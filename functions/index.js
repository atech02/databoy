import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { getStorage } from "firebase-admin/storage";
import { GeminiFlashProvider } from "./providers.js";

initializeApp();
const db = getFirestore();
const storage = getStorage();

/**
 * ============================================================================
 * SECURITY HELPERS
 * ============================================================================
 */
async function getCallerProfile(auth) {
  if (!auth || !auth.uid) {
    throw new HttpsError("unauthenticated", "Authentication is required to perform this action.");
  }
  const userDoc = await db.collection("users").doc(auth.uid).get();
  if (!userDoc.exists) {
    throw new HttpsError("not-found", "Authenticated user profile was not found.");
  }
  return { uid: auth.uid, ...userDoc.data() };
}

function createDecommissionedCallable(functionName, replacementEndpoint) {
  return onCall(async (request) => {
    await getCallerProfile(request.auth);
    throw new HttpsError(
      "failed-precondition",
      `Legacy Cloud Function '${functionName}' is permanently decommissioned. Use the authoritative Express backend endpoint: ${replacementEndpoint}.`
    );
  });
}

/**
 * ============================================================================
 * PHASE 5.8 (AUDIT-02): DECOMMISSIONED LEGACY WORKFLOW & ADMIN CALLABLES
 * All state-mutating assignment, proofreading, research, payment, and user-role
 * workflows are exclusively governed by the authenticated Express backend API.
 * None of these callables may mutate Firestore state.
 * ============================================================================
 */

export const fundassignment = onCall(async (request) => {
  await getCallerProfile(request.auth);
  throw new HttpsError(
    "failed-precondition",
    "Direct assignment funding via Cloud Functions is permanently disabled. All payments must be verified via Lipila Mobile Money checkout (/api/payments/initiate)."
  );
});

export const claimassignment = createDecommissionedCallable("claimassignment", "POST /api/assignments/:id/claim");
export const submitassignmentdraft = createDecommissionedCallable("submitassignmentdraft", "POST /api/assignments/:id/submit");
export const claimproofreadreview = createDecommissionedCallable("claimproofreadreview", "POST /api/proofreading/:id/claim");
export const rejectproofreadreview = createDecommissionedCallable("rejectproofreadreview", "POST /api/proofreading/:id/reject");
export const completeassignment = createDecommissionedCallable("completeassignment", "POST /api/assignments/:id/approve");
export const cancelassignment = createDecommissionedCallable("cancelassignment", "POST /api/admin/disputes/:id/resolve");

export const submitresearchquote = createDecommissionedCallable("submitresearchquote", "POST /api/research/:id/quote");
export const respondresearchquote = createDecommissionedCallable("respondresearchquote", "POST /api/research/:id/respond-quote");

export const fundresearchrequest = onCall(async (request) => {
  await getCallerProfile(request.auth);
  throw new HttpsError(
    "failed-precondition",
    "Direct research funding via Cloud Functions is permanently disabled. All research payments must be verified via Lipila Mobile Money checkout (/api/payments/initiate)."
  );
});

export const assignresearchwriter = createDecommissionedCallable("assignresearchwriter", "POST /api/research/:id/assign");
export const adminapprovewriter = createDecommissionedCallable("adminapprovewriter", "POST /api/admin/writers/:uid/approve");
export const adminsuspenduser = createDecommissionedCallable("adminsuspenduser", "POST /api/admin/users/:uid/suspend");

/**
 * ============================================================================
 * OCR BACKGROUND TRIGGER
 * ============================================================================
 */
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
    // Stage E: Valid Firestore Timestamp for TTL retention policy
    const expiresAt = Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)); // 30 days TTL

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
    // Stage E: Valid Firestore Timestamp for TTL retention policy
    const expiresAt = Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));

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
