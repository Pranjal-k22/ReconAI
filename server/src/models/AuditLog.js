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
        "CONTROLLER_RUN_FAILED"
      ],
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
