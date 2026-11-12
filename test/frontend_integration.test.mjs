import http from "http";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createApp } from "../backend/dist/app.js";
import { lipilaService } from "../backend/dist/services/lipilaService.js";
import { generateTestWebhookHeaders } from "../backend/dist/services/webhookAuth.js";

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

async function clearCollections(cols) {
  for (const col of cols) {
    const snap = await adminDb.collection(col).get();
    const batch = adminDb.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

function makeApiRequest(server, path, method = "GET", body = null, token = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const port = address.port;

    const headers = {
      "Content-Type": "application/json",
      ...extraHeaders,
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers,
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          let json;
          try {
            json = JSON.parse(raw);
          } catch {
            json = raw;
          }
          resolve({ status: res.statusCode, body: json, headers: res.headers });
        });
      }
    );

    req.on("error", reject);
    if (body) {
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    req.end();
  });
}

async function fundViaLipila(server, targetBody, token, amount) {
  const initRes = await makeApiRequest(
    server,
    "/api/payments/initiate",
    "POST",
    {
      ...targetBody,
      network: "airtel_money",
      phoneNumber: "0977123456",
    },
    token
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
    accountNumber: "260977123456",
  });
  const payload = { referenceId, status: "Successful", type: "Collection" };
  const { rawBody, headers } = generateTestWebhookHeaders(payload);
  const cbRes = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", rawBody, null, headers);
  return { referenceId, initRes, cbRes, payload };
}

async function runFrontendIntegrationTests() {
  console.log("================================================================================");
  console.log("DATABOY PHASE 3 — FRONTEND-TO-BACKEND INTEGRATION TEST SUITE");
  console.log("Targeting Backend API + Firestore Emulator at 127.0.0.1:8080");
  console.log("================================================================================\n");

  const app = createApp();
  const server = http.createServer(app);
  await new Promise((res) => server.listen(0, "127.0.0.1", res));

  const results = [];

  async function testCase(number, title, fn) {
    process.stdout.write(`Scenario ${number}: ${title} ... `);
    try {
      await clearCollections(["assignments", "users", "researchRequests", "auditLogs", "notifications", "payments", "paymentLocks", "processedWebhooks", "ledger"]);
      await fn();
      console.log("PASSED [✓]");
      results.push({ number, title, status: "PASSED" });
    } catch (err) {
      console.log(`FAILED [✗]\n  -> Error: ${err.message}`);
      results.push({ number, title, status: "FAILED", error: err.message });
    }
  }

  try {
    // --------------------------------------------------------------------------
    // SCENARIO 1: Public Health & Pricing Preview Endpoints
    // --------------------------------------------------------------------------
    await testCase(1, "Public Health & Pricing Preview API Workflows", async () => {
      // 1. Health check
      const healthRes = await makeApiRequest(server, "/api/health");
      if (healthRes.status !== 200 || healthRes.body.status !== "healthy") {
        throw new Error(`Health check failed: ${JSON.stringify(healthRes.body)}`);
      }

      // 2. Unauthenticated Pricing Preview: 6 pages, masters level (38 ZMW), 3 days out (1.55 rush), dissertation (1.35)
      // subtotal = 6 * 38 = 228
      // total = ceil(228 * 1.55 * 1.35) = ceil(477.09) = 478
      const priceRes = await makeApiRequest(server, "/api/pricing-preview", "POST", {
        pageCount: 6,
        academicLevel: "masters",
        deadline: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
        serviceType: "dissertation",
      });

      if (priceRes.status !== 200 || !priceRes.body.success) {
        throw new Error(`Pricing preview failed: ${JSON.stringify(priceRes.body)}`);
      }
      if (priceRes.body.breakdown.subtotal !== 228) {
        throw new Error(`Expected subtotal 228, got ${priceRes.body.breakdown.subtotal}`);
      }
      if (priceRes.body.breakdown.total !== 478) {
        throw new Error(`Expected total 478, got ${priceRes.body.breakdown.total}`);
      }
    });

    // --------------------------------------------------------------------------
    // SCENARIO 2: Customer Assignment Submission with Authoritative Pricing
    // --------------------------------------------------------------------------
    await testCase(2, "Customer Assignment Creation Enforces Authoritative Pricing", async () => {
      await adminDb.collection("users").doc("student_alice").set({
        uid: "student_alice",
        email: "alice@university.edu.zm",
        displayName: "Alice M.",
        role: "customer",
        status: "active",
      });

      // Alice first attempts to send client-controlled budget & commission fields -> MUST fail with 400 (C-1)
      const forgedRes = await makeApiRequest(
        server,
        "/api/assignments",
        "POST",
        {
          title: "Microbiology Laboratory Report",
          description: "Analysis of bacterial cultures under temperature gradients.",
          academicLevel: "degree",
          subject: "biology",
          deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
          pageCount: 4,
          serviceType: "assignment",
          budget: 5, // Client tampering attempt!
          writerCommission: 2,
        },
        "test-token:student_alice:customer:alice@university.edu.zm"
      );

      if (forgedRes.status !== 400) {
        throw new Error(`Expected 400 rejecting client financial fields, got ${forgedRes.status}`);
      }

      // Alice then submits a clean payload: 4 pages at degree rate (28 ZMW) = 112 ZMW computed server-side.
      const createRes = await makeApiRequest(
        server,
        "/api/assignments",
        "POST",
        {
          title: "Microbiology Laboratory Report",
          description: "Analysis of bacterial cultures under temperature gradients.",
          academicLevel: "degree",
          subject: "biology",
          deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split("T")[0],
          pageCount: 4,
          serviceType: "assignment",
        },
        "test-token:student_alice:customer:alice@university.edu.zm"
      );

      if (createRes.status !== 201) {
        throw new Error(`Assignment creation failed: ${createRes.status} ${JSON.stringify(createRes.body)}`);
      }

      const assignmentId = createRes.body.assignmentId;
      const snap = await adminDb.collection("assignments").doc(assignmentId).get();
      const proj = snap.data();

      // Verify server pricing engine enforced authoritative pricing and source marker
      if (proj.source !== "server_priced") {
        throw new Error(`Expected source='server_priced', found '${proj.source}'`);
      }
      if (proj.budget !== 112) {
        throw new Error(`Server failed to enforce pricing! Found budget: ${proj.budget}, expected: 112`);
      }
      if (proj.writerCommission !== 56) {
        throw new Error(`Expected writer commission 56, found: ${proj.writerCommission}`);
      }
      if (proj.proofreaderCommission !== 18.67) {
        throw new Error(`Expected proofreader commission 18.67, found: ${proj.proofreaderCommission}`);
      }
      if (proj.databoyCommission !== 37.33) {
        throw new Error(`Expected databoy commission 37.33, found: ${proj.databoyCommission}`);
      }

      // Check notification created
      const notifSnap = await adminDb
        .collection("notifications")
        .where("userId", "==", "student_alice")
        .get();
      if (notifSnap.empty) throw new Error("Customer notification was not generated");
    });

    // --------------------------------------------------------------------------
    // SCENARIO 3: Customer Assignment Funding via Lipila & Idempotent Callback
    // --------------------------------------------------------------------------
    await testCase(3, "Customer Funding Locks Escrow via Lipila & Handles Duplicate Webhooks", async () => {
      await adminDb.collection("users").doc("student_alice").set({
        uid: "student_alice",
        email: "alice@university.edu.zm",
        role: "customer",
        status: "active",
      });

      await adminDb.collection("assignments").doc("asg_fund_test").set({
        id: "asg_fund_test",
        customerId: "student_alice",
        title: "Database Systems",
        budget: 150,
        currency: "ZMW",
        status: "awaiting_payment",
        paymentStatus: "awaiting_payment",
      });

      // 1. Legacy direct /fund call must be rejected (403)
      const legacyRes = await makeApiRequest(
        server,
        "/api/assignments/asg_fund_test/fund",
        "POST",
        {},
        "test-token:student_alice:customer:alice@university.edu.zm"
      );
      if (legacyRes.status !== 403) {
        throw new Error(`Expected 403 on disabled /fund endpoint, got ${legacyRes.status}`);
      }

      // 2. Fund via Lipila initiation + signed webhook callback
      const { referenceId, cbRes, payload } = await fundViaLipila(
        server,
        { assignmentId: "asg_fund_test" },
        "test-token:student_alice:customer:alice@university.edu.zm",
        150
      );
      if (cbRes.status !== 200 || cbRes.body.status !== "Successful") {
        throw new Error(`First Lipila callback failed: ${cbRes.status}`);
      }

      const snap1 = await adminDb.collection("assignments").doc("asg_fund_test").get();
      if (snap1.data().paymentStatus !== "funded" || snap1.data().payoutStatus !== "escrowed" || snap1.data().paymentReference !== referenceId) {
        throw new Error("Payment status or payout status not updated properly in escrow");
      }

      // 3. Duplicate signed callback with fresh webhook-id (idempotent reconciliation)
      const dupHeaders = generateTestWebhookHeaders(payload);
      const res2 = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", dupHeaders.rawBody, null, dupHeaders.headers);
      if (res2.status !== 200 || !res2.body.message?.includes("already successfully reconciled")) {
        throw new Error(`Duplicate callback failed to be idempotent: ${res2.status} ${JSON.stringify(res2.body)}`);
      }
    });

    // --------------------------------------------------------------------------
    // SCENARIO 4: Writer Onboarding Application & Admin Verification
    // --------------------------------------------------------------------------
    await testCase(4, "Writer Onboarding Application & Administrative Approval", async () => {
      // 1. Initial user (customer)
      await adminDb.collection("users").doc("applicant_bob").set({
        uid: "applicant_bob",
        email: "bob@scholar.zm",
        displayName: "Bob K.",
        role: "customer",
        status: "active",
      });

      await adminDb.collection("users").doc("admin_dan").set({
        uid: "admin_dan",
        email: "dan@databoy.com",
        role: "admin",
        status: "active",
      });

      // 2. Bob applies to become a writer
      const applyRes = await makeApiRequest(
        server,
        "/api/writers/apply",
        "POST",
        {
          university: "University of Zambia",
          major: "Computer Science",
          yearOfStudy: "4th Year",
          degreeLevel: "degree",
          subjects: ["computer_science", "mathematics"],
          phone: "+260971234567",
          bio: "Senior CS undergrad specializing in distributed systems.",
          canProofread: true,
        },
        "test-token:applicant_bob:customer:bob@scholar.zm"
      );

      if (applyRes.status !== 200 || applyRes.body.verificationStatus !== "pending_review") {
        throw new Error(`Application failed: ${applyRes.status} ${JSON.stringify(applyRes.body)}`);
      }

      // Verify Bob's role is STILL customer (no privilege escalation!)
      const bobPreSnap = await adminDb.collection("users").doc("applicant_bob").get();
      if (bobPreSnap.data().role !== "customer") {
        throw new Error(`Security breach: Role escalated prematurely to ${bobPreSnap.data().role}`);
      }

      // 3. Admin Dan approves Bob with proofreading certification
      const approveRes = await makeApiRequest(
        server,
        "/api/admin/writers/applicant_bob/approve",
        "POST",
        { grantProofreading: true },
        "test-token:admin_dan:admin:dan@databoy.com"
      );

      if (approveRes.status !== 200) {
        throw new Error(`Admin approval failed: ${approveRes.status}`);
      }

      // Verify Bob is now an active writer with proofreading capability
      const bobPostSnap = await adminDb.collection("users").doc("applicant_bob").get();
      const bobData = bobPostSnap.data();
      if (bobData.role !== "writer") throw new Error(`Expected role 'writer', got '${bobData.role}'`);
      if (bobData.canProofread !== true) throw new Error("canProofread should be true");
      if (!bobData.specialistCapabilities.includes("proofreading")) {
        throw new Error("Missing proofreading capability");
      }
    });

    // --------------------------------------------------------------------------
    // SCENARIO 5: Full Assignment Lifecycle (Claim -> Submit -> Review -> Approve)
    // --------------------------------------------------------------------------
    await testCase(5, "End-to-End Assignment Lifecycle with Separation of Duties", async () => {
      // Setup Writer 1 and Reviewer (Writer 2)
      await adminDb.collection("users").doc("writer_john").set({
        uid: "writer_john",
        email: "john@writer.zm",
        role: "writer",
        status: "active",
        canProofread: true,
        specialistCapabilities: ["writing", "proofreading"],
      });

      await adminDb.collection("users").doc("reviewer_mary").set({
        uid: "reviewer_mary",
        email: "mary@reviewer.zm",
        role: "writer",
        status: "active",
        canProofread: true,
        specialistCapabilities: ["writing", "proofreading"],
      });

      await adminDb.collection("assignments").doc("asg_lifecycle_1").set({
        id: "asg_lifecycle_1",
        customerId: "student_alice",
        title: "Economics Macro Analysis",
        budget: 200,
        writerCommission: 100,
        proofreaderCommission: 33.34,
        databoyCommission: 66.66,
        status: "funded",
        paymentStatus: "funded",
        payoutStatus: "escrowed",
        writerId: null,
        proofreaderId: null,
      });

      // 1. Writer John claims the funded assignment
      const claimRes = await makeApiRequest(
        server,
        "/api/assignments/asg_lifecycle_1/claim",
        "POST",
        {},
        "test-token:writer_john:writer:john@writer.zm"
      );
      if (claimRes.status !== 200) throw new Error(`Claim failed: ${claimRes.status}`);

      // 2. Writer John submits the draft
      const draftRes = await makeApiRequest(
        server,
        "/api/assignments/asg_lifecycle_1/submit-draft",
        "POST",
        { fileUrl: "https://storage.googleapis.com/test/draft.docx", notes: "First draft ready" },
        "test-token:writer_john:writer:john@writer.zm"
      );
      if (draftRes.status !== 200) throw new Error(`Draft submit failed: ${draftRes.status}`);

      // 3. SEPARATION OF DUTIES TEST: John attempts to review his own draft!
      const invalidReviewRes = await makeApiRequest(
        server,
        "/api/assignments/asg_lifecycle_1/claim-review",
        "POST",
        {},
        "test-token:writer_john:writer:john@writer.zm"
      );
      if (invalidReviewRes.status !== 403) {
        throw new Error(`Separation of duties failed! Writer claimed own review: ${invalidReviewRes.status}`);
      }

      // 4. Independent Reviewer Mary claims the review
      const validReviewRes = await makeApiRequest(
        server,
        "/api/assignments/asg_lifecycle_1/claim-review",
        "POST",
        {},
        "test-token:reviewer_mary:writer:mary@reviewer.zm"
      );
      if (validReviewRes.status !== 200) {
        throw new Error(`Mary review claim failed: ${validReviewRes.status}`);
      }

      // 5. Reviewer Mary approves the final assignment
      const approveRes = await makeApiRequest(
        server,
        "/api/assignments/asg_lifecycle_1/approve",
        "POST",
        { finalFileUrl: "https://storage.googleapis.com/test/final.docx", notes: "Excellent quality." },
        "test-token:reviewer_mary:writer:mary@reviewer.zm"
      );
      if (approveRes.status !== 200) throw new Error(`Approval failed: ${approveRes.status}`);

      // Verify completion & payout release
      const finalDoc = await adminDb.collection("assignments").doc("asg_lifecycle_1").get();
      const finalData = finalDoc.data();
      if (finalData.status !== "completed") throw new Error(`Expected completed, got: ${finalData.status}`);
      if (finalData.payoutStatus !== "released") throw new Error(`Expected released, got: ${finalData.payoutStatus}`);
      if (finalData.proofreaderId !== "reviewer_mary") throw new Error("Incorrect proofreader recorded");
    });

    // --------------------------------------------------------------------------
    // SCENARIO 6: Research Request Workflow (Submission -> Quote -> Payment -> Allocation)
    // --------------------------------------------------------------------------
    await testCase(6, "Research Request Full Lifecycle & Manual Quotation", async () => {
      await adminDb.collection("users").doc("student_alice").set({
        uid: "student_alice",
        email: "alice@university.edu.zm",
        role: "customer",
        status: "active",
      });

      await adminDb.collection("users").doc("admin_dan").set({
        uid: "admin_dan",
        email: "dan@databoy.com",
        role: "admin",
        status: "active",
      });

      await adminDb.collection("users").doc("specialist_dr_smith").set({
        uid: "specialist_dr_smith",
        email: "smith@research.zm",
        role: "writer",
        status: "active",
      });

      // 1. Alice submits research request
      const createRes = await makeApiRequest(
        server,
        "/api/research",
        "POST",
        {
          title: "Renewable Energy Grid Feasibility in Zambia",
          requestTypes: ["proposal_writing", "data_analysis"],
          pastedBrief: "Comprehensive technical analysis of solar microgrids in rural provinces.",
          expectedDeliverable: "Full research proposal with statistical model",
          deadline: "2026-12-30",
        },
        "test-token:student_alice:customer:alice@university.edu.zm"
      );
      if (createRes.status !== 201) throw new Error(`Research creation failed: ${createRes.status}`);
      const reqId = createRes.body.requestId;

      // 2. Admin Dan sets manual quote of 750 ZMW
      const quoteRes = await makeApiRequest(
        server,
        `/api/research/${reqId}/quote`,
        "POST",
        { quoteAmount: 750, quoteNotes: "Includes data analysis and simulation scripts." },
        "test-token:admin_dan:admin:dan@databoy.com"
      );
      if (quoteRes.status !== 200 || quoteRes.body.quoteAmount !== 750) {
        throw new Error(`Quote failed: ${quoteRes.status}`);
      }

      // 3. Alice accepts the quote
      const acceptRes = await makeApiRequest(
        server,
        `/api/research/${reqId}/respond-quote`,
        "POST",
        { accept: true },
        "test-token:student_alice:customer:alice@university.edu.zm"
      );
      if (acceptRes.status !== 200 || acceptRes.body.status !== "awaiting_payment") {
        throw new Error(`Quote accept failed: ${acceptRes.status}`);
      }

      // 4. Legacy research /fund must return 403; Alice funds into escrow via Lipila
      const legacyFundRes = await makeApiRequest(
        server,
        `/api/research/${reqId}/fund`,
        "POST",
        {},
        "test-token:student_alice:customer:alice@university.edu.zm"
      );
      if (legacyFundRes.status !== 403) {
        throw new Error(`Expected 403 on disabled research /fund endpoint, got ${legacyFundRes.status}`);
      }

      const { cbRes } = await fundViaLipila(
        server,
        { researchRequestId: reqId },
        "test-token:student_alice:customer:alice@university.edu.zm",
        750
      );
      if (cbRes.status !== 200 || cbRes.body.status !== "Successful") {
        throw new Error(`Research Lipila fund failed: ${cbRes.status}`);
      }

      // 5. Admin Dan allocates to Specialist Dr. Smith
      const assignRes = await makeApiRequest(
        server,
        `/api/research/${reqId}/assign`,
        "POST",
        { writerId: "specialist_dr_smith" },
        "test-token:admin_dan:admin:dan@databoy.com"
      );
      if (assignRes.status !== 200 || assignRes.body.status !== "assigned") {
        throw new Error(`Research assign failed: ${assignRes.status}`);
      }

      const snap = await adminDb.collection("researchRequests").doc(reqId).get();
      if (snap.data().assignedWriterId !== "specialist_dr_smith") {
        throw new Error("Assigned writer was not updated properly");
      }
    });

    // --------------------------------------------------------------------------
    // SCENARIO 7: Account Suspension & Access Denied
    // --------------------------------------------------------------------------
    await testCase(7, "Account Suspension Disables Protected Access Immediately", async () => {
      await adminDb.collection("users").doc("bad_actor").set({
        uid: "bad_actor",
        email: "bad@actor.zm",
        role: "customer",
        status: "active",
      });

      await adminDb.collection("users").doc("admin_dan").set({
        uid: "admin_dan",
        email: "dan@databoy.com",
        role: "admin",
        status: "active",
      });

      // Admin suspends bad_actor
      const suspendRes = await makeApiRequest(
        server,
        "/api/admin/users/bad_actor/suspend",
        "POST",
        { reason: "Terms of service violation: payment dispute" },
        "test-token:admin_dan:admin:dan@databoy.com"
      );
      if (suspendRes.status !== 200) throw new Error("Suspension failed");

      // bad_actor attempts to call API
      const deniedRes = await makeApiRequest(
        server,
        "/api/assignments",
        "POST",
        { title: "Test", description: "test test", deadline: "2026-12-01" },
        "test-token:bad_actor:customer:bad@actor.zm"
      );

      if (deniedRes.status !== 403 || !deniedRes.body.error?.includes("suspended")) {
        throw new Error(`Expected 403 Forbidden for suspended user, got ${deniedRes.status}`);
      }

      // Admin activates bad_actor
      const activateRes = await makeApiRequest(
        server,
        "/api/admin/users/bad_actor/activate",
        "POST",
        {},
        "test-token:admin_dan:admin:dan@databoy.com"
      );
      if (activateRes.status !== 200) throw new Error("Activation failed");

      const badSnap = await adminDb.collection("users").doc("bad_actor").get();
      if (badSnap.data().status !== "active") throw new Error("Status should be active");
    });

    // --------------------------------------------------------------------------
    // SCENARIO 8: Platform Audit Logs API
    // --------------------------------------------------------------------------
    await testCase(8, "Admin Can Query Immutable Audit Logs via API", async () => {
      await adminDb.collection("users").doc("student_alice").set({
        uid: "student_alice",
        email: "alice@university.edu.zm",
        role: "customer",
        status: "active",
      });

      await adminDb.collection("users").doc("admin_dan").set({
        uid: "admin_dan",
        email: "dan@databoy.com",
        role: "admin",
        status: "active",
      });

      // Non-admin attempting to fetch audit logs
      const unauthorizedRes = await makeApiRequest(
        server,
        "/api/admin/audit-logs",
        "GET",
        null,
        "test-token:student_alice:customer:alice@university.edu.zm"
      );
      if (unauthorizedRes.status !== 403) {
        throw new Error(`Expected 403 for non-admin audit log query, got ${unauthorizedRes.status}`);
      }

      // Admin fetching audit logs
      const authorizedRes = await makeApiRequest(
        server,
        "/api/admin/audit-logs?limit=10",
        "GET",
        null,
        "test-token:admin_dan:admin:dan@databoy.com"
      );
      if (authorizedRes.status !== 200 || !Array.isArray(authorizedRes.body.auditLogs)) {
        throw new Error(`Admin failed to fetch audit logs: ${authorizedRes.status}`);
      }
    });
  } finally {
    server.close();
  }

  console.log("\n================================================================================");
  console.log("INTEGRATION TEST SUMMARY");
  console.log("================================================================================");
  const total = results.length;
  const passed = results.filter((r) => r.status === "PASSED").length;
  const failed = results.filter((r) => r.status === "FAILED").length;
  console.log(`Total Integration Scenarios: ${total}`);
  console.log(`Passed:                      ${passed} [✓]`);
  console.log(`Failed:                      ${failed} [✗]`);
  console.log("================================================================================\n");

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runFrontendIntegrationTests().catch((err) => {
  console.error("Integration test suite failed with error:", err);
  process.exit(1);
});
