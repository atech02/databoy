import { DocumentProcessor, ExtractionResult, ExtractionOptions } from "./documentProcessor";
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
    try {
      clientResult = await DocumentProcessor.process(
        file,
        (p) => {
          onProgress(p.status, Math.round(15 + p.progressPercent * 0.8));
        },
        options
      );
    } catch (err: any) {
      localError = err;
      console.warn("[ocrService] Local extraction failed or unavailable, checking backend fallback:", err);
    }

    // 2. Evaluate Local Extraction Quality
    if (clientResult && clientResult.rawText && clientResult.rawText.trim().length > 0) {
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

    // 3. Fallback: Only invoke backend if local extraction produced 0 characters AND fileId exists
    if (fileId) {
      try {
        onProgress("Local OCR did not detect characters. Invoking backup verification...", 60);
        const backendRes = await apiClient.post<any>(`/api/uploads/${fileId}/ocr`, {
          fileId,
        });

        if (backendRes && backendRes.success && backendRes.rawText && backendRes.rawText.trim().length > 0) {
          onProgress("Structuring assignment brief...", 95);
          const durationMs = Math.round(performance.now() - startTime);

          return {
            rawText: backendRes.rawText,
            parsed: backendRes.parsedFields || parseOCRText(backendRes.rawText),
            confidence: backendRes.confidence || "medium",
            ocrMetrics: backendRes.ocrMetrics || {
              fileType,
              extractionMethod: "backend_fallback",
              status: "Success",
              durationMs,
              confidenceScore: 70,
            },
          };
        }
      } catch (backendErr: any) {
        console.warn("[ocrService] Backend backup extraction also failed:", backendErr);
      }
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
