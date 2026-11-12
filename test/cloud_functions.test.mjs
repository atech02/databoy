import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Ensure Firebase Admin is pointing to local emulator
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
const PROJECT_ID = process.env.GCLOUD_PROJECT || "databoy-dev";
process.env.GCLOUD_PROJECT = PROJECT_ID;

// Import all exports from functions/index.js
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
  adminsuspenduser,
  processocrjob
} = await import("../functions/index.js");

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

async function expectHttpsError(promise, expectedCode, testName) {
  try {
    await promise;
    throw new Error(`Expected failure with [${expectedCode}] for ${testName}, but succeeded.`);
  } catch (err) {
    if (err.code !== expectedCode) {
      throw new Error(`Expected HttpsError code [${expectedCode}] for ${testName}, got [${err.code || err.message}]`);
    }
  }
}

async function runCloudFunctionTests() {
  console.log("================================================================================");
  console.log("DATABOY CLOUD FUNCTIONS DECOMMISSIONING & AUDIT-02 SECURITY VERIFICATION");
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
  // 1. UNAUTHENTICATED REJECTION ACROSS DECOMMISSIONED CALLABLES
  // ---------------------------------------------------------------------------
  await testCase(1, "Unauthenticated calls to decommissioned callables are rejected with 'unauthenticated'", async () => {
    await expectHttpsError(
      fundassignment.run({ data: { projectId: "asg_unauth" }, auth: null }),
      "unauthenticated",
      "fundassignment"
    );
    await expectHttpsError(
      claimassignment.run({ data: { projectId: "asg_unauth" }, auth: null }),
      "unauthenticated",
      "claimassignment"
    );
    await expectHttpsError(
      completeassignment.run({ data: { projectId: "asg_unauth" }, auth: null }),
      "unauthenticated",
      "completeassignment"
    );
    await expectHttpsError(
      assignresearchwriter.run({ data: { requestId: "res_unauth", writerId: "w1" }, auth: null }),
      "unauthenticated",
      "assignresearchwriter"
    );
    await expectHttpsError(
      adminapprovewriter.run({ data: { targetUid: "w1" }, auth: null }),
      "unauthenticated",
      "adminapprovewriter"
    );
  });

  // ---------------------------------------------------------------------------
  // 2. AUDIT-02: LEGACY FUNDING CALLABLES FAIL CLOSED WITH ZERO MUTATION
  // ---------------------------------------------------------------------------
  await testCase(2, "Decommissioned fundassignment & fundresearchrequest fail closed with zero mutation", async () => {
    await adminDb.collection("users").doc("cust_1").set({ uid: "cust_1", role: "customer", status: "active" });
    await adminDb.collection("assignments").doc("asg_1").set({
      id: "asg_1",
      customerId: "cust_1",
      status: "awaiting_payment",
      paymentStatus: "awaiting_payment",
      escrowStatus: "pending_funding",
      payoutStatus: "pending",
    });
    await adminDb.collection("researchRequests").doc("res_1").set({
      id: "res_1",
      studentId: "cust_1",
      status: "awaiting_payment",
      paymentStatus: "awaiting_payment",
      quoteAmount: 500,
    });

    await expectHttpsError(
      fundassignment.run({ data: { projectId: "asg_1" }, auth: { uid: "cust_1" } }),
      "failed-precondition",
      "fundassignment"
    );
    await expectHttpsError(
      fundresearchrequest.run({ data: { requestId: "res_1" }, auth: { uid: "cust_1" } }),
      "failed-precondition",
      "fundresearchrequest"
    );

    const asgAfter = (await adminDb.collection("assignments").doc("asg_1").get()).data();
    const resAfter = (await adminDb.collection("researchRequests").doc("res_1").get()).data();
    if (asgAfter.status !== "awaiting_payment" || asgAfter.paymentStatus !== "awaiting_payment") {
      throw new Error(`fundassignment mutated state unexpectedly: ${JSON.stringify(asgAfter)}`);
    }
    if (resAfter.status !== "awaiting_payment" || resAfter.paymentStatus !== "awaiting_payment") {
      throw new Error(`fundresearchrequest mutated state unexpectedly: ${JSON.stringify(resAfter)}`);
    }
  });

  // ---------------------------------------------------------------------------
  // 3. AUDIT-02: LEGACY ASSIGNMENT WORKFLOW CALLABLES FAIL CLOSED
  // ---------------------------------------------------------------------------
  await testCase(3, "Decommissioned claimassignment fails closed even for verified writers (zero mutation)", async () => {
    await adminDb.collection("users").doc("writer_1").set({
      uid: "writer_1",
      role: "writer",
      verificationStatus: "approved",
      writerStatus: "active",
      isVerifiedWriter: true,
      status: "active",
    });
    await adminDb.collection("assignments").doc("asg_claim").set({
      id: "asg_claim",
      customerId: "cust_1",
      status: "funded",
      writerId: null,
      payoutStatus: "escrowed",
    });

    await expectHttpsError(
      claimassignment.run({ data: { projectId: "asg_claim" }, auth: { uid: "writer_1" } }),
      "failed-precondition",
      "claimassignment"
    );

    const snap = await adminDb.collection("assignments").doc("asg_claim").get();
    if (snap.data().status !== "funded" || snap.data().writerId !== null) {
      throw new Error(`claimassignment unexpectedly mutated assignment: ${JSON.stringify(snap.data())}`);
    }
  });

  await testCase(4, "Decommissioned submitassignmentdraft, claimproofreadreview, rejectproofreadreview fail closed", async () => {
    await adminDb.collection("users").doc("writer_1").set({
      uid: "writer_1",
      role: "writer",
      verificationStatus: "approved",
      writerStatus: "active",
      isVerifiedWriter: true,
    });
    await adminDb.collection("users").doc("rev_1").set({
      uid: "rev_1",
      role: "proofreader",
      verificationStatus: "approved",
      writerStatus: "active",
      isVerifiedWriter: true,
    });
    await adminDb.collection("assignments").doc("asg_wf").set({
      id: "asg_wf",
      customerId: "cust_1",
      writerId: "writer_1",
      status: "assigned",
      payoutStatus: "escrowed",
    });

    await expectHttpsError(
      submitassignmentdraft.run({ data: { projectId: "asg_wf", files: [] }, auth: { uid: "writer_1" } }),
      "failed-precondition",
      "submitassignmentdraft"
    );
    await expectHttpsError(
      claimproofreadreview.run({ data: { projectId: "asg_wf" }, auth: { uid: "rev_1" } }),
      "failed-precondition",
      "claimproofreadreview"
    );
    await expectHttpsError(
      rejectproofreadreview.run({ data: { projectId: "asg_wf", reason: "Fix" }, auth: { uid: "rev_1" } }),
      "failed-precondition",
      "rejectproofreadreview"
    );

    const snap = await adminDb.collection("assignments").doc("asg_wf").get();
    if (snap.data().status !== "assigned" || snap.data().proofreaderId) {
      throw new Error(`Workflow callable unexpectedly mutated assignment: ${JSON.stringify(snap.data())}`);
    }
  });

  await testCase(5, "Decommissioned completeassignment & cancelassignment fail closed (zero wallet or payout mutation)", async () => {
    await adminDb.collection("users").doc("rev_1").set({
      uid: "rev_1",
      role: "proofreader",
      verificationStatus: "approved",
      writerStatus: "active",
      isVerifiedWriter: true,
    });
    await adminDb.collection("users").doc("writer_2").set({
      uid: "writer_2",
      role: "writer",
      availableBalance: 0,
      completedCount: 0,
    });
    await adminDb.collection("users").doc("admin_1").set({
      uid: "admin_1",
      role: "admin",
      status: "active",
    });
    await adminDb.collection("assignments").doc("asg_comp").set({
      id: "asg_comp",
      customerId: "cust_1",
      writerId: "writer_2",
      proofreaderId: "rev_1",
      status: "under_review",
      payoutStatus: "escrowed",
      budget: 600,
    });

    await expectHttpsError(
      completeassignment.run({ data: { projectId: "asg_comp" }, auth: { uid: "rev_1" } }),
      "failed-precondition",
      "completeassignment"
    );
    await expectHttpsError(
      cancelassignment.run({ data: { projectId: "asg_comp", reason: "Cancel" }, auth: { uid: "admin_1" } }),
      "failed-precondition",
      "cancelassignment"
    );

    const asgAfter = (await adminDb.collection("assignments").doc("asg_comp").get()).data();
    const writerAfter = (await adminDb.collection("users").doc("writer_2").get()).data();
    if (asgAfter.status !== "under_review" || asgAfter.payoutStatus !== "escrowed" || writerAfter.availableBalance !== 0) {
      throw new Error(`complete/cancel mutated state: asg=${JSON.stringify(asgAfter)} writer=${JSON.stringify(writerAfter)}`);
    }
  });

  // ---------------------------------------------------------------------------
  // 4. AUDIT-02: LEGACY RESEARCH & ADMIN CALLABLES FAIL CLOSED
  // ---------------------------------------------------------------------------
  await testCase(6, "Decommissioned submitresearchquote, respondresearchquote, assignresearchwriter fail closed", async () => {
    await adminDb.collection("users").doc("admin_r").set({ uid: "admin_r", role: "admin", status: "active" });
    await adminDb.collection("users").doc("cust_r").set({ uid: "cust_r", role: "customer", status: "active" });
    await adminDb.collection("users").doc("writer_r").set({ uid: "writer_r", role: "writer", verificationStatus: "approved", writerStatus: "active", isVerifiedWriter: true });
    await adminDb.collection("researchRequests").doc("res_legacy").set({
      id: "res_legacy",
      studentId: "cust_r",
      status: "funded",
      quoteAmount: 450,
      assignedWriterId: null,
    });

    await expectHttpsError(
      submitresearchquote.run({ data: { requestId: "res_legacy", amount: 900, notes: "Quote" }, auth: { uid: "admin_r" } }),
      "failed-precondition",
      "submitresearchquote"
    );
    await expectHttpsError(
      respondresearchquote.run({ data: { requestId: "res_legacy", accepted: true }, auth: { uid: "cust_r" } }),
      "failed-precondition",
      "respondresearchquote"
    );
    await expectHttpsError(
      assignresearchwriter.run({ data: { requestId: "res_legacy", writerId: "writer_r" }, auth: { uid: "admin_r" } }),
      "failed-precondition",
      "assignresearchwriter"
    );

    const snap = await adminDb.collection("researchRequests").doc("res_legacy").get();
    if (snap.data().status !== "funded" || snap.data().assignedWriterId !== null || snap.data().quoteAmount !== 450) {
      throw new Error(`Research callable unexpectedly mutated doc: ${JSON.stringify(snap.data())}`);
    }
  });

  await testCase(7, "Decommissioned adminapprovewriter & adminsuspenduser fail closed even for admin callers", async () => {
    await adminDb.collection("users").doc("admin_gov").set({ uid: "admin_gov", role: "admin", status: "active" });
    await adminDb.collection("users").doc("pending_applicant").set({
      uid: "pending_applicant",
      role: "customer",
      verificationStatus: "pending_review",
      isVerifiedWriter: false,
      status: "active",
    });

    await expectHttpsError(
      adminapprovewriter.run({ data: { targetUid: "pending_applicant" }, auth: { uid: "admin_gov" } }),
      "failed-precondition",
      "adminapprovewriter"
    );
    await expectHttpsError(
      adminsuspenduser.run({ data: { targetUid: "pending_applicant", reason: "Suspend" }, auth: { uid: "admin_gov" } }),
      "failed-precondition",
      "adminsuspenduser"
    );

    const userSnap = await adminDb.collection("users").doc("pending_applicant").get();
    if (userSnap.data().verificationStatus !== "pending_review" || userSnap.data().status !== "active" || userSnap.data().isVerifiedWriter !== false) {
      throw new Error(`Admin callable unexpectedly mutated user doc: ${JSON.stringify(userSnap.data())}`);
    }
  });

  await testCase(8, "Non-workflow background OCR trigger processocrjob remains exported", async () => {
    if (!processocrjob) {
      throw new Error("Expected processocrjob Firestore trigger to remain exported.");
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
    console.log(`ALL ${results.length} CLOUD FUNCTION AUDIT-02 SCENARIOS PASSED WITH ZERO FAILURES.`);
    process.exit(0);
  }
}

runCloudFunctionTests().catch((err) => {
  console.error("Fatal test runner error:", err);
  process.exit(1);
});
