import { DocumentProcessor, ExtractionResult, ExtractionOptions, resolveOcrLanguage, detectGibberishText } from "./documentProcessor";
import { parseOCRText, ParsedAssignmentFields } from "@/utils/ocrParser";
import { apiClient } from "@/services/apiClient";

export interface OCRMetrics {
  fileType: string;
  extractionMethod: string;
  status: "Success" | "Failure";
  durationMs: number;
  confidenceScore: number;
  completenessScore?: number;
  pageCount?: number;
  processedPages?: number;
  hasUnprocessedPages?: boolean;
  unprocessedReason?: string;
  cacheKey?: string;
  engineVersion?: string;
  warnings?: string[];
  isPartial?: boolean;
  modelUsed?: string;
  tokenUsage?: {
    promptTokens: number;
    completionTokens: number;
  };
  requestCostEstimate?: number;
  errorReason?: string;
}

export interface OCRResult {
  rawText: string;
  parsed: ParsedAssignmentFields;
  confidence: "high" | "medium" | "low";
  ocrMetrics: OCRMetrics;
  isPartial?: boolean;
  unprocessedReason?: string;
  cacheKey?: string;
}

export const ocrService = {
  /**
   * Processes an assignment document with a Local-First, Zero-Cost pipeline.
   * Priority:
   *  1. In-browser client-side extraction (DOCX via JSZip, Digital PDF via PDF.js,
   *     and Scanned PDFs / Images via enhanced Canvas + Tesseract.js).
   *     All ordinary character recognition happens locally without invoking Gemini vision tokens.
   *  2. Last-resort fallback to backend Express OCR (/api/uploads/:fileId/ocr)
   *     ONLY if local extraction fails completely or is blocked by browser environment.
   */
  async extractText(
    file: File,
    onProgress: (status: string, progressPercent: number) => void,
    projectId: string,
    customerId: string,
    fileUrl: string,
    filePath: string,
    fileId?: string,
    options?: ExtractionOptions
  ): Promise<OCRResult> {
    const startTime = performance.now();
    const fileType = file.name.split(".").pop()?.toLowerCase() || "";
    let extractionMethod = "Client Local OCR";
    let clientResult: ExtractionResult | null = null;
    let localError: Error | null = null;

    // 1. Stage 1: Execute Local In-Browser OCR & Text Extraction First
    const resolvedLang = resolveOcrLanguage(options?.lang, file.name);
    const enrichedOptions: ExtractionOptions = {
      ...options,
      lang: resolvedLang,
    };

    try {
      clientResult = await DocumentProcessor.process(
        file,
        (p) => {
          onProgress(p.status, Math.round(15 + p.progressPercent * 0.8));
        },
        enrichedOptions
      );
    } catch (err: any) {
      localError = err;
      console.warn("[ocrService] Local extraction failed or unavailable, checking backend fallback:", err);
    }

    // 2. Evaluate Local Extraction Quality
    const hasLocalText = Boolean(clientResult && clientResult.rawText && clientResult.rawText.trim().length > 0);
    const isLowConfidenceOrGibberish =
      !hasLocalText ||
      (clientResult ? clientResult.confidence < 50 || detectGibberishText(clientResult.rawText) : true);

    // Path A: High-Confidence Local Extraction (>= 50 confidence and not gibberish)
    if (hasLocalText && !isLowConfidenceOrGibberish && clientResult) {
      onProgress("Structuring assignment brief fields...", 90);

      let parsed = parseOCRText(clientResult.rawText);
      let effectiveMethod = clientResult.method;

      // Enhance with server-side Gemini 2.5 Flash understanding if fileId is available
      if (fileId) {
        try {
          onProgress("Interpreting assignment details with Gemini AI...", 95);
          const backendRes = await apiClient.post<any>(`/api/uploads/${fileId}/ocr`, {
            fileId,
            clientRawText: clientResult.rawText,
          });

          if (backendRes && backendRes.success && backendRes.parsedFields) {
            parsed = backendRes.parsedFields;
            effectiveMethod = `${clientResult.method} + Gemini 2.5 Flash`;
          }
        } catch (aiErr) {
          console.warn("[ocrService] Server AI structuring failed, using local rule parser:", aiErr);
        }
      }

      const durationMs = Math.round(performance.now() - startTime);

      const completenessScore =
        (parsed.title || parsed.assignment_title ? 20 : 0) +
        (parsed.guidelines || parsed.questions || parsed.assignment_brief ? 30 : 0) +
        (parsed.wordCount || parsed.word_count ? 20 : 0) +
        (parsed.referencingStyle || parsed.referencing_style ? 15 : 0) +
        (parsed.deadline || parsed.submission_deadline ? 15 : 0);

      const confidenceGrade: "high" | "medium" | "low" =
        parsed.extraction_confidence ||
        (clientResult.confidence >= 80 ? "high" : clientResult.confidence >= 50 ? "medium" : "low");

      const ocrMetrics: OCRMetrics = {
        fileType,
        extractionMethod: effectiveMethod,
        status: "Success",
        durationMs,
        confidenceScore: clientResult.confidence,
        completenessScore,
        pageCount: clientResult.pageCount,
        processedPages: clientResult.processedPages,
        hasUnprocessedPages: clientResult.hasUnprocessedPages,
        unprocessedReason: clientResult.unprocessedReason,
        cacheKey: clientResult.cacheKey,
        engineVersion: clientResult.engineVersion,
        warnings: clientResult.warnings,
        isPartial: clientResult.isPartial,
        requestCostEstimate: 0,
      };

      onProgress("Extraction complete.", 100);

      return {
        rawText: clientResult.rawText,
        parsed,
        confidence: confidenceGrade,
        ocrMetrics,
        isPartial: clientResult.isPartial,
        unprocessedReason: clientResult.unprocessedReason,
        cacheKey: clientResult.cacheKey,
      };
    }

    // Path B: Low-Confidence OCR / Gibberish / Empty -> Escalate to Gemini Multimodal Vision
    if (fileId) {
      try {
        onProgress("Low local confidence detected. Escalating to Gemini multimodal vision...", 75);
        // CRITICAL: Omit clientRawText so backend retrieves R2 buffer for multimodal vision
        const backendRes = await apiClient.post<any>(`/api/uploads/${fileId}/ocr`, {
          fileId,
          forceMultimodal: true,
        });

        if (backendRes && backendRes.success && (backendRes.parsedFields || backendRes.rawText)) {
          onProgress("Structuring assignment brief...", 95);
          const durationMs = Math.round(performance.now() - startTime);

          const parsed = backendRes.parsedFields || parseOCRText(backendRes.rawText || "");
          const rawText = backendRes.rawText || (clientResult?.rawText || "");

          const completenessScore =
            (parsed.title || parsed.assignment_title ? 20 : 0) +
            (parsed.guidelines || parsed.questions || parsed.assignment_brief ? 30 : 0) +
            (parsed.wordCount || parsed.word_count ? 20 : 0) +
            (parsed.referencingStyle || parsed.referencing_style ? 15 : 0) +
            (parsed.deadline || parsed.submission_deadline ? 15 : 0);

          const ocrMetrics: OCRMetrics = backendRes.ocrMetrics || {
            fileType,
            extractionMethod: "Gemini 2.5 Flash Multimodal Vision",
            status: "Success",
            durationMs,
            confidenceScore: backendRes.confidence === "high" ? 95 : 75,
            completenessScore,
            pageCount: clientResult?.pageCount,
            processedPages: clientResult?.processedPages,
            hasUnprocessedPages: clientResult?.hasUnprocessedPages,
            unprocessedReason: clientResult?.unprocessedReason,
            cacheKey: clientResult?.cacheKey,
            engineVersion: clientResult?.engineVersion,
            warnings: clientResult?.warnings,
            isPartial: clientResult?.isPartial,
            requestCostEstimate: 0,
          };

          onProgress("Extraction complete.", 100);

          return {
            rawText,
            parsed,
            confidence: (backendRes.confidence as any) || "high",
            ocrMetrics,
            isPartial: clientResult?.isPartial,
            unprocessedReason: clientResult?.unprocessedReason,
            cacheKey: clientResult?.cacheKey,
          };
        }
      } catch (backendErr: any) {
        console.warn("[ocrService] Gemini multimodal escalation failed:", backendErr);
      }
    }

    // Path C: Fallback to local raw text if available even with low confidence
    if (hasLocalText && clientResult) {
      const parsed = parseOCRText(clientResult.rawText);
      const durationMs = Math.round(performance.now() - startTime);

      const completenessScore =
        (parsed.title || parsed.assignment_title ? 20 : 0) +
        (parsed.guidelines || parsed.questions || parsed.assignment_brief ? 30 : 0) +
        (parsed.wordCount || parsed.word_count ? 20 : 0) +
        (parsed.referencingStyle || parsed.referencing_style ? 15 : 0) +
        (parsed.deadline || parsed.submission_deadline ? 15 : 0);

      const ocrMetrics: OCRMetrics = {
        fileType,
        extractionMethod: clientResult.method,
        status: "Success",
        durationMs,
        confidenceScore: clientResult.confidence,
        completenessScore,
        pageCount: clientResult.pageCount,
        processedPages: clientResult.processedPages,
        hasUnprocessedPages: clientResult.hasUnprocessedPages,
        unprocessedReason: clientResult.unprocessedReason,
        cacheKey: clientResult.cacheKey,
        engineVersion: clientResult.engineVersion,
        warnings: [...(clientResult.warnings || []), "Low confidence local extraction without multimodal recovery"],
        isPartial: clientResult.isPartial,
        requestCostEstimate: 0,
      };

      onProgress("Extraction complete.", 100);

      return {
        rawText: clientResult.rawText,
        parsed,
        confidence: "low",
        ocrMetrics,
        isPartial: clientResult.isPartial,
        unprocessedReason: clientResult.unprocessedReason,
        cacheKey: clientResult.cacheKey,
      };
    }

    // 4. Handle Case where No Readable Text Was Found
    const durationMs = Math.round(performance.now() - startTime);
    const failureReason = localError?.message || "No readable text detected in uploaded document.";

    const failedMetrics: OCRMetrics = {
      fileType,
      extractionMethod,
      status: "Failure",
      durationMs,
      confidenceScore: 0,
      errorReason: failureReason,
    };

    const error = new Error(failureReason);
    (error as any).ocrMetrics = failedMetrics;
    throw error;
  },
};
