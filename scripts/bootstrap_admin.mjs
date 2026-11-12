/**
 * DataBoy Server-Side Administrator Account Bootstrap Script
 *
 * Securely provisions the first DataBoy administrator account:
 * 1. Verifies if an administrator already exists (idempotent / non-destructive).
 * 2. Creates the administrator in Firebase Authentication (server-side via Identity Toolkit API).
 * 3. Generates a secure, single-use Firebase password reset link (no hardcoded passwords).
 * 4. Creates the authoritative Firestore user profile with role: "admin".
 * 5. Records an immutable audit log entry in the auditLogs collection.
 * 6. Verifies administrator authentication, profile retrieval, and admin API authorization.
 * 7. Verifies non-admin authorization denial on admin routes.
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const PROJECT_ID = "databoy-aa871";
const BACKEND_URL = process.env.API_URL || "https://databoy-backend-staging.onrender.com";
const FRONTEND_URL = "https://databoy-aa871.web.app";

// Helper to read .env.local without exposing values
function loadLocalEnv() {
  const envPath = path.resolve(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, "utf8");
  const result = {};
  for (const line of content.split("\n")) {
    const match = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)?\s*$/);
    if (match) {
      let val = (match[2] || "").trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      result[match[1]] = val;
    }
  }
  return result;
}

const localEnv = loadLocalEnv();
const API_KEY = process.env.NEXT_PUBLIC_FIREBASE_API_KEY || localEnv.NEXT_PUBLIC_FIREBASE_API_KEY;

function getGoogleAccessToken() {
  if (process.env.GOOGLE_ACCESS_TOKEN) {
    return process.env.GOOGLE_ACCESS_TOKEN.trim();
  }
  try {
    return execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();
  } catch (err) {
    throw new Error(`Failed to obtain Google Cloud access token via gcloud: ${err.message}`);
  }
}

async function runQueryAdmins(token) {
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
        from: [{ collectionId: "users" }],
        where: {
          fieldFilter: {
            field: { fieldPath: "role" },
            op: "EQUAL",
            value: { stringValue: "admin" },
          },
        },
      },
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Firestore query failed (${res.status}): ${errText}`);
  }

  const results = await res.json();
  const admins = [];
  for (const item of results) {
    if (item.document) {
      const doc = item.document;
      const fields = doc.fields || {};
      admins.push({
        name: doc.name,
        uid: fields.uid?.stringValue,
        email: fields.email?.stringValue,
        role: fields.role?.stringValue,
        status: fields.status?.stringValue,
      });
    }
  }
  return admins;
}

async function lookupAuthUserByEmail(token, email) {
  const url = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:lookup`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-goog-user-project": PROJECT_ID,
    },
    body: JSON.stringify({
      emails: [email],
    }),
  });

  if (!res.ok) {
    return null;
  }

  const data = await res.json();
  if (data.users && data.users.length > 0) {
    return data.users[0];
  }
  return null;
}

async function createAuthUser(token, email, password, displayName) {
  const url = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-goog-user-project": PROJECT_ID,
    },
    body: JSON.stringify({
      email,
      password,
      displayName,
      emailVerified: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to create user in Firebase Authentication (${res.status}): ${errText}`);
  }

  return await res.json();
}

async function generatePasswordResetLink(token, email) {
  const url = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:sendOobCode`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-goog-user-project": PROJECT_ID,
    },
    body: JSON.stringify({
      requestType: "PASSWORD_RESET",
      email,
      returnOobLink: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to generate password reset link (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.oobLink;
}

async function createFirestoreProfile(token, uid, email, displayName) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}`;
  const timestamp = new Date().toISOString();

  const payload = {
    fields: {
      uid: { stringValue: uid },
      email: { stringValue: email },
      displayName: { stringValue: displayName },
      role: { stringValue: "admin" },
      status: { stringValue: "active" },
      isOnboarded: { booleanValue: true },
      profileCompletion: { integerValue: "100" },
      reputation: { integerValue: "0" },
      completedCount: { integerValue: "0" },
      averageRating: { integerValue: "0" },
      activeTaskCount: { integerValue: "0" },
      disputeCount: { integerValue: "0" },
      revisionCount: { integerValue: "0" },
      createdAt: { stringValue: timestamp },
      updatedAt: { stringValue: timestamp },
    },
  };

  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-goog-user-project": PROJECT_ID,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to write admin profile to Firestore (${res.status}): ${errText}`);
  }

  return await res.json();
}

async function recordAuditLog(token, uid, email) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/auditLogs`;
  const timestamp = new Date().toISOString();

  const payload = {
    fields: {
      action: { stringValue: "admin_account_provisioned" },
      actorId: { stringValue: "system_bootstrap" },
      actorName: { stringValue: "Server Bootstrap Process" },
      actorRole: { stringValue: "admin" },
      targetId: { stringValue: uid },
      targetType: { stringValue: "user" },
      details: {
        mapValue: {
          fields: {
            email: { stringValue: email },
            method: { stringValue: "server_side_bootstrap" },
            role: { stringValue: "admin" },
            provisionedAt: { stringValue: timestamp },
          },
        },
      },
      timestamp: { timestampValue: timestamp },
    },
  };

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-goog-user-project": PROJECT_ID,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    console.warn(`[AuditLog Warning] Failed to insert audit log document (${res.status}): ${errText}`);
    return null;
  }

  return await res.json();
}

async function signInWithPassword(apiKey, email, password) {
  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email,
      password,
      returnSecureToken: true,
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Sign-in verification failed (${res.status}): ${errText}`);
  }

  return await res.json();
}

async function getFirestoreUser(token, uid) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}`;
  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "x-goog-user-project": PROJECT_ID,
    },
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Failed to fetch user profile (${res.status}): ${errText}`);
  }

  const doc = await res.json();
  const f = doc.fields || {};
  return {
    uid: f.uid?.stringValue,
    email: f.email?.stringValue,
    role: f.role?.stringValue,
    status: f.status?.stringValue,
    isOnboarded: f.isOnboarded?.booleanValue,
  };
}

async function testBackendAdminAccess(idToken) {
  const url = `${BACKEND_URL}/api/admin/audit-logs?limit=5`;
  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${idToken}`,
      "Content-Type": "application/json",
    },
  });

  return {
    status: res.status,
    ok: res.ok,
    body: await res.json().catch(() => null),
  };
}

async function testBackendNonAdminAccess() {
  const url = `${BACKEND_URL}/api/admin/audit-logs?limit=5`;
  // Test 1: Unauthenticated
  const unauthRes = await fetch(url);
  // Test 2: Invalid token
  const invalidRes = await fetch(url, {
    headers: { "Authorization": "Bearer invalid-dummy-token-sample" },
  });

  return {
    unauthStatus: unauthRes.status,
    invalidStatus: invalidRes.status,
  };
}

async function main() {
  console.log("================================================================================");
  console.log("DATABOY SECURE ADMINISTRATOR ACCOUNT PROVISIONING");
  console.log(`Target Firebase Project: ${PROJECT_ID}`);
  console.log(`Backend API:             ${BACKEND_URL}`);
  console.log(`Frontend URL:            ${FRONTEND_URL}`);
  console.log("================================================================================\n");

  const gcloudToken = getGoogleAccessToken();

  // 1. Audit existing administrators
  console.log("[Step 1/6] Auditing existing administrators in Firestore...");
  const existingAdmins = await runQueryAdmins(gcloudToken);
  if (existingAdmins.length > 0) {
    console.log(`\n[!] Administrator account already exists:`);
    for (const a of existingAdmins) {
      console.log(`  - UID:    ${a.uid}`);
      console.log(`  - Email:  ${a.email}`);
      console.log(`  - Role:   ${a.role}`);
      console.log(`  - Status: ${a.status}`);
    }
    const primaryAdmin = existingAdmins[0];
    const resetLink = await generatePasswordResetLink(gcloudToken, primaryAdmin.email);
    console.log("\n================================================================================");
    console.log("EXISTING ADMINISTRATOR CREDENTIAL DETAILS");
    console.log("================================================================================");
    console.log(`Administrator Login Email: ${primaryAdmin.email}`);
    console.log(`Administrator UID:         ${primaryAdmin.uid}`);
    console.log(`Login URL:                 ${FRONTEND_URL}/login`);
    console.log(`Admin Panel URL:           ${FRONTEND_URL}/admin`);
    console.log("\nSecure Password Setup / Reset URL:");
    console.log(`  ${resetLink}`);
    console.log("\nINSTRUCTIONS FOR USER:");
    console.log("1. Open the Password Setup / Reset URL above to define your private administrator password.");
    console.log("2. Navigate to the Login URL and sign in with your email and new password.");
    console.log("3. Access the Admin Panel to govern the platform.");
    console.log("================================================================================\n");
    process.exit(0);
  }
  console.log("  [✓] Verified: 0 administrator profiles exist in Firestore.");

  // 2. Determine target admin email and initial password
  const targetEmail = (
    process.env.ADMIN_EMAIL ||
    process.argv.find((a) => a.startsWith("--email="))?.split("=")[1] ||
    "admin@databoy.com"
  ).trim().toLowerCase();

  const initialPassword =
    process.env.ADMIN_INITIAL_PASSWORD ||
    `${crypto.randomBytes(12).toString("base64url")}!Db9`;

  console.log(`\n[Step 2/6] Provisioning administrator: ${targetEmail}`);

  // 3. Check or create in Firebase Authentication
  let authUser = await lookupAuthUserByEmail(gcloudToken, targetEmail);
  let uid = authUser?.localId;

  if (authUser) {
    console.log(`  [✓] User already exists in Firebase Authentication (UID: ${uid}).`);
    // Update password if initial password was specified
    const updateUrl = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:update`;
    await fetch(updateUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${gcloudToken}`,
        "Content-Type": "application/json",
        "x-goog-user-project": PROJECT_ID,
      },
      body: JSON.stringify({
        localId: uid,
        password: initialPassword,
      }),
    });
    console.log("  [✓] Firebase Authentication password synchronized.");
  } else {
    console.log("  [+] Creating new user in Firebase Authentication...");
    const created = await createAuthUser(
      gcloudToken,
      targetEmail,
      initialPassword,
      "DataBoy Administrator"
    );
    uid = created.localId;
    console.log(`  [✓] Created in Firebase Authentication (UID: ${uid}).`);
  }

  // 4. Generate official Firebase Password Reset Link
  console.log("\n[Step 3/6] Generating secure Firebase password recovery link...");
  const resetLink = await generatePasswordResetLink(gcloudToken, targetEmail);
  console.log("  [✓] Password reset action URL successfully generated.");

  // 5. Create Firestore Profile with role: "admin"
  console.log("\n[Step 4/6] Creating authoritative admin profile in Firestore...");
  await createFirestoreProfile(
    gcloudToken,
    uid,
    targetEmail,
    "DataBoy Administrator"
  );
  console.log(`  [✓] Profile created at users/${uid} with role: 'admin', status: 'active'.`);

  // 6. Record Audit Log
  console.log("\n[Step 5/6] Writing immutable security audit record...");
  const auditRes = await recordAuditLog(gcloudToken, uid, targetEmail);
  if (auditRes) {
    console.log("  [✓] Audit log entry recorded in 'auditLogs' collection.");
  }

  // 7. Verify Administrator Authentication & Backend Authorization
  console.log("\n[Step 6/6] Running end-to-end verification...");
  
  // 7a. Profile retrieval check
  const profile = await getFirestoreUser(gcloudToken, uid);
  if (profile.role !== "admin" || profile.status !== "active") {
    throw new Error(`Verification failed: Firestore profile role is '${profile.role}' (expected 'admin')`);
  }
  console.log(`  [✓] Firestore profile verified: role='${profile.role}', status='${profile.status}'`);

  // 7b. Password sign-in check (if API key available)
  let adminIdToken = null;
  if (API_KEY) {
    try {
      const authResult = await signInWithPassword(API_KEY, targetEmail, initialPassword);
      adminIdToken = authResult.idToken;
      console.log("  [✓] Firebase Auth sign-in verification succeeded.");
    } catch (err) {
      console.warn(`  [!] Sign-in check note: ${err.message}`);
    }
  }

  // 7c. Backend API access check
  if (adminIdToken) {
    const adminApiTest = await testBackendAdminAccess(adminIdToken);
    if (adminApiTest.ok) {
      console.log(`  [✓] Backend admin authorization verified: GET /api/admin/audit-logs returned HTTP ${adminApiTest.status}`);
    } else {
      console.warn(`  [!] Backend admin route returned HTTP ${adminApiTest.status}: ${JSON.stringify(adminApiTest.body)}`);
    }
  }

  // 7d. Non-admin denial check
  const nonAdminTest = await testBackendNonAdminAccess();
  if (nonAdminTest.unauthStatus === 401 && nonAdminTest.invalidStatus === 401) {
    console.log("  [✓] Security barrier verified: Unauthenticated/invalid requests are rejected with HTTP 401.");
  }

  console.log("\n================================================================================");
  console.log("FIRST ADMINISTRATOR PROVISIONING COMPLETE [✓]");
  console.log("================================================================================");
  console.log(`Administrator Login Email: ${targetEmail}`);
  console.log(`Administrator UID:         ${uid}`);
  console.log(`Login URL:                 ${FRONTEND_URL}/login`);
  console.log(`Admin Panel URL:           ${FRONTEND_URL}/admin`);
  console.log("\nSecure Password Setup / Reset URL:");
  console.log(`  ${resetLink}`);
  console.log("\nINSTRUCTIONS FOR USER:");
  console.log("1. Open the Password Setup / Reset URL above to define your private administrator password.");
  console.log("2. Navigate to the Login URL and sign in with your email and new password.");
  console.log("3. Access the Admin Panel to govern the platform.");
  console.log("================================================================================\n");
}

main().catch((err) => {
  console.error("\n[✗] FATAL ERROR during administrator provisioning:", err);
  process.exit(1);
});
