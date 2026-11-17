export class MockAIProvider {
    id = "mock_ai_provider";
    name = "Mock AI Provider for Automated Testing";
    behavior = "SUCCESS";
    mockDelayMs = 10;
    customFields;
    constructor(behavior = "SUCCESS") {
        this.behavior = behavior;
    }
    isAvailable() {
        return true;
    }
    async generateStructuredContent(params) {
        if (this.mockDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, this.mockDelayMs));
        }
        if (this.behavior === "QUOTA_EXHAUSTED") {
            return {
                success: false,
                metrics: { providerId: this.id, modelUsed: "mock-quota", durationMs: this.mockDelayMs },
                error: { code: "QUOTA_EXHAUSTED", message: "Mock simulated 429 quota exhaustion." },
            };
        }
        if (this.behavior === "TIMEOUT") {
            return {
                success: false,
                metrics: { providerId: this.id, modelUsed: "mock-timeout", durationMs: this.mockDelayMs },
                error: { code: "TIMEOUT", message: "Mock simulated network timeout." },
            };
        }
        if (this.behavior === "EMPTY_RESPONSE") {
            return {
                success: true,
                rawText: "",
                metrics: { providerId: this.id, modelUsed: "mock-empty", durationMs: this.mockDelayMs },
            };
        }
        if (this.behavior === "INVALID_JSON") {
            return {
                success: true,
                rawText: "This is not JSON: { title: 'Broken' ...",
                metrics: { providerId: this.id, modelUsed: "mock-invalid", durationMs: this.mockDelayMs },
            };
        }
        if (this.behavior === "SCHEMA_MISMATCH") {
            return {
                success: true,
                rawText: JSON.stringify(["Array instead of object", 123]),
                metrics: { providerId: this.id, modelUsed: "mock-schema-mismatch", durationMs: this.mockDelayMs },
            };
        }
        // Default: SUCCESS
        const defaultData = {
            title: "Corporate Governance & Ethics Case Study",
            questions: "1. Discuss agency theory.\n2. Evaluate board independence.",
            instructions: "Submit in APA 7th style by the stated deadline. Word count: 2500 words.",
            guidelines: "1. Discuss agency theory.\n2. Evaluate board independence.",
            wordCount: 2500,
            referencingStyle: "APA",
            deadline: "2026-12-18",
            academicLevel: "masters",
            ...this.customFields,
        };
        return {
            success: true,
            rawText: JSON.stringify(defaultData),
            data: defaultData,
            metrics: {
                providerId: this.id,
                modelUsed: "mock-v1",
                durationMs: this.mockDelayMs,
                tokenUsage: { promptTokens: 120, completionTokens: 85, totalTokens: 205 },
                costEstimate: 0,
            },
        };
    }
}
