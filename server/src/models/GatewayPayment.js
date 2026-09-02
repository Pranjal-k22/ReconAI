import mongoose from "mongoose";
import { isNonNegativeSafeInteger } from "./helpers/validators.js";

const gatewayPaymentSchema = new mongoose.Schema(
  {
    gatewayPaymentId: {
      type: String,
      required: [true, "gatewayPaymentId is required"],
      trim: true,
      unique: true,
      index: true
    },
    merchantOrderId: {
      type: String,
      trim: true,
      index: true,
      default: null
    },
    amountPaise: {
      type: Number,
      required: [true, "amountPaise is required"],
      validate: {
        validator: isNonNegativeSafeInteger,
        message: "amountPaise must be a non-negative safe integer"
      }
    },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      default: "INR"
    },
    status: {
      type: String,
      required: true,
      enum: [
        "CREATED",
        "AUTHORIZED",
        "CAPTURED",
        "FAILED",
        "REFUNDED",
        "PARTIALLY_REFUNDED",
        "UNKNOWN"
      ],
      default: "CAPTURED"
    },
    method: {
      type: String,
      required: true,
      enum: [
        "CARD",
        "UPI",
        "NETBANKING",
        "WALLET",
        "EMI",
        "BANK_TRANSFER",
        "OTHER",
        "UNKNOWN"
      ],
      default: "UPI"
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
    refundAmountPaise: {
      type: Number,
      default: 0,
      validate: {
        validator: isNonNegativeSafeInteger,
        message: "refundAmountPaise must be a non-negative safe integer"
      }
    },
    gatewayCreatedAt: {
      type: Date,
      default: Date.now
    },
    source: {
      type: String,
      required: true,
      enum: ["SYNTHETIC", "CSV", "RAZORPAY", "API"],
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

gatewayPaymentSchema.index({ status: 1 });
gatewayPaymentSchema.index({ gatewayCreatedAt: 1 });

export const GatewayPayment =
  mongoose.models.GatewayPayment ||
  mongoose.model("GatewayPayment", gatewayPaymentSchema);

export default GatewayPayment;
