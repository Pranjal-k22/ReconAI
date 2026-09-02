import mongoose from "mongoose";
import { isNonNegativeSafeInteger } from "./helpers/validators.js";

const merchantOrderSchema = new mongoose.Schema(
  {
    merchantOrderId: {
      type: String,
      required: [true, "merchantOrderId is required"],
      trim: true,
      unique: true,
      index: true
    },
    customerReference: {
      type: String,
      trim: true,
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
        "PENDING",
        "PAID",
        "PARTIALLY_PAID",
        "CANCELLED",
        "REFUNDED",
        "FAILED",
        "UNKNOWN"
      ],
      default: "CREATED"
    },
    source: {
      type: String,
      required: true,
      enum: ["SYNTHETIC", "CSV", "MERCHANT", "API"],
      default: "SYNTHETIC"
    },
    createdAtSource: {
      type: Date,
      default: Date.now
    },
    metadata: {
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

merchantOrderSchema.index({ status: 1 });
merchantOrderSchema.index({ createdAtSource: 1 });

export const MerchantOrder =
  mongoose.models.MerchantOrder ||
  mongoose.model("MerchantOrder", merchantOrderSchema);

export default MerchantOrder;
