import mongoose from "mongoose";
import crypto from "crypto";

/**
 * ReconAI 2.0 - CustomerClaim Domain Model
 *
 * Append-only record of customer-asserted payment discrepancies and fraud allegations.
 * Claims are UNVERIFIED EVIDENCE ONLY:
 * - A claim is a record of what a customer said.
 * - It never proves a debit, never changes order/capture/refund/settlement state,
 *   never creates refund eligibility, and never selects a classification by its text.
 * - Stored as plain text, length-capped, control characters stripped, card numbers
 *   (13-19 digits) and PII redacted before storage.
 * - Strictly append-only: updates and deletes are unconditionally rejected.
 */

export const CLAIM_TYPES = Object.freeze([
  "DEBIT_NOT_CONFIRMED",
  "UNAUTHORIZED_PAYMENT"
]);

export const REFERENCE_TYPES = Object.freeze([
  "MERCHANT_ORDER_ID",
  "GATEWAY_PAYMENT_ID",
  "BANK_RRN"
]);

export const LINK_STATUSES = Object.freeze([
  "LINKED",
  "UNLINKED"
]);

/**
 * Strips control characters, redacts card numbers (13-19 digits), emails, phone numbers,
 * and neutralizes instruction injection patterns. Caps length at 1000 characters.
 *
 * @param {string} rawText
 * @returns {string} sanitized plain text
 */
export function sanitizeClaimDescription(rawText) {
  if (!rawText || typeof rawText !== "string") return "";

  // 1. Strip ASCII control characters (preserving tab \t, line feed \n, carriage return \r)
  let text = rawText.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

  // 2. Redact instruction injection prompts
  text = text.replace(/(?:ignore\s+all\s+previous\s+instructions|system\s+override|prompt\s+injection)/gi, "[REDACTED_PROMPT]");

  // 3. Redact card numbers (13 to 19 digits with optional spaces or dashes)
  text = text.replace(/\b(?:\d[ -]*?){13,19}\b/g, "[REDACTED_CARD]");

  // 4. Redact email addresses
  text = text.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[REDACTED_EMAIL]");

  // 5. Redact Indian phone numbers (10 digits, optional +91 prefix)
  text = text.replace(/(?:\+?91[- ]?)?[6-9]\d{9}\b/g, "[REDACTED_PHONE]");

  // 6. Enforce hard 1000-character cap
  return text.slice(0, 1000).trim();
}

/**
 * Computes deterministic SHA-256 content hash over canonical claim fields.
 *
 * @param {Object} fields
 * @returns {string} 64-hex character hash
 */
export function computeClaimContentHash({
  claimType,
  referenceType,
  referenceValue,
  claimedAmountPaise = null,
  description = ""
}) {
  const canonical = {
    claimType,
    referenceType,
    referenceValue: (referenceValue || "").trim(),
    claimedAmountPaise: claimedAmountPaise || null,
    description: (description || "").trim()
  };
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

const customerClaimSchema = new mongoose.Schema(
  {
    claimId: {
      type: String,
      required: [true, "claimId is required"],
      unique: true,
      trim: true,
      default: () => `clm_${crypto.randomUUID()}`
    },
    tenantId: {
      type: String,
      required: [true, "tenantId is required"],
      trim: true,
      index: true,
      validate: {
        validator: (v) => v !== "unassigned_provider_quarantine" && typeof v === "string" && v.length > 0,
        message: "tenantId cannot be empty or the quarantine sentinel"
      }
    },
    customerId: {
      type: String,
      required: [true, "customerId is required"],
      trim: true,
      index: true
    },
    claimType: {
      type: String,
      required: [true, "claimType is required"],
      enum: {
        values: CLAIM_TYPES,
        message: "claimType must be DEBIT_NOT_CONFIRMED or UNAUTHORIZED_PAYMENT"
      }
    },
    referenceType: {
      type: String,
      required: [true, "referenceType is required"],
      enum: {
        values: REFERENCE_TYPES,
        message: "referenceType must be MERCHANT_ORDER_ID, GATEWAY_PAYMENT_ID, or BANK_RRN"
      }
    },
    referenceValue: {
      type: String,
      required: [true, "referenceValue is required"],
      trim: true,
      minlength: 1,
      maxlength: 64
    },
    claimedAmountPaise: {
      type: Number,
      default: null,
      validate: {
        validator: (v) => v === null || (typeof v === "number" && Number.isInteger(v) && v > 0 && v <= Number.MAX_SAFE_INTEGER),
        message: "claimedAmountPaise must be a positive safe integer or null"
      }
    },
    description: {
      type: String,
      default: "",
      maxlength: 1000
    },
    linkedCaseId: {
      type: String,
      default: null,
      trim: true,
      index: true
    },
    linkStatus: {
      type: String,
      required: [true, "linkStatus is required"],
      enum: {
        values: LINK_STATUSES,
        message: "linkStatus must be LINKED or UNLINKED"
      }
    },
    verified: {
      type: Boolean,
      default: false,
      required: true,
      validate: {
        validator: (v) => v === false,
        message: "Customer claims are unverified evidence; verified field must strictly be false"
      }
    },
    idempotencyKey: {
      type: String,
      required: [true, "idempotencyKey is required"],
      trim: true,
      minlength: 10,
      maxlength: 64
    },
    contentHash: {
      type: String,
      required: [true, "contentHash is required"],
      trim: true
    },
    createdAt: {
      type: Date,
      default: Date.now,
      immutable: true,
      index: true
    }
  },
  {
    timestamps: false,
    versionKey: false
  }
);

// Indexes
customerClaimSchema.index(
  { tenantId: 1, customerId: 1, idempotencyKey: 1 },
  { unique: true, name: "tenant_customer_idempotency_unique" }
);
customerClaimSchema.index({ tenantId: 1, linkedCaseId: 1 });
customerClaimSchema.index({ tenantId: 1, customerId: 1, createdAt: -1 });

// Immutability Guards: Append-Only Schema Enforcement
customerClaimSchema.pre("save", function (next) {
  if (!this.isNew) {
    return next(new Error("CustomerClaim is strictly append-only and cannot be updated."));
  }
  if (this.verified !== false) {
    return next(new Error("CustomerClaim verified field must strictly be false."));
  }
  next();
});

const blockedUpdateMethods = [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "findByIdAndUpdate",
  "replaceOne"
];

blockedUpdateMethods.forEach((method) => {
  customerClaimSchema.pre(method, function (next) {
    next(new Error("CustomerClaim is strictly append-only and cannot be updated."));
  });
});

const blockedDeleteMethods = [
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
  "findByIdAndDelete"
];

blockedDeleteMethods.forEach((method) => {
  customerClaimSchema.pre(method, function (next) {
    next(new Error("CustomerClaim is strictly append-only and cannot be deleted."));
  });
});

export const CustomerClaim =
  mongoose.models.CustomerClaim ||
  mongoose.model("CustomerClaim", customerClaimSchema);

export default CustomerClaim;

