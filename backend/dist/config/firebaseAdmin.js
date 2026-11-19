import "./env.js";
import { initializeApp, getApps, deleteApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { getAuth } from "firebase-admin/auth";
import { getStorage } from "firebase-admin/storage";
import { getMessaging } from "firebase-admin/messaging";
export const EXPECTED_FIREBASE_PROJECT_ID = "databoy-aa871";
function stripOuterQuotes(value) {
    let out = value.trim();
    while (out.length >= 2 &&
        ((out.startsWith('"') && out.endsWith('"')) ||
            (out.startsWith("'") && out.endsWith("'")))) {
        out = out.slice(1, -1).trim();
    }
    return out;
}
/**
 * Normalizes a PEM private key supplied via Render, dotenv, or multiline env vars.
 * Preserves PEM header/footer markers and cryptographic body while fixing
 * escaped newlines, CRLF endings, surrounding quotes, whitespace, and
 * space-flattened single-line PEM strings.
 */
export function normalizePrivateKey(rawInput) {
    if (!rawInput)
        return "";
    let cleaned = stripOuterQuotes(rawInput);
    // Support accidental or intentional full service-account JSON in env var
    if (cleaned.startsWith("{") && cleaned.endsWith("}")) {
        try {
            const parsed = JSON.parse(cleaned);
            if (typeof parsed.private_key === "string") {
                cleaned = stripOuterQuotes(parsed.private_key);
            }
            else {
                return "";
            }
        }
        catch {
            return "";
        }
    }
    cleaned = cleaned
        .replace(/\\\\r\\\\n/g, "\n")
        .replace(/\\r\\n/g, "\n")
        .replace(/\\\\n/g, "\n")
        .replace(/\\n/g, "\n")
        .replace(/\\\\r/g, "")
        .replace(/\\r/g, "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n")
        .trim();
    const pemMatch = cleaned.match(/(-----BEGIN (?:RSA )?PRIVATE KEY-----)([\s\S]*?)(-----END (?:RSA )?PRIVATE KEY-----)/);
    if (!pemMatch) {
        return cleaned;
    }
    const [, header, rawBody, footer] = pemMatch;
    const compactBody = rawBody.replace(/\s+/g, "");
    if (!compactBody) {
        return `${header}\n${footer}\n`;
    }
    const wrappedLines = compactBody.match(/.{1,64}/g) || [compactBody];
    return `${header}\n${wrappedLines.join("\n")}\n${footer}\n`;
}
export function validateFirebaseAdminConfig(options = {}) {
    const env = options.env ?? process.env;
    const usingEmulator = Boolean(env.FIRESTORE_EMULATOR_HOST?.trim());
    const isArgvTest = !options.env &&
        ((process.argv[1] || "").includes(".test.") ||
            /(?:^|[\\/])tests?(?:[\\/]|$)/.test(process.argv[1] || ""));
    const isTestEnv = (env.NODE_ENV || "").trim().toLowerCase() === "test" || isArgvTest;
    const isHostedEnv = (env.NODE_ENV || "").trim().toLowerCase() === "production" ||
        (env.APP_ENV || "").trim().toLowerCase() === "staging";
    let projectId = (env.FIREBASE_PROJECT_ID || env.GCLOUD_PROJECT || "").trim();
    let clientEmail = env.FIREBASE_CLIENT_EMAIL?.trim() || "";
    let rawPrivateKey = env.FIREBASE_PRIVATE_KEY || "";
    const rawServiceAccountJson = env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
    if (rawServiceAccountJson) {
        try {
            const parsed = JSON.parse(rawServiceAccountJson);
            if (!projectId && typeof parsed.project_id === "string") {
                projectId = parsed.project_id.trim();
            }
            if (!clientEmail && typeof parsed.client_email === "string") {
                clientEmail = parsed.client_email.trim();
            }
            if (!rawPrivateKey && typeof parsed.private_key === "string") {
                rawPrivateKey = parsed.private_key;
            }
        }
        catch {
            return {
                valid: false,
                projectId: projectId || EXPECTED_FIREBASE_PROJECT_ID,
                usingEmulator,
                error: "Firebase Admin configuration error: FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON.",
            };
        }
    }
    if (!projectId) {
        projectId = usingEmulator || isTestEnv ? EXPECTED_FIREBASE_PROJECT_ID : "";
    }
    const expectedProjectId = options.expectedProjectId ??
        (!usingEmulator && !isTestEnv ? EXPECTED_FIREBASE_PROJECT_ID : undefined);
    if (!projectId) {
        return {
            valid: false,
            projectId: "",
            usingEmulator,
            error: "Firebase Admin configuration error: Missing FIREBASE_PROJECT_ID.",
        };
    }
    if (expectedProjectId && projectId !== expectedProjectId) {
        return {
            valid: false,
            projectId,
            usingEmulator,
            error: `Firebase Admin configuration error: FIREBASE_PROJECT_ID must be '${expectedProjectId}' (received '${projectId}').`,
        };
    }
    const hasAnyServiceAccountField = Boolean(clientEmail || rawPrivateKey.trim() || rawServiceAccountJson);
    const requireServiceAccount = options.requireServiceAccount ??
        (!usingEmulator && (isHostedEnv || hasAnyServiceAccountField));
    if (!requireServiceAccount) {
        return { valid: true, projectId, usingEmulator };
    }
    if (!clientEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clientEmail)) {
        return {
            valid: false,
            projectId,
            usingEmulator,
            error: "Firebase Admin configuration error: Missing or invalid FIREBASE_CLIENT_EMAIL.",
        };
    }
    if (!rawPrivateKey.trim()) {
        return {
            valid: false,
            projectId,
            usingEmulator,
            error: "Firebase Admin configuration error: Missing or empty FIREBASE_PRIVATE_KEY.",
        };
    }
    const normalizedKey = normalizePrivateKey(rawPrivateKey);
    const pemBodyMatch = normalizedKey.match(/^-----BEGIN (?:RSA )?PRIVATE KEY-----\n([A-Za-z0-9+/=\n]+)\n-----END (?:RSA )?PRIVATE KEY-----\n?$/);
    const compactBase64 = pemBodyMatch ? pemBodyMatch[1].replace(/\n/g, "") : "";
    if (!pemBodyMatch || compactBase64.length < 64) {
        return {
            valid: false,
            projectId,
            usingEmulator,
            error: "Firebase Admin configuration error: FIREBASE_PRIVATE_KEY must be a valid PEM private key with BEGIN/END PRIVATE KEY markers.",
        };
    }
    return {
        valid: true,
        projectId,
        clientEmail,
        privateKey: normalizedKey,
        usingEmulator,
    };
}
export function initializeFirebaseAdmin(options = {}) {
    if (getApps().length > 0) {
        return getApps()[0];
    }
    const validation = validateFirebaseAdminConfig(options);
    if (!validation.valid) {
        throw new Error(validation.error || "Invalid Firebase Admin configuration.");
    }
    if (validation.usingEmulator) {
        const emulatorHost = (options.env ?? process.env).FIRESTORE_EMULATOR_HOST;
        console.log(`[Backend Firebase] Connecting to Firestore Emulator at ${emulatorHost}`);
    }
    if (!validation.usingEmulator && validation.clientEmail && validation.privateKey) {
        return initializeApp({
            projectId: validation.projectId,
            credential: cert({
                projectId: validation.projectId,
                clientEmail: validation.clientEmail,
                privateKey: validation.privateKey,
            }),
        });
    }
    return initializeApp({ projectId: validation.projectId });
}
export function getFirebaseAdminApps() {
    return getApps();
}
export async function resetFirebaseAdminForTest() {
    const isTestCtx = (process.env.NODE_ENV || "").trim().toLowerCase() === "test" ||
        (process.argv[1] || "").includes(".test.");
    if (!isTestCtx) {
        throw new Error("resetFirebaseAdminForTest is only permitted in test execution");
    }
    for (const existing of [...getApps()]) {
        await deleteApp(existing);
    }
}
const app = initializeFirebaseAdmin();
export const adminDb = getFirestore(app);
export const adminAuth = getAuth(app);
export const adminStorage = getStorage(app);
export const adminMessaging = getMessaging(app);
export { app };
