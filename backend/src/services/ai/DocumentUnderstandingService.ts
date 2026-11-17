import { AIProvider, ParsedAssignmentFields } from "./types.js";
import { AIResponseValidator } from "./AIResponseValidator.js";
import { parseTextToAssignmentFields } from "../ocrProcessingService.js";

export interface UnderstandingResult {
  parsedFields: ParsedAssignmentFields;
  confidence: "high" | "medium" | "low";
  strategyUsed: "rule_based_only" | "ai_structured" | "hybrid_fallback";
  tokenUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  modelUsed?: string;
  errorReason?: string;
}

export class DocumentUnderstandingService {
  /**
   * Analyzes raw assignment text and extracts structured academic fields.
   * Employs a cost-minimizing tiered strategy:
   *  1. Rule-based regex parser runs first (0 tokens, 0ms latency).
   *  2. If rule-based parser achieves high completeness, AI call is bypassed.
   *  3. Otherwise, sends plain text to AIProvider for semantic parsing.
   *  4. If AI fails or is unavailable, falls back gracefully to rule-based fields.
   */
  public static async understandDocumentText(params: {
    rawText: string;
    aiProvider: AIProvider;
    userUid?: string;
    forceAI?: boolean;
    multimodalBuffer?: { mimeType: string; buffer: Buffer };
  }): Promise<UnderstandingResult> {
    const { rawText, aiProvider, multimodalBuffer, forceAI } = params;

    // 1. Stage 1: Instant Rule-Based Parser
    const ruleBased = parseTextToAssignmentFields(rawText);

    // Mandatory Critical Field Gates:
    // (A) Must have a valid title (non-empty string, >= 3 chars)
    const hasTitle = Boolean(ruleBased.title && ruleBased.title.trim().length >= 3);
    // (B) Must have core assignment content (questions, instructions, or guidelines >= 10 chars)
    const hasContent = Boolean(
      (ruleBased.questions && ruleBased.questions.trim().length >= 10) ||
      (ruleBased.instructions && ruleBased.instructions.trim().length >= 10) ||
      (ruleBased.guidelines && ruleBased.guidelines.trim().length >= 10)
    );
    // (C) Must have at least one critical constraint (word count >= 50 or valid deadline)
    const hasConstraint = Boolean(
      (ruleBased.wordCount && ruleBased.wordCount >= 50) ||
      (ruleBased.deadline && ruleBased.deadline.trim().length > 0)
    );

    const hasCriticalFields = hasTitle && hasContent && hasConstraint;

    // Weighted Completeness Score (Total 100 points: content and title weighted heavily)
    const ruleCompleteness =
      (hasTitle ? 25 : 0) +
      (hasContent ? 35 : 0) +
      (ruleBased.wordCount && ruleBased.wordCount >= 50 ? 15 : 0) +
      (ruleBased.deadline && ruleBased.deadline.trim().length > 0 ? 15 : 0) +
      (ruleBased.referencingStyle && ruleBased.referencingStyle.trim().length > 0 ? 10 : 0);

    // Mandatory requirement: 75% completeness alone does NOT allow bypass if critical fields are missing
    if (hasCriticalFields && ruleCompleteness >= 75 && !forceAI && !multimodalBuffer) {
      return {
        parsedFields: ruleBased,
        confidence: "high",
        strategyUsed: "rule_based_only",
      };
    }

    // 2. Stage 2: AI Provider Structuring
    if (!aiProvider.isAvailable()) {
      return {
        parsedFields: ruleBased,
        confidence: ruleCompleteness >= 50 ? "medium" : "low",
        strategyUsed: "hybrid_fallback",
        errorReason: "AI provider not configured, used local rules.",
      };
    }

    const systemPrompt = `You are an academic evaluator parsing a university assignment brief.
Extract:
- title: string
- questions: string (verbatim, preserving question numbers and bullet points)
- instructions: string (verbatim constraints, rubric, referencing rules)
- wordCount: integer (target or maximum limit)
- referencingStyle: string (e.g. APA, Harvard, MLA, Chicago, IEEE, Vancouver, Other)
- deadline: string (parsed to YYYY-MM-DD format)
- academicLevel: string (high_school, diploma, degree, masters, phd)
Return clean JSON only. Do not invent missing facts.`;

    const userPrompt = "Parse the assignment brief into structured JSON.";

    const schema = {
      type: "object",
      properties: {
        title: { type: "string" },
        questions: { type: "string" },
        instructions: { type: "string" },
        wordCount: { type: "integer" },
        referencingStyle: { type: "string" },
        deadline: { type: "string" },
        academicLevel: { type: "string" },
      },
      required: ["questions", "instructions"],
    };

    const aiRes = await aiProvider.generateStructuredContent<ParsedAssignmentFields>({
      systemPrompt,
      userPrompt,
      schema,
      textInput: rawText.trim().length > 0 ? rawText : undefined,
      multimodalInput: rawText.trim().length === 0 && multimodalBuffer ? multimodalBuffer : undefined,
      temperature: 0.1,
    });

    if (!aiRes.success || !aiRes.rawText) {
      return {
        parsedFields: ruleBased,
        confidence: ruleCompleteness >= 50 ? "medium" : "low",
        strategyUsed: "hybrid_fallback",
        errorReason: aiRes.error?.message || "AI structuring failed, used local rules.",
      };
    }

    // 3. Stage 3: Strict Validation of AI output
    const validation = AIResponseValidator.validateAssignmentBrief(aiRes.rawText);
    if (!validation.isValid || !validation.data) {
      return {
        parsedFields: ruleBased,
        confidence: "medium",
        strategyUsed: "hybrid_fallback",
        errorReason: `AI response validation failed: ${validation.errorMessage}`,
      };
    }

    // 4. Merge fields (AI fields take precedence, rule-based fills missing gaps)
    const merged: ParsedAssignmentFields = {
      title: validation.data.title || ruleBased.title,
      questions: validation.data.questions || ruleBased.questions,
      instructions: validation.data.instructions || ruleBased.instructions,
      guidelines: validation.data.guidelines || ruleBased.guidelines,
      wordCount: validation.data.wordCount || ruleBased.wordCount,
      referencingStyle: validation.data.referencingStyle || ruleBased.referencingStyle,
      deadline: validation.data.deadline || ruleBased.deadline,
      academicLevel: validation.data.academicLevel || ruleBased.academicLevel,
    };

    return {
      parsedFields: merged,
      confidence: "high",
      strategyUsed: "ai_structured",
      tokenUsage: aiRes.metrics.tokenUsage,
      modelUsed: aiRes.metrics.modelUsed,
    };
  }
}
