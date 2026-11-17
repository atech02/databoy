import { adminDb } from "../config/firebaseAdmin.js";
import { r2StorageService } from "./r2StorageService.js";
import { AIOrchestrationService } from "./ai/AIOrchestrationService.js";
const MONTHS = {
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
export function parseDateToYMD(text) {
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
const SUBJECT_KEYWORDS = {
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
export function detectLanguageFromText(text) {
    if (!text || text.trim().length === 0)
        return "English";
    const lower = text.toLowerCase();
    const frMarkers = [" le ", " la ", " les ", " des ", " est ", " dans ", " pour ", " avec ", " une ", " sur "];
    const esMarkers = [" el ", " la ", " los ", " las ", " por ", " para ", " con ", " una ", " en ", " del "];
    const ptMarkers = [" o ", " a ", " os ", " as ", " do ", " da ", " em ", " para ", " com ", " um "];
    const deMarkers = [" der ", " die ", " das ", " und ", " ist ", " in ", " für ", " mit ", " auf "];
    const frCount = frMarkers.filter((m) => lower.includes(m)).length;
    const esCount = esMarkers.filter((m) => lower.includes(m)).length;
    const ptCount = ptMarkers.filter((m) => lower.includes(m)).length;
    const deCount = deMarkers.filter((m) => lower.includes(m)).length;
    if (frCount >= 4)
        return "French";
    if (esCount >= 4)
        return "Spanish";
    if (ptCount >= 4)
        return "Portuguese";
    if (deCount >= 4)
        return "German";
    return "English";
}
export function parseTextToAssignmentFields(rawText) {
    const fields = {};
    if (!rawText || !rawText.trim())
        return fields;
    const lines = rawText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const detectedLang = detectLanguageFromText(rawText);
    fields.language = detectedLang;
    const reviewFields = [];
    // 1. Title detection with contextual signals
    const explicitTitleMatch = rawText.match(/\b(?:assignment\s+title|coursework\s+title|essay\s+title|topic|title)\s*[:\-]\s*([^\r\n]+)/i);
    if (explicitTitleMatch && explicitTitleMatch[1]?.trim().length >= 3) {
        const candidate = explicitTitleMatch[1].trim().replace(/^[#*\s-]+|[#*\s-]+$/g, "");
        if (candidate.length <= 250) {
            fields.assignment_title = candidate;
            fields.title = candidate;
        }
    }
    if (!fields.title) {
        const titleSkipWords = [
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
            "student", "candidate", "matric", "semester", "academic year"
        ];
        const questionNumberingRegex = /^(\d+[\.\)]|[a-z][\.\)]|q\d+|task\s*\d+|part\s*[a-z\d]+)/i;
        const headerRegex = /\b(?:university|faculty|department|school\s+of|college|student\s+name|student\s+id|candidate\s+no|coursework\s+1|assignment\s+\d+)\b/i;
        const titleCandidate = lines.find((line) => {
            if (line.length < 5 || line.length > 90)
                return false;
            if (line.endsWith("?"))
                return false;
            if (questionNumberingRegex.test(line))
                return false;
            if (headerRegex.test(line))
                return false;
            const lower = line.toLowerCase();
            const firstWord = lower.split(/[\s:,\.\-]+/)[0];
            return !titleSkipWords.includes(firstWord) && !titleSkipWords.some((kw) => lower.startsWith(kw) || lower.includes("deadline:"));
        });
        if (titleCandidate) {
            const clean = titleCandidate.replace(/^[#*\s-]+|[#*\s-]+$/g, "");
            fields.assignment_title = clean;
            fields.title = clean;
        }
        else {
            fields.assignment_title = null;
            fields.title = null;
            reviewFields.push("assignment_title");
        }
    }
    // 2. Referencing Style
    const refStyles = ["APA", "Harvard", "MLA", "Chicago", "IEEE", "Vancouver"];
    for (const style of refStyles) {
        const regex = new RegExp(`\\b${style}\\b`, "i");
        if (regex.test(rawText)) {
            fields.referencing_style = style;
            fields.referencingStyle = style;
            break;
        }
    }
    if (!fields.referencing_style) {
        fields.referencing_style = null;
        fields.referencingStyle = null;
        reviewFields.push("referencing_style");
    }
    // 3. Word Count
    const wordCountMatch = rawText.match(/\b(?:word\s*count|word\s*limit|limit)?\s*[:\-]?\s*([0-9,]{3,6})\s*words?\b/i) ||
        rawText.match(/\bwords?\s*(?:count|limit)?\s*[:\-]?\s*([0-9,]{3,6})\b/i);
    if (wordCountMatch) {
        const val = parseInt(wordCountMatch[1].replace(/,/g, ""), 10);
        if (!isNaN(val) && val >= 100 && val <= 50000) {
            fields.word_count = val;
            fields.wordCount = val;
        }
    }
    // 4. Deadline
    const deadlineMatch = rawText.match(/\b(?:deadline|due\s+date|due|by|final\s+submission|submission\s+deadline|submission)\b\s*[:\-]?\s*([^\n\r]+)/i);
    if (deadlineMatch) {
        const parsedDate = parseDateToYMD(deadlineMatch[1]);
        if (parsedDate) {
            fields.submission_deadline = parsedDate;
            fields.deadline = parsedDate;
        }
    }
    if (!fields.deadline) {
        const anyDateMatch = rawText.match(/\b(\d{1,2})(st|nd|rd|th)?\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{4})\b/i);
        if (anyDateMatch) {
            const parsedDate = parseDateToYMD(anyDateMatch[0]);
            if (parsedDate) {
                fields.submission_deadline = parsedDate;
                fields.deadline = parsedDate;
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
            }
        }
    }
    if (!fields.deadline) {
        fields.submission_deadline = null;
        fields.deadline = null;
        reviewFields.push("submission_deadline");
    }
    // 5. Academic Level
    const academicLevels = [
        [/\b(?:phd|doctorate|doctoral)\b/i, "phd"],
        [/\b(?:master['’]?s?|postgraduate|msc|mba|ma|llm)\b/i, "masters"],
        [/\b(?:undergraduate|bachelor['’]?s?|bsc|ba|degree)\b/i, "degree"],
        [/\b(?:diploma|higher\s+national\s+diploma|hnd)\b/i, "diploma"],
        [/\b(?:high\s+school|secondary\s+school)\b/i, "high_school"],
    ];
    for (const [regex, level] of academicLevels) {
        if (regex.test(rawText)) {
            fields.academic_level = level;
            fields.academicLevel = level;
            break;
        }
    }
    if (!fields.academic_level) {
        fields.academic_level = null;
        fields.academicLevel = null;
        reviewFields.push("academic_level");
    }
    // 6. Subject or Discipline Identification
    const lowerText = rawText.toLowerCase();
    let detectedSubject = null;
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
    }
    else {
        fields.subject_or_discipline = null;
        reviewFields.push("subject_or_discipline");
    }
    // 7. Page budget extraction:
    // Strict check: distinguish "Page 10" from "Write 10 pages" or "10 pages required"
    const requestedPagesMatch = rawText.match(/\b(?:write|prepare|length|submit|maximum|up\s+to|at\s+least)?\s*([1-9]\d?)\s*pages?\b/i);
    // Negative check to exclude "page 10" or "pages 10-15"
    const isPageNumber = /\bpage\s+[1-9]\d?\b/i.test(requestedPagesMatch?.[0] || "");
    const isPageRange = /\bpages?\s+[1-9]\d?\s*[-–]\s*[1-9]\d?\b/i.test(rawText);
    if (requestedPagesMatch && !isPageNumber && !isPageRange) {
        const pagesVal = parseInt(requestedPagesMatch[1], 10);
        if (!isNaN(pagesVal) && pagesVal >= 1 && pagesVal <= 100) {
            fields.requested_page_count = pagesVal;
            fields.pageCount = pagesVal;
        }
    }
    else if (fields.word_count) {
        fields.requested_page_count = Math.max(1, Math.ceil(fields.word_count / 250));
        fields.pageCount = fields.requested_page_count;
    }
    else {
        fields.requested_page_count = null;
        reviewFields.push("requested_page_count");
    }
    // 8. Guidelines / Brief Extraction
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
    const secMatch = rawText.match(sectionRegex);
    if (secMatch && secMatch.index !== undefined) {
        matchIdx = secMatch.index;
    }
    else {
        const mMatch = rawText.match(markersRegex);
        if (mMatch && mMatch.index !== undefined) {
            matchIdx = mMatch.index;
        }
        else {
            const vMatch = rawText.match(verbsRegex);
            if (vMatch && vMatch.index !== undefined) {
                matchIdx = vMatch.index;
            }
        }
    }
    if (matchIdx !== -1) {
        const extracted = rawText.substring(matchIdx).trim();
        fields.assignment_brief = extracted;
        fields.guidelines = extracted;
        fields.instructions = extracted;
        fields.questions = extracted;
    }
    else {
        fields.assignment_brief = null;
        reviewFields.push("assignment_brief");
    }
    fields.fields_requiring_review = reviewFields;
    fields.extraction_confidence = reviewFields.length <= 1 && fields.title ? "high" : reviewFields.length <= 3 ? "medium" : "low";
    return fields;
}
/**
 * Invokes Gemini 2.5 Flash for multimodal document understanding (Images & Scanned PDFs)
 */
async function callGeminiMultimodal(params) {
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
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;
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
    const json = await response.json();
    const candidate = json.candidates?.[0];
    const responseText = candidate?.content?.parts?.[0]?.text;
    if (!responseText) {
        throw new Error("Gemini returned empty candidate content");
    }
    let parsed;
    try {
        parsed = JSON.parse(responseText);
    }
    catch {
        throw new Error("Failed to parse Gemini output as structured JSON");
    }
    const promptTokens = json.usageMetadata?.promptTokenCount || 0;
    const completionTokens = json.usageMetadata?.candidatesTokenCount || 0;
    const costEstimate = promptTokens * 0.075e-6 + completionTokens * 0.3e-6;
    const rawText = parsed.rawText || "";
    const parsedFields = {
        title: parsed.title || undefined,
        questions: parsed.questions || undefined,
        instructions: parsed.instructions || undefined,
        guidelines: parsed.questions || parsed.instructions || undefined,
        wordCount: typeof parsed.wordCount === "number" ? parsed.wordCount : undefined,
        referencingStyle: parsed.referencingStyle || undefined,
        deadline: parsed.deadline || undefined,
        academicLevel: parsed.academicLevel || undefined,
    };
    const confidence = rawText.length > 150 ? "high" : rawText.length > 50 ? "medium" : "low";
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
function extractTextFromPdfBuffer(buffer) {
    const content = buffer.toString("latin1");
    const textChunks = [];
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
    async processFile(params) {
        const { fileId, storageKey, contentType, fileName, userUid, clientRawText } = params;
        const startTime = Date.now();
        const ext = fileName.split(".").pop()?.toLowerCase() || "";
        const isImage = ["png", "jpg", "jpeg", "webp"].includes(ext) || contentType.startsWith("image/");
        const isPdf = ext === "pdf" || contentType === "application/pdf";
        const isDocx = ext === "docx" || ext === "doc" || contentType.includes("wordprocessingml");
        let rawText = clientRawText?.trim() || "";
        let fileBuffer = null;
        // 1. If client did not provide rawText, fetch buffer from R2
        if (!rawText && storageKey) {
            try {
                fileBuffer = await r2StorageService.getObjectBuffer(storageKey);
            }
            catch (r2Err) {
                console.warn(`[OCR] Failed to fetch R2 buffer for ${storageKey}:`, r2Err);
            }
        }
        // 2. Perform local buffer extraction if rawText is still empty
        if (!rawText && fileBuffer) {
            if (isPdf) {
                rawText = extractTextFromPdfBuffer(fileBuffer);
            }
            else if (isDocx) {
                const rawContent = fileBuffer.toString("utf8");
                const matches = rawContent.match(/<w:t[^>]*>(.*?)<\/w:t>/g) || [];
                rawText = matches.map((m) => m.replace(/<[^>]+>/g, "")).join(" ");
            }
        }
        let extractionMethod = rawText.length > 50 ? (clientRawText ? "client_stage1_ocr" : "backend_direct_stream") : "pending";
        let parsedFields = {};
        let confidence = "medium";
        let modelUsed;
        let tokenUsage;
        let requestCostEstimate;
        // 3. Delegate structured understanding to AIOrchestrationService
        try {
            const multimodalBuffer = !rawText && fileBuffer && (isImage || isPdf) ? {
                mimeType: isImage ? (ext === "png" ? "image/png" : "image/jpeg") : "application/pdf",
                buffer: fileBuffer,
            } : undefined;
            const targetType = storageKey ? storageKey.split("/")[0] : "assignment";
            const orchestration = await AIOrchestrationService.processAssignmentUnderstanding({
                rawText,
                userUid,
                fileId,
                targetType,
                multimodalBuffer,
                forceAI: true,
            });
            parsedFields = orchestration.parsedFields;
            confidence = orchestration.confidence;
            extractionMethod = orchestration.strategyUsed;
            modelUsed = orchestration.modelUsed;
            tokenUsage = orchestration.tokenUsage ? {
                promptTokens: orchestration.tokenUsage.promptTokens,
                completionTokens: orchestration.tokenUsage.completionTokens,
            } : undefined;
            requestCostEstimate = 0; // Free-tier optimization
        }
        catch (aiErr) {
            console.warn("[OCR] AI Orchestration fallback to rule parser:", aiErr);
            parsedFields = parseTextToAssignmentFields(rawText);
            confidence = rawText.length > 100 ? "high" : rawText.length > 20 ? "medium" : "low";
            extractionMethod = "local_rules_fallback";
        }
        const durationMs = Date.now() - startTime;
        const completenessScore = (parsedFields.title ? 20 : 0) +
            (parsedFields.guidelines || parsedFields.questions ? 30 : 0) +
            (parsedFields.wordCount ? 20 : 0) +
            (parsedFields.referencingStyle ? 15 : 0) +
            (parsedFields.deadline ? 15 : 0);
        const ocrMetrics = {
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
        const result = {
            rawText,
            parsedFields,
            confidence,
            ocrMetrics,
        };
        // Update Firestore records for persistent tracking and audit history
        try {
            const nowIso = new Date().toISOString();
            await adminDb.collection("fileObjects").doc(fileId).set({
                ocrStatus: "completed",
                ocrProcessedAt: nowIso,
                ocrConfidence: confidence,
                ocrExtractionMethod: extractionMethod,
                rawTextLength: rawText.length,
                rawTextPreview: rawText.slice(0, 500),
                updatedAt: nowIso,
            }, { merge: true });
            // Record in ocrJobs collection for historical dashboard & audit queries
            await adminDb.collection("ocrJobs").doc(`job_${fileId}`).set({
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
            }, { merge: true });
        }
        catch (auditErr) {
            console.warn("[OCR] Non-blocking error updating fileObject/ocrJob records:", auditErr);
        }
        return result;
    },
};
