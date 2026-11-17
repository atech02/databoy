/**
 * Utility parser to scan raw extracted text and suggest assignment metadata.
 */

export interface ParsedAssignmentFields {
  title?: string;
  guidelines?: string; // Maps to Assignment Brief
  questions?: string;
  instructions?: string;
  wordCount?: number;
  referencingStyle?: string;
  deadline?: string; // YYYY-MM-DD formatted
  academicLevel?: string;
}

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
  dec: "12", december: "12"
};

/**
 * Attempts to parse date string into YYYY-MM-DD format
 */
function parseDateToYMD(text: string): string | undefined {
  const ymdMatch = text.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (ymdMatch) {
    const [_, y, m, d] = ymdMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const dmyMatch = text.match(/\b(\d{1,2})(st|nd|rd|th)?\s+([A-Za-z]{3,10})\s+(\d{4})\b/i);
  if (dmyMatch) {
    const [_, d, , monthStr, y] = dmyMatch;
    const m = MONTHS[monthStr.toLowerCase().substring(0, 3)];
    if (m) {
      return `${y}-${m}-${d.padStart(2, "0")}`;
    }
  }

  const mdyMatch = text.match(/\b([A-Za-z]{3,10})\s+(\d{1,2})(st|nd|rd|th)?\b,?\s+(\d{4})\b/i);
  if (mdyMatch) {
    const [_, monthStr, d, , y] = mdyMatch;
    const m = MONTHS[monthStr.toLowerCase().substring(0, 3)];
    if (m) {
      return `${y}-${m}-${d.padStart(2, "0")}`;
    }
  }

  return undefined;
}

export function parseOCRText(rawText: string): ParsedAssignmentFields {
  const fields: ParsedAssignmentFields = {};
  if (!rawText || !rawText.trim()) return fields;

  const lines = rawText.split(/\r?\n/).map(l => l.trim()).filter(Boolean);

  // 1. Identify Assignment Title
  const titleKeywords = [
    "due", "deadline", "date", "referencing", "style", "word",
    "count", "page", "instructor", "course", "module", "university",
    "school", "faculty", "department", "college",
    "assignment", "instructions", "grading", "rubric",
    "discuss", "analyse", "analyze", "evaluate", "assess", "explain",
    "examine", "compare", "contrast", "critique", "investigate",
    "what", "how", "why", "who", "when", "where", "which",
    "identify", "describe", "outline", "summarize", "summarise",
    "consider", "calculate", "solve", "determine", "demonstrate",
    "note", "please", "ensure", "submit", "read", "answer"
  ];
  const questionNumberingRegex = /^(\d+[\.\)]|[a-z][\.\)]|q\d+|task\s*\d+|part\s*[a-z\d]+)/i;
  const titleCandidate = lines.find(line => {
    if (line.length < 5 || line.length > 80) return false;
    if (line.endsWith("?")) return false;
    if (questionNumberingRegex.test(line)) return false;
    const lower = line.toLowerCase();
    const firstWord = lower.split(/[\s:,\.\-]+/)[0];
    return !titleKeywords.includes(firstWord) && !titleKeywords.some(kw => lower.includes(kw));
  });
  if (titleCandidate) {
    fields.title = titleCandidate.replace(/^[#*\s-]+|[#*\s-]+$/g, "");
  }

  // 2. Identify Referencing Style
  const refStyles = ["APA", "Harvard", "MLA", "Chicago", "IEEE", "Vancouver"];
  for (const style of refStyles) {
    const regex = new RegExp(`\\b${style}\\b`, "i");
    if (regex.test(rawText)) {
      fields.referencingStyle = style;
      break;
    }
  }

  // 3. Identify Word Count
  const wordCountMatch = rawText.match(/\b(?:word\s*count|word\s*limit|limit)?\s*[:\-]?\s*([0-9,]{3,6})\s*words?\b/i) ||
                         rawText.match(/\bwords?\s*(?:count|limit)?\s*[:\-]?\s*([0-9,]{3,6})\b/i);
  if (wordCountMatch) {
    const val = parseInt(wordCountMatch[1].replace(/,/g, ""), 10);
    if (!isNaN(val) && val > 100) {
      fields.wordCount = val;
    }
  }

  // 4. Identify Deadline
  const deadlineMatch = rawText.match(/\b(?:deadline|due\s+date|due|by)\b\s*[:\-]?\s*([^\n\r]+)/i);
  if (deadlineMatch) {
    const parsedDate = parseDateToYMD(deadlineMatch[1]);
    if (parsedDate) {
      fields.deadline = parsedDate;
    }
  }
  if (!fields.deadline) {
    const anyDateMatch = rawText.match(/\b(\d{1,2})(st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})\b/i);
    if (anyDateMatch) {
      const parsedDate = parseDateToYMD(anyDateMatch[0]);
      if (parsedDate) {
        fields.deadline = parsedDate;
      }
    }
  }

  // 5. Identify Guidelines / Assignment Question & Tasks (Primary Target - Revision 1 & 2)
  // We search for section headers, question markers, and academic action verbs to split the instructions.
  // We preserve formatting, line breaks, bullet points, and headings (Revision 7).
  let extractedGuidelines = "";

  const verbs = [
    "discuss", "analyse", "analyze", "evaluate", "assess", "explain",
    "examine", "review", "compare", "contrast", "critique", "investigate",
    "illustrate", "interpret", "demonstrate", "justify", "describe",
    "explore", "identify", "recommend"
  ];
  const markers = [
    "question\\s*\\d+",
    "task\\s*\\d+",
    "part\\s*[a-z\\d]+",
    "section\\s*[a-z\\d]+"
  ];

  const sectionRegex = /\b(?:instructions|assignment\s+tasks|assignment\s+questions?|requirements|brief|prompt|case\s+study)\b/i;
  const markersRegex = new RegExp(`\\b(?:${markers.join("|")})\\b`, "i");
  const verbsRegex = new RegExp(`\\b(?:${verbs.join("|")})\\b`, "i");

  let matchIdx = -1;

  // Prioritize general section headings, then specific question markers, then academic verbs
  const secMatch = rawText.match(sectionRegex);
  if (secMatch && secMatch.index !== undefined) {
    matchIdx = secMatch.index;
  } else {
    const mMatch = rawText.match(markersRegex);
    if (mMatch && mMatch.index !== undefined) {
      matchIdx = mMatch.index;
    } else {
      const vMatch = rawText.match(verbsRegex);
      if (vMatch && vMatch.index !== undefined) {
        matchIdx = vMatch.index;
      }
    }
  }

  if (matchIdx !== -1) {
    extractedGuidelines = rawText.substring(matchIdx).trim();
  } else {
    extractedGuidelines = rawText; // fallback to complete text
  }

  fields.guidelines = extractedGuidelines.trim();

  return fields;
}
