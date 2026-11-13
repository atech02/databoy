/**
 * DataBoy Administrator Provisioning & Promotion Verification Suite
 *
 * Verifies:
 *  1. Promoted Google Administrator (atechsolutions0225@gmail.com / 6TCuUkSCKtWBlokgufXqRGv1llI3)
 *     has role: "admin", status: "active", isOnboarded: true in Firestore.
 *  2. Promoted Google Administrator account in Firebase Auth has emailVerified: true and provider: google.com.
 *  3. Placeholder Administrator (admin@databoy.com / QdZ4bDygR3RWsp99GWz9ph8TzpP2) remains completely intact.
 *  4. Immutable audit log records exist for both 'admin_promoted' and 'admin_account_provisioned'.
 *  5. Other user accounts in Firebase Auth (e.g. moses.lunyati@gmail.com) remain completely untouched.
 *  6. Backend rejects unauthenticated requests to admin routes (/api/admin/audit-logs).
 *  7. Backend rejects invalid / forged token requests to admin routes.
 *  8. Backend health endpoint confirms paymentsEnabled is false.
 */

import { execSync } from "child_process";

const PROJECT_ID = "databoy-aa871";
const BACKEND_URL = "https://databoy-backend-staging.onrender.com";
const PROMOTED_ADMIN_UID = "6TCuUkSCKtWBlokgufXqRGv1llI3";
const PROMOTED_ADMIN_EMAIL = "atechsolutions0225@gmail.com";
const PLACEHOLDER_ADMIN_UID = "QdZ4bDygR3RWsp99GWz9ph8TzpP2";
const PLACEHOLDER_ADMIN_EMAIL = "admin@databoy.com";

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runScenario(scenarioNum, name, testFn) {
  process.stdout.write(`Scenario ${scenarioNum}: ${name} ... `);
  try {
    await testFn();
    passed++;
    console.log("PASSED [✓]");
  } catch (err) {
    failed++;
    console.log(`FAILED [✗]\n  -> ${err.message}`);
  }
}

function getGoogleAccessToken() {
  if (process.env.GOOGLE_ACCESS_TOKEN) return process.env.GOOGLE_ACCESS_TOKEN.trim();
  return execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();
}

async function main() {
  console.log("================================================================================");
  console.log("DATABOY ADMIN PROMOTION & MULTI-ACCOUNT INTEGRITY VERIFICATION SUITE");
  console.log(`Firebase Project:       ${PROJECT_ID}`);
  console.log(`Backend API:            ${BACKEND_URL}`);
  console.log(`Promoted Google Admin:  ${PROMOTED_ADMIN_EMAIL} (${PROMOTED_ADMIN_UID})`);
  console.log(`Placeholder Admin:      ${PLACEHOLDER_ADMIN_EMAIL} (${PLACEHOLDER_ADMIN_UID})`);
  console.log("================================================================================\n");

  const token = getGoogleAccessToken();

  // ---------------------------------------------------------------------------
  // 1. Verify Promoted Administrator Profile in Firestore
  // ---------------------------------------------------------------------------
  await runScenario(1, "Promoted Google Admin profile exists in Firestore with role='admin' and status='active'", async () => {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${PROMOTED_ADMIN_UID}`;
    const res = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "x-goog-user-project": PROJECT_ID,
      },
    });
    assert(res.ok, `Failed to retrieve admin profile from Firestore: HTTP ${res.status}`);
    const data = await res.json();
    const f = data.fields || {};

    assert(f.uid?.stringValue === PROMOTED_ADMIN_UID, `Expected uid '${PROMOTED_ADMIN_UID}', got '${f.uid?.stringValue}'`);
    assert(f.email?.stringValue === PROMOTED_ADMIN_EMAIL, `Expected email '${PROMOTED_ADMIN_EMAIL}', got '${f.email?.stringValue}'`);
    assert(f.role?.stringValue === "admin", `Expected role 'admin', got '${f.role?.stringValue}'`);
    assert(f.status?.stringValue === "active", `Expected status 'active', got '${f.status?.stringValue}'`);
    assert(f.isOnboarded?.booleanValue === true, `Expected isOnboarded true`);
    assert(f.profileCompletion?.integerValue === "100", `Expected profileCompletion 100`);
  });

  // ---------------------------------------------------------------------------
  // 2. Verify Promoted Administrator in Firebase Auth
  // ---------------------------------------------------------------------------
  await runScenario(2, "Promoted Google Admin account in Firebase Auth is verified with google.com provider", async () => {
    const url = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:lookup`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-goog-user-project": PROJECT_ID,
      },
      body: JSON.stringify({ localId: [PROMOTED_ADMIN_UID] }),
    });
    assert(res.ok, `Lookup failed: HTTP ${res.status}`);
    const data = await res.json();
    assert(data.users && data.users.length === 1, `Expected 1 user in Auth for ${PROMOTED_ADMIN_UID}`);
    const user = data.users[0];
    assert(user.localId === PROMOTED_ADMIN_UID, `UID mismatch`);
    assert(user.email === PROMOTED_ADMIN_EMAIL, `Email mismatch`);
    assert(user.emailVerified === true, `Expected emailVerified: true`);
    const providers = (user.providerUserInfo || []).map((p) => p.providerId);
    assert(providers.includes("google.com"), `Expected provider 'google.com', got [${providers.join(", ")}]`);
    assert(!user.disabled, `Expected account not disabled`);
  });

  // ---------------------------------------------------------------------------
  // 3. Verify Placeholder Administrator Remains Intact
  // ---------------------------------------------------------------------------
  await runScenario(3, "Placeholder Admin account remains completely intact in Auth and Firestore", async () => {
    // Auth check
    const authUrl = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:lookup`;
    const authRes = await fetch(authUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-goog-user-project": PROJECT_ID,
      },
      body: JSON.stringify({ localId: [PLACEHOLDER_ADMIN_UID] }),
    });
    assert(authRes.ok, `Placeholder Auth lookup failed: HTTP ${authRes.status}`);
    const authData = await authRes.json();
    assert(authData.users && authData.users.length === 1, `Placeholder admin must exist in Auth`);
    assert(authData.users[0].email === PLACEHOLDER_ADMIN_EMAIL, `Placeholder email mismatch`);

    // Firestore check
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${PLACEHOLDER_ADMIN_UID}`;
    const firestoreRes = await fetch(firestoreUrl, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "x-goog-user-project": PROJECT_ID,
      },
    });
    assert(firestoreRes.ok, `Placeholder Firestore lookup failed: HTTP ${firestoreRes.status}`);
    const fData = await firestoreRes.json();
    assert(fData.fields?.role?.stringValue === "admin", `Placeholder role must be 'admin'`);
    assert(fData.fields?.status?.stringValue === "active", `Placeholder status must be 'active'`);
  });

  // ---------------------------------------------------------------------------
  // 4. Verify Immutable Audit Log Entries
  // ---------------------------------------------------------------------------
  await runScenario(4, "Audit log records exist for both admin provisioning and admin promotion", async () => {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:runQuery`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-goog-user-project": PROJECT_ID,
      },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "auditLogs" }],
        },
      }),
    });
    assert(res.ok, `Failed to query auditLogs: HTTP ${res.status}`);
    const results = await res.json();
    const actions = results
      .filter((r) => r.document)
      .map((r) => ({
        action: r.document.fields?.action?.stringValue,
        targetId: r.document.fields?.targetId?.stringValue,
      }));

    const hasPromotion = actions.some((a) => a.action === "admin_promoted" && a.targetId === PROMOTED_ADMIN_UID);
    const hasBootstrap = actions.some((a) => a.action === "admin_account_provisioned" && a.targetId === PLACEHOLDER_ADMIN_UID);

    assert(hasPromotion, `Missing audit log for admin_promoted (target: ${PROMOTED_ADMIN_UID})`);
    assert(hasBootstrap, `Missing audit log for admin_account_provisioned (target: ${PLACEHOLDER_ADMIN_UID})`);
  });

  // ---------------------------------------------------------------------------
  // 5. Verify Unrelated User Accounts Unchanged
  // ---------------------------------------------------------------------------
  await runScenario(5, "Unrelated accounts (moses.lunyati@gmail.com) remain completely untouched", async () => {
    const url = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:batchGet?maxResults=50`;
    const res = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "x-goog-user-project": PROJECT_ID,
      },
    });
    assert(res.ok, `Failed to list Auth accounts: HTTP ${res.status}`);
    const data = await res.json();
    const emails = (data.users || []).map((u) => u.email);

    assert(emails.includes("moses.lunyati@gmail.com"), "Account moses.lunyati@gmail.com must remain present");
    assert(emails.includes(PROMOTED_ADMIN_EMAIL), "Promoted admin must remain present");
    assert(emails.includes(PLACEHOLDER_ADMIN_EMAIL), "Placeholder admin must remain present");
  });

  // ---------------------------------------------------------------------------
  // 6. Backend Admin-Only API Security Barrier
  // ---------------------------------------------------------------------------
  await runScenario(6, "Backend rejects unauthenticated requests to admin routes (/api/admin/audit-logs)", async () => {
    const res = await fetch(`${BACKEND_URL}/api/admin/audit-logs?limit=5`);
    assert(res.status === 401, `Expected HTTP 401 for unauthenticated request, got ${res.status}`);
  });

  await runScenario(7, "Backend rejects forged/invalid token requests to admin routes", async () => {
    const res = await fetch(`${BACKEND_URL}/api/admin/audit-logs?limit=5`, {
      headers: { "Authorization": "Bearer forged-or-malformed-token-string" },
    });
    assert(res.status === 401, `Expected HTTP 401 for invalid token, got ${res.status}`);
  });

  // ---------------------------------------------------------------------------
  // 8. Verify Payments Disabled
  // ---------------------------------------------------------------------------
  await runScenario(8, "Backend health endpoint confirms paymentsEnabled is false", async () => {
    const res = await fetch(`${BACKEND_URL}/api/health`);
    assert(res.ok, `Backend health check failed: HTTP ${res.status}`);
    const data = await res.json();
    assert(data.status === "healthy", `Backend status is not healthy: ${data.status}`);
    assert(data.infrastructure?.paymentsEnabled === false, `Expected paymentsEnabled: false`);
  });

  console.log("\n================================================================================");
  console.log("VERIFICATION TEST SUMMARY");
  console.log("================================================================================");
  console.log(`Total Scenarios: ${passed + failed}`);
  console.log(`Passed:          ${passed} [✓]`);
  console.log(`Failed:          ${failed} [✗]`);
  console.log("================================================================================\n");

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
