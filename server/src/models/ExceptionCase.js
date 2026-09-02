import mongoose from "mongoose";
import { isNonNegativeSafeInteger } from "./helpers/validators.js";

const exceptionCaseSchema = new mongoose.Schema(
  {
    exceptionId: {
      type: String,
      required: [true, "exceptionId is required"],
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
    resultId: {
      type: String,
      required: [true, "resultId is required"],
      trim: true,
      index: true
    },
    merchantOrderId: {
      type: String,
      trim: true,
      index: true,
      default: null
    },
    type: {
      type: String,
      required: [true, "exception type is required"],
      enum: [
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
    severity: {
      type: String,
      required: true,
      enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"],
      default: "MEDIUM",
      index: true
    },
    confidence: {
      type: Number,
      min: [0, "Confidence cannot be less than 0"],
      max: [1, "Confidence cannot be greater than 1"],
      default: null
    },
    financialImpactPaise: {
      type: Number,
      default: 0,
      validate: {
        validator: isNonNegativeSafeInteger,
        message: "financialImpactPaise must be a non-negative safe integer"
      }
    },
    title: {
      type: String,
      required: [true, "title is required"],
      trim: true
    },
    deterministicExplanation: {
      type: String,
      required: [true, "deterministicExplanation is required"],
      trim: true
    },
    aiExplanation: {
      type: String,
      default: null
    },
    aiRecommendation: {
      type: String,
      default: null
    },
    aiConfidence: {
      type: Number,
      min: [0, "aiConfidence cannot be less than 0"],
      max: [1, "aiConfidence cannot be greater than 1"],
      default: null
    },
    status: {
      type: String,
      required: true,
      enum: ["OPEN", "UNDER_REVIEW", "RESOLVED", "DISMISSED"],
      default: "OPEN",
      index: true
    },
    assignedTo: {
      type: String,
      trim: true,
      default: null
    },
    humanDecision: {
      type: String,
      enum: ["APPROVE_MATCH", "KEEP_EXCEPTION", "MARK_RESOLVED", "NONE"],
      default: "NONE"
    },
    resolutionNotes: {
      type: String,
      default: null
    },
    resolvedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

exceptionCaseSchema.index({ runId: 1, status: 1 });
exceptionCaseSchema.index({ severity: 1, status: 1 });
exceptionCaseSchema.index({ runId: 1, resultId: 1 }, { unique: true });

export const ExceptionCase =
  mongoose.models.ExceptionCase ||
  mongoose.model("ExceptionCase", exceptionCaseSchema);

export default ExceptionCase;
