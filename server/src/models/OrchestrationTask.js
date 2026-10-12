import mongoose from "mongoose";
import { ORCHESTRATION_STATES } from "../services/orchestration/orchestrationStateMachine.js";

/**
 * ReconAI 2.0 - OrchestrationTask Domain Model
 *
 * Represents a durable, tenant-scoped, idempotently managed task for autonomous
 * resolution orchestration.
 *
 * Key guarantees:
 * - Atomic lease claiming via `lockedUntil` and `lockedBy`.
 * - Durable unique compound index `{ tenantId: 1, idempotencyKey: 1 }`.
 * - Bounded retry intervals `[60, 300, 900, 1800]` seconds.
 * - Explicit transition tracking via `stateHistory`.
 * - Stale lease recovery for crashed workers (`lockedUntil <= now`).
 */

const stateHistorySchema = new mongoose.Schema(
  {
    fromState: {
      type: String,
      enum: ORCHESTRATION_STATES,
      default: null
    },
    toState: {
      type: String,
      required: true,
      enum: ORCHESTRATION_STATES
    },
    timestamp: {
      type: Date,
      required: true,
      default: Date.now
    },
    workerId: {
      type: String,
      trim: true,
      default: null
    },
    reason: {
      type: String,
      trim: true,
      default: null
    }
  },
  { _id: false }
);

const orchestrationTaskSchema = new mongoose.Schema(
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
    caseId: {
      type: String,
      required: [true, "caseId is required"],
      trim: true,
      index: true
    },
    gatewayPaymentId: {
      type: String,
      trim: true,
      default: null,
      index: true
    },
    merchantOrderId: {
      type: String,
      trim: true,
      default: null,
      index: true
    },
    idempotencyKey: {
      type: String,
      required: [true, "idempotencyKey is required"],
      trim: true
    },
    state: {
      type: String,
      required: true,
      enum: ORCHESTRATION_STATES,
      default: "QUEUED",
      index: true
    },
    stateHistory: {
      type: [stateHistorySchema],
      default: []
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
      default: [60, 300, 900, 1800]
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
    triggerSource: {
      type: String,
      enum: ["API", "WEBHOOK", "SCHEDULER", "MANUAL", "MONITORING"],
      default: "API"
    },
    sourceEventId: {
      type: String,
      trim: true,
      default: null
    },
    policyVersion: {
      type: String,
      trim: true,
      default: "2026-10-12.v1"
    },
    policyDecision: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    evidenceReferences: {
      type: [String],
      default: []
    },
    proposedActionType: {
      type: String,
      trim: true,
      default: null
    },
    safeHoldReason: {
      type: String,
      trim: true,
      default: null
    },
    safeHoldCode: {
      type: String,
      trim: true,
      default: null
    },
    escalationReason: {
      type: String,
      trim: true,
      default: null
    },
    escalationState: {
      type: String,
      trim: true,
      default: null
    },
    lastError: {
      type: String,
      trim: true,
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

// Indexes
orchestrationTaskSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
orchestrationTaskSchema.index({ state: 1, nextRunAt: 1, lockedUntil: 1 });
orchestrationTaskSchema.index({ tenantId: 1, caseId: 1 });
orchestrationTaskSchema.index({ tenantId: 1, gatewayPaymentId: 1 });

export const OrchestrationTask =
  mongoose.models.OrchestrationTask ||
  mongoose.model("OrchestrationTask", orchestrationTaskSchema);

export default OrchestrationTask;
