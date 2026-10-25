import crypto from "crypto";
import { EvidenceRecord, SCENARIO_IDS } from "../../models/EvidenceRecord.js";
import { sanitizeMetadata } from "../../models/helpers/validators.js";

/**
 * ReconAI 2.0 - Deterministic Edge-Case Classification & Evidence Engine (Phase 6)
 *
 * Implements deterministic, explainable classification for the 30 approved payment
 * lifecycle edge cases. Distinguishes verified provider facts from customer claims,
 * identifies contradictions, stale events, and enforces safe-hold containment.
 *
 * GOVERNANCE RULES:
 * 1. Positive Provider Facts: Only verified provider events establish financial state.
 * 2. Claims vs Facts: Customer statements are claims, not bank debit proof.
 * 3. Timeout is Unknown: Timeouts never infer failure or refund eligibility.
 * 4. Late Capture on Cancelled Orders: Preserves cancellation under safe-hold.
 * 5. Strict Integer Math: Exact paise arithmetic; no floating point.
 * 6. Tenant Isolation: Rejects cross-tenant evidence.
 * 7. Untrusted Text Neutralization: Input text is sanitized; instructions ignored.
 * 8. Zero Financial Execution: Produces classifications & advisory recommendations only.
 *    Does not authorize, execute, enqueue, or enable financial mutations or ledger repairs.
 *    Phase 8 deterministic action eligibility matrix and Phase 7 AI agents are strictly isolated.
 */

const FRAUD_KEYWORDS_REGEX = /(?:unauthorized|stolen\s+card|fraud|compromised|hacked|stolen\s+phone|identity\s+theft|account\s+takeover)/i;

/**
 * Sanitizes customer or shop claim text to treat as inert string data and redact sensitive tokens.
 */
export function sanitizeClaimText(rawText) {
  if (!rawText || typeof rawText !== "string") return "";
  // Strip null bytes and truncate
  let sanitized = rawText.replace(/\0/g, "").slice(0, 500).trim();
  // Strip potential instruction injection prompts
  sanitized = sanitized.replace(/(?:ignore\s+all\s+previous\s+instructions|system\s+override|prompt\s+injection)/gi, "[REDACTED_PROMPT]");
  return sanitized;
}

/**
 * Deterministically classifies a payment scenario across the 30 approved edge cases.
 *
 * @param {Object} input
 * @param {Object|null} [input.gatewayPayment] - Verified gateway payment record
 * @param {Object|null} [input.merchantOrder] - Merchant order record
 * @param {Object|null} [input.paymentCase] - Existing payment case record
 * @param {Array} [input.lifecycleEvents] - Array of ingested lifecycle events
 * @param {Array} [input.settlementRecords] - Array of settlement batch records
 * @param {Array} [input.customerClaims] - Array of customer debit/fraud claims
 * @param {Object} [input.context] - Execution/runtime context
 * @returns {Object} Deterministic classification finding
 */
export function classifyPaymentScenario({
  gatewayPayment = null,
  merchantOrder = null,
  paymentCase = null,
  lifecycleEvents = [],
  settlementRecords = [],
  customerClaims = [],
  context = {}
} = {}) {
  const facts = [];
  const claims = [];
  const contradictions = [];
  const missingEvidence = [];
  const supportingEvidence = [];

  // Register verified provider payment facts if present
  if (gatewayPayment) {
    facts.push({
      dimension: "CAPTURE",
      value: gatewayPayment.status || "UNKNOWN",
      source: "GATEWAY_PAYMENT",
      authority: "PROVIDER_VERIFIED",
      verifiedAt: gatewayPayment.updatedAt || new Date(),
      evidenceRef: gatewayPayment.gatewayPaymentId || "PAYMENT_REF"
    });
    supportingEvidence.push({
      sourceSystem: "GATEWAY",
      entityType: "GatewayPayment",
      entityId: gatewayPayment.gatewayPaymentId || null,
      eventId: gatewayPayment.lastEventId || null,
      timestamp: gatewayPayment.updatedAt || new Date()
    });
  }

  // Register merchant order facts if present
  if (merchantOrder) {
    facts.push({
      dimension: "ORDER_STATE",
      value: merchantOrder.status || "UNKNOWN",
      source: "MERCHANT_ORDER",
      authority: "SYSTEM_RECORD",
      verifiedAt: merchantOrder.updatedAt || new Date(),
      evidenceRef: merchantOrder.merchantOrderId || "ORDER_REF"
    });
    supportingEvidence.push({
      sourceSystem: "MERCHANT",
      entityType: "MerchantOrder",
      entityId: merchantOrder.merchantOrderId || null,
      eventId: null,
      timestamp: merchantOrder.updatedAt || new Date()
    });
  }

  // Register settlement facts if present
  if (settlementRecords && settlementRecords.length > 0) {
    facts.push({
      dimension: "SETTLEMENT",
      value: settlementRecords[0].status || "SETTLEMENT_RECORDED",
      source: "SETTLEMENT_RECON",
      authority: "SETTLEMENT_BATCH",
      verifiedAt: settlementRecords[0].createdAt || new Date(),
      evidenceRef: settlementRecords[0].settlementRecordId || "SETTLEMENT_REF"
    });
    supportingEvidence.push({
      sourceSystem: "SETTLEMENT",
      entityType: "SettlementRecord",
      entityId: settlementRecords[0].settlementRecordId || null,
      eventId: null,
      timestamp: settlementRecords[0].createdAt || new Date()
    });
  }

  // Register customer claims as claims (NEVER as provider facts)
  if (customerClaims && customerClaims.length > 0) {
    for (const c of customerClaims) {
      const sanitizedText = sanitizeClaimText(c.text || c.claimType || "CUSTOMER_CLAIM");
      claims.push({
        claimType: c.claimType || "CUSTOMER_DEBIT_CLAIM",
        claimedValue: sanitizedText,
        source: "CUSTOMER_PORTAL",
        authority: "CUSTOMER_CLAIM",
        receivedAt: c.createdAt || new Date(),
        evidenceRef: c.claimId || "CLAIM_REF",
        verified: false // Customer claims are unverified claims by default
      });
      supportingEvidence.push({
        sourceSystem: "CUSTOMER",
        entityType: "CustomerClaim",
        entityId: c.claimId || null,
        eventId: null,
        timestamp: c.createdAt || new Date()
      });
    }
  }

  // -------------------------------------------------------------------------
  // Frontend Evidence Provenance & Trust Verification
  //
  // SECURITY INVARIANT:
  // Caller-provided context (e.g. context.authenticatedFrontendEvent, context.frontendTimeout)
  // is NEVER trusted as verified facts. An unauthenticated caller cannot pass a boolean
  // { authenticated: true } or forged IDs to elevate client claims into provider facts.
  //
  // Trusted frontend evidence requires authoritative server-side lifecycle ledger provenance:
  // 1. Must originate from an internal server system (sourceSystem === "RECONAI_SYSTEM" or "MERCHANT_ORDER")
  //    (never CUSTOMER_CLAIM, never untrusted caller input).
  // 2. Must possess authoritative server-side verification proof (serverVerifiedTelemetry === true).
  // 3. Must be strictly bound to the authoritative tenant (tenantId === targetTenantId).
  // 4. Must be strictly bound to the authoritative order (merchantOrderId === targetOrderId).
  // 5. If gatewayPaymentId is present on the event, must match targetPaymentId.
  // 6. Must not be corrupted (requires eventId and valid timeout/drop event type).
  // -------------------------------------------------------------------------
  const targetTenantId = gatewayPayment?.tenantId || merchantOrder?.tenantId || paymentCase?.tenantId || null;
  const targetOrderId = merchantOrder?.merchantOrderId || gatewayPayment?.merchantOrderId || null;
  const targetPaymentId = gatewayPayment?.gatewayPaymentId || null;

  // Unconditionally record any caller-supplied frontend claims in claims array as UNVERIFIED
  if (
    context.authenticatedFrontendEvent ||
    context.frontendTimeout === true ||
    context.browserDropped === true ||
    context.frontendEvent ||
    context.lifecycleEvents !== undefined ||
    context.serverVerifiedTelemetry !== undefined
  ) {
    claims.push({
      claimType: "FRONTEND_TIMEOUT_CLAIM",
      claimedValue: "Caller-supplied frontend checkout timeout claim (unverified; no client telemetry verification endpoint exists)",
      source: "UNAUTHENTICATED_CONTEXT",
      authority: "CUSTOMER_CLAIM",
      receivedAt: new Date(),
      evidenceRef: context.authenticatedFrontendEvent?.eventId || context.frontendEvent?.eventId || null,
      verified: false
    });
  }

  // Look for authoritative server-verified telemetry in lifecycleEvents only
  const trustedFrontendEvent = lifecycleEvents.find((e) => {
    // 1. Authoritative source only (never customer claims, never untrusted caller systems)
    if (e.sourceSystem !== "RECONAI_SYSTEM" && e.sourceSystem !== "MERCHANT_ORDER") {
      return false;
    }
    // 2. Explicit server verification proof
    if (e.serverVerifiedTelemetry !== true && e.metadata?.serverVerifiedTelemetry !== true) {
      return false;
    }
    // 3. Strict tenant boundary match (cannot reuse another tenant's telemetry)
    if (!targetTenantId || e.tenantId !== targetTenantId) {
      return false;
    }
    // 4. Strict order boundary match (cannot reuse another order's session)
    if (!targetOrderId || e.merchantOrderId !== targetOrderId) {
      return false;
    }
    // 5. Strict payment binding if specified
    if (e.gatewayPaymentId && targetPaymentId && e.gatewayPaymentId !== targetPaymentId) {
      return false;
    }
    // 6. Valid event type and eventId
    if (!e.eventId || typeof e.eventId !== "string" || e.eventId.trim().length === 0) {
      return false;
    }
    const evtType = e.normalizedEventType || e.metadata?.eventType || e.clientEvent;
    return evtType === "CHECKOUT_TIMEOUT" || evtType === "FRONTEND_DROPPED" || evtType === "FRONTEND_TIMEOUT";
  }) || null;

  if (trustedFrontendEvent) {
    facts.push({
      dimension: "FRONTEND_CHECKOUT",
      value: "CHECKOUT_TIMEOUT",
      source: trustedFrontendEvent.sourceSystem,
      authority: "SYSTEM_RECORD",
      verifiedAt: trustedFrontendEvent.occurredAt || trustedFrontendEvent.createdAt || new Date(),
      evidenceRef: trustedFrontendEvent.eventId
    });
    supportingEvidence.push({
      sourceSystem: trustedFrontendEvent.sourceSystem,
      entityType: "PaymentLifecycleEvent",
      entityId: trustedFrontendEvent.eventId,
      eventId: trustedFrontendEvent.eventId,
      timestamp: trustedFrontendEvent.occurredAt || new Date()
    });
  }

  // =========================================================================
  // 1. SECURITY & BOUNDARY RULES
  // =========================================================================

  // Case 28: Cross-Tenant Access Attempt
  const actorTenant = context.actorTenantId || context.tenantId || null;
  const entities = [gatewayPayment, merchantOrder, paymentCase, ...settlementRecords, ...customerClaims].filter(Boolean);
  const distinctTenants = new Set(entities.map((e) => e.tenantId).filter(Boolean));
  if (actorTenant && entities.some((e) => e.tenantId && e.tenantId !== actorTenant)) {
    distinctTenants.add("MISMATCHED_TENANT");
  }

  if (distinctTenants.size > 1 || context.crossTenantAttempt === true) {
    contradictions.push("Cross-tenant ownership boundary violated across records.");
    return {
      scenarioId: "CASE_28_CROSS_TENANT_ACCESS_ATTEMPT",
      category: "CROSS_TENANT_BLOCKED",
      reasonCode: "CROSS_TENANT_VIOLATION",
      ruleId: "RULE_CASE_28_CROSS_TENANT_VIOLATION",
      confidence: 1.0,
      facts,
      claims,
      contradictions,
      missingEvidence: [],
      safeHold: true,
      safeHoldCode: "POLICY_REJECTED",
      safeHoldReason: "Cross-tenant access or data correlation mismatch detected.",
      recommendation: "REJECT_CROSS_TENANT",
      suggestedNextStep: "ADVISORY_SECURITY_BLOCK",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: "Request or payload references mismatched tenant identifiers. Immediate security rejection enforced.",
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // Case 15: Forged Webhook
  if (context.incomingEvent?.signatureValid === false || context.signatureValid === false) {
    contradictions.push("Cryptographic HMAC-SHA256 signature verification failed.");
    return {
      scenarioId: "CASE_15_FORGED_WEBHOOK",
      category: "FORGED_WEBHOOK",
      reasonCode: "FORGED_WEBHOOK",
      ruleId: "RULE_CASE_15_FORGED_WEBHOOK",
      confidence: 1.0,
      facts: [
        ...facts,
        {
          dimension: "SYSTEM",
          value: "SIGNATURE_VERIFICATION_FAILED",
          source: "GATEWAY_WEBHOOK",
          authority: "SYSTEM_RECORD",
          verifiedAt: new Date(),
          evidenceRef: context.incomingEvent?.eventId || "FORGED_EVENT"
        }
      ],
      claims,
      contradictions,
      missingEvidence: [],
      safeHold: true,
      safeHoldCode: "POLICY_REJECTED",
      safeHoldReason: "Webhook payload failed cryptographic signature verification.",
      recommendation: "REJECT_FORGED_EVENT",
      suggestedNextStep: "ADVISORY_SECURITY_BLOCK",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: "Incoming webhook payload failed HMAC-SHA256 timing-safe signature comparison. Payload quarantined and dropped.",
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // Case 27: Concurrent Resolution Attempts
  if (context.concurrentAttempt?.lockConflict === true || context.lockConflict === true) {
    contradictions.push("Concurrency lock collision: case is currently locked by another worker lease.");
    return {
      scenarioId: "CASE_27_CONCURRENT_RESOLUTION_ATTEMPTS",
      category: "CONCURRENT_ATTEMPT",
      reasonCode: "CONCURRENT_MUTATION_RACE",
      ruleId: "RULE_CASE_27_CONCURRENT_MUTATION",
      confidence: 1.0,
      facts,
      claims,
      contradictions,
      missingEvidence: [],
      safeHold: false,
      safeHoldCode: "NONE",
      safeHoldReason: null,
      recommendation: "LOCK_ACQUISITION_REJECT",
      suggestedNextStep: "ADVISORY_REJECT_CONCURRENT_MUTATION",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: "Concurrent mutation attempt detected on active lease. Secondary attempt safely rejected without state mutation.",
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // Case 25: Database Outage During Action
  if (context.databaseError?.connectionDropped === true || context.databaseOutage === true) {
    contradictions.push("Database connection interrupted during operation.");
    const unresolvable = Boolean(context.unresolvableOnReconnect);
    return {
      scenarioId: "CASE_25_DATABASE_OUTAGE_DURING_ACTION",
      category: "DATABASE_OUTAGE_RECOVERY",
      reasonCode: "DATABASE_OUTAGE_RECOVERY",
      ruleId: "RULE_CASE_25_DATABASE_OUTAGE",
      confidence: 0.9,
      facts,
      claims,
      contradictions,
      missingEvidence: ["Database connectivity confirmation"],
      safeHold: unresolvable,
      safeHoldCode: unresolvable ? "DATABASE_OUTAGE_RECOVERY" : "NONE",
      safeHoldReason: unresolvable ? "Database outage recovery failed to reconcile provider state." : null,
      recommendation: "DATABASE_LEASE_RECOVERY",
      suggestedNextStep: "ADVISORY_RECOVER_DATABASE_LEASE",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: "Database network failure encountered during processing. In-flight action lease preserves state until safe reconnect query.",
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // Case 26: Worker Crash While Action Is Pending
  const isLeaseExpired =
    paymentCase?.resolutionCaseStatus === "CASE_ACTION_IN_PROGRESS" &&
    paymentCase?.actionLeaseExpiresAt &&
    new Date(paymentCase.actionLeaseExpiresAt) < new Date();

  if (isLeaseExpired || context.workerCrashedLeaseExpired === true) {
    const renewalCount = (paymentCase?.metadata?.leaseRenewalCount || context.leaseRenewalCount || 0);
    const excessiveExpirations = renewalCount >= 3;
    contradictions.push("Worker action lease expired without state finalization.");
    return {
      scenarioId: "CASE_26_WORKER_CRASH_ACTION_PENDING",
      category: "WORKER_LEASE_EXPIRED",
      reasonCode: "EXPIRED_LEASE_RECOVERY",
      ruleId: "RULE_CASE_26_EXPIRED_LEASE",
      confidence: 1.0,
      facts,
      claims,
      contradictions,
      missingEvidence: ["Worker completion heartbeat"],
      safeHold: excessiveExpirations,
      safeHoldCode: excessiveExpirations ? "WORKER_LEASE_EXPIRED" : "NONE",
      safeHoldReason: excessiveExpirations ? "Action lease expired more than 3 times." : null,
      recommendation: "EXPIRED_LEASE_RECLAIM",
      suggestedNextStep: "ADVISORY_RECLAIM_EXPIRED_LEASE",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: "Action lease expired while case in progress. Reclaimed by recovery scheduler to query provider idempotency key.",
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // Case 24: Provider Unavailable or Rate-Limited
  const isProviderThrottled =
    context.providerError?.status === 429 ||
    (context.providerError?.status >= 500 && context.providerError?.status < 600) ||
    context.providerError?.code === "RATE_LIMITED" ||
    context.providerError?.code === "GATEWAY_TIMEOUT";

  if (isProviderThrottled) {
    const attempts = context.providerError?.attempts || 1;
    const maxRetriesExceeded = attempts >= 5;
    return {
      scenarioId: "CASE_24_PROVIDER_UNAVAILABLE_RATE_LIMITED",
      category: "PROVIDER_UNAVAILABLE",
      reasonCode: "PROVIDER_THROTTLED_OR_UNAVAILABLE",
      ruleId: "RULE_CASE_24_PROVIDER_UNAVAILABLE",
      confidence: 1.0,
      facts,
      claims,
      contradictions: ["Provider returned HTTP 429 / 5xx error."],
      missingEvidence: ["Provider endpoint availability"],
      safeHold: maxRetriesExceeded,
      safeHoldCode: maxRetriesExceeded ? "PROVIDER_ERROR" : "NONE",
      safeHoldReason: maxRetriesExceeded ? "Provider API unavailable after 5 retries." : null,
      recommendation: "EXPONENTIAL_BACKOFF_RETRY",
      suggestedNextStep: "ADVISORY_EXPONENTIAL_BACKOFF_RETRY",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: `Provider API returned throttled or unavailable response (HTTP ${context.providerError?.status || "error"}). Retrying with jittered exponential backoff.`,
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // =========================================================================
  // 2. FORMAL DISPUTES & FRAUD ALLEGATIONS
  // =========================================================================

  // Case 30: Chargeback or Formal Dispute
  const hasDispute =
    context.incomingEvent?.eventType === "dispute.created" ||
    gatewayPayment?.dispute ||
    paymentCase?.disputeStatus === "DISPUTE_FORMAL_CHARGEBACK" ||
    context.formalDispute === true;

  if (hasDispute) {
    return {
      scenarioId: "CASE_30_CHARGEBACK_OR_FORMAL_DISPUTE",
      category: "FORMAL_DISPUTE",
      reasonCode: "FORMAL_DISPUTE",
      ruleId: "RULE_CASE_30_FORMAL_DISPUTE",
      confidence: 1.0,
      facts: [
        ...facts,
        {
          dimension: "DISPUTE",
          value: "DISPUTE_FORMAL_CHARGEBACK",
          source: "GATEWAY_WEBHOOK",
          authority: "PROVIDER_VERIFIED",
          verifiedAt: new Date(),
          evidenceRef: gatewayPayment?.gatewayPaymentId || "DISPUTE_REF"
        }
      ],
      claims,
      contradictions: ["Formal dispute opened by issuing bank."],
      missingEvidence: ["Merchant proof of fulfillment"],
      safeHold: true,
      safeHoldCode: "FORMAL_DISPUTE",
      safeHoldReason: "Formal chargeback opened with payment network. Automated refund prohibited.",
      recommendation: "ROUTE_TO_REPRESENTMENT_SAFE_HOLD",
      suggestedNextStep: "ADVISORY_HOLD_FOR_FORMAL_DISPUTE",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: "Formal dispute initiated by cardholder bank. Automated refunds are strictly frozen to prevent double loss; routed to evidence representment.",
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // Case 29: Fraud Allegation or Unauthorized Payment Claim
  const hasFraudClaim =
    customerClaims.some((c) => FRAUD_KEYWORDS_REGEX.test(c.text || "") || c.claimType === "FRAUD_CLAIM" || c.fraudAllegation === true) ||
    context.fraudAllegation === true ||
    (context.riskScore && context.riskScore > 85);

  if (hasFraudClaim) {
    return {
      scenarioId: "CASE_29_FRAUD_ALLEGATION_UNAUTHORIZED_PAYMENT",
      category: "FRAUD_CLAIM",
      reasonCode: "FRAUD_SUSPICION",
      ruleId: "RULE_CASE_29_FRAUD_SUSPICION",
      confidence: 0.95,
      facts,
      claims,
      contradictions: ["Cardholder claims transaction was unauthorized."],
      missingEvidence: ["Bank fraud report / police complaint verification"],
      safeHold: true,
      safeHoldCode: "FRAUD_SUSPICION",
      safeHoldReason: "Unauthorized payment or fraud allegation reported.",
      recommendation: "FREEZE_AUTOMATION_SAFE_HOLD",
      suggestedNextStep: "ADVISORY_FREEZE_AUTOMATION_SAFE_HOLD",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: "Fraud allegation or high-velocity risk flag detected. All automated actions frozen; placed under safe-hold for security review.",
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // =========================================================================
  // 3. EVENT REPLAY, DEDUPLICATION, STALE & OUT-OF-ORDER CHECKS
  // =========================================================================

  // Case 14: Duplicate Webhook Delivery
  if (context.isDuplicateWebhook === true || context.duplicateEvent === true) {
    return {
      scenarioId: "CASE_14_DUPLICATE_WEBHOOK_DELIVERY",
      category: "DUPLICATE_WEBHOOK",
      reasonCode: "DUPLICATE_WEBHOOK",
      ruleId: "RULE_CASE_14_DUPLICATE_WEBHOOK",
      confidence: 1.0,
      facts,
      claims,
      contradictions: [],
      missingEvidence: [],
      safeHold: false,
      safeHoldCode: "NONE",
      safeHoldReason: null,
      recommendation: "NO_OP_DUPLICATE_ACK",
      suggestedNextStep: "ADVISORY_ACKNOWLEDGE_DUPLICATE",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: "Duplicate webhook delivery recognized by durable event identity ledger. Acknowledged with HTTP 200 without duplicate mutation.",
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // Case 13: Stale Event After Refund / Terminal State
  const isTerminalState =
    paymentCase?.refundStatus === "REFUND_CONFIRMED" ||
    gatewayPayment?.status === "REFUNDED" ||
    (gatewayPayment?.status === "CAPTURED" && context.incomingEvent?.eventType === "payment.authorized");

  if (isTerminalState && context.isStaleEvent === true) {
    return {
      scenarioId: "CASE_13_STALE_EVENT_AFTER_REFUND",
      category: "STALE_EVENT_DELIVERY",
      reasonCode: "STALE_EVENT_DELIVERY",
      ruleId: "RULE_CASE_13_STALE_EVENT",
      confidence: 1.0,
      facts,
      claims,
      contradictions: ["Event timestamp precedes confirmed terminal state."],
      missingEvidence: [],
      safeHold: false,
      safeHoldCode: "NONE",
      safeHoldReason: null,
      recommendation: "NO_OP_DROP_STALE",
      suggestedNextStep: "ADVISORY_DROP_STALE_EVENT",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: "Incoming lifecycle event timestamp is stale relative to terminal canonical state. Dropped monotonically without state mutation.",
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // Case 16: Out-of-Order Webhooks
  if (
    context.incomingEvent?.eventType === "payment.captured" &&
    (!gatewayPayment || gatewayPayment.status === "CREATED" || gatewayPayment.status === "UNKNOWN") &&
    context.isOutOfOrder === true
  ) {
    return {
      scenarioId: "CASE_16_OUT_OF_ORDER_WEBHOOK",
      category: "OUT_OF_ORDER_WEBHOOK",
      reasonCode: "OUT_OF_ORDER_WEBHOOK",
      ruleId: "RULE_CASE_16_OUT_OF_ORDER_WEBHOOK",
      confidence: 0.95,
      facts,
      claims,
      contradictions: ["Intermediate payment.authorized event was skipped."],
      missingEvidence: ["Prior authorization receipt"],
      safeHold: false,
      safeHoldCode: "NONE",
      safeHoldReason: null,
      recommendation: "FORWARD_STATE_JUMP",
      suggestedNextStep: "ADVISORY_FORWARD_STATE_JUMP",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: "Advanced payment.captured webhook arrived out-of-order before authorization was registered. State progresses directly to CAPTURED.",
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // =========================================================================
  // 4. MULTI-CANDIDATE & RECORD LINKAGE AMBIGUITY
  // =========================================================================

  // Case 23: Multiple Plausible Payment Candidates (Ambiguity)
  if (
    context.ambiguousCandidates === true ||
    (context.candidateMatches && context.candidateMatches.length > 1 && (context.confidence || 0) < 0.95)
  ) {
    contradictions.push("Multiple unlinked gateway payments match order criteria.");
    return {
      scenarioId: "CASE_23_AMBIGUOUS_PAYMENT_CANDIDATES",
      category: "AMBIGUOUS_CANDIDATE_MATCH",
      reasonCode: "AMBIGUOUS_PAYMENTS",
      ruleId: "RULE_CASE_23_AMBIGUOUS_CANDIDATES",
      confidence: Number(context.confidence || 0.6),
      facts,
      claims,
      contradictions,
      missingEvidence: ["Definitive gateway-order linkage key"],
      safeHold: true,
      safeHoldCode: "AMBIGUOUS_PAYMENTS",
      safeHoldReason: "Multiple plausible payment candidates matched without deterministic linkage.",
      recommendation: "IMMEDIATE_SAFE_HOLD",
      suggestedNextStep: "ADVISORY_SAFE_HOLD_FOR_HUMAN_REVIEW",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: "Ambiguous payment pairing candidates detected. Confidence below threshold (< 0.95); immediate safe-hold enforced for operator review.",
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // Case 18: Conflicting Provider and Merchant Records
  const paymentOrderId = gatewayPayment?.merchantOrderId || gatewayPayment?.notes?.merchantOrderId || null;
  const directOrderId = merchantOrder?.merchantOrderId || null;
  if (
    paymentOrderId &&
    directOrderId &&
    paymentOrderId !== directOrderId &&
    context.conflictingRecords !== false
  ) {
    contradictions.push(`Gateway payment references order ${paymentOrderId}, but merchant order is ${directOrderId}.`);
    return {
      scenarioId: "CASE_18_CONFLICTING_PROVIDER_MERCHANT_RECORDS",
      category: "CONFLICTING_PROVIDER_MERCHANT_RECORDS",
      reasonCode: "CONFLICTING_PROVIDER_MERCHANT_RECORDS",
      ruleId: "RULE_CASE_18_CONFLICTING_RECORDS",
      confidence: 1.0,
      facts,
      claims,
      contradictions,
      missingEvidence: ["Intended order cross-reference authority"],
      safeHold: true,
      safeHoldCode: "CONFLICTING_PROVIDER_MERCHANT_RECORDS",
      safeHoldReason: "Conflicting order identifiers between gateway payment and merchant order.",
      recommendation: "IMMEDIATE_SAFE_HOLD",
      suggestedNextStep: "ADVISORY_SAFE_HOLD_FOR_HUMAN_REVIEW",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: "Cross-record conflict detected: provider notes point to a different order than merchant ledger. Placed in immediate safe hold.",
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // =========================================================================
  // 5. AMOUNT & CURRENCY INTEGRITY
  // =========================================================================

  // Currency mismatch check
  if (
    gatewayPayment &&
    merchantOrder &&
    gatewayPayment.currency &&
    merchantOrder.currency &&
    gatewayPayment.currency !== merchantOrder.currency
  ) {
    contradictions.push(`Currency mismatch: Payment is in ${gatewayPayment.currency}, Order is in ${merchantOrder.currency}.`);
    return {
      scenarioId: "CASE_19_AMOUNT_OR_CURRENCY_MISMATCH",
      category: "AMOUNT_CURRENCY_MISMATCH",
      reasonCode: "AMOUNT_CURRENCY_MISMATCH",
      ruleId: "RULE_CASE_19_AMOUNT_CURRENCY_MISMATCH",
      confidence: 1.0,
      facts,
      claims,
      contradictions,
      missingEvidence: [],
      safeHold: true,
      safeHoldCode: "AMOUNT_CURRENCY_MISMATCH",
      safeHoldReason: "Currency code mismatch between order and payment.",
      recommendation: "IMMEDIATE_SAFE_HOLD",
      suggestedNextStep: "ADVISORY_SAFE_HOLD_FOR_HUMAN_REVIEW",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: `Payment currency (${gatewayPayment.currency}) does not match order currency (${merchantOrder.currency}). Automation locked into safe hold.`,
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // Case 8: Partial Capture
  const amountCaptured = gatewayPayment?.amountCapturedPaise ?? gatewayPayment?.amountPaise ?? null;
  const amountAuthorized = gatewayPayment?.amountAuthorizedPaise ?? null;
  if (
    gatewayPayment?.status === "PARTIALLY_CAPTURED" ||
    (amountAuthorized && amountCaptured && amountCaptured < amountAuthorized) ||
    context.partialCapture === true
  ) {
    return {
      scenarioId: "CASE_8_PARTIAL_CAPTURE",
      category: "PARTIAL_CAPTURE",
      reasonCode: "PARTIAL_CAPTURE",
      ruleId: "RULE_CASE_8_PARTIAL_CAPTURE",
      confidence: 1.0,
      facts,
      claims,
      contradictions: ["Amount captured is less than authorized amount."],
      missingEvidence: ["Merchant partial fulfillment terms"],
      safeHold: true,
      safeHoldCode: "PARTIAL_CAPTURE",
      safeHoldReason: "Partial capture detected without approved merchant policy.",
      recommendation: "IMMEDIATE_SAFE_HOLD",
      suggestedNextStep: "ADVISORY_SAFE_HOLD_FOR_HUMAN_REVIEW",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: `Gateway amount captured (${amountCaptured} paise) is less than authorized (${amountAuthorized} paise). Safe hold applied.`,
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // Case 9: Partial Payment
  const isPartialPayment =
    gatewayPayment &&
    merchantOrder &&
    typeof gatewayPayment.amountPaise === "number" &&
    typeof merchantOrder.amountPaise === "number" &&
    gatewayPayment.amountPaise < merchantOrder.amountPaise &&
    context.isInstallment !== false &&
    !context.amountMismatch;

  if (isPartialPayment && context.partialPaymentExplicit === true) {
    const expired = Boolean(context.partialPaymentWindowExpired);
    return {
      scenarioId: "CASE_9_PARTIAL_PAYMENT",
      category: "PARTIAL_PAYMENT",
      reasonCode: "PARTIAL_PAYMENT",
      ruleId: "RULE_CASE_9_PARTIAL_PAYMENT",
      confidence: 1.0,
      facts,
      claims,
      contradictions: ["Payment amount is less than total merchant order amount."],
      missingEvidence: ["Second installment or balance payment"],
      safeHold: expired,
      safeHoldCode: expired ? "PARTIAL_PAYMENT" : "NONE",
      safeHoldReason: expired ? "Partial payment window expired without remaining balance." : null,
      recommendation: "HOLD_PARTIALLY_PAID",
      suggestedNextStep: "ADVISORY_HOLD_PARTIALLY_PAID",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: `Payment amount (${gatewayPayment.amountPaise} paise) is less than order amount (${merchantOrder.amountPaise} paise). Held in PARTIALLY_PAID.`,
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // Case 19: Amount Mismatch (non-partial)
  if (
    gatewayPayment &&
    merchantOrder &&
    typeof gatewayPayment.amountPaise === "number" &&
    typeof merchantOrder.amountPaise === "number" &&
    gatewayPayment.amountPaise !== merchantOrder.amountPaise &&
    !context.partialPaymentExplicit
  ) {
    contradictions.push(`Amount mismatch: Order is ${merchantOrder.amountPaise} paise, Payment is ${gatewayPayment.amountPaise} paise.`);
    return {
      scenarioId: "CASE_19_AMOUNT_OR_CURRENCY_MISMATCH",
      category: "AMOUNT_CURRENCY_MISMATCH",
      reasonCode: "AMOUNT_CURRENCY_MISMATCH",
      ruleId: "RULE_CASE_19_AMOUNT_CURRENCY_MISMATCH",
      confidence: 1.0,
      facts,
      claims,
      contradictions,
      missingEvidence: ["Authorized discount code or pricing override"],
      safeHold: true,
      safeHoldCode: "AMOUNT_CURRENCY_MISMATCH",
      safeHoldReason: "Discrepancy between order amount and payment amount.",
      recommendation: "IMMEDIATE_SAFE_HOLD",
      suggestedNextStep: "ADVISORY_SAFE_HOLD_FOR_HUMAN_REVIEW",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: `Integer paise amount mismatch detected (${gatewayPayment.amountPaise} vs ${merchantOrder.amountPaise}). Case locked in safe hold.`,
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // =========================================================================
  // 6. REFUND LIFECYCLE CHECKS
  // =========================================================================

  // Case 12: Failed Refund
  const isFailedRefund =
    gatewayPayment?.refundStatus === "FAILED" ||
    context.incomingEvent?.eventType === "refund.failed" ||
    context.refundStatus === "failed" ||
    context.refundFailed === true;

  if (isFailedRefund) {
    return {
      scenarioId: "CASE_12_FAILED_REFUND",
      category: "REFUND_FAILED",
      reasonCode: "REFUND_FAILED",
      ruleId: "RULE_CASE_12_REFUND_FAILED",
      confidence: 1.0,
      facts: [
        ...facts,
        {
          dimension: "REFUND",
          value: "REFUND_FAILED",
          source: "GATEWAY_WEBHOOK",
          authority: "PROVIDER_VERIFIED",
          verifiedAt: new Date(),
          evidenceRef: "REFUND_FAILURE"
        }
      ],
      claims,
      contradictions: ["Gateway refund rejected by acquiring bank or issuer."],
      missingEvidence: ["Alternative customer bank payout details"],
      safeHold: true,
      safeHoldCode: "REFUND_FAILED",
      safeHoldReason: "Refund attempt failed at provider network.",
      recommendation: "IMMEDIATE_SAFE_HOLD",
      suggestedNextStep: "ADVISORY_SAFE_HOLD_FOR_HUMAN_REVIEW",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: "Provider refund failure recorded. Immediate safe-hold applied; automated retry prohibited without admin review.",
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // Case 11: Full Refund Initiated But Not Completed
  const isRefundPending =
    gatewayPayment?.refundStatus === "PENDING" ||
    paymentCase?.refundStatus === "REFUND_PENDING" ||
    context.refundPending === true;

  if (isRefundPending) {
    const overdue = (context.refundPendingDays || 0) > 7;
    return {
      scenarioId: "CASE_11_FULL_REFUND_INITIATED_NOT_COMPLETED",
      category: "REFUND_PENDING_TIMEOUT",
      reasonCode: "REFUND_PENDING_TIMEOUT",
      ruleId: "RULE_CASE_11_REFUND_PENDING",
      confidence: 1.0,
      facts,
      claims,
      contradictions: [],
      missingEvidence: ["Acquiring bank clearance confirmation"],
      safeHold: overdue,
      safeHoldCode: overdue ? "REFUND_PENDING_TIMEOUT" : "NONE",
      safeHoldReason: overdue ? "Refund pending for longer than 7 business days." : null,
      recommendation: "MONITOR_REFUND",
      suggestedNextStep: "ADVISORY_MONITOR_REFUND",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: "Refund is currently in flight with the provider/banking network. Duplicate refund requests strictly blocked; scheduled for monitoring.",
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // Case 10: Partial Refund
  const amountRefunded = gatewayPayment?.amountRefundedPaise || 0;
  if (
    (amountRefunded > 0 && amountCaptured && amountRefunded < amountCaptured) ||
    context.partialRefund === true
  ) {
    const exceeds = amountCaptured && amountRefunded > amountCaptured;
    return {
      scenarioId: "CASE_10_PARTIAL_REFUND",
      category: "PARTIAL_REFUND",
      reasonCode: "PARTIAL_REFUND",
      ruleId: "RULE_CASE_10_PARTIAL_REFUND",
      confidence: 1.0,
      facts,
      claims,
      contradictions: exceeds ? ["Refunded amount exceeds captured amount."] : [],
      missingEvidence: [],
      safeHold: Boolean(exceeds),
      safeHoldCode: exceeds ? "PARTIAL_REFUND_EXCEEDS_CAPTURED" : "NONE",
      safeHoldReason: exceeds ? "Refunded amount exceeds captured total." : null,
      recommendation: "UPDATE_MERCHANT_LOCAL_LEDGER",
      suggestedNextStep: "ADVISORY_RECONCILE_LOCAL_LEDGER",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: `Partial refund of ${amountRefunded} paise recorded. Recommend adjusting merchant ledger balance.`,
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // =========================================================================
  // 7. DUPLICATE PAYMENT ATTEMPTS & ORDER CONFLICTS
  // =========================================================================

  // Case 22: Payment Captured But Order Cancelled (Safeguard 6)
  const isCaptured = gatewayPayment?.status === "CAPTURED";
  const isOrderCancelled = merchantOrder?.status === "CANCELLED";
  if (isCaptured && isOrderCancelled) {
    return {
      scenarioId: "CASE_22_PAYMENT_CAPTURED_ORDER_CANCELLED",
      category: "CANCELLED_ORDER_CAPTURED",
      reasonCode: "CANCELLED_ORDER_CAPTURED",
      ruleId: "RULE_CASE_22_CANCELLED_ORDER_CAPTURED",
      confidence: 1.0,
      facts,
      claims,
      contradictions: ["Payment is CAPTURED but merchant order is CANCELLED."],
      missingEvidence: [],
      safeHold: true,
      safeHoldCode: "LATE_CAPTURE_CANCELLED_ORDER",
      safeHoldReason: "Late capture received for cancelled order. Order cancellation preserved.",
      recommendation: "SAFE_HOLD_PRESERVE_CANCELLATION",
      suggestedNextStep: "ADVISORY_SAFE_HOLD_PRESERVE_CANCELLATION",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: "Capture arrived on cancelled merchant order. Per ReconAI Safeguard 6: Order cancellation preserved under safe hold; no automatic refund or reopen.",
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // Case 7: Duplicate Payment Attempts
  if (context.duplicatePaymentAttempts === true || (context.capturedPayments && context.capturedPayments.length > 1)) {
    return {
      scenarioId: "CASE_7_DUPLICATE_PAYMENT_ATTEMPTS",
      category: "DUPLICATE_PAYMENT",
      reasonCode: "DUPLICATE_PAYMENT",
      ruleId: "RULE_CASE_7_DUPLICATE_PAYMENTS",
      confidence: 1.0,
      facts,
      claims,
      contradictions: ["Two distinct captured payments exist for a single order."],
      missingEvidence: ["Merchant multi-order fulfillment consent"],
      safeHold: Boolean(context.amountsDiffer),
      safeHoldCode: context.amountsDiffer ? "DUPLICATE_PAYMENT_AMOUNTS_DIFFER" : "NONE",
      safeHoldReason: context.amountsDiffer ? "Duplicate payment attempts have different amounts." : null,
      recommendation: "REFUND_DUPLICATE_PAYMENT",
      suggestedNextStep: "ADVISORY_FLAG_DUPLICATE_PAYMENT",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: "Multiple captured payment attempts identified for single merchant order. Primary payment retained; second attempt isolated for refund recommendation.",
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // =========================================================================
  // 8. CUSTOMER CLAIMS VS GATEWAY STATE
  // =========================================================================

  // Case 4: Late Authorization After Timeout
  const isLateAuth =
    gatewayPayment?.status === "AUTHORIZED" &&
    (context.isLateAuthorization === true || context.incomingEvent?.eventType === "payment.authorized");

  if (isLateAuth) {
    return {
      scenarioId: "CASE_4_LATE_AUTHORIZATION_AFTER_TIMEOUT",
      category: "LATE_AUTHORIZATION",
      reasonCode: "LATE_AUTHORIZATION",
      ruleId: "RULE_CASE_4_LATE_AUTHORIZATION",
      confidence: 1.0,
      facts,
      claims,
      contradictions: ["Authorization received after initial checkout timeout."],
      missingEvidence: ["Merchant real-time inventory status"],
      safeHold: false,
      safeHoldCode: "NONE",
      safeHoldReason: null,
      recommendation: "CHECK_INVENTORY_THEN_CAPTURE_OR_VOID",
      suggestedNextStep: "ADVISORY_CHECK_INVENTORY_BEFORE_DECISION",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: "Late gateway authorization confirmed after checkout timeout. Recommends checking merchant inventory to auto-capture or auto-void.",
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // Case 2: Customer Debit Claim with Gateway Pending
  const isGatewayPending =
    !gatewayPayment ||
    gatewayPayment.status === "PENDING" ||
    gatewayPayment.status === "CREATED" ||
    gatewayPayment.status === "UNKNOWN";

  if (customerClaims.length > 0 && isGatewayPending && (context.customerDebitClaim === true || claims.length > 0)) {
    const overdue = (context.pendingMinutes || 0) >= 60;
    return {
      scenarioId: "CASE_2_CUSTOMER_DEBIT_CLAIM_GATEWAY_PENDING",
      category: "CUSTOMER_DEBIT_ON_GATEWAY_PENDING",
      reasonCode: "CUSTOMER_DEBIT_ON_GATEWAY_PENDING",
      ruleId: "RULE_CASE_2_CUSTOMER_DEBIT_PENDING",
      confidence: 0.85,
      facts,
      claims,
      contradictions: [],
      missingEvidence: ["Authoritative bank clearance proof (NPCI/Bank confirmation)"],
      safeHold: overdue,
      safeHoldCode: overdue ? "CUSTOMER_DEBIT_ON_GATEWAY_PENDING" : "NONE",
      safeHoldReason: overdue ? "Payment remains pending past 60 minutes window." : null,
      recommendation: "WAIT_AND_MONITOR",
      suggestedNextStep: "ADVISORY_WAIT_AND_MONITOR",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: "Customer submitted bank debit claim while gateway status remains PENDING. Debit claim labeled unverified claim; scheduled for automated polling without refund.",
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // Case 3: Customer Debit Claim with Payment Failed
  const isGatewayFailed = gatewayPayment?.status === "FAILED";
  if (isGatewayFailed && (customerClaims.length > 0 || context.customerDebitClaim === true)) {
    const reversalOverdue = Boolean(context.reversalOverdue);
    return {
      scenarioId: "CASE_3_CUSTOMER_DEBIT_CLAIM_PAYMENT_FAILED",
      category: "CUSTOMER_DEBIT_ON_GATEWAY_FAILURE",
      reasonCode: "CUSTOMER_DEBIT_ON_GATEWAY_FAILURE",
      ruleId: "RULE_CASE_3_CUSTOMER_DEBIT_FAILED",
      confidence: 0.9,
      facts,
      claims,
      contradictions: ["Customer claims debit on confirmed failed payment."],
      missingEvidence: ["Automatic bank reversal confirmation"],
      safeHold: reversalOverdue,
      safeHoldCode: reversalOverdue ? "CUSTOMER_DEBIT_ON_GATEWAY_FAILURE" : "NONE",
      safeHoldReason: reversalOverdue ? "Auto-reversal not confirmed within statutory window." : null,
      recommendation: "TRACK_AUTO_REVERSAL",
      suggestedNextStep: "ADVISORY_TRACK_AUTO_REVERSAL",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: "Gateway payment confirmed FAILED with cardholder debit claim. Auto-reversal tracking initiated per RBI statutory TAT window.",
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // =========================================================================
  // 9. LOST WEBHOOK & STATUS RECONSTRUCTION VIA POLL
  // =========================================================================

  // Case 17: Webhook Never Arrives (Lost Webhook)
  const isApiPoll = context.pollResult === true || context.source === "GATEWAY_API_POLL";
  const zeroWebhooks = lifecycleEvents.filter((e) => e.sourceSystem === "GATEWAY_WEBHOOK").length === 0;
  if (isCaptured && isApiPoll && zeroWebhooks) {
    return {
      scenarioId: "CASE_17_LOST_WEBHOOK",
      category: "LOST_WEBHOOK",
      reasonCode: "LOST_WEBHOOK",
      ruleId: "RULE_CASE_17_LOST_WEBHOOK",
      confidence: 1.0,
      facts,
      claims,
      contradictions: ["Payment captured at provider but zero webhook events received."],
      missingEvidence: ["Provider webhook delivery receipts"],
      safeHold: false,
      safeHoldCode: "NONE",
      safeHoldReason: null,
      recommendation: "RECONSTRUCT_FROM_POLL",
      suggestedNextStep: "ADVISORY_RECONSTRUCT_FROM_POLL",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: "Provider API poll confirmed payment is CAPTURED, but webhooks were lost in transit. Canonical state reconstructed from direct poll.",
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // =========================================================================
  // 10. SETTLEMENT DEDUPLICATION
  // =========================================================================

  // Case 20: Duplicate Settlement Record
  if (
    context.duplicateSettlement === true ||
    (settlementRecords && settlementRecords.length > 1 &&
      settlementRecords[0].settlementId &&
      settlementRecords[0].settlementId === settlementRecords[1].settlementId)
  ) {
    return {
      scenarioId: "CASE_20_DUPLICATE_SETTLEMENT_RECORD",
      category: "DUPLICATE_SETTLEMENT",
      reasonCode: "DUPLICATE_SETTLEMENT_RECORD",
      ruleId: "RULE_CASE_20_DUPLICATE_SETTLEMENT",
      confidence: 1.0,
      facts,
      claims,
      contradictions: ["Duplicate settlement payout rows detected in import."],
      missingEvidence: [],
      safeHold: false,
      safeHoldCode: "NONE",
      safeHoldReason: null,
      recommendation: "MERCHANT_LEDGER_DEDUPLICATION",
      suggestedNextStep: "ADVISORY_DEDUPLICATE_LEDGER_ROWS",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: "Duplicate payout records for identical settlement UTR detected. Deduplicated safely in settlement ledger.",
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // =========================================================================
  // 11. FRONTEND DROPPED & STATUS MISMATCH CHECKS
  // =========================================================================

  const isOrderPending =
    !merchantOrder ||
    merchantOrder.status === "PENDING" ||
    merchantOrder.status === "CREATED" ||
    merchantOrder.status === "ORDER_PENDING";

  // Case 1: Frontend Timeout After Payment Success (requires verified server-side evidence)
  if (isCaptured && isOrderPending && trustedFrontendEvent) {
    return {
      scenarioId: "CASE_1_FRONTEND_TIMEOUT_PAYMENT_SUCCESS",
      category: "FRONTEND_DROPPED_AFTER_SUCCESS",
      reasonCode: "FRONTEND_DROPPED_AFTER_SUCCESS",
      ruleId: "RULE_CASE_1_FRONTEND_TIMEOUT",
      confidence: 1.0,
      facts,
      claims,
      contradictions: [],
      missingEvidence: [], // Positively observed via authoritative server-verified telemetry
      safeHold: false,
      safeHoldCode: "NONE",
      safeHoldReason: null,
      recommendation: "UPDATE_MERCHANT_LOCAL_LEDGER",
      suggestedNextStep: "ADVISORY_RECONCILE_LOCAL_LEDGER",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: "Gateway payment confirmed CAPTURED and authoritative server-verified telemetry confirms frontend timeout/drop. Local merchant order remains PENDING.",
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // Case 6: Paid Gateway Payment But Unpaid Order (General Status Mismatch)
  // When gateway payment is CAPTURED and merchant order is PENDING, but no authenticated frontend event exists,
  // do NOT infer causation (frontend timeout). Classify faithfully as a payment/order status mismatch.
  if (isCaptured && isOrderPending) {
    return {
      scenarioId: "CASE_6_PAID_GATEWAY_UNPAID_ORDER",
      category: "STATUS_MISMATCH",
      reasonCode: "STATUS_MISMATCH",
      ruleId: "RULE_CASE_6_STATUS_MISMATCH",
      confidence: 1.0,
      facts,
      claims,
      contradictions: ["Gateway payment is CAPTURED but merchant order is PENDING."],
      missingEvidence: [
        "Authenticated frontend checkout acknowledgment or drop event (unobserved)"
      ],
      safeHold: false,
      safeHoldCode: "NONE",
      safeHoldReason: null,
      recommendation: "UPDATE_MERCHANT_LOCAL_LEDGER",
      suggestedNextStep: "ADVISORY_RECONCILE_LOCAL_LEDGER",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: "Verified provider payment is CAPTURED while merchant order remains PENDING. In the absence of authenticated frontend checkout telemetry, causation (frontend drop) is unobserved and not inferred; classified as payment/order status mismatch requiring local ledger reconciliation.",
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // =========================================================================
  // 12. SETTLEMENT SLA MONITORING
  // =========================================================================

  // Case 21: Missing Settlement Record (> 5 days)
  const elapsedHours = context.elapsedHoursSincePayment || 0;
  if (
    isCaptured &&
    (!settlementRecords || settlementRecords.length === 0) &&
    (elapsedHours > 120 || context.missingSettlementOverdue === true)
  ) {
    return {
      scenarioId: "CASE_21_MISSING_SETTLEMENT_RECORD",
      category: "MISSING_SETTLEMENT",
      reasonCode: "MISSING_SETTLEMENT_RECORD",
      ruleId: "RULE_CASE_21_MISSING_SETTLEMENT",
      confidence: 1.0,
      facts,
      claims,
      contradictions: ["Captured payment has zero settlement records after T+5 days."],
      missingEvidence: ["Bank payout NEFT/RTGS UTR"],
      safeHold: true,
      safeHoldCode: "MISSING_SETTLEMENT",
      safeHoldReason: "Settlement record missing beyond T+5 days SLA.",
      recommendation: "ESCALATE_TO_GATEWAY_SUPPORT",
      suggestedNextStep: "ADVISORY_ESCALATE_TO_GATEWAY_SUPPORT",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: "Payment captured successfully but settlement missing beyond statutory T+5 days. Customer funds untouched; escalated to gateway support.",
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // Case 5: Captured Payment with Delayed Merchant Settlement (< 72h)
  if (
    isCaptured &&
    (!settlementRecords || settlementRecords.length === 0 || settlementRecords[0].status === "PENDING") &&
    (elapsedHours <= 72 || context.delayedSettlement === true) &&
    !context.missingSettlementOverdue
  ) {
    return {
      scenarioId: "CASE_5_CAPTURED_PAYMENT_DELAYED_SETTLEMENT",
      category: "DELAYED_SETTLEMENT",
      reasonCode: "DELAYED_SETTLEMENT",
      ruleId: "RULE_CASE_5_DELAYED_SETTLEMENT",
      confidence: 1.0,
      facts,
      claims,
      contradictions: [],
      missingEvidence: ["Bank settlement UTR"],
      safeHold: false,
      safeHoldCode: "NONE",
      safeHoldReason: null,
      recommendation: "WAIT_FOR_SETTLEMENT",
      suggestedNextStep: "ADVISORY_WAIT_FOR_SETTLEMENT_WINDOW",
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      supportingEvidence,
      explanation: "Payment is captured and settlement is within standard T+2 banking window. Settlement delay is not a payment failure; customer refund strictly blocked.",
      redactedMetadata: sanitizeMetadata(context)
    };
  }

  // =========================================================================
  // 13. UNKNOWN / UNRESOLVED UNCERTAINTY SAFE FALLBACK
  // =========================================================================

  missingEvidence.push("Definitive payment lifecycle signal");
  return {
    scenarioId: "UNKNOWN_SCENARIO",
    category: "GENERAL_EXCEPTION",
    reasonCode: "UNRESOLVED_UNCERTAINTY",
    ruleId: "RULE_UNKNOWN_UNCERTAINTY",
    confidence: 0.0,
    facts,
    claims,
    contradictions,
    missingEvidence,
    safeHold: true,
    safeHoldCode: "UNRESOLVED_UNCERTAINTY",
    safeHoldReason: "Available evidence does not match any deterministic payment lifecycle rule.",
    recommendation: "UNKNOWN_OUTCOME_MONITOR",
    suggestedNextStep: "ADVISORY_HOLD_FOR_REVIEW",
    isExecutable: false,
    authoritative: false,
    requiresPolicyEngine: true,
    supportingEvidence,
    explanation: "Available evidence is insufficient, contradictory, or inconclusive. Case locked in safe hold; no speculative transitions allowed.",
    redactedMetadata: sanitizeMetadata(context)
  };
}

/**
 * Persists an evidence classification record into MongoDB with tenant scoping,
 * deduplication on evaluationKey, and append-only lifecycle compatibility.
 *
 * @param {Object} finding - Finding returned by classifyPaymentScenario
 * @param {Object} options
 * @param {string} options.tenantId - Authoritative tenant ID
 * @param {string} [options.caseId] - Associated case ID
 * @param {string} [options.merchantOrderId] - Associated merchant order ID
 * @param {string} [options.gatewayPaymentId] - Associated gateway payment ID
 * @param {string} [options.evaluationKey] - Deterministic deduplication key
 * @returns {Promise<EvidenceRecord>} Persisted Mongoose document
 */
export async function persistEvidenceFinding(finding, {
  tenantId,
  caseId = null,
  merchantOrderId = null,
  gatewayPaymentId = null,
  evaluationKey = null
} = {}) {
  if (!tenantId) {
    throw new Error("tenantId is required to persist EvidenceRecord");
  }

  const inferredPaymentId =
    gatewayPaymentId ||
    finding.supportingEvidence?.find((e) => e.entityType === "GatewayPayment")?.entityId ||
    null;
  const inferredOrderId =
    merchantOrderId ||
    finding.supportingEvidence?.find((e) => e.entityType === "MerchantOrder")?.entityId ||
    null;

  const recordId = `EVID-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const recordDoc = {
    recordId,
    tenantId,
    caseId,
    merchantOrderId: inferredOrderId,
    gatewayPaymentId: inferredPaymentId,
    scenarioId: finding.scenarioId,
    category: finding.category,
    reasonCode: finding.reasonCode,
    ruleId: finding.ruleId,
    confidence: finding.confidence,
    facts: finding.facts,
    claims: finding.claims,
    contradictions: finding.contradictions,
    missingEvidence: finding.missingEvidence,
    safeHold: finding.safeHold,
    safeHoldCode: finding.safeHoldCode,
    safeHoldReason: finding.safeHoldReason,
    recommendation: finding.recommendation,
    suggestedNextStep: finding.suggestedNextStep || "ADVISORY_HOLD_FOR_REVIEW",
    evaluationKey: evaluationKey || `${tenantId}:${caseId || merchantOrderId || gatewayPaymentId}:${finding.scenarioId}`,
    supportingEvidence: finding.supportingEvidence,
    explanation: finding.explanation,
    redactedMetadata: finding.redactedMetadata || {},
    evaluatedAt: new Date()
  };

  // If an evaluationKey exists, upsert to prevent duplicate evaluations
  if (recordDoc.evaluationKey) {
    const existing = await EvidenceRecord.findOne({ tenantId, evaluationKey: recordDoc.evaluationKey });
    if (existing) {
      return existing;
    }
  }

  const created = await EvidenceRecord.create(recordDoc);
  return created;
}
