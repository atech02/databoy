import http from "http";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { initializeTestEnvironment, assertFails } from "@firebase/rules-unit-testing";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { createApp } from "../backend/dist/app.js";
import { validateR2Config } from "../backend/dist/config/env.js";
import { r2StorageService } from "../backend/dist/services/r2StorageService.js";

process.env.NODE_ENV = "test";
process.env.ALLOW_TEST_AUTH = "true";
process.env.RATE_LIMIT_ENABLED = "false";
process.env.FIRESTORE_EMULATOR_HOST = "127.0.0.1:8080";
const PROJECT_ID = process.env.GCLOUD_PROJECT || "databoy-dev";
process.env.GCLOUD_PROJECT = PROJECT_ID;

if (getApps().length === 0) {
  initializeApp({ projectId: PROJECT_ID });
}
const adminDb = getFirestore();

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (!cond) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  [PASS] ${name}`);
    passed += 1;
  } catch (err) {
    console.error(`  [FAIL] ${name}`);
    console.error(`         ${err?.stack || err}`);
    failed += 1;
  }
}

async function withEnv(overrides, fn) {
  const backup = {};
  for (const [k, v] of Object.entries(overrides)) {
    backup[k] = process.env[k];
    if (v === undefined || v === null) delete process.env[k];
    else process.env[k] = String(v);
  }
  try {
    return await fn();
  } finally {
    for (const [k, prev] of Object.entries(backup)) {
      if (prev === undefined) delete process.env[k];
      else process.env[k] = prev;
    }
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

function makeRequest(server, path, method = "GET", body = null, token = null) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const headers = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: address.port,
        path,
        method,
        headers,
      },
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
          resolve({ status: res.statusCode, body: parsed, raw, headers: res.headers });
        });
      }
    );
    req.on("error", reject);
    if (body !== null && body !== undefined) {
      req.write(typeof body === "string" ? body : JSON.stringify(body));
    }
    req.end();
  });
}

function httpPutOrGet(urlString, method = "PUT", bodyBuffer = null, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlString);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers: {
          ...extraHeaders,
          ...(bodyBuffer ? { "Content-Length": bodyBuffer.length } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      }
    );
    req.on("error", reject);
    if (bodyBuffer) req.write(bodyBuffer);
    req.end();
  });
}

/**
 * Minimal S3/R2-compatible HTTP mock server for integration testing without live R2 credentials.
 */
function createMockR2Server() {
  const objects = new Map(); // key -> { body: Buffer, contentType: string, etag: string }
  const multiparts = new Map(); // uploadId -> { key, contentType, initiatedAt, parts: Map<number, { body, etag }> }
  const faultState = {
    failNextHeadCount: 0,
    delayMs: 0,
    deletedKeys: [],
    abortedUploadIds: [],
  };

  const server = http.createServer(async (req, res) => {
    const urlObj = new URL(req.url, "http://127.0.0.1");
    const segments = urlObj.pathname.split("/").filter(Boolean);
    const bucket = segments[0] || "";
    const key = decodeURIComponent(segments.slice(1).join("/"));

    if (faultState.delayMs > 0 && req.method === "HEAD") {
      await new Promise((r) => setTimeout(r, faultState.delayMs));
      if (res.writableEnded || req.destroyed) return;
    }

    const chunks = [];
    for await (const chunk of req) {
      chunks.push(chunk);
    }
    const reqBody = Buffer.concat(chunks);

    // ListMultipartUploads: GET /<bucket>?uploads
    if (req.method === "GET" && urlObj.searchParams.has("uploads")) {
      const uploadsXml = Array.from(multiparts.entries())
        .map(
          ([uploadId, mp]) =>
            `<Upload><Key>${mp.key}</Key><UploadId>${uploadId}</UploadId><Initiated>${mp.initiatedAt.toISOString()}</Initiated></Upload>`
        )
        .join("");
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(
        `<?xml version="1.0" encoding="UTF-8"?><ListMultipartUploadsResult><Bucket>${bucket}</Bucket>${uploadsXml}</ListMultipartUploadsResult>`
      );
      return;
    }

    // CreateMultipartUpload: POST /<bucket>/<key>?uploads
    if (req.method === "POST" && urlObj.searchParams.has("uploads")) {
      const uploadId = `mp_${crypto.randomUUID()}`;
      multiparts.set(uploadId, {
        key,
        contentType: req.headers["content-type"] || "application/octet-stream",
        initiatedAt: new Date(),
        parts: new Map(),
      });
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(
        `<?xml version="1.0" encoding="UTF-8"?><InitiateMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${key}</Key><UploadId>${uploadId}</UploadId></InitiateMultipartUploadResult>`
      );
      return;
    }

    // CompleteMultipartUpload: POST /<bucket>/<key>?uploadId=...
    if (req.method === "POST" && urlObj.searchParams.has("uploadId")) {
      const uploadId = urlObj.searchParams.get("uploadId");
      const mp = multiparts.get(uploadId);
      if (!mp) {
        res.writeHead(404);
        res.end("<Error><Code>NoSuchUpload</Code></Error>");
        return;
      }
      const partNums = Array.from(mp.parts.keys()).sort((a, b) => a - b);
      const assembled = Buffer.concat(partNums.map((n) => mp.parts.get(n).body));
      const etag = crypto.createHash("md5").update(assembled).digest("hex");
      objects.set(key, {
        body: assembled,
        contentType: mp.contentType,
        etag,
        lastModified: new Date(),
      });
      multiparts.delete(uploadId);
      res.writeHead(200, { "Content-Type": "application/xml" });
      res.end(
        `<?xml version="1.0" encoding="UTF-8"?><CompleteMultipartUploadResult><Bucket>${bucket}</Bucket><Key>${key}</Key><ETag>"${etag}"</ETag></CompleteMultipartUploadResult>`
      );
      return;
    }

    // AbortMultipartUpload: DELETE /<bucket>/<key>?uploadId=...
    if (req.method === "DELETE" && urlObj.searchParams.has("uploadId")) {
      const uploadId = urlObj.searchParams.get("uploadId");
      faultState.abortedUploadIds.push(uploadId);
      multiparts.delete(uploadId);
      res.writeHead(204);
      res.end();
      return;
    }

    // UploadPart: PUT /<bucket>/<key>?partNumber=...&uploadId=...
    if (req.method === "PUT" && urlObj.searchParams.has("partNumber") && urlObj.searchParams.has("uploadId")) {
      const uploadId = urlObj.searchParams.get("uploadId");
      const partNum = Number(urlObj.searchParams.get("partNumber"));
      const mp = multiparts.get(uploadId);
      if (!mp) {
        res.writeHead(404);
        res.end();
        return;
      }
      const etag = crypto.createHash("md5").update(reqBody).digest("hex");
      mp.parts.set(partNum, { body: reqBody, etag });
      res.writeHead(200, { ETag: `"${etag}"` });
      res.end();
      return;
    }

    // Standard PutObject: PUT /<bucket>/<key>
    if (req.method === "PUT") {
      const etag = crypto.createHash("md5").update(reqBody).digest("hex");
      objects.set(key, {
        body: reqBody,
        contentType: req.headers["content-type"] || "application/octet-stream",
        etag,
        lastModified: new Date(),
      });
      res.writeHead(200, { ETag: `"${etag}"` });
      res.end();
      return;
    }

    // HeadObject: HEAD /<bucket>/<key>
    if (req.method === "HEAD") {
      if (faultState.failNextHeadCount > 0) {
        faultState.failNextHeadCount -= 1;
        res.writeHead(500);
        res.end();
        return;
      }
      const obj = objects.get(key);
      if (!obj) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        "Content-Length": String(obj.body.length),
        "Content-Type": obj.contentType,
        ETag: `"${obj.etag}"`,
        "Last-Modified": obj.lastModified.toUTCString(),
      });
      res.end();
      return;
    }

    // GetObject: GET /<bucket>/<key>
    if (req.method === "GET") {
      const obj = objects.get(key);
      if (!obj) {
        res.writeHead(404);
        res.end();
        return;
      }
      const disp = urlObj.searchParams.get("response-content-disposition") || "attachment";
      res.writeHead(200, {
        "Content-Length": String(obj.body.length),
        "Content-Type": obj.contentType,
        "Content-Disposition": disp,
        ETag: `"${obj.etag}"`,
      });
      res.end(obj.body);
      return;
    }

    // DeleteObject: DELETE /<bucket>/<key>
    if (req.method === "DELETE") {
      faultState.deletedKeys.push(key);
      objects.delete(key);
      res.writeHead(204);
      res.end();
      return;
    }

    res.writeHead(400);
    res.end();
  });

  return { server, objects, multiparts, faultState };
}

async function seedUsers() {
  await clearCollections([
    "users",
    "assignments",
    "researchRequests",
    "proofreadingTasks",
    "disputes",
    "fileObjects",
    "auditLogs",
  ]);
  const users = [
    { uid: "cust_r2_a", role: "customer", status: "active", email: "custa@test.com" },
    { uid: "cust_r2_b", role: "customer", status: "active", email: "custb@test.com" },
    { uid: "writer_r2_1", role: "writer", status: "active", verificationStatus: "approved", email: "w1@test.com" },
    { uid: "writer_r2_2", role: "writer", status: "active", verificationStatus: "approved", email: "w2@test.com" },
    {
      uid: "proof_r2_1",
      role: "writer",
      status: "active",
      verificationStatus: "approved",
      canProofread: true,
      email: "p1@test.com",
    },
    { uid: "admin_r2", role: "admin", status: "active", email: "admin@test.com" },
  ];
  for (const u of users) {
    await adminDb.collection("users").doc(u.uid).set(u);
  }
}

async function runTests() {
  console.log("================================================================================");
  console.log("DATABOY PHASE 5.17 — CLOUDFLARE R2 PRIVATE STORAGE INTEGRATION TESTS");
  console.log("================================================================================\n");

  const mockR2 = createMockR2Server();
  await new Promise((r) => mockR2.server.listen(0, "127.0.0.1", r));
  const r2Port = mockR2.server.address().port;

  const baseR2Env = {
    R2_ACCOUNT_ID: "acct1234567890",
    R2_BUCKET_NAME: "databoy-staging-documents",
    R2_ENDPOINT: `http://127.0.0.1:${r2Port}`,
    R2_REGION: "auto",
    R2_ACCESS_KEY_ID: "r2_test_access_key_id_secret",
    R2_SECRET_ACCESS_KEY: "r2_test_super_secret_access_key_123456",
    R2_PRESIGNED_PUT_TTL_SECONDS: "300",
    R2_PRESIGNED_GET_TTL_SECONDS: "120",
    R2_REQUEST_TIMEOUT_MS: "5000",
    STORAGE_PROVIDER: "r2",
    R2_REQUIRED: "true",
  };

  try {
    // -----------------------------------------------------------------------
    // PART A: R2 CONFIG VALIDATION & FAIL-CLOSED STARTUP CHECKS
    // -----------------------------------------------------------------------
    await test("R2-01: Missing R2 env vars fail closed cleanly without leaking secrets", async () => {
      await withEnv(
        {
          R2_REQUIRED: "true",
          R2_ACCOUNT_ID: "",
          R2_BUCKET_NAME: "",
          R2_ACCESS_KEY_ID: "",
          R2_SECRET_ACCESS_KEY: "",
          R2_ENDPOINT: "",
        },
        async () => {
          const check = validateR2Config({ requireConfigured: true });
          assert(check.valid === false, "Expected missing R2 config to be invalid");
          assert(check.error.includes("R2_ACCOUNT_ID"), "Expected clear missing var message");

          let threw = false;
          try {
            createApp();
          } catch (e) {
            threw = true;
          }
          assert(threw, "Expected createApp() to fail closed when R2_REQUIRED=true and credentials missing");
        }
      );
    });

    await test("R2-02: Invalid R2_ENDPOINT, arbitrary host, HTTP endpoint, or STORAGE_PROVIDER=firebase rejected", async () => {
      await withEnv({ ...baseR2Env, NODE_ENV: "development", R2_ENDPOINT: "https://evil.example.com" }, () => {
        const check = validateR2Config({ requireConfigured: true });
        assert(check.valid === false, "Expected non-R2 endpoint host rejected");
      });

      await withEnv({ ...baseR2Env, NODE_ENV: "development", R2_ENDPOINT: `http://acct1234567890.r2.cloudflarestorage.com` }, () => {
        const check = validateR2Config({ requireConfigured: true });
        assert(check.valid === false, "Expected plain HTTP endpoint rejected outside test");
      });

      await withEnv({ ...baseR2Env, STORAGE_PROVIDER: "firebase" }, () => {
        const check = validateR2Config({ requireConfigured: true });
        assert(check.valid === false, "Expected firebase fallback provider rejected");
      });

      await withEnv(
        {
          ...baseR2Env,
          NODE_ENV: "production",
          R2_ENDPOINT: "https://acct1234567890.r2.cloudflarestorage.com",
        },
        () => {
          const check = validateR2Config({ requireConfigured: true });
          assert(check.valid === true, `Expected valid Cloudflare R2 HTTPS endpoint accepted, got ${check.error}`);
        }
      );
    });

    await test("R2-03: Placeholder R2 credentials rejected cleanly without exposing secret values", async () => {
      const secretVal = "placeholder";
      await withEnv({ ...baseR2Env, R2_SECRET_ACCESS_KEY: secretVal }, () => {
        const check = validateR2Config({ requireConfigured: true });
        assert(check.valid === false, "Expected placeholder secret rejected");
      });
    });

    await seedUsers();

    // Boot Express app cleanly with mock R2 config
    await withEnv(baseR2Env, async () => {
      r2StorageService.resetMetricsForTest();
      const app = createApp();
      const server = http.createServer(app);
      await new Promise((r) => server.listen(0, "127.0.0.1", r));

      const custATok = "test-token:cust_r2_a:customer:custa@test.com";
      const custBTok = "test-token:cust_r2_b:customer:custb@test.com";
      const writer1Tok = "test-token:writer_r2_1:writer:w1@test.com";
      const writer2Tok = "test-token:writer_r2_2:writer:w2@test.com";
      const proof1Tok = "test-token:proof_r2_1:writer:p1@test.com";
      const adminTok = "test-token:admin_r2:admin:admin@test.com";

      let customerAssignmentId = "";
      let sharedFileId = "";

      try {
        await test("R2-04: Unauthenticated calls to upload, complete, download, multipart, and delete fail with 401", async () => {
          const endpoints = [
            ["/api/uploads/authorize", "POST", { targetType: "pending", targetId: "cust_r2_a", fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 100 }],
            ["/api/uploads/complete", "POST", { fileId: "file_x" }],
            ["/api/uploads/download-url", "POST", { fileId: "file_x" }],
            ["/api/uploads/multipart/initiate", "POST", { targetType: "pending", targetId: "cust_r2_a", fileName: "a.pdf", contentType: "application/pdf", sizeBytes: 1000 }],
            ["/api/uploads/file_x", "DELETE", null],
          ];
          for (const [p, m, b] of endpoints) {
            const res = await makeRequest(server, p, m, b, null);
            assert(res.status === 401, `Expected 401 for unauth ${m} ${p}, got ${res.status}`);
          }
        });

        await test("R2-05: Missing R2 credentials fails closed 503 during /api/uploads/authorize without secret leakage", async () => {
          await withEnv({ R2_SECRET_ACCESS_KEY: "", R2_REQUIRED: "false" }, async () => {
            const res = await makeRequest(
              server,
              "/api/uploads/authorize",
              "POST",
              { targetType: "pending", targetId: "cust_r2_a", fileName: "brief.pdf", contentType: "application/pdf", sizeBytes: 128 },
              custATok
            );
            assert(res.status === 503, `Expected 503 when R2 unconfigured, got ${res.status}`);
            assert(!res.raw.includes(baseR2Env.R2_ACCESS_KEY_ID), "Leaked access key in 503 body");
          });
        });

        await test("R2-06: Invalid MIME type, SVG XSS type, and extension mismatch rejected (400)", async () => {
          const cases = [
            { fileName: "malware.exe", contentType: "application/x-msdownload" },
            { fileName: "xss.svg", contentType: "image/svg+xml" },
            { fileName: "spoofed.pdf", contentType: "text/html" },
          ];
          for (const c of cases) {
            const res = await makeRequest(
              server,
              "/api/uploads/authorize",
              "POST",
              { targetType: "pending", targetId: "cust_r2_a", ...c, sizeBytes: 512 },
              custATok
            );
            assert(res.status === 400, `Expected 400 rejecting ${c.fileName} (${c.contentType}), got ${res.status}`);
          }
        });

        await test("R2-07: Oversized file rejected on authorize & path traversal rejected", async () => {
          const big = await makeRequest(
            server,
            "/api/uploads/authorize",
            "POST",
            {
              targetType: "pending",
              targetId: "cust_r2_a",
              fileName: "huge.pdf",
              contentType: "application/pdf",
              sizeBytes: 30 * 1024 * 1024,
            },
            custATok
          );
          assert(big.status === 400 && big.body.code === "FILE_TOO_LARGE", `Expected FILE_TOO_LARGE, got ${big.status}`);

          const trav = await makeRequest(
            server,
            "/api/uploads/authorize",
            "POST",
            {
              targetType: "pending",
              targetId: "../other_user",
              fileName: "brief.pdf",
              contentType: "application/pdf",
              sizeBytes: 100,
            },
            custATok
          );
          assert(trav.status === 400, `Expected 400 on targetId traversal, got ${trav.status}`);
        });

        await test("R2-08: Completion fails closed when object is missing in R2 (OBJECT_NOT_FOUND_IN_STORAGE)", async () => {
          const authRes = await makeRequest(
            server,
            "/api/uploads/authorize",
            "POST",
            {
              targetType: "pending",
              targetId: "cust_r2_a",
              fileName: "never_put.pdf",
              contentType: "application/pdf",
              sizeBytes: 256,
            },
            custATok
          );
          assert(authRes.status === 200, `Expected 200 authorize, got ${authRes.status}`);

          const compFail = await makeRequest(
            server,
            "/api/uploads/complete",
            "POST",
            { fileId: authRes.body.fileId },
            custATok
          );
          assert(
            compFail.status === 400 && compFail.body.code === "OBJECT_NOT_FOUND_IN_STORAGE",
            `Expected 400 OBJECT_NOT_FOUND_IN_STORAGE, got ${compFail.status}`
          );
        });

        await test("R2-09: Full customer upload -> presigned PUT -> HeadObject verify -> idempotent complete -> assignment link", async () => {
          const payloadBuf = Buffer.from("%PDF-1.4 DataBoy Assignment Brief Sample Content");
          const shaHex = crypto.createHash("sha256").update(payloadBuf).digest("hex");

          const authRes = await makeRequest(
            server,
            "/api/uploads/authorize",
            "POST",
            {
              targetType: "pending",
              targetId: "cust_r2_a",
              fileName: "research brief final.pdf",
              contentType: "application/pdf",
              sizeBytes: payloadBuf.length,
              checksumSha256: shaHex,
            },
            custATok
          );
          assert(authRes.status === 200, `Authorize expected 200, got ${authRes.status}`);
          assert(authRes.body.provider === "r2" && authRes.body.uploadUrl.includes("X-Amz-Signature="), "Expected signed R2 PUT URL");
          assert(authRes.body.expiresInSeconds <= 900, "PUT URL expiry must stay bounded");

          const putRes = await httpPutOrGet(authRes.body.uploadUrl, "PUT", payloadBuf, {
            "Content-Type": "application/pdf",
          });
          assert(putRes.status === 200, `Direct PUT to mock R2 expected 200, got ${putRes.status}`);

          const comp1 = await makeRequest(
            server,
            "/api/uploads/complete",
            "POST",
            { fileId: authRes.body.fileId },
            custATok
          );
          assert(comp1.status === 200 && comp1.body.alreadyCompleted === false, "Expected fresh upload completion");
          assert(comp1.body.file.storageProvider === "r2", "Expected r2 provider metadata");
          assert(!comp1.raw.includes(baseR2Env.R2_SECRET_ACCESS_KEY), "Leaked secret key");

          // Second completion is idempotent
          const comp2 = await makeRequest(
            server,
            "/api/uploads/complete",
            "POST",
            { fileId: authRes.body.fileId },
            custATok
          );
          assert(comp2.status === 200 && comp2.body.alreadyCompleted === true, "Expected idempotent completion");

          sharedFileId = authRes.body.fileId;

          // Customer B CANNOT complete or attach Customer A's fileId
          const deadline = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
          const hijackRes = await makeRequest(
            server,
            "/api/assignments",
            "POST",
            {
              title: "Hijack File Attempt",
              description: "Trying to attach someone else's uploaded file",
              academicLevel: "degree",
              deadline,
              wordCount: 500,
              files: [{ fileId: sharedFileId, name: "stolen.pdf", url: `r2://${sharedFileId}`, sizeBytes: payloadBuf.length }],
            },
            custBTok
          );
          assert(hijackRes.status === 403, `Expected 403 blocking fileId attachment hijack, got ${hijackRes.status}`);

          // Customer A attaches file cleanly during assignment creation
          const createRes = await makeRequest(
            server,
            "/api/assignments",
            "POST",
            {
              title: "Legitimate R2 Brief Assignment",
              description: "Valid assignment with authenticated R2 brief document",
              academicLevel: "degree",
              deadline,
              wordCount: 750,
              files: [
                {
                  fileId: sharedFileId,
                  storageKey: authRes.body.storageKey,
                  name: comp1.body.file.fileName,
                  url: `r2://${sharedFileId}`,
                  sizeBytes: payloadBuf.length,
                },
              ],
            },
            custATok
          );
          assert(createRes.status === 201, `Expected 201 creating assignment, got ${createRes.status}`);
          customerAssignmentId = createRes.body.assignmentId;

          const metaSnap = await adminDb.collection("fileObjects").doc(sharedFileId).get();
          assert(metaSnap.data().linkedTargetId === customerAssignmentId, "Expected fileObjects linkedTargetId updated");
        });

        await test("R2-10: Upload size tampering (R2 object size != authorized sizeBytes) rejected", async () => {
          const authRes = await makeRequest(
            server,
            "/api/uploads/authorize",
            "POST",
            {
              targetType: "pending",
              targetId: "cust_r2_a",
              fileName: "mismatch.pdf",
              contentType: "application/pdf",
              sizeBytes: 100,
            },
            custATok
          );
          await httpPutOrGet(authRes.body.uploadUrl, "PUT", Buffer.from("too-short"), {
            "Content-Type": "application/pdf",
          });
          const compRes = await makeRequest(server, "/api/uploads/complete", "POST", { fileId: authRes.body.fileId }, custATok);
          assert(compRes.status === 400 && compRes.body.code === "SIZE_MISMATCH", `Expected SIZE_MISMATCH, got ${compRes.status}`);
        });

        await test("R2-11: Customer B rejected from downloading Customer A file (403); Owner succeeds with short-lived GET URL", async () => {
          const denied = await makeRequest(
            server,
            "/api/uploads/download-url",
            "POST",
            { fileId: sharedFileId },
            custBTok
          );
          assert(denied.status === 403, `Expected 403 for cross-customer download, got ${denied.status}`);

          const ok = await makeRequest(
            server,
            "/api/uploads/download-url",
            "POST",
            { fileId: sharedFileId },
            custATok
          );
          assert(ok.status === 200, `Expected 200 download-url for owner, got ${ok.status}`);
          assert(ok.body.expiresInSeconds <= 120, `Expected short-lived download TTL <= 120s, got ${ok.body.expiresInSeconds}`);
          assert(ok.body.downloadUrl.includes("X-Amz-Signature="), "Expected signed GET URL");

          const fetchObj = await httpPutOrGet(ok.body.downloadUrl, "GET");
          assert(
            fetchObj.status === 200 && fetchObj.body.toString().includes("DataBoy Assignment Brief"),
            "Expected downloaded binary content from mock R2 to match uploaded content"
          );
        });

        await test("R2-12: Writer verification documents restricted strictly to owner and admin", async () => {
          const degreeBuf = Buffer.from("%PDF-1.4 Official Degree Certificate");
          const authRes = await makeRequest(
            server,
            "/api/uploads/authorize",
            "POST",
            {
              targetType: "verification",
              targetId: "writer_r2_1",
              fileName: "degree_cert.pdf",
              contentType: "application/pdf",
              sizeBytes: degreeBuf.length,
            },
            writer1Tok
          );
          assert(authRes.status === 200, `Writer verification authorize expected 200, got ${authRes.status}`);
          await httpPutOrGet(authRes.body.uploadUrl, "PUT", degreeBuf, { "Content-Type": "application/pdf" });
          await makeRequest(server, "/api/uploads/complete", "POST", { fileId: authRes.body.fileId }, writer1Tok);

          const peerDenied = await makeRequest(
            server,
            "/api/uploads/download-url",
            "POST",
            { fileId: authRes.body.fileId },
            writer2Tok
          );
          assert(peerDenied.status === 403, `Expected 403 preventing peer writer reading verification docs, got ${peerDenied.status}`);

          const adminOk = await makeRequest(
            server,
            "/api/uploads/download-url",
            "POST",
            { fileId: authRes.body.fileId },
            adminTok
          );
          assert(adminOk.status === 200, `Expected 200 allowing admin to review verification docs, got ${adminOk.status}`);
        });

        await test("R2-13: Assigned writer & proofreader download/upload deliverable workflows + separation checks", async () => {
          // Fund assignment directly in emulator DB for workflow stage testing (payments stay disabled)
          await adminDb.collection("assignments").doc(customerAssignmentId).update({
            status: "funded",
            paymentStatus: "funded",
            escrowStatus: "held",
          });

          // Stranger writer cannot download before assignment
          const strangerDl = await makeRequest(server, "/api/uploads/download-url", "POST", { fileId: sharedFileId }, writer2Tok);
          assert(strangerDl.status === 403, `Unassigned writer should get 403, got ${strangerDl.status}`);

          // Writer 1 claims assignment
          const claimRes = await makeRequest(server, `/api/assignments/${customerAssignmentId}/claim`, "POST", {}, writer1Tok);
          assert(claimRes.status === 200, `Writer claim failed: ${claimRes.status}`);

          // Writer 1 now downloads brief cleanly
          const writerDl = await makeRequest(server, "/api/uploads/download-url", "POST", { fileId: sharedFileId }, writer1Tok);
          assert(writerDl.status === 200, `Assigned writer should download brief, got ${writerDl.status}`);

          // Non-assigned Writer 2 cannot upload deliverable draft
          const unauthorizedDraft = await makeRequest(
            server,
            "/api/uploads/authorize",
            "POST",
            {
              targetType: "draft",
              targetId: customerAssignmentId,
              fileName: "fake_draft.pdf",
              contentType: "application/pdf",
              sizeBytes: 64,
            },
            writer2Tok
          );
          assert(unauthorizedDraft.status === 403, `Expected 403 for unassigned writer draft upload, got ${unauthorizedDraft.status}`);

          // Writer 1 uploads real draft deliverable to R2 and submits draft
          const draftBuf = Buffer.from("%PDF-1.4 Completed Paper Draft v1");
          const draftAuth = await makeRequest(
            server,
            "/api/uploads/authorize",
            "POST",
            {
              targetType: "draft",
              targetId: customerAssignmentId,
              fileName: "draft_v1.pdf",
              contentType: "application/pdf",
              sizeBytes: draftBuf.length,
            },
            writer1Tok
          );
          assert(draftAuth.status === 200, `Draft authorize expected 200, got ${draftAuth.status}`);
          await httpPutOrGet(draftAuth.body.uploadUrl, "PUT", draftBuf, { "Content-Type": "application/pdf" });
          await makeRequest(server, "/api/uploads/complete", "POST", { fileId: draftAuth.body.fileId }, writer1Tok);

          const submitDraftRes = await makeRequest(
            server,
            `/api/assignments/${customerAssignmentId}/submit-draft`,
            "POST",
            {
              fileUrl: `r2://${draftAuth.body.fileId}`,
              fileId: draftAuth.body.fileId,
              storageKey: draftAuth.body.storageKey,
              fileName: "draft_v1.pdf",
              notes: "Ready for proofreading",
            },
            writer1Tok
          );
          assert(submitDraftRes.status === 200, `Draft submit failed: ${submitDraftRes.status}`);

          // Claim proofreading task as Proofreader 1 (different user from writer1)
          const proofClaim = await makeRequest(
            server,
            `/api/proofreading/proof_${customerAssignmentId}/claim`,
            "POST",
            {},
            proof1Tok
          );
          assert(proofClaim.status === 200, `Proofreader claim failed: ${proofClaim.status}`);

          // Proofreader 1 can download writer's draft and upload proofread submission
          const proofDl = await makeRequest(server, "/api/uploads/download-url", "POST", { fileId: draftAuth.body.fileId }, proof1Tok);
          assert(proofDl.status === 200, `Proofreader should download draft, got ${proofDl.status}`);

          const proofBuf = Buffer.from("%PDF-1.4 Proofread Final Paper");
          const proofUpAuth = await makeRequest(
            server,
            "/api/uploads/authorize",
            "POST",
            {
              targetType: "proofreading",
              targetId: customerAssignmentId,
              fileName: "proofread_final.pdf",
              contentType: "application/pdf",
              sizeBytes: proofBuf.length,
            },
            proof1Tok
          );
          assert(proofUpAuth.status === 200, `Proofreader upload authorize failed: ${proofUpAuth.status}`);
          await httpPutOrGet(proofUpAuth.body.uploadUrl, "PUT", proofBuf, { "Content-Type": "application/pdf" });
          await makeRequest(server, "/api/uploads/complete", "POST", { fileId: proofUpAuth.body.fileId }, proof1Tok);

          const proofSubmit = await makeRequest(
            server,
            `/api/proofreading/proof_${customerAssignmentId}/submit`,
            "POST",
            {
              fileUrl: `r2://${proofUpAuth.body.fileId}`,
              fileId: proofUpAuth.body.fileId,
              storageKey: proofUpAuth.body.storageKey,
              fileName: "proofread_final.pdf",
              notes: "Checked citations and formatting",
            },
            proof1Tok
          );
          assert(proofSubmit.status === 200, `Proofreading submit failed: ${proofSubmit.status}`);
        });

        await test("R2-14: R2 transient failure retries cleanly and R2 timeout fails closed with 504", async () => {
          const buf = Buffer.from("Retry test PDF payload");
          const authRes = await makeRequest(
            server,
            "/api/uploads/authorize",
            "POST",
            { targetType: "pending", targetId: "cust_r2_a", fileName: "retry.pdf", contentType: "application/pdf", sizeBytes: buf.length },
            custATok
          );
          await httpPutOrGet(authRes.body.uploadUrl, "PUT", buf, { "Content-Type": "application/pdf" });

          // Inject 1 transient 500 -> executeWithRetry recovers on attempt 2!
          mockR2.faultState.failNextHeadCount = 1;
          const okAfterRetry = await makeRequest(
            server,
            "/api/uploads/complete",
            "POST",
            { fileId: authRes.body.fileId },
            custATok
          );
          assert(okAfterRetry.status === 200, `Expected recovery after transient retry, got ${okAfterRetry.status}`);

          // Inject hard timeout exceeding R2_REQUEST_TIMEOUT_MS
          await withEnv({ R2_REQUEST_TIMEOUT_MS: "1000" }, async () => {
            const a2 = await makeRequest(
              server,
              "/api/uploads/authorize",
              "POST",
              { targetType: "pending", targetId: "cust_r2_a", fileName: "timeout.pdf", contentType: "application/pdf", sizeBytes: buf.length },
              custATok
            );
            await httpPutOrGet(a2.body.uploadUrl, "PUT", buf, { "Content-Type": "application/pdf" });
            mockR2.faultState.delayMs = 1500;
            const timeoutRes = await makeRequest(server, "/api/uploads/complete", "POST", { fileId: a2.body.fileId }, custATok);
            mockR2.faultState.delayMs = 0;
            assert(timeoutRes.status === 504 && timeoutRes.body.code === "R2_TIMEOUT", `Expected 504 R2_TIMEOUT, got ${timeoutRes.status}`);
          });
        });

        await test("R2-15: Multipart upload complete & abort + admin stale multipart cleanup", async () => {
          const part1 = Buffer.alloc(1024 * 64, "A");
          const part2 = Buffer.alloc(1024 * 32, "B");
          const total = part1.length + part2.length;

          const initRes = await makeRequest(
            server,
            "/api/uploads/multipart/initiate",
            "POST",
            {
              targetType: "pending",
              targetId: "cust_r2_a",
              fileName: "large_dataset.pdf",
              contentType: "application/pdf",
              sizeBytes: total,
            },
            custATok
          );
          assert(initRes.status === 200 && initRes.body.uploadId, `Multipart init failed: ${initRes.status}`);

          const p1Url = await makeRequest(server, "/api/uploads/multipart/part-url", "POST", { fileId: initRes.body.fileId, partNumber: 1 }, custATok);
          const p2Url = await makeRequest(server, "/api/uploads/multipart/part-url", "POST", { fileId: initRes.body.fileId, partNumber: 2 }, custATok);
          assert(p1Url.status === 200 && p2Url.status === 200, "Expected part URLs signed");

          const up1 = await httpPutOrGet(p1Url.body.uploadUrl, "PUT", part1);
          const up2 = await httpPutOrGet(p2Url.body.uploadUrl, "PUT", part2);
          const etag1 = up1.headers.etag.replace(/"/g, "");
          const etag2 = up2.headers.etag.replace(/"/g, "");

          const mpComp = await makeRequest(
            server,
            "/api/uploads/multipart/complete",
            "POST",
            {
              fileId: initRes.body.fileId,
              parts: [
                { partNumber: 1, etag: etag1 },
                { partNumber: 2, etag: etag2 },
              ],
            },
            custATok
          );
          assert(mpComp.status === 200 && mpComp.body.file.sizeBytes === total, "Expected multipart object assembled and size verified");

          // Explicit abort workflow + stale cleanup
          const abortInit = await makeRequest(
            server,
            "/api/uploads/multipart/initiate",
            "POST",
            { targetType: "pending", targetId: "cust_r2_a", fileName: "aborted.pdf", contentType: "application/pdf", sizeBytes: 5000 },
            custATok
          );
          const abortRes = await makeRequest(
            server,
            "/api/uploads/multipart/abort",
            "POST",
            { fileId: abortInit.body.fileId },
            custATok
          );
          assert(abortRes.status === 200 && abortRes.body.status === "aborted", "Expected explicit multipart abort");
          assert(mockR2.faultState.abortedUploadIds.includes(abortInit.body.uploadId), "Expected AbortMultipartUpload sent to R2");

          // Admin stale cleanup endpoint works & hides secrets
          const cleanupRes = await makeRequest(server, "/api/uploads/admin/cleanup-multipart", "POST", { maxAgeHours: 24 }, adminTok);
          assert(cleanupRes.status === 200 && typeof cleanupRes.body.metrics.presignPutCount === "number", "Expected cleanup metrics");
        });

        await test("R2-16: Pending deletion succeeds with audit log; funded/disputed assignment deletion blocked by retention hold", async () => {
          // Pending upload deleted cleanly
          const buf = Buffer.from("Deletable temp file");
          const authPending = await makeRequest(
            server,
            "/api/uploads/authorize",
            "POST",
            { targetType: "pending", targetId: "cust_r2_a", fileName: "temp_draft.pdf", contentType: "application/pdf", sizeBytes: buf.length },
            custATok
          );
          await httpPutOrGet(authPending.body.uploadUrl, "PUT", buf, { "Content-Type": "application/pdf" });
          await makeRequest(server, "/api/uploads/complete", "POST", { fileId: authPending.body.fileId }, custATok);

          const delPending = await makeRequest(server, `/api/uploads/${authPending.body.fileId}`, "DELETE", null, custATok);
          assert(delPending.status === 200 && delPending.body.status === "deleted", `Expected pending delete 200, got ${delPending.status}`);
          assert(mockR2.faultState.deletedKeys.includes(authPending.body.storageKey), "Expected DeleteObject invoked on R2");

          // Cannot download deleted file
          const dlDeleted = await makeRequest(server, "/api/uploads/download-url", "POST", { fileId: authPending.body.fileId }, custATok);
          assert(dlDeleted.status === 410, `Expected 410 downloading deleted file, got ${dlDeleted.status}`);

          // Raise dispute with R2 evidence and verify neither customer nor admin can delete disputed docs!
          const evBuf = Buffer.from("Dispute screenshot evidence");
          const evAuth = await makeRequest(
            server,
            "/api/uploads/authorize",
            "POST",
            { targetType: "dispute", targetId: customerAssignmentId, fileName: "evidence.png", contentType: "image/png", sizeBytes: evBuf.length },
            custATok
          );
          await httpPutOrGet(evAuth.body.uploadUrl, "PUT", evBuf, { "Content-Type": "image/png" });
          await makeRequest(server, "/api/uploads/complete", "POST", { fileId: evAuth.body.fileId }, custATok);

          const dispRes = await makeRequest(
            server,
            `/api/assignments/${customerAssignmentId}/dispute`,
            "POST",
            {
              reason: "Incomplete citations",
              details: "Attached screenshot of missing references",
              evidenceFiles: [{ fileId: evAuth.body.fileId, name: "evidence.png", storageKey: evAuth.body.storageKey }],
            },
            custATok
          );
          assert(dispRes.status === 201, `Expected 201 raising dispute with evidence, got ${dispRes.status}`);

          const blockedCustDel = await makeRequest(server, `/api/uploads/${sharedFileId}`, "DELETE", null, custATok);
          assert(
            blockedCustDel.status === 409 && blockedCustDel.body.code === "DISPUTE_HOLD_ACTIVE",
            `Expected 409 DISPUTE_HOLD_ACTIVE, got ${blockedCustDel.status}`
          );

          const blockedAdminDel = await makeRequest(server, `/api/uploads/${evAuth.body.fileId}`, "DELETE", null, adminTok);
          assert(
            blockedAdminDel.status === 409 && blockedAdminDel.body.code === "DISPUTE_HOLD_ACTIVE",
            `Expected 409 blocking deletion of open dispute evidence, got ${blockedAdminDel.status}`
          );

          // Audit logs contain upload, download, delete events
          const auditSnap = await adminDb.collection("auditLogs").get();
          const actions = new Set(auditSnap.docs.map((d) => d.data().action));
          assert(actions.has("file_upload_authorized"), "Missing file_upload_authorized audit log");
          assert(actions.has("file_upload_completed"), "Missing file_upload_completed audit log");
          assert(actions.has("file_download_authorized"), "Missing file_download_authorized audit log");
          assert(actions.has("file_deleted"), "Missing file_deleted audit log");
        });

        await test("R2-17: /api/storage alias and /api/health storage telemetry work safely", async () => {
          const metaRes = await makeRequest(server, `/api/storage/${sharedFileId}`, "GET", null, custATok);
          assert(metaRes.status === 200 && metaRes.body.file.storageProvider === "r2", "Expected /api/storage alias metadata");

          const health = await makeRequest(server, "/api/health", "GET", null, null);
          assert(
            health.status === 200 &&
              health.body.infrastructure?.storageProvider === "r2" &&
              health.body.infrastructure?.r2Configured === true,
            "Expected /api/health to report storageProvider=r2 & r2Configured=true"
          );
          assert(!health.raw.includes(baseR2Env.R2_BUCKET_NAME) && !health.raw.includes(baseR2Env.R2_SECRET_ACCESS_KEY), "Health leaked R2 secrets/bucket");
        });

        await test("R2-18: Research brief R2 upload, fileObjects linking, and participant-scoped download access", async () => {
          const researchBuf = Buffer.from("%PDF-1.4 DataBoy Research Methodology Brief");
          const deadline = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);

          const authRes = await makeRequest(
            server,
            "/api/uploads/authorize",
            "POST",
            {
              targetType: "pending",
              targetId: "cust_r2_a",
              fileName: "research_brief_v1.pdf",
              contentType: "application/pdf",
              sizeBytes: researchBuf.length,
            },
            custATok
          );
          assert(authRes.status === 200, `Expected 200 authoring research upload, got ${authRes.status}`);
          await httpPutOrGet(authRes.body.uploadUrl, "PUT", researchBuf, { "Content-Type": "application/pdf" });
          const compRes = await makeRequest(
            server,
            "/api/uploads/complete",
            "POST",
            { fileId: authRes.body.fileId },
            custATok
          );
          assert(compRes.status === 200, `Expected 200 completing research upload, got ${compRes.status}`);

          // Cross-customer attach attempt fails closed 403
          const crossResearch = await makeRequest(
            server,
            "/api/research",
            "POST",
            {
              title: "Hijacked Research Brief",
              requestTypes: ["data_analysis"],
              pastedBrief: "Trying to link another customer's uploaded research file.",
              expectedDeliverable: "Report",
              deadline,
              files: [{ fileId: authRes.body.fileId, name: "stolen.pdf", url: `r2://${authRes.body.fileId}` }],
            },
            custBTok
          );
          assert(crossResearch.status === 403, `Expected 403 linking other user's research file, got ${crossResearch.status}`);

          // Legitimate Customer A research submission links cleanly
          const createResearch = await makeRequest(
            server,
            "/api/research",
            "POST",
            {
              title: "Zambian Maize Yield Regression Study",
              requestTypes: ["data_analysis", "methodology"],
              pastedBrief: "Analyze historical provincial maize yield datasets using linear regression.",
              expectedDeliverable: "SPSS output + APA analytical report",
              deadline,
              files: [
                {
                  fileId: authRes.body.fileId,
                  storageKey: authRes.body.storageKey,
                  name: "research_brief_v1.pdf",
                  url: `r2://${authRes.body.fileId}`,
                  sizeBytes: researchBuf.length,
                },
              ],
            },
            custATok
          );
          assert(createResearch.status === 201, `Expected 201 submitting research request, got ${createResearch.status}`);

          const researchId = createResearch.body.requestId;
          const fileMeta = await adminDb.collection("fileObjects").doc(authRes.body.fileId).get();
          assert(
            fileMeta.exists && fileMeta.data().linkedTargetType === "research" && fileMeta.data().linkedTargetId === researchId,
            "Expected fileObjects linkedTargetType=research and linkedTargetId updated"
          );

          // Simulate writer1 assigned to the research request -> writer1 & admin can download; custB & writer2 denied
          await adminDb.collection("researchRequests").doc(researchId).update({ assignedWriterId: "writer_r2_1" });

          const custBDownload = await makeRequest(server, "/api/uploads/download-url", "POST", { fileId: authRes.body.fileId }, custBTok);
          assert(custBDownload.status === 403, `Expected 403 for unrelated customer B, got ${custBDownload.status}`);

          const writer2Download = await makeRequest(server, "/api/uploads/download-url", "POST", { fileId: authRes.body.fileId }, writer2Tok);
          assert(writer2Download.status === 403, `Expected 403 for unassigned writer2, got ${writer2Download.status}`);

          const writer1Download = await makeRequest(server, "/api/uploads/download-url", "POST", { fileId: authRes.body.fileId }, writer1Tok);
          assert(writer1Download.status === 200 && writer1Download.body.downloadUrl.includes("X-Amz-Signature="), "Expected assigned writer download");

          const adminDownload = await makeRequest(server, "/api/uploads/download-url", "POST", { fileId: authRes.body.fileId }, adminTok);
          assert(adminDownload.status === 200, "Expected admin research brief download");
        });

        await test("R2-19: Filename sanitization + multipart oversized/already-completed abort guards", async () => {
          const weirdAuth = await makeRequest(
            server,
            "/api/uploads/authorize",
            "POST",
            {
              targetType: "pending",
              targetId: "cust_r2_a",
              fileName: "../../../../etc/passwd ..\\secret\\draft (1).pdf",
              contentType: "application/pdf",
              sizeBytes: 128,
            },
            custATok
          );
          assert(weirdAuth.status === 200, `Expected 200 with sanitized key, got ${weirdAuth.status}`);
          assert(!weirdAuth.body.storageKey.includes(".."), `storageKey must not contain '..': ${weirdAuth.body.storageKey}`);
          assert(weirdAuth.body.storageKey.startsWith("pending/cust_r2_a/"), `Unexpected prefix: ${weirdAuth.body.storageKey}`);

          // Oversized multipart initiate rejected cleanly with 400 FILE_TOO_LARGE
          const overMp = await makeRequest(
            server,
            "/api/uploads/multipart/initiate",
            "POST",
            {
              targetType: "pending",
              targetId: "cust_r2_a",
              fileName: "oversized.pdf",
              contentType: "application/pdf",
              sizeBytes: 300 * 1024 * 1024,
            },
            custATok
          );
          assert(overMp.status === 400 && overMp.body.code === "FILE_TOO_LARGE", `Expected 400 FILE_TOO_LARGE on oversized multipart, got ${overMp.status}`);

          // Aborting an already-completed single-PUT or multipart record returns 409 ALREADY_COMPLETED
          const abortDone = await makeRequest(
            server,
            "/api/uploads/multipart/abort",
            "POST",
            { fileId: sharedFileId },
            custATok
          );
          assert(abortDone.status === 409 && abortDone.body.code === "ALREADY_COMPLETED", `Expected 409 ALREADY_COMPLETED, got ${abortDone.status}`);
        });

        await test("R2-20: Firestore rules strictly deny direct client read and write on fileObjects/{fileId}", async () => {
          const rulesContent = fs.readFileSync(path.resolve(process.cwd(), "firestore.rules"), "utf8");
          const rulesEnv = await initializeTestEnvironment({
            projectId: "databoy-r2-rules-check",
            firestore: { host: "127.0.0.1", port: 8080, rules: rulesContent },
          });
          try {
            await rulesEnv.withSecurityRulesDisabled(async (ctx) => {
              await setDoc(doc(ctx.firestore(), "fileObjects", "file_rule_test"), {
                fileId: "file_rule_test",
                ownerUid: "cust_r2_a",
                storageKey: "uploads/cust_r2_a/test.pdf",
                status: "completed",
              });
            });

            const unauthDb = rulesEnv.unauthenticatedContext().firestore();
            const ownerDb = rulesEnv.authenticatedContext("cust_r2_a", { role: "customer" }).firestore();
            const adminClientDb = rulesEnv.authenticatedContext("admin_r2", { role: "admin" }).firestore();

            await assertFails(getDoc(doc(unauthDb, "fileObjects", "file_rule_test")));
            await assertFails(getDoc(doc(ownerDb, "fileObjects", "file_rule_test")));
            await assertFails(getDoc(doc(adminClientDb, "fileObjects", "file_rule_test")));
            await assertFails(
              setDoc(doc(ownerDb, "fileObjects", "file_rule_forge"), {
                fileId: "file_rule_forge",
                ownerUid: "cust_r2_a",
                status: "completed",
              })
            );
          } finally {
            await rulesEnv.cleanup();
          }
        });
      } finally {
        server.close();
        await app.shutdownRateLimiters?.();
      }
    });
  } finally {
    mockR2.server.close();
  }

  console.log("\n================================================================================");
  console.log(`PHASE 5.17 R2 STORAGE RESULTS: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Fatal error running R2 storage tests:", err);
  process.exit(1);
});
