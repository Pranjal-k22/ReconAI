import mongoose from "mongoose";
import { isNonNegativeSafeInteger } from "./helpers/validators.js";

/**
 * ReconAI 2.0 - RefundReservation Domain Model
 *
 * Persists atomic refund reservation records guarding against duplicate sends
 * or concurrent dispatches exceeding the refundable balance.
 */

export const RESERVATION_STATUSES = Object.freeze(["RESERVED", "CONVERTED", "RELEASED"]);

const refundReservationSchema = new mongoose.Schema(
  {
    reservationId: {
      type: String,
      required: [true, "reservationId is required"],
      trim: true,
      unique: true,
      index: true
    },
    tenantId: {
      type: String,
      required: [true, "tenantId is required"],
      trim: true,
      index: true
    },
    gatewayPaymentId: {
      type: String,
      required: [true, "gatewayPaymentId is required"],
      trim: true,
      index: true
    },
    idempotencyKey: {
      type: String,
      required: [true, "idempotencyKey is required"],
      trim: true
    },
    amountPaise: {
      type: Number,
      required: [true, "amountPaise is required"],
      validate: {
        validator: isNonNegativeSafeInteger,
        message: "amountPaise must be a non-negative safe integer"
      }
    },
    status: {
      type: String,
      enum: RESERVATION_STATUSES,
      default: "RESERVED",
      index: true
    },
    expiresAt: {
      type: Date,
      default: null,
      index: true
    },
    releaseReason: {
      type: String,
      default: null
    }
  },
  {
    timestamps: true
  }
);

refundReservationSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
refundReservationSchema.index({ tenantId: 1, gatewayPaymentId: 1, status: 1 });

export const RefundReservation =
  mongoose.models.RefundReservation ||
  mongoose.model("RefundReservation", refundReservationSchema);

export default RefundReservation;
