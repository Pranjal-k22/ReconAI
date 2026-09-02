import mongoose from "mongoose";

/**
 * CRITICAL ARCHITECTURE RULE:
 * This model must NEVER be imported into production reconciliation services.
 * It is accessible ONLY to benchmark dataset generation and evaluation modules.
 * Production reconciliation matching MUST execute independently of ground truth data.
 */

const groundTruthSchema = new mongoose.Schema(
  {
    datasetVersion: {
      type: String,
      required: [true, "datasetVersion is required"],
      trim: true,
      index: true
    },
    merchantOrderId: {
      type: String,
      required: [true, "merchantOrderId is required"],
      trim: true,
      index: true
    },
    expectedClassification: {
      type: String,
      required: [true, "expectedClassification is required"],
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
      ]
    },
    expectedPaymentIds: {
      type: [String],
      default: []
    },
    expectedSettlementRecordIds: {
      type: [String],
      default: []
    },
    expectedRequiresReview: {
      type: Boolean,
      default: false
    },
    notes: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Compound unique index for versioned order ground truth
groundTruthSchema.index({ datasetVersion: 1, merchantOrderId: 1 }, { unique: true });

export const GroundTruth =
  mongoose.models.GroundTruth ||
  mongoose.model("GroundTruth", groundTruthSchema);

export default GroundTruth;
