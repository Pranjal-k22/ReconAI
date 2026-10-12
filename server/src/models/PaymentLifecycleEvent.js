import mongoose from "mongoose";
import {
  isNonNegativeSafeInteger,
  SUPPORTED_CURRENCIES,
  isValidCurrency
} from "./helpers/validators.js";

/**
 * ReconAI 2.0 - PaymentLifecycleEvent Domain Model
 *
 * Represents an append-only normalized evidence record of an event in the payment lifecycle.
 */

export const SOURCE_SYSTEMS = [
  "CUSTOMER_CLAIM",
  "MERCHANT_ORDER",
  "GATEWAY_WEBHOOK",
  "GATEWAY_API_POLL",
  "SETTLEMENT_RECON",
  "BANK_REPORT",
  "RECONAI_SYSTEM"
];

export const NORMALIZED_EVENT_TYPES = [
  "ORDER_CREATED",
  "ORDER_UPDATED",
  "ORDER_CANCELLED",
  "PAYMENT_INITIATED",
  "PAYMENT_AUTHORIZED",
  "PAYMENT_CAPTURED",
  "PAYMENT_FAILED",
  "PAYMENT_REFUNDED",
  "SETTLEMENT_BATCH_CREATED",
  "SETTLEMENT_PROCESSED",
  "SETTLEMENT_ADJUSTED",
  "CUSTOMER_DEBIT_CLAIM_SUBMITTED",
  "CUSTOMER_CLAIM_UPDATED",
  "DISPUTE_CREATED",
  "DISPUTE_UPDATED",
  "WEBHOOK_RECEIVED",
  "GATEWAY_STATUS_POLL_COMPLETED",
  "INCONSISTENCY_DETECTED",
  "SAFE_HOLD_APPLIED"
];

const paymentLifecycleEventSchema = new mongoose.Schema(
  {
    eventId: {
      type: String,
      required: [true, "eventId is required"],
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
    caseId: {
      type: String,
      trim: true,
      default: null,
      index: true
    },
    sourceSystem: {
      type: String,
      required: [true, "sourceSystem is required"],
      enum: SOURCE_SYSTEMS,
      index: true
    },
    sourceEventId: {
      type: String,
      trim: true,
      default: null
    },
    deduplicationKey: {
      type: String,
      required: [true, "deduplicationKey is required"],
      trim: true,
      unique: true,
      index: true
    },
    accountBodyHash: {
      type: String,
      trim: true,
      default: undefined,
      set: (v) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined)
    },
    normalizedEventType: {
      type: String,
      required: [true, "normalizedEventType is required"],
      enum: NORMALIZED_EVENT_TYPES,
      index: true
    },
    merchantOrderId: {
      type: String,
      trim: true,
      default: null,
      index: true
    },
    gatewayPaymentId: {
      type: String,
      trim: true,
      default: null,
      index: true
    },
    settlementId: {
      type: String,
      trim: true,
      default: null,
      index: true
    },
    refundId: {
      type: String,
      trim: true,
      default: null,
      index: true
    },
    amountPaise: {
      type: Number,
      default: null,
      validate: {
        validator: isNonNegativeSafeInteger,
        message: "amountPaise must be a non-negative safe integer or null"
      }
    },
    currency: {
      type: String,
      required: [true, "currency is required"],
      enum: {
        values: SUPPORTED_CURRENCIES,
        message: "currency '{VALUE}' is not supported. Supported: INR"
      },
      validate: {
        validator: isValidCurrency,
        message: "currency must be a valid 3-letter uppercase code from supported currencies (INR)"
      },
      default: "INR"
    },
    providerOccurredAt: {
      type: Date,
      default: null
    },
    sourceObservedAt: {
      type: Date,
      default: null
    },
    ingestedAt: {
      type: Date,
      default: Date.now,
      index: true
    },
    normalizedPayload: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    payloadFingerprint: {
      type: String,
      required: [true, "payloadFingerprint is required"],
      trim: true
    },
    schemaVersion: {
      type: String,
      default: "1.0.0"
    },
    provenance: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

paymentLifecycleEventSchema.index({ tenantId: 1, caseId: 1 });
paymentLifecycleEventSchema.index({ tenantId: 1, gatewayPaymentId: 1 });
paymentLifecycleEventSchema.index({ tenantId: 1, merchantOrderId: 1 });
paymentLifecycleEventSchema.index({ tenantId: 1, sourceSystem: 1, sourceEventId: 1 });
paymentLifecycleEventSchema.index(
  { accountBodyHash: 1 },
  {
    unique: true,
    partialFilterExpression: {
      accountBodyHash: {
        $type: "string",
        $gt: ""
      }
    }
  }
);

export const PaymentLifecycleEvent =
  mongoose.models.PaymentLifecycleEvent ||
  mongoose.model("PaymentLifecycleEvent", paymentLifecycleEventSchema);

export default PaymentLifecycleEvent;
