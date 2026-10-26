import mongoose from "mongoose";
import { sanitizeMetadata } from "./helpers/validators.js";
import { SAFE_HOLD_CODES, DISCREPANCY_CATEGORIES } from "./PaymentCase.js";

/**
 * ReconAI 2.0 - EvidenceRecord Domain Model
 *
 * Persisted, schema-validated record of deterministic classification and evidence collection
 * for the 30 payment lifecycle edge cases. Separates authoritative provider facts from
 * unverified customer claims, identifies safe holds, and provides an explainable audit trail.
 */

export const SCENARIO_IDS = [
  "CASE_1_FRONTEND_TIMEOUT_PAYMENT_SUCCESS",
  "CASE_2_CUSTOMER_DEBIT_CLAIM_GATEWAY_PENDING",
  "CASE_3_CUSTOMER_DEBIT_CLAIM_PAYMENT_FAILED",
  "CASE_4_LATE_AUTHORIZATION_AFTER_TIMEOUT",
  "CASE_5_CAPTURED_PAYMENT_DELAYED_SETTLEMENT",
  "CASE_6_PAID_GATEWAY_UNPAID_ORDER",
  "CASE_7_DUPLICATE_PAYMENT_ATTEMPTS",
  "CASE_8_PARTIAL_CAPTURE",
  "CASE_9_PARTIAL_PAYMENT",
  "CASE_10_PARTIAL_REFUND",
  "CASE_11_FULL_REFUND_INITIATED_NOT_COMPLETED",
  "CASE_12_FAILED_REFUND",
  "CASE_13_STALE_EVENT_AFTER_REFUND",
  "CASE_14_DUPLICATE_WEBHOOK_DELIVERY",
  "CASE_15_FORGED_WEBHOOK",
  "CASE_16_OUT_OF_ORDER_WEBHOOK",
  "CASE_17_LOST_WEBHOOK",
  "CASE_18_CONFLICTING_PROVIDER_MERCHANT_RECORDS",
  "CASE_19_AMOUNT_OR_CURRENCY_MISMATCH",
  "CASE_20_DUPLICATE_SETTLEMENT_RECORD",
  "CASE_21_MISSING_SETTLEMENT_RECORD",
  "CASE_22_PAYMENT_CAPTURED_ORDER_CANCELLED",
  "CASE_23_AMBIGUOUS_PAYMENT_CANDIDATES",
  "CASE_24_PROVIDER_UNAVAILABLE_RATE_LIMITED",
  "CASE_25_DATABASE_OUTAGE_DURING_ACTION",
  "CASE_26_WORKER_CRASH_ACTION_PENDING",
  "CASE_27_CONCURRENT_RESOLUTION_ATTEMPTS",
  "CASE_28_CROSS_TENANT_ACCESS_ATTEMPT",
  "CASE_29_FRAUD_ALLEGATION_UNAUTHORIZED_PAYMENT",
  "CASE_30_CHARGEBACK_OR_FORMAL_DISPUTE",
  "UNKNOWN_SCENARIO"
];

export const EVIDENCE_AUTHORITIES = [
  "PROVIDER_VERIFIED",
  "CUSTOMER_CLAIM",
  "SHOP_STATEMENT",
  "SETTLEMENT_BATCH",
  "SYSTEM_RECORD",
  "BANK_STATEMENT",
  "UNKNOWN_AUTHORITY"
];

const factItemSchema = new mongoose.Schema(
  {
    dimension: { type: String, required: true },
    value: { type: String, required: true },
    source: { type: String, required: true },
    authority: { type: String, required: true, enum: EVIDENCE_AUTHORITIES },
    verifiedAt: { type: Date, default: Date.now },
    evidenceRef: { type: String, default: null }
  },
  { _id: false }
);

const claimItemSchema = new mongoose.Schema(
  {
    claimType: { type: String, required: true },
    claimedValue: { type: mongoose.Schema.Types.Mixed, default: null },
    source: { type: String, required: true },
    authority: { type: String, required: true, enum: EVIDENCE_AUTHORITIES },
    receivedAt: { type: Date, default: Date.now },
    evidenceRef: { type: String, default: null },
    verified: { type: Boolean, default: false }
  },
  { _id: false }
);

const supportingEvidenceSchema = new mongoose.Schema(
  {
    sourceSystem: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: String, default: null },
    eventId: { type: String, default: null },
    timestamp: { type: Date, default: Date.now }
  },
  { _id: false }
);

const evidenceRecordSchema = new mongoose.Schema(
  {
    recordId: {
      type: String,
      required: [true, "recordId is required"],
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
    scenarioId: {
      type: String,
      required: [true, "scenarioId is required"],
      enum: SCENARIO_IDS,
      index: true
    },
    category: {
      type: String,
      required: [true, "category is required"],
      enum: DISCREPANCY_CATEGORIES,
      index: true
    },
    reasonCode: {
      type: String,
      required: [true, "reasonCode is required"],
      trim: true,
      index: true
    },
    ruleId: {
      type: String,
      required: [true, "ruleId is required"],
      trim: true,
      index: true
    },
    confidence: {
      type: Number,
      required: true,
      min: 0,
      max: 1
    },
    facts: [factItemSchema],
    claims: [claimItemSchema],
    contradictions: [{ type: String }],
    missingEvidence: [{ type: String }],
    safeHold: {
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
      maxlength: [256, "safeHoldReason must not exceed 256 characters"],
      default: null
    },
    recommendation: {
      type: String,
      required: [true, "recommendation is required"],
      trim: true
    },
    suggestedNextStep: {
      type: String,
      default: "ADVISORY_HOLD_FOR_REVIEW"
    },
    evaluationKey: {
      type: String,
      trim: true,
      default: null
    },
    inputHash: {
      type: String,
      trim: true,
      default: null,
      index: true
    },
    provenance: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    supportingEvidence: [supportingEvidenceSchema],
    explanation: {
      type: String,
      required: [true, "explanation is required"],
      trim: true
    },
    redactedMetadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
      set: sanitizeMetadata
    },
    evaluatedAt: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  {
    timestamps: true
  }
);

evidenceRecordSchema.index({ tenantId: 1, recordId: 1 });
evidenceRecordSchema.index({ tenantId: 1, scenarioId: 1 });
evidenceRecordSchema.index(
  { tenantId: 1, evaluationKey: 1 },
  {
    unique: true,
    partialFilterExpression: { evaluationKey: { $type: "string" } }
  }
);

export const EvidenceRecord =
  mongoose.models.EvidenceRecord ||
  mongoose.model("EvidenceRecord", evidenceRecordSchema);

export default EvidenceRecord;
