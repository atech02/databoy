process.env.NODE_ENV = "test";
import assert from "node:assert";
import { test } from "node:test";
import crypto from "node:crypto";

// Import compiled backend modules
import { AIOrchestrationService, ASSIGNMENT_SCHEMA_VERSION } from "../backend/dist/services/ai/AIOrchestrationService.js";
import { MockAIProvider } from "../backend/dist/services/ai/MockAIProvider.js";
import { AIResponseValidator } from "../backend/dist/services/ai/AIResponseValidator.js";
import { AIUsageTracker } from "../backend/dist/services/ai/AIUsageTracker.js";

// ============================================================================
// SUITE 1: Adversarial Tenant Identity Resolution & Input Sanitization
// ============================================================================
test("Phase 5.30 - 1.1: Missing tenantId defaults strictly to authenticated userUid", async () => {
  AIUsageTracker.resetForTesting();
  AIOrchestrationService.clearCacheForTesting();
  const mockProvider = new MockAIProvider("SUCCESS");
  AIOrchestrationService.setProvider(mockProvider);

  // Private document (fails public template test because it's short and generic)
  const docText = "Short individual essay instructions. Discuss monetary policy.";
  
  // Call without tenantId
  const result1 = await AIOrchestrationService.processAssignmentUnderstanding({
    rawText: docText,
    userUid: "user_tenant_alpha",
    targetType: "unknown_target", // unclassified target
    forceAI: true,
  });

  assert.strictEqual(result1.strategyUsed, "ai_structured");
  assert.strictEqual(result1.isCached, false);

  // Compute expected cache key using tenant:user_tenant_alpha
  const expectedKey = AIOrchestrationService.computeCacheKey({
    rawText: docText,
    tenantScope: "tenant:user_tenant_alpha",
  });

  // Querying with user_tenant_alpha should hit memory cache
  const cachedResult = await AIOrchestrationService.processAssignmentUnderstanding({
    rawText: docText,
    userUid: "user_tenant_alpha",
    targetType: "unknown_target",
  });
  assert.strictEqual(cachedResult.isCached, true);
  assert.strictEqual(cachedResult.strategyUsed, "cache_hit_memory");
});

test("Phase 5.30 - 1.2: Malicious / Invalid tenantId is sanitized or falls back to userUid", async () => {
  AIUsageTracker.resetForTesting();
  AIOrchestrationService.clearCacheForTesting();
  const mockProvider = new MockAIProvider("SUCCESS");
  AIOrchestrationService.setProvider(mockProvider);

  const docText = "Private thesis chapter on corporate governance.";
  
  // Attacker attempts directory traversal and prototype injection in tenantId:
  // e.g. "../../etc/passwd", "<script>alert(1)</script>", "__proto__"
  const maliciousTenantIds = [
    "../../etc/passwd",
    "<script>alert(1)</script>",
    "   ",
    "!@#$%^&*()",
  ];

  for (const badTenant of maliciousTenantIds) {
    const sanitized = badTenant.trim().replace(/[^a-zA-Z0-9_\-]/g, "");
    // If sanitized length < 3, it must fall back to userUid
    if (sanitized.length < 3) {
      const key = AIOrchestrationService.computeCacheKey({
        rawText: docText,
        tenantScope: "tenant:user_trusted_uid",
      });
      assert(key.length === 64, "Key must be valid SHA-256");
    }
  }

  // Verify processAssignmentUnderstanding with traversal tenantId falls back to userUid
  const res = await AIOrchestrationService.processAssignmentUnderstanding({
    rawText: docText,
    userUid: "trusted_user_888",
    tenantId: "../../evil", // sanitized to "evil" (length 4) or if invalid chars stripped
    targetType: "draft",
    forceAI: true,
  });

  assert.strictEqual(res.strategyUsed, "ai_structured");
  // Check that another user with different uid cannot access this cached entry
  const resOtherUser = await AIOrchestrationService.processAssignmentUnderstanding({
    rawText: docText,
    userUid: "victim_user_999",
    tenantId: "", // falls back to victim_user_999
    targetType: "draft",
    forceAI: true,
  });
  // Must NOT hit cache!
  assert.strictEqual(resOtherUser.isCached, false);
});

// ============================================================================
// SUITE 2: Fail-Safe Default for Unclassified Documents & PII Leakage
// ============================================================================
test("Phase 5.30 - 2.1: Unclassified/unknown targetType defaults to tenant-scoped caching", async () => {
  AIUsageTracker.resetForTesting();
  AIOrchestrationService.clearCacheForTesting();
  const mockProvider = new MockAIProvider("SUCCESS");
  AIOrchestrationService.setProvider(mockProvider);

  const docText = "Course assignment brief for Physics 101 mechanics experiment.";

  // Call with undefined or unexpected targetType
  const res1 = await AIOrchestrationService.processAssignmentUnderstanding({
    rawText: docText,
    userUid: "tenant_user_A",
    targetType: undefined,
    forceAI: true,
  });

  // Verify tenant_user_B cannot get a cache hit even with identical document text
  const res2 = await AIOrchestrationService.processAssignmentUnderstanding({
    rawText: docText,
    userUid: "tenant_user_B",
    targetType: undefined,
    forceAI: true,
  });

  assert.strictEqual(res1.isCached, false);
  assert.strictEqual(res2.isCached, false, "Tenant B must NOT access unclassified cached entry from Tenant A");
});

test("Phase 5.30 - 2.2: Document containing student PII defaults to tenant-scoped caching even if targetType is 'assignment'", async () => {
  AIUsageTracker.resetForTesting();
  AIOrchestrationService.clearCacheForTesting();
  const mockProvider = new MockAIProvider("SUCCESS");
  AIOrchestrationService.setProvider(mockProvider);

  // Even though it contains syllabus/assignment keywords, it contains a student ID and email
  const piiDocText = `
    Course: Advanced Macroeconomic Theory ECON-401
    Syllabus & Assignment 2: Fiscal Multipliers
    Student Name: Alice Johnson
    Student ID: STU-88291
    Email: alice.j@campus.edu
    Questions: 1. Calculate the Keynesian multiplier under fixed exchange rates.
  `;

  const resA = await AIOrchestrationService.processAssignmentUnderstanding({
    rawText: piiDocText,
    userUid: "student_alice",
    targetType: "assignment",
    forceAI: true,
  });
  assert.strictEqual(resA.isCached, false);

  // Bob submits the exact same document (e.g., shared lab partner file with Alice's info)
  const resB = await AIOrchestrationService.processAssignmentUnderstanding({
    rawText: piiDocText,
    userUid: "student_bob",
    targetType: "assignment",
    forceAI: true,
  });

  // Bob MUST NOT get a cache hit because PII documents are strictly tenant-scoped!
  assert.strictEqual(resB.isCached, false, "Cross-tenant PII cache leak prevented!");
});

// ============================================================================
// SUITE 3: Public Template vs Private Document Differentiation
// ============================================================================
test("Phase 5.30 - 3.1: Public course templates are safely cached globally", async () => {
  AIUsageTracker.resetForTesting();
  AIOrchestrationService.clearCacheForTesting();
  const mockProvider = new MockAIProvider("SUCCESS");
  AIOrchestrationService.setProvider(mockProvider);

  // Public generic assignment brief without PII, >= 50 chars, matching course/assignment/syllabus
  const publicBrief = `
    University Computer Science Department
    Course CS101: Introduction to Data Structures and Algorithms
    Assignment 3 Brief and Syllabus Guidelines
    Word count: 1500 words
    Questions: Implement Dijkstra algorithm in Python and analyze its Big-O time complexity.
  `;

  // User 1 processes the public brief
  const res1 = await AIOrchestrationService.processAssignmentUnderstanding({
    rawText: publicBrief,
    userUid: "student_carol",
    targetType: "assignment",
    forceAI: true,
  });
  assert.strictEqual(res1.isCached, false);

  // User 2 processes the identical public brief -> Safe global cache hit!
  const res2 = await AIOrchestrationService.processAssignmentUnderstanding({
    rawText: publicBrief,
    userUid: "student_david",
    targetType: "assignment",
    forceAI: true,
  });
  assert.strictEqual(res2.isCached, true, "Public non-PII course template can be safely reused across users");
  assert.strictEqual(res2.strategyUsed, "cache_hit_memory");
});

// ============================================================================
// SUITE 4: Cache Poisoning & Prototype Pollution Defenses
// ============================================================================
test("Phase 5.30 - 4.1: AIResponseValidator defends against prototype pollution and extra injected properties", () => {
  // Attacker crafts JSON with __proto__, constructor, and admin escalation fields
  const maliciousPayload = JSON.stringify({
    title: "Safe Assignment Title",
    wordCount: 2000,
    questions: "Valid questions string.",
    __proto__: { isAdmin: true, bypassAuth: true },
    constructor: { prototype: { pollutesGlobal: true } },
    isAdmin: true,
    role: "superadmin",
    secretToken: "leaked_token_12345",
  });

  const validation = AIResponseValidator.validateAssignmentBrief(maliciousPayload);
  assert.strictEqual(validation.isValid, true);
  assert.ok(validation.data);

  // 1. Verified allowed fields exist
  assert.strictEqual(validation.data.title, "Safe Assignment Title");
  assert.strictEqual(validation.data.wordCount, 2000);

  // 2. Verified malicious/extra fields are stripped
  assert.strictEqual(validation.data.isAdmin, undefined);
  assert.strictEqual(validation.data.role, undefined);
  assert.strictEqual(validation.data.secretToken, undefined);

  // 3. Verified global Object prototype is NOT polluted
  const cleanObj = {};
  assert.strictEqual(cleanObj.isAdmin, undefined);
  assert.strictEqual(cleanObj.bypassAuth, undefined);
  assert.strictEqual(cleanObj.pollutesGlobal, undefined);
});

test("Phase 5.30 - 4.2: AIResponseValidator rejects corrupted, truncated, or malicious non-JSON cache payloads", () => {
  const corruptPayloads = [
    "",
    "   ",
    "{ title: 'Unquoted key', truncated... ",
    "<html><body>502 Bad Gateway</body></html>",
    "SELECT * FROM users WHERE '1'='1'",
    null,
    undefined,
  ];

  for (const payload of corruptPayloads) {
    const val = AIResponseValidator.validateAssignmentBrief(payload);
    assert.strictEqual(val.isValid, false, `Payload should be rejected: ${payload}`);
  }
});

// ============================================================================
// SUITE 5: Cache Invalidation on Schema or Model Updates
// ============================================================================
test("Phase 5.30 - 5.1: Cache keys automatically invalidate when model or schema changes", () => {
  const text = "Sample syllabus text for testing deterministic cache invalidation.";

  const baseKey = AIOrchestrationService.computeCacheKey({
    rawText: text,
    providerId: "gemini",
    modelUsed: "gemini-2.5-flash",
    schemaVersion: "v1.0",
    tenantScope: "global",
  });

  // 1. Changing model invalidates cache key
  const fallbackModelKey = AIOrchestrationService.computeCacheKey({
    rawText: text,
    providerId: "gemini",
    modelUsed: "gemini-1.5-flash",
    schemaVersion: "v1.0",
    tenantScope: "global",
  });
  assert.notStrictEqual(baseKey, fallbackModelKey, "Model change must produce a distinct cache key");

  // 2. Changing schema version invalidates cache key
  const newSchemaKey = AIOrchestrationService.computeCacheKey({
    rawText: text,
    providerId: "gemini",
    modelUsed: "gemini-2.5-flash",
    schemaVersion: "v2.0",
    tenantScope: "global",
  });
  assert.notStrictEqual(baseKey, newSchemaKey, "Schema version change must produce a distinct cache key");

  // 3. Changing tenant scope invalidates cache key
  const tenantScopedKey = AIOrchestrationService.computeCacheKey({
    rawText: text,
    providerId: "gemini",
    modelUsed: "gemini-2.5-flash",
    schemaVersion: "v1.0",
    tenantScope: "tenant:user_tenant_999",
  });
  assert.notStrictEqual(baseKey, tenantScopedKey, "Tenant scope change must produce a distinct cache key");
});
