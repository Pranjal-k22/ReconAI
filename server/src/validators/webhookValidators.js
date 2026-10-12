import { z } from "zod";

/**
 * Validates Razorpay webhook signature header format.
 * Must be a 64-character hexadecimal string (HMAC-SHA256).
 */
export function isValidSignatureFormat(signature) {
  if (!signature || typeof signature !== "string") return false;
  return /^[0-9a-fA-F]{64}$/.test(signature.trim());
}

/**
 * Strict schema for Razorpay webhook envelope.
 */
export const razorpayWebhookEnvelopeSchema = z.object({
  entity: z.string().optional().default("event"),
  account_id: z.string().optional().default(""),
  event: z.string({ required_error: "Webhook event type is required" }).min(1),
  contains: z.array(z.string()).optional().default([]),
  payload: z.record(z.any()).default({}),
  created_at: z.number().optional()
});

/**
 * Sanitizes webhook payload for logging or storage to prevent PII / secret leakage.
 */
const SENSITIVE_WEBHOOK_KEYS = new Set([
  "card",
  "cvv",
  "password",
  "secret",
  "token",
  "bank_account",
  "account_number",
  "authorization",
  "pin"
]);

export function sanitizeWebhookPayload(data) {
  if (data === null || data === undefined) return data;
  if (typeof data !== "object") return data;

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeWebhookPayload(item));
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (
      SENSITIVE_WEBHOOK_KEYS.has(lowerKey) ||
      lowerKey.includes("card") ||
      lowerKey.includes("secret") ||
      lowerKey.includes("password")
    ) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeWebhookPayload(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}
