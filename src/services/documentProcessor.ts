import JSZip from "jszip";

// Processing & Safety Limits
export const DIGITAL_PDF_MAX_PAGES = 50;
export const SCANNED_PDF_MAX_PAGES = 5;

// Engine & Model Versions for Deterministic Cache Invalidation
export const TESSERACT_VERSION = "5.1.0";
export const PDFJS_VERSION = "3.11.174";
export const JSZIP_VERSION = "3.10.1";
export const OCR_DEFAULT_LANG = "eng+fra";

// Canonical Preprocessing Configuration
export const PREPROCESSING_CONFIG = {
  minWidth: 800,
  contrastBoost: 35,
  binarizeThreshold: 128,
  grayscale: true,
  blendAlphaWithWhite: true,
} as const;

// Canonical PDF Viewport Rendering Settings
export const PDF_RENDER_CONFIG = {
  scale: 1.5,
  intent: "display",
} as const;

export interface ExtractionProgress {
  status: string;
  progressPercent: number;
  currentPage?: number;
  totalPages?: number;
}

export interface PageExtractionResult {
  pageNumber: number;
  text: string;
  confidence: number;
  method: string;
  charCount: number;
  isScanned: boolean;
}

export interface ExtractionResult {
  rawText: string;
  confidence: number; // 0 to 100
  method: string;
  pageCount: number;
  processedPages: number;
  hasUnprocessedPages: boolean;
  unprocessedReason?: string;
  pageResults: PageExtractionResult[];
  cacheKey: string;
  engineVersion: string;
  warnings: string[];
  isPartial: boolean;
}

export interface ExtractionOptions {
  signal?: AbortSignal;
  resumablePages?: Map<number, PageExtractionResult>;
  onPageComplete?: (page: PageExtractionResult) => void;
}

export interface DocumentExtractor {
  extractText(
    file: File,
    onProgress: (progress: ExtractionProgress) => void,
    options?: ExtractionOptions
  ): Promise<ExtractionResult>;
}

/**
 * Computes a SHA-256 hexadecimal hash string for ArrayBuffer or Buffer data.
 * Works seamlessly in modern browsers via crypto.subtle and Node.js environments.
 */
export async function computeSha256Hex(data: ArrayBuffer | ArrayBufferView): Promise<string> {
  const buffer = ArrayBuffer.isView(data)
    ? (data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer)
    : (data as ArrayBuffer);

  if (typeof crypto !== "undefined" && crypto.subtle) {
    const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Fallback for Node.js test environments
  try {
    const nodeCrypto = await import("crypto");
    return nodeCrypto.createHash("sha256").update(Buffer.from(buffer)).digest("hex");
  } catch {
    // Ultra-fallback if subtle and node:crypto are unavailable
    let hash = 0;
    const view = new Uint8Array(buffer);
    for (let i = 0; i < view.length; i++) {
      hash = (hash << 5) - hash + view[i];
      hash |= 0;
    }
    return `fallback_${Math.abs(hash).toString(16)}`;
  }
}

/**
 * Builds a deterministic cache key binding:
 * - Content SHA-256
 * - Engine & Dependency Versions
 * - Language code
 * - Preprocessing parameters
 * - PDF Rendering parameters
 */
export async function buildDeterministicCacheKey(params: {
  fileBuffer: ArrayBuffer | ArrayBufferView;
  fileType: string;
  engineVersion: string;
  language?: string;
  preprocessing?: Record<string, any>;
  rendering?: Record<string, any>;
}): Promise<string> {
  const contentSha256 = await computeSha256Hex(params.fileBuffer);
  const descriptor = JSON.stringify({
    fileSha256: contentSha256,
    fileType: params.fileType,
    engineVersion: params.engineVersion,
    language: params.language || OCR_DEFAULT_LANG,
    preprocessing: params.preprocessing || PREPROCESSING_CONFIG,
    rendering: params.rendering || PDF_RENDER_CONFIG,
  });

  const encoder = new TextEncoder();
  const descSha = await computeSha256Hex(encoder.encode(descriptor));
  return `ocr_${params.fileType}_${contentSha256.substring(0, 16)}_${descSha.substring(0, 16)}`;
}

/**
 * Safely clears canvas pixel memory and resets dimensions to 0 to prevent memory leaks in long sessions.
 */
export function cleanupCanvas(canvas: HTMLCanvasElement | null): void {
  if (!canvas) return;
  try {
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }
    canvas.width = 0;
    canvas.height = 0;
  } catch {
    // Canvas already detached
  }
}

/**
 * Detects whether image content is sideways (90 or 270 degrees rotated)
 * by analyzing row-wise vs column-wise variance of dark pixel projections.
 * In horizontal text, row variance is high (lines of text alternate with white margins).
 * In rotated vertical text, column variance is higher than row variance.
 */
export function correctCanvasOrientation(canvas: HTMLCanvasElement): HTMLCanvasElement {
  if (typeof document === "undefined") return canvas;
  const ctx = canvas.getContext("2d");
  if (!ctx || canvas.width === 0 || canvas.height === 0) return canvas;

  try {
    const w = canvas.width;
    const h = canvas.height;
    if (w < 100 || h < 100) return canvas;

    const sampleW = Math.min(w, 400);
    const sampleH = Math.min(h, 400);
    const startX = Math.floor((w - sampleW) / 2);
    const startY = Math.floor((h - sampleH) / 2);

    const imgData = ctx.getImageData(startX, startY, sampleW, sampleH);
    const data = imgData.data;

    const rowSums = new Float64Array(sampleH);
    const colSums = new Float64Array(sampleW);

    for (let y = 0; y < sampleH; y++) {
      for (let x = 0; x < sampleW; x++) {
        const idx = (y * sampleW + x) * 4;
        const gray = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
        const dark = 255 - gray;
        rowSums[y] += dark;
        colSums[x] += dark;
      }
    }

    const calcVar = (arr: Float64Array) => {
      let sum = 0;
      for (let i = 0; i < arr.length; i++) sum += arr[i];
      const mean = sum / arr.length;
      let v = 0;
      for (let i = 0; i < arr.length; i++) {
        const diff = arr[i] - mean;
        v += diff * diff;
      }
      return v / arr.length;
    };

    const rowVar = calcVar(rowSums);
    const colVar = calcVar(colSums);

    // If column variance is significantly higher than row variance (> 1.35x),
    // text lines run vertically, meaning the document is sideways.
    if (colVar > rowVar * 1.35 && colVar > 1000) {
      const rotated = document.createElement("canvas");
      rotated.width = h;
      rotated.height = w;
      const rotCtx = rotated.getContext("2d");
      if (rotCtx) {
        rotCtx.translate(h / 2, w / 2);
        rotCtx.rotate((90 * Math.PI) / 180);
        rotCtx.drawImage(canvas, -w / 2, -h / 2);
        return rotated;
      }
    }
  } catch (err) {
    console.warn("[DocumentProcessor] Orientation check warning:", err);
  }

  return canvas;
}

/**
 * Deskews canvas by small angles (-4° to +4°) by finding the rotation angle
 * that maximizes horizontal projection profile sharpness.
 */
export function deskewCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
  if (typeof document === "undefined") return canvas;
  const ctx = canvas.getContext("2d");
  if (!ctx || canvas.width === 0 || canvas.height === 0) return canvas;

  try {
    const w = canvas.width;
    const h = canvas.height;
    if (w < 200 || h < 200) return canvas;

    const sampleH = Math.min(h, 240);
    const sampleW = Math.min(w, 240);
    const startX = Math.floor((w - sampleW) / 2);
    const startY = Math.floor((h - sampleH) / 2);

    const testAngles = [-4, -2, 2, 4];
    let bestAngle = 0;

    const baseData = ctx.getImageData(startX, startY, sampleW, sampleH).data;
    const baseRows = new Float64Array(sampleH);
    for (let y = 0; y < sampleH; y++) {
      for (let x = 0; x < sampleW; x++) {
        const idx = (y * sampleW + x) * 4;
        baseRows[y] += 255 - (0.299 * baseData[idx] + 0.587 * baseData[idx + 1] + 0.114 * baseData[idx + 2]);
      }
    }
    let sum0 = 0;
    for (let y = 0; y < sampleH; y++) sum0 += baseRows[y];
    const mean0 = sum0 / sampleH;
    let var0 = 0;
    for (let y = 0; y < sampleH; y++) var0 += (baseRows[y] - mean0) ** 2;
    let maxVariance = var0;

    for (const deg of testAngles) {
      const rad = (deg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const testRows = new Float64Array(sampleH);
      for (let y = 0; y < sampleH; y++) {
        for (let x = 0; x < sampleW; x++) {
          const origX = Math.floor(startX + (x - sampleW / 2) * cos - (y - sampleH / 2) * sin + sampleW / 2);
          const origY = Math.floor(startY + (x - sampleW / 2) * sin + (y - sampleH / 2) * cos + sampleH / 2);
          if (origX >= 0 && origX < w && origY >= 0 && origY < h) {
            const idx = (origY * w + origX) * 4;
            testRows[y] += 255 - (0.299 * baseData[idx] + 0.587 * baseData[idx + 1] + 0.114 * baseData[idx + 2]);
          }
        }
      }
      let sumA = 0;
      for (let y = 0; y < sampleH; y++) sumA += testRows[y];
      const meanA = sumA / sampleH;
      let varA = 0;
      for (let y = 0; y < sampleH; y++) varA += (testRows[y] - meanA) ** 2;

      if (varA > maxVariance * 1.15) {
        maxVariance = varA;
        bestAngle = deg;
      }
    }

    if (bestAngle !== 0) {
      const deskewed = document.createElement("canvas");
      deskewed.width = w;
      deskewed.height = h;
      const dCtx = deskewed.getContext("2d");
      if (dCtx) {
        dCtx.translate(w / 2, h / 2);
        dCtx.rotate((bestAngle * Math.PI) / 180);
        dCtx.drawImage(canvas, -w / 2, -h / 2);
        return deskewed;
      }
    }
  } catch (err) {
    console.warn("[DocumentProcessor] Deskew warning:", err);
  }

  return canvas;
}

/**
 * Preprocesses canvas client-side:
 * 1. Upscales small images (minimum 800px width).
 * 2. Blends alpha/transparency over solid white.
 * 3. Converts to high-contrast grayscale.
 * 4. Applies noise reduction and soft adaptive thresholding, preserving anti-aliased font stroke margins.
 * 5. Corrects orientation and deskews document alignment.
 */
export function preprocessCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
  if (typeof document === "undefined") return canvas;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const width = canvas.width;
  const height = canvas.height;
  let targetCanvas = canvas;

  // 1. Resize very small images (min width 800px)
  if (width > 0 && width < PREPROCESSING_CONFIG.minWidth) {
    const ratio = PREPROCESSING_CONFIG.minWidth / width;
    const targetWidth = PREPROCESSING_CONFIG.minWidth;
    const targetHeight = Math.round(height * ratio);

    const resizeCanvas = document.createElement("canvas");
    resizeCanvas.width = targetWidth;
    resizeCanvas.height = targetHeight;
    const resizeCtx = resizeCanvas.getContext("2d");
    if (resizeCtx) {
      resizeCtx.imageSmoothingEnabled = true;
      resizeCtx.imageSmoothingQuality = "high";
      resizeCtx.drawImage(canvas, 0, 0, targetWidth, targetHeight);
      targetCanvas = resizeCanvas;
    }
  }

  const finalCtx = targetCanvas.getContext("2d");
  if (!finalCtx || targetCanvas.width === 0 || targetCanvas.height === 0) return targetCanvas;

  try {
    const imgData = finalCtx.getImageData(0, 0, targetCanvas.width, targetCanvas.height);
    const data = imgData.data;

    // Contrast boost factor
    const contrast = PREPROCESSING_CONFIG.contrastBoost;
    const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));
    const threshold = PREPROCESSING_CONFIG.binarizeThreshold;

    for (let i = 0; i < data.length; i += 4) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];
      const a = data[i + 3];

      // Remove transparency by blending with white background
      if (a < 255) {
        const alpha = a / 255;
        r = Math.round(r * alpha + 255 * (1 - alpha));
        g = Math.round(g * alpha + 255 * (1 - alpha));
        b = Math.round(b * alpha + 255 * (1 - alpha));
      }

      // Grayscale conversion using ITU-R BT.601 luma weights
      let gray = 0.299 * r + 0.587 * g + 0.114 * b;

      // Contrast scaling
      gray = factor * (gray - 128) + 128;
      gray = Math.max(0, Math.min(255, gray));

      // Adaptive thresholding: Preserve anti-aliased font stroke margins
      // (avoiding broken letter fragments that cause OCR foreign-glyph hallucinations)
      let finalColor: number;
      if (gray < threshold - 30) {
        finalColor = 0; // Solid ink
      } else if (gray > threshold + 30) {
        finalColor = 255; // Solid paper
      } else {
        // Smooth transition zone for Tesseract line gradient detection
        finalColor = Math.round((gray - (threshold - 30)) * (255 / 60));
      }

      data[i] = finalColor;     // R
      data[i + 1] = finalColor; // G
      data[i + 2] = finalColor; // B
      data[i + 3] = 255;        // Opaque alpha
    }

    finalCtx.putImageData(imgData, 0, 0);

    // 5. Correct sideways orientation and document skew
    const oriented = correctCanvasOrientation(targetCanvas);
    const deskewed = deskewCanvas(oriented);
    return deskewed;
  } catch (err) {
    console.warn("[DocumentProcessor] Canvas preprocessing warning, using raw canvas:", err);
  }

  return targetCanvas;
}

/**
 * 1. DOCX Extractor
 * Parses .docx packages client-side by unzipping them with JSZip and parsing the core word/document.xml.
 */
export class DOCXTextExtractor implements DocumentExtractor {
  async extractText(
    file: File,
    onProgress: (progress: ExtractionProgress) => void,
    options?: ExtractionOptions
  ): Promise<ExtractionResult> {
    if (options?.signal?.aborted) {
      throw new Error("DOCX extraction cancelled by user.");
    }

    onProgress({ status: "Reading DOCX file structure...", progressPercent: 20 });
    const arrayBuffer = await file.arrayBuffer();

    const cacheKey = await buildDeterministicCacheKey({
      fileBuffer: arrayBuffer,
      fileType: "docx",
      engineVersion: `jszip@${JSZIP_VERSION}`,
    });

    const zip = await JSZip.loadAsync(arrayBuffer);
    const docXmlFile = zip.file("word/document.xml");

    if (!docXmlFile) {
      throw new Error("Invalid DOCX format: word/document.xml not found.");
    }

    if (options?.signal?.aborted) {
      throw new Error("DOCX extraction cancelled by user.");
    }

    onProgress({ status: "Extracting XML text blocks...", progressPercent: 60 });
    const xmlText = await docXmlFile.async("text");

    onProgress({ status: "Parsing XML layout...", progressPercent: 90 });
    const paragraphs: string[] = [];

    if (typeof DOMParser !== "undefined") {
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlText, "text/xml");
      const pElements = xmlDoc.getElementsByTagName("w:p");

      for (let i = 0; i < pElements.length; i++) {
        const p = pElements[i];
        const tElements = p.getElementsByTagName("w:t");
        let paragraphText = "";
        for (let j = 0; j < tElements.length; j++) {
          paragraphText += tElements[j].textContent || "";
        }
        if (paragraphText.trim()) {
          paragraphs.push(paragraphText);
        }
      }
    } else {
      // Fallback regex extraction for XML text tags
      const matches = xmlText.match(/<w:t[^>]*>(.*?)<\/w:t>/g) || [];
      const extracted = matches.map((m) => m.replace(/<[^>]+>/g, "")).join(" ");
      if (extracted.trim()) {
        paragraphs.push(extracted);
      }
    }

    const rawText = paragraphs.join("\n\n").trim();
    const pageResult: PageExtractionResult = {
      pageNumber: 1,
      text: rawText,
      confidence: 100,
      method: "DOCX Direct",
      charCount: rawText.length,
      isScanned: false,
    };

    onProgress({ status: "Extraction complete.", progressPercent: 100 });

    return {
      rawText,
      confidence: 100,
      method: "DOCX Direct",
      pageCount: 1,
      processedPages: 1,
      hasUnprocessedPages: false,
      pageResults: [pageResult],
      cacheKey,
      engineVersion: `jszip@${JSZIP_VERSION}`,
      warnings: [],
      isPartial: false,
    };
  }
}

/**
 * Stopword dictionary and morphology normalizer for evaluating OCR and text fidelity.
 */
function getBaseWord(word: string): string {
  if (word.length <= 3) return word;

  if (word.endsWith("ies")) return word.slice(0, -3) + "y";
  if (word.endsWith("es")) {
    const base = word.slice(0, -2);
    if (base.endsWith("s") || base.endsWith("x") || base.endsWith("ch") || base.endsWith("sh")) {
      return base;
    }
    return word.slice(0, -1);
  }
  if (word.endsWith("s") && !word.endsWith("ss") && !word.endsWith("us") && !word.endsWith("is")) {
    return word.slice(0, -1);
  }

  if (word.endsWith("ied")) return word.slice(0, -3) + "y";
  if (word.endsWith("ed")) return word.slice(0, -2);
  if (word.endsWith("ing")) return word.slice(0, -3);
  if (word.endsWith("ly")) return word.slice(0, -2);

  return word;
}

const COMMON_ACADEMIC_WORDS = new Set([
  "the", "of", "to", "and", "a", "in", "is", "it", "you", "that", "he", "was", "for", "on", "are", "as", "with", "his", "they", "i", 
  "at", "be", "this", "have", "from", "or", "one", "had", "by", "word", "but", "not", "what", "all", "were", "we", "when", "your", "can", "said", 
  "there", "use", "an", "each", "which", "she", "do", "how", "their", "if", "will", "up", "other", "about", "out", "many", "then", "them", "these", "so", 
  "some", "her", "would", "make", "like", "him", "into", "time", "has", "look", "two", "more", "write", "go", "see", "number", "no", "way", "could", "people", 
  "my", "than", "first", "water", "been", "call", "who", "oil", "its", "now", "find", "long", "down", "day", "did", "get", "come", "made", "may", "part",
  "over", "new", "sound", "take", "only", "little", "work", "know", "place", "year", "live", "me", "back", "give", "most", "very", "after", "thing", "our", "just",
  "name", "good", "sentence", "man", "think", "say", "great", "where", "help", "through", "much", "before", "line", "right", "too", "mean", "any", "same", "tell", "boy",
  "follow", "came", "want", "show", "also", "around", "form", "three", "small", "end", "put", "home", "read", "hand", "port", "large", "spell", "add", "even", "land",
  "here", "must", "big", "high", "such", "act", "why", "ask", "men", "change", "went", "light", "kind", "off", "need", "house", "picture", "try", "us",
  "again", "animal", "point", "mother", "world", "near", "build", "self", "earth", "father", "head", "stand", "own", "page", "should", "country", "found", "answer",
  "school", "grow", "study", "still", "learn", "plant", "cover", "food", "sun", "four", "between", "state", "keep", "eye", "never", "last", "let", "thought", "city",
  "tree", "cross", "farm", "hard", "start", "might", "story", "saw", "far", "sea", "draw", "left", "late", "run", "dont", "while", "press", "close", "night", "real",
  "life", "few", "north", "open", "seem", "together", "next", "white", "children", "begin", "got", "walk", "example", "ease", "paper", "group", "always", "music", "those",
  "both", "mark", "often", "letter", "until", "mile", "river", "car", "feet", "care", "second", "book", "carry", "took", "science", "eat", "room", "friend", "began", "idea",
  "question", "essay", "assignment", "project", "standard", "report", "reference", "research", "university", "course", "class", "discuss", "explain", "evaluate", "analyze",
  "compare", "contrast", "define", "describe", "argue", "support", "outline", "list", "detail", "table", "level", "student", "team", "individual", "required",
  "brief", "solution", "grade", "rubric", "module", "unit", "lecture", "tutorial", "seminar",
  "academic", "education", "college", "literature", "article", "journal", "overview", "theory",
  "concept", "framework", "model", "method", "methodology", "approach", "process", "system",
  "factor", "variable", "data", "evidence", "proof", "argument", "thesis", "hypothesis", "finding",
  "figure", "chart", "graph", "diagram", "chapter", "section", "part", "volume", "issue",
  "assume", "assumption", "implication", "due", "deadline", "score", "criteria",
  "business", "economic", "economics", "economy", "finance", "financial", "market", "policy",
  "impact", "capital", "structure", "trade", "enterprise", "student", "students", "referencing",
  "style", "maximum", "limit", "instruction", "instructions", "guideline", "guidelines",
  "discuss", "evaluate", "critically", "analyze", "hypothesis", "theory", "model", "words"
]);

export function calculateStopwordRatio(text: string): { totalWords: number; matchCount: number; ratio: number } {
  if (!text || text.trim().length === 0) {
    return { totalWords: 0, matchCount: 0, ratio: 0 };
  }

  const words = text
    .toLowerCase()
    .replace(/'s\b/g, "")
    .replace(/[^a-z\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 1 || w === "a" || w === "i");

  if (words.length === 0) {
    return { totalWords: 0, matchCount: 0, ratio: 0 };
  }

  let matchCount = 0;
  for (const word of words) {
    if (COMMON_ACADEMIC_WORDS.has(word)) {
      matchCount++;
    } else {
      const base = getBaseWord(word);
      const base2 = getBaseWord(base);
      if (COMMON_ACADEMIC_WORDS.has(base) || COMMON_ACADEMIC_WORDS.has(base2)) {
        matchCount++;
      }
    }
  }

  return { totalWords: words.length, matchCount, ratio: matchCount / words.length };
}

export function detectGibberishText(text: string): boolean {
  if (!text || text.trim().length < 20) return true;

  // 1. High-ratio non-printable / symbol check: true gibberish / OCR noise
  const lettersAndDigits = text.match(/[\p{L}\p{N}]/gu) || [];
  if (lettersAndDigits.length / text.length < 0.35) return true;

  // 2. Coherent English stopword ratio
  const { totalWords, matchCount, ratio } = calculateStopwordRatio(text);
  if (totalWords >= 5 && ratio >= 0.45) return false;

  // 3. Multi-language coherent phrase markers (French, Spanish, German, Portuguese)
  const lower = text.toLowerCase();
  const foreignMarkers = [
    " le ", " la ", " les ", " des ", " est ", " dans ", " pour ", " avec ", " une ", " sur ", // French
    " el ", " la ", " los ", " las ", " por ", " para ", " con ", " una ", " en ", " del ", // Spanish
    " der ", " die ", " das ", " und ", " ist ", " in ", " für ", " mit ", " auf ", // German
    " o ", " a ", " os ", " as ", " do ", " da ", " em ", " para ", " com ", " um ", // Portuguese
    " devoir ", " cours ", " projet ", " travail ", " note ", " etudiant ", " etudiante " // French academic
  ];
  if (foreignMarkers.filter((m) => lower.includes(m)).length >= 2) {
    return false;
  }

  // 4. Check for coherent words with standard vowel-consonant structure vs random keyboard smash / OCR noise
  // A genuine word is strictly alphabetic and contains at least one vowel
  const tokens = text.trim().split(/\s+/).filter((w) => w.length >= 2);
  if (tokens.length >= 4) {
    const validWordCount = tokens.filter((w) => /^[a-zA-Z\p{L}\-']+$/u.test(w) && /[aeiouyàâäéèêëîïôöùûüç]/iu.test(w)).length;
    const validWordRatio = validWordCount / tokens.length;

    const symbolCount = (text.match(/[^a-zA-Z0-9\s\p{L}\p{N}.,;:?!()"'\-]/gu) || []).length;
    const symbolRatio = symbolCount / text.length;

    // Academic text with domain jargon has high valid word ratio and low symbol ratio, plus some academic matches
    if (validWordRatio >= 0.75 && symbolRatio < 0.12 && (matchCount >= 2 || ratio >= 0.20)) {
      return false;
    }
  }

  return ratio < 0.45;
}

/**
 * Evaluates whether a PDF.js page result represents a true digital text page or a scanned/empty page.
 * Uses primary structural signals (item count, printable length, character density)
 * in conjunction with linguistic stopword validation.
 */
export function evaluatePageIsScanned(itemsCount: number, pageText: string): boolean {
  const trimmed = pageText.trim();
  // 1. Primary check: zero items or negligible character volume
  if (itemsCount === 0 || trimmed.length < 25) {
    return true;
  }

  // 2. Check printable character ratio
  const nonWhitespace = trimmed.replace(/\s+/g, "");
  if (nonWhitespace.length < 20) {
    return true;
  }

  // 3. Check linguistic coherence if substantial length
  if (trimmed.length >= 50) {
    return detectGibberishText(trimmed);
  }

  return false;
}

/**
 * 2. PDF & Scanned PDF Extractor
 * Primary Method: Extracts selectable text layers using PDF.js.
 * Fallback Method: Renders pages sequentially to canvas, applies preprocessing,
 * and runs Tesseract.js client-side OCR for scanned documents.
 */
export class PDFTextExtractor implements DocumentExtractor {
  public async loadPdfJS(): Promise<any> {
    if (typeof window === "undefined") return null;

    const win = window as any;
    if (win.pdfjsLib) {
      return win.pdfjsLib;
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.min.js`;
      script.async = true;
      script.onload = () => {
        const pdfjs = (window as any).pdfjsLib;
        pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${PDFJS_VERSION}/pdf.worker.min.js`;
        resolve(pdfjs);
      };
      script.onerror = () => reject(new Error("Failed to load PDF.js engine from CDN."));
      document.body.appendChild(script);
    });
  }

  private async loadTesseract(): Promise<any> {
    if (typeof window === "undefined") return null;
    const win = window as any;
    if (win.Tesseract) {
      return win.Tesseract;
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js`;
      script.async = true;
      script.onload = () => {
        resolve((window as any).Tesseract);
      };
      script.onerror = () => reject(new Error("Failed to load OCR engine from CDN."));
      document.body.appendChild(script);
    });
  }

  async extractText(
    file: File,
    onProgress: (progress: ExtractionProgress) => void,
    options?: ExtractionOptions
  ): Promise<ExtractionResult> {
    if (options?.signal?.aborted) {
      throw new Error("PDF processing cancelled by user.");
    }

    onProgress({ status: "Loading PDF engine...", progressPercent: 10 });
    const pdfjs = await this.loadPdfJS();
    if (!pdfjs) {
      throw new Error("PDF.js is unavailable in non-browser environment.");
    }

    const arrayBuffer = await file.arrayBuffer();
    const cacheKey = await buildDeterministicCacheKey({
      fileBuffer: arrayBuffer,
      fileType: "pdf",
      engineVersion: `pdfjs@${PDFJS_VERSION}_tesseract@${TESSERACT_VERSION}`,
    });

    onProgress({ status: "Reading PDF document structure...", progressPercent: 20 });
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;

    const totalPages = pdf.numPages;
    const digitalPagesToScan = Math.min(totalPages, DIGITAL_PDF_MAX_PAGES);
    const pageResults: PageExtractionResult[] = [];
    const warnings: string[] = [];
    let scannedPagesCount = 0;

    // 1. Digital Text Layer Extraction & Primary Scanned Identification
    onProgress({
      status: `Analyzing text layers (0 of ${digitalPagesToScan} pages)...`,
      progressPercent: 25,
      currentPage: 0,
      totalPages,
    });

    for (let i = 1; i <= digitalPagesToScan; i++) {
      if (options?.signal?.aborted) {
        throw new Error("PDF processing cancelled by user.");
      }

      // Check if page already completed in resumable state
      if (options?.resumablePages && options.resumablePages.has(i)) {
        const cached = options.resumablePages.get(i)!;
        pageResults.push(cached);
        if (cached.isScanned) scannedPagesCount++;
        continue;
      }

      const page = await pdf.getPage(i);
      const textContent = await page.getTextContent();
      const itemsCount = textContent.items?.length || 0;

      // Preserve layout: group items by Y coordinate transformations
      let lastY = -1;
      let pageText = "";
      for (const item of textContent.items as any[]) {
        const currentY = item.transform ? item.transform[5] : -1;
        if (lastY !== -1 && currentY !== -1 && Math.abs(currentY - lastY) > 5) {
          pageText += "\n";
        }
        pageText += (item.str || "") + " ";
        lastY = currentY;
      }

      pageText = pageText.trim();
      const isScanned = evaluatePageIsScanned(itemsCount, pageText);
      if (isScanned) {
        scannedPagesCount++;
      }

      const pResult: PageExtractionResult = {
        pageNumber: i,
        text: pageText,
        confidence: isScanned ? 30 : 100,
        method: isScanned ? "Scanned (Pending OCR)" : "PDF Direct",
        charCount: pageText.length,
        isScanned,
      };

      pageResults.push(pResult);
      options?.onPageComplete?.(pResult);

      try {
        page.cleanup();
      } catch {}

      onProgress({
        status: `Analyzed page ${i} of ${digitalPagesToScan}...`,
        progressPercent: Math.round(25 + (i / digitalPagesToScan) * 20),
        currentPage: i,
        totalPages,
      });
    }

    // Determine whether document requires scanned OCR processing
    const isPredominantlyScanned =
      scannedPagesCount > 0 &&
      (scannedPagesCount >= pageResults.length * 0.5 ||
        pageResults.reduce((acc, p) => acc + p.charCount, 0) < 60);

    // =========================================================================
    // CASE A: Digital PDF (Text layer is healthy and valid)
    // =========================================================================
    if (!isPredominantlyScanned) {
      const fullText = pageResults
        .filter((p) => !p.isScanned && p.text.length > 0)
        .map((p) => p.text)
        .join("\n\n")
        .trim();

      const hasUnprocessed = totalPages > DIGITAL_PDF_MAX_PAGES;
      let unprocessedReason: string | undefined;
      if (hasUnprocessed) {
        unprocessedReason = `Digital PDF has ${totalPages} pages exceeding browser limit (${DIGITAL_PDF_MAX_PAGES}). Processed first ${DIGITAL_PDF_MAX_PAGES} pages.`;
        warnings.push(unprocessedReason);
      }

      onProgress({ status: "Digital PDF extraction complete.", progressPercent: 100 });

      return {
        rawText: fullText,
        confidence: 100,
        method: "PDF Direct",
        pageCount: totalPages,
        processedPages: pageResults.length,
        hasUnprocessedPages: hasUnprocessed,
        unprocessedReason,
        pageResults,
        cacheKey,
        engineVersion: `pdfjs@${PDFJS_VERSION}`,
        warnings,
        isPartial: hasUnprocessed,
      };
    }

    // =========================================================================
    // CASE B: Scanned PDF (Sequential In-Browser Canvas + Tesseract.js OCR)
    // =========================================================================
    onProgress({
      status: "Scanned document detected. Initializing local OCR engine...",
      progressPercent: 48,
    });

    const Tesseract = await this.loadTesseract();
    const scannedTargetPages = Math.min(totalPages, SCANNED_PDF_MAX_PAGES);
    const ocrPageResults: PageExtractionResult[] = [];
    const hasUnprocessed = totalPages > SCANNED_PDF_MAX_PAGES;
    let unprocessedReason: string | undefined;

    if (hasUnprocessed) {
      unprocessedReason = `Scanned PDF contains ${totalPages} pages. The first ${SCANNED_PDF_MAX_PAGES} pages were recognized locally. Pages ${SCANNED_PDF_MAX_PAGES + 1}–${totalPages} require background server OCR.`;
      warnings.push(unprocessedReason);
    }

    for (let pageNum = 1; pageNum <= scannedTargetPages; pageNum++) {
      if (options?.signal?.aborted) {
        throw new Error("Scanned PDF OCR cancelled by user.");
      }

      // Check if page already OCR-ed in resumable state
      if (
        options?.resumablePages &&
        options.resumablePages.has(pageNum) &&
        options.resumablePages.get(pageNum)!.method.includes("OCR")
      ) {
        const cached = options.resumablePages.get(pageNum)!;
        ocrPageResults.push(cached);
        continue;
      }

      onProgress({
        status: `Rendering page ${pageNum} of ${scannedTargetPages} to high-resolution canvas...`,
        progressPercent: Math.round(50 + ((pageNum - 1) / scannedTargetPages) * 45),
        currentPage: pageNum,
        totalPages: scannedTargetPages,
      });

      const page = await pdf.getPage(pageNum);
      const viewport = page.getViewport({ scale: PDF_RENDER_CONFIG.scale });

      const canvas = document.createElement("canvas");
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      const context = canvas.getContext("2d");

      if (!context) {
        cleanupCanvas(canvas);
        page.cleanup();
        throw new Error(`Failed to create 2D canvas context for page ${pageNum}.`);
      }

      // Sequential render to avoid memory spikes
      const renderTask = page.render({
        canvasContext: context,
        viewport,
        intent: PDF_RENDER_CONFIG.intent,
      });
      await renderTask.promise;

      // Apply image enhancement and binarization
      onProgress({
        status: `Enhancing contrast and binarizing page ${pageNum}...`,
        progressPercent: Math.round(50 + ((pageNum - 0.5) / scannedTargetPages) * 45),
        currentPage: pageNum,
        totalPages: scannedTargetPages,
      });

      const processedCanvas = preprocessCanvas(canvas);

      onProgress({
        status: `Recognizing text on page ${pageNum} of ${scannedTargetPages}...`,
        progressPercent: Math.round(50 + (pageNum / scannedTargetPages) * 45),
        currentPage: pageNum,
        totalPages: scannedTargetPages,
      });

      let pageOcrText = "";
      let pageConfidence = 85;

      try {
        const ocrRes = await Tesseract.recognize(processedCanvas, OCR_DEFAULT_LANG, {
          logger: (m: any) => {
            if (m.status === "recognizing text" && typeof m.progress === "number") {
              const baseP = 50 + ((pageNum - 1) / scannedTargetPages) * 45;
              const stepP = (m.progress / scannedTargetPages) * 45;
              onProgress({
                status: `Recognizing characters on page ${pageNum} (${Math.round(m.progress * 100)}%)...`,
                progressPercent: Math.round(baseP + stepP),
                currentPage: pageNum,
                totalPages: scannedTargetPages,
              });
            }
          },
        });

        pageOcrText = (ocrRes?.data?.text || "").trim();
        pageConfidence = Math.round(ocrRes?.data?.confidence || 80);
      } catch (ocrErr: any) {
        console.warn(`[PDF OCR] Page ${pageNum} character recognition failed:`, ocrErr);
        pageOcrText = "";
        pageConfidence = 10;
        warnings.push(`Page ${pageNum} character recognition failed: ${ocrErr?.message || ocrErr}`);
      } finally {
        // Enforce immediate canvas and page memory teardown
        cleanupCanvas(canvas);
        if (processedCanvas !== canvas) {
          cleanupCanvas(processedCanvas);
        }
        try {
          page.cleanup();
        } catch {}
      }

      const pageOcrResult: PageExtractionResult = {
        pageNumber: pageNum,
        text: pageOcrText,
        confidence: Math.max(10, Math.min(100, pageConfidence)),
        method: "Client Scanned PDF OCR",
        charCount: pageOcrText.length,
        isScanned: true,
      };

      ocrPageResults.push(pageOcrResult);
      options?.onPageComplete?.(pageOcrResult);
    }

    const fullScannedText = ocrPageResults
      .map((p) => p.text)
      .filter((t) => t.length > 0)
      .join("\n\n")
      .trim();

    const avgConfidence =
      ocrPageResults.length > 0
        ? Math.round(
            ocrPageResults.reduce((acc, p) => acc + p.confidence, 0) / ocrPageResults.length
          )
        : 50;

    onProgress({ status: "Local scanned PDF OCR complete.", progressPercent: 100 });

    return {
      rawText: fullScannedText,
      confidence: avgConfidence,
      method: "Client Scanned PDF OCR",
      pageCount: totalPages,
      processedPages: ocrPageResults.length,
      hasUnprocessedPages: hasUnprocessed,
      unprocessedReason,
      pageResults: ocrPageResults,
      cacheKey,
      engineVersion: `pdfjs@${PDFJS_VERSION}_tesseract@${TESSERACT_VERSION}`,
      warnings,
      isPartial: hasUnprocessed,
    };
  }
}

/**
 * 3. Image Extractor
 * Preprocesses raster images (PNG, JPG, JPEG, WEBP) on an HTML5 canvas before running Tesseract.js.
 */
export class ImageTextExtractor implements DocumentExtractor {
  private async loadTesseract(): Promise<any> {
    if (typeof window === "undefined") return null;
    const win = window as any;
    if (win.Tesseract) {
      return win.Tesseract;
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = `https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js`;
      script.async = true;
      script.onload = () => {
        resolve((window as any).Tesseract);
      };
      script.onerror = () => reject(new Error("Failed to load OCR engine from CDN."));
      document.body.appendChild(script);
    });
  }

  private async loadImageToCanvas(file: File): Promise<HTMLCanvasElement> {
    const canvas = document.createElement("canvas");

    // Fast path: createImageBitmap if supported
    if (typeof createImageBitmap !== "undefined") {
      try {
        const bitmap = await createImageBitmap(file);
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0);
          bitmap.close();
          return canvas;
        }
      } catch (bitmapErr) {
        console.warn("[ImageTextExtractor] createImageBitmap failed, falling back to Image element:", bitmapErr);
      }
    }

    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          URL.revokeObjectURL(url);
          resolve(canvas);
        } else {
          URL.revokeObjectURL(url);
          reject(new Error("Could not acquire 2D canvas context for image upload."));
        }
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        reject(new Error("Failed to load image into browser memory."));
      };
      img.src = url;
    });
  }

  async extractText(
    file: File,
    onProgress: (progress: ExtractionProgress) => void,
    options?: ExtractionOptions
  ): Promise<ExtractionResult> {
    if (options?.signal?.aborted) {
      throw new Error("Image OCR cancelled by user.");
    }

    onProgress({ status: "Loading image and optical recognition engine...", progressPercent: 15 });
    const arrayBuffer = await file.arrayBuffer();

    const cacheKey = await buildDeterministicCacheKey({
      fileBuffer: arrayBuffer,
      fileType: "image",
      engineVersion: `tesseract@${TESSERACT_VERSION}`,
    });

    const Tesseract = await this.loadTesseract();
    if (!Tesseract) {
      throw new Error("Tesseract engine is unavailable in non-browser environment.");
    }

    if (options?.signal?.aborted) {
      throw new Error("Image OCR cancelled by user.");
    }

    onProgress({ status: "Preprocessing image layout & boosting contrast...", progressPercent: 30 });
    const rawCanvas = await this.loadImageToCanvas(file);
    const preprocessedCanvas = preprocessCanvas(rawCanvas);

    onProgress({ status: "Recognizing characters from image...", progressPercent: 50 });
    let text = "";
    let confidence = 85;

    try {
      const ret = await Tesseract.recognize(preprocessedCanvas, OCR_DEFAULT_LANG, {
        logger: (m: any) => {
          if (m.status === "recognizing text" && typeof m.progress === "number") {
            onProgress({
              status: `Reading text from assignment image (${Math.round(m.progress * 100)}%)...`,
              progressPercent: Math.round(50 + m.progress * 45),
            });
          }
        },
      });

      text = (ret?.data?.text || "").trim();
      confidence = Math.round(ret?.data?.confidence || 85);
    } finally {
      cleanupCanvas(rawCanvas);
      if (preprocessedCanvas !== rawCanvas) {
        cleanupCanvas(preprocessedCanvas);
      }
    }

    const pageResult: PageExtractionResult = {
      pageNumber: 1,
      text,
      confidence: Math.max(10, Math.min(100, confidence)),
      method: "Client Image OCR",
      charCount: text.length,
      isScanned: true,
    };

    onProgress({ status: "Image character recognition complete.", progressPercent: 100 });

    return {
      rawText: text,
      confidence: Math.max(10, Math.min(100, confidence)),
      method: "Client Image OCR",
      pageCount: 1,
      processedPages: 1,
      hasUnprocessedPages: false,
      pageResults: [pageResult],
      cacheKey,
      engineVersion: `tesseract@${TESSERACT_VERSION}`,
      warnings: [],
      isPartial: false,
    };
  }
}

/**
 * Universal Registry mapping file formats to appropriate local extractors.
 * Priority Sequence: DOCX -> PDF -> Image.
 */
export const DocumentProcessor = {
  async process(
    file: File,
    onProgress: (progress: ExtractionProgress) => void,
    options?: ExtractionOptions
  ): Promise<ExtractionResult> {
    const ext = file.name.split(".").pop()?.toLowerCase() || "";

    if (ext === "docx" || ext === "doc") {
      const docxExtractor = new DOCXTextExtractor();
      return await docxExtractor.extractText(file, onProgress, options);
    }

    if (ext === "pdf") {
      const pdfExtractor = new PDFTextExtractor();
      return await pdfExtractor.extractText(file, onProgress, options);
    }

    if (["png", "jpg", "jpeg", "webp", "tiff", "tif"].includes(ext)) {
      const imgExtractor = new ImageTextExtractor();
      return await imgExtractor.extractText(file, onProgress, options);
    }

    throw new Error(`Unsupported document extension for local extraction: .${ext}`);
  },
};
