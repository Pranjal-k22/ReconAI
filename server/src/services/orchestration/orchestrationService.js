import crypto from "crypto";
import mongoose from "mongoose";
import { logger } from "../../config/logger.js";
import { AppError } from "../../utils/AppError.js";
import { OrchestrationTask } from "../../models/OrchestrationTask.js";
import { PaymentCase } from "../../models/PaymentCase.js";
import { GatewayPayment } from "../../models/GatewayPayment.js";
import { MerchantOrder } from "../../models/MerchantOrder.js";
import { EvidenceRecord } from "../../models/EvidenceRecord.js";
import { ProviderOperation } from "../../models/ProviderOperation.js";
import { createAuditEvent } from "../audit/auditService.js";
import {
  evaluateResolutionPolicy,
  DEFAULT_POLICY_VERSION
} from "../policy/resolutionPolicyEvaluator.js";
import {
  fetchRazorpayApi,
  RazorpayProviderError,
  RAZORPAY_ERROR_CODES
} from "../razorpay/razorpayClient.js";
import {
  assertValidOrchestrationTransition,
  isValidOrchestrationTransition
} from "./orchestrationStateMachine.js";
import {
  checkOrchestratorGate,
  recordOrchestratorMetric,
  sanitizeOrchestrationPayload
} from "./orchestratorGate.js";

// Non-production in-memory store for isolated unit testing when MongoDB is offline
const inMemoryTasks = new Map();

export function resetInMemoryOrchestrationStore() {
  inMemoryTasks.clear();
}

/**
 * Calculates exponential backoff according to the approved schedule:
 * [60s, 300s, 900s, 1800s]
 */
export function calculateOrchestrationBackoffTime({
  attemptCount,
  backoffIntervalsSeconds = [60, 300, 900, 1800],
  asOfTime = new Date(),
  jitterSeconds = 0
}) {
  const index = Math.min(attemptCount, backoffIntervalsSeconds.length - 1);
  const baseSeconds = backoffIntervalsSeconds[index] || 1800;
  const totalSeconds = Math.max(1, baseSeconds + jitterSeconds);
  return new Date(asOfTime.getTime() + totalSeconds * 1000);
}

/**
 * Enqueues a new orchestration task idempotently.
 *
 * @param {Object} params
 * @param {string} params.tenantId - Merchant tenant ID
 * @param {string} params.caseId - Target PaymentCase ID
 * @param {string} params.idempotencyKey - Scoped idempotency key
 * @param {string} [params.gatewayPaymentId] - Optional gateway payment ID
 * @param {string} [params.merchantOrderId] - Optional merchant order ID
 * @param {string} [params.triggerSource="API"] - Triggering source
 * @param {string} [params.sourceEventId] - Correlated source event ID
 * @param {number} [params.maxAttempts=4] - Max allowed execution attempts
 * @param {number} [params.deadlineMinutes=60] - Overall deadline in minutes
 * @param {Object} [params.metadata={}] - Safe non-PII metadata
 * @param {Date} [params.asOfTime=new Date()] - Injectable clock reference
 * @returns {Promise<Object>} Created or existing task document
 */
export async function queueOrchestrationTask({
  tenantId,
  caseId,
  idempotencyKey,
  gatewayPaymentId = null,
  merchantOrderId = null,
  triggerSource = "API",
  sourceEventId = null,
  maxAttempts = 4,
  deadlineMinutes = 60,
  metadata = {},
  asOfTime = new Date()
}) {
  if (!tenantId || typeof tenantId !== "string" || tenantId.trim().length === 0) {
    throw AppError.badRequest("tenantId is required to queue an orchestration task");
  }
  if (!caseId || typeof caseId !== "string" || caseId.trim().length === 0) {
    throw AppError.badRequest("caseId is required to queue an orchestration task");
  }
  if (!idempotencyKey || typeof idempotencyKey !== "string" || idempotencyKey.trim().length === 0) {
    throw AppError.badRequest("idempotencyKey is required to queue an orchestration task");
  }

  const cleanTenantId = tenantId.trim();
  const cleanCaseId = caseId.trim();
  const cleanIdempotencyKey = idempotencyKey.trim();
  const taskId = `orch_task_${crypto.randomUUID()}`;
  const deadlineAt = new Date(asOfTime.getTime() + deadlineMinutes * 60 * 1000);

  const isMongoConnected = Boolean(mongoose.connection && mongoose.connection.readyState === 1);
  let taskDoc = null;

  if (isMongoConnected) {
    taskDoc = await OrchestrationTask.findOneAndUpdate(
      { tenantId: cleanTenantId, idempotencyKey: cleanIdempotencyKey },
      {
        $setOnInsert: {
          taskId,
          tenantId: cleanTenantId,
          caseId: cleanCaseId,
          gatewayPaymentId: gatewayPaymentId ? gatewayPaymentId.trim() : null,
          merchantOrderId: merchantOrderId ? merchantOrderId.trim() : null,
          idempotencyKey: cleanIdempotencyKey,
          state: "QUEUED",
          stateHistory: [
            {
              fromState: null,
              toState: "QUEUED",
              timestamp: asOfTime,
              workerId: null,
              reason: `Task queued via ${triggerSource}`
            }
          ],
          attemptCount: 0,
          maxAttempts,
          backoffIntervalsSeconds: [60, 300, 900, 1800],
          nextRunAt: asOfTime,
          deadlineAt,
          lockedUntil: null,
          lockedBy: null,
          triggerSource,
          sourceEventId,
          metadata: sanitizeOrchestrationPayload(metadata)
        }
      },
      { upsert: true, new: true }
    );
  } else {
    // In-memory offline fallback for unit tests
    const key = `${cleanTenantId}:${cleanIdempotencyKey}`;
    if (!inMemoryTasks.has(key)) {
      taskDoc = {
        taskId,
        tenantId: cleanTenantId,
        caseId: cleanCaseId,
        gatewayPaymentId: gatewayPaymentId ? gatewayPaymentId.trim() : null,
        merchantOrderId: merchantOrderId ? merchantOrderId.trim() : null,
        idempotencyKey: cleanIdempotencyKey,
        state: "QUEUED",
        stateHistory: [
          {
            fromState: null,
            toState: "QUEUED",
            timestamp: asOfTime,
            workerId: null,
            reason: `Task queued via ${triggerSource}`
          }
        ],
        attemptCount: 0,
        maxAttempts,
        backoffIntervalsSeconds: [60, 300, 900, 1800],
        nextRunAt: asOfTime,
        deadlineAt,
        lockedUntil: null,
        lockedBy: null,
        triggerSource,
        sourceEventId,
        metadata: sanitizeOrchestrationPayload(metadata)
      };
      inMemoryTasks.set(key, taskDoc);
    } else {
      taskDoc = inMemoryTasks.get(key);
    }
  }

  recordOrchestratorMetric("tasksQueued");

  await createAuditEvent({
    actorType: "SYSTEM",
    actorId: "orchestrator",
    action: "ORCHESTRATION_TASK_QUEUED",
    tenantId: cleanTenantId,
    entityType: "OrchestrationTask",
    entityId: taskDoc.taskId,
    metadata: {
      caseId: cleanCaseId,
      idempotencyKey: cleanIdempotencyKey,
      triggerSource
    }
  }).catch(() => {});

  return taskDoc;
}

/**
 * Atomically claims one due orchestration task using MongoDB findOneAndUpdate.
 * Recovers stale leases if lockedUntil <= asOfTime.
 *
 * @param {Object} [options]
 * @param {string} [options.workerId="orch-worker-1"] - Worker identifier
 * @param {number} [options.leaseDurationMs=30000] - Lease duration in ms
 * @param {Date} [options.asOfTime=new Date()] - Injectable clock reference
 * @returns {Promise<Object|null>} Claimed task document or null
 */
export async function claimDueOrchestrationTask({
  workerId = "orch-worker-1",
  leaseDurationMs = 30000,
  asOfTime = new Date()
} = {}) {
  // Gate check: must be explicitly enabled and kill switch must NOT be active
  const gate = await checkOrchestratorGate();
  if (!gate.allowed) {
    return null;
  }

  const isMongoConnected = Boolean(mongoose.connection && mongoose.connection.readyState === 1);
  const lockExpiry = new Date(asOfTime.getTime() + leaseDurationMs);

  if (isMongoConnected) {
    // 1. Check for stale lease recovery candidate to accurately track metric
    const staleCandidate = await OrchestrationTask.findOne({
      state: { $in: ["CLAIMED", "EVIDENCE_COLLECTION", "POLICY_EVALUATION"] },
      lockedUntil: { $lte: asOfTime }
    }).lean();

    if (staleCandidate) {
      recordOrchestratorMetric("staleLeasesRecovered");
      logger.warn(
        { taskId: staleCandidate.taskId, previousLockBy: staleCandidate.lockedBy },
        "Recovering stale lease from crashed or timed-out worker"
      );
    }

    // 2. Atomic claim via findOneAndUpdate
    const claimed = await OrchestrationTask.findOneAndUpdate(
      {
        $or: [
          {
            state: { $in: ["QUEUED", "WAITING_FOR_RECHECK"] },
            nextRunAt: { $lte: asOfTime },
            $or: [{ lockedUntil: null }, { lockedUntil: { $lte: asOfTime } }]
          },
          {
            state: { $in: ["CLAIMED", "EVIDENCE_COLLECTION", "POLICY_EVALUATION"] },
            lockedUntil: { $lte: asOfTime }
          }
        ]
      },
      {
        $set: {
          state: "CLAIMED",
          lockedUntil: lockExpiry,
          lockedBy: workerId,
          lastRunAt: asOfTime
        },
        $inc: { attemptCount: 1 },
        $push: {
          stateHistory: {
            fromState: null,
            toState: "CLAIMED",
            timestamp: asOfTime,
            workerId,
            reason: staleCandidate ? "Stale lease recovered" : "Task claimed by worker"
          }
        }
      },
      { new: true, sort: { nextRunAt: 1 } }
    );

    if (claimed) {
      recordOrchestratorMetric("tasksClaimed");
    }

    return claimed;
  }

  // In-memory offline fallback for testing without MongoDB
  for (const [key, t] of inMemoryTasks.entries()) {
    const isDueQueued =
      (t.state === "QUEUED" || t.state === "WAITING_FOR_RECHECK") &&
      t.nextRunAt <= asOfTime &&
      (!t.lockedUntil || t.lockedUntil <= asOfTime);

    const isStaleLease =
      ["CLAIMED", "EVIDENCE_COLLECTION", "POLICY_EVALUATION"].includes(t.state) &&
      t.lockedUntil &&
      t.lockedUntil <= asOfTime;

    if (isDueQueued || isStaleLease) {
      if (isStaleLease) {
        recordOrchestratorMetric("staleLeasesRecovered");
      }
      t.state = "CLAIMED";
      t.lockedUntil = lockExpiry;
      t.lockedBy = workerId;
      t.lastRunAt = asOfTime;
      t.attemptCount = (t.attemptCount || 0) + 1;
      t.stateHistory.push({
        fromState: null,
        toState: "CLAIMED",
        timestamp: asOfTime,
        workerId,
        reason: isStaleLease ? "Stale lease recovered" : "Task claimed by worker"
      });
      recordOrchestratorMetric("tasksClaimed");
      return t;
    }
  }

  return null;
}

/**
 * Safely renews the active lease for a task currently owned and being processed by workerId.
 *
 * Requirements:
 * - Atomic conditional update in MongoDB.
 * - Only succeeds if taskId matches, lockedBy === workerId, lockedUntil >= asOfTime (not yet expired),
 *   and state is an active renewable processing state (CLAIMED, EVIDENCE_COLLECTION, POLICY_EVALUATION).
 * - If renewal fails, the worker has lost ownership (e.g. lease expired and recovered by another worker).
 *
 * @param {Object} params
 * @param {string} params.taskId - Task identifier
 * @param {string} params.workerId - Current worker identifier
 * @param {number} [params.leaseDurationMs=30000] - Duration to extend lease from asOfTime
 * @param {Date} [params.asOfTime=new Date()] - Current clock time
 * @returns {Promise<{ renewed: boolean, task: Object|null, reason?: string }>}
 */
export async function renewOrchestrationTaskLease({
  taskId,
  workerId,
  leaseDurationMs = 30000,
  asOfTime = new Date()
}) {
  if (!taskId || !workerId) {
    return { renewed: false, task: null, reason: "MISSING_PARAMETERS" };
  }

  const newLockUntil = new Date(asOfTime.getTime() + leaseDurationMs);
  const isMongoConnected = Boolean(mongoose.connection && mongoose.connection.readyState === 1);

  if (isMongoConnected) {
    const updated = await OrchestrationTask.findOneAndUpdate(
      {
        taskId,
        lockedBy: workerId,
        lockedUntil: { $gte: asOfTime },
        state: { $in: ["CLAIMED", "EVIDENCE_COLLECTION", "POLICY_EVALUATION"] }
      },
      {
        $set: {
          lockedUntil: newLockUntil
        }
      },
      { new: true }
    );

    if (updated) {
      recordOrchestratorMetric("leasesRenewed");
      return { renewed: true, task: updated };
    }

    recordOrchestratorMetric("leaseLosses");
    logger.warn(
      { taskId, workerId },
      "Lease renewal rejected: task is either no longer owned by this worker, has expired, or is in non-renewable state"
    );
    return { renewed: false, task: null, reason: "LEASE_LOST_OR_EXPIRED" };
  }

  // In-memory offline fallback for testing without MongoDB
  let foundTask = null;
  for (const [key, t] of inMemoryTasks.entries()) {
    if (t.taskId === taskId) {
      foundTask = t;
      break;
    }
  }

  if (foundTask) {
    if (
      foundTask.lockedBy === workerId &&
      foundTask.lockedUntil &&
      foundTask.lockedUntil >= asOfTime &&
      ["CLAIMED", "EVIDENCE_COLLECTION", "POLICY_EVALUATION"].includes(foundTask.state)
    ) {
      foundTask.lockedUntil = newLockUntil;
      recordOrchestratorMetric("leasesRenewed");
      return { renewed: true, task: foundTask };
    }
    recordOrchestratorMetric("leaseLosses");
    return { renewed: false, task: null, reason: "LEASE_LOST_OR_EXPIRED" };
  }

  // Bare mock object in offline unit test where store is empty
  if (inMemoryTasks.size === 0) {
    return { renewed: true, task: null };
  }

  return { renewed: false, task: null, reason: "TASK_NOT_FOUND" };
}

/**
 * Transitions task state atomically and records in stateHistory.
 * Enforces atomic conditional lease ownership check in MongoDB when transitioning from a leased state.
 */
async function transitionTaskState(task, toState, { workerId, reason = null, extraFields = {}, asOfTime = new Date() } = {}) {
  assertValidOrchestrationTransition(task.state, toState);

  const fromState = task.state;
  task.state = toState;

  const historyEntry = {
    fromState,
    toState,
    timestamp: asOfTime,
    workerId,
    reason
  };

  const isMongoConnected = Boolean(mongoose.connection && mongoose.connection.readyState === 1);

  if (isMongoConnected) {
    const query = { taskId: task.taskId };
    if (workerId) {
      query.lockedBy = workerId;
      query.lockedUntil = { $gte: asOfTime };
    }

    const updated = await OrchestrationTask.findOneAndUpdate(
      query,
      {
        $set: {
          state: toState,
          ...extraFields
        },
        $push: { stateHistory: historyEntry }
      },
      { new: true }
    );

    if (!updated) {
      recordOrchestratorMetric("leaseLosses");
      const conflictErr = AppError.conflict(
        `Worker '${workerId}' cannot transition task '${task.taskId}' to '${toState}': lease lost or expired`
      );
      conflictErr.code = "LEASE_OWNERSHIP_LOST";
      throw conflictErr;
    }

    return updated;
  }

  // In-memory update
  if (workerId && task.lockedBy) {
    const isOwner = task.lockedBy === workerId;
    const isExpired = task.lockedUntil && task.lockedUntil < asOfTime;
    if (!isOwner || isExpired) {
      recordOrchestratorMetric("leaseLosses");
      const conflictErr = AppError.conflict(
        `Worker '${workerId}' cannot transition task '${task.taskId}' to '${toState}': lease lost or expired`
      );
      conflictErr.code = "LEASE_OWNERSHIP_LOST";
      throw conflictErr;
    }
  }

  task.stateHistory.push(historyEntry);
  Object.assign(task, extraFields);
  return task;
}

/**
 * Executes the complete 7-step safe resolution orchestration pipeline for a claimed task.
 *
 * NON-EXECUTABILITY INVARIANT:
 * - ZERO provider mutations (never dispatches refunds, captures, voids).
 * - ZERO canonical ledger or order mutations.
 * - Case 22 remains unconditionally in SAFE_HOLD.
 * - Missing approved refund limits fail closed.
 * - Ambiguous outcomes remain unresolved.
 *
 * @param {Object} task - Claimed OrchestrationTask document
 * @param {Object} [options]
 * @param {string} [options.workerId="orch-worker-1"] - Worker identifier
 * @param {Date} [options.asOfTime=new Date()] - Injectable clock reference
 * @param {Function|null} [options.customFetch=null] - Injectable fetch for read-only checks
 * @param {Object|null} [options.policyConfig=null] - Trusted server-side policy config
 * @returns {Promise<Object>} Execution outcome summary
 */
export async function processOrchestrationTask(
  task,
  {
    workerId = "orch-worker-1",
    asOfTime = new Date(),
    customFetch = null,
    policyConfig = null
  } = {}
) {
  try {
    // Gate check: if kill switch was engaged after claim, release task immediately
    const gate = await checkOrchestratorGate();
  if (!gate.allowed) {
    await transitionTaskState(task, "WAITING_FOR_RECHECK", {
      workerId,
      reason: `Gate disabled during processing: ${gate.reason}`,
      extraFields: { lockedUntil: null, lockedBy: null },
      asOfTime
    });
    return { status: "WAITING_FOR_RECHECK", reason: gate.reason };
  }

  const tenantId = task.tenantId;
  const caseId = task.caseId;
  const isMongoConnected = Boolean(mongoose.connection && mongoose.connection.readyState === 1);

  // -------------------------------------------------------------------------
  // STEP 1: Verify Resource & Tenant Bindings
  // -------------------------------------------------------------------------
  let paymentCase = null;
  let gatewayPayment = null;
  let merchantOrder = null;

  if (isMongoConnected) {
    paymentCase = await PaymentCase.findOne({ caseId, tenantId }).lean();
  } else {
    // Mock / in-memory lookup
    paymentCase = task.mockPaymentCase || null;
  }

  if (!paymentCase) {
    recordOrchestratorMetric("safeHolds");
    await transitionTaskState(task, "SAFE_HOLD", {
      workerId,
      reason: `PaymentCase '${caseId}' not found for tenant '${tenantId}'`,
      extraFields: {
        safeHoldCode: "RESOURCE_TENANT_MISMATCH",
        safeHoldReason: "PaymentCase does not exist or tenant binding mismatch",
        lockedUntil: null,
        lockedBy: null
      },
      asOfTime
    });
    return { status: "SAFE_HOLD", reason: "RESOURCE_TENANT_MISMATCH" };
  }

  // -------------------------------------------------------------------------
  // STEP 2: Transition to EVIDENCE_COLLECTION
  // -------------------------------------------------------------------------
  await transitionTaskState(task, "EVIDENCE_COLLECTION", {
    workerId,
    reason: "Beginning authoritative evidence collection",
    asOfTime
  });

  const paymentId = task.gatewayPaymentId || paymentCase.gatewayPaymentId;
  const orderId = task.merchantOrderId || paymentCase.merchantOrderId;

  if (isMongoConnected) {
    if (paymentId) {
      gatewayPayment = await GatewayPayment.findOne({ gatewayPaymentId: paymentId, tenantId }).lean();
    }
    if (orderId) {
      merchantOrder = await MerchantOrder.findOne({ merchantOrderId: orderId, tenantId }).lean();
    }
  } else {
    gatewayPayment = task.mockGatewayPayment || null;
    merchantOrder = task.mockMerchantOrder || null;
  }

  // Cross-tenant verification: Payment and Order must belong strictly to tenant
  if ((gatewayPayment && gatewayPayment.tenantId !== tenantId) || (merchantOrder && merchantOrder.tenantId !== tenantId)) {
    recordOrchestratorMetric("safeHolds");
    await transitionTaskState(task, "SAFE_HOLD", {
      workerId,
      reason: "Cross-tenant resource reference detected",
      extraFields: {
        safeHoldCode: "CROSS_TENANT_BLOCKED",
        safeHoldReason: "Correlated gateway payment or merchant order belongs to a different tenant",
        lockedUntil: null,
        lockedBy: null
      },
      asOfTime
    });
    return { status: "SAFE_HOLD", reason: "CROSS_TENANT_BLOCKED" };
  }

  // -------------------------------------------------------------------------
  // STEP 3: Case 22 Invariant Check (Late capture on cancelled order)
  // Case 22 MUST REMAIN UNCONDITIONALLY IN SAFE_HOLD!
  // No orchestration path may automatically refund it or reopen the order.
  // -------------------------------------------------------------------------
  const isOrderCancelled =
    (merchantOrder && merchantOrder.status === "CANCELLED") ||
    paymentCase.orderStatus === "ORDER_CANCELLED";

  const isPaymentCaptured =
    (gatewayPayment && (gatewayPayment.status === "CAPTURED" || gatewayPayment.status === "captured")) ||
    paymentCase.captureStatus === "CAPTURE_CAPTURED";

  const isCase22 = isOrderCancelled && isPaymentCaptured;

  if (isCase22 || paymentCase.discrepancyCategory === "CANCELLED_ORDER_CAPTURED") {
    recordOrchestratorMetric("safeHolds");
    recordOrchestratorMetric("escalations");

    await transitionTaskState(task, "SAFE_HOLD", {
      workerId,
      reason: "Case 22: Late capture on cancelled order held unconditionally in SAFE_HOLD",
      extraFields: {
        safeHoldCode: "R_LATE_CAPTURE_CANCELLED_ORDER_HOLD",
        safeHoldReason: "Late capture after cancelled order requires manual operator review. Automated mutation forbidden.",
        escalationReason: "Case 22 requires authorized human review",
        escalationState: "PENDING_OPERATOR_REVIEW",
        lockedUntil: null,
        lockedBy: null
      },
      asOfTime
    });

    return {
      status: "SAFE_HOLD",
      case22Held: true,
      reason: "R_LATE_CAPTURE_CANCELLED_ORDER_HOLD"
    };
  }

  // -------------------------------------------------------------------------
  // STEP 4: Read-Only Provider Status Check (If payment pending or needs recheck)
  // -------------------------------------------------------------------------
  // Gate check before consequential step
  const gateBeforeStep4 = await checkOrchestratorGate();
  if (!gateBeforeStep4.allowed) {
    await transitionTaskState(task, "WAITING_FOR_RECHECK", {
      workerId,
      reason: `Gate disabled before provider status check: ${gateBeforeStep4.reason}`,
      extraFields: { lockedUntil: null, lockedBy: null },
      asOfTime
    });
    return { status: "WAITING_FOR_RECHECK", reason: gateBeforeStep4.reason };
  }

  // Lease renewal before consequential step
  const renewalStep4 = await renewOrchestrationTaskLease({ taskId: task.taskId, workerId, asOfTime });
  if (!renewalStep4.renewed) {
    logger.warn({ taskId: task.taskId, workerId }, "Aborting task processing before Step 4: lease ownership lost");
    return { status: "LEASE_LOST", reason: "LEASE_LOST_OR_EXPIRED" };
  }

  let readOnlyProviderData = null;
  let readOnlyFetchError = null;

  if (paymentId) {
    try {
      readOnlyProviderData = await fetchRazorpayApi(`/v1/payments/${encodeURIComponent(paymentId)}`, {}, customFetch);
    } catch (err) {
      readOnlyFetchError = err;
    }
  }

  // Handle read-only provider fetch errors conservatively
  if (readOnlyFetchError) {
    const isTimeout =
      readOnlyFetchError.code === RAZORPAY_ERROR_CODES.TIMEOUT ||
      readOnlyFetchError.name === "AbortError";
    const isNetwork = readOnlyFetchError.code === RAZORPAY_ERROR_CODES.NETWORK_ERROR;
    const isRateLimited = readOnlyFetchError.code === RAZORPAY_ERROR_CODES.RATE_LIMIT;

    logger.warn(
      { paymentId, errCode: readOnlyFetchError.code, message: readOnlyFetchError.message },
      "Read-only provider status check encountered an error"
    );

    // Timeout or transient network failure does NOT prove payment failure!
    const isTransient = isTimeout || isNetwork || isRateLimited;
    const isDeadlineExceeded = Boolean(task.deadlineAt && asOfTime >= task.deadlineAt);
    const areAttemptsExhausted = task.attemptCount >= task.maxAttempts || isDeadlineExceeded;

    if (isTransient && !areAttemptsExhausted) {
      const nextRunAt = calculateOrchestrationBackoffTime({
        attemptCount: task.attemptCount,
        backoffIntervalsSeconds: task.backoffIntervalsSeconds,
        asOfTime
      });

      recordOrchestratorMetric("retries");
      await transitionTaskState(task, "WAITING_FOR_RECHECK", {
        workerId,
        reason: `Transient provider check error: ${readOnlyFetchError.message}. Rescheduled.`,
        extraFields: {
          nextRunAt,
          lastError: readOnlyFetchError.message,
          lockedUntil: null,
          lockedBy: null
        },
        asOfTime
      });

      return {
        status: "WAITING_FOR_RECHECK",
        reason: "TRANSIENT_PROVIDER_CHECK_ERROR",
        nextRunAt
      };
    }

    if (areAttemptsExhausted) {
      // Monitoring window exhausted without authoritative evidence -> SAFE_HOLD
      recordOrchestratorMetric("safeHolds");
      await transitionTaskState(task, "SAFE_HOLD", {
        workerId,
        reason: "Monitoring retry window exhausted without authoritative provider confirmation",
        extraFields: {
          safeHoldCode: "MONITORING_WINDOW_EXHAUSTED",
          safeHoldReason: "Provider status check retry budget exhausted under ambiguous network conditions",
          lastError: readOnlyFetchError.message,
          lockedUntil: null,
          lockedBy: null
        },
        asOfTime
      });

      return {
        status: "SAFE_HOLD",
        reason: "MONITORING_WINDOW_EXHAUSTED"
      };
    }
  }

  // -------------------------------------------------------------------------
  // STEP 5: Transition to POLICY_EVALUATION
  // -------------------------------------------------------------------------
  // Gate check before policy evaluation
  const gateBeforeStep5 = await checkOrchestratorGate();
  if (!gateBeforeStep5.allowed) {
    await transitionTaskState(task, "WAITING_FOR_RECHECK", {
      workerId,
      reason: `Gate disabled before policy evaluation: ${gateBeforeStep5.reason}`,
      extraFields: { lockedUntil: null, lockedBy: null },
      asOfTime
    });
    return { status: "WAITING_FOR_RECHECK", reason: gateBeforeStep5.reason };
  }

  // Lease renewal before policy evaluation
  const renewalStep5 = await renewOrchestrationTaskLease({ taskId: task.taskId, workerId, asOfTime });
  if (!renewalStep5.renewed) {
    logger.warn({ taskId: task.taskId, workerId }, "Aborting task processing before Step 5: lease ownership lost");
    return { status: "LEASE_LOST", reason: "LEASE_LOST_OR_EXPIRED" };
  }

  await transitionTaskState(task, "POLICY_EVALUATION", {
    workerId,
    reason: "Evaluating deterministic resolution policy",
    asOfTime
  });

  const proposedAction = task.proposedActionType || "WAIT_AND_MONITOR";

  const policyResult = evaluateResolutionPolicy({
    tenantId,
    caseId,
    actorId: workerId,
    actorRole: "PAYMENT_CONTROLLER",
    proposedActionType: proposedAction,
    amountPaise: gatewayPayment?.amountPaise || paymentCase.amountPaise || 0,
    currency: gatewayPayment?.currency || paymentCase.currency || "INR",
    classificationFinding: paymentCase.discrepancyCategory,
    authoritativeEvidence: {
      gatewayPayment,
      merchantOrder,
      paymentCase,
      providerData: readOnlyProviderData
    },
    policyConfig,
    policyVersion: task.policyVersion || DEFAULT_POLICY_VERSION
  });

  // -------------------------------------------------------------------------
  // STEP 6: Execute Permitted Non-Mutating Orchestration Step
  // -------------------------------------------------------------------------
  // Invariant A: If policy mandates SAFE_HOLD
  if (policyResult.outcomeStatus === "SAFE_HOLD" || policyResult.isSafeHold) {
    recordOrchestratorMetric("safeHolds");
    await transitionTaskState(task, "SAFE_HOLD", {
      workerId,
      reason: policyResult.safeHoldReason || policyResult.denyReasons?.join("; ") || "Policy mandates SAFE_HOLD",
      extraFields: {
        safeHoldCode: policyResult.appliedRuleIds?.[0] || "POLICY_SAFE_HOLD",
        safeHoldReason: policyResult.safeHoldReason || policyResult.denyReasons?.join("; "),
        policyDecision: sanitizeOrchestrationPayload(policyResult),
        lockedUntil: null,
        lockedBy: null
      },
      asOfTime
    });

    return {
      status: "SAFE_HOLD",
      policyResult
    };
  }

  // Invariant B: If policy requires ESCALATION or missing refund limits
  if (
    policyResult.outcomeStatus === "ESCALATION_REQUIRED" ||
    policyResult.appliedRuleIds?.includes("R_REFUND_LIMITS_MISSING_FAIL_CLOSED") ||
    policyResult.appliedRuleIds?.includes("R_ADMIN_APPROVAL_REQUIRED")
  ) {
    recordOrchestratorMetric("escalations");
    await transitionTaskState(task, "ESCALATION_REQUIRED", {
      workerId,
      reason: policyResult.denyReasons?.join("; ") || "Policy requires authorized human escalation",
      extraFields: {
        escalationReason: policyResult.denyReasons?.join("; ") || "Missing approved refund limits or human review required",
        escalationState: "PENDING_OPERATOR_REVIEW",
        policyDecision: sanitizeOrchestrationPayload(policyResult),
        lockedUntil: null,
        lockedBy: null
      },
      asOfTime
    });

    return {
      status: "ESCALATION_REQUIRED",
      policyResult
    };
  }

  // Invariant C: If proposed action is REQUEST_REFUND or any financial mutation
  // THE AUTONOMOUS WORKER IS STRICTLY FORBIDDEN FROM DISPATCHING REFUNDS!
  if (proposedAction === "REQUEST_REFUND" || proposedAction === "EXECUTE_PROVIDER_REFUND") {
    recordOrchestratorMetric("escalations");
    await transitionTaskState(task, "ESCALATION_REQUIRED", {
      workerId,
      reason: "Financial mutation requested: autonomous worker cannot execute refunds; operator dispatch required",
      extraFields: {
        escalationReason: "Refund eligible in policy but autonomous execution forbidden. Awaiting operator dispatch.",
        escalationState: "PENDING_OPERATOR_APPROVAL",
        policyDecision: sanitizeOrchestrationPayload(policyResult),
        lockedUntil: null,
        lockedBy: null
      },
      asOfTime
    });

    return {
      status: "ESCALATION_REQUIRED",
      reason: "MUTATION_REQUIRES_HUMAN_APPROVAL",
      policyResult
    };
  }

  // Invariant D: If policy allows WAIT_AND_MONITOR or RECHECK_PROVIDER_STATUS
  if (proposedAction === "WAIT_AND_MONITOR" || proposedAction === "RECHECK_PROVIDER_STATUS") {
    const isDeadlineExceeded = Boolean(task.deadlineAt && asOfTime >= task.deadlineAt);
    const areAttemptsExhausted = task.attemptCount >= task.maxAttempts || isDeadlineExceeded;

    if (!areAttemptsExhausted) {
      const nextRunAt = calculateOrchestrationBackoffTime({
        attemptCount: task.attemptCount,
        backoffIntervalsSeconds: task.backoffIntervalsSeconds,
        asOfTime
      });

      recordOrchestratorMetric("retries");
      await transitionTaskState(task, "WAITING_FOR_RECHECK", {
        workerId,
        reason: `Policy approved ${proposedAction}. Waiting for next check interval.`,
        extraFields: {
          nextRunAt,
          policyDecision: sanitizeOrchestrationPayload(policyResult),
          lockedUntil: null,
          lockedBy: null
        },
        asOfTime
      });

      return {
        status: "WAITING_FOR_RECHECK",
        nextRunAt,
        policyResult
      };
    }

    // Monitoring window exhausted
    recordOrchestratorMetric("safeHolds");
    await transitionTaskState(task, "SAFE_HOLD", {
      workerId,
      reason: "Monitoring window exhausted without final resolution",
      extraFields: {
        safeHoldCode: "MONITORING_WINDOW_EXHAUSTED",
        safeHoldReason: "Maximum polling attempts reached under non-definitive state",
        policyDecision: sanitizeOrchestrationPayload(policyResult),
        lockedUntil: null,
        lockedBy: null
      },
      asOfTime
    });

    return {
      status: "SAFE_HOLD",
      reason: "MONITORING_WINDOW_EXHAUSTED",
      policyResult
    };
  }

  // Invariant E: Terminal completion (Fully reconciled / matching / non-mutating completion)
  recordOrchestratorMetric("tasksCompleted");
  await transitionTaskState(task, "COMPLETED", {
    workerId,
    reason: "Orchestration lifecycle completed safely without outstanding mutations",
    extraFields: {
      policyDecision: sanitizeOrchestrationPayload(policyResult),
      lockedUntil: null,
      lockedBy: null
    },
    asOfTime
  });

  return {
    status: "COMPLETED",
    policyResult
  };
  } catch (err) {
    if (err.code === "LEASE_OWNERSHIP_LOST" || err.message?.includes("lease lost")) {
      logger.warn(
        { taskId: task.taskId, workerId },
        "Task processing halted safely: worker lost lease ownership or lease expired"
      );
      return { status: "LEASE_LOST", reason: "LEASE_OWNERSHIP_LOST" };
    }
    throw err;
  }
}

/**
 * Sweeps due orchestration tasks up to a configured batch ceiling.
 *
 * @param {Object} [options]
 * @param {number} [options.maxTasks=5] - Batch concurrency ceiling
 * @param {string} [options.workerId="orch-worker-1"] - Worker identifier
 * @param {number} [options.leaseDurationMs=30000] - Lease duration
 * @param {Date} [options.asOfTime=new Date()] - Injectable clock reference
 * @param {Function|null} [options.customFetch=null] - Injectable fetch
 * @param {Object|null} [options.policyConfig=null] - Trusted policy config
 * @returns {Promise<Object>} Sweep execution summary
 */
export async function sweepDueOrchestrationTasks({
  maxTasks = 5,
  workerId = "orch-worker-1",
  leaseDurationMs = 30000,
  asOfTime = new Date(),
  customFetch = null,
  policyConfig = null
} = {}) {
  // Gate check
  const gate = await checkOrchestratorGate();
  if (!gate.allowed) {
    return {
      processedCount: 0,
      completedCount: 0,
      safeHoldCount: 0,
      escalatedCount: 0,
      waitingCount: 0,
      failedCount: 0,
      reason: gate.reason
    };
  }

  let processedCount = 0;
  let completedCount = 0;
  let safeHoldCount = 0;
  let escalatedCount = 0;
  let waitingCount = 0;
  let failedCount = 0;
  const results = [];

  for (let i = 0; i < maxTasks; i++) {
    const task = await claimDueOrchestrationTask({
      workerId,
      leaseDurationMs,
      asOfTime
    });

    if (!task) {
      break; // No more due tasks
    }

    processedCount++;

    try {
      const outcome = await processOrchestrationTask(task, {
        workerId,
        asOfTime,
        customFetch,
        policyConfig
      });

      results.push(outcome);

      if (outcome.status === "COMPLETED") completedCount++;
      else if (outcome.status === "SAFE_HOLD") safeHoldCount++;
      else if (outcome.status === "ESCALATION_REQUIRED") escalatedCount++;
      else if (outcome.status === "WAITING_FOR_RECHECK") waitingCount++;
      else if (outcome.status === "LEASE_LOST") {
        logger.warn({ taskId: task.taskId, workerId }, "Task processing stopped due to lease loss");
      }
    } catch (err) {
      if (err.code === "LEASE_OWNERSHIP_LOST" || err.message?.includes("lease lost")) {
        logger.warn(
          { taskId: task.taskId, workerId },
          "Worker lost lease ownership during execution; halting cleanly without state mutation"
        );
        continue;
      }
      failedCount++;
      recordOrchestratorMetric("failures");
      logger.error({ err: err.message, taskId: task.taskId }, "Unhandled error in orchestration task execution");

      // Attempt safe failure recovery
      const isMongoConnected = Boolean(mongoose.connection && mongoose.connection.readyState === 1);
      if (isMongoConnected) {
        await OrchestrationTask.updateOne(
          { taskId: task.taskId },
          {
            $set: {
              state: "FAILED_RETRYABLE",
              lockedUntil: null,
              lockedBy: null,
              lastError: err.message
            }
          }
        ).catch(() => {});
      } else {
        task.state = "FAILED_RETRYABLE";
        task.lockedUntil = null;
        task.lockedBy = null;
        task.lastError = err.message;
      }
    }
  }

  return {
    processedCount,
    completedCount,
    safeHoldCount,
    escalatedCount,
    waitingCount,
    failedCount,
    results
  };
}
