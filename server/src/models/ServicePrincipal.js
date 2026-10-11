import mongoose from "mongoose";
import crypto from "crypto";

/**
 * ReconAI 2.0 - ServicePrincipal Model
 *
 * Persists machine/service identities with scrypt credential hashes,
 * fixed service roles, tenant/customer scopes, and monotonic credential versions.
 * Prevents credential leakage and ensures persistent revocation/rotation across restarts.
 */

export const SERVICE_ROLES = Object.freeze([
  "CUSTOMER_AI",
  "SHOP_AI",
  "PAYMENT_CONTROLLER"
]);

const servicePrincipalSchema = new mongoose.Schema(
  {
    serviceId: {
      type: String,
      required: [true, "serviceId is required"],
      unique: true,
      trim: true,
      index: true
    },
    serviceRole: {
      type: String,
      required: [true, "serviceRole is required"],
      enum: {
        values: SERVICE_ROLES,
        message: "Invalid service role. Allowed: CUSTOMER_AI, SHOP_AI, PAYMENT_CONTROLLER"
      }
    },
    tenantId: {
      type: String,
      trim: true,
      default: null,
      index: true
    },
    customerId: {
      type: String,
      trim: true,
      default: null,
      index: true
    },
    scopes: {
      type: [String],
      default: []
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true
    },
    credentialVersion: {
      type: Number,
      default: 1
    },
    credentialHash: {
      type: String,
      required: [true, "credentialHash is required"]
    },
    credentialSalt: {
      type: String,
      required: [true, "credentialSalt is required"]
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

servicePrincipalSchema.index({ serviceId: 1, isActive: 1 });
servicePrincipalSchema.index({ tenantId: 1, serviceRole: 1 });

/**
 * Derives a cryptographic salt and scrypt hash for machine service credentials.
 */
export function hashServiceCredential(plaintext) {
  if (!plaintext || typeof plaintext !== "string" || plaintext.trim().length === 0) {
    throw new Error("Service credential cannot be empty");
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(plaintext.trim(), salt, 64);
  return {
    hash: derivedKey.toString("hex"),
    salt
  };
}

/**
 * Verifies plaintext service credential against stored hash using constant-time comparison.
 */
export function verifyServiceCredential(plaintext, hash, salt) {
  if (!plaintext || !hash || !salt) return false;
  try {
    const derivedKey = crypto.scryptSync(plaintext.trim(), salt, 64);
    const keyBuffer = Buffer.from(derivedKey.toString("hex"), "hex");
    const hashBuffer = Buffer.from(hash, "hex");
    if (keyBuffer.length !== hashBuffer.length) return false;
    return crypto.timingSafeEqual(keyBuffer, hashBuffer);
  } catch (err) {
    return false;
  }
}

export const ServicePrincipal =
  mongoose.models.ServicePrincipal || mongoose.model("ServicePrincipal", servicePrincipalSchema);
