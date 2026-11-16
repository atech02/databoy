import JSZip from "jszip";

export interface ExtractionProgress {
  status: string;
  progressPercent: number;
}

export interface ExtractionResult {
  rawText: string;
  confidence: number; // 0 to 100
  method: string;
}

export interface DocumentExtractor {
  extractText(
    file: File,
    onProgress: (progress: ExtractionProgress) => void
  ): Promise<ExtractionResult>;
}

/**
 * Preprocesses canvas client-side to convert to grayscale,
 * boost contrast, binarize threshold, remove transparency, and resize small images.
 */
function preprocessCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;

  const width = canvas.width;
  const height = canvas.height;

  // 1. Resize very small images (min width 800px)
  let targetCanvas = canvas;
  if (width < 800) {
    const ratio = 800 / width;
    const targetWidth = 800;
    const targetHeight = Math.round(height * ratio);

    const resizeCanvas = document.createElement("canvas");
    resizeCanvas.width = targetWidth;
    resizeCanvas.height = targetHeight;
    const resizeCtx = resizeCanvas.getContext("2d");
    if (resizeCtx) {
      resizeCtx.drawImage(canvas, 0, 0, targetWidth, targetHeight);
      targetCanvas = resizeCanvas;
    }
  }

  const finalCtx = targetCanvas.getContext("2d");
  if (!finalCtx) return targetCanvas;

  const imgData = finalCtx.getImageData(0, 0, targetCanvas.width, targetCanvas.height);
  const data = imgData.data;

  // Contrast scale calculations
  const contrast = 35; // boost factor -255 to 255
  const factor = (259 * (contrast + 255)) / (255 * (259 - contrast));

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];
    let a = data[i + 3];

    // Remove transparency by blending with white background
    if (a < 255) {
      const alpha = a / 255;
      r = Math.round(r * alpha + 255 * (1 - alpha));
      g = Math.round(g * alpha + 255 * (1 - alpha));
      b = Math.round(b * alpha + 255 * (1 - alpha));
    }

    // Grayscale conversion
    let gray = 0.299 * r + 0.587 * g + 0.114 * b;

    // Contrast mapping
    gray = factor * (gray - 128) + 128;

    // Simple binary threshold thresholding
    const finalColor = gray > 128 ? 255 : 0;

    data[i] = finalColor;     // R
    data[i + 1] = finalColor; // G
    data[i + 2] = finalColor; // B
    data[i + 3] = 255;        // Opaque alpha
  }

  finalCtx.putImageData(imgData, 0, 0);
  return targetCanvas;
}

/**
 * 1. DOCX Extractor
 * Parses .docx packages client-side by unzipping them with JSZip and parsing the core word/document.xml.
 */
export class DOCXTextExtractor implements DocumentExtractor {
  async extractText(
    file: File,
    onProgress: (progress: ExtractionProgress) => void
  ): Promise<ExtractionResult> {
    onProgress({ status: "Reading DOCX file structure...", progressPercent: 20 });
    
    const zip = await JSZip.loadAsync(file);
    const docXmlFile = zip.file("word/document.xml");
    
    if (!docXmlFile) {
      throw new Error("Invalid DOCX format: word/document.xml not found.");
    }
    
    onProgress({ status: "Extracting XML text blocks...", progressPercent: 60 });
    const xmlText = await docXmlFile.async("text");
    
    onProgress({ status: "Parsing XML layout...", progressPercent: 90 });
    // Strip XML tags to get raw text paragraphs
    const paragraphs: string[] = [];
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
    
    return {
      rawText: paragraphs.join("\n\n"),
      confidence: 100, // Direct extraction has 100% confidence
      method: "DOCX Direct"
    };
  }
}

/**
 * 2. PDF Extractor
 * Dynamically injects and runs PDF.js to extract selectable text from digital PDFs.
 * Groups elements by Y-translation coordinate to preserve lists and line-breaks.
 * Falls back to Scanned PDF OCR page-by-page rendering if direct text is empty.
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
  if (word.endsWith("ed")) {
    return word.slice(0, -2);
  }
  
  if (word.endsWith("ing")) {
    return word.slice(0, -3);
  }
  
  if (word.endsWith("ly")) {
    return word.slice(0, -2);
  }
  
  return word;
}

function detectGibberishText(text: string): boolean {
  if (!text || text.trim().length < 20) return true;

  const words = text.toLowerCase()
    .replace(/'s\b/g, "") // Remove possessives
    .replace(/[^a-z\s]/g, "") // Remove punctuation/numbers
    .split(/\s+/)
    .filter(w => w.length > 1 || w === "a" || w === "i"); // Filter out invalid single letters

  if (words.length === 0) return true;

  const commonWords = new Set([
    "the", "of", "to", "and", "a", "in", "is", "it", "you", "that", "he", "was", "for", "on", "are", "as", "with", "his", "they", "i", 
    "at", "be", "this", "have", "from", "or", "one", "had", "by", "word", "but", "not", "what", "all", "were", "we", "when", "your", "can", "said", 
    "there", "use", "an", "each", "which", "she", "do", "how", "their", "if", "will", "up", "other", "about", "out", "many", "then", "them", "these", "so", 
    "some", "her", "would", "make", "like", "him", "into", "time", "has", "look", "two", "more", "write", "go", "see", "number", "no", "way", "could", "people", 
    "my", "than", "first", "water", "been", "call", "who", "oil", "its", "now", "find", "long", "down", "day", "did", "get", "come", "made", "may", "part",
    "over", "new", "sound", "take", "only", "little", "work", "know", "place", "year", "live", "me", "back", "give", "most", "very", "after", "thing", "our", "just",
    "name", "good", "sentence", "man", "think", "say", "great", "where", "help", "through", "much", "before", "line", "right", "too", "mean", "any", "same", "tell", "boy",
    "follow", "came", "want", "show", "also", "around", "form", "three", "small", "end", "put", "home", "read", "hand", "port", "large", "spell", "add", "even", "land",
    "here", "must", "big", "high", "such", "follow", "act", "why", "ask", "men", "change", "went", "light", "kind", "off", "need", "house", "picture", "try", "us",
    "again", "animal", "point", "mother", "world", "near", "build", "self", "earth", "father", "head", "stand", "own", "page", "should", "country", "found", "answer",
    "school", "grow", "study", "still", "learn", "plant", "cover", "food", "sun", "four", "between", "state", "keep", "eye", "never", "last", "let", "thought", "city",
    "tree", "cross", "farm", "hard", "start", "might", "story", "saw", "far", "sea", "draw", "left", "late", "run", "dont", "while", "press", "close", "night", "real",
    "life", "few", "north", "open", "seem", "together", "next", "white", "children", "begin", "got", "walk", "example", "ease", "paper", "group", "always", "music", "those",
    "both", "mark", "often", "letter", "until", "mile", "river", "car", "feet", "care", "second", "book", "carry", "took", "science", "eat", "room", "friend", "began", "idea",
    "question", "essay", "assignment", "project", "standard", "report", "reference", "research", "university", "course", "class", "discuss", "explain", "evaluate", "analyze",
    "compare", "contrast", "define", "describe", "argue", "support", "outline", "list", "detail", "table", "level", "student", "team", "individual", "required",
    
    // Academic & Assignment Brief specific
    "brief", "solution", "grade", "rubric", "module", "unit", "lecture", "tutorial", "seminar",
    "academic", "education", "college", "literature", "article", "journal", "overview", "theory",
    "concept", "framework", "model", "method", "methodology", "approach", "process", "system",
    "factor", "variable", "data", "evidence", "proof", "argument", "thesis", "hypothesis", "finding",
    "figure", "chart", "graph", "diagram", "chapter", "section", "part", "volume", "issue",
    "assume", "assumption", "implication", "flow", "forward", "decision", "whether", "hold", "provide",
    "calculate", "calculation", "determine", "solve", "verify", "prove", "theorem", "exercise", "problem",
    "due", "deadline", "score", "professor", "instructor", "tutor", "assess", "assessment", "criteria",
    
    // Business, Economics & Finance
    "business", "economic", "economics", "economy", "finance", "financial", "market", "marketing",
    "product", "service", "company", "firm", "organization", "industry", "sector", "management",
    "manager", "strategy", "strategic", "operation", "operational", "cost", "price", "pricing",
    "revenue", "profit", "profitable", "loss", "investment", "invest", "investor", "capital",
    "fund", "funding", "bank", "banking", "interest", "rate", "inflation", "currency",
    "exchange", "trade", "trading", "import", "export", "tariff", "tax", "taxation", "policy",
    "government", "regulation", "legal", "law", "contract", "agreement", "customer", "client",
    "consumer", "demand", "supply", "stock", "share", "bond", "asset", "liability", "equity",
    "debt", "credit", "loan", "growth", "development", "develop", "global", "globalization",
    "international", "foreign", "local", "domestic", "national", "regional", "value", "valuation",
    "risk", "return", "yield", "performance", "perform", "measure", "measurement", "metric",
    "index", "indicator", "trend", "forecast", "projection", "budget", "accounting", "audit",
    "practical", "practice", "movement", "offset", "differential", "parity", "rise", "rose",
    "significantly", "significant", "significance", "above", "below", "between", "among",
    "under", "over", "through", "across", "during", "before", "after", "since", "until",
    "while", "although", "though", "even", "unless", "because", "therefore", "thus", "hence",
    "consequently", "furthermore", "moreover", "addition", "additional", "besides", "very",
    "quite", "rather", "extremely", "highly", "fully", "completely", "entirely", "partially",
    "partly", "mostly", "mainly", "principally", "primarily", "especially", "particularly",
    "specifically", "generally", "normally", "typically", "usually", "often", "frequently",
    "sometimes", "rarely", "seldom", "always", "constantly", "continually", "temporary",
    "permanent", "recent", "recently", "current", "currently", "present", "presently",
    "future", "modern", "traditional", "classic", "classical", "time", "date", "year",
    "month", "week", "day", "hour", "minute", "second", "period", "duration", "long",
    "short", "large", "small", "big", "little", "great", "huge", "tiny", "wide", "narrow",
    "deep", "shallow", "high", "low", "tall", "heavy", "light", "hard", "soft", "strong",
    "weak", "fast", "slow", "rapid", "quick", "immediate", "sudden", "gradual", "united", "states",
    "zambia", "kwacha"
  ]);

  let matchCount = 0;
  for (const word of words) {
    if (commonWords.has(word)) {
      matchCount++;
    } else {
      const base = getBaseWord(word);
      const base2 = getBaseWord(base);
      if (commonWords.has(base) || commonWords.has(base2)) {
        matchCount++;
      }
    }
  }

  const ratio = matchCount / words.length;
  console.log(`[PDF OCR Layer Audit] Total words: ${words.length} | Matches: ${matchCount} | Stopword ratio: ${ratio.toFixed(4)}`);
  
  // If less than 55% of words are valid common English/academic words, it's gibberish/garbled OCR
  return ratio < 0.55;
}

export class PDFTextExtractor implements DocumentExtractor {
  private async loadPdfJS(): Promise<any> {
    if (typeof window === "undefined") return null;
    
    const win = window as any;
    if (win.pdfjsLib) {
      return win.pdfjsLib;
    }
    
    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js";
      script.async = true;
      script.onload = () => {
        const pdfjs = (window as any).pdfjsLib;
        pdfjs.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
        resolve(pdfjs);
      };
      script.onerror = () => reject(new Error("Failed to load PDF.js engine from CDN."));
      document.body.appendChild(script);
    });
  }

  async extractText(
    file: File,
    onProgress: (progress: ExtractionProgress) => void
  ): Promise<ExtractionResult> {
    onProgress({ status: "Loading PDF parser engine...", progressPercent: 15 });
    const pdfjs = await this.loadPdfJS();
    
    onProgress({ status: "Reading document pages...", progressPercent: 40 });
    const arrayBuffer = await file.arrayBuffer();
    const loadingTask = pdfjs.getDocument({ data: arrayBuffer });
    const pdf = await loadingTask.promise;
    
    const maxPages = pdf.numPages;
    const textContent: string[] = [];
    let isScanned = false;
    
    try {
      for (let i = 1; i <= maxPages; i++) {
        onProgress({ 
          status: `Reading text layout (Page ${i} of ${maxPages})...`, 
          progressPercent: Math.round(40 + (i / maxPages) * 40) 
        });
        const page = await pdf.getPage(i);
        const text = await page.getTextContent();
        
        // Preserve layout: group items by Y coordinate transformations
        let lastY = -1;
        let pageText = "";
        for (const item of text.items as any[]) {
          const currentY = item.transform ? item.transform[5] : -1;
          if (lastY !== -1 && currentY !== -1 && Math.abs(currentY - lastY) > 5) {
            pageText += "\n";
          }
          pageText += (item.str || "") + " ";
          lastY = currentY;
        }
        
        textContent.push(pageText.trim());
      }
      
      const fullText = textContent.join("\n\n").trim();
      const isGibberish = detectGibberishText(fullText);

      if (!fullText || isGibberish) {
        isScanned = true;
      } else {
        return {
          rawText: fullText,
          confidence: 100, // Direct extraction has 100% confidence
          method: "PDF Direct"
        };
      }
    } catch (err) {
      console.warn("Direct PDF text extraction failed. Retrying with Scanned PDF fallback:", err);
      isScanned = true;
    }
    
    if (isScanned) {
      throw new Error("SCANNED_PDF");
    }
    
    throw new Error("Failed to process PDF file.");
  }
}

export class ImageTextExtractor implements DocumentExtractor {
  private async loadTesseract(): Promise<any> {
    if (typeof window === "undefined") return null;
    const win = window as any;
    if (win.Tesseract) {
      return win.Tesseract;
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js";
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
    onProgress: (progress: ExtractionProgress) => void
  ): Promise<ExtractionResult> {
    onProgress({ status: "Loading optical recognition engine...", progressPercent: 20 });
    const Tesseract = await this.loadTesseract();

    onProgress({ status: "Recognizing characters from image...", progressPercent: 50 });
    const ret = await Tesseract.recognize(file, "eng", {
      logger: (m: any) => {
        if (m.status === "recognizing text" && typeof m.progress === "number") {
          onProgress({
            status: "Reading text from assignment image...",
            progressPercent: Math.round(50 + m.progress * 40),
          });
        }
      },
    });

    const text = (ret?.data?.text || "").trim();
    const confidence = Math.round(ret?.data?.confidence || 85);

    return {
      rawText: text,
      confidence: Math.max(10, Math.min(100, confidence)),
      method: "Client Image OCR",
    };
  }
}

/**
 * Registry mapping file extensions to matching DocumentExtractors
 * Strictly respects priority sequence: DOCX -> PDF -> Image.
 */
export const DocumentProcessor = {
  async process(
    file: File,
    onProgress: (progress: ExtractionProgress) => void
  ): Promise<ExtractionResult> {
    const ext = file.name.split(".").pop()?.toLowerCase() || "";

    if (ext === "docx" || ext === "doc") {
      const docxExtractor = new DOCXTextExtractor();
      return await docxExtractor.extractText(file, onProgress);
    }

    if (ext === "pdf") {
      const pdfExtractor = new PDFTextExtractor();
      return await pdfExtractor.extractText(file, onProgress);
    }

    if (["png", "jpg", "jpeg", "webp"].includes(ext)) {
      const imgExtractor = new ImageTextExtractor();
      return await imgExtractor.extractText(file, onProgress);
    }

    throw new Error(`Unsupported document extension: .${ext}`);
  },
};
