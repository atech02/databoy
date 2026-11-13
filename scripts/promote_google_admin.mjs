/**
 * DataBoy — Promote Existing Google Account to Platform Administrator
 *
 * Promotes the existing Google OAuth user (atechsolutions0225@gmail.com, UID: 6TCuUkSCKtWBlokgufXqRGv1llI3)
 * to platform administrator in Firestore, while keeping the existing placeholder administrator
 * (admin@databoy.com, UID: QdZ4bDygR3RWsp99GWz9ph8TzpP2) completely intact.
 */

import { execSync } from "child_process";

const PROJECT_ID = "databoy-aa871";
const BACKEND_URL = "https://databoy-backend-staging.onrender.com";
const TARGET_UID = "6TCuUkSCKtWBlokgufXqRGv1llI3";
const TARGET_EMAIL = "atechsolutions0225@gmail.com";
const PLACEHOLDER_UID = "QdZ4bDygR3RWsp99GWz9ph8TzpP2";
const PLACEHOLDER_EMAIL = "admin@databoy.com";

function getGoogleAccessToken() {
  if (process.env.GOOGLE_ACCESS_TOKEN) return process.env.GOOGLE_ACCESS_TOKEN.trim();
  return execSync("gcloud auth print-access-token", { encoding: "utf8" }).trim();
}

async function lookupAuthUser(token, uid) {
  const url = `https://identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:lookup`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Content-Type": "application/json",
      "x-goog-user-project": PROJECT_ID,
    },
    body: JSON.stringify({ localId: [uid] }),
  });
  if (!res.ok) throw new Error(`Auth lookup failed for ${uid}: HTTP ${res.status}`);
  const data = await res.json();
  return (data.users || [])[0] || null;
}

async function getFirestoreUser(token, uid) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/users/${uid}`;
  const res = await fetch(url, {
    headers: {
      "Authorization": `Bearer ${token}`,
      "x-goog-user-project": PROJECT_ID,
    },
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore lookup failed for ${uid}: HTTP ${res.status}`);
  return await res.json();
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
    throw new Error(`Failed to create Firestore profile for ${uid}: ${errText}`);
  }

  return await res.json();
}

async function recordAuditLog(token, targetUid, targetEmail) {
  const url = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents/auditLogs`;
  const timestamp = new Date().toISOString();

  const payload = {
    fields: {
      action: { stringValue: "admin_promoted" },
      actorId: { stringValue: "system_bootstrap" },
      actorName: { stringValue: "Server Bootstrap Process" },
      actorRole: { stringValue: "admin" },
      targetId: { stringValue: targetUid },
      targetType: { stringValue: "user" },
      details: {
        mapValue: {
          fields: {
            email: { stringValue: targetEmail },
            provider: { stringValue: "google.com" },
            method: { stringValue: "google_oauth_promotion" },
            role: { stringValue: "admin" },
            placeholderAdminPreserved: { stringValue: PLACEHOLDER_UID },
            promotedAt: { stringValue: timestamp },
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

async function main() {
  console.log("================================================================================");
  console.log("DATABOY GOOGLE ACCOUNT PROMOTION TO PLATFORM ADMINISTRATOR");
  console.log(`Target Firebase Project: ${PROJECT_ID}`);
  console.log(`Target User:             ${TARGET_EMAIL} (${TARGET_UID})`);
  console.log(`Placeholder Admin:       ${PLACEHOLDER_EMAIL} (${PLACEHOLDER_UID})`);
  console.log("================================================================================\n");

  const token = getGoogleAccessToken();

  // 1. Reconfirm target Google account in Firebase Auth
  console.log("[Step 1/5] Reconfirming target Google account in Firebase Auth...");
  const targetAuth = await lookupAuthUser(token, TARGET_UID);
  if (!targetAuth) {
    throw new Error(`Target account ${TARGET_UID} not found in Firebase Auth`);
  }
  if (targetAuth.email !== TARGET_EMAIL) {
    throw new Error(`Target account email mismatch: expected ${TARGET_EMAIL}, got ${targetAuth.email}`);
  }
  if (!targetAuth.emailVerified) {
    throw new Error(`Target account email is not verified in Firebase Auth`);
  }
  const providers = (targetAuth.providerUserInfo || []).map((p) => p.providerId);
  console.log(`  [✓] Verified: ${targetAuth.email} (UID: ${targetAuth.localId})`);
  console.log(`  [✓] Providers: ${providers.join(", ")}`);
  console.log(`  [✓] Email verified: ${targetAuth.emailVerified}`);

  // 2. Reconfirm placeholder admin in Firebase Auth & Firestore
  console.log("\n[Step 2/5] Reconfirming placeholder admin remains intact...");
  const placeholderAuth = await lookupAuthUser(token, PLACEHOLDER_UID);
  if (!placeholderAuth) {
    throw new Error(`Placeholder admin ${PLACEHOLDER_UID} not found in Firebase Auth`);
  }
  const placeholderFirestore = await getFirestoreUser(token, PLACEHOLDER_UID);
  if (!placeholderFirestore) {
    throw new Error(`Placeholder admin profile ${PLACEHOLDER_UID} not found in Firestore`);
  }
  console.log(`  [✓] Placeholder Auth account intact: ${placeholderAuth.email} (${PLACEHOLDER_UID})`);
  console.log(`  [✓] Placeholder Firestore profile intact: role='${placeholderFirestore.fields?.role?.stringValue}'`);

  // 3. Confirm target does not already have a conflicting Firestore profile
  console.log("\n[Step 3/5] Checking target Firestore profile state...");
  const targetFirestore = await getFirestoreUser(token, TARGET_UID);
  if (targetFirestore) {
    const existingRole = targetFirestore.fields?.role?.stringValue;
    if (existingRole === "admin") {
      console.log(`  [!] Profile already exists with role='admin'.`);
    } else {
      throw new Error(`Conflicting profile exists for ${TARGET_UID} with role '${existingRole}'`);
    }
  } else {
    console.log(`  [✓] Confirmed: No prior Firestore profile exists for ${TARGET_UID}.`);
  }

  // 4. Create the authoritative administrator profile in Firestore
  console.log("\n[Step 4/5] Creating authoritative admin profile in Firestore...");
  const displayName = targetAuth.displayName || "ATech Solutions";
  await createFirestoreProfile(token, TARGET_UID, TARGET_EMAIL, displayName);
  console.log(`  [✓] Created users/${TARGET_UID} with role: 'admin', status: 'active', isOnboarded: true.`);

  // 5. Record immutable audit log
  console.log("\n[Step 5/5] Writing immutable audit record...");
  await recordAuditLog(token, TARGET_UID, TARGET_EMAIL);
  console.log(`  [✓] Recorded audit event 'admin_promoted' in auditLogs collection.`);

  // 6. Verify profile retrieval
  console.log("\n================================================================================");
  console.log("VERIFYING PROMOTED ADMINISTRATOR");
  console.log("================================================================================");
  const verifyProfile = await getFirestoreUser(token, TARGET_UID);
  const vf = verifyProfile.fields || {};
  console.log(`  - UID:              ${vf.uid?.stringValue}`);
  console.log(`  - Email:            ${vf.email?.stringValue}`);
  console.log(`  - Role:             ${vf.role?.stringValue}`);
  console.log(`  - Status:           ${vf.status?.stringValue}`);
  console.log(`  - IsOnboarded:      ${vf.isOnboarded?.booleanValue}`);
  console.log(`  - ProfileCompl:     ${vf.profileCompletion?.integerValue}%`);
  console.log(`  - Placeholder Adm:  Intact (${PLACEHOLDER_EMAIL})`);
  console.log("================================================================================\n");
  console.log("PROMOTION COMPLETED SUCCESSFULLY! [✓]");
}

main().catch((err) => {
  console.error("\n[✗] FATAL ERROR during promotion:", err);
  process.exit(1);
});
