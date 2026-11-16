import { DocumentProcessor } from "./documentProcessor";
import { parseOCRText, ParsedAssignmentFields } from "@/utils/ocrParser";
import { apiClient } from "@/services/apiClient";

export interface OCRResult {
  rawText: string;
  parsed: ParsedAssignmentFields;
  confidence: "high" | "medium" | "low";
  ocrMetrics: {
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
  };
}

export const ocrService = {
  /**
   * Processes an assignment document.
   * Priority:
   *  1. Direct client-side parsing for DOCX and Digital PDF (zero latency, 100% fidelity).
   *  2. Authoritative backend Express OCR endpoint (/api/uploads/:fileId/ocr) for multimodal
   *     understanding of Images & Scanned PDFs via Cloudflare R2 + Gemini 2.5 Flash.
   *  3. In-browser client-side optical character recognition fallback (Tesseract.js)
   *     if backend multimodal processing is unavailable or offline.
   * Completely replaces the obsolete Firebase Storage Cloud Function trigger.
   */
  async extractText(
    file: File,
    onProgress: (status: string, progressPercent: number) => void,
    projectId: string,
    customerId: string,
    fileUrl: string,
    filePath: string,
    fileId?: string
  ): Promise<OCRResult> {
    const startTime = performance.now();
    const fileType = file.name.split(".").pop()?.toLowerCase() || "";
    let extractionMethod = "Unknown";

    try {
      // 1. Direct client-side parsing for DOCX
      if (fileType === "docx" || fileType === "doc") {
        onProgress("Reading document structure...", 20);
        const result = await DocumentProcessor.process(file, (p) => {
          onProgress(p.status, Math.round(20 + p.progressPercent * 0.7));
        });
        const parsed = parseOCRText(result.rawText);
        const durationMs = Math.round(performance.now() - startTime);
        return {
          rawText: result.rawText,
          parsed,
          confidence: "high",
          ocrMetrics: {
            fileType,
            extractionMethod: result.method,
            status: "Success",
            durationMs,
            confidenceScore: 100,
          },
        };
      }

      // 2. Direct client-side parsing for Digital PDF
      if (fileType === "pdf") {
        onProgress("Reading PDF layout...", 20);
        try {
          const result = await DocumentProcessor.process(file, (p) => {
            onProgress(p.status, Math.round(20 + p.progressPercent * 0.7));
          });
          const parsed = parseOCRText(result.rawText);
          const durationMs = Math.round(performance.now() - startTime);
          return {
            rawText: result.rawText,
            parsed,
            confidence: "high",
            ocrMetrics: {
              fileType,
              extractionMethod: result.method,
              status: "Success",
              durationMs,
              confidenceScore: 100,
            },
          };
        } catch (pdfErr: any) {
          if (pdfErr.message !== "SCANNED_PDF") {
            throw pdfErr;
          }
          extractionMethod = "scanned_pdf";
        }
      } else if (["png", "jpg", "jpeg", "webp"].includes(fileType)) {
        extractionMethod = "image_ocr";
      } else {
        throw new Error(`Unsupported document extension: .${fileType}`);
      }

      // 3. Backend Express OCR endpoint via Cloudflare R2
      if (fileId) {
        try {
          onProgress("Analyzing assignment brief with backend OCR...", 40);
          const backendRes = await apiClient.post<any>(`/api/uploads/${fileId}/ocr`, {
            fileId,
          });

          if (backendRes && backendRes.success && backendRes.rawText && backendRes.rawText.trim().length > 0) {
            onProgress("Parsing assignment guidelines...", 90);
            const durationMs = Math.round(performance.now() - startTime);
            return {
              rawText: backendRes.rawText,
              parsed: backendRes.parsedFields || parseOCRText(backendRes.rawText),
              confidence: backendRes.confidence || "high",
              ocrMetrics: backendRes.ocrMetrics || {
                fileType,
                extractionMethod: backendRes.ocrMetrics?.extractionMethod || "backend_r2_gemini",
                status: "Success",
                durationMs,
                confidenceScore: 90,
              },
            };
          }
        } catch (backendErr: any) {
          console.warn("Backend OCR endpoint unavailable or returned an error, falling back to client OCR:", backendErr);
        }
      }

      // 4. Client-side OCR fallback for Images & Scanned PDFs
      onProgress("Running optical character recognition...", 50);
      const clientResult = await DocumentProcessor.process(file, (p) => {
        onProgress(p.status, Math.round(50 + p.progressPercent * 0.45));
      });

      const parsed = parseOCRText(clientResult.rawText);
      const durationMs = Math.round(performance.now() - startTime);

      return {
        rawText: clientResult.rawText,
        parsed,
        confidence: clientResult.confidence > 70 ? "high" : clientResult.confidence > 40 ? "medium" : "low",
        ocrMetrics: {
          fileType,
          extractionMethod: clientResult.method,
          status: "Success",
          durationMs,
          confidenceScore: clientResult.confidence,
        },
      };
    } catch (err: any) {
      console.error("ocrService.extractText failed:", err);
      const durationMs = Math.round(performance.now() - startTime);
      const failedMetrics = {
        fileType,
        extractionMethod,
        status: "Failure" as const,
        durationMs,
        confidenceScore: 0,
        errorReason: err.message || "ocr_extraction_failed",
      };
      (err as any).ocrMetrics = failedMetrics;
      throw err;
    }
  },
};
