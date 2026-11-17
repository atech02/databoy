import { ParsedAssignmentFields } from "./types.js";

export interface ValidationResult<T> {
  isValid: boolean;
  data?: T;
  errorCode?: "EMPTY_RESPONSE" | "INVALID_JSON" | "SCHEMA_MISMATCH" | "TRUNCATED_JSON";
  errorMessage?: string;
  details?: any;
}

const VALID_REFERENCING_STYLES = new Set(["APA", "Harvard", "MLA", "Chicago", "IEEE", "Vancouver", "Other"]);
const VALID_ACADEMIC_LEVELS = new Set(["high_school", "diploma", "degree", "masters", "phd"]);

const VALID_SUBJECTS = new Set([
  "computer_science",
  "mathematics",
  "engineering",
  "physics_chemistry",
  "biological_sciences",
  "business_finance",
  "humanities_arts",
  "social_sciences",
  "law",
]);

const INSTITUTION_HEADER_PATTERNS = [
  /\b(?:university|college|faculty|department|school\s+of|institute)\b/i,
  /\b(?:semester|academic\s+year|module\s+code|course\s+code)\b/i,
  /\b(?:student\s+name|student\s+id|candidate\s+no|matric\s+no)\b/i,
  /\b(?:assignment\s+brief|coursework\s+specification|assessment\s+brief)\b/i,
];

const MONTHS: Record<string, string> = {
  jan: "01", january: "01",
  feb: "02", february: "02",
  mar: "03", march: "03",
  apr: "04", april: "04",
  may: "05",
  jun: "06", june: "06",
  jul: "07", july: "07",
  aug: "08", august: "08",
  sep: "09", september: "09",
  oct: "10", october: "10",
  nov: "11", november: "11",
  dec: "12", december: "12",
};

function parseDateToYMD(text: string): string | undefined {
  const ymdMatch = text.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const dmyMatch = text.match(/\b(\d{1,2})(st|nd|rd|th)?\s+([A-Za-z]{3,10})\s+(\d{4})\b/i);
  if (dmyMatch) {
    const [, d, , monthStr, y] = dmyMatch;
    const m = MONTHS[monthStr.toLowerCase().substring(0, 3)];
    if (m) {
      return `${y}-${m}-${d.padStart(2, "0")}`;
    }
  }

  const mdyMatch = text.match(/\b([A-Za-z]{3,10})\s+(\d{1,2})(st|nd|rd|th)?\b,?\s+(\d{4})\b/i);
  if (mdyMatch) {
    const [, monthStr, d, , y] = mdyMatch;
    const m = MONTHS[monthStr.toLowerCase().substring(0, 3)];
    if (m) {
      return `${y}-${m}-${d.padStart(2, "0")}`;
    }
  }

  return undefined;
}

/**
 * Validates and sanitizes raw JSON output from AI providers into authoritative ParsedAssignmentFields.
 * Defends against hallucinations, invalid JSON, truncated responses, prototype pollution, and schema mismatches.
 */
export class AIResponseValidator {
  /**
   * Parses and validates raw AI text response.
   */
  public static validateAssignmentBrief(rawText: string | undefined | null): ValidationResult<ParsedAssignmentFields> {
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

    let parsed: any;
    try {
      parsed = JSON.parse(jsonString);
    } catch (parseErr: any) {
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
    const sanitized: ParsedAssignmentFields = {};
    const reviewFields: string[] = [];

    // Helper to get field across snake_case and camelCase
    const getVal = (snake: string, camel: string) => {
      if (parsed[snake] !== undefined && parsed[snake] !== null) return parsed[snake];
      if (parsed[camel] !== undefined && parsed[camel] !== null) return parsed[camel];
      return undefined;
    };

    // 1. Title validation (assignment_title / title)
    const rawTitle = getVal("assignment_title", "title");
    if (typeof rawTitle === "string" && rawTitle.trim().length > 0) {
      const cleanTitle = rawTitle.replace(/^[#*\s-]+|[#*\s-]+$/g, "").trim();
      // Verify title is not just an institutional header or student ID line
      const isHeader = INSTITUTION_HEADER_PATTERNS.some((p) => p.test(cleanTitle));
      if (cleanTitle.length >= 3 && cleanTitle.length <= 250 && !isHeader) {
        sanitized.assignment_title = cleanTitle;
        sanitized.title = cleanTitle;
      } else if (isHeader) {
        reviewFields.push("assignment_title");
      }
    } else {
      sanitized.assignment_title = null;
      reviewFields.push("assignment_title");
    }

    // 2. Assignment Brief / Questions / Instructions
    const rawBrief = getVal("assignment_brief", "brief") || getVal("questions", "questions") || getVal("instructions", "instructions") || getVal("guidelines", "guidelines");
    if (typeof rawBrief === "string" && rawBrief.trim().length > 0) {
      const cleanBrief = rawBrief.trim();
      sanitized.assignment_brief = cleanBrief;
      sanitized.guidelines = cleanBrief;
      sanitized.instructions = cleanBrief;
      sanitized.questions = cleanBrief;
    } else {
      sanitized.assignment_brief = null;
    }

    // 3. Academic Level (academic_level / academicLevel)
    const rawLevel = getVal("academic_level", "academicLevel");
    if (typeof rawLevel === "string" && rawLevel.trim().length > 0) {
      const lower = rawLevel.toLowerCase().trim();
      if (VALID_ACADEMIC_LEVELS.has(lower)) {
        sanitized.academic_level = lower as any;
        sanitized.academicLevel = lower;
      } else if (lower.includes("phd") || lower.includes("doctor")) {
        sanitized.academic_level = "phd";
        sanitized.academicLevel = "phd";
      } else if (lower.includes("master") || lower.includes("postgrad")) {
        sanitized.academic_level = "masters";
        sanitized.academicLevel = "masters";
      } else if (lower.includes("undergrad") || lower.includes("bachelor") || lower.includes("degree")) {
        sanitized.academic_level = "degree";
        sanitized.academicLevel = "degree";
      } else if (lower.includes("diploma") || lower.includes("certificate")) {
        sanitized.academic_level = "diploma";
        sanitized.academicLevel = "diploma";
      } else if (lower.includes("school")) {
        sanitized.academic_level = "high_school";
        sanitized.academicLevel = "high_school";
      } else {
        sanitized.academic_level = null;
        reviewFields.push("academic_level");
      }
    } else {
      sanitized.academic_level = null;
      reviewFields.push("academic_level");
    }

    // 4. Subject or Discipline (subject_or_discipline / subject)
    const rawSubject = getVal("subject_or_discipline", "subject");
    if (typeof rawSubject === "string" && rawSubject.trim().length > 0) {
      const lower = rawSubject.toLowerCase().trim();
      if (VALID_SUBJECTS.has(lower)) {
        sanitized.subject_or_discipline = lower;
        sanitized.subject = lower;
      } else if (lower.includes("computer") || lower.includes("software") || lower.includes("programming") || lower.includes("data")) {
        sanitized.subject_or_discipline = "computer_science";
        sanitized.subject = "computer_science";
      } else if (lower.includes("math") || lower.includes("statistic")) {
        sanitized.subject_or_discipline = "mathematics";
        sanitized.subject = "mathematics";
      } else if (lower.includes("engineer")) {
        sanitized.subject_or_discipline = "engineering";
        sanitized.subject = "engineering";
      } else if (lower.includes("physic") || lower.includes("chemist")) {
        sanitized.subject_or_discipline = "physics_chemistry";
        sanitized.subject = "physics_chemistry";
      } else if (lower.includes("bio") || lower.includes("health") || lower.includes("medicine") || lower.includes("nurs")) {
        sanitized.subject_or_discipline = "biological_sciences";
        sanitized.subject = "biological_sciences";
      } else if (lower.includes("business") || lower.includes("econom") || lower.includes("finance") || lower.includes("account")) {
        sanitized.subject_or_discipline = "business_finance";
        sanitized.subject = "business_finance";
      } else if (lower.includes("law") || lower.includes("legal") || lower.includes("juris")) {
        sanitized.subject_or_discipline = "law";
        sanitized.subject = "law";
      } else if (lower.includes("psych") || lower.includes("sociolog") || lower.includes("social")) {
        sanitized.subject_or_discipline = "social_sciences";
        sanitized.subject = "social_sciences";
      } else if (lower.includes("humanit") || lower.includes("art") || lower.includes("philosoph") || lower.includes("histor")) {
        sanitized.subject_or_discipline = "humanities_arts";
        sanitized.subject = "humanities_arts";
      } else {
        sanitized.subject_or_discipline = null;
        reviewFields.push("subject_or_discipline");
      }
    } else {
      sanitized.subject_or_discipline = null;
      reviewFields.push("subject_or_discipline");
    }

    // 5. Referencing Style (referencing_style / referencingStyle)
    const rawStyle = getVal("referencing_style", "referencingStyle");
    if (typeof rawStyle === "string" && rawStyle.trim().length > 0) {
      const trimmedStyle = rawStyle.trim();
      const matched = Array.from(VALID_REFERENCING_STYLES).find(
        (s) => s.toLowerCase() === trimmedStyle.toLowerCase()
      );
      if (matched) {
        sanitized.referencing_style = matched;
        sanitized.referencingStyle = matched;
      } else if (/apa/i.test(trimmedStyle)) {
        sanitized.referencing_style = "APA";
        sanitized.referencingStyle = "APA";
      } else if (/harvard/i.test(trimmedStyle)) {
        sanitized.referencing_style = "Harvard";
        sanitized.referencingStyle = "Harvard";
      } else if (/mla/i.test(trimmedStyle)) {
        sanitized.referencing_style = "MLA";
        sanitized.referencingStyle = "MLA";
      } else if (/chicago/i.test(trimmedStyle)) {
        sanitized.referencing_style = "Chicago";
        sanitized.referencingStyle = "Chicago";
      } else if (/ieee/i.test(trimmedStyle)) {
        sanitized.referencing_style = "IEEE";
        sanitized.referencingStyle = "IEEE";
      } else if (/vancouver/i.test(trimmedStyle)) {
        sanitized.referencing_style = "Vancouver";
        sanitized.referencingStyle = "Vancouver";
      } else {
        sanitized.referencing_style = "Other";
        sanitized.referencingStyle = "Other";
      }
    } else {
      sanitized.referencing_style = null;
      reviewFields.push("referencing_style");
    }

    // 6. Submission Deadline (submission_deadline / deadline)
    const rawDeadline = getVal("submission_deadline", "deadline");
    if (typeof rawDeadline === "string" && rawDeadline.trim().length > 0) {
      const dateStr = rawDeadline.trim();
      const isoMatch = dateStr.match(/^\d{4}-\d{2}-\d{2}$/);
      if (isoMatch && !isNaN(Date.parse(dateStr))) {
        sanitized.submission_deadline = dateStr;
        sanitized.deadline = dateStr;
      } else {
        const parsed = parseDateToYMD(dateStr);
        if (parsed) {
          sanitized.submission_deadline = parsed;
          sanitized.deadline = parsed;
        } else {
          sanitized.submission_deadline = null;
          sanitized.deadline = null;
          reviewFields.push("submission_deadline");
        }
      }
    } else {
      sanitized.submission_deadline = null;
      sanitized.deadline = null;
      reviewFields.push("submission_deadline");
    }

    // 7. Page counts: Distinguish requested_page_count vs total_page_count
    const rawReqPages = getVal("requested_page_count", "pageCount");
    if (typeof rawReqPages === "number" && !isNaN(rawReqPages)) {
      const val = Math.round(rawReqPages);
      if (val >= 1 && val <= 100) {
        sanitized.requested_page_count = val;
        sanitized.pageCount = val;
      }
    } else {
      sanitized.requested_page_count = null;
    }

    const rawTotalPages = getVal("total_page_count", "totalPageCount");
    if (typeof rawTotalPages === "number" && !isNaN(rawTotalPages)) {
      sanitized.total_page_count = Math.max(1, Math.round(rawTotalPages));
    } else {
      sanitized.total_page_count = null;
    }

    // 8. Word Count (word_count / wordCount)
    const rawWordCount = getVal("word_count", "wordCount");
    if (typeof rawWordCount === "number" && !isNaN(rawWordCount)) {
      const rounded = Math.round(rawWordCount);
      if (rounded >= 50 && rounded <= 100000) {
        sanitized.word_count = rounded;
        sanitized.wordCount = rounded;
      }
    } else if (typeof rawWordCount === "string") {
      const match = rawWordCount.match(/\b([0-9,]{2,7})\b/);
      if (match) {
        const val = parseInt(match[1].replace(/,/g, ""), 10);
        if (!isNaN(val) && val >= 50 && val <= 100000) {
          sanitized.word_count = val;
          sanitized.wordCount = val;
        }
      }
    } else {
      sanitized.word_count = null;
    }

    // Derive requested_page_count from word_count if word_count is explicitly provided but requested_page_count is null
    if (!sanitized.requested_page_count && sanitized.word_count && sanitized.word_count >= 100) {
      sanitized.requested_page_count = Math.max(1, Math.ceil(sanitized.word_count / 250));
      sanitized.pageCount = sanitized.requested_page_count;
    }

    // 9. Assignment Type
    const rawType = getVal("assignment_type", "assignmentType");
    if (typeof rawType === "string" && rawType.trim().length > 0) {
      sanitized.assignment_type = rawType.trim();
    } else {
      sanitized.assignment_type = "assignment";
    }

    // 10. Language Detection
    const rawLang = getVal("language", "language");
    if (typeof rawLang === "string" && rawLang.trim().length > 0) {
      sanitized.language = rawLang.trim();
    } else {
      sanitized.language = "English";
    }

    // 11. Extraction Confidence & Fields Requiring Review
    const rawConf = getVal("extraction_confidence", "confidence");
    if (rawConf === "high" || rawConf === "medium" || rawConf === "low") {
      sanitized.extraction_confidence = rawConf;
    } else {
      sanitized.extraction_confidence = reviewFields.length <= 1 && sanitized.assignment_title ? "high" : reviewFields.length <= 3 ? "medium" : "low";
    }

    const rawReviewFields = getVal("fields_requiring_review", "fieldsRequiringReview");
    if (Array.isArray(rawReviewFields)) {
      const combined = Array.from(new Set([...reviewFields, ...rawReviewFields.filter((f) => typeof f === "string")]));
      sanitized.fields_requiring_review = combined;
    } else {
      sanitized.fields_requiring_review = reviewFields;
    }

    return {
      isValid: true,
      data: sanitized,
    };
  }
}
