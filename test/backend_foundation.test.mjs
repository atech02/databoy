import http from "http";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  calculateAssignmentPricing,
  calculateCommissionBreakdown,
  wordsToPages,
  calculateDaysUntilDeadline,
} from "../backend/dist/services/pricingEngine.js";
import { createApp } from "../backend/dist/app.js";
import { createNotification } from "../backend/dist/services/notificationService.js";
import { lipilaService } from "../backend/dist/services/lipilaService.js";
import { generateTestWebhookHeaders } from "../backend/dist/services/webhookAuth.js";
import { runMigration } from "../scripts/migrate_proofreaders.mjs";

process.env.NODE_ENV = "test";
process.env.ALLOW_TEST_AUTH = "true";
process.env.LIPILA_MOCK = "true";
process.env.RATE_LIMIT_ENABLED = "false";
process.env.LIPILA_WEBHOOK_SECRET = "whsec_dGVzdF9saXBpbGFfd2ViaG9va19zZWNyZXRfa2V5XzEyMzQ1Njc4OTA=";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
const PROJECT_ID = process.env.GCLOUD_PROJECT || "databoy-dev";
process.env.GCLOUD_PROJECT = PROJECT_ID;

if (getApps().length === 0) {
  initializeApp({ projectId: PROJECT_ID });
}
const adminDb = getFirestore();

// Helper to clear collections in emulator
async function clearCollections(cols) {
  for (const col of cols) {
    const snap = await adminDb.collection(col).get();
    const batch = adminDb.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

// Helper to make HTTP requests against local Express app
function makeRequest(server, options, body = null) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const port = address.port;

    const reqOptions = {
      hostname: "127.0.0.1",
      port,
      path: options.path,
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
    };

    const req = http.request(reqOptions, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let json;
        try {
          json = JSON.parse(data);
        } catch {
          json = data;
        }
        resolve({ status: res.statusCode, body: json, headers: res.headers });
      });
    });

    req.on("error", reject);

    if (body) {
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function fundViaLipila(server, targetBody, token, amount, accountNumber = "260977123456") {
  const initRes = await makeRequest(
    server,
    {
      path: "/api/payments/initiate",
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    },
    {
      ...targetBody,
      network: "airtel_money",
      phoneNumber: "0977123456",
    }
  );
  if (initRes.status !== 200 || !initRes.body.referenceId) {
    throw new Error(`Lipila initiate failed: ${initRes.status} ${JSON.stringify(initRes.body)}`);
  }
  const referenceId = initRes.body.referenceId;
  lipilaService.setMockStatus(referenceId, "Successful", {
    amount,
    currency: "ZMW",
    type: "Collection",
    paymentType: "AirtelMoney",
    accountNumber,
  });
  const payload = { referenceId, status: "Successful", type: "Collection" };
  const { rawBody, headers } = generateTestWebhookHeaders(payload);
  const cbRes = await makeRequest(
    server,
    {
      path: "/api/payments/lipila-callback",
      method: "POST",
      headers,
    },
    rawBody
  );
  return { referenceId, initRes, cbRes, rawBody, headers };
}

async function runTestSuite() {
  console.log("================================================================================");
  console.log("DATABOY PHASE 2 — BACKEND FOUNDATION & SECURITY REMEDIATION TEST SUITE");
  console.log("Targeting local Firestore Emulator at 127.0.0.1:8080");
  console.log("================================================================================\n");

  const app = createApp();
  const server = http.createServer(app);
  await new Promise((res) => server.listen(0, "127.0.0.1", res));

  const results = [];

  async function executeTest(number, name, fn) {
    process.stdout.write(`Test ${number}: ${name} ... `);
    try {
      await clearCollections(["assignments", "users", "researchRequests", "auditLogs", "notifications", "ocrJobs", "payments", "paymentLocks", "processedWebhooks", "ledger"]);
      await fn();
      console.log("PASSED [✓]");
      results.push({ number, name, status: "PASSED" });
    } catch (err) {
      console.log(`FAILED [✗]\n  -> Error: ${err.message}`);
      results.push({ number, name, status: "FAILED", error: err.message });
    }
  }

  try {
    // --------------------------------------------------------------------------
    // TEST 1: Server-Side Pricing Engine Formulas & Multipliers
    // --------------------------------------------------------------------------
    await executeTest(1, "Deterministic Pricing Calculation & Commission Distribution", async () => {
      // 4 pages, degree (28 ZMW), 8 days out (1.0 urgency), assignment (1.0)
      const p1 = calculateAssignmentPricing(4, "degree", 8, "assignment");
      if (p1.subtotal !== 112) throw new Error(`Expected subtotal 112, got ${p1.subtotal}`);
      if (p1.total !== 112) throw new Error(`Expected total 112, got ${p1.total}`);

      // 4 pages, degree (28 ZMW), 1 day out (2.1 urgency), report (1.1)
      // subtotal = 112, total = ceil(112 * 2.1 * 1.1) = ceil(258.72) = 259
      const p2 = calculateAssignmentPricing(4, "degree", 1, "report");
      if (p2.total !== 259) throw new Error(`Expected total 259, got ${p2.total}`);

      // Commission distribution on 200 ZMW:
      // writer = 100 (50%), proofreader = 33.34 (16.67%), databoy = 66.66 (33.33%)
      const comm = calculateCommissionBreakdown(200);
      if (comm.writer !== 100) throw new Error(`Expected writer commission 100, got ${comm.writer}`);
      if (comm.proofreader !== 33.34) throw new Error(`Expected proofreader 33.34, got ${comm.proofreader}`);
      if (comm.databoy !== 66.66) throw new Error(`Expected databoy 66.66, got ${comm.databoy}`);

      // Word count to pages
      if (wordsToPages(750) !== 3) throw new Error("Expected 750 words to be 3 pages");
      if (wordsToPages(100) !== 1) throw new Error("Expected 100 words to be 1 page");
    });

    // --------------------------------------------------------------------------
    // TEST 2: Client-Side Budget Tampering Prevention (C-1)
    // --------------------------------------------------------------------------
    await executeTest(2, "Rejects Client-Sent Budget & Computes Authoritative Server Pricing", async () => {
      // Setup customer in Firestore
      await adminDb.collection("users").doc("cust_1").set({
        uid: "cust_1",
        email: "cust1@test.com",
        role: "customer",
        status: "active",
      });

      // Customer tries to create assignment with maliciously tampered budget: 1 ZMW!
      const rejectedRes = await makeRequest(
        server,
        {
          path: "/api/assignments",
          method: "POST",
          headers: { Authorization: "Bearer test-token:cust_1:customer:cust1@test.com" },
        },
        {
          title: "Network Security Research",
          description: "Detailed assignment on network protocols",
          academicLevel: "degree",
          deadline: "2026-12-01",
          pageCount: 5,
          budget: 1, // Tampered input!
          writerCommission: 0.5,
        }
      );

      if (rejectedRes.status !== 400 || rejectedRes.body?.code !== "FORBIDDEN_FINANCIAL_OR_STATE_FIELDS") {
        throw new Error(`Expected 400 FORBIDDEN_FINANCIAL_OR_STATE_FIELDS, got ${rejectedRes.status}: ${JSON.stringify(rejectedRes.body)}`);
      }

      // Clean submission without client financial fields is priced authoritatively on server
      const res = await makeRequest(
        server,
        {
          path: "/api/assignments",
          method: "POST",
          headers: { Authorization: "Bearer test-token:cust_1:customer:cust1@test.com" },
        },
        {
          title: "Network Security Research",
          description: "Detailed assignment on network protocols",
          academicLevel: "degree",
          deadline: "2026-12-01",
          pageCount: 5,
        }
      );

      if (res.status !== 201) throw new Error(`Expected 201, got ${res.status}: ${JSON.stringify(res.body)}`);

      // Verify Firestore project document
      const assignmentDoc = await adminDb.collection("assignments").doc(res.body.assignmentId).get();
      const proj = assignmentDoc.data();

      // 5 pages * 28 ZMW * 1.0 * 1.0 = 140 ZMW
      if (proj.budget !== 140) {
        throw new Error(`Expected server-calculated 140, got ${proj.budget}`);
      }
      if (proj.writerCommission !== 70) {
        throw new Error(`Expected writer commission 70, got ${proj.writerCommission}`);
      }
      if (proj.proofreaderCommission !== 23.34) {
        throw new Error(`Expected proofreader commission 23.34, got ${proj.proofreaderCommission}`);
      }
      if (proj.source !== "server_priced") {
        throw new Error(`Expected source='server_priced', got ${proj.source}`);
      }
    });

    // --------------------------------------------------------------------------
    // TEST 3: Lipila Funding & Decommissioned /fund Endpoint Blocking
    // --------------------------------------------------------------------------
    await executeTest(3, "Idempotent Assignment Funding via Lipila & Blocked /fund Bypass", async () => {
      await adminDb.collection("users").doc("cust_1").set({
        uid: "cust_1",
        email: "cust1@test.com",
        role: "customer",
        status: "active",
      });

      await adminDb.collection("assignments").doc("proj_fund_1").set({
        id: "proj_fund_1",
        customerId: "cust_1",
        title: "Database Systems Project",
        budget: 200,
        currency: "ZMW",
        status: "awaiting_payment",
        paymentStatus: "awaiting_payment",
        statusHistory: [],
      });

      // Legacy /fund endpoint must be permanently rejected (403)
      const legacyRes = await makeRequest(
        server,
        {
          path: "/api/assignments/proj_fund_1/fund",
          method: "POST",
          headers: { Authorization: "Bearer test-token:cust_1:customer:cust1@test.com" },
        },
        {}
      );
      if (legacyRes.status !== 403) {
        throw new Error(`Expected 403 for disabled /fund bypass, got ${legacyRes.status}: ${JSON.stringify(legacyRes.body)}`);
      }

      // 1st authoritative Lipila collection + signed webhook reconciliation
      const { cbRes, rawBody } = await fundViaLipila(
        server,
        { assignmentId: "proj_fund_1" },
        "test-token:cust_1:customer:cust1@test.com",
        200
      );
      if (cbRes.status !== 200 || cbRes.body.status !== "Successful") {
        throw new Error(`Expected 200 Successful, got ${cbRes.status}: ${JSON.stringify(cbRes.body)}`);
      }

      // Duplicate initiation after funded must be rejected
      const dupInitRes = await makeRequest(
        server,
        {
          path: "/api/payments/initiate",
          method: "POST",
          headers: { Authorization: "Bearer test-token:cust_1:customer:cust1@test.com" },
        },
        { assignmentId: "proj_fund_1", network: "airtel_money", phoneNumber: "0977123456" }
      );
      if (dupInitRes.status !== 400 || !dupInitRes.body.error?.includes("already funded")) {
        throw new Error(`Expected duplicate initiation rejection, got ${dupInitRes.status}: ${JSON.stringify(dupInitRes.body)}`);
      }

      // Verify status in DB is clean
      const docSnap = await adminDb.collection("assignments").doc("proj_fund_1").get();
      if (docSnap.data().status !== "funded" || !rawBody) throw new Error("Status corrupted");
    });

    // --------------------------------------------------------------------------
    // TEST 4: Separation of Duties (Allocated Writer cannot review own work)
    // --------------------------------------------------------------------------
    await executeTest(4, "Separation of Duties in Review Claim (Writer != Reviewer)", async () => {
      // Writer 1 has proofreading capability
      await adminDb.collection("users").doc("writer_dual_1").set({
        uid: "writer_dual_1",
        email: "writerdual@test.com",
        role: "writer",
        canProofread: true,
        specialistCapabilities: ["writing", "proofreading"],
        status: "active",
      });

      // Writer 2 also has proofreading capability
      await adminDb.collection("users").doc("writer_dual_2").set({
        uid: "writer_dual_2",
        email: "writerdual2@test.com",
        role: "writer",
        canProofread: true,
        specialistCapabilities: ["writing", "proofreading"],
        status: "active",
      });

      // Project assigned to Writer 1 and submitted for review
      await adminDb.collection("assignments").doc("proj_review_1").set({
        id: "proj_review_1",
        customerId: "cust_1",
        writerId: "writer_dual_1",
        proofreaderId: null,
        title: "Calculus Assignment",
        status: "under_review",
        budget: 150,
      });

      // ATTEMPT 1: Writer 1 attempts to claim review on their OWN assignment!
      const res1 = await makeRequest(
        server,
        {
          path: "/api/assignments/proj_review_1/claim-review",
          method: "POST",
          headers: { Authorization: "Bearer test-token:writer_dual_1:writer:writerdual@test.com" },
        },
        {}
      );

      if (res1.status !== 403) {
        throw new Error(`Expected 403 Forbidden for separation of duties, got ${res1.status}`);
      }

      // ATTEMPT 2: Writer 2 claims review on Writer 1's assignment (Independent Review)
      const res2 = await makeRequest(
        server,
        {
          path: "/api/assignments/proj_review_1/claim-review",
          method: "POST",
          headers: { Authorization: "Bearer test-token:writer_dual_2:writer:writerdual2@test.com" },
        },
        {}
      );

      if (res2.status !== 200) {
        throw new Error(`Expected 200 for independent reviewer, got ${res2.status}: ${JSON.stringify(res2.body)}`);
      }

      const snap = await adminDb.collection("assignments").doc("proj_review_1").get();
      if (snap.data().proofreaderId !== "writer_dual_2") {
        throw new Error("Proofreader ID was not updated properly");
      }
    });

    // --------------------------------------------------------------------------
    // TEST 5: Proofreading Specialist Capability Enforcement
    // --------------------------------------------------------------------------
    await executeTest(5, "Writer Without Proofreading Capability Cannot Claim Reviews", async () => {
      // Standard writer without proofreading certification
      await adminDb.collection("users").doc("writer_standard").set({
        uid: "writer_standard",
        email: "standard@test.com",
        role: "writer",
        canProofread: false,
        specialistCapabilities: ["writing"],
        status: "active",
      });

      await adminDb.collection("assignments").doc("proj_review_2").set({
        id: "proj_review_2",
        customerId: "cust_1",
        writerId: "other_writer",
        proofreaderId: null,
        status: "under_review",
        budget: 100,
      });

      const res = await makeRequest(
        server,
        {
          path: "/api/assignments/proj_review_2/claim-review",
          method: "POST",
          headers: { Authorization: "Bearer test-token:writer_standard:writer:standard@test.com" },
        },
        {}
      );

      if (res.status !== 403) {
        throw new Error(`Expected 403 for missing proofreading capability, got ${res.status}`);
      }
    });

    // --------------------------------------------------------------------------
    // TEST 6: Suspended Account Security Enforcement
    // --------------------------------------------------------------------------
    await executeTest(6, "Suspended User Accounts Are Denied Access", async () => {
      await adminDb.collection("users").doc("suspended_user").set({
        uid: "suspended_user",
        email: "baduser@test.com",
        role: "customer",
        status: "suspended",
      });

      const res = await makeRequest(
        server,
        {
          path: "/api/assignments",
          method: "POST",
          headers: { Authorization: "Bearer test-token:suspended_user:customer:baduser@test.com" },
        },
        { title: "Test", description: "test test test", deadline: "2026-12-01" }
      );

      if (res.status !== 403) {
        throw new Error(`Expected 403 Forbidden for suspended account, got ${res.status}`);
      }
    });

    // --------------------------------------------------------------------------
    // TEST 7: Research Quotation & Funding Workflow
    // --------------------------------------------------------------------------
    await executeTest(7, "End-to-End Research Quotation, Acceptance, and Funding", async () => {
      await adminDb.collection("users").doc("research_cust").set({
        uid: "research_cust",
        email: "rcust@test.com",
        role: "customer",
        status: "active",
      });

      await adminDb.collection("users").doc("admin_user").set({
        uid: "admin_user",
        email: "admin@databoy.com",
        role: "admin",
        status: "active",
      });

      // 1. Customer submits research request
      const res1 = await makeRequest(
        server,
        {
          path: "/api/research",
          method: "POST",
          headers: { Authorization: "Bearer test-token:research_cust:customer:rcust@test.com" },
        },
        {
          title: "Dissertation on Machine Learning in Health",
          requestTypes: ["proposal_writing", "literature_review"],
          pastedBrief: "Comprehensive research proposal on ML models for diagnostics",
          expectedDeliverable: "30-page research proposal document",
          deadline: "2026-12-15",
        }
      );

      if (res1.status !== 201) throw new Error(`Submit failed: ${res1.status}`);
      const requestId = res1.body.requestId;

      // 2. Admin provides quotation of 1,200 ZMW
      const res2 = await makeRequest(
        server,
        {
          path: `/api/research/${requestId}/quote`,
          method: "POST",
          headers: { Authorization: "Bearer test-token:admin_user:admin:admin@databoy.com" },
        },
        { quoteAmount: 1200, quoteNotes: "Senior research specialist required" }
      );

      if (res2.status !== 200 || res2.body.quoteAmount !== 1200) {
        throw new Error(`Quote failed: ${res2.status}`);
      }

      // 3. Customer accepts quote
      const res3 = await makeRequest(
        server,
        {
          path: `/api/research/${requestId}/respond-quote`,
          method: "POST",
          headers: { Authorization: "Bearer test-token:research_cust:customer:rcust@test.com" },
        },
        { accept: true }
      );

      if (res3.status !== 200 || res3.body.status !== "awaiting_payment") {
        throw new Error(`Respond failed: ${res3.status}`);
      }

      // 4. Legacy /fund endpoint must reject (403); fund research quote via Lipila instead
      const legacyRes4 = await makeRequest(
        server,
        {
          path: `/api/research/${requestId}/fund`,
          method: "POST",
          headers: { Authorization: "Bearer test-token:research_cust:customer:rcust@test.com" },
        },
        {}
      );
      if (legacyRes4.status !== 403) {
        throw new Error(`Expected 403 for disabled research /fund bypass, got ${legacyRes4.status}`);
      }

      const { cbRes } = await fundViaLipila(
        server,
        { researchRequestId: requestId },
        "test-token:research_cust:customer:rcust@test.com",
        1200
      );
      if (cbRes.status !== 200 || cbRes.body.status !== "Successful") {
        throw new Error(`Research Lipila funding failed: ${cbRes.status}`);
      }

      const fundedSnap = await adminDb.collection("researchRequests").doc(requestId).get();
      if (fundedSnap.data().status !== "funded") {
        throw new Error(`Expected research request status funded, got ${fundedSnap.data().status}`);
      }
    });

    // --------------------------------------------------------------------------
    // TEST 8: Server Notification Creation Integrity
    // --------------------------------------------------------------------------
    await executeTest(8, "Server Notification Service Writes Clean Notifications", async () => {
      const notifId = await createNotification({
        userId: "target_user_1",
        title: "Security Notice",
        message: "Your profile has been authenticated.",
        type: "system",
      });

      if (!notifId) throw new Error("Failed to create notification");

      const docSnap = await adminDb.collection("notifications").doc(notifId).get();
      if (!docSnap.exists) throw new Error("Notification document missing in Firestore");
      if (docSnap.data().read !== false) throw new Error("Default read status should be false");
    });

    // --------------------------------------------------------------------------
    // TEST 9: OCR Job Retention / TTL Timestamp Verification (Stage E)
    // --------------------------------------------------------------------------
    await executeTest(9, "OCR Job Document writes Firestore Timestamp for expiresAt", async () => {
      const now = new Date();
      const expires = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      const expiresAtTimestamp = Timestamp.fromDate(expires);

      const jobRef = adminDb.collection("ocrJobs").doc("test_ocr_job");
      await jobRef.set({
        jobId: "test_ocr_job",
        userId: "cust_1",
        status: "completed",
        expiresAt: expiresAtTimestamp,
        createdAt: Timestamp.fromDate(now),
      });

      const snap = await jobRef.get();
      const data = snap.data();

      if (!data.expiresAt) throw new Error("expiresAt is missing");
      if (typeof data.expiresAt.toDate !== "function") {
        throw new Error(`expiresAt is not a Firestore Timestamp! Found type: ${typeof data.expiresAt}`);
      }
      if (typeof data.expiresAt === "string") {
        throw new Error("expiresAt was stored as a string instead of Firestore Timestamp");
      }
    });

    // --------------------------------------------------------------------------
    // TEST 10: Three-Role Proofreader Migration Script (Stage F)
    // --------------------------------------------------------------------------
    await executeTest(10, "Proofreader Accounts Migrated to Writer with Specialist Capability", async () => {
      // Create legacy proofreader account
      await adminDb.collection("users").doc("legacy_proofreader_1").set({
        uid: "legacy_proofreader_1",
        email: "proof@test.com",
        role: "proofreader",
        specialistCapabilities: ["proofreading"],
        reputation: 4.8,
        status: "active",
      });

      // Run migration
      const migrationResult = await runMigration({ execute: true });
      if (migrationResult.migrated < 1) throw new Error("Migration script did not find legacy account");

      // Verify migrated document
      const snap = await adminDb.collection("users").doc("legacy_proofreader_1").get();
      const data = snap.data();

      if (data.role !== "writer") throw new Error(`Expected role 'writer', got '${data.role}'`);
      if (data.canProofread !== true) throw new Error("canProofread flag was not set to true");
      if (data.isProofreadCertified !== true) throw new Error("isProofreadCertified was not set to true");
      if (!data.specialistCapabilities.includes("proofreading") || !data.specialistCapabilities.includes("writing")) {
        throw new Error(`Capabilities not merged properly: ${JSON.stringify(data.specialistCapabilities)}`);
      }
      if (data.reputation !== 4.8) throw new Error("Reputation was overwritten");
    });
  } finally {
    server.close();
  }

  console.log("\n================================================================================");
  console.log("TEST SUMMARY");
  console.log("================================================================================");
  const total = results.length;
  const passed = results.filter((r) => r.status === "PASSED").length;
  const failed = results.filter((r) => r.status === "FAILED").length;
  console.log(`Total Scenarios: ${total}`);
  console.log(`Passed:          ${passed} [✓]`);
  console.log(`Failed:          ${failed} [✗]`);
  console.log("================================================================================\n");

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTestSuite().catch((err) => {
  console.error("Test Suite execution failed:", err);
  process.exit(1);
});
