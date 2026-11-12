# DataBoy Phase 5.13 — Independent Lipila Configuration, Rate Limiting & Financial Security Audit

**Audit Date:** 2026-11-11  
**Audit Mode:** STRICT READ-ONLY (Zero source, test, Firestore rules, environment, or database modifications; zero sandbox or production Lipila transactions initiated)  
**Scope:** Independent source-level verification of Phase 5.12 (Lipila environment configuration & API rate limiting) and Phase 5.9 recheck (C-1 through C-4 / Phase 5.10 & 5.11 prerequisites)

---

## 1. Executive Verdict

**OVERALL AUDIT VERDICT:** **`FAIL`**  
**CONTROLLED LIPILA SANDBOX AUTHORIZATION:** **`FAIL` — DO NOT AUTHORIZE**

### Subsystem Verdicts
| Area | Verdict | Summary |
| --- | --- | --- |
| Part A — Lipila Environment Configuration & Secret Hygiene | **PASS WITH REQUIRED CORRECTIONS** | Strict URL allowlists (`https://api.lipila.dev` / `https://blz.lipila.io`), fail-closed missing/placeholder prod credentials, `LIPILA_MOCK=true` rejection outside `test`, test `.env` isolation, Git-ignored env files, zero secret leaks. Prefixless cross-environment key heuristic is inherently limited. |
| Part B — Redis Rate Limiting & Shared Store Lifecycle | **NOT VERIFIED** _(with code finding)_ | No local Redis daemon or running Docker engine is available to test real `node-redis` sockets or TTL key eviction (`NOT VERIFIED`). Static inspection confirms `REDIS_URL` requirement and HTTP `503` fail-closed store handling in production, **and identifies a post-startup disconnect recovery defect** in `backend/src/middleware/rateLimit.ts`. |
| Part C — Authentication, IP & Proxy Security | **PASS WITH REQUIRED CORRECTIONS** | IP limiters execute pre-auth; UID limiters execute strictly post-`authMiddleware` (`req.user.uid`); `TRUST_PROXY=true`/`*` rejected fail-closed. However, `/api/auth/login-guard`, `/api/auth/password-recovery-guard`, and `/api/uploads/authorize` are not invoked by the frontend (`src/`). |
| Part D — Route-by-Route Rate Limit Verification | **PASS WITH REQUIRED CORRECTIONS** | All 11 specified groups match quota/window configs, `Retry-After` & `draft-7` headers are present, and webhook bypasses `general`. Gaps: un-wired frontend auth/upload guards, plus `writerRoutes` `/apply` and `assignmentRoutes` `/approve`, `/reject-review`, `/revision` rely only on `general`. |
| Part E — Lipila Webhook Security | **PASS** | `req.rawBody` preserved prior to `lipilaWebhook`, HMAC-SHA256 over `${webhook-id}.${webhook-timestamp}.${rawBody}`, +/-300s timestamp check, `crypto.timingSafeEqual`, key rotation (`v1,`), `processedWebhooks` transactional lease + UUID fencing token + retry recovery intact. |
| Part F — Phase 5.9 Financial Integrity Recheck (C-1..C-4) | **FAIL** | Phase 5.10 / 5.11 remediations have not been implemented: **C-1** (direct Firestore `assignments` / `researchRequests` creation + `setDoc` fallbacks + checkout accepts `draft`/`priced`), **C-2** (`initiateDisbursement` status/JSON uncertainty), **C-3** (refund ref uniqueness + non-atomic `/approve` escrow release), and **C-4** (client Firestore mutations) remain open. |
| Real External Lipila & Live Redis Services | **NOT VERIFIED** | Zero live/sandbox Lipila API requests and zero live Redis server runs occurred. |

---

## 2. Exact Files Inspected

- **Environment & Firebase Configuration**: `backend/src/config/env.ts`, `backend/src/config/firebaseAdmin.ts` _(noted: actual path vs prompt's `backend/src/firebaseAdmin.ts`)_, `.env.example`, `backend/.env.example`, `backend/.env` _(key names / emptiness only)_, `.env.local` _(key names only)_, `.gitignore`, `backend/ENVIRONMENT_SETUP.md`.
- **Rate Limiting & Express Bootstrap**: `backend/src/middleware/rateLimit.ts`, `backend/src/app.ts`, `backend/src/server.ts`, `backend/src/middleware/authMiddleware.ts`.
- **Backend Routes & Services**: `backend/src/routes/publicRoutes.ts`, `backend/src/routes/authRoutes.ts`, `backend/src/routes/uploadRoutes.ts`, `backend/src/routes/assignmentRoutes.ts`, `backend/src/routes/researchRoutes.ts`, `backend/src/routes/writerRoutes.ts`, `backend/src/routes/proofreadingRoutes.ts`, `backend/src/routes/adminRoutes.ts`, `backend/src/routes/paymentRoutes.ts`, `backend/src/services/lipilaService.ts`, `backend/src/services/webhookAuth.ts`, `backend/src/services/ledgerService.ts`.
- **Firestore Rules & Frontend Callers**: `firestore.rules`, `src/app/(private)/projects/upload/page.tsx`, `src/services/projectService.ts`, `src/services/researchService.ts`, `src/services/adminService.ts`, `src/services/allocationService.ts`, `src/services/userService.ts`.
- **Automated Test Suites & Build Output**: `test/security_rules.test.mjs`, `test/cloud_functions.test.mjs`, `test/backend_foundation.test.mjs`, `test/frontend_integration.test.mjs`, `test/marketplace_workflows.test.mjs`, `test/lipila_payment.test.mjs`, `test/rate_limit_and_env.test.mjs`, plus `out/` bundle secret scan.

---

## 3. Verified Findings (`PASS`)

1. **Sandbox vs Production URL & Mode Isolation (`backend/src/config/env.ts`)**:
   - `ALLOWED_SANDBOX_BASE_URLS` permits only `"https://api.lipila.dev"`; `ALLOWED_PRODUCTION_BASE_URLS` permits only `"https://blz.lipila.io"`.
   - `validateOriginUrl()` rejects non-HTTPS protocols, embedded credentials, paths (`/..`), query strings, hashes, and cross-environment URLs.
   - `resolveLipilaEnvironment()` rejects `NODE_ENV=production` paired with `LIPILA_ENV=sandbox`, as well as conflicting `LIPILA_ENV` vs `LIPILA_ENVIRONMENT`.
2. **Fail-Closed Startup & Mock Blocking (`backend/src/app.ts`, `backend/src/services/webhookAuth.ts`, `backend/src/services/lipilaService.ts`)**:
   - `createApp()` validates Lipila config (`requireCredentials: isProd`), `validateWebhookConfig()`, `lipilaService.validateProductionConfig()`, `parseTrustProxySetting()`, and `validateRateLimitConfig()` synchronously at startup.
   - `LIPILA_MOCK=true` is rejected in `production` (`env.ts:359`) and in any non-`test` environment including `development` (`env.ts:367`, `lipilaService.ts:339`). Outside `NODE_ENV=test`, missing credentials fail closed rather than falling back to mock transactions.
3. **Placeholder & Cross-Env Secret Checks (`backend/src/config/env.ts`)**:
   - Known placeholder API keys (`sandbox_mock_api_key_databoy`, `test`, `changeme`, `placeholder`, `sandbox_*`, `test_*`, etc.) and placeholder webhook secrets (`test`, `changeme`, `placeholder`, `your_webhook_secret`, `test_lipila_webhook_secret`, `sandbox` in prod; `live_`/`whsec_live_`/`production_secret` in sandbox) are rejected fail-closed.
4. **Test `.env` Isolation & Host Env Precedence (`backend/src/config/env.ts:37-72`)**:
   - `loadBackendEnv()` skips `.env` injection whenever `isTestExecutionContext()` is true (`NODE_ENV=test`, `.test.` script path, or `--test`), and otherwise uses `dotenv.config({ path, override: false })` so hosting provider environment variables always take precedence.
5. **Firebase Admin Normalization (`backend/src/config/firebaseAdmin.ts`)**:
   - Imports `./env.js` first and normalizes `FIREBASE_PRIVATE_KEY` (`replace(/\\n/g, "\n")`) when `!FIRESTORE_EMULATOR_HOST && clientEmail && privateKey`.
6. **Secret Hygiene & Git Isolation**:
   - `git ls-files "*.env*"` returned zero tracked `.env*` files; `git check-ignore -v .env.local backend/.env` confirmed both are ignored.
   - `backend/.env` has blank `LIPILA_API_KEY`, `LIPILA_WEBHOOK_SECRET`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`, and `REDIS_URL`.
   - Scans across `src/`, `.env.local`, and generated `out/` confirmed **0** occurrences of `LIPILA_API_KEY`, `LIPILA_WEBHOOK_SECRET`, `FIREBASE_PRIVATE_KEY`, `REDIS_URL`, `api.lipila.dev`, or `blz.lipila.io`.
   - Rate-limit `429`/`503` responses and webhook config errors redact secrets, Redis URIs, raw IPs (`ip:[redacted]`), and stack traces (`RL-05`, `ENV-08`).
7. **Webhook Signature, Lease Fencing & Raw Body Integrity (`app.ts`, `paymentRoutes.ts`, `webhookAuth.ts`)**:
   - `express.json({ verify })` captures `req.rawBody` before `/api` limiters and router execution.
   - `general` explicitly skips `/payments/lipila-callback` (`rateLimit.ts:487`), while `lipilaWebhook` (`60 req / 60s / IP`) runs at `paymentRoutes.ts:883` before `verifyLipilaWebhookSignature(req.headers, rawBody)` — unauthenticated requests never bypass HMAC verification (`RL-06`).
   - Verified HMAC-SHA256 construction (`${webhookId}.${webhookTimestampStr}.${rawBody}`), `+/- 300s` replay window, `crypto.timingSafeEqual`, space-separated signature key rotation, transactional `processedWebhooks` lease creation with UUID `leaseToken` fencing (`renewWebhookLease`, `markWebhookCompleted`, `markWebhookFailed`, `markWebhookRejected`), and post-failure retry recovery.

---

## 4. Failed Findings (`FAIL` / `PASS WITH REQUIRED CORRECTIONS`)

1. **[BLOCKER / FAIL] C-1 Open: Direct Client Assignment/Research Creation & Pricing Bypass (`firestore.rules`, `projectService.ts`, `researchService.ts`, `paymentRoutes.ts`)**:
   - `firestore.rules:141-147` (`assignments`) still allows authenticated customers to `create` directly when `status in ['draft', 'priced']` without restricting financial fields (`budget`, `pricingBreakdown`, commissions).
   - `firestore.rules:232-236` (`researchRequests`) still permits direct client `create`.
   - `src/services/projectService.ts:116-121` and `src/services/researchService.ts:106-111` still fall back to client-side Firestore `setDoc(...)` when `/api/assignments` or `/api/research` fails/is unreachable.
   - `backend/src/routes/paymentRoutes.ts:120-128` (`checkTargetFundingEligibility`) only blocks `["completed", "cancelled", "disputed"]` for assignments — so `"draft"` or client-created `"priced"` assignments with client-manipulated `budget` can still initiate Lipila payment.
2. **[HIGH / FAIL] C-2 Open: Disbursement Uncertainty Mishandling (`backend/src/services/lipilaService.ts:695-712`)**:
   - In `initiateDisbursement()`, `await response.json().catch(() => ({}))` silently swallows malformed JSON on HTTP 2xx and returns `status: "Pending", success: true` instead of `"Unknown"` (`uncertain: true`).
   - `if (!response.ok)` unconditionally returns `status: "Failed"` for all non-2xx codes including transient HTTP `408`, `429`, and `5xx` (unlike `initiateCollection` at lines 483–512).
3. **[HIGH / FAIL] C-3 Open: Global Refund Reference Uniqueness & Split Escrow Release Transactions (`ledgerService.ts`, `assignmentRoutes.ts`, `proofreadingRoutes.ts`)**:
   - `ledgerService.resolveDisputeWithAccounting()` (`ledgerService.ts:589-752`) does **not** enforce global uniqueness on `externalRefundReference` (no global lock collection comparable to `payoutExternalRefs` in `completeWriterPayout` at lines 285–305), allowing duplicate refund references across disputes.
   - `assignmentRoutes.ts:588-645` (`POST /:id/approve`) and `proofreadingRoutes.ts:228-275` (`POST /:taskId/approve`) update `status: "completed"` and `payoutStatus: "released"` inside one transaction and call `ledgerService.releaseAssignmentEscrow(...)` **outside** that transaction in separate `recordEntry()` transactions (whereas dispute completion in `ledgerService.ts:763-899` updates both atomically).
4. **[MEDIUM-HIGH / FAIL] C-4 Open & Unwired Auth/Upload Guards (`src/services/*`, `authRoutes.ts`, `uploadRoutes.ts`)**:
   - Privileged direct client Firestore writes remain active in `src/services/allocationService.ts:144,262` (`updateDoc` on `assignments`), `src/services/researchService.ts:285` (`updateDoc` on `researchRequests`), `src/services/userService.ts:132,239,260,279` (`updateDoc` on `users`), `src/services/adminService.ts:79,187` (`addDoc` on `disputes`/`auditLogs`), `src/services/auditService.ts:56`, `src/services/notificationService.ts:40`.
   - Frontend code in `src/` makes **zero** calls to `/api/auth/login-guard`, `/api/auth/password-recovery-guard`, or `/api/uploads/authorize`; Firebase Auth login/password reset and Firebase Storage uploads execute client-to-Firebase directly and can bypass those server-side limiters.
5. **[MEDIUM / CODE DEFECT] Post-Startup Redis Disconnect Does Not Recover (`backend/src/middleware/rateLimit.ts:234-262`)**:
   - Once `client.connect()` succeeds initially, `connectPromise` stays resolved forever and is not cleared on `"end"`/`"error"`, while `reconnectStrategy` (`if (retries > 1) return new Error(...)`) terminates auto-reconnection after 2 attempts (~100ms). While subsequent requests **do** fail closed cleanly with HTTP `503`, the process cannot automatically recover Redis connectivity once Redis comes back online until restarted.
6. **[LOW / CORRECTION RECOMMENDED] Route Coverage Nuances (`writerRoutes.ts`, `assignmentRoutes.ts`)**:
   - `POST /api/writers/apply` attaches only `general` (no `writerAction`/`fileUpload` limiter).
   - `POST /api/assignments/:id/approve`, `/:id/reject-review`, and `/:id/revision` rely on `general` (`120 / 60s / IP`) rather than `writerAction` / UID limits.
   - Note also heuristic limitation in `env.ts`: cross-environment credential detection (`isSandboxPlaceholderOrLiveApiKeyMismatch` & `parseAndValidateWebhookSecret`) relies on prefixes/substrings (`live_`, `prod_`, `sandbox`, `whsec_live_`); prefixless keys cannot be statically distinguished across environments without a live API check.

---

## 5. Findings That Could Not Be Verified (`NOT VERIFIED`)

1. **Live Redis Daemon Integration & Multi-Instance Startup (`NOT VERIFIED`)**:
   - Neither `redis-server` nor a running Docker daemon is present on this host (port `127.0.0.1:6379` unreachable; `docker info` failed with no running daemon).
   - Consequently, real `node-redis` TCP/TLS sockets (`rediss://`), multi-instance persistence across process restarts against a live Redis server, live mid-flight Redis socket drops after an actual connection, and Redis TTL expiry cleanup (`PEXPIRE` eviction) are **`NOT VERIFIED`** end-to-end.
2. **Real Upstream Proxy Deployment Behavior (`NOT VERIFIED`)**:
   - Exact upstream hop count (`TRUST_PROXY=1`) against a real reverse proxy/load balancer is validated at configuration parse level (`RL-07`), not exercised behind an external cloud proxy.
3. **Real Lipila Sandbox / Production HTTP & Handset Flows (`NOT VERIFIED`)**:
   - Per strict audit rules, zero live or sandbox Lipila API transactions were initiated. Real merchant key acceptance at `https://api.lipila.dev` or `https://blz.lipila.io`, real USSD handset prompts, and live Lipila webhook delivery are **`NOT VERIFIED`**.

---

## 6. Environment Configuration Security (Part A Checklist)

| # | Check | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Sandbox selects only `https://api.lipila.dev` | **PASS** | `env.ts:9,181-185`; `ENV-01`, `ENV-04`, `ENV-05` |
| 2 | Production selects only `https://blz.lipila.io` | **PASS** | `env.ts:8,181-185`; `ENV-02`, `ENV-03` |
| 3 | Arbitrary / HTTP / path URLs rejected | **PASS** | `env.ts:124-175`; `ENV-05` |
| 4 | Sandbox creds rejected in production | **PASS** _(heuristic)_ | `env.ts:187-223,269-274`; `Scenario 43,44,47` |
| 5 | Production creds rejected in sandbox | **PASS** _(prefix heuristic)_ | `env.ts:233-243,276-287`; `ENV-05` (prefixless keys indistinguishable) |
| 6 | Missing prod API key fails closed at startup | **PASS** | `app.ts:37-54`, `lipilaService.ts:272-279`; `Scenario 46,48` |
| 7 | Missing prod webhook secret fails closed at startup | **PASS** | `app.ts:44-49`, `webhookAuth.ts:28-35`; `Scenario 42,45` |
| 8 | Placeholder webhook secrets rejected | **PASS** | `env.ts:26-33,262-267`; `Scenario 43` |
| 9 | Mock mode blocked in prod & dev | **PASS** | `env.ts:359-373`, `lipilaService.ts:266-271,339-349`; `ENV-07`, `Scenario 49` |
| 10 | Tests cannot accidentally load `.env` | **PASS** | `env.ts:37-58` (`isTestExecutionContext()` verified across all 7 suites) |
| 11 | Hosting env vars remain authoritative | **PASS** | `env.ts:66,68` (`dotenv.config(..., override: false)`) |
| 12 | Firebase Admin creds normalized & loaded | **PASS** | `firebaseAdmin.ts:1,7-29` (`replace(/\\n/g, "\n")`, emulator guard) |
| 13 | No secrets in logs/responses/src/bundle/`out/`/git | **PASS** | `0` matches in `src/`, `.env.local`, `out/`; `git check-ignore` verified; `ENV-08`, `RL-05` |

---

## 7. Redis Shared-Store & Failure Behavior (Part B Checklist)

| # | Check | Status | Evidence & Classification |
| --- | --- | --- | --- |
| 1 | Production requires Redis rate limiting | **PASS** | `rateLimit.ts:138-161`, `app.ts:74-80` |
| 2 | Production cannot silently fall back to memory | **PASS** | `rateLimit.ts:139-146`; `RL-05` (`memCheck.valid === false`) |
| 3 | Redis connection failure blocks sensitive requests | **PASS** _(stubbed)_ | `rateLimit.ts:299-329,442`; `RL-05` HTTP `503` via failing `redisSendCommand` stub |
| 4 | Post-startup Redis disconnection fails closed | **PASS WITH REQUIRED CORRECTIONS** | Static trace (`rateLimit.ts:234-267,304-328`): `sendCommand` failure returns `503`, **but** stale resolved `connectPromise` + `retries > 1` permanently stops auto-reconnect until process restart; live socket drop **`NOT VERIFIED`** |
| 5 | Store errors return safe HTTP 503 | **PASS** | `rateLimit.ts:314-320` (`503`, `RATE_LIMIT_STORE_UNAVAILABLE`) |
| 6 | Redis errors never expose creds/connection strings | **PASS** | `rateLimit.ts:312-320`; `RL-05` asserts password/host/ECONNREFUSED absent |
| 7 | Redis clients closed on graceful shutdown | **PASS** _(static)_ | `server.ts:12-25` calls `app.shutdownRateLimiters()` & `shutdownRateLimitClients()` |
| 8 | Two backend instances share counters | **PASS** _(in-mem stub)_ / **`NOT VERIFIED`** _(real Redis)_ | `RL-04` tested 2 `createApp({ redisSendCommand })` servers over shared JS Map stub |
| 9 | Restarted instance preserves shared prod limits | **NOT VERIFIED** | Shared Redis stub was verified across two app instances; actual restarted process vs external Redis not executed |
| 10 | Expired rate-limit records cleaned up | **NOT VERIFIED** | Verified only inside custom JS stub expiry check; real Redis `PEXPIRE` not executed |

---

## 8. Route-by-Route Rate-Limit Verification (Parts C & D)

All middleware orderings inspect against `backend/src/app.ts` and `backend/src/routes/*.ts`:

| Route Group | Expected Spec | Actual Code (`rateLimit.ts`) | Attached Routes & Middleware Order | Status |
| --- | --- | --- | --- | --- |
| `general` | `120 / 60s` | `120 / 60s / IP` | `app.ts:136` global `/api` (skips `/payments/lipila-callback`) | **PASS** |
| `authLogin` | `5 / 15m` | `5 / 15m / IP` | `POST /api/auth/login-guard` (pre-auth IP limit) — **unwired in `src/`** | **PASS WITH CORRECTIONS** |
| `passwordRecovery` | `3 / 15m` | `3 / 15m / IP` | `POST /api/auth/password-recovery-guard` (pre-auth IP limit) — **unwired in `src/`** | **PASS WITH CORRECTIONS** |
| `assignmentCreate` | `5 UID / 15 IP / 10m` | `5 UID + 15 IP / 10m` | `POST /api/assignments` (`authMiddleware` → `createLimit` → `requireRole`) | **PASS** |
| `researchCreate` | `5 UID / 15 IP / 10m` | `5 UID + 15 IP / 10m` | `POST /api/research` (`authMiddleware` → `createLimit` → `requireRole`) | **PASS** |
| `paymentInitiate` | `3 UID / 9 IP / 10m` | `3 UID + 9 IP / 10m` | `POST /api/payments/initiate` (`authMiddleware` → `initiateLimit`) | **PASS** |
| `paymentStatus` | `30 / 60s` | `30 / 60s / UID` | `GET /api/payments/status/:referenceId` (`authMiddleware` → `statusLimit`) | **PASS** |
| `writerAction` | `10 / 60s` | `10 / 60s / UID` | `POST /api/assignments/:id/claim`, `:id/claim-review`; `POST /api/writers/me/payout-request`; `POST /api/proofreading/:taskId/claim` (`authMiddleware` → `writerActionLimit`). _(Not on `writers/apply` or `approve`/`reject-review`/`revision`)_ | **PASS WITH CORRECTIONS** |
| `fileUpload` | `10 / 10m` | `10 / 10m / UID` | `POST /api/uploads/authorize` (**unwired in `src/`**); `POST /api/assignments/:id/submit-draft`; `POST /api/proofreading/:taskId/submit` (`authMiddleware` → `uploadLimit`) | **PASS WITH CORRECTIONS** |
| `disputeCreate` | `3 UID / 9 IP / 60m` | `3 UID + 9 IP / 60m` | `POST /api/assignments/:id/dispute` (`authMiddleware` → `disputeLimit`). _(Direct client `disputes` create also allowed by `firestore.rules`)_ | **PASS WITH CORRECTIONS** |
| `lipilaWebhook` | `60 / 60s / IP` (dedicated) | `60 / 60s / IP` | `POST /api/payments/lipila-callback` (`webhookLimit`; `general` skipped at `rateLimit.ts:487`) | **PASS** |

- **UID Spoofing & Proxy Checks**:
  - Verified UID keying uses `req.user?.uid` strictly after `authMiddleware` (`RL-03`: unauthenticated spoofed `customerId` rejected with `401` prior to limiter; multi-IP attempts by same UID hit UID quota).
  - `parseTrustProxySetting()` defaults to `1` in production and rejects `"true"` and `"*"` (`RL-07`).

---

## 9. Lipila Webhook Security Verification (Part E Checklist)

1. **Raw Body Capture**: `app.ts:118-123` (`express.json({ verify })`) captures exact `buf.toString("utf8")` into `req.rawBody`; `paymentRoutes.ts:885` uses `req.rawBody` without JSON reserialization. (**PASS**)
2. **No Bypass via Rate Limiting / IP**: `webhookLimit` runs before handler, `verifyLipilaWebhookSignature` executes unconditionally inside handler; no Lipila IP whitelist exists (`RL-06`). (**PASS**)
3. **HMAC Construction**: `${webhookId}.${webhookTimestampStr}.${rawBody || ""}` (`webhookAuth.ts:117-119`). (**PASS**)
4. **Timestamp Tolerance**: `+/- 300` seconds enforced (`webhookAuth.ts:75-92`; `Scenarios 17–18`). (**PASS**)
5. **Constant-Time Comparison & Key Rotation**: Space-separated `v1,` signatures checked with equal-length `crypto.timingSafeEqual` (`webhookAuth.ts:122-136`; `Scenario 20`). (**PASS**)
6. **Replay Protection**: Atomic Firestore `processedWebhooks` doc check blocks rejected events (`400`, `Scenario 21`) and concurrent active leases (`409`, `Scenario 31`, `Scenario 56`). (**PASS**)
7. **Lease-Token Fencing**: Every state mutation (`renewWebhookLease`, `markWebhookCompleted`, `markWebhookRejected`, `markWebhookFailed`) checks UUID `leaseToken` transactionally (`webhookAuth.ts:263-373`; `Scenario 62`). (**PASS**)
8. **Idempotency & Failure Recovery**: Completed events return `200` without duplicate ledger writes (`Scenario 30`, `Scenario 57`); `markWebhookFailed` transitions lease to `"failed"` (`leaseExpiresAt: 0`) allowing subsequent gateway retries (`Scenario 58`, `Scenario 59`). (**PASS**)
9. **Retry Capacity**: `lipilaWebhook` (`60 req / 60s / IP`) is independent of `general`, allowing legitimate gateway retries during customer traffic bursts (`RL-06`). (**PASS**)

---

## 10. Outstanding Phase 5.9 & Phase 5.10 Findings (Summary)

Phase 5.10 and Phase 5.11 have not yet been executed in this repository. All four Phase 5.9 blockers (**C-1**, **C-2**, **C-3**, **C-4**) detailed in **Section 4** remain open and un-remediated.

---

## 11. Test Execution Results & Accurate Classification (Part G)

All checks below were executed fresh during this read-only audit with zero modifications to code or configuration:

| Check / Suite | Result | Execution Environment & Mock/Stub Classification |
| --- | --- | --- |
| `npx tsc -p backend/tsconfig.json --noEmit` | **PASS** (Exit `0`) | Static TypeScript compiler verification |
| `npx tsc --noEmit` | **PASS** (Exit `0`) | Static TypeScript compiler verification |
| `npm run build` (`next build`, 16.2.6) | **PASS** (Exit `0`, 26/26 static routes) | Next.js production build + bundle generation (`out/`) |
| Bundle & Source Secret Scan | **PASS** (`0` matches in `src/`, `.env.local`, `out/`) | Static file search + `git check-ignore` |
| `test/security_rules.test.mjs` | **24 / 24 PASSED** | **Firestore Emulator** (`@firebase/rules-unit-testing`) |
| `test/cloud_functions.test.mjs` | **8 / 8 PASSED** | **Direct handler invocation** + **Firestore Emulator** (`functions/index.js`) |
| `test/backend_foundation.test.mjs` | **10 / 10 PASSED** | **Express HTTP integration** + **Firestore Emulator** + `ALLOW_TEST_AUTH=true` + **Mocked Lipila transport** (`RATE_LIMIT_ENABLED=false`) |
| `test/frontend_integration.test.mjs` | **8 / 8 PASSED** | **Express HTTP integration** + **Firestore Emulator** + `ALLOW_TEST_AUTH=true` + **Mocked Lipila transport** (`RATE_LIMIT_ENABLED=false`) |
| `test/marketplace_workflows.test.mjs` | **8 / 8 PASSED** | **Express HTTP integration** + **Firestore Emulator** + `ALLOW_TEST_AUTH=true` + **Mocked Lipila transport** (`RATE_LIMIT_ENABLED=false`) |
| `test/lipila_payment.test.mjs` | **74 / 74 PASSED** | **Express HTTP integration** + **Direct handler invocation** + **Firestore Emulator** + `ALLOW_TEST_AUTH=true` + **Mocked Lipila transport** (`LIPILA_MOCK=true` / injected `fetchImpl`; `RATE_LIMIT_ENABLED=false`) |
| `test/rate_limit_and_env.test.mjs` | **15 / 15 PASSED** (`ENV-01`..`ENV-08`, `RL-01`..`RL-07`) | **Direct handler invocation** (`ENV-01`..`08`, `RL-07`) + **Express HTTP integration** + **Firestore Emulator** + `ALLOW_TEST_AUTH=true` + **Mocked Lipila transport** + **In-memory `redisSendCommand` stub** (NO real Redis daemon) |
| **Live Redis Integration** | **`NOT VERIFIED`** | No Redis server / Docker daemon running locally |
| **Actual External Lipila API** | **`NOT VERIFIED`** | Strictly excluded per read-only / no-transaction audit policy |

**Combined Automated Emulator Regression Total:** **147 / 147 scenarios passed, 0 failed** (`firebase.cmd emulators:exec --only firestore "node test/run_all_regressions.mjs"`, exit `0`).

---

## 12. Sandbox Authorization Recommendation

**RECOMMENDATION:** **`FAIL` — DO NOT AUTHORIZE CONTROLLED LIPILA SANDBOX TESTING**

Controlled Lipila sandbox acceptance testing must remain **BLOCKED** until all mandatory blockers are remediated and re-audited:
1. Close **C-1** (Phase 5.10/5.11): Lock down `firestore.rules` on `assignments` and `researchRequests` to deny direct client creation / arbitrary client pricing, remove `setDoc` fallbacks in `src/services/projectService.ts` and `src/services/researchService.ts`, and reject `"draft"` or non-server-priced targets in `/api/payments/initiate`.
2. Close **C-2**: Update `lipilaService.initiateDisbursement()` so HTTP `408`/`429`/`5xx` and malformed `2xx` JSON classify as `Unknown` (`uncertain: true`).
3. Close **C-3**: Enforce global uniqueness for `externalRefundReference` in `ledgerService.resolveDisputeWithAccounting()` and unify assignment completion/payout-release status updates inside the ledger escrow-release transaction.
4. Address **C-4 & Auth/Upload Guard Bypass**: Converge remaining privileged client-side Firestore mutations onto audited Express APIs and wire `/api/auth/login-guard`, `/api/auth/password-recovery-guard`, and `/api/uploads/authorize` (or server-proxied enforcement) into the frontend/backend security boundary.
5. Fix the Redis post-startup disconnect recovery defect in `backend/src/middleware/rateLimit.ts` (`connectPromise` reset + bounded reconnect backoff) and verify against a real Redis test instance before staging/production cutover.
