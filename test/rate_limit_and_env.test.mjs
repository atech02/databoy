import http from "http";
import net from "net";
import crypto from "crypto";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createApp } from "../backend/dist/app.js";
import {
  ALLOWED_PRODUCTION_BASE_URLS,
  SANDBOX_BASE_URL,
  validateLipilaConfig,
} from "../backend/dist/config/env.js";
import { lipilaService } from "../backend/dist/services/lipilaService.js";
import {
  generateTestWebhookHeaders,
  verifyLipilaWebhookSignature,
} from "../backend/dist/services/webhookAuth.js";
import {
  parseTrustProxySetting,
  validateRateLimitConfig,
} from "../backend/dist/middleware/rateLimit.js";

process.env.NODE_ENV = "test";
process.env.ALLOW_TEST_AUTH = "true";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
const PROJECT_ID = process.env.GCLOUD_PROJECT || "databoy-dev";
process.env.GCLOUD_PROJECT = PROJECT_ID;

if (getApps().length === 0) {
  initializeApp({ projectId: PROJECT_ID });
}
const adminDb = getFirestore();

function assert(cond, msg) {
  if (!cond) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

async function clearCollections(cols) {
  for (const col of cols) {
    const snap = await adminDb.collection(col).get();
    const batch = adminDb.batch();
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  }
}

function makeRequest(server, path, method = "GET", body = null, token = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const { port } = server.address();
    const reqHeaders = {
      "Content-Type": "application/json",
      ...headers,
    };
    if (token) {
      reqHeaders["Authorization"] = `Bearer ${token}`;
    }

    const req = http.request(
      { hostname: "127.0.0.1", port, path, method, headers: reqHeaders },
      (res) => {
        let raw = "";
        res.on("data", (c) => (raw += c));
        res.on("end", () => {
          let parsed;
          try {
            parsed = JSON.parse(raw);
          } catch {
            parsed = raw;
          }
          resolve({ status: res.statusCode, body: parsed, headers: res.headers, raw });
        });
      }
    );
    req.on("error", reject);
    if (body !== null) {
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    req.end();
  });
}

function createInMemoryRedisSendCommand() {
  const scripts = new Map();
  const store = new Map(); // key -> { count, expiresAt }
  return async (...args) => {
    const cmd = String(args[0] || "").toUpperCase();
    if (cmd === "SCRIPT" && String(args[1] || "").toUpperCase() === "LOAD") {
      const sha = crypto.createHash("sha1").update(String(args[2] || "")).digest("hex");
      scripts.set(sha, String(args[2] || ""));
      return sha;
    }
    if (cmd === "EVALSHA") {
      const sha = String(args[1] || "");
      const script = scripts.get(sha) || "";
      const key = String(args[3] || "");
      const windowMs = Number(args[4] || 60000);
      const now = Date.now();
      let entry = store.get(key);
      if (script.includes("INCR")) {
        if (!entry || entry.expiresAt <= now) {
          entry = { count: 1, expiresAt: now + windowMs };
          store.set(key, entry);
          return [1, windowMs];
        }
        entry.count += 1;
        return [entry.count, Math.max(1, entry.expiresAt - now)];
      } else {
        if (!entry || entry.expiresAt <= now) {
          return [null, -2];
        }
        return [String(entry.count), Math.max(1, entry.expiresAt - now)];
      }
    }
    if (cmd === "DEL") {
      store.delete(String(args[1] || ""));
      return 1;
    }
    if (cmd === "DECR") {
      const key = String(args[1] || "");
      const entry = store.get(key);
      if (entry) {
        entry.count = Math.max(0, entry.count - 1);
        return entry.count;
      }
      return 0;
    }
    return "OK";
  };
}

async function withEnv(tempEnv, fn) {
  const saved = {};
  for (const key of Object.keys(tempEnv)) {
    saved[key] = process.env[key];
    if (tempEnv[key] === undefined) delete process.env[key];
    else process.env[key] = tempEnv[key];
  }
  try {
    return await fn();
  } finally {
    for (const key of Object.keys(saved)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
}

async function runTests() {
  console.log("================================================================================");
  console.log("PHASE 5.12 — LIPILA ENVIRONMENT CONFIGURATION & API RATE LIMITING TEST SUITE");
  console.log("================================================================================\n");

  let passed = 0;
  let failed = 0;

  async function test(name, fn) {
    try {
      await clearCollections([
        "users",
        "assignments",
        "researchRequests",
        "payments",
        "paymentLocks",
        "processedWebhooks",
        "ledger",
        "disputes",
        "proofreadingTasks",
        "auditLogs",
      ]);
      await fn();
      passed++;
      console.log(`[PASS] ${name}`);
    } catch (err) {
      failed++;
      console.error(`[FAIL] ${name}`);
      console.error(err);
    }
  }

  // ============================================================================
  // PART A: ENVIRONMENT CONFIGURATION TESTS
  // ============================================================================

  await test("ENV-01: Sandbox selects approved URL https://api.lipila.dev", async () => {
    await withEnv(
      {
        NODE_ENV: "development",
        LIPILA_ENV: "sandbox",
        LIPILA_BASE_URL: SANDBOX_BASE_URL,
        LIPILA_API_KEY: "sbx_valid_key_99887766",
        LIPILA_WEBHOOK_SECRET: "whsec_c2FuZGJveF9zZWNyZXRfa2V5XzEyMzQ1Njc4OTA=",
        LIPILA_CURRENCY: "ZMW",
        LIPILA_REQUEST_TIMEOUT_MS: "15000",
      },
      async () => {
        const res = validateLipilaConfig({ requireCredentials: true });
        assert(res.valid === true, `Expected valid sandbox config, got: ${res.error}`);
        assert(res.env === "sandbox", "Expected env sandbox");
        assert(res.baseUrl === "https://api.lipila.dev", `Unexpected URL: ${res.baseUrl}`);
      }
    );
  });

  await test("ENV-02: Production selects approved URL https://blz.lipila.io", async () => {
    await withEnv(
      {
        NODE_ENV: "production",
        LIPILA_ENV: "production",
        LIPILA_BASE_URL: ALLOWED_PRODUCTION_BASE_URLS[0],
        LIPILA_API_KEY: "live_valid_prod_key_99887766",
        LIPILA_WEBHOOK_SECRET: "whsec_cHJvZHVjdGlvbl9zZWNyZXRfa2V5XzEyMzQ1Njc4OTA=",
        LIPILA_MOCK: "false",
      },
      async () => {
        const res = validateLipilaConfig({ requireCredentials: true });
        assert(res.valid === true, `Expected valid prod config, got: ${res.error}`);
        assert(res.env === "production", "Expected env production");
        assert(res.baseUrl === "https://blz.lipila.io", `Unexpected URL: ${res.baseUrl}`);
      }
    );
  });

  await test("ENV-03: Production rejects sandbox URL (https://api.lipila.dev)", async () => {
    await withEnv(
      {
        NODE_ENV: "production",
        LIPILA_ENV: "production",
        LIPILA_BASE_URL: "https://api.lipila.dev",
        LIPILA_API_KEY: "live_valid_prod_key_99887766",
        LIPILA_WEBHOOK_SECRET: "whsec_cHJvZHVjdGlvbl9zZWNyZXRfa2V5XzEyMzQ1Njc4OTA=",
      },
      async () => {
        const res = validateLipilaConfig({ requireCredentials: true });
        assert(res.valid === false, "Expected production to reject sandbox URL");
        assert(res.error.includes("allowlist"), `Unexpected error: ${res.error}`);
      }
    );
  });

  await test("ENV-04: Sandbox rejects production URL (https://blz.lipila.io)", async () => {
    await withEnv(
      {
        NODE_ENV: "development",
        LIPILA_ENV: "sandbox",
        LIPILA_BASE_URL: "https://blz.lipila.io",
        LIPILA_API_KEY: "sbx_valid_key_99887766",
        LIPILA_WEBHOOK_SECRET: "whsec_c2FuZGJveF9zZWNyZXRfa2V5XzEyMzQ1Njc4OTA=",
      },
      async () => {
        const res = validateLipilaConfig({ requireCredentials: true });
        assert(res.valid === false, "Expected sandbox to reject production URL");
        assert(res.error.includes("allowlist"), `Unexpected error: ${res.error}`);
      }
    );
  });

  await test("ENV-05: Arbitrary, HTTP, path-suffixed, and cross-env credentials/URLs are rejected", async () => {
    // Arbitrary URL in sandbox
    await withEnv(
      {
        NODE_ENV: "development",
        LIPILA_ENV: "sandbox",
        LIPILA_BASE_URL: "https://evil-gateway.example",
        LIPILA_API_KEY: "sbx_valid_key_99887766",
        LIPILA_WEBHOOK_SECRET: "whsec_c2FuZGJveF9zZWNyZXRfa2V5XzEyMzQ1Njc4OTA=",
      },
      async () => {
        const r = validateLipilaConfig({ requireCredentials: true });
        assert(r.valid === false, "Expected arbitrary host rejected in sandbox");
      }
    );

    // Non-HTTPS URL in production
    await withEnv(
      {
        NODE_ENV: "production",
        LIPILA_ENV: "production",
        LIPILA_BASE_URL: "http://blz.lipila.io",
        LIPILA_API_KEY: "live_valid_prod_key_99887766",
        LIPILA_WEBHOOK_SECRET: "whsec_cHJvZHVjdGlvbl9zZWNyZXRfa2V5XzEyMzQ1Njc4OTA=",
      },
      async () => {
        const r = validateLipilaConfig({ requireCredentials: true });
        assert(r.valid === false, "Expected HTTP rejected in production");
      }
    );

    // Sandbox with production live_ API key rejected
    await withEnv(
      {
        NODE_ENV: "development",
        LIPILA_ENV: "sandbox",
        LIPILA_BASE_URL: "https://api.lipila.dev",
        LIPILA_API_KEY: "live_secret_prod_key",
        LIPILA_WEBHOOK_SECRET: "whsec_c2FuZGJveF9zZWNyZXRfa2V5XzEyMzQ1Njc4OTA=",
      },
      async () => {
        const r = validateLipilaConfig({ requireCredentials: true });
        assert(r.valid === false, "Expected live_ API key rejected in sandbox");
      }
    );

    // Production NODE_ENV cannot silently switch to LIPILA_ENV=sandbox
    await withEnv(
      {
        NODE_ENV: "production",
        LIPILA_ENV: "sandbox",
      },
      async () => {
        const r = validateLipilaConfig({ requireCredentials: true });
        assert(r.valid === false, "Expected NODE_ENV=production + LIPILA_ENV=sandbox rejected");
      }
    );
  });

  await test("ENV-06: Missing real-payment credentials fail closed in non-test sandbox (never silent mock)", async () => {
    await withEnv(
      {
        NODE_ENV: "development",
        LIPILA_ENV: "sandbox",
        LIPILA_BASE_URL: "https://api.lipila.dev",
        LIPILA_API_KEY: "",
        LIPILA_WEBHOOK_SECRET: "",
        LIPILA_MOCK: undefined,
      },
      async () => {
        const res = await lipilaService.initiateCollection({
          referenceId: "DB-DEV-MISSING-CREDS-1",
          amount: 100,
          narration: "Test",
          accountNumber: "260977123456",
          network: "airtel_money",
        });
        assert(res.success === false, "Must fail closed when credentials missing in development");
        assert(res.status === "Failed", "Expected Failed config refusal without mock");
        assert(res.message.includes("LIPILA_API_KEY"), `Expected missing var name, got: ${res.message}`);
      }
    );
  });

  await test("ENV-07: LIPILA_MOCK=true is forbidden in production AND development", async () => {
    await withEnv(
      {
        NODE_ENV: "production",
        LIPILA_ENV: "production",
        LIPILA_BASE_URL: "https://blz.lipila.io",
        LIPILA_API_KEY: "live_prod_key_99887766",
        LIPILA_WEBHOOK_SECRET: "whsec_cHJvZHVjdGlvbl9zZWNyZXRfa2V5XzEyMzQ1Njc4OTA=",
        LIPILA_MOCK: "true",
      },
      async () => {
        const r = validateLipilaConfig({ requireCredentials: true });
        assert(r.valid === false && r.error.includes("LIPILA_MOCK"), "Expected mock forbidden in production");
      }
    );

    await withEnv(
      {
        NODE_ENV: "development",
        LIPILA_ENV: "sandbox",
        LIPILA_BASE_URL: "https://api.lipila.dev",
        LIPILA_API_KEY: "sbx_real_key_99887766",
        LIPILA_WEBHOOK_SECRET: "whsec_c2FuZGJveF9zZWNyZXRfa2V5XzEyMzQ1Njc4OTA=",
        LIPILA_MOCK: "true",
      },
      async () => {
        const r = validateLipilaConfig({ requireCredentials: true });
        assert(r.valid === false && r.error.includes("LIPILA_MOCK"), "Expected mock forbidden in development");
      }
    );
  });

  await test("ENV-08: Secrets are never exposed in config/webhook errors or API responses", async () => {
    const secretApiKey = "live_ultra_secret_api_key_do_not_leak";
    const secretWebhook = "whsec_c2VjcmV0X2RvX25vdF9sZWFrXzEyMzQ1Njc4OTA=";
    await withEnv(
      {
        NODE_ENV: "development",
        LIPILA_ENV: "sandbox",
        LIPILA_BASE_URL: "https://blz.lipila.io", // mismatched URL triggers error
        LIPILA_API_KEY: secretApiKey,
        LIPILA_WEBHOOK_SECRET: secretWebhook,
      },
      async () => {
        const cfgErr = validateLipilaConfig({ requireCredentials: true });
        assert(cfgErr.valid === false, "Expected URL mismatch failure");
        assert(!cfgErr.error.includes(secretApiKey), "API key leaked in config error");
        assert(!cfgErr.error.includes(secretWebhook), "Webhook secret leaked in config error");

        const hookRes = await verifyLipilaWebhookSignature(
          {
            "webhook-id": "msg_leak_check",
            "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
            "webhook-signature": "v1,invalid",
          },
          "{}",
          secretWebhook
        );
        const serialized = JSON.stringify(hookRes);
        assert(!serialized.includes(secretWebhook), "Webhook secret leaked in verify result");
      }
    );
  });

  // ============================================================================
  // PART B: API RATE LIMITING TESTS
  // ============================================================================

  const custAToken = "test-token:rl-cust-a:customer:custa@databoy.com";
  const custBToken = "test-token:rl-cust-b:customer:custb@databoy.com";
  const writerToken = "test-token:rl-writer:writer:writer@databoy.com";

  async function seedUsers() {
    await adminDb.collection("users").doc("rl-cust-a").set({
      uid: "rl-cust-a",
      email: "custa@databoy.com",
      role: "customer",
      status: "active",
    });
    await adminDb.collection("users").doc("rl-cust-b").set({
      uid: "rl-cust-b",
      email: "custb@databoy.com",
      role: "customer",
      status: "active",
    });
    await adminDb.collection("users").doc("rl-writer").set({
      uid: "rl-writer",
      email: "writer@databoy.com",
      role: "writer",
      status: "active",
      isVerifiedWriter: true,
      verificationStatus: "approved",
      canProofread: true,
      availableBalance: 500,
    });
  }

  await test("RL-01: General API, Login, and Password Recovery limits enforce IP quotas and 429 Retry-After", async () => {
    await withEnv(
      {
        NODE_ENV: "test",
        RATE_LIMIT_ENABLED: "true",
        RATE_LIMIT_STORE: "memory",
        RATE_LIMIT_GENERAL_MAX: "12",
        RATE_LIMIT_AUTH_LOGIN_MAX: "5",
        RATE_LIMIT_PASSWORD_RECOVERY_MAX: "3",
      },
      async () => {
        const app = createApp();
        const server = http.createServer(app);
        await new Promise((r) => server.listen(0, "127.0.0.1", r));
        try {
          // Auth login: 5 allowed, 6th returns 429 with Retry-After
          for (let i = 0; i < 5; i++) {
            const ok = await makeRequest(server, "/api/auth/login-guard", "POST", {});
            assert(ok.status === 200, `Login attempt ${i + 1} expected 200, got ${ok.status}`);
          }
          const blockedLogin = await makeRequest(server, "/api/auth/login-guard", "POST", {});
          assert(blockedLogin.status === 429, `Expected 429 on 6th login, got ${blockedLogin.status}`);
          assert(Number(blockedLogin.headers["retry-after"]) >= 1, "Missing Retry-After header on login 429");
          assert(blockedLogin.body.code === "RATE_LIMIT_EXCEEDED", "Expected RATE_LIMIT_EXCEEDED code");

          // Password recovery: 3 allowed, 4th returns 429 with Retry-After
          for (let i = 0; i < 3; i++) {
            const ok = await makeRequest(server, "/api/auth/password-recovery-guard", "POST", {});
            assert(ok.status === 200, `Recovery attempt ${i + 1} expected 200, got ${ok.status}`);
          }
          const blockedRecovery = await makeRequest(server, "/api/auth/password-recovery-guard", "POST", {});
          assert(blockedRecovery.status === 429, `Expected 429 on 4th recovery, got ${blockedRecovery.status}`);
          assert(Number(blockedRecovery.headers["retry-after"]) >= 1, "Missing Retry-After header on recovery 429");

          // Remaining hits trigger general limiter (5 + 1 + 3 + 1 = 10 already counted against general=12)
          const genOk1 = await makeRequest(server, "/api/health");
          const genOk2 = await makeRequest(server, "/api/health");
          assert(genOk1.status === 200 && genOk2.status === 200, "Expected remaining 2 general requests to succeed");
          const genBlocked = await makeRequest(server, "/api/health");
          assert(genBlocked.status === 429, `Expected 429 on general limit exceed, got ${genBlocked.status}`);
          assert(Number(genBlocked.headers["retry-after"]) >= 1, "Missing Retry-After on general 429");
        } finally {
          server.close();
          await app.shutdownRateLimiters?.();
        }
      }
    );
  });

  await test("RL-02: Assignment & Research creation, File upload, Writer actions, and Disputes are rate limited", async () => {
    await seedUsers();
    await withEnv(
      {
        NODE_ENV: "test",
        RATE_LIMIT_ENABLED: "true",
        RATE_LIMIT_STORE: "memory",
        RATE_LIMIT_GENERAL_MAX: "200",
        RATE_LIMIT_ASSIGNMENT_CREATE_MAX: "5",
        RATE_LIMIT_RESEARCH_CREATE_MAX: "5",
        RATE_LIMIT_DISPUTE_CREATE_MAX: "3",
        RATE_LIMIT_FILE_UPLOAD_MAX: "2",
        RATE_LIMIT_WRITER_ACTION_MAX: "2",
        R2_ACCOUNT_ID: "testaccount123456",
        R2_BUCKET_NAME: "databoy-test-bucket",
        R2_ENDPOINT: "http://127.0.0.1:9999",
        R2_ACCESS_KEY_ID: "test_r2_access_key_id",
        R2_SECRET_ACCESS_KEY: "test_r2_secret_access_key_value",
      },
      async () => {
        const app = createApp();
        const server = http.createServer(app);
        await new Promise((r) => server.listen(0, "127.0.0.1", r));
        try {
          const validDeadline = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
          let createdAsgId = "";

          // Assignment creation: 5 allowed, 6th blocked (429)
          for (let i = 0; i < 5; i++) {
            const res = await makeRequest(
              server,
              "/api/assignments",
              "POST",
              {
                title: `Assignment ${i + 1}`,
                description: "Long valid description for automated testing.",
                academicLevel: "degree",
                deadline: validDeadline,
                pageCount: 2,
              },
              custAToken
            );
            assert(res.status === 201, `Assignment ${i + 1} expected 201, got ${res.status}`);
            createdAsgId = res.body.assignmentId;
          }
          const asgBlocked = await makeRequest(
            server,
            "/api/assignments",
            "POST",
            {
              title: "Assignment 6",
              description: "Should fail rate limit cleanly.",
              academicLevel: "degree",
              deadline: validDeadline,
              pageCount: 2,
            },
            custAToken
          );
          assert(asgBlocked.status === 429, `Expected 429 on 6th assignment create, got ${asgBlocked.status}`);

          // Research creation: 5 allowed, 6th blocked (429)
          for (let i = 0; i < 5; i++) {
            const res = await makeRequest(
              server,
              "/api/research",
              "POST",
              {
                title: `Research ${i + 1}`,
                requestTypes: ["data_analysis"],
                pastedBrief: "Research brief text with sufficient length.",
                expectedDeliverable: "Statistical report",
                deadline: validDeadline,
              },
              custAToken
            );
            assert(res.status === 201, `Research ${i + 1} expected 201, got ${res.status}`);
          }
          const resBlocked = await makeRequest(
            server,
            "/api/research",
            "POST",
            {
              title: "Research 6",
              requestTypes: ["data_analysis"],
              pastedBrief: "Research brief text with sufficient length.",
              expectedDeliverable: "Statistical report",
              deadline: validDeadline,
            },
            custAToken
          );
          assert(resBlocked.status === 429, `Expected 429 on 6th research create, got ${resBlocked.status}`);

          // File upload authorization: 2 allowed (override), 3rd blocked
          for (let i = 0; i < 2; i++) {
            const u = await makeRequest(
              server,
              "/api/uploads/authorize",
              "POST",
              {
                targetType: "assignment",
                targetId: createdAsgId,
                fileName: `doc${i}.pdf`,
                contentType: "application/pdf",
                sizeBytes: 1024,
              },
              custAToken
            );
            assert(u.status === 200, `Upload auth ${i + 1} expected 200, got ${u.status}`);
          }
          const uploadBlocked = await makeRequest(
            server,
            "/api/uploads/authorize",
            "POST",
            {
              targetType: "assignment",
              targetId: createdAsgId,
              fileName: "doc3.pdf",
              contentType: "application/pdf",
              sizeBytes: 1024,
            },
            custAToken
          );
          assert(uploadBlocked.status === 429, `Expected 429 on upload burst, got ${uploadBlocked.status}`);

          // Writer action limiter (claim): 2 allowed, 3rd returns 429
          for (let i = 0; i < 2; i++) {
            const w = await makeRequest(server, `/api/assignments/${createdAsgId}/claim`, "POST", {}, writerToken);
            assert(w.status !== 429, `Writer action ${i + 1} should not yet hit 429, got ${w.status}`);
          }
          const writerBlocked = await makeRequest(
            server,
            `/api/assignments/${createdAsgId}/claim`,
            "POST",
            {},
            writerToken
          );
          assert(writerBlocked.status === 429, `Expected 429 on 3rd writer action, got ${writerBlocked.status}`);

          // Dispute creation: 3 allowed, 4th blocked
          for (let i = 0; i < 3; i++) {
            const d = await makeRequest(
              server,
              `/api/assignments/${createdAsgId}/dispute`,
              "POST",
              { reason: `Quality check ${i + 1}` },
              custAToken
            );
            assert(d.status === 201, `Dispute ${i + 1} expected 201, got ${d.status}`);
          }
          const disputeBlocked = await makeRequest(
            server,
            `/api/assignments/${createdAsgId}/dispute`,
            "POST",
            { reason: "Blocked dispute 4" },
            custAToken
          );
          assert(disputeBlocked.status === 429, `Expected 429 on 4th dispute, got ${disputeBlocked.status}`);
        } finally {
          server.close();
          await app.shutdownRateLimiters?.();
        }
      }
    );
  });

  await test("RL-03: Authenticated UID limits follow user across IPs, unauthenticated callers cannot spoof UIDs, and polling uses higher limit", async () => {
    await seedUsers();
    const sharedRedis = createInMemoryRedisSendCommand();
    await withEnv(
      {
        NODE_ENV: "test",
        RATE_LIMIT_ENABLED: "true",
        RATE_LIMIT_STORE: "redis",
        TRUST_PROXY: "1",
        LIPILA_MOCK: "true",
        RATE_LIMIT_PAYMENT_INITIATE_MAX: "3",
        RATE_LIMIT_PAYMENT_INITIATE_IP_MAX: "50",
        RATE_LIMIT_PAYMENT_STATUS_MAX: "10",
      },
      async () => {
        const app = createApp({ redisSendCommand: sharedRedis });
        const server = http.createServer(app);
        await new Promise((r) => server.listen(0, "127.0.0.1", r));
        try {
          // Seed two assignments for Cust A and one for Cust B
          const asgBase = {
            currency: "ZMW",
            budget: 150,
            status: "awaiting_payment",
            paymentStatus: "awaiting_payment",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
          await adminDb.collection("assignments").doc("asg-uid-1").set({ ...asgBase, customerId: "rl-cust-a" });
          await adminDb.collection("assignments").doc("asg-uid-2").set({ ...asgBase, customerId: "rl-cust-a" });
          await adminDb.collection("assignments").doc("asg-uid-3").set({ ...asgBase, customerId: "rl-cust-a" });
          await adminDb.collection("assignments").doc("asg-uid-b").set({ ...asgBase, customerId: "rl-cust-b" });

          // Unauthenticated request trying to supply customerId in body must receive 401 (authMiddleware runs first!)
          const unauthAttempt = await makeRequest(server, "/api/payments/initiate", "POST", {
            assignmentId: "asg-uid-1",
            customerId: "rl-cust-b",
            network: "airtel_money",
            phoneNumber: "0977112233",
          });
          assert(unauthAttempt.status === 401, `Expected 401 before UID limiter, got ${unauthAttempt.status}`);

          // Cust A makes 3 initiation requests from 3 DIFFERENT X-Forwarded-For IPs -> UID limit still hits on 4th!
          const ips = ["198.51.100.1", "198.51.100.2", "198.51.100.3"];
          let trackedRefId = "";
          for (let i = 0; i < 3; i++) {
            const res = await makeRequest(
              server,
              "/api/payments/initiate",
              "POST",
              { assignmentId: `asg-uid-${i + 1}`, network: "airtel_money", phoneNumber: "0977112233" },
              custAToken,
              { "X-Forwarded-For": ips[i] }
            );
            assert(res.status === 200, `Init ${i + 1} expected 200, got ${res.status}: ${JSON.stringify(res.body)}`);
            trackedRefId = res.body.referenceId;
          }

          // 4th attempt for Cust A from yet another IP is blocked (UID limit enforced!)
          const custABlocked = await makeRequest(
            server,
            "/api/payments/initiate",
            "POST",
            { assignmentId: "asg-uid-1", network: "airtel_money", phoneNumber: "0977112233" },
            custAToken,
            { "X-Forwarded-For": "198.51.100.4" }
          );
          assert(custABlocked.status === 429, `Expected 429 on 4th initiation for UID, got ${custABlocked.status}`);
          assert(Number(custABlocked.headers["retry-after"]) >= 1, "Expected Retry-After header");

          // Cust B on the SAME IP is unaffected (UID-isolated!) and unauth attacker did NOT pollute Cust B!
          const custBOk = await makeRequest(
            server,
            "/api/payments/initiate",
            "POST",
            { assignmentId: "asg-uid-b", network: "mtn_money", phoneNumber: "0966112233" },
            custBToken,
            { "X-Forwarded-For": "198.51.100.4" }
          );
          assert(custBOk.status === 200, `Cust B should succeed on separate UID quota, got ${custBOk.status}`);

          // Cust A can STILL poll payment status cleanly with higher separate polling limit (10 here vs 30 prod default)
          for (let p = 0; p < 5; p++) {
            const pollRes = await makeRequest(
              server,
              `/api/payments/status/${trackedRefId}`,
              "GET",
              null,
              custAToken
            );
            assert(pollRes.status === 200, `Poll ${p + 1} should succeed even though initiation exhausted, got ${pollRes.status}`);
          }
        } finally {
          server.close();
          await app.shutdownRateLimiters?.();
        }
      }
    );
  });

  await test("RL-04: Multi-instance shared Redis store coordinates limits across backend instances", async () => {
    const sharedRedis = createInMemoryRedisSendCommand();
    await withEnv(
      {
        NODE_ENV: "test",
        RATE_LIMIT_ENABLED: "true",
        RATE_LIMIT_STORE: "redis",
        RATE_LIMIT_AUTH_LOGIN_MAX: "4",
      },
      async () => {
        const app1 = createApp({ redisSendCommand: sharedRedis });
        const app2 = createApp({ redisSendCommand: sharedRedis });
        const srv1 = http.createServer(app1);
        const srv2 = http.createServer(app2);
        await new Promise((r) => srv1.listen(0, "127.0.0.1", r));
        await new Promise((r) => srv2.listen(0, "127.0.0.1", r));
        try {
          // 2 hits on Instance 1 + 2 hits on Instance 2 = 4 shared hits
          assert((await makeRequest(srv1, "/api/auth/login-guard", "POST", {})).status === 200, "srv1 #1");
          assert((await makeRequest(srv2, "/api/auth/login-guard", "POST", {})).status === 200, "srv2 #2");
          assert((await makeRequest(srv1, "/api/auth/login-guard", "POST", {})).status === 200, "srv1 #3");
          assert((await makeRequest(srv2, "/api/auth/login-guard", "POST", {})).status === 200, "srv2 #4");

          // 5th hit on EITHER instance must return 429
          const fifthOnSrv1 = await makeRequest(srv1, "/api/auth/login-guard", "POST", {});
          assert(fifthOnSrv1.status === 429, `Expected 429 across shared Redis instances, got ${fifthOnSrv1.status}`);
        } finally {
          srv1.close();
          srv2.close();
          await app1.shutdownRateLimiters?.();
          await app2.shutdownRateLimiters?.();
        }
      }
    );
  });

  await test("RL-05: Production Redis failure fails closed (503) without memory fallback or Redis secret/stack leak", async () => {
    const secretRedisPass = "super_secret_redis_password_do_not_expose";
    const failingRedis = async () => {
      throw new Error(`ECONNREFUSED rediss://default:${secretRedisPass}@redis-internal.prod:6379`);
    };

    await withEnv(
      {
        NODE_ENV: "production",
        LIPILA_ENV: "production",
        LIPILA_BASE_URL: "https://blz.lipila.io",
        LIPILA_API_KEY: "live_valid_prod_key_99887766",
        LIPILA_WEBHOOK_SECRET: "whsec_cHJvZHVjdGlvbl9zZWNyZXRfa2V5XzEyMzQ1Njc4OTA=",
        LIPILA_MOCK: "false",
        RATE_LIMIT_ENABLED: "true",
        RATE_LIMIT_STORE: "redis",
        REDIS_URL: `rediss://default:${secretRedisPass}@redis-internal.prod:6379`,
      },
      async () => {
        // 1) Missing REDIS_URL or memory store in production rejects config validation
        const memCheck = await withEnv({ RATE_LIMIT_STORE: "memory" }, async () => validateRateLimitConfig());
        assert(memCheck.valid === false, "Expected memory store prohibited in production");

        // 2) Live Redis outage fails closed (HTTP 503) and hides internal error details & credentials
        const app = createApp({ redisSendCommand: failingRedis });
        const server = http.createServer(app);
        await new Promise((r) => server.listen(0, "127.0.0.1", r));
        try {
          const res = await makeRequest(server, "/api/payments/initiate", "POST", {});
          assert(res.status === 503, `Expected 503 fail-closed when Redis down in prod, got ${res.status}`);
          assert(!res.raw.includes(secretRedisPass), "Redis password leaked in 503 body!");
          assert(!res.raw.includes("ECONNREFUSED"), "Internal Redis error leaked in 503 body!");
          assert(!res.raw.includes("redis-internal.prod"), "Internal Redis hostname leaked in 503 body!");
        } finally {
          server.close();
          await app.shutdownRateLimiters?.();
        }
      }
    );
  });

  await test("RL-06: Legitimate webhook retries bypass customer limits while enforcing HMAC, locks & uncertainty checks", async () => {
    await seedUsers();
    const secret = "whsec_c2FuZGJveF9zZWNyZXRfa2V5XzEyMzQ1Njc4OTA=";
    await withEnv(
      {
        NODE_ENV: "test",
        LIPILA_MOCK: "true",
        LIPILA_WEBHOOK_SECRET: secret,
        RATE_LIMIT_ENABLED: "true",
        RATE_LIMIT_STORE: "memory",
        RATE_LIMIT_GENERAL_MAX: "2",
        RATE_LIMIT_PAYMENT_INITIATE_MAX: "3",
        RATE_LIMIT_WEBHOOK_MAX: "10",
      },
      async () => {
        const app = createApp();
        const server = http.createServer(app);
        await new Promise((r) => server.listen(0, "127.0.0.1", r));
        try {
          // Seed assignment
          await adminDb.collection("assignments").doc("asg-wh-int").set({
            customerId: "rl-cust-a",
            budget: 250,
            currency: "ZMW",
            status: "awaiting_payment",
            paymentStatus: "awaiting_payment",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });

          // Initiate 1 payment (also consumes general=1), then exhaust general limit (=2)
          const initRes = await makeRequest(
            server,
            "/api/payments/initiate",
            "POST",
            { assignmentId: "asg-wh-int", network: "airtel_money", phoneNumber: "0977112233" },
            custAToken
          );
          assert(initRes.status === 200, `Expected 200 on init, got ${initRes.status}`);
          const refId = initRes.body.referenceId;

          // Repeated initiation hits Pending payment lock (409), NOT lock bypass
          const dupInit = await makeRequest(
            server,
            "/api/payments/initiate",
            "POST",
            { assignmentId: "asg-wh-int", network: "airtel_money", phoneNumber: "0977112233" },
            custAToken
          );
          assert(dupInit.status === 409, `Expected 409 payment lock protection, got ${dupInit.status}`);

          // General limiter now exhausted (2/2) -> /api/health returns 429
          const genBlocked = await makeRequest(server, "/api/health");
          assert(genBlocked.status === 429, `Expected general 429, got ${genBlocked.status}`);

          // Unsigned webhook still MUST fail with 401 (never bypassed)
          const unsignedHook = await makeRequest(
            server,
            "/api/payments/lipila-callback",
            "POST",
            { referenceId: refId, status: "Successful" },
            null,
            {
              "webhook-id": "msg_rl_unsigned_1",
              "webhook-timestamp": String(Math.floor(Date.now() / 1000)),
            }
          );
          assert(unsignedHook.status === 401, `Unsigned webhook must still fail 401, got ${unsignedHook.status}`);

          // Mark Lipila authoritative status Successful and send signed webhook EVEN AFTER customer/general quota exhausted
          lipilaService.setMockStatus(refId, "Successful", {
            amount: 250,
            currency: "ZMW",
            accountNumber: "260977112233",
            type: "Collection",
          });

          const payload = { referenceId: refId, status: "Successful", type: "Collection", transactionId: "TX-RL-1" };
          const { rawBody, headers } = generateTestWebhookHeaders(payload, secret, { webhookId: "msg_rl_wh_1" });
          const hookOk = await makeRequest(server, "/api/payments/lipila-callback", "POST", rawBody, null, headers);
          assert(hookOk.status === 200, `Signed webhook must NOT be blocked by customer/general limit, got ${hookOk.status}`);

          // Legitimate webhook retry (same webhook-id) returns idempotent 200 and only 1 ledger entry exists
          const retryHook = await makeRequest(server, "/api/payments/lipila-callback", "POST", rawBody, null, headers);
          assert(retryHook.status === 200, `Webhook retry expected idempotent 200, got ${retryHook.status}`);
          const ledgerSnap = await adminDb.collection("ledger").where("referenceId", "==", refId).get();
          assert(ledgerSnap.size === 1, `Expected exactly 1 ledger credit, found ${ledgerSnap.size}`);
        } finally {
          server.close();
          await app.shutdownRateLimiters?.();
        }
      }
    );
  });

  await test("RL-07: Permissive TRUST_PROXY=true rejected at validation", async () => {
    const check = parseTrustProxySetting("true", true);
    assert(check.valid === false, "Expected TRUST_PROXY=true rejected");
    const safeCheck = parseTrustProxySetting("1", true);
    assert(safeCheck.valid === true && safeCheck.value === 1, "Expected TRUST_PROXY=1 valid");
  });

  await test("RL-08 (Phase 5.14): Real TCP RESP2 Redis reconnect recovery after mid-session drop (fail-closed 503 during outage)", async () => {
    const scripts = new Map();
    const counters = new Map();
    const activeSockets = new Set();

    function encodeResp(val) {
      if (val === null) return "$-1\r\n";
      if (typeof val === "number") return `:${val}\r\n`;
      if (typeof val === "string") return `$${Buffer.byteLength(val)}\r\n${val}\r\n`;
      if (Array.isArray(val)) return `*${val.length}\r\n${val.map(encodeResp).join("")}`;
      return "+OK\r\n";
    }

    function createMiniRespServer(port = 0) {
      const tcpServer = net.createServer((socket) => {
        activeSockets.add(socket);
        socket.on("close", () => activeSockets.delete(socket));
        let buf = "";
        socket.on("data", (chunk) => {
          buf += chunk.toString("utf8");
          while (buf.includes("\r\n")) {
            const firstCr = buf.indexOf("\r\n");
            const head = buf.slice(0, firstCr);
            if (!head.startsWith("*")) {
              buf = buf.slice(firstCr + 2);
              continue;
            }
            const argc = Number(head.slice(1));
            let pos = firstCr + 2;
            const args = [];
            let incomplete = false;
            for (let i = 0; i < argc; i++) {
              const cr = buf.indexOf("\r\n", pos);
              if (cr === -1) {
                incomplete = true;
                break;
              }
              const len = Number(buf.slice(pos + 1, cr));
              const start = cr + 2;
              if (buf.length < start + len + 2) {
                incomplete = true;
                break;
              }
              args.push(buf.slice(start, start + len));
              pos = start + len + 2;
            }
            if (incomplete) break;
            buf = buf.slice(pos);

            const cmd = (args[0] || "").toUpperCase();
            if (cmd === "HELLO") {
              socket.write("%7\r\n$6\r\nserver\r\n$5\r\nredis\r\n$7\r\nversion\r\n$5\r\n7.0.0\r\n$5\r\nproto\r\n:2\r\n$2\r\nid\r\n:1\r\n$4\r\nmode\r\n$10\r\nstandalone\r\n$4\r\nrole\r\n$6\r\nmaster\r\n$7\r\nmodules\r\n*0\r\n");
            } else if (cmd === "PING") {
              socket.write("+PONG\r\n");
            } else if (cmd === "CLIENT") {
              socket.write("+OK\r\n");
            } else if (cmd === "SCRIPT" && (args[1] || "").toUpperCase() === "LOAD") {
              const sha = crypto.createHash("sha1").update(args[2] || "").digest("hex");
              scripts.set(sha, args[2] || "");
              socket.write(encodeResp(sha));
            } else if (cmd === "EVALSHA") {
              const key = args[3] || "k";
              const windowMs = Number(args[4] || 60000);
              const next = (counters.get(key) || 0) + 1;
              counters.set(key, next);
              socket.write(encodeResp([next, windowMs]));
            } else {
              socket.write("+OK\r\n");
            }
          }
        });
      });
      return new Promise((resolve) => tcpServer.listen(port, "127.0.0.1", () => resolve(tcpServer)));
    }

    let tcpRedis = await createMiniRespServer(0);
    const redisPort = tcpRedis.address().port;

    await withEnv(
      {
        NODE_ENV: "test",
        RATE_LIMIT_ENABLED: "true",
        RATE_LIMIT_STORE: "redis",
        REDIS_URL: `redis://127.0.0.1:${redisPort}`,
        REDIS_CONNECT_TIMEOUT_MS: "1000",
        REDIS_RECONNECT_COOLDOWN_MS: "50",
        RATE_LIMIT_GENERAL_MAX: "2",
      },
      async () => {
        const app = createApp({ storeKeyPrefix: "rl:tcp:test" });
        const server = http.createServer(app);
        await new Promise((r) => server.listen(0, r));
        try {
          // 1) Initial request connects and succeeds
          const r1 = await makeRequest(server, "/api/health");
          assert(r1.status === 200, `Expected 200 while TCP Redis online, got ${r1.status}`);

          // 2) Simulate mid-session Redis socket drop & outage
          for (const s of activeSockets) s.destroy();
          await new Promise((r) => tcpRedis.close(r));
          await new Promise((r) => setTimeout(r, 80));

          const downRes = await makeRequest(server, "/api/health");
          assert(downRes.status === 503, `Expected 503 fail-closed when Redis down, got ${downRes.status}`);

          // 3) Restart Redis on the SAME port -> client MUST automatically reconnect
          tcpRedis = await createMiniRespServer(redisPort);
          let recovered = null;
          for (let i = 0; i < 15; i++) {
            await new Promise((r) => setTimeout(r, 220));
            const attempt = await makeRequest(server, "/api/health");
            if (attempt.status === 200) {
              recovered = attempt;
              break;
            }
          }
          assert(recovered && recovered.status === 200, "Expected rateLimit client to automatically recover after Redis restart");

          // 4) Counter limit (=2) triggers 429 cleanly after recovery
          const blockedAfterRecover = await makeRequest(server, "/api/health");
          assert(blockedAfterRecover.status === 429, `Expected 429 on quota exhaustion after recovery, got ${blockedAfterRecover.status}`);
        } finally {
          server.close();
          await app.shutdownRateLimiters?.();
          for (const s of activeSockets) s.destroy();
          await new Promise((r) => tcpRedis.close(() => r()));
        }
      }
    );
  });

  await test("RL-09 (Phase 5.14): Upload authorize checks ownership & /api/writers/apply rate limit enforces cap", async () => {
    await withEnv(
      {
        NODE_ENV: "test",
        RATE_LIMIT_ENABLED: "true",
        RATE_LIMIT_WRITER_ACTION_MAX: "1",
        R2_ACCOUNT_ID: "testaccount123456",
        R2_BUCKET_NAME: "databoy-test-bucket",
        R2_ENDPOINT: "http://127.0.0.1:9999",
        R2_ACCESS_KEY_ID: "test_r2_access_key_id",
        R2_SECRET_ACCESS_KEY: "test_r2_secret_access_key_value",
      },
      async () => {
        await adminDb.collection("users").doc("cust_upload_owner").set({
          uid: "cust_upload_owner",
          role: "customer",
          status: "active",
        });
        await adminDb.collection("users").doc("stranger_upload").set({
          uid: "stranger_upload",
          role: "customer",
          status: "active",
        });
        await adminDb.collection("assignments").doc("asg-upload-own").set({
          id: "asg-upload-own",
          customerId: "cust_upload_owner",
          status: "awaiting_payment",
        });

        const app = createApp({ redisSendCommand: createInMemoryRedisSendCommand(), storeKeyPrefix: "rl:p514" });
        const server = http.createServer(app);
        await new Promise((r) => server.listen(0, r));
        try {
          const strangerTok = "test-token:stranger_upload:customer:stranger@test.com";
          const ownerTok = "test-token:cust_upload_owner:customer:owner@test.com";

          const denied = await makeRequest(
            server,
            "/api/uploads/authorize",
            "POST",
            {
              targetType: "assignment",
              targetId: "asg-upload-own",
              fileName: "../evil.pdf",
              contentType: "application/pdf",
              sizeBytes: 1024,
            },
            strangerTok
          );
          assert(denied.status === 400 || denied.status === 403, `Expected 400/403 rejecting unauthorized upload, got ${denied.status}`);

          const pendingOk = await makeRequest(
            server,
            "/api/uploads/authorize",
            "POST",
            {
              targetType: "pending",
              targetId: "cust_upload_owner",
              fileName: "brief.pdf",
              contentType: "application/pdf",
              sizeBytes: 2048,
            },
            ownerTok
          );
          assert(pendingOk.status === 200 && pendingOk.body.storagePath.startsWith("pending/cust_upload_owner/"),
            `Expected 200 with pending storagePath, got ${pendingOk.status}`);

          await adminDb.collection("users").doc("writer_apply_rl").set({
            uid: "writer_apply_rl",
            role: "customer",
            status: "active",
          });
          const applyTok = "test-token:writer_apply_rl:customer:app@test.com";
          const appPayload = {
            university: "UNZA",
            major: "CS",
            yearOfStudy: "4",
            subjects: ["CS"],
            phone: "0977112233",
          };
          const a1 = await makeRequest(server, "/api/writers/apply", "POST", appPayload, applyTok);
          assert(a1.status === 200, `Expected 200 on first /api/writers/apply, got ${a1.status}`);
          const a2 = await makeRequest(server, "/api/writers/apply", "POST", appPayload, applyTok);
          assert(a2.status === 429, `Expected 429 rate limiting /api/writers/apply, got ${a2.status}`);
        } finally {
          server.close();
          await app.shutdownRateLimiters?.();
        }
      }
    );
  });

  console.log("\n================================================================================");
  console.log(`PHASE 5.12 ENV & RATE LIMIT RESULTS: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Fatal error running Phase 5.12 test suite:", err);
  process.exit(1);
});
