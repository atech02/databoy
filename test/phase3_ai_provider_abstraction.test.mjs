import assert from "node:assert";
import { test } from "node:test";
import fs from "node:fs";

// Import Phase 3 Backend AI modules
import { MockAIProvider } from "../backend/dist/services/ai/MockAIProvider.js";
import { AIResponseValidator } from "../backend/dist/services/ai/AIResponseValidator.js";
import {
  AIUsageTracker,
  USER_AI_RPM_LIMIT,
  USER_AI_DAILY_LIMIT,
  REDIS_COOLDOWN_KEY,
} from "../backend/dist/services/ai/AIUsageTracker.js";
import { DocumentUnderstandingService } from "../backend/dist/services/ai/DocumentUnderstandingService.js";
import { AIOrchestrationService, ASSIGNMENT_SCHEMA_VERSION } from "../backend/dist/services/ai/AIOrchestrationService.js";
import { GeminiProvider } from "../backend/dist/services/ai/GeminiProvider.js";

// ============================================================================
// SUITE 1: Mock & Interface Tests
// ============================================================================
test("Phase 3 - A1: MockAIProvider Implements AIProvider & Simulates Behaviors", async () => {
  const provider = new MockAIProvider("SUCCESS");
  assert.strictEqual(provider.id, "mock_ai_provider");
  assert.strictEqual(provider.isAvailable(), true);

  // 1. Success case
  const successRes = await provider.generateStructuredContent({
    userPrompt: "Parse assignment brief",
  });
  assert.strictEqual(successRes.success, true);
  assert(successRes.data, "Data must be populated on success");
  assert.strictEqual(successRes.data.title, "Corporate Governance & Ethics Case Study");
  assert.strictEqual(successRes.data.wordCount, 2500);

  // 2. Quota Exhaustion simulation
  provider.behavior = "QUOTA_EXHAUSTED";
  const quotaRes = await provider.generateStructuredContent({ userPrompt: "Test" });
  assert.strictEqual(quotaRes.success, false);
  assert.strictEqual(quotaRes.error?.code, "QUOTA_EXHAUSTED");

  // 3. Timeout simulation
  provider.behavior = "TIMEOUT";
  const timeoutRes = await provider.generateStructuredContent({ userPrompt: "Test" });
  assert.strictEqual(timeoutRes.success, false);
  assert.strictEqual(timeoutRes.error?.code, "TIMEOUT");

  // 4. Invalid JSON simulation
  provider.behavior = "INVALID_JSON";
  const invalidJsonRes = await provider.generateStructuredContent({ userPrompt: "Test" });
  assert.strictEqual(invalidJsonRes.success, true);
  assert(invalidJsonRes.rawText?.includes("This is not JSON"));
});

// ============================================================================
// SUITE 2: Schema Validation Tests
// ============================================================================
test("Phase 3 - B1: AIResponseValidator Strict Schema Validation & Sanitization", () => {
  // 1. Valid JSON
  const validJson = JSON.stringify({
    title: "  # Advanced Macroeconomic Policy Analysis  ",
    questions: "1. Evaluate inflation targeting.\n2. Assess exchange rate volatility.",
    instructions: "Word limit: 3000 words. APA style. Submit by 2026-12-20.",
    wordCount: 3000,
    referencingStyle: "apa",
    deadline: "2026-12-20",
    academicLevel: "postgraduate",
  });

  const res = AIResponseValidator.validateAssignmentBrief(validJson);
  assert.strictEqual(res.isValid, true);
  assert(res.data);
  assert.strictEqual(res.data.title, "Advanced Macroeconomic Policy Analysis", "Must trim and strip markdown headers");
  assert.strictEqual(res.data.wordCount, 3000);
  assert.strictEqual(res.data.referencingStyle, "APA", "Must normalize referencing style casing");
  assert.strictEqual(res.data.deadline, "2026-12-20");
  assert.strictEqual(res.data.academicLevel, "masters", "Must normalize postgraduate to masters");

  // 2. Empty or whitespace response
  const emptyRes = AIResponseValidator.validateAssignmentBrief("");
  assert.strictEqual(emptyRes.isValid, false);
  assert.strictEqual(emptyRes.errorCode, "EMPTY_RESPONSE");

  // 3. Truncated JSON
  const truncatedRes = AIResponseValidator.validateAssignmentBrief('{"title": "Unfinished essay", "wordCount": 200');
  assert.strictEqual(truncatedRes.isValid, false);
  assert.strictEqual(truncatedRes.errorCode, "TRUNCATED_JSON");

  // 4. Broken non-JSON
  const brokenRes = AIResponseValidator.validateAssignmentBrief("Random non-json text response from LLM");
  assert.strictEqual(brokenRes.isValid, false);
  assert.strictEqual(brokenRes.errorCode, "INVALID_JSON");

  // 5. Schema mismatch (array root)
  const arrayRes = AIResponseValidator.validateAssignmentBrief('["not", "an", "object"]');
  assert.strictEqual(arrayRes.isValid, false);
  assert.strictEqual(arrayRes.errorCode, "SCHEMA_MISMATCH");

  // 6. Word count bounds protection
  const outOfBoundsJson = JSON.stringify({
    title: "Test",
    questions: "Q1",
    instructions: "Inst",
    wordCount: 999999999,
  });
  const boundedRes = AIResponseValidator.validateAssignmentBrief(outOfBoundsJson);
  assert.strictEqual(boundedRes.isValid, true);
  assert.strictEqual(boundedRes.data?.wordCount, undefined, "Unrealistic word counts (>100k) must be dropped");
});

// ============================================================================
// SUITE 3: Redis Integration, Concurrency, Restarts & Failures
// ============================================================================
test("Phase 3 - C1: Redis-Backed AIUsageTracker Concurrency, Expiration & Outage Handling", async () => {
  // In-memory mock Redis store representing the shared Redis server
  const redisStorage = new Map();
  const redisTtls = new Map();

  const mockRedisClient = {
    async get(key) {
      return redisStorage.has(key) ? String(redisStorage.get(key)) : null;
    },
    async set(key, value, options) {
      redisStorage.set(key, value);
      if (options?.EX) {
        redisTtls.set(key, options.EX);
      }
      return "OK";
    },
    async incr(key) {
      const current = parseInt(redisStorage.get(key) || "0", 10) + 1;
      redisStorage.set(key, current);
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
      redisStorage.delete(key);
      redisTtls.delete(key);
      return 1;
    },
  };

  AIUsageTracker.resetForTesting();
  AIUsageTracker.setRedisClient(mockRedisClient);

  const testUser = "usr_redis_concurrent_789";

  // 1. Initial request allowed
  const check1 = await AIUsageTracker.canUserRequest(testUser);
  assert.strictEqual(check1.allowed, true);

  // 2. Consume full limit in Redis
  for (let i = 0; i < USER_AI_RPM_LIMIT; i++) {
    await AIUsageTracker.incrementUserUsage(testUser);
  }

  // 3. Rate limit exceeded in Redis
  const checkRpmExceeded = await AIUsageTracker.canUserRequest(testUser);
  assert.strictEqual(checkRpmExceeded.allowed, false);
  assert(checkRpmExceeded.reason?.includes("Rate limit reached"));
  assert(redisStorage.get(`ai:rpm:${testUser}`) >= USER_AI_RPM_LIMIT, "RPM counter must be in Redis");

  // 4. Test Persistence Across Process Restarts:
  // Simulate container crash/restart by resetting tracker static state while Redis persists!
  AIUsageTracker.resetForTesting();
  AIUsageTracker.setRedisClient(mockRedisClient); // reconnected to same Redis
  const checkAfterRestart = await AIUsageTracker.canUserRequest(testUser);
  assert.strictEqual(checkAfterRestart.allowed, false, "Rate limit MUST persist in Redis across process restarts");

  // 5. Test Shared Cooldown (ai:cooldown:google_gemini)
  await AIUsageTracker.reportQuotaExhaustion(45000); // 45 seconds
  assert(redisStorage.has(REDIS_COOLDOWN_KEY), "Shared cooldown key must exist in Redis");
  const checkCooldown = await AIUsageTracker.canUserRequest("another_user_456");
  assert.strictEqual(checkCooldown.allowed, false, "Shared 429 cooldown must block all users across instances");

  // 6. Test Redis Outage Handling:
  // When Redis throws errors, tracker must fall back to in-memory protection without crashing
  const failingRedisClient = {
    async get() { throw new Error("ECONNREFUSED - Redis cluster unavailable"); },
    async set() { throw new Error("ECONNREFUSED - Redis cluster unavailable"); },
    async incr() { throw new Error("ECONNREFUSED - Redis cluster unavailable"); },
    async expire() { throw new Error("ECONNREFUSED - Redis cluster unavailable"); },
    async ttl() { throw new Error("ECONNREFUSED - Redis cluster unavailable"); },
  };

  AIUsageTracker.resetForTesting();
  AIUsageTracker.setRedisClient(failingRedisClient);

  // Must not throw unhandled exception; must fall back to in-memory tracking
  const checkOutage = await AIUsageTracker.canUserRequest("outage_user_999");
  assert.strictEqual(checkOutage.allowed, true, "Outage fallback must safely allow within local limits");

  AIUsageTracker.resetForTesting();
});

// ============================================================================
// SUITE 4: Critical Field Gate & 75% Completeness Threshold
// ============================================================================
test("Phase 3 - D1: Document Completeness Critical-Field Gate Safeguard", async () => {
  const mockAI = new MockAIProvider("SUCCESS");

  // Test Case 1: Incomplete text with peripheral metadata ONLY (Title + WordCount + Referencing)
  // Under the old flawed calculation, this scored 75% and bypassed AI with NO questions!
  // Under the new critical-field gate, hasContent is false, so it MUST NOT bypass AI!
  const metadataOnlyText = `
    Strategic Marketing Plan
    Word count: 2000 words
    Referencing: Harvard
    Deadline: 2026-12-15
  `;

  const res1 = await DocumentUnderstandingService.understandDocumentText({
    rawText: metadataOnlyText,
    aiProvider: mockAI,
    forceAI: false,
  });

  assert.strictEqual(
    res1.strategyUsed,
    "ai_structured",
    "Missing questions/instructions must NEVER bypass AI, regardless of peripheral score"
  );

  // Test Case 2: Full document with ALL critical fields present (Title + Questions + WordCount)
  const completeBriefText = `
    Business Strategy and Sustainability
    Word count: 2500 words
    Referencing: Harvard style
    Submission deadline: 2026-12-15
    Instructions:
    Critically analyze ESG reporting standards in modern banking. Answer all questions thoroughly.
  `;

  const res2 = await DocumentUnderstandingService.understandDocumentText({
    rawText: completeBriefText,
    aiProvider: mockAI,
    forceAI: false,
  });

  assert.strictEqual(
    res2.strategyUsed,
    "rule_based_only",
    "Complete brief with Title + Questions + Constraints can safely bypass AI"
  );
  assert.strictEqual(res2.parsedFields.title, "Business Strategy and Sustainability");
  assert.strictEqual(res2.parsedFields.wordCount, 2500);

  // Test Case 3: Missing Title (only questions + word count)
  const noTitleText = `
    Word count: 1500 words
    Deadline: 2026-12-30
    Instructions:
    Discuss the implications of macroeconomic shifts on local commercial banks.
  `;

  const res3 = await DocumentUnderstandingService.understandDocumentText({
    rawText: noTitleText,
    aiProvider: mockAI,
    forceAI: false,
  });

  assert.strictEqual(
    res3.strategyUsed,
    "ai_structured",
    "Missing title must NEVER bypass AI"
  );
});

// ============================================================================
// SUITE 5: Cache Security, Model Awareness & Tenant Isolation
// ============================================================================
test("Phase 3 - E1: Model-Aware Cache Keys, Schema Invalidation & Tenant Isolation", async () => {
  AIUsageTracker.resetForTesting();
  AIOrchestrationService.clearCacheForTesting();

  const sampleText = "Case study evaluation of supply chain resilience in post-pandemic commerce.";

  // 1. Model-aware cache key uniqueness
  const keyModel1 = AIOrchestrationService.computeCacheKey({
    rawText: sampleText,
    providerId: "google_gemini",
    modelUsed: "gemini-2.5-flash",
    schemaVersion: ASSIGNMENT_SCHEMA_VERSION,
  });

  const keyModel2 = AIOrchestrationService.computeCacheKey({
    rawText: sampleText,
    providerId: "google_gemini",
    modelUsed: "gemini-1.5-flash", // Fallback model must have distinct cache key
    schemaVersion: ASSIGNMENT_SCHEMA_VERSION,
  });

  assert.notStrictEqual(keyModel1, keyModel2, "Different models must generate distinct cache keys");

  // 2. Schema version invalidation
  const keyOldSchema = AIOrchestrationService.computeCacheKey({
    rawText: sampleText,
    providerId: "google_gemini",
    modelUsed: "gemini-2.5-flash",
    schemaVersion: "v1.0",
  });
  assert.notStrictEqual(keyModel1, keyOldSchema, "Schema upgrades must invalidate previous cache keys");

  // 3. Execution & Cache Hit Verification
  const mockAI = new MockAIProvider("SUCCESS");
  AIOrchestrationService.setProvider(mockAI);

  const call1 = await AIOrchestrationService.processAssignmentUnderstanding({
    rawText: sampleText,
    userUid: "user_tenant_alpha",
    fileId: "file_secret_123", // fileId must NOT leak to user B
    forceAI: true,
  });
  assert.strictEqual(call1.isCached, false);
  assert.strictEqual(call1.strategyUsed, "ai_structured");

  // Call from different user with same text (Tenant Beta)
  const call2 = await AIOrchestrationService.processAssignmentUnderstanding({
    rawText: sampleText,
    userUid: "user_tenant_beta",
  });
  assert.strictEqual(call2.isCached, true);
  assert.strictEqual(call2.strategyUsed, "cache_hit_memory");
  // Result must be strictly parsed assignment fields without leaking fileId or userUid
  assert.strictEqual(call2.parsedFields.title, call1.parsedFields.title);
  assert.strictEqual(call2.fileId, undefined, "fileId must NEVER be returned from cache to another tenant");
  assert.strictEqual(call2.userUid, undefined, "userUid must NEVER be returned from cache to another tenant");
});

// ============================================================================
// SUITE 6: Gemini Fallback Gating by HTTP Status
// ============================================================================
test("Phase 3 - F1: Gemini Fallback Gated by HTTP Status (404/503 vs 401/403/429)", async () => {
  // Verify that GeminiProvider structure enforces fallback only on 404/503
  const gemini = new GeminiProvider();
  assert.strictEqual(gemini.defaultModel, "gemini-2.5-flash");
  assert.strictEqual(gemini.fallbackModel, "gemini-1.5-flash");

  // Audit provider source code to ensure 401, 403, and 429 NEVER call fallbackModel
  const providerSrc = fs.readFileSync("backend/src/services/ai/GeminiProvider.ts", "utf-8");

  // Must check 429 before fallback
  const pos429 = providerSrc.indexOf("response.status === 429");
  const posFallback = providerSrc.indexOf("response.status === 404 || response.status === 503");
  const pos401 = providerSrc.indexOf("response.status === 401 || response.status === 403");

  assert(pos429 !== -1, "Must handle 429 status");
  assert(pos401 !== -1, "Must handle 401/403 auth errors");
  assert(posFallback !== -1, "Must gate fallback on 404 and 503");
  assert(pos429 < posFallback, "429 check must precede any fallback attempt");
  assert(pos401 < posFallback, "401/403 check must precede any fallback attempt");
});

// ============================================================================
// SUITE 7: Token Accounting Precision & Security
// ============================================================================
test("Phase 3 - G1: Token Accounting Precision Across All Execution Paths", async () => {
  const mockAI = new MockAIProvider("SUCCESS");
  AIOrchestrationService.setProvider(mockAI);
  AIUsageTracker.resetForTesting();
  AIOrchestrationService.clearCacheForTesting();

  // Path 1: Local-only processing (0 tokens)
  const completeText = `
    Marketing Strategy
    Word count: 2000 words
    Deadline: 2026-12-25
    Instructions: Complete all case questions on market entry barriers.
  `;
  const resLocal = await AIOrchestrationService.processAssignmentUnderstanding({
    rawText: completeText,
    userUid: "user_token_1",
    forceAI: false,
  });
  assert.strictEqual(resLocal.strategyUsed, "rule_based_only");
  assert.strictEqual(resLocal.tokenUsage, undefined, "Local-only processing must consume 0 tokens");

  // Path 2: AI structured call (tokens reported from provider)
  const sparseText = "Critical essay questions on blockchain consensus algorithms.";
  const resAI = await AIOrchestrationService.processAssignmentUnderstanding({
    rawText: sparseText,
    userUid: "user_token_2",
    forceAI: true,
  });
  assert.strictEqual(resAI.strategyUsed, "ai_structured");
  assert(resAI.tokenUsage && resAI.tokenUsage.totalTokens > 0, "AI call must accurately report tokens");

  // Path 3: Cache hit (0 tokens)
  const resCache = await AIOrchestrationService.processAssignmentUnderstanding({
    rawText: sparseText,
    userUid: "user_token_3",
  });
  assert.strictEqual(resCache.isCached, true);
  assert.strictEqual(resCache.tokenUsage, undefined, "Cache hits must consume 0 tokens");
});
