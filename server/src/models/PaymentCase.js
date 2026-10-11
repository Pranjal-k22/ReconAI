import mongoose from "mongoose";
import { isNonNegativeSafeInteger } from "./helpers/validators.js";

/**
 * ReconAI 2.0 - PaymentCase Domain Model
 *
 * Represents a durable investigation and resolution case across the 8-dimensional
 * payment lifecycle state machine.
 */

export const ORDER_STATES = [
  "ORDER_CREATED",
  "ORDER_PENDING",
  "ORDER_PAID",
  "ORDER_PARTIALLY_PAID",
  "ORDER_CANCELLED",
  "ORDER_FULFILLED",
  "UNKNOWN"
];

export const CUSTOMER_DEBIT_STATES = [
  "DEBIT_NONE",
  "DEBIT_REPORTED",
  "DEBIT_VERIFIED",
  "DEBIT_REVERSED",
  "UNKNOWN"
];

export const AUTHORIZATION_STATES = [
  "AUTH_NONE",
  "AUTH_PENDING",
  "AUTH_AUTHORIZED",
  "AUTH_EXPIRED",
  "AUTH_VOIDED",
  "UNKNOWN"
];

export const CAPTURE_STATES = [
  "CAPTURE_NONE",
  "CAPTURE_CAPTURED",
  "CAPTURE_PARTIALLY_CAPTURED",
  "CAPTURE_FAILED",
  "UNKNOWN"
];

export const SETTLEMENT_STATES = [
  "SETTLEMENT_NONE",
  "SETTLEMENT_PENDING",
  "SETTLEMENT_SETTLED",
  "SETTLEMENT_ADJUSTED",
  "UNKNOWN"
];

export const REFUND_STATES = [
  "REFUND_NONE",
  "REFUND_ELIGIBLE",
  "REFUND_INITIATED",
  "REFUND_PENDING",
  "REFUND_CONFIRMED",
  "REFUND_FAILED",
  "UNKNOWN"
];

export const DISPUTE_STATES = [
  "DISPUTE_NONE",
  "DISPUTE_INQUIRY",
  "DISPUTE_FORMAL_CHARGEBACK",
  "DISPUTE_UNDER_REVIEW",
  "DISPUTE_WON",
  "DISPUTE_LOST",
  "UNKNOWN"
];

export const RESOLUTION_CASE_STATES = [
  "CASE_DETECTED",
  "CASE_INVESTIGATING",
  "CASE_PENDING_POLICY",
  "CASE_ACTION_IN_PROGRESS",
  "CASE_VERIFYING_OUTCOME",
  "CASE_RESOLVED",
  "CASE_SAFE_HOLD",
  "CASE_EXTERNAL_ESCALATION"
];

export const DISCREPANCY_CATEGORIES = [
  "FRONTEND_DROPPED_AFTER_SUCCESS",
  "CUSTOMER_DEBIT_ON_GATEWAY_FAILURE",
  "LATE_AUTHORIZATION",
  "DELAYED_SETTLEMENT",
  "STATUS_MISMATCH",
  "DUPLICATE_PAYMENT",
  "PARTIAL_CAPTURE",
  "PARTIAL_PAYMENT",
  "PARTIAL_REFUND",
  "REFUND_PENDING_TIMEOUT",
  "REFUND_FAILED",
  "STALE_EVENT_DELIVERY",
  "LOST_WEBHOOK",
  "CONFLICTING_PROVIDER_MERCHANT_RECORDS",
  "AMOUNT_CURRENCY_MISMATCH",
  "DUPLICATE_SETTLEMENT",
  "MISSING_SETTLEMENT",
  "CANCELLED_ORDER_CAPTURED",
  "AMBIGUOUS_CANDIDATE_MATCH",
  "PROVIDER_UNAVAILABLE",
  "DATABASE_OUTAGE_RECOVERY",
  "WORKER_LEASE_EXPIRED",
  "CONCURRENT_ATTEMPT",
  "CROSS_TENANT_BLOCKED",
  "FRAUD_CLAIM",
  "FORMAL_DISPUTE",
  "GENERAL_EXCEPTION"
];

export const SAFE_HOLD_CODES = [
  "PROVISIONAL_REFUND_LIMIT_REQUIRED",
  "UNVERIFIED_DEBIT_CLAIM",
  "LATE_CAPTURE_CANCELLED_ORDER",
  "FRAUD_SUSPICION",
  "FORMAL_DISPUTE",
  "AMBIGUOUS_PAYMENTS",
  "POLICY_REJECTED",
  "PROVIDER_ERROR",
  "ADMIN_HOLD",
  "NONE"
];

const paymentCaseSchema = new mongoose.Schema(
  {
    caseId: {
      type: String,
      required: [true, "caseId is required"],
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
    customerId: {
      type: String,
      trim: true,
      default: null,
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
    discrepancyCategory: {
      type: String,
      required: [true, "discrepancyCategory is required"],
      enum: DISCREPANCY_CATEGORIES,
      index: true
    },
    // Dimension 1: Merchant Order State
    orderState: {
      type: String,
      required: true,
      enum: ORDER_STATES,
      default: "UNKNOWN"
    },
    // Dimension 2: Customer Debit Claim State
    customerDebitState: {
      type: String,
      required: true,
      enum: CUSTOMER_DEBIT_STATES,
      default: "DEBIT_NONE"
    },
    // Dimension 3: Gateway Authorization State
    authorizationState: {
      type: String,
      required: true,
      enum: AUTHORIZATION_STATES,
      default: "AUTH_NONE"
    },
    // Dimension 4: Gateway Capture State
    captureState: {
      type: String,
      required: true,
      enum: CAPTURE_STATES,
      default: "CAPTURE_NONE"
    },
    // Dimension 5: Settlement State
    settlementState: {
      type: String,
      required: true,
      enum: SETTLEMENT_STATES,
      default: "SETTLEMENT_NONE"
    },
    // Dimension 6: Refund State
    refundState: {
      type: String,
      required: true,
      enum: REFUND_STATES,
      default: "REFUND_NONE"
    },
    // Dimension 7: Dispute / Chargeback State
    disputeState: {
      type: String,
      required: true,
      enum: DISPUTE_STATES,
      default: "DISPUTE_NONE"
    },
    // Dimension 8: Case Resolution State
    resolutionCaseState: {
      type: String,
      required: true,
      enum: RESOLUTION_CASE_STATES,
      default: "CASE_DETECTED",
      index: true
    },
    // Monetary integer paise
    expectedAmountPaise: {
      type: Number,
      default: null,
      validate: {
        validator: isNonNegativeSafeInteger,
        message: "expectedAmountPaise must be a non-negative safe integer or null"
      }
    },
    actualAmountPaise: {
      type: Number,
      default: null,
      validate: {
        validator: isNonNegativeSafeInteger,
        message: "actualAmountPaise must be a non-negative safe integer or null"
      }
    },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      default: "INR"
    },
    // Safe-Hold explicit flags
    isSafeHold: {
      type: Boolean,
      default: false,
      index: true
    },
    safeHoldCode: {
      type: String,
      enum: SAFE_HOLD_CODES,
      default: "NONE"
    },
    safeHoldReason: {
      type: String,
      default: null
    },
    // Correlation & Deduplication metadata
    correlationKey: {
      type: String,
      trim: true,
      default: null
    },
    actionLeaseExpiresAt: {
      type: Date,
      default: null
    },
    detectedAt: {
      type: Date,
      default: Date.now,
      index: true
    },
    resolvedAt: {
      type: Date,
      default: null
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

// Compound indexes for tenant-scoped querying and deduplication
paymentCaseSchema.index({ tenantId: 1, caseId: 1 });
paymentCaseSchema.index({ tenantId: 1, resolutionCaseState: 1 });
paymentCaseSchema.index({ tenantId: 1, isSafeHold: 1 });
paymentCaseSchema.index(
  { tenantId: 1, correlationKey: 1 },
  {
    unique: true,
    partialFilterExpression: { correlationKey: { $type: "string" } }
  }
);

export const PaymentCase =
  mongoose.models.PaymentCase ||
  mongoose.model("PaymentCase", paymentCaseSchema);

export default PaymentCase;
