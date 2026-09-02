import mongoose from "mongoose";
import { isNonNegativeSafeInteger } from "./helpers/validators.js";

const reconciliationRunSchema = new mongoose.Schema(
  {
    runId: {
      type: String,
      required: [true, "runId is required"],
      trim: true,
      unique: true,
      index: true
    },
    name: {
      type: String,
      trim: true,
      default: "Reconciliation Run"
    },
    sourceMode: {
      type: String,
      required: true,
      enum: ["SYNTHETIC", "CSV", "RAZORPAY", "MIXED"],
      default: "SYNTHETIC"
    },
    status: {
      type: String,
      required: true,
      enum: [
        "PENDING",
        "RUNNING",
        "COMPLETED",
        "COMPLETED_WITH_EXCEPTIONS",
        "FAILED"
      ],
      default: "PENDING"
    },
    startedAt: {
      type: Date,
      default: Date.now
    },
    completedAt: {
      type: Date,
      default: null
    },
    totalRecords: {
      type: Number,
      default: 0,
      validate: {
        validator: isNonNegativeSafeInteger,
        message: "totalRecords must be a non-negative safe integer"
      }
    },
    processedRecords: {
      type: Number,
      default: 0,
      validate: {
        validator: isNonNegativeSafeInteger,
        message: "processedRecords must be a non-negative safe integer"
      }
    },
    durationMs: {
      type: Number,
      default: 0,
      validate: {
        validator: isNonNegativeSafeInteger,
        message: "durationMs must be a non-negative safe integer"
      }
    },
    metrics: {
      type: mongoose.Schema.Types.Mixed,
      default: {
        matchedCount: 0,
        exceptionCount: 0,
        manualReviewCount: 0,
        autoReconciledCount: 0,
        autoReconciliationRate: 0,
        throughputRecordsPerSecond: 0,
        totalAmountProcessedPaise: 0,
        autoReconciledAmountPaise: 0,
        amountUnderReviewPaise: 0,
        classificationBreakdown: {}
      }
    },
    configuration: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    errorSummary: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

reconciliationRunSchema.index({ status: 1 });
reconciliationRunSchema.index({ createdAt: 1 });

export const ReconciliationRun =
  mongoose.models.ReconciliationRun ||
  mongoose.model("ReconciliationRun", reconciliationRunSchema);

export default ReconciliationRun;
