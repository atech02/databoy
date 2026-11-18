/**
 * Utility parser to scan raw extracted text and suggest assignment metadata.
 */

export interface FieldConfidenceInfo {
  confidence: "high" | "medium" | "low";
  evidence?: string | null;
}

export interface ParsedAssignmentFields {
  // Primary structured schema fields
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
  field_confidences?: Record<string, FieldConfidenceInfo>;
  fieldConfidences?: Record<string, FieldConfidenceInfo>;

  // Backward compatibility aliases
  title?: string | null;
  guidelines?: string | null;
  questions?: string | null;
  instructions?: string | null;
  wordCount?: number | null;
  referencingStyle?: string | null;
  deadline?: string | null;
  academicLevel?: string | null;
  subject?: string | null;
  pageCount?: number | null;
}

const MONTHS: Record<string, string> = {
  jan: "01", january: "01", janvier: "01",
  feb: "02", february: "02", fevrier: "02", février: "02",
  mar: "03", march: "03", mars: "03",
  apr: "04", april: "04", avril: "04",
  may: "05", mai: "05",
  jun: "06", june: "06", juin: "06",
  jul: "07", july: "07", juillet: "07",
  aug: "08", august: "08", aout: "08", août: "08",
  sep: "09", september: "09", septembre: "09",
  oct: "10", october: "10", octobre: "10",
  nov: "11", november: "11", novembre: "11",
  dec: "12", december: "12", decembre: "12", décembre: "12"
};

const SUBJECT_KEYWORDS: Record<string, string[]> = {
  computer_science: ["programming", "algorithm", "database", "software", "java", "python", "javascript", "react", "node", "sql", "html", "css", "data structure", "socket server", "networking", "cybersecurity"],
  mathematics: ["calculus", "linear algebra", "differential", "probability", "statistics", "theorem", "matrix", "integral", "derivative"],
  engineering: ["mechanical", "electrical", "civil", "thermodynamics", "circuit", "cad", "structural engineering", "signal processing"],
  physics_chemistry: ["quantum", "chemical", "organic chemistry", "velocity", "thermodynamics", "reaction", "molecular", "spectroscopy"],
  biological_sciences: ["biology", "biochemistry", "pathology", "anatomy", "genetics", "cellular", "clinical", "health sciences", "pharmacology", "nursing", "medicine"],
  business_finance: ["accounting", "economics", "econometric", "econometrics", "macroeconomic", "macroeconomics", "microeconomic", "microeconomics", "balance sheet", "finance", "marketing", "management", "inflation", "gdp", "investment", "audit", "banking", "corporate governance"],
  law: ["jurisprudence", "tort", "contract law", "criminal law", "constitutional", "statute", "court", "legal precedent", "liability", "litigation", "human rights law"],
  social_sciences: ["psychology", "sociology", "political science", "anthropology", "social policy", "cognitive", "behavioral", "criminology"],
  humanities_arts: ["literature", "philosophy", "history", "ethics", "poetry", "art history", "linguistics", "theology"],
};

export function detectLanguageFromText(text: string): string {
  if (!text || text.trim().length === 0) return "English";
  const lower = text.toLowerCase();

  const frMarkers = [" le ", " la ", " les ", " des ", " est ", " dans ", " pour ", " avec ", " une ", " sur "];
  const esMarkers = [" el ", " la ", " los ", " las ", " por ", " para ", " con ", " una ", " en ", " del "];
  const ptMarkers = [" o ", " a ", " os ", " as ", " do ", " da ", " em ", " para ", " com ", " um "];
  const deMarkers = [" der ", " die ", " das ", " und ", " ist ", " in ", " für ", " mit ", " auf "];

  const frCount = frMarkers.filter((m) => lower.includes(m)).length;
  const esCount = esMarkers.filter((m) => lower.includes(m)).length;
  const ptCount = ptMarkers.filter((m) => lower.includes(m)).length;
  const deCount = deMarkers.filter((m) => lower.includes(m)).length;

  if (frCount >= 4) return "French";
  if (esCount >= 4) return "Spanish";
  if (ptCount >= 4) return "Portuguese";
  if (deCount >= 4) return "German";
  return "English";
}

/**
 * Attempts to parse date string into YYYY-MM-DD format
 */
export function parseDateToYMD(text: string): string | undefined {
  const ymdMatch = text.match(/\b(\d{4})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (ymdMatch) {
    const [, y, m, d] = ymdMatch;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }

  const dmyMatch = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([\p{L}]{3,12})\s+(\d{4})\b/iu);
  if (dmyMatch) {
    const [, d, monthStr, y] = dmyMatch;
    const cleanMonth = monthStr.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const rawMonth = monthStr.toLowerCase();
    const m = MONTHS[rawMonth] || MONTHS[cleanMonth] || MONTHS[cleanMonth.substring(0, 3)] || MONTHS[rawMonth.substring(0, 3)];
    if (m) {
      return `${y}-${m}-${d.padStart(2, "0")}`;
    }
  }

  const mdyMatch = text.match(/\b([\p{L}]{3,12})\s+(\d{1,2})(?:st|nd|rd|th)?\b,?\s+(\d{4})\b/iu);
  if (mdyMatch) {
    const [, monthStr, d, y] = mdyMatch;
    const cleanMonth = monthStr.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    const rawMonth = monthStr.toLowerCase();
    const m = MONTHS[rawMonth] || MONTHS[cleanMonth] || MONTHS[cleanMonth.substring(0, 3)] || MONTHS[rawMonth.substring(0, 3)];
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
  const detectedLang = detectLanguageFromText(rawText);
  fields.language = detectedLang;

  const reviewFields: string[] = [];
  const fieldConfidences: Record<string, FieldConfidenceInfo> = {};

  // 1. Identify Assignment Title
  const explicitTitleMatch =
    rawText.match(/\b(?:assignment\s+title|coursework\s+title|essay\s+title|topic|title|titre(?:\s+du\s+devoir|\s+du\s+projet)?|intitulé|sujet|título|thema)\s*[:\-]\s*([^\r\n]+)/i);

  if (explicitTitleMatch && explicitTitleMatch[1]?.trim().length >= 3) {
    const candidate = explicitTitleMatch[1].trim().replace(/^[#*\s-]+|[#*\s-]+$/g, "");
    if (candidate.length <= 250) {
      fields.assignment_title = candidate;
      fields.title = candidate;
      fieldConfidences.assignment_title = { confidence: "high", evidence: explicitTitleMatch[0].trim() };
    }
  }

  if (!fields.title) {
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
      "note", "please", "ensure", "submit", "read", "answer",
      "student", "candidate", "matric", "semester", "academic year",
      "just", "prompt", "name", "lecturer", "programme", "program",
      "consignes", "devoir", "professeur", "etudiant", "remise"
    ];
    const questionNumberingRegex = /^(\d+[\.\)]|[a-z][\.\)]|q\d+|task\s*\d+|part\s*[a-z\d]+)/i;
    const headerRegex = /\b(?:university|faculty|department|school\s+of|college|student\s+name|student\s+id|candidate\s+no|coursework\s+\d+|assignment\s+\d+|programme|program|year\s+\d+|semester\s+\d+|lecturer|examination|course\s+code|université|faculté|département)\b|^(?:name|student|candidate|id|nom|matricule)\s*:/i;

    const titleCandidate = lines.find(line => {
      if (line.length < 5 || line.length > 90) return false;
      const letterCount = (line.match(/[\p{L}]/gu) || []).length;
      if (letterCount < 4) return false;
      if (line.endsWith("?")) return false;
      if (/\.\s+[A-Za-z]/.test(line)) return false; // Multi-sentence prose is not a title
      if (questionNumberingRegex.test(line)) return false;
      if (headerRegex.test(line)) return false;
      const lower = line.toLowerCase();
      const firstWord = lower.split(/[\s:,\.\-]+/)[0];
      return !titleKeywords.includes(firstWord) && !titleKeywords.some(kw => lower.startsWith(kw) || lower.includes("deadline:") || lower.includes("date limite:"));
    });

    if (titleCandidate) {
      const clean = titleCandidate.replace(/^[#*\s-]+|[#*\s-]+$/g, "");
      fields.assignment_title = clean;
      fields.title = clean;
      fieldConfidences.assignment_title = { confidence: "medium", evidence: clean };
    } else {
      fields.assignment_title = null;
      fields.title = null;
      fieldConfidences.assignment_title = { confidence: "low", evidence: null };
      reviewFields.push("assignment_title");
    }
  }

  // 2. Identify Referencing Style
  const refStyles = ["APA", "Harvard", "MLA", "Chicago", "IEEE", "Vancouver", "OSCOLA"];
  for (const style of refStyles) {
    const regex = new RegExp(`\\b${style}\\b`, "i");
    if (regex.test(rawText)) {
      fields.referencing_style = style;
      fields.referencingStyle = style;
      fieldConfidences.referencing_style = { confidence: "high", evidence: style };
      break;
    }
  }
  if (!fields.referencing_style) {
    fields.referencing_style = null;
    fields.referencingStyle = null;
    fieldConfidences.referencing_style = { confidence: "low", evidence: null };
    reviewFields.push("referencing_style");
  }

  // 3. Identify Word Count
  const wordCountMatch =
    rawText.match(/\b(?:word\s*count|word\s*limit|limit|limite|nombre\s+de\s+mots)?\s*[:\-]?\s*([0-9,]{3,6})\s*(?:words?|mots?|palabras?|wörter?)\b/i) ||
    rawText.match(/\b(?:words?|mots?|palabras?)\s*(?:count|limit)?\s*[:\-]?\s*([0-9,]{3,6})\b/i);
  if (wordCountMatch) {
    const val = parseInt(wordCountMatch[1].replace(/,/g, ""), 10);
    if (!isNaN(val) && val >= 100 && val <= 50000) {
      fields.word_count = val;
      fields.wordCount = val;
      fieldConfidences.word_count = { confidence: "high", evidence: wordCountMatch[0] };
    }
  } else {
    fieldConfidences.word_count = { confidence: "low", evidence: null };
  }

  // 4. Identify Deadline
  const deadlineMatch = rawText.match(/\b(?:deadline|due\s+date|due|by|final\s+submission|submission\s+deadline|submission|date\s+limite|échéance|date\s+de\s+remise|à\s+rendre\s+avant\s+le)\b\s*[:\-]?\s*([^\n\r]+)/i);
  if (deadlineMatch) {
    const parsedDate = parseDateToYMD(deadlineMatch[1]);
    if (parsedDate) {
      fields.submission_deadline = parsedDate;
      fields.deadline = parsedDate;
      fieldConfidences.submission_deadline = { confidence: "high", evidence: deadlineMatch[0].trim() };
    }
  }
  if (!fields.deadline) {
    const anyDateMatch = rawText.match(/\b(\d{1,2})(st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|janvier|fevrier|février|mars|avril|mai|juin|juillet|aout|août|septembre|octobre|novembre|decembre|décembre)[a-z]*\s+(\d{4})\b/i);
    if (anyDateMatch) {
      const parsedDate = parseDateToYMD(anyDateMatch[0]);
      if (parsedDate) {
        fields.submission_deadline = parsedDate;
        fields.deadline = parsedDate;
        fieldConfidences.submission_deadline = { confidence: "medium", evidence: anyDateMatch[0] };
      }
    }
  }
  if (!fields.deadline) {
    const isoDateMatch = rawText.match(/\b(\d{4}[-/]\d{2}[-/]\d{2})\b/);
    if (isoDateMatch) {
      const parsedDate = parseDateToYMD(isoDateMatch[1]);
      if (parsedDate) {
        fields.submission_deadline = parsedDate;
        fields.deadline = parsedDate;
        fieldConfidences.submission_deadline = { confidence: "medium", evidence: isoDateMatch[1] };
      }
    }
  }
  if (!fields.deadline) {
    fields.submission_deadline = null;
    fields.deadline = null;
    fieldConfidences.submission_deadline = { confidence: "low", evidence: null };
    reviewFields.push("submission_deadline");
  }

  // 5. Academic Level
  const academicLevels: Array<[RegExp, string]> = [
    [/\b(?:phd|doctorate|doctoral|doctorat)\b/i, "phd"],
    [/\b(?:postgraduate\s+diploma|pgd)\b/i, "diploma"],
    [/\b(?:master['’]?s?|postgraduate|msc|mba|ma|llm|mastère|master)\b/i, "masters"],
    [/\b(?:undergraduate|bachelor['’]?s?|bsc|ba|ll\.?b|b\.?ed|degree|licence)\b/i, "degree"],
    [/\b(?:diploma|higher\s+national\s+diploma|hnd|bts|dut)\b/i, "diploma"],
    [/\b(?:high\s+school|secondary\s+school|lycée|baccalauréat)\b/i, "high_school"],
  ];
  for (const [regex, level] of academicLevels) {
    if (regex.test(rawText)) {
      fields.academic_level = level as any;
      fields.academicLevel = level;
      fieldConfidences.academic_level = { confidence: "high", evidence: level };
      break;
    }
  }
  if (!fields.academic_level) {
    fields.academic_level = null;
    fields.academicLevel = null;
    fieldConfidences.academic_level = { confidence: "low", evidence: null };
    reviewFields.push("academic_level");
  }

  // 6. Subject or Discipline Identification
  const lowerText = rawText.toLowerCase();
  let detectedSubject: string | null = null;
  let maxMatches = 0;

  for (const [subj, keywords] of Object.entries(SUBJECT_KEYWORDS)) {
    const matchCount = keywords.filter((kw) => lowerText.includes(kw)).length;
    if (matchCount > maxMatches && matchCount >= 2) {
      maxMatches = matchCount;
      detectedSubject = subj;
    }
  }

  if (detectedSubject) {
    fields.subject_or_discipline = detectedSubject;
    fields.subject = detectedSubject;
    fieldConfidences.subject_or_discipline = {
      confidence: maxMatches >= 3 ? "high" : "medium",
      evidence: `${detectedSubject} (${maxMatches} matched keywords)`
    };
  } else {
    fields.subject_or_discipline = null;
    fieldConfidences.subject_or_discipline = { confidence: "low", evidence: null };
    reviewFields.push("subject_or_discipline");
  }

  // 7. Page count / budget: Distinguish "Page 10" from "Write 10 pages"
  const requestedPagesMatch = rawText.match(/\b(?:write|prepare|length|submit|maximum|up\s+to|at\s+least|rédiger|longueur|au\s+moins)?\s*([1-9]\d?)\s*pages?\b/i);
  const isPageNumber = /\bpages?\s+[1-9]\d?\b/i.test(requestedPagesMatch?.[0] || "");
  const isPageRange = /\bpages?\s+[1-9]\d?\s*[-–]\s*[1-9]\d?\b/i.test(rawText);

  if (requestedPagesMatch && !isPageNumber && !isPageRange) {
    const pagesVal = parseInt(requestedPagesMatch[1], 10);
    if (!isNaN(pagesVal) && pagesVal >= 1 && pagesVal <= 100) {
      fields.requested_page_count = pagesVal;
      fields.pageCount = pagesVal;
      fieldConfidences.requested_page_count = { confidence: "high", evidence: requestedPagesMatch[0] };
    }
  } else if (fields.word_count) {
    fields.requested_page_count = Math.max(1, Math.ceil(fields.word_count / 250));
    fields.pageCount = fields.requested_page_count;
    fieldConfidences.requested_page_count = { confidence: "medium", evidence: `Calculated from ${fields.word_count} words` };
  } else {
    fields.requested_page_count = null;
    fieldConfidences.requested_page_count = { confidence: "low", evidence: null };
    reviewFields.push("requested_page_count");
  }

  // 8. Guidelines / Brief Extraction
  const verbs = [
    "discuss", "analyse", "analyze", "evaluate", "assess", "explain",
    "examine", "review", "compare", "contrast", "critique", "investigate",
    "illustrate", "interpret", "demonstrate", "justify", "describe",
    "explore", "identify", "recommend", "discuter", "analyser", "évaluer", "expliquer"
  ];
  const markers = [
    "question\\s*\\d+",
    "task\\s*\\d+",
    "part\\s*[a-z\\d]+",
    "section\\s*[a-z\\d]+",
    "partie\\s*[a-z\\d]+"
  ];

  const sectionRegex = /\b(?:instructions|assignment\s+tasks|assignment\s+questions?|requirements|brief|prompt|case\s+study|consignes|travail\s+à\s+rendre|sujet)\b/i;
  const markersRegex = new RegExp(`\\b(?:${markers.join("|")})\\b`, "i");
  const verbsRegex = new RegExp(`\\b(?:${verbs.join("|")})\\b`, "i");

  let matchIdx = -1;
  let briefEvidence: string | null = null;

  const secMatch = rawText.match(sectionRegex);
  if (secMatch && secMatch.index !== undefined) {
    matchIdx = secMatch.index;
    briefEvidence = secMatch[0];
  } else {
    const mMatch = rawText.match(markersRegex);
    if (mMatch && mMatch.index !== undefined) {
      matchIdx = mMatch.index;
      briefEvidence = mMatch[0];
    } else {
      const vMatch = rawText.match(verbsRegex);
      if (vMatch && vMatch.index !== undefined) {
        matchIdx = vMatch.index;
        briefEvidence = vMatch[0];
      }
    }
  }

  if (matchIdx !== -1) {
    const extractedGuidelines = rawText.substring(matchIdx).trim();
    fields.assignment_brief = extractedGuidelines;
    fields.guidelines = extractedGuidelines;
    fields.instructions = extractedGuidelines;
    fields.questions = extractedGuidelines;
    fieldConfidences.assignment_brief = {
      confidence: secMatch ? "high" : "medium",
      evidence: briefEvidence
    };
  } else {
    fields.assignment_brief = null;
    fieldConfidences.assignment_brief = { confidence: "low", evidence: null };
    reviewFields.push("assignment_brief");
  }

  fields.field_confidences = fieldConfidences;
  fields.fieldConfidences = fieldConfidences;
  fields.fields_requiring_review = reviewFields;
  fields.extraction_confidence = reviewFields.length <= 1 && fields.title ? "high" : reviewFields.length <= 3 ? "medium" : "low";

  return fields;
}
