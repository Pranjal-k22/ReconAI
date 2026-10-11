import mongoose from "mongoose";
import { isNonNegativeSafeInteger } from "./helpers/validators.js";

/**
 * ReconAI 2.0 - PaymentCase Domain Model
 *
 * Represents a durable investigation and resolution case across the 8 canonical
 * orthogonal payment lifecycle dimensions:
 * 1. Order state
 * 2. Customer debit state
 * 3. Authorization state
 * 4. Capture state
 * 5. Settlement state
 * 6. Refund state
 * 7. Dispute state
 * 8. Resolution-case state
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
export const ORDER_STATUSES = ORDER_STATES;

export const CUSTOMER_DEBIT_STATES = [
  "DEBIT_NONE",
  "DEBIT_REPORTED",
  "DEBIT_VERIFIED",
  "DEBIT_REVERSED",
  "UNKNOWN"
];
export const CUSTOMER_DEBIT_STATUSES = CUSTOMER_DEBIT_STATES;

export const AUTHORIZATION_STATES = [
  "AUTH_NONE",
  "AUTH_PENDING",
  "AUTH_AUTHORIZED",
  "AUTH_EXPIRED",
  "AUTH_VOIDED",
  "UNKNOWN"
];
export const AUTHORIZATION_STATUSES = AUTHORIZATION_STATES;

export const CAPTURE_STATES = [
  "CAPTURE_NONE",
  "CAPTURE_CAPTURED",
  "CAPTURE_PARTIALLY_CAPTURED",
  "CAPTURE_FAILED",
  "UNKNOWN"
];
export const CAPTURE_STATUSES = CAPTURE_STATES;

export const SETTLEMENT_STATES = [
  "SETTLEMENT_NONE",
  "SETTLEMENT_PENDING",
  "SETTLEMENT_SETTLED",
  "SETTLEMENT_ADJUSTED",
  "UNKNOWN"
];
export const SETTLEMENT_STATUSES = SETTLEMENT_STATES;

export const REFUND_STATES = [
  "REFUND_NONE",
  "REFUND_ELIGIBLE",
  "REFUND_INITIATED",
  "REFUND_PENDING",
  "REFUND_CONFIRMED",
  "REFUND_FAILED",
  "UNKNOWN"
];
export const REFUND_STATUSES = REFUND_STATES;

export const DISPUTE_STATES = [
  "DISPUTE_NONE",
  "DISPUTE_INQUIRY",
  "DISPUTE_FORMAL_CHARGEBACK",
  "DISPUTE_UNDER_REVIEW",
  "DISPUTE_WON",
  "DISPUTE_LOST",
  "UNKNOWN"
];
export const DISPUTE_STATUSES = DISPUTE_STATES;

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
export const RESOLUTION_CASE_STATUSES = RESOLUTION_CASE_STATES;

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
    // Canonical Dimension 1: Merchant Order State
    orderStatus: {
      type: String,
      required: true,
      enum: ORDER_STATUSES,
      default: "UNKNOWN",
      alias: "orderState"
    },
    // Canonical Dimension 2: Customer Debit Claim State
    customerDebitStatus: {
      type: String,
      required: true,
      enum: CUSTOMER_DEBIT_STATUSES,
      default: "DEBIT_NONE",
      alias: "customerDebitState"
    },
    // Canonical Dimension 3: Gateway Authorization State
    authorizationStatus: {
      type: String,
      required: true,
      enum: AUTHORIZATION_STATUSES,
      default: "AUTH_NONE",
      alias: "authorizationState"
    },
    // Canonical Dimension 4: Gateway Capture State
    captureStatus: {
      type: String,
      required: true,
      enum: CAPTURE_STATUSES,
      default: "CAPTURE_NONE",
      alias: "captureState"
    },
    // Canonical Dimension 5: Settlement State
    settlementStatus: {
      type: String,
      required: true,
      enum: SETTLEMENT_STATUSES,
      default: "SETTLEMENT_NONE",
      alias: "settlementState"
    },
    // Canonical Dimension 6: Refund State
    refundStatus: {
      type: String,
      required: true,
      enum: REFUND_STATUSES,
      default: "REFUND_NONE",
      alias: "refundState"
    },
    // Canonical Dimension 7: Dispute / Chargeback State
    disputeStatus: {
      type: String,
      required: true,
      enum: DISPUTE_STATUSES,
      default: "DISPUTE_NONE",
      alias: "disputeState"
    },
    // Canonical Dimension 8: Case Resolution State
    resolutionCaseStatus: {
      type: String,
      required: true,
      enum: RESOLUTION_CASE_STATUSES,
      default: "CASE_DETECTED",
      index: true,
      alias: "resolutionCaseState"
    },
    // Auxiliary Dimensions (optional supplementary fields)
    reversalStatus: {
      type: String,
      default: null
    },
    reconStatus: {
      type: String,
      default: null
    },
    investigationStatus: {
      type: String,
      default: null
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

paymentCaseSchema.index({ tenantId: 1, caseId: 1 });
paymentCaseSchema.index({ tenantId: 1, resolutionCaseStatus: 1 });
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
