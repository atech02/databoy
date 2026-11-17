/**
 * Provider-Independent AI Architecture Types for DataBoy
 * Decouples application business logic from specific AI provider SDKs.
 */

export interface AITokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface AIMetrics {
  providerId: string;
  modelUsed: string;
  durationMs: number;
  tokenUsage?: AITokenUsage;
  costEstimate?: number;
  isCached?: boolean;
}

export interface AIStructuredResponse<T> {
  success: boolean;
  data?: T;
  rawText?: string;
  metrics: AIMetrics;
  error?: {
    code: "INVALID_JSON" | "SCHEMA_MISMATCH" | "TIMEOUT" | "RATE_LIMITED" | "QUOTA_EXHAUSTED" | "PROVIDER_ERROR";
    message: string;
    details?: any;
  };
}

export interface StructuredGenerationParams {
  systemPrompt?: string;
  userPrompt: string;
  schema?: Record<string, any>;
  textInput?: string;
  multimodalInput?: {
    mimeType: string;
    buffer: Buffer;
  };
  temperature?: number;
  timeoutMs?: number;
}

export interface AIProvider {
  readonly id: string;
  readonly name: string;
  isAvailable(): boolean;
  generateStructuredContent<T>(params: StructuredGenerationParams): Promise<AIStructuredResponse<T>>;
}

export interface ParsedAssignmentFields {
  title?: string;
  questions?: string;
  instructions?: string;
  guidelines?: string;
  wordCount?: number;
  referencingStyle?: string;
  deadline?: string;
  academicLevel?: string;
}

export interface AIUsageRecord {
  userUid: string;
  timestamp: string;
  providerId: string;
  modelUsed: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  operation: string;
}
