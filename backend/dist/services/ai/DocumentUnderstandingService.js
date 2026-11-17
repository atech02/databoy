import { AIResponseValidator } from "./AIResponseValidator.js";
import { parseTextToAssignmentFields } from "../ocrProcessingService.js";
export class DocumentUnderstandingService {
    /**
     * Analyzes raw assignment text and extracts structured academic fields.
     * Employs a cost-minimizing tiered strategy:
     *  1. Rule-based regex parser runs first (0 tokens, 0ms latency).
     *  2. If rule-based parser achieves high completeness, AI call is bypassed.
     *  3. Otherwise, sends plain text to AIProvider for semantic parsing.
     *  4. If AI fails or is unavailable, falls back gracefully to rule-based fields.
     */
    static async understandDocumentText(params) {
        const { rawText, aiProvider, multimodalBuffer, forceAI } = params;
        // 1. Stage 1: Instant Rule-Based Parser
        const ruleBased = parseTextToAssignmentFields(rawText);
        // Mandatory Critical Field Gates:
        // (A) Must have a valid title (non-empty string, >= 3 chars)
        const hasTitle = Boolean(ruleBased.title && ruleBased.title.trim().length >= 3);
        // (B) Must have core assignment content (questions, instructions, or guidelines >= 10 chars)
        const hasContent = Boolean((ruleBased.questions && ruleBased.questions.trim().length >= 10) ||
            (ruleBased.instructions && ruleBased.instructions.trim().length >= 10) ||
            (ruleBased.guidelines && ruleBased.guidelines.trim().length >= 10));
        // (C) Must have at least one critical constraint (word count >= 50 or valid deadline)
        const hasConstraint = Boolean((ruleBased.wordCount && ruleBased.wordCount >= 50) ||
            (ruleBased.deadline && ruleBased.deadline.trim().length > 0));
        const hasCriticalFields = hasTitle && hasContent && hasConstraint;
        // Weighted Completeness Score (Total 100 points: content and title weighted heavily)
        const ruleCompleteness = (hasTitle ? 25 : 0) +
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
        const systemPrompt = `You are an expert academic evaluator parsing a university assignment brief.
Detect the document's actual language and preserve it. NEVER translate content. If the document is English, keep it English.
Extract:
- assignment_title: string (Identify the actual topic/title. Do NOT use institution name, faculty name, student name, repeated header, document code, or generic labels like "Assignment Questions" or "Coursework 1")
- assignment_brief: string (Verbatim assignment tasks, questions, instructions, and constraints preserving paragraph structure and numbering)
- academic_level: string (One of: high_school, diploma, degree, masters, phd; or null if absent)
- subject_or_discipline: string (One of: computer_science, mathematics, engineering, physics_chemistry, biological_sciences, business_finance, humanities_arts, social_sciences, law; or null if absent)
- referencing_style: string (e.g. APA, Harvard, MLA, Chicago, IEEE, Vancouver, Other; or null if absent)
- submission_deadline: string (YYYY-MM-DD format; or null if absent)
- total_page_count: integer (Total number of pages of the source document if known, else null)
- requested_page_count: integer (Explicit requested assignment length to write, e.g. "write 10 pages" -> 10. Do NOT use page numbers like "Page 10" or page ranges like "Pages 10-15". If not explicitly requested, return null)
- word_count: integer (Required word count or word limit, e.g. 2000; or null if absent)
- assignment_type: string (e.g. assignment, essay, report, dissertation, etc.)
- language: string (Detected language name, e.g. "English", "French", "Spanish")
- extraction_confidence: string (high, medium, low)
- fields_requiring_review: array of strings (List field names that are uncertain, ambiguous, or need student review)

Return clean JSON matching the schema. Use null for genuinely absent fields. Do NOT invent missing information.`;
        const userPrompt = "Parse the assignment brief into structured JSON.";
        const schema = {
            type: "object",
            properties: {
                assignment_title: { type: "string" },
                title: { type: "string" },
                assignment_brief: { type: "string" },
                questions: { type: "string" },
                instructions: { type: "string" },
                academic_level: { type: "string" },
                academicLevel: { type: "string" },
                subject_or_discipline: { type: "string" },
                subject: { type: "string" },
                referencing_style: { type: "string" },
                referencingStyle: { type: "string" },
                submission_deadline: { type: "string" },
                deadline: { type: "string" },
                total_page_count: { type: "integer" },
                requested_page_count: { type: "integer" },
                pageCount: { type: "integer" },
                word_count: { type: "integer" },
                wordCount: { type: "integer" },
                assignment_type: { type: "string" },
                language: { type: "string" },
                extraction_confidence: { type: "string" },
                fields_requiring_review: {
                    type: "array",
                    items: { type: "string" },
                },
            },
        };
        const aiRes = await aiProvider.generateStructuredContent({
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
        const merged = {
            assignment_title: validation.data.assignment_title ?? ruleBased.assignment_title ?? validation.data.title ?? ruleBased.title ?? null,
            assignment_brief: validation.data.assignment_brief ?? ruleBased.assignment_brief ?? validation.data.guidelines ?? ruleBased.guidelines ?? null,
            academic_level: validation.data.academic_level ?? ruleBased.academic_level ?? validation.data.academicLevel ?? ruleBased.academicLevel ?? null,
            subject_or_discipline: validation.data.subject_or_discipline ?? ruleBased.subject_or_discipline ?? validation.data.subject ?? ruleBased.subject ?? null,
            referencing_style: validation.data.referencing_style ?? ruleBased.referencing_style ?? validation.data.referencingStyle ?? ruleBased.referencingStyle ?? null,
            submission_deadline: validation.data.submission_deadline ?? ruleBased.submission_deadline ?? validation.data.deadline ?? ruleBased.deadline ?? null,
            total_page_count: validation.data.total_page_count ?? ruleBased.total_page_count ?? null,
            requested_page_count: validation.data.requested_page_count ?? ruleBased.requested_page_count ?? validation.data.pageCount ?? ruleBased.pageCount ?? null,
            word_count: validation.data.word_count ?? ruleBased.word_count ?? validation.data.wordCount ?? ruleBased.wordCount ?? null,
            assignment_type: validation.data.assignment_type ?? ruleBased.assignment_type ?? "assignment",
            language: validation.data.language ?? ruleBased.language ?? "English",
            extraction_confidence: validation.data.extraction_confidence ?? ruleBased.extraction_confidence ?? "high",
            fields_requiring_review: validation.data.fields_requiring_review ?? ruleBased.fields_requiring_review ?? [],
            // Backward compatibility aliases
            title: validation.data.title || ruleBased.title || (validation.data.assignment_title ?? undefined),
            questions: validation.data.questions || ruleBased.questions || (validation.data.assignment_brief ?? undefined),
            instructions: validation.data.instructions || ruleBased.instructions || (validation.data.assignment_brief ?? undefined),
            guidelines: validation.data.guidelines || ruleBased.guidelines || (validation.data.assignment_brief ?? undefined),
            wordCount: validation.data.wordCount || ruleBased.wordCount || (validation.data.word_count ?? undefined),
            referencingStyle: validation.data.referencingStyle || ruleBased.referencingStyle || (validation.data.referencing_style ?? undefined),
            deadline: validation.data.deadline || ruleBased.deadline || (validation.data.submission_deadline ?? undefined),
            academicLevel: validation.data.academicLevel || ruleBased.academicLevel || (validation.data.academic_level ?? undefined),
            subject: validation.data.subject || ruleBased.subject || (validation.data.subject_or_discipline ?? undefined),
            pageCount: validation.data.pageCount || ruleBased.pageCount || (validation.data.requested_page_count ?? undefined),
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
