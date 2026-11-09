import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { GeminiFlashProvider } from "./providers.js";

initializeApp();
const db = getFirestore();
const storage = getStorage();

export const processocrjob = onDocumentCreated({
  document: "ocrJobs/{jobId}",
  secrets: ["GEMINI_API_KEY"],
  timeoutSeconds: 120
}, async (event) => {
  const snapshot = event.data;
  if (!snapshot) {
    console.log("No snapshot data found.");
    return;
  }

  const jobData = snapshot.data();
  const jobId = event.params.jobId;

  // Only process if status is queued
  if (jobData.status !== "queued") {
    console.log(`Job ${jobId} is not queued. Status is ${jobData.status}. Skipping.`);
    return;
  }

  const jobRef = db.collection("ocrJobs").doc(jobId);
  const startTime = Date.now();

  try {
    // 1. Transition to processing
    await jobRef.update({
      status: "processing",
      updatedAt: new Date().toISOString()
    });

    // 2. Setup 115s timeout promise to guarantee fail-safe write
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => {
        const err = new Error("Job execution exceeded maximum allowed duration of 120 seconds.");
        err.name = "TimeoutError";
        reject(err);
      }, 112000); // 112 seconds
    });

    // 3. Process workload
    const processPromise = (async () => {
      const bucket = storage.bucket();
      const file = bucket.file(jobData.filePath);

      console.log(`Downloading file: ${jobData.filePath} from bucket: ${bucket.name}`);
      const [fileBuffer] = await file.download();

      console.log(`Invoking AssignmentUnderstandingProvider for job ${jobId}`);
      const provider = new GeminiFlashProvider();
      const apiKey = process.env.GEMINI_API_KEY;

      const result = await provider.understandAssignment(fileBuffer, jobData.mimeType, apiKey);
      return result;
    })();

    // Race processing against timeout
    const result = await Promise.race([processPromise, timeoutPromise]);

    // 4. Calculate completeness score (Revision 9)
    let completenessScore = 0;
    const completenessDetails = [];

    const hasQuestions = !!(result.parsedFields.questions && result.parsedFields.questions.trim().length > 10);
    completenessScore += hasQuestions ? 40 : 0;
    completenessDetails.push({ field: "questions", found: hasQuestions });

    const hasInstructions = !!(result.parsedFields.instructions && result.parsedFields.instructions.trim().length > 10);
    completenessScore += hasInstructions ? 20 : 0;
    completenessDetails.push({ field: "instructions", found: hasInstructions });

    const hasWordCount = typeof result.parsedFields.wordCount === "number" && result.parsedFields.wordCount > 0;
    completenessScore += hasWordCount ? 10 : 0;
    completenessDetails.push({ field: "wordCount", found: hasWordCount });

    const hasRef = !!(result.parsedFields.referencingStyle && result.parsedFields.referencingStyle.trim().length > 0);
    completenessScore += hasRef ? 10 : 0;
    completenessDetails.push({ field: "referencingStyle", found: hasRef });

    const hasDeadline = !!(result.parsedFields.deadline && result.parsedFields.deadline.trim().length > 0);
    completenessScore += hasDeadline ? 10 : 0;
    completenessDetails.push({ field: "deadline", found: hasDeadline });

    const hasTitle = !!(result.parsedFields.title && result.parsedFields.title.trim().length > 4);
    completenessScore += hasTitle ? 10 : 0;
    completenessDetails.push({ field: "title", found: hasTitle });

    // 5. Determine Platform Confidence Level (Revision 6)
    let confidenceLevel = "low";
    if (completenessScore >= 80) {
      confidenceLevel = "high";
    } else if (completenessScore >= 50) {
      confidenceLevel = "medium";
    }

    const durationMs = Date.now() - startTime;
    const completedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days TTL

    const ocrMetrics = {
      fileType: jobData.fileType,
      extractionMethod: jobData.extractionMethod,
      status: "Success",
      durationMs,
      confidenceScore: completenessScore,
      completenessScore,
      completenessDetails,
      modelUsed: result.metrics.modelUsed,
      tokenUsage: result.metrics.tokenUsage,
      requestCostEstimate: result.metrics.requestCostEstimate
    };

    // 6. Write final result back to ocrJobs
    await jobRef.update({
      status: "completed",
      completedAt,
      expiresAt,
      rawText: result.rawText,
      parsedFields: result.parsedFields,
      confidenceLevel,
      ocrMetrics,
      updatedAt: completedAt
    });

    // 7. Store results inside the Project document if associated (Revision 2)
    if (jobData.projectId) {
      const projRef = db.collection("assignments").doc(jobData.projectId);
      const projSnap = await projRef.get();
      if (projSnap.exists) {
        console.log(`Writing OCR results directly to project: ${jobData.projectId}`);
        await projRef.update({
          ocrText: result.rawText,
          ocrParsedFields: result.parsedFields,
          ocrMetrics: ocrMetrics,
          extractionMethod: jobData.extractionMethod,
          confidenceLevel: confidenceLevel,
          updatedAt: new Date().toISOString()
        });
      }
    }

    console.log(`OCR Job ${jobId} completed successfully in ${durationMs}ms`);

  } catch (error) {
    console.error(`OCR Job ${jobId} failed:`, error);

    let errorReason = "unknown_error";
    if (error.name === "TimeoutError") {
      errorReason = "processing_timeout";
    } else if (error.message && error.message.includes("large")) {
      errorReason = "document_too_large";
    }

    const completedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

    await jobRef.update({
      status: "failed",
      completedAt,
      expiresAt,
      error: error.message || String(error),
      errorReason,
      ocrMetrics: {
        fileType: jobData.fileType,
        extractionMethod: jobData.extractionMethod,
        status: "Failure",
        durationMs: Date.now() - startTime,
        confidenceScore: 0,
        errorReason
      },
      updatedAt: completedAt
    });

    // Write failure back to project if associated
    if (jobData.projectId) {
      const projRef = db.collection("assignments").doc(jobData.projectId);
      const projSnap = await projRef.get();
      if (projSnap.exists) {
        await projRef.update({
          ocrMetrics: {
            fileType: jobData.fileType,
            extractionMethod: jobData.extractionMethod,
            status: "Failure",
            durationMs: Date.now() - startTime,
            confidenceScore: 0,
            errorReason
          },
          updatedAt: new Date().toISOString()
        });
      }
    }
  }
});
