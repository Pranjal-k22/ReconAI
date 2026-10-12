import { pathToFileURL } from "url";
import { validateEnv } from "./config/env.js";
import { connectDatabase, disconnectDatabase } from "./config/database.js";
import { logger } from "./config/logger.js";
import { startMonitoringWorker, stopMonitoringWorker } from "./services/monitoring/monitoringWorker.js";
import { startOrchestrationWorker, stopOrchestrationWorker } from "./services/orchestration/orchestrationWorker.js";

let workerInstance = null;
let orchestrationWorkerInstance = null;
let isShuttingDown = false;

export const getWorkerInstance = () => workerInstance;
export const getOrchestrationWorkerInstance = () => orchestrationWorkerInstance;

export const startStandaloneWorker = async ({ customFetch = null } = {}) => {
  try {
    const env = validateEnv();

    if (!env.MONGODB_URI) {
      logger.error("❌ Fatal Startup Error: MONGODB_URI is required to run ReconAI Monitoring Worker.");
      process.exit(1);
    }

    await connectDatabase(env.MONGODB_URI);

    workerInstance = startMonitoringWorker({
      intervalMs: env.MONITORING_INTERVAL_MS || 30000,
      maxTasks: env.MONITORING_MAX_CONCURRENT_READS || 5,
      leaseDurationMs: env.MONITORING_LEASE_DURATION_MS || 30000,
      workerId: `worker_proc_${process.pid}`,
      customFetch
    });

    if (env.ORCHESTRATOR_WORKER_ENABLED === true) {
      orchestrationWorkerInstance = startOrchestrationWorker({
        intervalMs: env.ORCHESTRATOR_INTERVAL_MS || 30000,
        maxTasks: env.ORCHESTRATOR_MAX_CONCURRENT_TASKS || 5,
        leaseDurationMs: env.ORCHESTRATOR_LEASE_DURATION_MS || 30000,
        workerId: `orch_worker_proc_${process.pid}`,
        customFetch
      });
    }

    logger.info(`🚀 ReconAI Payment Monitoring Worker process running [PID: ${process.pid}]`);
    return { workerInstance, orchestrationWorkerInstance };
  } catch (err) {
    logger.error(`❌ Monitoring Worker process startup failed: ${err.message}`);
    process.exit(1);
  }
};

export const handleWorkerShutdown = async (signal, { exitProcess = true } = {}) => {
  if (isShuttingDown) return;
  isShuttingDown = true;

  logger.info(`Received ${signal}. Gracefully stopping Monitoring Worker process...`);

  if (workerInstance) {
    stopMonitoringWorker(workerInstance);
    workerInstance = null;
  }

  if (orchestrationWorkerInstance) {
    stopOrchestrationWorker(orchestrationWorkerInstance);
    orchestrationWorkerInstance = null;
  }

  await disconnectDatabase();
  logger.info("Worker process disconnected cleanly. Exiting.");
  isShuttingDown = false;

  if (exitProcess) {
    process.exit(0);
  }
};

process.on("SIGINT", () => handleWorkerShutdown("SIGINT"));
process.on("SIGTERM", () => handleWorkerShutdown("SIGTERM"));

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled Rejection in Worker process:", reason);
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception in Worker process:", error);
  process.exit(1);
});

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  startStandaloneWorker();
}
