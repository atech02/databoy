# DataBoy Phase 5.14 — Security Remediation, Firebase Hardening & Staging Readiness Report

**Date:** 2026-11-11  
**Status:** PARTIAL / REMEDIATION IMPLEMENTED — Live Staging Deployment & Firebase Emulator Regression Execution Blocked by Host/Account Prerequisites  
**Live Payment Policy:** Production and Lipila sandbox payment transactions remain **DISABLED** (`APP_ENV=staging`, `PAYMENTS_ENABLED=false`).

---

## 1. Executive Summary

Phase 5.14 implemented the source-code remediations for all Phase 5.13/5.9 security findings (**C-1**, **C-2**, **C-3**, **C-4**, Redis reconnection resilience, auth/upload rate-limit wiring, and hardened Firestore/Storage rules), added staging payment kill-switches (`APP_ENV=staging` + `PAYMENTS_ENABLED=false`), and created reproducible staging deployment assets for Firebase Hosting, Render, Docker, and managed Redis.

However, **no shareable live staging URLs exist yet**, and the Firebase Emulator test suites could not run locally because:
1. **No Java JDK (`java.exe`)** is installed on the host machine, blocking `firebase emulators:exec` (`Could not spawn java -version`).
2. The locally authenticated Firebase/GCP CLI identity (`atechsolutions0225@gmail.com`) lacks access to `databoy-dev` (`HTTP Error: 403`) and no Render account/token or live Redis instance is authenticated/running locally.

---

## 2. Pre-Deployment Security Remediation (Part A)

| Finding | Implemented Remediation | Primary Files Modified |
| :--- | :--- | :--- |
| **C-1: Assignment Creation & Pricing Bypass** | Denied direct client `create` on `assignments` and `researchRequests` in Firestore rules; removed client-side `setDoc` creation fallbacks; rejected client-supplied financial/status/ownership fields (`budget`, `price`, `source`, `status`, `customerId`) with HTTP `400`; stamped `source: "server_priced"`; rejected `"draft"`, non-`"awaiting_payment"`, `client_fallback`, and mismatched `pricingBreakdown` in payment initiation eligibility checks. | [firestore.rules](file:///c:/Dev/projects/databoy-main/firestore.rules), [projectService.ts](file:///c:/Dev/projects/databoy-main/src/services/projectService.ts), [researchService.ts](file:///c:/Dev/projects/databoy-main/src/services/researchService.ts), [assignmentRoutes.ts](file:///c:/Dev/projects/databoy-main/backend/src/routes/assignmentRoutes.ts), [researchRoutes.ts](file:///c:/Dev/projects/databoy-main/backend/src/routes/researchRoutes.ts), [paymentRoutes.ts](file:///c:/Dev/projects/databoy-main/backend/src/routes/paymentRoutes.ts) |
| **C-2: Disbursement Response Classification** | Updated `LipilaService.initiateDisbursement` so malformed 2xx JSON bodies and transient HTTP `408`, `429`, and `>=500` responses return `{ success: false, referenceId, status: "Unknown", uncertain: true }`, preserving `referenceId` for manual reconciliation rather than failing open or triggering blind retries. | [lipilaService.ts](file:///c:/Dev/projects/databoy-main/backend/src/services/lipilaService.ts) |
| **C-3: Global External Refund Ref & Atomic Escrow Release** | Added transactional `refundExternalRefs` uniqueness lock inside `ledgerService.resolveDisputeWithAccounting` (mapped to HTTP `409` `DUPLICATE_EXTERNAL_REFUND_REF`); consolidated assignment approval, `escrowStatus: "released"`, ledger entries, and writer/proofreader wallet credits into one atomic Firestore transaction (`releaseAssignmentEscrowInTransaction`) used by both `/api/assignments/:id/approve` and `/api/proofreading/:taskId/approve`. | [ledgerService.ts](file:///c:/Dev/projects/databoy-main/backend/src/services/ledgerService.ts), [adminRoutes.ts](file:///c:/Dev/projects/databoy-main/backend/src/routes/adminRoutes.ts), [assignmentRoutes.ts](file:///c:/Dev/projects/databoy-main/backend/src/routes/assignmentRoutes.ts), [proofreadingRoutes.ts](file:///c:/Dev/projects/databoy-main/backend/src/routes/proofreadingRoutes.ts) |
| **C-4: Direct Client Firestore Mutations & Storage Rules** | Denied client `create` on `assignments/*/activity`, `disputes`, `auditLogs`, `notifications`, and all client access on `refundExternalRefs`; routed assignment allocation (`/api/assignments/:id/allocate`), activity comments (`/api/assignments/:id/activity`), research clarifications/status (`/api/research/:id/clarifications`, `/status`), writer clarifications (`/api/admin/writers/:uid/clarification`), writer availability/application, and dispute creation through authenticated Express APIs. Hardened `storage.rules` with private `pending/{uid}/{filename}` workspace, participant-only `assignments/` & `research/`, owner/admin `verifications/`, and strict MIME/size checks. | [firestore.rules](file:///c:/Dev/projects/databoy-main/firestore.rules), [storage.rules](file:///c:/Dev/projects/databoy-main/storage.rules), [allocationService.ts](file:///c:/Dev/projects/databoy-main/src/services/allocationService.ts), [auditService.ts](file:///c:/Dev/projects/databoy-main/src/services/auditService.ts), [userService.ts](file:///c:/Dev/projects/databoy-main/src/services/userService.ts), [adminService.ts](file:///c:/Dev/projects/databoy-main/src/services/adminService.ts), [notificationService.ts](file:///c:/Dev/projects/databoy-main/src/services/notificationService.ts), [storageService.ts](file:///c:/Dev/projects/databoy-main/src/services/storageService.ts), [uploadRoutes.ts](file:///c:/Dev/projects/databoy-main/backend/src/routes/uploadRoutes.ts) |
| **Redis Outage & Auto-Recovery** | Configured Redis rate-limit client with `disableOfflineQueue: true`, continuous exponential `reconnectStrategy`, and `connectPromise` reset on `"error"` / `"end"` so outages fail closed immediately with HTTP `503` and automatically recover when Redis returns. | [rateLimit.ts](file:///c:/Dev/projects/databoy-main/backend/src/middleware/rateLimit.ts) |
| **Auth, Upload & Writer Rate-Limit Wiring** | Connected `/api/auth/login-guard` and `/api/auth/password-recovery-guard` in frontend auth flows; enforced ownership/participant/traversal validation in `/api/uploads/authorize`; applied `writerActionLimit` to writer apply/availability and review/approval/revision endpoints. | [AuthProvider.tsx](file:///c:/Dev/projects/databoy-main/src/components/providers/AuthProvider.tsx), [login/page.tsx](file:///c:/Dev/projects/databoy-main/src/app/(public)/login/page.tsx), [writerRoutes.ts](file:///c:/Dev/projects/databoy-main/backend/src/routes/writerRoutes.ts), [assignmentRoutes.ts](file:///c:/Dev/projects/databoy-main/backend/src/routes/assignmentRoutes.ts), [uploadRoutes.ts](file:///c:/Dev/projects/databoy-main/backend/src/routes/uploadRoutes.ts) |

---

## 3. Staging Environment Isolation & Deployment Assets (Parts B–E)

### Environment Separation & Payment Kill-Switch
- Added `AppEnvironment` (`"local" | "staging" | "production"`), `resolveAppEnvironment()`, `isStagingEnvironment()`, and `isPaymentsDisabledInStaging()` in [env.ts](file:///c:/Dev/projects/databoy-main/backend/src/config/env.ts).
- Staging (`APP_ENV=staging` + `PAYMENTS_ENABLED=false`) explicitly disables `/api/payments/initiate` and `/api/payments/lipila-callback` with HTTP `403` (`PAYMENTS_DISABLED_IN_STAGING`), while preserving strict `NODE_ENV=production` fail-closed rejections for sandbox URLs/keys and insecure `TRUST_PROXY=true` settings.
- Enhanced `GET /api/health` in [publicRoutes.ts](file:///c:/Dev/projects/databoy-main/backend/src/routes/publicRoutes.ts) to expose non-sensitive readiness fields (`environment`, `apiVersion`, `infrastructure.firestoreConfigured`, `infrastructure.rateLimitStore`, `infrastructure.paymentsEnabled`).
- Updated [MobileMoneyCheckoutModal.tsx](file:///c:/Dev/projects/databoy-main/src/components/payment/MobileMoneyCheckoutModal.tsx) with a staging notice when payments are disabled, gated [seeder.ts](file:///c:/Dev/projects/databoy-main/src/utils/seeder.ts) to development only, and updated [apiClient.ts](file:///c:/Dev/projects/databoy-main/src/services/apiClient.ts) for staging origin awareness.

### Created Staging Infrastructure Templates & Guides
- **Render Blueprint (Express Backend + Managed Redis):** [render.yaml](file:///c:/Dev/projects/databoy-main/render.yaml)
- **Non-Root Container Image:** [Dockerfile](file:///c:/Dev/projects/databoy-main/backend/Dockerfile)
- **Environment Templates (whitelisted in [.gitignore](file:///c:/Dev/projects/databoy-main/.gitignore)):** [.env.staging.example](file:///c:/Dev/projects/databoy-main/.env.staging.example), [backend/.env.staging.example](file:///c:/Dev/projects/databoy-main/backend/.env.staging.example)
- **Synthetic Admin-SDK Staging Seeder (no real PII, no public admin credentials):** [seed_staging.ts](file:///c:/Dev/projects/databoy-main/backend/scripts/seed_staging.ts)
- **Operator Runbook:** [STAGING_SETUP.md](file:///c:/Dev/projects/databoy-main/STAGING_SETUP.md)

---

## 4. Verification Results & Current Blockers

### Executed & Passing Checks
1. **Backend TypeScript Build (`npm --prefix backend run build`)**: Exited with code `0`.
2. **Frontend TypeScript Check (`npx tsc --noEmit`)**: Exited with code `0`.
3. **Next.js Static Export Build (`npm run build`, run unsandboxed for `fonts.googleapis.com` prior to final `.gitignore`/scratch edits with `src/` unchanged since)**: Exited with code `0`; generated 26/26 static pages into `out/`. *(Note: the local `out/` directory was compiled with workspace `.env.local`; staging builds must supply staging values per [.env.staging.example](file:///c:/Dev/projects/databoy-main/.env.staging.example)).*
4. **Isolated Non-Emulator Runtime Verification (`verify_non_emulator.mjs`, 4/4 PASSED, exit code `0`)**:
   - **C-2 Disbursement Classification**: Verified malformed 200 JSON and HTTP `408`/`429`/`500`/`503` return `{ status: "Unknown", uncertain: true, success: false }` with `referenceId` preserved.
   - **Staging Isolation & CORS**: Verified `APP_ENV=staging` + `PAYMENTS_ENABLED=false` returns safe `/api/health`, blocks `/api/payments/lipila-callback` with HTTP `403` (`PAYMENTS_DISABLED_IN_STAGING`), and denies disallowed `Origin` headers. *(Note: `/api/payments/initiate` enforces `isPaymentsDisabledInStaging()` in handler code behind Firebase auth, which requires Firestore user lookup).*
   - **Redis Outage & Auto-Recovery (TCP RESP2)**: Verified real TCP RESP2 disconnect returns immediate HTTP `503`, auto-recovers upon Redis restart without backend restart, and enforces HTTP `429` once quota is reached.
   - **Production Env & Proxy Guardrails**: Verified `NODE_ENV=production` rejects `LIPILA_ENV=sandbox` and `TRUST_PROXY=true`.

### Blocked Checks & Deployment Prerequisites
1. **Firebase Emulator Suites (`test/run_all_regressions.mjs`, `security_rules.test.mjs`, `storage_rules.test.mjs`, `frontend_integration.test.mjs`, `lipila_payment.test.mjs`, `rate_limit_and_env.test.mjs`)**:
   - **Blocked locally** because Java (`java.exe`) / JDK is not installed on this Windows host (`firebase emulators:exec` failed with `Could not spawn java -version`). Updated rules and emulator tests are not runtime-verified against Firestore/Storage/Auth emulators until JDK 17/21+ is installed.
2. **Shareable Live Staging URLs (Frontend Hosting, Express Backend, Live Redis)**:
   - **Blocked externally**:
     - Active Firebase/Google CLI account (`atechsolutions0225@gmail.com`) returned `HTTP Error: 403` for `databoy-dev` and does not own a DataBoy staging Firebase project.
     - No Render CLI/API credentials or live Redis service are configured on this host, and local Docker Desktop WSL distro is `Stopped`.
   - **Next Action for Operator**: Install JDK 21 and run `npm run test:regressions` against Firebase Emulators to runtime-verify the updated `firestore.rules`, `storage.rules`, C-1/C-3/C-4 routes, and `/api/payments/initiate` staging guard; then follow [STAGING_SETUP.md](file:///c:/Dev/projects/databoy-main/STAGING_SETUP.md) to provision Firebase Hosting, Render Web Service + Redis, and deploy the staging build.
