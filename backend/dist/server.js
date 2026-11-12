import "./config/env.js";
import { app } from "./app.js";
import { shutdownRateLimitClients } from "./middleware/rateLimit.js";
const PORT = parseInt(process.env.PORT || "4001", 10);
const server = app.listen(PORT, () => {
    console.log(`[DataBoy Backend] Server listening on port ${PORT}`);
    console.log(`[DataBoy Backend] Health check: http://localhost:${PORT}/api/health`);
});
const handleShutdown = async (signal) => {
    console.log(`[DataBoy Backend] Received ${signal}. Shutting down gracefully...`);
    try {
        if (typeof app.shutdownRateLimiters === "function") {
            await app.shutdownRateLimiters();
        }
        await shutdownRateLimitClients();
    }
    catch {
        // Ignore store shutdown errors during termination
    }
    server.close(() => {
        console.log("[DataBoy Backend] HTTP server closed.");
        process.exit(0);
    });
};
process.on("SIGINT", () => void handleShutdown("SIGINT"));
process.on("SIGTERM", () => void handleShutdown("SIGTERM"));
