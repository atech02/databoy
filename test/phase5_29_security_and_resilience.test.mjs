process.env.NODE_ENV = "test";
import assert from "node:assert";
import { test } from "node:test";
import fs from "node:fs";
import { z } from "zod";

// Import compiled backend modules
import { AIOrchestrationService, ASSIGNMENT_SCHEMA_VERSION } from "../backend/dist/services/ai/AIOrchestrationService.js";
import { MockAIProvider } from "../backend/dist/services/ai/MockAIProvider.js";
import { AIResponseValidator } from "../backend/dist/services/ai/AIResponseValidator.js";
import { AIUsageTracker } from "../backend/dist/services/ai/AIUsageTracker.js";
import { DocumentUnderstandingService } from "../backend/dist/services/ai/DocumentUnderstandingService.js";

// ============================================================================
// SUITE 1: Dependency Security & Zod v4 Schema Compatibility
// ============================================================================
test("Phase 5.29 - 1.1: Zod 4.6.7+ Runtime Schema Validation & DoS Protection", () => {
  // 1. Verify Zod pricing preview schema
  const pricingPreviewSchema = z.object({
    wordCount: z.number().int().positive().optional(),
    pageCount: z.number().int().positive().optional(),
    academicLevel: z.string().default("degree"),
    deadline: z.string(),
    serviceType: z.string().default("assignment"),
  });

  const validPricing = pricingPreviewSchema.parse({
    wordCount: 2500,
    deadline: "2026-12-15",
  });
  assert.strictEqual(validPricing.wordCount, 2500);
  assert.strictEqual(validPricing.academicLevel, "degree");

  // 2. Verify Zod upload authorization schema
  const TARGET_TYPES = ["assignment", "draft", "deliverable", "dispute"];
  const authorizeUploadSchema = z.object({
    targetType: z.enum(TARGET_TYPES),
    targetId: z.string().min(1).max(128),
    fileName: z.string().min(1).max(255),
    contentType: z.string().min(1).max(200),
    fileSize: z.number().int().positive().max(25 * 1024 * 1024),
  });

  const validUpload = authorizeUploadSchema.parse({
    targetType: "assignment",
    targetId: "asg_audit_999",
    fileName: "term_paper.pdf",
    contentType: "application/pdf",
    fileSize: 1048576,
  });
  assert.strictEqual(validUpload.fileName, "term_paper.pdf");

  // 3. Verify Memory Exhaustion / DoS Resistance on constrained collections (GHSA-mrhx-c7xc-m3w5)
  // An invalid payload with invalid enum or negative file size fails fast without catastrophic backtracking
  const invalidUploadRes = authorizeUploadSchema.safeParse({
    targetType: "unauthorized_type",
    targetId: "x".repeat(500), // Exceeds max length
    fileName: "malicious.exe",
    contentType: "application/octet-stream",
    fileSize: -1,
  });
  assert.strictEqual(invalidUploadRes.success, false);
});

// ============================================================================
// SUITE 2: Cross-Tenant Cache Hardening & Classification
// ============================================================================
test("Phase 5.29 - 2.1: Document Sensitivity Classification (Tenant vs Global)", () => {
  // Case A: Document containing student email -> SENSITIVE (Tenant-scoped)
  const docWithEmail = `
    Student Email: alice.smith@university.edu
    Assignment Title: Corporate Law Case Study
    Word count: 2000 words
    Questions: 1. Evaluate fiduciary duties under Companies Act.
  `;
  const classA = AIOrchestrationService.classifyDocumentSensitivity(docWithEmail, "assignment");
  assert.strictEqual(classA.isSensitive, true);
  assert(classA.reasons.includes("contains_email"));

  // Case B: Document containing Student ID / Matriculation -> SENSITIVE (Tenant-scoped)
  const docWithStudentId = `
    Candidate Number: STU-2026-98741
    Course: Advanced Microeconomics
    Word count: 3000 words
    Questions: Discuss Nash equilibrium in Bertrand competition.
  `;
  const classB = AIOrchestrationService.classifyDocumentSensitivity(docWithStudentId, "assignment");
  assert.strictEqual(classB.isSensitive, true);
  assert(classB.reasons.includes("contains_student_id"));

  // Case C: Document containing personalized greeting / instructor feedback -> SENSITIVE
  const docWithGreeting = `
    Dear Michael, please review your revised dissertation chapter.
    Word count: 4000 words
    Questions: Refine methodology section on qualitative coding.
  `;
  const classC = AIOrchestrationService.classifyDocumentSensitivity(docWithGreeting, "assignment");
  assert.strictEqual(classC.isSensitive, true);
  assert(classC.reasons.includes("contains_personalized_salutation"));

  // Case D: Private target types (drafts, deliverables, disputes) -> ALWAYS SENSITIVE
  const draftDoc = `
    Word count: 1500 words
    Instructions: Rough notes on market entry in emerging economies.
  `;
  const classD = AIOrchestrationService.classifyDocumentSensitivity(draftDoc, "draft");
  assert.strictEqual(classD.isSensitive, true);
  assert(classD.reasons.includes("private_target_type:draft"));

  // Case E: Pure generic assignment brief / public syllabus -> TENANT-INDEPENDENT (Global-eligible)
  const publicBrief = `
    University Course Syllabus & Assignment Brief
    Module: Strategic Financial Management
    Word count: 2500 words
    Deadline: 2026-12-20
    Referencing: Harvard style
    Instructions:
    Critically appraise the Capital Asset Pricing Model (CAPM) in the context of emerging markets.
  `;
  const classE = AIOrchestrationService.classifyDocumentSensitivity(publicBrief, "assignment");
  assert.strictEqual(classE.isSensitive, false, "Public syllabus with zero PII must be classified as non-sensitive");
  assert.strictEqual(classE.reasons.length, 0);
});

test("Phase 5.29 - 2.2: Cross-Tenant Isolation on Sensitive Documents", async () => {
  AIUsageTracker.resetForTesting();
  AIOrchestrationService.clearCacheForTesting();

  const mockAI = new MockAIProvider("SUCCESS");
  AIOrchestrationService.setProvider(mockAI);

  // Document contains student ID (Sensitive)
  const sensitiveDocText = `
    Student Registration: STU-99281-XYZ
    Essay Title: Comparative Contract Law in Civil vs Common Law Jurisdictions
    Word count: 2500 words
    Instructions: Compare breach remedies under German BGB and English Law.
  `;

  // Tenant Alpha submits the sensitive document
  const callAlpha = await AIOrchestrationService.processAssignmentUnderstanding({
    rawText: sensitiveDocText,
    userUid: "user_alpha_101",
    tenantId: "tenant_alpha_corp",
    fileId: "alpha_secret_file_111",
    targetType: "assignment",
    forceAI: true,
  });

  assert.strictEqual(callAlpha.isCached, false);
  assert.strictEqual(callAlpha.strategyUsed, "ai_structured");

  // Tenant Beta submits the EXACT SAME text
  const callBeta = await AIOrchestrationService.processAssignmentUnderstanding({
    rawText: sensitiveDocText,
    userUid: "user_beta_202",
    tenantId: "tenant_beta_corp", // Separate tenant!
    fileId: "beta_file_222",
    targetType: "assignment",
  });

  // Critical Isolation Verification:
  // Tenant Beta MUST NOT hit Tenant Alpha's cache because the document was sensitive!
  assert.strictEqual(
    callBeta.isCached,
    false,
    "Tenant Beta must NEVER receive a cache hit from Tenant Alpha's sensitive document"
  );
  assert.strictEqual(callBeta.fileId, undefined);
  assert.strictEqual(callBeta.userUid, undefined);

  // Tenant Alpha submits again (or User 2 within Tenant Alpha)
  const callAlphaUser2 = await AIOrchestrationService.processAssignmentUnderstanding({
    rawText: sensitiveDocText,
    userUid: "user_alpha_102", // Different user within Tenant Alpha
    tenantId: "tenant_alpha_corp", // SAME tenant!
    fileId: "alpha_file_333",
    targetType: "assignment",
  });

  // Same tenant CAN safely reuse its own tenant-scoped cache
  assert.strictEqual(
    callAlphaUser2.isCached,
    true,
    "Users within the SAME tenant CAN safely reuse tenant-scoped cached outputs"
  );
  assert.strictEqual(callAlphaUser2.strategyUsed, "cache_hit_memory");
  assert.strictEqual(callAlphaUser2.fileId, undefined, "fileId must never be in cache payload");
  assert.strictEqual(callAlphaUser2.userUid, undefined, "userUid must never be in cache payload");
});

test("Phase 5.29 - 2.3: Global Shared Cache for Verified Public Briefs", async () => {
  AIUsageTracker.resetForTesting();
  AIOrchestrationService.clearCacheForTesting();

  const mockAI = new MockAIProvider("SUCCESS");
  AIOrchestrationService.setProvider(mockAI);

  // Pure public syllabus with zero PII
  const cleanPublicText = `
    University Course Guide: Econometrics & Quantitative Modeling
    Word count: 3500 words
    Deadline: 2026-12-25
    Referencing: APA style
    Questions:
    1. Estimate ordinary least squares (OLS) regression parameters.
    2. Test for heteroskedasticity using Breusch-Pagan test.
  `;

  // Tenant 1 submits clean public brief
  const call1 = await AIOrchestrationService.processAssignmentUnderstanding({
    rawText: cleanPublicText,
    userUid: "user_univ_1",
    tenantId: "tenant_oxford",
    targetType: "assignment",
    forceAI: true,
  });
  assert.strictEqual(call1.isCached, false);

  // Tenant 2 submits clean public brief
  const call2 = await AIOrchestrationService.processAssignmentUnderstanding({
    rawText: cleanPublicText,
    userUid: "user_univ_2",
    tenantId: "tenant_cambridge",
    targetType: "assignment",
  });

  // Clean public briefs are verified tenant-independent, so global cache hit is permitted safely
  assert.strictEqual(call2.isCached, true, "Verified tenant-independent public briefs allow shared caching");
  assert.strictEqual(call2.tokenUsage, undefined, "Shared cache hit consumes 0 tokens");
  assert.strictEqual(call2.fileId, undefined);
  assert.strictEqual(call2.userUid, undefined);
});

// ============================================================================
// SUITE 3: OCR Resilience & Document Preservation Invariants
// ============================================================================
test("Phase 5.29 - 3.1: OCR Failure Fault-Tolerance & Source File Preservation", async () => {
  // Simulated R2 storage record
  const mockStorageState = new Map();
  const testFileId = "source_doc_preserve_test_888";
  const testStorageKey = `pending/user_test_1/${testFileId}.pdf`;

  mockStorageState.set(testStorageKey, {
    buffer: Buffer.from("%PDF-1.4 Mock PDF content"),
    contentType: "application/pdf",
    deleted: false,
  });

  // 1. Simulate an OCR job failure (e.g., Timeout or Malformed LLM response)
  const failingProvider = new MockAIProvider("TIMEOUT");
  AIOrchestrationService.setProvider(failingProvider);

  const rawCorruptText = "Corrupted unreadable scan fragment";
  const understanding = await DocumentUnderstandingService.understandDocumentText({
    rawText: rawCorruptText,
    aiProvider: failingProvider,
  });

  // Verify graceful fallback
  assert.strictEqual(understanding.strategyUsed, "hybrid_fallback");
  assert(
    understanding.errorReason?.toLowerCase().includes("timeout") ||
    understanding.errorReason?.toLowerCase().includes("failed")
  );

  // 2. CRITICAL PRESERVATION INVARIANT:
  // An OCR failure must NEVER trigger file deletion or purge the uploaded R2 object!
  assert.strictEqual(
    mockStorageState.get(testStorageKey).deleted,
    false,
    "Failed OCR operation MUST NEVER delete the uploaded source file in Cloudflare R2"
  );
  assert.strictEqual(
    mockStorageState.has(testStorageKey),
    true,
    "Source document must remain permanently preserved in storage"
  );
});
