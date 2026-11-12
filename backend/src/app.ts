import "./config/env.js";
import express, { Express, Request, Response, NextFunction } from "express";
import cors from "cors";
import publicRoutes from "./routes/publicRoutes.js";
import { createAssignmentRouter } from "./routes/assignmentRoutes.js";
import { createResearchRouter } from "./routes/researchRoutes.js";
import { createWriterRouter } from "./routes/writerRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import { createProofreadingRouter } from "./routes/proofreadingRoutes.js";
import { createPaymentRouter } from "./routes/paymentRoutes.js";
import { createAuthRouter } from "./routes/authRoutes.js";
import { createUploadRouter } from "./routes/uploadRoutes.js";
import { validateWebhookConfig } from "./services/webhookAuth.js";
import { lipilaService } from "./services/lipilaService.js";
import {
  isLipilaProductionEnv,
  validateLipilaConfig,
  validateR2Config,
} from "./config/env.js";
import {
  createRateLimiters,
  parseTrustProxySetting,
  SendRedisCommandFn,
  validateRateLimitConfig,
} from "./middleware/rateLimit.js";

export interface CreateAppOptions {
  redisSendCommand?: SendRedisCommandFn;
  storeKeyPrefix?: string;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();

  const isProd = isLipilaProductionEnv();

  // Fail closed on invalid Lipila environment selection, URLs, currency, timeout, or cross-env credentials
  const lipilaEnvConfigCheck = validateLipilaConfig({ requireCredentials: isProd });
  if (!lipilaEnvConfigCheck.valid) {
    console.error(`[CRITICAL CONFIGURATION ERROR]: ${lipilaEnvConfigCheck.error}`);
    throw new Error(lipilaEnvConfigCheck.error || "Invalid Lipila configuration");
  }

  // Startup configuration check for production readiness (fail closed)
  if (isProd) {
    const webhookCheck = validateWebhookConfig();
    if (!webhookCheck.valid) {
      console.error(`[CRITICAL CONFIGURATION ERROR]: ${webhookCheck.error}`);
      throw new Error(webhookCheck.error || "Invalid webhook production configuration");
    }
    const lipilaCheck = lipilaService.validateProductionConfig();
    if (!lipilaCheck.valid) {
      console.error(`[CRITICAL CONFIGURATION ERROR]: ${lipilaCheck.error}`);
      throw new Error(lipilaCheck.error || "Invalid Lipila production configuration");
    }
  } else if (
    process.env.NODE_ENV !== "test" &&
    lipilaEnvConfigCheck.missingVars &&
    lipilaEnvConfigCheck.missingVars.length > 0
  ) {
    console.warn(
      `[Lipila Config Notice] Sandbox environment is missing credentials (${lipilaEnvConfigCheck.missingVars.join(", ")}). Real payment operations will fail closed until configured.`
    );
  }

  // Fail closed on missing/invalid Cloudflare R2 configuration in staging/production or partial R2 setups
  const r2Check = validateR2Config();
  if (!r2Check.valid) {
    console.error(`[CRITICAL STORAGE CONFIGURATION ERROR]: ${r2Check.error}`);
    throw new Error(r2Check.error || "Invalid Cloudflare R2 configuration");
  }
  if (!r2Check.configured && process.env.NODE_ENV !== "test") {
    console.warn(
      "[R2 Storage Notice] Cloudflare R2 credentials are not set for local development. Document upload/download endpoints will fail closed (503) until R2_* environment variables are configured."
    );
  }

  // Validate and configure Express trust proxy setting safely
  const trustProxyCheck = parseTrustProxySetting(process.env.TRUST_PROXY, isProd);
  if (!trustProxyCheck.valid) {
    console.error(`[CRITICAL CONFIGURATION ERROR]: ${trustProxyCheck.error}`);
    throw new Error(trustProxyCheck.error || "Invalid TRUST_PROXY configuration");
  }
  app.set("trust proxy", trustProxyCheck.value);

  // Validate and instantiate centralized rate limiters
  const rateLimitCheck = validateRateLimitConfig({
    hasCustomRedisSendCommand: Boolean(options.redisSendCommand),
  });
  if (!rateLimitCheck.valid) {
    console.error(`[CRITICAL CONFIGURATION ERROR]: ${rateLimitCheck.error}`);
    throw new Error(rateLimitCheck.error || "Invalid rate limiting configuration");
  }
  const limiters = createRateLimiters({
    redisSendCommand: options.redisSendCommand,
    storeKeyPrefix: options.storeKeyPrefix,
  });

  // CORS origin allowlist (AUDIT-06C)
  const envOrigins = (process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
  const devOrigins =
    process.env.NODE_ENV !== "production"
      ? ["http://localhost:3000", "http://127.0.0.1:3000"]
      : [];
  const allowedOrigins = new Set<string>([...devOrigins, ...envOrigins]);

  app.use(
    cors({
      origin: (origin, callback) => {
        // Server-to-server callbacks (Lipila webhooks), curl, and same-origin requests have no Origin header
        if (!origin) {
          return callback(null, true);
        }
        const normalizedOrigin = origin.trim().replace(/\/+$/, "");
        if (allowedOrigins.has(normalizedOrigin)) {
          return callback(null, true);
        }
        const err: any = new Error(`CORS policy denied origin: ${normalizedOrigin}`);
        err.status = 403;
        return callback(err);
      },
      credentials: true,
    })
  );

  // Capture rawBody for cryptographic webhook HMAC verification (Lipila Standard Webhooks)
  app.use(
    express.json({
      limit: "10mb",
      verify: (req: any, _res: any, buf: Buffer) => {
        req.rawBody = buf.toString("utf8");
      },
    })
  );
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  // Request logger in dev/verbose
  if (process.env.NODE_ENV !== "test") {
    app.use((req: Request, _res: Response, next: NextFunction) => {
      console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
      next();
    });
  }

  // Apply General API rate limiter across /api (lipila-callback uses its own dedicated limiter)
  app.use("/api", limiters.general);

  // Mount routes
  app.use("/api", publicRoutes);
  app.use("/api/auth", createAuthRouter(limiters));
  const uploadRouter = createUploadRouter(limiters);
  app.use("/api/uploads", uploadRouter);
  app.use("/api/storage", uploadRouter);
  app.use("/api/assignments", createAssignmentRouter(limiters));
  app.use("/api/research", createResearchRouter(limiters));
  app.use("/api/writers", createWriterRouter(limiters));
  app.use("/api/admin", adminRoutes);
  app.use("/api/proofreading", createProofreadingRouter(limiters));
  app.use("/api/payments", createPaymentRouter(limiters));

  // 404 handler
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: "Endpoint not found" });
  });

  // Global error handler
  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[Backend App Error]:", err);
    res.status(err.status || 500).json({
      error: err.message || "Internal server error",
    });
  });

  (app as any).shutdownRateLimiters = limiters.shutdown;

  return app;
}

export const app = createApp();
