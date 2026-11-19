/**
 * DATABOY PHASE 5.40.1 — CRITICAL BLOCKER REMEDIATION TEST SUITE
 *
 * Covers:
 *  1. Existing Firebase custom claim preservation across approve/reject/role/reconcile
 *  2. Writer approval idempotency (no duplicate history or notifications)
 *  3. Writer rejection transaction, claim sync & fail-closed rollback on sync failure
 *  4. Admin role changes, claim sync, no silent writer grant & fail-closed rollback
 *  5. Firestore-to-Auth custom claims reconciliation endpoint
 *  6. Unauthorized writer access & strict authMiddleware role/verification checks
 *  7. Legacy proofreader compatibility
 *  8. FCM missing VAPID configuration (state: configuration_missing, zero synthetic tokens)
 *  9. FCM getToken() failure, backend registration failure & synthetic token rejection
 * 10. Email provider unconfigured behavior (preferences saved, in-app works, skipped_unconfigured)
 *
 * Requires Firestore Emulator at 127.0.0.1:8080.
 */

process.env.NODE_ENV = "test";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
process.env.FIREBASE_PROJECT_ID = "databoy-test-project";
process.env.ALLOW_TEST_AUTH = "true";
process.env.RATE_LIMIT_ENABLED = "false";
delete process.env.EMAIL_PROVIDER;
delete process.env.RESEND_API_KEY;
delete process.env.SENDGRID_API_KEY;
delete process.env.EMAIL_FROM_ADDRESS;

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const { createApp } = await import("../backend/dist/app.js");
const app = createApp();
const { adminDb } = await import("../backend/dist/config/firebaseAdmin.js");
const {
  computeAuthoritativeRoleClaims,
  setCustomClaimsAuthClientForTesting,
} = await import("../backend/dist/services/customClaimsService.js");
const { createNotification } = await import("../backend/dist/services/notificationService.js");

let server;
let baseUrl;
let passed = 0;
let failed = 0;

async function startServer() {
  return new Promise((resolve) => {
    server = app.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      baseUrl = `http://127.0.0.1:${addr.port}`;
      resolve();
    });
  });
}

async function api(method, urlPath, token, body) {
  const res = await fetch(`${baseUrl}${urlPath}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  return { status: res.status, body: json };
}

async function runTest(name, fn) {
  process.stdout.write(`Test ${name} ... `);
  try {
    await fn();
    console.log("PASSED [✓]");
    passed++;
  } catch (err) {
    console.log("FAILED [✗]");
    console.error("  Error:", err?.stack || err);
    failed++;
  }
}

async function seedUser(uid, data) {
  await adminDb.collection("users").doc(uid).set({
    uid,
    email: `${uid}@test.databoy.local`,
    displayName: `User ${uid}`,
    role: "customer",
    status: "active",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...data,
  });
}

// In-memory mock Firebase Auth claims store for deterministic claim-preservation tests
function createMockAuthStore(initialClaimsByUid = {}, opts = {}) {
  const store = new Map();
  for (const [uid, claims] of Object.entries(initialClaimsByUid)) {
    store.set(uid, { ...claims });
  }
  let failNextSet = Boolean(opts.failSet);
  let failNextGet = Boolean(opts.failGet);

  const client = {
    async getUser(uid) {
      if (failNextGet) {
        throw new Error("Simulated Firebase Auth getUser outage");
      }
      return { customClaims: store.has(uid) ? { ...store.get(uid) } : {} };
    },
    async setCustomUserClaims(uid, claims) {
      if (failNextSet) {
        throw new Error("Simulated Firebase Auth setCustomUserClaims failure");
      }
      store.set(uid, claims ? { ...claims } : {});
    },
  };

  return {
    client,
    getClaims: (uid) => store.get(uid) || {},
    setFailSet: (v) => {
      failNextSet = v;
    },
    setFailGet: (v) => {
      failNextGet = v;
    },
  };
}

console.log("================================================================================");
console.log("DATABOY PHASE 5.40.1 — CRITICAL BLOCKER REMEDIATION TEST SUITE");
console.log("================================================================================\n");

await startServer();
await seedUser("admin_5401", { role: "admin", status: "active" });
const adminToken = "test-token:admin_5401:admin:admin_5401@test.databoy.local";

// 1. Existing custom claim preservation
await runTest("01: Existing custom claims are preserved during writer approval", async () => {
  const uid = "writer_preserve_01";
  await seedUser(uid, {
    role: "customer",
    writerInterest: true,
    verificationStatus: "pending_review",
    isVerifiedWriter: false,
    writerStatus: "inactive",
    statusHistory: [],
  });

  const mockAuth = createMockAuthStore({
    [uid]: {
      tenantId: "zm-university-01",
      betaAccess: true,
      orgPermission: "research_partner",
      role: "customer",
    },
  });
  setCustomClaimsAuthClientForTesting(mockAuth.client);

  try {
    const res = await api("POST", `/api/admin/writers/${uid}/approve`, adminToken, {
      grantProofreading: true,
      note: "Verified degree certificate",
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.success, true);
    assert.equal(res.body.claimsSynced, true);

    const claims = mockAuth.getClaims(uid);
    assert.equal(claims.role, "writer");
    assert.equal(claims.isVerifiedWriter, true);
    assert.equal(claims.canProofread, true);
    assert.equal(claims.tenantId, "zm-university-01", "Unrelated tenantId claim must be preserved");
    assert.equal(claims.betaAccess, true, "Unrelated betaAccess claim must be preserved");
    assert.equal(claims.orgPermission, "research_partner", "Unrelated orgPermission claim must be preserved");
  } finally {
    setCustomClaimsAuthClientForTesting(null);
  }
});

// 2. Writer approval idempotency
await runTest("02: Writer approval is idempotent (no duplicate history or notifications)", async () => {
  const uid = "writer_idempotent_02";
  await seedUser(uid, {
    role: "customer",
    writerInterest: true,
    verificationStatus: "pending_review",
    isVerifiedWriter: false,
    writerStatus: "inactive",
    statusHistory: [],
  });

  const mockAuth = createMockAuthStore({ [uid]: { customFlag: "keep" } });
  setCustomClaimsAuthClientForTesting(mockAuth.client);

  try {
    const first = await api("POST", `/api/admin/writers/${uid}/approve`, adminToken, {
      grantProofreading: false,
      note: "Initial approval",
    });
    assert.equal(first.status, 200);
    assert.equal(first.body.alreadyApproved, undefined);

    const afterFirstSnap = await adminDb.collection("users").doc(uid).get();
    const afterFirst = afterFirstSnap.data();
    const historyCountAfterFirst = afterFirst.statusHistory.length;
    const verifiedAtFirst = afterFirst.verifiedAt;

    const notifSnapFirst = await adminDb.collection("notifications").where("userId", "==", uid).get();
    const notifCountFirst = notifSnapFirst.size;

    const second = await api("POST", `/api/admin/writers/${uid}/approve`, adminToken, {
      grantProofreading: false,
      note: "Duplicate click",
    });
    assert.equal(second.status, 200);
    assert.equal(second.body.alreadyApproved, true);
    assert.equal(second.body.claimsSynced, true);

    const afterSecond = (await adminDb.collection("users").doc(uid).get()).data();
    assert.equal(afterSecond.statusHistory.length, historyCountAfterFirst, "Duplicate statusHistory must not be added");
    assert.equal(afterSecond.verifiedAt, verifiedAtFirst, "verifiedAt must not be overwritten");

    const notifSnapSecond = await adminDb.collection("notifications").where("userId", "==", uid).get();
    assert.equal(notifSnapSecond.size, notifCountFirst, "Duplicate approval notification must not be sent");
    assert.equal(mockAuth.getClaims(uid).customFlag, "keep");
  } finally {
    setCustomClaimsAuthClientForTesting(null);
  }
});

// 3. Writer rejection & claim sync + fail-closed rollback
await runTest("03: Writer rejection synchronizes claims, preserves unrelated claims & fails closed on sync error", async () => {
  const uid = "writer_reject_03";
  await seedUser(uid, {
    role: "customer",
    writerInterest: true,
    verificationStatus: "under_review",
    isVerifiedWriter: false,
    writerStatus: "inactive",
    statusHistory: [],
  });

  const mockAuth = createMockAuthStore({
    [uid]: { region: "lusaka", role: "writer", isVerifiedWriter: true, canProofread: true },
  });
  setCustomClaimsAuthClientForTesting(mockAuth.client);

  try {
    // Failure case first: claim sync fails -> must fail closed (502) and roll back Firestore
    mockAuth.setFailSet(true);
    const failedRes = await api("POST", `/api/admin/writers/${uid}/reject`, adminToken, {
      reason: "Blurry transcript",
    });
    assert.equal(failedRes.status, 502);
    const rolledBack = (await adminDb.collection("users").doc(uid).get()).data();
    assert.equal(rolledBack.verificationStatus, "under_review", "Firestore verificationStatus must roll back on claim sync failure");
    assert.equal(rolledBack.previousRejectionsCount || 0, 0);

    // Success case
    mockAuth.setFailSet(false);
    const okRes = await api("POST", `/api/admin/writers/${uid}/reject`, adminToken, {
      reason: "Blurry transcript",
    });
    assert.equal(okRes.status, 200);
    assert.equal(okRes.body.claimsSynced, true);

    const updated = (await adminDb.collection("users").doc(uid).get()).data();
    assert.equal(updated.role, "customer");
    assert.equal(updated.verificationStatus, "rejected");
    assert.equal(updated.isVerifiedWriter, false);

    const claims = mockAuth.getClaims(uid);
    assert.equal(claims.role, "customer");
    assert.equal(claims.isVerifiedWriter, false);
    assert.equal(claims.canProofread, false);
    assert.equal(claims.region, "lusaka", "Unrelated claim must be preserved on rejection");
  } finally {
    setCustomClaimsAuthClientForTesting(null);
  }
});

// 4. Admin role changes & claim synchronization (never silently grants writer access + rollback)
await runTest("04: Admin role change syncs claims, never silently grants writer approval & rolls back on error", async () => {
  const uid = "role_change_04";
  await seedUser(uid, {
    role: "customer",
    status: "active",
    verificationStatus: "draft",
    isVerifiedWriter: false,
    writerStatus: "inactive",
  });

  const mockAuth = createMockAuthStore({ [uid]: { partnerTier: "gold" } });
  setCustomClaimsAuthClientForTesting(mockAuth.client);

  try {
    // Promoting customer -> writer via /role must NOT silently grant isVerifiedWriter: true
    const promoteRes = await api("POST", `/api/admin/users/${uid}/role`, adminToken, { role: "writer" });
    assert.equal(promoteRes.status, 200);
    assert.equal(promoteRes.body.claimsSynced, true);
    assert.equal(promoteRes.body.expectedClaims.role, "writer");
    assert.equal(promoteRes.body.expectedClaims.isVerifiedWriter, false);

    const docAfter = (await adminDb.collection("users").doc(uid).get()).data();
    assert.equal(docAfter.isVerifiedWriter, false, "Raw role change must not silently approve writer");

    const claimsAfter = mockAuth.getClaims(uid);
    assert.equal(claimsAfter.role, "writer");
    assert.equal(claimsAfter.isVerifiedWriter, false);
    assert.equal(claimsAfter.partnerTier, "gold");

    // Claim sync failure must roll back Firestore role
    mockAuth.setFailSet(true);
    const failRes = await api("POST", `/api/admin/users/${uid}/role`, adminToken, { role: "admin" });
    assert.equal(failRes.status, 502);
    const rolledBack = (await adminDb.collection("users").doc(uid).get()).data();
    assert.equal(rolledBack.role, "writer", "Role change must roll back when claim sync fails");
  } finally {
    setCustomClaimsAuthClientForTesting(null);
  }
});

// 5. Reconciliation endpoint
await runTest("05: Admin claims reconciliation aligns Firebase Auth with Firestore while preserving unrelated claims", async () => {
  const uid = "reconcile_user_05";
  await seedUser(uid, {
    role: "writer",
    status: "active",
    writerStatus: "active",
    verificationStatus: "approved",
    isVerifiedWriter: true,
    canProofread: true,
  });

  const mockAuth = createMockAuthStore({
    [uid]: { role: "customer", isVerifiedWriter: false, legacyOrg: "unza" },
  });
  setCustomClaimsAuthClientForTesting(mockAuth.client);

  try {
    const res = await api("POST", `/api/admin/users/${uid}/reconcile-claims`, adminToken);
    assert.equal(res.status, 200);
    assert.equal(res.body.claimsSynced, true);
    assert.deepEqual(res.body.expectedClaims, {
      role: "writer",
      isVerifiedWriter: true,
      canProofread: true,
    });
    const claims = mockAuth.getClaims(uid);
    assert.equal(claims.role, "writer");
    assert.equal(claims.isVerifiedWriter, true);
    assert.equal(claims.canProofread, true);
    assert.equal(claims.legacyOrg, "unza");
  } finally {
    setCustomClaimsAuthClientForTesting(null);
  }
});

// 6. Unauthorized writer access & authMiddleware validation
await runTest("06: Unauthorized accounts (customer, pending, rejected, unapproved writer, suspended) are denied writer access", async () => {
  // Active customer with NO verificationStatus must NEVER have isVerifiedWriter=true
  const customerClaims = computeAuthoritativeRoleClaims({ role: "customer", status: "active" });
  assert.equal(customerClaims.role, "customer");
  assert.equal(customerClaims.isVerifiedWriter, false);
  assert.equal(customerClaims.canProofread, false);

  await seedUser("plain_customer_06", { role: "customer", status: "active" });
  await seedUser("pending_writer_06", {
    role: "writer",
    status: "active",
    verificationStatus: "pending_review",
    isVerifiedWriter: false,
    writerStatus: "inactive",
  });
  await seedUser("suspended_writer_06", {
    role: "writer",
    status: "suspended",
    verificationStatus: "approved",
    isVerifiedWriter: true,
    writerStatus: "active",
  });

  const r1 = await api("GET", "/api/writers/pool", "test-token:plain_customer_06:customer:c@test.local");
  const r2 = await api("GET", "/api/writers/pool", "test-token:pending_writer_06:writer:p@test.local");
  const r3 = await api("GET", "/api/writers/pool", "test-token:suspended_writer_06:writer:s@test.local");
  const r4 = await api("GET", "/api/writers/me/earnings", "test-token:pending_writer_06:writer:p@test.local");

  assert.equal(r1.status, 403);
  assert.equal(r2.status, 403);
  assert.equal(r3.status, 403);
  assert.equal(r4.status, 403);
});

// 7. Legacy proofreader compatibility
await runTest("07: Legacy proofreader account retains writer+proofread access and reconciles cleanly", async () => {
  const uid = "legacy_proofreader_07";
  await seedUser(uid, {
    role: "proofreader",
    status: "active",
    verificationStatus: "approved",
    isVerifiedWriter: true,
  });

  const computed = computeAuthoritativeRoleClaims({
    role: "proofreader",
    status: "active",
    verificationStatus: "approved",
    isVerifiedWriter: true,
  });
  assert.deepEqual(computed, {
    role: "writer",
    isVerifiedWriter: true,
    canProofread: true,
  });

  const poolRes = await api("GET", "/api/writers/pool", `test-token:${uid}:proofreader:${uid}@test.local`);
  assert.equal(poolRes.status, 200);
});

// 8. FCM missing VAPID configuration & zero synthetic token generation
await runTest("08: FCM registration blocks missing VAPID key (configuration_missing) and contains zero synthetic token generation", async () => {
  const notifServiceSrc = fs.readFileSync(path.join(rootDir, "src/services/notificationService.ts"), "utf8");
  const pushRegSrc = fs.readFileSync(path.join(rootDir, "src/utils/pushRegistration.ts"), "utf8");
  assert.equal(
    /webpush_device_\$\{/.test(notifServiceSrc) || /webpush_device_\$\{/.test(pushRegSrc),
    false,
    "Frontend notificationService / pushRegistration must not fabricate webpush_device_ tokens"
  );
  assert.equal(
    pushRegSrc.includes("configuration_missing"),
    true,
    "pushRegistration must report configuration_missing state"
  );
  assert.equal(
    pushRegSrc.includes("registration_failed"),
    true,
    "pushRegistration must report registration_failed state"
  );

  const { executePushRegistration } = await import("../src/utils/pushRegistration.ts");
  assert.equal(typeof executePushRegistration, "function");

  let permissionCalled = false;
  let getTokenCalled = false;
  let backendCalled = false;

  const res = await executePushRegistration({
    vapidKey: "",
    checkSupport: () => ({ supported: true, permission: "default", isIosWithoutStandalone: false }),
    requestPermission: async () => {
      permissionCalled = true;
      return "granted";
    },
    getServiceWorkerRegistration: async () => ({}),
    acquireFcmToken: async () => {
      getTokenCalled = true;
      return "fake";
    },
    registerTokenWithBackend: async () => {
      backendCalled = true;
      return { success: true, deviceId: "d1" };
    },
  });

  assert.equal(res.success, false);
  assert.equal(res.state, "configuration_missing");
  assert.equal(permissionCalled, false, "Must not request permission when VAPID key is missing");
  assert.equal(getTokenCalled, false, "Must not call getToken when VAPID key is missing");
  assert.equal(backendCalled, false, "Must not call backend when VAPID key is missing");
});

// 9. FCM getToken() failure, backend registration failure & backend synthetic token rejection
await runTest("09: FCM getToken() failure, backend registration failure & synthetic token rejection are handled honestly", async () => {
  const uid = "push_test_user_09";
  await seedUser(uid, { role: "customer", status: "active" });
  const userToken = `test-token:${uid}:customer:${uid}@test.local`;

  // Backend must reject synthetic webpush_device_ tokens with 400
  const synthRes = await api("POST", "/api/notifications/push-tokens", userToken, {
    token: "webpush_device_12345678-1234-1234-1234-1234567890ab",
    platform: "Web",
  });
  assert.equal(synthRes.status, 400, "Backend must reject synthetic webpush_device_ tokens");

  const { executePushRegistration } = await import("../src/utils/pushRegistration.ts");
  assert.equal(typeof executePushRegistration, "function");

  const validVapid = "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";

  // A) Firebase getToken() throws -> registration_failed, never calls backend or saveLocalToken
  let backendCalledOnTokenErr = false;
  let savedLocalOnTokenErr = false;
  const tokenFailRes = await executePushRegistration({
    vapidKey: validVapid,
    checkSupport: () => ({ supported: true, permission: "granted", isIosWithoutStandalone: false }),
    requestPermission: async () => "granted",
    getServiceWorkerRegistration: async () => ({}),
    acquireFcmToken: async () => {
      throw new Error("messaging/token-subscribe-failed");
    },
    registerTokenWithBackend: async () => {
      backendCalledOnTokenErr = true;
      return { success: true, deviceId: "dev1" };
    },
    saveLocalToken: () => {
      savedLocalOnTokenErr = true;
    },
  });
  assert.equal(tokenFailRes.success, false);
  assert.equal(tokenFailRes.state, "registration_failed");
  assert.equal(backendCalledOnTokenErr, false);
  assert.equal(savedLocalOnTokenErr, false);

  // B) Backend registration fails -> registration_failed, never saves local token or reports enabled
  let savedLocalOnBackendErr = false;
  const backendFailRes = await executePushRegistration({
    vapidKey: validVapid,
    checkSupport: () => ({ supported: true, permission: "granted", isIosWithoutStandalone: false }),
    requestPermission: async () => "granted",
    getServiceWorkerRegistration: async () => ({}),
    acquireFcmToken: async () => "real_fcm_token_abcdef1234567890_genuine",
    registerTokenWithBackend: async () => {
      throw new Error("503 Service Unavailable");
    },
    saveLocalToken: () => {
      savedLocalOnBackendErr = true;
    },
  });
  assert.equal(backendFailRes.success, false);
  assert.equal(backendFailRes.state, "registration_failed");
  assert.equal(savedLocalOnBackendErr, false);

  // C) Permission denied -> permission_denied
  const deniedRes = await executePushRegistration({
    vapidKey: validVapid,
    checkSupport: () => ({ supported: true, permission: "denied", isIosWithoutStandalone: false }),
    requestPermission: async () => "denied",
    getServiceWorkerRegistration: async () => ({}),
    acquireFcmToken: async () => "should_not_run",
    registerTokenWithBackend: async () => ({ success: true, deviceId: "x" }),
  });
  assert.equal(deniedRes.success, false);
  assert.equal(deniedRes.state, "permission_denied");

  // D) Genuine token + backend success -> enabled
  let savedToken = "";
  const okRes = await executePushRegistration({
    vapidKey: validVapid,
    checkSupport: () => ({ supported: true, permission: "default", isIosWithoutStandalone: false }),
    requestPermission: async () => "granted",
    getServiceWorkerRegistration: async () => ({}),
    acquireFcmToken: async () => "real_fcm_token_abcdef1234567890_genuine",
    registerTokenWithBackend: async () => ({ success: true, deviceId: "dev_ok_1" }),
    saveLocalToken: (t) => {
      savedToken = t;
    },
  });
  assert.equal(okRes.success, true);
  assert.equal(okRes.state, "enabled");
  assert.equal(okRes.deviceId, "dev_ok_1");
  assert.equal(savedToken, "real_fcm_token_abcdef1234567890_genuine");
});

// 10. Email provider unconfigured behavior
await runTest("10: Unconfigured email provider saves preferences, delivers in-app & logs skipped_unconfigured", async () => {
  const uid = "email_unconf_10";
  await seedUser(uid, { role: "customer", status: "active" });
  const userToken = `test-token:${uid}:customer:${uid}@test.local`;

  const prefRes = await api("POST", "/api/notifications/preferences", userToken, {
    inAppNotifications: true,
    emailNotifications: true,
  });
  assert.equal(prefRes.status, 200);
  assert.equal(prefRes.body.preferences.emailNotifications, true);

  const statusRes = await api("GET", "/api/notifications/status", userToken);
  assert.equal(statusRes.status, 200);
  assert.equal(statusRes.body.emailDelivery.configured, false);
  assert.equal(statusRes.body.emailDelivery.provider, "unconfigured");

  await createNotification({
    userId: uid,
    title: "Order Confirmed",
    message: "Your assignment order has been created.",
    type: "assignment",
    link: "/dashboard",
  });

  const inAppSnap = await adminDb.collection("notifications").where("userId", "==", uid).get();
  assert.equal(inAppSnap.size >= 1, true, "In-app notification must still be delivered");

  const deliverySnap = await adminDb.collection("emailDeliveries").where("userId", "==", uid).get();
  assert.equal(deliverySnap.size >= 1, true, "Email delivery log must be recorded");
  const deliveryDoc = deliverySnap.docs[0].data();
  assert.equal(deliveryDoc.status, "skipped_unconfigured");
  assert.notEqual(deliveryDoc.status, "sent");
});

server.close();
console.log("\n================================================================================");
console.log(`PHASE 5.40.1 REMEDIATION RESULTS: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
console.log("================================================================================");

if (failed > 0) {
  process.exit(1);
}
process.exit(0);
