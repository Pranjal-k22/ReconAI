import mongoose from "mongoose";
import { isSafeInteger, isNonNegativeSafeInteger } from "./helpers/validators.js";

const reconciliationResultSchema = new mongoose.Schema(
  {
    resultId: {
      type: String,
      required: [true, "resultId is required"],
      trim: true,
      unique: true,
      index: true
    },
    runId: {
      type: String,
      required: [true, "runId is required"],
      trim: true,
      index: true
    },
    merchantOrderId: {
      type: String,
      trim: true,
      index: true,
      default: null
    },
    gatewayPaymentIds: {
      type: [String],
      default: []
    },
    settlementRecordIds: {
      type: [String],
      default: []
    },
    classification: {
      type: String,
      required: [true, "classification is required"],
      enum: [
        "MATCHED",
        "AMOUNT_MISMATCH",
        "MISSING_PAYMENT",
        "MISSING_SETTLEMENT",
        "DUPLICATE_PAYMENT",
        "DUPLICATE_SETTLEMENT",
        "FEE_MISMATCH",
        "REFUND_MISMATCH",
        "REFERENCE_MISMATCH",
        "STATUS_MISMATCH",
        "AMBIGUOUS",
        "INVALID_DATA"
      ],
      index: true
    },
    confidence: {
      type: Number,
      required: [true, "confidence is required"],
      min: [0, "Confidence cannot be less than 0"],
      max: [1, "Confidence cannot be greater than 1"]
    },
    autoResolved: {
      type: Boolean,
      default: false
    },
    resolutionStatus: {
      type: String,
      required: true,
      enum: [
        "AUTO_RECONCILED",
        "OPEN",
        "UNDER_REVIEW",
        "APPROVED",
        "REJECTED",
        "RESOLVED"
      ],
      default: "OPEN",
      index: true
    },
    expectedAmountPaise: {
      type: Number,
      default: 0,
      validate: {
        validator: isNonNegativeSafeInteger,
        message: "expectedAmountPaise must be a non-negative safe integer"
      }
    },
    actualAmountPaise: {
      type: Number,
      default: null,
      validate: {
        validator: (v) => v === null || v === undefined || isNonNegativeSafeInteger(v),
        message: "actualAmountPaise must be a non-negative safe integer or null"
      }
    },
    differencePaise: {
      type: Number,
      default: null,
      validate: {
        validator: (v) => v === null || v === undefined || isSafeInteger(v),
        message: "differencePaise must be a valid safe integer or null"
      }
    },
    reasons: {
      type: [String],
      default: []
    },
    ruleEvidence: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    aiInvestigationId: {
      type: String,
      trim: true,
      default: null
    },
    requiresReview: {
      type: Boolean,
      default: false,
      index: true
    }
  },
  {
    timestamps: true
  }
);

reconciliationResultSchema.index({ runId: 1, classification: 1 });
reconciliationResultSchema.index({ runId: 1, requiresReview: 1 });
reconciliationResultSchema.index({ runId: 1, merchantOrderId: 1 }, { unique: true });

export const ReconciliationResult =
  mongoose.models.ReconciliationResult ||
  mongoose.model("ReconciliationResult", reconciliationResultSchema);

export default ReconciliationResult;
