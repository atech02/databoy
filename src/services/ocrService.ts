import { DocumentProcessor } from "./documentProcessor";
import { parseOCRText, ParsedAssignmentFields } from "@/utils/ocrParser";
import { collection, query, where, getDocs, addDoc, onSnapshot, doc, Timestamp } from "firebase/firestore";
import { db } from "@/config/firebase";

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
   * Processes a document. DOCX and Digital PDFs are parsed locally.
   * Scanned PDFs and images are routed to the Firebase Cloud Functions backend
   * with duplicate protection and a 120s timeout.
   */
  async extractText(
    file: File, 
    onProgress: (status: string, progressPercent: number) => void,
    projectId: string,
    customerId: string,
    fileUrl: string,
    filePath: string
  ): Promise<OCRResult> {
    const startTime = performance.now();
    const fileType = file.name.split(".").pop()?.toLowerCase() || "";
    let extractionMethod = "Unknown";
    
    try {
      // 1. Direct Client-side parsing for DOCX
      if (fileType === "docx" || fileType === "doc") {
        onProgress("Reading document...", 10);
        const result = await DocumentProcessor.process(file, (p) => {
          onProgress(p.status, Math.round(10 + (p.progressPercent * 0.75)));
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
            confidenceScore: 100
          }
        };
      }

      // 2. Direct Client-side parsing for Digital PDF with Scanned PDF detection
      if (fileType === "pdf") {
        onProgress("Reading PDF layout...", 10);
        try {
          const result = await DocumentProcessor.process(file, (p) => {
            onProgress(p.status, Math.round(10 + (p.progressPercent * 0.75)));
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
              confidenceScore: 100
            }
          };
        } catch (err: any) {
          if (err.message === "SCANNED_PDF") {
            extractionMethod = "gemini_scanned_pdf";
          } else {
            throw err;
          }
        }
      } else if (["png", "jpg", "jpeg", "webp"].includes(fileType)) {
        extractionMethod = "gemini_image";
      } else {
        throw new Error(`Unsupported document extension: .${fileType}`);
      }

      // 3. Fallback Route: Firebase Cloud Functions backend execution
      onProgress("Checking duplicate scans...", 20);
      
      // Duplicate protection: Check if an active ocrJob exists for the same user and file details
      const ocrJobsRef = collection(db, "ocrJobs");
      const duplicateQuery = query(
        ocrJobsRef,
        where("customerId", "==", customerId),
        where("fileName", "==", file.name),
        where("fileSize", "==", file.size),
        where("status", "in", ["queued", "processing"])
      );
      
      const querySnap = await getDocs(duplicateQuery);
      let jobId = "";
      
      if (!querySnap.empty) {
        jobId = querySnap.docs[0].id;
        console.log(`Active OCR job found for file: ${file.name}. Subscribing to job ID: ${jobId}`);
      } else {
        // Create new OCR job document with 30-day retention metadata (Firestore Timestamp for TTL)
        const createdAt = new Date().toISOString();
        const expiresAt = Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
        
        const docRef = await addDoc(ocrJobsRef, {
          customerId,
          projectId,
          fileName: file.name,
          fileSize: file.size,
          fileType,
          filePath,
          fileUrl,
          mimeType: file.type || (fileType === "pdf" ? "application/pdf" : `image/${fileType}`),
          status: "queued",
          extractionMethod,
          createdAt,
          expiresAt,
          updatedAt: createdAt
        });
        jobId = docRef.id;
        console.log(`Created new OCR job ID: ${jobId}`);
      }

      // 4. Listen to Firestore job updates using onSnapshot
      return new Promise<OCRResult>((resolve, reject) => {
        const timeoutId = setTimeout(() => {
          unsubscribe();
          reject(new Error("processing_timeout"));
        }, 120000); // 120 seconds timeout limit

        const unsubscribe = onSnapshot(doc(db, "ocrJobs", jobId), (snapshot) => {
          if (!snapshot.exists()) return;
          const data = snapshot.data();

          if (data.status === "queued") {
            onProgress("Queued for analysis...", 30);
          } else if (data.status === "processing") {
            onProgress("Understanding assignment brief...", 65);
          } else if (data.status === "completed") {
            clearTimeout(timeoutId);
            unsubscribe();
            resolve({
              rawText: data.rawText || "",
              parsed: data.parsedFields || {},
              confidence: data.confidenceLevel || "low",
              ocrMetrics: data.ocrMetrics
            });
          } else if (data.status === "failed") {
            clearTimeout(timeoutId);
            unsubscribe();
            const err = new Error(data.error || "OCR extraction failed.");
            (err as any).ocrMetrics = data.ocrMetrics || { status: "Failure" };
            reject(err);
          }
        }, (err) => {
          clearTimeout(timeoutId);
          unsubscribe();
          reject(err);
        });
      });

    } catch (err: any) {
      console.error("ocrService.extractText failed:", err);
      const durationMs = Math.round(performance.now() - startTime);
      const failedMetrics = {
        fileType,
        extractionMethod,
        status: "Failure" as const,
        durationMs,
        confidenceScore: 0,
        errorReason: err.message === "processing_timeout" ? "processing_timeout" : "unknown_error"
      };
      (err as any).ocrMetrics = failedMetrics;
      throw err;
    }
  }
};
