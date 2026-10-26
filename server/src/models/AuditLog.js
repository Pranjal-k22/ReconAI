import mongoose from "mongoose";

const auditLogSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      required: [true, "eventId is required"],
      trim: true,
      unique: true,
      index: true
    },
    timestamp: {
      type: Date,
      default: Date.now,
      index: true
    },
    actorType: {
      type: String,
      required: [true, "actorType is required"],
      enum: [
        "SYSTEM",
        "RULE_ENGINE",
        "AI",
        "HUMAN",
        "SERVICE",
        "RAZORPAY_ADAPTER",
        "IMPORTER"
      ],
      index: true
    },
    actorId: {
      type: String,
      default: "system",
      trim: true
    },
    action: {
      type: String,
      required: [true, "action is required"],
      enum: [
        "DATA_IMPORTED",
        "DATA_NORMALIZED",
        "RECONCILIATION_STARTED",
        "RECONCILIATION_COMPLETED",
        "MATCH_CREATED",
        "EXCEPTION_CREATED",
        "AI_INVESTIGATION_REQUESTED",
        "AI_INVESTIGATION_COMPLETED",
        "AI_INVESTIGATION_FAILED",
        "HUMAN_DECISION",
        "RAZORPAY_SYNC_STARTED",
        "RAZORPAY_SYNC_COMPLETED",
        "RAZORPAY_SYNC_FAILED",
        "DEMO_DATA_RESET",
        "CONTROLLER_RUN_STARTED",
        "CONTROLLER_DATA_VALIDATED",
        "CONTROLLER_RECONCILIATION_COMPLETED",
        "CONTROLLER_SAFETY_GATE_EVALUATED",
        "CONTROLLER_EXCEPTIONS_PROCESSED",
        "CONTROLLER_REPORT_GENERATED",
        "CONTROLLER_RUN_COMPLETED",
        "CONTROLLER_RUN_FAILED",
        "AUTH_LOGIN_SUCCESS",
        "AUTH_LOGIN_FAILED",
        "ACCESS_DENIED_ALERT",
        "TOKEN_REVOKED",
        "GLOBAL_AUDIT_ACCESSED",
        "WEBHOOK_INGESTED",
        "WEBHOOK_DUPLICATE_SKIPPED",
        "WEBHOOK_SIGNATURE_FAILED",
        "WEBHOOK_QUARANTINED",
        "MONITORING_TASK_SCHEDULED",
        "MONITORING_RECHECK_EXECUTED",
        "MONITORING_STATE_UPDATED",
        "MONITORING_POLL_RESCHEDULED",
        "MONITORING_RETRY_EXHAUSTED",
        "MONITORING_LEASE_EXPIRED_RECOVERED",
        "MONITORING_SAFE_HOLD_APPLIED",
        "SAFE_HOLD_APPLIED",
        "STALE_EVENT_DROPPED",
        "ORCHESTRATION_TASK_QUEUED",
        "ORCHESTRATION_TASK_TRANSITIONED",
        "TOKEN_ISSUED",
        "TOKEN_REJECTED",
        "REFUND_RESERVED",
        "REFUND_RESERVATION_RELEASED",
        "REFUND_RESERVATION_CONVERTED",
        "PROVIDER_DISPATCH_REQUESTED",
        "PROVIDER_DISPATCH_COMPLETED",
        "PROVIDER_DISPATCH_FAILED",
        "POLICY_CONFIG_PROPOSED",
        "POLICY_CONFIG_APPROVAL_REQUESTED",
        "POLICY_CONFIG_APPROVED",
        "POLICY_CONFIG_REJECTION_REQUESTED",
        "POLICY_CONFIG_REJECTED",
        "POLICY_CONFIG_ACTIVATED",
        "POLICY_CONFIG_DEACTIVATION_REQUESTED",
        "POLICY_CONFIG_DEACTIVATED",
        "POLICY_CONFIG_CHANGE_BLOCKED"
      ],
      index: true
    },
    tenantId: {
      type: String,
      trim: true,
      default: null,
      index: true
    },
    entityType: {
      type: String,
      required: [true, "entityType is required"],
      trim: true,
      index: true
    },
    entityId: {
      type: String,
      required: [true, "entityId is required"],
      trim: true,
      index: true
    },
    runId: {
      type: String,
      trim: true,
      index: true,
      default: null
    },
    before: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    after: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    reason: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

auditLogSchema.index({ entityType: 1, entityId: 1 });
auditLogSchema.index({ timestamp: -1 });

export const AuditLog =
  mongoose.models.AuditLog ||
  mongoose.model("AuditLog", auditLogSchema);

export default AuditLog;
