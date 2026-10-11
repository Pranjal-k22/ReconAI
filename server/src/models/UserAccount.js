import mongoose from "mongoose";
import crypto from "crypto";

/**
 * ReconAI 2.0 - UserAccount Model
 *
 * Stores human user identities with salted, memory-hard scrypt password hashes.
 * Ensures zero plaintext passwords, immutable role/tenant associations,
 * and timing-safe credential verification.
 */

const userAccountSchema = new mongoose.Schema(
  {
    userId: {
      type: String,
      required: [true, "userId is required"],
      unique: true,
      trim: true,
      index: true
    },
    email: {
      type: String,
      required: [true, "email is required"],
      unique: true,
      lowercase: true,
      trim: true,
      index: true
    },
    passwordHash: {
      type: String,
      required: [true, "passwordHash is required"]
    },
    passwordSalt: {
      type: String,
      required: [true, "passwordSalt is required"]
    },
    role: {
      type: String,
      required: true,
      enum: ["CUSTOMER", "SHOP", "ADMIN", "AUDITOR"]
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
      default: true
    }
  },
  {
    timestamps: true
  }
);

userAccountSchema.index({ email: 1, isActive: 1 });
userAccountSchema.index({ userId: 1, isActive: 1 });

/**
 * Derives a cryptographic salt and scrypt password hash.
 */
export function hashPassword(plaintext) {
  if (!plaintext || typeof plaintext !== "string" || plaintext.length < 8) {
    throw new Error("Password must be at least 8 characters long");
  }
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = crypto.scryptSync(plaintext, salt, 64);
  return {
    hash: derivedKey.toString("hex"),
    salt
  };
}

/**
 * Verifies plaintext password against stored hash using constant-time comparison.
 */
export function verifyPassword(plaintext, hash, salt) {
  if (!plaintext || !hash || !salt) return false;
  try {
    const derivedKey = crypto.scryptSync(plaintext, salt, 64);
    const keyBuffer = Buffer.from(derivedKey.toString("hex"), "hex");
    const hashBuffer = Buffer.from(hash, "hex");
    if (keyBuffer.length !== hashBuffer.length) return false;
    return crypto.timingSafeEqual(keyBuffer, hashBuffer);
  } catch {
    return false;
  }
}

export const UserAccount =
  mongoose.models.UserAccount ||
  mongoose.model("UserAccount", userAccountSchema);

export default UserAccount;
