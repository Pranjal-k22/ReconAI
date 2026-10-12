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
    aiAdvisoryCheck: false,
    duplicateEvidenceCheck: false
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
    paymentCase = null,
    duplicatePayments = [],
    inFlightCommitmentsPaise = 0
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
  // 5. Scenario Mapping & Provenance Rules
  // -------------------------------------------------------------------------
  const scenarioId = classificationFinding?.scenarioId || paymentCase?.discrepancyCategory || null;

  // Case 1 vs Case 6: Provenance Reconciliation
  if (scenarioId === "CASE_1_FRONTEND_TIMEOUT_PAYMENT_SUCCESS") {
    const hasServerVerifiedTelemetry = authoritativeEvidence.serverVerifiedTelemetry === true;
    if (!hasServerVerifiedTelemetry) {
      appliedRuleIds.push("R_UNVERIFIED_TIMEOUT_FALLBACK_TO_STATUS_MISMATCH");
      allowReasons.push(
        "Client timeout telemetry unverified from server source. Evaluated under status-mismatch local ledger repair policy without causal inference."
      );
    }
  }

  // -------------------------------------------------------------------------
  // 6. Mandatory Risk, Dispute, Fraud & Safe-Hold Triggers
  // -------------------------------------------------------------------------
  checksPerformed.safeHoldCheck = true;

  // Dispute / Formal Chargeback (Case 30)
  const isDispute =
    disputeRecord ||
    scenarioId === "CASE_30_FORMAL_DISPUTE" ||
    scenarioId === "CASE_30_CHARGEBACK_OR_FORMAL_DISPUTE" ||
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
    scenarioId === "CASE_29_FRAUD_ALLEGATION_UNAUTHORIZED_PAYMENT" ||
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
  if (
    scenarioId === "CASE_23_AMBIGUOUS_CANDIDATE_MATCH" ||
    scenarioId === "CASE_23_AMBIGUOUS_PAYMENT_CANDIDATES" ||
    paymentCase?.safeHoldCode === "AMBIGUOUS_PAYMENTS" ||
    authoritativeEvidence.isAmbiguous === true
  ) {
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
    scenarioId === "CASE_19_AMOUNT_OR_CURRENCY_MISMATCH" ||
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

  // Late Capture on Cancelled Order (Case 22)
  const isCancelledOrder = merchantOrder && (merchantOrder.status === "CANCELLED" || merchantOrder.status === "ORDER_CANCELLED");
  const isCapturedPayment = gatewayPayment && gatewayPayment.status === "CAPTURED";
  const isCase22 =
    scenarioId === "CASE_22_CANCELLED_ORDER_CAPTURED" ||
    scenarioId === "CASE_22_PAYMENT_CAPTURED_ORDER_CANCELLED" ||
    paymentCase?.safeHoldCode === "LATE_CAPTURE_CANCELLED_ORDER" ||
    (isCancelledOrder && isCapturedPayment);

  if (isCase22) {
    if (proposedActionType === "UPDATE_MERCHANT_LOCAL_LEDGER") {
      denyReasons.push("Binding guardrail: Late capture on cancelled order cannot reopen cancelled order.");
    } else {
      denyReasons.push(
        "Binding guardrail: Late capture associated with cancelled order must remain on safe hold. Automated refund simulation is prohibited. Caller-supplied approval flags and AI suggestions are rejected as non-authoritative."
      );
    }
    return buildPolicyResult({
      outcomeStatus: "SAFE_HOLD",
      appliedRuleIds: [...appliedRuleIds, "R_LATE_CAPTURE_CANCELLED_ORDER_HOLD"],
      denyReasons,
      conflicts: ["LATE_CAPTURE_ON_CANCELLED_ORDER"],
      approvedEvidenceReferences,
      checksPerformed
    });
  }

  // -------------------------------------------------------------------------
  // 7. Case 7 Conclusive Duplicate Payment Verification
  // -------------------------------------------------------------------------
  const isDuplicateScenario =
    scenarioId === "CASE_7_DUPLICATE_PAYMENT" ||
    scenarioId === "CASE_7_DUPLICATE_PAYMENT_ATTEMPTS" ||
    classificationFinding?.primaryReasonCode === "DUPLICATE_PAYMENT";

  if (isDuplicateScenario && (proposedActionType === "REQUEST_REFUND" || proposedActionType === "SIMULATE_REFUND_CUSTOMER")) {
    checksPerformed.duplicateEvidenceCheck = true;

    // Conclusive check 1: Must have at least two distinct payment records
    if (!Array.isArray(duplicatePayments) || duplicatePayments.length < 2) {
      denyReasons.push("Duplicate payment evidence inconclusive: at least two distinct payment attempts are required.");
      missingEvidence.push("DISTINCT_DUPLICATE_PAYMENTS");
      return buildPolicyResult({
        outcomeStatus: "INSUFFICIENT_EVIDENCE",
        appliedRuleIds: [...appliedRuleIds, "R_DUPLICATE_EVIDENCE_INSUFFICIENT"],
        denyReasons,
        missingEvidence,
        approvedEvidenceReferences,
        checksPerformed
      });
    }

    // Conclusive check 2: Distinct identifiers
    const paymentIds = duplicatePayments.map((p) => p.gatewayPaymentId).filter(Boolean);
    const uniquePaymentIds = new Set(paymentIds);
    if (uniquePaymentIds.size < 2) {
      denyReasons.push("Duplicate payment evidence inconclusive: gatewayPaymentIds are identical or missing.");
      return buildPolicyResult({
        outcomeStatus: "SAFE_HOLD",
        appliedRuleIds: [...appliedRuleIds, "R_DUPLICATE_IDENTIFIERS_NOT_DISTINCT"],
        denyReasons,
        conflicts: ["NON_DISTINCT_PAYMENT_IDS"],
        approvedEvidenceReferences,
        checksPerformed
      });
    }

    // Conclusive check 3: Cross-tenant isolation
    const hasCrossTenantPayment = duplicatePayments.some((p) => p.tenantId && p.tenantId !== tenantId);
    if (hasCrossTenantPayment) {
      return buildPolicyResult({
        outcomeStatus: "REJECTED_BY_POLICY",
        appliedRuleIds: [...appliedRuleIds, "R_CROSS_TENANT_PAYMENT_BLOCKED"],
        denyReasons: ["Cross-tenant duplicate payment candidate rejected."],
        conflicts: ["CROSS_TENANT_DUPLICATE_ATTEMPT"],
        checksPerformed
      });
    }

    // Conclusive check 4: Correlated order ID match
    const orderIds = duplicatePayments.map((p) => p.merchantOrderId).filter(Boolean);
    const orderMismatch = orderIds.some((oid) => merchantOrder && oid !== merchantOrder.merchantOrderId);
    if (orderMismatch) {
      return buildPolicyResult({
        outcomeStatus: "SAFE_HOLD",
        appliedRuleIds: [...appliedRuleIds, "R_CONFLICTING_ORDER_PAYMENT_LINK"],
        denyReasons: ["Duplicate payment attempts reference conflicting merchantOrderId."],
        conflicts: ["MISMATCHED_ORDER_IDS"],
        checksPerformed
      });
    }

    // Conclusive check 5: Authoritative captured status on both payments
    const hasUncapturedPayment = duplicatePayments.some((p) => p.status !== "CAPTURED");
    if (hasUncapturedPayment) {
      denyReasons.push("Both duplicate payments must be conclusively verified CAPTURED by provider.");
      return buildPolicyResult({
        outcomeStatus: "SAFE_HOLD",
        appliedRuleIds: [...appliedRuleIds, "R_DUPLICATE_PAYMENT_NOT_CAPTURED"],
        denyReasons,
        conflicts: ["UNVERIFIED_DUPLICATE_CAPTURE"],
        approvedEvidenceReferences,
        checksPerformed
      });
    }

    // Conclusive check 6: Amount and currency consistency
    const currencies = new Set(duplicatePayments.map((p) => p.currency));
    if (currencies.size > 1 || (merchantOrder && !currencies.has(merchantOrder.currency))) {
      return buildPolicyResult({
        outcomeStatus: "SAFE_HOLD",
        appliedRuleIds: [...appliedRuleIds, "R_AMOUNT_MISMATCH_SAFE_HOLD"],
        denyReasons: ["Duplicate payment currencies are inconsistent."],
        conflicts: ["CURRENCY_MISMATCH"],
        checksPerformed
      });
    }

    // Conclusive check 7: Ambiguity / confidence threshold check
    if (authoritativeEvidence.isAmbiguous || (authoritativeEvidence.candidateScore && authoritativeEvidence.candidateScore < 0.95)) {
      return buildPolicyResult({
        outcomeStatus: "SAFE_HOLD",
        appliedRuleIds: [...appliedRuleIds, "R_AMBIGUOUS_CANDIDATES_SAFE_HOLD"],
        denyReasons: ["Duplicate candidate is ambiguous or below 0.95 confidence threshold."],
        conflicts: ["AMBIGUOUS_DUPLICATE_CANDIDATE"],
        approvedEvidenceReferences,
        checksPerformed
      });
    }

    appliedRuleIds.push("R_CONCLUSIVE_DUPLICATE_PAYMENTS_VERIFIED");
  }

  // -------------------------------------------------------------------------
  // 8. Action-Specific Evaluation Rules
  // -------------------------------------------------------------------------

  // -----------------------------------------
  // 8.1 ACTION: REQUEST_REFUND
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
      denyReasons.push(
        "Binding guardrail: Explicit monetary limits (maxSingleRefundPaise & maxCumulativeRefundPaise) missing or invalid. Fail-closed."
      );
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
      denyReasons.push(
        "Binding guardrail: Authoritative gateway payment record is missing. Customer claim alone cannot establish refund eligibility."
      );
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

    // Guard 3: Currency matching check
    if (gatewayPayment.currency && gatewayPayment.currency !== currency) {
      denyReasons.push(`Currency mismatch: payment currency '${gatewayPayment.currency}' does not match refund currency '${currency}'. Fail closed.`);
      return buildPolicyResult({
        outcomeStatus: "REJECTED_BY_POLICY",
        appliedRuleIds: [...appliedRuleIds, "R_CURRENCY_MISMATCH_FAIL_CLOSED"],
        denyReasons,
        conflicts: ["CURRENCY_MISMATCH"],
        approvedEvidenceReferences,
        checksPerformed
      });
    }

    // Guard 4: Gateway status check (failed or pending cannot authorize refund)
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

    if (gatewayPayment.status !== "CAPTURED" && gatewayPayment.status !== "PARTIALLY_REFUNDED") {
      denyReasons.push(`Gateway payment status '${gatewayPayment.status}' is not CAPTURED.`);
      return buildPolicyResult({
        outcomeStatus: "REJECTED_BY_POLICY",
        appliedRuleIds: [...appliedRuleIds, "R_REFUND_PAYMENT_NOT_CAPTURED"],
        denyReasons,
        approvedEvidenceReferences,
        checksPerformed
      });
    }

    // Guard 5: Authoritative captured amount identification and conflict detection
    const candidateCapturedValues = [];
    if (typeof gatewayPayment.capturedAmountPaise === "number" && isNonNegativeSafeInteger(gatewayPayment.capturedAmountPaise)) {
      candidateCapturedValues.push({ source: "capturedAmountPaise", amount: gatewayPayment.capturedAmountPaise });
    }
    if (typeof gatewayPayment.amountCapturedPaise === "number" && isNonNegativeSafeInteger(gatewayPayment.amountCapturedPaise)) {
      candidateCapturedValues.push({ source: "amountCapturedPaise", amount: gatewayPayment.amountCapturedPaise });
    }
    if (
      gatewayPayment.rawData &&
      typeof gatewayPayment.rawData.amount_captured === "number" &&
      isNonNegativeSafeInteger(gatewayPayment.rawData.amount_captured)
    ) {
      candidateCapturedValues.push({ source: "rawData.amount_captured", amount: gatewayPayment.rawData.amount_captured });
    }

    // Fail closed if multiple candidate captured amounts disagree
    const distinctCapturedAmounts = new Set(candidateCapturedValues.map((v) => v.amount));
    if (distinctCapturedAmounts.size > 1) {
      denyReasons.push(
        `Conflicting captured amount evidence detected across provider fields (${candidateCapturedValues
          .map((v) => `${v.source}=${v.amount}`)
          .join(", ")}). Fail closed.`
      );
      return buildPolicyResult({
        outcomeStatus: "SAFE_HOLD",
        appliedRuleIds: [...appliedRuleIds, "R_CAPTURED_AMOUNT_CONFLICT_FAIL_CLOSED"],
        denyReasons,
        conflicts: ["CONFLICTING_CAPTURED_AMOUNT_EVIDENCE"],
        approvedEvidenceReferences,
        checksPerformed
      });
    }

    let authoritativeCapturedPaise = null;
    if (candidateCapturedValues.length > 0) {
      authoritativeCapturedPaise = candidateCapturedValues[0].amount;
    } else if (
      gatewayPayment.status === "CAPTURED" &&
      typeof gatewayPayment.amountPaise === "number" &&
      isNonNegativeSafeInteger(gatewayPayment.amountPaise)
    ) {
      authoritativeCapturedPaise = gatewayPayment.amountPaise;
    }

    // Partial capture verification
    if (
      scenarioId === "CASE_8_PARTIAL_CAPTURE" ||
      gatewayPayment.status === "PARTIAL_CAPTURE" ||
      gatewayPayment.status === "PARTIALLY_CAPTURED"
    ) {
      if (authoritativeCapturedPaise === null || authoritativeCapturedPaise === gatewayPayment.amountPaise) {
        denyReasons.push("Partial capture evidence missing verified captured amount. Locked into safe hold.");
        return buildPolicyResult({
          outcomeStatus: "SAFE_HOLD",
          appliedRuleIds: [...appliedRuleIds, "R_PARTIAL_CAPTURE_SAFE_HOLD"],
          denyReasons,
          conflicts: ["PARTIAL_CAPTURE_AMOUNT_UNVERIFIED"],
          approvedEvidenceReferences,
          checksPerformed
        });
      }
    }

    if (authoritativeCapturedPaise === null) {
      denyReasons.push("Authoritative captured amount cannot be established from provider evidence. Fail closed.");
      missingEvidence.push("AUTHORITATIVE_CAPTURED_AMOUNT");
      return buildPolicyResult({
        outcomeStatus: "INSUFFICIENT_EVIDENCE",
        appliedRuleIds: [...appliedRuleIds, "R_MISSING_CAPTURED_AMOUNT_EVIDENCE"],
        denyReasons,
        missingEvidence,
        approvedEvidenceReferences,
        checksPerformed
      });
    }

    // Guard 6: Deduct completed refunds, pending refunds, and in-flight commitments
    const completedRefundsPaise = (refundRecords || []).reduce((acc, r) => {
      if (r.status === "PROCESSED" || r.status === "CONFIRMED" || r.status === "REFUNDED") {
        return acc + (r.amountPaise || 0);
      }
      return acc;
    }, gatewayPayment.refundAmountPaise || 0);

    const pendingRefundsPaise = (refundRecords || []).reduce((acc, r) => {
      if (r.status === "REFUND_PENDING" || r.status === "PENDING" || r.status === "INITIATED") {
        return acc + (r.amountPaise || 0);
      }
      return acc;
    }, 0);

    const totalDeductionsPaise = completedRefundsPaise + pendingRefundsPaise + inFlightCommitmentsPaise;
    const availableRefundablePaise = Math.max(0, authoritativeCapturedPaise - totalDeductionsPaise);

    const targetRefundPaise = amountPaise !== null ? amountPaise : availableRefundablePaise;

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
      denyReasons.push(
        `Proposed refund of ₹${(targetRefundPaise / 100).toFixed(2)} exceeds available refundable balance of ₹${(
          availableRefundablePaise / 100
        ).toFixed(2)}.`
      );
      return buildPolicyResult({
        outcomeStatus: "REJECTED_BY_POLICY",
        appliedRuleIds: [...appliedRuleIds, "R_REFUND_EXCEEDS_REFUNDABLE_BALANCE"],
        denyReasons,
        approvedEvidenceReferences,
        checksPerformed
      });
    }

    // Guard 7: Single refund limit
    if (targetRefundPaise > maxSingleRefundPaise) {
      denyReasons.push(
        `Proposed refund ₹${(targetRefundPaise / 100).toFixed(2)} exceeds configured single refund limit ₹${(
          maxSingleRefundPaise / 100
        ).toFixed(2)}.`
      );
      return buildPolicyResult({
        outcomeStatus: "REJECTED_BY_POLICY",
        appliedRuleIds: [...appliedRuleIds, "R_REFUND_EXCEEDS_SINGLE_LIMIT"],
        denyReasons,
        approvedEvidenceReferences,
        checksPerformed
      });
    }

    // Guard 8: Cumulative refund velocity limit
    const cumulativeDailyRefundsPaise = policyConfig.currentCumulativeDailyPaise || 0;
    if (cumulativeDailyRefundsPaise + targetRefundPaise > maxCumulativeRefundPaise) {
      denyReasons.push(
        `Proposed refund would cause cumulative refunds ₹${((cumulativeDailyRefundsPaise + targetRefundPaise) / 100).toFixed(
          2
        )} to exceed limit ₹${(maxCumulativeRefundPaise / 100).toFixed(2)}.`
      );
      return buildPolicyResult({
        outcomeStatus: "REJECTED_BY_POLICY",
        appliedRuleIds: [...appliedRuleIds, "R_REFUND_EXCEEDS_CUMULATIVE_LIMIT"],
        denyReasons,
        approvedEvidenceReferences,
        checksPerformed
      });
    }

    // Guard 9: Existing refund in-flight check
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
  // 8.2 ACTION: UPDATE_MERCHANT_LOCAL_LEDGER
  // -----------------------------------------
  if (proposedActionType === "UPDATE_MERCHANT_LOCAL_LEDGER") {
    appliedRuleIds.push("R_LOCAL_LEDGER_REPAIR_EVALUATION");

    const isPaymentCaptured = gatewayPayment && gatewayPayment.status === "CAPTURED";
    const isOrderUnpaid =
      merchantOrder &&
      (merchantOrder.status === "PENDING" || merchantOrder.status === "ORDER_PENDING" || merchantOrder.status === "CREATED");

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

    if (
      scenarioId === "CASE_10_PARTIAL_REFUND" ||
      scenarioId === "CASE_20_DUPLICATE_SETTLEMENT" ||
      scenarioId === "CASE_20_DUPLICATE_SETTLEMENT_RECORD"
    ) {
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
  // 8.3 ACTION: WAIT_AND_MONITOR
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
  // 8.4 ACTION: RECHECK_PROVIDER_STATUS
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
  // 8.5 ACTION: SAFE_HOLD
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
  // 8.6 ACTION: NOTIFY_PARTIES
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
  // 8.7 ACTION: EXTERNAL_ESCALATION_REQUIRED
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
