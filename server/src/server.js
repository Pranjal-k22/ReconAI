import { validateEnv } from "./config/env.js";
import { connectDatabase, disconnectDatabase } from "./config/database.js";
import { logger } from "./config/logger.js";
import app from "./app.js";

let server = null;
let isShuttingDown = false;

const startServer = async () => {
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
    }

    // Step 3: Start HTTP Server only after database connection succeeds
    const PORT = env.PORT || 5000;
    server = app.listen(PORT, () => {
      logger.info(`🚀 ReconAI API Server running on port ${PORT} [${env.NODE_ENV}]`);
    });
  } catch (error) {
    logger.error(`❌ Server startup failed: ${error.message}`);
    process.exit(1);
  }
};

const handleGracefulShutdown = async (signal) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}. Initiating graceful shutdown...`);

  if (server) {
    server.close(async () => {
      logger.info("HTTP server closed.");
      await disconnectDatabase();
      logger.info("Graceful shutdown completed cleanly.");
      process.exit(0);
    });

    setTimeout(() => {
      logger.error("Forced exit: Shutdown timed out.");
      process.exit(1);
    }, 10000);
  } else {
    await disconnectDatabase();
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

startServer();
