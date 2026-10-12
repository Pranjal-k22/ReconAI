/**
 * ReconAI 2.0 - Centralized Deterministic Payment State Machine
 *
 * Implements monotonic, evidence-backed state progression rules across the 8
 * canonical dimensions:
 * 1. Merchant Order State
 * 2. Customer Debit State
 * 3. Gateway Authorization State
 * 4. Gateway Capture State
 * 5. Settlement State
 * 6. Refund State
 * 7. Dispute State
 * 8. Resolution Case State
 *
 * INVARIANTS:
 * - Terminal states (CAPTURED, REFUNDED) cannot regress to earlier or failed states.
 * - Late capture after failure preserves capture evidence under safe-hold (ADMIN_HOLD).
 * - Late capture on cancelled orders preserves CANCELLED status under safe-hold (LATE_CAPTURE_CANCELLED_ORDER).
 * - Timeouts leave outcomes UNKNOWN or PENDING; timeouts do NOT infer FAILED or debit.
 * - Transitions are strictly evidence-backed and tenant-isolated.
 */

/**
 * Validates whether a GatewayPayment status transition is permitted.
 */
export function canTransitionGatewayStatus(currentStatus, newStatus) {
  if (!currentStatus || currentStatus === newStatus) return true;

  if (currentStatus === "CAPTURED") {
    // Only refund progressions allowed from CAPTURED
    return newStatus === "REFUNDED" || newStatus === "PARTIALLY_REFUNDED";
  }

  if (currentStatus === "REFUNDED") {
    // Terminal state: no further transitions allowed
    return false;
  }

  if (currentStatus === "PARTIALLY_REFUNDED") {
    return newStatus === "REFUNDED";
  }

  if (currentStatus === "AUTHORIZED") {
    return newStatus === "CAPTURED" || newStatus === "FAILED";
  }

  if (currentStatus === "FAILED") {
    // Late capture for an initially failed attempt is a provider-valid transition
    return newStatus === "CAPTURED";
  }

  if (currentStatus === "CREATED" || currentStatus === "PENDING" || currentStatus === "UNKNOWN") {
    return true;
  }

  return false;
}

/**
 * Validates whether a MerchantOrder status transition is permitted.
 */
export function canTransitionOrderStatus(currentStatus, newStatus) {
  if (!currentStatus || currentStatus === newStatus) return true;

  if (currentStatus === "CANCELLED") {
    // Cancelled orders cannot be reopened automatically by payment events
    return false;
  }

  if (currentStatus === "PAID" || currentStatus === "ORDER_PAID") {
    return newStatus === "FULFILLED" || newStatus === "CANCELLED" || newStatus === "REFUNDED";
  }

  if (currentStatus === "CREATED" || currentStatus === "PENDING" || currentStatus === "UNKNOWN") {
    return true;
  }

  return false;
}

/**
 * Maps raw provider status string to canonical GatewayPayment status.
 */
export function mapProviderPaymentStatus(rawStatus) {
  if (!rawStatus || typeof rawStatus !== "string") return "UNKNOWN";
  const s = rawStatus.trim().toLowerCase();
  switch (s) {
    case "captured":
      return "CAPTURED";
    case "authorized":
      return "AUTHORIZED";
    case "failed":
      return "FAILED";
    case "refunded":
      return "REFUNDED";
    case "partially_refunded":
      return "PARTIALLY_REFUNDED";
    case "created":
      return "CREATED";
    case "pending":
      return "PENDING";
    default:
      return "UNKNOWN";
  }
}

/**
 * Evaluates canonical state transition for an incoming provider event or status poll.
 *
 * @param {Object} params
 * @param {Object|null} params.existingGateway - Current GatewayPayment record
 * @param {Object|null} params.existingOrder - Current MerchantOrder record
 * @param {Object|null} params.existingCase - Current PaymentCase record
 * @param {string} params.newPaymentStatus - Proposed new payment status
 * @param {string} [params.tenantId] - Authoritative tenant ID
 * @param {string|null} [params.claimedTenantId] - Tenant ID claimed in payload notes
 * @returns {Object} Evaluation outcome with permitted status, conflict flags, and record updates
 */
export function evaluateCanonicalTransition({
  existingGateway = null,
  existingOrder = null,
  existingCase = null,
  newPaymentStatus,
  tenantId = null,
  claimedTenantId = null
}) {
  // 1. Cross-Tenant Integrity Check
  if (claimedTenantId && existingOrder?.tenantId && claimedTenantId !== existingOrder.tenantId) {
    return {
      allowed: false,
      reason: "CROSS_TENANT_MISMATCH",
      conflictFlag: "CROSS_TENANT_MISMATCH",
      gatewayUpdates: null,
      orderUpdates: null,
      caseUpdates: null
    };
  }

  const currentGatewayStatus = existingGateway?.status || null;
  const isOrderCancelled = Boolean(existingOrder && existingOrder.status === "CANCELLED");
  const isCurrentlyCaptured = currentGatewayStatus === "CAPTURED";
  const isCurrentlyFailed = currentGatewayStatus === "FAILED";

  // 2. Out-of-Order Regression Protection: Delayed failure after capture
  if (isCurrentlyCaptured && newPaymentStatus === "FAILED") {
    return {
      allowed: false,
      reason: "STALE_REGRESSION_BLOCKED: Confirmed CAPTURED status cannot regress to FAILED",
      conflictFlag: "STALE_REGRESSION_BLOCKED",
      gatewayUpdates: null,
      orderUpdates: null,
      caseUpdates: null
    };
  }

  // 3. Check general monotonic gateway transition validity
  if (currentGatewayStatus && !canTransitionGatewayStatus(currentGatewayStatus, newPaymentStatus)) {
    return {
      allowed: false,
      reason: `INVALID_GATEWAY_TRANSITION: Cannot transition from ${currentGatewayStatus} to ${newPaymentStatus}`,
      conflictFlag: "INVALID_TRANSITION",
      gatewayUpdates: null,
      orderUpdates: null,
      caseUpdates: null
    };
  }

  // 4. Edge Case: Late capture on CANCELLED order
  if (newPaymentStatus === "CAPTURED" && isOrderCancelled) {
    return {
      allowed: true,
      reason: "LATE_CAPTURE_ON_CANCELLED_ORDER: Capture recorded, order cancellation preserved under safe-hold",
      conflictFlag: "CANCELLED_ORDER_CAPTURED",
      gatewayUpdates: {
        status: "CAPTURED",
        isLateCapture: true
      },
      orderUpdates: {
        // Order status must NOT be changed to PAID! Cancellation preserved!
        status: "CANCELLED"
      },
      caseUpdates: {
        orderStatus: "ORDER_CANCELLED",
        captureStatus: "CAPTURE_CAPTURED",
        resolutionCaseStatus: "CASE_SAFE_HOLD",
        safeHoldCode: "LATE_CAPTURE_CANCELLED_ORDER",
        safeHoldReason: "Late capture received for cancelled order. Awaiting operator review.",
        discrepancyCategory: "CANCELLED_ORDER_CAPTURED",
        isSafeHold: true
      }
    };
  }

  // 5. Edge Case: Late capture after apparent FAILURE
  if (newPaymentStatus === "CAPTURED" && isCurrentlyFailed) {
    return {
      allowed: true,
      reason: "LATE_CAPTURE_AFTER_FAILURE: Initial failure overturned by late provider capture",
      conflictFlag: "LATE_CAPTURE_AFTER_FAILURE",
      gatewayUpdates: {
        status: "CAPTURED",
        isLateCapture: true,
        previousStatus: "FAILED"
      },
      orderUpdates: existingOrder && existingOrder.status !== "CANCELLED" ? { status: "PAID" } : null,
      caseUpdates: {
        captureStatus: "CAPTURE_CAPTURED",
        resolutionCaseStatus: "CASE_SAFE_HOLD",
        safeHoldCode: "ADMIN_HOLD",
        safeHoldReason: "Conflicting late capture arrived after payment failure was recorded.",
        discrepancyCategory: "STATUS_MISMATCH",
        isSafeHold: true
      }
    };
  }

  // 6. Standard Capture Progression
  if (newPaymentStatus === "CAPTURED") {
    const shouldUpdateOrder = existingOrder && existingOrder.status !== "CANCELLED";
    return {
      allowed: true,
      reason: "PAYMENT_CAPTURED: Standard successful capture transition",
      conflictFlag: null,
      gatewayUpdates: {
        status: "CAPTURED"
      },
      orderUpdates: shouldUpdateOrder ? { status: "PAID" } : null,
      caseUpdates: {
        captureStatus: "CAPTURE_CAPTURED",
        settlementStatus: "SETTLEMENT_PENDING",
        ...(shouldUpdateOrder ? { orderStatus: "ORDER_PAID" } : {})
      }
    };
  }

  // 7. Standard Failure Progression
  if (newPaymentStatus === "FAILED") {
    return {
      allowed: true,
      reason: "PAYMENT_FAILED: Gateway payment marked failed",
      conflictFlag: null,
      gatewayUpdates: {
        status: "FAILED"
      },
      orderUpdates: null,
      caseUpdates: {
        captureStatus: "CAPTURE_FAILED"
        // Customer debit remains UNKNOWN unless verified positive debit proof exists!
      }
    };
  }

  // 8. Standard Authorization Progression
  if (newPaymentStatus === "AUTHORIZED") {
    return {
      allowed: true,
      reason: "PAYMENT_AUTHORIZED: Gateway payment authorization hold confirmed",
      conflictFlag: null,
      gatewayUpdates: {
        status: "AUTHORIZED"
      },
      orderUpdates: null,
      caseUpdates: {
        authorizationStatus: "AUTH_AUTHORIZED"
      }
    };
  }

  // 9. Standard Refund Progression
  if (newPaymentStatus === "REFUNDED") {
    return {
      allowed: true,
      reason: "PAYMENT_REFUNDED: Gateway payment refund confirmed",
      conflictFlag: null,
      gatewayUpdates: {
        status: "REFUNDED"
      },
      orderUpdates: null,
      caseUpdates: {
        refundStatus: "REFUND_CONFIRMED"
      }
    };
  }

  // 10. Default / Intermediate
  return {
    allowed: true,
    reason: `PAYMENT_STATUS_UPDATE: Transitioned to ${newPaymentStatus}`,
    conflictFlag: null,
    gatewayUpdates: {
      status: newPaymentStatus
    },
    orderUpdates: null,
    caseUpdates: null
  };
}
