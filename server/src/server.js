import { pathToFileURL } from "url";
import { validateEnv } from "./config/env.js";
import { connectDatabase, disconnectDatabase } from "./config/database.js";
import { logger } from "./config/logger.js";
import { startMonitoringWorker, stopMonitoringWorker } from "./services/monitoring/monitoringWorker.js";
import { initDefaultAccounts } from "./services/auth/accountService.js";
import app from "./app.js";

let server = null;
let monitoringWorker = null;
let isShuttingDown = false;

export const getMonitoringWorker = () => monitoringWorker;

export const startServer = async ({ customFetch = null } = {}) => {
  try {
    // Step 1: Validate environment variables early
    const env = validateEnv();

    // Step 2: In dev & prod, MongoDB connection is mandatory before listening
    if (env.NODE_ENV !== "test" || env.MONGODB_URI) {
      if (!env.MONGODB_URI) {
        logger.error("❌ Fatal Startup Error: MONGODB_URI is required to start ReconAI API Server.");
        process.exit(1);
      }
      await connectDatabase(env.MONGODB_URI);

      // Provision default demo accounts in development or demo mode
      if (env.NODE_ENV !== "production" || env.DEMO_MODE) {
        await initDefaultAccounts();
      }
    }

    // Step 3: Start In-Process Payment Monitoring Worker if enabled
    if (env.MONITORING_WORKER_ENABLED !== false) {
      monitoringWorker = startMonitoringWorker({
        intervalMs: env.MONITORING_INTERVAL_MS || 30000,
        maxTasks: env.MONITORING_MAX_CONCURRENT_READS || 5,
        leaseDurationMs: env.MONITORING_LEASE_DURATION_MS || 30000,
        customFetch
      });
    }

    // Step 4: Start HTTP Server only after database connection succeeds
    const PORT = env.PORT || 5000;
    server = app.listen(PORT, () => {
      logger.info(`🚀 ReconAI API Server running on port ${PORT} [${env.NODE_ENV}]`);
    });

    return { server, monitoringWorker };
  } catch (error) {
    logger.error(`❌ Server startup failed: ${error.message}`);
    process.exit(1);
  }
};

export const handleGracefulShutdown = async (signal, { exitProcess = true } = {}) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}. Initiating graceful shutdown...`);

  // Stop monitoring sweeps immediately
  if (monitoringWorker) {
    stopMonitoringWorker(monitoringWorker);
    monitoringWorker = null;
  }

  if (server) {
    await new Promise((resolve) => {
      server.close(async () => {
        logger.info("HTTP server closed.");
        await disconnectDatabase();
        resolve();
      });
    });
  } else {
    await disconnectDatabase();
  }

  logger.info("Graceful shutdown completed cleanly.");
  isShuttingDown = false;
  server = null;

  if (exitProcess) {
    process.exit(0);
  }
};

process.on("SIGINT", () => handleGracefulShutdown("SIGINT"));
process.on("SIGTERM", () => handleGracefulShutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled Rejection:", reason);
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", error);
  process.exit(1);
});

// Detect if server.js is executed directly as main CLI script
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startServer();
}
