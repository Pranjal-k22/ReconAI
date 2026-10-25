import { getEnv } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import {
  fetchRazorpayApi,
  postRazorpayApi,
  RazorpayProviderError,
  RAZORPAY_ERROR_CODES
} from "./razorpayClient.js";
import { isNonNegativeSafeInteger } from "../../models/helpers/validators.js";
import {
  verifyPolicyAuthorizationToken,
  UnauthorizedActionExecutionError
} from "../policy/policyAuthorizationToken.js";

export { UnauthorizedActionExecutionError };

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
  authorizationToken,
  tenantId = null,
  caseId = null,
  gatewayPaymentId,
  amountPaise,
  currency = "INR",
  idempotencyKey = null,
  notes = {},
  receipt = null,
  providerIdempotencyKey = null,
  customFetch = null,
  nowMs = null,
  customSecret = null,
  operationId = null
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

  // 3. Cryptographic Policy Authorization Token Verification (Gate 3)
  const tokenPayload = await verifyPolicyAuthorizationToken({
    token: authorizationToken,
    expectedTenantId: tenantId,
    expectedCaseId: caseId,
    expectedPaymentId: cleanPaymentId,
    expectedActionType: "REQUEST_REFUND",
    expectedAmountPaise: amountPaise,
    expectedCurrency: currency,
    expectedIdempotencyKey: idempotencyKey,
    expectedOperationId: operationId,
    nowMs,
    customSecret
  });

  // 4. Prepare sanitized request payload
  const safeNotes = sanitizeProviderPayload(notes) || {};
  const requestBody = {
    amount: Math.round(amountPaise),
    speed: "normal",
    notes: safeNotes
  };

  if (receipt && typeof receipt === "string") {
    requestBody.receipt = receipt.slice(0, 40);
  }

  // 5. Pass stable provider idempotency header
  const extraHeaders = {};
  const effectiveIdempotencyKey = providerIdempotencyKey || idempotencyKey;
  if (effectiveIdempotencyKey && typeof effectiveIdempotencyKey === "string" && effectiveIdempotencyKey.trim()) {
    extraHeaders["X-Refund-Idempotency"] = effectiveIdempotencyKey.trim();
  }

  logger.info(
    { gatewayPaymentId: cleanPaymentId, amountPaise, providerIdempotencyKey: effectiveIdempotencyKey, tokenId: tokenPayload.tokenId },
    "Dispatching sandbox refund to Razorpay test endpoint"
  );

  // 6. Dispatch via centralized POST wrapper
  const endpoint = `/v1/payments/${cleanPaymentId}/refund`;
  const rawResponse = await postRazorpayApi(endpoint, requestBody, customFetch, extraHeaders);

  const sanitizedResponse = sanitizeProviderPayload(rawResponse);

  return {
    providerRefundId: sanitizedResponse.id || null,
    providerPaymentId: sanitizedResponse.payment_id || cleanPaymentId,
    amountPaise: typeof sanitizedResponse.amount === "number" ? Math.round(sanitizedResponse.amount) : amountPaise,
    currency: sanitizedResponse.currency || "INR",
    providerStatus: sanitizedResponse.status || "UNKNOWN",
    rawResponse: sanitizedResponse,
    tokenId: tokenPayload.tokenId
  };
}

/**
 * Authoritative Read Verification for Razorpay Refund.
 *
 * Calls GET /v1/payments/:paymentId/refunds/:refundId to independently verify
 * whether the refund has reached a terminal state (processed or failed) or remains pending.
 *
 * Strictly verifies authoritative provider identity fields before confirming outcome:
 * - Expected refund ID matches
 * - Expected payment ID matches
 * - Exact requested refund amount in paise matches
 * - Expected currency matches
 * - Supported provider refund status ("processed", "failed", "pending")
 *
 * Missing fields, mismatched identities, mismatched amount/currency, or unexpected status
 * fail closed to SAFE_HOLD.
 */
export async function verifySandboxRefundStatus({
  gatewayPaymentId,
  refundId,
  expectedAmountPaise = null,
  expectedCurrency = "INR",
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

  const cleanPaymentId = String(gatewayPaymentId).trim();
  const cleanRefundId = String(refundId).trim();

  try {
    const endpoint = `/v1/payments/${cleanPaymentId}/refunds/${cleanRefundId}`;
    const rawResponse = await fetchRazorpayApi(endpoint, {}, customFetch);
    const sanitized = sanitizeProviderPayload(rawResponse);

    // 1. Incomplete payload guard: verify essential identity fields are present
    if (
      !sanitized ||
      typeof sanitized !== "object" ||
      !sanitized.id ||
      !sanitized.payment_id ||
      typeof sanitized.amount !== "number" ||
      !sanitized.status
    ) {
      return {
        verified: false,
        outcome: "SAFE_HOLD",
        status: "PROVIDER_PAYLOAD_INCOMPLETE",
        safeHoldReason: "Authoritative provider response is missing required identity fields (id, payment_id, amount, or status)",
        rawResponse: sanitized
      };
    }

    const providerRefundId = String(sanitized.id).trim();
    const providerPaymentId = String(sanitized.payment_id).trim();
    const providerAmount = Math.round(sanitized.amount);
    const providerCurrency = (sanitized.currency || "INR").toUpperCase();
    const targetCurrency = (expectedCurrency || "INR").toUpperCase();
    const statusStr = String(sanitized.status).trim().toLowerCase();

    // 2. Exact Identity Matching Checks
    if (cleanRefundId && providerRefundId !== cleanRefundId) {
      return {
        verified: false,
        outcome: "SAFE_HOLD",
        status: "REFUND_ID_MISMATCH",
        safeHoldReason: `Authoritative provider refund ID '${providerRefundId}' does not match expected '${cleanRefundId}'`,
        rawResponse: sanitized
      };
    }

    if (cleanPaymentId && providerPaymentId !== cleanPaymentId) {
      return {
        verified: false,
        outcome: "SAFE_HOLD",
        status: "PAYMENT_ID_MISMATCH",
        safeHoldReason: `Authoritative provider payment ID '${providerPaymentId}' does not match expected '${cleanPaymentId}'`,
        rawResponse: sanitized
      };
    }

    if (expectedAmountPaise !== null && providerAmount !== expectedAmountPaise) {
      return {
        verified: false,
        outcome: "SAFE_HOLD",
        status: "AMOUNT_MISMATCH",
        safeHoldReason: `Authoritative provider refund amount ₹${(providerAmount / 100).toFixed(2)} does not match expected ₹${(expectedAmountPaise / 100).toFixed(2)}`,
        rawResponse: sanitized
      };
    }

    if (targetCurrency && providerCurrency !== targetCurrency) {
      return {
        verified: false,
        outcome: "SAFE_HOLD",
        status: "CURRENCY_MISMATCH",
        safeHoldReason: `Authoritative provider refund currency '${providerCurrency}' does not match expected '${targetCurrency}'`,
        rawResponse: sanitized
      };
    }

    // 3. Status Semantics Validation
    if (statusStr === "processed") {
      return {
        verified: true,
        outcome: "VERIFIED_SUCCEEDED",
        status: "PROCESSED",
        providerRefundId,
        gatewayPaymentId: providerPaymentId,
        amountPaise: providerAmount,
        currency: providerCurrency,
        rawResponse: sanitized
      };
    }

    if (statusStr === "failed") {
      return {
        verified: true,
        outcome: "VERIFIED_FAILED",
        status: "FAILED",
        providerRefundId,
        gatewayPaymentId: providerPaymentId,
        failureReason: sanitized.error_description || "Authoritative provider read confirmed refund failed",
        rawResponse: sanitized
      };
    }

    if (statusStr === "pending") {
      return {
        verified: false,
        outcome: "OUTCOME_UNKNOWN",
        status: "PENDING",
        providerRefundId,
        gatewayPaymentId: providerPaymentId,
        details: "Refund is pending processing with banking partner",
        rawResponse: sanitized
      };
    }

    // Any unrecognized or unsupported status value fails closed to SAFE_HOLD
    return {
      verified: false,
      outcome: "SAFE_HOLD",
      status: "UNEXPECTED_PROVIDER_STATUS",
      safeHoldReason: `Authoritative provider response contained unexpected refund status '${statusStr}'`,
      providerRefundId,
      gatewayPaymentId: providerPaymentId,
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
