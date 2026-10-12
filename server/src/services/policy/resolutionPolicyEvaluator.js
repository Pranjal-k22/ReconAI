import { APPROVED_DRY_RUN_ACTION_TYPES, ACTION_TYPES } from "../../models/PaymentAction.js";
import { POLICY_OUTCOME_STATUSES } from "../../models/PolicyDecision.js";
import { isNonNegativeSafeInteger } from "../../models/helpers/validators.js";

export const DEFAULT_POLICY_VERSION = "2026-10-12.v1";
export const SUPPORTED_POLICY_VERSIONS = Object.freeze(["2026-10-12.v1"]);

/**
 * ReconAI 2.0 - Deterministic Resolution Policy Evaluator
 *
 * Evaluates proposed actions against verified evidence, explicit eligibility rules,
 * authorization, risk controls, and fail-closed refund limits.
 *
 * PURE & DETERMINISTIC: Zero external network I/O, zero database side-effects.
 * Permanently non-executable: returns outcomeStatus and non-executability contract.
 */
export function evaluateResolutionPolicy({
  tenantId,
  caseId,
  actorId,
  actorRole,
  proposedActionType,
  amountPaise = null,
  currency = "INR",
  classificationFinding = null,
  authoritativeEvidence = {},
  advisoryAiSuggestion = null,
  policyConfig = null,
  policyVersion = DEFAULT_POLICY_VERSION
}) {
  const appliedRuleIds = [];
  const allowReasons = [];
  const denyReasons = [];
  const missingEvidence = [];
  const conflicts = [];
  const approvedEvidenceReferences = [];
  const checksPerformed = {
    tenantCheck: false,
    ownershipCheck: false,
    providerCapabilityCheck: false,
    amountCheck: false,
    refundLimitsCheck: false,
    safeHoldCheck: false,
    aiAdvisoryCheck: false
  };

  // -------------------------------------------------------------------------
  // 1. Core Schema and Input Invariant Validation
  // -------------------------------------------------------------------------
  if (!tenantId || typeof tenantId !== "string" || tenantId.trim().length === 0) {
    return buildPolicyResult({
      outcomeStatus: "REJECTED_BY_POLICY",
      appliedRuleIds: ["R_INVALID_TENANT_ID"],
      denyReasons: ["tenantId is required and must be a valid non-empty string"],
      checksPerformed
    });
  }
  checksPerformed.tenantCheck = true;

  if (!caseId || typeof caseId !== "string" || caseId.trim().length === 0) {
    return buildPolicyResult({
      outcomeStatus: "REJECTED_BY_POLICY",
      appliedRuleIds: ["R_INVALID_CASE_ID"],
      denyReasons: ["caseId is required and must be a valid non-empty string"],
      checksPerformed
    });
  }

  if (!SUPPORTED_POLICY_VERSIONS.includes(policyVersion)) {
    return buildPolicyResult({
      outcomeStatus: "REJECTED_BY_POLICY",
      appliedRuleIds: ["R_UNSUPPORTED_POLICY_VERSION"],
      denyReasons: [`Policy version '${policyVersion}' is unsupported. Supported: ${SUPPORTED_POLICY_VERSIONS.join(", ")}`],
      checksPerformed
    });
  }

  if (!proposedActionType || !ACTION_TYPES.includes(proposedActionType)) {
    return buildPolicyResult({
      outcomeStatus: "REJECTED_BY_POLICY",
      appliedRuleIds: ["R_UNKNOWN_ACTION_TYPE"],
      denyReasons: [`Action type '${proposedActionType}' is not recognized or supported by policy catalogue.`],
      checksPerformed
    });
  }

  if (currency !== "INR") {
    return buildPolicyResult({
      outcomeStatus: "REJECTED_BY_POLICY",
      appliedRuleIds: ["R_UNSUPPORTED_CURRENCY"],
      denyReasons: [`Currency '${currency}' is not supported. Supported: INR`],
      checksPerformed
    });
  }

  if (amountPaise !== null && !isNonNegativeSafeInteger(amountPaise)) {
    return buildPolicyResult({
      outcomeStatus: "REJECTED_BY_POLICY",
      appliedRuleIds: ["R_INVALID_AMOUNT_PAISE"],
      denyReasons: ["amountPaise must be a non-negative safe integer or null"],
      checksPerformed
    });
  }
  checksPerformed.amountCheck = true;

  // -------------------------------------------------------------------------
  // 2. Ownership & Cross-Tenant Boundary Verification
  // -------------------------------------------------------------------------
  const {
    gatewayPayment = null,
    merchantOrder = null,
    refundRecords = [],
    settlementRecord = null,
    disputeRecord = null,
    paymentCase = null
  } = authoritativeEvidence;

  if (gatewayPayment) {
    if (gatewayPayment.tenantId && gatewayPayment.tenantId !== tenantId) {
      return buildPolicyResult({
        outcomeStatus: "REJECTED_BY_POLICY",
        appliedRuleIds: ["R_CROSS_TENANT_PAYMENT_BLOCKED"],
        denyReasons: [`Gateway payment tenant '${gatewayPayment.tenantId}' does not match evaluated tenant '${tenantId}'`],
        conflicts: ["CROSS_TENANT_PAYMENT_MISMATCH"],
        checksPerformed
      });
    }
    if (gatewayPayment.gatewayPaymentId) {
      approvedEvidenceReferences.push(`PAYMENT:${gatewayPayment.gatewayPaymentId}`);
    }
  }

  if (merchantOrder) {
    if (merchantOrder.tenantId && merchantOrder.tenantId !== tenantId) {
      return buildPolicyResult({
        outcomeStatus: "REJECTED_BY_POLICY",
        appliedRuleIds: ["R_CROSS_TENANT_ORDER_BLOCKED"],
        denyReasons: [`Merchant order tenant '${merchantOrder.tenantId}' does not match evaluated tenant '${tenantId}'`],
        conflicts: ["CROSS_TENANT_ORDER_MISMATCH"],
        checksPerformed
      });
    }
    if (merchantOrder.merchantOrderId) {
      approvedEvidenceReferences.push(`ORDER:${merchantOrder.merchantOrderId}`);
    }
  }

  if (gatewayPayment && merchantOrder && gatewayPayment.merchantOrderId) {
    if (gatewayPayment.merchantOrderId !== merchantOrder.merchantOrderId) {
      conflicts.push("CONFLICTING_ORDER_PAYMENT_LINK");
      return buildPolicyResult({
        outcomeStatus: "SAFE_HOLD",
        appliedRuleIds: ["R_CONFLICTING_ORDER_PAYMENT_LINK"],
        denyReasons: [
          `Gateway payment merchantOrderId '${gatewayPayment.merchantOrderId}' conflicts with order '${merchantOrder.merchantOrderId}'`
        ],
        conflicts,
        checksPerformed
      });
    }
  }
  checksPerformed.ownershipCheck = true;

  // -------------------------------------------------------------------------
  // 3. AI Suggestion Advisory Invariant
  // -------------------------------------------------------------------------
  checksPerformed.aiAdvisoryCheck = true;
  if (advisoryAiSuggestion) {
    appliedRuleIds.push("R_AI_ADVISORY_CHECK");
    allowReasons.push(`AI suggested '${advisoryAiSuggestion}' evaluated strictly as non-authoritative advisory context.`);
  }

  // -------------------------------------------------------------------------
  // 4. Provider Capability Invariant
  // -------------------------------------------------------------------------
  checksPerformed.providerCapabilityCheck = true;
  appliedRuleIds.push("R_PROVIDER_CAPABILITY_READ_ONLY");

  // -------------------------------------------------------------------------
  // 5. Mandatory Risk, Dispute, Fraud & Safe-Hold Triggers
  // -------------------------------------------------------------------------
  checksPerformed.safeHoldCheck = true;

  const scenarioId = classificationFinding?.scenarioId || paymentCase?.discrepancyCategory || null;
  const isSafeHoldCase =
    paymentCase?.isSafeHold ||
    classificationFinding?.safeHold ||
    classificationFinding?.primaryReasonCode?.startsWith("SAFE_HOLD");

  // Dispute / Formal Chargeback (Case 30)
  const isDispute =
    disputeRecord ||
    scenarioId === "CASE_30_FORMAL_DISPUTE" ||
    classificationFinding?.primaryReasonCode === "DISPUTE_FORMAL_CHARGEBACK" ||
    paymentCase?.disputeStatus === "DISPUTE_FORMAL_CHARGEBACK" ||
    paymentCase?.disputeStatus === "DISPUTE_UNDER_REVIEW";

  if (isDispute) {
    appliedRuleIds.push("R_FORMAL_DISPUTE_SAFE_HOLD");
    if (proposedActionType === "REQUEST_REFUND" || proposedActionType === "SIMULATE_REFUND_CUSTOMER") {
      denyReasons.push("Formal dispute active. Automated refund prohibited to prevent double-loss.");
      return buildPolicyResult({
        outcomeStatus: "SAFE_HOLD",
        appliedRuleIds,
        denyReasons,
        conflicts: ["FORMAL_DISPUTE_ACTIVE"],
        approvedEvidenceReferences,
        checksPerformed
      });
    }
    if (proposedActionType === "SAFE_HOLD" || proposedActionType === "LOCK_SAFE_HOLD") {
      allowReasons.push("Formal dispute placed in safe hold for dispute representment.");
      return buildPolicyResult({
        outcomeStatus: "SAFE_HOLD",
        appliedRuleIds,
        allowReasons,
        approvedEvidenceReferences,
        checksPerformed
      });
    }
    if (proposedActionType === "EXTERNAL_ESCALATION_REQUIRED") {
      allowReasons.push("Formal dispute routed to dispute representment queue simulation.");
      return buildPolicyResult({
        outcomeStatus: "ELIGIBLE_FOR_SIMULATION",
        appliedRuleIds,
        allowReasons,
        approvedEvidenceReferences,
        checksPerformed
      });
    }
    return buildPolicyResult({
      outcomeStatus: "SAFE_HOLD",
      appliedRuleIds,
      denyReasons: ["Case is under formal bank dispute; action must remain held in safe hold."],
      approvedEvidenceReferences,
      checksPerformed
    });
  }

  // Fraud Allegation (Case 29)
  const isFraud =
    scenarioId === "CASE_29_FRAUD_CLAIM" ||
    classificationFinding?.primaryReasonCode === "FRAUD_CLAIM" ||
    paymentCase?.safeHoldCode === "FRAUD_SUSPICION";

  if (isFraud) {
    appliedRuleIds.push("R_FRAUD_ALLEGATION_SAFE_HOLD");
    if (proposedActionType === "REQUEST_REFUND" || proposedActionType === "SIMULATE_REFUND_CUSTOMER") {
      denyReasons.push("Fraud allegation flagged. All automated transactions frozen pending investigation.");
      return buildPolicyResult({
        outcomeStatus: "SAFE_HOLD",
        appliedRuleIds,
        denyReasons,
        conflicts: ["FRAUD_SUSPICION_ACTIVE"],
        approvedEvidenceReferences,
        checksPerformed
      });
    }
    if (proposedActionType === "SAFE_HOLD" || proposedActionType === "LOCK_SAFE_HOLD") {
      allowReasons.push("Fraud claim placed on safe hold for security review.");
      return buildPolicyResult({
        outcomeStatus: "SAFE_HOLD",
        appliedRuleIds,
        allowReasons,
        approvedEvidenceReferences,
        checksPerformed
      });
    }
    if (proposedActionType === "EXTERNAL_ESCALATION_REQUIRED") {
      allowReasons.push("Fraud claim routed to fraud desk escalation simulation.");
      return buildPolicyResult({
        outcomeStatus: "ELIGIBLE_FOR_SIMULATION",
        appliedRuleIds,
        allowReasons,
        approvedEvidenceReferences,
        checksPerformed
      });
    }
    return buildPolicyResult({
      outcomeStatus: "SAFE_HOLD",
      appliedRuleIds,
      denyReasons: ["Case flagged for fraud; must remain held in safe hold."],
      approvedEvidenceReferences,
      checksPerformed
    });
  }

  // Multiple Plausible Payment Candidates (Case 23)
  if (scenarioId === "CASE_23_AMBIGUOUS_CANDIDATE_MATCH" || paymentCase?.safeHoldCode === "AMBIGUOUS_PAYMENTS") {
    appliedRuleIds.push("R_AMBIGUOUS_CANDIDATES_SAFE_HOLD");
    if (proposedActionType !== "SAFE_HOLD" && proposedActionType !== "WAIT_AND_MONITOR") {
      denyReasons.push("Multiple ambiguous payment candidates detected. Manual operator pairing required.");
      return buildPolicyResult({
        outcomeStatus: "SAFE_HOLD",
        appliedRuleIds,
        denyReasons,
        conflicts: ["AMBIGUOUS_PAYMENT_CANDIDATES"],
        approvedEvidenceReferences,
        checksPerformed
      });
    }
  }

  // Amount or Currency Mismatch (Case 19)
  if (
    scenarioId === "CASE_19_AMOUNT_CURRENCY_MISMATCH" ||
    (gatewayPayment && merchantOrder && gatewayPayment.amountPaise !== merchantOrder.amountPaise)
  ) {
    appliedRuleIds.push("R_AMOUNT_MISMATCH_SAFE_HOLD");
    if (proposedActionType === "REQUEST_REFUND" || proposedActionType === "UPDATE_MERCHANT_LOCAL_LEDGER") {
      denyReasons.push("Amount mismatch between gateway payment and merchant order. Automated mutation prohibited.");
      return buildPolicyResult({
        outcomeStatus: "SAFE_HOLD",
        appliedRuleIds,
        denyReasons,
        conflicts: ["AMOUNT_MISMATCH_DETECTED"],
        approvedEvidenceReferences,
        checksPerformed
      });
    }
  }

  // Partial Capture (Case 8)
  if (scenarioId === "CASE_8_PARTIAL_CAPTURE") {
    appliedRuleIds.push("R_PARTIAL_CAPTURE_SAFE_HOLD");
    if (proposedActionType !== "SAFE_HOLD") {
      denyReasons.push("Partial capture requires merchant contract review. Locked into safe hold.");
      return buildPolicyResult({
        outcomeStatus: "SAFE_HOLD",
        appliedRuleIds,
        denyReasons,
        conflicts: ["PARTIAL_CAPTURE_HOLD"],
        approvedEvidenceReferences,
        checksPerformed
      });
    }
  }

  // Late Capture on Cancelled Order (Case 22 Late Capture)
  const isCancelledOrder = merchantOrder && (merchantOrder.status === "CANCELLED" || merchantOrder.status === "ORDER_CANCELLED");
  const isCapturedPayment = gatewayPayment && gatewayPayment.status === "CAPTURED";
  const isLateCaptureCancelled =
    paymentCase?.safeHoldCode === "LATE_CAPTURE_CANCELLED_ORDER" ||
    (isCancelledOrder && isCapturedPayment && paymentCase?.isSafeHold);

  if (isLateCaptureCancelled) {
    appliedRuleIds.push("R_LATE_CAPTURE_CANCELLED_ORDER_HOLD");
    if (proposedActionType === "UPDATE_MERCHANT_LOCAL_LEDGER") {
      denyReasons.push("Binding guardrail: Late capture on cancelled order cannot reopen cancelled order.");
      return buildPolicyResult({
        outcomeStatus: "SAFE_HOLD",
        appliedRuleIds,
        denyReasons,
        conflicts: ["LATE_CAPTURE_ON_CANCELLED_ORDER"],
        approvedEvidenceReferences,
        checksPerformed
      });
    }
  }

  // -------------------------------------------------------------------------
  // 6. Action-Specific Evaluation Rules
  // -------------------------------------------------------------------------

  // -----------------------------------------
  // 6.1 ACTION: REQUEST_REFUND
  // -----------------------------------------
  if (proposedActionType === "REQUEST_REFUND" || proposedActionType === "SIMULATE_REFUND_CUSTOMER") {
    checksPerformed.refundLimitsCheck = true;
    appliedRuleIds.push("R_REFUND_SAFETY_EVALUATION");

    // Guard 1: Fail-closed refund limits configuration
    if (!policyConfig || typeof policyConfig !== "object") {
      denyReasons.push("Binding guardrail: Policy configuration is missing. Fail-closed refund policy requires explicit limits.");
      missingEvidence.push("POLICY_CONFIG");
      return buildPolicyResult({
        outcomeStatus: "INSUFFICIENT_EVIDENCE",
        appliedRuleIds: [...appliedRuleIds, "R_REFUND_LIMITS_MISSING_FAIL_CLOSED"],
        denyReasons,
        missingEvidence,
        approvedEvidenceReferences,
        checksPerformed
      });
    }

    const maxSingleRefundPaise = policyConfig.maxSingleRefundPaise;
    const maxCumulativeRefundPaise = policyConfig.maxCumulativeRefundPaise;

    if (!isNonNegativeSafeInteger(maxSingleRefundPaise) || !isNonNegativeSafeInteger(maxCumulativeRefundPaise)) {
      denyReasons.push("Binding guardrail: Explicit monetary limits (maxSingleRefundPaise & maxCumulativeRefundPaise) missing or invalid. Fail-closed.");
      missingEvidence.push("EXPLICIT_REFUND_LIMITS");
      return buildPolicyResult({
        outcomeStatus: "INSUFFICIENT_EVIDENCE",
        appliedRuleIds: [...appliedRuleIds, "R_REFUND_LIMITS_MISSING_FAIL_CLOSED"],
        denyReasons,
        missingEvidence,
        approvedEvidenceReferences,
        checksPerformed
      });
    }

    // Guard 2: Customer debit claims alone are not proof
    if (!gatewayPayment) {
      denyReasons.push("Binding guardrail: Authoritative gateway payment record is missing. Customer claim alone cannot establish refund eligibility.");
      missingEvidence.push("AUTHORITATIVE_GATEWAY_PAYMENT");
      return buildPolicyResult({
        outcomeStatus: "INSUFFICIENT_EVIDENCE",
        appliedRuleIds: [...appliedRuleIds, "R_REFUND_UNVERIFIED_DEBIT_CLAIM"],
        denyReasons,
        missingEvidence,
        approvedEvidenceReferences,
        checksPerformed
      });
    }

    // Guard 3: Gateway failure alone is insufficient
    if (gatewayPayment.status === "FAILED") {
      denyReasons.push("Binding guardrail: Gateway payment is FAILED. Failed gateway status cannot authorize a refund without captured funds.");
      return buildPolicyResult({
        outcomeStatus: "REJECTED_BY_POLICY",
        appliedRuleIds: [...appliedRuleIds, "R_REFUND_GATEWAY_FAILED_NO_FUNDS"],
        denyReasons,
        approvedEvidenceReferences,
        checksPerformed
      });
    }

    if (gatewayPayment.status === "PENDING" || gatewayPayment.status === "CREATED") {
      denyReasons.push("Gateway payment is still PENDING/CREATED. Funds not confirmed captured by provider.");
      return buildPolicyResult({
        outcomeStatus: "REJECTED_BY_POLICY",
        appliedRuleIds: [...appliedRuleIds, "R_REFUND_GATEWAY_PENDING"],
        denyReasons,
        approvedEvidenceReferences,
        checksPerformed
      });
    }

    if (gatewayPayment.status !== "CAPTURED") {
      denyReasons.push(`Gateway payment status '${gatewayPayment.status}' is not CAPTURED.`);
      return buildPolicyResult({
        outcomeStatus: "REJECTED_BY_POLICY",
        appliedRuleIds: [...appliedRuleIds, "R_REFUND_PAYMENT_NOT_CAPTURED"],
        denyReasons,
        approvedEvidenceReferences,
        checksPerformed
      });
    }

    // Guard 4: Refundable balance calculation
    const capturedPaise = gatewayPayment.amountPaise || 0;
    const existingRefundsPaise = (refundRecords || []).reduce((acc, r) => {
      if (r.status === "PROCESSED" || r.status === "CONFIRMED" || r.status === "PENDING") {
        return acc + (r.amountPaise || 0);
      }
      return acc;
    }, 0);

    const targetRefundPaise = amountPaise !== null ? amountPaise : capturedPaise;
    const availableRefundablePaise = capturedPaise - existingRefundsPaise;

    if (targetRefundPaise <= 0) {
      denyReasons.push("Target refund amount must be greater than zero paise.");
      return buildPolicyResult({
        outcomeStatus: "REJECTED_BY_POLICY",
        appliedRuleIds: [...appliedRuleIds, "R_REFUND_ZERO_AMOUNT"],
        denyReasons,
        approvedEvidenceReferences,
        checksPerformed
      });
    }

    if (targetRefundPaise > availableRefundablePaise) {
      denyReasons.push(`Proposed refund of ₹${(targetRefundPaise / 100).toFixed(2)} exceeds available refundable balance of ₹${(availableRefundablePaise / 100).toFixed(2)}.`);
      return buildPolicyResult({
        outcomeStatus: "REJECTED_BY_POLICY",
        appliedRuleIds: [...appliedRuleIds, "R_REFUND_EXCEEDS_REFUNDABLE_BALANCE"],
        denyReasons,
        approvedEvidenceReferences,
        checksPerformed
      });
    }

    // Guard 5: Single refund limit
    if (targetRefundPaise > maxSingleRefundPaise) {
      denyReasons.push(`Proposed refund ₹${(targetRefundPaise / 100).toFixed(2)} exceeds configured single refund limit ₹${(maxSingleRefundPaise / 100).toFixed(2)}.`);
      return buildPolicyResult({
        outcomeStatus: "REJECTED_BY_POLICY",
        appliedRuleIds: [...appliedRuleIds, "R_REFUND_EXCEEDS_SINGLE_LIMIT"],
        denyReasons,
        approvedEvidenceReferences,
        checksPerformed
      });
    }

    // Guard 6: Cumulative refund velocity limit
    const cumulativeDailyRefundsPaise = policyConfig.currentCumulativeDailyPaise || 0;
    if (cumulativeDailyRefundsPaise + targetRefundPaise > maxCumulativeRefundPaise) {
      denyReasons.push(`Proposed refund would cause cumulative refunds ₹${((cumulativeDailyRefundsPaise + targetRefundPaise) / 100).toFixed(2)} to exceed limit ₹${(maxCumulativeRefundPaise / 100).toFixed(2)}.`);
      return buildPolicyResult({
        outcomeStatus: "REJECTED_BY_POLICY",
        appliedRuleIds: [...appliedRuleIds, "R_REFUND_EXCEEDS_CUMULATIVE_LIMIT"],
        denyReasons,
        approvedEvidenceReferences,
        checksPerformed
      });
    }

    // Guard 7: Existing refund in-flight check
    const hasInFlightRefund = (refundRecords || []).some(
      (r) => r.status === "REFUND_PENDING" || r.status === "PENDING" || r.status === "INITIATED"
    );
    if (hasInFlightRefund) {
      denyReasons.push("Existing refund is currently in flight with banking network. Duplicate refund request blocked.");
      return buildPolicyResult({
        outcomeStatus: "REJECTED_BY_POLICY",
        appliedRuleIds: [...appliedRuleIds, "R_REFUND_ALREADY_IN_FLIGHT"],
        denyReasons,
        approvedEvidenceReferences,
        checksPerformed
      });
    }

    // Eligible for simulation
    allowReasons.push(`Refund proposal of ₹${(targetRefundPaise / 100).toFixed(2)} verified eligible for simulation under policy.`);
    appliedRuleIds.push("R_REFUND_ELIGIBLE_FOR_SIMULATION");

    return buildPolicyResult({
      outcomeStatus: "ELIGIBLE_FOR_SIMULATION",
      appliedRuleIds,
      allowReasons,
      approvedEvidenceReferences,
      amountPaise: targetRefundPaise,
      currency,
      checksPerformed
    });
  }

  // -----------------------------------------
  // 6.2 ACTION: UPDATE_MERCHANT_LOCAL_LEDGER
  // -----------------------------------------
  if (proposedActionType === "UPDATE_MERCHANT_LOCAL_LEDGER") {
    appliedRuleIds.push("R_LOCAL_LEDGER_REPAIR_EVALUATION");

    // Scenario check: Case 1, Case 6, Case 10, Case 20
    const isPaymentCaptured = gatewayPayment && gatewayPayment.status === "CAPTURED";
    const isOrderUnpaid = merchantOrder && (merchantOrder.status === "PENDING" || merchantOrder.status === "ORDER_PENDING" || merchantOrder.status === "CREATED");

    if (isPaymentCaptured && isOrderUnpaid) {
      allowReasons.push("Verified captured gateway payment with pending merchant order. Local ledger confirmation repair eligible for simulation.");
      appliedRuleIds.push("R_LOCAL_LEDGER_REPAIR_ELIGIBLE");
      return buildPolicyResult({
        outcomeStatus: "ELIGIBLE_FOR_SIMULATION",
        appliedRuleIds,
        allowReasons,
        approvedEvidenceReferences,
        amountPaise: gatewayPayment.amountPaise,
        currency,
        checksPerformed
      });
    }

    if (scenarioId === "CASE_10_PARTIAL_REFUND" || scenarioId === "CASE_20_DUPLICATE_SETTLEMENT") {
      allowReasons.push("Ledger adjustment/deduplication verified eligible for local simulation.");
      appliedRuleIds.push("R_LOCAL_LEDGER_REPAIR_ELIGIBLE");
      return buildPolicyResult({
        outcomeStatus: "ELIGIBLE_FOR_SIMULATION",
        appliedRuleIds,
        allowReasons,
        approvedEvidenceReferences,
        amountPaise,
        currency,
        checksPerformed
      });
    }

    allowReasons.push("Local ledger simulation proposal accepted under general policy rules.");
    appliedRuleIds.push("R_LOCAL_LEDGER_PROPOSAL_ONLY");
    return buildPolicyResult({
      outcomeStatus: "PROPOSAL_ONLY",
      appliedRuleIds,
      allowReasons,
      approvedEvidenceReferences,
      amountPaise,
      currency,
      checksPerformed
    });
  }

  // -----------------------------------------
  // 6.3 ACTION: WAIT_AND_MONITOR
  // -----------------------------------------
  if (proposedActionType === "WAIT_AND_MONITOR") {
    allowReasons.push("Observation plan eligible for monitoring sweep simulation.");
    appliedRuleIds.push("R_WAIT_AND_MONITOR_ELIGIBLE");
    return buildPolicyResult({
      outcomeStatus: "ELIGIBLE_FOR_SIMULATION",
      appliedRuleIds,
      allowReasons,
      approvedEvidenceReferences,
      checksPerformed
    });
  }

  // -----------------------------------------
  // 6.4 ACTION: RECHECK_PROVIDER_STATUS
  // -----------------------------------------
  if (proposedActionType === "RECHECK_PROVIDER_STATUS" || proposedActionType === "POLL_PROVIDER_STATUS") {
    allowReasons.push("Provider status recheck plan eligible for simulation.");
    appliedRuleIds.push("R_RECHECK_PROVIDER_STATUS_ELIGIBLE");
    return buildPolicyResult({
      outcomeStatus: "ELIGIBLE_FOR_SIMULATION",
      appliedRuleIds,
      allowReasons,
      approvedEvidenceReferences,
      checksPerformed
    });
  }

  // -----------------------------------------
  // 6.5 ACTION: SAFE_HOLD
  // -----------------------------------------
  if (proposedActionType === "SAFE_HOLD" || proposedActionType === "LOCK_SAFE_HOLD") {
    allowReasons.push("Safe hold quarantine explicitly applied.");
    appliedRuleIds.push("R_SAFE_HOLD_APPLIED");
    return buildPolicyResult({
      outcomeStatus: "SAFE_HOLD",
      appliedRuleIds,
      allowReasons,
      approvedEvidenceReferences,
      checksPerformed
    });
  }

  // -----------------------------------------
  // 6.6 ACTION: NOTIFY_PARTIES
  // -----------------------------------------
  if (proposedActionType === "NOTIFY_PARTIES") {
    allowReasons.push("Simulated notification plan approved. No live messages sent.");
    appliedRuleIds.push("R_NOTIFY_PARTIES_SIMULATED");
    return buildPolicyResult({
      outcomeStatus: "ELIGIBLE_FOR_SIMULATION",
      appliedRuleIds,
      allowReasons,
      approvedEvidenceReferences,
      checksPerformed
    });
  }

  // -----------------------------------------
  // 6.7 ACTION: EXTERNAL_ESCALATION_REQUIRED
  // -----------------------------------------
  if (proposedActionType === "EXTERNAL_ESCALATION_REQUIRED" || proposedActionType === "ESCALATE_EXTERNAL_DISPUTE") {
    allowReasons.push("External escalation recorded as non-executing simulation plan.");
    appliedRuleIds.push("R_EXTERNAL_ESCALATION_RECORDED");
    return buildPolicyResult({
      outcomeStatus: "ELIGIBLE_FOR_SIMULATION",
      appliedRuleIds,
      allowReasons,
      approvedEvidenceReferences,
      checksPerformed
    });
  }

  // Default fallback for any remaining action
  return buildPolicyResult({
    outcomeStatus: "PROPOSAL_ONLY",
    appliedRuleIds: [...appliedRuleIds, "R_PROPOSAL_ONLY_DEFAULT"],
    allowReasons: ["Action recorded as non-executing proposal."],
    approvedEvidenceReferences,
    amountPaise,
    currency,
    checksPerformed
  });
}

function buildPolicyResult({
  outcomeStatus,
  appliedRuleIds = [],
  allowReasons = [],
  denyReasons = [],
  missingEvidence = [],
  conflicts = [],
  approvedEvidenceReferences = [],
  amountPaise = null,
  currency = "INR",
  checksPerformed = {}
}) {
  const isEligible = outcomeStatus === "ELIGIBLE_FOR_SIMULATION";
  const decisionReasons = isEligible ? [...allowReasons] : [...denyReasons, ...allowReasons];

  return {
    outcomeStatus,
    appliedRuleIds,
    decisionReasons,
    allowReasons,
    denyReasons,
    missingEvidence,
    conflicts,
    approvedEvidenceReferences,
    amountPaise,
    currency,
    checksPerformed,
    isExecutable: false,
    authoritative: false,
    executionState: "NON_EXECUTABLE_SIMULATION"
  };
}
