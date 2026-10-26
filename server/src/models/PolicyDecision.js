import mongoose from "mongoose";
import {
  isNonNegativeSafeInteger,
  SUPPORTED_CURRENCIES,
  isValidCurrency,
  sanitizeMetadata
} from "./helpers/validators.js";
import { APPROVED_DRY_RUN_ACTION_TYPES, ACTION_TYPES } from "./PaymentAction.js";

/**
 * ReconAI 2.0 - PolicyDecision Domain Model
 *
 * Durable, append-only record of deterministic resolution policy evaluations.
 * Scoped to tenant, enforces unique idempotency keys, records rule IDs,
 * explicit allow/deny rationale, and simulated dry-run results.
 * Strictly non-executable: executionState is permanently NON_EXECUTABLE_SIMULATION.
 */

export const POLICY_OUTCOME_STATUSES = Object.freeze([
  "ELIGIBLE_FOR_SIMULATION",
  "PROPOSAL_ONLY",
  "REJECTED_BY_POLICY",
  "SAFE_HOLD",
  "INSUFFICIENT_EVIDENCE"
]);

const policyDecisionSchema = new mongoose.Schema(
  {
    decisionId: {
      type: String,
      required: [true, "decisionId is required"],
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
    gatewayPaymentId: {
      type: String,
      trim: true,
      default: null
    },
    merchantOrderId: {
      type: String,
      trim: true,
      default: null
    },
    idempotencyKey: {
      type: String,
      required: [true, "idempotencyKey is required"],
      trim: true
    },
    inputHash: {
      type: String,
      required: [true, "inputHash is required"],
      trim: true
    },
    policyVersion: {
      type: String,
      required: [true, "policyVersion is required"],
      default: "2026-10-12.v1",
      trim: true
    },
    policyConfigVersion: {
      type: Number,
      default: null
    },
    contentHash: {
      type: String,
      default: null,
      trim: true
    },
    classificationRecordId: {
      type: String,
      trim: true,
      default: null,
      index: true
    },
    classificationInputHash: {
      type: String,
      trim: true,
      default: null,
      index: true
    },
    proposedActionType: {
      type: String,
      required: [true, "proposedActionType is required"],
      enum: ACTION_TYPES,
      index: true
    },
    outcomeStatus: {
      type: String,
      required: [true, "outcomeStatus is required"],
      enum: POLICY_OUTCOME_STATUSES,
      index: true
    },
    appliedRuleIds: {
      type: [String],
      default: []
    },
    decisionReasons: {
      type: [String],
      default: []
    },
    allowReasons: {
      type: [String],
      default: []
    },
    denyReasons: {
      type: [String],
      default: []
    },
    missingEvidence: {
      type: [String],
      default: []
    },
    conflicts: {
      type: [String],
      default: []
    },
    approvedEvidenceReferences: {
      type: [String],
      default: []
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
        message: "currency must be a valid 3-letter uppercase code (INR)"
      },
      default: "INR"
    },
    actionId: {
      type: String,
      trim: true,
      default: null
    },
    simulationResult: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    checksPerformed: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    isExecutable: {
      type: Boolean,
      default: false,
      immutable: true
    },
    authoritative: {
      type: Boolean,
      default: false,
      immutable: true
    },
    executionState: {
      type: String,
      default: "NON_EXECUTABLE_SIMULATION",
      immutable: true
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

policyDecisionSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
policyDecisionSchema.index({ tenantId: 1, caseId: 1 });
policyDecisionSchema.index({ tenantId: 1, outcomeStatus: 1 });

export const PolicyDecision =
  mongoose.models.PolicyDecision ||
  mongoose.model("PolicyDecision", policyDecisionSchema);

export default PolicyDecision;
