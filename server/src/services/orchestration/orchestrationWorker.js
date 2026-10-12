import crypto from "crypto";
import { logger } from "../../config/logger.js";
import { checkOrchestratorGate } from "./orchestratorGate.js";
import { sweepDueOrchestrationTasks } from "./orchestrationService.js";

/**
 * ReconAI 2.0 - Autonomous Orchestration Worker Runtime
 *
 * Controls background polling interval sweeps for durable orchestration tasks.
 *
 * Requirements:
 * - Disabled by default.
 * - Requires explicit server-side environment setting (ORCHESTRATOR_WORKER_ENABLED === true).
 * - Operator kill switch stops task claiming immediately.
 * - Graceful shutdown drains in-progress execution cleanly.
 */

let activeWorkerInstance = null;

export function getActiveOrchestrationWorker() {
  return activeWorkerInstance;
}

/**
 * Starts background interval runner for the autonomous orchestration worker.
 *
 * @param {Object} [options]
 * @param {number} [options.intervalMs=30000] - Polling interval
 * @param {number} [options.maxTasks=5] - Concurrency ceiling
 * @param {number} [options.leaseDurationMs=30000] - Lease duration
 * @param {string} [options.workerId] - Worker ID
 * @param {Function|null} [options.customFetch=null] - Injectable fetch
 * @param {Object|null} [options.policyConfig=null] - Trusted policy config
 * @param {boolean} [options.runImmediate=true] - Run initial sweep immediately
 * @returns {Object} Worker instance handle
 */
export function startOrchestrationWorker({
  intervalMs = 30000,
  maxTasks = 5,
  leaseDurationMs = 30000,
  workerId = `orch_worker_${crypto.randomUUID().slice(0, 8)}`,
  customFetch = null,
  policyConfig = null,
  runImmediate = true
} = {}) {
  const gate = checkOrchestratorGate();

  if (!gate.allowed) {
    logger.info(
      { reason: gate.reason },
      "Orchestration worker startup halted: gate is disabled (fails closed by default)"
    );
    return {
      intervalId: null,
      workerId,
      isEnabled: false,
      isRunning: () => false,
      stop: () => {}
    };
  }

  let isSweeping = false;
  let isStopped = false;

  const runSweep = async () => {
    if (isSweeping || isStopped) return;

    // Check gate on each sweep
    const currentGate = checkOrchestratorGate();
    if (!currentGate.allowed) {
      return;
    }

    isSweeping = true;
    try {
      await sweepDueOrchestrationTasks({
        maxTasks,
        workerId,
        leaseDurationMs,
        customFetch,
        policyConfig
      });
    } catch (err) {
      logger.error({ err: err.message }, "Background orchestration sweep encountered an unhandled error");
    } finally {
      isSweeping = false;
    }
  };

  if (runImmediate) {
    runSweep().catch(() => {});
  }

  const intervalId = setInterval(runSweep, intervalMs);

  const instance = {
    intervalId,
    workerId,
    isEnabled: true,
    isRunning: () => !isStopped,
    stop: () => {
      isStopped = true;
      if (intervalId) {
        clearInterval(intervalId);
      }
      logger.info({ workerId }, "Autonomous orchestration worker stopped cleanly");
    }
  };

  activeWorkerInstance = instance;
  logger.info({ workerId, intervalMs, maxTasks }, "🚀 Autonomous orchestration worker running");
  return instance;
}

/**
 * Stops an active orchestration worker instance cleanly.
 */
export function stopOrchestrationWorker(workerInstance) {
  if (workerInstance && typeof workerInstance.stop === "function") {
    workerInstance.stop();
  }
  if (activeWorkerInstance === workerInstance) {
    activeWorkerInstance = null;
  }
}
