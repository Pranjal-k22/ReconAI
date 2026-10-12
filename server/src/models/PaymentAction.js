import mongoose from "mongoose";
import {
  isNonNegativeSafeInteger,
  SUPPORTED_CURRENCIES,
  isValidCurrency,
  sanitizeMetadata
} from "./helpers/validators.js";

/**
 * ReconAI 2.0 - PaymentAction Domain Model (Action Ledger)
 *
 * Represents an idempotent record of an intended or simulated resolution action.
 * Enforces strict Phase 2 non-executing status allowlist, scoped idempotency,
 * and integer paise monetary fields.
 */

export const APPROVED_DRY_RUN_ACTION_TYPES = Object.freeze([
  "WAIT_AND_MONITOR",
  "RECHECK_PROVIDER_STATUS",
  "UPDATE_MERCHANT_LOCAL_LEDGER",
  "REQUEST_REFUND",
  "SAFE_HOLD",
  "NOTIFY_PARTIES",
  "EXTERNAL_ESCALATION_REQUIRED"
]);

export const ACTION_TYPES = [
  ...APPROVED_DRY_RUN_ACTION_TYPES,
  "POLL_PROVIDER_STATUS",
  "SIMULATE_REFUND_CUSTOMER",
  "EXECUTE_PROVIDER_REFUND",
  "VOID_AUTHORIZATION",
  "CAPTURE_AUTHORIZED_PAYMENT",
  "LOCK_SAFE_HOLD",
  "ESCALATE_EXTERNAL_DISPUTE"
];

/**
 * Canonical Phase 2 Action Statuses.
 * Phase 2 is strictly a storage and intent-recording phase.
 * It does not authorize or execute live financial transactions.
 * Execution-ready and execution-confirmed statuses are prohibited.
 */
export const ACTION_STATUSES = [
  "PROPOSED",
  "SIMULATED",
  "REJECTED_BY_POLICY",
  "HELD_IN_SAFE_HOLD"
];

export const PHASE_2_ACTION_STATUSES = ACTION_STATUSES;

export const INITIATING_ACTOR_TYPES = [
  "AI_PLANNER",
  "SYSTEM_MONITOR",
  "HUMAN_ADMIN",
  "POLICY_ENGINE"
];

const paymentActionSchema = new mongoose.Schema(
  {
    actionId: {
      type: String,
      required: [true, "actionId is required"],
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
    actionType: {
      type: String,
      required: [true, "actionType is required"],
      enum: ACTION_TYPES,
      index: true
    },
    actionStatus: {
      type: String,
      required: [true, "actionStatus is required"],
      enum: ACTION_STATUSES,
      default: "PROPOSED",
      index: true
    },
    idempotencyKey: {
      type: String,
      required: [true, "idempotencyKey is required"],
      trim: true
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
    initiatedByActorType: {
      type: String,
      required: [true, "initiatedByActorType is required"],
      enum: INITIATING_ACTOR_TYPES
    },
    initiatedByActorId: {
      type: String,
      required: [true, "initiatedByActorId is required"],
      trim: true,
      maxlength: [64, "initiatedByActorId must not exceed 64 characters"]
    },
    reasonCode: {
      type: String,
      required: [true, "reasonCode is required"],
      trim: true,
      maxlength: [64, "reasonCode must not exceed 64 characters"]
    },
    evidenceReferences: {
      type: [String],
      default: []
    },
    policyEvaluationResult: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    proposedAt: {
      type: Date,
      default: Date.now,
      index: true
    },
    decidedAt: {
      type: Date,
      default: null
    },
    executedAt: {
      type: Date,
      default: null
    },
    verifiedAt: {
      type: Date,
      default: null
    },
    providerReferenceId: {
      type: String,
      trim: true,
      default: null
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
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
      set: sanitizeMetadata
    }
  },
  {
    timestamps: true
  }
);

paymentActionSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
paymentActionSchema.index({ tenantId: 1, caseId: 1 });
paymentActionSchema.index({ tenantId: 1, actionStatus: 1 });

export const PaymentAction =
  mongoose.models.PaymentAction ||
  mongoose.model("PaymentAction", paymentActionSchema);

export default PaymentAction;
