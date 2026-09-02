import { validateEnv } from "./config/env.js";
import { connectDatabase, disconnectDatabase } from "./config/database.js";
import { logger } from "./config/logger.js";
import app from "./app.js";

// Validate environment early
const env = validateEnv();

let server = null;
let isShuttingDown = false;

const startServer = async () => {
  try {
    // Attempt database connection if URI is available
    if (env.MONGODB_URI) {
      await connectDatabase(env.MONGODB_URI);
    } else {
      logger.warn("⚠️ MONGODB_URI not provided. Server starting without database connection.");
    }

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

    // Force exit after 10 seconds if shutdown hangs
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
