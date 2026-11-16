import { adminDb } from "../config/firebaseAdmin.js";
import { r2StorageService } from "./r2StorageService.js";

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

export interface OCRMetrics {
  fileType: string;
  extractionMethod: string;
  status: "Success" | "Failure";
  durationMs: number;
  confidenceScore: number;
  completenessScore?: number;
  modelUsed?: string;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
  };
  requestCostEstimate?: number;
  errorReason?: string;
}

export interface OCRProcessingResult {
  rawText: string;
  parsedFields: ParsedAssignmentFields;
  confidence: "high" | "medium" | "low";
  ocrMetrics: OCRMetrics;
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
  dec: "12", december: "12",
};

export function parseDateToYMD(text: string): string | undefined {
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

export function parseTextToAssignmentFields(rawText: string): ParsedAssignmentFields {
  const fields: ParsedAssignmentFields = {};
  if (!rawText || !rawText.trim()) return fields;

  const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // 1. Title detection
  const titleSkipWords = [
    "due", "deadline", "date", "referencing", "style", "word",
    "count", "page", "instructor", "course", "module", "university",
    "school", "faculty", "department", "college",
    "assignment", "instructions", "grading", "rubric",
  ];
  const titleCandidate = lines.find((line) => {
    if (line.length < 5 || line.length > 90) return false;
    const lower = line.toLowerCase();
    return !titleSkipWords.some((kw) => lower.startsWith(kw) || lower.includes("deadline:"));
  });
  if (titleCandidate) {
    fields.title = titleCandidate.replace(/^[#*\s-]+|[#*\s-]+$/g, "");
  }

  // 2. Referencing Style
  const refStyles = ["APA", "Harvard", "MLA", "Chicago", "IEEE", "Vancouver"];
  for (const style of refStyles) {
    const regex = new RegExp(`\\b${style}\\b`, "i");
    if (regex.test(rawText)) {
      fields.referencingStyle = style;
      break;
    }
  }

  // 3. Word Count
  const wordCountMatch =
    rawText.match(/\b(?:word\s*count|word\s*limit|limit)?\s*[:\-]?\s*([0-9,]{3,6})\s*words?\b/i) ||
    rawText.match(/\bwords?\s*(?:count|limit)?\s*[:\-]?\s*([0-9,]{3,6})\b/i);
  if (wordCountMatch) {
    const val = parseInt(wordCountMatch[1].replace(/,/g, ""), 10);
    if (!isNaN(val) && val >= 100 && val <= 50000) {
      fields.wordCount = val;
    }
  }

  // 4. Deadline
  const deadlineMatch = rawText.match(/\b(?:deadline|due\s+date|due|by)\b\s*[:\-]?\s*([^\n\r]+)/i);
  if (deadlineMatch) {
    const parsedDate = parseDateToYMD(deadlineMatch[1]);
    if (parsedDate) {
      fields.deadline = parsedDate;
    }
  }
  if (!fields.deadline) {
    const anyDateMatch = rawText.match(
      /\b(\d{1,2})(st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})\b/i
    );
    if (anyDateMatch) {
      const parsedDate = parseDateToYMD(anyDateMatch[0]);
      if (parsedDate) {
        fields.deadline = parsedDate;
      }
    }
  }

  // 5. Academic Level
  const academicLevels: Array<[RegExp, string]> = [
    [/\b(?:phd|doctorate|doctoral)\b/i, "phd"],
    [/\b(?:master['’]?s?|postgraduate|msc|mba|ma)\b/i, "masters"],
    [/\b(?:undergraduate|bachelor['’]?s?|bsc|ba)\b/i, "degree"],
    [/\b(?:diploma|higher\s+national\s+diploma|hnd)\b/i, "diploma"],
    [/\b(?:high\s+school|secondary\s+school)\b/i, "high_school"],
  ];
  for (const [regex, level] of academicLevels) {
    if (regex.test(rawText)) {
      fields.academicLevel = level;
      break;
    }
  }

  // 6. Guidelines / Brief Extraction
  const sectionRegex = /\b(?:instructions|assignment\s+tasks|assignment\s+questions?|requirements|brief|prompt|case\s+study)\b/i;
  const secMatch = rawText.match(sectionRegex);
  if (secMatch && secMatch.index !== undefined) {
    fields.guidelines = rawText.substring(secMatch.index).trim();
    fields.instructions = fields.guidelines;
    fields.questions = fields.guidelines;
  } else {
    fields.guidelines = rawText.trim();
    fields.instructions = rawText.trim();
    fields.questions = rawText.trim();
  }

  return fields;
}

/**
 * Invokes Gemini 2.5 Flash for multimodal document understanding (Images & Scanned PDFs)
 */
async function callGeminiMultimodal(params: {
  fileBuffer: Buffer;
  mimeType: string;
  apiKey: string;
}): Promise<{
  rawText: string;
  parsedFields: ParsedAssignmentFields;
  confidence: "high" | "medium" | "low";
  modelUsed: string;
  tokenUsage?: { promptTokens: number; completionTokens: number };
  costEstimate?: number;
}> {
  const { fileBuffer, mimeType, apiKey } = params;
  const base64Data = fileBuffer.toString("base64");
  const modelName = "gemini-2.5-flash";

  const prompt = `You are an expert academic evaluator parsing a university assignment brief.
Extract:
- Assignment title
- Assignment questions (verbatim, preserve question numbering, bullet points, sub-sections, and line breaks)
- Assignment instructions (verbatim instructions, guidelines, word limit, referencing constraints, preserve line breaks)
- Word count (numerical estimation if stated, e.g., 2000)
- Referencing style (e.g. APA, Harvard, MLA, Chicago, IEEE, Vancouver, or Other)
- Deadline (if stated, parse to YYYY-MM-DD format)
- Academic level (if stated, e.g. undergraduate, postgraduate, phd)

Preserve the complete assignment brief and task structures. Do not summarize or synthesize.
Also transcribe the complete, raw extracted text from the document.
Return structured JSON only.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(
    apiKey
  )}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: prompt },
          {
            inlineData: {
              mimeType,
              data: base64Data,
            },
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: {
        type: "object",
        properties: {
          title: { type: "string", description: "The title of the assignment" },
          questions: { type: "string", description: "Verbatim list of assignment questions or tasks" },
          instructions: { type: "string", description: "Verbatim instructions, requirements, guidelines" },
          wordCount: { type: "integer", description: "Numerical word count limit or target" },
          referencingStyle: { type: "string", description: "Referencing style naming" },
          deadline: { type: "string", description: "Parsed deadline in YYYY-MM-DD format" },
          academicLevel: { type: "string", description: "Academic level if mentioned" },
          rawText: { type: "string", description: "Verbatim transcription of all readable text" },
        },
        required: ["questions", "instructions", "rawText"],
      },
    },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (HTTP ${response.status}): ${errorText.slice(0, 300)}`);
  }

  const json: any = await response.json();
  const candidate = json.candidates?.[0];
  const responseText = candidate?.content?.parts?.[0]?.text;

  if (!responseText) {
    throw new Error("Gemini returned empty candidate content");
  }

  let parsed: any;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new Error("Failed to parse Gemini output as structured JSON");
  }

  const promptTokens = json.usageMetadata?.promptTokenCount || 0;
  const completionTokens = json.usageMetadata?.candidatesTokenCount || 0;
  const costEstimate = promptTokens * 0.075e-6 + completionTokens * 0.3e-6;

  const rawText = parsed.rawText || "";
  const parsedFields: ParsedAssignmentFields = {
    title: parsed.title || undefined,
    questions: parsed.questions || undefined,
    instructions: parsed.instructions || undefined,
    guidelines: parsed.questions || parsed.instructions || undefined,
    wordCount: typeof parsed.wordCount === "number" ? parsed.wordCount : undefined,
    referencingStyle: parsed.referencingStyle || undefined,
    deadline: parsed.deadline || undefined,
    academicLevel: parsed.academicLevel || undefined,
  };

  const confidence: "high" | "medium" | "low" = rawText.length > 150 ? "high" : rawText.length > 50 ? "medium" : "low";

  return {
    rawText,
    parsedFields,
    confidence,
    modelUsed: modelName,
    tokenUsage: { promptTokens, completionTokens },
    costEstimate: parseFloat(costEstimate.toFixed(7)),
  };
}

/**
 * Extracts raw text from text-based PDF buffers without external binaries
 */
function extractTextFromPdfBuffer(buffer: Buffer): string {
  const content = buffer.toString("latin1");
  const textChunks: string[] = [];

  // Match text objects enclosed in BT ... ET blocks
  const btBlocks = content.match(/BT[\s\S]*?ET/g) || [];
  for (const block of btBlocks) {
    // Match strings inside parentheses (Text) Tj or [...] TJ
    const tjMatches = block.match(/\((.*?)\)\s*Tj/g) || [];
    for (const tj of tjMatches) {
      const match = tj.match(/\((.*?)\)\s*Tj/);
      if (match && match[1]) {
        textChunks.push(match[1]);
      }
    }

    const tjArrayMatches = block.match(/\[(.*?)\]\s*TJ/g) || [];
    for (const tja of tjArrayMatches) {
      const strings = tja.match(/\((.*?)\)/g) || [];
      for (const s of strings) {
        textChunks.push(s.slice(1, -1));
      }
    }
  }

  return textChunks.join(" ").replace(/\\([()\\])/g, "$1").trim();
}

export const ocrProcessingService = {
  async processFile(params: {
    fileId: string;
    storageKey: string;
    contentType: string;
    fileName: string;
    userUid: string;
  }): Promise<OCRProcessingResult> {
    const { fileId, storageKey, contentType, fileName, userUid } = params;
    const startTime = Date.now();
    const ext = fileName.split(".").pop()?.toLowerCase() || "";
    const isImage = ["png", "jpg", "jpeg", "webp"].includes(ext) || contentType.startsWith("image/");
    const isPdf = ext === "pdf" || contentType === "application/pdf";
    const isDocx = ext === "docx" || ext === "doc" || contentType.includes("wordprocessingml");

    // Fetch authoritative buffer directly from R2
    const fileBuffer = await r2StorageService.getObjectBuffer(storageKey);
    const geminiApiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";

    let rawText = "";
    let parsedFields: ParsedAssignmentFields = {};
    let confidence: "high" | "medium" | "low" = "medium";
    let extractionMethod = "backend_parser";
    let modelUsed: string | undefined;
    let tokenUsage: { promptTokens: number; completionTokens: number } | undefined;
    let requestCostEstimate: number | undefined;

    // 1. If Gemini API key is configured and file is multimodal (Image or PDF)
    if (geminiApiKey && (isImage || isPdf)) {
      try {
        const mime = isImage
          ? ext === "png"
            ? "image/png"
            : ext === "webp"
            ? "image/webp"
            : "image/jpeg"
          : "application/pdf";

        const geminiRes = await callGeminiMultimodal({
          fileBuffer,
          mimeType: mime,
          apiKey: geminiApiKey,
        });

        rawText = geminiRes.rawText;
        parsedFields = geminiRes.parsedFields;
        confidence = geminiRes.confidence;
        extractionMethod = isImage ? "gemini_image" : "gemini_pdf";
        modelUsed = geminiRes.modelUsed;
        tokenUsage = geminiRes.tokenUsage;
        requestCostEstimate = geminiRes.costEstimate;
      } catch (err: any) {
        console.warn(`[OCR] Gemini multimodal processing failed, falling back to local extraction: ${err?.message || err}`);
      }
    }

    // 2. Fallback text extraction if rawText is still empty
    if (!rawText.trim()) {
      if (isPdf) {
        rawText = extractTextFromPdfBuffer(fileBuffer);
        extractionMethod = rawText.length > 50 ? "pdf_stream_direct" : "scanned_pdf_pending";
      } else if (isDocx) {
        // Simple text recovery from docx xml stream
        const rawContent = fileBuffer.toString("utf8");
        const matches = rawContent.match(/<w:t[^>]*>(.*?)<\/w:t>/g) || [];
        rawText = matches.map((m) => m.replace(/<[^>]+>/g, "")).join(" ");
        extractionMethod = "docx_direct";
      } else if (isImage) {
        extractionMethod = "image_ocr_ready";
      }

      parsedFields = parseTextToAssignmentFields(rawText);
      confidence = rawText.length > 100 ? "high" : rawText.length > 20 ? "medium" : "low";
    }

    const durationMs = Date.now() - startTime;
    const completenessScore =
      (parsedFields.title ? 20 : 0) +
      (parsedFields.guidelines || parsedFields.questions ? 30 : 0) +
      (parsedFields.wordCount ? 20 : 0) +
      (parsedFields.referencingStyle ? 15 : 0) +
      (parsedFields.deadline ? 15 : 0);

    const ocrMetrics: OCRMetrics = {
      fileType: ext.toUpperCase(),
      extractionMethod,
      status: "Success",
      durationMs,
      confidenceScore: confidence === "high" ? 100 : confidence === "medium" ? 70 : 40,
      completenessScore,
      modelUsed,
      tokenUsage,
      requestCostEstimate,
    };

    const result: OCRProcessingResult = {
      rawText,
      parsedFields,
      confidence,
      ocrMetrics,
    };

    // Update Firestore records for persistent tracking and audit history
    try {
      const nowIso = new Date().toISOString();
      await adminDb.collection("fileObjects").doc(fileId).set(
        {
          ocrStatus: "completed",
          ocrProcessedAt: nowIso,
          ocrConfidence: confidence,
          ocrExtractionMethod: extractionMethod,
          rawTextLength: rawText.length,
          rawTextPreview: rawText.slice(0, 500),
          updatedAt: nowIso,
        },
        { merge: true }
      );

      // Record in ocrJobs collection for historical dashboard & audit queries
      await adminDb.collection("ocrJobs").doc(`job_${fileId}`).set(
        {
          jobId: `job_${fileId}`,
          fileId,
          customerId: userUid,
          storageKey,
          status: "completed",
          rawText,
          parsedFields,
          confidenceLevel: confidence,
          ocrMetrics,
          updatedAt: nowIso,
          createdAt: nowIso,
        },
        { merge: true }
      );
    } catch (auditErr) {
      console.warn("[OCR] Non-blocking error updating fileObject/ocrJob records:", auditErr);
    }

    return result;
  },
};
