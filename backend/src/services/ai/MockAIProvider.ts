import { AIProvider, StructuredGenerationParams, AIStructuredResponse, ParsedAssignmentFields } from "./types.js";

export type MockBehavior =
  | "SUCCESS"
  | "QUOTA_EXHAUSTED"
  | "TIMEOUT"
  | "INVALID_JSON"
  | "SCHEMA_MISMATCH"
  | "EMPTY_RESPONSE";

export class MockAIProvider implements AIProvider {
  public readonly id = "mock_ai_provider";
  public readonly name = "Mock AI Provider for Automated Testing";
  public behavior: MockBehavior = "SUCCESS";
  public mockDelayMs: number = 10;
  public customFields?: Partial<ParsedAssignmentFields>;

  constructor(behavior: MockBehavior = "SUCCESS") {
    this.behavior = behavior;
  }

  public isAvailable(): boolean {
    return true;
  }

  public async generateStructuredContent<T>(
    params: StructuredGenerationParams
  ): Promise<AIStructuredResponse<T>> {
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
    const defaultData: ParsedAssignmentFields = {
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
      data: defaultData as unknown as T,
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
