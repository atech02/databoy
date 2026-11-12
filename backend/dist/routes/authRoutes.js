import { Router } from "express";
export function createAuthRouter(limiters) {
    const router = Router();
    /**
     * POST /api/auth/login-guard
     * Pre-authentication IP rate-limited gate for login attempts (5 attempts / 15 min default).
     * Returns a uniform non-enumerating response without handling raw credentials.
     */
    router.post("/login-guard", limiters.authLogin, (_req, res) => {
        res.status(200).json({
            allowed: true,
            message: "Login attempt permitted",
        });
    });
    /**
     * POST /api/auth/password-recovery-guard
     * Pre-authentication IP rate-limited gate for password recovery attempts (3 attempts / 15 min default).
     * Always returns a generic status without revealing account existence.
     */
    router.post("/password-recovery-guard", limiters.passwordRecovery, (_req, res) => {
        res.status(200).json({
            allowed: true,
            message: "Password recovery request permitted",
        });
    });
    return router;
}
