# DataBoy Staging Deployment Guide (Firebase + Independent Express Backend)

## 1. Architecture & Safety Isolation
- **Frontend**: Next.js static export (`output: "export"`, `out/`) hosted on **Firebase Hosting** (`databoy-aa871`).
- **Backend**: Independent Node.js/Express API (`backend/`) deployed on **Render** (`render.yaml`) or any Docker host (`backend/Dockerfile`).
- **Database & Auth**: Firebase Authentication and Cloud Firestore (`databoy-aa871`) secured by `firestore.rules`.
- **Private Document Storage**: **Cloudflare R2** private S3-compatible bucket mediated strictly by authenticated Express presigned URLs (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET_NAME`, `R2_ENDPOINT`, `R2_REGION=auto`). Public R2 bucket access (`r2.dev` / custom public domains) MUST remain disabled; `storage.rules` is retained only for legacy compatibility.
- **Rate Limiting**: Shared Redis (`REDIS_URL`, `RATE_LIMIT_STORE=redis`), fail-closed with HTTP `503` if Redis is unavailable.
- **Staging Payment Safety**: `APP_ENV=staging` and `PAYMENTS_ENABLED=false` disable `/api/payments/initiate` and `/api/payments/lipila-callback` with HTTP `403`. Zero live/sandbox Lipila merchant transactions can run in staging.

---

## 2. Firebase Staging Project Setup
1. Select or create an isolated Firebase project (never share production Firestore or Storage buckets):
   ```bash
   firebase use <your-staging-project-id>
   ```
2. In **Firebase Console -> Authentication -> Sign-in method**:
   - Enable **Email/Password** and **Google**.
   - Add your Firebase Hosting domains (`<project-id>.web.app`, `<project-id>.firebaseapp.com`, plus any custom staging domain) under **Authentication -> Settings -> Authorized domains**.
3. Deploy database rules & indexes:
   ```bash
   firebase deploy --only firestore:rules,firestore:indexes
   ```
   *(Cloudflare R2 handles private document binary storage; `storage.rules` is retained only for legacy compatibility.)*

4. Provision Cloudflare R2 private bucket (`databoy-staging-documents` or chosen bucket), disable `r2.dev` public URL, apply restricted CORS origins (`https://databoy-aa871.web.app`, `https://databoy-aa871.firebaseapp.com`), and create an **Object Read & Write** token scoped strictly to that bucket (see `backend/ENVIRONMENT_SETUP.md` §7 and `render.yaml`).

---

## 3. Deploy Independent Backend + Redis (Render)
1. Provision using `render.yaml` (`Render Dashboard -> Blueprints -> New Blueprint Instance`) or create:
   - Redis / Key Value instance -> inject `REDIS_URL`.
   - Web Service (`rootDir: backend`, build `npm ci && npm run build`, start `node dist/server.js`, health check `/api/health`).
2. Configure environment variables (matching `render.yaml` and `backend/ENVIRONMENT_SETUP.md`):
   - `NODE_ENV=production`
   - `APP_ENV=staging`
   - `PAYMENTS_ENABLED=false`
   - `LIPILA_ENV=sandbox`
   - `TRUST_PROXY=1`
   - `RATE_LIMIT_ENABLED=true`
   - `RATE_LIMIT_STORE=redis`
   - `REDIS_URL=<internal-or-tls-redis-url>`
   - `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`
   - `CORS_ALLOWED_ORIGINS=https://<staging-project>.web.app,https://<staging-project>.firebaseapp.com`
3. Verify health endpoint:
   ```bash
   curl -fsS https://<your-backend-host>/api/health
   ```
   Expected response includes `"environment": "staging"`, `"rateLimitStore": "redis"`, and `"paymentsEnabled": false` with no secrets or internal URLs.

---

## 4. Seed Synthetic Staging Data (Optional for Reviewers)
1. Set `APP_ENV=staging` and Firebase Admin credentials in your operator shell.
2. Run the synthetic Admin SDK seeder (creates only `*.databoy.example` synthetic records and never exposes admin credentials):
   ```bash
   cd backend
   npx tsx scripts/seed_staging.ts
   ```
3. Provision any reviewer admin account privately in Firebase Console Authentication & Firestore `users/{uid}` (`role: "admin"`). Never embed admin passwords in frontend bundles or docs.

---

## 5. Build & Deploy Frontend to Firebase Hosting
1. Create `.env.local` locally (or provide CI build env vars) with:
   - `NEXT_PUBLIC_APP_ENV=staging`
   - `NEXT_PUBLIC_PAYMENTS_ENABLED=false`
   - `NEXT_PUBLIC_API_URL=https://<your-backend-host>`
   - Staging Firebase Web config keys.
2. Build static bundle and confirm no localhost API URLs exist in `out/`:
   ```bash
   npm ci
   npm run build
   ```
3. Deploy static site:
   ```bash
   firebase deploy --only hosting
   ```
