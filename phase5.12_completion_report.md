# DataBoy Phase 5.12 Completion Report — Lipila Environment Configuration & API Rate Limiting

**Date:** 2026-11-11  
**Status:** Implementation & Automated Verification Complete (Mocked Lipila Transport; Sandbox Acceptance Hold Preserved Pending Live/Sandbox Credentials & Phase 5.10/5.11 Prerequisites)  
**Payment Gateway:** Lipila (Exclusive — Airtel Money, MTN Mobile Money, Zamtel Kwacha; card payments blocked)

---

## 1. Environment Configuration Summary

Standardized, fail-closed backend environment loading and validation were implemented across the Express/TypeScript backend without exposing any secret to the Next.js frontend or git repository:

- **`backend/src/config/env.ts`**:
  - Added centralized non-test `.env` loader (`loadBackendEnv()`) using `dotenv` (`override: false`, skipped cleanly during `NODE_ENV=test` or automated `.test.` execution contexts so test suites remain isolated and OS/hosting env vars always take precedence).
  - Standardized `LIPILA_ENV` (`sandbox` | `production`, with legacy `LIPILA_ENVIRONMENT` alias conflict detection) and strict `NODE_ENV=production` + `LIPILA_ENV=sandbox` cross-mismatch rejection.
  - Enforced strict URL allowlists (`https://api.lipila.dev` for sandbox, `https://blz.lipila.io` for production), rejecting arbitrary URLs, HTTP URLs, path suffixes, query parameters, and cross-environment URLs.
  - Added cross-environment credential checks, placeholder secret rejection (`parseAndValidateWebhookSecret`), currency validation (`LIPILA_CURRENCY`, default `ZMW`), and outbound HTTP timeout configuration (`LIPILA_REQUEST_TIMEOUT_MS`, default `15000`, positive bounds).
  - Enforced fail-closed behavior (`validateLipilaConfig()`) at `createApp()` startup and request time.
- **`backend/src/config/firebaseAdmin.ts`**:
  - Imports `./env.js` first and supports standard service-account credential injection (`FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` with `\n` normalization) alongside local Firestore Emulator (`FIRESTORE_EMULATOR_HOST`) and ADC.
- **`backend/src/services/webhookAuth.ts` & `backend/src/services/lipilaService.ts`**:
  - Refactored onto shared `config/env.ts` validators.
  - Eliminated silent mock payment fallback outside `NODE_ENV === "test"`; missing/placeholder credentials fail closed in both production and non-test sandbox runtime.
  - `LIPILA_MOCK=true` is explicitly blocked in both `production` and `development` environments.
- **`backend/.env.example`, Git-ignored `backend/.env`, `.gitignore`, & `backend/ENVIRONMENT_SETUP.md`**:
  - Created `backend/.env.example` documenting all required backend environment variables with blank secret placeholders.
  - Created Git-ignored local `backend/.env` configured for local sandbox defaults with blank secrets.
  - Updated `.gitignore` to ignore `backend/.env`, `backend/.env.*`, `.env`, and `.env.*` (while keeping `.env.example` and `backend/.env.example` tracked).
  - Authored `backend/ENVIRONMENT_SETUP.md` documenting sandbox vs production configuration, static Firebase Hosting frontend vs Node.js backend deployment separation, Redis setup, webhook URL requirements, secret hygiene, and key rotation.

---

## 2. Complete Backend Environment Variable Reference

| Variable | Default / Example | Required In Production | Purpose |
| --- | --- | --- | --- |
| `NODE_ENV` | `development` / `production` | Yes | Runtime environment mode (`test` isolated for automated suites) |
| `PORT` | `4001` | Yes (host-assigned or `4001`) | Express HTTP server port |
| `FIREBASE_PROJECT_ID` | _(blank in example)_ | Yes (unless ADC provides) | Firebase project identifier |
| `FIREBASE_CLIENT_EMAIL` | _(blank)_ | Yes (unless ADC) | Firebase Admin service account email |
| `FIREBASE_PRIVATE_KEY` | _(blank)_ | Yes (unless ADC) | Firebase Admin private key (`\n` escaped) |
| `LIPILA_ENV` | `sandbox` | Yes (`production`) | Selects `sandbox` vs `production` Lipila mode (`LIPILA_ENVIRONMENT` supported as alias if non-conflicting) |
| `LIPILA_BASE_URL` | `https://api.lipila.dev` (sandbox) / `https://blz.lipila.io` (prod) | Recommended (or env default) | Strict allowlisted Lipila API base URL |
| `LIPILA_API_KEY` | _(blank)_ | Yes | Merchant Lipila API key |
| `LIPILA_WEBHOOK_SECRET` | _(blank)_ | Yes | Lipila HMAC-SHA256 webhook signing secret (supports rotation via comma-separated/space-delimited verification in `webhookAuth.ts` as configured) |
| `LIPILA_CURRENCY` | `ZMW` | No (defaults `ZMW`) | Expected settlement currency (`ZMW`) |
| `LIPILA_REQUEST_TIMEOUT_MS` | `15000` | No (defaults `15000`) | Outbound Lipila HTTP fetch `AbortSignal.timeout` duration (ms) |
| `RATE_LIMIT_ENABLED` | `true` | Must not be `false` | Enables API throttling (`false` forbidden in production) |
| `RATE_LIMIT_STORE` | `redis` | Yes (`redis`) | Rate limit store backend (`redis` mandatory in production; `memory` permitted only in local dev/test) |
| `REDIS_URL` | _(blank in example)_ | Yes | Redis connection URI for distributed rate limiting |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:3000,http://localhost:3001` | Yes | Comma-separated allowed browser origins |
| `TRUST_PROXY` | Unset (defaults `1` in prod, `false` otherwise) | Optional (`1`..`10` / CIDR class) | Express `trust proxy` hop setting (permissive `true`/`*` rejected to prevent header IP spoofing) |
| `RATE_LIMIT_*_MAX` / `RATE_LIMIT_*_WINDOW_MS` | Per-group defaults | Optional | Fine-tuning overrides per route group |

---

## 3. Sandbox vs Production Separation & URL Allowlist

- **Sandbox**: Permitted base URL is strictly `https://api.lipila.dev`. Using `https://blz.lipila.io`, HTTP URLs, or arbitrary domains fails validation at startup and at request time.
- **Production**: Permitted base URL is strictly `https://blz.lipila.io`. Setting `LIPILA_ENV=sandbox` or pointing to `https://api.lipila.dev` when `NODE_ENV=production` immediately throws a critical configuration error and blocks startup.
- **Cross-Environment Credential Guard**: Live/production key markers in sandbox or test/sandbox placeholder markers in production are rejected fail-closed (`ENV-03`–`ENV-05` verified).

---

## 4. Secret Hygiene & Frontend Bundle Isolation

- `git check-ignore -v backend/.env .env.local` confirmed both `backend/.env` (`.gitignore:37`) and `.env.local` (`.gitignore:35`) are ignored by Git.
- Recursive source scan across `src/`, `.env.local`, and the production static export `out/` confirmed **0 occurrences** of `LIPILA_API_KEY`, `LIPILA_WEBHOOK_SECRET`, `FIREBASE_PRIVATE_KEY`, `REDIS_URL`, `api.lipila.dev`, or `blz.lipila.io`.
- Config validation, webhook verification, and rate-limit error responses (`429` / `503` / `500`) redact secret values, Redis URIs, raw IP addresses in logs (`ip:[redacted]` / partial UID tags), and stack traces (`ENV-08`, `RL-05`).

---

## 5. Production Security Fail-Closed Behavior

- **Missing/Placeholder Lipila Credentials**: Startup `createApp()` and payment/webhook endpoints fail closed; webhook verification returns `500` server configuration error without touching the ledger or payments.
- **Mock Mode Disabled**: `LIPILA_MOCK=true` is rejected in both `production` and `development` environments (`ENV-07`), and non-test sandbox runtime with missing credentials fails closed rather than silently falling back to mock transactions (`ENV-06`).
- **Mandatory Rate Limiting & Shared Store**: Disabling `RATE_LIMIT_ENABLED=false`, setting `RATE_LIMIT_STORE=memory`, or omitting `REDIS_URL` in production throws a critical startup error in `createApp()`.
- **Anti-Spoofing Proxy Trust**: `TRUST_PROXY=true` or `*` fails closed at startup (`RL-07`).

---

## 6. Rate Limiting Architecture & Route Bindings

Implemented in `backend/src/middleware/rateLimit.ts`, wired in `backend/src/app.ts`, and bound across backend routers:

- **Dependencies Installed**: `dotenv@^18.0.10`, `express-rate-limit@^8.7.4`, `rate-limit-redis@^6.0.2`, `redis@^6.3.1`.
- **Standard Headers & Error Format**: Emits IETF `RateLimit` headers (`standardHeaders: "draft-7"`) plus `Retry-After` on HTTP `429` JSON responses (`{ error: "TooManyRequests", code: "RATE_LIMIT_EXCEEDED", group, message, retryAfterSeconds }`).
- **Dual Keying (UID + Secondary IP Anti-Sybil)**: Sensitive authenticated routes apply UID quotas derived strictly from verified Firebase Auth tokens (`req.user.uid`, never spoofable headers) paired with secondary IP limits.
- **Route Bindings**:
  - `app.ts`: `general` applied globally under `/api` (skipping `/api/payments/lipila-callback`); graceful `shutdownRateLimiters()` and `shutdownRateLimitClients()` integrated in `backend/src/server.ts`.
  - `backend/src/routes/authRoutes.ts`: `/api/auth/login-guard` (`authLogin`), `/api/auth/password-recovery-guard` (`passwordRecovery`).
  - `backend/src/routes/uploadRoutes.ts`: `/api/uploads/authorize` (`fileUpload`).
  - `backend/src/routes/assignmentRoutes.ts`: `POST /` (`assignmentCreate`), `POST /:id/claim` (`writerAction`), `POST /:id/submit-draft` (`fileUpload`), `POST /:id/claim-review` (`writerAction`), `POST /:id/dispute` (`disputeCreate`).
  - `backend/src/routes/researchRoutes.ts`: `POST /` (`researchCreate`).
  - `backend/src/routes/writerRoutes.ts`: `POST /me/payout-request` (`writerAction`).
  - `backend/src/routes/proofreadingRoutes.ts`: `POST /:taskId/claim` (`writerAction`), `POST /:taskId/submit` (`fileUpload`).
  - `backend/src/routes/paymentRoutes.ts`: `POST /initiate` (`paymentInitiate`), `GET /status/:referenceId` (`paymentStatus`), `POST /lipila-callback` (`lipilaWebhook`, after raw-body JSON capture and before controller execution).

---

## 7. Complete Rate Limit Quotas by Route Group

| Route Group | Key Strategy | Default Quota | Window | Env Overrides |
| --- | --- | --- | --- | --- |
| `general` | IP (`ip:<normalized>`) | `120` req | `60s` (`60000ms`) | `RATE_LIMIT_GENERAL_MAX`, `RATE_LIMIT_GENERAL_WINDOW_MS` |
| `authLogin` (`auth_login`) | IP | `5` req | `15m` (`900000ms`) | `RATE_LIMIT_AUTH_LOGIN_MAX`, `RATE_LIMIT_AUTH_LOGIN_WINDOW_MS` |
| `passwordRecovery` (`password_recovery`) | IP | `3` req | `15m` (`900000ms`) | `RATE_LIMIT_PASSWORD_RECOVERY_MAX`, `RATE_LIMIT_PASSWORD_RECOVERY_WINDOW_MS` |
| `assignmentCreate` (`assignment_create`) | Dual: Authenticated UID + IP | `5` / UID, `15` / IP | `10m` (`600000ms`) | `RATE_LIMIT_ASSIGNMENT_CREATE_MAX`, `_IP_MAX`, `_WINDOW_MS` |
| `researchCreate` (`research_create`) | Dual: Authenticated UID + IP | `5` / UID, `15` / IP | `10m` (`600000ms`) | `RATE_LIMIT_RESEARCH_CREATE_MAX`, `_IP_MAX`, `_WINDOW_MS` |
| `paymentInitiate` (`payment_initiate`) | Dual: Authenticated UID + IP | `3` / UID, `9` / IP | `10m` (`600000ms`) | `RATE_LIMIT_PAYMENT_INITIATE_MAX`, `_IP_MAX`, `_WINDOW_MS` |
| `paymentStatus` (`payment_status`) | Authenticated UID (fallback IP) | `30` req | `60s` (`60000ms`) | `RATE_LIMIT_PAYMENT_STATUS_MAX`, `RATE_LIMIT_PAYMENT_STATUS_WINDOW_MS` |
| `writerAction` (`writer_action`) | Authenticated UID (fallback IP) | `10` req | `60s` (`60000ms`) | `RATE_LIMIT_WRITER_ACTION_MAX`, `RATE_LIMIT_WRITER_ACTION_WINDOW_MS` |
| `fileUpload` (`file_upload`) | Authenticated UID (fallback IP) | `10` req | `10m` (`600000ms`) | `RATE_LIMIT_FILE_UPLOAD_MAX`, `RATE_LIMIT_FILE_UPLOAD_WINDOW_MS` |
| `disputeCreate` (`dispute_create`) | Dual: Authenticated UID + IP | `3` / UID, `9` / IP | `60m` (`3600000ms`) | `RATE_LIMIT_DISPUTE_CREATE_MAX`, `_IP_MAX`, `_WINDOW_MS` |
| `lipilaWebhook` (`lipila_webhook`) | IP | `60` req | `60s` (`60000ms`) | `RATE_LIMIT_WEBHOOK_MAX`, `RATE_LIMIT_WEBHOOK_WINDOW_MS` |

---

## 8. Shared Redis Store, Horizontal Scaling & Failure Handling

- Multiple backend instances sharing `REDIS_URL` synchronize rate-limit counters through `RedisStore` (`rl:databoy:<group>:` namespace), preventing attackers from bypassing quotas across load-balanced replicas (`RL-04` verified).
- In local `development` / `test` without `REDIS_URL`, memory storage is allowed unless `RATE_LIMIT_STRICT=true` or `RATE_LIMIT_STORE=redis`.
- In `production`, Redis is mandatory and fail-closed (`passOnStoreError: false`): if Redis becomes unreachable or throws a command error, `wrapLimiterFailClosed` returns HTTP `503 ServiceUnavailable` (`code: "RATE_LIMIT_STORE_UNAVAILABLE"`) rather than silently falling back to per-process memory (`RL-05` verified).

---

## 9. Webhook Rate Limiting & Security Preservation

- `/api/payments/lipila-callback` explicitly bypasses the customer-facing `general` limiter so heavy frontend traffic cannot starve gateway delivery (`RL-06` verified).
- A dedicated generous protective `lipilaWebhook` limiter (`60 req / 60s / IP`) protects the callback endpoint against floods while allowing legitimate gateway retries.
- Middleware ordering preserves `req.rawBody` capture in `express.json({ verify })` before `lipilaWebhook` and controller execution, so `verifyLipilaWebhookSignature` (HMAC-SHA256 + 300s timestamp window), atomic 60-second Firestore processing leases, and authoritative Lipila polling verification remain fully enforced (`RL-06` verified).

---

## 10. Verification & Automated Test Results

All checks below ran after the final code edit, using Firestore Emulator (`127.0.0.1:8080`) and mocked Lipila transport (`NODE_ENV=test` / in-process mocked `fetch` — **no real or sandbox Lipila API calls or transactions were initiated**):

- **Backend TypeScript Check & Build**: `npx tsc -p backend/tsconfig.json --noEmit` & `npx tsc -p backend/tsconfig.json` — Exit `0`
- **Frontend TypeScript Check**: `npx tsc --noEmit` — Exit `0`
- **Next.js Production Build**: `npm run build` (`next build`, Next.js 16.2.6 Turbopack) — Exit `0`, `26/26` static routes generated in `out/`
- **Git-ignore & Secret Scan**: `git check-ignore -v backend/.env .env.local` + recursive `src/`, `.env.local`, and `out/` scans — `0` secret matches found
- **Full 7-Suite Firestore Emulator Regression (`firebase.cmd emulators:exec --only firestore "node test/run_all_regressions.mjs"`)**: **147 / 147 scenarios passed, 0 failed** (exit `0`):
  1. `test/security_rules.test.mjs`: **24 / 24 passed**
  2. `test/cloud_functions.test.mjs`: **8 / 8 passed**
  3. `test/backend_foundation.test.mjs`: **10 / 10 passed**
  4. `test/frontend_integration.test.mjs`: **8 / 8 passed**
  5. `test/marketplace_workflows.test.mjs`: **8 / 8 passed**
  6. `test/lipila_payment.test.mjs`: **74 / 74 passed** (SEC-01/02/03, OPS-01/02, AUDIT-01..06)
  7. `test/rate_limit_and_env.test.mjs`: **15 / 15 passed** (`ENV-01`..`ENV-08`, `RL-01`..`RL-07`)

---

## 11. Operational Next Steps Before Controlled Sandbox Testing

1. Configure real sandbox credentials (`LIPILA_API_KEY`, `LIPILA_WEBHOOK_SECRET`, `FIREBASE_PROJECT_ID` / service account, `CORS_ALLOWED_ORIGINS`) in host environment / un-committed `backend/.env`.
2. Provision a managed Redis instance (`REDIS_URL`) for multi-instance sandbox/staging and production deployments and set `TRUST_PROXY` to the exact upstream proxy hop count (e.g., `1`).
3. Confirm Phase 5.10/5.11 prerequisites and register the HTTPS webhook URL `https://<backend-domain>/api/payments/lipila-callback` in the Lipila dashboard prior to lifting the controlled sandbox authorization hold.
