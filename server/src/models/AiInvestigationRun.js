import mongoose from "mongoose";

/**
 * ReconAI 2.0 - AiInvestigationRun Domain Model
 *
 * Represents an immutable, tenant-scoped record of a controller-mediated
 * multi-agent investigation run across CUSTOMER_AI, SHOP_AI, INVESTIGATOR_AI,
 * and RESOLUTION_PLANNER_AI.
 *
 * INVARIANT: AI outputs are strictly advisory, non-authoritative, and non-executable.
 */

export const AI_INVESTIGATION_STATUSES = [
  "COMPLETED",
  "INSUFFICIENT_EVIDENCE",
  "SAFE_HOLD_REQUIRED",
  "CONTRADICTION_UNRESOLVED",
  "FALLBACK",
  "FAILED"
];

const aiInvestigationRunSchema = new mongoose.Schema(
  {
    investigationId: {
      type: String,
      required: [true, "investigationId is required"],
      unique: true,
      trim: true,
      index: true
    },
    caseId: {
      type: String,
      required: [true, "caseId is required"],
      trim: true,
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
    idempotencyKey: {
      type: String,
      trim: true,
      default: null
    },
    status: {
      type: String,
      required: true,
      enum: AI_INVESTIGATION_STATUSES,
      default: "COMPLETED",
      index: true
    },
    evidenceCards: {
      type: [mongoose.Schema.Types.Mixed],
      default: []
    },
    customerPerspective: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    shopPerspective: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    investigatorFindings: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    resolutionProposal: {
      type: mongoose.Schema.Types.Mixed,
      default: null
    },
    modelUsed: {
      type: String,
      trim: true,
      default: "FALLBACK_DETERMINISTIC"
    },
    durationMs: {
      type: Number,
      default: 0
    },
    fallbackReason: {
      type: String,
      trim: true,
      default: null
    },
    isExecutable: {
      type: Boolean,
      default: false
    },
    authoritative: {
      type: Boolean,
      default: false
    },
    requiresPolicyEngine: {
      type: Boolean,
      default: true
    },
    redactedMetadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    }
  },
  {
    timestamps: true
  }
);

aiInvestigationRunSchema.index({ tenantId: 1, caseId: 1 });
aiInvestigationRunSchema.index(
  { tenantId: 1, idempotencyKey: 1 },
  { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } }
);

export const AiInvestigationRun =
  mongoose.models.AiInvestigationRun ||
  mongoose.model("AiInvestigationRun", aiInvestigationRunSchema);

export default AiInvestigationRun;
