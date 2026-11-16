import "./config/env.js";
import { app } from "./app.js";
import { shutdownRateLimitClients } from "./middleware/rateLimit.js";
import { r2StorageService } from "./services/r2StorageService.js";

const PORT = parseInt(process.env.PORT || "4001", 10);

const server = app.listen(PORT, () => {
  console.log(`[DataBoy Backend] Server listening on port ${PORT}`);
  console.log(`[DataBoy Backend] Health check: http://localhost:${PORT}/api/health`);

  // Ensure Cloudflare R2 bucket CORS allows live Web App and Firebase domains
  if (process.env.STORAGE_PROVIDER === "r2" || process.env.R2_REQUIRED === "true") {
    r2StorageService
      .ensureDefaultBucketCors()
      .then((res) => {
        if (res.applied) {
          console.log("[DataBoy Backend] R2 bucket CORS configuration applied successfully.");
        } else {
          console.log("[DataBoy Backend] R2 bucket CORS verified.");
        }
      })
      .catch((err) => {
        console.warn("[DataBoy Backend] R2 bucket CORS verification warning:", err?.message || err);
      });
  }
});

const handleShutdown = async (signal: string) => {
  console.log(`[DataBoy Backend] Received ${signal}. Shutting down gracefully...`);
  try {
    if (typeof (app as any).shutdownRateLimiters === "function") {
      await (app as any).shutdownRateLimiters();
    }
    await shutdownRateLimitClients();
  } catch {
    // Ignore store shutdown errors during termination
  }
  server.close(() => {
    console.log("[DataBoy Backend] HTTP server closed.");
    process.exit(0);
  });
};

process.on("SIGINT", () => void handleShutdown("SIGINT"));
process.on("SIGTERM", () => void handleShutdown("SIGTERM"));
