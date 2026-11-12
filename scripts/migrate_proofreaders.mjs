/**
 * DataBoy Stage F: Proofreader Role Migration Script
 *
 * Migrates legacy `role: "proofreader"` accounts to the unified three-role architecture:
 *   - role -> "writer"
 *   - canProofread -> true
 *   - isProofreadCertified -> true
 *   - specialistCapabilities -> ["writing", "proofreading"]
 *
 * Safety:
 *   - Supports --dry-run (default if neither --dry-run nor --execute is passed)
 *   - Idempotent: already-migrated accounts are skipped
 *   - Preserves all existing profile fields, status history, and reputation
 */

import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

const isExecute = process.argv.includes("--execute");
const isDryRun = !isExecute;

console.log(`[Proofreader Migration] Mode: ${isDryRun ? "DRY-RUN (Simulated)" : "LIVE EXECUTION"}`);

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "databoy-dev";
if (getApps().length === 0) {
  initializeApp({ projectId });
}
const db = getFirestore();

export async function runMigration(options = {}) {
  const shouldExecute = options.execute ?? process.argv.includes("--execute");
  const isDryRun = !shouldExecute;

  console.log(`[Proofreader Migration] Execution mode: ${isDryRun ? "DRY-RUN (Simulated)" : "LIVE EXECUTION"}`);

  const usersRef = db.collection("users");
  const snapshot = await usersRef.where("role", "==", "proofreader").get();

  console.log(`[Proofreader Migration] Found ${snapshot.size} legacy proofreader accounts.`);

  if (snapshot.empty) {
    console.log("[Proofreader Migration] No legacy proofreader accounts require migration.");
    return { scanned: 0, migrated: 0 };
  }

  let migrated = 0;

  for (const doc of snapshot.docs) {
    const data = doc.data();
    const existingCapabilities = Array.isArray(data.specialistCapabilities) ? data.specialistCapabilities : [];
    const mergedCapabilities = Array.from(new Set([...existingCapabilities, "writing", "proofreading"]));

    const updatePayload = {
      role: "writer",
      canProofread: true,
      isProofreadCertified: true,
      specialistCapabilities: mergedCapabilities,
      migratedFromLegacyProofreader: true,
      migratedAt: new Date().toISOString(),
    };

    console.log(` - User ${doc.id} (${data.email || "no-email"}):`);
    console.log(`   role: "proofreader" -> "writer"`);
    console.log(`   canProofread: true`);
    console.log(`   specialistCapabilities: ${JSON.stringify(mergedCapabilities)}`);

    if (shouldExecute) {
      await doc.ref.update(updatePayload);
      console.log(`   [STATUS: UPDATED]`);
    } else {
      console.log(`   [STATUS: SIMULATED]`);
    }

    migrated++;
  }

  console.log(`[Proofreader Migration] Completed: ${migrated} accounts processed.`);
  return { scanned: snapshot.size, migrated };
}

// Run directly if invoked from CLI
if (process.argv[1]?.endsWith("migrate_proofreaders.mjs")) {
  runMigration()
    .then(() => {
      console.log("[Proofreader Migration] Finished.");
      process.exit(0);
    })
    .catch((err) => {
      console.error("[Proofreader Migration] Error:", err);
      process.exit(1);
    });
}
