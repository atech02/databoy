# DataBoy Backend Environment & Deployment Setup

This guide documents how to configure environment variables, Lipila mobile-money credentials, and shared Redis rate limiting for the DataBoy Express/TypeScript backend (`backend/`).

> **Architecture Separation:**
> - **Frontend (Next.js static export):** Configured via `output: "export"` in `next.config.ts`, deployed to **Firebase Hosting** (`firebase.json`). It may only hold public `NEXT_PUBLIC_*` settings in `.env.local` and must **never** contain `LIPILA_API_KEY`, `LIPILA_WEBHOOK_SECRET`, Firebase Admin private keys, or `REDIS_URL`.
> - **Backend (Express/TypeScript API):** Standalone Node.js server (`backend/dist/server.js`, default local port `4001`), deployed to an external Node.js hosting provider (e.g., Render, Railway, Fly.io, Google Cloud Run, or a hardened VPS). Adding a local `backend/.env` file does **not** configure your hosted deployment—all production/staging variables must be set in your backend host's Environment Variables / Secrets Manager.

---

## 1. Local Sandbox Setup

1. Create `backend/.env` locally (never commit it) with the sandbox defaults below:
2. Keep local sandbox defaults in `backend/.env` (which is ignored by Git):
   ```env
   NODE_ENV=development
   PORT=4001

   FIREBASE_PROJECT_ID=databoy-dev
   FIREBASE_CLIENT_EMAIL=
   FIREBASE_PRIVATE_KEY=

   LIPILA_ENV=sandbox
   LIPILA_BASE_URL=https://api.lipila.dev
   LIPILA_API_KEY=
   LIPILA_WEBHOOK_SECRET=

   LIPILA_CURRENCY=ZMW
   LIPILA_REQUEST_TIMEOUT_MS=15000

   RATE_LIMIT_ENABLED=true
   RATE_LIMIT_STORE=redis
   REDIS_URL=

   CORS_ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001
   ```
3. Notice:
   - Ordinary local UI development can run without live Lipila secrets, **but** attempting real Lipila API calls or webhook verification with empty credentials fails closed with an explicit configuration error (never silently falling back to mock payments outside `NODE_ENV=test`).
   - Isolated automated tests use `NODE_ENV=test` with `LIPILA_MOCK=true` or injected `fetch` test stubs.

---

## 2. Obtaining Lipila API Keys & Webhook Secrets

1. Sign in to your **Lipila Merchant Dashboard** (use the Sandbox portal for sandbox keys and Live portal only after explicit production sign-off).
2. Navigate to **API Credentials / Developers**:
   - Copy your merchant API Key (`x-api-key`) into `LIPILA_API_KEY`.
3. Navigate to **Webhooks / Notifications**:
   - Register your backend webhook endpoint (Section 6).
   - Copy the Standard Webhooks signing secret (`whsec_...`) into `LIPILA_WEBHOOK_SECRET`.
4. Never commit credentials, print them in logs, or paste them into frontend `.env.local`.

---

## 3. Configuring Hosted Backend Providers

Configure all backend environment variables directly in your Node.js hosting provider's dashboard or CLI secrets store:

- **Render / Railway / Fly.io / Cloud Run:** Add `NODE_ENV`, `PORT`, `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` (preserving `\n` escapes), `LIPILA_ENV`, `LIPILA_BASE_URL`, `LIPILA_API_KEY`, `LIPILA_WEBHOOK_SECRET`, `LIPILA_CURRENCY=ZMW`, `LIPILA_REQUEST_TIMEOUT_MS=15000`, `RATE_LIMIT_ENABLED=true`, `RATE_LIMIT_STORE=redis`, `REDIS_URL`, `CORS_ALLOWED_ORIGINS`, and `TRUST_PROXY=1`.
- **Managed Redis (required for production/multi-instance rate limiting):** Provision Upstash Redis, Render Key Value, Railway Redis, or Memorystore and assign the TLS connection string (`rediss://...`) to `REDIS_URL`. If `REDIS_URL` is missing or Redis becomes unreachable in production, rate-limited routes fail closed (`503`) rather than downgrading to per-instance in-memory counters.
- **Reverse Proxy Trust:** Keep `TRUST_PROXY=1` when behind a single managed load balancer/reverse proxy. Never set `TRUST_PROXY=true` (`*`), which is rejected at startup because it enables IP header spoofing.

---

## 4. Sandbox vs Production Environments

### Sandbox
```env
LIPILA_ENV=sandbox
LIPILA_BASE_URL=https://api.lipila.dev
```
- Enforces `https://api.lipila.dev` strictly.
- Rejects production URL (`https://blz.lipila.io`), arbitrary URLs, and production (`live_`/`prod_`) keys.

### Production (Only After Explicit Sandbox & Security Authorization)
```env
NODE_ENV=production
LIPILA_ENV=production
LIPILA_BASE_URL=https://blz.lipila.io
LIPILA_MOCK=false
RATE_LIMIT_ENABLED=true
RATE_LIMIT_STORE=redis
REDIS_URL=rediss://...
```
- Enforces `https://blz.lipila.io` strictly via exact HTTPS origin matching.
- Rejects sandbox URLs (`https://api.lipila.dev`), sandbox/test/placeholder credentials, and `LIPILA_MOCK=true` synchronously at server startup (`createApp()`).
- Rejects `NODE_ENV=production` paired with `LIPILA_ENV=sandbox`.

---

## 5. Lipila Webhook / Callback Configuration

Point Lipila payment webhooks to:

```text
https://<your-backend-domain>/api/payments/lipila-callback
```

Requirements verified automatically by the backend:
- Exact raw HTTP body preserved for HMAC-SHA256 verification.
- Standard Webhooks headers verified: `webhook-id`, `webhook-timestamp` (+/- 300s), and `webhook-signature` (`v1,<base64>`).
- Atomic Firestore processing lease (`processedWebhooks`) prevents duplicate ledger reconciliation.
- Dedicated webhook rate limit (`60 req/min` default via `RATE_LIMIT_WEBHOOK_MAX`) isolates Lipila webhook retries from customer login/payment limits while never skipping signature verification.

---

## 6. Secret Hygiene & Bundle Verification Checklist

Before committing or deploying:
1. Verify `backend/.env` is ignored by Git:
   ```bash
   git check-ignore -v backend/.env
   git status
   ```
2. Build frontend static export and verify no backend secrets leaked into `out/` or `.next/`:
   ```bash
   npm run build
   grep -rn "LIPILA_\|FIREBASE_PRIVATE_KEY\|REDIS_URL\|R2_\|whsec_" out/
   ```
   (Expected result: zero matches.)

---

## 7. Cloudflare R2 Private Document Storage Setup

DataBoy uses **Cloudflare R2** as its primary private document storage provider via S3-compatible presigned URLs issued by the authenticated Express backend.

1. **Create Private Bucket:**
   - In Cloudflare Dashboard -> **R2 Object Storage**, create a dedicated bucket per environment (e.g., `databoy-staging-documents`, `databoy-production-documents`).
   - Keep **Public Development URL (`r2.dev`) DISABLED** and do **not** attach any public custom domain.
2. **Create Scoped R2 API Token (Least Privilege):**
   - Go to **R2 -> Manage R2 API Tokens -> Create API token**.
   - Grant **Object Read & Write** permissions scoped **only** to the target DataBoy bucket (never grant account-wide admin permissions unless strictly required for automated bucket configuration).
   - Store `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com`, `R2_REGION=auto`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` in the **backend secrets manager only** (`render.yaml` / `backend/.env`), never in `.env.local` or `NEXT_PUBLIC_*`.
3. **Configure Restricted Bucket CORS Policy (Allow Only Exact DataBoy Origins):**
   Apply a minimal CORS policy allowing direct browser `PUT` / multipart part uploads via backend-issued presigned URLs only from your exact Firebase Hosting / local dev origins:
   ```json
   [
     {
       "AllowedOrigins": [
         "https://databoy-aa871.web.app",
         "https://databoy-aa871.firebaseapp.com"
       ],
       "AllowedMethods": ["GET", "PUT", "HEAD"],
       "AllowedHeaders": ["Content-Type", "Content-Length", "x-amz-*"],
       "ExposeHeaders": ["ETag"],
       "MaxAgeSeconds": 3600
     }
   ]
   ```
   *(For local development only, temporarily include `http://localhost:3000` in a separate staging/dev bucket CORS rule — never use `"AllowedOrigins": ["*"]`.)*
4. **Incomplete Multipart Cleanup & Backup/DR Notes:**
   - R2 buckets include a default 7-day incomplete multipart upload abort lifecycle rule; DataBoy also tracks active multipart sessions in Firestore (`fileObjects`) and invokes `AbortMultipartUpload` explicitly on cancellation or expiry.
   - Because Cloudflare R2 does **not** currently provide AWS S3-style native `PutBucketVersioning` or user-configured cross-region bucket replication, DataBoy uses immutable unique `storageKey` prefixes (`<resource>/<ownerOrTarget>/<fileId>_<sanitizedName>`) so uploads never silently overwrite prior versions, retains audit trails in Firestore (`auditLogs` + `fileObjects`), and recommends scheduled encrypted off-cloud backup snapshots (e.g., `rclone` / Worker / archival job) before production launch.

---

## 8. Credential Rotation

1. **Webhook Secret Rotation:** Lipila supports space-separated multiple signatures in `webhook-signature`. During rotation, keep both active in Lipila if dual-signing, deploy the new `LIPILA_WEBHOOK_SECRET` in your hosting secret manager, restart/roll instances, verify signed delivery succeeds, then retire the old signing key in Lipila.
2. **API Key Rotation:** Generate a new API key in Lipila Dashboard, update `LIPILA_API_KEY` in the hosting provider's secrets store, trigger a zero-downtime rollout, confirm `/api/health` and collection verification pass, and revoke the old key in Lipila.
