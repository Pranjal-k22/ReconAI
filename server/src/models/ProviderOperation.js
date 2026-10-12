import mongoose from "mongoose";
import {
  isNonNegativeSafeInteger,
  SUPPORTED_CURRENCIES,
  isValidCurrency,
  sanitizeMetadata
} from "./helpers/validators.js";

/**
 * ReconAI 2.0 - ProviderOperation Domain Model
 *
 * Persists durable provider mutation lifecycle records, idempotent dispatch guarantees,
 * and independent outcome verification states.
 *
 * Strict conservative lifecycle states:
 * - REQUESTED: durably recorded prior to dispatch
 * - OUTCOME_UNKNOWN: timeout, network abort, or ambiguous provider response
 * - VERIFIED_SUCCEEDED: authoritative GET read confirms successful execution (e.g. refund processed)
 * - VERIFIED_FAILED: authoritative GET read confirms terminal provider failure
 * - SAFE_HOLD: evidence conflict, ownership anomaly, or ambiguous verification
 */

export const PROVIDER_OPERATION_TYPES = Object.freeze(["REFUND", "STATUS_CHECK"]);

export const PROVIDER_OPERATION_STATUSES = Object.freeze([
  "REQUESTED",
  "OUTCOME_UNKNOWN",
  "VERIFIED_SUCCEEDED",
  "VERIFIED_FAILED",
  "SAFE_HOLD"
]);

const providerOperationSchema = new mongoose.Schema(
  {
    operationId: {
      type: String,
      required: [true, "operationId is required"],
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
      required: [true, "caseId is required"],
      trim: true,
      index: true
    },
    actionId: {
      type: String,
      trim: true,
      default: null
    },
    decisionId: {
      type: String,
      trim: true,
      default: null
    },
    idempotencyKey: {
      type: String,
      required: [true, "idempotencyKey is required"],
      trim: true
    },
    operationType: {
      type: String,
      required: [true, "operationType is required"],
      enum: PROVIDER_OPERATION_TYPES,
      default: "REFUND",
      index: true
    },
    operationStatus: {
      type: String,
      required: [true, "operationStatus is required"],
      enum: PROVIDER_OPERATION_STATUSES,
      default: "REQUESTED",
      index: true
    },
    gatewayPaymentId: {
      type: String,
      required: [true, "gatewayPaymentId is required"],
      trim: true,
      index: true
    },
    merchantOrderId: {
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
    provider: {
      type: String,
      required: [true, "provider is required"],
      default: "RAZORPAY",
      trim: true
    },
    providerOperationId: {
      type: String,
      trim: true,
      default: null,
      index: true
    },
    requestPayloadHash: {
      type: String,
      trim: true,
      default: null
    },
    policyVersion: {
      type: String,
      trim: true,
      default: null
    },
    providerResponseRaw: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      set: sanitizeMetadata
    },
    verificationEvidence: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
      set: sanitizeMetadata
    },
    verificationStatus: {
      type: String,
      trim: true,
      default: "PENDING"
    },
    failureReason: {
      type: String,
      maxlength: [256, "failureReason must not exceed 256 characters"],
      default: null
    },
    safeHoldReason: {
      type: String,
      maxlength: [256, "safeHoldReason must not exceed 256 characters"],
      default: null
    },
    requestedAt: {
      type: Date,
      default: Date.now,
      index: true
    },
    dispatchedAt: {
      type: Date,
      default: null
    },
    verifiedAt: {
      type: Date,
      default: null
    }
  },
  {
    timestamps: true
  }
);

providerOperationSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
providerOperationSchema.index({ tenantId: 1, caseId: 1 });
providerOperationSchema.index({ tenantId: 1, operationStatus: 1 });

export const ProviderOperation =
  mongoose.models.ProviderOperation ||
  mongoose.model("ProviderOperation", providerOperationSchema);

export default ProviderOperation;
