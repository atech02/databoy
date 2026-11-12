import http from "http";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createApp } from "../backend/dist/app.js";
import {
  lipilaService,
  ALLOWED_PRODUCTION_BASE_URLS,
  validateProductionBaseUrl,
} from "../backend/dist/services/lipilaService.js";
import {
  acquireWebhookLease,
  generateTestWebhookHeaders,
  markWebhookCompleted,
  markWebhookFailed,
  renewWebhookLease,
  validateWebhookConfig,
} from "../backend/dist/services/webhookAuth.js";

process.env.NODE_ENV = "test";
process.env.ALLOW_TEST_AUTH = "true";
process.env.RATE_LIMIT_ENABLED = "false";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
const PROJECT_ID = process.env.GCLOUD_PROJECT || "databoy-dev";
process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.LIPILA_WEBHOOK_SECRET = "whsec_dGVzdF9saXBpbGFfd2ViaG9va19zZWNyZXRfa2V5XzEyMzQ1Njc4OTA=";

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

function makeApiRequest(server, path, method = "GET", body = null, token = null, customHeaders = {}) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const port = address.port;

    const headers = {
      "Content-Type": "application/json",
      ...customHeaders,
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
      const data = typeof body === "string" ? body : JSON.stringify(body);
      req.write(data);
    }
    req.end();
  });
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`);
  }
}

async function runTests() {
  console.log("================================================================================");
  console.log("PHASE 5.2: COMPREHENSIVE LIPILA PAYMENT SECURITY & INTEGRITY TEST SUITE");
  console.log("Full Suite: HMAC-SHA256 Webhooks, Authoritative Verification, ACID Reconciliation");
  console.log("================================================================================\n");

  const app = createApp();
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));

  const customerToken = "test-token:cust-phase5:customer:customer@databoy.com";
  const otherCustomerToken = "test-token:cust-other:customer:other@databoy.com";
  const writerToken = "test-token:writer-phase5:writer:writer@databoy.com";
  const adminToken = "test-token:admin-phase5:admin:admin@databoy.com";

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await fn();
      console.log(`[PASS] Scenario ${passed + failed + 1}: ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] Scenario ${passed + failed + 1}: ${name}`);
      console.error(`       Error: ${err.message}`);
      failed++;
    }
  }

  try {
    await clearCollections([
      "assignments",
      "researchRequests",
      "payments",
      "paymentLocks",
      "ledger",
      "audit_logs",
      "auditLogs",
      "payoutRequests",
      "payoutExternalRefs",
      "disputes",
      "wallets",
      "users",
      "processedWebhooks",
    ]);

    // Seed test user profiles required by authMiddleware
    await adminDb.collection("users").doc("cust-phase5").set({
      uid: "cust-phase5",
      displayName: "Customer Phase5",
      email: "customer@databoy.com",
      role: "customer",
      status: "active",
      createdAt: new Date().toISOString(),
    });

    await adminDb.collection("users").doc("cust-other").set({
      uid: "cust-other",
      displayName: "Other Customer",
      email: "other@databoy.com",
      role: "customer",
      status: "active",
      createdAt: new Date().toISOString(),
    });

    await adminDb.collection("users").doc("writer-phase5").set({
      uid: "writer-phase5",
      displayName: "Jane Writer",
      email: "writer@databoy.com",
      role: "writer",
      status: "active",
      isVerifiedWriter: true,
      verificationStatus: "approved",
      createdAt: new Date().toISOString(),
    });

    await adminDb.collection("users").doc("admin-phase5").set({
      uid: "admin-phase5",
      displayName: "Admin User",
      email: "admin@databoy.com",
      role: "admin",
      status: "active",
      createdAt: new Date().toISOString(),
    });

    // Seed test assignments in production domain collection "assignments"
    const asg1Ref = adminDb.collection("assignments").doc("asg-lipila-001");
    await asg1Ref.set({
      id: "asg-lipila-001",
      title: "Data Structures & Algorithms Implementation",
      customerId: "cust-phase5",
      budget: 350.0,
      currency: "ZMW",
      status: "awaiting_payment",
      paymentStatus: "awaiting_payment",
      createdAt: new Date().toISOString(),
    });

    const asg2Ref = adminDb.collection("assignments").doc("asg-lipila-002");
    await asg2Ref.set({
      id: "asg-lipila-002",
      title: "Organic Chemistry Lab Synthesis",
      customerId: "cust-phase5",
      budget: 200.0,
      currency: "ZMW",
      status: "awaiting_payment",
      paymentStatus: "awaiting_payment",
      createdAt: new Date().toISOString(),
    });

    const asg3Ref = adminDb.collection("assignments").doc("asg-lipila-003");
    await asg3Ref.set({
      id: "asg-lipila-003",
      title: "Macroeconomic Policy Review",
      customerId: "cust-phase5",
      budget: 150.0,
      currency: "ZMW",
      status: "awaiting_payment",
      paymentStatus: "awaiting_payment",
      createdAt: new Date().toISOString(),
    });

    let airtelRefId = "";
    let mtnRefId = "";
    let zamtelRefId = "";

    // -------------------------------------------------------------------------
    // PART A: CUSTOMER CHECKOUT & VALIDATION (PHASE 5 CORE)
    // -------------------------------------------------------------------------

    // 1. Customer initiates Airtel Money payment
    await test("Customer initiates Airtel Money payment successfully", async () => {
      const res = await makeApiRequest(
        server,
        "/api/payments/initiate",
        "POST",
        {
          assignmentId: "asg-lipila-001",
          network: "airtel_money",
          phoneNumber: "0977123456",
        },
        customerToken
      );

      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.success === true, "Expected success: true");
      assert(res.body.referenceId && res.body.referenceId.startsWith("DB-PAY-"), "Expected DB-PAY reference");
      assert(res.body.amount === 350.0, "Expected authoritative amount 350.0");
      assert(res.body.maskedPhone === "260*****3456", `Expected masked phone, got ${res.body.maskedPhone}`);
      assert(res.body.status === "Pending", "Expected Pending status");
      airtelRefId = res.body.referenceId;
    });

    // 2. Customer initiates MTN Mobile Money payment
    await test("Customer initiates MTN Mobile Money payment successfully (returns *115# USSD prompt)", async () => {
      const res = await makeApiRequest(
        server,
        "/api/payments/initiate",
        "POST",
        {
          assignmentId: "asg-lipila-002",
          network: "mtn_money",
          phoneNumber: "0966987654",
        },
        customerToken
      );

      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.network === "mtn_money", "Expected mtn_money");
      assert(res.body.instructions.includes("*115#"), "Expected *115# in instructions");
      assert(res.body.amount === 200.0, "Expected authoritative amount 200.0");
      mtnRefId = res.body.referenceId;
    });

    // 3. Customer initiates Zamtel Kwacha payment
    await test("Customer initiates Zamtel Kwacha payment successfully", async () => {
      const res = await makeApiRequest(
        server,
        "/api/payments/initiate",
        "POST",
        {
          assignmentId: "asg-lipila-003",
          network: "zamtel_kwacha",
          phoneNumber: "0955554433",
        },
        customerToken
      );

      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.network === "zamtel_kwacha", "Expected zamtel_kwacha");
      assert(res.body.amount === 150.0, "Expected 150.0");
      zamtelRefId = res.body.referenceId;
    });

    // 4. Card payment attempt rejected
    await test("Card payment attempt rejected with 400 Bad Request", async () => {
      const res = await makeApiRequest(
        server,
        "/api/payments/initiate",
        "POST",
        {
          assignmentId: "asg-lipila-001",
          network: "visa",
          phoneNumber: "0977123456",
        },
        customerToken
      );

      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.toLowerCase().includes("card"), "Expected error mentioning card payments not supported");
    });

    // 5. Invalid network rejected
    await test("Invalid network (e.g. mpesa) rejected with 400", async () => {
      const res = await makeApiRequest(
        server,
        "/api/payments/initiate",
        "POST",
        {
          assignmentId: "asg-lipila-001",
          network: "mpesa",
          phoneNumber: "0977123456",
        },
        customerToken
      );

      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.includes("Unsupported network"), "Expected unsupported network error");
    });

    // 6. Missing phone number rejected
    await test("Missing phone number rejected with 400", async () => {
      const res = await makeApiRequest(
        server,
        "/api/payments/initiate",
        "POST",
        {
          assignmentId: "asg-lipila-001",
          network: "airtel_money",
        },
        customerToken
      );

      assert(res.status === 400, `Expected 400, got ${res.status}`);
    });

    // 7. Malformed phone number rejected
    await test("Malformed phone number rejected with 400", async () => {
      const res = await makeApiRequest(
        server,
        "/api/payments/initiate",
        "POST",
        {
          assignmentId: "asg-lipila-001",
          network: "airtel_money",
          phoneNumber: "12345",
        },
        customerToken
      );

      assert(res.status === 400, `Expected 400, got ${res.status}`);
    });

    // 8. Non-Zambian phone number rejected
    await test("Non-Zambian phone number (+14155552671) rejected with 400", async () => {
      const res = await makeApiRequest(
        server,
        "/api/payments/initiate",
        "POST",
        {
          assignmentId: "asg-lipila-001",
          network: "airtel_money",
          phoneNumber: "+14155552671",
        },
        customerToken
      );

      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.includes("Zambian"), "Expected Zambian phone error");
    });

    // 9. PIN field presence rejected
    await test("PIN field submission rejected (strict PIN protection)", async () => {
      const res = await makeApiRequest(
        server,
        "/api/payments/initiate",
        "POST",
        {
          assignmentId: "asg-lipila-001",
          network: "airtel_money",
          phoneNumber: "0977123456",
          pin: "1234",
        },
        customerToken
      );

      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.includes("Forbidden fields"), "Expected forbidden fields error for PIN");
    });

    // 10. Client amount tampering blocked
    await test("Client amount tampering blocked (authoritative Firestore budget used)", async () => {
      await adminDb.collection("assignments").doc("asg-tamper-001").set({
        id: "asg-tamper-001",
        title: "Tamper Guard Verification Assignment",
        customerId: "cust-phase5",
        budget: 275.0,
        currency: "ZMW",
        status: "awaiting_payment",
        paymentStatus: "awaiting_payment",
        createdAt: new Date().toISOString(),
      });

      const res = await makeApiRequest(
        server,
        "/api/payments/initiate",
        "POST",
        {
          assignmentId: "asg-tamper-001",
          network: "mtn_money",
          phoneNumber: "0966987654",
          amount: 1.0,
        },
        customerToken
      );

      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.amount === 275.0, `Expected authoritative budget 275.0, got ${res.body.amount}`);
    });

    // 11. Non-existent assignment rejected
    await test("Non-existent assignment rejected with 404", async () => {
      const res = await makeApiRequest(
        server,
        "/api/payments/initiate",
        "POST",
        {
          assignmentId: "asg-does-not-exist",
          network: "airtel_money",
          phoneNumber: "0977123456",
        },
        customerToken
      );

      assert(res.status === 404, `Expected 404, got ${res.status}`);
    });

    // 12. Non-owner customer cannot pay for assignment
    await test("Non-owner customer cannot pay for another user's assignment (403)", async () => {
      const res = await makeApiRequest(
        server,
        "/api/payments/initiate",
        "POST",
        {
          assignmentId: "asg-lipila-001",
          network: "airtel_money",
          phoneNumber: "0977123456",
        },
        otherCustomerToken
      );

      assert(res.status === 403, `Expected 403, got ${res.status}`);
    });

    // 13. Already funded assignment rejects duplicate payment initiation
    await test("Already funded assignment rejects duplicate payment initiation", async () => {
      const fundedAsgRef = adminDb.collection("assignments").doc("asg-already-funded");
      await fundedAsgRef.set({
        id: "asg-already-funded",
        title: "Already Funded Assignment",
        customerId: "cust-phase5",
        budget: 100.0,
        status: "funded",
        paymentStatus: "funded",
        escrowStatus: "held",
      });

      const res = await makeApiRequest(
        server,
        "/api/payments/initiate",
        "POST",
        {
          assignmentId: "asg-already-funded",
          network: "airtel_money",
          phoneNumber: "0977123456",
        },
        customerToken
      );

      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.includes("already funded"), "Expected already funded error");
    });

    // -------------------------------------------------------------------------
    // PART B: WEBHOOK AUTHENTICATION (HMAC-SHA256 & TIMESTAMP VALIDATION)
    // -------------------------------------------------------------------------

    // 14. Missing signature header rejected
    await test("Webhook with missing signature header rejected with 401", async () => {
      const res = await makeApiRequest(
        server,
        "/api/payments/lipila-callback",
        "POST",
        { referenceId: airtelRefId, status: "Successful" },
        null,
        {
          "webhook-id": "msg_test_001",
          "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
        }
      );

      assert(res.status === 401, `Expected 401, got ${res.status}`);
      assert(res.body.message.includes("webhook-signature"), "Expected signature missing message");
    });

    // 15. Invalid signature rejected
    await test("Webhook with invalid signature rejected with 401", async () => {
      const res = await makeApiRequest(
        server,
        "/api/payments/lipila-callback",
        "POST",
        { referenceId: airtelRefId, status: "Successful" },
        null,
        {
          "webhook-id": "msg_test_002",
          "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
          "webhook-signature": "v1,invalid_signature_hash_here_123456",
        }
      );

      assert(res.status === 401, `Expected 401, got ${res.status}`);
      assert(res.body.message.includes("Invalid webhook signature"), "Expected invalid signature error");
    });

    // 16. Missing webhook-id header rejected
    await test("Webhook with missing webhook-id header rejected with 400", async () => {
      const res = await makeApiRequest(
        server,
        "/api/payments/lipila-callback",
        "POST",
        { referenceId: airtelRefId, status: "Successful" },
        null,
        {
          "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
          "webhook-signature": "v1,dummy_signature",
        }
      );

      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.message.includes("webhook-id"), "Expected missing webhook-id error");
    });

    // 17. Expired timestamp rejected (> 5 min)
    await test("Webhook with expired timestamp (> 300s in past) rejected with 401", async () => {
      const expiredTimestamp = Math.floor(Date.now() / 1000) - 360; // 6 minutes ago
      const payload = { referenceId: airtelRefId, status: "Successful" };
      const { rawBody, headers } = generateTestWebhookHeaders(payload, process.env.LIPILA_WEBHOOK_SECRET, {
        timestamp: expiredTimestamp,
      });

      const res = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", rawBody, null, headers);
      assert(res.status === 401, `Expected 401, got ${res.status}`);
      assert(res.body.message.includes("expired"), "Expected expired timestamp message");
    });

    // 18. Future timestamp outside tolerance rejected (> 5 min in future)
    await test("Webhook with future timestamp (> 300s in future) rejected with 401", async () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 400; // 6.6 minutes into future
      const payload = { referenceId: airtelRefId, status: "Successful" };
      const { rawBody, headers } = generateTestWebhookHeaders(payload, process.env.LIPILA_WEBHOOK_SECRET, {
        timestamp: futureTimestamp,
      });

      const res = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", rawBody, null, headers);
      assert(res.status === 401, `Expected 401, got ${res.status}`);
      assert(res.body.message.includes("future"), "Expected future timestamp message");
    });

    // 19. Modified request body rejected (signature mismatch)
    await test("Webhook with tampered payload rejected with 401", async () => {
      const payload = { referenceId: airtelRefId, status: "Successful" };
      // Generate headers using tampered payload
      const { headers } = generateTestWebhookHeaders(payload, process.env.LIPILA_WEBHOOK_SECRET, {
        tamperPayload: true,
      });

      // Send original untampered body with signature calculated on tampered content
      const res = await makeApiRequest(
        server,
        "/api/payments/lipila-callback",
        "POST",
        JSON.stringify(payload),
        null,
        headers
      );

      assert(res.status === 401, `Expected 401, got ${res.status}`);
      assert(res.body.message.includes("Invalid webhook signature"), "Expected signature failure");
    });

    // 20. Key rotation support (multiple space-separated signatures)
    await test("Webhook with multiple signatures during key rotation accepted", async () => {
      const payload = { referenceId: "DB-PAY-ROTATION-TEST", type: "Collection" };
      const oldSignature = "v1,b2xkX3JvdGF0aW9uX3NpZ25hdHVyZV9leGFtcGxlMTIzNA==";
      const { rawBody, headers } = generateTestWebhookHeaders(payload, process.env.LIPILA_WEBHOOK_SECRET, {
        extraSignatures: [oldSignature],
      });

      // The signature header will contain "v1,oldSig v1,validSig"
      assert(headers["webhook-signature"].includes(oldSignature), "Should contain old signature");

      const res = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", rawBody, null, headers);
      // Since DB-PAY-ROTATION-TEST does not exist in payments, signature auth passes (not 401), returns 404
      assert(res.status === 404, `Expected 404 (signature accepted, doc not found), got ${res.status}`);
    });

    // 21. Replay attack rejection (duplicate webhook-id)
    await test("Replay attack using duplicate webhook-id is rejected with 400", async () => {
      const staticWebhookId = "msg_replay_prevention_001";
      const payload = { referenceId: "DB-PAY-REPLAY-TEST", type: "Collection" };
      const { rawBody, headers } = generateTestWebhookHeaders(payload, process.env.LIPILA_WEBHOOK_SECRET, {
        webhookId: staticWebhookId,
      });

      // First dispatch: signature accepted, returns 404 because payment doc does not exist
      const res1 = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", rawBody, null, headers);
      assert(res1.status === 404, `First dispatch expected 404, got ${res1.status}`);

      // Second dispatch: same webhook-id should trigger replay attack detection
      const res2 = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", rawBody, null, headers);
      assert(res2.status === 400, `Second dispatch expected 400 replay rejected, got ${res2.status}`);
      assert(res2.body.message.includes("Replay attack"), "Expected replay attack error");
    });

    // -------------------------------------------------------------------------
    // PART C: PAYMENT VERIFICATION & AUTHORITATIVE STATUS CONTRACT
    // -------------------------------------------------------------------------

    // 22. Callback says Successful but Lipila status says Failed -> does not fund
    await test("Callback claims Successful but Lipila authoritative status is Failed -> funds rejected", async () => {
      lipilaService.setMockStatus(mtnRefId, "Failed", {
        message: "Customer cancelled authorization prompt",
      });

      const payload = { referenceId: mtnRefId, status: "Successful", type: "Collection" };
      const { rawBody, headers } = generateTestWebhookHeaders(payload);

      const res = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", rawBody, null, headers);
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.details.includes("not 'Successful'"), "Expected authoritative status failure");

      // Verify assignment was NOT funded
      const asgSnap = await adminDb.collection("assignments").doc("asg-lipila-002").get();
      assert(asgSnap.data().status === "awaiting_payment", "Assignment should remain awaiting_payment");
    });

    // 23. Callback says Successful but Lipila status says Pending -> does not fund
    await test("Callback claims Successful but Lipila status is Pending -> funds rejected", async () => {
      lipilaService.setMockStatus(mtnRefId, "Pending", {
        message: "Awaiting subscriber PIN entry",
      });

      const payload = { referenceId: mtnRefId, status: "Successful", type: "Collection" };
      const { rawBody, headers } = generateTestWebhookHeaders(payload);

      const res = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", rawBody, null, headers);
      assert(res.status === 400, `Expected 400, got ${res.status}`);

      const asgSnap = await adminDb.collection("assignments").doc("asg-lipila-002").get();
      assert(asgSnap.data().status === "awaiting_payment", "Assignment should remain awaiting_payment");
    });

    // 24. Wrong amount rejected
    await test("Wrong amount from Lipila is rejected without funding", async () => {
      // Payment expected amount is 200 ZMW, but Lipila reports 100 ZMW
      lipilaService.setMockStatus(mtnRefId, "Successful", {
        amount: 100.0,
        currency: "ZMW",
        type: "Collection",
        paymentType: "MTNMoney",
        accountNumber: "260966987654",
      });

      const payload = { referenceId: mtnRefId, status: "Successful", type: "Collection" };
      const { rawBody, headers } = generateTestWebhookHeaders(payload);

      const res = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", rawBody, null, headers);
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.details.includes("Amount mismatch"), "Expected amount mismatch error");

      const asgSnap = await adminDb.collection("assignments").doc("asg-lipila-002").get();
      assert(asgSnap.data().status === "awaiting_payment", "Assignment should not be funded");
    });

    // 25. Wrong currency rejected
    await test("Wrong currency from Lipila (e.g. USD) is rejected", async () => {
      lipilaService.setMockStatus(mtnRefId, "Successful", {
        amount: 200.0,
        currency: "USD",
        type: "Collection",
        paymentType: "MTNMoney",
        accountNumber: "260966987654",
      });

      const payload = { referenceId: mtnRefId, status: "Successful", type: "Collection" };
      const { rawBody, headers } = generateTestWebhookHeaders(payload);

      const res = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", rawBody, null, headers);
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.details.includes("Currency mismatch"), "Expected currency mismatch error");
    });

    // 26. Wrong account number rejected
    await test("Wrong account number from Lipila is rejected", async () => {
      lipilaService.setMockStatus(mtnRefId, "Successful", {
        amount: 200.0,
        currency: "ZMW",
        type: "Collection",
        paymentType: "MTNMoney",
        accountNumber: "260977000000", // Mismatched number
      });

      const payload = { referenceId: mtnRefId, status: "Successful", type: "Collection" };
      const { rawBody, headers } = generateTestWebhookHeaders(payload);

      const res = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", rawBody, null, headers);
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.details.includes("Account number mismatch"), "Expected account number mismatch error");
    });

    // 27. Wrong transaction type rejected (Disbursement instead of Collection)
    await test("Disbursement transaction callback rejected", async () => {
      const payload = { referenceId: mtnRefId, status: "Successful", type: "Disbursement" };
      const { rawBody, headers } = generateTestWebhookHeaders(payload);

      const res = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", rawBody, null, headers);
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.error.includes("Collection"), "Expected Collection type requirement");
    });

    // 28. Card payment callback rejected
    await test("Card payment callback from Lipila is strictly prohibited and rejected", async () => {
      lipilaService.setMockStatus(mtnRefId, "Successful", {
        amount: 200.0,
        currency: "ZMW",
        type: "Collection",
        paymentType: "Visa", // Card payment method
        accountNumber: "260966987654",
      });

      const payload = { referenceId: mtnRefId, status: "Successful", type: "Collection" };
      const { rawBody, headers } = generateTestWebhookHeaders(payload);

      const res = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", rawBody, null, headers);
      assert(res.status === 400, `Expected 400, got ${res.status}`);
      assert(res.body.details.includes("Card payments are strictly prohibited"), "Expected card prohibition error");
    });

    // 29. Valid successful mobile money collection funds assignment and ledger
    await test("Valid successful mobile money collection funds assignment and writes single ledger credit", async () => {
      lipilaService.setMockStatus(airtelRefId, "Successful", {
        amount: 350.0,
        currency: "ZMW",
        type: "Collection",
        paymentType: "AirtelMoney",
        accountNumber: "260977123456",
        transactionId: "LPL-AIRTEL-VALID-101",
      });

      const payload = { referenceId: airtelRefId, status: "Successful", type: "Collection" };
      const { rawBody, headers } = generateTestWebhookHeaders(payload);

      const res = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", rawBody, null, headers);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.status === "Successful", "Expected Successful status");

      // Verify assignment was funded
      const asgSnap = await adminDb.collection("assignments").doc("asg-lipila-001").get();
      const asg = asgSnap.data();
      assert(asg.status === "funded", `Expected status: funded, got ${asg.status}`);
      assert(asg.escrowStatus === "held", `Expected escrowStatus: held, got ${asg.escrowStatus}`);
      assert(asg.payoutStatus === "escrowed", `Expected payoutStatus: escrowed, got ${asg.payoutStatus}`);
      assert(asg.paymentReference === airtelRefId, "Expected paymentReference set");

      // Verify exactly ONE ledger entry was created
      const ledgerSnap = await adminDb.collection("ledger").where("referenceId", "==", airtelRefId).get();
      assert(ledgerSnap.size === 1, `Expected exactly 1 ledger entry, got ${ledgerSnap.size}`);
      const entry = ledgerSnap.docs[0].data();
      assert(entry.type === "customer_payment", "Expected customer_payment type");
      assert(entry.amount === 350.0, "Expected amount 350.0");
      assert(entry.currency === "ZMW", "Expected currency ZMW");
    });

    // -------------------------------------------------------------------------
    // PART D: EXACTLY-ONCE FINANCIAL RECONCILIATION & CONCURRENCY
    // -------------------------------------------------------------------------

    // 30. Same callback delivered twice sequentially -> idempotent return
    await test("Same callback delivered twice sequentially returns 200 without duplicate ledger entry", async () => {
      const payload = { referenceId: airtelRefId, status: "Successful", type: "Collection" };
      const { rawBody, headers } = generateTestWebhookHeaders(payload);

      const res = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", rawBody, null, headers);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.message.includes("already successfully reconciled"), "Expected already reconciled message");

      // Verify ledger count is STILL exactly 1
      const ledgerSnap = await adminDb.collection("ledger").where("referenceId", "==", airtelRefId).get();
      assert(ledgerSnap.size === 1, `Expected exactly 1 ledger entry, got ${ledgerSnap.size}`);
    });

    // 31. Same webhook delivered concurrently (Promise.all)
    await test("Same webhook delivered concurrently (Promise.all) results in exactly 1 ledger credit", async () => {
      // Seed a fresh assignment and payment for concurrent test
      const asgConcRef = adminDb.collection("assignments").doc("asg-concurrent-001");
      await asgConcRef.set({
        id: "asg-concurrent-001",
        title: "Concurrent Webhook Stress Test",
        customerId: "cust-phase5",
        budget: 500.0,
        currency: "ZMW",
        status: "awaiting_payment",
      });

      const initRes = await makeApiRequest(
        server,
        "/api/payments/initiate",
        "POST",
        {
          assignmentId: "asg-concurrent-001",
          network: "mtn_money",
          phoneNumber: "0966123456",
        },
        customerToken
      );
      const concRefId = initRes.body.referenceId;

      lipilaService.setMockStatus(concRefId, "Successful", {
        amount: 500.0,
        currency: "ZMW",
        type: "Collection",
        paymentType: "MTNMoney",
        accountNumber: "260966123456",
      });

      // Dispatch 3 concurrent webhook requests
      const payload = { referenceId: concRefId, status: "Successful", type: "Collection" };
      const requests = [1, 2, 3].map(() => {
        const { rawBody, headers } = generateTestWebhookHeaders(payload);
        return makeApiRequest(server, "/api/payments/lipila-callback", "POST", rawBody, null, headers);
      });

      const responses = await Promise.all(requests);
      for (const r of responses) {
        assert(r.status === 200, `Expected 200 for concurrent response, got ${r.status}`);
      }

      // Verify exactly ONE ledger entry exists in Firestore
      const ledgerSnap = await adminDb.collection("ledger").where("referenceId", "==", concRefId).get();
      assert(ledgerSnap.size === 1, `Expected exactly 1 ledger entry under concurrency, got ${ledgerSnap.size}`);
    });

    // 32. Same payment reconciled through callback and polling concurrently
    await test("Same payment reconciled through callback and polling concurrently creates 1 credit", async () => {
      const asgDualRef = adminDb.collection("assignments").doc("asg-dual-001");
      await asgDualRef.set({
        id: "asg-dual-001",
        title: "Dual Webhook and Polling Race Test",
        customerId: "cust-phase5",
        budget: 400.0,
        currency: "ZMW",
        status: "awaiting_payment",
      });

      const initRes = await makeApiRequest(
        server,
        "/api/payments/initiate",
        "POST",
        {
          assignmentId: "asg-dual-001",
          network: "zamtel_kwacha",
          phoneNumber: "0955112233",
        },
        customerToken
      );
      const dualRefId = initRes.body.referenceId;

      lipilaService.setMockStatus(dualRefId, "Successful", {
        amount: 400.0,
        currency: "ZMW",
        type: "Collection",
        paymentType: "ZamtelKwacha",
        accountNumber: "260955112233",
      });

      const payload = { referenceId: dualRefId, status: "Successful", type: "Collection" };
      const { rawBody, headers } = generateTestWebhookHeaders(payload);

      // Race webhook and polling GET at the exact same moment (authenticated owner)
      const [cbRes, pollRes] = await Promise.all([
        makeApiRequest(server, "/api/payments/lipila-callback", "POST", rawBody, null, headers),
        makeApiRequest(server, `/api/payments/status/${dualRefId}`, "GET", null, customerToken),
      ]);

      assert(cbRes.status === 200, `Expected 200 for webhook, got ${cbRes.status}`);
      assert(pollRes.status === 200, `Expected 200 for polling, got ${pollRes.status}`);

      const ledgerSnap = await adminDb.collection("ledger").where("referenceId", "==", dualRefId).get();
      assert(ledgerSnap.size === 1, `Expected exactly 1 ledger entry, got ${ledgerSnap.size}`);
    });

    // 33. Different successful payment attempts to fund an already-funded assignment
    await test("Different successful payment attempting to fund an already-funded assignment is rejected", async () => {
      // asg-lipila-001 is ALREADY FUNDED by airtelRefId!
      // Create a second independent payment record for asg-lipila-001
      const pay2Ref = adminDb.collection("payments").doc();
      const duplicateRefId = `DB-PAY-DUP-${Date.now()}`;
      await pay2Ref.set({
        id: pay2Ref.id,
        referenceId: duplicateRefId,
        assignmentId: "asg-lipila-001", // Points to already funded assignment
        customerId: "cust-phase5",
        amount: 350.0,
        currency: "ZMW",
        network: "mtn_money",
        accountNumber: "260966987654",
        status: "Pending",
        createdAt: new Date().toISOString(),
      });

      lipilaService.setMockStatus(duplicateRefId, "Successful", {
        amount: 350.0,
        currency: "ZMW",
        type: "Collection",
        paymentType: "MTNMoney",
        accountNumber: "260966987654",
      });

      const payload = { referenceId: duplicateRefId, status: "Successful", type: "Collection" };
      const { rawBody, headers } = generateTestWebhookHeaders(payload);

      const res = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", rawBody, null, headers);
      assert(res.status === 409, `Expected 409 Conflict for duplicate funding attempt, got ${res.status}`);
      assert(res.body.error.includes("already funded"), "Expected already funded error message");

      // Verify payment was marked as Duplicate_Requires_Refund
      const refreshedPaySnap = await pay2Ref.get();
      assert(
        refreshedPaySnap.data().status === "Duplicate_Requires_Refund",
        `Expected Duplicate_Requires_Refund, got ${refreshedPaySnap.data().status}`
      );

      // Verify no ledger entry was created for duplicateRefId
      const dupLedgerSnap = await adminDb.collection("ledger").where("referenceId", "==", duplicateRefId).get();
      assert(dupLedgerSnap.empty, "No ledger entry should be created for duplicate funding attempt");

      // Verify assignment payment reference is still the original airtelRefId
      const asgSnap = await adminDb.collection("assignments").doc("asg-lipila-001").get();
      assert(asgSnap.data().paymentReference === airtelRefId, "Assignment reference should remain original");
    });

    // 34. Two concurrent successful payments for the same assignment
    await test("Two concurrent successful payments for the same assignment: exactly one wins, second marked for refund", async () => {
      const asgRaceRef = adminDb.collection("assignments").doc("asg-race-001");
      await asgRaceRef.set({
        id: "asg-race-001",
        title: "Concurrent Multi-Payment Race",
        customerId: "cust-phase5",
        budget: 600.0,
        currency: "ZMW",
        status: "awaiting_payment",
      });

      const refA = `DB-PAY-RACE-A-${Date.now()}`;
      const refB = `DB-PAY-RACE-B-${Date.now()}`;

      const payARef = adminDb.collection("payments").doc();
      await payARef.set({
        id: payARef.id,
        referenceId: refA,
        assignmentId: "asg-race-001",
        customerId: "cust-phase5",
        customerEmail: "customer@databoy.com",
        maskedPhone: "260*****2233",
        amount: 600.0,
        currency: "ZMW",
        network: "airtel_money",
        accountNumber: "260977112233",
        status: "Pending",
        createdAt: new Date().toISOString(),
      });

      const payBRef = adminDb.collection("payments").doc();
      await payBRef.set({
        id: payBRef.id,
        referenceId: refB,
        assignmentId: "asg-race-001",
        customerId: "cust-phase5",
        customerEmail: "customer@databoy.com",
        maskedPhone: "260*****2233",
        amount: 600.0,
        currency: "ZMW",
        network: "mtn_money",
        accountNumber: "260966112233",
        status: "Pending",
        createdAt: new Date().toISOString(),
      });

      lipilaService.setMockStatus(refA, "Successful", {
        amount: 600.0,
        currency: "ZMW",
        type: "Collection",
        paymentType: "AirtelMoney",
        accountNumber: "260977112233",
      });

      lipilaService.setMockStatus(refB, "Successful", {
        amount: 600.0,
        currency: "ZMW",
        type: "Collection",
        paymentType: "MTNMoney",
        accountNumber: "260966112233",
      });

      const hA = generateTestWebhookHeaders({ referenceId: refA, status: "Successful", type: "Collection" });
      const hB = generateTestWebhookHeaders({ referenceId: refB, status: "Successful", type: "Collection" });

      const [resA, resB] = await Promise.all([
        makeApiRequest(server, "/api/payments/lipila-callback", "POST", hA.rawBody, null, hA.headers),
        makeApiRequest(server, "/api/payments/lipila-callback", "POST", hB.rawBody, null, hB.headers),
      ]);

      const oneSucceeded = (resA.status === 200 && resB.status === 409) || (resA.status === 409 && resB.status === 200);
      assert(oneSucceeded, `Expected exactly one 200 and one 409, got A=${resA.status}, B=${resB.status}`);

      // Verify assignment has exactly ONE payment reference
      const asgSnap = await adminDb.collection("assignments").doc("asg-race-001").get();
      assert(asgSnap.data().status === "funded", "Assignment should be funded");

      // Verify total ledger credits for this assignment is exactly ONE
      const ledgerSnap = await adminDb.collection("ledger").where("assignmentId", "==", "asg-race-001").get();
      assert(ledgerSnap.size === 1, `Expected exactly 1 ledger credit for assignment, got ${ledgerSnap.size}`);
    });

    // 35. Failed payment reconciliation does not fund
    await test("Failed payment reconciliation does not fund assignment or create ledger entry", async () => {
      const asgFailRef = adminDb.collection("assignments").doc("asg-fail-001");
      await asgFailRef.set({
        id: "asg-fail-001",
        title: "Failed Payment Test",
        customerId: "cust-phase5",
        budget: 150.0,
        currency: "ZMW",
        status: "awaiting_payment",
      });

      const initRes = await makeApiRequest(
        server,
        "/api/payments/initiate",
        "POST",
        {
          assignmentId: "asg-fail-001",
          network: "airtel_money",
          phoneNumber: "0977889900",
        },
        customerToken
      );
      const failRefId = initRes.body.referenceId;

      lipilaService.setMockStatus(failRefId, "Failed", {
        message: "Insufficient subscriber mobile money balance",
      });

      const h = generateTestWebhookHeaders({ referenceId: failRefId, status: "Failed", type: "Collection" });
      const res = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", h.rawBody, null, h.headers);

      assert(res.status === 400, `Expected 400 for failed payment, got ${res.status}`);

      const asgSnap = await asgFailRef.get();
      assert(asgSnap.data().status === "awaiting_payment", "Assignment should remain awaiting_payment");

      const ledgerSnap = await adminDb.collection("ledger").where("referenceId", "==", failRefId).get();
      assert(ledgerSnap.empty, "Ledger should have zero entries");
    });

    // 36. Pending payment reconciliation does not fund
    await test("Pending payment reconciliation leaves assignment awaiting_payment", async () => {
      const asgPendRef = adminDb.collection("assignments").doc("asg-pending-001");
      await asgPendRef.set({
        id: "asg-pending-001",
        title: "Pending Payment Test",
        customerId: "cust-phase5",
        budget: 180.0,
        currency: "ZMW",
        status: "awaiting_payment",
      });

      const initRes = await makeApiRequest(
        server,
        "/api/payments/initiate",
        "POST",
        {
          assignmentId: "asg-pending-001",
          network: "mtn_money",
          phoneNumber: "0966889900",
        },
        customerToken
      );
      const pendRefId = initRes.body.referenceId;

      lipilaService.setMockStatus(pendRefId, "Pending", {
        message: "Pending authorization on handset",
      });

      const pollRes = await makeApiRequest(server, `/api/payments/status/${pendRefId}`, "GET", null, customerToken);
      assert(pollRes.status === 200, `Expected 200, got ${pollRes.status}`);
      assert(pollRes.body.payment.status === "Pending", "Expected Pending status");

      const asgSnap = await asgPendRef.get();
      assert(asgSnap.data().status === "awaiting_payment", "Assignment should remain awaiting_payment");

      const ledgerSnap = await adminDb.collection("ledger").where("referenceId", "==", pendRefId).get();
      assert(ledgerSnap.empty, "Ledger should have zero entries for pending payment");
    });

    // -------------------------------------------------------------------------
    // PART E: END-TO-END WORKFLOWS, HISTORY, ADMIN & DISBURSEMENTS
    // -------------------------------------------------------------------------

    // 37. Callback with unknown reference handled cleanly
    await test("Callback with unknown reference handled cleanly (404)", async () => {
      const payload = { referenceId: "DB-PAY-UNKNOWN-9999", type: "Collection" };
      const { rawBody, headers } = generateTestWebhookHeaders(payload);

      const res = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", rawBody, null, headers);
      assert(res.status === 404, `Expected 404, got ${res.status}`);
    });

    // 38. Independent status check recovers un-callbacked payment (polling reconciles)
    await test("Independent status check recovers un-callbacked payment (polling reconciles)", async () => {
      lipilaService.setMockStatus(zamtelRefId, "Successful", {
        amount: 150.0,
        currency: "ZMW",
        type: "Collection",
        paymentType: "ZamtelKwacha",
        accountNumber: "260955554433",
        transactionId: "LPL-ZAMTEL-TX-7766",
      });

      const res = await makeApiRequest(server, `/api/payments/status/${zamtelRefId}`, "GET", null, customerToken);
      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.payment.status === "Successful", "Expected status recovered to Successful");

      // Verify assignment was funded by reconciliation
      const asgSnap = await adminDb.collection("assignments").doc("asg-lipila-003").get();
      assert(asgSnap.data().status === "funded", "Assignment 3 should be funded");
    });

    // 39. Customer payment history returns only customer's payments with masked phone
    await test("Customer payment history returns only customer's payments with masked phone", async () => {
      const res = await makeApiRequest(server, "/api/payments/history", "GET", null, customerToken);

      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(Array.isArray(res.body.payments), "Expected payments array");
      assert(res.body.payments.length >= 3, `Expected at least 3 payments, got ${res.body.payments.length}`);

      for (const p of res.body.payments) {
        assert(typeof p.maskedPhone === "string" && p.maskedPhone.includes("*****"), `Expected masked phone, got ${p.maskedPhone}`);
        assert(!p.accountNumber, "Full accountNumber should not be in public customer response");
      }
    });

    // 40. Admin can view all collections with network breakdown
    await test("Admin can view all collections with network breakdown", async () => {
      const res = await makeApiRequest(server, "/api/payments/admin/collections", "GET", null, adminToken);

      assert(res.status === 200, `Expected 200, got ${res.status}`);
      assert(res.body.summary, "Expected summary object");
      assert(typeof res.body.summary.totalCollectedZMW === "number", "Expected totalCollectedZMW");
      assert(res.body.summary.networkCounts.airtel_money >= 1, "Expected airtel count >= 1");
      assert(res.body.summary.networkCounts.mtn_money >= 1, "Expected mtn count >= 1");
      assert(res.body.summary.networkCounts.zamtel_kwacha >= 1, "Expected zamtel count >= 1");
      assert(res.body.collections.length >= 3, "Expected collections array");
    });

    // 41. Writer disbursement request validates mobile money account details
    await test("Writer disbursement request validates mobile money account details", async () => {
      await adminDb.collection("users").doc("writer-phase5").update({
        availableBalance: 500.0,
        totalEarned: 500.0,
      });

      // Attempt 1: Card payout rejection
      const cardRes = await makeApiRequest(
        server,
        "/api/writers/me/payout-request",
        "POST",
        {
          amount: 100,
          paymentMethod: "card",
          paymentDetails: { cardNumber: "4111222233334444" },
        },
        writerToken
      );
      assert(cardRes.status === 400, "Expected 400 for card payout");
      assert(cardRes.body.error.includes("Card payouts are not supported"), "Expected card payout rejection message");

      // Attempt 2: Invalid non-Zambian phone rejection
      const nonZmRes = await makeApiRequest(
        server,
        "/api/writers/me/payout-request",
        "POST",
        {
          amount: 100,
          paymentMethod: "airtel_money",
          paymentDetails: { phoneNumber: "+14155552671" },
        },
        writerToken
      );
      assert(nonZmRes.status === 400, "Expected 400 for non-Zambian phone");

      // Attempt 3: Valid Zambian Mobile Money payout request
      const validRes = await makeApiRequest(
        server,
        "/api/writers/me/payout-request",
        "POST",
        {
          amount: 100,
          paymentMethod: "mtn_money",
          paymentDetails: {
            phoneNumber: "0966123456",
            accountName: "Writer Jane Doe",
          },
        },
        writerToken
      );
      assert(validRes.status === 200 || validRes.status === 201, `Expected 200/201, got ${validRes.status}`);
      assert(validRes.body.success === true, "Expected success: true");
      assert(validRes.body.payoutId, "Expected payoutId returned");
    });

    // -------------------------------------------------------------------------
    // PART F: PHASE 5.4 PRODUCTION CONFIGURATION HARDENING & RESILIENCE (42 - 60)
    // -------------------------------------------------------------------------

    // 42. Production without webhook secret returns 500 Server Misconfiguration
    await test("SEC-01: Production without webhook secret returns 500 Server Misconfiguration", async () => {
      const oldEnv = process.env.NODE_ENV;
      const oldSecret = process.env.LIPILA_WEBHOOK_SECRET;
      try {
        process.env.NODE_ENV = "production";
        delete process.env.LIPILA_WEBHOOK_SECRET;
        const headers = {
          "webhook-id": `msg_sec01_${Date.now()}`,
          "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
          "webhook-signature": "v1,dummy",
          "Content-Type": "application/json",
        };
        const res = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", "{}", null, headers);
        assert(res.status === 500, `Expected 500, got ${res.status}`);
        assert(res.body.message.includes("LIPILA_WEBHOOK_SECRET is not configured"), "Expected configuration error message");
      } finally {
        process.env.NODE_ENV = oldEnv;
        process.env.LIPILA_WEBHOOK_SECRET = oldSecret;
      }
    });

    // 43. Production with placeholder webhook secret returns 500
    await test("SEC-01: Production with placeholder webhook secret returns 500", async () => {
      const oldEnv = process.env.NODE_ENV;
      const oldSecret = process.env.LIPILA_WEBHOOK_SECRET;
      try {
        process.env.NODE_ENV = "production";
        process.env.LIPILA_WEBHOOK_SECRET = "changeme";
        const headers = {
          "webhook-id": `msg_sec01_${Date.now()}`,
          "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
          "webhook-signature": "v1,dummy",
          "Content-Type": "application/json",
        };
        const res = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", "{}", null, headers);
        assert(res.status === 500, `Expected 500, got ${res.status}`);
        assert(res.body.message.includes("insecure placeholder value"), "Expected placeholder error");
      } finally {
        process.env.NODE_ENV = oldEnv;
        process.env.LIPILA_WEBHOOK_SECRET = oldSecret;
      }
    });

    // 44. Production rejecting sandbox webhook secret returns 500
    await test("SEC-01: Production rejecting sandbox webhook secret returns 500", async () => {
      const oldEnv = process.env.NODE_ENV;
      const oldSecret = process.env.LIPILA_WEBHOOK_SECRET;
      try {
        process.env.NODE_ENV = "production";
        process.env.LIPILA_WEBHOOK_SECRET = "whsec_test_lipila_webhook_secret_12345";
        const headers = {
          "webhook-id": `msg_sec01_${Date.now()}`,
          "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
          "webhook-signature": "v1,dummy",
          "Content-Type": "application/json",
        };
        const res = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", "{}", null, headers);
        assert(res.status === 500, `Expected 500, got ${res.status}`);
        assert(res.body.message.includes("Sandbox webhook secret cannot be used in production"), "Expected sandbox secret error in production");
      } finally {
        process.env.NODE_ENV = oldEnv;
        process.env.LIPILA_WEBHOOK_SECRET = oldSecret;
      }
    });

    // 45. Startup validator reports missing or placeholder secret
    await test("SEC-01: Startup validator reports missing or placeholder secret", async () => {
      const oldSecret = process.env.LIPILA_WEBHOOK_SECRET;
      try {
        delete process.env.LIPILA_WEBHOOK_SECRET;
        const check1 = validateWebhookConfig();
        assert(check1.valid === false, "Expected invalid check when secret missing");

        process.env.LIPILA_WEBHOOK_SECRET = "test";
        const check2 = validateWebhookConfig();
        assert(check2.valid === false, "Expected invalid check when placeholder secret");
      } finally {
        process.env.LIPILA_WEBHOOK_SECRET = oldSecret;
      }
    });

    // 46. Production without API key rejects payment initiation with configuration error
    await test("SEC-02: Production without API key rejects payment initiation with configuration error", async () => {
      const oldEnv = process.env.NODE_ENV;
      const oldKey = process.env.LIPILA_API_KEY;
      try {
        process.env.NODE_ENV = "production";
        delete process.env.LIPILA_API_KEY;
        const res = await lipilaService.initiateCollection({
          referenceId: "DB-PROD-NOKEY-1",
          amount: 100,
          narration: "Test",
          accountNumber: "260977112233",
          network: "airtel_money",
        });
        assert(res.success === false, "Expected initiation failure");
        assert(res.message.includes("Valid LIPILA_API_KEY is mandatory in production"), `Expected production API key error, got: ${res.message}`);
      } finally {
        process.env.NODE_ENV = oldEnv;
        if (oldKey === undefined) delete process.env.LIPILA_API_KEY; else process.env.LIPILA_API_KEY = oldKey;
      }
    });

    // 47. Production with placeholder API key rejects payment initiation
    await test("SEC-02: Production with placeholder API key rejects payment initiation", async () => {
      const oldEnv = process.env.NODE_ENV;
      const oldKey = process.env.LIPILA_API_KEY;
      try {
        process.env.NODE_ENV = "production";
        process.env.LIPILA_API_KEY = "your_api_key";
        const res = await lipilaService.initiateCollection({
          referenceId: "DB-PROD-PLACEHOLDER-1",
          amount: 100,
          narration: "Test",
          accountNumber: "260977112233",
          network: "airtel_money",
        });
        assert(res.success === false, "Expected initiation failure with placeholder key");
        assert(res.message.includes("Valid LIPILA_API_KEY is mandatory in production"), `Expected production API key error, got: ${res.message}`);
      } finally {
        process.env.NODE_ENV = oldEnv;
        if (oldKey === undefined) delete process.env.LIPILA_API_KEY; else process.env.LIPILA_API_KEY = oldKey;
      }
    });

    // 48. Production configuration rejects non-allowlisted URLs and invalid startup env (fail-fast)
    await test("SEC-02: Strict URL allowlist and createApp() fail-fast production startup validation", async () => {
      const oldEnv = process.env.NODE_ENV;
      const oldKey = process.env.LIPILA_API_KEY;
      const oldSecret = process.env.LIPILA_WEBHOOK_SECRET;
      const oldBaseUrl = process.env.LIPILA_BASE_URL;
      const oldMock = process.env.LIPILA_MOCK;
      const oldRateEnabled = process.env.RATE_LIMIT_ENABLED;
      const oldRedisUrl = process.env.REDIS_URL;
      try {
        // Explicit URL allowlist checks (https://blz.lipila.io only)
        assert(ALLOWED_PRODUCTION_BASE_URLS.includes("https://blz.lipila.io"), "Expected https://blz.lipila.io allowlisted");
        assert(validateProductionBaseUrl("https://blz.lipila.io").valid === true, "Expected exact prod origin valid");
        assert(validateProductionBaseUrl("https://api.lipila.dev").valid === false, "Expected api.lipila.dev rejected");
        assert(validateProductionBaseUrl("https://evil.example.com").valid === false, "Expected arbitrary host rejected");
        assert(validateProductionBaseUrl("http://blz.lipila.io").valid === false, "Expected non-HTTPS rejected");
        assert(validateProductionBaseUrl("https://blz.lipila.io/v1").valid === false, "Expected path suffix rejected");

        process.env.NODE_ENV = "production";
        process.env.LIPILA_API_KEY = "live_prod_key_1234567890";
        process.env.LIPILA_WEBHOOK_SECRET = "whsec_cHJvZHVjdGlvbl9zZWNyZXRfa2V5XzEyMzQ1Njc4OTA=";
        process.env.LIPILA_MOCK = "false";
        process.env.RATE_LIMIT_ENABLED = "true";
        process.env.REDIS_URL = "redis://127.0.0.1:6379";

        // 1) Non-allowlisted base URL rejects both validateProductionConfig and createApp()
        process.env.LIPILA_BASE_URL = "https://api.lipila.dev";
        const badUrlCheck = lipilaService.validateProductionConfig();
        assert(badUrlCheck.valid === false, "Expected non-allowlisted URL rejected in production");
        let threwBadUrl = false;
        try {
          createApp({ redisSendCommand: async () => "OK" });
        } catch (err) {
          threwBadUrl = true;
        }
        assert(threwBadUrl, "Expected createApp() to throw synchronously when LIPILA_BASE_URL is non-allowlisted in production");

        // 2) LIPILA_MOCK=true in production rejects startup even with valid keys
        process.env.LIPILA_BASE_URL = "https://blz.lipila.io";
        process.env.LIPILA_MOCK = "true";
        let threwMock = false;
        try {
          createApp({ redisSendCommand: async () => "OK" });
        } catch (err) {
          threwMock = true;
        }
        assert(threwMock, "Expected createApp() to throw synchronously when LIPILA_MOCK=true in production");

        // 3) Valid production configuration passes both validator and createApp()
        process.env.LIPILA_MOCK = "false";
        const validCheck = lipilaService.validateProductionConfig();
        assert(validCheck.valid === true, `Expected valid production config, got: ${validCheck.error}`);
        const prodApp = createApp({ redisSendCommand: async () => "OK" });
        assert(Boolean(prodApp), "Expected createApp() to succeed with valid production config");
      } finally {
        process.env.NODE_ENV = oldEnv;
        if (oldKey === undefined) delete process.env.LIPILA_API_KEY; else process.env.LIPILA_API_KEY = oldKey;
        if (oldSecret === undefined) delete process.env.LIPILA_WEBHOOK_SECRET; else process.env.LIPILA_WEBHOOK_SECRET = oldSecret;
        if (oldBaseUrl === undefined) delete process.env.LIPILA_BASE_URL; else process.env.LIPILA_BASE_URL = oldBaseUrl;
        if (oldMock === undefined) delete process.env.LIPILA_MOCK; else process.env.LIPILA_MOCK = oldMock;
        if (oldRateEnabled === undefined) delete process.env.RATE_LIMIT_ENABLED; else process.env.RATE_LIMIT_ENABLED = oldRateEnabled;
        if (oldRedisUrl === undefined) delete process.env.REDIS_URL; else process.env.REDIS_URL = oldRedisUrl;
      }
    });

    // 49. Mock payment mode strictly forbidden in production (with or without API key)
    await test("SEC-02: Mock payment mode strictly forbidden in production even with valid API key", async () => {
      const oldEnv = process.env.NODE_ENV;
      const oldMock = process.env.LIPILA_MOCK;
      const oldKey = process.env.LIPILA_API_KEY;
      const oldUrl = process.env.LIPILA_BASE_URL;
      try {
        process.env.NODE_ENV = "production";
        process.env.LIPILA_MOCK = "true";
        process.env.LIPILA_API_KEY = "live_prod_key_1234567890";
        process.env.LIPILA_BASE_URL = "https://blz.lipila.io";

        const configCheck = lipilaService.validateProductionConfig();
        assert(configCheck.valid === false, "Expected validateProductionConfig false when LIPILA_MOCK=true");
        assert(configCheck.error.includes("LIPILA_MOCK"), "Expected LIPILA_MOCK error");

        const res = await lipilaService.initiateCollection({
          referenceId: "DB-PROD-MOCK-1",
          amount: 100,
          narration: "Test",
          accountNumber: "260977112233",
          network: "airtel_money",
        });
        assert(res.success === false, "Expected initiation blocked when LIPILA_MOCK=true in production");
        assert(res.message.includes("LIPILA_MOCK"), "Expected LIPILA_MOCK configuration failure");
      } finally {
        process.env.NODE_ENV = oldEnv;
        if (oldMock === undefined) delete process.env.LIPILA_MOCK; else process.env.LIPILA_MOCK = oldMock;
        if (oldKey === undefined) delete process.env.LIPILA_API_KEY; else process.env.LIPILA_API_KEY = oldKey;
        if (oldUrl === undefined) delete process.env.LIPILA_BASE_URL; else process.env.LIPILA_BASE_URL = oldUrl;
      }
    });

    // 50. Assignment direct-funding endpoint permanently disabled across ALL environments
    await test("SEC-03: Assignment direct-funding /fund rejected with 403 in both production and test/dev", async () => {
      const asgSec3Ref = adminDb.collection("assignments").doc("asg-sec03-001");
      await asgSec3Ref.set({
        id: "asg-sec03-001",
        title: "Direct Funding Security Test",
        customerId: "cust-phase5",
        budget: 500,
        status: "awaiting_payment",
      });

      const oldEnv = process.env.NODE_ENV;
      try {
        for (const envMode of ["production", "test", "development"]) {
          process.env.NODE_ENV = envMode;
          const res = await makeApiRequest(server, "/api/assignments/asg-sec03-001/fund", "POST", null, customerToken);
          assert(res.status === 403, `Expected 403 in ${envMode}, got ${res.status}`);
          const text = JSON.stringify(res.body).toLowerCase();
          assert(text.includes("disabled") || text.includes("lipila"), `Expected disabled message in ${envMode}`);
        }

        // Verify assignment in Firestore remains awaiting_payment
        const snap = await asgSec3Ref.get();
        assert(snap.data().status === "awaiting_payment", "Assignment should remain awaiting_payment");

        // Verify zero ledger entries
        const ledgerSnap = await adminDb.collection("ledger").where("assignmentId", "==", "asg-sec03-001").get();
        assert(ledgerSnap.empty, "Zero ledger entries should exist");
      } finally {
        process.env.NODE_ENV = oldEnv;
      }
    });

    // 51. Production assignment direct-funding rejected for Admin, Writer, and Unauthenticated
    await test("SEC-03: Production assignment direct-funding rejected for Admin, Writer, and Unauthenticated", async () => {
      const oldEnv = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = "production";
        const adminRes = await makeApiRequest(server, "/api/assignments/asg-sec03-001/fund", "POST", null, adminToken);
        assert(adminRes.status === 403, `Expected 403 for Admin, got ${adminRes.status}`);

        const writerRes = await makeApiRequest(server, "/api/assignments/asg-sec03-001/fund", "POST", null, writerToken);
        assert(writerRes.status === 403, `Expected 403 for Writer, got ${writerRes.status}`);

        const unauthRes = await makeApiRequest(server, "/api/assignments/asg-sec03-001/fund", "POST", null, null);
        assert(unauthRes.status === 401, `Expected 401 for Unauth, got ${unauthRes.status}`);
      } finally {
        process.env.NODE_ENV = oldEnv;
      }
    });

    // 52. Production research direct-funding request rejected with 403 Forbidden
    await test("SEC-03: Production research direct-funding request rejected with 403 Forbidden", async () => {
      const resDocRef = adminDb.collection("researchRequests").doc("res-sec03-001");
      await resDocRef.set({
        id: "res-sec03-001",
        title: "Research Direct Funding Test",
        studentId: "cust-phase5",
        quoteAmount: 400,
        status: "awaiting_payment",
      });

      const oldEnv = process.env.NODE_ENV;
      try {
        for (const envMode of ["production", "test"]) {
          process.env.NODE_ENV = envMode;
          const res = await makeApiRequest(server, "/api/research/res-sec03-001/fund", "POST", null, customerToken);
          assert(res.status === 403, `Expected 403 in ${envMode}, got ${res.status}`);
          const text = JSON.stringify(res.body).toLowerCase();
          assert(text.includes("disabled") || text.includes("lipila"), `Expected disabled message in ${envMode}`);
        }

        const snap = await resDocRef.get();
        assert(snap.data().status === "awaiting_payment", "Research should remain awaiting_payment");
      } finally {
        process.env.NODE_ENV = oldEnv;
      }
    });

    // 53. OPS-01 REAL FETCH TRANSPORT: Collection timeout preserves referenceId & marks Unknown (202)
    await test("OPS-01 (Real Fetch): Collection initiation TimeoutError/AbortError preserves referenceId as Unknown", async () => {
      const asgTimeoutRef = adminDb.collection("assignments").doc("asg-timeout-001");
      await asgTimeoutRef.set({
        id: "asg-timeout-001",
        title: "Timeout Preservation Test",
        customerId: "cust-phase5",
        budget: 350.0,
        currency: "ZMW",
        status: "awaiting_payment",
      });

      const oldMock = process.env.LIPILA_MOCK;
      const oldKey = process.env.LIPILA_API_KEY;
      let observedSignal = false;
      try {
        process.env.LIPILA_MOCK = "false";
        process.env.LIPILA_API_KEY = "test_fetch_transport_key";
        lipilaService.setFetchImplementation(async (_url, init) => {
          observedSignal = init?.signal instanceof AbortSignal;
          throw new DOMException("The operation was aborted due to timeout", "TimeoutError");
        });

        const initRes = await makeApiRequest(
          server,
          "/api/payments/initiate",
          "POST",
          {
            assignmentId: "asg-timeout-001",
            network: "airtel_money",
            phoneNumber: "0977889900",
          },
          customerToken
        );

        assert(observedSignal, "Expected fetch called with AbortSignal (AbortSignal.timeout)");
        assert(initRes.status === 202, `Expected 202 Accepted on uncertain timeout, got ${initRes.status}`);
        assert(initRes.body.status === "Unknown", `Expected Unknown status, got ${initRes.body.status}`);
        assert(initRes.body.uncertain === true, "Expected uncertain: true flag");
        const timeoutRefId = initRes.body.referenceId;
        assert(typeof timeoutRefId === "string" && timeoutRefId.startsWith("DB-PAY-"), "Expected referenceId preserved");

        const query = await adminDb.collection("payments").where("referenceId", "==", timeoutRefId).get();
        assert(!query.empty, "Payment record should remain persisted after timeout");
        assert(query.docs[0].data().status === "Unknown", "Persisted payment status should be Unknown");
        assert(query.docs[0].data().uncertain === true, "Persisted payment uncertain flag should be true");

        // Also test AbortError directly at service layer
        lipilaService.setFetchImplementation(async (_url, init) => {
          assert(init?.signal instanceof AbortSignal, "Expected AbortSignal on direct call");
          throw new DOMException("Aborted by transport", "AbortError");
        });
        const directAbort = await lipilaService.initiateCollection({
          referenceId: "DB-ABORT-DIRECT-1",
          amount: 100,
          narration: "Direct abort test",
          accountNumber: "260977889900",
          network: "airtel_money",
        });
        assert(directAbort.success === false && directAbort.status === "Unknown" && directAbort.isTimeout === true, "Expected Unknown + isTimeout on AbortError");
      } finally {
        lipilaService.setFetchImplementation(undefined);
        if (oldMock === undefined) delete process.env.LIPILA_MOCK; else process.env.LIPILA_MOCK = oldMock;
        if (oldKey === undefined) delete process.env.LIPILA_API_KEY; else process.env.LIPILA_API_KEY = oldKey;
      }
    });

    // 54. OPS-01 REAL FETCH TRANSPORT: Re-initiating after Unknown checks Lipila status first and prevents duplicate debit
    await test("OPS-01 (Real Fetch): Retry initiation queries checkCollectionStatus before creating second attempt", async () => {
      const oldMock = process.env.LIPILA_MOCK;
      const oldKey = process.env.LIPILA_API_KEY;
      let statusPollCount = 0;
      let newInitPostCount = 0;
      try {
        process.env.LIPILA_MOCK = "false";
        process.env.LIPILA_API_KEY = "test_fetch_transport_key";

        // Case A: Lipila reports Pending -> second initiate MUST block (409) without POSTing another collection
        lipilaService.setFetchImplementation(async (url, init) => {
          assert(init?.signal instanceof AbortSignal, "Expected AbortSignal");
          if (String(url).includes("/check-status")) {
            statusPollCount++;
            return new Response(JSON.stringify({ status: "Pending", message: "Awaiting customer PIN" }), { status: 200 });
          }
          newInitPostCount++;
          return new Response(JSON.stringify({ status: "Pending" }), { status: 202 });
        });

        const retryPendingRes = await makeApiRequest(
          server,
          "/api/payments/initiate",
          "POST",
          {
            assignmentId: "asg-timeout-001",
            network: "airtel_money",
            phoneNumber: "0977889900",
          },
          customerToken
        );
        assert(statusPollCount === 1, `Expected status check before re-initiate, got ${statusPollCount}`);
        assert(newInitPostCount === 0, `Expected ZERO duplicate POST collections when still Pending, got ${newInitPostCount}`);
        assert(retryPendingRes.status === 409, `Expected 409 Conflict when existing collection is still Pending, got ${retryPendingRes.status}`);

        // Case B: Lipila actually succeeded after original timeout -> re-initiate reconciles existing payment (200 alreadyPaid) with 0 new POSTs!
        lipilaService.setFetchImplementation(async (url) => {
          if (String(url).includes("/check-status")) {
            statusPollCount++;
            return new Response(
              JSON.stringify({
                status: "Successful",
                amount: 350.0,
                currency: "ZMW",
                type: "Collection",
                paymentType: "AirtelMoney",
                accountNumber: "260977889900",
                transactionId: "LPL-RECOVERED-AFTER-TIMEOUT",
              }),
              { status: 200 }
            );
          }
          newInitPostCount++;
          return new Response(JSON.stringify({ status: "Pending" }), { status: 202 });
        });

        const retrySuccessRes = await makeApiRequest(
          server,
          "/api/payments/initiate",
          "POST",
          {
            assignmentId: "asg-timeout-001",
            network: "airtel_money",
            phoneNumber: "0977889900",
          },
          customerToken
        );
        assert(retrySuccessRes.status === 200 && retrySuccessRes.body.alreadyPaid === true, `Expected 200 alreadyPaid reconciliation, got ${retrySuccessRes.status}`);
        assert(newInitPostCount === 0, `Expected ZERO duplicate collection POSTs when original actually succeeded, got ${newInitPostCount}`);
        const asgRecoveredSnap = await adminDb.collection("assignments").doc("asg-timeout-001").get();
        assert(asgRecoveredSnap.data().status === "funded", "Assignment should be funded by recovery");
        const recLedger = await adminDb.collection("ledger").where("assignmentId", "==", "asg-timeout-001").get();
        assert(recLedger.size === 1, `Expected 1 ledger credit after recovery, got ${recLedger.size}`);
      } finally {
        lipilaService.setFetchImplementation(undefined);
        if (oldMock === undefined) delete process.env.LIPILA_MOCK; else process.env.LIPILA_MOCK = oldMock;
        if (oldKey === undefined) delete process.env.LIPILA_API_KEY; else process.env.LIPILA_API_KEY = oldKey;
      }
    });

    // 55. OPS-01 REAL FETCH TRANSPORT: Status check / disbursement timeouts return Unknown & concurrent initiate lock blocks double initiation
    await test("OPS-01 (Real Fetch): checkCollectionStatus/disbursement timeouts return Unknown + concurrent initiation lock", async () => {
      const asgRef = adminDb.collection("assignments").doc("asg-to-rec-001");
      await asgRef.set({
        id: "asg-to-rec-001",
        title: "Timeout & Concurrent Lock Test",
        customerId: "cust-phase5",
        budget: 300,
        currency: "ZMW",
        status: "awaiting_payment",
      });

      const oldMock = process.env.LIPILA_MOCK;
      const oldKey = process.env.LIPILA_API_KEY;
      let externalInitCalls = 0;
      try {
        process.env.LIPILA_MOCK = "false";
        process.env.LIPILA_API_KEY = "test_fetch_transport_key";

        // 1) Status check timeout returns Unknown without falsely marking Failed
        const pollRef = `DB-TO-STAT-${Date.now()}`;
        await adminDb.collection("payments").doc().set({
          id: pollRef,
          referenceId: pollRef,
          assignmentId: "asg-to-rec-001",
          targetType: "assignment",
          targetId: "asg-to-rec-001",
          customerId: "cust-phase5",
          amount: 300,
          currency: "ZMW",
          network: "mtn_money",
          accountNumber: "260966112233",
          status: "Pending",
          createdAt: new Date().toISOString(),
        });

        lipilaService.setFetchImplementation(async (_url, init) => {
          assert(init?.signal instanceof AbortSignal, "Expected AbortSignal on status check");
          throw new DOMException("Status check timed out", "TimeoutError");
        });

        const statusTimeoutRes = await makeApiRequest(server, `/api/payments/status/${pollRef}`, "GET", null, customerToken);
        assert(statusTimeoutRes.status === 200, `Expected 200, got ${statusTimeoutRes.status}`);
        assert(statusTimeoutRes.body.payment.status === "Unknown", `Expected status Unknown on status timeout, got ${statusTimeoutRes.body.payment.status}`);

        // 2) Disbursement timeout returns Unknown & preserves referenceId
        const disbTimeout = await lipilaService.initiateDisbursement({
          referenceId: "DB-DISB-TO-1",
          amount: 120,
          narration: "Payout timeout test",
          accountNumber: "260977000111",
          network: "airtel_money",
        });
        assert(disbTimeout.success === false && disbTimeout.status === "Unknown" && disbTimeout.isTimeout === true && disbTimeout.referenceId === "DB-DISB-TO-1", "Expected Unknown + isTimeout on disbursement timeout");

        // Clear the synthetic pollRef payment so asg-to-rec-001 starts clean for concurrent initiation lock test
        const oldPays = await adminDb.collection("payments").where("assignmentId", "==", "asg-to-rec-001").get();
        for (const d of oldPays.docs) await d.ref.delete();

        lipilaService.setFetchImplementation(async (url, init) => {
          if (String(url).includes("/collections/mobile-money") && init?.method === "POST") {
            externalInitCalls++;
            return new Response(JSON.stringify({ identifier: "LPL-CONC-LOCK", status: "Pending", message: "Accepted" }), { status: 202 });
          }
          return new Response(JSON.stringify({ status: "Pending", message: "Awaiting customer authorization" }), { status: 200 });
        });

        const [initA, initB] = await Promise.all([
          makeApiRequest(server, "/api/payments/initiate", "POST", { assignmentId: "asg-to-rec-001", network: "mtn_money", phoneNumber: "0966112233" }, customerToken),
          makeApiRequest(server, "/api/payments/initiate", "POST", { assignmentId: "asg-to-rec-001", network: "mtn_money", phoneNumber: "0966112233" }, customerToken),
        ]);
        const statuses = [initA.status, initB.status].sort((a, b) => a - b);
        assert(statuses[0] === 200 && statuses[1] === 409, `Expected one 200 and one 409 under concurrent initiate lock, got [${statuses.join(", ")}]`);
        assert(externalInitCalls === 1, `Expected strictly 1 external POST call under concurrent lock, got ${externalInitCalls}`);
      } finally {
        lipilaService.setFetchImplementation(undefined);
        if (oldMock === undefined) delete process.env.LIPILA_MOCK; else process.env.LIPILA_MOCK = oldMock;
        if (oldKey === undefined) delete process.env.LIPILA_API_KEY; else process.env.LIPILA_API_KEY = oldKey;
      }
    });

    // 56. Two simultaneous requests with identical webhook-id: one succeeds, concurrent duplicate rejected with 409
    await test("OPS-02: Two simultaneous requests with identical webhook-id: one claims, concurrent duplicate rejected with 409", async () => {
      const asgRaceRef = adminDb.collection("assignments").doc("asg-ops02-race");
      await asgRaceRef.set({
        id: "asg-ops02-race",
        title: "Atomic Replay Race",
        customerId: "cust-phase5",
        budget: 250,
        currency: "ZMW",
        status: "awaiting_payment",
      });

      const refId = `DB-PAY-OPS02-${Date.now()}`;
      const payDoc = adminDb.collection("payments").doc();
      await payDoc.set({
        id: payDoc.id,
        referenceId: refId,
        assignmentId: "asg-ops02-race",
        customerId: "cust-phase5",
        amount: 250,
        currency: "ZMW",
        network: "airtel_money",
        accountNumber: "260977554433",
        status: "Pending",
        createdAt: new Date().toISOString(),
      });

      const oldMock = process.env.LIPILA_MOCK;
      const oldKey = process.env.LIPILA_API_KEY;
      try {
        process.env.LIPILA_MOCK = "false";
        process.env.LIPILA_API_KEY = "test_fetch_transport_key";
        // Simulate 1500ms HTTP check-status roundtrip so Worker 1 remains in "processing" across Firestore SDK backoff while Worker 2 arrives
        lipilaService.setFetchImplementation(async () => {
          await new Promise((r) => setTimeout(r, 1500));
          return new Response(
            JSON.stringify({
              status: "Successful",
              amount: 250,
              currency: "ZMW",
              type: "Collection",
              paymentType: "AirtelMoney",
              accountNumber: "260977554433",
            }),
            { status: 200 }
          );
        });

        const sharedWebhookId = `msg_concurrent_${Date.now()}`;
        const payload = { referenceId: refId, status: "Successful", type: "Collection" };
        const h1 = generateTestWebhookHeaders(payload, undefined, { webhookId: sharedWebhookId });
        const h2 = generateTestWebhookHeaders(payload, undefined, { webhookId: sharedWebhookId });

        const [res1, res2] = await Promise.all([
          makeApiRequest(server, "/api/payments/lipila-callback", "POST", h1.rawBody, null, h1.headers),
          makeApiRequest(server, "/api/payments/lipila-callback", "POST", h2.rawBody, null, h2.headers),
        ]);

        const has200 = res1.status === 200 || res2.status === 200;
        const has409 = res1.status === 409 || res2.status === 409;
        assert(has200, `Expected at least one 200, got ${res1.status}, ${res2.status}`);
        assert(has409, `Expected concurrent duplicate 409, got ${res1.status}, ${res2.status}`);

        const ledgerSnap = await adminDb.collection("ledger").where("referenceId", "==", refId).get();
        assert(ledgerSnap.size === 1, `Expected exactly 1 ledger entry, got ${ledgerSnap.size}`);
      } finally {
        lipilaService.setFetchImplementation(undefined);
        if (oldMock === undefined) delete process.env.LIPILA_MOCK; else process.env.LIPILA_MOCK = oldMock;
        if (oldKey === undefined) delete process.env.LIPILA_API_KEY; else process.env.LIPILA_API_KEY = oldKey;
      }
    });

    // 57. Completed webhook delivered again returns idempotent 200 without duplicate ledger entries
    await test("OPS-02: Completed webhook delivered again returns idempotent 200 without duplicate ledger entries", async () => {
      const completedWebhookId = `msg_completed_${Date.now()}`;
      const refId = `DB-PAY-COMP-${Date.now()}`;
      const payDoc = adminDb.collection("payments").doc();
      await payDoc.set({
        id: payDoc.id,
        referenceId: refId,
        assignmentId: "asg-completed-001",
        customerId: "cust-phase5",
        amount: 200,
        currency: "ZMW",
        network: "zamtel_kwacha",
        accountNumber: "260955112233",
        status: "Pending",
        createdAt: new Date().toISOString(),
      });

      const asgRef = adminDb.collection("assignments").doc("asg-completed-001");
      await asgRef.set({
        id: "asg-completed-001",
        title: "Completed Webhook Test",
        customerId: "cust-phase5",
        budget: 200,
        currency: "ZMW",
        status: "awaiting_payment",
      });

      lipilaService.setMockStatus(refId, "Successful", {
        amount: 200,
        currency: "ZMW",
        type: "Collection",
        paymentType: "ZamtelKwacha",
        accountNumber: "260955112233",
      });

      const payload = { referenceId: refId, status: "Successful", type: "Collection" };
      const h1 = generateTestWebhookHeaders(payload, undefined, { webhookId: completedWebhookId });

      const res1 = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", h1.rawBody, null, h1.headers);
      assert(res1.status === 200, `Expected 200, got ${res1.status}`);

      const res2 = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", h1.rawBody, null, h1.headers);
      assert(res2.status === 200, `Expected 200 idempotent, got ${res2.status}`);
      assert(res2.body.message.includes("already processed") || res2.body.message.includes("idempotent"), "Expected idempotent message");

      const ledgerSnap = await adminDb.collection("ledger").where("referenceId", "==", refId).get();
      assert(ledgerSnap.size === 1, `Expected exactly 1 ledger entry, got ${ledgerSnap.size}`);
    });

    // 58. Event processing failure allows safe retry (clears lease)
    await test("OPS-02: Event processing failure allows safe retry (clears lease)", async () => {
      const failedWebhookId = `msg_fail_retry_${Date.now()}`;
      const replayDocRef = adminDb.collection("processedWebhooks").doc(failedWebhookId);

      await replayDocRef.set({
        webhookId: failedWebhookId,
        timestamp: Math.floor(Date.now() / 1000),
        status: "failed",
        errorReason: "Transient error",
        leaseExpiresAt: 0,
        createdAt: new Date().toISOString(),
      });

      const refId = `DB-PAY-RETRY-${Date.now()}`;
      const payDoc = adminDb.collection("payments").doc();
      await payDoc.set({
        id: payDoc.id,
        referenceId: refId,
        assignmentId: "asg-retry-001",
        customerId: "cust-phase5",
        amount: 150,
        currency: "ZMW",
        network: "airtel_money",
        accountNumber: "260977112233",
        status: "Pending",
        createdAt: new Date().toISOString(),
      });

      const asgRef = adminDb.collection("assignments").doc("asg-retry-001");
      await asgRef.set({
        id: "asg-retry-001",
        title: "Retry Lease Test",
        customerId: "cust-phase5",
        budget: 150,
        currency: "ZMW",
        status: "awaiting_payment",
      });

      lipilaService.setMockStatus(refId, "Successful", {
        amount: 150,
        currency: "ZMW",
        type: "Collection",
        paymentType: "AirtelMoney",
        accountNumber: "260977112233",
      });

      const payload = { referenceId: refId, status: "Successful", type: "Collection" };
      const h = generateTestWebhookHeaders(payload, undefined, { webhookId: failedWebhookId });

      const retryRes = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", h.rawBody, null, h.headers);
      assert(retryRes.status === 200, `Expected 200 on retry, got ${retryRes.status}`);

      const snap = await replayDocRef.get();
      assert(snap.data().status === "completed", "Expected status updated to completed");
    });

    // 59. Expired processing lease can be re-acquired for recovery
    await test("OPS-02: Expired processing lease can be re-acquired for recovery", async () => {
      const expiredWebhookId = `msg_expired_lease_${Date.now()}`;
      const replayDocRef = adminDb.collection("processedWebhooks").doc(expiredWebhookId);

      await replayDocRef.set({
        webhookId: expiredWebhookId,
        timestamp: Math.floor(Date.now() / 1000),
        status: "processing",
        leaseExpiresAt: Date.now() - 10000,
        createdAt: new Date(Date.now() - 70000).toISOString(),
      });

      const refId = `DB-PAY-EXP-${Date.now()}`;
      const payDoc = adminDb.collection("payments").doc();
      await payDoc.set({
        id: payDoc.id,
        referenceId: refId,
        assignmentId: "asg-exp-001",
        customerId: "cust-phase5",
        amount: 120,
        currency: "ZMW",
        network: "mtn_money",
        accountNumber: "260966112233",
        status: "Pending",
        createdAt: new Date().toISOString(),
      });

      const asgRef = adminDb.collection("assignments").doc("asg-exp-001");
      await asgRef.set({
        id: "asg-exp-001",
        title: "Expired Lease Recovery Test",
        customerId: "cust-phase5",
        budget: 120,
        currency: "ZMW",
        status: "awaiting_payment",
      });

      lipilaService.setMockStatus(refId, "Successful", {
        amount: 120,
        currency: "ZMW",
        type: "Collection",
        paymentType: "MTNMoney",
        accountNumber: "260966112233",
      });

      const payload = { referenceId: refId, status: "Successful", type: "Collection" };
      const h = generateTestWebhookHeaders(payload, undefined, { webhookId: expiredWebhookId });

      const res = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", h.rawBody, null, h.headers);
      assert(res.status === 200, `Expected 200 on expired lease recovery, got ${res.status}`);

      const snap = await replayDocRef.get();
      assert(snap.data().status === "completed", "Expected status updated to completed");
    });

    // 60. Different webhook IDs for same payment do not produce duplicate ledger entries
    await test("OPS-02: Different webhook IDs for same payment do not produce duplicate ledger entries", async () => {
      const refId = `DB-PAY-DIFF-${Date.now()}`;
      const payDoc = adminDb.collection("payments").doc();
      await payDoc.set({
        id: payDoc.id,
        referenceId: refId,
        assignmentId: "asg-diff-001",
        customerId: "cust-phase5",
        amount: 180,
        currency: "ZMW",
        network: "airtel_money",
        accountNumber: "260977112233",
        status: "Pending",
        createdAt: new Date().toISOString(),
      });

      const asgRef = adminDb.collection("assignments").doc("asg-diff-001");
      await asgRef.set({
        id: "asg-diff-001",
        title: "Different Webhook IDs Test",
        customerId: "cust-phase5",
        budget: 180,
        currency: "ZMW",
        status: "awaiting_payment",
      });

      lipilaService.setMockStatus(refId, "Successful", {
        amount: 180,
        currency: "ZMW",
        type: "Collection",
        paymentType: "AirtelMoney",
        accountNumber: "260977112233",
      });

      const payload = { referenceId: refId, status: "Successful", type: "Collection" };
      const hA = generateTestWebhookHeaders(payload, undefined, { webhookId: `msg_diff_A_${Date.now()}` });
      const hB = generateTestWebhookHeaders(payload, undefined, { webhookId: `msg_diff_B_${Date.now()}` });

      const resA = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", hA.rawBody, null, hA.headers);
      assert(resA.status === 200, `Expected 200, got ${resA.status}`);

      const resB = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", hB.rawBody, null, hB.headers);
      assert(resB.status === 200, `Expected 200, got ${resB.status}`);

      const ledgerSnap = await adminDb.collection("ledger").where("referenceId", "==", refId).get();
      assert(ledgerSnap.size === 1, `Expected exactly 1 ledger entry, got ${ledgerSnap.size}`);
    });

    // -------------------------------------------------------------------------
    // PART G: PHASE 5.6 CRITICAL CORRECTIONS (RESEARCH, FENCING, PAYOUT ATOMICITY)
    // -------------------------------------------------------------------------

    // 61. Research request Lipila checkout, ownership, quote enforcement & reconciliation
    await test("Phase 5.6: Research request Lipila initiation validates ownership/quote, prevents tampering, reconciles once", async () => {
      const createRes = await makeApiRequest(
        server,
        "/api/research",
        "POST",
        {
          title: "Precision Epidemiology Statistical Study",
          requestTypes: ["data_analysis", "final_report"],
          pastedBrief: "Full statistical modelling of regional survey datasets.",
          expectedDeliverable: "Statistical report and tables",
          deadline: "2027-02-15",
        },
        customerToken
      );
      assert(createRes.status === 201, `Expected 201 creating research request, got ${createRes.status}`);
      const reqId = createRes.body.requestId;

      // Reject payment initiation BEFORE admin sets a quote / student accepts it
      const unquotedRes = await makeApiRequest(
        server,
        "/api/payments/initiate",
        "POST",
        { researchRequestId: reqId, network: "airtel_money", phoneNumber: "0977112233" },
        customerToken
      );
      assert(unquotedRes.status === 400, `Expected 400 for unquoted research request, got ${unquotedRes.status}`);

      // Admin sets authoritative quote of 850 ZMW
      const quoteRes = await makeApiRequest(
        server,
        `/api/research/${reqId}/quote`,
        "POST",
        { quoteAmount: 850, quoteNotes: "Includes econometric dataset cleaning" },
        adminToken
      );
      assert(quoteRes.status === 200, `Expected 200 quoting research request, got ${quoteRes.status}`);

      // Student accepts quote -> status awaiting_payment, quoteStatus accepted
      const acceptRes = await makeApiRequest(
        server,
        `/api/research/${reqId}/respond-quote`,
        "POST",
        { accept: true },
        customerToken
      );
      assert(acceptRes.status === 200 && acceptRes.body.status === "awaiting_payment", "Expected awaiting_payment after quote acceptance");

      // Other customer cannot pay for student's research request
      const foreignRes = await makeApiRequest(
        server,
        "/api/payments/initiate",
        "POST",
        { researchRequestId: reqId, network: "airtel_money", phoneNumber: "0977112233" },
        otherCustomerToken
      );
      assert(foreignRes.status === 403, `Expected 403 for non-owner research payment, got ${foreignRes.status}`);

      // Client tries to tamper amount to 1 ZMW -> server uses authoritative quoteAmount (850 ZMW)
      const initRes = await makeApiRequest(
        server,
        "/api/payments/initiate",
        "POST",
        { researchRequestId: reqId, targetType: "research", amount: 1, network: "mtn_money", phoneNumber: "0966112233" },
        customerToken
      );
      assert(initRes.status === 200, `Expected 200 OK for research payment, got ${initRes.status}`);
      assert(initRes.body.amount === 850, `Expected authoritative amount 850, got ${initRes.body.amount}`);
      const resRefId = initRes.body.referenceId;

      lipilaService.setMockStatus(resRefId, "Successful", {
        amount: 850,
        currency: "ZMW",
        type: "Collection",
        paymentType: "MTNMoney",
        accountNumber: "260966112233",
      });
      const cb = generateTestWebhookHeaders({ referenceId: resRefId, status: "Successful", type: "Collection" });
      const cbRes = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", cb.rawBody, null, cb.headers);
      assert(cbRes.status === 200 && cbRes.body.status === "Successful", `Expected 200 Successful, got ${cbRes.status}`);

      const fundedReqSnap = await adminDb.collection("researchRequests").doc(reqId).get();
      const fundedReq = fundedReqSnap.data();
      assert(fundedReq.status === "funded", `Expected status funded, got ${fundedReq.status}`);
      assert(fundedReq.paymentStatus === "funded", "Expected paymentStatus funded");
      assert(fundedReq.quoteStatus === "paid", "Expected quoteStatus paid");
      assert(fundedReq.paymentReference === resRefId, "Expected paymentReference set on researchRequest");

      const ledgerSnap = await adminDb.collection("ledger").where("researchRequestId", "==", reqId).get();
      assert(ledgerSnap.size === 1, `Expected 1 ledger entry for research request, got ${ledgerSnap.size}`);
      assert(ledgerSnap.docs[0].data().amount === 850, "Expected ledger credit of 850 ZMW");

      // Duplicate funding after paid must fail
      const dupInit = await makeApiRequest(
        server,
        "/api/payments/initiate",
        "POST",
        { researchRequestId: reqId, network: "mtn_money", phoneNumber: "0966112233" },
        customerToken
      );
      assert(dupInit.status === 400, `Expected 400 on duplicate research initiation, got ${dupInit.status}`);
    });

    // 62. Stale-worker lease fencing token race test
    await test("Phase 5.6: Stale Worker A cannot overwrite Worker B after lease expiration & re-acquisition", async () => {
      const fencedWebhookId = `msg_fence_race_${Date.now()}`;
      const ts = Math.floor(Date.now() / 1000);

      // Worker A acquires lease at t0
      const leaseA = await acquireWebhookLease(fencedWebhookId, ts, {
        workerId: "worker-A",
        leaseDurationMs: 25,
        nowMs: Date.now(),
      });
      assert(leaseA.valid === true && typeof leaseA.leaseToken === "string", "Worker A should acquire initial leaseToken");

      // Wait until Worker A's short lease expires
      await new Promise((r) => setTimeout(r, 60));

      // Worker B re-acquires expired lease and gets a distinct fencing token
      const leaseB = await acquireWebhookLease(fencedWebhookId, ts, {
        workerId: "worker-B",
        leaseDurationMs: 60000,
        nowMs: Date.now(),
      });
      assert(leaseB.valid === true && typeof leaseB.leaseToken === "string", "Worker B should acquire expired lease");
      assert(leaseB.leaseToken !== leaseA.leaseToken, "Worker B must receive a distinct leaseToken");

      // Worker B completes the webhook first using its token
      const bComplete = await markWebhookCompleted(fencedWebhookId, leaseB.leaseToken, {
        referenceId: "DB-FENCE-PAY-1",
      });
      assert(bComplete.updated === true, "Worker B completion should succeed");

      // Worker A wakes up late and tries renew, complete, and fail with its stale token -> ALL must be fenced out
      const aRenew = await renewWebhookLease(fencedWebhookId, leaseA.leaseToken);
      assert(aRenew.updated === false, "Stale Worker A renewWebhookLease must be rejected");

      const aComplete = await markWebhookCompleted(fencedWebhookId, leaseA.leaseToken, {
        referenceId: "DB-FENCE-STALE-OVERRIDE",
      });
      assert(aComplete.updated === false, "Stale Worker A markWebhookCompleted must be rejected");

      const aFail = await markWebhookFailed(fencedWebhookId, leaseA.leaseToken, "stale failure should not overwrite completed");
      assert(aFail.updated === false, "Stale Worker A markWebhookFailed must be rejected");

      // Confirm Firestore doc still belongs to Worker B's completion
      const docSnap = await adminDb.collection("processedWebhooks").doc(fencedWebhookId).get();
      const docData = docSnap.data();
      assert(docData.status === "completed", `Expected completed status preserved, got ${docData.status}`);
      assert(docData.leaseToken === leaseB.leaseToken, "Completed doc leaseToken must remain Worker B's");
      assert(docData.details?.referenceId === "DB-FENCE-PAY-1", "Worker B metadata must not be overwritten");
    });

    // 63. Concurrent writer payout requests against finite balance prevent negative/double spend
    await test("Phase 5.6: Concurrent writer payout requests block overdraw via single Firestore transaction", async () => {
      await adminDb.collection("users").doc("writer-conc-payout").set({
        uid: "writer-conc-payout",
        displayName: "Concurrent Payout Writer",
        email: "concwriter@databoy.com",
        role: "writer",
        status: "active",
        isVerifiedWriter: true,
        verificationStatus: "approved",
        availableBalance: 150.0,
        reservedBalance: 0,
        totalEarned: 150.0,
        totalPaidOut: 0,
      });
      const concWriterToken = "test-token:writer-conc-payout:writer:concwriter@databoy.com";

      const reqBody = {
        amount: 100,
        paymentMethod: "airtel_money",
        paymentDetails: { phoneNumber: "0977445566" },
      };

      const [res1, res2] = await Promise.all([
        makeApiRequest(server, "/api/writers/me/payout-request", "POST", reqBody, concWriterToken),
        makeApiRequest(server, "/api/writers/me/payout-request", "POST", reqBody, concWriterToken),
      ]);

      const codes = [res1.status, res2.status].sort((a, b) => a - b);
      assert(codes[0] === 201 && (codes[1] === 400 || codes[1] === 409), `Expected one 201 and one 400/409, got [${codes.join(", ")}]`);

      const writerSnap = await adminDb.collection("users").doc("writer-conc-payout").get();
      const w = writerSnap.data();
      assert(w.availableBalance === 50.0, `Expected availableBalance 50.0 (never negative), got ${w.availableBalance}`);
      assert(w.reservedBalance === 100.0, `Expected reservedBalance 100.0, got ${w.reservedBalance}`);

      const payoutsSnap = await adminDb.collection("payoutRequests").where("userId", "==", "writer-conc-payout").get();
      assert(payoutsSnap.size === 1, `Expected strictly 1 payoutRequest created, got ${payoutsSnap.size}`);

      const ledgerSnap = await adminDb.collection("ledger").where("userId", "==", "writer-conc-payout").get();
      assert(ledgerSnap.size === 1, `Expected strictly 1 ledger reservation debit, got ${ledgerSnap.size}`);
    });

    // 64. Atomic writer payout completion (idempotent) & rejection restoration (single-restore)
    await test("Phase 5.6: Atomic admin payout approval is idempotent and rejection restores availableBalance once", async () => {
      await adminDb.collection("users").doc("writer-admin-payout").set({
        uid: "writer-admin-payout",
        displayName: "Atomic Payout Writer",
        email: "adminpayout@databoy.com",
        role: "writer",
        status: "active",
        isVerifiedWriter: true,
        verificationStatus: "approved",
        availableBalance: 250.0,
        reservedBalance: 0,
        totalEarned: 250.0,
        totalPaidOut: 0,
      });
      const payoutWriterToken = "test-token:writer-admin-payout:writer:adminpayout@databoy.com";

      // Request #1: 120 ZMW -> Approve twice -> totalPaidOut increments strictly once
      const req1 = await makeApiRequest(
        server,
        "/api/writers/me/payout-request",
        "POST",
        { amount: 120, paymentMethod: "mtn_money", paymentDetails: { phoneNumber: "0966223344" } },
        payoutWriterToken
      );
      assert(req1.status === 201, `Expected 201, got ${req1.status}`);
      const p1Id = req1.body.payoutId || req1.body.payout?.id || req1.body.id;

      const app1 = await makeApiRequest(server, `/api/admin/payouts/${p1Id}/approve`, "POST", { externalTransactionId: "LPL-MANUAL-01" }, adminToken);
      assert(app1.status === 200, `Expected 200 approving payout, got ${app1.status}`);

      // Second approve attempt must fail cleanly / stay idempotent without double totalPaidOut
      const app2 = await makeApiRequest(server, `/api/admin/payouts/${p1Id}/approve`, "POST", { externalTransactionId: "LPL-MANUAL-01" }, adminToken);
      assert(app2.status === 200 || app2.status === 400, `Expected idempotent 200 or 400 on second approve, got ${app2.status}`);

      let wSnap = await adminDb.collection("users").doc("writer-admin-payout").get();
      assert(wSnap.data().availableBalance === 130.0, `Expected availableBalance 130, got ${wSnap.data().availableBalance}`);
      assert(wSnap.data().reservedBalance === 0, `Expected reservedBalance 0, got ${wSnap.data().reservedBalance}`);
      assert(wSnap.data().totalPaidOut === 120.0, `Expected totalPaidOut 120, got ${wSnap.data().totalPaidOut}`);

      // Request #2: 80 ZMW -> Reject twice -> availableBalance restored once (from 50 back to 130)
      const req2 = await makeApiRequest(
        server,
        "/api/writers/me/payout-request",
        "POST",
        { amount: 80, paymentMethod: "zamtel_kwacha", paymentDetails: { phoneNumber: "0955223344" } },
        payoutWriterToken
      );
      assert(req2.status === 201, `Expected 201 creating 2nd payout, got ${req2.status}`);
      const p2Id = req2.body.payoutId || req2.body.payout?.id || req2.body.id;

      const rej1 = await makeApiRequest(server, `/api/admin/payouts/${p2Id}/reject`, "POST", { notes: "Wrong subscriber number" }, adminToken);
      assert(rej1.status === 200, `Expected 200 rejecting payout, got ${rej1.status}`);

      const rej2 = await makeApiRequest(server, `/api/admin/payouts/${p2Id}/reject`, "POST", { notes: "Duplicate reject" }, adminToken);
      assert(rej2.status === 200 || rej2.status === 400, `Expected idempotent 200 or 400 rejecting already-rejected payout, got ${rej2.status}`);

      wSnap = await adminDb.collection("users").doc("writer-admin-payout").get();
      assert(wSnap.data().availableBalance === 130.0, `Expected availableBalance restored once to 130, got ${wSnap.data().availableBalance}`);
      assert(wSnap.data().reservedBalance === 0, `Expected reservedBalance 0 after reject, got ${wSnap.data().reservedBalance}`);
    });

    // 65. Production assignment creation via POST /api/assignments -> funded in assignments collection
    await test("Phase 5.6: Real POST /api/assignments -> Lipila payment funds assignments doc (never projects)", async () => {
      const createAsg = await makeApiRequest(
        server,
        "/api/assignments",
        "POST",
        {
          title: "Distributed Systems Consensus Paper",
          description: "Analyze Raft and Paxos safety guarantees under network partitions.",
          subject: "Computer Science",
          projectType: "coursework",
          academicLevel: "undergraduate",
          wordCount: 1500,
          deadline: new Date(Date.now() + 86400000 * 5).toISOString(),
          guidelines: "Analyze Raft and Paxos safety guarantees under network partitions.",
        },
        customerToken
      );
      assert(createAsg.status === 201, `Expected 201 creating assignment, got ${createAsg.status}`);
      const realAsgId = createAsg.body.assignmentId || createAsg.body.assignment?.id;
      const realBudget = createAsg.body.budget || createAsg.body.assignment?.budget;

      const initRes = await makeApiRequest(
        server,
        "/api/payments/initiate",
        "POST",
        { assignmentId: realAsgId, network: "zamtel_kwacha", phoneNumber: "0955123456" },
        customerToken
      );
      assert(initRes.status === 200, `Expected 200 initiating payment for real assignment, got ${initRes.status}`);
      const refId = initRes.body.referenceId;

      lipilaService.setMockStatus(refId, "Successful", {
        amount: realBudget,
        currency: "ZMW",
        type: "Collection",
        paymentType: "ZamtelKwacha",
        accountNumber: "260955123456",
      });
      const cb = generateTestWebhookHeaders({ referenceId: refId, status: "Successful", type: "Collection" });
      const cbRes = await makeApiRequest(server, "/api/payments/lipila-callback", "POST", cb.rawBody, null, cb.headers);
      assert(cbRes.status === 200 && cbRes.body.status === "Successful", `Expected 200 Successful, got ${cbRes.status}`);

      const asgDoc = await adminDb.collection("assignments").doc(realAsgId).get();
      assert(asgDoc.exists && asgDoc.data().status === "funded", "Assignment in assignments collection must be funded");
      const staleProjectDoc = await adminDb.collection("projects").doc(realAsgId).get();
      assert(!staleProjectDoc.exists, "Legacy projects collection must never be written");
    });

    // =========================================================================
    // PART G: PHASE 5.8 SECURITY, INTEGRITY & HARDENING REMEDIATION TESTS
    // =========================================================================

    // --- AUDIT-03: Unique Non-Empty External Transaction ID on Payouts ---

    await test("AUDIT-03: Payout approval rejects missing, empty, and whitespace externalTransactionId (400)", async () => {
      await adminDb.collection("users").doc("writer-audit03").set({
        uid: "writer-audit03",
        email: "audit03@writer.zm",
        role: "writer",
        status: "active",
        verificationStatus: "approved",
        availableBalance: 400.0,
        reservedBalance: 0,
        totalEarned: 400.0,
        totalPaidOut: 0,
      });
      const wToken = "test-token:writer-audit03:writer:audit03@writer.zm";

      const pReq = await makeApiRequest(
        server,
        "/api/writers/me/payout-request",
        "POST",
        { amount: 100, paymentMethod: "airtel_money", paymentDetails: { phoneNumber: "0977112233" } },
        wToken
      );
      assert(pReq.status === 201, `Expected 201 creating payout, got ${pReq.status}`);
      const pid = pReq.body.payoutId;

      for (const badBody of [{}, { externalTransactionId: "" }, { externalTransactionId: "   \t\n  " }]) {
        const res = await makeApiRequest(server, `/api/admin/payouts/${pid}/approve`, "POST", badBody, adminToken);
        assert(res.status === 400, `Expected 400 for invalid externalTransactionId ${JSON.stringify(badBody)}, got ${res.status}`);
      }

      const pSnap = await adminDb.collection("payoutRequests").doc(pid).get();
      assert(pSnap.data().status === "pending", "Rejected payout must remain pending");
      const wSnap = await adminDb.collection("users").doc("writer-audit03").get();
      assert(wSnap.data().totalPaidOut === 0, "totalPaidOut must remain 0 after invalid approve");
    });

    await test("AUDIT-03: Valid externalTransactionId completes payout & records trimmed ref, ledger metadata, and audit trail", async () => {
      const wToken = "test-token:writer-audit03:writer:audit03@writer.zm";
      const listRes = await makeApiRequest(server, "/api/admin/payouts", "GET", null, adminToken);
      const pendingPayout = (listRes.body.payouts || []).find((p) => p.userId === "writer-audit03" && p.status === "pending");
      assert(pendingPayout, "Expected pending payout for writer-audit03");

      const appRes = await makeApiRequest(
        server,
        `/api/admin/payouts/${pendingPayout.id}/approve`,
        "POST",
        { externalTransactionId: "  MM-TX-AUDIT03-001  ", confirmationNotes: "Airtel payout batch #7" },
        adminToken
      );
      assert(appRes.status === 200, `Expected 200 completing payout, got ${appRes.status}: ${JSON.stringify(appRes.body)}`);
      assert(appRes.body.externalTransactionId === "MM-TX-AUDIT03-001", "Expected trimmed externalTransactionId");

      const pSnap = await adminDb.collection("payoutRequests").doc(pendingPayout.id).get();
      assert(pSnap.data().externalTransactionId === "MM-TX-AUDIT03-001", "Payout doc missing trimmed externalTransactionId");
      assert(pSnap.data().processedBy === "admin-phase5", "Expected processedBy admin uid");

      const ledgerSnap = await adminDb.collection("ledger").doc(`payout_complete_${pendingPayout.id}`).get();
      assert(ledgerSnap.exists && ledgerSnap.data().metadata?.externalTransactionId === "MM-TX-AUDIT03-001", "Ledger entry must store externalTransactionId metadata");

      const auditSnap = await adminDb.collection("auditLogs").where("targetId", "==", pendingPayout.id).get();
      assert(!auditSnap.empty && auditSnap.docs.some((d) => d.data().details?.externalTransactionId === "MM-TX-AUDIT03-001"), "Audit log must persist externalTransactionId");

      // Second payout request created for reuse test
      const p2Req = await makeApiRequest(
        server,
        "/api/writers/me/payout-request",
        "POST",
        { amount: 50, paymentMethod: "mtn_money", paymentDetails: { phoneNumber: "0966112233" } },
        wToken
      );
      assert(p2Req.status === 201, `Expected 201 creating second payout, got ${p2Req.status}`);
      const p2Id = p2Req.body.payoutId;

      // Exact duplicate reuse across different payout rejected (409)
      const dupExact = await makeApiRequest(
        server,
        `/api/admin/payouts/${p2Id}/approve`,
        "POST",
        { externalTransactionId: "MM-TX-AUDIT03-001" },
        adminToken
      );
      assert(dupExact.status === 409, `Expected 409 for reused externalTransactionId, got ${dupExact.status}`);

      // Case/whitespace variant reuse across different payout rejected (409)
      const dupVariant = await makeApiRequest(
        server,
        `/api/admin/payouts/${p2Id}/approve`,
        "POST",
        { externalTransactionId: "  mm-tx-audit03-001 " },
        adminToken
      );
      assert(dupVariant.status === 409, `Expected 409 for case/whitespace variant reuse, got ${dupVariant.status}`);

      // Retry SAME completed payout with identical ref stays idempotent (200)
      const idemRetry = await makeApiRequest(
        server,
        `/api/admin/payouts/${pendingPayout.id}/approve`,
        "POST",
        { externalTransactionId: "MM-TX-AUDIT03-001" },
        adminToken
      );
      assert(idemRetry.status === 200 && idemRetry.body.alreadyCompleted === true, "Expected idempotent 200 on same payout + same ref");

      // Retry SAME completed payout with DIFFERENT ref conflicts (409)
      const diffRefRetry = await makeApiRequest(
        server,
        `/api/admin/payouts/${pendingPayout.id}/approve`,
        "POST",
        { externalTransactionId: "MM-TX-AUDIT03-OTHER" },
        adminToken
      );
      assert(diffRefRetry.status === 409, `Expected 409 when retrying completed payout with different ref, got ${diffRefRetry.status}`);
    });

    await test("AUDIT-03: Concurrent approvals on two payouts with same externalTransactionId allow strictly one", async () => {
      const wToken = "test-token:writer-audit03:writer:audit03@writer.zm";
      const r1 = await makeApiRequest(
        server,
        "/api/writers/me/payout-request",
        "POST",
        { amount: 55, paymentMethod: "airtel_money", paymentDetails: { phoneNumber: "0977112233" } },
        wToken
      );
      const r2 = await makeApiRequest(
        server,
        "/api/writers/me/payout-request",
        "POST",
        { amount: 65, paymentMethod: "airtel_money", paymentDetails: { phoneNumber: "0977112233" } },
        wToken
      );
      assert(r1.status === 201 && r2.status === 201, `Both payout requests should be created (${r1.status}, ${r2.status})`);

      const sharedRef = "MM-CONC-SHARED-999";
      const [c1, c2] = await Promise.all([
        makeApiRequest(server, `/api/admin/payouts/${r1.body.payoutId}/approve`, "POST", { externalTransactionId: sharedRef }, adminToken),
        makeApiRequest(server, `/api/admin/payouts/${r2.body.payoutId}/approve`, "POST", { externalTransactionId: sharedRef }, adminToken),
      ]);

      const successes = [c1, c2].filter((r) => r.status === 200);
      const conflicts = [c1, c2].filter((r) => r.status === 409);
      assert(successes.length === 1 && conflicts.length === 1, `Expected 1 success + 1 conflict, got statuses [${c1.status}, ${c2.status}]`);
    });

    // --- AUDIT-04: Non-Timeout Transport Errors Map to Unknown / Uncertain ---

    await test("AUDIT-04: Non-timeout initiateCollection errors (ENOTFOUND, ECONNRESET, fetch failed, socket drop) return Unknown/202 and preserve lock", async () => {
      const transportErrors = [
        Object.assign(new Error("getaddrinfo ENOTFOUND sandbox.lipila.dev"), { code: "ENOTFOUND" }),
        Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" }),
        Object.assign(new Error("connect ECONNREFUSED 127.0.0.1:443"), { code: "ECONNREFUSED" }),
        new TypeError("fetch failed"),
      ];

      const oldMock = process.env.LIPILA_MOCK;
      const oldKey = process.env.LIPILA_API_KEY;
      try {
        process.env.LIPILA_MOCK = "false";
        process.env.LIPILA_API_KEY = "test_transport_key";

        for (let i = 0; i < transportErrors.length; i++) {
          const asgId = `asg-neterr-${i}`;
          await adminDb.collection("assignments").doc(asgId).set({
            id: asgId,
            title: `Network Error Test ${i}`,
            customerId: "cust-phase5",
            budget: 180,
            currency: "ZMW",
            status: "awaiting_payment",
          });

          lipilaService.setFetchImplementation(async () => {
            throw transportErrors[i];
          });

          const res = await makeApiRequest(
            server,
            "/api/payments/initiate",
            "POST",
            { assignmentId: asgId, network: "mtn_money", phoneNumber: "0966123456" },
            customerToken
          );
          assert(res.status === 202, `Expected 202 on transport error ${i}, got ${res.status}: ${JSON.stringify(res.body)}`);
          assert(res.body.status === "Unknown" && res.body.uncertain === true, "Expected Unknown + uncertain: true");

          const lockSnap = await adminDb.collection("paymentLocks").doc(`assignment_${asgId}`).get();
          assert(lockSnap.exists, `Payment lock must remain held on transport failure ${i}`);

          // Re-initiate while status endpoint ALSO encounters transport error -> must NOT release lock or trigger 2nd collection
          let initiateCalls = 0;
          lipilaService.setFetchImplementation(async (url) => {
            if (url.includes("/collections/mobile-money")) initiateCalls++;
            throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
          });

          const retryRes = await makeApiRequest(
            server,
            "/api/payments/initiate",
            "POST",
            { assignmentId: asgId, network: "mtn_money", phoneNumber: "0966123456" },
            customerToken
          );
          assert(initiateCalls === 0, "Duplicate collection initiation must be blocked while prior outcome is Unknown");
          assert(
            retryRes.status === 409 &&
              retryRes.body.code === "COLLECTION_OUTCOME_UNCERTAIN" &&
              retryRes.body.status === "Unknown" &&
              retryRes.body.uncertain === true,
            `Expected 409 COLLECTION_OUTCOME_UNCERTAIN with Unknown status on retry, got ${retryRes.status}: ${JSON.stringify(retryRes.body)}`
          );
        }
      } finally {
        lipilaService.setFetchImplementation(undefined);
        if (oldMock === undefined) delete process.env.LIPILA_MOCK;
        else process.env.LIPILA_MOCK = oldMock;
        if (oldKey === undefined) delete process.env.LIPILA_API_KEY;
        else process.env.LIPILA_API_KEY = oldKey;
      }
    });

    await test("AUDIT-04: checkCollectionStatus & initiateDisbursement treat transport failures & malformed JSON as Unknown (never Failed)", async () => {
      const asgId = "asg-status-neterr";
      await adminDb.collection("assignments").doc(asgId).set({
        id: asgId,
        title: "Status Transport Error Recovery",
        customerId: "cust-phase5",
        budget: 210,
        currency: "ZMW",
        status: "awaiting_payment",
      });

      const pollRef = "DB-PAY-NETERR-POLL-01";
      await adminDb.collection("paymentLocks").doc(`assignment_${asgId}`).set({
        activePaymentReferenceId: pollRef,
        targetId: asgId,
        targetType: "assignment",
      });
      await adminDb.collection("payments").add({
        referenceId: pollRef,
        assignmentId: asgId,
        targetType: "assignment",
        targetId: asgId,
        customerId: "cust-phase5",
        amount: 210,
        currency: "ZMW",
        network: "airtel_money",
        accountNumber: "260977112233",
        status: "Pending",
        createdAt: new Date().toISOString(),
      });

      const oldMock = process.env.LIPILA_MOCK;
      const oldKey = process.env.LIPILA_API_KEY;
      try {
        process.env.LIPILA_MOCK = "false";
        process.env.LIPILA_API_KEY = "test_transport_key";

        // 1) EAI_AGAIN on status check keeps lock & transitions Pending -> Unknown (not Failed)
        lipilaService.setFetchImplementation(async () => {
          throw Object.assign(new Error("getaddrinfo EAI_AGAIN"), { code: "EAI_AGAIN" });
        });
        const pollErr = await makeApiRequest(server, `/api/payments/status/${pollRef}`, "GET", null, customerToken);
        assert(pollErr.status === 200, `Expected 200, got ${pollErr.status}`);
        assert(pollErr.body.payment.status === "Unknown" && pollErr.body.payment.uncertain === true, "Expected Unknown/uncertain on EAI_AGAIN");
        assert((await adminDb.collection("paymentLocks").doc(`assignment_${asgId}`).get()).exists, "Lock must NOT be released on EAI_AGAIN");

        // 2) Malformed 200 JSON from Lipila returns Unknown (not Failed)
        lipilaService.setFetchImplementation(async () =>
          new Response("{truncated json", { status: 200, headers: { "Content-Type": "application/json" } })
        );
        const badJsonStatus = await lipilaService.checkCollectionStatus(pollRef);
        assert(badJsonStatus.status === "Unknown" && badJsonStatus.uncertain === true, "Malformed 200 JSON must map to Unknown/uncertain");

        // 3) Disbursement ECONNRESET returns Unknown/uncertain
        lipilaService.setFetchImplementation(async () => {
          throw Object.assign(new Error("read ECONNRESET"), { code: "ECONNRESET" });
        });
        const disbErr = await lipilaService.initiateDisbursement({
          referenceId: "DB-DISB-NETERR",
          amount: 100,
          narration: "Test",
          accountNumber: "260977000111",
          network: "airtel_money",
        });
        assert(disbErr.status === "Unknown" && disbErr.uncertain === true && !JSON.stringify(disbErr).includes("test_transport_key"), "Disbursement network error must be Unknown without leaking secrets");

        // 4) Subsequent status recovery to Successful reconciles payment cleanly
        lipilaService.setFetchImplementation(async () =>
          new Response(
            JSON.stringify({
              referenceId: pollRef,
              status: "Successful",
              amount: 210,
              currency: "ZMW",
              type: "Collection",
              paymentType: "AirtelMoney",
              accountNumber: "260977112233",
              transactionId: "LPL-RECOVERED-NETERR",
            }),
            { status: 200, headers: { "Content-Type": "application/json" } }
          )
        );
        const recovered = await makeApiRequest(server, `/api/payments/status/${pollRef}`, "GET", null, customerToken);
        assert(recovered.status === 200 && recovered.body.payment.status === "Successful", "Subsequent successful poll should reconcile payment");
        assert((await adminDb.collection("assignments").doc(asgId).get()).data().status === "funded", "Assignment should now be funded");
      } finally {
        lipilaService.setFetchImplementation(undefined);
        if (oldMock === undefined) delete process.env.LIPILA_MOCK;
        else process.env.LIPILA_MOCK = oldMock;
        if (oldKey === undefined) delete process.env.LIPILA_API_KEY;
        else process.env.LIPILA_API_KEY = oldKey;
      }
    });

    // --- AUDIT-05: Status Auth & Ownership + CSPRNG Payment Reference IDs ---

    await test("AUDIT-05: GET /api/payments/status/:referenceId requires auth & restricts access to owner or admin only", async () => {
      await adminDb.collection("assignments").doc("asg-audit05").set({
        id: "asg-audit05",
        title: "Private Payment Status Check",
        customerId: "cust-phase5",
        budget: 140,
        currency: "ZMW",
        status: "awaiting_payment",
      });

      const initRes = await makeApiRequest(
        server,
        "/api/payments/initiate",
        "POST",
        { assignmentId: "asg-audit05", network: "airtel_money", phoneNumber: "0977998877" },
        customerToken
      );
      assert(initRes.status === 200, `Expected 200 initiating payment, got ${initRes.status}`);
      const refId = initRes.body.referenceId;

      // Verify CSPRNG format (UUID suffix, never short sequential 4-digit suffix)
      assert(
        /^DB-PAY-[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/.test(refId),
        `Expected CSPRNG UUIDv4 referenceId format, got ${refId}`
      );

      // 1) Unauthenticated -> 401
      const unauth = await makeApiRequest(server, `/api/payments/status/${refId}`, "GET");
      assert(unauth.status === 401, `Expected 401 unauthenticated, got ${unauth.status}`);
      assert(!unauth.body?.payment, "Unauthenticated response must not expose payment data");

      // 2) Unrelated customer -> 403/404 and zero metadata
      const otherCust = await makeApiRequest(server, `/api/payments/status/${refId}`, "GET", null, otherCustomerToken);
      assert(otherCust.status === 403 || otherCust.status === 404, `Expected 403/404 for unrelated customer, got ${otherCust.status}`);
      assert(!otherCust.body?.payment && !otherCust.body?.maskedPhone, "Other customer must see zero payment metadata");

      // 3) Writer -> 403/404 and zero metadata
      const writerAttempt = await makeApiRequest(server, `/api/payments/status/${refId}`, "GET", null, writerToken);
      assert(writerAttempt.status === 403 || writerAttempt.status === 404, `Expected 403/404 for writer, got ${writerAttempt.status}`);
      assert(!writerAttempt.body?.payment, "Writer must see zero payment metadata");

      // 4) Non-existent reference -> 404
      const missingRes = await makeApiRequest(server, "/api/payments/status/DB-PAY-DOES-NOT-EXIST", "GET", null, customerToken);
      assert(missingRes.status === 404, `Expected 404 for missing payment ref, got ${missingRes.status}`);

      // 5) Owning customer -> 200 without raw accountNumber
      const ownerRes = await makeApiRequest(server, `/api/payments/status/${refId}`, "GET", null, customerToken);
      assert(ownerRes.status === 200 && ownerRes.body.payment?.referenceId === refId, "Owner should view payment status");
      assert(ownerRes.body.payment.accountNumber === undefined, "Must never expose raw accountNumber in status response");

      // 6) Admin -> 200
      const adminRes = await makeApiRequest(server, `/api/payments/status/${refId}`, "GET", null, adminToken);
      assert(adminRes.status === 200 && adminRes.body.payment?.referenceId === refId, "Admin should view any payment status");
    });

    // --- AUDIT-06B: Dispute Resolution Escrow & Refund Ledger Accounting ---

    await test("AUDIT-06B: Dispute 'refund' enforces funded escrow & externalRefundReference, records ledger refund, blocks double-settlement", async () => {
      // Seed unfunded assignment + dispute -> reject refund
      await adminDb.collection("assignments").doc("asg-unfunded-disp").set({
        id: "asg-unfunded-disp",
        title: "Unfunded Dispute Assignment",
        customerId: "cust-phase5",
        budget: 200,
        status: "awaiting_payment",
        paymentStatus: "awaiting_payment",
        escrowStatus: "pending_funding",
        payoutStatus: "pending",
      });
      await adminDb.collection("disputes").doc("disp-unfunded").set({
        disputeId: "disp-unfunded",
        relatedType: "assignment",
        relatedId: "asg-unfunded-disp",
        assignmentId: "asg-unfunded-disp",
        studentId: "cust-phase5",
        status: "open",
        reason: "Cancel unfunded",
      });

      const unfundedRefund = await makeApiRequest(
        server,
        "/api/admin/disputes/disp-unfunded/resolve",
        "POST",
        { resolution: "refund", externalRefundReference: "MM-REFUND-UNFUNDED" },
        adminToken
      );
      assert(unfundedRefund.status === 400, `Expected 400 refunding unfunded target, got ${unfundedRefund.status}`);
      assert(!(await adminDb.collection("ledger").doc("refund_asg-unfunded-disp").get()).exists, "Must not write refund ledger on unfunded target");

      // Seed funded assignment + dispute
      await adminDb.collection("assignments").doc("asg-funded-disp-refund").set({
        id: "asg-funded-disp-refund",
        title: "Funded Refund Dispute",
        customerId: "cust-phase5",
        customerEmail: "customer@databoy.com",
        writerId: "writer-phase5",
        budget: 400,
        status: "disputed",
        paymentStatus: "funded",
        escrowStatus: "held",
        payoutStatus: "escrowed",
      });
      await adminDb.collection("disputes").doc("disp-refund-ok").set({
        disputeId: "disp-refund-ok",
        relatedType: "assignment",
        relatedId: "asg-funded-disp-refund",
        assignmentId: "asg-funded-disp-refund",
        studentId: "cust-phase5",
        writerId: "writer-phase5",
        status: "open",
        reason: "Non-delivery",
      });

      // Missing externalRefundReference rejected (400)
      const missingRefRes = await makeApiRequest(
        server,
        "/api/admin/disputes/disp-refund-ok/resolve",
        "POST",
        { resolution: "refund" },
        adminToken
      );
      assert(missingRefRes.status === 400, `Expected 400 missing externalRefundReference, got ${missingRefRes.status}`);

      // Valid refund succeeds & records ledger
      const okRefundRes = await makeApiRequest(
        server,
        "/api/admin/disputes/disp-refund-ok/resolve",
        "POST",
        { resolution: "refund", externalRefundReference: "MM-REFUND-400-ZMW", notes: "Verified manual MM return" },
        adminToken
      );
      assert(okRefundRes.status === 200 && okRefundRes.body.outcome === "refund", `Expected 200 refund outcome, got ${okRefundRes.status}`);

      const refundedAsg = (await adminDb.collection("assignments").doc("asg-funded-disp-refund").get()).data();
      assert(
        refundedAsg.status === "cancelled" && refundedAsg.escrowStatus === "refunded" && refundedAsg.payoutStatus === "refunded",
        "Refunded assignment must set cancelled + refunded statuses"
      );
      const refLedger = (await adminDb.collection("ledger").doc("refund_asg-funded-disp-refund").get()).data();
      assert(refLedger && refLedger.type === "refund" && refLedger.amount === 400 && refLedger.metadata?.externalRefundReference === "MM-REFUND-400-ZMW", "Refund ledger entry missing/invalid");

      // Double-settlement / conflicting complete on refunded dispute rejected (409)
      const conflictComplete = await makeApiRequest(
        server,
        "/api/admin/disputes/disp-refund-ok/resolve",
        "POST",
        { resolution: "complete" },
        adminToken
      );
      assert(conflictComplete.status === 409, `Expected 409 switching resolved dispute outcome, got ${conflictComplete.status}`);
    });

    await test("AUDIT-06B: Dispute 'complete' releases escrow deterministically once & blocks subsequent refund (409)", async () => {
      await adminDb.collection("users").doc("writer-disp-comp").set({
        uid: "writer-disp-comp",
        email: "wcomp@writer.zm",
        role: "writer",
        availableBalance: 0,
        reservedBalance: 0,
        totalEarned: 0,
      });
      await adminDb.collection("assignments").doc("asg-disp-complete").set({
        id: "asg-disp-complete",
        title: "Funded Completion Dispute",
        customerId: "cust-phase5",
        writerId: "writer-disp-comp",
        writerEmail: "wcomp@writer.zm",
        budget: 300,
        status: "disputed",
        paymentStatus: "funded",
        escrowStatus: "held",
        payoutStatus: "escrowed",
      });
      await adminDb.collection("disputes").doc("disp-comp-ok").set({
        disputeId: "disp-comp-ok",
        relatedType: "assignment",
        relatedId: "asg-disp-complete",
        assignmentId: "asg-disp-complete",
        studentId: "cust-phase5",
        writerId: "writer-disp-comp",
        status: "open",
        reason: "Customer unresponsive on final sign-off",
      });

      const compRes = await makeApiRequest(
        server,
        "/api/admin/disputes/disp-comp-ok/resolve",
        "POST",
        { resolution: "complete", notes: "Deliverable verified complete by admin" },
        adminToken
      );
      assert(compRes.status === 200 && compRes.body.outcome === "complete", `Expected 200 complete, got ${compRes.status}`);

      // Idempotent duplicate resolve does not double credit
      const compRetry = await makeApiRequest(
        server,
        "/api/admin/disputes/disp-comp-ok/resolve",
        "POST",
        { resolution: "complete" },
        adminToken
      );
      assert(compRetry.status === 200 && compRetry.body.alreadyResolved === true, "Expected idempotent alreadyResolved on duplicate complete");

      const writerSnap = (await adminDb.collection("users").doc("writer-disp-comp").get()).data();
      assert(writerSnap.availableBalance === 150 && writerSnap.totalEarned === 150, `Expected writer paid 50% (150 ZMW) strictly once, got ${JSON.stringify(writerSnap)}`);

      // Independent new dispute cannot refund already-released assignment
      await adminDb.collection("disputes").doc("disp-post-release-refund").set({
        disputeId: "disp-post-release-refund",
        relatedType: "assignment",
        relatedId: "asg-disp-complete",
        assignmentId: "asg-disp-complete",
        status: "open",
      });
      const doubleSettle = await makeApiRequest(
        server,
        "/api/admin/disputes/disp-post-release-refund/resolve",
        "POST",
        { resolution: "refund", externalRefundReference: "MM-ATTEMPT-DOUBLE" },
        adminToken
      );
      assert(doubleSettle.status === 409, `Expected 409 preventing refund after escrow release, got ${doubleSettle.status}`);
    });

    // --- AUDIT-06C: CORS Origin Allowlist ---

    await test("AUDIT-06C: Disallowed origins rejected (403), configured origins allowed, and requests without Origin succeed", async () => {
      const prevCors = process.env.CORS_ALLOWED_ORIGINS;
      const prevEnv = process.env.NODE_ENV;
      const prevSecret = process.env.LIPILA_WEBHOOK_SECRET;
      const prevLipilaEnv = process.env.LIPILA_ENV;
      const prevApiKey = process.env.LIPILA_API_KEY;
      const prevBaseUrl = process.env.LIPILA_BASE_URL;
      const prevRateEnabled = process.env.RATE_LIMIT_ENABLED;

      try {
        process.env.CORS_ALLOWED_ORIGINS = "https://app.databoy.example, https://admin.databoy.example";
        process.env.NODE_ENV = "production";
        process.env.LIPILA_WEBHOOK_SECRET = "whsec_dGVzdF9saXBpbGFfd2ViaG9va19zZWNyZXRfa2V5XzEyMzQ1Njc4OTA=";
        process.env.LIPILA_ENV = "production";
        process.env.LIPILA_API_KEY = "prod_test_key_non_placeholder_123456";
        process.env.LIPILA_BASE_URL = "https://blz.lipila.io";
        process.env.RATE_LIMIT_ENABLED = "true";

        const inMemScripts = new Map();
        const inMemCounters = new Map();
        const prodCorsApp = createApp({
          redisSendCommand: async (...args) => {
            const cmd = String(args[0] || "").toUpperCase();
            if (cmd === "SCRIPT" && String(args[1] || "").toUpperCase() === "LOAD") {
              const sha = `sha_${inMemScripts.size + 1}`;
              inMemScripts.set(sha, String(args[2] || ""));
              return sha;
            }
            if (cmd === "EVALSHA") {
              const key = String(args[3] || "");
              const ttl = Number(args[4] || 60000);
              const next = (inMemCounters.get(key) || 0) + 1;
              inMemCounters.set(key, next);
              return [next, ttl];
            }
            return "OK";
          },
        });
        const prodServer = http.createServer(prodCorsApp);
        await new Promise((resolve) => prodServer.listen(0, resolve));
        try {
          // 1) Evil cross-origin rejected cleanly with 403 and NO wildcard ACAO header
          const evilRes = await makeApiRequest(prodServer, "/api/health", "GET", null, null, {
            Origin: "https://evil-attacker.example",
          });
          assert(evilRes.status === 403, `Expected 403 for disallowed origin, got ${evilRes.status}`);
          assert(
            !evilRes.headers["access-control-allow-origin"],
            "Disallowed origin must NOT receive Access-Control-Allow-Origin"
          );

          // 2) Dev localhost origin is rejected in production unless explicitly in CORS_ALLOWED_ORIGINS
          const devInProd = await makeApiRequest(prodServer, "/api/health", "GET", null, null, {
            Origin: "http://localhost:3000",
          });
          assert(devInProd.status === 403, `Expected localhost rejected in production CORS mode, got ${devInProd.status}`);

          // 3) Explicitly configured allowlisted origin succeeds
          const okOrigin = await makeApiRequest(prodServer, "/api/health", "GET", null, null, {
            Origin: "https://app.databoy.example",
          });
          assert(okOrigin.status === 200, `Expected 200 for allowed origin, got ${okOrigin.status}`);
          assert(
            okOrigin.headers["access-control-allow-origin"] === "https://app.databoy.example",
            `Expected matching ACAO header, got ${okOrigin.headers["access-control-allow-origin"]}`
          );

          // 4) Server-to-server request with no Origin header succeeds (e.g. webhooks/health)
          const noOrigin = await makeApiRequest(prodServer, "/api/health", "GET", null, null, {});
          assert(noOrigin.status === 200, `Expected 200 for server-to-server request without Origin, got ${noOrigin.status}`);
        } finally {
          prodServer.close();
        }
      } finally {
        if (prevCors === undefined) delete process.env.CORS_ALLOWED_ORIGINS;
        else process.env.CORS_ALLOWED_ORIGINS = prevCors;
        if (prevEnv === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = prevEnv;
        if (prevSecret === undefined) delete process.env.LIPILA_WEBHOOK_SECRET;
        else process.env.LIPILA_WEBHOOK_SECRET = prevSecret;
        if (prevLipilaEnv === undefined) delete process.env.LIPILA_ENV;
        else process.env.LIPILA_ENV = prevLipilaEnv;
        if (prevApiKey === undefined) delete process.env.LIPILA_API_KEY;
        else process.env.LIPILA_API_KEY = prevApiKey;
        if (prevBaseUrl === undefined) delete process.env.LIPILA_BASE_URL;
        else process.env.LIPILA_BASE_URL = prevBaseUrl;
        if (prevRateEnabled === undefined) delete process.env.RATE_LIMIT_ENABLED;
        else process.env.RATE_LIMIT_ENABLED = prevRateEnabled;
      }
    });

    // ============================================================================
    // PHASE 5.14: C-1, C-2, C-3 & STAGING PAYMENT DISABLEMENT REGRESSIONS
    // ============================================================================

    await test("Phase 5.14 C-1: Checkout rejects draft/unpriced assignments and untrusted client pricingBreakdown", async () => {
      await adminDb.collection("assignments").doc("asg-draft-c1").set({
        id: "asg-draft-c1",
        customerId: "cust-phase5",
        status: "draft",
        paymentStatus: "awaiting_payment",
        budget: 1,
        currency: "ZMW",
      });
      const draftRes = await makeApiRequest(
        server,
        "/api/payments/initiate",
        "POST",
        { assignmentId: "asg-draft-c1", network: "airtel_money", phoneNumber: "0977112233" },
        customerToken
      );
      assert(draftRes.status === 400, `Expected 400 rejecting draft assignment checkout, got ${draftRes.status}`);

      await adminDb.collection("assignments").doc("asg-forged-pb").set({
        id: "asg-forged-pb",
        customerId: "cust-phase5",
        status: "awaiting_payment",
        paymentStatus: "awaiting_payment",
        budget: 5,
        pricingBreakdown: { total: 200 },
        currency: "ZMW",
      });
      const mismatchRes = await makeApiRequest(
        server,
        "/api/payments/initiate",
        "POST",
        { assignmentId: "asg-forged-pb", network: "airtel_money", phoneNumber: "0977112233" },
        customerToken
      );
      assert(mismatchRes.status === 400, `Expected 400 rejecting tampered pricingBreakdown, got ${mismatchRes.status}`);
    });

    await test("Phase 5.14 C-2: initiateDisbursement classifies malformed 2xx JSON & 408/429/5xx as Unknown/uncertain", async () => {
      const prevEnv = process.env.NODE_ENV;
      const prevMock = process.env.LIPILA_MOCK;
      const prevApiKey = process.env.LIPILA_API_KEY;
      const prevWebhookSecret = process.env.LIPILA_WEBHOOK_SECRET;
      const prevLipilaEnv = process.env.LIPILA_ENV;
      const prevBaseUrl = process.env.LIPILA_BASE_URL;
      const origFetch = lipilaService.setFetchImplementation ? null : null;

      try {
        process.env.NODE_ENV = "sandbox";
        process.env.LIPILA_MOCK = "false";
        process.env.LIPILA_ENV = "sandbox";
        process.env.LIPILA_BASE_URL = "https://api.lipila.dev";
        process.env.LIPILA_API_KEY = "sb_disbursement_key_phase514";
        process.env.LIPILA_WEBHOOK_SECRET = Buffer.from("phase514_webhook_secret").toString("base64");

        // 1. Malformed 200 response -> must return Unknown/uncertain preserving referenceId
        lipilaService.setFetchImplementation(async () => ({
          ok: true,
          status: 200,
          json: async () => {
            throw new SyntaxError("Unexpected end of JSON input");
          },
        }));
        const badJsonRes = await lipilaService.initiateDisbursement({
          referenceId: "DISB-C2-JSON",
          amount: 120,
          narration: "Writer payout",
          accountNumber: "260977112233",
          network: "airtel_money",
        });
        assert(badJsonRes.status === "Unknown" && badJsonRes.uncertain === true && badJsonRes.success === false,
          `Expected Unknown+uncertain on malformed 200 disbursement JSON, got ${JSON.stringify(badJsonRes)}`);
        assert(badJsonRes.referenceId === "DISB-C2-JSON", "Expected referenceId preserved");

        // 2. Transient HTTP 500 -> must return Unknown/uncertain (never Failed)
        lipilaService.setFetchImplementation(async () => ({
          ok: false,
          status: 500,
          json: async () => ({ message: "Gateway upstream error" }),
        }));
        const transientRes = await lipilaService.initiateDisbursement({
          referenceId: "DISB-C2-500",
          amount: 120,
          narration: "Writer payout",
          accountNumber: "260977112233",
          network: "airtel_money",
        });
        assert(transientRes.status === "Unknown" && transientRes.uncertain === true && transientRes.success === false,
          `Expected Unknown+uncertain on 500 disbursement, got ${JSON.stringify(transientRes)}`);

        // 3. HTTP 429 -> must also return Unknown/uncertain
        lipilaService.setFetchImplementation(async () => ({
          ok: false,
          status: 429,
          json: async () => ({ message: "Rate limited" }),
        }));
        const rateRes = await lipilaService.initiateDisbursement({
          referenceId: "DISB-C2-429",
          amount: 120,
          narration: "Writer payout",
          accountNumber: "260977112233",
          network: "airtel_money",
        });
        assert(rateRes.status === "Unknown" && rateRes.uncertain === true,
          `Expected Unknown+uncertain on 429 disbursement, got ${JSON.stringify(rateRes)}`);
      } finally {
        lipilaService.setFetchImplementation(undefined);
        process.env.NODE_ENV = prevEnv;
        process.env.LIPILA_MOCK = prevMock;
        if (prevApiKey === undefined) delete process.env.LIPILA_API_KEY;
        else process.env.LIPILA_API_KEY = prevApiKey;
        if (prevWebhookSecret === undefined) delete process.env.LIPILA_WEBHOOK_SECRET;
        else process.env.LIPILA_WEBHOOK_SECRET = prevWebhookSecret;
        if (prevLipilaEnv === undefined) delete process.env.LIPILA_ENV;
        else process.env.LIPILA_ENV = prevLipilaEnv;
        if (prevBaseUrl === undefined) delete process.env.LIPILA_BASE_URL;
        else process.env.LIPILA_BASE_URL = prevBaseUrl;
      }
    });

    await test("Phase 5.14 C-3: Duplicate externalRefundReference rejected with 409 & atomic approve+escrow prevents double release", async () => {
      // Seed two funded assignments + disputes
      for (const idx of [1, 2]) {
        await adminDb.collection("assignments").doc(`asg-ref-${idx}`).set({
          id: `asg-ref-${idx}`,
          customerId: "cust-phase5",
          customerEmail: "cust@test.com",
          writerId: "writer-ref-c3",
          status: "disputed",
          paymentStatus: "funded",
          escrowStatus: "held",
          payoutStatus: "escrowed",
          budget: 100,
          currency: "ZMW",
        });
        await adminDb.collection("disputes").doc(`disp-ref-${idx}`).set({
          id: `disp-ref-${idx}`,
          assignmentId: `asg-ref-${idx}`,
          relatedId: `asg-ref-${idx}`,
          relatedType: "assignment",
          status: "open",
          reason: "Quality disagreement",
        });
      }

      const ref1 = await makeApiRequest(
        server,
        "/api/admin/disputes/disp-ref-1/resolve",
        "POST",
        { resolution: "refund", notes: "First refund", externalRefundReference: "MOMO-REFUND-SHARED-001" },
        adminToken
      );
      assert(ref1.status === 200, `Expected 200 on first refund, got ${ref1.status}: ${JSON.stringify(ref1.body)}`);

      // Second different dispute reusing same externalRefundReference MUST fail 409
      const ref2 = await makeApiRequest(
        server,
        "/api/admin/disputes/disp-ref-2/resolve",
        "POST",
        { resolution: "refund", notes: "Duplicate ref attempt", externalRefundReference: "momo-refund-shared-001" },
        adminToken
      );
      assert(ref2.status === 409, `Expected 409 blocking duplicate externalRefundReference, got ${ref2.status}: ${JSON.stringify(ref2.body)}`);

      // Atomic approve + escrow release concurrency test
      await adminDb.collection("users").doc("writer-c3-atomic").set({
        uid: "writer-c3-atomic",
        role: "writer",
        status: "active",
        availableBalance: 0,
        reservedBalance: 0,
        totalEarned: 0,
      });
      await adminDb.collection("users").doc("proof-c3-atomic").set({
        uid: "proof-c3-atomic",
        role: "writer",
        status: "active",
        canProofread: true,
        specialistCapabilities: ["writing", "proofreading"],
        availableBalance: 0,
        reservedBalance: 0,
        totalEarned: 0,
      });
      await adminDb.collection("assignments").doc("asg-atomic-c3").set({
        id: "asg-atomic-c3",
        customerId: "cust-phase5",
        writerId: "writer-c3-atomic",
        writerEmail: "writer@c3.test",
        proofreaderId: "proof-c3-atomic",
        proofreaderEmail: "proof@c3.test",
        title: "Concurrent Approval Escrow Test",
        status: "under_review",
        paymentStatus: "funded",
        escrowStatus: "held",
        payoutStatus: "escrowed",
        budget: 100,
        currency: "ZMW",
      });

      const proofToken = "test-token:proof-c3-atomic:writer:proof@c3.test";
      const [appA, appB] = await Promise.all([
        makeApiRequest(server, "/api/assignments/asg-atomic-c3/approve", "POST", { notes: "OK" }, proofToken),
        makeApiRequest(server, "/api/assignments/asg-atomic-c3/approve", "POST", { notes: "OK" }, proofToken),
      ]);
      assert(appA.status === 200 && appB.status === 200, `Expected 200 on idempotent concurrent approvals, got ${appA.status}/${appB.status}`);

      const wAfter = (await adminDb.collection("users").doc("writer-c3-atomic").get()).data();
      const asgAfter = (await adminDb.collection("assignments").doc("asg-atomic-c3").get()).data();
      assert(wAfter.availableBalance === 50, `Expected writer credited once with 50 ZMW, got ${wAfter.availableBalance}`);
      assert(asgAfter.escrowStatus === "released" && asgAfter.status === "completed", "Expected escrowStatus=released atomically");
    });

    await test("Phase 5.14 Staging: APP_ENV=staging + PAYMENTS_ENABLED=false disables /api/payments/initiate & webhook", async () => {
      const prevAppEnv = process.env.APP_ENV;
      const prevPayEnabled = process.env.PAYMENTS_ENABLED;
      const prevRate = process.env.RATE_LIMIT_ENABLED;
      try {
        process.env.APP_ENV = "staging";
        process.env.PAYMENTS_ENABLED = "false";
        process.env.RATE_LIMIT_ENABLED = "false";

        const stgApp = createApp();
        const stgServer = http.createServer(stgApp);
        await new Promise((r) => stgServer.listen(0, r));
        try {
          const healthRes = await makeApiRequest(stgServer, "/api/health");
          assert(
            healthRes.status === 200 &&
              healthRes.body.environment === "staging" &&
              healthRes.body.infrastructure?.paymentsEnabled === false,
            `Unexpected staging health response: ${JSON.stringify(healthRes.body)}`
          );

          const initBlocked = await makeApiRequest(
            stgServer,
            "/api/payments/initiate",
            "POST",
            { assignmentId: "asg-any", network: "airtel_money", phoneNumber: "0977112233" },
            customerToken
          );
          assert(initBlocked.status === 403 && initBlocked.body.code === "PAYMENTS_DISABLED_IN_STAGING",
            `Expected 403 PAYMENTS_DISABLED_IN_STAGING, got ${initBlocked.status}`);

          const cbBlocked = await makeApiRequest(stgServer, "/api/payments/lipila-callback", "POST", { referenceId: "X" });
          assert(cbBlocked.status === 403 && cbBlocked.body.code === "PAYMENTS_DISABLED_IN_STAGING",
            `Expected 403 blocking callback in staging, got ${cbBlocked.status}`);
        } finally {
          stgServer.close();
        }
      } finally {
        if (prevAppEnv === undefined) delete process.env.APP_ENV;
        else process.env.APP_ENV = prevAppEnv;
        if (prevPayEnabled === undefined) delete process.env.PAYMENTS_ENABLED;
        else process.env.PAYMENTS_ENABLED = prevPayEnabled;
        if (prevRate === undefined) delete process.env.RATE_LIMIT_ENABLED;
        else process.env.RATE_LIMIT_ENABLED = prevRate;
      }
    });

  } finally {
    server.close();
  }

  console.log("\n================================================================================");
  console.log(`PHASE 5.8 LIPILA PAYMENT & SECURITY TEST RESULTS: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests().catch((err) => {
  console.error("FATAL SUITE ERROR:", err);
  process.exit(1);
});
