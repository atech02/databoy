import crypto from "crypto";
import { adminDb } from "../../config/firebaseAdmin.js";
import { AIProvider, ParsedAssignmentFields } from "./types.js";
import { GeminiProvider } from "./GeminiProvider.js";
import { AIUsageTracker } from "./AIUsageTracker.js";
import { DocumentUnderstandingService, UnderstandingResult } from "./DocumentUnderstandingService.js";
import { AIResponseValidator } from "./AIResponseValidator.js";

export const ASSIGNMENT_SCHEMA_VERSION = "v1.2";

export interface OrchestrationResult {
  parsedFields: ParsedAssignmentFields;
  confidence: "high" | "medium" | "low";
  strategyUsed: string;
  isCached: boolean;
  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  modelUsed?: string;
  durationMs: number;
  errorReason?: string;
}

export class AIOrchestrationService {
  private static activeProvider: AIProvider = new GeminiProvider();
  private static localMemoryCache: Map<string, { data: ParsedAssignmentFields; cachedAt: number }> = new Map();
  private static CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Sets or overrides the active AI provider (used for testing with MockAIProvider or switching providers).
   */
  public static setProvider(provider: AIProvider): void {
    this.activeProvider = provider;
  }

  public static getProvider(): AIProvider {
    return this.activeProvider;
  }

  /**
   * Classifies document sensitivity to protect student privacy and ensure tenant isolation.
   * Outputs containing private student data (names, IDs, emails, drafts) are strictly tenant-scoped.
   * Outputs that are purely generic assignment briefs / public templates are eligible for global caching.
   */
  public static classifyDocumentSensitivity(rawText: string, targetType?: string): {
    isSensitive: boolean;
    reasons: string[];
  } {
    const reasons: string[] = [];

    // 1. Non-assignment targets (draft, deliverable, dispute, research) are inherently private student work
    if (targetType && targetType !== "assignment" && targetType !== "template") {
      reasons.push(`private_target_type:${targetType}`);
    }

    // 2. Email detection
    if (/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/i.test(rawText)) {
      reasons.push("contains_email");
    }

    // 3. Student/Candidate ID
    if (/\b(?:student|candidate|reg(?:istration)?|matric(?:ulation)?)\b\s*(?:no|num|number|id|code)?\s*[:#\-]\s*([A-Za-z0-9\-]{4,20})\b/i.test(rawText)) {
      reasons.push("contains_student_id");
    }

    // 4. Personalized salutations or private student names
    if (/\b(?:dear|hello|hi)\s+[A-Z][a-z]+|\bstudent\s*name\s*[:\-]\s*[A-Z][a-z]+/i.test(rawText)) {
      reasons.push("contains_personalized_salutation");
    }

    // 5. Submission markers
    if (/\b(?:my\s+submission|draft\s+submission|final\s+deliverable|plagiarism\s+report|turnitin\s+similarity)\b/i.test(rawText)) {
      reasons.push("contains_private_submission_markers");
    }

    return {
      isSensitive: reasons.length > 0,
      reasons,
    };
  }

  /**
   * Computes a deterministic cache key binding:
   *  - Tenant Scope ('global' for verified tenant-independent, 'tenant:<id>' for sensitive)
   *  - Normalized document text
   *  - Provider ID
   *  - Actual Model Used
   *  - Schema & Prompt Version
   */
  public static computeCacheKey(params: {
    rawText: string;
    providerId?: string;
    modelUsed?: string;
    schemaVersion?: string;
    tenantScope?: string;
  }): string {
    const normalizedText = params.rawText.trim().replace(/\s+/g, " ");
    const provider = params.providerId || this.activeProvider.id;
    const model = params.modelUsed || "default";
    const schema = params.schemaVersion || ASSIGNMENT_SCHEMA_VERSION;
    const scope = params.tenantScope || "global";
    const descriptor = `${scope}::${normalizedText}::${provider}::${model}::${schema}`;
    return crypto.createHash("sha256").update(descriptor).digest("hex");
  }

  /**
   * Backward compatibility alias for single-argument text hashing.
   */
  public static computeTextCacheKey(text: string): string {
    return this.computeCacheKey({ rawText: text });
  }

  /**
   * Orchestrates assignment understanding with:
   *  - Tenant-hardened cache isolation (sensitive outputs strictly tenant-scoped)
   *  - Model-aware SHA-256 caching (instant return, 0 tokens)
   *  - Strict tenant isolation (never stores fileId/userId in shared cache)
   *  - Per-user rate limiting & quota protection
   *  - Document understanding tiered strategy
   *  - Audit logging & telemetry
   */
  public static async processAssignmentUnderstanding(params: {
    rawText: string;
    userUid: string;
    tenantId?: string;
    targetType?: string;
    fileId?: string;
    forceAI?: boolean;
    multimodalBuffer?: { mimeType: string; buffer: Buffer };
  }): Promise<OrchestrationResult> {
    const startTime = Date.now();
    const { rawText, userUid, forceAI, multimodalBuffer, fileId, tenantId, targetType } = params;

    // 1. Resolve effective tenant identity:
    // Defaults strictly to trusted server-side userUid (authenticated via Firebase token).
    // If tenantId is supplied, it must be alphanumeric and sanitized; otherwise falls back to userUid.
    let effectiveTenant = userUid && typeof userUid === "string" && userUid.trim().length > 0
      ? userUid.trim()
      : "unknown_tenant";
    if (tenantId && typeof tenantId === "string") {
      const sanitized = tenantId.trim().replace(/[^a-zA-Z0-9_\-]/g, "");
      if (sanitized.length >= 3 && sanitized.length <= 64) {
        effectiveTenant = sanitized;
      }
    }

    // 2. Classify document sensitivity and determine cache scope:
    // MANDATORY INVARIANT: Unknown or uncertain document classifications MUST default to tenant-scoped caching.
    // Global shared caching is permitted ONLY for verified tenant-independent public templates.
    const sensitivity = this.classifyDocumentSensitivity(rawText, targetType);
    const isVerifiedPublicTemplate =
      (targetType === "assignment" || targetType === "template") &&
      !sensitivity.isSensitive &&
      rawText.length >= 50 &&
      /\b(?:course|module|syllabus|brief|assignment|curriculum|exam)\b/i.test(rawText);

    const tenantScope = isVerifiedPublicTemplate ? "global" : `tenant:${effectiveTenant}`;

    const cacheKey = rawText.trim().length > 0 ? this.computeCacheKey({ rawText, tenantScope }) : "";

    // 1. Check In-Memory & Firestore Cache
    if (cacheKey) {
      const memoryHit = this.localMemoryCache.get(cacheKey);
      if (memoryHit && Date.now() - memoryHit.cachedAt < this.CACHE_TTL_MS) {
        return {
          parsedFields: memoryHit.data,
          confidence: "high",
          strategyUsed: "cache_hit_memory",
          isCached: true,
          durationMs: Date.now() - startTime,
        };
      }

      if (process.env.NODE_ENV !== "test" || process.env.FIRESTORE_EMULATOR_HOST) {
        try {
          const cacheDoc = await adminDb.collection("aiResponseCache").doc(cacheKey).get();
          if (cacheDoc.exists) {
            const rawCached = cacheDoc.data()?.parsedFields;
            if (rawCached) {
              // Validate cached payload to defend against tampering or corrupt schemas
              const validation = AIResponseValidator.validateAssignmentBrief(JSON.stringify(rawCached));
              if (validation.isValid && validation.data) {
                this.localMemoryCache.set(cacheKey, { data: validation.data, cachedAt: Date.now() });
                return {
                  parsedFields: validation.data,
                  confidence: "high",
                  strategyUsed: "cache_hit_firestore",
                  isCached: true,
                  durationMs: Date.now() - startTime,
                };
              }
            }
          }
        } catch (cacheErr) {
          console.warn("[AIOrchestrationService] Non-blocking cache lookup warning:", cacheErr);
        }
      }
    }

    // 2. Fair-Use Quota & Rate Limit Check
    const quotaCheck = await AIUsageTracker.canUserRequest(userUid);
    if (!quotaCheck.allowed) {
      // Graceful fallback: return rule-based parsing without throwing fatal errors
      const fallbackResult = await DocumentUnderstandingService.understandDocumentText({
        rawText,
        aiProvider: {
          id: "disabled",
          name: "Quota Disabled",
          isAvailable: () => false,
          generateStructuredContent: async () => ({
            success: false,
            metrics: { providerId: "disabled", modelUsed: "none", durationMs: 0 },
          }),
        },
        userUid,
      });

      return {
        parsedFields: fallbackResult.parsedFields,
        confidence: fallbackResult.confidence,
        strategyUsed: "quota_fallback_rule_based",
        isCached: false,
        durationMs: Date.now() - startTime,
        errorReason: quotaCheck.reason,
      };
    }

    // 3. Increment usage and execute understanding
    await AIUsageTracker.incrementUserUsage(userUid);

    const understanding = await DocumentUnderstandingService.understandDocumentText({
      rawText,
      aiProvider: this.activeProvider,
      userUid,
      forceAI,
      multimodalBuffer,
    });

    const durationMs = Date.now() - startTime;

    // 4. Record Token Usage
    if (understanding.tokenUsage) {
      await AIUsageTracker.recordUsage({
        userUid,
        timestamp: new Date().toISOString(),
        providerId: this.activeProvider.id,
        modelUsed: understanding.modelUsed || "gemini-2.5-flash",
        promptTokens: understanding.tokenUsage.promptTokens,
        completionTokens: understanding.tokenUsage.completionTokens,
        totalTokens: understanding.tokenUsage.totalTokens,
        estimatedCostUsd: 0, // Free tier
        operation: "assignment_understanding",
      });
    }

    // 5. Store in Cache for future duplicate uploads (Notice: fileId and userUid are EXCLUDED for tenant isolation)
    if (cacheKey && understanding.strategyUsed === "ai_structured") {
      this.localMemoryCache.set(cacheKey, { data: understanding.parsedFields, cachedAt: Date.now() });
      if (process.env.NODE_ENV !== "test" || process.env.FIRESTORE_EMULATOR_HOST) {
        try {
          await adminDb.collection("aiResponseCache").doc(cacheKey).set(
            {
              cacheKey,
              tenantScope,
              parsedFields: understanding.parsedFields,
              providerId: this.activeProvider.id,
              modelUsed: understanding.modelUsed || "gemini-2.5-flash",
              schemaVersion: ASSIGNMENT_SCHEMA_VERSION,
              cachedAt: new Date().toISOString(),
            },
            { merge: true }
          );
        } catch (saveCacheErr) {
          console.warn("[AIOrchestrationService] Non-blocking cache write warning:", saveCacheErr);
        }
      }
    }

    return {
      parsedFields: understanding.parsedFields,
      confidence: understanding.confidence,
      strategyUsed: understanding.strategyUsed,
      isCached: false,
      tokenUsage: understanding.tokenUsage,
      modelUsed: understanding.modelUsed,
      durationMs,
      errorReason: understanding.errorReason,
    };
  }

  /**
   * Clears memory cache (for testing).
   */
  public static clearCacheForTesting(): void {
    this.localMemoryCache.clear();
  }
}
