const VALID_REFERENCING_STYLES = new Set(["APA", "Harvard", "MLA", "Chicago", "IEEE", "Vancouver", "Other"]);
const VALID_ACADEMIC_LEVELS = new Set(["high_school", "diploma", "degree", "masters", "phd"]);
/**
 * Validates and sanitizes raw JSON output from AI providers into authoritative ParsedAssignmentFields.
 * Defends against hallucinations, invalid JSON, truncated responses, and schema mismatches.
 */
export class AIResponseValidator {
    /**
     * Parses and validates raw AI text response.
     */
    static validateAssignmentBrief(rawText) {
        if (!rawText || typeof rawText !== "string" || !rawText.trim()) {
            return {
                isValid: false,
                errorCode: "EMPTY_RESPONSE",
                errorMessage: "AI returned empty or null content.",
            };
        }
        const trimmed = rawText.trim();
        // Strip markdown code fences if present
        let jsonString = trimmed;
        if (jsonString.startsWith("```")) {
            jsonString = jsonString.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
        }
        // Check for obvious JSON truncation: starts like JSON object/array but doesn't close
        const looksLikeJson = jsonString.startsWith("{") || jsonString.startsWith("[");
        if (looksLikeJson && !jsonString.endsWith("}") && !jsonString.endsWith("]")) {
            return {
                isValid: false,
                errorCode: "TRUNCATED_JSON",
                errorMessage: "AI output appears truncated or incomplete.",
            };
        }
        let parsed;
        try {
            parsed = JSON.parse(jsonString);
        }
        catch (parseErr) {
            return {
                isValid: false,
                errorCode: "INVALID_JSON",
                errorMessage: `Failed to parse AI output as JSON: ${parseErr?.message || parseErr}`,
            };
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return {
                isValid: false,
                errorCode: "SCHEMA_MISMATCH",
                errorMessage: "AI JSON root is not an object.",
            };
        }
        // Sanitize and validate fields
        const sanitized = {};
        // 1. Title validation
        if (typeof parsed.title === "string" && parsed.title.trim().length > 0) {
            const cleanTitle = parsed.title.replace(/^[#*\s-]+|[#*\s-]+$/g, "").trim();
            if (cleanTitle.length >= 3 && cleanTitle.length <= 200) {
                sanitized.title = cleanTitle;
            }
        }
        // 2. Questions validation
        if (typeof parsed.questions === "string" && parsed.questions.trim().length > 0) {
            sanitized.questions = parsed.questions.trim();
        }
        // 3. Instructions validation
        if (typeof parsed.instructions === "string" && parsed.instructions.trim().length > 0) {
            sanitized.instructions = parsed.instructions.trim();
        }
        // 4. Guidelines fallback
        sanitized.guidelines =
            sanitized.questions || sanitized.instructions || (typeof parsed.guidelines === "string" ? parsed.guidelines.trim() : undefined);
        // 5. Word Count validation (bounded between 50 and 100,000)
        if (typeof parsed.wordCount === "number" && !isNaN(parsed.wordCount)) {
            const rounded = Math.round(parsed.wordCount);
            if (rounded >= 50 && rounded <= 100000) {
                sanitized.wordCount = rounded;
            }
        }
        else if (typeof parsed.wordCount === "string") {
            const match = parsed.wordCount.match(/\b([0-9,]{2,7})\b/);
            if (match) {
                const val = parseInt(match[1].replace(/,/g, ""), 10);
                if (!isNaN(val) && val >= 50 && val <= 100000) {
                    sanitized.wordCount = val;
                }
            }
        }
        // 6. Referencing Style validation & normalization
        if (typeof parsed.referencingStyle === "string" && parsed.referencingStyle.trim().length > 0) {
            const rawStyle = parsed.referencingStyle.trim();
            const matched = Array.from(VALID_REFERENCING_STYLES).find((s) => s.toLowerCase() === rawStyle.toLowerCase());
            sanitized.referencingStyle = matched || rawStyle.slice(0, 50);
        }
        // 7. Deadline validation (YYYY-MM-DD normalization)
        if (typeof parsed.deadline === "string" && parsed.deadline.trim().length > 0) {
            const dateStr = parsed.deadline.trim();
            const isoMatch = dateStr.match(/^\d{4}-\d{2}-\d{2}$/);
            if (isoMatch) {
                const timestamp = Date.parse(dateStr);
                if (!isNaN(timestamp)) {
                    sanitized.deadline = dateStr;
                }
            }
        }
        // 8. Academic Level validation & normalization
        if (typeof parsed.academicLevel === "string" && parsed.academicLevel.trim().length > 0) {
            const lower = parsed.academicLevel.toLowerCase().trim();
            if (VALID_ACADEMIC_LEVELS.has(lower)) {
                sanitized.academicLevel = lower;
            }
            else if (lower.includes("phd") || lower.includes("doctor")) {
                sanitized.academicLevel = "phd";
            }
            else if (lower.includes("master") || lower.includes("postgrad")) {
                sanitized.academicLevel = "masters";
            }
            else if (lower.includes("undergrad") || lower.includes("bachelor") || lower.includes("degree")) {
                sanitized.academicLevel = "degree";
            }
            else if (lower.includes("diploma")) {
                sanitized.academicLevel = "diploma";
            }
            else if (lower.includes("school")) {
                sanitized.academicLevel = "high_school";
            }
        }
        return {
            isValid: true,
            data: sanitized,
        };
    }
}
