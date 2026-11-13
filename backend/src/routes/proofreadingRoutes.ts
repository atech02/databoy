import { Router, Request, Response, RequestHandler } from "express";
import { z } from "zod";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "../config/firebaseAdmin.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { requireRole, requireProofreadCapability } from "../middleware/roleGuard.js";
import { RateLimiterBundle } from "../middleware/rateLimit.js";
import { logAuditEvent } from "../services/auditService.js";
import { createNotification } from "../services/notificationService.js";
import { ledgerService } from "../services/ledgerService.js";
import { performanceService } from "../services/performanceService.js";

const noopMiddleware: RequestHandler = (_req, _res, next) => next();

const submitProofreadingSchema = z.object({
  fileUrl: z.string().optional(),
  submissionUrl: z.string().optional(),
  fileId: z.string().optional(),
  storageKey: z.string().optional(),
  fileName: z.string().optional(),
  notes: z.string().optional(),
}).refine(data => data.fileUrl || data.submissionUrl || data.fileId || data.storageKey, {
  message: "Either fileUrl, submissionUrl, fileId, or storageKey is required",
});

const returnProofreadingSchema = z.object({
  feedback: z.string().min(5),
});

export function createProofreadingRouter(limiters?: RateLimiterBundle): Router {
  const router = Router();
  const writerActionLimit = limiters?.writerAction || noopMiddleware;
  const uploadLimit = limiters?.fileUpload || noopMiddleware;

/**
 * GET /api/proofreading/pool
 * Eligible proofreaders browse open proofreading tasks.
 * Strict exclusion of tasks originated by the caller.
 */
router.get(
  "/pool",
  authMiddleware,
  requireProofreadCapability,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const user = req.user!;
      const snap = await adminDb
        .collection("proofreadingTasks")
        .where("status", "==", "available")
        .limit(50)
        .get();

      // Exclude any tasks where the caller is the original author
      const tasks = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((t: any) => t.originalWriterId !== user.uid);

      res.status(200).json({ tasks });
    } catch (err: any) {
      console.error("[ProofreadingRoutes] Pool error:", err);
      res.status(500).json({ error: "Failed to fetch proofreading pool" });
    }
  }
);

/**
 * POST /api/proofreading/:taskId/claim
 * Certified proofreader claims an open proofreading task.
 * STRICT SEPARATION OF DUTIES: Original writer CANNOT claim.
 */
router.post(
  "/:taskId/claim",
  authMiddleware,
  writerActionLimit,
  requireProofreadCapability,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const taskId = req.params.taskId as string;
      const user = req.user!;

      if (user.status === "suspended" || (user as any).performanceReviewStatus === "suspended") {
        res.status(403).json({ error: "Suspended proofreaders cannot claim tasks" });
        return;
      }

      const taskRef = adminDb.collection("proofreadingTasks").doc(taskId);

      const result = await adminDb.runTransaction(async (transaction) => {
        const snap = await transaction.get(taskRef);
        if (!snap.exists) throw new Error("NOT_FOUND");

        const task = snap.data()!;
        if (task.originalWriterId === user.uid) throw new Error("SEPARATION_OF_DUTIES_VIOLATION");
        if (task.status !== "available" && task.status !== "unassigned") throw new Error("NOT_AVAILABLE");

        const now = new Date().toISOString();
        const asgRef = adminDb.collection("assignments").doc(task.assignmentId);

        transaction.update(taskRef, {
          status: "claimed",
          proofreaderId: user.uid,
          proofreaderEmail: user.email,
          claimedAt: now,
          updatedAt: now,
        });

        transaction.update(asgRef, {
          proofreaderId: user.uid,
          status: "under_review",
          updatedAt: now,
        });

        return { assignmentId: task.assignmentId, title: task.title || "Assignment" };
      });

      await logAuditEvent({
        action: "proofreading_task_claimed",
        actorId: user.uid,
        actorRole: user.role,
        targetId: taskId,
        details: { assignmentId: result.assignmentId },
        ip: req.ip as string | undefined,
      });

      res.status(200).json({ success: true, message: "Proofreading task claimed" });
    } catch (err: any) {
      if (err.message === "NOT_FOUND") {
        res.status(404).json({ error: "Proofreading task not found" });
        return;
      }
      if (err.message === "SEPARATION_OF_DUTIES_VIOLATION") {
        res.status(403).json({ error: "Separation of duties: You cannot proofread your own assignment" });
        return;
      }
      if (err.message === "NOT_AVAILABLE") {
        res.status(409).json({ error: "Task is no longer available" });
        return;
      }
      console.error("[ProofreadingRoutes] Claim error:", err);
      res.status(500).json({ error: "Failed to claim proofreading task" });
    }
  }
);

/**
 * POST /api/proofreading/:taskId/submit
 * Proofreader submits the corrected document for administrative review.
 */
router.post(
  "/:taskId/submit",
  authMiddleware,
  uploadLimit,
  requireProofreadCapability,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const taskId = req.params.taskId as string;
      const user = req.user!;
      const parsed = submitProofreadingSchema.safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: "Invalid submission payload", details: parsed.error.format() });
        return;
      }

      const finalUrl = parsed.data.fileUrl || parsed.data.submissionUrl || "";
      const fileId = parsed.data.fileId;
      const storageKey = parsed.data.storageKey;
      const fileName = parsed.data.fileName;
      const notes = parsed.data.notes;
      const taskRef = adminDb.collection("proofreadingTasks").doc(taskId);

      const result = await adminDb.runTransaction(async (transaction) => {
        const snap = await transaction.get(taskRef);
        if (!snap.exists) throw new Error("NOT_FOUND");

        const task = snap.data()!;
        if (task.proofreaderId !== user.uid) throw new Error("FORBIDDEN");

        const now = new Date().toISOString();
        const asgRef = adminDb.collection("assignments").doc(task.assignmentId);

        transaction.update(taskRef, {
          status: "submitted",
          submissionUrl: finalUrl,
          proofreaderSubmissionUrl: finalUrl,
          proofreadDocumentUrl: finalUrl,
          ...(fileId ? { proofreadFileId: fileId } : {}),
          ...(storageKey ? { proofreadStorageKey: storageKey } : {}),
          ...(fileName ? { proofreadFileName: fileName } : {}),
          proofreaderNotes: notes || "",
          submittedAt: now,
          updatedAt: now,
        });

        transaction.update(asgRef, {
          proofreadDocumentUrl: finalUrl,
          ...(fileId ? { proofreadFileId: fileId } : {}),
          ...(storageKey ? { proofreadStorageKey: storageKey } : {}),
          ...(fileName ? { proofreadFileName: fileName } : {}),
          status: "under_review",
          updatedAt: now,
        });

        return { assignmentId: task.assignmentId, title: task.title };
      });

      await logAuditEvent({
        action: "proofreading_submitted",
        actorId: user.uid,
        actorRole: user.role,
        targetId: taskId,
        details: { fileUrl: finalUrl },
        ip: req.ip as string | undefined,
      });

      res.status(200).json({ success: true, message: "Proofreading submission received" });
    } catch (err: any) {
      if (err.message === "NOT_FOUND") {
        res.status(404).json({ error: "Proofreading task not found" });
        return;
      }
      if (err.message === "FORBIDDEN") {
        res.status(403).json({ error: "Only the allocated proofreader can submit" });
        return;
      }
      console.error("[ProofreadingRoutes] Submit error:", err);
      res.status(500).json({ error: "Failed to submit proofreading" });
    }
  }
);

/**
 * POST /api/proofreading/:taskId/approve
 * Admin reviews and approves the proofreading submission.
 * Completes assignment, releases payouts to writer and proofreader, and delivers work.
 */
router.post(
  "/:taskId/approve",
  authMiddleware,
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const taskId = req.params.taskId as string;
      const user = req.user!;

      if (user.status === "suspended" || (user as any).performanceReviewStatus === "suspended") {
        res.status(403).json({ error: "Suspended proofreaders cannot claim tasks" });
        return;
      }

      const taskRef = adminDb.collection("proofreadingTasks").doc(taskId);

      const result = await adminDb.runTransaction(async (transaction) => {
        const snap = await transaction.get(taskRef);
        if (!snap.exists) throw new Error("NOT_FOUND");

        const task = snap.data()!;
        const asgRef = adminDb.collection("assignments").doc(task.assignmentId);
        const asgSnap = await transaction.get(asgRef);
        if (!asgSnap.exists) throw new Error("ASSIGNMENT_NOT_FOUND");

        const asg = asgSnap.data()!;
        const now = new Date().toISOString();

        const escrowResult = await ledgerService.releaseAssignmentEscrowInTransaction(transaction, {
          assignmentId: task.assignmentId,
          budget: Number(asg.budget || 0),
          writerId: task.originalWriterId,
          writerEmail: task.originalWriterEmail || asg.writerEmail || "",
          proofreaderId: task.proofreaderId || null,
          proofreaderEmail: task.proofreaderEmail || "",
          now,
          metadata: { taskId, approvedBy: user.uid },
        });

        transaction.update(taskRef, {
          status: "approved",
          approvedAt: now,
          approvedBy: user.uid,
          updatedAt: now,
        });

        transaction.update(asgRef, {
          status: "completed",
          payoutStatus: "released",
          escrowStatus: "released",
          finalFileUrl: task.proofreadDocumentUrl || asg.draftFileUrl || null,
          completedAt: asg.completedAt || now,
          updatedAt: now,
        });

        return {
          assignmentId: task.assignmentId,
          customerId: asg.customerId,
          originalWriterId: task.originalWriterId,
          originalWriterEmail: task.originalWriterEmail || asg.writerEmail || "",
          proofreaderId: task.proofreaderId || null,
          proofreaderEmail: task.proofreaderEmail || "",
          budget: Number(asg.budget || 0),
          title: asg.title,
          alreadyReleased: escrowResult.alreadyReleased,
        };
      });

      await logAuditEvent({
        action: "proofreading_approved_and_completed",
        actorId: user.uid,
        actorRole: user.role,
        targetId: taskId,
        details: { assignmentId: result.assignmentId, budget: result.budget },
        ip: req.ip as string | undefined,
      });

      if (!result.alreadyReleased) {
        if (result.proofreaderId) {
          try {
            await performanceService.recordTaskCompletion({
              userId: result.proofreaderId,
              taskType: "proofreading",
              taskId,
              taskTitle: result.title,
              actorId: user.uid,
              actorRole: user.role,
            });
          } catch (pErr) {
            console.error("[ProofreadingRoutes] Error updating proofreader performance:", pErr);
          }
        }
        if (result.originalWriterId) {
          try {
            await performanceService.recordTaskCompletion({
              userId: result.originalWriterId,
              taskType: "writing",
              taskId: result.assignmentId,
              taskTitle: result.title,
              actorId: user.uid,
              actorRole: user.role,
            });
          } catch (pErr) {
            console.error("[ProofreadingRoutes] Error updating writer performance:", pErr);
          }
        }
      }

      // Notify customer of final delivery
      await createNotification({
        userId: result.customerId,
        title: "Assignment Completed & Ready",
        message: `Your assignment "${result.title}" has passed full quality review and is ready for download!`,
        type: "assignment",
        link: `/app/assignments/${result.assignmentId}`,
      });

      // Notify writer
      if (result.originalWriterId) {
        await createNotification({
          userId: result.originalWriterId,
          title: "Earnings Released",
          message: `Your draft for "${result.title}" was approved. Author earnings credited!`,
          type: "payment",
          link: `/app/assignments/${result.assignmentId}`,
        });
      }

      // Notify proofreader
      if (result.proofreaderId) {
        await createNotification({
          userId: result.proofreaderId,
          title: "Proofreading Payout Released",
          message: `Your proofreading review for "${result.title}" was approved. Payout credited!`,
          type: "payment",
          link: `/app/assignments/${result.assignmentId}`,
        });
      }

      res.status(200).json({ success: true, message: "Proofreading approved and payouts released" });
    } catch (err: any) {
      if (err.message === "NOT_FOUND" || err.message === "ASSIGNMENT_NOT_FOUND") {
        res.status(404).json({ error: "Task or assignment not found" });
        return;
      }
      console.error("[ProofreadingRoutes] Approve error:", err);
      res.status(500).json({ error: "Failed to approve proofreading" });
    }
  }
);

/**
 * POST /api/proofreading/:taskId/return
 * Admin returns the proofread document with feedback.
 */
router.post(
  "/:taskId/return",
  authMiddleware,
  requireRole("admin"),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const taskId = req.params.taskId as string;
      const user = req.user!;
      const parsed = returnProofreadingSchema.safeParse(req.body);

      if (!parsed.success) {
        res.status(400).json({ error: "Feedback required", details: parsed.error.format() });
        return;
      }

      const { feedback } = parsed.data;
      const taskRef = adminDb.collection("proofreadingTasks").doc(taskId);

      const result = await adminDb.runTransaction(async (transaction) => {
        const snap = await transaction.get(taskRef);
        if (!snap.exists) throw new Error("NOT_FOUND");

        const task = snap.data()!;
        const now = new Date().toISOString();

        transaction.update(taskRef, {
          status: "returned",
          adminFeedback: feedback,
          updatedAt: now,
        });

        return { proofreaderId: task.proofreaderId, title: task.title };
      });

      await logAuditEvent({
        action: "proofreading_returned",
        actorId: user.uid,
        actorRole: user.role,
        targetId: taskId,
        details: { feedback },
        ip: req.ip as string | undefined,
      });

      if (result.proofreaderId) {
        await createNotification({
          userId: result.proofreaderId,
          title: "Proofreading Returned",
          message: `Admin requested revisions on "${result.title}": ${feedback}`,
          type: "review",
        });
      }

      res.status(200).json({ success: true, message: "Proofreading returned with feedback" });
    } catch (err: any) {
      if (err.message === "NOT_FOUND") {
        res.status(404).json({ error: "Proofreading task not found" });
        return;
      }
      console.error("[ProofreadingRoutes] Return error:", err);
      res.status(500).json({ error: "Failed to return proofreading" });
    }
  }
);

  return router;
}

export default createProofreadingRouter();
