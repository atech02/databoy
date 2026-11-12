export function requireRole(...allowedRoles) {
    return (req, res, next) => {
        if (!req.user) {
            res.status(401).json({ error: "Unauthorized: Authentication required" });
            return;
        }
        if (!allowedRoles.includes(req.user.role)) {
            res.status(403).json({
                error: `Forbidden: Requires one of [${allowedRoles.join(", ")}] role. Current role: ${req.user.role}`,
            });
            return;
        }
        next();
    };
}
export function requireProofreadCapability(req, res, next) {
    if (!req.user) {
        res.status(401).json({ error: "Unauthorized: Authentication required" });
        return;
    }
    // Admins always have authority
    if (req.user.role === "admin") {
        next();
        return;
    }
    // Writers must have proofreading capability
    if (req.user.role === "writer" && req.user.canProofread) {
        next();
        return;
    }
    res.status(403).json({
        error: "Forbidden: Specialist proofreading capability required",
    });
}
