import crypto from "crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, DeleteObjectCommand, CreateMultipartUploadCommand, UploadPartCommand, CompleteMultipartUploadCommand, AbortMultipartUploadCommand, ListMultipartUploadsCommand, GetBucketCorsCommand, PutBucketCorsCommand, } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { validateR2Config } from "../config/env.js";
export class R2StorageError extends Error {
    code;
    statusCode;
    constructor(code, message, statusCode = 502) {
        super(message);
        this.name = "R2StorageError";
        this.code = code;
        this.statusCode = statusCode;
    }
}
export function getRecommendedR2CorsRules() {
    // In strict production, exclude local development origins to protect cloud buckets
    const isStrictProduction = process.env.NODE_ENV === "production" && process.env.APP_ENV === "production";
    const origins = [
        "https://databoy-aa871.web.app",
        "https://databoy-aa871.firebaseapp.com",
    ];
    if (!isStrictProduction) {
        origins.push("http://localhost:3000", "http://127.0.0.1:3000");
    }
    return [
        {
            AllowedOrigins: origins,
            AllowedMethods: ["GET", "PUT", "HEAD"],
            AllowedHeaders: ["content-type", "*"],
            ExposeHeaders: ["ETag"],
            MaxAgeSeconds: 3600,
        },
    ];
}
export const DEFAULT_R2_CORS_RULES = getRecommendedR2CorsRules();
const metrics = {
    presignPutCount: 0,
    presignGetCount: 0,
    headCount: 0,
    deleteCount: 0,
    multipartInitCount: 0,
    multipartPartSignCount: 0,
    multipartCompleteCount: 0,
    multipartAbortCount: 0,
    cleanupCount: 0,
    retryCount: 0,
    failureCount: 0,
    timeoutCount: 0,
};
export function sanitizeUrlForLog(rawUrl) {
    try {
        const parsed = new URL(rawUrl);
        return `${parsed.origin}${parsed.pathname}`;
    }
    catch {
        return "[redacted-url]";
    }
}
export function sanitizeStorageErrorMessage(err) {
    const msg = String(err?.message || err || "Unknown storage error");
    return msg
        .replace(/([?&](?:X-Amz-Signature|X-Amz-Credential|X-Amz-Security-Token)=)[^&\s]+/gi, "$1[REDACTED]")
        .replace(/(https?:\/\/[^\s?]+)\?[^\s]+/gi, "$1?[REDACTED]");
}
function logStorageEvent(level, event, details) {
    if (process.env.NODE_ENV === "test" && level === "info") {
        return;
    }
    const payload = {
        ts: new Date().toISOString(),
        component: "r2_storage",
        level,
        event,
        ...details,
    };
    const serialized = JSON.stringify(payload);
    if (level === "error")
        console.error(serialized);
    else if (level === "warn")
        console.warn(serialized);
    else
        console.log(serialized);
}
let cachedClientKey = "";
let cachedClient = null;
export function getValidatedR2ConfigOrThrow() {
    const validation = validateR2Config({ requireConfigured: true });
    if (!validation.valid || !validation.config) {
        throw new R2StorageError("R2_NOT_CONFIGURED", validation.error || "Cloudflare R2 storage is not configured", 503);
    }
    return validation.config;
}
function getS3Client(config) {
    const key = `${config.endpoint}|${config.region}|${config.accessKeyId}|${crypto
        .createHash("sha256")
        .update(config.secretAccessKey)
        .digest("hex")}`;
    if (cachedClient && cachedClientKey === key) {
        return cachedClient;
    }
    // Cloudflare R2 S3 Signature V4 auth layer strictly requires "us-east-1" in the credential scope.
    // If region is "auto", map to "us-east-1" to ensure presigned PUT URLs pass R2 signature verification.
    const signingRegion = config.region === "auto" ? "us-east-1" : config.region;
    cachedClient = new S3Client({
        region: signingRegion,
        endpoint: config.endpoint,
        // Path-style avoids bucket subdomain SSL wildcard issues across R2 and local S3 test servers
        forcePathStyle: true,
        // Disable automatic checksum injection (x-amz-checksum-crc32) which breaks R2 presigned PUTs
        requestChecksumCalculation: "WHEN_REQUIRED",
        responseChecksumValidation: "WHEN_REQUIRED",
        maxAttempts: 1, // Managed explicitly by executeWithRetry so timeout/metrics stay deterministic
        credentials: {
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
        },
    });
    cachedClientKey = key;
    return cachedClient;
}
function isRetryableStorageError(err) {
    const name = String(err?.name || "");
    const code = String(err?.code || err?.Code || "");
    const status = err?.$metadata?.httpStatusCode;
    if (name === "TimeoutError" || name === "AbortError" || code === "ETIMEDOUT" || code === "ECONNRESET" || code === "ECONNREFUSED") {
        return true;
    }
    if (typeof status === "number" && (status === 429 || status >= 500)) {
        return true;
    }
    return false;
}
async function executeWithRetry(operationName, timeoutMs, maxAttempts, fn) {
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => {
            controller.abort(new Error(`R2 operation '${operationName}' timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        try {
            const result = await fn(controller.signal);
            clearTimeout(timer);
            return result;
        }
        catch (err) {
            clearTimeout(timer);
            lastError = err;
            const aborted = controller.signal.aborted || err?.name === "AbortError" || err?.name === "TimeoutError";
            if (aborted) {
                metrics.timeoutCount += 1;
            }
            if (attempt < maxAttempts && isRetryableStorageError(err)) {
                metrics.retryCount += 1;
                logStorageEvent("warn", "r2_operation_retry", {
                    operation: operationName,
                    attempt,
                    reason: sanitizeStorageErrorMessage(err),
                });
                await new Promise((r) => setTimeout(r, attempt * 150));
                continue;
            }
            metrics.failureCount += 1;
            logStorageEvent("error", "r2_operation_failed", {
                operation: operationName,
                attempt,
                timedOut: aborted,
                reason: sanitizeStorageErrorMessage(err),
            });
            if (aborted) {
                throw new R2StorageError("R2_TIMEOUT", `Storage operation timed out after ${timeoutMs}ms. Please verify and retry safely.`, 504);
            }
            throw err;
        }
    }
    throw lastError;
}
function buildSafeContentDisposition(fileName, disposition) {
    const clean = fileName.replace(/[\r\n"\\]/g, "_").trim() || "document";
    return `${disposition}; filename="${clean}"`;
}
export const r2StorageService = {
    getMetrics() {
        return { ...metrics };
    },
    resetMetricsForTest() {
        Object.keys(metrics).forEach((k) => {
            metrics[k] = 0;
        });
        cachedClient = null;
        cachedClientKey = "";
    },
    async createPresignedUploadUrl(params) {
        const config = getValidatedR2ConfigOrThrow();
        const client = getS3Client(config);
        const ttl = Math.min(params.expiresInSeconds || config.presignedPutTtlSeconds, 900);
        // Note: Do NOT include ContentLength in PutObjectCommand for presigning.
        // Specifying ContentLength forces AWS SDK to add 'content-length' to X-Amz-SignedHeaders.
        // In browsers, setting 'Content-Length' via XHR is strictly forbidden, causing signature
        // mismatches or CORS preflight rejection when uploaded from client browsers.
        // File size is still validated prior to presigning and strictly verified via headObject on complete.
        const command = new PutObjectCommand({
            Bucket: config.bucketName,
            Key: params.storageKey,
            ContentType: params.contentType,
        });
        const uploadUrl = await getSignedUrl(client, command, {
            expiresIn: ttl,
            signableHeaders: new Set(["host", "content-type"]),
        });
        metrics.presignPutCount += 1;
        logStorageEvent("info", "presign_put_created", {
            storageKey: params.storageKey,
            ttlSeconds: ttl,
            contentType: params.contentType,
            sizeBytes: params.contentLength,
        });
        return {
            uploadUrl,
            expiresInSeconds: ttl,
            bucketName: config.bucketName,
        };
    },
    async headObject(storageKey) {
        const config = getValidatedR2ConfigOrThrow();
        const client = getS3Client(config);
        metrics.headCount += 1;
        try {
            const response = await executeWithRetry("headObject", config.requestTimeoutMs, 2, (signal) => client.send(new HeadObjectCommand({
                Bucket: config.bucketName,
                Key: storageKey,
            }), { abortSignal: signal }));
            return {
                exists: true,
                contentLength: typeof response.ContentLength === "number" ? response.ContentLength : undefined,
                contentType: response.ContentType,
                etag: response.ETag ? response.ETag.replace(/"/g, "") : undefined,
                lastModified: response.LastModified ? response.LastModified.toISOString() : undefined,
            };
        }
        catch (err) {
            const status = err?.$metadata?.httpStatusCode;
            const code = String(err?.name || err?.Code || "");
            if (status === 404 || code === "NotFound" || code === "NoSuchKey") {
                return { exists: false };
            }
            if (err instanceof R2StorageError) {
                throw err;
            }
            throw new R2StorageError("R2_HEAD_FAILED", `Failed to verify object in R2 storage: ${sanitizeStorageErrorMessage(err)}`, 502);
        }
    },
    async createPresignedDownloadUrl(params) {
        const config = getValidatedR2ConfigOrThrow();
        const client = getS3Client(config);
        const ttl = Math.min(params.expiresInSeconds || config.presignedGetTtlSeconds, 600);
        const dispositionMode = params.disposition === "inline" ? "inline" : "attachment";
        const command = new GetObjectCommand({
            Bucket: config.bucketName,
            Key: params.storageKey,
            ResponseContentDisposition: buildSafeContentDisposition(params.fileName, dispositionMode),
            ...(params.contentType ? { ResponseContentType: params.contentType } : {}),
        });
        const downloadUrl = await getSignedUrl(client, command, { expiresIn: ttl });
        metrics.presignGetCount += 1;
        logStorageEvent("info", "presign_get_created", {
            storageKey: params.storageKey,
            ttlSeconds: ttl,
            disposition: dispositionMode,
        });
        return { downloadUrl, expiresInSeconds: ttl };
    },
    async deleteObject(storageKey) {
        const config = getValidatedR2ConfigOrThrow();
        const client = getS3Client(config);
        metrics.deleteCount += 1;
        try {
            await executeWithRetry("deleteObject", config.requestTimeoutMs, 2, (signal) => client.send(new DeleteObjectCommand({
                Bucket: config.bucketName,
                Key: storageKey,
            }), { abortSignal: signal }));
            logStorageEvent("info", "object_deleted", { storageKey });
        }
        catch (err) {
            if (err instanceof R2StorageError)
                throw err;
            throw new R2StorageError("R2_DELETE_FAILED", `Failed to delete object from R2 storage: ${sanitizeStorageErrorMessage(err)}`, 502);
        }
    },
    async createMultipartUpload(params) {
        const config = getValidatedR2ConfigOrThrow();
        const client = getS3Client(config);
        metrics.multipartInitCount += 1;
        try {
            const response = await executeWithRetry("createMultipartUpload", config.requestTimeoutMs, 2, (signal) => client.send(new CreateMultipartUploadCommand({
                Bucket: config.bucketName,
                Key: params.storageKey,
                ContentType: params.contentType,
            }), { abortSignal: signal }));
            if (!response.UploadId) {
                throw new R2StorageError("R2_MULTIPART_INIT_FAILED", "R2 did not return an UploadId", 502);
            }
            logStorageEvent("info", "multipart_initiated", {
                storageKey: params.storageKey,
                uploadIdPrefix: response.UploadId.slice(0, 8),
            });
            return { uploadId: response.UploadId, bucketName: config.bucketName };
        }
        catch (err) {
            if (err instanceof R2StorageError)
                throw err;
            throw new R2StorageError("R2_MULTIPART_INIT_FAILED", `Failed to initiate multipart upload: ${sanitizeStorageErrorMessage(err)}`, 502);
        }
    },
    async createPresignedPartUrl(params) {
        const config = getValidatedR2ConfigOrThrow();
        const client = getS3Client(config);
        const ttl = Math.min(params.expiresInSeconds || config.multipartPartTtlSeconds, 3600);
        const command = new UploadPartCommand({
            Bucket: config.bucketName,
            Key: params.storageKey,
            UploadId: params.uploadId,
            PartNumber: params.partNumber,
        });
        const uploadUrl = await getSignedUrl(client, command, {
            expiresIn: ttl,
            signableHeaders: new Set(["host"]),
        });
        metrics.multipartPartSignCount += 1;
        return { uploadUrl, expiresInSeconds: ttl };
    },
    async completeMultipartUpload(params) {
        const config = getValidatedR2ConfigOrThrow();
        const client = getS3Client(config);
        metrics.multipartCompleteCount += 1;
        const sortedParts = [...params.parts]
            .sort((a, b) => a.partNumber - b.partNumber)
            .map((p) => ({
            PartNumber: p.partNumber,
            ETag: p.etag.startsWith('"') ? p.etag : `"${p.etag}"`,
        }));
        try {
            const response = await executeWithRetry("completeMultipartUpload", config.requestTimeoutMs, 2, (signal) => client.send(new CompleteMultipartUploadCommand({
                Bucket: config.bucketName,
                Key: params.storageKey,
                UploadId: params.uploadId,
                MultipartUpload: { Parts: sortedParts },
            }), { abortSignal: signal }));
            logStorageEvent("info", "multipart_completed", {
                storageKey: params.storageKey,
                partCount: sortedParts.length,
            });
            return {
                etag: response.ETag ? response.ETag.replace(/"/g, "") : undefined,
            };
        }
        catch (err) {
            if (err instanceof R2StorageError)
                throw err;
            throw new R2StorageError("R2_MULTIPART_COMPLETE_FAILED", `Failed to complete multipart upload: ${sanitizeStorageErrorMessage(err)}`, 502);
        }
    },
    async abortMultipartUpload(params) {
        const config = getValidatedR2ConfigOrThrow();
        const client = getS3Client(config);
        metrics.multipartAbortCount += 1;
        try {
            await executeWithRetry("abortMultipartUpload", config.requestTimeoutMs, 2, (signal) => client.send(new AbortMultipartUploadCommand({
                Bucket: config.bucketName,
                Key: params.storageKey,
                UploadId: params.uploadId,
            }), { abortSignal: signal }));
            logStorageEvent("info", "multipart_aborted", { storageKey: params.storageKey });
        }
        catch (err) {
            if (err instanceof R2StorageError)
                throw err;
            throw new R2StorageError("R2_MULTIPART_ABORT_FAILED", `Failed to abort multipart upload: ${sanitizeStorageErrorMessage(err)}`, 502);
        }
    },
    async cleanupStaleMultipartUploads(options = {}) {
        const config = getValidatedR2ConfigOrThrow();
        const client = getS3Client(config);
        const maxAgeMs = (options.maxAgeHours ?? 24) * 60 * 60 * 1000;
        const cutoff = Date.now() - maxAgeMs;
        metrics.cleanupCount += 1;
        const listResp = await executeWithRetry("listMultipartUploads", config.requestTimeoutMs, 2, (signal) => client.send(new ListMultipartUploadsCommand({
            Bucket: config.bucketName,
            ...(options.prefix ? { Prefix: options.prefix } : {}),
        }), { abortSignal: signal }));
        const uploads = listResp.Uploads || [];
        let aborted = 0;
        for (const up of uploads) {
            if (!up.Key || !up.UploadId || !up.Initiated)
                continue;
            if (up.Initiated.getTime() < cutoff) {
                await r2StorageService.abortMultipartUpload({
                    storageKey: up.Key,
                    uploadId: up.UploadId,
                });
                aborted += 1;
            }
        }
        logStorageEvent("info", "multipart_cleanup_finished", {
            scanned: uploads.length,
            aborted,
        });
        return { scanned: uploads.length, aborted };
    },
    async getObjectBuffer(storageKey) {
        const config = getValidatedR2ConfigOrThrow();
        const client = getS3Client(config);
        try {
            const response = await executeWithRetry("getObjectBuffer", config.requestTimeoutMs, 2, (signal) => client.send(new GetObjectCommand({
                Bucket: config.bucketName,
                Key: storageKey,
            }), { abortSignal: signal }));
            if (!response.Body) {
                throw new R2StorageError("R2_GET_FAILED", "Empty body returned from R2 storage", 502);
            }
            const byteArray = await response.Body.transformToByteArray();
            return Buffer.from(byteArray);
        }
        catch (err) {
            if (err instanceof R2StorageError)
                throw err;
            throw new R2StorageError("R2_GET_FAILED", `Failed to retrieve object from R2 storage: ${sanitizeStorageErrorMessage(err)}`, 502);
        }
    },
    async getBucketCors() {
        const config = getValidatedR2ConfigOrThrow();
        const client = getS3Client(config);
        try {
            const response = await executeWithRetry("getBucketCors", config.requestTimeoutMs, 1, (signal) => client.send(new GetBucketCorsCommand({
                Bucket: config.bucketName,
            }), { abortSignal: signal }));
            return response.CORSRules || [];
        }
        catch (err) {
            const status = err?.$metadata?.httpStatusCode;
            const code = String(err?.name || err?.Code || "");
            if (status === 404 || code === "NoSuchCORSConfiguration") {
                return [];
            }
            if (err instanceof R2StorageError)
                throw err;
            throw new R2StorageError("R2_CORS_GET_FAILED", `Failed to get R2 bucket CORS: ${sanitizeStorageErrorMessage(err)}`, 502);
        }
    },
    async putBucketCors(rules = DEFAULT_R2_CORS_RULES) {
        const config = getValidatedR2ConfigOrThrow();
        const client = getS3Client(config);
        try {
            await executeWithRetry("putBucketCors", config.requestTimeoutMs, 2, (signal) => client.send(new PutBucketCorsCommand({
                Bucket: config.bucketName,
                CORSConfiguration: {
                    CORSRules: rules,
                },
            }), { abortSignal: signal }));
            logStorageEvent("info", "bucket_cors_updated", {
                bucket: config.bucketName,
                ruleCount: rules.length,
            });
        }
        catch (err) {
            if (err instanceof R2StorageError)
                throw err;
            throw new R2StorageError("R2_CORS_PUT_FAILED", `Failed to set R2 bucket CORS: ${sanitizeStorageErrorMessage(err)}`, 502);
        }
    },
    async ensureDefaultBucketCors() {
        try {
            const current = await r2StorageService.getBucketCors();
            const hasWebOrigin = current.some((r) => r.AllowedOrigins.some((o) => o === "*" || o.includes("databoy-aa871.web.app")));
            if (!hasWebOrigin || current.length === 0) {
                logStorageEvent("warn", "bucket_cors_auto_configure", {
                    message: "R2 bucket CORS does not allow databoy-aa871.web.app. Applying recommended CORS configuration.",
                });
                const rules = getRecommendedR2CorsRules();
                await r2StorageService.putBucketCors(rules);
                return { applied: true, rules };
            }
            return { applied: false, rules: current };
        }
        catch (err) {
            logStorageEvent("warn", "bucket_cors_auto_configure_warning", {
                error: sanitizeStorageErrorMessage(err),
            });
            return { applied: false, rules: [] };
        }
    },
};
