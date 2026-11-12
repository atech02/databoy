import { Router } from "express";
import { z } from "zod";
import { adminDb } from "../config/firebaseAdmin.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { requireRole, requireProofreadCapability } from "../middleware/roleGuard.js";
import { calculateAssignmentPricing, calculateCommissionBreakdown, calculateDaysUntilDeadline, wordsToPages, } from "../services/pricingEngine.js";
import { logAuditEvent } from "../services/auditService.js";
import { createNotification } from "../services/notificationService.js";
import { ledgerService } from "../services/ledgerService.js";
import { linkUploadedFilesToTarget } from "../services/fileLinkService.js";
const noopMiddleware = (_req, _res, next) => next();
const FORBIDDEN_ASSIGNMENT_CLIENT_FIELDS = [
    "budget",
    "commission",
    "writerCommission",
    "proofreaderCommission",
    "databoyCommission",
    "pricingBreakdown",
    "currency",
    "paymentStatus",
    "paymentReference",
    "escrowStatus",
    "payoutStatus",
    "fundedAt",
    "releasedAt",
    "refundedAt",
    "status",
    "customerId",
    "customerEmail",
    "writerId",
    "proofreaderId",
    "source",
    "pricingSource",
];
// Validation schema for creating an assignment
const createAssignmentSchema = z.object({
    title: z.string().min(3).max(200),
    description: z.string().min(10).max(5000).optional(),
    guidelines: z.string().min(10).max(5000).optional(),
    academicLevel: z.string().default("degree"),
    subject: z.string().default("general"),
    deadline: z.string(), // YYYY-MM-DD
    wordCount: z.number().int().positive().optional(),
    pageCount: z.number().int().positive().optional(),
    serviceType: z.string().optional(),
    projectType: z.string().optional(),
    referencingStyle: z.string().optional(),
    citationStyle: z.string().optional(),
    additionalNotes: z.string().max(2000).optional(),
    files: z
        .array(z.object({
        uid: z.string().optional(),
        fileId: z.string().optional(),
        name: z.string(),
        url: z.string().optional().default(""),
        storageKey: z.string().optional(),
        storagePath: z.string().optional(),
        storageProvider: z.string().optional(),
        contentType: z.string().optional(),
        sizeBytes: z.number().optional(),
    }))
        .optional(),
});
export function createAssignmentRouter(limiters) {
    const router = Router();
    const createLimit = limiters?.assignmentCreate || noopMiddleware;
    const writerActionLimit = limiters?.writerAction || noopMiddleware;
    const uploadLimit = limiters?.fileUpload || noopMiddleware;
    const disputeLimit = limiters?.disputeCreate || noopMiddleware;
    /**
     * POST /api/assignments
     * Create an assignment with authoritative server-side pricing.
     * Customer or Admin only.
     */
    router.post("/", authMiddleware, createLimit, requireRole("customer", "admin"), async (req, res) => {
        try {
            const rawBody = req.body && typeof req.body === "object" ? req.body : {};
            const forbiddenPresent = FORBIDDEN_ASSIGNMENT_CLIENT_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(rawBody, field));
            if (forbiddenPresent.length > 0) {
                res.status(400).json({
                    error: "Forbidden client fields in assignment creation",
                    code: "FORBIDDEN_FINANCIAL_OR_STATE_FIELDS",
                    rejectedFields: forbiddenPresent,
                });
                return;
            }
            const parsed = createAssignmentSchema.safeParse(rawBody);
            if (!parsed.success) {
                res.status(400).json({ error: "Invalid assignment payload", details: parsed.error.format() });
                return;
            }
            const data = parsed.data;
            const effectiveDescription = (data.description || data.guidelines || "").trim();
            if (effectiveDescription.length < 10) {
                res.status(400).json({ error: "Assignment description/guidelines must be at least 10 characters" });
                return;
            }
            const effectiveServiceType = (data.serviceType || data.projectType || "assignment").trim();
            const user = req.user;
            // Calculate pages
            const pages = data.pageCount ?? (data.wordCount ? wordsToPages(data.wordCount) : 1);
            const daysUntilDeadline = calculateDaysUntilDeadline(data.deadline);
            // AUTHORITATIVE SERVER PRICING — Reject client prices and compute strictly on server
            const pricing = calculateAssignmentPricing(pages, data.academicLevel, daysUntilDeadline, effectiveServiceType);
            const commission = calculateCommissionBreakdown(pricing.total);
            const now = new Date().toISOString();
            const projectRef = adminDb.collection("assignments").doc();
            const projectData = {
                id: projectRef.id,
                title: data.title,
                guidelines: effectiveDescription,
                academicLevel: data.academicLevel,
                subject: data.subject,
                deadline: data.deadline,
                wordCount: data.wordCount || pages * 250,
                pageCount: pages,
                projectType: effectiveServiceType,
                referencingStyle: data.referencingStyle || data.citationStyle || "APA 7th",
                files: data.files || [],
                source: "server_priced",
                // Server authoritative financials
                budget: pricing.total,
                currency: "ZMW",
                pricingBreakdown: pricing,
                writerCommission: commission.writer,
                proofreaderCommission: commission.proofreader,
                databoyCommission: commission.databoy,
                // Ownership and status
                customerId: user.uid,
                customerEmail: user.email,
                writerId: null,
                proofreaderId: null,
                status: "awaiting_payment",
                paymentStatus: "awaiting_payment",
                payoutStatus: "pending",
                statusHistory: [
                    {
                        status: "awaiting_payment",
                        actorId: user.uid,
                        actorName: user.email,
                        actorRole: user.role,
                        timestamp: now,
                        note: `Priced securely by DataBoy Server: ${pricing.total} ZMW`,
                    },
                ],
                createdAt: now,
                updatedAt: now,
            };
            await linkUploadedFilesToTarget({
                files: data.files,
                targetType: "assignment",
                targetId: projectRef.id,
                actorUid: user.uid,
                actorRole: user.role,
            });
            await projectRef.set(projectData);
            await logAuditEvent({
                action: "assignment_created",
                actorId: user.uid,
                actorRole: user.role,
                targetId: projectRef.id,
                details: { budget: pricing.total, pages, academicLevel: data.academicLevel },
                ip: req.ip,
            });
            await createNotification({
                userId: user.uid,
                title: "Assignment Created",
                message: `Your assignment "${data.title}" is ready. Verified quote: ${pricing.total} ZMW.`,
                type: "assignment",
                link: `/app/assignments/${projectRef.id}`,
            });
            res.status(201).json({
                success: true,
                assignmentId: projectRef.id,
                budget: pricing.total,
                pricingBreakdown: pricing,
            });
        }
        catch (err) {
            if (err?.message === "FORBIDDEN_FILE_REFERENCE") {
                res.status(403).json({ error: "Cannot attach files belonging to another user" });
                return;
            }
            console.error("[AssignmentRoutes] Create error:", err);
            res.status(500).json({ error: "Failed to create assignment" });
        }
    });
    /**
     * POST /api/assignments/:id/fund (DECOMMISSIONED)
     * Legacy direct funding is permanently disabled across all environments.
     */
    router.post("/:id/fund", authMiddleware, requireRole("customer", "admin"), async (_req, res) => {
        res.status(403).json({
            error: "Forbidden",
            message: "Direct funding is disabled. All assignment payments must be funded via Lipila Mobile Money (/api/payments/initiate).",
        });
    });
    /**
     * POST /api/assignments/:id/claim
     * Writer claims a funded assignment.
     * Active Writer only.
     */
    router.post("/:id/claim", authMiddleware, writerActionLimit, requireRole("writer"), async (req, res) => {
        try {
            const id = req.params.id;
            const user = req.user;
            if (!user.isVerifiedWriter && user.role !== "admin") {
                res.status(403).json({ error: "Only verified approved writers can claim assignments" });
                return;
            }
            const projectRef = adminDb.collection("assignments").doc(id);
            const result = await adminDb.runTransaction(async (transaction) => {
                const snap = await transaction.get(projectRef);
                if (!snap.exists)
                    throw new Error("NOT_FOUND");
                const project = snap.data();
                if (project.writerId || project.status === "assigned" || project.status === "in_progress") {
                    throw new Error("ALREADY_ASSIGNED");
                }
                if (project.status !== "funded") {
                    throw new Error("INVALID_STATUS");
                }
                const now = new Date().toISOString();
                const updatedHistory = Array.isArray(project.statusHistory) ? [...project.statusHistory] : [];
                updatedHistory.push({
                    status: "assigned",
                    actorId: user.uid,
                    actorName: user.email,
                    actorRole: "writer",
                    timestamp: now,
                    note: `Writer claimed assignment`,
                });
                transaction.update(projectRef, {
                    writerId: user.uid,
                    status: "assigned",
                    assignedAt: now,
                    updatedAt: now,
                    statusHistory: updatedHistory,
                });
                return { customerId: project.customerId, title: project.title };
            });
            await logAuditEvent({
                action: "assignment_claimed",
                actorId: user.uid,
                actorRole: user.role,
                targetId: id,
                ip: req.ip,
            });
            // Notify customer
            await createNotification({
                userId: result.customerId,
                title: "Writer Assigned",
                message: `A writer has started working on "${result.title}".`,
                type: "assignment",
                link: `/app/assignments/${id}`,
            });
            res.status(200).json({ success: true, status: "assigned" });
        }
        catch (err) {
            if (err.message === "NOT_FOUND") {
                res.status(404).json({ error: "Assignment not found" });
                return;
            }
            if (err.message === "INVALID_STATUS") {
                res.status(400).json({ error: "Assignment is not in funded status" });
                return;
            }
            if (err.message === "ALREADY_ASSIGNED") {
                res.status(409).json({ error: "Assignment is already claimed by another writer" });
                return;
            }
            console.error("[AssignmentRoutes] Claim error:", err);
            res.status(500).json({ error: "Failed to claim assignment" });
        }
    });
    /**
     * POST /api/assignments/:id/submit-draft
     * Writer submits draft for proofreading review.
     * Allocated writer only.
     */
    router.post("/:id/submit-draft", authMiddleware, uploadLimit, requireRole("writer"), async (req, res) => {
        try {
            const id = req.params.id;
            const user = req.user;
            const fileUrl = req.body.fileUrl || req.body.draftUrl || "";
            const fileId = typeof req.body.fileId === "string" ? req.body.fileId : undefined;
            const storageKey = typeof req.body.storageKey === "string" ? req.body.storageKey : undefined;
            const fileName = typeof req.body.fileName === "string" ? req.body.fileName : undefined;
            const notes = req.body.notes;
            if (!fileUrl && !fileId && !storageKey) {
                res.status(400).json({ error: "Draft file reference or URL is required" });
                return;
            }
            const projectRef = adminDb.collection("assignments").doc(id);
            await adminDb.runTransaction(async (transaction) => {
                const snap = await transaction.get(projectRef);
                if (!snap.exists)
                    throw new Error("NOT_FOUND");
                const project = snap.data();
                if (project.writerId !== user.uid) {
                    throw new Error("FORBIDDEN");
                }
                if (project.status !== "assigned" &&
                    project.status !== "in_progress" &&
                    project.status !== "draft_submitted" &&
                    project.status !== "review_rejected") {
                    throw new Error("INVALID_STATUS");
                }
                const now = new Date().toISOString();
                const updatedHistory = Array.isArray(project.statusHistory) ? [...project.statusHistory] : [];
                updatedHistory.push({
                    status: "draft_submitted",
                    actorId: user.uid,
                    actorName: user.email,
                    actorRole: "writer",
                    timestamp: now,
                    note: notes || "Draft submitted for proofreading review",
                });
                transaction.update(projectRef, {
                    status: "draft_submitted",
                    draftFileUrl: fileUrl,
                    draftDeliverable: {
                        url: fileUrl,
                        ...(fileId ? { fileId } : {}),
                        ...(storageKey ? { storageKey } : {}),
                        ...(fileName ? { fileName } : {}),
                        notes: notes || "",
                        submittedAt: now,
                    },
                    proofreaderId: null, // Reset so any eligible proofreader can claim
                    submittedForReviewAt: now,
                    updatedAt: now,
                    statusHistory: updatedHistory,
                });
                // Create dedicated, separate proofreading task for proofreading pool
                const budget = Number(project.budget || 0);
                const commission = calculateCommissionBreakdown(budget);
                const taskRef = adminDb.collection("proofreadingTasks").doc(`proof_${id}`);
                transaction.set(taskRef, {
                    id: `proof_${id}`,
                    assignmentId: id,
                    title: project.title,
                    academicLevel: project.academicLevel || "degree",
                    subject: project.subject || "general",
                    originalWriterId: project.writerId || user.uid,
                    originalWriterEmail: project.writerEmail || user.email,
                    originalWriterName: user.email,
                    budget,
                    proofreaderEarning: commission.proofreader,
                    proofreaderPayout: commission.proofreader,
                    draftFileUrl: fileUrl,
                    draftUrl: fileUrl,
                    draftNotes: notes || "",
                    status: "unassigned",
                    proofreaderId: null,
                    createdAt: now,
                    updatedAt: now,
                }, { merge: true });
            });
            await logAuditEvent({
                action: "draft_submitted",
                actorId: user.uid,
                actorRole: user.role,
                targetId: id,
                details: { fileUrl },
                ip: req.ip,
            });
            res.status(200).json({ success: true, status: "draft_submitted" });
        }
        catch (err) {
            if (err.message === "NOT_FOUND") {
                res.status(404).json({ error: "Assignment not found" });
                return;
            }
            if (err.message === "FORBIDDEN") {
                res.status(403).json({ error: "Only the allocated writer can submit drafts" });
                return;
            }
            if (err.message === "INVALID_STATUS") {
                res.status(400).json({ error: "Assignment is not in an editable status" });
                return;
            }
            console.error("[AssignmentRoutes] Submit draft error:", err);
            res.status(500).json({ error: "Failed to submit draft" });
        }
    });
    /**
     * POST /api/assignments/:id/claim-review
     * Proofreader claims assignment for review.
     * Writer with canProofread capability or Admin.
     * STRICT SEPARATION OF DUTIES: Allocated writer CANNOT review their own assignment!
     */
    router.post("/:id/claim-review", authMiddleware, writerActionLimit, requireProofreadCapability, async (req, res) => {
        try {
            const id = req.params.id;
            const user = req.user;
            const projectRef = adminDb.collection("assignments").doc(id);
            await adminDb.runTransaction(async (transaction) => {
                const snap = await transaction.get(projectRef);
                if (!snap.exists)
                    throw new Error("NOT_FOUND");
                const project = snap.data();
                // SEPARATION OF DUTIES GUARD:
                if (project.writerId === user.uid) {
                    throw new Error("SEPARATION_OF_DUTIES_VIOLATION");
                }
                if (project.status !== "under_review" && project.status !== "draft_submitted") {
                    throw new Error("INVALID_STATUS");
                }
                if (project.proofreaderId) {
                    throw new Error("ALREADY_CLAIMED");
                }
                const now = new Date().toISOString();
                const updatedHistory = Array.isArray(project.statusHistory) ? [...project.statusHistory] : [];
                updatedHistory.push({
                    status: "under_review",
                    actorId: user.uid,
                    actorName: user.email,
                    actorRole: "writer_proofreader",
                    timestamp: now,
                    note: "Proofreader claimed quality review",
                });
                transaction.update(projectRef, {
                    proofreaderId: user.uid,
                    reviewClaimedAt: now,
                    updatedAt: now,
                    statusHistory: updatedHistory,
                });
            });
            await logAuditEvent({
                action: "review_claimed",
                actorId: user.uid,
                actorRole: user.role,
                targetId: id,
                ip: req.ip,
            });
            res.status(200).json({ success: true, message: "Review claimed successfully" });
        }
        catch (err) {
            if (err.message === "NOT_FOUND") {
                res.status(404).json({ error: "Assignment not found" });
                return;
            }
            if (err.message === "SEPARATION_OF_DUTIES_VIOLATION") {
                res.status(403).json({ error: "Separation of duties: You cannot proofread your own assignment" });
                return;
            }
            if (err.message === "INVALID_STATUS") {
                res.status(400).json({ error: "Assignment is not in under_review status" });
                return;
            }
            if (err.message === "ALREADY_CLAIMED") {
                res.status(409).json({ error: "Review has already been claimed" });
                return;
            }
            console.error("[AssignmentRoutes] Claim review error:", err);
            res.status(500).json({ error: "Failed to claim review" });
        }
    });
    /**
     * POST /api/assignments/:id/reject-review
     * Proofreader rejects draft, returns to writer for revisions.
     */
    router.post("/:id/reject-review", authMiddleware, writerActionLimit, requireProofreadCapability, async (req, res) => {
        try {
            const id = req.params.id;
            const user = req.user;
            const { feedback } = req.body;
            if (!feedback) {
                res.status(400).json({ error: "Revision feedback is required" });
                return;
            }
            const projectRef = adminDb.collection("assignments").doc(id);
            const result = await adminDb.runTransaction(async (transaction) => {
                const snap = await transaction.get(projectRef);
                if (!snap.exists)
                    throw new Error("NOT_FOUND");
                const project = snap.data();
                if (project.proofreaderId !== user.uid && user.role !== "admin") {
                    throw new Error("FORBIDDEN");
                }
                const now = new Date().toISOString();
                const updatedHistory = Array.isArray(project.statusHistory) ? [...project.statusHistory] : [];
                updatedHistory.push({
                    status: "review_rejected",
                    actorId: user.uid,
                    actorName: user.email,
                    actorRole: "writer_proofreader",
                    timestamp: now,
                    note: `Revision requested: ${feedback}`,
                });
                transaction.update(projectRef, {
                    status: "review_rejected",
                    reviewFeedback: feedback,
                    proofreaderId: null, // Release lock so writer can revise
                    updatedAt: now,
                    statusHistory: updatedHistory,
                });
                return { writerId: project.writerId, title: project.title };
            });
            await logAuditEvent({
                action: "review_rejected",
                actorId: user.uid,
                actorRole: user.role,
                targetId: id,
                details: { feedback },
                ip: req.ip,
            });
            if (result.writerId) {
                await createNotification({
                    userId: result.writerId,
                    title: "Revision Requested",
                    message: `The proofreader requested revisions on "${result.title}": ${feedback}`,
                    type: "review",
                    link: `/app/assignments/${id}`,
                });
            }
            res.status(200).json({ success: true, status: "review_rejected" });
        }
        catch (err) {
            if (err.message === "NOT_FOUND") {
                res.status(404).json({ error: "Assignment not found" });
                return;
            }
            if (err.message === "FORBIDDEN") {
                res.status(403).json({ error: "Only the assigned proofreader can reject" });
                return;
            }
            console.error("[AssignmentRoutes] Reject review error:", err);
            res.status(500).json({ error: "Failed to reject review" });
        }
    });
    /**
     * POST /api/assignments/:id/approve
     * Proofreader or Admin approves assignment.
     * Releases payout in escrow.
     */
    router.post("/:id/approve", authMiddleware, writerActionLimit, requireProofreadCapability, async (req, res) => {
        try {
            const id = req.params.id;
            const user = req.user;
            const { finalFileUrl, notes } = req.body;
            const projectRef = adminDb.collection("assignments").doc(id);
            const result = await adminDb.runTransaction(async (transaction) => {
                const snap = await transaction.get(projectRef);
                if (!snap.exists)
                    throw new Error("NOT_FOUND");
                const project = snap.data();
                if (project.proofreaderId !== user.uid && user.role !== "admin") {
                    throw new Error("FORBIDDEN");
                }
                const isFunded = project.paymentStatus === "funded" ||
                    project.escrowStatus === "held" ||
                    project.payoutStatus === "escrowed";
                const alreadyReleased = project.escrowStatus === "released" || project.payoutStatus === "released";
                const alreadyRefunded = project.escrowStatus === "refunded" || project.payoutStatus === "refunded";
                if (alreadyRefunded) {
                    throw new Error("ESCROW_ALREADY_SETTLED");
                }
                if (!isFunded && !alreadyReleased) {
                    throw new Error("NOT_FUNDED");
                }
                const now = new Date().toISOString();
                const budget = Number(project.budget || 0);
                // Perform all ledger & wallet reads/writes atomically in the SAME transaction as approval
                const escrowResult = await ledgerService.releaseAssignmentEscrowInTransaction(transaction, {
                    assignmentId: id,
                    budget,
                    writerId: project.writerId || "",
                    writerEmail: project.writerEmail || "",
                    proofreaderId: project.proofreaderId || null,
                    proofreaderEmail: project.proofreaderEmail || null,
                    now,
                    metadata: { approvedBy: user.uid, via: "assignment_approve" },
                });
                if (alreadyReleased || escrowResult.alreadyReleased) {
                    return {
                        alreadyApproved: true,
                        assignmentId: id,
                        customerId: project.customerId,
                        writerId: project.writerId,
                        writerEmail: project.writerEmail,
                        proofreaderId: project.proofreaderId,
                        proofreaderEmail: project.proofreaderEmail,
                        title: project.title,
                        budget,
                        writerPayout: escrowResult.writerAmount,
                        proofreaderPayout: escrowResult.proofreaderAmount,
                    };
                }
                const updatedHistory = Array.isArray(project.statusHistory) ? [...project.statusHistory] : [];
                updatedHistory.push({
                    status: "completed",
                    actorId: user.uid,
                    actorName: user.email,
                    actorRole: user.role === "admin" ? "admin" : "writer_proofreader",
                    timestamp: now,
                    note: notes || "Final document approved and payout released",
                });
                const updates = {
                    status: "completed",
                    payoutStatus: "released",
                    escrowStatus: "released",
                    completedAt: project.completedAt || now,
                    updatedAt: now,
                    statusHistory: updatedHistory,
                };
                if (finalFileUrl) {
                    updates.finalFileUrl = finalFileUrl;
                }
                transaction.update(projectRef, updates);
                return {
                    alreadyApproved: false,
                    assignmentId: id,
                    customerId: project.customerId,
                    writerId: project.writerId,
                    writerEmail: project.writerEmail,
                    proofreaderId: project.proofreaderId,
                    proofreaderEmail: project.proofreaderEmail,
                    title: project.title,
                    budget,
                    writerPayout: escrowResult.writerAmount,
                    proofreaderPayout: escrowResult.proofreaderAmount,
                };
            });
            if (!result.alreadyApproved) {
                await logAuditEvent({
                    action: "assignment_approved",
                    actorId: user.uid,
                    actorRole: user.role,
                    targetId: id,
                    details: { writerPayout: result.writerPayout, proofreaderPayout: result.proofreaderPayout },
                    ip: req.ip,
                });
                // Notify customer
                await createNotification({
                    userId: result.customerId,
                    title: "Assignment Completed",
                    message: `Your assignment "${result.title}" has passed quality review and is ready!`,
                    type: "assignment",
                    link: `/app/assignments/${id}`,
                });
                // Notify writer
                if (result.writerId) {
                    await createNotification({
                        userId: result.writerId,
                        title: "Payout Released",
                        message: `Your draft for "${result.title}" was approved! Payout: ${result.writerPayout} ZMW.`,
                        type: "payment",
                        link: `/app/assignments/${id}`,
                    });
                }
            }
            res.status(200).json({
                success: true,
                status: "completed",
                alreadyApproved: result.alreadyApproved,
            });
        }
        catch (err) {
            if (err.message === "NOT_FOUND") {
                res.status(404).json({ error: "Assignment not found" });
                return;
            }
            if (err.message === "FORBIDDEN") {
                res.status(403).json({ error: "Only the assigned reviewer can approve" });
                return;
            }
            if (err.message === "NOT_FUNDED") {
                res.status(400).json({ error: "Assignment must be funded in escrow before releasing payout" });
                return;
            }
            if (err.message === "ESCROW_ALREADY_SETTLED") {
                res.status(409).json({ error: "Assignment escrow has already been refunded or settled" });
                return;
            }
            console.error("[AssignmentRoutes] Approve error:", err);
            res.status(500).json({ error: "Failed to approve assignment" });
        }
    });
    /**
     * GET /api/assignments/:id
     * Retrieve assignment details with role-based field filtering.
     */
    router.get("/:id", authMiddleware, async (req, res) => {
        try {
            const id = req.params.id;
            const user = req.user;
            const doc = await adminDb.collection("assignments").doc(id).get();
            if (!doc.exists) {
                res.status(404).json({ error: "Assignment not found" });
                return;
            }
            const project = doc.data();
            // Authorized if owner, assigned writer, assigned proofreader, or admin
            const isOwner = project.customerId === user.uid;
            const isAssignedWriter = project.writerId === user.uid;
            const isAssignedProofreader = project.proofreaderId === user.uid;
            const isAdmin = user.role === "admin";
            // Also writers can view funded, unassigned projects
            const isPoolWriter = user.role === "writer" && project.status === "funded" && !project.writerId;
            if (!isOwner && !isAssignedWriter && !isAssignedProofreader && !isAdmin && !isPoolWriter) {
                res.status(403).json({ error: "Access denied" });
                return;
            }
            res.status(200).json({ assignment: project });
        }
        catch (err) {
            console.error("[AssignmentRoutes] Get error:", err);
            res.status(500).json({ error: "Failed to fetch assignment" });
        }
    });
    /**
     * POST /api/assignments/:id/revision
     * Customer requests revision on an assignment with explanation.
     */
    router.post("/:id/revision", authMiddleware, writerActionLimit, requireRole("customer", "admin"), async (req, res) => {
        try {
            const id = req.params.id;
            const user = req.user;
            const { explanation } = req.body;
            if (!explanation || typeof explanation !== "string" || explanation.length < 5) {
                res.status(400).json({ error: "Revision explanation is required (min 5 characters)" });
                return;
            }
            const projectRef = adminDb.collection("assignments").doc(id);
            const result = await adminDb.runTransaction(async (transaction) => {
                const snap = await transaction.get(projectRef);
                if (!snap.exists)
                    throw new Error("NOT_FOUND");
                const project = snap.data();
                if (project.customerId !== user.uid && user.role !== "admin") {
                    throw new Error("FORBIDDEN");
                }
                const now = new Date().toISOString();
                const updatedHistory = Array.isArray(project.statusHistory) ? [...project.statusHistory] : [];
                updatedHistory.push({
                    status: "review_rejected",
                    actorId: user.uid,
                    actorName: user.email,
                    actorRole: user.role,
                    timestamp: now,
                    note: `Customer requested revision: ${explanation}`,
                });
                const updatedRevisionHistory = Array.isArray(project.revisionHistory) ? [...project.revisionHistory] : [];
                updatedRevisionHistory.push({
                    requestedBy: user.uid,
                    requestedAt: now,
                    explanation,
                });
                transaction.update(projectRef, {
                    status: "review_rejected",
                    revisionRequestedAt: now,
                    revisionNotes: explanation,
                    revisionHistory: updatedRevisionHistory,
                    updatedAt: now,
                    statusHistory: updatedHistory,
                });
                return { writerId: project.writerId, title: project.title };
            });
            await logAuditEvent({
                action: "customer_revision_requested",
                actorId: user.uid,
                actorRole: user.role,
                targetId: id,
                details: { explanation },
                ip: req.ip,
            });
            if (result.writerId) {
                await createNotification({
                    userId: result.writerId,
                    title: "Revision Requested by Customer",
                    message: `Customer requested revisions on "${result.title}": ${explanation}`,
                    type: "review",
                    link: `/app/assignments/${id}`,
                });
            }
            res.status(200).json({ success: true, status: "review_rejected", message: "Revision requested" });
        }
        catch (err) {
            if (err.message === "NOT_FOUND")
                return void res.status(404).json({ error: "Assignment not found" });
            if (err.message === "FORBIDDEN")
                return void res.status(403).json({ error: "Access denied" });
            console.error("[AssignmentRoutes] Revision error:", err);
            res.status(500).json({ error: "Failed to request revision" });
        }
    });
    /**
     * POST /api/assignments/:id/dispute
     * Customer or Writer raises a dispute on an assignment.
     */
    router.post("/:id/dispute", authMiddleware, disputeLimit, async (req, res) => {
        try {
            const id = req.params.id;
            const user = req.user;
            const { reason, details, evidenceFiles } = req.body;
            if (!reason || typeof reason !== "string") {
                res.status(400).json({ error: "Dispute reason is required" });
                return;
            }
            const projectRef = adminDb.collection("assignments").doc(id);
            const disputeRef = adminDb.collection("disputes").doc();
            const now = new Date().toISOString();
            await adminDb.runTransaction(async (transaction) => {
                const snap = await transaction.get(projectRef);
                if (!snap.exists)
                    throw new Error("NOT_FOUND");
                const project = snap.data();
                const isParticipant = project.customerId === user.uid || project.writerId === user.uid || project.proofreaderId === user.uid;
                if (!isParticipant && user.role !== "admin")
                    throw new Error("FORBIDDEN");
                const evidenceList = Array.isArray(evidenceFiles) ? evidenceFiles.slice(0, 10) : [];
                transaction.set(disputeRef, {
                    id: disputeRef.id,
                    assignmentId: id,
                    relatedId: id,
                    relatedType: "assignment",
                    title: project.title,
                    raisedBy: user.uid,
                    raisedByEmail: user.email,
                    raisedByRole: user.role,
                    reason,
                    details: details || "",
                    evidenceFiles: evidenceList,
                    status: "open",
                    createdAt: now,
                    updatedAt: now,
                });
                transaction.update(projectRef, {
                    status: "disputed",
                    activeDisputeId: disputeRef.id,
                    updatedAt: now,
                });
            });
            if (Array.isArray(evidenceFiles) && evidenceFiles.length > 0) {
                await linkUploadedFilesToTarget({
                    files: evidenceFiles.slice(0, 10),
                    targetType: "dispute",
                    targetId: disputeRef.id,
                    actorUid: user.uid,
                    actorRole: user.role,
                });
            }
            await logAuditEvent({
                action: "dispute_raised",
                actorId: user.uid,
                actorRole: user.role,
                targetId: disputeRef.id,
                details: { assignmentId: id, reason },
                ip: req.ip,
            });
            res.status(201).json({ success: true, disputeId: disputeRef.id, status: "disputed" });
        }
        catch (err) {
            if (err.message === "NOT_FOUND")
                return void res.status(404).json({ error: "Assignment not found" });
            if (err.message === "FORBIDDEN")
                return void res.status(403).json({ error: "Access denied" });
            console.error("[AssignmentRoutes] Dispute error:", err);
            res.status(500).json({ error: "Failed to raise dispute" });
        }
    });
    /**
     * POST /api/assignments/:id/allocate
     * Admin triggers an allocation offer to a specialist writer or escalates the assignment to the open pool.
     */
    router.post("/:id/allocate", authMiddleware, requireRole("admin"), async (req, res) => {
        try {
            const id = req.params.id;
            const user = req.user;
            const { mode, candidateWriterId, candidateWriterName } = req.body || {};
            if (mode !== "offer" && mode !== "open_pool") {
                res.status(400).json({ error: "mode must be 'offer' or 'open_pool'" });
                return;
            }
            if (mode === "offer" && (!candidateWriterId || typeof candidateWriterId !== "string")) {
                res.status(400).json({ error: "candidateWriterId is required when mode is 'offer'" });
                return;
            }
            const projectRef = adminDb.collection("assignments").doc(id);
            const result = await adminDb.runTransaction(async (transaction) => {
                const snap = await transaction.get(projectRef);
                if (!snap.exists)
                    throw new Error("NOT_FOUND");
                const project = snap.data();
                const now = new Date().toISOString();
                if (mode === "offer") {
                    const expiresAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
                    const currentAttempt = Number(project.allocationAttempt || 0) + 1;
                    const declined = Array.isArray(project.declinedWriters) ? [...project.declinedWriters] : [];
                    if (project.candidateWriterId &&
                        project.candidateWriterId !== candidateWriterId &&
                        !declined.includes(project.candidateWriterId)) {
                        declined.push(project.candidateWriterId);
                    }
                    transaction.update(projectRef, {
                        allocationMode: "pending_offer",
                        allocationAttempt: currentAttempt,
                        candidateWriterId,
                        candidateWriterName: candidateWriterName || "Specialist Writer",
                        offeredAt: now,
                        offerExpiresAt: expiresAt,
                        declinedWriters: declined,
                        status: "allocating",
                        updatedAt: now,
                    });
                    return {
                        title: project.title,
                        subject: project.subject,
                        customerId: project.customerId,
                        expiresAt,
                        allocationAttempt: currentAttempt,
                    };
                }
                const declined = Array.isArray(project.declinedWriters) ? [...project.declinedWriters] : [];
                if (project.candidateWriterId && !declined.includes(project.candidateWriterId)) {
                    declined.push(project.candidateWriterId);
                }
                transaction.update(projectRef, {
                    allocationMode: "open_pool",
                    candidateWriterId: null,
                    candidateWriterName: null,
                    declinedWriters: declined,
                    status: project.paymentStatus === "funded" ? "funded" : "unassigned",
                    updatedAt: now,
                });
                return {
                    title: project.title,
                    subject: project.subject,
                    customerId: project.customerId,
                };
            });
            await logAuditEvent({
                action: mode === "offer" ? "assignment_offer_sent" : "assignment_escalated_to_pool",
                actorId: user.uid,
                actorRole: user.role,
                targetId: id,
                details: { mode, candidateWriterId: candidateWriterId || null },
                ip: req.ip,
            });
            if (mode === "offer" && candidateWriterId) {
                await createNotification({
                    userId: candidateWriterId,
                    title: "Priority Assignment Invitation",
                    message: `You have been matched for "${result.title}" (${result.subject || "Academic"}). Please respond before expiry.`,
                    type: "assignment",
                    link: `/projects/detail?id=${id}`,
                });
            }
            res.status(200).json({ success: true, mode, ...result });
        }
        catch (err) {
            if (err.message === "NOT_FOUND")
                return void res.status(404).json({ error: "Assignment not found" });
            console.error("[AssignmentRoutes] Allocate error:", err);
            res.status(500).json({ error: "Failed to allocate assignment" });
        }
    });
    /**
     * POST /api/assignments/:id/activity
     * Authenticated participant or admin posts an activity comment to the assignment timeline.
     */
    router.post("/:id/activity", authMiddleware, writerActionLimit, async (req, res) => {
        try {
            const id = req.params.id;
            const user = req.user;
            const { comment, actorName } = req.body || {};
            if (!comment || typeof comment !== "string" || !comment.trim() || comment.trim().length > 2000) {
                res.status(400).json({ error: "comment must be a non-empty string up to 2000 characters" });
                return;
            }
            const projectSnap = await adminDb.collection("assignments").doc(id).get();
            if (!projectSnap.exists) {
                res.status(404).json({ error: "Assignment not found" });
                return;
            }
            const project = projectSnap.data();
            const isParticipant = project.customerId === user.uid ||
                project.writerId === user.uid ||
                project.proofreaderId === user.uid ||
                project.candidateWriterId === user.uid;
            if (!isParticipant && user.role !== "admin") {
                res.status(403).json({ error: "Only assignment participants or admins can post activity" });
                return;
            }
            const now = new Date().toISOString();
            const actRef = adminDb.collection("assignments").doc(id).collection("activity").doc();
            const entry = {
                id: actRef.id,
                projectId: id,
                actorId: user.uid,
                actorName: typeof actorName === "string" && actorName.trim() ? actorName.trim() : user.email,
                actorRole: user.role,
                action: "COMMENT_ADDED",
                type: "comment",
                message: comment.trim(),
                description: comment.trim(),
                createdAt: now,
                timestamp: now,
            };
            await actRef.set(entry);
            await logAuditEvent({
                action: "assignment_comment_added",
                actorId: user.uid,
                actorRole: user.role,
                targetId: id,
                details: { activityId: actRef.id },
                ip: req.ip,
            });
            res.status(201).json({ success: true, activity: entry });
        }
        catch (err) {
            console.error("[AssignmentRoutes] Activity error:", err);
            res.status(500).json({ error: "Failed to log assignment activity" });
        }
    });
    return router;
}
export default createAssignmentRouter();
