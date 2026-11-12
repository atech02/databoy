import { Router } from "express";
import { z } from "zod";
import { adminDb } from "../config/firebaseAdmin.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/roleGuard.js";
import { logAuditEvent } from "../services/auditService.js";
import { ledgerService } from "../services/ledgerService.js";
const noopMiddleware = (_req, _res, next) => next();
const writerApplicationSchema = z.object({
    university: z.string().min(2),
    major: z.string().min(2),
    yearOfStudy: z.string().min(1),
    degreeLevel: z.string().default("degree"),
    subjects: z.array(z.string()).min(1),
    phone: z.string().min(5),
    bio: z.string().optional(),
    degreeCertificateUrl: z.string().optional(),
    transcriptUrl: z.string().optional(),
    cvUrl: z.string().optional(),
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
            const now = new Date().toISOString();
            await userRef.update({
                verificationStatus: "pending_review",
                academic: {
                    university: data.university,
                    major: data.major,
                    yearOfStudy: data.yearOfStudy,
                    degreeLevel: data.degreeLevel,
                    subjects: data.subjects,
                    phone: data.phone,
                    bio: data.bio || "",
                    documents: {
                        degreeCertificateUrl: data.degreeCertificateUrl || null,
                        transcriptUrl: data.transcriptUrl || null,
                        cvUrl: data.cvUrl || null,
                    },
                },
                requestedCapabilities: data.canProofread ? ["writing", "proofreading"] : ["writing"],
                updatedAt: now,
            });
            await logAuditEvent({
                action: "writer_applied",
                actorId: user.uid,
                actorRole: user.role,
                targetId: user.uid,
                details: { university: data.university, major: data.major },
                ip: req.ip,
            });
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
     * Active Writers only.
     */
    router.get("/pool", authMiddleware, requireRole("writer"), async (req, res) => {
        try {
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
