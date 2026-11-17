import crypto from "crypto";
import { adminDb } from "../../config/firebaseAdmin.js";
import { GeminiProvider } from "./GeminiProvider.js";
import { AIUsageTracker } from "./AIUsageTracker.js";
import { DocumentUnderstandingService } from "./DocumentUnderstandingService.js";
import { AIResponseValidator } from "./AIResponseValidator.js";
export const ASSIGNMENT_SCHEMA_VERSION = "v1.2";
export class AIOrchestrationService {
    static activeProvider = new GeminiProvider();
    static localMemoryCache = new Map();
    static CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours
    /**
     * Sets or overrides the active AI provider (used for testing with MockAIProvider or switching providers).
     */
    static setProvider(provider) {
        this.activeProvider = provider;
    }
    static getProvider() {
        return this.activeProvider;
    }
    /**
     * Computes model-aware, schema-versioned deterministic cache key for document understanding.
     * Binds:
     *  - Normalized document text
     *  - Provider ID
     *  - Actual Model Used
     *  - Schema & Prompt Version
     */
    static computeCacheKey(params) {
        const normalizedText = params.rawText.trim().replace(/\s+/g, " ");
        const provider = params.providerId || this.activeProvider.id;
        const model = params.modelUsed || "default";
        const schema = params.schemaVersion || ASSIGNMENT_SCHEMA_VERSION;
        const descriptor = `${normalizedText}::${provider}::${model}::${schema}`;
        return crypto.createHash("sha256").update(descriptor).digest("hex");
    }
    /**
     * Backward compatibility alias for single-argument text hashing.
     */
    static computeTextCacheKey(text) {
        return this.computeCacheKey({ rawText: text });
    }
    /**
     * Orchestrates assignment understanding with:
     *  - Model-aware SHA-256 caching (instant return, 0 tokens)
     *  - Strict tenant isolation (never stores fileId/userId in shared cache)
     *  - Per-user rate limiting & quota protection
     *  - Document understanding tiered strategy
     *  - Audit logging & telemetry
     */
    static async processAssignmentUnderstanding(params) {
        const startTime = Date.now();
        const { rawText, userUid, forceAI, multimodalBuffer, fileId } = params;
        const cacheKey = rawText.trim().length > 0 ? this.computeCacheKey({ rawText }) : "";
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
                }
                catch (cacheErr) {
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
                    await adminDb.collection("aiResponseCache").doc(cacheKey).set({
                        cacheKey,
                        parsedFields: understanding.parsedFields,
                        providerId: this.activeProvider.id,
                        modelUsed: understanding.modelUsed || "gemini-2.5-flash",
                        schemaVersion: ASSIGNMENT_SCHEMA_VERSION,
                        cachedAt: new Date().toISOString(),
                    }, { merge: true });
                }
                catch (saveCacheErr) {
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
    static clearCacheForTesting() {
        this.localMemoryCache.clear();
    }
}
