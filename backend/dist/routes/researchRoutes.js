import { Router } from "express";
import { z } from "zod";
import { adminDb } from "../config/firebaseAdmin.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/roleGuard.js";
import { logAuditEvent } from "../services/auditService.js";
import { createNotification } from "../services/notificationService.js";
import { linkUploadedFilesToTarget } from "../services/fileLinkService.js";
const noopMiddleware = (_req, _res, next) => next();
const FORBIDDEN_RESEARCH_CLIENT_FIELDS = [
    "quoteAmount",
    "quoteStatus",
    "currency",
    "paymentStatus",
    "escrowStatus",
    "payoutStatus",
    "status",
    "studentId",
    "assignedWriterId",
    "writerCommission",
    "databoyCommission",
];
const createResearchSchema = z.object({
    title: z.string().min(3).max(200),
    requestTypes: z.array(z.string()).min(1),
    pastedBrief: z.string().min(10).max(10000),
    expectedDeliverable: z.string().min(3).max(2000),
    subject: z.string().default("general"),
    levelOfStudy: z.string().default("degree"),
    deadline: z.string(),
    otherDetails: z.string().optional(),
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
/**
 * POST /api/research
 * Submit a research request for manual admin quotation.
 */
export function createResearchRouter(limiters) {
    const router = Router();
    const createLimit = limiters?.researchCreate || noopMiddleware;
    const writerActionLimit = limiters?.writerAction || noopMiddleware;
    router.post("/", authMiddleware, createLimit, requireRole("customer", "admin"), async (req, res) => {
        try {
            const rawBody = req.body && typeof req.body === "object" ? req.body : {};
            const forbiddenPresent = FORBIDDEN_RESEARCH_CLIENT_FIELDS.filter((field) => Object.prototype.hasOwnProperty.call(rawBody, field));
            if (forbiddenPresent.length > 0) {
                res.status(400).json({
                    error: "Forbidden client fields in research request creation",
                    code: "FORBIDDEN_FINANCIAL_OR_STATE_FIELDS",
                    rejectedFields: forbiddenPresent,
                });
                return;
            }
            const parsed = createResearchSchema.safeParse(rawBody);
            if (!parsed.success) {
                res.status(400).json({ error: "Invalid research payload", details: parsed.error.format() });
                return;
            }
            const data = parsed.data;
            const user = req.user;
            const now = new Date().toISOString();
            const docRef = adminDb.collection("researchRequests").doc();
            const researchData = {
                id: docRef.id,
                studentId: user.uid,
                studentEmail: user.email,
                title: data.title,
                requestTypes: data.requestTypes,
                pastedBrief: data.pastedBrief,
                expectedDeliverable: data.expectedDeliverable,
                subject: data.subject,
                levelOfStudy: data.levelOfStudy,
                deadline: data.deadline,
                otherDetails: data.otherDetails || null,
                files: data.files || [],
                status: "submitted",
                quoteAmount: null,
                quoteNotes: null,
                quoteStatus: null,
                assignedWriterId: null,
                createdAt: now,
                updatedAt: now,
            };
            await linkUploadedFilesToTarget({
                files: data.files,
                targetType: "research",
                targetId: docRef.id,
                actorUid: user.uid,
                actorRole: user.role,
            });
            await docRef.set(researchData);
            await logAuditEvent({
                action: "research_created",
                actorId: user.uid,
                actorRole: user.role,
                targetId: docRef.id,
                ip: req.ip,
            });
            await createNotification({
                userId: user.uid,
                title: "Research Request Submitted",
                message: `Your research request "${data.title}" has been submitted for review.`,
                type: "research",
                link: `/app/research/${docRef.id}`,
            });
            res.status(201).json({ success: true, requestId: docRef.id, status: "submitted" });
        }
        catch (err) {
            if (err?.message === "FORBIDDEN_FILE_REFERENCE") {
                res.status(403).json({ error: "Cannot attach files belonging to another user" });
                return;
            }
            console.error("[ResearchRoutes] Submit error:", err);
            res.status(500).json({ error: "Failed to submit research request" });
        }
    });
    /**
     * POST /api/research/:id/quote
     * Admin provides official manual quotation.
     */
    router.post("/:id/quote", authMiddleware, requireRole("admin"), async (req, res) => {
        try {
            const id = req.params.id;
            const { quoteAmount, quoteNotes } = req.body;
            const user = req.user;
            if (typeof quoteAmount !== "number" || quoteAmount <= 0) {
                res.status(400).json({ error: "A valid positive quote amount is required" });
                return;
            }
            const docRef = adminDb.collection("researchRequests").doc(id);
            const result = await adminDb.runTransaction(async (transaction) => {
                const snap = await transaction.get(docRef);
                if (!snap.exists)
                    throw new Error("NOT_FOUND");
                const data = snap.data();
                const now = new Date().toISOString();
                transaction.update(docRef, {
                    quoteAmount,
                    quoteNotes: quoteNotes || "",
                    quoteStatus: "pending_acceptance",
                    status: "quote_ready",
                    adminReviewedBy: user.uid,
                    updatedAt: now,
                });
                return { studentId: data.studentId, title: data.title };
            });
            await logAuditEvent({
                action: "research_quote_created",
                actorId: user.uid,
                actorRole: user.role,
                targetId: id,
                details: { quoteAmount },
                ip: req.ip,
            });
            await createNotification({
                userId: result.studentId,
                title: "Research Quote Ready",
                message: `A quote of ${quoteAmount} ZMW is available for "${result.title}".`,
                type: "research",
                link: `/app/research/${id}`,
            });
            res.status(200).json({ success: true, status: "quote_ready", quoteAmount });
        }
        catch (err) {
            if (err.message === "NOT_FOUND") {
                res.status(404).json({ error: "Research request not found" });
                return;
            }
            console.error("[ResearchRoutes] Quote error:", err);
            res.status(500).json({ error: "Failed to provide quote" });
        }
    });
    /**
     * POST /api/research/:id/respond-quote
     * Customer accepts or rejects quotation.
     */
    router.post("/:id/respond-quote", authMiddleware, requireRole("customer", "admin"), async (req, res) => {
        try {
            const id = req.params.id;
            const { accept } = req.body;
            const user = req.user;
            if (typeof accept !== "boolean") {
                res.status(400).json({ error: "accept boolean field is required" });
                return;
            }
            const docRef = adminDb.collection("researchRequests").doc(id);
            await adminDb.runTransaction(async (transaction) => {
                const snap = await transaction.get(docRef);
                if (!snap.exists)
                    throw new Error("NOT_FOUND");
                const data = snap.data();
                if (data.studentId !== user.uid && user.role !== "admin") {
                    throw new Error("FORBIDDEN");
                }
                if (data.status !== "quote_ready") {
                    throw new Error("INVALID_STATUS");
                }
                const now = new Date().toISOString();
                if (accept) {
                    transaction.update(docRef, {
                        quoteStatus: "accepted",
                        status: "awaiting_payment",
                        updatedAt: now,
                    });
                }
                else {
                    transaction.update(docRef, {
                        quoteStatus: "rejected",
                        status: "cancelled",
                        updatedAt: now,
                    });
                }
            });
            await logAuditEvent({
                action: accept ? "research_quote_accepted" : "research_quote_rejected",
                actorId: user.uid,
                actorRole: user.role,
                targetId: id,
                ip: req.ip,
            });
            res.status(200).json({ success: true, status: accept ? "awaiting_payment" : "cancelled" });
        }
        catch (err) {
            if (err.message === "NOT_FOUND") {
                res.status(404).json({ error: "Research request not found" });
                return;
            }
            if (err.message === "FORBIDDEN") {
                res.status(403).json({ error: "Access denied" });
                return;
            }
            if (err.message === "INVALID_STATUS") {
                res.status(400).json({ error: "Request is not awaiting quote response" });
                return;
            }
            console.error("[ResearchRoutes] Respond quote error:", err);
            res.status(500).json({ error: "Failed to respond to quote" });
        }
    });
    /**
     * POST /api/research/:id/fund (DECOMMISSIONED)
     * Legacy direct funding is permanently disabled across all environments.
     */
    router.post("/:id/fund", authMiddleware, requireRole("customer", "admin"), async (_req, res) => {
        res.status(403).json({
            error: "Forbidden",
            message: "Direct funding is disabled. All research request payments must be funded via Lipila Mobile Money (/api/payments/initiate).",
        });
    });
    /**
     * POST /api/research/:id/assign
     * Admin allocates funded research to a specialist writer.
     */
    router.post("/:id/assign", authMiddleware, requireRole("admin"), async (req, res) => {
        try {
            const id = req.params.id;
            const { writerId } = req.body;
            const user = req.user;
            if (!writerId) {
                res.status(400).json({ error: "writerId is required" });
                return;
            }
            // Verify writer exists and is active writer
            const writerDoc = await adminDb.collection("users").doc(writerId).get();
            if (!writerDoc.exists || writerDoc.data()?.role !== "writer" || writerDoc.data()?.status !== "active") {
                res.status(400).json({ error: "Target writer not found or not active" });
                return;
            }
            const docRef = adminDb.collection("researchRequests").doc(id);
            const result = await adminDb.runTransaction(async (transaction) => {
                const snap = await transaction.get(docRef);
                if (!snap.exists)
                    throw new Error("NOT_FOUND");
                const data = snap.data();
                if (data.status !== "funded") {
                    throw new Error("INVALID_STATUS");
                }
                const now = new Date().toISOString();
                transaction.update(docRef, {
                    assignedWriterId: writerId,
                    status: "assigned",
                    assignedAt: now,
                    updatedAt: now,
                });
                return { studentId: data.studentId, title: data.title };
            });
            await logAuditEvent({
                action: "research_assigned",
                actorId: user.uid,
                actorRole: user.role,
                targetId: id,
                details: { writerId },
                ip: req.ip,
            });
            // Notify writer
            await createNotification({
                userId: writerId,
                title: "Research Project Assigned",
                message: `You have been assigned to research project "${result.title}".`,
                type: "research",
                link: `/app/research/${id}`,
            });
            // Notify student
            await createNotification({
                userId: result.studentId,
                title: "Specialist Assigned",
                message: `A research specialist has been assigned to "${result.title}".`,
                type: "research",
                link: `/app/research/${id}`,
            });
            res.status(200).json({ success: true, status: "assigned" });
        }
        catch (err) {
            if (err.message === "NOT_FOUND") {
                res.status(404).json({ error: "Research request not found" });
                return;
            }
            if (err.message === "INVALID_STATUS") {
                res.status(400).json({ error: "Research request must be funded before assigning" });
                return;
            }
            console.error("[ResearchRoutes] Assign error:", err);
            res.status(500).json({ error: "Failed to assign research request" });
        }
    });
    /**
     * GET /api/research/:id
     * Retrieve research details with access control.
     */
    router.get("/:id", authMiddleware, async (req, res) => {
        try {
            const id = req.params.id;
            const user = req.user;
            const doc = await adminDb.collection("researchRequests").doc(id).get();
            if (!doc.exists) {
                res.status(404).json({ error: "Research request not found" });
                return;
            }
            const data = doc.data();
            const isOwner = data.studentId === user.uid;
            const isAssignedWriter = data.assignedWriterId === user.uid;
            const isAdmin = user.role === "admin";
            if (!isOwner && !isAssignedWriter && !isAdmin) {
                res.status(403).json({ error: "Access denied" });
                return;
            }
            res.status(200).json({ researchRequest: data });
        }
        catch (err) {
            console.error("[ResearchRoutes] Get error:", err);
            res.status(500).json({ error: "Failed to fetch research request" });
        }
    });
    /**
     * POST /api/research/:id/clarifications
     * Submit a clarification message on a research request (participant or admin) and update status if requested.
     */
    router.post("/:id/clarifications", authMiddleware, writerActionLimit, async (req, res) => {
        try {
            const id = req.params.id;
            const user = req.user;
            const { message, authorName, requestStudentClarification } = req.body || {};
            if (!message || typeof message !== "string" || !message.trim() || message.trim().length > 4000) {
                res.status(400).json({ error: "message must be a non-empty string up to 4000 characters" });
                return;
            }
            const docRef = adminDb.collection("researchRequests").doc(id);
            const result = await adminDb.runTransaction(async (transaction) => {
                const snap = await transaction.get(docRef);
                if (!snap.exists)
                    throw new Error("NOT_FOUND");
                const data = snap.data();
                const isOwner = data.studentId === user.uid;
                const isAssignedWriter = data.assignedWriterId === user.uid;
                const isAdmin = user.role === "admin";
                if (!isOwner && !isAssignedWriter && !isAdmin) {
                    throw new Error("FORBIDDEN");
                }
                const now = new Date().toISOString();
                const nextStatus = isAdmin && requestStudentClarification
                    ? "needs_clarification"
                    : isOwner && data.status === "needs_clarification"
                        ? "under_review"
                        : data.status;
                const clarifications = Array.isArray(data.clarifications) ? [...data.clarifications] : [];
                clarifications.push({
                    id: `clr-${Date.now()}`,
                    authorId: user.uid,
                    authorRole: user.role,
                    authorName: typeof authorName === "string" && authorName.trim() ? authorName.trim() : user.email,
                    message: message.trim(),
                    createdAt: now,
                });
                transaction.update(docRef, {
                    status: nextStatus,
                    clarifications,
                    updatedAt: now,
                });
                return {
                    title: data.title,
                    studentId: data.studentId,
                    nextStatus,
                };
            });
            await logAuditEvent({
                action: "research_clarification_submitted",
                actorId: user.uid,
                actorRole: user.role,
                targetId: id,
                details: { nextStatus: result.nextStatus },
                ip: req.ip,
            });
            if (user.role === "admin" && result.studentId && result.nextStatus === "needs_clarification") {
                await createNotification({
                    userId: result.studentId,
                    title: "Research Clarification Required",
                    message: `Admin requested clarification on "${result.title}".`,
                    type: "research",
                    link: `/research/detail?id=${id}`,
                });
            }
            res.status(200).json({ success: true, status: result.nextStatus });
        }
        catch (err) {
            if (err.message === "NOT_FOUND")
                return void res.status(404).json({ error: "Research request not found" });
            if (err.message === "FORBIDDEN")
                return void res.status(403).json({ error: "Access denied" });
            console.error("[ResearchRoutes] Clarification error:", err);
            res.status(500).json({ error: "Failed to submit clarification" });
        }
    });
    /**
     * POST /api/research/:id/status
     * Authorized workflow state transition for a research request (enforces ownership, role & valid transitions).
     */
    router.post("/:id/status", authMiddleware, writerActionLimit, async (req, res) => {
        try {
            const id = req.params.id;
            const user = req.user;
            const { nextStatus, note } = req.body || {};
            const allowedTargets = new Set([
                "under_review",
                "needs_clarification",
                "in_progress",
                "draft_submitted",
                "completed",
                "cancelled",
            ]);
            if (!nextStatus || typeof nextStatus !== "string" || !allowedTargets.has(nextStatus)) {
                res.status(400).json({ error: "Invalid target status" });
                return;
            }
            const docRef = adminDb.collection("researchRequests").doc(id);
            const result = await adminDb.runTransaction(async (transaction) => {
                const snap = await transaction.get(docRef);
                if (!snap.exists)
                    throw new Error("NOT_FOUND");
                const data = snap.data();
                const isOwner = data.studentId === user.uid;
                const isAssignedWriter = data.assignedWriterId === user.uid;
                const isAdmin = user.role === "admin";
                if (nextStatus === "under_review" || nextStatus === "needs_clarification" || nextStatus === "completed") {
                    if (!isAdmin)
                        throw new Error("FORBIDDEN");
                }
                else if (nextStatus === "in_progress" || nextStatus === "draft_submitted") {
                    if (!isAdmin && !isAssignedWriter)
                        throw new Error("FORBIDDEN");
                    if (data.paymentStatus !== "funded" && data.escrowStatus !== "held") {
                        throw new Error("NOT_FUNDED");
                    }
                }
                else if (nextStatus === "cancelled") {
                    if (!isAdmin && !(isOwner && ["submitted", "under_review", "needs_clarification", "quoted", "awaiting_payment"].includes(data.status))) {
                        throw new Error("FORBIDDEN");
                    }
                }
                const now = new Date().toISOString();
                const updates = {
                    status: nextStatus,
                    updatedAt: now,
                };
                if (nextStatus === "completed") {
                    updates.completedAt = now;
                }
                if (typeof note === "string" && note.trim()) {
                    updates.statusNote = note.trim();
                }
                transaction.update(docRef, updates);
                return { title: data.title, studentId: data.studentId, previousStatus: data.status };
            });
            await logAuditEvent({
                action: "research_status_transition",
                actorId: user.uid,
                actorRole: user.role,
                targetId: id,
                details: { from: result.previousStatus, to: nextStatus, note: note || null },
                ip: req.ip,
            });
            res.status(200).json({ success: true, status: nextStatus });
        }
        catch (err) {
            if (err.message === "NOT_FOUND")
                return void res.status(404).json({ error: "Research request not found" });
            if (err.message === "FORBIDDEN")
                return void res.status(403).json({ error: "Access denied for status transition" });
            if (err.message === "NOT_FUNDED")
                return void res.status(400).json({ error: "Research request must be funded first" });
            console.error("[ResearchRoutes] Status error:", err);
            res.status(500).json({ error: "Failed to transition research status" });
        }
    });
    return router;
}
export default createResearchRouter();
