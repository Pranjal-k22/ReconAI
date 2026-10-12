import mongoose from "mongoose";

/**
 * ReconAI 2.0 - PaymentMonitoringTask Domain Model
 *
 * Represents a durable, distributed scheduled task for bounded payment status rechecks.
 * Backed by atomic leasing with optimistic locking:
 * - `lockedUntil` and `lockedBy` implement atomic task claims.
 * - Tasks surviving worker crashes can be claimed upon lease expiration (`lockedUntil <= now`).
 * - Idempotency and duplicate prevention guaranteed via unique indexes and atomic updates.
 */

export const TASK_STATUSES = [
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "EXHAUSTED",
  "FAILED",
  "CANCELLED"
];

const paymentMonitoringTaskSchema = new mongoose.Schema(
  {
    taskId: {
      type: String,
      required: [true, "taskId is required"],
      trim: true,
      unique: true,
      index: true
    },
    tenantId: {
      type: String,
      required: [true, "tenantId is required"],
      trim: true,
      index: true
    },
    gatewayPaymentId: {
      type: String,
      required: [true, "gatewayPaymentId is required"],
      trim: true,
      index: true
    },
    merchantOrderId: {
      type: String,
      trim: true,
      default: null,
      index: true
    },
    caseId: {
      type: String,
      trim: true,
      default: null,
      index: true
    },
    status: {
      type: String,
      required: true,
      enum: TASK_STATUSES,
      default: "PENDING",
      index: true
    },
    attemptCount: {
      type: Number,
      default: 0,
      min: 0
    },
    maxAttempts: {
      type: Number,
      default: 4,
      min: 1
    },
    backoffIntervalsSeconds: {
      type: [Number],
      default: [60, 300, 900, 1800] // T+1m, T+5m, T+15m, T+30m
    },
    nextRunAt: {
      type: Date,
      required: true,
      default: Date.now,
      index: true
    },
    lastRunAt: {
      type: Date,
      default: null
    },
    deadlineAt: {
      type: Date,
      default: null
    },
    lockedUntil: {
      type: Date,
      default: null,
      index: true
    },
    lockedBy: {
      type: String,
      trim: true,
      default: null
    },
    lastError: {
      type: String,
      default: null
    },
    lastObservedStatus: {
      type: String,
      default: null
    },
    outcomeReason: {
      type: String,
      default: null
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

paymentMonitoringTaskSchema.index({ status: 1, nextRunAt: 1, lockedUntil: 1 });
paymentMonitoringTaskSchema.index({ tenantId: 1, gatewayPaymentId: 1 });
paymentMonitoringTaskSchema.index({ tenantId: 1, caseId: 1 });

export const PaymentMonitoringTask =
  mongoose.models.PaymentMonitoringTask ||
  mongoose.model("PaymentMonitoringTask", paymentMonitoringTaskSchema);

export default PaymentMonitoringTask;
