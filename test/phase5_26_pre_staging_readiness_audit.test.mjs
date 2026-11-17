import assert from "node:assert";
import { test } from "node:test";
import fs from "node:fs";

// Import compiled backend modules
import { GeminiProvider } from "../backend/dist/services/ai/GeminiProvider.js";
import { MockAIProvider } from "../backend/dist/services/ai/MockAIProvider.js";
import { AIResponseValidator } from "../backend/dist/services/ai/AIResponseValidator.js";
import {
  AIUsageTracker,
  USER_AI_RPM_LIMIT,
  USER_AI_DAILY_LIMIT,
  REDIS_COOLDOWN_KEY,
} from "../backend/dist/services/ai/AIUsageTracker.js";
import { DocumentUnderstandingService } from "../backend/dist/services/ai/DocumentUnderstandingService.js";
import {
  AIOrchestrationService,
  ASSIGNMENT_SCHEMA_VERSION,
} from "../backend/dist/services/ai/AIOrchestrationService.js";

// ============================================================================
// AUDIT 1: Gemini API Verification (Fallback, Gating & Token Accounting)
// ============================================================================
test("Audit 1.1: Gemini Fallback Triggered on HTTP 404 & 503", async () => {
  const gemini = new GeminiProvider();
  assert.strictEqual(gemini.defaultModel, "gemini-2.5-flash");
  assert.strictEqual(gemini.fallbackModel, "gemini-1.5-flash");

  // Save original fetch
  const originalFetch = globalThis.fetch;

  try {
    // Scenario A: HTTP 404 on defaultModel -> Fallback to gemini-1.5-flash succeeds
    const callLog = [];
    globalThis.fetch = async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes("gemini-2.5-flash")) {
        callLog.push("gemini-2.5-flash:404");
        return new Response("Model not found", { status: 404, statusText: "Not Found" });
      }
      if (urlStr.includes("gemini-1.5-flash")) {
        callLog.push("gemini-1.5-flash:200");
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{"title":"Fallback Essay"}' }] } }],
            usageMetadata: { promptTokenCount: 150, candidatesTokenCount: 80, totalTokenCount: 230 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      throw new Error(`Unexpected URL: ${urlStr}`);
    };

    // Temporarily set a dummy key to enable provider
    process.env.GEMINI_API_KEY = "test_audit_key_123";

    const res404 = await gemini.generateStructuredContent({ userPrompt: "Test 404 fallback" });
    assert.strictEqual(res404.success, true);
    assert.strictEqual(res404.metrics.modelUsed, "gemini-1.5-flash", "Must record fallback model");
    assert.deepStrictEqual(callLog, ["gemini-2.5-flash:404", "gemini-1.5-flash:200"]);
    assert.strictEqual(res404.metrics.tokenUsage?.totalTokens, 230);

    // Scenario B: HTTP 503 on defaultModel -> Fallback to gemini-1.5-flash succeeds
    callLog.length = 0;
    globalThis.fetch = async (url, opts) => {
      const urlStr = String(url);
      if (urlStr.includes("gemini-2.5-flash")) {
        callLog.push("gemini-2.5-flash:503");
        return new Response("Service Unavailable", { status: 503, statusText: "Unavailable" });
      }
      if (urlStr.includes("gemini-1.5-flash")) {
        callLog.push("gemini-1.5-flash:200");
        return new Response(
          JSON.stringify({
            candidates: [{ content: { parts: [{ text: '{"title":"503 Recovered"}' }] } }],
            usageMetadata: { promptTokenCount: 110, candidatesTokenCount: 45, totalTokenCount: 155 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }
      throw new Error(`Unexpected URL: ${urlStr}`);
    };

    const res503 = await gemini.generateStructuredContent({ userPrompt: "Test 503 fallback" });
    assert.strictEqual(res503.success, true);
    assert.strictEqual(res503.metrics.modelUsed, "gemini-1.5-flash");
    assert.deepStrictEqual(callLog, ["gemini-2.5-flash:503", "gemini-1.5-flash:200"]);
    assert.strictEqual(res503.metrics.tokenUsage?.totalTokens, 155);
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GEMINI_API_KEY;
  }
});

test("Audit 1.2: Gemini Refuses Fallback on HTTP 401, 403 & 429", async () => {
  const gemini = new GeminiProvider();
  const originalFetch = globalThis.fetch;

  try {
    process.env.GEMINI_API_KEY = "test_audit_key_123";

    // 1. HTTP 401: Unauthorized -> NO fallback allowed
    let attempts = [];
    globalThis.fetch = async (url) => {
      attempts.push(String(url));
      return new Response("API key invalid", { status: 401 });
    };
    const res401 = await gemini.generateStructuredContent({ userPrompt: "Test 401" });
    assert.strictEqual(res401.success, false);
    assert.strictEqual(res401.error?.code, "PROVIDER_ERROR");
    assert.strictEqual(attempts.length, 1, "401 must NEVER attempt fallback to secondary model");

    // 2. HTTP 403: Forbidden -> NO fallback allowed
    attempts = [];
    globalThis.fetch = async (url) => {
      attempts.push(String(url));
      return new Response("Permission denied", { status: 403 });
    };
    const res403 = await gemini.generateStructuredContent({ userPrompt: "Test 403" });
    assert.strictEqual(res403.success, false);
    assert.strictEqual(res403.error?.code, "PROVIDER_ERROR");
    assert.strictEqual(attempts.length, 1, "403 must NEVER attempt fallback to secondary model");

    // 3. HTTP 429: Quota Exceeded -> NO fallback allowed, triggers shared cooldown
    AIUsageTracker.resetForTesting();
    attempts = [];
    globalThis.fetch = async (url) => {
      attempts.push(String(url));
      return new Response("RESOURCE_EXHAUSTED", { status: 429 });
    };
    const res429 = await gemini.generateStructuredContent({ userPrompt: "Test 429" });
    assert.strictEqual(res429.success, false);
    assert.strictEqual(res429.error?.code, "QUOTA_EXHAUSTED");
    assert.strictEqual(attempts.length, 1, "429 must NEVER cascade to burn fallback model quota");
    assert(AIUsageTracker.getTelemetry().isCoolingDown, "429 must engage shared cooldown");
  } finally {
    globalThis.fetch = originalFetch;
    delete process.env.GEMINI_API_KEY;
    AIUsageTracker.resetForTesting();
  }
});

// ============================================================================
// AUDIT 2: Redis Distributed Rate Limiter & Cooldown Verification
// ============================================================================
test("Audit 2.1: Atomic Counters, Concurrency, Restarts & Failures", async () => {
  const redisStore = new Map();
  const redisTtls = new Map();

  // High-fidelity Redis mock tracking atomicity and TTLs
  const mockRedisClient = {
    async get(key) {
      return redisStore.has(key) ? String(redisStore.get(key)) : null;
    },
    async set(key, value, options) {
      redisStore.set(key, value);
      if (options?.EX) redisTtls.set(key, options.EX);
      return "OK";
    },
    async incr(key) {
      const current = parseInt(redisStore.get(key) || "0", 10) + 1;
      redisStore.set(key, current);
      return current;
    },
    async expire(key, seconds) {
      redisTtls.set(key, seconds);
      return 1;
    },
    async ttl(key) {
      return redisTtls.get(key) || -1;
    },
    async del(key) {
      redisStore.delete(key);
      redisTtls.delete(key);
      return 1;
    },
  };

  AIUsageTracker.resetForTesting();
  AIUsageTracker.setRedisClient(mockRedisClient);

  const testUid = "usr_redis_audit_100";

  // A. Atomic Concurrent Bursts: 10 parallel increments
  await Promise.all(
    Array.from({ length: 10 }).map(() => AIUsageTracker.incrementUserUsage(testUid))
  );

  assert.strictEqual(
    redisStore.get(`ai:rpm:${testUid}`),
    10,
    "10 concurrent increments must result in exactly 10 in Redis"
  );
  assert(redisTtls.get(`ai:rpm:${testUid}`) > 0, "RPM key must have TTL set");

  // B. Verification of Daily Counter format
  const todayStr = new Date().toISOString().slice(0, 10);
  assert.strictEqual(
    redisStore.get(`ai:daily:${testUid}:${todayStr}`),
    10,
    "Daily counter must accurately reflect 10 requests"
  );
  assert.strictEqual(redisTtls.get(`ai:daily:${testUid}:${todayStr}`), 86400, "Daily TTL must be 24 hours");

  // C. Process Restart / Multi-Dyno Simulation:
  // Reset local static state (simulating container crash & fresh dyno startup)
  AIUsageTracker.resetForTesting();
  AIUsageTracker.setRedisClient(mockRedisClient); // reconnected to shared Redis

  // Verify that the new instance honors existing Redis counters
  // Since limit is 10 RPM, user should now be blocked on 11th request!
  const checkAfterRestart = await AIUsageTracker.canUserRequest(testUid);
  assert.strictEqual(
    checkAfterRestart.allowed,
    false,
    "State MUST survive container restarts via shared Redis"
  );
  assert(checkAfterRestart.reason?.includes("Rate limit reached"));

  // D. Shared 429 Cooldown across dynos:
  await AIUsageTracker.reportQuotaExhaustion(30000); // 30s
  assert(redisStore.has(REDIS_COOLDOWN_KEY), "Shared cooldown must be present in Redis");
  assert.strictEqual(redisTtls.get(REDIS_COOLDOWN_KEY), 30, "Cooldown TTL must match seconds");

  // A completely new user on this or any dyno is blocked by shared cooldown
  const checkOtherUser = await AIUsageTracker.canUserRequest("usr_dyno_2_new");
  assert.strictEqual(
    checkOtherUser.allowed,
    false,
    "Shared 429 cooldown must block all users across all instances"
  );

  // E. Redis Outage Resilience (Fail-Open Conservative Local Fallback):
  const deadRedisClient = {
    async get() { throw new Error("ECONNREFUSED: Redis down"); },
    async set() { throw new Error("ECONNREFUSED: Redis down"); },
    async incr() { throw new Error("ECONNREFUSED: Redis down"); },
    async expire() { throw new Error("ECONNREFUSED: Redis down"); },
    async ttl() { throw new Error("ECONNREFUSED: Redis down"); },
  };

  AIUsageTracker.resetForTesting();
  AIUsageTracker.setRedisClient(deadRedisClient);

  // Outage fallback must gracefully allow valid requests within local window without throwing fatal errors
  const outageCheck = await AIUsageTracker.canUserRequest("usr_outage_fallback");
  assert.strictEqual(outageCheck.allowed, true, "Outage fallback must safely permit legitimate requests");

  AIUsageTracker.resetForTesting();
});

// ============================================================================
// AUDIT 3: Cache Security, Tenant Isolation & Token Minimization
// ============================================================================
test("Audit 3.1: Strict Tenant Isolation & Zero-Token Cache Hits", async () => {
  AIUsageTracker.resetForTesting();
  AIOrchestrationService.clearCacheForTesting();

  const mockAI = new MockAIProvider("SUCCESS");
  AIOrchestrationService.setProvider(mockAI);

  const sharedBriefText = "Evaluation of corporate sustainability compliance under EU Taxonomy guidelines.";

  // Tenant Alpha submits document
  const callTenantAlpha = await AIOrchestrationService.processAssignmentUnderstanding({
    rawText: sharedBriefText,
    userUid: "tenant_alpha_uid",
    fileId: "confidential_alpha_file_001",
    forceAI: true,
  });

  assert.strictEqual(callTenantAlpha.isCached, false);
  assert.strictEqual(callTenantAlpha.strategyUsed, "ai_structured");
  assert(callTenantAlpha.tokenUsage && callTenantAlpha.tokenUsage.totalTokens > 0);

  // Tenant Beta submits identical document text
  const callTenantBeta = await AIOrchestrationService.processAssignmentUnderstanding({
    rawText: sharedBriefText,
    userUid: "tenant_beta_uid",
    fileId: "confidential_beta_file_002",
  });

  // Verify Tenant Isolation Invariants:
  assert.strictEqual(callTenantBeta.isCached, true, "Tenant Beta must hit cache");
  assert.strictEqual(callTenantBeta.strategyUsed, "cache_hit_memory");
  assert.strictEqual(callTenantBeta.tokenUsage, undefined, "Cache hits must consume 0 tokens");

  // Verify that NO metadata from Tenant Alpha leaked to Tenant Beta
  assert.strictEqual(callTenantBeta.fileId, undefined, "fileId must NEVER be returned from cache");
  assert.strictEqual(callTenantBeta.userUid, undefined, "userUid must NEVER be returned from cache");

  // Verify Cache Key Identity Properties:
  const keyOriginal = AIOrchestrationService.computeCacheKey({
    rawText: sharedBriefText,
    providerId: "google_gemini",
    modelUsed: "gemini-2.5-flash",
    schemaVersion: ASSIGNMENT_SCHEMA_VERSION,
  });

  const keyDifferentModel = AIOrchestrationService.computeCacheKey({
    rawText: sharedBriefText,
    providerId: "google_gemini",
    modelUsed: "gemini-1.5-flash", // different model
    schemaVersion: ASSIGNMENT_SCHEMA_VERSION,
  });

  const keyDifferentSchema = AIOrchestrationService.computeCacheKey({
    rawText: sharedBriefText,
    providerId: "google_gemini",
    modelUsed: "gemini-2.5-flash",
    schemaVersion: "v1.1", // old schema version
  });

  assert.notStrictEqual(keyOriginal, keyDifferentModel, "Model difference must generate distinct cache key");
  assert.notStrictEqual(keyOriginal, keyDifferentSchema, "Schema version change must invalidate cache key");
});

// ============================================================================
// AUDIT 4: Document Understanding Completeness & Bypass Gates
// ============================================================================
test("Audit 4.1: Critical-Field Gates on All 7 Document Combinations", async () => {
  const mockAI = new MockAIProvider("SUCCESS");

  // 1. Title only -> Must NOT bypass AI
  const docTitleOnly = `
    Advanced Investment Banking Portfolio Analysis
  `;
  const res1 = await DocumentUnderstandingService.understandDocumentText({
    rawText: docTitleOnly,
    aiProvider: mockAI,
    forceAI: false,
  });
  assert.strictEqual(res1.strategyUsed, "ai_structured", "Doc 1 (Title only) must NOT bypass AI");

  // 2. Title and word count -> Must NOT bypass AI
  const docTitleWordCount = `
    Advanced Investment Banking Portfolio Analysis
    Word count: 2500 words
  `;
  const res2 = await DocumentUnderstandingService.understandDocumentText({
    rawText: docTitleWordCount,
    aiProvider: mockAI,
    forceAI: false,
  });
  assert.strictEqual(res2.strategyUsed, "ai_structured", "Doc 2 (Title + WordCount) must NOT bypass AI");

  // 3. Title and referencing style -> Must NOT bypass AI
  const docTitleReferencing = `
    Advanced Investment Banking Portfolio Analysis
    Referencing: Harvard style
  `;
  const res3 = await DocumentUnderstandingService.understandDocumentText({
    rawText: docTitleReferencing,
    aiProvider: mockAI,
    forceAI: false,
  });
  assert.strictEqual(res3.strategyUsed, "ai_structured", "Doc 3 (Title + Referencing) must NOT bypass AI");

  // 4. Title and instructions (No constraint: missing wordCount and deadline) -> Must NOT bypass AI
  const docTitleInstructions = `
    Advanced Investment Banking Portfolio Analysis
    Instructions:
    Critically evaluate value-at-risk hedging models for bond portfolios.
  `;
  const res4 = await DocumentUnderstandingService.understandDocumentText({
    rawText: docTitleInstructions,
    aiProvider: mockAI,
    forceAI: false,
  });
  assert.strictEqual(res4.strategyUsed, "ai_structured", "Doc 4 (Title + Instructions, no constraints) must NOT bypass AI");

  // 5. Title and questions (No constraint: missing wordCount and deadline) -> Must NOT bypass AI
  const docTitleQuestions = `
    Advanced Investment Banking Portfolio Analysis
    Assignment Questions:
    Question 1. Calculate duration and convexity of the given bond structure.
  `;
  const res5 = await DocumentUnderstandingService.understandDocumentText({
    rawText: docTitleQuestions,
    aiProvider: mockAI,
    forceAI: false,
  });
  assert.strictEqual(res5.strategyUsed, "ai_structured", "Doc 5 (Title + Questions, no constraints) must NOT bypass AI");

  // 6. Title, questions and word count (All 3 critical gates satisfied + high score) -> Bypasses AI safely!
  const docTitleQuestionsWordCount = `
    Advanced Investment Banking Portfolio Analysis
    Word count: 3000 words
    Referencing: Harvard style
    Assignment Questions:
    Question 1. Calculate duration and convexity of the given bond structure.
    Question 2. Recommend optimal hedging strategies.
  `;
  const res6 = await DocumentUnderstandingService.understandDocumentText({
    rawText: docTitleQuestionsWordCount,
    aiProvider: mockAI,
    forceAI: false,
  });
  assert.strictEqual(
    res6.strategyUsed,
    "rule_based_only",
    "Doc 6 (Title + Questions + WordCount) CAN safely bypass AI"
  );
  assert.strictEqual(res6.parsedFields.title, "Advanced Investment Banking Portfolio Analysis");
  assert.strictEqual(res6.parsedFields.wordCount, 3000);

  // 7. Title, instructions and deadline (All 3 critical gates satisfied + high score) -> Bypasses AI safely!
  const docTitleInstructionsDeadline = `
    Strategic Human Resource Management
    Submission deadline: 2026-12-18
    Referencing: APA style
    Instructions:
    Analyze employee turnover and retention in high-tech consulting firms. Provide structured recommendations.
  `;
  const res7 = await DocumentUnderstandingService.understandDocumentText({
    rawText: docTitleInstructionsDeadline,
    aiProvider: mockAI,
    forceAI: false,
  });
  assert.strictEqual(
    res7.strategyUsed,
    "rule_based_only",
    "Doc 7 (Title + Instructions + Deadline) CAN safely bypass AI"
  );
  assert.strictEqual(res7.parsedFields.title, "Strategic Human Resource Management");
  assert.strictEqual(res7.parsedFields.deadline, "2026-12-18");
});

// ============================================================================
// AUDIT 5: Firebase Spark Plan & Architectural Constraints Invariant
// ============================================================================
test("Audit 5.1: Zero Cloud Functions, Zero Vertex AI & Spark Invariant", () => {
  const rootPkg = JSON.parse(fs.readFileSync("package.json", "utf-8"));
  const backendPkg = JSON.parse(fs.readFileSync("backend/package.json", "utf-8"));
  const allDeps = {
    ...rootPkg.dependencies,
    ...rootPkg.devDependencies,
    ...backendPkg.dependencies,
    ...backendPkg.devDependencies,
  };

  assert(!allDeps["@google-cloud/vertexai"], "Vertex AI package must NOT be installed (Spark Invariant)");
  assert(!allDeps["@google-cloud/tasks"], "Cloud Tasks must NOT be installed (Spark Invariant)");
  assert(!allDeps["@google-cloud/run"], "Cloud Run must NOT be installed (Spark Invariant)");

  // Verify that frontend .env.local does not expose Gemini API keys
  if (fs.existsSync(".env.local")) {
    const envLocal = fs.readFileSync(".env.local", "utf-8");
    assert(!envLocal.includes("GEMINI_API_KEY"), ".env.local must NOT expose GEMINI_API_KEY to client bundle");
  }
});
