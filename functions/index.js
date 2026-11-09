import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
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

async function writeAuditLog(actor, action, targetId, targetType, details) {
  try {
    await db.collection("auditLogs").add({
      actorId: actor.uid,
      actorName: actor.displayName || "Unknown",
      actorRole: actor.role || "unknown",
      action,
      targetId,
      targetType,
      details,
      createdAt: new Date().toISOString()
    });
  } catch (err) {
    console.error("Failed to persist security audit record:", err);
  }
}

/**
 * ============================================================================
 * PHASE 3: SECURE ASSIGNMENT WORKFLOW TRANSITIONS (Cloud Functions Gen 2)
 * ============================================================================
 */

/**
 * 1. fundassignment: Locks escrow funds for an assignment.
 * Only the customer who owns the assignment or an admin can trigger this.
 */
export const fundassignment = onCall(async (request) => {
  const caller = await getCallerProfile(request.auth);
  const { projectId } = request.data || {};
  if (!projectId) {
    throw new HttpsError("invalid-argument", "Missing required 'projectId'.");
  }

  const projRef = db.collection("assignments").doc(projectId);
  const timestamp = new Date().toISOString();

  return await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(projRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", `Project '${projectId}' does not exist.`);
    }

    const proj = snap.data();
    if (caller.role !== "admin" && proj.customerId !== caller.uid) {
      throw new HttpsError("permission-denied", "Only the project customer can fund this assignment.");
    }

    if (proj.status === "completed" || proj.status === "cancelled") {
      throw new HttpsError("failed-precondition", `Cannot fund a project with status '${proj.status}'.`);
    }

    const nextStatus = "funded";
    const historyEntry = {
      status: nextStatus,
      actorId: caller.uid,
      actorName: caller.displayName || "Customer",
      actorRole: caller.role,
      timestamp,
      note: "Escrow funds deposited and secured via backend verification."
    };

    transaction.update(projRef, {
      status: nextStatus,
      paymentStatus: "paid",
      payoutStatus: "escrowed",
      statusHistory: FieldValue.arrayUnion(historyEntry),
      updatedAt: timestamp
    });

    await writeAuditLog(caller, "ASSIGNMENT_FUNDED", projectId, "assignment", "Escrow successfully funded.");
    return { success: true, projectId, status: nextStatus, payoutStatus: "escrowed" };
  });
});

/**
 * 2. claimassignment: Verified specialist claims an open assignment.
 * Prevents race conditions and self-assignment by unauthorized roles.
 */
export const claimassignment = onCall(async (request) => {
  const caller = await getCallerProfile(request.auth);
  const { projectId } = request.data || {};
  if (!projectId) {
    throw new HttpsError("invalid-argument", "Missing required 'projectId'.");
  }

  if (caller.role !== "writer" && caller.role !== "proofreader" && caller.role !== "admin") {
    throw new HttpsError("permission-denied", "Only active specialists can claim assignments.");
  }

  if (caller.role !== "admin") {
    if (caller.verificationStatus !== "approved" || caller.writerStatus !== "active" || caller.isVerifiedWriter !== true) {
      throw new HttpsError("permission-denied", "You must be an approved, active verified specialist to claim assignments.");
    }
  }

  const projRef = db.collection("assignments").doc(projectId);
  const timestamp = new Date().toISOString();

  return await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(projRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", `Project '${projectId}' does not exist.`);
    }

    const proj = snap.data();
    if (proj.writerId && proj.writerId !== caller.uid) {
      throw new HttpsError("already-exists", "This assignment has already been claimed by another specialist.");
    }

    const eligibleStatuses = ["awaiting_assignment", "funded", "unassigned"];
    if (caller.role !== "admin" && !eligibleStatuses.includes(proj.status)) {
      throw new HttpsError("failed-precondition", `Assignment is not in an open claiming state (current: '${proj.status}').`);
    }

    const nextStatus = "assigned";
    const historyEntry = {
      status: nextStatus,
      actorId: caller.uid,
      actorName: caller.displayName || "Specialist",
      actorRole: caller.role,
      timestamp,
      note: "Specialist claimed assignment through secured backend service."
    };

    transaction.update(projRef, {
      status: nextStatus,
      writerId: caller.uid,
      writerName: caller.displayName || "Assigned Specialist",
      allocationStatus: "assigned",
      payoutStatus: proj.payoutStatus === "pending" ? "escrowed" : (proj.payoutStatus || "escrowed"),
      statusHistory: FieldValue.arrayUnion(historyEntry),
      updatedAt: timestamp
    });

    await writeAuditLog(caller, "ASSIGNMENT_CLAIMED", projectId, "assignment", `Assigned to specialist ${caller.uid}`);
    return { success: true, projectId, status: nextStatus, writerId: caller.uid };
  });
});

/**
 * 3. submitassignmentdraft: Writer uploads work for review.
 */
export const submitassignmentdraft = onCall(async (request) => {
  const caller = await getCallerProfile(request.auth);
  const { projectId, files, notes } = request.data || {};
  if (!projectId) {
    throw new HttpsError("invalid-argument", "Missing required 'projectId'.");
  }

  const projRef = db.collection("assignments").doc(projectId);
  const timestamp = new Date().toISOString();

  return await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(projRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", `Project '${projectId}' does not exist.`);
    }

    const proj = snap.data();
    if (caller.role !== "admin" && proj.writerId !== caller.uid) {
      throw new HttpsError("permission-denied", "Only the assigned specialist can submit drafts for this project.");
    }

    const validStates = ["assigned", "in_progress", "review_rejected"];
    if (caller.role !== "admin" && !validStates.includes(proj.status)) {
      throw new HttpsError("failed-precondition", `Cannot submit draft when status is '${proj.status}'.`);
    }

    const nextStatus = "draft_submitted";
    const historyEntry = {
      status: nextStatus,
      actorId: caller.uid,
      actorName: caller.displayName || "Specialist",
      actorRole: caller.role,
      timestamp,
      note: notes || "Draft submitted for proofreading."
    };

    const updatePayload = {
      status: nextStatus,
      statusHistory: FieldValue.arrayUnion(historyEntry),
      updatedAt: timestamp
    };
    if (Array.isArray(files) && files.length > 0) {
      updatePayload.files = files;
    }

    transaction.update(projRef, updatePayload);
    await writeAuditLog(caller, "ASSIGNMENT_DRAFT_SUBMITTED", projectId, "assignment", "Specialist submitted draft.");
    return { success: true, projectId, status: nextStatus };
  });
});

/**
 * 4. claimproofreadreview: Proofreader takes on auditing a submitted draft.
 * STRICT ENFORCEMENT OF SEPARATION OF DUTIES: Assigned writer CANNOT audit their own draft!
 */
export const claimproofreadreview = onCall(async (request) => {
  const caller = await getCallerProfile(request.auth);
  const { projectId } = request.data || {};
  if (!projectId) {
    throw new HttpsError("invalid-argument", "Missing required 'projectId'.");
  }

  if (caller.role !== "proofreader" && caller.role !== "writer" && caller.role !== "admin") {
    throw new HttpsError("permission-denied", "Only designated proofreaders can audit assignments.");
  }

  const projRef = db.collection("assignments").doc(projectId);
  const timestamp = new Date().toISOString();

  return await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(projRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", `Project '${projectId}' does not exist.`);
    }

    const proj = snap.data();

    // SEPARATION OF DUTIES ENFORCEMENT
    if (proj.writerId && caller.uid === proj.writerId) {
      throw new HttpsError(
        "failed-precondition",
        "Separation of duties violation: The assigned writer cannot review or audit their own work."
      );
    }

    if (proj.status !== "draft_submitted") {
      throw new HttpsError("failed-precondition", `Assignment must be 'draft_submitted' to claim review (current: '${proj.status}').`);
    }

    const nextStatus = "under_review";
    const historyEntry = {
      status: nextStatus,
      actorId: caller.uid,
      actorName: caller.displayName || "Proofreader",
      actorRole: caller.role,
      timestamp,
      note: "Proofreader claimed assignment for quality and academic integrity audit."
    };

    transaction.update(projRef, {
      status: nextStatus,
      proofreaderId: caller.uid,
      proofreaderName: caller.displayName || "Assigned Proofreader",
      statusHistory: FieldValue.arrayUnion(historyEntry),
      updatedAt: timestamp
    });

    await writeAuditLog(caller, "PROOFREAD_CLAIMED", projectId, "assignment", `Audit claimed by proofreader ${caller.uid}`);
    return { success: true, projectId, status: nextStatus, proofreaderId: caller.uid };
  });
});

/**
 * 5. rejectproofreadreview: Proofreader rejects draft and sends back with revision notes.
 * STRICT ENFORCEMENT OF SEPARATION OF DUTIES.
 */
export const rejectproofreadreview = onCall(async (request) => {
  const caller = await getCallerProfile(request.auth);
  const { projectId, reason } = request.data || {};
  if (!projectId) {
    throw new HttpsError("invalid-argument", "Missing required 'projectId'.");
  }

  const projRef = db.collection("assignments").doc(projectId);
  const timestamp = new Date().toISOString();

  return await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(projRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", `Project '${projectId}' does not exist.`);
    }

    const proj = snap.data();

    // SEPARATION OF DUTIES ENFORCEMENT
    if (proj.writerId && caller.uid === proj.writerId) {
      throw new HttpsError(
        "failed-precondition",
        "Separation of duties violation: The assigned writer cannot reject their own submission."
      );
    }

    if (caller.role !== "admin" && proj.proofreaderId && proj.proofreaderId !== caller.uid) {
      throw new HttpsError("permission-denied", "Only the assigned reviewer or admin can reject this draft.");
    }

    if (proj.status !== "under_review") {
      throw new HttpsError("failed-precondition", `Assignment is not currently 'under_review' (status: '${proj.status}').`);
    }

    const nextStatus = "review_rejected";
    const historyEntry = {
      status: nextStatus,
      actorId: caller.uid,
      actorName: caller.displayName || "Proofreader",
      actorRole: caller.role,
      timestamp,
      note: reason || "Draft rejected and returned to specialist for revision."
    };

    transaction.update(projRef, {
      status: nextStatus,
      statusHistory: FieldValue.arrayUnion(historyEntry),
      updatedAt: timestamp
    });

    await writeAuditLog(caller, "PROOFREAD_REJECTED", projectId, "assignment", `Draft rejected: ${reason || "Revision requested"}`);
    return { success: true, projectId, status: nextStatus };
  });
});

/**
 * 6. completeassignment: Proofreader or Admin approves completion and releases payout escrow.
 * STRICT ENFORCEMENT OF SEPARATION OF DUTIES.
 */
export const completeassignment = onCall(async (request) => {
  const caller = await getCallerProfile(request.auth);
  const { projectId } = request.data || {};
  if (!projectId) {
    throw new HttpsError("invalid-argument", "Missing required 'projectId'.");
  }

  const projRef = db.collection("assignments").doc(projectId);
  const timestamp = new Date().toISOString();

  return await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(projRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", `Project '${projectId}' does not exist.`);
    }

    const proj = snap.data();

    // SEPARATION OF DUTIES ENFORCEMENT
    if (proj.writerId && caller.uid === proj.writerId) {
      throw new HttpsError(
        "failed-precondition",
        "Separation of duties violation: The assigned writer cannot approve their own submission."
      );
    }

    if (caller.role !== "admin" && proj.proofreaderId && proj.proofreaderId !== caller.uid) {
      throw new HttpsError("permission-denied", "Only the assigned proofreader or admin can approve final completion.");
    }

    if (proj.status !== "under_review" && caller.role !== "admin") {
      throw new HttpsError("failed-precondition", `Project must be 'under_review' to complete (status: '${proj.status}').`);
    }

    const nextStatus = "completed";
    const historyEntry = {
      status: nextStatus,
      actorId: caller.uid,
      actorName: caller.displayName || "Reviewer",
      actorRole: caller.role,
      timestamp,
      note: "Assignment approved by reviewer. Escrow payout released."
    };

    // Update assignment
    transaction.update(projRef, {
      status: nextStatus,
      payoutStatus: "released",
      completedAt: timestamp,
      statusHistory: FieldValue.arrayUnion(historyEntry),
      updatedAt: timestamp
    });

    // Update writer statistics securely on server
    if (proj.writerId) {
      const writerRef = db.collection("users").doc(proj.writerId);
      transaction.update(writerRef, {
        completedCount: FieldValue.increment(1),
        completedAssignments: FieldValue.increment(1),
        updatedAt: timestamp
      });
    }

    await writeAuditLog(caller, "ASSIGNMENT_COMPLETED", projectId, "assignment", "Escrow released to specialist.");
    return { success: true, projectId, status: nextStatus, payoutStatus: "released" };
  });
});

/**
 * 7. cancelassignment: Customer or Admin cancels project; refunds escrow.
 */
export const cancelassignment = onCall(async (request) => {
  const caller = await getCallerProfile(request.auth);
  const { projectId, reason } = request.data || {};
  if (!projectId) {
    throw new HttpsError("invalid-argument", "Missing required 'projectId'.");
  }

  const projRef = db.collection("assignments").doc(projectId);
  const timestamp = new Date().toISOString();

  return await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(projRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", `Project '${projectId}' does not exist.`);
    }

    const proj = snap.data();
    if (caller.role !== "admin" && proj.customerId !== caller.uid) {
      throw new HttpsError("permission-denied", "Only the project customer or an admin can cancel this assignment.");
    }

    if (proj.status === "completed") {
      throw new HttpsError("failed-precondition", "Cannot cancel an assignment that is already completed.");
    }

    const nextStatus = "cancelled";
    const historyEntry = {
      status: nextStatus,
      actorId: caller.uid,
      actorName: caller.displayName || "User",
      actorRole: caller.role,
      timestamp,
      note: reason || "Project cancelled. Escrow returned if previously funded."
    };

    const payoutStatus = proj.payoutStatus === "escrowed" ? "refunded" : (proj.payoutStatus || "pending");

    transaction.update(projRef, {
      status: nextStatus,
      payoutStatus,
      statusHistory: FieldValue.arrayUnion(historyEntry),
      updatedAt: timestamp
    });

    await writeAuditLog(caller, "ASSIGNMENT_CANCELLED", projectId, "assignment", `Cancelled: ${reason || "No reason given"}`);
    return { success: true, projectId, status: nextStatus, payoutStatus };
  });
});

/**
 * ============================================================================
 * PHASE 4: SECURE RESEARCH REQUEST TRANSITIONS (Cloud Functions Gen 2)
 * ============================================================================
 */

/**
 * 8. submitresearchquote: Admin sets the official quote amount and notes.
 */
export const submitresearchquote = onCall(async (request) => {
  const caller = await getCallerProfile(request.auth);
  if (caller.role !== "admin") {
    throw new HttpsError("permission-denied", "Only administrators can issue formal research quotes.");
  }

  const { requestId, amount, notes } = request.data || {};
  if (!requestId || typeof amount !== "number" || amount <= 0) {
    throw new HttpsError("invalid-argument", "Valid requestId and positive numeric amount are required.");
  }

  const reqRef = db.collection("researchRequests").doc(requestId);
  const timestamp = new Date().toISOString();

  await reqRef.update({
    quoteAmount: amount,
    quoteNotes: notes || "",
    quoteStatus: "pending_acceptance",
    status: "quote_ready",
    adminReviewedBy: caller.uid,
    clarificationNeeded: false,
    updatedAt: timestamp
  });

  await writeAuditLog(caller, "RESEARCH_QUOTE_SUBMITTED", requestId, "research", `Quote issued: K${amount}`);
  return { success: true, requestId, quoteAmount: amount, status: "quote_ready" };
});

/**
 * 9. respondresearchquote: Student accepts or declines an issued quote.
 */
export const respondresearchquote = onCall(async (request) => {
  const caller = await getCallerProfile(request.auth);
  const { requestId, accepted } = request.data || {};
  if (!requestId || typeof accepted !== "boolean") {
    throw new HttpsError("invalid-argument", "Missing required 'requestId' or boolean 'accepted'.");
  }

  const reqRef = db.collection("researchRequests").doc(requestId);
  const timestamp = new Date().toISOString();

  return await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(reqRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", `Research request '${requestId}' does not exist.`);
    }

    const rData = snap.data();
    if (caller.role !== "admin" && rData.studentId !== caller.uid) {
      throw new HttpsError("permission-denied", "Only the student who submitted this request can respond to quotes.");
    }

    if (rData.status !== "quote_ready" || rData.quoteStatus !== "pending_acceptance") {
      throw new HttpsError("failed-precondition", "Request does not currently have a pending quote awaiting response.");
    }

    const nextStatus = accepted ? "awaiting_payment" : "submitted";
    const quoteStatus = accepted ? "accepted" : "rejected";

    transaction.update(reqRef, {
      quoteStatus,
      status: nextStatus,
      updatedAt: timestamp
    });

    await writeAuditLog(caller, "RESEARCH_QUOTE_DECISION", requestId, "research", `Student ${quoteStatus} the quote.`);
    return { success: true, requestId, status: nextStatus, quoteStatus };
  });
});

/**
 * 10. fundresearchrequest: Student deposits escrow for accepted research quote.
 */
export const fundresearchrequest = onCall(async (request) => {
  const caller = await getCallerProfile(request.auth);
  const { requestId } = request.data || {};
  if (!requestId) {
    throw new HttpsError("invalid-argument", "Missing required 'requestId'.");
  }

  const reqRef = db.collection("researchRequests").doc(requestId);
  const timestamp = new Date().toISOString();

  return await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(reqRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", `Research request '${requestId}' does not exist.`);
    }

    const rData = snap.data();
    if (caller.role !== "admin" && rData.studentId !== caller.uid) {
      throw new HttpsError("permission-denied", "Only the requesting student can fund this research project.");
    }

    if (rData.status !== "awaiting_payment" || rData.quoteStatus !== "accepted") {
      throw new HttpsError("failed-precondition", "Cannot fund research request unless quote is accepted and awaiting payment.");
    }

    transaction.update(reqRef, {
      status: "funded",
      quoteStatus: "paid",
      paymentStatus: "paid",
      updatedAt: timestamp
    });

    await writeAuditLog(caller, "RESEARCH_REQUEST_FUNDED", requestId, "research", `Escrow payment funded for research request ${requestId}.`);
    return { success: true, requestId, status: "funded", paymentStatus: "paid" };
  });
});

/**
 * 11. assignresearchwriter: Admin assigns research project to an expert.
 */
export const assignresearchwriter = onCall(async (request) => {
  const caller = await getCallerProfile(request.auth);
  if (caller.role !== "admin") {
    throw new HttpsError("permission-denied", "Only administrators can assign research projects.");
  }

  const { requestId, writerId } = request.data || {};
  if (!requestId || !writerId) {
    throw new HttpsError("invalid-argument", "Missing required 'requestId' or 'writerId'.");
  }

  const reqRef = db.collection("researchRequests").doc(requestId);
  const writerRef = db.collection("users").doc(writerId);
  const timestamp = new Date().toISOString();

  return await db.runTransaction(async (transaction) => {
    const [reqSnap, writerSnap] = await Promise.all([
      transaction.get(reqRef),
      transaction.get(writerRef)
    ]);

    if (!reqSnap.exists) {
      throw new HttpsError("not-found", `Research request '${requestId}' not found.`);
    }
    if (!writerSnap.exists) {
      throw new HttpsError("not-found", `Target specialist '${writerId}' not found.`);
    }

    transaction.update(reqRef, {
      assignedWriterId: writerId,
      status: "assigned",
      updatedAt: timestamp
    });

    await writeAuditLog(caller, "RESEARCH_WRITER_ASSIGNED", requestId, "research", `Assigned to expert ${writerId}.`);
    return { success: true, requestId, assignedWriterId: writerId, status: "assigned" };
  });
});

/**
 * ============================================================================
 * PHASE 5: SECURE ADMINISTRATIVE GOVERNANCE (Cloud Functions Gen 2)
 * ============================================================================
 */

/**
 * 12. adminapprovewriter: Administrator approves credentials and activates specialist.
 */
export const adminapprovewriter = onCall(async (request) => {
  const caller = await getCallerProfile(request.auth);
  if (caller.role !== "admin") {
    throw new HttpsError("permission-denied", "Only administrators can approve specialists.");
  }

  const { targetUid } = request.data || {};
  if (!targetUid) {
    throw new HttpsError("invalid-argument", "Missing required 'targetUid'.");
  }

  const userRef = db.collection("users").doc(targetUid);
  const timestamp = new Date().toISOString();

  return await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(userRef);
    if (!snap.exists) {
      throw new HttpsError("not-found", `User '${targetUid}' was not found.`);
    }

    const userData = snap.data();
    const historyEntry = {
      status: "approved",
      actorId: caller.uid,
      actorName: caller.displayName || "Administrator",
      actorRole: "admin",
      timestamp,
      note: "Credentials approved manually via administrative governance service."
    };

    transaction.update(userRef, {
      verificationStatus: "approved",
      writerStatus: "active",
      isVerifiedWriter: true,
      verifiedAt: timestamp,
      status: "active",
      availability: "available",
      profileCompletion: 100,
      reputation: userData.reputation || 0,
      completedCount: userData.completedCount || 0,
      statusHistory: FieldValue.arrayUnion(historyEntry),
      updatedAt: timestamp
    });

    await writeAuditLog(caller, "ADMIN_APPROVED_WRITER", targetUid, "user", `Specialist credentials approved by admin ${caller.uid}`);
    return { success: true, targetUid, verificationStatus: "approved", writerStatus: "active" };
  });
});

/**
 * 13. adminsuspenduser: Administrator suspends malicious or unverified user.
 */
export const adminsuspenduser = onCall(async (request) => {
  const caller = await getCallerProfile(request.auth);
  if (caller.role !== "admin") {
    throw new HttpsError("permission-denied", "Only administrators can suspend accounts.");
  }

  const { targetUid, reason } = request.data || {};
  if (!targetUid) {
    throw new HttpsError("invalid-argument", "Missing required 'targetUid'.");
  }

  const userRef = db.collection("users").doc(targetUid);
  const timestamp = new Date().toISOString();

  await userRef.update({
    status: "suspended",
    updatedAt: timestamp
  });

  await writeAuditLog(caller, "ADMIN_SUSPENDED_USER", targetUid, "user", `Suspended: ${reason || "Administrative security action"}`);
  return { success: true, targetUid, status: "suspended" };
});

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
