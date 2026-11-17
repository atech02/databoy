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
  // Required Phase 5.33 structured schema fields
  assignment_title?: string | null;
  assignment_brief?: string | null;
  academic_level?: "high_school" | "diploma" | "degree" | "masters" | "phd" | null;
  subject_or_discipline?: string | null;
  referencing_style?: string | null;
  submission_deadline?: string | null;
  total_page_count?: number | null;
  requested_page_count?: number | null;
  word_count?: number | null;
  assignment_type?: string | null;
  language?: string | null;
  extraction_confidence?: "high" | "medium" | "low";
  fields_requiring_review?: string[];

  // Backward compatibility aliases
  title?: string | null;
  questions?: string | null;
  instructions?: string | null;
  guidelines?: string | null;
  wordCount?: number | null;
  referencingStyle?: string | null;
  deadline?: string | null;
  academicLevel?: string | null;
  subject?: string | null;
  pageCount?: number | null;
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
