import { adminAuth, adminDb } from "../config/firebaseAdmin.js";
let testAuthClientOverride = null;
function isTestEnvironment() {
    return ((process.env.NODE_ENV || "").trim().toLowerCase() === "test" ||
        Boolean(process.env.FIRESTORE_EMULATOR_HOST?.trim()));
}
/**
 * Allows automated tests in test/emulator environments to inject a deterministic
 * Firebase Auth claims client (for verifying claim preservation and failure rollback).
 * Ignored outside test/emulator environments.
 */
export function setCustomClaimsAuthClientForTesting(client) {
    if (!isTestEnvironment()) {
        return;
    }
    testAuthClientOverride = client;
}
/**
 * Computes authoritative role and writer verification claims from a Firestore `users/{uid}` document.
 * Preserves legacy `proofreader` compatibility while strictly blocking customers and unverified/suspended accounts.
 */
export function computeAuthoritativeRoleClaims(userData) {
    const rawRole = userData.role || "customer";
    const role = rawRole === "admin"
        ? "admin"
        : rawRole === "writer" || rawRole === "proofreader"
            ? "writer"
            : "customer";
    const isSuspended = userData.status === "suspended";
    const specialistCapabilities = Array.isArray(userData.specialistCapabilities)
        ? userData.specialistCapabilities
        : [];
    const isUnverified = userData.isVerifiedWriter === false ||
        ["pending_review", "under_review", "draft", "incomplete", "rejected", "clarification_required"].includes(userData.verificationStatus);
    const isVerifiedWriter = !isSuspended &&
        (role === "admin" ||
            (role === "writer" &&
                !isUnverified &&
                (userData.isVerifiedWriter === true ||
                    userData.verificationStatus === "approved" ||
                    (userData.status === "active" && userData.writerStatus !== "inactive"))));
    const canProofread = !isSuspended &&
        (role === "admin" ||
            (role === "writer" &&
                isVerifiedWriter &&
                (rawRole === "proofreader" ||
                    userData.canProofread === true ||
                    specialistCapabilities.includes("proofreading"))));
    return {
        role,
        isVerifiedWriter,
        canProofread,
    };
}
/**
 * Synchronizes Firebase Authentication custom claims without overwriting unrelated existing claims.
 * Retrieves the user's current custom claims, merges only the intended role/verification fields,
 * and writes back the merged object. Fails closed when synchronization fails outside unmocked emulator tests.
 */
export async function syncUserCustomClaims(uid, patch, options) {
    const isTest = isTestEnvironment();
    const useInjectedClient = isTest && testAuthClientOverride !== null;
    const authClient = useInjectedClient
        ? testAuthClientOverride
        : adminAuth;
    try {
        const userRecord = await authClient.getUser(uid);
        const existingClaims = userRecord && userRecord.customClaims && typeof userRecord.customClaims === "object"
            ? { ...userRecord.customClaims }
            : {};
        const preservedClaimKeys = Object.keys(existingClaims).filter((key) => key !== "role" && key !== "isVerifiedWriter" && key !== "canProofread");
        const mergedClaims = {
            ...existingClaims,
            role: patch.role,
            isVerifiedWriter: patch.isVerifiedWriter,
            canProofread: patch.canProofread,
        };
        await authClient.setCustomUserClaims(uid, mergedClaims);
        return {
            synced: true,
            mergedClaims,
            preservedClaimKeys,
        };
    }
    catch (err) {
        if (isTest && !useInjectedClient && !options?.enforceInTest) {
            return {
                synced: false,
                skippedInTest: true,
                error: err?.message || "Skipped in Firestore-only emulator test",
            };
        }
        console.error(`[CustomClaimsService] Failed to synchronize Firebase Auth custom claims for ${uid}:`, err);
        return {
            synced: false,
            error: err?.message || "Custom claim synchronization failed",
        };
    }
}
/**
 * Reconciles Firebase Authentication custom claims for a user from their authoritative
 * Firestore `users/{uid}` document while preserving unrelated existing claims.
 */
export async function reconcileUserClaimsFromFirestore(uid, options) {
    const userSnap = await adminDb.collection("users").doc(uid).get();
    if (!userSnap.exists) {
        throw new Error("USER_NOT_FOUND");
    }
    const userData = userSnap.data() || {};
    const expectedClaims = computeAuthoritativeRoleClaims(userData);
    const syncResult = await syncUserCustomClaims(uid, expectedClaims, options);
    return {
        ...syncResult,
        expectedClaims,
    };
}
