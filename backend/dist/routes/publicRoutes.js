import { Router } from "express";
import { z } from "zod";
import { resolveAppEnvironment, isPaymentsDisabledInStaging, validateR2Config, } from "../config/env.js";
import { validateRateLimitConfig } from "../middleware/rateLimit.js";
import { calculateAssignmentPricing, calculateDaysUntilDeadline, wordsToPages, } from "../services/pricingEngine.js";
const router = Router();
const pricingPreviewSchema = z.object({
    wordCount: z.number().int().positive().optional(),
    pageCount: z.number().int().positive().optional(),
    academicLevel: z.string().default("degree"),
    deadline: z.string(), // YYYY-MM-DD
    serviceType: z.string().default("assignment"),
});
/**
 * GET /api/health
 * Public health check endpoint returning safe operational metadata only (zero secrets/PII/URLs).
 */
router.get("/health", (_req, res) => {
    const appEnv = resolveAppEnvironment();
    const paymentsEnabled = !isPaymentsDisabledInStaging();
    const rlConfig = validateRateLimitConfig();
    const r2Status = validateR2Config();
    const hasFirebaseProject = Boolean(process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || process.env.FIRESTORE_EMULATOR_HOST);
    res.status(200).json({
        status: "healthy",
        service: "DataBoy Backend API",
        environment: appEnv,
        apiVersion: "1.0.0",
        infrastructure: {
            firestoreConfigured: hasFirebaseProject,
            storageProvider: "r2",
            r2Configured: r2Status.valid && r2Status.configured,
            rateLimitStore: rlConfig.enabled ? rlConfig.storeMode : "disabled",
            paymentsEnabled,
        },
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
    });
});
/**
 * POST /api/pricing-preview
 * Public pricing preview endpoint.
 */
router.post("/pricing-preview", (req, res) => {
    const parsed = pricingPreviewSchema.safeParse(req.body);
    if (!parsed.success) {
        res.status(400).json({ error: "Invalid pricing parameters", details: parsed.error.format() });
        return;
    }
    const { wordCount, pageCount, academicLevel, deadline, serviceType } = parsed.data;
    const pages = pageCount ?? (wordCount ? wordsToPages(wordCount) : 1);
    const daysUntilDeadline = calculateDaysUntilDeadline(deadline);
    const breakdown = calculateAssignmentPricing(pages, academicLevel, daysUntilDeadline, serviceType);
    res.status(200).json({
        success: true,
        breakdown,
    });
});
export default router;
