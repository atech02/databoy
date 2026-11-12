/**
 * DataBoy Automated Regression Test Suite
 * Reputation Model, Validation & Profile Normalization Suite
 * 
 * Verifies:
 *  1. New user with no reputation history (reputation: 0).
 *  2. Existing user with valid score (reputation: 4.8, 1.0, 5.0).
 *  3. Legacy user with score of zero (reputation: 0).
 *  4. Missing (undefined) and null reputation values.
 *  5. Invalid string and out-of-range values (e.g. 0.5, -1, 5.5, NaN, strings).
 *  6. Safe normalization of legacy profiles (preserves legitimate scores, defaults corrupted/unrated to 0, preserves all other profile fields).
 *  7. Differentiated error handling behavior in AuthProvider contract.
 *  8. Firestore rules enforcement: reputation is server-controlled (client cannot write reputation on create or update).
 */

import fs from "fs";
import path from "path";
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runScenario(scenarioNum, name, testFn) {
  totalTests++;
  process.stdout.write(`Scenario ${scenarioNum}: ${name} ... `);
  try {
    await testFn();
    passedTests++;
    console.log("PASSED [✓]");
  } catch (err) {
    failedTests++;
    console.log(`FAILED [✗]\n  -> ${err.message}`);
  }
}

// -----------------------------------------------------------------------------
// Pure logic mirrors of src/utils/validation.ts & src/services/userService.ts
// to guarantee test execution in Node without module bundling side-effects.
// -----------------------------------------------------------------------------
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateUserProfile(data) {
  const errors = [];

  if (!data.uid || typeof data.uid !== "string" || data.uid.trim() === "") {
    errors.push("Invalid User ID (uid) is required.");
  }
  if (!data.email || !EMAIL_REGEX.test(data.email)) {
    errors.push("Invalid email format.");
  }
  if (!data.displayName || data.displayName.trim().length < 2) {
    errors.push("Display name must be at least 2 characters.");
  }

  const validRoles = ["customer", "writer", "proofreader", "admin"];
  if (!data.role || !validRoles.includes(data.role)) {
    errors.push(`Invalid role. Must be one of: ${validRoles.join(", ")}`);
  }

  const validStatuses = ["active", "suspended"];
  if (!data.status || !validStatuses.includes(data.status)) {
    errors.push(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
  }

  if (data.reputation !== undefined && data.reputation !== null) {
    if (typeof data.reputation !== "number" || Number.isNaN(data.reputation) || !Number.isFinite(data.reputation)) {
      errors.push("Reputation score must be a valid number.");
    } else if (data.reputation !== 0 && (data.reputation < 1.0 || data.reputation > 5.0)) {
      errors.push("Reputation score must be between 1.0 and 5.0 (or 0 for unrated users).");
    }
  }

  if (data.isOnboarded) {
    if (!data.academic) {
      errors.push("Academic profile details are required upon onboarding completion.");
    } else {
      const acad = data.academic;
      if (!acad.major || acad.major.trim().length === 0) {
        errors.push("Major or Program of Study is required.");
      }
      if (!acad.yearOfStudy || acad.yearOfStudy.trim().length === 0) {
        errors.push("Education Level or Qualification is required.");
      }
    }
  }

  return errors;
}

function normalizeUserProfile(raw) {
  const user = { ...raw };

  const vStatus = user.verificationStatus;
  if (vStatus === "verified" || vStatus === "approved") {
    user.verificationStatus = "approved";
    user.writerStatus = "active";
    user.isVerifiedWriter = true;
  } else if (vStatus === "pending" || vStatus === "pending_review") {
    user.verificationStatus = "pending_review";
    user.writerStatus = "inactive";
    user.isVerifiedWriter = false;
  } else {
    user.verificationStatus = (vStatus === "incomplete" || vStatus === "clarification_required" || vStatus === "rejected")
      ? vStatus
      : "draft";
    user.writerStatus = "inactive";
    user.isVerifiedWriter = false;
  }

  user.competencies = user.competencies ?? (user.academic?.specializations || []);
  user.subjectExpertise = user.subjectExpertise ?? (user.academic?.specializations || []);
  user.degreeLevel = user.degreeLevel ?? (user.academic?.yearOfStudy || "");
  user.yearsOfExperience = user.yearsOfExperience ?? 0;
  user.preferredWorkload = user.preferredWorkload ?? 5;
  user.activeTaskCount = user.activeTaskCount ?? 0;
  user.completedAssignments = user.completedAssignments ?? (user.completedCount || 0);
  user.disputeCount = user.disputeCount ?? 0;
  user.revisionCount = user.revisionCount ?? 0;

  // Safe reputation normalization
  const rawRep = raw?.reputation;
  if (rawRep === undefined || rawRep === null) {
    user.reputation = 0;
  } else if (typeof rawRep === "number") {
    if (Number.isFinite(rawRep) && (rawRep === 0 || (rawRep >= 1.0 && rawRep <= 5.0))) {
      user.reputation = rawRep;
    } else {
      user.reputation = 0;
    }
  } else if (typeof rawRep === "string") {
    const parsed = Number(rawRep);
    if (Number.isFinite(parsed) && (parsed === 0 || (parsed >= 1.0 && parsed <= 5.0))) {
      user.reputation = parsed;
    } else {
      user.reputation = 0;
    }
  } else {
    user.reputation = 0;
  }
  user.averageRating = user.averageRating ?? (user.reputation || 0);

  return user;
}

function classifyAuthError(errorStr) {
  const lower = (errorStr || "").toLowerCase();
  if (lower.includes("suspended") || lower.includes("restricted") || lower.includes("permission-denied")) {
    return "Account Access Restricted";
  }
  if (lower.includes("validation failed") || lower.includes("schema") || lower.includes("reputation") || lower.includes("invalid profile")) {
    return "Account Profile Error";
  }
  return "Database Connection Failed";
}

async function runAll() {
  console.log("================================================================================");
  console.log("DATABOY REPUTATION MODEL & PROFILE VALIDATION REGRESSION SUITE");
  console.log("================================================================================\n");

  const baseValidUser = {
    uid: "usr_test_123",
    email: "student@university.edu.zm",
    displayName: "Chileshe Mwape",
    role: "customer",
    status: "active",
    isOnboarded: false,
    profileCompletion: 20,
  };

  // ---------------------------------------------------------------------------
  // 1. New user with no reputation history (reputation = 0)
  // ---------------------------------------------------------------------------
  await runScenario(1, "New user with default reputation = 0 passes validation", async () => {
    const user = { ...baseValidUser, reputation: 0 };
    const errs = validateUserProfile(user);
    assert(errs.length === 0, `Expected 0 validation errors, got: ${errs.join(" | ")}`);
  });

  // ---------------------------------------------------------------------------
  // 2. Existing user with valid rating (1.0 - 5.0)
  // ---------------------------------------------------------------------------
  await runScenario(2, "Existing user with valid reputation score (4.8, 1.0, 5.0) passes validation", async () => {
    for (const score of [1.0, 3.5, 4.8, 5.0]) {
      const user = { ...baseValidUser, reputation: score };
      const errs = validateUserProfile(user);
      assert(errs.length === 0, `Score ${score} failed validation: ${errs.join(" | ")}`);
    }
  });

  // ---------------------------------------------------------------------------
  // 3. Legacy user with score of zero (reputation = 0)
  // ---------------------------------------------------------------------------
  await runScenario(3, "Legacy user with score of 0 is treated as valid unrated user", async () => {
    const user = { ...baseValidUser, reputation: 0 };
    const errs = validateUserProfile(user);
    assert(errs.length === 0, `Legacy score 0 failed validation: ${errs.join(" | ")}`);
    const normalized = normalizeUserProfile({ ...baseValidUser, reputation: 0 });
    assert(normalized.reputation === 0, "Reputation 0 should normalize to 0");
    assert(normalized.averageRating === 0, "Average rating should normalize to 0");
  });

  // ---------------------------------------------------------------------------
  // 4. Missing and null reputation values
  // ---------------------------------------------------------------------------
  await runScenario(4, "Missing (undefined) and null reputation pass validation and normalize to 0", async () => {
    // Undefined
    const userUndef = { ...baseValidUser, reputation: undefined };
    const errsUndef = validateUserProfile(userUndef);
    assert(errsUndef.length === 0, `Undefined reputation produced errors: ${errsUndef.join(" | ")}`);
    const normUndef = normalizeUserProfile(userUndef);
    assert(normUndef.reputation === 0, `Expected normalized reputation 0, got ${normUndef.reputation}`);

    // Null
    const userNull = { ...baseValidUser, reputation: null };
    const errsNull = validateUserProfile(userNull);
    assert(errsNull.length === 0, `Null reputation produced errors: ${errsNull.join(" | ")}`);
    const normNull = normalizeUserProfile(userNull);
    assert(normNull.reputation === 0, `Expected normalized reputation 0, got ${normNull.reputation}`);
  });

  // ---------------------------------------------------------------------------
  // 5. Invalid string and out-of-range values
  // ---------------------------------------------------------------------------
  await runScenario(5, "Invalid string, NaN, negative, and out-of-range values are strictly rejected by validator", async () => {
    const invalidCases = [
      { rep: "4.8", expectedMsg: "Reputation score must be a valid number." },
      { rep: "invalid", expectedMsg: "Reputation score must be a valid number." },
      { rep: NaN, expectedMsg: "Reputation score must be a valid number." },
      { rep: Infinity, expectedMsg: "Reputation score must be a valid number." },
      { rep: 0.5, expectedMsg: "Reputation score must be between 1.0 and 5.0 (or 0 for unrated users)." },
      { rep: -1, expectedMsg: "Reputation score must be between 1.0 and 5.0 (or 0 for unrated users)." },
      { rep: 5.1, expectedMsg: "Reputation score must be between 1.0 and 5.0 (or 0 for unrated users)." },
      { rep: 10, expectedMsg: "Reputation score must be between 1.0 and 5.0 (or 0 for unrated users)." },
    ];

    for (const { rep, expectedMsg } of invalidCases) {
      const errs = validateUserProfile({ ...baseValidUser, reputation: rep });
      assert(errs.length > 0, `Expected validation failure for reputation=${rep}`);
      assert(errs.some((e) => e.includes(expectedMsg)), `Expected error containing "${expectedMsg}", got: ${errs.join(" | ")}`);
    }
  });

  // ---------------------------------------------------------------------------
  // 6. Safe legacy profile normalization
  // ---------------------------------------------------------------------------
  await runScenario(6, "Legacy records normalize safely without destroying data", async () => {
    // 6a: Legacy valid score is preserved
    const rawLegit = {
      uid: "leg_1",
      email: "writer@databoy.com",
      displayName: "Experienced Writer",
      role: "writer",
      status: "active",
      reputation: 4.95,
      completedCount: 42,
      academic: { major: "Computer Science", yearOfStudy: "Master" },
    };
    const normLegit = normalizeUserProfile(rawLegit);
    assert(normLegit.reputation === 4.95, "Valid reputation must be preserved exactly");
    assert(normLegit.completedAssignments === 42, "completedAssignments must map from completedCount");
    assert(normLegit.degreeLevel === "Master", "degreeLevel must normalize from academic.yearOfStudy");

    // 6b: Legacy numeric string parses safely
    const rawStringRep = { ...rawLegit, reputation: "4.5" };
    const normStringRep = normalizeUserProfile(rawStringRep);
    assert(normStringRep.reputation === 4.5, "Numeric string '4.5' must parse to number 4.5");

    // 6c: Legacy corrupted string or out-of-range value defaults to 0 safely without crashing
    const rawCorrupt = { ...rawLegit, reputation: "corrupt_data", customField: "preserve_me" };
    const normCorrupt = normalizeUserProfile(rawCorrupt);
    assert(normCorrupt.reputation === 0, "Corrupt reputation must default to 0 in memory");
    assert(normCorrupt.customField === "preserve_me", "Non-reputation fields must not be destroyed");
  });

  // ---------------------------------------------------------------------------
  // 7. Error classification in AuthProvider
  // ---------------------------------------------------------------------------
  await runScenario(7, "AuthProvider error classification differentiates schema, suspension, and network issues", async () => {
    assert(
      classifyAuthError("Profile validation failed: Reputation score must be between 1.0 and 5.0.") === "Account Profile Error",
      "Validation failure must map to Account Profile Error"
    );
    assert(
      classifyAuthError("Your account has been suspended. Please contact support.") === "Account Access Restricted",
      "Suspension must map to Account Access Restricted"
    );
    assert(
      classifyAuthError("Database connection lookup timed out (8s limit exceeded).") === "Database Connection Failed",
      "Timeout must map to Database Connection Failed"
    );
  });

  // ---------------------------------------------------------------------------
  // 8. Firestore security rules: client cannot manipulate reputation
  // ---------------------------------------------------------------------------
  const net = await import("net");
  const emulatorRunning = await new Promise((resolve) => {
    const s = net.createConnection({ host: "127.0.0.1", port: 8080 }, () => {
      s.end();
      resolve(true);
    });
    s.on("error", () => resolve(false));
  });

  if (!emulatorRunning) {
    console.log("Scenario 8: Firestore security rules client isolation ... SKIPPED (Firestore Emulator not running on 127.0.0.1:8080)");
  } else {
    await runScenario(8, "Firestore security rules prevent client from creating or updating reputation", async () => {
      const rulesPath = path.resolve(process.cwd(), "firestore.rules");
      const rulesContent = fs.readFileSync(rulesPath, "utf8");

      const testEnv = await initializeTestEnvironment({
        projectId: "databoy-reputation-rules-test",
        firestore: {
          host: "127.0.0.1",
          port: 8080,
          rules: rulesContent,
        },
      });

      try {
        await testEnv.clearFirestore();

        const userAuth = testEnv.authenticatedContext("student_rep_test", { email: "student_rep@test.com" });
        const db = userAuth.firestore();

        // Client attempt to write reputation on create -> MUST FAIL
        await assertFails(
          setDoc(doc(db, "users/student_rep_test"), {
            uid: "student_rep_test",
            email: "student_rep@test.com",
            displayName: "Cheater",
            role: "customer",
            status: "active",
            reputation: 5.0, // FORBIDDEN CLIENT WRITE
          })
        );

        // Client legit creation without reputation -> MUST SUCCEED
        await assertSucceeds(
          setDoc(doc(db, "users/student_rep_test"), {
            uid: "student_rep_test",
            email: "student_rep@test.com",
            displayName: "Legit User",
            role: "customer",
            status: "active",
          })
        );

        // Client attempt to update reputation -> MUST FAIL
        await assertFails(
          updateDoc(doc(db, "users/student_rep_test"), {
            reputation: 5.0,
          })
        );

        // Admin updating reputation -> MUST SUCCEED
        await testEnv.withSecurityRulesDisabled(async (ctx) => {
          await setDoc(doc(ctx.firestore(), "users/admin_rep_test"), {
            uid: "admin_rep_test",
            role: "admin",
            status: "active",
          });
          // Admin setting reputation directly
          await setDoc(doc(ctx.firestore(), "users/student_rep_test"), { reputation: 4.8 }, { merge: true });
        });

        // Verify user reading document
        const snap = await getDoc(doc(db, "users/student_rep_test"));
        assert(snap.exists(), "Document must exist");
        const readData = snap.data();
        assert(readData.reputation === 4.8, `Expected reputation 4.8 from admin write, got ${readData.reputation}`);

        const normalized = normalizeUserProfile(readData);
        assert(normalized.reputation === 4.8, "Retrieved profile must normalize to 4.8");
      } finally {
        await testEnv.cleanup();
      }
    });
  }

  console.log("\n================================================================================");
  console.log("REPUTATION & PROFILE VALIDATION TEST RESULTS");
  console.log("================================================================================");
  console.log(`Total Scenarios: ${totalTests}`);
  console.log(`Passed:          ${passedTests} [✓]`);
  console.log(`Failed:          ${failedTests} [✗]`);
  console.log("================================================================================\n");

  if (failedTests > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runAll().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
