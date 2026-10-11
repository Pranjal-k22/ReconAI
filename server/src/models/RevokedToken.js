import mongoose from "mongoose";

/**
 * ReconAI 2.0 - RevokedToken Model
 *
 * Persists invalidated JWT identifiers (JTI) across service restarts and distributed nodes.
 * Features a MongoDB TTL index ensuring automatic cleanup when token expiry passes.
 */

const revokedTokenSchema = new mongoose.Schema(
  {
    jti: {
      type: String,
      required: [true, "jti is required"],
      unique: true,
      trim: true,
      index: true
    },
    expiresAt: {
      type: Date,
      required: [true, "expiresAt is required"]
    },
    reason: {
      type: String,
      default: "LOGOUT"
    },
    revokedAt: {
      type: Date,
      default: Date.now
    }
  },
  {
    timestamps: true
  }
);

// TTL index to automatically purge documents when expiresAt is reached
revokedTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RevokedToken =
  mongoose.models.RevokedToken ||
  mongoose.model("RevokedToken", revokedTokenSchema);

export default RevokedToken;
