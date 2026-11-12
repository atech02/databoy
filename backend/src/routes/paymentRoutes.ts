import { Router, Request, Response, RequestHandler } from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { adminDb } from "../config/firebaseAdmin.js";
import { validateLipilaConfig, isPaymentsDisabledInStaging } from "../config/env.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/roleGuard.js";
import { RateLimiterBundle } from "../middleware/rateLimit.js";
import {
  lipilaService,
  normalizeZambianPhone,
  validateNetwork,
  maskPhoneNumber,
} from "../services/lipilaService.js";
import { logAuditEvent } from "../services/auditService.js";
import { createNotification } from "../services/notificationService.js";
import {
  verifyLipilaWebhookSignature,
  renewWebhookLease,
  markWebhookCompleted,
  markWebhookFailed,
  markWebhookRejected,
} from "../services/webhookAuth.js";

const noopMiddleware: RequestHandler = (_req, _res, next) => next();

export type PayableTargetType = "assignment" | "research";

// Validation schema for initiating payment (supports assignments and research requests)
const initiatePaymentSchema = z.object({
  assignmentId: z.string().min(1).optional(),
  researchRequestId: z.string().min(1).optional(),
  targetType: z.enum(["assignment", "research"]).optional(),
  targetId: z.string().min(1).optional(),
  network: z.string().min(1, "Network is required"),
  phoneNumber: z.string().min(1, "Phone number is required"),
  // Explicitly disallow any amount override from client
  amount: z.number().optional(),
  // Check for forbidden card fields
  cardNumber: z.any().optional(),
  cvv: z.any().optional(),
  expiry: z.any().optional(),
  pin: z.any().optional(),
  cardExpiry: z.any().optional(),
  cardHolder: z.any().optional(),
});

interface PayableTargetDescriptor {
  targetType: PayableTargetType;
  targetId: string;
  collectionName: "assignments" | "researchRequests";
  lockId: string;
  notificationLink: string;
}

function getPayableDescriptor(targetType: PayableTargetType, targetId: string): PayableTargetDescriptor {
  if (targetType === "research") {
    return {
      targetType: "research",
      targetId,
      collectionName: "researchRequests",
      lockId: `research_${targetId}`,
      notificationLink: `/research/detail?id=${targetId}`,
    };
  }
  return {
    targetType: "assignment",
    targetId,
    collectionName: "assignments",
    lockId: `assignment_${targetId}`,
    notificationLink: `/projects/detail?id=${targetId}`,
  };
}

function resolveTargetFromPaymentData(paymentData: any): PayableTargetDescriptor {
  if (paymentData?.targetType === "research" || (!paymentData?.targetType && paymentData?.researchRequestId && !paymentData?.assignmentId)) {
    const id = paymentData.targetId || paymentData.researchRequestId;
    return getPayableDescriptor("research", id);
  }
  const id = paymentData?.targetId || paymentData?.assignmentId;
  return getPayableDescriptor("assignment", id);
}

function checkTargetFundingEligibility(
  target: Record<string, any>,
  targetType: PayableTargetType,
  actor?: { uid: string; role: string }
): { ok: true; authoritativeAmount: number } | { ok: false; statusCode: number; error: string } {
  const ownerId = targetType === "research" ? target.studentId : target.customerId;
  if (actor && ownerId !== actor.uid && actor.role !== "admin") {
    return {
      ok: false,
      statusCode: 403,
      error: `Access denied. You do not own this ${targetType === "research" ? "research request" : "assignment"}.`,
    };
  }

  const isAlreadyFunded =
    target.status === "funded" ||
    target.paymentStatus === "funded" ||
    target.escrowStatus === "held" ||
    (targetType === "research" && target.quoteStatus === "paid");

  if (isAlreadyFunded) {
    return {
      ok: false,
      statusCode: 400,
      error: `${targetType === "research" ? "Research request" : "Assignment"} is already funded.`,
    };
  }

  if (targetType === "research") {
    if (target.quoteStatus !== "accepted" || target.status !== "awaiting_payment") {
      return {
        ok: false,
        statusCode: 400,
        error: "Research request quote must be accepted and awaiting payment before checkout.",
      };
    }
  } else {
    if (target.status === "draft") {
      return {
        ok: false,
        statusCode: 400,
        error: "Draft assignments cannot be paid directly. Submit the assignment for server pricing first.",
      };
    }
    if (target.status !== "awaiting_payment") {
      return {
        ok: false,
        statusCode: 400,
        error: `Assignment is not eligible for payment in status '${target.status}'.`,
      };
    }
    if (target.source === "client_fallback" || target.pricingSource === "client_fallback") {
      return {
        ok: false,
        statusCode: 400,
        error: "Assignment pricing source is untrusted and ineligible for checkout.",
      };
    }
    if (process.env.NODE_ENV !== "test" && target.source !== "server_priced") {
      return {
        ok: false,
        statusCode: 400,
        error: "Assignment must carry verified server pricing before checkout.",
      };
    }
    if (target.pricingBreakdown !== undefined) {
      const breakdownTotal = Number(target.pricingBreakdown?.total);
      if (!Number.isFinite(breakdownTotal) || breakdownTotal !== Number(target.budget)) {
        return {
          ok: false,
          statusCode: 400,
          error: "Assignment pricing breakdown integrity check failed.",
        };
      }
    }
  }

  const currency = (target.currency || "ZMW").toUpperCase();
  if (currency !== "ZMW") {
    return {
      ok: false,
      statusCode: 400,
      error: `Unsupported currency '${currency}'. DataBoy payments must be denominated in ZMW.`,
    };
  }

  const rawAmount = targetType === "research" ? target.quoteAmount : target.budget;
  const authoritativeAmount = Number(rawAmount);
  if (!Number.isFinite(authoritativeAmount) || authoritativeAmount <= 0) {
    return {
      ok: false,
      statusCode: 400,
      error: `${targetType === "research" ? "Research quote amount" : "Assignment budget"} must be greater than zero.`,
    };
  }

  return { ok: true, authoritativeAmount };
}

export interface ReconcileResult {
  success: boolean;
  status: "reconciled" | "already_processed" | "already_funded_by_other" | "rejected";
  message: string;
  ledgerEntryId?: string;
}

/**
 * Reconciles a completed Lipila payment atomically with assignment/research funding and immutable ledger.
 * Runs in a single ACID Firestore transaction against the production domain collection (`assignments` or `researchRequests`).
 */
export async function reconcileLipilaPayment(
  paymentDocId: string,
  paymentData: any,
  verifiedTransactionId?: string
): Promise<ReconcileResult> {
  const { customerId, customerEmail, amount, network, maskedPhone, referenceId } = paymentData;
  const desc = resolveTargetFromPaymentData(paymentData);

  const paymentRef = adminDb.collection("payments").doc(paymentDocId);
  const targetRef = adminDb.collection(desc.collectionName).doc(desc.targetId);
  const lockRef = adminDb.collection("paymentLocks").doc(desc.lockId);
  const ledgerRef = adminDb.collection("ledger").doc(`lipila_pay_${referenceId}`);
  const now = new Date().toISOString();

  try {
    const txResult = await adminDb.runTransaction(async (transaction) => {
      // 1. All Reads First
      const [paySnap, targetSnap, ledgerSnap, lockSnap] = await Promise.all([
        transaction.get(paymentRef),
        transaction.get(targetRef),
        transaction.get(ledgerRef),
        transaction.get(lockRef),
      ]);

      if (!paySnap.exists) {
        throw new Error("PAYMENT_NOT_FOUND");
      }

      if (!targetSnap.exists) {
        throw new Error(desc.targetType === "research" ? "RESEARCH_NOT_FOUND" : "ASSIGNMENT_NOT_FOUND");
      }

      const currentPay = paySnap.data()!;
      const currentTarget = targetSnap.data()!;

      // Guard A: Same payment already reconciled or retried
      if (currentPay.status === "Successful" || currentPay.reconciled === true || ledgerSnap.exists) {
        return {
          success: true,
          status: "already_processed" as const,
          message: "Payment was already reconciled into ledger and escrow.",
          ledgerEntryId: ledgerRef.id,
        };
      }

      // Guard B: Different payment attempting to fund an already-funded target
      const isAlreadyFunded =
        currentTarget.status === "funded" ||
        currentTarget.paymentStatus === "funded" ||
        currentTarget.escrowStatus === "held" ||
        (desc.targetType === "research" && currentTarget.quoteStatus === "paid");

      if (isAlreadyFunded && currentTarget.paymentReference && currentTarget.paymentReference !== referenceId) {
        transaction.update(paymentRef, {
          status: "Duplicate_Requires_Refund",
          reconciliationNote: `${desc.targetType} ${desc.targetId} was already funded by reference ${currentTarget.paymentReference}`,
          updatedAt: now,
        });

        if (lockSnap.exists && lockSnap.data()?.activePaymentReferenceId === referenceId) {
          transaction.delete(lockRef);
        }

        return {
          success: false,
          status: "already_funded_by_other" as const,
          message: `Target was already funded by reference '${currentTarget.paymentReference}'. Duplicate collection flagged for refund.`,
        };
      }

      // Guard C: Reject unexpected status mismatch on research requests
      if (desc.targetType === "research" && (currentTarget.quoteStatus !== "accepted" || currentTarget.status !== "awaiting_payment")) {
        throw new Error("RESEARCH_NOT_PAYABLE");
      }

      // 2. Atomic Writes (Payment + Target Domain Record + Immutable Ledger Entry)
      transaction.update(paymentRef, {
        status: "Successful",
        reconciled: true,
        uncertain: false,
        reconciledAt: now,
        completedAt: currentPay.completedAt || now,
        transactionId: verifiedTransactionId || currentPay.transactionId || `LPL-REC-${Date.now()}`,
        updatedAt: now,
      });

      if (desc.targetType === "research") {
        transaction.update(targetRef, {
          status: "funded",
          quoteStatus: "paid",
          paymentStatus: "funded",
          escrowStatus: "held",
          paymentReference: referenceId,
          paymentNetwork: network || "mobile_money",
          fundedAt: now,
          updatedAt: now,
        });
      } else {
        const updatedHistory = Array.isArray(currentTarget.statusHistory) ? [...currentTarget.statusHistory] : [];
        updatedHistory.push({
          status: "funded",
          actorId: customerId || "customer",
          actorName: customerEmail || customerId || "Customer",
          actorRole: "customer",
          timestamp: now,
          note: `Lipila Mobile Money Escrow Secured (${network || "mobile_money"}) - Ref: ${referenceId}`,
        });

        transaction.update(targetRef, {
          status: "funded",
          paymentStatus: "funded",
          escrowStatus: "held",
          payoutStatus: "escrowed",
          paymentReference: referenceId,
          paymentNetwork: network || "mobile_money",
          fundedAt: now,
          updatedAt: now,
          statusHistory: updatedHistory,
        });
      }

      if (lockSnap.exists && lockSnap.data()?.activePaymentReferenceId === referenceId) {
        transaction.delete(lockRef);
      }

      // Exactly-one deterministic immutable ledger document created within the same transaction
      transaction.set(ledgerRef, {
        id: ledgerRef.id,
        idempotencyKey: `lipila_pay_${referenceId}`,
        type: "customer_payment",
        userId: customerId || "customer",
        userEmail: customerEmail || "",
        userRole: "customer",
        amount: Number(amount),
        currency: "ZMW",
        targetType: desc.targetType,
        targetId: desc.targetId,
        ...(desc.targetType === "research" ? { researchRequestId: desc.targetId } : { assignmentId: desc.targetId }),
        referenceId,
        description: `Lipila Mobile Money Escrow Funding (${network || "mobile_money"}) for ${desc.targetType} ${desc.targetId}`,
        metadata: {
          network: network || "mobile_money",
          accountNumberMasked: maskedPhone || "",
          transactionId: verifiedTransactionId || currentPay.transactionId || "",
        },
        createdAt: now,
      });

      return {
        success: true,
        status: "reconciled" as const,
        message: "Payment successfully reconciled and escrow secured.",
        ledgerEntryId: ledgerRef.id,
      };
    });

    if (txResult.status === "reconciled") {
      await logAuditEvent({
        action: desc.targetType === "research" ? "lipila_research_payment_completed" : "lipila_payment_completed",
        actorId: customerId,
        actorRole: "customer",
        targetId: desc.targetId,
        details: {
          targetType: desc.targetType,
          referenceId,
          amount,
          network,
          transactionId: verifiedTransactionId,
        },
      });

      await createNotification({
        userId: customerId,
        type: "payment",
        title: "Payment Received & Escrow Secured",
        message: `Your payment of ZMW ${amount} via ${network} has been verified. Your ${desc.targetType === "research" ? "research request" : "assignment"} is now active and funded in escrow.`,
        link: desc.notificationLink,
      });
    }

    return txResult;
  } catch (err: any) {
    console.error("[Lipila Reconciliation Error]:", err);
    return {
      success: false,
      status: "rejected",
      message: err.message || "Failed to reconcile payment",
    };
  }
}

/**
 * Validates authoritative Lipila status response against internal payment record.
 * Decimal-safe money comparison, currency, referenceId, type, account number, paymentType.
 */
function validateAuthoritativeCollectionStatus(
  verified: any,
  payment: any
): { valid: boolean; error?: string } {
  if (verified.status !== "Successful") {
    return { valid: false, error: "Authoritative Lipila status is not 'Successful'" };
  }

  // Decimal-safe amount comparison
  const verifiedAmt = Number(verified.amount);
  const expectedAmt = Number(payment.amount);
  if (isNaN(verifiedAmt) || Math.abs(verifiedAmt - expectedAmt) > 0.001) {
    return {
      valid: false,
      error: `Amount mismatch: expected ${expectedAmt} ZMW, received ${verifiedAmt} ZMW`,
    };
  }

  // Currency matching
  if ((verified.currency || "").toUpperCase() !== "ZMW") {
    return { valid: false, error: `Currency mismatch: expected 'ZMW', received '${verified.currency}'` };
  }

  // Reference matching
  if (verified.referenceId && verified.referenceId !== payment.referenceId) {
    return { valid: false, error: `Reference mismatch: expected '${payment.referenceId}', received '${verified.referenceId}'` };
  }

  // Type matching: must be Collection
  if (verified.type && verified.type !== "Collection") {
    return { valid: false, error: `Transaction type mismatch: expected 'Collection', received '${verified.type}'` };
  }

  // Account number matching
  if (verified.accountNumber && verified.accountNumber !== payment.accountNumber) {
    return { valid: false, error: `Account number mismatch: expected '${payment.accountNumber}', received '${verified.accountNumber}'` };
  }

  // Payment type / network matching (strictly reject card processors)
  const paymentTypeRaw = (verified.paymentType || verified.network || "").toLowerCase().replace(/[\s\-_]/g, "");
  if (["card", "visa", "mastercard", "amex"].includes(paymentTypeRaw)) {
    return { valid: false, error: "Card payments are strictly prohibited on DataBoy" };
  }

  const allowedTypes = ["airtelmoney", "mtnmoney", "zamtelkwacha"];
  if (!allowedTypes.includes(paymentTypeRaw)) {
    return { valid: false, error: `Unsupported payment type '${verified.paymentType || verified.network}'` };
  }

  return { valid: true };
}

const NON_TERMINAL_PAYMENT_STATUSES = ["Initiating", "Pending", "Unknown"];
const INITIATION_LOCK_TTL_MS = 30000;

function buildNetworkInstructions(network: string, maskedPhone: string): string {
  if (network === "mtn_money") {
    return `Please check your phone for the MTN Mobile Money prompt. If delayed, dial *115# to authorize under 'My Approvals'.`;
  }
  if (network === "airtel_money") {
    return `Please check your phone for the Airtel Money PIN prompt and approve the payment.`;
  }
  if (network === "zamtel_kwacha") {
    return `Please check your phone for the Zamtel Kwacha prompt and approve the payment.`;
  }
  return `Please approve the prompt on your handset (${maskedPhone}).`;
}

async function releasePaymentLockIfOwned(lockId: string, referenceId: string): Promise<void> {
  const lockRef = adminDb.collection("paymentLocks").doc(lockId);
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(lockRef);
    if (snap.exists && snap.data()?.activePaymentReferenceId === referenceId) {
      tx.delete(lockRef);
    }
  });
}

async function clearLockLeaseTtlIfOwned(lockId: string, referenceId: string): Promise<void> {
  const lockRef = adminDb.collection("paymentLocks").doc(lockId);
  await adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(lockRef);
    if (snap.exists && snap.data()?.activePaymentReferenceId === referenceId) {
      tx.update(lockRef, { lockExpiresAt: 0, updatedAt: new Date().toISOString() });
    }
  });
}

/**
 * Resolves the target descriptor from the initiate request payload.
 */
function parseInitiateTarget(data: z.infer<typeof initiatePaymentSchema>):
  | { ok: true; descriptor: PayableTargetDescriptor }
  | { ok: false; error: string } {
  const { assignmentId, researchRequestId, targetType, targetId } = data;

  if (targetType && targetId) {
    return { ok: true, descriptor: getPayableDescriptor(targetType, targetId) };
  }
  if (researchRequestId && !assignmentId) {
    return { ok: true, descriptor: getPayableDescriptor("research", researchRequestId) };
  }
  if (assignmentId && !researchRequestId) {
    return { ok: true, descriptor: getPayableDescriptor("assignment", assignmentId) };
  }
  if (assignmentId && researchRequestId) {
    return { ok: false, error: "Specify either assignmentId or researchRequestId, not both." };
  }
  return { ok: false, error: "Either assignmentId, researchRequestId, or (targetType + targetId) is required." };
}

type AcquireInitiationOutcome =
  | { kind: "ERROR"; statusCode: number; error: string }
  | { kind: "CONCURRENT_IN_FLIGHT"; referenceId: string }
  | { kind: "CHECK_EXISTING"; existingPayment: any }
  | { kind: "INITIATE_NEW"; paymentDocId: string; paymentRecord: any; authoritativeAmount: number; title: string };

async function acquirePaymentInitiationLock(params: {
  desc: PayableTargetDescriptor;
  user: { uid: string; email?: string; role: string };
  network: "airtel_money" | "mtn_money" | "zamtel_kwacha";
  normalizedPhone: string;
  maskedPhone: string;
}): Promise<AcquireInitiationOutcome> {
  const { desc, user, network, normalizedPhone, maskedPhone } = params;
  const targetRef = adminDb.collection(desc.collectionName).doc(desc.targetId);
  const lockRef = adminDb.collection("paymentLocks").doc(desc.lockId);
  const matchField = desc.targetType === "research" ? "researchRequestId" : "assignmentId";
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  return adminDb.runTransaction<AcquireInitiationOutcome>(async (tx) => {
    const [targetSnap, lockSnap, existingPaySnapQuery] = await Promise.all([
      tx.get(targetRef),
      tx.get(lockRef),
      tx.get(adminDb.collection("payments").where(matchField, "==", desc.targetId)),
    ]);

    if (!targetSnap.exists) {
      return {
        kind: "ERROR",
        statusCode: 404,
        error: desc.targetType === "research" ? "Research request not found" : "Assignment not found",
      };
    }

    const target = targetSnap.data()!;
    const eligibility = checkTargetFundingEligibility(target, desc.targetType, user);
    if (!eligibility.ok) {
      return { kind: "ERROR", statusCode: eligibility.statusCode, error: eligibility.error };
    }

    // Check active lock document first
    if (lockSnap.exists) {
      const lock = lockSnap.data()!;
      if (lock.activePaymentDocId) {
        const lockedPaySnap = await tx.get(adminDb.collection("payments").doc(lock.activePaymentDocId));
        if (lockedPaySnap.exists) {
          const lockedPay = lockedPaySnap.data()!;
          if (lockedPay.status === "Initiating" && lock.lockExpiresAt && nowMs < lock.lockExpiresAt) {
            return { kind: "CONCURRENT_IN_FLIGHT", referenceId: lockedPay.referenceId };
          }
          if (NON_TERMINAL_PAYMENT_STATUSES.includes(lockedPay.status)) {
            return { kind: "CHECK_EXISTING", existingPayment: lockedPay };
          }
        }
      } else if (lock.lockExpiresAt && nowMs < lock.lockExpiresAt) {
        return { kind: "CONCURRENT_IN_FLIGHT", referenceId: lock.activePaymentReferenceId || "" };
      }
    }

    // Also inspect any non-terminal payment records (e.g., seeded without paymentLocks)
    const activeExisting = existingPaySnapQuery.docs
      .map((d) => d.data())
      .filter((p) => NON_TERMINAL_PAYMENT_STATUSES.includes(p.status))
      .sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime())[0];

    if (activeExisting) {
      return { kind: "CHECK_EXISTING", existingPayment: activeExisting };
    }

    // Acquire atomic lock & persist payment record BEFORE external Lipila HTTP request (CSPRNG referenceId)
    const referenceId = `DB-PAY-${crypto.randomUUID().toUpperCase()}`;
    const paymentDocRef = adminDb.collection("payments").doc();
    const paymentRecord = {
      id: paymentDocRef.id,
      referenceId,
      targetType: desc.targetType,
      targetId: desc.targetId,
      ...(desc.targetType === "research" ? { researchRequestId: desc.targetId } : { assignmentId: desc.targetId }),
      customerId: user.uid,
      customerEmail: user.email || "",
      amount: eligibility.authoritativeAmount,
      currency: "ZMW",
      network,
      accountNumber: normalizedPhone,
      maskedPhone,
      status: "Initiating",
      uncertain: false,
      createdAt: nowIso,
      updatedAt: nowIso,
    };

    tx.set(paymentDocRef, paymentRecord);
    tx.set(lockRef, {
      targetType: desc.targetType,
      targetId: desc.targetId,
      activePaymentDocId: paymentDocRef.id,
      activePaymentReferenceId: referenceId,
      lockExpiresAt: nowMs + INITIATION_LOCK_TTL_MS,
      updatedAt: nowIso,
    });

    return {
      kind: "INITIATE_NEW",
      paymentDocId: paymentDocRef.id,
      paymentRecord,
      authoritativeAmount: eligibility.authoritativeAmount,
      title: target.title || (desc.targetType === "research" ? "Research Request" : "Assignment"),
    };
  });
}

export function createPaymentRouter(limiters?: RateLimiterBundle): Router {
  const router = Router();
  const initiateLimit = limiters?.paymentInitiate || noopMiddleware;
  const statusLimit = limiters?.paymentStatus || noopMiddleware;
  const webhookLimit = limiters?.lipilaWebhook || noopMiddleware;

/**
 * POST /api/payments/initiate
 * Customer initiates Lipila mobile money checkout for an assignment or accepted research request.
 * Protects against concurrent initiations and verifies uncertain/pending attempts before retrying.
 */
router.post("/initiate", authMiddleware, initiateLimit, async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  if (isPaymentsDisabledInStaging()) {
    res.status(403).json({
      error: "PaymentsDisabledInStaging",
      code: "PAYMENTS_DISABLED_IN_STAGING",
      message: "Lipila payment initiation is disabled in the staging environment.",
    });
    return;
  }

  // Require valid real-payment credentials outside isolated test mode
  if (process.env.NODE_ENV !== "test") {
    const cfg = validateLipilaConfig({ requireCredentials: true });
    if (!cfg.valid) {
      res.status(500).json({
        error: "Server configuration error",
        message: cfg.error || "Lipila payment credentials are not properly configured.",
      });
      return;
    }
  }

  // Check for forbidden card fields or PIN inputs
  const rawBody = req.body || {};
  if (
    rawBody.cardNumber ||
    rawBody.card_number ||
    rawBody.cvv ||
    rawBody.expiry ||
    rawBody.cardExpiry ||
    rawBody.cardHolder ||
    rawBody.pin ||
    rawBody.password
  ) {
    res.status(400).json({
      error:
        "Forbidden fields detected. DataBoy strictly processes Zambian mobile money only. Bank cards are prohibited, and your mobile money PIN must never be entered on DataBoy.",
    });
    return;
  }

  const parseResult = initiatePaymentSchema.safeParse(rawBody);
  if (!parseResult.success) {
    res.status(400).json({
      error: "Validation failed",
      details: parseResult.error.flatten(),
    });
    return;
  }

  const targetParsed = parseInitiateTarget(parseResult.data);
  if (!targetParsed.ok) {
    res.status(400).json({ error: targetParsed.error });
    return;
  }
  const desc = targetParsed.descriptor;

  const { network, phoneNumber } = parseResult.data;

  // Validate Zambian mobile phone number
  const phoneResult = normalizeZambianPhone(phoneNumber);
  if (!phoneResult.valid || !phoneResult.normalized) {
    res.status(400).json({
      error: phoneResult.error || "Invalid Zambian mobile number",
    });
    return;
  }

  // Validate mobile money network (rejects cards/unsupported networks)
  const netResult = validateNetwork(network, phoneResult.normalized);
  if (!netResult.valid || !netResult.detectedNetwork) {
    res.status(400).json({
      error: netResult.error || "Unsupported payment network",
    });
    return;
  }

  const maskedPhone = maskPhoneNumber(phoneResult.normalized);

  try {
    let outcome = await acquirePaymentInitiationLock({
      desc,
      user,
      network: netResult.detectedNetwork,
      normalizedPhone: phoneResult.normalized,
      maskedPhone,
    });

    if (outcome.kind === "ERROR") {
      res.status(outcome.statusCode).json({ error: outcome.error });
      return;
    }

    if (outcome.kind === "CONCURRENT_IN_FLIGHT") {
      res.status(409).json({
        error: "A payment initiation request is already in progress for this item.",
        code: "INITIATION_IN_FLIGHT",
        referenceId: outcome.referenceId,
      });
      return;
    }

    // Reconcile existing non-terminal payment reference BEFORE ever initiating a new collection
    if (outcome.kind === "CHECK_EXISTING") {
      const existing = outcome.existingPayment;
      const verified = await lipilaService.checkCollectionStatus(existing.referenceId);

      if (verified.status === "Successful") {
        const validation = validateAuthoritativeCollectionStatus(verified, existing);
        if (validation.valid) {
          const recResult = await reconcileLipilaPayment(existing.id, existing, verified.transactionId);
          if (recResult.success) {
            res.status(200).json({
              success: true,
              alreadyPaid: true,
              referenceId: existing.referenceId,
              status: "Successful",
              amount: existing.amount,
              currency: "ZMW",
              network: existing.network,
              maskedPhone: existing.maskedPhone,
              message: "Existing collection confirmed by Lipila and reconciled.",
            });
            return;
          }
        }
        // Authoritative check failed validation -> terminalize as Failed so user can start fresh
        await adminDb.collection("payments").doc(existing.id).update({
          status: "Failed",
          uncertain: false,
          failureReason: validation.error || "Authoritative verification failed",
          updatedAt: new Date().toISOString(),
        });
        await releasePaymentLockIfOwned(desc.lockId, existing.referenceId);
      } else if (verified.status === "Pending" || verified.status === "Unknown") {
        const nextStatus = verified.status;
        await adminDb.collection("payments").doc(existing.id).update({
          status: nextStatus,
          uncertain: nextStatus === "Unknown",
          ...(verified.message ? { failureReason: verified.message } : {}),
          updatedAt: new Date().toISOString(),
        });
        await clearLockLeaseTtlIfOwned(desc.lockId, existing.referenceId);

        res.status(409).json({
          error:
            nextStatus === "Unknown"
              ? "Existing collection outcome is uncertain after timeout. Do not initiate a duplicate charge; continue polling status."
              : "An active mobile money collection is already pending for this item. Please approve the existing prompt on your handset.",
          code: nextStatus === "Unknown" ? "COLLECTION_OUTCOME_UNCERTAIN" : "COLLECTION_ALREADY_PENDING",
          referenceId: existing.referenceId,
          status: nextStatus,
          uncertain: nextStatus === "Unknown",
        });
        return;
      } else {
        // Conclusively terminal (Failed / Cancelled / Expired) -> mark existing terminal and allow retry
        await adminDb.collection("payments").doc(existing.id).update({
          status: verified.status,
          uncertain: false,
          failureReason: verified.message || `Previous attempt ${verified.status}`,
          updatedAt: new Date().toISOString(),
        });
        await releasePaymentLockIfOwned(desc.lockId, existing.referenceId);
      }

      // Now attempt single retry to acquire new initiation lock
      outcome = await acquirePaymentInitiationLock({
        desc,
        user,
        network: netResult.detectedNetwork,
        normalizedPhone: phoneResult.normalized,
        maskedPhone,
      });

      if (outcome.kind === "ERROR") {
        res.status(outcome.statusCode).json({ error: outcome.error });
        return;
      }
      if (outcome.kind === "CONCURRENT_IN_FLIGHT" || outcome.kind === "CHECK_EXISTING") {
        res.status(409).json({
          error: "Concurrent payment state change detected. Please check status before retrying.",
          code: "COLLECTION_CONFLICT",
        });
        return;
      }
    }

    const { paymentDocId, paymentRecord, authoritativeAmount, title } = outcome;
    const { referenceId } = paymentRecord;
    const paymentDocRef = adminDb.collection("payments").doc(paymentDocId);

    // Call Lipila collection service outside transaction (with 15s AbortSignal timeout)
    const lipilaResponse = await lipilaService.initiateCollection({
      referenceId,
      amount: authoritativeAmount,
      narration: `DataBoy Escrow: ${title.substring(0, 30)}`,
      accountNumber: phoneResult.normalized,
      network: netResult.detectedNetwork,
      customerEmail: user.email,
      currency: "ZMW",
    });

    const instructions = buildNetworkInstructions(netResult.detectedNetwork, maskedPhone);
    const securityNotice =
      "Never share or enter your Mobile Money PIN on any website. Authorize strictly on your personal handset prompt.";

    if (lipilaResponse.isTimeout || lipilaResponse.status === "Unknown") {
      await paymentDocRef.update({
        status: "Unknown",
        uncertain: true,
        failureReason: lipilaResponse.message || "Initiation request timed out",
        updatedAt: new Date().toISOString(),
      });
      await clearLockLeaseTtlIfOwned(desc.lockId, referenceId);

      res.status(202).json({
        success: true,
        uncertain: true,
        referenceId,
        targetType: desc.targetType,
        targetId: desc.targetId,
        ...(desc.targetType === "research" ? { researchRequestId: desc.targetId } : { assignmentId: desc.targetId }),
        status: "Unknown",
        amount: authoritativeAmount,
        currency: "ZMW",
        network: netResult.detectedNetwork,
        maskedPhone,
        instructions,
        message: lipilaResponse.message,
        securityNotice,
      });
      return;
    }

    if (!lipilaResponse.success && lipilaResponse.status === "Failed") {
      await paymentDocRef.update({
        status: "Failed",
        uncertain: false,
        failureReason: lipilaResponse.message || "Failed to initiate collection",
        updatedAt: new Date().toISOString(),
      });
      await releasePaymentLockIfOwned(desc.lockId, referenceId);

      res.status(502).json({
        error: "Lipila payment initiation failed",
        message: lipilaResponse.message,
        referenceId,
      });
      return;
    }

    await paymentDocRef.update({
      status: "Pending",
      uncertain: false,
      ...(lipilaResponse.transactionId ? { transactionId: lipilaResponse.transactionId } : {}),
      updatedAt: new Date().toISOString(),
    });
    await clearLockLeaseTtlIfOwned(desc.lockId, referenceId);

    res.status(200).json({
      success: true,
      uncertain: false,
      referenceId,
      targetType: desc.targetType,
      targetId: desc.targetId,
      ...(desc.targetType === "research" ? { researchRequestId: desc.targetId } : { assignmentId: desc.targetId }),
      status: "Pending",
      amount: authoritativeAmount,
      currency: "ZMW",
      network: netResult.detectedNetwork,
      maskedPhone,
      instructions,
      securityNotice,
    });
  } catch (err: any) {
    console.error("[Lipila Payment Initiation Error]:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

/**
 * POST /api/payments/lipila-callback
 * Dedicated webhook listener for Lipila payment callbacks.
 *
 * Strict Security Order:
 * 1. Authenticate webhook HMAC-SHA256 signature, timestamp (+/- 300s), and fenced lease acquisition.
 * 2. Parse authenticated payload.
 * 3. Locate stored internal payment record.
 * 4. Verify callback type corresponds to collection.
 * 5. Independently query Lipila authoritative status.
 * 6. Renew/verify fenced lease BEFORE mutating payment/escrow state.
 * 7. Validate authoritative response & atomically reconcile within Firestore transaction.
 */
router.post("/lipila-callback", webhookLimit, async (req: Request, res: Response) => {
  if (isPaymentsDisabledInStaging()) {
    res.status(403).json({
      error: "PaymentsDisabledInStaging",
      code: "PAYMENTS_DISABLED_IN_STAGING",
      message: "Lipila webhooks are disabled in the staging environment.",
    });
    return;
  }

  // 1. Webhook Signature & Fenced Lease Acquisition
  const rawBody = (req as any).rawBody !== undefined ? (req as any).rawBody : JSON.stringify(req.body);
  const authResult = await verifyLipilaWebhookSignature(req.headers, rawBody);

  if (!authResult.valid) {
    res.status(authResult.statusCode || 401).json({
      error: "Webhook signature verification failed",
      message: authResult.error,
    });
    return;
  }

  // Idempotent return for already-completed webhooks (OPS-02)
  if (authResult.alreadyCompleted) {
    res.status(200).json({
      success: true,
      message: "Webhook event already processed (idempotent)",
      webhookId: authResult.webhookId,
    });
    return;
  }

  const webhookId = authResult.webhookId!;
  const leaseToken = authResult.leaseToken;

  // 2. Parse authenticated payload
  const payload = req.body || {};
  const { referenceId, transactionId, type } = payload;

  if (!referenceId) {
    await markWebhookFailed(webhookId, leaseToken, "Missing referenceId");
    res.status(400).json({ error: "Missing referenceId" });
    return;
  }

  // 3. Confirm callback corresponds to Collection
  if (type && type !== "Collection") {
    await markWebhookFailed(webhookId, leaseToken, "Callback transaction type must be 'Collection'");
    res.status(400).json({ error: "Callback transaction type must be 'Collection'" });
    return;
  }

  try {
    // 4. Find internal payment record
    const query = await adminDb.collection("payments").where("referenceId", "==", referenceId).limit(1).get();

    if (query.empty) {
      const rej = await markWebhookRejected(webhookId, leaseToken, "Unknown reference ID");
      if (!rej.updated) {
        res.status(409).json({ error: "Webhook processing lease superseded by another worker" });
        return;
      }
      res.status(404).json({ error: "Unknown reference ID" });
      return;
    }

    const payDoc = query.docs[0];
    const payment = payDoc.data();

    // Idempotency check: Already successfully reconciled
    if (payment.status === "Successful" || payment.reconciled === true) {
      const comp = await markWebhookCompleted(webhookId, leaseToken, { referenceId, status: "AlreadyReconciled" });
      if (!comp.updated) {
        res.status(409).json({ error: "Webhook processing lease superseded by another worker" });
        return;
      }
      res.status(200).json({
        success: true,
        message: "Payment already successfully reconciled",
        referenceId,
      });
      return;
    }

    // 5. Independently query Lipila's authoritative collection status
    const verifiedStatus = await lipilaService.checkCollectionStatus(referenceId);

    // 6. Verify lease fencing token is still active after external HTTP I/O
    const leaseRenew = await renewWebhookLease(webhookId, leaseToken);
    if (!leaseRenew.updated) {
      res.status(409).json({
        error: "Webhook processing lease expired or superseded by another worker",
        reason: leaseRenew.reason,
      });
      return;
    }

    if (verifiedStatus.isTimeout || verifiedStatus.status === "Unknown") {
      await markWebhookFailed(webhookId, leaseToken, verifiedStatus.message || "Authoritative status check uncertain");
      res.status(503).json({
        error: "Authoritative Lipila verification timed out; safe to retry",
        referenceId,
      });
      return;
    }

    // 7. Validate authoritative status (Strict: never trust callback body alone)
    const validation = validateAuthoritativeCollectionStatus(verifiedStatus, payment);
    if (!validation.valid) {
      const now = new Date().toISOString();
      await payDoc.ref.update({
        status: "Failed",
        uncertain: false,
        failureReason: validation.error || "Authoritative validation failed",
        updatedAt: now,
      });

      const comp = await markWebhookCompleted(webhookId, leaseToken, {
        referenceId,
        status: "Failed",
        reason: validation.error,
      });
      if (!comp.updated) {
        res.status(409).json({ error: "Webhook processing lease superseded by another worker" });
        return;
      }

      res.status(400).json({
        error: "Authoritative Lipila payment verification failed",
        details: validation.error,
      });
      return;
    }

    // 8. Invoke Atomic Financial Reconciliation Transaction
    const reconcileResult = await reconcileLipilaPayment(
      payDoc.id,
      payment,
      verifiedStatus.transactionId || transactionId
    );

    if (reconcileResult.status === "already_funded_by_other") {
      const comp = await markWebhookCompleted(webhookId, leaseToken, {
        referenceId,
        status: "Duplicate_Requires_Refund",
        message: reconcileResult.message,
      });
      if (!comp.updated) {
        res.status(409).json({ error: "Webhook processing lease superseded by another worker" });
        return;
      }
      res.status(409).json({
        error: "Target was already funded by another transaction",
        message: reconcileResult.message,
      });
      return;
    }

    if (!reconcileResult.success && reconcileResult.status !== "already_processed") {
      await markWebhookFailed(webhookId, leaseToken, reconcileResult.message || "Reconciliation failed");
      res.status(500).json({
        error: "Failed to reconcile payment",
        details: reconcileResult.message,
      });
      return;
    }

    const comp = await markWebhookCompleted(webhookId, leaseToken, {
      referenceId,
      transactionId: verifiedStatus.transactionId || transactionId,
    });
    if (!comp.updated) {
      res.status(409).json({ error: "Webhook processing lease superseded by another worker" });
      return;
    }

    res.status(200).json({
      success: true,
      referenceId,
      status: "Successful",
      message: "Payment successfully verified and escrow secured",
    });
  } catch (err: any) {
    console.error("[Lipila Callback Error]:", err);
    await markWebhookFailed(webhookId, leaseToken, err.message || "Internal server error");
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

/**
 * GET /api/payments/status/:referenceId
 * Status polling endpoint for checkout modal with authoritative verification & recovery
 */
router.get("/status/:referenceId", authMiddleware, statusLimit, async (req: Request, res: Response) => {
  const referenceId = req.params.referenceId as string;
  const user = req.user!;

  if (process.env.NODE_ENV !== "test") {
    const cfg = validateLipilaConfig({ requireCredentials: true });
    if (!cfg.valid) {
      res.status(500).json({
        error: "Server configuration error",
        message: cfg.error || "Lipila payment credentials are not properly configured.",
      });
      return;
    }
  }

  try {
    const query = await adminDb.collection("payments").where("referenceId", "==", referenceId).limit(1).get();

    if (query.empty) {
      res.status(404).json({ error: "Payment not found" });
      return;
    }

    const payDoc = query.docs[0];
    let payment = payDoc.data();

    // Enforce strict owner or admin authorization before any upstream query or metadata exposure
    if (payment.customerId !== user.uid && user.role !== "admin") {
      res.status(403).json({ error: "Access denied" });
      return;
    }

    const desc = resolveTargetFromPaymentData(payment);

    // If non-terminal (Initiating, Pending, Unknown), probe Lipila checkCollectionStatus to reconcile
    if (NON_TERMINAL_PAYMENT_STATUSES.includes(payment.status)) {
      const verified = await lipilaService.checkCollectionStatus(referenceId);
      if (verified.status === "Successful") {
        const validation = validateAuthoritativeCollectionStatus(verified, payment);
        if (validation.valid) {
          await reconcileLipilaPayment(payDoc.id, payment, verified.transactionId);
          const refreshedSnap = await payDoc.ref.get();
          payment = refreshedSnap.data()!;
        } else {
          await payDoc.ref.update({
            status: "Failed",
            uncertain: false,
            failureReason: validation.error,
            updatedAt: new Date().toISOString(),
          });
          await releasePaymentLockIfOwned(desc.lockId, referenceId);
          const refreshedSnap = await payDoc.ref.get();
          payment = refreshedSnap.data()!;
        }
      } else if (verified.status === "Failed" || verified.status === "Cancelled" || verified.status === "Expired") {
        await payDoc.ref.update({
          status: verified.status,
          uncertain: false,
          failureReason: verified.message || `Payment ${verified.status.toLowerCase()}`,
          updatedAt: new Date().toISOString(),
        });
        await releasePaymentLockIfOwned(desc.lockId, referenceId);
        const refreshedSnap = await payDoc.ref.get();
        payment = refreshedSnap.data()!;
      } else if (verified.status === "Pending" && payment.status !== "Pending") {
        await payDoc.ref.update({
          status: "Pending",
          uncertain: false,
          updatedAt: new Date().toISOString(),
        });
        const refreshedSnap = await payDoc.ref.get();
        payment = refreshedSnap.data()!;
      } else if (verified.status === "Unknown") {
        await payDoc.ref.update({
          status: "Unknown",
          uncertain: true,
          failureReason: verified.message || "Status check uncertain",
          updatedAt: new Date().toISOString(),
        });
        const refreshedSnap = await payDoc.ref.get();
        payment = refreshedSnap.data()!;
      }
    }

    res.status(200).json({
      success: true,
      payment: {
        referenceId: payment.referenceId,
        targetType: payment.targetType || (payment.researchRequestId ? "research" : "assignment"),
        targetId: payment.targetId || payment.assignmentId || payment.researchRequestId,
        assignmentId: payment.assignmentId,
        researchRequestId: payment.researchRequestId,
        status: payment.status,
        uncertain: Boolean(payment.uncertain || payment.status === "Unknown"),
        amount: payment.amount,
        currency: payment.currency,
        network: payment.network,
        maskedPhone: payment.maskedPhone,
        transactionId: payment.transactionId,
        createdAt: payment.createdAt,
        completedAt: payment.completedAt,
        failureReason: payment.failureReason,
      },
    });
  } catch (err: any) {
    console.error("[Lipila Status Error]:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

/**
 * GET /api/payments/history
 * Returns the current customer's payment history with masked phone numbers
 */
router.get("/history", authMiddleware, async (req: Request, res: Response) => {
  const user = (req as any).user;
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  try {
    const snapshot = await adminDb
      .collection("payments")
      .where("customerId", "==", user.uid)
      .get();

    const payments = snapshot.docs
      .map((doc) => {
        const d = doc.data();
        return {
          id: doc.id,
          referenceId: d.referenceId,
          assignmentId: d.assignmentId,
          amount: d.amount,
          currency: d.currency,
          network: d.network,
          maskedPhone: d.maskedPhone || (d.accountNumber ? maskPhoneNumber(d.accountNumber) : "260*****XXXX"),
          status: d.status,
          createdAt: d.createdAt,
          completedAt: d.completedAt,
          failureReason: d.failureReason,
        };
      })
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    res.status(200).json({
      success: true,
      payments,
    });
  } catch (err: any) {
    console.error("[Payment History Error]:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

/**
 * GET /api/payments/admin/collections
 * Admin summary and full ledger of mobile money collections
 */
router.get("/admin/collections", authMiddleware, requireRole("admin"), async (req: Request, res: Response) => {
  try {
    const snapshot = await adminDb.collection("payments").get();

    let totalCollectedZMW = 0;
    const networkCounts: Record<string, number> = {
      airtel_money: 0,
      mtn_money: 0,
      zamtel_kwacha: 0,
    };
    const statusCounts: Record<string, number> = {
      Successful: 0,
      Pending: 0,
      Failed: 0,
    };

    const collections = snapshot.docs.map((doc) => {
      const d = doc.data();
      const st = d.status === "completed" ? "Successful" : d.status;
      if (st === "Successful") {
        totalCollectedZMW += Number(d.amount || 0);
      }
      if (d.network && networkCounts[d.network] !== undefined) {
        networkCounts[d.network]++;
      }
      if (st && statusCounts[st] !== undefined) {
        statusCounts[st]++;
      } else if (st) {
        statusCounts[st] = 1;
      }

      return {
        id: doc.id,
        referenceId: d.referenceId,
        assignmentId: d.assignmentId,
        customerId: d.customerId,
        customerEmail: d.customerEmail,
        amount: d.amount,
        currency: d.currency,
        network: d.network,
        maskedPhone: d.maskedPhone,
        status: st,
        transactionId: d.transactionId,
        createdAt: d.createdAt,
        completedAt: d.completedAt,
      };
    });

    res.status(200).json({
      success: true,
      summary: {
        totalCollectedZMW,
        totalTransactions: collections.length,
        networkCounts,
        statusCounts,
      },
      collections: collections.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    });
  } catch (err: any) {
    console.error("[Admin Collections Error]:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

  return router;
}

export default createPaymentRouter();
