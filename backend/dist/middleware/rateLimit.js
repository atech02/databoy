import { rateLimit, ipKeyGenerator } from "express-rate-limit";
import { RedisStore } from "rate-limit-redis";
import { createClient } from "redis";
import { isLipilaProductionEnv } from "../config/env.js";
const activeRedisClients = new Set();
export async function shutdownRateLimitClients() {
    const clients = Array.from(activeRedisClients);
    activeRedisClients.clear();
    for (const client of clients) {
        try {
            await client.quit();
        }
        catch {
            try {
                await client.disconnect?.();
            }
            catch {
                // Ignore cleanup errors on shutdown
            }
        }
    }
}
function readPositiveIntEnv(envName, defaultValue) {
    const raw = process.env[envName];
    if (!raw || !raw.trim())
        return defaultValue;
    const parsed = Number.parseInt(raw.trim(), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}
export function parseTrustProxySetting(rawTrustProxy = process.env.TRUST_PROXY, isProduction = isLipilaProductionEnv()) {
    if (rawTrustProxy === undefined || rawTrustProxy.trim() === "") {
        return { valid: true, value: isProduction ? 1 : false };
    }
    const trimmed = rawTrustProxy.trim().toLowerCase();
    if (trimmed === "true" || trimmed === "*") {
        return {
            valid: false,
            value: false,
            error: "Server configuration error: Permissive TRUST_PROXY ('true' or '*') is prohibited to prevent IP spoofing",
        };
    }
    if (trimmed === "false" || trimmed === "0") {
        return { valid: true, value: false };
    }
    if (/^\d+$/.test(trimmed)) {
        const hops = Number.parseInt(trimmed, 10);
        if (hops > 0 && hops <= 10) {
            return { valid: true, value: hops };
        }
        return {
            valid: false,
            value: false,
            error: "Server configuration error: Numeric TRUST_PROXY hop count must be between 1 and 10",
        };
    }
    if (["loopback", "linklocal", "uniquelocal"].includes(trimmed)) {
        return { valid: true, value: trimmed };
    }
    return {
        valid: false,
        value: false,
        error: `Server configuration error: Unsupported TRUST_PROXY value '${rawTrustProxy}'`,
    };
}
export function validateRateLimitConfig(options = {}) {
    const isProduction = isLipilaProductionEnv();
    const isHostedProductionProcess = isProduction || (process.env.NODE_ENV || "").trim().toLowerCase() === "production";
    const rawEnabled = (process.env.RATE_LIMIT_ENABLED ?? "true").trim().toLowerCase();
    const enabled = rawEnabled !== "false";
    if (isHostedProductionProcess && !enabled) {
        return {
            valid: false,
            enabled: false,
            storeMode: "redis",
            error: "Server configuration error: RATE_LIMIT_ENABLED cannot be disabled in production",
        };
    }
    if (!enabled) {
        return {
            valid: true,
            enabled: false,
            storeMode: "memory",
        };
    }
    const rawStore = (process.env.RATE_LIMIT_STORE || (isHostedProductionProcess ? "redis" : "")).trim().toLowerCase();
    const redisUrl = (process.env.REDIS_URL || "").trim();
    if (isHostedProductionProcess) {
        if (rawStore && rawStore !== "redis") {
            return {
                valid: false,
                enabled: true,
                storeMode: "redis",
                error: "Server configuration error: In-memory rate limiting is prohibited in production; set RATE_LIMIT_STORE=redis with REDIS_URL",
            };
        }
        if (!redisUrl && !options.hasCustomRedisSendCommand) {
            return {
                valid: false,
                enabled: true,
                storeMode: "redis",
                error: "Server configuration error: REDIS_URL is mandatory in production for shared rate limiting",
            };
        }
        return {
            valid: true,
            enabled: true,
            storeMode: "redis",
            redisUrl: redisUrl || undefined,
        };
    }
    // Non-production (development / test)
    if (rawStore && rawStore !== "redis" && rawStore !== "memory") {
        return {
            valid: false,
            enabled: true,
            storeMode: "memory",
            error: `Server configuration error: Invalid RATE_LIMIT_STORE '${rawStore}'. Allowed: redis, memory`,
        };
    }
    if (options.hasCustomRedisSendCommand || (rawStore === "redis" && redisUrl)) {
        return {
            valid: true,
            enabled: true,
            storeMode: "redis",
            redisUrl: redisUrl || undefined,
        };
    }
    if (redisUrl && rawStore !== "memory") {
        return {
            valid: true,
            enabled: true,
            storeMode: "redis",
            redisUrl,
        };
    }
    if (rawStore === "redis" && !redisUrl && process.env.RATE_LIMIT_STRICT === "true") {
        return {
            valid: false,
            enabled: true,
            storeMode: "redis",
            error: "Server configuration error: REDIS_URL is missing with RATE_LIMIT_STRICT=true",
        };
    }
    return {
        valid: true,
        enabled: true,
        storeMode: "memory",
    };
}
function getNormalizedIp(req) {
    const rawIp = req.ip || req.socket?.remoteAddress || "127.0.0.1";
    return ipKeyGenerator(rawIp);
}
function getAuthenticatedUidOrIpKey(req) {
    if (req.user?.uid) {
        return `uid:${req.user.uid}`;
    }
    return `ip:${getNormalizedIp(req)}`;
}
function getKeyPrefixTag(key) {
    if (key.startsWith("uid:")) {
        return `uid:${key.slice(4, 10)}***`;
    }
    return "ip:[redacted]";
}
function createFailClosedRedisCommandSender(redisUrl) {
    const client = createClient({
        url: redisUrl,
        disableOfflineQueue: true,
        socket: {
            connectTimeout: readPositiveIntEnv("REDIS_CONNECT_TIMEOUT_MS", 2000),
            reconnectStrategy: (retries) => Math.min(200 * (retries + 1), 2000),
        },
    });
    let connectPromise = null;
    let lastConnectErrorAt = 0;
    const connectCooldownMs = readPositiveIntEnv("REDIS_RECONNECT_COOLDOWN_MS", 250);
    client.on("error", () => {
        connectPromise = null;
        // Intentionally suppress noisy unhandled client error events; request path fails closed safely with HTTP 503.
    });
    client.on("end", () => {
        connectPromise = null;
    });
    client.on("ready", () => {
        lastConnectErrorAt = 0;
    });
    activeRedisClients.add(client);
    const ensureConnected = async () => {
        if (client.isReady)
            return;
        // If client socket is already open and reconnecting in the background, fail closed immediately instead of stalling handlers.
        if (client.isOpen) {
            throw new Error("Redis connection unavailable (reconnecting)");
        }
        const now = Date.now();
        if (lastConnectErrorAt > 0 && now - lastConnectErrorAt < connectCooldownMs) {
            throw new Error("Redis connection unavailable");
        }
        if (!connectPromise) {
            connectPromise = client
                .connect()
                .then(() => {
                lastConnectErrorAt = 0;
            })
                .catch((err) => {
                lastConnectErrorAt = Date.now();
                connectPromise = null;
                throw err;
            });
        }
        await connectPromise;
    };
    const sendCommand = async (...args) => {
        await ensureConnected();
        if (!client.isReady) {
            throw new Error("Redis connection unavailable");
        }
        return client.sendCommand(args);
    };
    const close = async () => {
        activeRedisClients.delete(client);
        connectPromise = null;
        try {
            if (client.isOpen) {
                await client.quit();
            }
        }
        catch {
            try {
                await client.disconnect();
            }
            catch {
                // Ignore
            }
        }
    };
    return { sendCommand, close };
}
function createSafeRedisStore(prefix, sendCommand) {
    const store = new RedisStore({
        prefix,
        sendCommand,
    });
    const origInit = store.init.bind(store);
    store.init = async (opts) => {
        await Promise.resolve(origInit(opts)).catch(() => undefined);
    };
    return store;
}
function wrapLimiterFailClosed(limiter, group, failClosedOnStoreError) {
    return (req, res, next) => {
        limiter(req, res, (err) => {
            if (!err) {
                next();
                return;
            }
            // Sanitized server log — never leak Redis URL, credentials, or stack traces to callers
            console.error(`[RateLimit Store Error] group=${group} path=${req.path} Store operation failed`);
            if (failClosedOnStoreError) {
                res.status(503).json({
                    error: "ServiceUnavailable",
                    code: "RATE_LIMIT_STORE_UNAVAILABLE",
                    message: "Request throttling protection is temporarily unavailable. Please try again shortly.",
                });
                return;
            }
            res.status(503).json({
                error: "ServiceUnavailable",
                code: "RATE_LIMIT_UNAVAILABLE",
                message: "Rate limiting service unavailable.",
            });
        });
    };
}
function composeMiddlewares(...handlers) {
    return (req, res, next) => {
        let idx = 0;
        const step = (err) => {
            if (err) {
                next(err);
                return;
            }
            if (idx >= handlers.length) {
                next();
                return;
            }
            const fn = handlers[idx++];
            fn(req, res, step);
        };
        step();
    };
}
export function createRateLimiters(options = {}) {
    const config = validateRateLimitConfig({
        hasCustomRedisSendCommand: Boolean(options.redisSendCommand),
    });
    if (!config.valid) {
        throw new Error(config.error || "Invalid rate limiting configuration");
    }
    const noop = (_req, _res, next) => next();
    if (!config.enabled) {
        return {
            general: noop,
            authLogin: noop,
            passwordRecovery: noop,
            assignmentCreate: noop,
            researchCreate: noop,
            paymentInitiate: noop,
            paymentStatus: noop,
            writerAction: noop,
            fileUpload: noop,
            disputeCreate: noop,
            lipilaWebhook: noop,
            shutdown: async () => undefined,
        };
    }
    const keyPrefixBase = options.storeKeyPrefix || "rl:databoy";
    const isProd = isLipilaProductionEnv();
    let closeRedisClient;
    let sendCommand = options.redisSendCommand;
    if (!sendCommand && config.storeMode === "redis" && config.redisUrl) {
        const conn = createFailClosedRedisCommandSender(config.redisUrl);
        sendCommand = conn.sendCommand;
        closeRedisClient = conn.close;
    }
    const buildLimiter = (cfg) => {
        const store = config.storeMode === "redis" && sendCommand
            ? createSafeRedisStore(`${keyPrefixBase}:${cfg.group}:`, sendCommand)
            : undefined;
        const handler = rateLimit({
            windowMs: cfg.windowMs,
            limit: cfg.limit,
            standardHeaders: "draft-7",
            legacyHeaders: false,
            passOnStoreError: false,
            store,
            keyGenerator: (req) => cfg.keyGenerator(req),
            skip: cfg.skip ? (req) => cfg.skip(req) : undefined,
            validate: {
                trustProxy: true,
                xForwardedForHeader: false,
                default: true,
            },
            handler: (req, res) => {
                const rateInfo = req.rateLimit;
                let retryAfterSeconds = Math.max(1, Math.ceil(cfg.windowMs / 1000));
                if (rateInfo?.resetTime instanceof Date) {
                    retryAfterSeconds = Math.max(1, Math.ceil((rateInfo.resetTime.getTime() - Date.now()) / 1000));
                }
                res.setHeader("Retry-After", String(retryAfterSeconds));
                const keyTag = getKeyPrefixTag(cfg.keyGenerator(req));
                console.warn(`[RateLimit Exceeded] group=${cfg.group} method=${req.method} path=${req.path} key=${keyTag} retryAfter=${retryAfterSeconds}s`);
                res.status(429).json({
                    error: "TooManyRequests",
                    code: "RATE_LIMIT_EXCEEDED",
                    group: cfg.group,
                    message: cfg.message,
                    retryAfterSeconds,
                });
            },
        });
        return wrapLimiterFailClosed(handler, cfg.group, isProd || config.storeMode === "redis");
    };
    // Helper for sensitive authenticated actions: enforces primary UID limit AND secondary IP anti-Sybil cap
    const buildDualUidAndIpLimiter = (cfg) => {
        const windowMs = readPositiveIntEnv(cfg.windowEnv, cfg.defaultWindowMs);
        const uidLimit = readPositiveIntEnv(cfg.uidLimitEnv, cfg.defaultUidLimit);
        const ipLimit = readPositiveIntEnv(cfg.ipLimitEnv, Math.max(cfg.defaultIpLimit, uidLimit));
        const uidLimiter = buildLimiter({
            group: `${cfg.group}_uid`,
            windowMs,
            limit: uidLimit,
            keyGenerator: getAuthenticatedUidOrIpKey,
            message: cfg.message,
        });
        const ipLimiter = buildLimiter({
            group: `${cfg.group}_ip`,
            windowMs,
            limit: ipLimit,
            keyGenerator: (req) => `ip:${getNormalizedIp(req)}`,
            message: `${cfg.message} (IP threshold exceeded)`,
        });
        // Check UID quota before IP quota so authenticated single-user exhaustion reports deterministically,
        // while multi-account attacks from one IP hit the IP cap.
        return composeMiddlewares(uidLimiter, ipLimiter);
    };
    const general = buildLimiter({
        group: "general",
        windowMs: readPositiveIntEnv("RATE_LIMIT_GENERAL_WINDOW_MS", 60 * 1000),
        limit: readPositiveIntEnv("RATE_LIMIT_GENERAL_MAX", 120),
        keyGenerator: (req) => `ip:${getNormalizedIp(req)}`,
        message: "Too many API requests. Please slow down and try again shortly.",
        skip: (req) => req.path === "/payments/lipila-callback" || req.originalUrl.startsWith("/api/payments/lipila-callback"),
    });
    const authLogin = buildLimiter({
        group: "auth_login",
        windowMs: readPositiveIntEnv("RATE_LIMIT_AUTH_LOGIN_WINDOW_MS", 15 * 60 * 1000),
        limit: readPositiveIntEnv("RATE_LIMIT_AUTH_LOGIN_MAX", 5),
        keyGenerator: (req) => `ip:${getNormalizedIp(req)}`,
        message: "Too many login attempts. Please wait 15 minutes before trying again.",
    });
    const passwordRecovery = buildLimiter({
        group: "password_recovery",
        windowMs: readPositiveIntEnv("RATE_LIMIT_PASSWORD_RECOVERY_WINDOW_MS", 15 * 60 * 1000),
        limit: readPositiveIntEnv("RATE_LIMIT_PASSWORD_RECOVERY_MAX", 3),
        keyGenerator: (req) => `ip:${getNormalizedIp(req)}`,
        message: "Too many password recovery attempts. Please try again later.",
    });
    const assignmentCreate = buildDualUidAndIpLimiter({
        group: "assignment_create",
        uidLimitEnv: "RATE_LIMIT_ASSIGNMENT_CREATE_MAX",
        defaultUidLimit: 5,
        ipLimitEnv: "RATE_LIMIT_ASSIGNMENT_CREATE_IP_MAX",
        defaultIpLimit: 15,
        windowEnv: "RATE_LIMIT_ASSIGNMENT_CREATE_WINDOW_MS",
        defaultWindowMs: 10 * 60 * 1000,
        message: "Too many assignments created in a short period. Please wait before creating another assignment.",
    });
    const researchCreate = buildDualUidAndIpLimiter({
        group: "research_create",
        uidLimitEnv: "RATE_LIMIT_RESEARCH_CREATE_MAX",
        defaultUidLimit: 5,
        ipLimitEnv: "RATE_LIMIT_RESEARCH_CREATE_IP_MAX",
        defaultIpLimit: 15,
        windowEnv: "RATE_LIMIT_RESEARCH_CREATE_WINDOW_MS",
        defaultWindowMs: 10 * 60 * 1000,
        message: "Too many research requests submitted in a short period. Please wait before submitting another.",
    });
    const paymentInitiate = buildDualUidAndIpLimiter({
        group: "payment_initiate",
        uidLimitEnv: "RATE_LIMIT_PAYMENT_INITIATE_MAX",
        defaultUidLimit: 3,
        ipLimitEnv: "RATE_LIMIT_PAYMENT_INITIATE_IP_MAX",
        defaultIpLimit: 9,
        windowEnv: "RATE_LIMIT_PAYMENT_INITIATE_WINDOW_MS",
        defaultWindowMs: 10 * 60 * 1000,
        message: "Too many payment initiation attempts. Check your pending handset prompt or poll payment status before retrying.",
    });
    const paymentStatus = buildLimiter({
        group: "payment_status",
        windowMs: readPositiveIntEnv("RATE_LIMIT_PAYMENT_STATUS_WINDOW_MS", 60 * 1000),
        limit: readPositiveIntEnv("RATE_LIMIT_PAYMENT_STATUS_MAX", 30),
        keyGenerator: getAuthenticatedUidOrIpKey,
        message: "Too many payment status checks. Please wait a few seconds before polling again.",
    });
    const writerAction = buildLimiter({
        group: "writer_action",
        windowMs: readPositiveIntEnv("RATE_LIMIT_WRITER_ACTION_WINDOW_MS", 60 * 1000),
        limit: readPositiveIntEnv("RATE_LIMIT_WRITER_ACTION_MAX", 10),
        keyGenerator: getAuthenticatedUidOrIpKey,
        message: "Too many writer task actions in a short window. Please wait a moment before retrying.",
    });
    const fileUpload = buildLimiter({
        group: "file_upload",
        windowMs: readPositiveIntEnv("RATE_LIMIT_FILE_UPLOAD_WINDOW_MS", 10 * 60 * 1000),
        limit: readPositiveIntEnv("RATE_LIMIT_FILE_UPLOAD_MAX", 10),
        keyGenerator: getAuthenticatedUidOrIpKey,
        message: "Too many document upload requests. Please wait before uploading additional files.",
    });
    const disputeCreate = buildDualUidAndIpLimiter({
        group: "dispute_create",
        uidLimitEnv: "RATE_LIMIT_DISPUTE_CREATE_MAX",
        defaultUidLimit: 3,
        ipLimitEnv: "RATE_LIMIT_DISPUTE_CREATE_IP_MAX",
        defaultIpLimit: 9,
        windowEnv: "RATE_LIMIT_DISPUTE_CREATE_WINDOW_MS",
        defaultWindowMs: 60 * 60 * 1000,
        message: "Dispute submission rate limit reached. Please wait before opening another dispute.",
    });
    const lipilaWebhook = buildLimiter({
        group: "lipila_webhook",
        windowMs: readPositiveIntEnv("RATE_LIMIT_WEBHOOK_WINDOW_MS", 60 * 1000),
        limit: readPositiveIntEnv("RATE_LIMIT_WEBHOOK_MAX", 60),
        keyGenerator: (req) => `ip:${getNormalizedIp(req)}`,
        message: "Webhook rate limit temporarily exceeded. Retry shortly.",
    });
    return {
        general,
        authLogin,
        passwordRecovery,
        assignmentCreate,
        researchCreate,
        paymentInitiate,
        paymentStatus,
        writerAction,
        fileUpload,
        disputeCreate,
        lipilaWebhook,
        shutdown: async () => {
            if (closeRedisClient) {
                await closeRedisClient();
            }
        },
    };
}
