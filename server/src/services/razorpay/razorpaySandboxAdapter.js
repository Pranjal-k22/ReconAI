import { getEnv } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import {
  fetchRazorpayApi,
  postRazorpayApi,
  RazorpayProviderError,
  RAZORPAY_ERROR_CODES
} from "./razorpayClient.js";
import { isNonNegativeSafeInteger } from "../../models/helpers/validators.js";

/**
 * Custom error thrown when a mutation is requested but the sandbox write gate is closed.
 */
export class SandboxGateClosedError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "SandboxGateClosedError";
    this.code = "SANDBOX_GATE_CLOSED";
    this.details = details;
  }
}

/**
 * Evaluates the strict sandbox write gate.
 *
 * FAILS CLOSED UNLESS:
 * 1. Environment is explicitly in test mode (RAZORPAY_MODE === "test")
 * 2. Sandbox writes are explicitly enabled (RAZORPAY_SANDBOX_WRITES_ENABLED === true)
 * 3. Credentials strictly match test pattern (RAZORPAY_KEY_ID starts with "rzp_test_")
 *
 * NEVER falls back to live mode or production URLs.
 */
export function checkSandboxWriteGate() {
  const env = getEnv();
  const mode = (process.env.RAZORPAY_MODE || env.RAZORPAY_MODE || "test").trim().toLowerCase();
  const writesEnabled =
    process.env.RAZORPAY_SANDBOX_WRITES_ENABLED !== undefined
      ? process.env.RAZORPAY_SANDBOX_WRITES_ENABLED === "true" || process.env.RAZORPAY_SANDBOX_WRITES_ENABLED === true
      : Boolean(env.RAZORPAY_SANDBOX_WRITES_ENABLED);
  const keyId = (process.env.RAZORPAY_KEY_ID || env.RAZORPAY_KEY_ID || "").trim();

  const reasons = [];

  if (mode !== "test") {
    reasons.push(`Provider mode is '${mode}', expected 'test'. Live provider mutations are strictly prohibited.`);
  }

  if (!writesEnabled) {
    reasons.push(
      "Provider mutations are disabled by default. RAZORPAY_SANDBOX_WRITES_ENABLED must be explicitly set to true."
    );
  }

  if (!keyId.startsWith("rzp_test_")) {
    reasons.push(
      `Razorpay Key ID does not match test prefix 'rzp_test_'. Given: '${keyId.slice(0, 8)}...'`
    );
  }

  if (reasons.length > 0) {
    throw new SandboxGateClosedError(
      `Sandbox write gate closed: ${reasons.join(" ")}`,
      { mode, writesEnabled, keyIdPrefix: keyId.slice(0, 8) }
    );
  }

  return true;
}

/**
 * Returns true if the sandbox write gate is open, false otherwise.
 */
export function isSandboxWriteEnabled() {
  try {
    checkSandboxWriteGate();
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Deep redaction of secrets, authorization tokens, customer PII from provider payloads.
 */
export function sanitizeProviderPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;

  if (Array.isArray(payload)) {
    return payload.map(sanitizeProviderPayload);
  }

  const sanitized = { ...payload };

  // Strip credentials and auth headers
  delete sanitized.key_secret;
  delete sanitized.secret;
  delete sanitized.auth;
  delete sanitized.authorization;
  delete sanitized.Authorization;

  // Strip customer PII
  delete sanitized.email;
  delete sanitized.contact;
  delete sanitized.phone;
  delete sanitized.address;
  delete sanitized.vpa;
  delete sanitized.card_id;
  delete sanitized.card;
  delete sanitized.token_id;

  if (sanitized.notes && typeof sanitized.notes === "object") {
    const safeNotes = { ...sanitized.notes };
    delete safeNotes.email;
    delete safeNotes.contact;
    delete safeNotes.phone;
    delete safeNotes.address;
    delete safeNotes.vpa;
    sanitized.notes = safeNotes;
  }

  return sanitized;
}

/**
 * Dispatches a sandbox refund request to Razorpay.
 *
 * CRITICAL SAFETY:
 * - Fails closed unless checkSandboxWriteGate() passes.
 * - Requires typed paymentId and positive integer amountPaise.
 * - Strips all customer PII from notes prior to dispatch.
 */
export async function executeSandboxRefund({
  gatewayPaymentId,
  amountPaise,
  notes = {},
  receipt = null,
  customFetch = null
}) {
  // 1. Enforce sandbox gate
  checkSandboxWriteGate();

  // 2. Validate inputs
  if (!gatewayPaymentId || typeof gatewayPaymentId !== "string" || !gatewayPaymentId.trim()) {
    throw new Error("gatewayPaymentId is required for refund dispatch");
  }

  if (!isNonNegativeSafeInteger(amountPaise) || amountPaise <= 0) {
    throw new Error("amountPaise must be a positive safe integer paise value");
  }

  const cleanPaymentId = gatewayPaymentId.trim();

  // 3. Prepare sanitized request payload
  const safeNotes = sanitizeProviderPayload(notes) || {};
  const requestBody = {
    amount: Math.round(amountPaise),
    speed: "normal",
    notes: safeNotes
  };

  if (receipt && typeof receipt === "string") {
    requestBody.receipt = receipt.slice(0, 40);
  }

  logger.info(
    { gatewayPaymentId: cleanPaymentId, amountPaise },
    "Dispatching sandbox refund to Razorpay test endpoint"
  );

  // 4. Dispatch via centralized POST wrapper
  const endpoint = `/v1/payments/${cleanPaymentId}/refund`;
  const rawResponse = await postRazorpayApi(endpoint, requestBody, customFetch);

  const sanitizedResponse = sanitizeProviderPayload(rawResponse);

  return {
    providerRefundId: sanitizedResponse.id || null,
    providerPaymentId: sanitizedResponse.payment_id || cleanPaymentId,
    amountPaise: typeof sanitizedResponse.amount === "number" ? Math.round(sanitizedResponse.amount) : amountPaise,
    currency: sanitizedResponse.currency || "INR",
    providerStatus: sanitizedResponse.status || "UNKNOWN",
    rawResponse: sanitizedResponse
  };
}

/**
 * Authoritative Read Verification for Razorpay Refund.
 *
 * Calls GET /v1/payments/:paymentId/refunds/:refundId to independently verify
 * whether the refund has reached a terminal state (processed or failed) or remains pending.
 *
 * Does NOT require sandbox writes enabled (read verification is safe read-only).
 */
export async function verifySandboxRefundStatus({
  gatewayPaymentId,
  refundId,
  customFetch = null
}) {
  if (!gatewayPaymentId || !refundId) {
    return {
      verified: false,
      outcome: "OUTCOME_UNKNOWN",
      status: "MISSING_IDENTIFIERS",
      details: "gatewayPaymentId and refundId are required for verification"
    };
  }

  const cleanPaymentId = gatewayPaymentId.trim();
  const cleanRefundId = refundId.trim();

  try {
    const endpoint = `/v1/payments/${cleanPaymentId}/refunds/${cleanRefundId}`;
    const rawResponse = await fetchRazorpayApi(endpoint, {}, customFetch);
    const sanitized = sanitizeProviderPayload(rawResponse);

    const statusStr = (sanitized.status || "").toLowerCase();

    if (statusStr === "processed") {
      return {
        verified: true,
        outcome: "VERIFIED_SUCCEEDED",
        status: "PROCESSED",
        providerRefundId: cleanRefundId,
        gatewayPaymentId: cleanPaymentId,
        amountPaise: typeof sanitized.amount === "number" ? Math.round(sanitized.amount) : null,
        currency: sanitized.currency || "INR",
        rawResponse: sanitized
      };
    }

    if (statusStr === "failed") {
      return {
        verified: true,
        outcome: "VERIFIED_FAILED",
        status: "FAILED",
        providerRefundId: cleanRefundId,
        gatewayPaymentId: cleanPaymentId,
        failureReason: sanitized.error_description || "Provider reported refund failed",
        rawResponse: sanitized
      };
    }

    if (statusStr === "pending") {
      return {
        verified: false,
        outcome: "OUTCOME_UNKNOWN",
        status: "PENDING",
        providerRefundId: cleanRefundId,
        gatewayPaymentId: cleanPaymentId,
        details: "Refund is pending processing with banking partner",
        rawResponse: sanitized
      };
    }

    return {
      verified: false,
      outcome: "OUTCOME_UNKNOWN",
      status: statusStr.toUpperCase() || "UNKNOWN",
      providerRefundId: cleanRefundId,
      gatewayPaymentId: cleanPaymentId,
      rawResponse: sanitized
    };
  } catch (err) {
    logger.warn(
      { err: err.message, refundId: cleanRefundId, paymentId: cleanPaymentId },
      "Error during authoritative refund verification read"
    );

    return {
      verified: false,
      outcome: "OUTCOME_UNKNOWN",
      status: "READ_FAILED_OR_TIMEOUT",
      error: err.message,
      errorCode: err.code || "VERIFICATION_READ_ERROR"
    };
  }
}

/**
 * Authoritative Read Verification for Razorpay Payment status.
 *
 * Calls GET /v1/payments/:paymentId to verify payment existence, status, and refunded amount.
 */
export async function verifyPaymentStatus({
  gatewayPaymentId,
  customFetch = null
}) {
  if (!gatewayPaymentId) {
    return {
      verified: false,
      outcome: "OUTCOME_UNKNOWN",
      status: "MISSING_PAYMENT_ID"
    };
  }

  const cleanPaymentId = gatewayPaymentId.trim();

  try {
    const endpoint = `/v1/payments/${cleanPaymentId}`;
    const rawResponse = await fetchRazorpayApi(endpoint, {}, customFetch);
    const sanitized = sanitizeProviderPayload(rawResponse);

    return {
      verified: true,
      gatewayPaymentId: cleanPaymentId,
      amountPaise: typeof sanitized.amount === "number" ? Math.round(sanitized.amount) : null,
      amountRefundedPaise: typeof sanitized.amount_refunded === "number" ? Math.round(sanitized.amount_refunded) : 0,
      currency: sanitized.currency || "INR",
      status: sanitized.status ? sanitized.status.toUpperCase() : "UNKNOWN",
      rawResponse: sanitized
    };
  } catch (err) {
    return {
      verified: false,
      outcome: "OUTCOME_UNKNOWN",
      status: "READ_FAILED_OR_TIMEOUT",
      error: err.message
    };
  }
}
