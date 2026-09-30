import mongoose from "mongoose";
import { isNonNegativeSafeInteger } from "./helpers/validators.js";

const financeControllerRunSchema = new mongoose.Schema(
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
      default: "Track 4 AI Finance Controller Run"
    },
    sourceMode: {
      type: String,
      required: true,
      enum: ["SYNTHETIC", "CSV", "RAZORPAY", "MIXED"],
      default: "SYNTHETIC"
    },
    importBatchId: {
      type: String,
      trim: true,
      default: "BATCH-DEMO-V1"
    },
    datasetVersion: {
      type: String,
      trim: true,
      default: "RECONAI_DEMO_V1"
    },
    controllerState: {
      type: String,
      required: true,
      enum: [
        "IDLE",
        "INGESTING",
        "VALIDATING",
        "RECONCILING",
        "SAFETY_EVALUATION",
        "EXCEPTION_PROCESSING",
        "REPORTING",
        "COMPLETED",
        "FAILED"
      ],
      default: "IDLE"
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
    currentPhase: {
      type: String,
      default: "INIT"
    },
    progressPercent: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    startedAt: {
      type: Date,
      default: Date.now
    },
    completedAt: {
      type: Date,
      default: null
    },
    durationMs: {
      type: Number,
      default: 0,
      validate: {
        validator: isNonNegativeSafeInteger,
        message: "durationMs must be a non-negative safe integer"
      }
    },
    batchSize: {
      type: Number,
      default: 0,
      validate: {
        validator: isNonNegativeSafeInteger,
        message: "batchSize must be a non-negative safe integer"
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
    matchedRecords: {
      type: Number,
      default: 0,
      validate: {
        validator: isNonNegativeSafeInteger,
        message: "matchedRecords must be a non-negative safe integer"
      }
    },
    exceptionRecords: {
      type: Number,
      default: 0,
      validate: {
        validator: isNonNegativeSafeInteger,
        message: "exceptionRecords must be a non-negative safe integer"
      }
    },
    autoResolvedRecords: {
      type: Number,
      default: 0,
      validate: {
        validator: isNonNegativeSafeInteger,
        message: "autoResolvedRecords must be a non-negative safe integer"
      }
    },
    manualReviewRecords: {
      type: Number,
      default: 0,
      validate: {
        validator: isNonNegativeSafeInteger,
        message: "manualReviewRecords must be a non-negative safe integer"
      }
    },
    unresolvedRecords: {
      type: Number,
      default: 0,
      validate: {
        validator: isNonNegativeSafeInteger,
        message: "unresolvedRecords must be a non-negative safe integer"
      }
    },
    matchRate: {
      type: Number,
      default: 0
    },
    exceptionRate: {
      type: Number,
      default: 0
    },
    throughput: {
      type: Number,
      default: 0
    },
    totalAmountProcessedPaise: {
      type: Number,
      default: 0,
      validate: {
        validator: isNonNegativeSafeInteger,
        message: "totalAmountProcessedPaise must be a non-negative safe integer"
      }
    },
    autoReconciledAmountPaise: {
      type: Number,
      default: 0,
      validate: {
        validator: isNonNegativeSafeInteger,
        message: "autoReconciledAmountPaise must be a non-negative safe integer"
      }
    },
    amountUnderReviewPaise: {
      type: Number,
      default: 0,
      validate: {
        validator: isNonNegativeSafeInteger,
        message: "amountUnderReviewPaise must be a non-negative safe integer"
      }
    },
    reconciliationRunId: {
      type: String,
      default: null
    },
    autoInvestigate: {
      type: Boolean,
      default: true
    },
    report: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    errorSummary: {
      type: String,
      default: null
    },
    configuration: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

financeControllerRunSchema.index({ status: 1 });
financeControllerRunSchema.index({ controllerState: 1 });
financeControllerRunSchema.index({ createdAt: 1 });

export const FinanceControllerRun =
  mongoose.models.FinanceControllerRun ||
  mongoose.model("FinanceControllerRun", financeControllerRunSchema);

export default FinanceControllerRun;
