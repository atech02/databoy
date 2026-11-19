import { adminAuth, adminDb } from "../config/firebaseAdmin.js";
export async function authMiddleware(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        res.status(401).json({ error: "Missing or invalid authorization header" });
        return;
    }
    const token = authHeader.split("Bearer ")[1].trim();
    try {
        let uid;
        let email = "";
        // Test token support for local integration tests
        const isTestMode = process.env.NODE_ENV === "test" || process.env.ALLOW_TEST_AUTH === "true";
        if (isTestMode && token.startsWith("test-token:")) {
            // Format: test-token:<uid>:<role>:<email>
            const parts = token.split(":");
            uid = parts[1];
            email = parts[3] || `${uid}@example.com`;
        }
        else {
            const decoded = await adminAuth.verifyIdToken(token);
            uid = decoded.uid;
            email = decoded.email || "";
        }
        // Lookup user in Firestore to verify authoritative role and account status
        const userDoc = await adminDb.collection("users").doc(uid).get();
        if (!userDoc.exists) {
            res.status(401).json({ error: "User profile not found" });
            return;
        }
        const userData = userDoc.data() || {};
        if (userData.status === "suspended") {
            res.status(403).json({ error: "Account is suspended. Access denied." });
            return;
        }
        const rawRole = userData.role || "customer";
        // Authoritative 3-role mapping: proofreader legacy accounts map to writer
        const role = rawRole === "admin" ? "admin" : rawRole === "writer" || rawRole === "proofreader" ? "writer" : "customer";
        const specialistCapabilities = Array.isArray(userData.specialistCapabilities)
            ? userData.specialistCapabilities
            : [];
        const canProofread = rawRole === "proofreader" ||
            userData.canProofread === true ||
            specialistCapabilities.includes("proofreading");
        const isUnverified = userData.isVerifiedWriter === false ||
            ["pending_review", "under_review", "draft", "incomplete", "rejected", "clarification_required"].includes(userData.verificationStatus);
        const isVerifiedWriter = role === "admin" ||
            (!isUnverified &&
                (userData.isVerifiedWriter === true ||
                    userData.verificationStatus === "approved" ||
                    userData.status === "active"));
        req.user = {
            uid,
            email,
            role,
            canProofread,
            specialistCapabilities,
            status: userData.status || "active",
            isVerifiedWriter,
            verificationStatus: userData.verificationStatus,
        };
        next();
    }
    catch (err) {
        console.error("[AuthMiddleware] Token verification failed:", err?.message || err);
        res.status(401).json({ error: "Unauthorized: Invalid or expired token" });
    }
}
