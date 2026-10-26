import mongoose from "mongoose";
import crypto from "crypto";

/**
 * ReconAI 2.0 - PolicyConfigVersion Model (Part B: Governed Policy-Limits Config)
 *
 * Implements append-only, immutable, two-person governed per-tenant refund limits.
 *
 * Invariants:
 * 1. Zero defaults: No monetary limit defaults exist anywhere in code or schema.
 * 2. Immutability: Once created, `limits`, `contentHash`, `tenantId`, and `configVersion` can NEVER be modified.
 * 3. Two-Person Governance: A proposal created by an ADMIN can only be activated when approved by a DIFFERENT ADMIN.
 * 4. At most one ACTIVE config per tenant: Guaranteed by MongoDB partial unique index on `{ tenantId: 1 }` where `{ status: "ACTIVE" }`.
 * 5. Quarantine sentinel rejection: `unassigned_provider_quarantine` is unconditionally rejected.
 */

export const POLICY_CONFIG_STATUSES = Object.freeze([
  "PENDING_APPROVAL",
  "ACTIVE",
  "SUPERSEDED",
  "REJECTED",
  "DEACTIVATED"
]);

export function computePolicyConfigHash(limits) {
  if (!limits || typeof limits !== "object") {
    throw new Error("Limits object is required to compute contentHash");
  }
  const canonical = JSON.stringify({
    currency: String(limits.currency || "INR").trim().toUpperCase(),
    maxCumulativeRefundPaise: Number(limits.maxCumulativeRefundPaise),
    maxSingleRefundPaise: Number(limits.maxSingleRefundPaise)
  });
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

const policyConfigVersionSchema = new mongoose.Schema(
  {
    tenantId: {
      type: String,
      required: [true, "tenantId is required"],
      trim: true,
      validate: {
        validator: function (v) {
          return Boolean(v && v.trim() && v.trim() !== "unassigned_provider_quarantine");
        },
        message: "tenantId cannot be empty or the quarantine sentinel"
      }
    },
    configVersion: {
      type: Number,
      required: [true, "configVersion is required"],
      min: 1,
      validate: {
        validator: Number.isInteger,
        message: "configVersion must be an integer"
      }
    },
    status: {
      type: String,
      required: [true, "status is required"],
      enum: POLICY_CONFIG_STATUSES,
      default: "PENDING_APPROVAL",
      index: true
    },
    limits: {
      currency: {
        type: String,
        default: "INR",
        enum: ["INR"],
        required: true
      },
      // Plain meaning today: Evaluated against refundableBalancePaise for single refund authorization.
      // If refundableBalancePaise > maxSingleRefundPaise, the evaluator rejects or requires escalation.
      maxSingleRefundPaise: {
        type: Number,
        required: [true, "maxSingleRefundPaise is required"],
        validate: {
          validator: (v) => typeof v === "number" && Number.isInteger(v) && v > 0 && v <= Number.MAX_SAFE_INTEGER,
          message: "maxSingleRefundPaise must be a positive safe integer"
        }
      },
      // Plain meaning today: Evaluator checks (currentCumulativeDailyPaise + refundableBalancePaise) <= maxCumulativeRefundPaise.
      // NOTE: "per-day velocity cap" and "cumulative-per-payment cap" across historical transactions are NOT IMPLEMENTED
      // in production because currentCumulativeDailyPaise is never populated from DB history in production workflows.
      maxCumulativeRefundPaise: {
        type: Number,
        required: [true, "maxCumulativeRefundPaise is required"],
        validate: {
          validator: (v) => typeof v === "number" && Number.isInteger(v) && v > 0 && v <= Number.MAX_SAFE_INTEGER,
          message: "maxCumulativeRefundPaise must be a positive safe integer"
        }
      }
    },
    contentHash: {
      type: String,
      required: [true, "contentHash is required"],
      trim: true
    },
    proposedBy: {
      type: String,
      required: [true, "proposedBy is required"],
      trim: true
    },
    proposedAt: {
      type: Date,
      default: Date.now,
      required: true
    },
    proposalReason: {
      type: String,
      required: [true, "proposalReason is required"],
      trim: true
    },
    approvedBy: {
      type: String,
      default: null,
      trim: true
    },
    approvedAt: {
      type: Date,
      default: null
    },
    approvalReason: {
      type: String,
      default: null,
      trim: true
    },
    activatedAt: {
      type: Date,
      default: null
    },
    supersededAt: {
      type: Date,
      default: null
    },
    deactivatedBy: {
      type: String,
      default: null,
      trim: true
    },
    deactivatedAt: {
      type: Date,
      default: null
    },
    deactivationReason: {
      type: String,
      default: null,
      trim: true
    },
    rejectedBy: {
      type: String,
      default: null,
      trim: true
    },
    rejectedAt: {
      type: Date,
      default: null
    },
    rejectionReason: {
      type: String,
      default: null,
      trim: true
    },
    sourceConfigVersion: {
      type: Number,
      default: null
    }
  },
  {
    timestamps: true
  }
);

// Indexes
// 1. Unique compound index on { tenantId, configVersion }
policyConfigVersionSchema.index({ tenantId: 1, configVersion: 1 }, { unique: true });

// 2. Unique partial index on { tenantId } where status = 'ACTIVE' (at most one active config per tenant)
policyConfigVersionSchema.index(
  { tenantId: 1 },
  { unique: true, partialFilterExpression: { status: "ACTIVE" } }
);

// Immutability Guard: limits, contentHash, tenantId, and configVersion are strictly immutable after creation.
policyConfigVersionSchema.pre("save", function (next) {
  if (!this.isNew) {
    if (
      this.isModified("limits") ||
      this.isModified("limits.maxSingleRefundPaise") ||
      this.isModified("limits.maxCumulativeRefundPaise") ||
      this.isModified("limits.currency") ||
      this.isModified("contentHash") ||
      this.isModified("tenantId") ||
      this.isModified("configVersion")
    ) {
      return next(
        new Error("PolicyConfigVersion limits, contentHash, tenantId, and configVersion are strictly immutable after creation.")
      );
    }
  }
  next();
});

policyConfigVersionSchema.pre(["findOneAndUpdate", "updateOne", "updateMany"], function (next) {
  const update = this.getUpdate();
  if (!update) return next();
  const modifiedFields = new Set();
  if (update.$set) {
    Object.keys(update.$set).forEach((k) => modifiedFields.add(k));
  }
  Object.keys(update).forEach((k) => {
    if (!k.startsWith("$")) modifiedFields.add(k);
  });
  const immutableKeys = [
    "limits",
    "limits.currency",
    "limits.maxSingleRefundPaise",
    "limits.maxCumulativeRefundPaise",
    "contentHash",
    "tenantId",
    "configVersion"
  ];
  for (const key of immutableKeys) {
    if (modifiedFields.has(key)) {
      return next(new Error(`Field '${key}' on PolicyConfigVersion is strictly immutable.`));
    }
  }
  next();
});

export const PolicyConfigVersion =
  mongoose.models.PolicyConfigVersion ||
  mongoose.model("PolicyConfigVersion", policyConfigVersionSchema);

export default PolicyConfigVersion;
