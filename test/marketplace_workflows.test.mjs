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

async function runMarketplaceWorkflowTests() {
  console.log("================================================================================");
  console.log("DATABOY PHASE 4 — END-TO-END MARKETPLACE WORKFLOWS & ROLES TEST SUITE");
  console.log("Authoritative Ledger, Proofreading Separation of Duties & Admin Governance");
  console.log("Targeting Backend API + Firestore Emulator at 127.0.0.1:8080");
  console.log("================================================================================\n");

  const app = createApp();
  const server = http.createServer(app);
  await new Promise((res) => server.listen(0, "127.0.0.1", res));

  const results = [];

  async function testCase(number, title, fn) {
    process.stdout.write(`Scenario ${number}: ${title} ... `);
    try {
      await clearCollections(["assignments", "users", "proofreadingTasks", "disputes", "ledger", "payoutRequests", "auditLogs", "payments", "paymentLocks", "processedWebhooks"]);
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
    // SCENARIO 1: Customer Creates & Funds Assignment with Authoritative Ledger Escrow
    // --------------------------------------------------------------------------
    await testCase(1, "Customer Creates & Funds Assignment into Authoritative Ledger", async () => {
      // 1. Seed customer profile
      await adminDb.collection("users").doc("cust_chanda").set({
        uid: "cust_chanda",
        displayName: "Chanda Customer",
        email: "chanda@example.com",
        role: "customer",
        status: "active",
        createdAt: new Date().toISOString(),
      });

      // 2. Customer creates assignment
      const createRes = await makeApiRequest(server, "/api/assignments", "POST", {
        title: "Microeconomic Equilibrium Analysis",
        description: "Detailed analysis of market equilibrium and elasticity models.",
        projectType: "coursework",
        academicLevel: "undergraduate",
        wordCount: 2000,
        deadline: new Date(Date.now() + 86400000 * 7).toISOString(),
        guidelines: "Detailed analysis of market equilibrium and elasticity.",
      }, "test-token:cust_chanda:customer:chanda@example.com");

      if (createRes.status !== 201) {
        throw new Error(`Expected 201 Created for assignment, got ${createRes.status}: ${JSON.stringify(createRes.body)}`);
      }
      const assignmentId = createRes.body.assignmentId || createRes.body.assignment?.id;
      const budget = createRes.body.budget || createRes.body.assignment?.budget;

      if (!budget || budget <= 0) {
        throw new Error(`Expected positive server-calculated budget, got ${budget}`);
      }

      // 3. Direct /fund bypass must fail (403); fund assignment via Lipila initiation + callback
      const legacyFundRes = await makeApiRequest(
        server,
        `/api/assignments/${assignmentId}/fund`,
        "POST",
        {},
        "test-token:cust_chanda:customer:chanda@example.com"
      );
      if (legacyFundRes.status !== 403) {
        throw new Error(`Expected 403 on disabled /fund bypass, got ${legacyFundRes.status}`);
      }

      const initRes = await makeApiRequest(
        server,
        "/api/payments/initiate",
        "POST",
        {
          assignmentId,
          network: "airtel_money",
          phoneNumber: "0977998877",
        },
        "test-token:cust_chanda:customer:chanda@example.com"
      );
      if (initRes.status !== 200 || !initRes.body.referenceId) {
        throw new Error(`Expected 200 OK from Lipila initiate, got ${initRes.status}: ${JSON.stringify(initRes.body)}`);
      }
      const refId = initRes.body.referenceId;
      lipilaService.setMockStatus(refId, "Successful", {
        amount: budget,
        currency: "ZMW",
        type: "Collection",
        paymentType: "AirtelMoney",
        accountNumber: "260977998877",
      });
      const { rawBody, headers } = generateTestWebhookHeaders({ referenceId: refId, status: "Successful", type: "Collection" });
      const cbRes = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", rawBody, null, headers);
      if (cbRes.status !== 200 || cbRes.body.status !== "Successful") {
        throw new Error(`Expected 200 OK for Lipila webhook reconciliation, got ${cbRes.status}: ${JSON.stringify(cbRes.body)}`);
      }

      // 4. Verify assignment status updated
      const asgDoc = await adminDb.collection("assignments").doc(assignmentId).get();
      const asgData = asgDoc.data();
      if (asgData.paymentStatus !== "funded" || asgData.escrowStatus !== "held" || asgData.status !== "funded") {
        throw new Error(`Assignment not correctly marked funded: ${JSON.stringify(asgData)}`);
      }

      // 5. Verify authoritative ledger entry created
      const ledgerSnap = await adminDb.collection("ledger").where("assignmentId", "==", assignmentId).get();
      if (ledgerSnap.empty) {
        throw new Error("No ledger entry created for customer payment");
      }
      const entry = ledgerSnap.docs[0].data();
      if (entry.type !== "customer_payment" || entry.amount !== budget || entry.currency !== "ZMW" || entry.assignmentId !== assignmentId || entry.referenceId !== refId) {
        throw new Error(`Invalid ledger entry: ${JSON.stringify(entry)}`);
      }
    });

    // --------------------------------------------------------------------------
    // SCENARIO 2: Atomic Writer Claiming with Verification Checks
    // --------------------------------------------------------------------------
    await testCase(2, "Atomic Writer Claiming & Verification Enforcement", async () => {
      // 1. Seed Customer, Unverified Writer, Verified Writer
      await adminDb.collection("users").doc("cust_mutale").set({
        uid: "cust_mutale",
        displayName: "Mutale Student",
        role: "customer",
        status: "active",
      });
      await adminDb.collection("users").doc("writer_unverified").set({
        uid: "writer_unverified",
        displayName: "Unverified Writer",
        role: "writer",
        status: "active",
        verificationStatus: "pending_review",
        isVerifiedWriter: false,
      });
      await adminDb.collection("users").doc("writer_verified").set({
        uid: "writer_verified",
        displayName: "Verified Mwape",
        role: "writer",
        writerStatus: "active",
        verificationStatus: "approved",
        isVerifiedWriter: true,
      });

      // 2. Seed funded assignment
      const asgRef = adminDb.collection("assignments").doc("asg_claim_test");
      await asgRef.set({
        id: "asg_claim_test",
        title: "Biochemistry Enzyme Kinetics",
        customerId: "cust_mutale",
        budget: 150.00,
        currency: "ZMW",
        status: "funded",
        paymentStatus: "funded",
        escrowStatus: "held",
        payoutStatus: "escrowed",
        writerId: null,
        createdAt: new Date().toISOString(),
      });

      // 3. Unverified writer attempts to claim -> Should be rejected (403)
      const unverifiedClaimRes = await makeApiRequest(
        server,
        "/api/assignments/asg_claim_test/claim",
        "POST",
        {},
        "test-token:writer_unverified:writer:unverified@writer.zm"
      );
      if (unverifiedClaimRes.status !== 403) {
        throw new Error(`Expected 403 for unverified writer claim, got ${unverifiedClaimRes.status}`);
      }

      // 4. Verified writer claims -> Should succeed (200)
      const verifiedClaimRes = await makeApiRequest(
        server,
        "/api/assignments/asg_claim_test/claim",
        "POST",
        {},
        "test-token:writer_verified:writer:verified@writer.zm"
      );
      if (verifiedClaimRes.status !== 200) {
        throw new Error(`Expected 200 for verified writer claim, got ${verifiedClaimRes.status}: ${JSON.stringify(verifiedClaimRes.body)}`);
      }

      const updatedAsg = (await asgRef.get()).data();
      if (updatedAsg.status !== "assigned" || updatedAsg.writerId !== "writer_verified") {
        throw new Error(`Assignment not correctly claimed: ${JSON.stringify(updatedAsg)}`);
      }

      // 5. Another writer attempts to claim already assigned assignment -> Should get 409 Conflict
      await adminDb.collection("users").doc("writer_second").set({
        uid: "writer_second",
        displayName: "Second Writer",
        role: "writer",
        writerStatus: "active",
        verificationStatus: "approved",
        isVerifiedWriter: true,
      });

      const secondClaimRes = await makeApiRequest(
        server,
        "/api/assignments/asg_claim_test/claim",
        "POST",
        {},
        "test-token:writer_second:writer:second@writer.zm"
      );
      if (secondClaimRes.status !== 409) {
        throw new Error(`Expected 409 Conflict for already claimed project, got ${secondClaimRes.status}`);
      }
    });

    // --------------------------------------------------------------------------
    // SCENARIO 3: Draft Submission Automatically Spawns Separate Proofreading Task
    // --------------------------------------------------------------------------
    await testCase(3, "Writer Submits Draft & Creates Separate Proofreading Task", async () => {
      // 1. Seed assignment in progress
      await adminDb.collection("users").doc("writer_bwalya").set({
        uid: "writer_bwalya",
        displayName: "Bwalya Writer",
        role: "writer",
        writerStatus: "active",
        verificationStatus: "approved",
        isVerifiedWriter: true,
      });

      const asgRef = adminDb.collection("assignments").doc("asg_draft_test");
      await asgRef.set({
        id: "asg_draft_test",
        title: "Constitutional Law Zambian Case Studies",
        customerId: "cust_chanda",
        writerId: "writer_bwalya",
        budget: 300.00,
        currency: "ZMW",
        status: "in_progress",
        paymentStatus: "funded",
        escrowStatus: "held",
        payoutStatus: "escrowed",
        createdAt: new Date().toISOString(),
      });

      // 2. Writer submits draft deliverable
      const draftRes = await makeApiRequest(
        server,
        "/api/assignments/asg_draft_test/submit-draft",
        "POST",
        {
          draftUrl: "https://storage.googleapis.com/databoy/drafts/asg_draft_test_v1.docx",
          notes: "First completed draft covering constitutional amendments 1996 & 2016.",
        },
        "test-token:writer_bwalya:writer:bwalya@writer.zm"
      );

      if (draftRes.status !== 200) {
        throw new Error(`Expected 200 OK for draft submission, got ${draftRes.status}: ${JSON.stringify(draftRes.body)}`);
      }

      // 3. Verify assignment status moved to draft_submitted
      const updatedAsg = (await asgRef.get()).data();
      if (updatedAsg.status !== "draft_submitted" || !updatedAsg.draftDeliverable) {
        throw new Error(`Assignment status not updated to draft_submitted: ${JSON.stringify(updatedAsg)}`);
      }

      // 4. Verify separate proofreading task created in proofreadingTasks collection
      const taskDoc = await adminDb.collection("proofreadingTasks").doc("proof_asg_draft_test").get();
      if (!taskDoc.exists) {
        throw new Error("Proofreading task 'proof_asg_draft_test' was not created in proofreadingTasks collection");
      }

      const taskData = taskDoc.data();
      if (
        taskData.originalWriterId !== "writer_bwalya" ||
        taskData.status !== "unassigned" ||
        taskData.proofreaderEarning !== 50.01 // 16.67% of 300 = 50.01
      ) {
        throw new Error(`Invalid proofreading task data: ${JSON.stringify(taskData)}`);
      }
    });

    // --------------------------------------------------------------------------
    // SCENARIO 4: Separation of Duties Enforcement in Proofreading Task Claiming
    // --------------------------------------------------------------------------
    await testCase(4, "Strict Proofreading Separation of Duties & Quality Review", async () => {
      // 1. Seed users: original author, writer without proofreading capability, certified proofreader
      await adminDb.collection("users").doc("author_lungu").set({
        uid: "author_lungu",
        displayName: "Lungu Author",
        role: "writer",
        writerStatus: "active",
        verificationStatus: "approved",
        isVerifiedWriter: true,
        canProofread: true, // certified, BUT is original author!
      });

      await adminDb.collection("users").doc("writer_novice").set({
        uid: "writer_novice",
        displayName: "Novice Writer",
        role: "writer",
        writerStatus: "active",
        verificationStatus: "approved",
        isVerifiedWriter: true,
        canProofread: false, // not certified to proofread
      });

      await adminDb.collection("users").doc("proofreader_grace").set({
        uid: "proofreader_grace",
        displayName: "Grace Proofreader",
        role: "writer",
        writerStatus: "active",
        verificationStatus: "approved",
        isVerifiedWriter: true,
        canProofread: true, // certified proofreader, distinct person
      });

      // 2. Seed proofreading task
      await adminDb.collection("proofreadingTasks").doc("task_sep_test").set({
        id: "task_sep_test",
        assignmentId: "asg_sep_test",
        title: "Econometrics Time Series Analysis",
        originalWriterId: "author_lungu",
        originalWriterName: "Lungu Author",
        budget: 200.00,
        proofreaderEarning: 33.34,
        status: "unassigned",
        draftUrl: "https://storage.googleapis.com/databoy/drafts/sample.pdf",
        proofreaderId: null,
        createdAt: new Date().toISOString(),
      });

      await adminDb.collection("assignments").doc("asg_sep_test").set({
        id: "asg_sep_test",
        title: "Econometrics Time Series Analysis",
        writerId: "author_lungu",
        status: "draft_submitted",
        budget: 200.00,
      });

      // 3. Original author tries to claim their own work for proofreading -> MUST BE 403
      const authorClaimRes = await makeApiRequest(
        server,
        "/api/proofreading/task_sep_test/claim",
        "POST",
        {},
        "test-token:author_lungu:writer:lungu@writer.zm"
      );
      if (authorClaimRes.status !== 403) {
        throw new Error(`Expected 403 Separation of Duties for original writer, got ${authorClaimRes.status}`);
      }

      // 4. Non-certified writer tries to claim -> MUST BE 403
      const uncertifiedClaimRes = await makeApiRequest(
        server,
        "/api/proofreading/task_sep_test/claim",
        "POST",
        {},
        "test-token:writer_novice:writer:novice@writer.zm"
      );
      if (uncertifiedClaimRes.status !== 403) {
        throw new Error(`Expected 403 for non-certified proofreader, got ${uncertifiedClaimRes.status}`);
      }

      // 5. Certified distinct proofreader claims -> MUST BE 200
      const validClaimRes = await makeApiRequest(
        server,
        "/api/proofreading/task_sep_test/claim",
        "POST",
        {},
        "test-token:proofreader_grace:writer:grace@proofreader.zm"
      );
      if (validClaimRes.status !== 200) {
        throw new Error(`Expected 200 for certified proofreader claim, got ${validClaimRes.status}: ${JSON.stringify(validClaimRes.body)}`);
      }

      // 6. Proofreader submits reviewed document
      const submitRes = await makeApiRequest(
        server,
        "/api/proofreading/task_sep_test/submit",
        "POST",
        {
          submissionUrl: "https://storage.googleapis.com/databoy/proofread/annotated_sample.docx",
          notes: "Fixed APA 7 citation errors and clarified methodology subsection.",
        },
        "test-token:proofreader_grace:writer:grace@proofreader.zm"
      );
      if (submitRes.status !== 200) {
        throw new Error(`Expected 200 for proofreading submission, got ${submitRes.status}`);
      }

      const taskAfterSubmit = (await adminDb.collection("proofreadingTasks").doc("task_sep_test").get()).data();
      if (taskAfterSubmit.status !== "submitted") {
        throw new Error(`Expected status 'submitted', got ${taskAfterSubmit.status}`);
      }
    });

    // --------------------------------------------------------------------------
    // SCENARIO 5: Admin Approval, Authoritative Ledger Escrow Release & Exact Splits
    // --------------------------------------------------------------------------
    await testCase(5, "Quality Approval & Deterministic Commission Distribution", async () => {
      // 1. Seed Admin, Writer ($0 bal), Proofreader ($0 bal)
      await adminDb.collection("users").doc("admin_auditor").set({
        uid: "admin_auditor",
        displayName: "System Administrator",
        role: "admin",
        status: "active",
      });

      await adminDb.collection("users").doc("writer_kanyanta").set({
        uid: "writer_kanyanta",
        displayName: "Kanyanta Writer",
        role: "writer",
        status: "active",
        availableBalance: 0,
        totalEarned: 0,
      });

      await adminDb.collection("users").doc("proofreader_musonda").set({
        uid: "proofreader_musonda",
        displayName: "Musonda Proofreader",
        role: "writer",
        status: "active",
        availableBalance: 0,
        totalEarned: 0,
      });

      // 2. Seed assignment with budget of 100.00 ZMW
      const BUDGET = 100.00;
      await adminDb.collection("assignments").doc("asg_payout_split").set({
        id: "asg_payout_split",
        title: "Public Health Epidemiology Survey",
        customerId: "cust_chanda",
        writerId: "writer_kanyanta",
        proofreaderId: "proofreader_musonda",
        budget: BUDGET,
        currency: "ZMW",
        status: "under_review",
        paymentStatus: "funded",
        escrowStatus: "held",
        payoutStatus: "escrowed",
      });

      // 3. Seed proofreading task
      await adminDb.collection("proofreadingTasks").doc("proof_asg_payout_split").set({
        id: "proof_asg_payout_split",
        assignmentId: "asg_payout_split",
        title: "Public Health Epidemiology Survey",
        originalWriterId: "writer_kanyanta",
        originalWriterName: "Kanyanta Writer",
        proofreaderId: "proofreader_musonda",
        proofreaderName: "Musonda Proofreader",
        budget: BUDGET,
        proofreaderEarning: 16.67,
        status: "submitted",
        draftUrl: "https://storage.googleapis.com/databoy/draft.pdf",
        proofreaderSubmissionUrl: "https://storage.googleapis.com/databoy/final.docx",
      });

      // 4. Admin approves proofreading task -> releases escrow payouts
      const approveRes = await makeApiRequest(
        server,
        "/api/proofreading/proof_asg_payout_split/approve",
        "POST",
        {},
        "test-token:admin_auditor:admin:auditor@databoy.com"
      );

      if (approveRes.status !== 200) {
        throw new Error(`Expected 200 OK for approval, got ${approveRes.status}: ${JSON.stringify(approveRes.body)}`);
      }

      // 5. Verify ledger entries: writer earning (50%), proofreader earning (16.67%), platform fee (33.33%)
      const ledgerEntries = (await adminDb.collection("ledger").where("referenceId", "==", "asg_payout_split").get()).docs.map(d => d.data());
      
      const writerEntry = ledgerEntries.find(e => e.type === "writer_earning");
      const proofreaderEntry = ledgerEntries.find(e => e.type === "proofreader_earning");
      const platformEntry = ledgerEntries.find(e => e.type === "platform_fee");

      if (!writerEntry || writerEntry.amount !== 50.00) {
        throw new Error(`Expected writer earning 50.00, got: ${JSON.stringify(writerEntry)}`);
      }
      if (!proofreaderEntry || proofreaderEntry.amount !== 16.67) {
        throw new Error(`Expected proofreader earning 16.67, got: ${JSON.stringify(proofreaderEntry)}`);
      }
      if (!platformEntry || platformEntry.amount !== 33.33) {
        throw new Error(`Expected platform commission 33.33, got: ${JSON.stringify(platformEntry)}`);
      }

      // Exact Penny Reconciliation: sum MUST equal original budget exactly
      const sum = Number((writerEntry.amount + proofreaderEntry.amount + platformEntry.amount).toFixed(2));
      if (sum !== BUDGET) {
        throw new Error(`Reconciliation failure: Sum of payouts (${sum}) does not equal budget (${BUDGET})`);
      }

      // 6. Verify balances updated on user profiles
      const writerProfile = (await adminDb.collection("users").doc("writer_kanyanta").get()).data();
      const proofreaderProfile = (await adminDb.collection("users").doc("proofreader_musonda").get()).data();

      if (writerProfile.availableBalance !== 50.00 || writerProfile.totalEarned !== 50.00) {
        throw new Error(`Writer balance not updated: ${JSON.stringify(writerProfile)}`);
      }
      if (proofreaderProfile.availableBalance !== 16.67 || proofreaderProfile.totalEarned !== 16.67) {
        throw new Error(`Proofreader balance not updated: ${JSON.stringify(proofreaderProfile)}`);
      }
    });

    // --------------------------------------------------------------------------
    // SCENARIO 6: Customer Revision Request Lifecycle
    // --------------------------------------------------------------------------
    await testCase(6, "Customer Revision Request Lifecycle", async () => {
      // 1. Seed customer and assignment in draft_submitted status
      await adminDb.collection("users").doc("cust_tembo").set({
        uid: "cust_tembo",
        displayName: "Tembo Customer",
        role: "customer",
        status: "active",
      });

      await adminDb.collection("assignments").doc("asg_revision_test").set({
        id: "asg_revision_test",
        title: "Artificial Intelligence in Agritech",
        customerId: "cust_tembo",
        writerId: "writer_kanyanta",
        budget: 180.00,
        status: "draft_submitted",
        statusHistory: [],
      });

      // 2. Customer requests revision with detailed feedback
      const revisionRes = await makeApiRequest(
        server,
        "/api/assignments/asg_revision_test/revision",
        "POST",
        {
          explanation: "Please expand on computer vision applications in soil moisture prediction and add citations from 2024-2026.",
        },
        "test-token:cust_tembo:customer:tembo@example.com"
      );

      if (revisionRes.status !== 200) {
        throw new Error(`Expected 200 for revision request, got ${revisionRes.status}: ${JSON.stringify(revisionRes.body)}`);
      }

      const updatedAsg = (await adminDb.collection("assignments").doc("asg_revision_test").get()).data();
      if (updatedAsg.status !== "review_rejected") {
        throw new Error(`Expected assignment status 'review_rejected', got ${updatedAsg.status}`);
      }
      if (!updatedAsg.revisionHistory || updatedAsg.revisionHistory.length === 0) {
        throw new Error("Revision explanation not recorded in revisionHistory");
      }
    });

    // --------------------------------------------------------------------------
    // SCENARIO 7: Dispute Escalation & Administrative Mediation
    // --------------------------------------------------------------------------
    await testCase(7, "Dispute Escalation & Administrative Mediation", async () => {
      // 1. Seed assignment and customer
      await adminDb.collection("users").doc("cust_simon").set({
        uid: "cust_simon",
        displayName: "Simon Student",
        role: "customer",
        status: "active",
      });
      await adminDb.collection("users").doc("admin_mediator").set({
        uid: "admin_mediator",
        displayName: "Admin Mediator",
        role: "admin",
        status: "active",
      });

      await adminDb.collection("assignments").doc("asg_dispute_test").set({
        id: "asg_dispute_test",
        title: "Pharmaceutical Quality Control Thesis",
        customerId: "cust_simon",
        writerId: "writer_kanyanta",
        budget: 250.00,
        status: "in_progress",
      });

      // 2. Customer raises dispute
      const disputeRes = await makeApiRequest(
        server,
        "/api/assignments/asg_dispute_test/dispute",
        "POST",
        {
          reason: "Writer missed agreed milestone deadline without communication",
          details: "Deliverable draft was promised by Monday; no update provided.",
        },
        "test-token:cust_simon:customer:simon@example.com"
      );

      if (disputeRes.status !== 200 && disputeRes.status !== 201) {
        throw new Error(`Expected 200 or 201 for dispute raise, got ${disputeRes.status}: ${JSON.stringify(disputeRes.body)}`);
      }

      const asgAfterDispute = (await adminDb.collection("assignments").doc("asg_dispute_test").get()).data();
      if (asgAfterDispute.status !== "disputed") {
        throw new Error(`Expected status 'disputed', got ${asgAfterDispute.status}`);
      }

      // 3. Find created dispute ticket
      const disputeSnap = await adminDb.collection("disputes").where("relatedId", "==", "asg_dispute_test").get();
      if (disputeSnap.empty) {
        throw new Error("No dispute document found in 'disputes' collection");
      }
      const disputeId = disputeSnap.docs[0].id;

      // 4. Admin resolves dispute
      const resolveRes = await makeApiRequest(
        server,
        `/api/admin/disputes/${disputeId}/resolve`,
        "POST",
        {
          resolution: "Writer granted 48-hour extension; milestone reset.",
          adminNotes: "Both parties agreed during arbitration session.",
        },
        "test-token:admin_mediator:admin:mediator@databoy.com"
      );

      if (resolveRes.status !== 200) {
        throw new Error(`Expected 200 for dispute resolution, got ${resolveRes.status}: ${JSON.stringify(resolveRes.body)}`);
      }

      const resolvedDispute = (await adminDb.collection("disputes").doc(disputeId).get()).data();
      if (resolvedDispute.status !== "resolved") {
        throw new Error(`Dispute not marked resolved: ${JSON.stringify(resolvedDispute)}`);
      }
    });

    // --------------------------------------------------------------------------
    // SCENARIO 8: Writer Authoritative Wallet, Payout Governance & Platform Analytics
    // --------------------------------------------------------------------------
    await testCase(8, "Writer Wallet, Payout Lifecycle & Realtime Platform Analytics", async () => {
      // 1. Seed writer with 300 ZMW available balance
      await adminDb.collection("users").doc("writer_payout_user").set({
        uid: "writer_payout_user",
        displayName: "Payout Writer",
        role: "writer",
        status: "active",
        availableBalance: 300.00,
        pendingBalance: 100.00,
        totalEarned: 300.00,
        totalPaidOut: 0,
      });

      await adminDb.collection("users").doc("admin_finance").set({
        uid: "admin_finance",
        displayName: "Finance Officer",
        role: "admin",
        status: "active",
      });

      // 2. Writer views wallet earnings
      const walletRes = await makeApiRequest(
        server,
        "/api/writers/me/earnings",
        "GET",
        null,
        "test-token:writer_payout_user:writer:payout@writer.zm"
      );

      if (walletRes.status !== 200 || walletRes.body.wallet.availableBalance !== 300.00) {
        throw new Error(`Invalid wallet response: ${JSON.stringify(walletRes.body)}`);
      }

      // 3. Writer attempts payout exceeding available balance -> 400 Bad Request
      const overdrawRes = await makeApiRequest(
        server,
        "/api/writers/me/payout-request",
        "POST",
        {
          amount: 500.00,
          paymentMethod: "airtel_money",
          paymentDetails: { accountNumber: "+260971234567" },
        },
        "test-token:writer_payout_user:writer:payout@writer.zm"
      );
      if (overdrawRes.status !== 400) {
        throw new Error(`Expected 400 for overdraw payout, got ${overdrawRes.status}`);
      }

      // 4. Writer attempts payout below 50 ZMW minimum -> 400 Bad Request
      const minRes = await makeApiRequest(
        server,
        "/api/writers/me/payout-request",
        "POST",
        {
          amount: 30.00,
          paymentMethod: "airtel_money",
          paymentDetails: { accountNumber: "+260971234567" },
        },
        "test-token:writer_payout_user:writer:payout@writer.zm"
      );
      if (minRes.status !== 400) {
        throw new Error(`Expected 400 for payout under minimum, got ${minRes.status}`);
      }

      // 5. Writer submits valid payout request of 100.00 ZMW
      const validPayoutRes = await makeApiRequest(
        server,
        "/api/writers/me/payout-request",
        "POST",
        {
          amount: 100.00,
          paymentMethod: "airtel_money",
          paymentDetails: { accountNumber: "+260971234567" },
        },
        "test-token:writer_payout_user:writer:payout@writer.zm"
      );

      if (validPayoutRes.status !== 201) {
        throw new Error(`Expected 201 for valid payout request, got ${validPayoutRes.status}: ${JSON.stringify(validPayoutRes.body)}`);
      }
      const payoutId = validPayoutRes.body.payoutId;

      // Available balance should now be 200.00
      const userAfterRequest = (await adminDb.collection("users").doc("writer_payout_user").get()).data();
      if (userAfterRequest.availableBalance !== 200.00) {
        throw new Error(`Balance not deducted upon payout request: ${userAfterRequest.availableBalance}`);
      }

      // 6. Admin lists payout requests
      const adminPayoutsRes = await makeApiRequest(
        server,
        "/api/admin/payouts",
        "GET",
        null,
        "test-token:admin_finance:admin:finance@databoy.com"
      );
      if (adminPayoutsRes.status !== 200 || !adminPayoutsRes.body.payouts.some(p => p.id === payoutId)) {
        throw new Error(`Payout request not listed in admin endpoint: ${JSON.stringify(adminPayoutsRes.body)}`);
      }

      // 7. Admin approves payout request (AUDIT-03: requires unique non-empty externalTransactionId)
      const approvePayoutRes = await makeApiRequest(
        server,
        `/api/admin/payouts/${payoutId}/approve`,
        "POST",
        {
          externalTransactionId: `MM-WF-${payoutId}`,
          confirmationNotes: "Settled via Airtel Money batch #1",
        },
        "test-token:admin_finance:admin:finance@databoy.com"
      );
      if (approvePayoutRes.status !== 200) {
        throw new Error(`Expected 200 for payout approval, got ${approvePayoutRes.status}: ${JSON.stringify(approvePayoutRes.body)}`);
      }

      // Payout marked completed, totalPaidOut incremented
      const userAfterApproval = (await adminDb.collection("users").doc("writer_payout_user").get()).data();
      if (userAfterApproval.totalPaidOut !== 100.00) {
        throw new Error(`totalPaidOut not incremented: ${JSON.stringify(userAfterApproval)}`);
      }

      // 8. Test rejection and refund flow: Writer requests another 50 ZMW, admin rejects with reason
      const secondReqRes = await makeApiRequest(
        server,
        "/api/writers/me/payout-request",
        "POST",
        {
          amount: 50.00,
          paymentMethod: "airtel_money",
          paymentDetails: { accountNumber: "+260979999999" },
        },
        "test-token:writer_payout_user:writer:payout@writer.zm"
      );
      const secondPayoutId = secondReqRes.body.payoutId;

      // Admin rejects payout
      const rejectRes = await makeApiRequest(
        server,
        `/api/admin/payouts/${secondPayoutId}/reject`,
        "POST",
        { reason: "Invalid mobile money phone number format." },
        "test-token:admin_finance:admin:finance@databoy.com"
      );
      if (rejectRes.status !== 200) {
        throw new Error(`Expected 200 for payout rejection, got ${rejectRes.status}`);
      }

      // Balance refunded back to 200.00 (200 - 50 + 50)
      const userAfterReject = (await adminDb.collection("users").doc("writer_payout_user").get()).data();
      if (userAfterReject.availableBalance !== 200.00) {
        throw new Error(`Balance not refunded on rejection: ${userAfterReject.availableBalance}`);
      }

      // 9. Admin calls /api/admin/analytics
      const analyticsRes = await makeApiRequest(
        server,
        "/api/admin/analytics",
        "GET",
        null,
        "test-token:admin_finance:admin:finance@databoy.com"
      );
      if (analyticsRes.status !== 200) {
        throw new Error(`Expected 200 for analytics, got ${analyticsRes.status}`);
      }
      const analytics = analyticsRes.body.analytics;
      if (typeof analytics.revenue?.totalWriterPaidOut !== "number" || analytics.revenue.totalWriterPaidOut < 100.00) {
        throw new Error(`Analytics missing or incorrect totalWriterPaidOut: ${JSON.stringify(analytics)}`);
      }
    });

  } finally {
    server.close();
  }

  console.log("\n================================================================================");
  console.log(`PHASE 4 TEST SUMMARY: ${results.filter(r => r.status === "PASSED").length}/${results.length} Scenarios Passed`);
  console.log("================================================================================");

  if (results.some(r => r.status === "FAILED")) {
    process.exit(1);
  }
}

runMarketplaceWorkflowTests().catch((err) => {
  console.error("Fatal Test Runner Error:", err);
  process.exit(1);
});
