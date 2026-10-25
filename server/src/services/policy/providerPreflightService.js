import { fetchRazorpayApi, RazorpayProviderError } from "../razorpay/razorpayClient.js";
import { sanitizeProviderPayload } from "../razorpay/razorpaySandboxAdapter.js";
import { createAuditEvent } from "../audit/auditService.js";
import { logger } from "../../config/logger.js";

/**
 * ReconAI 2.0 - Fresh Provider Read Preflight Service (Gate B2)
 *
 * Performs authoritative GET read of the payment and its refunds list from Razorpay
 * prior to issuing a PolicyAuthorizationToken or dispatching a refund.
 *
 * Strict invariants:
 * - payment.status === "captured"
 * - payment.currency === localCurrency
 * - payment.amount_captured === local captured amount
 * - payment.amount_refunded consistent with local records
 * - payment.order_id matches local order ID (when present)
 * - Refundable amount = captured - provider refunded - local reservations
 *
 * Mismatch -> SAFE_HOLD
 * Timeout or Error -> INSUFFICIENT_EVIDENCE
 */
export async function performProviderPreflight({
  tenantId = null,
  caseId = null,
  gatewayPaymentId,
  localAmountPaise,
  localCurrency = "INR",
  localOrderId = null,
  localRefundedAmountPaise = 0,
  reservedRefundPaise = 0,
  customFetch = null
}) {
  if (!gatewayPaymentId || typeof gatewayPaymentId !== "string" || !gatewayPaymentId.trim()) {
    return {
      ok: false,
      status: "INSUFFICIENT_EVIDENCE",
      reason: "gatewayPaymentId is required for provider preflight read"
    };
  }

  const cleanPaymentId = gatewayPaymentId.trim();
  const cleanCurrency = String(localCurrency || "INR").trim().toUpperCase();

  let providerPaymentRaw;
  let providerRefundsRaw;

  // 1. Authoritative GET Reads
  try {
    const [payRes, refRes] = await Promise.all([
      fetchRazorpayApi(`/v1/payments/${cleanPaymentId}`, {}, customFetch),
      fetchRazorpayApi(`/v1/payments/${cleanPaymentId}/refunds`, {}, customFetch)
    ]);
    providerPaymentRaw = payRes;
    providerRefundsRaw = refRes;
  } catch (err) {
    logger.warn(
      { err: err.message, gatewayPaymentId: cleanPaymentId },
      "Provider preflight read failed or timed out"
    );
    return {
      ok: false,
      status: "INSUFFICIENT_EVIDENCE",
      reason: `Provider GET read failed or timed out: ${err.message}`,
      error: err
    };
  }

  const payment = sanitizeProviderPayload(providerPaymentRaw);
  const refundsList = sanitizeProviderPayload(providerRefundsRaw);

  const failMismatch = async (reason, details = {}) => {
    logger.warn({ reason, details, gatewayPaymentId: cleanPaymentId }, "Provider preflight mismatch detected");
    await createAuditEvent({
      actorType: "RAZORPAY_ADAPTER",
      actorId: "preflight-verifier",
      action: "PROVIDER_PREFLIGHT_MISMATCH",
      tenantId: tenantId || "system",
      entityType: "GatewayPayment",
      entityId: cleanPaymentId,
      metadata: {
        reason,
        details,
        caseId,
        gatewayPaymentId: cleanPaymentId
      }
    }).catch(() => {});

    return {
      ok: false,
      status: "SAFE_HOLD",
      reason,
      details,
      providerPayment: payment,
      providerRefunds: refundsList
    };
  };

  // 2. Validate Payment Status: must be "captured"
  if (payment.status !== "captured") {
    return await failMismatch(
      `Provider payment status is '${payment.status}', expected 'captured'`,
      { providerStatus: payment.status, expected: "captured" }
    );
  }

  // 3. Validate Currency
  const providerCurrency = String(payment.currency || "").trim().toUpperCase();
  if (providerCurrency !== cleanCurrency) {
    return await failMismatch(
      `Provider currency '${providerCurrency}' does not match expected '${cleanCurrency}'`,
      { providerCurrency, expectedCurrency: cleanCurrency }
    );
  }

  // 4. Validate Captured Amount
  const providerCaptured =
    typeof payment.amount_captured === "number"
      ? payment.amount_captured
      : typeof payment.amount === "number"
      ? payment.amount
      : null;

  if (providerCaptured !== localAmountPaise) {
    return await failMismatch(
      `Provider captured amount (${providerCaptured}) does not match local recorded amount (${localAmountPaise})`,
      { providerCaptured, localAmountPaise }
    );
  }

  // 5. Validate Order ID Consistency
  if (localOrderId && payment.order_id && payment.order_id !== localOrderId) {
    return await failMismatch(
      `Provider order_id '${payment.order_id}' does not match local orderId '${localOrderId}'`,
      { providerOrderId: payment.order_id, localOrderId }
    );
  }

  // 6. Validate Refund Consistency
  const refundsItems = Array.isArray(refundsList?.items) ? refundsList.items : [];
  const listRefundedPaise = refundsItems
    .filter((r) => r.status === "processed" || r.status === "pending")
    .reduce((sum, r) => sum + (r.amount || 0), 0);

  const entityRefundedPaise = typeof payment.amount_refunded === "number" ? payment.amount_refunded : 0;
  const effectiveProviderRefunded = Math.max(listRefundedPaise, entityRefundedPaise);

  if (effectiveProviderRefunded < localRefundedAmountPaise) {
    return await failMismatch(
      `Provider reported refunded amount (${effectiveProviderRefunded}) is less than local recorded refunded amount (${localRefundedAmountPaise})`,
      { providerRefunded: effectiveProviderRefunded, localRefundedAmountPaise }
    );
  }

  // 7. Calculate Refundable Balance
  const refundableAmountPaise = providerCaptured - effectiveProviderRefunded - reservedRefundPaise;
  if (refundableAmountPaise <= 0) {
    return await failMismatch(
      `No refundable balance remaining: captured ${providerCaptured}, refunded ${effectiveProviderRefunded}, reserved ${reservedRefundPaise}`,
      { providerCaptured, effectiveProviderRefunded, reservedRefundPaise, refundableAmountPaise }
    );
  }

  return {
    ok: true,
    status: "OK",
    providerPayment: payment,
    providerRefunds: refundsList,
    providerCapturedPaise: providerCaptured,
    providerRefundedPaise: effectiveProviderRefunded,
    reservedRefundPaise,
    refundableAmountPaise
  };
}
