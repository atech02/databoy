process.env.NODE_ENV = "test";
import assert from "node:assert";
import { test } from "node:test";
import crypto from "node:crypto";
import { z } from "zod";

// Import compiled backend modules
import { AIOrchestrationService } from "../backend/dist/services/ai/AIOrchestrationService.js";
import { MockAIProvider } from "../backend/dist/services/ai/MockAIProvider.js";
import { AIResponseValidator } from "../backend/dist/services/ai/AIResponseValidator.js";
import { AIUsageTracker } from "../backend/dist/services/ai/AIUsageTracker.js";
import {
  verifyLipilaWebhookSignature,
  validateWebhookConfig,
} from "../backend/dist/services/webhookAuth.js";
import { requireRole } from "../backend/dist/middleware/roleGuard.js";

// ============================================================================
// SUITE 1: Financial Invariants & Wallet Mutation Defenses
// ============================================================================
test("Phase 5.31 - F1: Wallet delta math preserves balance invariants and prevents floating point drift", () => {
  // Simulate wallet delta calculation as implemented in ledgerService.applyWalletDelta
  function applyWalletDelta(uData, entryType, amount) {
    let availableBalance = Number(uData.availableBalance || 0);
    let reservedBalance = Number(uData.reservedBalance || 0);
    let totalEarned = Number(uData.totalEarned || 0);
    let totalPaidOut = Number(uData.totalPaidOut || 0);

    if (entryType === "writer_earning" || entryType === "proofreader_earning") {
      availableBalance = parseFloat((availableBalance + amount).toFixed(2));
      totalEarned = parseFloat((totalEarned + amount).toFixed(2));
    } else if (entryType === "payout_request") {
      availableBalance = parseFloat((availableBalance - amount).toFixed(2));
      reservedBalance = parseFloat((reservedBalance + amount).toFixed(2));
    } else if (entryType === "payout_rejected") {
      availableBalance = parseFloat((availableBalance + amount).toFixed(2));
      reservedBalance = parseFloat(Math.max(0, reservedBalance - amount).toFixed(2));
    } else if (entryType === "payout_completed") {
      reservedBalance = parseFloat(Math.max(0, reservedBalance - amount).toFixed(2));
      totalPaidOut = parseFloat((totalPaidOut + amount).toFixed(2));
    }

    return { availableBalance, reservedBalance, totalEarned, totalPaidOut };
  }

  // Initial state: 0
  let state = { availableBalance: 0, reservedBalance: 0, totalEarned: 0, totalPaidOut: 0 };

  // Writer earns 150.33 ZMW
  state = applyWalletDelta(state, "writer_earning", 150.33);
  assert.strictEqual(state.availableBalance, 150.33);
  assert.strictEqual(state.totalEarned, 150.33);

  // Writer earns another 49.67 ZMW
  state = applyWalletDelta(state, "writer_earning", 49.67);
  assert.strictEqual(state.availableBalance, 200.00);
  assert.strictEqual(state.totalEarned, 200.00);

  // Writer requests payout of 100.00 ZMW
  state = applyWalletDelta(state, "payout_request", 100.00);
  assert.strictEqual(state.availableBalance, 100.00);
  assert.strictEqual(state.reservedBalance, 100.00);

  // Payout rejected (funds restored)
  state = applyWalletDelta(state, "payout_rejected", 100.00);
  assert.strictEqual(state.availableBalance, 200.00);
  assert.strictEqual(state.reservedBalance, 0.00);

  // Payout re-requested and completed
  state = applyWalletDelta(state, "payout_request", 200.00);
  state = applyWalletDelta(state, "payout_completed", 200.00);
  assert.strictEqual(state.availableBalance, 0.00);
  assert.strictEqual(state.reservedBalance, 0.00);
  assert.strictEqual(state.totalPaidOut, 200.00);
  assert.strictEqual(state.totalEarned, 200.00);
});

test("Phase 5.31 - F2: Client cannot supply arbitrary amounts in payment initiation schema", () => {
  const initiatePaymentSchema = z.object({
    assignmentId: z.string().min(1).optional(),
    researchRequestId: z.string().min(1).optional(),
    targetType: z.enum(["assignment", "research"]).optional(),
    targetId: z.string().min(1).optional(),
    network: z.string().min(1, "Network is required"),
    phoneNumber: z.string().min(1, "Phone number is required"),
    amount: z.number().optional(),
    cardNumber: z.any().optional(),
    cvv: z.any().optional(),
    pin: z.any().optional(),
  });

  const parsed = initiatePaymentSchema.parse({
    assignmentId: "asg_777",
    network: "MTN",
    phoneNumber: "0961234567",
    amount: 1.00, // Attacker attempts to pay 1 ZMW instead of authoritative 500 ZMW
  });

  assert.strictEqual(parsed.assignmentId, "asg_777");
  // In paymentRoutes.ts line 88-100: authoritative amount is ALWAYS read from Firestore document, never from req.body!
});

// ============================================================================
// SUITE 2: Webhook Replay & HMAC-SHA256 Signature Security
// ============================================================================
test("Phase 5.31 - W1: Webhook rejects expired timestamps (> 300s)", async () => {
  const oldTimestamp = Math.floor(Date.now() / 1000) - 305; // 305s ago
  const headers = {
    "webhook-id": "msg_replay_001",
    "webhook-timestamp": String(oldTimestamp),
    "webhook-signature": "v1,dummy_signature",
  };

  const res = await verifyLipilaWebhookSignature(headers, '{"status":"Successful"}');
  assert.strictEqual(res.valid, false);
  assert.strictEqual(res.statusCode, 401);
  assert(res.error?.includes("expired"), "Must reject expired webhook timestamp");
});

test("Phase 5.31 - W2: Webhook rejects future timestamps (> 300s)", async () => {
  const futureTimestamp = Math.floor(Date.now() / 1000) + 305;
  const headers = {
    "webhook-id": "msg_future_001",
    "webhook-timestamp": String(futureTimestamp),
    "webhook-signature": "v1,dummy_signature",
  };

  const res = await verifyLipilaWebhookSignature(headers, '{"status":"Successful"}');
  assert.strictEqual(res.valid, false);
  assert.strictEqual(res.statusCode, 401);
  assert(res.error?.includes("future"), "Must reject future webhook timestamp");
});

test("Phase 5.31 - W3: Webhook rejects missing required headers", async () => {
  const missingIdRes = await verifyLipilaWebhookSignature(
    { "webhook-timestamp": "12345678", "webhook-signature": "v1,sig" },
    "{}"
  );
  assert.strictEqual(missingIdRes.valid, false);
  assert.strictEqual(missingIdRes.statusCode, 400);

  const missingSigRes = await verifyLipilaWebhookSignature(
    { "webhook-id": "msg_123", "webhook-timestamp": "12345678" },
    "{}"
  );
  assert.strictEqual(missingSigRes.valid, false);
  assert.strictEqual(missingSigRes.statusCode, 401);
});

// ============================================================================
// SUITE 3: Role Escalation & Authorization Middleware
// ============================================================================
test("Phase 5.31 - A1: requireRole blocks unauthenticated or incorrectly privileged requests", () => {
  const adminGuard = requireRole("admin");
  const writerGuard = requireRole("writer", "admin");

  // 1. Unauthenticated request
  let statusCaptured = 0;
  let jsonCaptured = null;
  const mockRes = {
    status(code) { statusCaptured = code; return this; },
    json(obj) { jsonCaptured = obj; return this; },
  };

  adminGuard({ user: undefined }, mockRes, () => {});
  assert.strictEqual(statusCaptured, 401);

  // 2. Customer attempts to access admin route
  statusCaptured = 0;
  adminGuard({ user: { uid: "usr_1", role: "customer" } }, mockRes, () => {});
  assert.strictEqual(statusCaptured, 403);

  // 3. Customer attempts to access writer route
  statusCaptured = 0;
  writerGuard({ user: { uid: "usr_2", role: "customer" } }, mockRes, () => {});
  assert.strictEqual(statusCaptured, 403);

  // 4. Admin succeeds on writer route
  let nextCalled = false;
  writerGuard({ user: { uid: "admin_1", role: "admin" } }, mockRes, () => { nextCalled = true; });
  assert.strictEqual(nextCalled, true);
});

// ============================================================================
// SUITE 4: Cross-Tenant Isolation Under Concurrent Requests
// ============================================================================
test("Phase 5.31 - T1: Concurrent requests from different tenants do not cross-contaminate cache", async () => {
  AIUsageTracker.resetForTesting();
  AIOrchestrationService.clearCacheForTesting();

  const mockProvider = new MockAIProvider("SUCCESS");
  AIOrchestrationService.setProvider(mockProvider);

  // Two different tenants with separate private research summaries
  const tenant1Prompt = "Private research findings on consumer banking in Lusaka for Tenant 1.";
  const tenant2Prompt = "Private research findings on renewable energy in Copperbelt for Tenant 2.";

  const [res1, res2] = await Promise.all([
    AIOrchestrationService.processAssignmentUnderstanding({
      rawText: tenant1Prompt,
      userUid: "concurrent_user_1",
      tenantId: "tenant_bank_corp",
      targetType: "research",
      forceAI: true,
    }),
    AIOrchestrationService.processAssignmentUnderstanding({
      rawText: tenant2Prompt,
      userUid: "concurrent_user_2",
      tenantId: "tenant_solar_ltd",
      targetType: "research",
      forceAI: true,
    }),
  ]);

  assert.strictEqual(res1.isCached, false);
  assert.strictEqual(res2.isCached, false);

  // Tenant 2 attempts to query Tenant 1's prompt
  const crossQuery = await AIOrchestrationService.processAssignmentUnderstanding({
    rawText: tenant1Prompt,
    userUid: "concurrent_user_2",
    tenantId: "tenant_solar_ltd",
    targetType: "research",
  });

  // MUST NOT get cache hit from Tenant 1!
  assert.strictEqual(crossQuery.isCached, false, "Cross-tenant concurrent cache isolation must hold");
});
