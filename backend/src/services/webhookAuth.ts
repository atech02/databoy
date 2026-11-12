import crypto from "crypto";
import { adminDb } from "../config/firebaseAdmin.js";
import {
  parseAndValidateWebhookSecret,
  resolveLipilaEnvironment,
} from "../config/env.js";

export interface VerifyWebhookResult {
  valid: boolean;
  statusCode?: number;
  error?: string;
  webhookId?: string;
  timestamp?: number;
  alreadyCompleted?: boolean;
  leaseToken?: string;
  leaseOwner?: string;
}

export interface LeaseTransitionResult {
  updated: boolean;
  reason?: "NOT_FOUND" | "ALREADY_COMPLETED" | "LEASE_FENCED" | "INVALID_STATE" | "ERROR";
}

/**
 * Validates Lipila webhook server configuration.
 * Returns whether the server is properly configured to accept webhooks.
 */
export function validateWebhookConfig(): { valid: boolean; error?: string } {
  const envCheck = resolveLipilaEnvironment();
  if (!envCheck.valid) {
    return { valid: false, error: envCheck.error };
  }
  const check = parseAndValidateWebhookSecret(process.env.LIPILA_WEBHOOK_SECRET, envCheck.env);
  return { valid: check.valid, error: check.error };
}

/**
 * Standard Webhooks HMAC-SHA256 verification (Lipila specification).
 * Specification:
 * - Headers: webhook-id, webhook-timestamp, webhook-signature
 * - Signed payload: `${webhook-id}.${webhook-timestamp}.${raw_body}`
 * - Secret: Base64-encoded, optionally prefixed with 'whsec_'
 * - Signature: 'v1,<base64-digest>', supporting space-separated signatures for key rotation
 * - Timestamp tolerance: +/- 300 seconds (5 minutes)
 * - Replay protection: Atomic creation with recoverable processing lease
 */
export async function verifyLipilaWebhookSignature(
  headers: Record<string, string | string[] | undefined>,
  rawBody: string,
  secretOverride?: string
): Promise<VerifyWebhookResult> {
  // Extract headers (case-insensitive fallback)
  const webhookId = (headers["webhook-id"] || headers["Webhook-Id"] || "") as string;
  const webhookTimestampStr = (headers["webhook-timestamp"] || headers["Webhook-Timestamp"] || "") as string;
  const webhookSignature = (headers["webhook-signature"] || headers["Webhook-Signature"] || "") as string;

  if (!webhookId || typeof webhookId !== "string" || !webhookId.trim()) {
    return { valid: false, statusCode: 400, error: "Missing required 'webhook-id' header" };
  }

  if (!webhookTimestampStr || typeof webhookTimestampStr !== "string") {
    return { valid: false, statusCode: 400, error: "Missing required 'webhook-timestamp' header" };
  }

  const timestamp = parseInt(webhookTimestampStr, 10);
  if (isNaN(timestamp)) {
    return { valid: false, statusCode: 400, error: "Malformed 'webhook-timestamp' header" };
  }

  if (!webhookSignature || typeof webhookSignature !== "string" || !webhookSignature.trim()) {
    return { valid: false, statusCode: 401, error: "Missing required 'webhook-signature' header" };
  }

  // 1. Timestamp validation (5 minutes tolerance: 300 seconds)
  const nowInSeconds = Math.floor(Date.now() / 1000);
  const diff = nowInSeconds - timestamp;

  if (diff > 300) {
    return {
      valid: false,
      statusCode: 401,
      error: `Webhook timestamp expired. Request timestamp: ${timestamp}, current: ${nowInSeconds} (tolerance: 300s)`,
    };
  }

  if (diff < -300) {
    return {
      valid: false,
      statusCode: 401,
      error: `Webhook timestamp too far in the future. Request timestamp: ${timestamp}, current: ${nowInSeconds}`,
    };
  }

  // 2. Secret Key Parsing & Fail-Closed Enforcement (SEC-01)
  const envCheck = resolveLipilaEnvironment();
  if (!envCheck.valid) {
    return {
      valid: false,
      statusCode: 500,
      error: envCheck.error || "Invalid Lipila environment configuration",
    };
  }

  const rawSecret = secretOverride !== undefined ? secretOverride : process.env.LIPILA_WEBHOOK_SECRET;
  const secretCheck = parseAndValidateWebhookSecret(rawSecret, envCheck.env);
  if (!secretCheck.valid || !secretCheck.secretKey) {
    return {
      valid: false,
      statusCode: 500,
      error: secretCheck.error || "Invalid webhook secret configuration",
    };
  }
  const secretKey = secretCheck.secretKey;

  // 3. Compute expected HMAC-SHA256 signature
  // Signed format: `${webhook-id}.${webhook-timestamp}.${raw_body}`
  const signedPayload = `${webhookId}.${webhookTimestampStr}.${rawBody || ""}`;
  const computedHash = crypto.createHmac("sha256", secretKey).update(signedPayload).digest("base64");
  const expectedSignatureV1 = `v1,${computedHash}`;

  // 4. Compare signatures using constant-time comparison (support multiple space-separated signatures for key rotation)
  const candidateSignatures = webhookSignature.split(" ").map((s) => s.trim()).filter(Boolean);
  let signatureMatched = false;

  const expectedBuffer = Buffer.from(expectedSignatureV1);

  for (const candidate of candidateSignatures) {
    if (!candidate.startsWith("v1,")) {
      continue;
    }
    const candidateBuffer = Buffer.from(candidate);
    if (expectedBuffer.length === candidateBuffer.length && crypto.timingSafeEqual(expectedBuffer, candidateBuffer)) {
      signatureMatched = true;
      break;
    }
  }

  if (!signatureMatched) {
    return { valid: false, statusCode: 401, error: "Invalid webhook signature" };
  }

  // 5. Atomic Transactional Replay Protection & Fenced Lease Acquisition (OPS-02)
  return acquireWebhookLease(webhookId, timestamp);
}

/**
 * Atomically acquires (or re-acquires after expiry/failure) a fenced processing lease
 * for a webhook event inside a single Firestore transaction.
 */
export async function acquireWebhookLease(
  webhookId: string,
  timestamp: number,
  options: { workerId?: string; leaseDurationMs?: number; nowMs?: number } = {}
): Promise<VerifyWebhookResult> {
  const LEASE_DURATION_MS = options.leaseDurationMs ?? 60000;
  const nowMs = options.nowMs ?? Date.now();
  const nowIso = new Date(nowMs).toISOString();
  const leaseOwner = options.workerId || `worker_${crypto.randomBytes(6).toString("hex")}`;
  const leaseToken = crypto.randomUUID();

  try {
    const replayDocRef = adminDb.collection("processedWebhooks").doc(webhookId);

    const txResult = await adminDb.runTransaction<VerifyWebhookResult>(async (tx) => {
      const snap = await tx.get(replayDocRef);

      if (!snap.exists) {
        tx.create(replayDocRef, {
          webhookId,
          timestamp,
          status: "processing",
          leaseToken,
          leaseOwner,
          leaseExpiresAt: nowMs + LEASE_DURATION_MS,
          createdAt: nowIso,
          updatedAt: nowIso,
          retryCount: 0,
        });

        return {
          valid: true,
          webhookId,
          timestamp,
          leaseToken,
          leaseOwner,
        };
      }

      const data = snap.data()!;

      // Case A: Event already completed successfully
      if (data.status === "completed") {
        return {
          valid: true,
          alreadyCompleted: true,
          webhookId,
          timestamp,
        };
      }

      // Case B: Event was rejected previously -> replay attack detected
      if (data.status === "rejected") {
        return {
          valid: false,
          statusCode: 400,
          error: `Replay attack detected. Webhook ID '${webhookId}' has already been processed.`,
        };
      }

      // Case C: Event currently being processed with active (unexpired) lease
      if (data.status === "processing" && data.leaseExpiresAt && nowMs < data.leaseExpiresAt) {
        return {
          valid: false,
          statusCode: 409,
          error: `Webhook '${webhookId}' is currently being processed by another worker`,
        };
      }

      // Case D: Unexpired lease check failed (expired processing lease) OR previous transient failure
      if (data.status === "processing" || data.status === "failed") {
        tx.update(replayDocRef, {
          status: "processing",
          leaseToken,
          leaseOwner,
          leaseExpiresAt: nowMs + LEASE_DURATION_MS,
          updatedAt: nowIso,
          retryCount: (data.retryCount || 0) + 1,
        });

        return {
          valid: true,
          webhookId,
          timestamp,
          leaseToken,
          leaseOwner,
        };
      }

      return {
        valid: false,
        statusCode: 409,
        error: `Webhook '${webhookId}' is in non-acquirable state '${data.status}'`,
      };
    });

    return txResult;
  } catch (err: any) {
    if (process.env.NODE_ENV !== "test") {
      console.error("[Webhook Lease Acquisition Error]:", err);
    }
    return {
      valid: false,
      statusCode: 500,
      error: "Failed to acquire webhook processing lease",
    };
  }
}

/**
 * Verifies current leaseToken inside an atomic Firestore transaction before mutating lease state.
 * Prevents stale/expired workers from completing, renewing, or releasing another worker's lease.
 */
async function transitionWebhookLease(
  webhookId: string,
  leaseToken: string | undefined,
  buildUpdate: (data: any, nowMs: number, nowIso: string) => Record<string, any>
): Promise<LeaseTransitionResult> {
  if (!leaseToken || typeof leaseToken !== "string") {
    return { updated: false, reason: "LEASE_FENCED" };
  }

  const replayDocRef = adminDb.collection("processedWebhooks").doc(webhookId);
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  try {
    return await adminDb.runTransaction<LeaseTransitionResult>(async (tx) => {
      const snap = await tx.get(replayDocRef);
      if (!snap.exists) {
        return { updated: false, reason: "NOT_FOUND" };
      }

      const data = snap.data()!;
      if (data.status === "completed" && data.leaseToken !== leaseToken) {
        return { updated: false, reason: "ALREADY_COMPLETED" };
      }
      if (data.status !== "processing") {
        return { updated: false, reason: "INVALID_STATE" };
      }
      if (!data.leaseToken || data.leaseToken !== leaseToken) {
        return { updated: false, reason: "LEASE_FENCED" };
      }

      const updateFields = buildUpdate(data, nowMs, nowIso);
      tx.update(replayDocRef, updateFields);
      return { updated: true };
    });
  } catch (err) {
    console.error(`[Webhook Lease Transition Error for ${webhookId}]:`, err);
    return { updated: false, reason: "ERROR" };
  }
}

/**
 * Renews an active processing lease only if the caller still holds the current leaseToken.
 */
export async function renewWebhookLease(
  webhookId: string,
  leaseToken: string | undefined,
  extendMs = 60000
): Promise<LeaseTransitionResult> {
  return transitionWebhookLease(webhookId, leaseToken, (_data, nowMs, nowIso) => ({
    leaseExpiresAt: nowMs + extendMs,
    updatedAt: nowIso,
  }));
}

/**
 * Marks a processed webhook as successfully completed only if caller holds the active leaseToken.
 */
export async function markWebhookCompleted(
  webhookId: string,
  leaseToken: string | undefined,
  details: Record<string, any> = {}
): Promise<LeaseTransitionResult> {
  const cleanDetails: Record<string, any> = {};
  for (const [k, v] of Object.entries(details || {})) {
    if (v !== undefined) {
      cleanDetails[k] = v;
    }
  }
  return transitionWebhookLease(webhookId, leaseToken, (_data, _nowMs, nowIso) => ({
    status: "completed",
    completedAt: nowIso,
    updatedAt: nowIso,
    leaseExpiresAt: 0,
    details: cleanDetails,
  }));
}

/**
 * Marks a processed webhook as permanently rejected only if caller holds the active leaseToken.
 */
export async function markWebhookRejected(
  webhookId: string,
  leaseToken: string | undefined,
  errorReason: string
): Promise<LeaseTransitionResult> {
  return transitionWebhookLease(webhookId, leaseToken, (_data, _nowMs, nowIso) => ({
    status: "rejected",
    rejectedAt: nowIso,
    updatedAt: nowIso,
    errorReason,
    leaseExpiresAt: 0,
  }));
}

/**
 * Releases a failed processing lease for safe retry only if caller holds the active leaseToken.
 */
export async function markWebhookFailed(
  webhookId: string,
  leaseToken: string | undefined,
  errorReason: string
): Promise<LeaseTransitionResult> {
  return transitionWebhookLease(webhookId, leaseToken, (_data, _nowMs, nowIso) => ({
    status: "failed",
    failedAt: nowIso,
    updatedAt: nowIso,
    errorReason,
    leaseExpiresAt: 0,
  }));
}

/**
 * Helper to generate valid Lipila standard webhook headers for tests or internal dispatches.
 */
export function generateTestWebhookHeaders(
  payload: string | object,
  secret: string = "whsec_dGVzdF9saXBpbGFfd2ViaG9va19zZWNyZXRfa2V5XzEyMzQ1Njc4OTA=",
  options: {
    webhookId?: string;
    timestamp?: number;
    tamperPayload?: boolean;
    extraSignatures?: string[];
  } = {}
): {
  rawBody: string;
  headers: Record<string, string>;
} {
  const rawBody = typeof payload === "string" ? payload : JSON.stringify(payload);
  const webhookId = options.webhookId || `msg_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
  const timestamp = options.timestamp !== undefined ? options.timestamp : Math.floor(Date.now() / 1000);

  let base64Secret = secret.trim();
  if (base64Secret.startsWith("whsec_")) {
    base64Secret = base64Secret.substring(6);
  }
  const secretKey = Buffer.from(base64Secret, "base64");

  const bodyToSign = options.tamperPayload ? rawBody + "_tampered" : rawBody;
  const signedPayload = `${webhookId}.${timestamp}.${bodyToSign}`;
  const computedHash = crypto.createHmac("sha256", secretKey).update(signedPayload).digest("base64");
  let signatureHeader = `v1,${computedHash}`;

  if (options.extraSignatures && options.extraSignatures.length > 0) {
    signatureHeader = `${options.extraSignatures.join(" ")} ${signatureHeader}`;
  }

  return {
    rawBody,
    headers: {
      "Content-Type": "application/json",
      "webhook-id": webhookId,
      "webhook-timestamp": String(timestamp),
      "webhook-signature": signatureHeader,
    },
  };
}
