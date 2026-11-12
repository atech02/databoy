import { ALLOWED_PRODUCTION_BASE_URLS, ALLOWED_SANDBOX_BASE_URLS, DEFAULT_LIPILA_TIMEOUT_MS, SANDBOX_BASE_URL, getLipilaCurrency, getLipilaRequestTimeoutMs, isLipilaProductionEnv, isPlaceholderApiKey, isSandboxPlaceholderOrLiveApiKeyMismatch, resolveLipilaEnvironment, validateLipilaBaseUrl, validateLipilaConfig, } from "../config/env.js";
export { ALLOWED_PRODUCTION_BASE_URLS, ALLOWED_SANDBOX_BASE_URLS, SANDBOX_BASE_URL, validateLipilaConfig, resolveLipilaEnvironment, };
export const LIPILA_HTTP_TIMEOUT_MS = DEFAULT_LIPILA_TIMEOUT_MS;
export function validateProductionBaseUrl(rawUrl) {
    return validateLipilaBaseUrl("production", rawUrl);
}
export function validateSandboxBaseUrl(rawUrl) {
    return validateLipilaBaseUrl("sandbox", rawUrl);
}
/**
 * Validates and normalizes Zambian phone numbers to 260XXXXXXXXX format.
 */
export function normalizeZambianPhone(phone) {
    if (!phone || typeof phone !== "string") {
        return { valid: false, error: "Phone number is required" };
    }
    // Remove spaces, hyphens, brackets
    const cleaned = phone.replace(/[\s\-\(\)]/g, "");
    // Match Zambian mobile formats
    // (optional +260 or 260 or 0) followed by 9 digits starting with 9 or 7, followed by 5, 6, or 7
    const match = cleaned.match(/^(?:\+?260|0)?([97][567]\d{7})$/);
    if (!match) {
        return {
            valid: false,
            error: "Invalid Zambian mobile number. Must be an active Airtel (097/077), MTN (096/076), or Zamtel (095/075) number.",
        };
    }
    const nationalNumber = match[1];
    const normalized = `260${nationalNumber}`;
    return { valid: true, normalized };
}
/**
 * Validates network and checks prefix compatibility
 */
export function validateNetwork(network, normalizedPhone) {
    const allowedNetworks = ["airtel_money", "mtn_money", "zamtel_kwacha"];
    const lowerNet = (network || "").toLowerCase().trim();
    // Explicit card rejection
    if (["card", "visa", "mastercard", "amex", "credit_card", "debit_card"].includes(lowerNet)) {
        return { valid: false, error: "Card payments (Visa/Mastercard) are not supported. DataBoy exclusively supports Zambian Mobile Money." };
    }
    if (!allowedNetworks.includes(lowerNet)) {
        return {
            valid: false,
            error: `Unsupported network '${network}'. Allowed networks: airtel_money, mtn_money, zamtel_kwacha.`,
        };
    }
    const typedNetwork = lowerNet;
    return { valid: true, detectedNetwork: typedNetwork };
}
/**
 * Masks a normalized phone number for privacy display: e.g. 260971234567 -> 260*****4567
 */
export function maskPhoneNumber(phone) {
    if (!phone || phone.length < 7)
        return phone || "";
    const prefix = phone.substring(0, 3);
    const suffix = phone.substring(phone.length - 4);
    return `${prefix}*****${suffix}`;
}
export function isLipilaProduction() {
    return isLipilaProductionEnv();
}
export function isPlaceholderKey(key) {
    return isPlaceholderApiKey(key);
}
function isTimeoutError(err) {
    if (!err)
        return false;
    const code = err.code || err.cause?.code;
    return (err.name === "TimeoutError" ||
        err.name === "AbortError" ||
        code === "ETIMEDOUT" ||
        code === "UND_ERR_CONNECT_TIMEOUT" ||
        code === "UND_ERR_HEADERS_TIMEOUT" ||
        (typeof err.message === "string" && err.message.toLowerCase().includes("timeout")));
}
export class LipilaService {
    apiKey;
    environment;
    baseUrl;
    customFetch;
    // In-memory mock store exclusively for isolated test environments (NODE_ENV === "test")
    mockTransactions = new Map();
    constructor(options = {}) {
        this.customFetch = options.fetchImpl;
        const resolvedEnv = resolveLipilaEnvironment();
        this.environment = resolvedEnv.env;
        this.apiKey = process.env.LIPILA_API_KEY || "";
        if (this.environment === "production") {
            this.baseUrl = process.env.LIPILA_BASE_URL || ALLOWED_PRODUCTION_BASE_URLS[0];
            const urlCheck = validateProductionBaseUrl(this.baseUrl);
            if (!urlCheck.valid) {
                throw new Error(urlCheck.error);
            }
            this.baseUrl = urlCheck.normalizedUrl;
        }
        else {
            const candidateUrl = process.env.LIPILA_BASE_URL || SANDBOX_BASE_URL;
            const urlCheck = validateSandboxBaseUrl(candidateUrl);
            this.baseUrl = urlCheck.valid ? urlCheck.normalizedUrl : candidateUrl;
        }
    }
    setFetchImplementation(fetchImpl) {
        this.customFetch = fetchImpl;
    }
    getFetchImpl() {
        return this.customFetch || globalThis.fetch;
    }
    isProduction() {
        return (this.environment === "production" ||
            isLipilaProduction());
    }
    getEffectiveBaseUrl() {
        if (process.env.LIPILA_BASE_URL !== undefined) {
            return process.env.LIPILA_BASE_URL;
        }
        return this.isProduction() ? ALLOWED_PRODUCTION_BASE_URLS[0] : this.baseUrl;
    }
    getEffectiveApiKey() {
        return process.env.LIPILA_API_KEY !== undefined ? process.env.LIPILA_API_KEY : this.apiKey;
    }
    /**
     * Validates production configuration (SEC-02) and sandbox/production environment isolation.
     */
    validateProductionConfig() {
        const envResolution = resolveLipilaEnvironment();
        if (!envResolution.valid) {
            return { valid: false, error: envResolution.error };
        }
        if (this.isProduction() || envResolution.env === "production") {
            if (process.env.LIPILA_MOCK === "true") {
                return {
                    valid: false,
                    error: "Server configuration error: Mock payment mode (LIPILA_MOCK=true) is prohibited in production",
                };
            }
            const key = this.getEffectiveApiKey();
            const keyCheck = isSandboxPlaceholderOrLiveApiKeyMismatch(key, "production", false);
            if (!keyCheck.valid) {
                return {
                    valid: false,
                    error: keyCheck.error || "Server configuration error: Valid LIPILA_API_KEY is mandatory in production",
                };
            }
            const urlCheck = validateProductionBaseUrl(this.getEffectiveBaseUrl());
            if (!urlCheck.valid) {
                return {
                    valid: false,
                    error: urlCheck.error,
                };
            }
            const currencyCheck = getLipilaCurrency();
            if (!currencyCheck.valid) {
                return { valid: false, error: currencyCheck.error };
            }
            const timeoutCheck = getLipilaRequestTimeoutMs();
            if (!timeoutCheck.valid) {
                return { valid: false, error: timeoutCheck.error };
            }
            return { valid: true, baseUrl: urlCheck.normalizedUrl };
        }
        // Sandbox validations: never allow production URL or unapproved hosts
        const sandboxUrlCheck = validateSandboxBaseUrl(this.getEffectiveBaseUrl());
        if (!sandboxUrlCheck.valid) {
            return { valid: false, error: sandboxUrlCheck.error };
        }
        const currencyCheck = getLipilaCurrency();
        if (!currencyCheck.valid) {
            return { valid: false, error: currencyCheck.error };
        }
        const timeoutCheck = getLipilaRequestTimeoutMs();
        if (!timeoutCheck.valid) {
            return { valid: false, error: timeoutCheck.error };
        }
        return { valid: true, baseUrl: sandboxUrlCheck.normalizedUrl };
    }
    validateRuntimeCall() {
        const envCheck = this.validateProductionConfig();
        if (!envCheck.valid) {
            return {
                valid: false,
                apiKey: "",
                baseUrl: "",
                currency: "ZMW",
                timeoutMs: LIPILA_HTTP_TIMEOUT_MS,
                allowMock: false,
                error: envCheck.error,
            };
        }
        const isTestEnv = process.env.NODE_ENV === "test";
        const resolvedEnv = this.isProduction() ? "production" : resolveLipilaEnvironment().env;
        if (!isTestEnv && process.env.LIPILA_MOCK === "true") {
            return {
                valid: false,
                apiKey: "",
                baseUrl: "",
                currency: "ZMW",
                timeoutMs: LIPILA_HTTP_TIMEOUT_MS,
                allowMock: false,
                error: "Server configuration error: LIPILA_MOCK=true is prohibited outside isolated test environments",
            };
        }
        const currentApiKey = this.getEffectiveApiKey();
        const allowMock = isTestEnv &&
            resolvedEnv !== "production" &&
            !this.customFetch &&
            process.env.LIPILA_MOCK !== "false";
        const timeoutMs = getLipilaRequestTimeoutMs().timeoutMs;
        const currency = getLipilaCurrency().currency;
        if (!allowMock) {
            const keyCheck = isSandboxPlaceholderOrLiveApiKeyMismatch(currentApiKey, resolvedEnv, isTestEnv && Boolean(this.customFetch));
            if (!keyCheck.valid) {
                return {
                    valid: false,
                    apiKey: "",
                    baseUrl: "",
                    currency,
                    timeoutMs,
                    allowMock: false,
                    error: keyCheck.error,
                };
            }
            // Outside isolated test mock/fetch stubs, verify webhook secret & overall real-payment config too
            if (!isTestEnv) {
                const fullCheck = validateLipilaConfig({ requireCredentials: true });
                if (!fullCheck.valid) {
                    return {
                        valid: false,
                        apiKey: "",
                        baseUrl: "",
                        currency,
                        timeoutMs,
                        allowMock: false,
                        error: fullCheck.error,
                    };
                }
            }
        }
        return {
            valid: true,
            apiKey: currentApiKey,
            baseUrl: envCheck.baseUrl || this.getEffectiveBaseUrl(),
            currency,
            timeoutMs,
            allowMock,
        };
    }
    /**
     * Initiates mobile money collection prompt to the customer's phone
     */
    async initiateCollection(req) {
        const { referenceId, amount, narration, accountNumber, network, customerEmail } = req;
        const runtime = this.validateRuntimeCall();
        if (!runtime.valid) {
            return {
                success: false,
                referenceId,
                status: "Failed",
                message: runtime.error || "Configuration error: Valid LIPILA_API_KEY is required in production.",
            };
        }
        if (runtime.allowMock) {
            const paymentType = network === "airtel_money"
                ? "AirtelMoney"
                : network === "mtn_money"
                    ? "MTNMoney"
                    : "ZamtelKwacha";
            const mockTx = {
                referenceId,
                status: "Pending",
                amount,
                currency: "ZMW",
                type: "Collection",
                paymentType,
                transactionId: `LPL-COL-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                accountNumber,
                network,
                message: `Mobile money prompt sent to ${accountNumber}. Please authorize on your handset.`,
                timestamp: new Date().toISOString(),
            };
            this.mockTransactions.set(referenceId, mockTx);
            return {
                success: true,
                referenceId,
                status: "Pending",
                transactionId: mockTx.transactionId,
                message: mockTx.message,
                raw: mockTx,
            };
        }
        try {
            const fetchFn = this.getFetchImpl();
            // OPS-01: Outbound HTTP timeout set to 15000ms
            const response = await fetchFn(`${runtime.baseUrl}/api/v1/collections/mobile-money`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": runtime.apiKey,
                },
                body: JSON.stringify({
                    referenceId,
                    amount,
                    narration,
                    accountNumber,
                    currency: runtime.currency,
                    customerEmail: customerEmail || "customer@databoy.com",
                }),
                signal: AbortSignal.timeout(runtime.timeoutMs),
            });
            let data = {};
            let malformedJson = false;
            try {
                data = await response.json();
            }
            catch {
                malformedJson = true;
            }
            if (!response.ok) {
                const isTransientGatewayStatus = response.status === 408 || response.status === 429 || response.status >= 500;
                if (isTransientGatewayStatus) {
                    return {
                        success: false,
                        referenceId,
                        status: "Unknown",
                        uncertain: true,
                        message: data?.message || `Lipila returned uncertain status (${response.status}). Reconciliation required.`,
                        raw: data,
                    };
                }
                return {
                    success: false,
                    referenceId,
                    status: "Failed",
                    message: data?.message || `Lipila collection error (${response.status})`,
                    raw: data,
                };
            }
            if (malformedJson) {
                return {
                    success: false,
                    referenceId,
                    status: "Unknown",
                    uncertain: true,
                    message: "Lipila collection returned an unparseable response body. Reference preserved for reconciliation.",
                };
            }
            return {
                success: true,
                referenceId,
                status: data.status === "Successful" ? "Successful" : "Pending",
                transactionId: data.transactionId || data.id,
                message: data.message || "Prompt initiated successfully",
                raw: data,
            };
        }
        catch (err) {
            const timedOut = isTimeoutError(err);
            if (timedOut) {
                console.warn(`[Lipila Collection Timeout]: Request for reference ${referenceId} timed out after ${runtime.timeoutMs}ms`);
            }
            else {
                console.warn(`[Lipila Collection Transport Uncertainty]: Request for reference ${referenceId} encountered transport failure (${err?.code || err?.name || "NetworkError"})`);
            }
            return {
                success: false,
                referenceId,
                status: "Unknown",
                isTimeout: timedOut,
                uncertain: true,
                message: timedOut
                    ? "Lipila initiation request timed out after 15s. Transaction reference preserved with uncertain outcome."
                    : `Transport error contacting Lipila (${err?.code || err?.message || "Network failure"}). Transaction reference preserved with uncertain outcome.`,
            };
        }
    }
    /**
     * Checks authoritative collection status with Lipila
     */
    async checkCollectionStatus(referenceId) {
        const runtime = this.validateRuntimeCall();
        if (!runtime.valid) {
            return {
                referenceId,
                status: "Failed",
                message: runtime.error || "Configuration error: Valid LIPILA_API_KEY is required in production.",
            };
        }
        if (runtime.allowMock) {
            const mock = this.mockTransactions.get(referenceId);
            if (mock) {
                return mock;
            }
            return {
                referenceId,
                status: "Failed",
                message: "Transaction not found in mock store",
            };
        }
        try {
            const fetchFn = this.getFetchImpl();
            // OPS-01: Outbound HTTP timeout set to 15000ms
            const response = await fetchFn(`${runtime.baseUrl}/api/v1/collections/check-status?referenceId=${encodeURIComponent(referenceId)}`, {
                method: "GET",
                headers: {
                    "x-api-key": runtime.apiKey,
                },
                signal: AbortSignal.timeout(runtime.timeoutMs),
            });
            let data = {};
            let malformedJson = false;
            try {
                data = await response.json();
            }
            catch {
                malformedJson = true;
            }
            if (!response.ok) {
                return {
                    referenceId,
                    status: response.status === 404 ? "Failed" : "Unknown",
                    uncertain: response.status !== 404,
                    message: data?.message || `Lipila status error (${response.status})`,
                };
            }
            if (malformedJson) {
                return {
                    referenceId,
                    status: "Unknown",
                    uncertain: true,
                    message: "Lipila status check returned an unparseable response body. Outcome uncertain; will retry.",
                };
            }
            const mappedStatus = data.status === "Successful"
                ? "Successful"
                : data.status === "Failed"
                    ? "Failed"
                    : data.status === "Cancelled"
                        ? "Cancelled"
                        : data.status === "Expired"
                            ? "Expired"
                            : "Pending";
            return {
                referenceId: data.referenceId || referenceId,
                status: mappedStatus,
                amount: typeof data.amount === "number" ? data.amount : parseFloat(data.amount || "0"),
                currency: data.currency || "ZMW",
                type: data.type || "Collection",
                paymentType: data.paymentType || (data.network === "airtel_money" ? "AirtelMoney" : data.network === "mtn_money" ? "MTNMoney" : "ZamtelKwacha"),
                transactionId: data.transactionId,
                accountNumber: data.accountNumber,
                network: data.network,
                message: data.message,
                timestamp: data.timestamp || new Date().toISOString(),
            };
        }
        catch (err) {
            const timedOut = isTimeoutError(err);
            if (timedOut) {
                console.warn(`[Lipila Status Timeout]: Status check for reference ${referenceId} timed out after ${runtime.timeoutMs}ms`);
            }
            else {
                console.warn(`[Lipila Status Transport Uncertainty]: Status check for reference ${referenceId} encountered transport failure (${err?.code || err?.name || "NetworkError"})`);
            }
            return {
                referenceId,
                status: "Unknown",
                isTimeout: timedOut,
                uncertain: true,
                message: timedOut
                    ? "Lipila status check timed out after 15s. Outcome uncertain; will retry."
                    : `Transport error querying Lipila status (${err?.code || err?.message || "Network failure"}). Outcome uncertain; will retry.`,
            };
        }
    }
    /**
     * Initiates writer disbursement via mobile money
     */
    async initiateDisbursement(req) {
        const { referenceId, amount, narration, accountNumber, network, recipientName } = req;
        const runtime = this.validateRuntimeCall();
        if (!runtime.valid) {
            return {
                success: false,
                referenceId,
                status: "Failed",
                message: runtime.error || "Configuration error: Valid LIPILA_API_KEY is required in production.",
            };
        }
        if (runtime.allowMock) {
            return {
                success: true,
                referenceId,
                status: "Successful",
                transactionId: `LPL-DISB-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                message: `Disbursement of ZMW ${amount} to ${accountNumber} (${network}) completed successfully.`,
            };
        }
        try {
            const fetchFn = this.getFetchImpl();
            // OPS-01: Outbound HTTP timeout set to 15000ms
            const response = await fetchFn(`${runtime.baseUrl}/api/v1/disbursements/mobile-money`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-api-key": runtime.apiKey,
                },
                body: JSON.stringify({
                    referenceId,
                    amount,
                    narration,
                    accountNumber,
                    currency: runtime.currency,
                    recipientName: recipientName || "Writer",
                }),
                signal: AbortSignal.timeout(runtime.timeoutMs),
            });
            let data = {};
            let malformedJson = false;
            try {
                data = await response.json();
            }
            catch {
                malformedJson = true;
            }
            if (!response.ok) {
                const isTransientGatewayStatus = response.status === 408 || response.status === 429 || response.status >= 500;
                if (isTransientGatewayStatus) {
                    return {
                        success: false,
                        referenceId,
                        status: "Unknown",
                        uncertain: true,
                        message: data?.message ||
                            `Lipila disbursement returned uncertain status (${response.status}). Manual reconciliation required; do not blind-retry.`,
                    };
                }
                return {
                    success: false,
                    referenceId,
                    status: "Failed",
                    message: data?.message || `Disbursement failed (${response.status})`,
                };
            }
            if (malformedJson) {
                return {
                    success: false,
                    referenceId,
                    status: "Unknown",
                    uncertain: true,
                    message: "Lipila disbursement returned an unparseable response body. Reference preserved for manual reconciliation; do not blind-retry.",
                };
            }
            return {
                success: true,
                referenceId,
                status: data.status === "Successful" ? "Successful" : "Pending",
                transactionId: data.transactionId || data.id,
                message: data.message || "Disbursement initiated",
            };
        }
        catch (err) {
            const timedOut = isTimeoutError(err);
            if (timedOut) {
                console.warn(`[Lipila Disbursement Timeout]: Disbursement for reference ${referenceId} timed out after ${runtime.timeoutMs}ms`);
            }
            else {
                console.warn(`[Lipila Disbursement Transport Uncertainty]: Disbursement for reference ${referenceId} encountered transport failure (${err?.code || err?.name || "NetworkError"})`);
            }
            return {
                success: false,
                referenceId,
                status: "Unknown",
                isTimeout: timedOut,
                uncertain: true,
                message: timedOut
                    ? "Lipila disbursement request timed out after 15s. Preserved with uncertain outcome."
                    : `Disbursement transport error (${err?.code || err?.message || "Network failure"}). Preserved with uncertain outcome.`,
            };
        }
    }
    /**
     * Helper for tests to update mock status
     */
    setMockStatus(referenceId, status, details = {}) {
        const existing = this.mockTransactions.get(referenceId) || {
            referenceId,
            status: "Pending",
            timestamp: new Date().toISOString(),
        };
        this.mockTransactions.set(referenceId, {
            ...existing,
            ...details,
            status,
        });
    }
}
export const lipilaService = new LipilaService();
