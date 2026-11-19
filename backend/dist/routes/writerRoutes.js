import { Router } from "express";
import { z } from "zod";
import { adminDb } from "../config/firebaseAdmin.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/roleGuard.js";
import { logAuditEvent } from "../services/auditService.js";
import { ledgerService } from "../services/ledgerService.js";
import { createNotification } from "../services/notificationService.js";
const noopMiddleware = (_req, _res, next) => next();
const writerApplicationSchema = z.object({
    fullName: z.string().min(2).max(120).optional(),
    university: z.string().min(2),
    faculty: z.string().optional(),
    major: z.string().min(2),
    yearOfStudy: z.string().min(1),
    degreeLevel: z.string().default("degree"),
    subjects: z.array(z.string()).min(1),
    phone: z.string().min(5),
    bio: z.string().optional(),
    degreeCertificateUrl: z.string().optional(),
    transcriptUrl: z.string().optional(),
    cvUrl: z.string().optional(),
    certificationsUrl: z.string().optional(),
    publicationsUrl: z.string().optional(),
    supportingDocsUrl: z.string().optional(),
    canProofread: z.boolean().optional(),
});
export function createWriterRouter(limiters) {
    const router = Router();
    const writerActionLimit = limiters?.writerAction || noopMiddleware;
    /**
     * POST /api/writers/apply
     * Customer applies to become a verified writer.
     * Note: Role is NOT escalated here! Admin approval is required.
     */
    router.post("/apply", authMiddleware, writerActionLimit, async (req, res) => {
        try {
            const parsed = writerApplicationSchema.safeParse(req.body);
            if (!parsed.success) {
                res.status(400).json({ error: "Invalid application payload", details: parsed.error.format() });
                return;
            }
            const data = parsed.data;
            const user = req.user;
            const userRef = adminDb.collection("users").doc(user.uid);
            const userSnap = await userRef.get();
            if (!userSnap.exists) {
                res.status(404).json({ error: "User profile not found" });
                return;
            }
            const existing = userSnap.data() || {};
            // Prevent duplicate active applications or approved writers from re-applying
            if (existing.role === "admin") {
                res.status(400).json({ error: "Administrators cannot apply as writers" });
                return;
            }
            if (existing.verificationStatus === "approved" && existing.isVerifiedWriter === true) {
                res.status(409).json({
                    error: "Your account is already an approved verified writer.",
                    code: "ALREADY_APPROVED_WRITER",
                });
                return;
            }
            if ((existing.verificationStatus === "pending_review" || existing.verificationStatus === "under_review") &&
                req.body?.allowResubmit !== true) {
                res.status(409).json({
                    error: "An active writer application is already pending administrative review.",
                    code: "DUPLICATE_ACTIVE_APPLICATION",
                });
                return;
            }
            const now = new Date().toISOString();
            const isResubmission = existing.verificationStatus === "clarification_required" || existing.verificationStatus === "rejected";
            const displayName = (data.fullName || existing.displayName || user.email || "Applicant").trim();
            const statusHistory = Array.isArray(existing.statusHistory) ? [...existing.statusHistory] : [];
            statusHistory.push({
                status: "pending_review",
                actorId: user.uid,
                actorName: displayName,
                actorRole: existing.role || "customer",
                timestamp: now,
                note: isResubmission
                    ? "Applicant updated and resubmitted writer application credentials."
                    : "Applicant submitted writer credentials for administrative review.",
            });
            const existingAcademic = existing.academic || {};
            const existingDocs = existingAcademic.documents || {};
            await userRef.update({
                ...(data.fullName ? { displayName } : {}),
                writerInterest: true,
                verificationStatus: "pending_review",
                writerStatus: "inactive",
                isVerifiedWriter: false,
                profileCompletion: 100,
                competencies: data.subjects,
                subjectExpertise: data.subjects,
                degreeLevel: data.degreeLevel || data.yearOfStudy,
                submissionDate: now,
                academic: {
                    ...existingAcademic,
                    university: data.university,
                    faculty: data.faculty || existingAcademic.faculty || "",
                    major: data.major,
                    yearOfStudy: data.yearOfStudy,
                    degreeLevel: data.degreeLevel,
                    subjects: data.subjects,
                    specializations: data.subjects,
                    phone: data.phone,
                    bio: data.bio ?? existingAcademic.bio ?? "",
                    documents: {
                        degreeCertificateUrl: data.degreeCertificateUrl ?? existingDocs.degreeCertificateUrl ?? null,
                        transcriptUrl: data.transcriptUrl ?? existingDocs.transcriptUrl ?? null,
                        cvUrl: data.cvUrl ?? existingDocs.cvUrl ?? null,
                        certificationsUrl: data.certificationsUrl ?? existingDocs.certificationsUrl ?? null,
                        publicationsUrl: data.publicationsUrl ?? existingDocs.publicationsUrl ?? null,
                        supportingDocsUrl: data.supportingDocsUrl ?? existingDocs.supportingDocsUrl ?? null,
                    },
                },
                requestedCapabilities: data.canProofread ? ["writing", "proofreading"] : ["writing"],
                statusHistory,
                updatedAt: now,
            });
            await logAuditEvent({
                action: isResubmission ? "writer_application_resubmitted" : "writer_applied",
                actorId: user.uid,
                actorRole: user.role,
                targetId: user.uid,
                details: { university: data.university, major: data.major, isResubmission },
                ip: req.ip,
            });
            // Notify applicant
            await createNotification({
                userId: user.uid,
                title: isResubmission ? "Writer Application Resubmitted" : "Writer Application Received",
                message: `Your writer application for ${data.major} (${data.university}) has been submitted and is pending administrative review.`,
                type: "writer_application",
                relatedType: "writer_application",
                relatedId: user.uid,
                link: "/verification",
            });
            // Notify administrators
            try {
                const adminsSnap = await adminDb.collection("users").where("role", "==", "admin").get();
                await Promise.allSettled(adminsSnap.docs.map((adminDoc) => createNotification({
                    userId: adminDoc.id,
                    title: isResubmission ? "Writer Application Resubmitted" : "New Writer Application",
                    message: `${displayName} submitted writer credentials (${data.major}) for administrative review.`,
                    type: "writer_application",
                    relatedType: "writer_application",
                    relatedId: user.uid,
                    link: "/admin?tab=verifications",
                })));
            }
            catch {
                // Non-fatal if admin notification fanout encounters an issue
            }
            res.status(200).json({
                success: true,
                message: "Application submitted for administrative verification",
                verificationStatus: "pending_review",
            });
        }
        catch (err) {
            console.error("[WriterRoutes] Apply error:", err);
            res.status(500).json({ error: "Failed to submit writer application" });
        }
    });
    /**
     * GET /api/writers/pool
     * Retrieve list of funded, unassigned projects available for claiming.
     * Active Verified Writers only.
     */
    router.get("/pool", authMiddleware, requireRole("writer"), async (req, res) => {
        try {
            const user = req.user;
            if (!user.isVerifiedWriter) {
                res.status(403).json({ error: "Only verified approved writers can access the assignment pool" });
                return;
            }
            const snapshot = await adminDb
                .collection("assignments")
                .where("status", "==", "funded")
                .where("writerId", "==", null)
                .limit(50)
                .get();
            const projects = snapshot.docs.map((doc) => ({
                id: doc.id,
                ...doc.data(),
            }));
            res.status(200).json({ pool: projects });
        }
        catch (err) {
            console.error("[WriterRoutes] Pool error:", err);
            res.status(500).json({ error: "Failed to fetch writer pool" });
        }
    });
    /**
     * GET /api/writers/me/earnings
     * Retrieve live wallet summary and recent ledger transactions for the authenticated writer.
     */
    router.get("/me/earnings", authMiddleware, requireRole("writer"), async (req, res) => {
        try {
            const user = req.user;
            if (!user.isVerifiedWriter) {
                res.status(403).json({ error: "Only verified approved writers can access writer earnings" });
                return;
            }
            const wallet = await ledgerService.getWalletSummary(user.uid);
            const recentTransactions = await ledgerService.listUserEntries(user.uid, 50);
            res.status(200).json({
                wallet,
                transactions: recentTransactions,
            });
        }
        catch (err) {
            console.error("[WriterRoutes] Earnings error:", err);
            res.status(500).json({ error: "Failed to fetch writer earnings" });
        }
    });
    /**
     * POST /api/writers/me/payout-request
     * Writer submits a payout request against available balance.
     */
    router.post("/me/payout-request", authMiddleware, writerActionLimit, requireRole("writer"), async (req, res) => {
        try {
            const user = req.user;
            if (!user.isVerifiedWriter) {
                res.status(403).json({ error: "Only verified approved writers can request payouts" });
                return;
            }
            const { amount, paymentMethod, paymentDetails, idempotencyKey } = req.body;
            if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 50) {
                res.status(400).json({ error: "Minimum payout request is 50 ZMW" });
                return;
            }
            if (!paymentMethod || !paymentDetails) {
                res.status(400).json({ error: "Payment method and payment details are required" });
                return;
            }
            // Card exclusion & Zambian Mobile Money validation
            const lowerMethod = String(paymentMethod).toLowerCase().trim();
            if (["card", "visa", "mastercard", "amex", "bank_card"].includes(lowerMethod)) {
                res.status(400).json({
                    error: "Card payouts are not supported. Payouts are exclusively disbursed via Zambian Mobile Money (Airtel, MTN, Zamtel).",
                });
                return;
            }
            const validNetworks = ["airtel_money", "mtn_money", "zamtel_kwacha", "mobile_money"];
            const targetNetwork = (paymentDetails.network || lowerMethod).toLowerCase().trim();
            if (!validNetworks.includes(targetNetwork)) {
                res.status(400).json({
                    error: `Unsupported payout network '${targetNetwork}'. Allowed networks: airtel_money, mtn_money, zamtel_kwacha.`,
                });
                return;
            }
            const rawPhone = paymentDetails.phoneNumber || paymentDetails.accountNumber;
            if (!rawPhone) {
                res.status(400).json({ error: "Mobile money account phone number is required" });
                return;
            }
            // Import normalizeZambianPhone from lipilaService
            const { normalizeZambianPhone } = await import("../services/lipilaService.js");
            const phoneCheck = normalizeZambianPhone(rawPhone);
            if (!phoneCheck.valid || !phoneCheck.normalized) {
                res.status(400).json({
                    error: phoneCheck.error || "Invalid Zambian mobile number for mobile money disbursement",
                });
                return;
            }
            // Store normalized phone in paymentDetails
            paymentDetails.accountNumber = phoneCheck.normalized;
            paymentDetails.phoneNumber = phoneCheck.normalized;
            const reservation = await ledgerService.reserveWriterPayout({
                userId: user.uid,
                userEmail: user.email,
                amount,
                paymentMethod,
                paymentDetails,
                idempotencyKey: typeof idempotencyKey === "string" && idempotencyKey.trim() ? idempotencyKey.trim() : undefined,
            });
            if (!reservation.alreadyProcessed) {
                await logAuditEvent({
                    action: "payout_requested",
                    actorId: user.uid,
                    actorRole: user.role,
                    targetId: reservation.payoutId,
                    details: { amount, paymentMethod, remainingBalance: reservation.remainingBalance },
                    ip: req.ip,
                });
            }
            res.status(reservation.alreadyProcessed ? 200 : 201).json({
                success: true,
                payoutId: reservation.payoutId,
                remainingBalance: reservation.remainingBalance,
                alreadyProcessed: reservation.alreadyProcessed,
                message: "Payout request submitted for administrator review",
            });
        }
        catch (err) {
            if (typeof err?.message === "string" && err.message.startsWith("INSUFFICIENT_BALANCE:")) {
                const available = err.message.split(":")[1];
                res.status(400).json({
                    error: `Insufficient available balance. Available: ${available} ZMW`,
                });
                return;
            }
            if (err?.message === "USER_NOT_FOUND") {
                res.status(404).json({ error: "Writer profile not found" });
                return;
            }
            console.error("[WriterRoutes] Payout request error:", err);
            res.status(500).json({ error: "Failed to submit payout request" });
        }
    });
    /**
     * POST /api/writers/me/availability
     * Writer updates their own online/busy availability status cleanly with audit tracking.
     */
    router.post("/me/availability", authMiddleware, writerActionLimit, requireRole("writer", "admin"), async (req, res) => {
        try {
            const user = req.user;
            const { availability } = req.body || {};
            if (availability !== "available" && availability !== "busy") {
                res.status(400).json({ error: "availability must be 'available' or 'busy'" });
                return;
            }
            const now = new Date().toISOString();
            await adminDb.collection("users").doc(user.uid).update({
                availability,
                updatedAt: now,
            });
            await logAuditEvent({
                action: "writer_availability_updated",
                actorId: user.uid,
                actorRole: user.role,
                targetId: user.uid,
                details: { availability },
                ip: req.ip,
            });
            res.status(200).json({ success: true, availability });
        }
        catch (err) {
            console.error("[WriterRoutes] Availability update error:", err);
            res.status(500).json({ error: "Failed to update writer availability" });
        }
    });
    return router;
}
export default createWriterRouter();
