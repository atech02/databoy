import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

export type LipilaEnvironment = "sandbox" | "production";
export type AppEnvironment = "local" | "staging" | "production";

export const ALLOWED_PRODUCTION_BASE_URLS = ["https://blz.lipila.io"] as const;
export const ALLOWED_SANDBOX_BASE_URLS = ["https://api.lipila.dev"] as const;
export const SANDBOX_BASE_URL = ALLOWED_SANDBOX_BASE_URLS[0];
export const DEFAULT_LIPILA_CURRENCY = "ZMW";
export const DEFAULT_LIPILA_TIMEOUT_MS = 15000;

const KNOWN_PLACEHOLDER_API_KEYS = new Set([
  "sandbox_mock_api_key_databoy",
  "test",
  "changeme",
  "your_api_key",
  "sandbox",
  "demo",
  "placeholder",
  "api_key",
  "your_key",
]);

const KNOWN_PLACEHOLDER_WEBHOOK_SECRETS = new Set([
  "test",
  "changeme",
  "placeholder",
  "your_webhook_secret",
  "secret",
  "your_secret",
]);

let envLoaded = false;

function isTestExecutionContext(): boolean {
  if ((process.env.NODE_ENV || "").trim().toLowerCase() === "test") {
    return true;
  }
  const entry = process.argv[1] || "";
  if (entry.includes(".test.") || /(?:^|[\\/])tests?(?:[\\/]|$)/.test(entry)) {
    return true;
  }
  return process.execArgv.some((arg) => arg === "--test" || arg.startsWith("--test-"));
}

/**
 * Loads backend/.env in non-test environments before reading process.env.
 * Existing OS/hosting environment variables always take precedence (override: false).
 */
export function loadBackendEnv(): void {
  if (envLoaded) return;
  envLoaded = true;

  if (isTestExecutionContext()) {
    return;
  }

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const backendEnvPath = path.resolve(__dirname, "../../.env");
  const cwdEnvPath = path.resolve(process.cwd(), ".env");

  if (fs.existsSync(backendEnvPath)) {
    dotenv.config({ path: backendEnvPath, override: false });
  } else if (fs.existsSync(cwdEnvPath)) {
    dotenv.config({ path: cwdEnvPath, override: false });
  }
}

loadBackendEnv();

export function resolveAppEnvironment(): AppEnvironment {
  const raw = (process.env.APP_ENV || "").trim().toLowerCase();
  if (raw === "staging") return "staging";
  if (raw === "production") return "production";
  if (raw === "local" || raw === "development") return "local";
  return (process.env.NODE_ENV || "").trim().toLowerCase() === "production" ? "production" : "local";
}

export function isStagingEnvironment(): boolean {
  return resolveAppEnvironment() === "staging";
}

export function isPaymentsDisabledInStaging(): boolean {
  const rawEnabled = (process.env.PAYMENTS_ENABLED || "").trim().toLowerCase();
  if (isStagingEnvironment()) {
    // Staging disables live/sandbox payment execution unless explicitly overridden only in isolated tests
    return !(process.env.NODE_ENV === "test" && rawEnabled === "true");
  }
  return rawEnabled === "false";
}

export function resolveLipilaEnvironment(): {
  valid: boolean;
  env: LipilaEnvironment;
  error?: string;
} {
  const rawPrimary = process.env.LIPILA_ENV?.trim().toLowerCase();
  const rawLegacy = process.env.LIPILA_ENVIRONMENT?.trim().toLowerCase();

  if (rawPrimary && rawLegacy && rawPrimary !== rawLegacy) {
    return {
      valid: false,
      env: "sandbox",
      error: "Server configuration error: Conflicting LIPILA_ENV and LIPILA_ENVIRONMENT values",
    };
  }

  const chosen = rawPrimary || rawLegacy;
  const nodeEnv = (process.env.NODE_ENV || "").trim().toLowerCase();
  const isStaging = isStagingEnvironment();

  if (isStaging && chosen === "production") {
    return {
      valid: false,
      env: "sandbox",
      error: "Server configuration error: LIPILA_ENV cannot be set to 'production' when APP_ENV is 'staging'",
    };
  }

  if (chosen) {
    if (chosen !== "sandbox" && chosen !== "production") {
      return {
        valid: false,
        env: "sandbox",
        error: `Server configuration error: Invalid LIPILA_ENV '${chosen}'. Allowed values: sandbox, production`,
      };
    }

    if (nodeEnv === "production" && !isStaging && chosen === "sandbox") {
      return {
        valid: false,
        env: "production",
        error: "Server configuration error: LIPILA_ENV cannot be set to 'sandbox' when NODE_ENV is 'production'",
      };
    }

    return { valid: true, env: chosen };
  }

  if (isStaging) {
    return { valid: true, env: "sandbox" };
  }

  return {
    valid: true,
    env: nodeEnv === "production" ? "production" : "sandbox",
  };
}

export function isLipilaProductionEnv(): boolean {
  if (isStagingEnvironment()) {
    return false;
  }
  const resolved = resolveLipilaEnvironment();
  return resolved.env === "production" || process.env.NODE_ENV === "production";
}

export function validateOriginUrl(
  rawUrl: string | undefined,
  allowlist: readonly string[],
  envLabel: string
): { valid: boolean; normalizedUrl?: string; error?: string } {
  if (!rawUrl || typeof rawUrl !== "string" || !rawUrl.trim()) {
    return {
      valid: false,
      error: `Server configuration error: LIPILA_BASE_URL is empty in ${envLabel}`,
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return {
      valid: false,
      error: `Server configuration error: Invalid LIPILA_BASE_URL '${rawUrl}'`,
    };
  }

  if (parsed.protocol !== "https:") {
    return {
      valid: false,
      error: `Server configuration error: ${envLabel} LIPILA_BASE_URL must use HTTPS`,
    };
  }

  if (
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    (parsed.pathname && parsed.pathname !== "/")
  ) {
    return {
      valid: false,
      error: `Server configuration error: ${envLabel} LIPILA_BASE_URL must be an exact origin without credentials, path, or query`,
    };
  }

  if (!allowlist.includes(parsed.origin)) {
    const capitalized = envLabel.charAt(0).toUpperCase() + envLabel.slice(1);
    return {
      valid: false,
      error: `Server configuration error: ${capitalized} LIPILA_BASE_URL '${parsed.origin}' is not in the explicit ${envLabel} allowlist (${allowlist.join(", ")})`,
    };
  }

  return { valid: true, normalizedUrl: parsed.origin };
}

export function validateLipilaBaseUrl(
  env: LipilaEnvironment,
  rawUrl?: string
): { valid: boolean; normalizedUrl?: string; error?: string } {
  if (env === "production") {
    return validateOriginUrl(rawUrl, ALLOWED_PRODUCTION_BASE_URLS, "production");
  }
  return validateOriginUrl(rawUrl, ALLOWED_SANDBOX_BASE_URLS, "sandbox");
}

export function isPlaceholderApiKey(key?: string): boolean {
  if (!key || !key.trim()) return true;
  const lower = key.trim().toLowerCase();
  return (
    KNOWN_PLACEHOLDER_API_KEYS.has(lower) ||
    lower.startsWith("sandbox_") ||
    lower.startsWith("test_")
  );
}

export function isSandboxPlaceholderOrLiveApiKeyMismatch(
  key: string | undefined,
  env: LipilaEnvironment,
  allowTestPrefix = false
): { valid: boolean; error?: string } {
  if (!key || !key.trim()) {
    return {
      valid: false,
      error:
        env === "production"
          ? "Server configuration error: Valid LIPILA_API_KEY is mandatory in production"
          : "Server configuration error: Valid LIPILA_API_KEY is required in sandbox",
    };
  }

  const trimmed = key.trim();
  const lower = trimmed.toLowerCase();

  if (env === "production") {
    if (isPlaceholderApiKey(trimmed) || lower.includes("sandbox")) {
      return {
        valid: false,
        error: "Server configuration error: Valid LIPILA_API_KEY is mandatory in production",
      };
    }
    return { valid: true };
  }

  // Sandbox validations
  if (KNOWN_PLACEHOLDER_API_KEYS.has(lower) || (!allowTestPrefix && lower.startsWith("placeholder_"))) {
    return {
      valid: false,
      error: "Server configuration error: LIPILA_API_KEY is using an insecure placeholder value in sandbox",
    };
  }

  if (
    lower.startsWith("live_") ||
    lower.startsWith("prod_") ||
    lower.includes("_live_") ||
    lower.includes("_prod_")
  ) {
    return {
      valid: false,
      error: "Server configuration error: Production LIPILA_API_KEY cannot be used in sandbox mode",
    };
  }

  return { valid: true };
}

export function parseAndValidateWebhookSecret(
  rawSecret: string | undefined,
  env: LipilaEnvironment
): { valid: boolean; secretKey?: Buffer; error?: string } {
  if (!rawSecret || typeof rawSecret !== "string" || !rawSecret.trim()) {
    return {
      valid: false,
      error: "Server configuration error: LIPILA_WEBHOOK_SECRET is not configured",
    };
  }

  const trimmedSecret = rawSecret.trim();
  const lower = trimmedSecret.toLowerCase();

  if (KNOWN_PLACEHOLDER_WEBHOOK_SECRETS.has(lower)) {
    return {
      valid: false,
      error: "Server configuration error: LIPILA_WEBHOOK_SECRET is using an insecure placeholder value",
    };
  }

  if (env === "production" && (lower.includes("test_lipila_webhook_secret") || lower.includes("sandbox"))) {
    return {
      valid: false,
      error: "Server configuration error: Sandbox webhook secret cannot be used in production",
    };
  }

  if (
    env === "sandbox" &&
    (lower.startsWith("live_") ||
      lower.startsWith("whsec_live_") ||
      lower.includes("production_secret") ||
      lower.includes("cHJvZHVjdGlvbl9zZWNyZXQ"))
  ) {
    return {
      valid: false,
      error: "Server configuration error: Production webhook secret cannot be used in sandbox",
    };
  }

  let base64Secret = trimmedSecret;
  if (base64Secret.startsWith("whsec_")) {
    base64Secret = base64Secret.substring(6);
  }

  try {
    const secretKey = Buffer.from(base64Secret, "base64");
    if (secretKey.length === 0) {
      return { valid: false, error: "Invalid webhook secret configuration" };
    }
    return { valid: true, secretKey };
  } catch {
    return { valid: false, error: "Invalid webhook secret configuration" };
  }
}

export function getLipilaCurrency(): { valid: boolean; currency: string; error?: string } {
  const raw = process.env.LIPILA_CURRENCY;
  const currency = (raw === undefined ? DEFAULT_LIPILA_CURRENCY : raw).trim().toUpperCase();
  if (currency !== "ZMW") {
    return {
      valid: false,
      currency,
      error: `Server configuration error: Unsupported LIPILA_CURRENCY '${currency}'. DataBoy only supports ZMW.`,
    };
  }
  return { valid: true, currency };
}

export function getLipilaRequestTimeoutMs(): { valid: boolean; timeoutMs: number; error?: string } {
  const raw = process.env.LIPILA_REQUEST_TIMEOUT_MS;
  if (raw === undefined || raw.trim() === "") {
    return { valid: true, timeoutMs: DEFAULT_LIPILA_TIMEOUT_MS };
  }
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 1000 || parsed > 120000) {
    return {
      valid: false,
      timeoutMs: DEFAULT_LIPILA_TIMEOUT_MS,
      error: "Server configuration error: LIPILA_REQUEST_TIMEOUT_MS must be an integer between 1000 and 120000",
    };
  }
  return { valid: true, timeoutMs: parsed };
}

export interface LipilaConfigValidationResult {
  valid: boolean;
  env: LipilaEnvironment;
  baseUrl?: string;
  currency?: string;
  timeoutMs?: number;
  error?: string;
  missingVars?: string[];
}

/**
 * Unified validator for Lipila environment settings, base URLs, currency, timeout, and credentials.
 * - Production always requires valid credentials, https://blz.lipila.io, and forbids LIPILA_MOCK=true.
 * - Sandbox enforces https://api.lipila.dev, forbids production URLs/keys, and requires credentials when
 *   requireCredentials is true (real-payment sandbox runtime).
 */
export function validateLipilaConfig(options: { requireCredentials?: boolean } = {}): LipilaConfigValidationResult {
  const envCheck = resolveLipilaEnvironment();
  if (!envCheck.valid) {
    return { valid: false, env: envCheck.env, error: envCheck.error };
  }
  const env = envCheck.env;
  const isProd = env === "production";
  const requireCreds = isProd || options.requireCredentials === true;

  if (isProd && process.env.LIPILA_MOCK === "true") {
    return {
      valid: false,
      env,
      error: "Server configuration error: Mock payment mode (LIPILA_MOCK=true) is prohibited in production",
    };
  }

  if (process.env.NODE_ENV !== "test" && process.env.LIPILA_MOCK === "true") {
    return {
      valid: false,
      env,
      error: "Server configuration error: LIPILA_MOCK=true is only permitted when NODE_ENV=test",
    };
  }

  const defaultUrl = isProd ? ALLOWED_PRODUCTION_BASE_URLS[0] : SANDBOX_BASE_URL;
  const rawUrl = process.env.LIPILA_BASE_URL !== undefined ? process.env.LIPILA_BASE_URL : defaultUrl;
  const urlCheck = validateLipilaBaseUrl(env, rawUrl);
  if (!urlCheck.valid) {
    return { valid: false, env, error: urlCheck.error };
  }

  const currencyCheck = getLipilaCurrency();
  if (!currencyCheck.valid) {
    return { valid: false, env, error: currencyCheck.error };
  }

  const timeoutCheck = getLipilaRequestTimeoutMs();
  if (!timeoutCheck.valid) {
    return { valid: false, env, error: timeoutCheck.error };
  }

  const missingVars: string[] = [];
  const rawApiKey = process.env.LIPILA_API_KEY;
  const rawWebhookSecret = process.env.LIPILA_WEBHOOK_SECRET;

  if (!rawApiKey || !rawApiKey.trim()) missingVars.push("LIPILA_API_KEY");
  if (!rawWebhookSecret || !rawWebhookSecret.trim()) missingVars.push("LIPILA_WEBHOOK_SECRET");

  if (requireCreds) {
    const keyCheck = isSandboxPlaceholderOrLiveApiKeyMismatch(rawApiKey, env, process.env.NODE_ENV === "test");
    if (!keyCheck.valid) {
      return { valid: false, env, error: keyCheck.error, missingVars };
    }

    const secretCheck = parseAndValidateWebhookSecret(rawWebhookSecret, env);
    if (!secretCheck.valid) {
      return { valid: false, env, error: secretCheck.error, missingVars };
    }
  } else {
    // Even without requireCredentials (e.g. local UI startup), reject cross-env credential contamination if set
    if (rawApiKey && rawApiKey.trim()) {
      const keyCheck = isSandboxPlaceholderOrLiveApiKeyMismatch(rawApiKey, env, process.env.NODE_ENV === "test");
      if (!keyCheck.valid) {
        return { valid: false, env, error: keyCheck.error, missingVars };
      }
    }
    if (rawWebhookSecret && rawWebhookSecret.trim()) {
      const secretCheck = parseAndValidateWebhookSecret(rawWebhookSecret, env);
      if (!secretCheck.valid) {
        return { valid: false, env, error: secretCheck.error, missingVars };
      }
    }
  }

  return {
    valid: true,
    env,
    baseUrl: urlCheck.normalizedUrl,
    currency: currencyCheck.currency,
    timeoutMs: timeoutCheck.timeoutMs,
    missingVars,
  };
}

// ============================================================================
// CLOUDFLARE R2 PRIVATE DOCUMENT STORAGE CONFIGURATION
// ============================================================================

export const DEFAULT_R2_REGION = "auto";
export const DEFAULT_R2_PRESIGNED_PUT_TTL_SECONDS = 300;
export const DEFAULT_R2_PRESIGNED_GET_TTL_SECONDS = 120;
export const DEFAULT_R2_MULTIPART_PART_TTL_SECONDS = 900;
export const DEFAULT_R2_REQUEST_TIMEOUT_MS = 15000;
export const DEFAULT_R2_MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;
export const DEFAULT_R2_MAX_MULTIPART_FILE_SIZE_BYTES = 250 * 1024 * 1024;

const ALLOWED_R2_REGIONS = new Set([
  "auto",
  "wnam",
  "enam",
  "weur",
  "eeur",
  "apac",
  "oc",
  "us-east-1",
]);

const KNOWN_PLACEHOLDER_R2_VALUES = new Set([
  "your_cloudflare_account_id",
  "your_r2_access_key_id",
  "your_r2_secret_access_key",
  "your_bucket_name",
  "changeme",
  "placeholder",
  "secret",
  "test",
  "demo",
  "example",
]);

export interface ValidatedR2Config {
  provider: "r2";
  accountId: string;
  bucketName: string;
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  presignedPutTtlSeconds: number;
  presignedGetTtlSeconds: number;
  multipartPartTtlSeconds: number;
  requestTimeoutMs: number;
  maxFileSizeBytes: number;
  maxMultipartFileSizeBytes: number;
}

export interface R2ConfigValidationResult {
  valid: boolean;
  configured: boolean;
  error?: string;
  missingVars?: string[];
  config?: ValidatedR2Config;
}

function parseBoundedIntEnv(
  envName: string,
  defaultValue: number,
  min: number,
  max: number
): { valid: boolean; value: number; error?: string } {
  const raw = process.env[envName];
  if (raw === undefined || raw.trim() === "") {
    return { valid: true, value: defaultValue };
  }
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return {
      valid: false,
      value: defaultValue,
      error: `Server configuration error: ${envName} must be an integer between ${min} and ${max}`,
    };
  }
  return { valid: true, value: parsed };
}

export function hasAnyR2ConfigEnvSet(): boolean {
  const keys = [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET_NAME",
    "R2_ENDPOINT",
  ];
  return keys.some((k) => Boolean(process.env[k]?.trim()));
}

export function isR2ConfigRequired(): boolean {
  const rawReq = (process.env.R2_REQUIRED || "").trim().toLowerCase();
  if (rawReq === "true") return true;
  if (rawReq === "false") return false;
  if (hasAnyR2ConfigEnvSet()) return true;
  if (!isTestExecutionContext()) {
    const nodeEnv = (process.env.NODE_ENV || "").trim().toLowerCase();
    if (isStagingEnvironment() || nodeEnv === "production") {
      return true;
    }
  }
  return false;
}

export function validateR2Config(
  options: { requireConfigured?: boolean } = {}
): R2ConfigValidationResult {
  const rawProvider = (process.env.STORAGE_PROVIDER || "r2").trim().toLowerCase();
  if (rawProvider !== "r2") {
    return {
      valid: false,
      configured: false,
      error: `Server configuration error: Unsupported STORAGE_PROVIDER '${rawProvider}'. Only 'r2' is permitted (Firebase Storage and local disk fallbacks are disabled).`,
    };
  }

  const requireConfigured = options.requireConfigured === true || isR2ConfigRequired();
  const accountId = (process.env.R2_ACCOUNT_ID || "").trim();
  const accessKeyId = (process.env.R2_ACCESS_KEY_ID || "").trim();
  const secretAccessKey = (process.env.R2_SECRET_ACCESS_KEY || "").trim();
  const bucketName = (process.env.R2_BUCKET_NAME || "").trim();
  const rawEndpoint = (process.env.R2_ENDPOINT || "").trim();
  const region = (process.env.R2_REGION || DEFAULT_R2_REGION).trim().toLowerCase();

  const missingVars: string[] = [];
  if (!accountId) missingVars.push("R2_ACCOUNT_ID");
  if (!bucketName) missingVars.push("R2_BUCKET_NAME");
  if (!accessKeyId) missingVars.push("R2_ACCESS_KEY_ID");
  if (!secretAccessKey) missingVars.push("R2_SECRET_ACCESS_KEY");

  const anySet = Boolean(accountId || bucketName || accessKeyId || secretAccessKey || rawEndpoint);

  if (!requireConfigured && !anySet) {
    return { valid: true, configured: false, missingVars };
  }

  if (missingVars.length > 0) {
    return {
      valid: false,
      configured: false,
      missingVars,
      error: `Server configuration error: Missing required Cloudflare R2 configuration (${missingVars.join(", ")})`,
    };
  }

  if (!ALLOWED_R2_REGIONS.has(region)) {
    return {
      valid: false,
      configured: false,
      error: `Server configuration error: Invalid R2_REGION '${region}'. Allowed values: ${Array.from(ALLOWED_R2_REGIONS).join(", ")}`,
    };
  }

  if (KNOWN_PLACEHOLDER_R2_VALUES.has(accountId.toLowerCase()) || !/^[a-zA-Z0-9_-]{6,64}$/.test(accountId)) {
    return {
      valid: false,
      configured: false,
      error: "Server configuration error: R2_ACCOUNT_ID is invalid or uses a placeholder value",
    };
  }

  if (
    KNOWN_PLACEHOLDER_R2_VALUES.has(bucketName.toLowerCase()) ||
    !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucketName) ||
    /^\d+\.\d+\.\d+\.\d+$/.test(bucketName)
  ) {
    return {
      valid: false,
      configured: false,
      error: "Server configuration error: R2_BUCKET_NAME must be a valid private bucket name (3-63 lowercase letters, digits, or hyphens)",
    };
  }

  if (KNOWN_PLACEHOLDER_R2_VALUES.has(accessKeyId.toLowerCase()) || accessKeyId.length < 8) {
    return {
      valid: false,
      configured: false,
      error: "Server configuration error: R2_ACCESS_KEY_ID is invalid or uses a placeholder value",
    };
  }

  if (KNOWN_PLACEHOLDER_R2_VALUES.has(secretAccessKey.toLowerCase()) || secretAccessKey.length < 16) {
    return {
      valid: false,
      configured: false,
      error: "Server configuration error: R2_SECRET_ACCESS_KEY is invalid or uses a placeholder value",
    };
  }

  const candidateEndpoint = rawEndpoint || `https://${accountId}.r2.cloudflarestorage.com`;
  let parsedEndpoint: URL;
  try {
    parsedEndpoint = new URL(candidateEndpoint);
  } catch {
    return {
      valid: false,
      configured: false,
      error: "Server configuration error: R2_ENDPOINT must be a valid URL",
    };
  }

  if (parsedEndpoint.username || parsedEndpoint.password || parsedEndpoint.search || parsedEndpoint.hash) {
    return {
      valid: false,
      configured: false,
      error: "Server configuration error: R2_ENDPOINT must not include credentials, query strings, or fragments",
    };
  }

  const isLocalTestEndpoint =
    process.env.NODE_ENV === "test" &&
    parsedEndpoint.protocol === "http:" &&
    (parsedEndpoint.hostname === "127.0.0.1" || parsedEndpoint.hostname === "localhost");

  if (!isLocalTestEndpoint) {
    if (parsedEndpoint.protocol !== "https:") {
      return {
        valid: false,
        configured: false,
        error: "Server configuration error: R2_ENDPOINT must use HTTPS",
      };
    }
    const hostLower = parsedEndpoint.hostname.toLowerCase();
    const expectedStandardHost = `${accountId.toLowerCase()}.r2.cloudflarestorage.com`;
    const expectedEuHost = `${accountId.toLowerCase()}.eu.r2.cloudflarestorage.com`;
    if (hostLower !== expectedStandardHost && hostLower !== expectedEuHost) {
      return {
        valid: false,
        configured: false,
        error: "Server configuration error: R2_ENDPOINT hostname must match the configured R2_ACCOUNT_ID Cloudflare R2 endpoint",
      };
    }
    if (parsedEndpoint.pathname && parsedEndpoint.pathname !== "/") {
      return {
        valid: false,
        configured: false,
        error: "Server configuration error: R2_ENDPOINT must be the account endpoint origin without a bucket path",
      };
    }
  }

  const normalizedEndpoint = parsedEndpoint.origin;

  const putTtl = parseBoundedIntEnv("R2_PRESIGNED_PUT_TTL_SECONDS", DEFAULT_R2_PRESIGNED_PUT_TTL_SECONDS, 60, 900);
  if (!putTtl.valid) return { valid: false, configured: false, error: putTtl.error };

  const getTtl = parseBoundedIntEnv("R2_PRESIGNED_GET_TTL_SECONDS", DEFAULT_R2_PRESIGNED_GET_TTL_SECONDS, 30, 600);
  if (!getTtl.valid) return { valid: false, configured: false, error: getTtl.error };

  const partTtl = parseBoundedIntEnv("R2_MULTIPART_PART_TTL_SECONDS", DEFAULT_R2_MULTIPART_PART_TTL_SECONDS, 60, 3600);
  if (!partTtl.valid) return { valid: false, configured: false, error: partTtl.error };

  const timeoutCheck = parseBoundedIntEnv("R2_REQUEST_TIMEOUT_MS", DEFAULT_R2_REQUEST_TIMEOUT_MS, 1000, 120000);
  if (!timeoutCheck.valid) return { valid: false, configured: false, error: timeoutCheck.error };

  const maxFileCheck = parseBoundedIntEnv(
    "R2_MAX_FILE_SIZE_BYTES",
    DEFAULT_R2_MAX_FILE_SIZE_BYTES,
    1024,
    100 * 1024 * 1024
  );
  if (!maxFileCheck.valid) return { valid: false, configured: false, error: maxFileCheck.error };

  const maxMultipartCheck = parseBoundedIntEnv(
    "R2_MAX_MULTIPART_FILE_SIZE_BYTES",
    DEFAULT_R2_MAX_MULTIPART_FILE_SIZE_BYTES,
    5 * 1024 * 1024,
    1024 * 1024 * 1024
  );
  if (!maxMultipartCheck.valid) return { valid: false, configured: false, error: maxMultipartCheck.error };

  return {
    valid: true,
    configured: true,
    config: {
      provider: "r2",
      accountId,
      bucketName,
      endpoint: normalizedEndpoint,
      region,
      accessKeyId,
      secretAccessKey,
      presignedPutTtlSeconds: putTtl.value,
      presignedGetTtlSeconds: getTtl.value,
      multipartPartTtlSeconds: partTtl.value,
      requestTimeoutMs: timeoutCheck.value,
      maxFileSizeBytes: maxFileCheck.value,
      maxMultipartFileSizeBytes: maxMultipartCheck.value,
    },
  };
}
