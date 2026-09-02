import mongoose from "mongoose";
import { isSafeInteger, isNonNegativeSafeInteger } from "./helpers/validators.js";

const settlementRecordSchema = new mongoose.Schema(
  {
    settlementRecordId: {
      type: String,
      required: [true, "settlementRecordId is required"],
      trim: true,
      unique: true,
      index: true
    },
    settlementId: {
      type: String,
      required: [true, "settlementId is required"],
      trim: true,
      index: true
    },
    entityId: {
      type: String,
      trim: true,
      index: true,
      default: null
    },
    merchantOrderId: {
      type: String,
      trim: true,
      index: true,
      default: null
    },
    grossAmountPaise: {
      type: Number,
      required: [true, "grossAmountPaise is required"],
      validate: {
        validator: isNonNegativeSafeInteger,
        message: "grossAmountPaise must be a non-negative safe integer"
      }
    },
    feePaise: {
      type: Number,
      default: 0,
      validate: {
        validator: isNonNegativeSafeInteger,
        message: "feePaise must be a non-negative safe integer"
      }
    },
    taxPaise: {
      type: Number,
      default: 0,
      validate: {
        validator: isNonNegativeSafeInteger,
        message: "taxPaise must be a non-negative safe integer"
      }
    },
    netAmountPaise: {
      type: Number,
      required: [true, "netAmountPaise is required"],
      validate: {
        validator: isSafeInteger,
        message: "netAmountPaise must be a valid safe integer"
      }
    },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      default: "INR"
    },
    settledAt: {
      type: Date,
      default: Date.now
    },
    utr: {
      type: String,
      trim: true,
      index: true,
      default: null
    },
    type: {
      type: String,
      required: true,
      enum: [
        "PAYMENT",
        "REFUND",
        "ADJUSTMENT",
        "TRANSFER",
        "FEE",
        "OTHER",
        "UNKNOWN"
      ],
      default: "PAYMENT"
    },
    source: {
      type: String,
      required: true,
      enum: ["SYNTHETIC", "CSV", "RAZORPAY", "BANK", "API"],
      default: "SYNTHETIC"
    },
    rawData: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    importBatchId: {
      type: String,
      trim: true,
      index: true,
      default: null
    }
  },
  {
    timestamps: true
  }
);

settlementRecordSchema.index({ settledAt: 1 });

export const SettlementRecord =
  mongoose.models.SettlementRecord ||
  mongoose.model("SettlementRecord", settlementRecordSchema);

export default SettlementRecord;
