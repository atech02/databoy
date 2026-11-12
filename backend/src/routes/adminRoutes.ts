import { Router, Request, Response } from "express";
import { adminDb } from "../config/firebaseAdmin.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/roleGuard.js";
import { logAuditEvent } from "../services/auditService.js";
import { createNotification } from "../services/notificationService.js";
import { ledgerService } from "../services/ledgerService.js";

const router = Router();

// All admin routes require admin role
router.use(authMiddleware, requireRole("admin"));

/**
 * POST /api/admin/writers/:uid/approve
 * Admin approves a writer application, elevating their role to writer.
 */
router.post("/writers/:uid/approve", async (req: Request, res: Response): Promise<void> => {
  try {
    const uid = req.params.uid as string;
    const { grantProofreading } = req.body;
    const user = req.user!;
    const userRef = adminDb.collection("users").doc(uid);
    const now = new Date().toISOString();

    const snap = await userRef.get();
    if (!snap.exists) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const capabilities = ["writing"];
    if (grantProofreading) {
      capabilities.push("proofreading");
    }

    await userRef.update({
      role: "writer",
      status: "active",
      verificationStatus: "approved",
      isVerifiedWriter: true,
      canProofread: !!grantProofreading,
      specialistCapabilities: capabilities,
      verifiedAt: now,
      updatedAt: now,
    });

    await logAuditEvent({
      action: "writer_approved",
      actorId: user.uid,
      actorRole: user.role,
      targetId: uid,
      details: { grantProofreading: !!grantProofreading },
      ip: req.ip,
    });

    await createNotification({
      userId: uid,
      title: "Writer Application Approved",
      message: `Congratulations! Your writer application has been approved.${
        grantProofreading ? " You have also been certified as a Proofreader." : ""
      }`,
      type: "system",
      link: "/app/writer",
    });

    res.status(200).json({ success: true, message: "Writer approved successfully" });
  } catch (err: any) {
    console.error("[AdminRoutes] Approve writer error:", err);
    res.status(500).json({ error: "Failed to approve writer" });
  }
});

/**
 * POST /api/admin/writers/:uid/reject
 * Admin rejects a writer application.
 */
router.post("/writers/:uid/reject", async (req: Request, res: Response): Promise<void> => {
  try {
    const uid = req.params.uid as string;
    const { reason } = req.body;
    const user = req.user!;
    const userRef = adminDb.collection("users").doc(uid);
    const now = new Date().toISOString();

    const snap = await userRef.get();
    if (!snap.exists) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    await userRef.update({
      verificationStatus: "rejected",
      rejectionReason: reason || "Did not meet criteria",
      rejectedAt: now,
      updatedAt: now,
    });

    await logAuditEvent({
      action: "writer_rejected",
      actorId: user.uid,
      actorRole: user.role,
      targetId: uid,
      details: { reason },
      ip: req.ip,
    });

    await createNotification({
      userId: uid,
      title: "Writer Application Update",
      message: `Your application could not be approved at this time: ${reason || "Criteria not met"}`,
      type: "system",
    });

    res.status(200).json({ success: true, message: "Writer application rejected" });
  } catch (err: any) {
    console.error("[AdminRoutes] Reject writer error:", err);
    res.status(500).json({ error: "Failed to reject writer application" });
  }
});

/**
 * POST /api/admin/users/:uid/suspend
 * Admin suspends a user account.
 */
router.post("/users/:uid/suspend", async (req: Request, res: Response): Promise<void> => {
  try {
    const uid = req.params.uid as string;
    const { reason } = req.body;
    const user = req.user!;
    const userRef = adminDb.collection("users").doc(uid);
    const now = new Date().toISOString();

    const snap = await userRef.get();
    if (!snap.exists) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    if (snap.data()?.role === "admin") {
      res.status(400).json({ error: "Cannot suspend administrative accounts" });
      return;
    }

    await userRef.update({
      status: "suspended",
      suspendedReason: reason || "Administrative action",
      suspendedAt: now,
      updatedAt: now,
    });

    await logAuditEvent({
      action: "user_suspended",
      actorId: user.uid,
      actorRole: user.role,
      targetId: uid,
      details: { reason },
      ip: req.ip,
    });

    res.status(200).json({ success: true, message: "User suspended" });
  } catch (err: any) {
    console.error("[AdminRoutes] Suspend user error:", err);
    res.status(500).json({ error: "Failed to suspend user" });
  }
});

/**
 * POST /api/admin/users/:uid/activate
 * Admin activates / unsuspends a user account.
 */
router.post("/users/:uid/activate", async (req: Request, res: Response): Promise<void> => {
  try {
    const uid = req.params.uid as string;
    const user = req.user!;
    const userRef = adminDb.collection("users").doc(uid);
    const now = new Date().toISOString();

    const snap = await userRef.get();
    if (!snap.exists) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    await userRef.update({
      status: "active",
      suspendedReason: null,
      updatedAt: now,
    });

    await logAuditEvent({
      action: "user_activated",
      actorId: user.uid,
      actorRole: user.role,
      targetId: uid,
      ip: req.ip,
    });

    res.status(200).json({ success: true, message: "User activated" });
  } catch (err: any) {
    console.error("[AdminRoutes] Activate user error:", err);
    res.status(500).json({ error: "Failed to activate user" });
  }
});

/**
 * POST /api/admin/users/:uid/role
 * Admin changes a user's role within the three-role domain model (customer, writer, admin).
 */
router.post("/users/:uid/role", async (req: Request, res: Response): Promise<void> => {
  try {
    const uid = req.params.uid as string;
    const { role } = req.body || {};
    const user = req.user!;

    if (!["customer", "writer", "admin"].includes(role)) {
      res.status(400).json({ error: "Invalid role. Supported roles are customer, writer, and admin." });
      return;
    }

    const userRef = adminDb.collection("users").doc(uid);
    const snap = await userRef.get();
    if (!snap.exists) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const now = new Date().toISOString();
    await userRef.update({
      role,
      updatedAt: now,
    });

    await logAuditEvent({
      action: "user_role_changed",
      actorId: user.uid,
      actorRole: user.role,
      targetId: uid,
      details: { previousRole: snap.data()?.role || null, newRole: role },
      ip: req.ip,
    });

    res.status(200).json({ success: true, role, message: "User role updated" });
  } catch (err: any) {
    console.error("[AdminRoutes] Role change error:", err);
    res.status(500).json({ error: "Failed to change user role" });
  }
});

/**
 * GET /api/admin/audit-logs
 * Fetch recent audit logs.
 */
router.get("/audit-logs", async (req: Request, res: Response): Promise<void> => {
  try {
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 50));
    const snap = await adminDb.collection("auditLogs").orderBy("timestamp", "desc").limit(limit).get();

    const logs = snap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));

    res.status(200).json({ auditLogs: logs });
  } catch (err: any) {
    console.error("[AdminRoutes] Fetch audit logs error:", err);
    res.status(500).json({ error: "Failed to fetch audit logs" });
  }
});

/**
 * GET /api/admin/analytics
 * Real-time operational platform statistics derived directly from Firestore data.
 */
router.get("/analytics", async (_req: Request, res: Response): Promise<void> => {
  try {
    const [usersSnap, assignmentsSnap, proofreadingSnap, disputesSnap, ledgerSnap, payoutsSnap] = await Promise.all([
      adminDb.collection("users").get(),
      adminDb.collection("assignments").get(),
      adminDb.collection("proofreadingTasks").get(),
      adminDb.collection("disputes").get(),
      adminDb.collection("ledger").get(),
      adminDb.collection("payoutRequests").get(),
    ]);

    const now = new Date();

    // 1. Users metrics
    let totalCustomers = 0;
    let totalWriters = 0;
    let pendingApplications = 0;
    let activeWriters = 0;
    let suspendedUsers = 0;

    usersSnap.docs.forEach((d) => {
      const u = d.data();
      if (u.role === "customer") totalCustomers++;
      if (u.role === "writer") {
        totalWriters++;
        if (u.status === "active") activeWriters++;
      }
      if (u.verificationStatus === "pending_review") pendingApplications++;
      if (u.status === "suspended") suspendedUsers++;
    });

    // 2. Assignments metrics
    let totalAssignments = assignmentsSnap.size;
    let unclaimedAssignments = 0;
    let activeWritingAssignments = 0;
    let completedWritingAssignments = 0;
    let overdueAssignments = 0;
    let completedDeliveries = 0;

    assignmentsSnap.docs.forEach((d) => {
      const a = d.data();
      if (a.status === "funded" && !a.writerId) unclaimedAssignments++;
      if (["assigned", "in_progress"].includes(a.status)) activeWritingAssignments++;
      if (["under_review", "review_rejected", "completed"].includes(a.status)) completedWritingAssignments++;
      if (a.status === "completed") completedDeliveries++;

      if (a.deadline && ["assigned", "in_progress", "under_review"].includes(a.status)) {
        const dDate = new Date(a.deadline);
        if (dDate < now) overdueAssignments++;
      }
    });

    // 3. Proofreading tasks metrics
    let activeProofreadingAssignments = 0;
    let completedProofreadingAssignments = 0;
    let pendingAdminReviews = 0;

    proofreadingSnap.docs.forEach((d) => {
      const t = d.data();
      if (["available", "claimed"].includes(t.status)) activeProofreadingAssignments++;
      if (t.status === "approved") completedProofreadingAssignments++;
      if (t.status === "submitted_for_admin_review") pendingAdminReviews++;
    });

    // 4. Disputes metrics
    let openDisputes = 0;
    disputesSnap.docs.forEach((d) => {
      if (d.data().status === "open") openDisputes++;
    });

    // 5. Financial ledger metrics
    let totalVerifiedRevenue = 0;
    let platformCommission = 0;
    let writerEarnings = 0;
    let proofreaderEarnings = 0;

    ledgerSnap.docs.forEach((d) => {
      const l = d.data();
      const amount = Number(l.amount || 0);
      if (l.type === "customer_payment") totalVerifiedRevenue += amount;
      if (l.type === "platform_fee") platformCommission += amount;
      if (l.type === "writer_earning") writerEarnings += amount;
      if (l.type === "proofreader_earning") proofreaderEarnings += amount;
    });

    // 6. Payouts metrics
    let pendingPayouts = 0;
    let pendingPayoutsAmount = 0;
    let completedPayouts = 0;
    let completedPayoutsAmount = 0;

    payoutsSnap.docs.forEach((d) => {
      const p = d.data();
      const amount = Number(p.amount || 0);
      if (p.status === "pending") {
        pendingPayouts++;
        pendingPayoutsAmount += amount;
      }
      if (p.status === "completed") {
        completedPayouts++;
        completedPayoutsAmount += amount;
      }
    });

    res.status(200).json({
      analytics: {
        totalCustomers,
        totalWriters,
        pendingApplications,
        activeWriters,
        suspendedUsers,
        totalAssignments,
        unclaimedAssignments,
        activeWritingAssignments,
        completedWritingAssignments,
        activeProofreadingAssignments,
        completedProofreadingAssignments,
        pendingAdminReviews,
        overdueAssignments,
        completedDeliveries,
        openDisputes,
        totalVerifiedRevenue: parseFloat(totalVerifiedRevenue.toFixed(2)),
        platformCommission: parseFloat(platformCommission.toFixed(2)),
        writerEarnings: parseFloat(writerEarnings.toFixed(2)),
        proofreaderEarnings: parseFloat(proofreaderEarnings.toFixed(2)),
        pendingPayouts,
        pendingPayoutsAmount: parseFloat(pendingPayoutsAmount.toFixed(2)),
        completedPayouts,
        completedPayoutsAmount: parseFloat(completedPayoutsAmount.toFixed(2)),
        revenue: {
          totalCustomerPayments: parseFloat(totalVerifiedRevenue.toFixed(2)),
          totalPlatformCommission: parseFloat(platformCommission.toFixed(2)),
          totalWriterEarnings: parseFloat(writerEarnings.toFixed(2)),
          totalProofreaderEarnings: parseFloat(proofreaderEarnings.toFixed(2)),
          totalWriterPaidOut: parseFloat(completedPayoutsAmount.toFixed(2)),
          pendingPayoutsAmount: parseFloat(pendingPayoutsAmount.toFixed(2)),
        },
        proofreading: {
          totalTasks: proofreadingSnap.size,
          approvedTasks: completedProofreadingAssignments,
        },
      },
    });
  } catch (err: any) {
    console.error("[AdminRoutes] Analytics error:", err);
    res.status(500).json({ error: "Failed to generate analytics" });
  }
});

/**
 * GET /api/admin/payouts
 * List all payout requests.
 */
router.get("/payouts", async (_req: Request, res: Response): Promise<void> => {
  try {
    const snap = await adminDb.collection("payoutRequests").orderBy("requestedAt", "desc").get();
    const payouts = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.status(200).json({ payouts });
  } catch (err: any) {
    console.error("[AdminRoutes] Payouts error:", err);
    res.status(500).json({ error: "Failed to fetch payout requests" });
  }
});

/**
 * POST /api/admin/payouts/:id/approve
 * Admin approves and finalizes a manual/admin-controlled payout request atomically.
 * Idempotent if retried on an already-completed payout (never double-credits totalPaidOut).
 */
router.post("/payouts/:id/approve", async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { externalTransactionId, confirmationNotes } = req.body || {};
    const user = req.user!;

    if (typeof externalTransactionId !== "string" || !externalTransactionId.trim()) {
      res.status(400).json({
        error: "externalTransactionId is required and must be a non-empty string confirming the external mobile-money payout.",
      });
      return;
    }

    const { payout, alreadyCompleted } = await ledgerService.completeWriterPayout({
      payoutId: id,
      adminUid: user.uid,
      externalTransactionId,
      confirmationNotes,
    });

    if (!alreadyCompleted) {
      await logAuditEvent({
        action: "payout_approved",
        actorId: user.uid,
        actorRole: user.role,
        targetId: id,
        details: {
          amount: payout.amount,
          userId: payout.userId,
          externalTransactionId: payout.externalTransactionId,
          confirmationNotes: confirmationNotes || null,
        },
        ip: req.ip as string | undefined,
      });

      await createNotification({
        userId: payout.userId,
        title: "Payout Completed",
        message: `Your payout of ${payout.amount} ZMW has been processed and sent! Reference: ${payout.externalTransactionId}`,
        type: "payment",
      });
    }

    res.status(200).json({
      success: true,
      alreadyCompleted,
      externalTransactionId: payout.externalTransactionId,
      message: alreadyCompleted ? "Payout was already completed" : "Payout approved and completed",
    });
  } catch (err: any) {
    if (err.message === "MISSING_EXTERNAL_TX_ID") {
      return void res.status(400).json({ error: "externalTransactionId is required and cannot be empty" });
    }
    if (err.message === "DUPLICATE_EXTERNAL_TX_ID") {
      return void res.status(409).json({ error: "Duplicate externalTransactionId: this reference has already been used for another payout" });
    }
    if (err.message === "CONFLICT_EXTERNAL_TX_ID") {
      return void res.status(409).json({ error: "Payout was already completed with a different externalTransactionId" });
    }
    if (err.message === "NOT_FOUND") return void res.status(404).json({ error: "Payout request not found" });
    if (err.message === "ALREADY_PROCESSED") return void res.status(400).json({ error: "Payout already processed" });
    console.error("[AdminRoutes] Approve payout error:", err);
    res.status(500).json({ error: "Failed to approve payout" });
  }
});

/**
 * POST /api/admin/payouts/:id/reject
 * Admin rejects a payout request atomically, returning funds to writer's available balance once.
 */
router.post("/payouts/:id/reject", async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { reason } = req.body || {};
    const user = req.user!;

    const { payout, alreadyRejected } = await ledgerService.rejectWriterPayout({
      payoutId: id,
      adminUid: user.uid,
      reason,
    });

    if (!alreadyRejected) {
      await logAuditEvent({
        action: "payout_rejected",
        actorId: user.uid,
        actorRole: user.role,
        targetId: id,
        details: { amount: payout.amount, reason },
        ip: req.ip as string | undefined,
      });

      await createNotification({
        userId: payout.userId,
        title: "Payout Request Rejected",
        message: `Your payout request was not approved: ${reason || "Administrative review"}. Funds returned to balance.`,
        type: "payment",
      });
    }

    res.status(200).json({
      success: true,
      alreadyRejected,
      message: alreadyRejected ? "Payout was already rejected" : "Payout rejected and funds returned",
    });
  } catch (err: any) {
    if (err.message === "NOT_FOUND") return void res.status(404).json({ error: "Payout request not found" });
    if (err.message === "ALREADY_PROCESSED") return void res.status(400).json({ error: "Payout already processed" });
    console.error("[AdminRoutes] Reject payout error:", err);
    res.status(500).json({ error: "Failed to reject payout" });
  }
});

/**
 * GET /api/admin/disputes
 * List all disputes.
 */
router.get("/disputes", async (_req: Request, res: Response): Promise<void> => {
  try {
    const snap = await adminDb.collection("disputes").orderBy("createdAt", "desc").get();
    const disputes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    res.status(200).json({ disputes });
  } catch (err: any) {
    console.error("[AdminRoutes] Disputes error:", err);
    res.status(500).json({ error: "Failed to fetch disputes" });
  }
});

/**
 * POST /api/admin/disputes/:id/resolve
 * Admin resolves a dispute with enforced financial accounting and idempotency.
 */
router.post("/disputes/:id/resolve", async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { resolution, outcome, notes, adminNotes, externalRefundReference } = req.body || {};
    const user = req.user!;

    const result = await ledgerService.resolveDisputeWithAccounting({
      disputeId: id,
      adminUid: user.uid,
      resolution: outcome || resolution,
      notes: notes || adminNotes,
      externalRefundReference,
    });

    if (!result.alreadyResolved) {
      await logAuditEvent({
        action: result.outcome === "refund" ? "dispute_refunded" : "dispute_resolved",
        actorId: user.uid,
        actorRole: user.role,
        targetId: id,
        details: {
          outcome: result.outcome,
          resolution: outcome || resolution || result.outcome,
          notes: notes || adminNotes || "",
          ...(result.targetId ? { targetId: result.targetId, targetType: result.targetType } : {}),
          ...(result.outcome === "refund" ? { externalRefundReference, amount: result.amount } : {}),
        },
        ip: req.ip as string | undefined,
      });
    }

    res.status(200).json({
      success: true,
      alreadyResolved: result.alreadyResolved,
      outcome: result.outcome,
      message: result.alreadyResolved
        ? "Dispute was already resolved"
        : `Dispute resolved (${result.outcome})`,
    });
  } catch (err: any) {
    if (err.message === "NOT_FOUND") return void res.status(404).json({ error: "Dispute not found" });
    if (err.message === "TARGET_NOT_FOUND") return void res.status(404).json({ error: "Dispute target not found" });
    if (err.message === "MISSING_REFUND_REFERENCE") {
      return void res.status(400).json({
        error: "externalRefundReference is required to settle a dispute refund (automated Lipila reversals are not supported).",
      });
    }
    if (err.message === "TARGET_NOT_FUNDED") {
      return void res.status(400).json({
        error: "Financial dispute resolution requires an actively funded escrow target.",
      });
    }
    if (err.message === "DISPUTE_ALREADY_RESOLVED") {
      return void res.status(409).json({
        error: "Dispute has already been resolved under a different outcome.",
      });
    }
    if (err.message === "ESCROW_ALREADY_SETTLED") {
      return void res.status(409).json({
        error: "Escrow has already been settled (released or refunded) and cannot be double-settled.",
      });
    }
    if (err.message === "DUPLICATE_EXTERNAL_REFUND_REF") {
      return void res.status(409).json({
        error: "externalRefundReference has already been used for another dispute refund.",
      });
    }
    console.error("[AdminRoutes] Resolve dispute error:", err);
    res.status(500).json({ error: "Failed to resolve dispute" });
  }
});

/**
 * POST /api/admin/assignments/:id/reassign
 * Admin reallocates work to an eligible specialist writer.
 */
router.post("/assignments/:id/reassign", async (req: Request, res: Response): Promise<void> => {
  try {
    const id = req.params.id as string;
    const { writerId } = req.body;
    const user = req.user!;

    if (!writerId) {
      res.status(400).json({ error: "Target writerId is required" });
      return;
    }

    const writerSnap = await adminDb.collection("users").doc(writerId).get();
    if (!writerSnap.exists || writerSnap.data()?.role !== "writer" || writerSnap.data()?.status !== "active") {
      res.status(400).json({ error: "Target user is not an active verified writer" });
      return;
    }

    const projectRef = adminDb.collection("assignments").doc(id);

    const result = await adminDb.runTransaction(async (transaction) => {
      const snap = await transaction.get(projectRef);
      if (!snap.exists) throw new Error("NOT_FOUND");

      const project = snap.data()!;
      const now = new Date().toISOString();
      const updatedHistory = Array.isArray(project.statusHistory) ? [...project.statusHistory] : [];
      updatedHistory.push({
        status: "assigned",
        actorId: user.uid,
        actorName: user.email,
        actorRole: user.role,
        timestamp: now,
        note: `Admin reassigned project to writer ${writerId}`,
      });

      transaction.update(projectRef, {
        writerId,
        writerEmail: writerSnap.data()?.email || "",
        status: "assigned",
        assignedAt: now,
        updatedAt: now,
        statusHistory: updatedHistory,
      });

      return { title: project.title };
    });

    await logAuditEvent({
      action: "assignment_reassigned",
      actorId: user.uid,
      actorRole: user.role,
      targetId: id,
      details: { writerId },
      ip: req.ip as string | undefined,
    });

    await createNotification({
      userId: writerId,
      title: "Assignment Reassigned to You",
      message: `Admin allocated assignment "${result.title}" to you.`,
      type: "assignment",
      link: `/app/assignments/${id}`,
    });

    res.status(200).json({ success: true, message: "Assignment reassigned successfully" });
  } catch (err: any) {
    if (err.message === "NOT_FOUND") return void res.status(404).json({ error: "Assignment not found" });
    console.error("[AdminRoutes] Reassign error:", err);
    res.status(500).json({ error: "Failed to reassign assignment" });
  }
});

/**
 * POST /api/admin/writers/:uid/clarification
 * Admin requests further verification documents or clarification from a writer applicant.
 */
router.post("/writers/:uid/clarification", async (req: Request, res: Response): Promise<void> => {
  try {
    const uid = req.params.uid as string;
    const { notes, note } = req.body || {};
    const messageNote = typeof (notes || note) === "string" ? String(notes || note).trim() : "";
    const user = req.user!;

    if (!messageNote) {
      res.status(400).json({ error: "Clarification note is required" });
      return;
    }

    const userRef = adminDb.collection("users").doc(uid);
    const result = await adminDb.runTransaction(async (transaction) => {
      const snap = await transaction.get(userRef);
      if (!snap.exists) throw new Error("NOT_FOUND");
      const currentData = snap.data()!;
      const now = new Date().toISOString();
      const prevCount = Number(currentData.previousClarificationsCount || 0) + 1;
      const history = Array.isArray(currentData.statusHistory) ? [...currentData.statusHistory] : [];
      history.push({
        status: "clarification_required",
        timestamp: now,
        adminId: user.uid,
        adminName: user.email,
        note: messageNote,
      });

      transaction.update(userRef, {
        verificationStatus: "clarification_required",
        isVerifiedWriter: false,
        clarificationNote: messageNote,
        previousClarificationsCount: prevCount,
        statusHistory: history,
        updatedAt: now,
      });

      return { prevCount };
    });

    await logAuditEvent({
      action: "writer_clarification_requested",
      actorId: user.uid,
      actorRole: user.role,
      targetId: uid,
      details: { note: messageNote, previousClarificationsCount: result.prevCount },
      ip: req.ip as string | undefined,
    });

    await createNotification({
      userId: uid,
      title: "Verification Clarification Required",
      message: `Please update your writer verification application: ${messageNote}`,
      type: "system",
      link: "/verification",
    });

    res.status(200).json({
      success: true,
      verificationStatus: "clarification_required",
      previousClarificationsCount: result.prevCount,
    });
  } catch (err: any) {
    if (err.message === "NOT_FOUND") return void res.status(404).json({ error: "User not found" });
    console.error("[AdminRoutes] Clarification error:", err);
    res.status(500).json({ error: "Failed to request writer clarification" });
  }
});

/**
 * POST /api/admin/disputes
 * Admin opens a moderated dispute record and freezes the target workflow atomically.
 */
router.post("/disputes", async (req: Request, res: Response): Promise<void> => {
  try {
    const user = req.user!;
    const {
      assignmentId,
      relatedId,
      relatedType = "assignment",
      title,
      reason,
      details,
    } = req.body || {};

    const targetId = assignmentId || relatedId;
    if (!targetId || typeof targetId !== "string" || !reason || typeof reason !== "string") {
      res.status(400).json({ error: "targetId (assignmentId or relatedId) and reason are required" });
      return;
    }

    const colName = relatedType === "research" ? "researchRequests" : "assignments";
    const targetRef = adminDb.collection(colName).doc(targetId);
    const disputeRef = adminDb.collection("disputes").doc();
    const now = new Date().toISOString();

    await adminDb.runTransaction(async (transaction) => {
      const targetSnap = await transaction.get(targetRef);
      if (!targetSnap.exists) throw new Error("TARGET_NOT_FOUND");
      const targetData = targetSnap.data()!;

      transaction.set(disputeRef, {
        id: disputeRef.id,
        assignmentId: relatedType === "research" ? null : targetId,
        relatedId: targetId,
        relatedType: relatedType === "research" ? "research" : "assignment",
        title: title || targetData.title || "Dispute Case",
        raisedBy: user.uid,
        raisedByEmail: user.email,
        raisedByRole: user.role,
        reason: reason.trim(),
        details: typeof details === "string" ? details.trim() : "",
        status: "open",
        createdAt: now,
        updatedAt: now,
      });

      transaction.update(targetRef, {
        status: "disputed",
        activeDisputeId: disputeRef.id,
        updatedAt: now,
      });
    });

    await logAuditEvent({
      action: "admin_dispute_created",
      actorId: user.uid,
      actorRole: user.role,
      targetId: disputeRef.id,
      details: { relatedId: targetId, relatedType, reason },
      ip: req.ip as string | undefined,
    });

    res.status(201).json({ success: true, disputeId: disputeRef.id, status: "open" });
  } catch (err: any) {
    if (err.message === "TARGET_NOT_FOUND") return void res.status(404).json({ error: "Target record not found" });
    console.error("[AdminRoutes] Create dispute error:", err);
    res.status(500).json({ error: "Failed to create dispute" });
  }
});

export default router;
