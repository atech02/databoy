import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Ensure Firebase Admin is pointing to local emulator
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
const PROJECT_ID = process.env.GCLOUD_PROJECT || "databoy-dev";
process.env.GCLOUD_PROJECT = PROJECT_ID;

// Import all production Cloud Functions from functions/index.js
const {
  fundassignment,
  claimassignment,
  submitassignmentdraft,
  claimproofreadreview,
  rejectproofreadreview,
  completeassignment,
  cancelassignment,
  submitresearchquote,
  respondresearchquote,
  fundresearchrequest,
  assignresearchwriter,
  adminapprovewriter,
  adminsuspenduser
} = await import("../functions/index.js");

// Initialize admin app matching the functions app
if (getApps().length === 0) {
  initializeApp({ projectId: PROJECT_ID });
}

const adminDb = getFirestore();

async function clearEmulatorData() {
  const collections = ["assignments", "users", "researchRequests", "auditLogs", "ocrJobs"];
  for (const col of collections) {
    const snap = await adminDb.collection(col).get();
    const batch = adminDb.batch();
    snap.docs.forEach((doc) => batch.delete(doc.ref));
    await batch.commit();
  }
}

async function runCloudFunctionTests() {
  console.log("================================================================================");
  console.log("DATABOY BACKEND & CLOUD FUNCTIONS PRODUCTION READINESS AUDIT");
  console.log("Targeting Firestore Emulator at 127.0.0.1:8080");
  console.log("================================================================================\n");

  const results = [];

  async function testCase(number, title, fn) {
    process.stdout.write(`Test ${number}: ${title} ... `);
    try {
      await clearEmulatorData();
      await fn();
      console.log("PASSED [✓]");
      results.push({ number, title, status: "PASSED" });
    } catch (err) {
      console.log(`FAILED [✗]\n  -> Error: ${err.message}`);
      results.push({ number, title, status: "FAILED", error: err.message });
    }
  }

  // ---------------------------------------------------------------------------
  // 1. AUTHENTICATION & REJECTION OF UNAUTHENTICATED INVOCATIONS
  // ---------------------------------------------------------------------------
  await testCase(1, "Unauthenticated call to fundassignment is rejected", async () => {
    try {
      await fundassignment.run({ data: { projectId: "proj_1" }, auth: null });
      throw new Error("Should have thrown unauthenticated error");
    } catch (e) {
      if (e.code !== "unauthenticated") {
        throw new Error(`Expected 'unauthenticated' but received '${e.code}': ${e.message}`);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 2. OWNERSHIP VERIFICATION ON FUNDING
  // ---------------------------------------------------------------------------
  await testCase(2, "Unauthorized user cannot fund another student's assignment", async () => {
    // Seed project owned by student_A
    await adminDb.collection("users").doc("student_A").set({
      uid: "student_A",
      role: "customer",
      status: "active"
    });
    await adminDb.collection("users").doc("student_B").set({
      uid: "student_B",
      role: "customer",
      status: "active"
    });
    await adminDb.collection("assignments").doc("proj_owned").set({
      id: "proj_owned",
      customerId: "student_A",
      status: "unassigned",
      payoutStatus: "pending"
    });

    try {
      // student_B tries to fund student_A's project
      await fundassignment.run({
        data: { projectId: "proj_owned" },
        auth: { uid: "student_B" }
      });
      throw new Error("Should have thrown permission-denied");
    } catch (e) {
      if (e.code !== "permission-denied") {
        throw new Error(`Expected 'permission-denied' but received '${e.code}': ${e.message}`);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 3. LEGITIMATE ESCROW FUNDING & AUDIT LOG GENERATION
  // ---------------------------------------------------------------------------
  await testCase(3, "Owner can fund assignment, locking escrow and generating audit record", async () => {
    await adminDb.collection("users").doc("student_A").set({
      uid: "student_A",
      role: "customer",
      displayName: "Alice",
      status: "active"
    });
    await adminDb.collection("assignments").doc("proj_fund_ok").set({
      id: "proj_fund_ok",
      customerId: "student_A",
      status: "unassigned",
      payoutStatus: "pending"
    });

    const res = await fundassignment.run({
      data: { projectId: "proj_fund_ok" },
      auth: { uid: "student_A" }
    });

    if (res.status !== "funded" || res.payoutStatus !== "escrowed") {
      throw new Error(`Unexpected return: ${JSON.stringify(res)}`);
    }

    const docSnap = await adminDb.collection("assignments").doc("proj_fund_ok").get();
    const data = docSnap.data();
    if (data.status !== "funded" || data.paymentStatus !== "paid" || data.payoutStatus !== "escrowed") {
      throw new Error(`Document status incorrect: ${JSON.stringify(data)}`);
    }

    // Verify Audit Log
    const auditSnap = await adminDb.collection("auditLogs").where("targetId", "==", "proj_fund_ok").get();
    if (auditSnap.empty) {
      throw new Error("No audit log generated for fundassignment!");
    }
    const audit = auditSnap.docs[0].data();
    if (audit.action !== "ASSIGNMENT_FUNDED" || audit.actorId !== "student_A") {
      throw new Error(`Audit log entry mismatch: ${JSON.stringify(audit)}`);
    }
  });

  // ---------------------------------------------------------------------------
  // 4. UNVERIFIED WRITER ROLE REJECTION
  // ---------------------------------------------------------------------------
  await testCase(4, "Unverified specialist cannot claim open assignment", async () => {
    await adminDb.collection("users").doc("unverified_writer").set({
      uid: "unverified_writer",
      role: "writer",
      verificationStatus: "pending_review",
      isVerifiedWriter: false,
      writerStatus: "inactive"
    });
    await adminDb.collection("assignments").doc("proj_claim_test").set({
      id: "proj_claim_test",
      customerId: "student_A",
      status: "awaiting_assignment",
      payoutStatus: "escrowed"
    });

    try {
      await claimassignment.run({
        data: { projectId: "proj_claim_test" },
        auth: { uid: "unverified_writer" }
      });
      throw new Error("Should have rejected unverified writer");
    } catch (e) {
      if (e.code !== "permission-denied") {
        throw new Error(`Expected 'permission-denied' but received '${e.code}': ${e.message}`);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 5. VERIFIED SPECIALIST CLAIMING & RACE CONDITION PREVENTED
  // ---------------------------------------------------------------------------
  await testCase(5, "Verified specialist can claim open assignment, blocking duplicate claims", async () => {
    await adminDb.collection("users").doc("verified_writer_1").set({
      uid: "verified_writer_1",
      role: "writer",
      displayName: "Bob Writer",
      verificationStatus: "approved",
      isVerifiedWriter: true,
      writerStatus: "active"
    });
    await adminDb.collection("users").doc("verified_writer_2").set({
      uid: "verified_writer_2",
      role: "writer",
      displayName: "Charlie Writer",
      verificationStatus: "approved",
      isVerifiedWriter: true,
      writerStatus: "active"
    });
    await adminDb.collection("assignments").doc("proj_claim_race").set({
      id: "proj_claim_race",
      customerId: "student_A",
      status: "awaiting_assignment",
      payoutStatus: "escrowed"
    });

    // Writer 1 claims successfully
    const res = await claimassignment.run({
      data: { projectId: "proj_claim_race" },
      auth: { uid: "verified_writer_1" }
    });
    if (res.status !== "assigned" || res.writerId !== "verified_writer_1") {
      throw new Error(`Unexpected claim response: ${JSON.stringify(res)}`);
    }

    // Writer 2 tries to claim the same assignment -> rejected!
    try {
      await claimassignment.run({
        data: { projectId: "proj_claim_race" },
        auth: { uid: "verified_writer_2" }
      });
      throw new Error("Second claim should have been rejected!");
    } catch (e) {
      if (e.code !== "already-exists" && e.code !== "failed-precondition") {
        throw new Error(`Expected 'already-exists' but received '${e.code}': ${e.message}`);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 6. SEPARATION OF DUTIES — ASSIGNED WRITER CANNOT AUDIT THEIR OWN WORK
  // ---------------------------------------------------------------------------
  await testCase(6, "Separation of duties: Assigned writer CANNOT claim proofread review of own work", async () => {
    // User is dual writer/proofreader
    await adminDb.collection("users").doc("dual_role_user").set({
      uid: "dual_role_user",
      role: "proofreader",
      verificationStatus: "approved",
      isVerifiedWriter: true,
      writerStatus: "active"
    });
    await adminDb.collection("assignments").doc("proj_duty_test").set({
      id: "proj_duty_test",
      customerId: "student_A",
      writerId: "dual_role_user", // Assigned writer is this user
      status: "draft_submitted"
    });

    try {
      await claimproofreadreview.run({
        data: { projectId: "proj_duty_test" },
        auth: { uid: "dual_role_user" }
      });
      throw new Error("Separation of duties should have blocked self-review!");
    } catch (e) {
      if (e.code !== "failed-precondition") {
        throw new Error(`Expected 'failed-precondition' but received '${e.code}': ${e.message}`);
      }
      if (!e.message.includes("Separation of duties")) {
        throw new Error(`Expected separation of duties message, got: ${e.message}`);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 7. SEPARATION OF DUTIES — ASSIGNED WRITER CANNOT APPROVE OWN COMPLETION
  // ---------------------------------------------------------------------------
  await testCase(7, "Separation of duties: Assigned writer CANNOT approve completion of own work", async () => {
    await adminDb.collection("users").doc("dual_role_user").set({
      uid: "dual_role_user",
      role: "proofreader",
      status: "active"
    });
    await adminDb.collection("assignments").doc("proj_self_complete").set({
      id: "proj_self_complete",
      customerId: "student_A",
      writerId: "dual_role_user",
      proofreaderId: "dual_role_user",
      status: "under_review",
      payoutStatus: "escrowed"
    });

    try {
      await completeassignment.run({
        data: { projectId: "proj_self_complete" },
        auth: { uid: "dual_role_user" }
      });
      throw new Error("Writer self-approval should have failed!");
    } catch (e) {
      if (e.code !== "failed-precondition") {
        throw new Error(`Expected 'failed-precondition', got: ${e.code}`);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 8. ESCROW RELEASE & REPUTATION INCREMENT ON AUTHORIZED APPROVAL
  // ---------------------------------------------------------------------------
  await testCase(8, "Authorized proofreader completes assignment, releasing escrow and updating writer stats", async () => {
    await adminDb.collection("users").doc("independent_proofreader").set({
      uid: "independent_proofreader",
      role: "proofreader",
      displayName: "Patty Proofreader",
      status: "active"
    });
    await adminDb.collection("users").doc("worker_writer").set({
      uid: "worker_writer",
      role: "writer",
      completedCount: 5,
      completedAssignments: 5,
      status: "active"
    });
    await adminDb.collection("assignments").doc("proj_payout_release").set({
      id: "proj_payout_release",
      customerId: "student_A",
      writerId: "worker_writer",
      proofreaderId: "independent_proofreader",
      status: "under_review",
      payoutStatus: "escrowed"
    });

    const res = await completeassignment.run({
      data: { projectId: "proj_payout_release" },
      auth: { uid: "independent_proofreader" }
    });

    if (res.status !== "completed" || res.payoutStatus !== "released") {
      throw new Error(`Unexpected completion return: ${JSON.stringify(res)}`);
    }

    // Check assignment document
    const projSnap = await adminDb.collection("assignments").doc("proj_payout_release").get();
    const projData = projSnap.data();
    if (projData.status !== "completed" || projData.payoutStatus !== "released") {
      throw new Error(`Assignment not released: ${JSON.stringify(projData)}`);
    }

    // Check writer document stats incremented
    const writerSnap = await adminDb.collection("users").doc("worker_writer").get();
    const writerData = writerSnap.data();
    if (writerData.completedCount !== 6 || writerData.completedAssignments !== 6) {
      throw new Error(`Writer completedCount not incremented: ${JSON.stringify(writerData)}`);
    }
  });

  // ---------------------------------------------------------------------------
  // 9. IDEMPOTENCY / PREVENTING DUPLICATE COMPLETION REQUESTS
  // ---------------------------------------------------------------------------
  await testCase(9, "Duplicate completion request is rejected (idempotency guard)", async () => {
    await adminDb.collection("users").doc("independent_proofreader").set({
      uid: "independent_proofreader",
      role: "proofreader",
      status: "active"
    });
    await adminDb.collection("assignments").doc("proj_already_done").set({
      id: "proj_already_done",
      customerId: "student_A",
      writerId: "worker_writer",
      proofreaderId: "independent_proofreader",
      status: "completed",
      payoutStatus: "released"
    });

    try {
      // Calling completeassignment when already completed
      await completeassignment.run({
        data: { projectId: "proj_already_done" },
        auth: { uid: "independent_proofreader" }
      });
      throw new Error("Should have rejected duplicate completion!");
    } catch (e) {
      if (e.code !== "failed-precondition") {
        throw new Error(`Expected 'failed-precondition', got: ${e.code}`);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // 10. RESEARCH QUOTE MANAGEMENT & ESCROW WORKFLOW
  // ---------------------------------------------------------------------------
  await testCase(10, "Research quotation, acceptance, and escrow funding flow securely", async () => {
    await adminDb.collection("users").doc("admin_gov").set({
      uid: "admin_gov",
      role: "admin",
      status: "active"
    });
    await adminDb.collection("users").doc("research_student").set({
      uid: "research_student",
      role: "customer",
      status: "active"
    });
    await adminDb.collection("researchRequests").doc("res_pipeline").set({
      id: "res_pipeline",
      studentId: "research_student",
      status: "submitted",
      quoteAmount: null,
      quoteStatus: null
    });

    // 1. Non-admin cannot submit quote
    try {
      await submitresearchquote.run({
        data: { requestId: "res_pipeline", amount: 450, notes: "Admin quote" },
        auth: { uid: "research_student" }
      });
      throw new Error("Student should not be able to issue quote!");
    } catch (e) {
      if (e.code !== "permission-denied") {
        throw new Error(`Expected 'permission-denied', got ${e.code}`);
      }
    }

    // 2. Admin issues quote
    await submitresearchquote.run({
      data: { requestId: "res_pipeline", amount: 450, notes: "Admin quote" },
      auth: { uid: "admin_gov" }
    });
    let reqSnap = await adminDb.collection("researchRequests").doc("res_pipeline").get();
    if (reqSnap.data().quoteAmount !== 450 || reqSnap.data().status !== "quote_ready") {
      throw new Error(`Quote was not set properly: ${JSON.stringify(reqSnap.data())}`);
    }

    // 3. Student accepts quote
    await respondresearchquote.run({
      data: { requestId: "res_pipeline", accepted: true },
      auth: { uid: "research_student" }
    });
    reqSnap = await adminDb.collection("researchRequests").doc("res_pipeline").get();
    if (reqSnap.data().quoteStatus !== "accepted" || reqSnap.data().status !== "awaiting_payment") {
      throw new Error(`Student response failed: ${JSON.stringify(reqSnap.data())}`);
    }

    // 4. Student funds research request
    await fundresearchrequest.run({
      data: { requestId: "res_pipeline" },
      auth: { uid: "research_student" }
    });
    reqSnap = await adminDb.collection("researchRequests").doc("res_pipeline").get();
    if (reqSnap.data().status !== "funded" || reqSnap.data().paymentStatus !== "paid") {
      throw new Error(`Funding failed: ${JSON.stringify(reqSnap.data())}`);
    }
  });

  // ---------------------------------------------------------------------------
  // 11. ADMINISTRATIVE APPROVAL & SUSPENSION GOVERNANCE
  // ---------------------------------------------------------------------------
  await testCase(11, "Administrator can approve specialist and suspend malicious account", async () => {
    await adminDb.collection("users").doc("admin_gov").set({
      uid: "admin_gov",
      role: "admin",
      status: "active"
    });
    await adminDb.collection("users").doc("pending_applicant").set({
      uid: "pending_applicant",
      role: "writer",
      verificationStatus: "pending_review",
      writerStatus: "inactive",
      isVerifiedWriter: false,
      status: "active"
    });

    // Admin approves writer
    await adminapprovewriter.run({
      data: { targetUid: "pending_applicant" },
      auth: { uid: "admin_gov" }
    });
    let userSnap = await adminDb.collection("users").doc("pending_applicant").get();
    if (userSnap.data().verificationStatus !== "approved" || userSnap.data().isVerifiedWriter !== true) {
      throw new Error(`Approval failed: ${JSON.stringify(userSnap.data())}`);
    }

    // Admin suspends user
    await adminsuspenduser.run({
      data: { targetUid: "pending_applicant", reason: "Fraud investigation" },
      auth: { uid: "admin_gov" }
    });
    userSnap = await adminDb.collection("users").doc("pending_applicant").get();
    if (userSnap.data().status !== "suspended") {
      throw new Error(`Suspension failed: ${JSON.stringify(userSnap.data())}`);
    }
  });

  console.log("\n================================================================================");
  console.log("TEST EXECUTION SUMMARY");
  console.log("================================================================================");
  const passed = results.filter(r => r.status === "PASSED").length;
  const failed = results.filter(r => r.status === "FAILED").length;
  console.log(`Total Scenarios: ${results.length} | Passed: ${passed} | Failed: ${failed}`);

  if (failed > 0) {
    console.error("FAILURES DETECTED IN CLOUD FUNCTIONS SUITE:");
    results.filter(r => r.status === "FAILED").forEach(f => {
      console.error(`- Test ${f.number}: ${f.title} => ${f.error}`);
    });
    process.exit(1);
  } else {
    console.log("ALL 11 BACKEND & CLOUD FUNCTION SUITE SCENARIOS PASSED WITH ZERO FAILURES.");
    process.exit(0);
  }
}

runCloudFunctionTests().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
