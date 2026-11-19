import { Request, Response, NextFunction } from "express";
import { adminAuth, adminDb } from "../config/firebaseAdmin.js";
import { computeAuthoritativeRoleClaims } from "../services/customClaimsService.js";

export interface AuthenticatedUser {
  uid: string;
  email: string;
  role: "admin" | "writer" | "customer";
  canProofread: boolean;
  specialistCapabilities: string[];
  status: "active" | "pending" | "suspended";
  isVerifiedWriter: boolean;
  verificationStatus?: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export async function authMiddleware(req: Request, res: Response, next: NextFunction): Promise<void> {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing or invalid authorization header" });
    return;
  }

  const token = authHeader.split("Bearer ")[1].trim();

  try {
    let uid: string;
    let email: string = "";

    // Test token support for local integration tests
    const isTestMode = process.env.NODE_ENV === "test" || process.env.ALLOW_TEST_AUTH === "true";
    if (isTestMode && token.startsWith("test-token:")) {
      // Format: test-token:<uid>:<role>:<email>
      const parts = token.split(":");
      uid = parts[1];
      email = parts[3] || `${uid}@example.com`;
    } else {
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

    const specialistCapabilities: string[] = Array.isArray(userData.specialistCapabilities)
      ? userData.specialistCapabilities
      : [];

    const authoritativeClaims = computeAuthoritativeRoleClaims(userData);
    const { role, canProofread, isVerifiedWriter } = authoritativeClaims;

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
  } catch (err: any) {
    console.error("[AuthMiddleware] Token verification failed:", err?.message || err);
    res.status(401).json({ error: "Unauthorized: Invalid or expired token" });
  }
}
