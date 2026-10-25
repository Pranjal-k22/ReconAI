import crypto from "crypto";
import mongoose from "mongoose";
import { logger } from "../../config/logger.js";
import { AppError } from "../../utils/AppError.js";
import { PaymentMonitoringTask } from "../../models/PaymentMonitoringTask.js";
import { GatewayPayment } from "../../models/GatewayPayment.js";
import { MerchantOrder } from "../../models/MerchantOrder.js";
import { PaymentCase } from "../../models/PaymentCase.js";
import { PaymentLifecycleEvent } from "../../models/PaymentLifecycleEvent.js";
import { createAuditEvent } from "../audit/auditService.js";
import {
  fetchRazorpayApi,
  isRazorpayConfigured,
  RazorpayProviderError,
  RAZORPAY_ERROR_CODES
} from "../razorpay/razorpayClient.js";
import {
  evaluateCanonicalTransition,
  mapProviderPaymentStatus
} from "../stateMachine/paymentStateMachine.js";
import { sanitizeWebhookPayload } from "../../validators/webhookValidators.js";

// Non-production in-memory store for unit testing when MongoDB is offline
const inMemoryTasks = new Map();

export function resetInMemoryMonitoringStore() {
  inMemoryTasks.clear();
}

/**
 * Calculates exponential backoff with deterministic or random jitter.
 */
export function calculateNextBackoffTime({
  attemptCount,
  backoffIntervalsSeconds = [60, 300, 900, 1800],
  asOfTime = new Date(),
  jitterSeconds = 0
}) {
  const baseSeconds =
    attemptCount < backoffIntervalsSeconds.length
      ? backoffIntervalsSeconds[attemptCount]
      : backoffIntervalsSeconds[backoffIntervalsSeconds.length - 1] * 2;

  const totalSeconds = Math.max(1, baseSeconds + jitterSeconds);
  return new Date(asOfTime.getTime() + totalSeconds * 1000);
}

/**
 * Schedules a bounded payment status recheck task.
 *
 * @param {Object} params
 * @param {string} params.tenantId - Merchant tenant ID
 * @param {string} params.gatewayPaymentId - Gateway payment ID to monitor
 * @param {string} [params.merchantOrderId] - Linked merchant order ID
 * @param {string} [params.caseId] - Linked PaymentCase ID
 * @param {number} [params.initialDelaySeconds=60] - Initial delay before first check
 * @param {number} [params.maxAttempts=4] - Maximum number of polling retries
 * @param {number} [params.deadlineMinutes=60] - Overall monitoring deadline in minutes
 * @param {Object} [params.metadata={}] - Non-PII metadata
 * @param {Date} [params.asOfTime=new Date()] - Injectable clock reference
 * @returns {Promise<Object>} Created or updated task document
 */
export async function schedulePaymentMonitoring({
  tenantId,
  gatewayPaymentId,
  merchantOrderId = null,
  caseId = null,
  initialDelaySeconds = 60,
  maxAttempts = 4,
  deadlineMinutes = 60,
  metadata = {},
  asOfTime = new Date()
}) {
  if (!tenantId || typeof tenantId !== "string" || tenantId.trim().length === 0) {
    throw AppError.badRequest("tenantId is required to schedule payment monitoring");
  }
  if (!gatewayPaymentId || typeof gatewayPaymentId !== "string" || gatewayPaymentId.trim().length === 0) {
    throw AppError.badRequest("gatewayPaymentId is required to schedule payment monitoring");
  }

  const cleanTenantId = tenantId.trim();
  const cleanPaymentId = gatewayPaymentId.trim();
  const nextRunAt = new Date(asOfTime.getTime() + initialDelaySeconds * 1000);
  const deadlineAt = new Date(asOfTime.getTime() + deadlineMinutes * 60 * 1000);
  const taskId = `task_mon_${crypto.randomUUID()}`;

  const isMongoConnected = Boolean(mongoose.connection && mongoose.connection.readyState === 1);

  let taskDoc = null;

  if (isMongoConnected) {
    taskDoc = await PaymentMonitoringTask.findOneAndUpdate(
      { tenantId: cleanTenantId, gatewayPaymentId: cleanPaymentId },
      {
        $setOnInsert: {
          taskId,
          tenantId: cleanTenantId,
          gatewayPaymentId: cleanPaymentId,
          merchantOrderId,
          caseId,
          status: "PENDING",
          attemptCount: 0,
          maxAttempts,
          backoffIntervalsSeconds: [60, 300, 900, 1800],
          nextRunAt,
          deadlineAt,
          lockedUntil: null,
          lockedBy: null,
          metadata
        }
      },
      { upsert: true, new: true }
    );
  } else {
    // In-memory offline fallback: only initialize if not already registered
    const key = `${cleanTenantId}:${cleanPaymentId}`;
    if (!inMemoryTasks.has(key)) {
      taskDoc = {
        taskId,
        tenantId: cleanTenantId,
        gatewayPaymentId: cleanPaymentId,
        merchantOrderId,
        caseId,
        status: "PENDING",
        attemptCount: 0,
        maxAttempts,
        backoffIntervalsSeconds: [60, 300, 900, 1800],
        nextRunAt,
        deadlineAt,
        lockedUntil: null,
        lockedBy: null,
        metadata
      };
      inMemoryTasks.set(key, taskDoc);
    } else {
      taskDoc = inMemoryTasks.get(key);
    }
  }

  await createAuditEvent({
    actorType: "SYSTEM",
    actorId: "payment-monitor",
    action: "MONITORING_TASK_SCHEDULED",
    tenantId: cleanTenantId,
    entityType: "PaymentMonitoringTask",
    entityId: taskDoc.taskId,
    metadata: {
      gatewayPaymentId: cleanPaymentId,
      merchantOrderId,
      caseId,
      initialDelaySeconds,
      nextRunAt: nextRunAt.toISOString(),
      deadlineAt: deadlineAt.toISOString()
    }
  }).catch(() => {});

  return taskDoc;
}

/**
 * Executes a single bounded status recheck for a claimed monitoring task.
 *
 * @param {Object} task - Claimed task record
 * @param {Object} [options]
 * @param {Date} [options.asOfTime=new Date()] - Injectable clock reference
 * @param {Function|null} [options.customFetch=null] - Injectable custom fetch implementation
 * @param {string} [options.workerId="worker-1"] - Worker ID executing the check
 * @returns {Promise<Object>} Execution result summary
 */
export async function executeMonitoringRecheck(task, { asOfTime = new Date(), customFetch = null, workerId = "worker-1" } = {}) {
  const isMongoConnected = Boolean(mongoose.connection && mongoose.connection.readyState === 1);
  const tenantId = task.tenantId;
  const gatewayPaymentId = task.gatewayPaymentId;

  let providerData = null;
  let providerFetchError = null;

  // 1. Read-Only Provider Recheck via GET /v1/payments/:id
  try {
    providerData = await fetchRazorpayApi(`/v1/payments/${encodeURIComponent(gatewayPaymentId)}`, {}, customFetch);
  } catch (err) {
    providerFetchError = err;
  }

  // 2. Handle Provider Errors (Throttling, Timeouts, Auth, Network)
  if (providerFetchError) {
    const isRateLimited =
      providerFetchError.code === RAZORPAY_ERROR_CODES.RATE_LIMIT ||
      (providerFetchError.originalError && providerFetchError.originalError.status === 429);

    const isTimeout =
      providerFetchError.code === RAZORPAY_ERROR_CODES.TIMEOUT ||
      providerFetchError.name === "AbortError";

    const isNetwork = providerFetchError.code === RAZORPAY_ERROR_CODES.NETWORK_ERROR;
    const isAuthError = providerFetchError.code === RAZORPAY_ERROR_CODES.AUTH_ERROR;
    const isNotConfigured = providerFetchError.code === RAZORPAY_ERROR_CODES.NOT_CONFIGURED;

    logger.warn(
      {
        errCode: providerFetchError.code,
        errMessage: providerFetchError.message,
        paymentId: gatewayPaymentId,
        attempt: task.attemptCount
      },
      "Provider recheck query encountered an error"
    );

    // If permanent credential issue, fail closed safely without state corruption
    if (isAuthError || isNotConfigured) {
      if (isMongoConnected) {
        await PaymentMonitoringTask.updateOne(
          { taskId: task.taskId },
          {
            $set: {
              status: "FAILED",
              lockedUntil: null,
              lastError: providerFetchError.message,
              outcomeReason: "PROVIDER_AUTH_OR_CONFIG_ERROR"
            }
          }
        );
      } else {
        task.status = "FAILED";
        task.lockedUntil = null;
        task.lastError = providerFetchError.message;
      }

      return {
        success: false,
        status: "FAILED",
        reason: "PROVIDER_CREDENTIAL_ERROR",
        error: providerFetchError.message
      };
    }

    // Temporary failure (rate-limited, timeout, network): check attempt bounds
    const isDeadlineExceeded = Boolean(task.deadlineAt && asOfTime >= task.deadlineAt);
    const areAttemptsExhausted = task.attemptCount >= task.maxAttempts || isDeadlineExceeded;

    if (!areAttemptsExhausted) {
      // Bounded retry with exponential backoff and jitter
      const nextRunAt = calculateNextBackoffTime({
        attemptCount: task.attemptCount,
        backoffIntervalsSeconds: task.backoffIntervalsSeconds,
        asOfTime
      });

      if (isMongoConnected) {
        await PaymentMonitoringTask.updateOne(
          { taskId: task.taskId },
          {
            $set: {
              status: "PENDING",
              nextRunAt,
              lockedUntil: null,
              lastError: providerFetchError.message
            }
          }
        );
      } else {
        task.status = "PENDING";
        task.nextRunAt = nextRunAt;
        task.lockedUntil = null;
        task.lastError = providerFetchError.message;
      }

      await createAuditEvent({
        actorType: "SYSTEM",
        actorId: workerId,
        action: "MONITORING_POLL_RESCHEDULED",
        tenantId,
        entityType: "PaymentMonitoringTask",
        entityId: task.taskId,
        metadata: {
          gatewayPaymentId,
          reason: isRateLimited ? "RATE_LIMITED" : isTimeout ? "TIMEOUT" : "NETWORK_ERROR",
          nextRunAt: nextRunAt.toISOString(),
          attemptCount: task.attemptCount
        }
      }).catch(() => {});

      return {
        success: true,
        status: "RESCHEDULED",
        reason: "TRANSIENT_PROVIDER_ERROR",
        nextRunAt
      };
    }

    // Exhausted retries under timeout/network failure: Safe-Hold containment
    // Critical: Do NOT mark payment FAILED on timeout/exhaustion!
    if (isMongoConnected) {
      await PaymentMonitoringTask.updateOne(
        { taskId: task.taskId },
        {
          $set: {
            status: "EXHAUSTED",
            lockedUntil: null,
            lastError: providerFetchError.message,
            outcomeReason: "MONITORING_RETRY_EXHAUSTED"
          }
        }
      );

      // Place PaymentCase under safe-hold
      if (task.caseId) {
        await PaymentCase.updateOne(
          { caseId: task.caseId, tenantId },
          {
            $set: {
              resolutionCaseStatus: "CASE_SAFE_HOLD",
              safeHoldCode: "MONITORING_RETRY_EXHAUSTED",
              safeHoldReason: "Provider status check retry policy exhausted without definitive outcome.",
              isSafeHold: true
            }
          }
        );
      }
    } else {
      task.status = "EXHAUSTED";
      task.lockedUntil = null;
      task.outcomeReason = "MONITORING_RETRY_EXHAUSTED";
    }

    await createAuditEvent({
      actorType: "SYSTEM",
      actorId: workerId,
      action: "MONITORING_RETRY_EXHAUSTED",
      tenantId,
      entityType: "PaymentMonitoringTask",
      entityId: task.taskId,
      metadata: {
        gatewayPaymentId,
        caseId: task.caseId,
        reason: "RETRY_EXHAUSTED_TIMEOUT_OR_ERROR",
        lastError: providerFetchError.message
      }
    });

    return {
      success: true,
      status: "EXHAUSTED",
      reason: "RETRY_EXHAUSTED_UNKNOWN_OUTCOME"
    };
  }

  // 3. Evaluate Provider Response against Canonical State Machine
  const rawProviderStatus = providerData?.status || "unknown";
  const mappedStatus = mapProviderPaymentStatus(rawProviderStatus);

  let existingGateway = null;
  let existingOrder = null;
  let existingCase = null;

  if (isMongoConnected) {
    existingGateway = await GatewayPayment.findOne({ gatewayPaymentId, tenantId }).lean();
    if (task.merchantOrderId) {
      existingOrder = await MerchantOrder.findOne({ merchantOrderId: task.merchantOrderId, tenantId }).lean();
    }
    if (task.caseId) {
      existingCase = await PaymentCase.findOne({ caseId: task.caseId, tenantId }).lean();
    }
  }

  const capturedAmountPaise =
    mappedStatus === "CAPTURED"
      ? (typeof providerData?.amount_captured === "number"
          ? providerData.amount_captured
          : (typeof providerData?.amount === "number" ? providerData.amount : null))
      : null;
  const paymentCurrency = (providerData?.currency || "INR").toUpperCase();

  const transitionEval = evaluateCanonicalTransition({
    existingGateway,
    existingOrder,
    existingCase,
    newPaymentStatus: mappedStatus,
    capturedAmountPaise,
    currency: paymentCurrency,
    tenantId
  });

  // 4. Apply Monotonic State Transitions
  if (transitionEval.allowed) {
    if (isMongoConnected) {
      // A. Gateway Payment Update
      if (transitionEval.gatewayUpdates) {
        await GatewayPayment.updateOne(
          { gatewayPaymentId, tenantId },
          {
            $set: {
              ...transitionEval.gatewayUpdates,
              rawData: sanitizeWebhookPayload(providerData)
            }
          }
        );
      }

      // B. Merchant Order Update (only mutated if amount and currency match per Item g)
      if (transitionEval.orderUpdates && task.merchantOrderId) {
        await MerchantOrder.updateOne(
          { merchantOrderId: task.merchantOrderId, tenantId },
          { $set: transitionEval.orderUpdates }
        );
      }

      // C. Payment Case Update
      if (transitionEval.caseUpdates && task.caseId) {
        await PaymentCase.updateOne(
          { caseId: task.caseId, tenantId },
          { $set: transitionEval.caseUpdates }
        );

        if (transitionEval.caseUpdates.isSafeHold) {
          await createAuditEvent({
            actorType: "SYSTEM",
            actorId: workerId,
            action: "SAFE_HOLD_APPLIED",
            tenantId,
            entityType: "PaymentCase",
            entityId: task.caseId,
            metadata: {
              gatewayPaymentId,
              caseId: task.caseId,
              safeHoldCode: transitionEval.caseUpdates.safeHoldCode,
              reason: transitionEval.caseUpdates.safeHoldReason,
              discrepancyCategory: transitionEval.caseUpdates.discrepancyCategory
            }
          });
        }
      }

      // D. Immutable Append-Only Lifecycle Event
      const eventId = `evt_poll_${crypto.randomUUID()}`;
      await PaymentLifecycleEvent.create({
        eventId,
        tenantId,
        sourceSystem: "GATEWAY_API_POLL",
        sourceEventId: `poll_${gatewayPaymentId}_${task.attemptCount}`,
        deduplicationKey: `POLL:${tenantId}:${gatewayPaymentId}:${task.attemptCount}`,
        normalizedEventType: "GATEWAY_STATUS_POLL_COMPLETED",
        merchantOrderId: task.merchantOrderId,
        gatewayPaymentId,
        amountPaise: typeof providerData.amount === "number" ? providerData.amount : null,
        currency: (providerData.currency || "INR").toUpperCase(),
        providerOccurredAt: providerData.created_at ? new Date(providerData.created_at * 1000) : null,
        sourceObservedAt: asOfTime,
        payloadFingerprint: crypto.createHash("sha256").update(JSON.stringify(providerData)).digest("hex"),
        provenance: {
          source: "GATEWAY_API_POLL",
          taskId: task.taskId,
          workerId,
          attemptCount: task.attemptCount,
          observedStatus: mappedStatus,
          conflictFlag: transitionEval.conflictFlag
        }
      }).catch(() => {});
    }
  }

  // 5. Determine Task Outcome (Completed vs Reschedule vs Exhausted)
  const isTerminalStatus = mappedStatus === "CAPTURED" || mappedStatus === "FAILED" || mappedStatus === "REFUNDED";

  if (isTerminalStatus) {
    // Definitive provider outcome reached
    if (isMongoConnected) {
      await PaymentMonitoringTask.updateOne(
        { taskId: task.taskId },
        {
          $set: {
            status: "COMPLETED",
            lockedUntil: null,
            lastObservedStatus: mappedStatus,
            outcomeReason: "TERMINAL_STATUS_CONFIRMED"
          }
        }
      );
    } else {
      task.status = "COMPLETED";
      task.lockedUntil = null;
      task.lastObservedStatus = mappedStatus;
    }

    await createAuditEvent({
      actorType: "SYSTEM",
      actorId: workerId,
      action: "MONITORING_RECHECK_EXECUTED",
      tenantId,
      entityType: "PaymentMonitoringTask",
      entityId: task.taskId,
      metadata: {
        gatewayPaymentId,
        observedStatus: mappedStatus,
        outcome: "TERMINAL_CONFIRMED",
        conflictFlag: transitionEval.conflictFlag
      }
    });

    return {
      success: true,
      status: "COMPLETED",
      paymentStatus: mappedStatus,
      conflictFlag: transitionEval.conflictFlag
    };
  }

  // Payment is STILL PENDING / AUTHORIZED / CREATED
  const isDeadlinePassed = Boolean(task.deadlineAt && asOfTime >= task.deadlineAt);
  const attemptsRemain = task.attemptCount < task.maxAttempts && !isDeadlinePassed;

  if (attemptsRemain) {
    const nextRunAt = calculateNextBackoffTime({
      attemptCount: task.attemptCount,
      backoffIntervalsSeconds: task.backoffIntervalsSeconds,
      asOfTime
    });

    if (isMongoConnected) {
      await PaymentMonitoringTask.updateOne(
        { taskId: task.taskId },
        {
          $set: {
            status: "PENDING",
            nextRunAt,
            lockedUntil: null,
            lastObservedStatus: mappedStatus
          }
        }
      );
    } else {
      task.status = "PENDING";
      task.nextRunAt = nextRunAt;
      task.lockedUntil = null;
      task.lastObservedStatus = mappedStatus;
    }

    await createAuditEvent({
      actorType: "SYSTEM",
      actorId: workerId,
      action: "MONITORING_POLL_RESCHEDULED",
      tenantId,
      entityType: "PaymentMonitoringTask",
      entityId: task.taskId,
      metadata: {
        gatewayPaymentId,
        observedStatus: mappedStatus,
        nextRunAt: nextRunAt.toISOString(),
        attemptCount: task.attemptCount
      }
    });

    return {
      success: true,
      status: "RESCHEDULED",
      paymentStatus: mappedStatus,
      nextRunAt
    };
  }

  // Retry deadline exhausted for pending payment: Safe-Hold containment
  // Critical: Do NOT mark payment FAILED on timeout/exhaustion! Result is UNKNOWN.
  if (isMongoConnected) {
    await PaymentMonitoringTask.updateOne(
      { taskId: task.taskId },
      {
        $set: {
          status: "EXHAUSTED",
          lockedUntil: null,
          lastObservedStatus: mappedStatus,
          outcomeReason: "MONITORING_RETRY_EXHAUSTED"
        }
      }
    );

    if (task.caseId) {
      await PaymentCase.updateOne(
        { caseId: task.caseId, tenantId },
        {
          $set: {
            resolutionCaseStatus: "CASE_SAFE_HOLD",
            safeHoldCode: "MONITORING_RETRY_EXHAUSTED",
            safeHoldReason: "Payment remains pending after retry ceiling reached. Awaiting manual review.",
            isSafeHold: true
          }
        }
      );
    }
  } else {
    task.status = "EXHAUSTED";
    task.lockedUntil = null;
    task.lastObservedStatus = mappedStatus;
  }

  await createAuditEvent({
    actorType: "SYSTEM",
    actorId: workerId,
    action: "MONITORING_RETRY_EXHAUSTED",
    tenantId,
    entityType: "PaymentMonitoringTask",
    entityId: task.taskId,
    metadata: {
      gatewayPaymentId,
      caseId: task.caseId,
      observedStatus: mappedStatus,
      attemptCount: task.attemptCount
    }
  });

  return {
    success: true,
    status: "EXHAUSTED",
    paymentStatus: mappedStatus,
    reason: "RETRY_CEILING_REACHED_UNKNOWN_OUTCOME"
  };
}

/**
 * Bounded discovery and scheduling for unmonitored pending/authorized payment attempts.
 * Prevents orphan pending records from being missed if initial events were lost.
 *
 * @param {Object} [options]
 * @param {string|null} [options.tenantId=null] - Optional tenant scope filter
 * @param {number} [options.limit=50] - Maximum records to inspect
 * @param {number} [options.initialDelaySeconds=60] - Initial delay
 * @param {Date} [options.asOfTime=new Date()] - Injectable clock reference
 * @returns {Promise<Object>} Summary of enqueued records
 */
export async function enqueueUnmonitoredPendingPayments({
  tenantId = null,
  limit = 50,
  initialDelaySeconds = 60,
  asOfTime = new Date()
} = {}) {
  const isMongoConnected = Boolean(mongoose.connection && mongoose.connection.readyState === 1);
  if (!isMongoConnected) return { enqueuedCount: 0, skippedCount: 0 };

  let enqueuedCount = 0;
  let skippedCount = 0;

  if (tenantId) {
    const pendingPayments = await GatewayPayment.find({
      tenantId,
      status: { $in: ["CREATED", "AUTHORIZED", "PENDING"] }
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    for (const pay of pendingPayments) {
      if (!pay.tenantId || !pay.gatewayPaymentId) continue;

      const existingTask = await PaymentMonitoringTask.findOne({
        tenantId: pay.tenantId,
        gatewayPaymentId: pay.gatewayPaymentId
      }).lean();

      if (!existingTask) {
        await schedulePaymentMonitoring({
          tenantId: pay.tenantId,
          gatewayPaymentId: pay.gatewayPaymentId,
          merchantOrderId: pay.merchantOrderId,
          initialDelaySeconds,
          asOfTime
        });
        enqueuedCount++;
      } else {
        skippedCount++;
      }
    }
  } else {
    // Tenant-safe iteration: discover distinct tenantIds from pending records
    const distinctTenants = await GatewayPayment.distinct("tenantId", {
      status: { $in: ["CREATED", "AUTHORIZED", "PENDING"] }
    });

    const activeTenants = distinctTenants.filter(
      (t) => typeof t === "string" && t.trim().length > 0
    );

    const maxTenantsToInspect = 50;
    const perTenantLimit = Math.max(1, Math.floor(limit / Math.max(1, activeTenants.length)));

    for (const tId of activeTenants.slice(0, maxTenantsToInspect)) {
      const pendingPayments = await GatewayPayment.find({
        tenantId: tId,
        status: { $in: ["CREATED", "AUTHORIZED", "PENDING"] }
      })
        .sort({ createdAt: -1 })
        .limit(perTenantLimit)
        .lean();

      for (const pay of pendingPayments) {
        if (!pay.tenantId || !pay.gatewayPaymentId) continue;

        const existingTask = await PaymentMonitoringTask.findOne({
          tenantId: pay.tenantId,
          gatewayPaymentId: pay.gatewayPaymentId
        }).lean();

        if (!existingTask) {
          await schedulePaymentMonitoring({
            tenantId: pay.tenantId,
            gatewayPaymentId: pay.gatewayPaymentId,
            merchantOrderId: pay.merchantOrderId,
            initialDelaySeconds,
            asOfTime
          });
          enqueuedCount++;
        } else {
          skippedCount++;
        }
      }
    }
  }

  return { enqueuedCount, skippedCount };
}
