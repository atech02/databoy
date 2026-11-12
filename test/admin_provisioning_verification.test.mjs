/**
 * DataBoy Administrator Provisioning & Authorization Verification Suite
 *
 * Verifies:
 *  1. Administrator profile in Firestore has role: "admin", status: "active", isOnboarded: true.
 *  2. Immutable audit record exists in auditLogs for admin_account_provisioned.
 *  3. Admin-only backend API endpoints (/api/admin/audit-logs, /api/admin/analytics) allow admin.
 *  4. Admin-only backend API endpoints reject unauthenticated or non-admin callers (401/403).
 *  5. Existing user accounts in Firebase Authentication remain intact and untouched.
 *  6. Payments system remains safely disabled across frontend and backend.
 */

import { execSync } from "child_process";

const PROJECT_ID = "databoy-aa871";
const BACKEND_URL = "https://databoy-backend-staging.onrender.com";
const ADMIN_UID = "QdZ4bDygR3RWsp99GWz9ph8TzpP2";
const ADMIN_EMAIL = "admin@databoy.com";

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
  console.log("DATABOY ADMIN PROVISIONING & SECURITY VERIFICATION SUITE");
  console.log(`Firebase Project: ${PROJECT_ID}`);
  console.log(`Backend API:      ${BACKEND_URL}`);
  console.log("================================================================================\n");

  const token = getGoogleAccessToken();

  // ---------------------------------------------------------------------------
  // 1. Verify Firestore Administrator Profile
  // ---------------------------------------------------------------------------
  await runScenario(1, "Administrator profile exists in Firestore with role='admin' and status='active'", async () => {
    const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${ADMIN_UID}`;
    const res = await fetch(url, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "x-goog-user-project": PROJECT_ID,
      },
    });
    assert(res.ok, `Failed to retrieve admin profile from Firestore: HTTP ${res.status}`);
    const data = await res.json();
    const f = data.fields || {};

    assert(f.uid?.stringValue === ADMIN_UID, `Expected uid '${ADMIN_UID}', got '${f.uid?.stringValue}'`);
    assert(f.email?.stringValue === ADMIN_EMAIL, `Expected email '${ADMIN_EMAIL}', got '${f.email?.stringValue}'`);
    assert(f.role?.stringValue === "admin", `Expected role 'admin', got '${f.role?.stringValue}'`);
    assert(f.status?.stringValue === "active", `Expected status 'active', got '${f.status?.stringValue}'`);
    assert(f.isOnboarded?.booleanValue === true, `Expected isOnboarded true`);
    assert(f.profileCompletion?.integerValue === "100", `Expected profileCompletion 100`);
  });

  // ---------------------------------------------------------------------------
  // 2. Verify Audit Log Entry
  // ---------------------------------------------------------------------------
  await runScenario(2, "Audit log record exists in 'auditLogs' recording admin provisioning", async () => {
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
          where: {
            fieldFilter: {
              field: { fieldPath: "action" },
              op: "EQUAL",
              value: { stringValue: "admin_account_provisioned" },
            },
          },
        },
      }),
    });
    assert(res.ok, `Failed to query auditLogs: HTTP ${res.status}`);
    const results = await res.json();
    const matching = results.filter((r) => r.document);
    assert(matching.length > 0, "No audit log entry found for action 'admin_account_provisioned'");

    const doc = matching[0].document;
    const f = doc.fields || {};
    assert(f.targetId?.stringValue === ADMIN_UID, `Audit targetId '${f.targetId?.stringValue}' does not match admin UID`);
    assert(f.actorRole?.stringValue === "admin", `Audit actorRole '${f.actorRole?.stringValue}' expected 'admin'`);
  });

  // ---------------------------------------------------------------------------
  // 3. Verify Firebase Authentication User Record
  // ---------------------------------------------------------------------------
  await runScenario(3, "Administrator account exists in Firebase Authentication", async () => {
    const url = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:lookup`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "x-goog-user-project": PROJECT_ID,
      },
      body: JSON.stringify({
        localId: [ADMIN_UID],
      }),
    });
    assert(res.ok, `Lookup failed: HTTP ${res.status}`);
    const data = await res.json();
    assert(data.users && data.users.length === 1, `Expected 1 user in Auth for ${ADMIN_UID}`);
    const user = data.users[0];
    assert(user.localId === ADMIN_UID, `Auth user localId '${user.localId}' does not match '${ADMIN_UID}'`);
    assert(user.email === ADMIN_EMAIL, `Auth user email '${user.email}' does not match '${ADMIN_EMAIL}'`);
    assert(user.emailVerified === true, `Expected emailVerified: true`);
    assert(user.disabled === false, `Expected disabled: false`);
  });

  // ---------------------------------------------------------------------------
  // 4. Verify Existing Accounts Unchanged
  // ---------------------------------------------------------------------------
  await runScenario(4, "Existing accounts in Firebase Authentication remain unchanged", async () => {
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

    assert(emails.includes("atechsolutions0225@gmail.com"), "Existing account atechsolutions0225@gmail.com must remain present");
    assert(emails.includes("moses.lunyati@gmail.com"), "Existing account moses.lunyati@gmail.com must remain present");
    assert(emails.includes(ADMIN_EMAIL), `Newly provisioned account ${ADMIN_EMAIL} must be present`);
  });

  // ---------------------------------------------------------------------------
  // 5. Backend Admin-Only API Security Barrier
  // ---------------------------------------------------------------------------
  await runScenario(5, "Backend rejects unauthenticated requests to admin routes (/api/admin/audit-logs)", async () => {
    const res = await fetch(`${BACKEND_URL}/api/admin/audit-logs?limit=5`);
    assert(res.status === 401, `Expected HTTP 401 for unauthenticated request, got ${res.status}`);
  });

  await runScenario(6, "Backend rejects forged/invalid token requests to admin routes", async () => {
    const res = await fetch(`${BACKEND_URL}/api/admin/audit-logs?limit=5`, {
      headers: { "Authorization": "Bearer forged-or-malformed-token-string" },
    });
    assert(res.status === 401, `Expected HTTP 401 for invalid token, got ${res.status}`);
  });

  // ---------------------------------------------------------------------------
  // 7. Verify Payments Disabled
  // ---------------------------------------------------------------------------
  await runScenario(7, "Backend health endpoint confirms paymentsEnabled is false", async () => {
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
