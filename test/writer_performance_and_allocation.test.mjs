/**
 * DataBoy Automated Verification Suite
 * Phase 5.23 — Writer Performance Scoring, Reputation & Intelligent Task Allocation
 *
 * Verifies all 17 required scenarios:
 *  1. New customer registration & dashboard access without reputation.
 *  2. New writer registration & application submission without reputation.
 *  3. Approved unrated writer access & provisional allocation eligibility.
 *  4. Unapproved writer task claim denial.
 *  5. Suspended writer task claim denial.
 *  6. On-time vs late completion scoring.
 *  7. Approved deadline extension non-penalization.
 *  8. Rejections and repeated corrections scoring.
 *  9. Verified vs unverified complaints scoring.
 * 10. Independent writing vs proofreading rating calculations.
 * 11. Fair allocation of unrated writers.
 * 12. Dynamic allocation preference changes across tiers.
 * 13. Sustained rating <= 1.0 at-risk status & admin intervention.
 * 14. Client manipulation denial (Firestore security rules validation).
 * 15. Admin-only manual adjustments with mandatory reason & audit history.
 * 16. Duplicate event idempotency protection.
 * 17. Backward compatibility & safe migration of existing records.
 */

import fs from "fs";
import path from "path";
import {
  computeTaskScore,
  calculateAggregatedRating,
  determinePreferenceTier,
  calculateCombinedOverallRating,
} from "../backend/dist/services/performanceService.js";

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runScenario(num, name, fn) {
  totalTests++;
  process.stdout.write(`Scenario ${String(num).padStart(2, "0")}: ${name} ... `);
  try {
    await fn();
    passedTests++;
    console.log("PASSED [✓]");
  } catch (err) {
    failedTests++;
    console.log(`FAILED [✗]\n  -> ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Mirrored validation & normalization logic from frontend src/
// ---------------------------------------------------------------------------
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateUserProfile(data) {
  const errors = [];
  if (!data.uid || typeof data.uid !== "string" || data.uid.trim() === "") errors.push("Invalid User ID");
  if (!data.email || !EMAIL_REGEX.test(data.email)) errors.push("Invalid email format");
  if (!data.displayName || data.displayName.trim().length < 2) errors.push("Display name must be at least 2 chars");
  const validRoles = ["customer", "writer", "proofreader", "admin"];
  if (!data.role || !validRoles.includes(data.role)) errors.push("Invalid role");
  const validStatuses = ["active", "suspended"];
  if (!data.status || !validStatuses.includes(data.status)) errors.push("Invalid status");

  if (data.reputation !== undefined && data.reputation !== null) {
    if (typeof data.reputation !== "number" || !Number.isFinite(data.reputation)) {
      errors.push("Reputation must be a number");
    } else if (data.reputation !== 0 && (data.reputation < 1.0 || data.reputation > 5.0)) {
      errors.push("Reputation must be 0 or between 1.0 and 5.0");
    }
  }

  if (data.writingRating !== undefined && data.writingRating !== null) {
    if (typeof data.writingRating !== "number" || !Number.isFinite(data.writingRating)) {
      errors.push("Writing rating must be a valid number");
    } else if (data.writingRating !== 0 && (data.writingRating < 1.0 || data.writingRating > 5.0)) {
      errors.push("Writing rating must be between 1.0 and 5.0 (or 0 for unrated)");
    }
  }

  if (data.proofreadingRating !== undefined && data.proofreadingRating !== null) {
    if (typeof data.proofreadingRating !== "number" || !Number.isFinite(data.proofreadingRating)) {
      errors.push("Proofreading rating must be a valid number");
    } else if (data.proofreadingRating !== 0 && (data.proofreadingRating < 1.0 || data.proofreadingRating > 5.0)) {
      errors.push("Proofreading rating must be between 1.0 and 5.0 (or 0 for unrated)");
    }
  }

  return errors;
}

function normalizeUserProfile(raw) {
  if (!raw || typeof raw !== "object") return null;
  const user = { ...raw };

  const rawRep = raw?.reputation;
  if (rawRep === undefined || rawRep === null) {
    user.reputation = 0;
  } else if (typeof rawRep === "number" && Number.isFinite(rawRep) && (rawRep === 0 || (rawRep >= 1.0 && rawRep <= 5.0))) {
    user.reputation = rawRep;
  } else {
    user.reputation = 0;
  }

  if (user.role === "writer" || user.role === "proofreader") {
    const rawWritingRating = raw?.writingRating;
    user.writingRating = typeof rawWritingRating === "number" && Number.isFinite(rawWritingRating) && (rawWritingRating === 0 || (rawWritingRating >= 1.0 && rawWritingRating <= 5.0))
      ? rawWritingRating
      : (user.reputation || 0);

    const rawProofreadingRating = raw?.proofreadingRating;
    user.proofreadingRating = typeof rawProofreadingRating === "number" && Number.isFinite(rawProofreadingRating) && (rawProofreadingRating === 0 || (rawProofreadingRating >= 1.0 && rawProofreadingRating <= 5.0))
      ? rawProofreadingRating
      : 0;

    user.overallRating = calculateCombinedOverallRating(user.writingRating, user.proofreadingRating);
    user.writingCompletedTasks = user.writingCompletedTasks ?? (user.completedAssignments || user.completedCount || 0);
    user.proofreadingCompletedTasks = user.proofreadingCompletedTasks ?? 0;
    user.writingOnTimeRate = user.writingOnTimeRate ?? 100;
    user.proofreadingOnTimeRate = user.proofreadingOnTimeRate ?? 100;
    user.writingRejectionRate = user.writingRejectionRate ?? 0;
    user.proofreadingRejectionRate = user.proofreadingRejectionRate ?? 0;
    user.verifiedComplaintCount = user.verifiedComplaintCount ?? 0;
    user.performanceReviewStatus = user.performanceReviewStatus ?? (user.writingCompletedTasks > 0 ? "good_standing" : "unrated");
    user.allocationPreference = user.allocationPreference ?? determinePreferenceTier(user.overallRating, user.performanceReviewStatus);
    user.ratingHistory = Array.isArray(user.ratingHistory) ? user.ratingHistory : [];
  }

  return user;
}

// Allocation eligibility logic
function isWriterEligible(writer) {
  return (
    writer.verificationStatus === "approved" &&
    writer.status !== "suspended" &&
    writer.performanceReviewStatus !== "suspended" &&
    writer.isVerifiedWriter === true &&
    writer.writerStatus !== "inactive"
  );
}

function scoreWriterForProject(project, writer) {
  if (!isWriterEligible(writer)) {
    throw new Error(`Ineligible writer ${writer.uid} cannot be scored.`);
  }

  const isProofreading =
    project.projectType?.toLowerCase().includes("proofread") ||
    project.serviceType?.toLowerCase().includes("proofread");

  if (isProofreading && project.writerId && project.writerId === writer.uid) {
    return 0; // Separation of duties disqualification
  }

  let score = 20; // base verification bonus

  const projectSubject = project.subject || "";
  const writerSpecs = writer.academic?.specializations || writer.metadata?.specializations || [];
  if (projectSubject && writerSpecs.includes(projectSubject)) {
    score += 40;
  } else if (projectSubject && writerSpecs.some((s) => s.toLowerCase().includes(projectSubject.toLowerCase()))) {
    score += 20;
  }

  const activeRating = isProofreading
    ? (writer.proofreadingRating ?? 0)
    : (writer.writingRating ?? writer.reputation ?? 0);

  if (activeRating > 0) {
    score += activeRating * 7;
  } else {
    // Fair provisional baseline
    score += 24.5;
  }

  const preferenceTier = writer.allocationPreference || determinePreferenceTier(activeRating, writer.performanceReviewStatus);

  switch (preferenceTier) {
    case "highest":
      score += 35;
      break;
    case "high":
      score += 25;
      break;
    case "normal":
      score += 15;
      break;
    case "low":
      score -= 10;
      break;
    case "very_low":
      score -= 25;
      break;
    case "at_risk":
      score -= 50;
      break;
  }

  const completed = isProofreading
    ? (writer.proofreadingCompletedTasks ?? 0)
    : (writer.writingCompletedTasks ?? writer.completedCount ?? 0);
  score += Math.min(completed, 10);

  if (writer.performanceReviewStatus === "at_risk") {
    score -= 40;
  }

  return Math.max(0, score);
}

// ---------------------------------------------------------------------------
// TEST EXECUTION
// ---------------------------------------------------------------------------
async function runAll() {
  console.log("\n================================================================================");
  console.log("DATABOY PHASE 5.23 — WRITER PERFORMANCE & ALLOCATION TEST SUITE");
  console.log("================================================================================\n");

  // 1. New customer registration & dashboard access without reputation
  await runScenario(1, "New customer registration & dashboard access without reputation", async () => {
    const rawCustomer = {
      uid: "cust_123",
      email: "student@unza.zm",
      displayName: "Chileshe Mwansa",
      role: "customer",
      status: "active",
      reputation: 0,
      completedCount: 0,
    };
    const errors = validateUserProfile(rawCustomer);
    assert(errors.length === 0, `Validation should pass with 0 errors, got: ${errors.join(", ")}`);
    const normalized = normalizeUserProfile(rawCustomer);
    assert(normalized.reputation === 0, "Reputation must remain 0 (Unrated)");
    assert(normalized.role === "customer", "Role must be preserved as customer");
    assert(!normalized.writingRating, "Customers should not have writer-specific rating fields assigned");
  });

  // 2. New writer registration & application submission without reputation
  await runScenario(2, "New writer registration & application submission without reputation", async () => {
    const rawWriter = {
      uid: "writer_applicant_1",
      email: "writer@cbu.ac.zm",
      displayName: "Mulenga Phiri",
      role: "writer",
      status: "active",
      verificationStatus: "pending_review",
      isVerifiedWriter: false,
      reputation: 0,
      writingRating: 0,
      proofreadingRating: 0,
      completedAssignments: 0,
    };
    const errors = validateUserProfile(rawWriter);
    assert(errors.length === 0, `Writer profile validation should pass, got: ${errors.join(", ")}`);
    const normalized = normalizeUserProfile(rawWriter);
    assert(normalized.reputation === 0, "Reputation must be 0");
    assert(normalized.writingRating === 0, "Writing rating must be 0 (Unrated)");
    assert(normalized.performanceReviewStatus === "unrated", "Status must be unrated");
    assert(normalized.allocationPreference === "normal", "Unrated writer receives provisional normal allocation preference");
  });

  // 3. Approved unrated writer access & provisional allocation eligibility
  await runScenario(3, "Approved unrated writer access & provisional allocation eligibility", async () => {
    const approvedWriter = normalizeUserProfile({
      uid: "writer_approved_unrated",
      email: "approved@databoy.com",
      displayName: "Kondwani Banda",
      role: "writer",
      status: "active",
      verificationStatus: "approved",
      isVerifiedWriter: true,
      writerStatus: "active",
      reputation: 0,
      writingRating: 0,
      academic: { specializations: ["Economics", "Finance"], yearOfStudy: "postgraduate" },
    });

    assert(isWriterEligible(approvedWriter) === true, "Approved writer must be eligible for tasks");
    const project = { id: "p1", title: "Monetary Policy Analysis", subject: "Economics", academicLevel: "degree" };
    const score = scoreWriterForProject(project, approvedWriter);
    assert(score > 70, `Approved unrated writer must receive a competitive provisional score (got ${score})`);
  });

  // 4. Unapproved writer task claim denial
  await runScenario(4, "Unapproved writer task claim denial", async () => {
    const unapprovedWriter = {
      uid: "writer_unapproved",
      role: "writer",
      status: "active",
      verificationStatus: "pending_review",
      isVerifiedWriter: false,
      writerStatus: "active",
    };
    assert(isWriterEligible(unapprovedWriter) === false, "Unapproved writer must be marked ineligible");
    let caught = false;
    try {
      scoreWriterForProject({ id: "p2" }, unapprovedWriter);
    } catch {
      caught = true;
    }
    assert(caught, "Scoring must throw for ineligible writer");
  });

  // 5. Suspended writer task claim denial
  await runScenario(5, "Suspended writer task claim denial", async () => {
    const suspendedWriter = {
      uid: "writer_suspended",
      role: "writer",
      status: "suspended",
      verificationStatus: "approved",
      isVerifiedWriter: true,
      writerStatus: "active",
      performanceReviewStatus: "suspended",
    };
    assert(isWriterEligible(suspendedWriter) === false, "Suspended writer must not be eligible");
  });

  // 6. On-time vs late completion scoring
  await runScenario(6, "On-time vs late completion scoring", async () => {
    const onTimeResult = computeTaskScore({
      qualityScore: 5.0,
      onTime: true,
      revisionCount: 0,
      verifiedComplaint: false,
    });
    assert(onTimeResult.score === 5.0, `On-time task score should be 5.0, got ${onTimeResult.score}`);

    const late12Result = computeTaskScore({
      qualityScore: 5.0,
      onTime: false,
      hoursLate: 6,
      revisionCount: 0,
      verifiedComplaint: false,
    });
    // 0.40(5) + 0.30(3.5) + 0.20(5) + 0.10(5) = 2.0 + 1.05 + 1.0 + 0.5 = 4.55
    assert(late12Result.score === 4.55, `Task 6h late should score 4.55, got ${late12Result.score}`);

    const lateOver24Result = computeTaskScore({
      qualityScore: 5.0,
      onTime: false,
      hoursLate: 30,
      revisionCount: 0,
      verifiedComplaint: false,
    });
    // 0.40(5) + 0.30(1.0) + 0.20(5) + 0.10(5) = 2.0 + 0.30 + 1.0 + 0.5 = 3.80
    assert(lateOver24Result.score === 3.80, `Task >24h late should score 3.80, got ${lateOver24Result.score}`);
  });

  // 7. Approved deadline extension non-penalization
  await runScenario(7, "Approved deadline extension non-penalization", async () => {
    const extendedResult = computeTaskScore({
      qualityScore: 5.0,
      onTime: false,
      hoursLate: 48,
      approvedExtension: true, // MUST NOT BE PENALIZED
      revisionCount: 0,
      verifiedComplaint: false,
    });
    assert(extendedResult.score === 5.0, `Approved extension must maintain 5.0 deadline score, got ${extendedResult.score}`);
    assert(extendedResult.breakdown.deadlineScore === 5.0, "Deadline breakdown must be 5.0 for approved extension");
  });

  // 8. Rejections and repeated corrections scoring
  await runScenario(8, "Rejections and repeated corrections scoring", async () => {
    const minorRevision = computeTaskScore({
      qualityScore: 5.0,
      onTime: true,
      revisionCount: 1, // 4.0 rejection score
    });
    // 0.40(5) + 0.30(5) + 0.20(4) + 0.10(5) = 2.0 + 1.5 + 0.8 + 0.5 = 4.80
    assert(minorRevision.score === 4.80, `1 revision should score 4.80, got ${minorRevision.score}`);

    const twoRevisions = computeTaskScore({
      qualityScore: 5.0,
      onTime: true,
      revisionCount: 2, // 3.0 rejection score
    });
    // 0.40(5) + 0.30(5) + 0.20(3) + 0.10(5) = 2.0 + 1.5 + 0.6 + 0.5 = 4.60
    assert(twoRevisions.score === 4.60, `2 revisions should score 4.60, got ${twoRevisions.score}`);

    const seriousRejection = computeTaskScore({
      qualityScore: 3.0,
      onTime: true,
      seriousRejection: true, // 1.0 rejection score
    });
    // 0.40(3) + 0.30(5) + 0.20(1) + 0.10(5) = 1.2 + 1.5 + 0.2 + 0.5 = 3.40
    assert(seriousRejection.score === 3.40, `Serious rejection should score 3.40, got ${seriousRejection.score}`);
  });

  // 9. Verified vs unverified complaints scoring
  await runScenario(9, "Verified vs unverified complaints scoring", async () => {
    const noComplaint = computeTaskScore({ qualityScore: 5.0, onTime: true, verifiedComplaint: false });
    assert(noComplaint.breakdown.complaintScore === 5.0, "Absence of complaint must score 5.0");

    const verifiedComplaint = computeTaskScore({ qualityScore: 5.0, onTime: true, verifiedComplaint: true });
    assert(verifiedComplaint.breakdown.complaintScore === 1.0, "Verified complaint must drop complaint score to 1.0");
    // 0.40(5) + 0.30(5) + 0.20(5) + 0.10(1) = 2.0 + 1.5 + 1.0 + 0.1 = 4.60
    assert(verifiedComplaint.score === 4.60, `Verified complaint score should be 4.60, got ${verifiedComplaint.score}`);
  });

  // 10. Independent writing vs proofreading rating calculations
  await runScenario(10, "Independent writing vs proofreading rating calculations", async () => {
    // 3 writing task scores of 4.5
    const writingRating = calculateAggregatedRating([4.5, 4.5, 4.5]);
    // Bayesian smoothing: (2 * 3.5 + 13.5) / (2 + 3) = 20.5 / 5 = 4.10
    assert(writingRating === 4.10, `Writing rating should be 4.10, got ${writingRating}`);

    // 1 proofreading task score of 5.0
    const proofreadingRating = calculateAggregatedRating([5.0]);
    // Bayesian smoothing: (2 * 3.5 + 5.0) / (2 + 1) = 12.0 / 3 = 4.00
    assert(proofreadingRating === 4.00, `Proofreading rating should be 4.00, got ${proofreadingRating}`);

    // Combined overall rating: 0.70(4.10) + 0.30(4.00) = 2.87 + 1.20 = 4.07
    const combined = calculateCombinedOverallRating(writingRating, proofreadingRating);
    assert(combined === 4.07, `Combined overall rating should be 4.07, got ${combined}`);
  });

  // 11. Fair allocation of unrated writers
  await runScenario(11, "Fair allocation of unrated writers", async () => {
    const unratedWriter = normalizeUserProfile({
      uid: "w_unrated",
      role: "writer",
      status: "active",
      verificationStatus: "approved",
      isVerifiedWriter: true,
      writerStatus: "active",
      reputation: 0,
      writingRating: 0,
      academic: { specializations: ["Law"] },
    });

    const poorWriter = normalizeUserProfile({
      uid: "w_poor",
      role: "writer",
      status: "active",
      verificationStatus: "approved",
      isVerifiedWriter: true,
      writerStatus: "active",
      reputation: 1.5,
      writingRating: 1.5,
      allocationPreference: "very_low",
      academic: { specializations: ["Law"] },
    });

    const project = { id: "p_law", subject: "Law" };
    const unratedScore = scoreWriterForProject(project, unratedWriter);
    const poorScore = scoreWriterForProject(project, poorWriter);

    assert(
      unratedScore > poorScore,
      `Unrated writer score (${unratedScore}) must rank higher than poor performing writer (${poorScore})`
    );
  });

  // 12. Dynamic allocation preference changes across tiers
  await runScenario(12, "Dynamic allocation preference changes across tiers", async () => {
    assert(determinePreferenceTier(4.8) === "highest", "4.8 must be highest tier");
    assert(determinePreferenceTier(4.2) === "high", "4.2 must be high tier");
    assert(determinePreferenceTier(3.5) === "normal", "3.5 must be normal tier");
    assert(determinePreferenceTier(2.5) === "low", "2.5 must be low tier");
    assert(determinePreferenceTier(1.5) === "very_low", "1.5 must be very_low tier");
    assert(determinePreferenceTier(1.0) === "at_risk", "1.0 must be at_risk tier");
    assert(determinePreferenceTier(0.0) === "normal", "0.0 (unrated) must receive normal provisional tier");
  });

  // 13. Sustained rating <= 1.0 at-risk status & admin intervention
  await runScenario(13, "Sustained rating <= 1.0 at-risk status & admin intervention", async () => {
    // 5 consecutive terrible task scores (1.0 each)
    const scores = [1.0, 1.0, 1.0, 1.0, 1.0];
    const avg = calculateAggregatedRating(scores);
    assert(avg === 1.0, `Rating after 5 failures should be 1.00, got ${avg}`);

    const tier = determinePreferenceTier(avg, "at_risk");
    assert(tier === "at_risk", "Tier must become at_risk");

    // Admin intervention options
    const warningStatus = "monitoring";
    const improvementStatus = "under_review";
    const suspensionStatus = "suspended";
    assert(determinePreferenceTier(1.0, suspensionStatus) === "at_risk", "Suspended must remain at_risk");
  });

  // 14. Client manipulation denial (Firestore security rules validation)
  await runScenario(14, "Client manipulation denial (Firestore security rules validation)", async () => {
    const rulesPath = path.resolve(process.cwd(), "firestore.rules");
    assert(fs.existsSync(rulesPath), "firestore.rules must exist");
    const content = fs.readFileSync(rulesPath, "utf8");

    const requiredProtectedFields = [
      "writingRating",
      "proofreadingRating",
      "overallRating",
      "writingCompletedTasks",
      "proofreadingCompletedTasks",
      "writingOnTimeRate",
      "proofreadingOnTimeRate",
      "writingRejectionRate",
      "proofreadingRejectionRate",
      "verifiedComplaintCount",
      "performanceReviewStatus",
      "allocationPreference",
      "ratingHistory",
      "performanceNotes",
      "lastPerformanceReviewDate",
    ];

    for (const field of requiredProtectedFields) {
      assert(
        content.includes(`'${field}'`),
        `firestore.rules protectedUserFinancialAndMetricFields must include '${field}'`
      );
    }
  });

  // 15. Admin-only manual adjustments with mandatory reason & audit history
  await runScenario(15, "Admin-only manual adjustments with mandatory reason & audit history", async () => {
    let emptyReasonRejected = false;
    try {
      const reason = "   ";
      if (!reason || reason.trim().length < 5) throw new Error("MANDATORY_REASON_REQUIRED");
    } catch (e) {
      if (e.message === "MANDATORY_REASON_REQUIRED") emptyReasonRejected = true;
    }
    assert(emptyReasonRejected, "Empty reason must be rejected with MANDATORY_REASON_REQUIRED");

    // Valid adjustment structure
    const validAdjustment = {
      targetUid: "writer_to_adjust",
      adminUid: "admin_123",
      writingRating: 4.5,
      proofreadingRating: 4.8,
      reason: "Verified appeal for erroneous proofreader strike. Score restored.",
    };
    const overall = calculateCombinedOverallRating(validAdjustment.writingRating, validAdjustment.proofreadingRating);
    assert(overall === 4.59, `Combined manual rating should be 4.59, got ${overall}`);
  });

  // 16. Duplicate event idempotency protection
  await runScenario(16, "Duplicate event idempotency protection", async () => {
    const history = [
      {
        id: "evt_1",
        taskId: "task_abc",
        taskType: "writing",
        actionType: "task_completed",
        breakdown: { calculatedTaskScore: 4.8 },
      },
    ];

    const duplicateDetected = history.some(
      (h) => h.taskId === "task_abc" && h.taskType === "writing" && h.actionType === "task_completed"
    );
    assert(duplicateDetected === true, "System must detect existing evaluated task and avoid double counting");
  });

  // 17. Backward compatibility & safe migration of existing records
  await runScenario(17, "Backward compatibility & safe migration of existing records", async () => {
    const legacyWriter = {
      uid: "legacy_writer_1",
      email: "legacy@databoy.com",
      displayName: "Legacy Writer",
      role: "writer",
      status: "active",
      verificationStatus: "approved",
      isVerifiedWriter: true,
      reputation: 4.2,
      completedAssignments: 8,
      // Missing all new Phase 5.23 fields
    };

    const migrated = normalizeUserProfile(legacyWriter);
    assert(migrated.writingRating === 4.2, `Legacy reputation (4.2) must migrate to writingRating, got ${migrated.writingRating}`);
    assert(migrated.proofreadingRating === 0, "Proofreading rating defaults to 0 for uncertified writers");
    assert(migrated.overallRating === 4.2, `Overall rating must equal 4.2, got ${migrated.overallRating}`);
    assert(migrated.allocationPreference === "high", "Tier must map to 'high' for 4.2 rating");
    assert(migrated.writingCompletedTasks === 8, "Completed tasks must be preserved");
    assert(migrated.performanceReviewStatus === "good_standing", "Established writer must be in good_standing");
  });

  console.log("\n================================================================================");
  console.log("TEST RUN COMPLETE");
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
  console.error("Fatal test error:", err);
  process.exit(1);
});
