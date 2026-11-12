import crypto from "crypto";
import { cert } from "firebase-admin/app";
import {
  normalizePrivateKey,
  validateFirebaseAdminConfig,
  initializeFirebaseAdmin,
  getFirebaseAdminApps,
  resetFirebaseAdminForTest,
  EXPECTED_FIREBASE_PROJECT_ID,
} from "../backend/dist/config/firebaseAdmin.js";

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

async function clearFirebaseApps() {
  await resetFirebaseAdminForTest();
}

async function runTests() {
  console.log("================================================================================");
  console.log("DATABOY PHASE 5.18.2 — FIREBASE ADMIN PRIVATE KEY & CREDENTIAL TESTS");
  console.log("================================================================================\n");

  // Generate an ephemeral synthetic RSA PKCS#8 key in-memory (no hardcoded secrets)
  const { privateKey: syntheticMultilinePem } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });

  const testEmail = "firebase-adminsdk-test@databoy-aa871.iam.gserviceaccount.com";
  const keySnippet = syntheticMultilinePem
    .split("\n")
    .slice(1, 3)
    .join("")
    .slice(0, 24);

  await test("FB-01: Valid multiline PEM key validates and passes firebase-admin cert() parser", () => {
    const res = validateFirebaseAdminConfig({
      env: {
        NODE_ENV: "production",
        APP_ENV: "staging",
        FIREBASE_PROJECT_ID: EXPECTED_FIREBASE_PROJECT_ID,
        FIREBASE_CLIENT_EMAIL: testEmail,
        FIREBASE_PRIVATE_KEY: syntheticMultilinePem,
      },
      requireServiceAccount: true,
    });
    assert(res.valid === true, `Expected valid config, got error: ${res.error}`);
    assert(res.projectId === EXPECTED_FIREBASE_PROJECT_ID, "Expected projectId databoy-aa871");
    assert(res.privateKey.includes("-----BEGIN PRIVATE KEY-----"), "Missing BEGIN marker");
    assert(res.privateKey.includes("-----END PRIVATE KEY-----"), "Missing END marker");

    // Verify OpenSSL / firebase-admin cert() accepts normalized PEM
    const credential = cert({
      projectId: res.projectId,
      clientEmail: res.clientEmail,
      privateKey: res.privateKey,
    });
    assert(Boolean(credential), "Expected cert() to succeed");
  });

  await test("FB-02: Escaped newline (\\\\n / \\n), CRLF, outer quotes, and space-flattened PEM normalize cleanly", () => {
    const escapedSingle = syntheticMultilinePem.trim().replace(/\n/g, "\\n");
    const escapedDouble = syntheticMultilinePem.trim().replace(/\n/g, "\\\\n");
    const quotedAndCrlf = `  "${syntheticMultilinePem.trim().replace(/\n/g, "\\r\\n")}"  `;
    const spaceFlattened = syntheticMultilinePem.trim().replace(/\n+/g, " ");

    for (const [label, variant] of [
      ["single-escaped", escapedSingle],
      ["double-escaped", escapedDouble],
      ["quoted-crlf", quotedAndCrlf],
      ["space-flattened", spaceFlattened],
    ]) {
      const normalized = normalizePrivateKey(variant);
      const res = validateFirebaseAdminConfig({
        env: {
          NODE_ENV: "production",
          FIREBASE_PROJECT_ID: EXPECTED_FIREBASE_PROJECT_ID,
          FIREBASE_CLIENT_EMAIL: testEmail,
          FIREBASE_PRIVATE_KEY: variant,
        },
        requireServiceAccount: true,
      });
      assert(res.valid === true, `${label} variant failed validation: ${res.error}`);
      const credential = cert({
        projectId: res.projectId,
        clientEmail: res.clientEmail,
        privateKey: normalized,
      });
      assert(Boolean(credential), `${label} variant rejected by firebase-admin cert()`);
    }
  });

  await test("FB-03: Missing private key fails validation cleanly without secret leakage", () => {
    const res = validateFirebaseAdminConfig({
      env: {
        NODE_ENV: "production",
        FIREBASE_PROJECT_ID: EXPECTED_FIREBASE_PROJECT_ID,
        FIREBASE_CLIENT_EMAIL: testEmail,
      },
      requireServiceAccount: true,
    });
    assert(res.valid === false, "Expected missing FIREBASE_PRIVATE_KEY to fail");
    assert(res.error.includes("FIREBASE_PRIVATE_KEY"), `Unexpected error: ${res.error}`);
  });

  await test("FB-04: Empty or whitespace-only private key fails validation cleanly", () => {
    for (const emptyVal of ["", "   \n\t  ", '""']) {
      const res = validateFirebaseAdminConfig({
        env: {
          NODE_ENV: "production",
          FIREBASE_PROJECT_ID: EXPECTED_FIREBASE_PROJECT_ID,
          FIREBASE_CLIENT_EMAIL: testEmail,
          FIREBASE_PRIVATE_KEY: emptyVal,
        },
        requireServiceAccount: true,
      });
      assert(res.valid === false, `Expected empty/quoted key '${emptyVal}' to fail`);
    }
  });

  await test("FB-05: Malformed PEM key fails validation without echoing key contents", () => {
    const malformedInputs = [
      "not-a-pem-key-at-all",
      "-----BEGIN PRIVATE KEY-----\nshort\n-----END PRIVATE KEY-----",
      "-----BEGIN PRIVATE KEY-----\n!!!invalid-base64-chars-repeated-enough-to-exceed-length-64-check!!!\n-----END PRIVATE KEY-----",
    ];
    for (const bad of malformedInputs) {
      const res = validateFirebaseAdminConfig({
        env: {
          NODE_ENV: "production",
          FIREBASE_PROJECT_ID: EXPECTED_FIREBASE_PROJECT_ID,
          FIREBASE_CLIENT_EMAIL: testEmail,
          FIREBASE_PRIVATE_KEY: bad,
        },
        requireServiceAccount: true,
      });
      assert(res.valid === false, "Expected malformed PEM key rejected");
      assert(!res.error.includes(bad), "Error message must never echo raw private key material");
    }
  });

  await test("FB-06: Wrong FIREBASE_PROJECT_ID fails closed in non-emulator hosted config", () => {
    const res = validateFirebaseAdminConfig({
      env: {
        NODE_ENV: "production",
        APP_ENV: "staging",
        FIREBASE_PROJECT_ID: "wrong-firebase-project",
        FIREBASE_CLIENT_EMAIL: testEmail,
        FIREBASE_PRIVATE_KEY: syntheticMultilinePem,
      },
      expectedProjectId: EXPECTED_FIREBASE_PROJECT_ID,
      requireServiceAccount: true,
    });
    assert(res.valid === false, "Expected wrong project ID to be rejected");
    assert(res.error.includes(EXPECTED_FIREBASE_PROJECT_ID), `Expected databoy-aa871 in error: ${res.error}`);
    assert(!res.error.includes(keySnippet), "Error must never leak key material");
  });

  await test("FB-07: Initialization does not occur when credentials are invalid", async () => {
    await clearFirebaseApps();
    assert(getFirebaseAdminApps().length === 0, "Expected 0 apps after cleanup");

    let threw = false;
    try {
      initializeFirebaseAdmin({
        env: {
          NODE_ENV: "production",
          APP_ENV: "staging",
          FIREBASE_PROJECT_ID: EXPECTED_FIREBASE_PROJECT_ID,
          FIREBASE_CLIENT_EMAIL: testEmail,
          FIREBASE_PRIVATE_KEY: "malformed-pem-value",
        },
        expectedProjectId: EXPECTED_FIREBASE_PROJECT_ID,
        requireServiceAccount: true,
      });
    } catch (err) {
      threw = true;
      assert(!String(err?.message || "").includes("malformed-pem-value"), "Error echoed bad key value");
    }

    assert(threw, "Expected initializeFirebaseAdmin() to throw on invalid credentials");
    assert(getFirebaseAdminApps().length === 0, "Firebase Admin app must NOT be initialized on invalid credentials");
  });

  await test("FB-08: Firebase Admin initializes only once (idempotent singleton)", async () => {
    await clearFirebaseApps();
    assert(getFirebaseAdminApps().length === 0, "Expected 0 apps before singleton test");

    const env = {
      NODE_ENV: "production",
      APP_ENV: "staging",
      FIREBASE_PROJECT_ID: EXPECTED_FIREBASE_PROJECT_ID,
      FIREBASE_CLIENT_EMAIL: testEmail,
      FIREBASE_PRIVATE_KEY: syntheticMultilinePem.trim().replace(/\n/g, "\\n"),
    };

    const app1 = initializeFirebaseAdmin({ env, requireServiceAccount: true });
    const app2 = initializeFirebaseAdmin({ env, requireServiceAccount: true });

    assert(getFirebaseAdminApps().length === 1, `Expected strictly 1 Firebase App, got ${getFirebaseAdminApps().length}`);
    assert(app1 === app2, "Expected repeated initializeFirebaseAdmin() calls to return the same singleton App");
    await clearFirebaseApps();
  });

  console.log("\n================================================================================");
  console.log(`PHASE 5.18.2 FIREBASE ADMIN CONFIG RESULTS: ${passed} PASSED, ${failed} FAILED (TOTAL: ${passed + failed})`);
  console.log("================================================================================");

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error("Fatal error running Firebase Admin config tests:", err);
  process.exit(1);
});
