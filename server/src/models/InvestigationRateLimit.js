import mongoose from "mongoose";

/**
 * ReconAI 2.0 - InvestigationRateLimit Domain Model
 *
 * Enforces server-side cost guardrails on LLM investigation calls.
 * Backed by persistent MongoDB storage with TTL index.
 * Stores counters for ADMIN_HOURLY, ADMIN_DAILY, TENANT_HOURLY, and TENANT_DAILY windows.
 */

export const RATE_LIMIT_SCOPES = Object.freeze([
  "ADMIN_HOURLY",
  "ADMIN_DAILY",
  "TENANT_HOURLY",
  "TENANT_DAILY"
]);

const investigationRateLimitSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: [true, "key is required"],
      unique: true,
      trim: true,
      index: true
    },
    scope: {
      type: String,
      required: [true, "scope is required"],
      enum: {
        values: RATE_LIMIT_SCOPES,
        message: "Invalid rate limit scope"
      }
    },
    adminId: {
      type: String,
      default: null,
      trim: true,
      index: true
    },
    tenantId: {
      type: String,
      default: null,
      trim: true,
      index: true
    },
    count: {
      type: Number,
      required: true,
      default: 1,
      min: 1
    },
    expiresAt: {
      type: Date,
      required: true
    }
  },
  {
    timestamps: true,
    versionKey: false,
    collection: "investigationratelimits"
  }
);

investigationRateLimitSchema.index({ key: 1 }, { unique: true });
investigationRateLimitSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
investigationRateLimitSchema.index({ scope: 1, adminId: 1, createdAt: -1 });
investigationRateLimitSchema.index({ scope: 1, tenantId: 1, createdAt: -1 });

export const InvestigationRateLimit =
  mongoose.models.InvestigationRateLimit ||
  mongoose.model("InvestigationRateLimit", investigationRateLimitSchema);

export default InvestigationRateLimit;

