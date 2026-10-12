import crypto from "crypto";
import mongoose from "mongoose";
import { logger } from "../../config/logger.js";
import { PaymentMonitoringTask } from "../../models/PaymentMonitoringTask.js";
import { executeMonitoringRecheck } from "./paymentMonitoringService.js";

/**
 * ReconAI 2.0 - Payment Monitoring Background Worker
 *
 * Implements atomic distributed claiming with optimistic lease locks:
 * - `claimDueMonitoringTask`: Uses MongoDB `findOneAndUpdate` to claim tasks atomically.
 * - Leases expire after `leaseDurationMs` (default 30s), enabling automatic dead-letter recovery
 *   if a worker crashes while a task is in progress.
 * - `sweepDueMonitoringTasks`: Executes bounded polling sweeps up to a concurrency ceiling.
 * - Injectable clock and custom fetch enable deterministic unit and integration testing.
 */

/**
 * Atomically claims one due monitoring task.
 *
 * @param {Object} [options]
 * @param {string} [options.workerId="worker-1"] - Worker identifier
 * @param {number} [options.leaseDurationMs=30000] - Lease lock duration
 * @param {Date} [options.asOfTime=new Date()] - Injectable clock
 * @returns {Promise<Object|null>} Claimed task or null
 */
export async function claimDueMonitoringTask({
  workerId = "worker-1",
  leaseDurationMs = 30000,
  asOfTime = new Date()
} = {}) {
  const isMongoConnected = Boolean(mongoose.connection && mongoose.connection.readyState === 1);

  if (isMongoConnected) {
    const lockExpiry = new Date(asOfTime.getTime() + leaseDurationMs);

    return await PaymentMonitoringTask.findOneAndUpdate(
      {
        $or: [
          {
            status: "PENDING",
            nextRunAt: { $lte: asOfTime },
            $or: [{ lockedUntil: null }, { lockedUntil: { $lte: asOfTime } }]
          },
          {
            status: "IN_PROGRESS",
            lockedUntil: { $lte: asOfTime }
          }
        ]
      },
      {
        $set: {
          status: "IN_PROGRESS",
          lockedUntil: lockExpiry,
          lockedBy: workerId,
          lastRunAt: asOfTime
        },
        $inc: { attemptCount: 1 }
      },
      { new: true, sort: { nextRunAt: 1 } }
    );
  }

  // Non-production in-memory fallback
  return null;
}

/**
 * Sweeps due monitoring tasks up to a configured batch/concurrency limit.
 *
 * @param {Object} [options]
 * @param {number} [options.maxTasks=5] - Maximum tasks to process in single sweep
 * @param {Date} [options.asOfTime=new Date()] - Injectable clock
 * @param {Function|null} [options.customFetch=null] - Injectable fetch
 * @param {string} [options.workerId="worker-1"] - Worker identifier
 * @param {number} [options.leaseDurationMs=30000] - Lease duration
 * @returns {Promise<Object>} Sweep execution summary
 */
export async function sweepDueMonitoringTasks({
  maxTasks = 5,
  asOfTime = new Date(),
  customFetch = null,
  workerId = "worker-1",
  leaseDurationMs = 30000
} = {}) {
  let processedCount = 0;
  let completedCount = 0;
  let rescheduledCount = 0;
  let exhaustedCount = 0;
  let failedCount = 0;

  const results = [];

  for (let i = 0; i < maxTasks; i++) {
    const task = await claimDueMonitoringTask({
      workerId,
      leaseDurationMs,
      asOfTime
    });

    if (!task) {
      // No more due tasks
      break;
    }

    processedCount++;

    try {
      const outcome = await executeMonitoringRecheck(task, {
        asOfTime,
        customFetch,
        workerId
      });

      results.push(outcome);

      if (outcome.status === "COMPLETED") completedCount++;
      else if (outcome.status === "RESCHEDULED") rescheduledCount++;
      else if (outcome.status === "EXHAUSTED") exhaustedCount++;
      else if (outcome.status === "FAILED") failedCount++;
    } catch (err) {
      failedCount++;
      logger.error({ err: err.message, taskId: task.taskId }, "Error executing monitoring recheck");

      if (mongoose.connection && mongoose.connection.readyState === 1) {
        await PaymentMonitoringTask.updateOne(
          { taskId: task.taskId },
          {
            $set: {
              status: "PENDING",
              lockedUntil: null,
              lastError: err.message
            }
          }
        ).catch(() => {});
      }
    }
  }

  return {
    processedCount,
    completedCount,
    rescheduledCount,
    exhaustedCount,
    failedCount,
    results
  };
}

/**
 * Starts background interval runner for the monitoring worker.
 */
export function startMonitoringWorker({
  intervalMs = 30000,
  maxTasks = 5,
  leaseDurationMs = 30000,
  workerId = `worker_${crypto.randomUUID().slice(0, 8)}`,
  customFetch = null,
  runImmediate = true
} = {}) {
  let isRunning = false;
  let isStopped = false;

  const runSweep = async () => {
    if (isRunning || isStopped) return;
    isRunning = true;
    try {
      await sweepDueMonitoringTasks({ maxTasks, workerId, customFetch, leaseDurationMs });
    } catch (err) {
      logger.error({ err: err.message }, "Background monitoring worker sweep failed");
    } finally {
      isRunning = false;
    }
  };

  if (runImmediate) {
    runSweep().catch(() => {});
  }

  const intervalId = setInterval(runSweep, intervalMs);

  logger.info({ workerId, intervalMs, maxTasks, leaseDurationMs }, "Payment monitoring background worker started");

  return {
    intervalId,
    workerId,
    isRunning: () => !isStopped,
    stop: () => {
      isStopped = true;
      clearInterval(intervalId);
      logger.info({ workerId }, "Payment monitoring background worker stopped");
    }
  };
}

export function stopMonitoringWorker(workerInstance) {
  if (workerInstance && typeof workerInstance.stop === "function") {
    workerInstance.stop();
  }
}
