import { paiseToRupees } from "../../utils/money.js";

/**
 * ReconAI 2.0 - Deterministic Agent Fallback Generators
 *
 * Implements resilient, schema-compliant deterministic fallbacks for each
 * of the four AI roles when the LLM provider is unconfigured, throttled (429),
 * timed out, or returns malformed outputs.
 *
 * INVARIANT: Fallbacks are 100% compliant with Zod contracts, strictly grounded
 * in approved evidence cards, and advisory/non-executable.
 */

export function generateCustomerAiFallback({
  caseId,
  tenantId,
  cards = [],
  fallbackReason = "DETERMINISTIC_FALLBACK"
}) {
  const claimCard = cards.find((c) => c.cardType === "CUSTOMER_CLAIM_RECORD");
  const paymentCard = cards.find((c) => c.cardType === "PROVIDER_PAYMENT_STATUS");

  const claimedAmountPaise = paymentCard?.data?.amountPaise || null;
  const statement = claimCard?.data?.statement || "Customer reported a payment inquiry.";

  const citedEvidenceIds = cards
    .filter((c) => c.cardType === "CUSTOMER_CLAIM_RECORD" || c.cardType === "PROVIDER_PAYMENT_STATUS")
    .map((c) => c.cardId);

  return {
    role: "CUSTOMER_AI",
    caseId,
    tenantId,
    perspective: `Customer Statement: ${statement}. Customer observes payment attempt with amount ${
      claimedAmountPaise ? `${paiseToRupees(claimedAmountPaise)} INR` : "unspecified"
    }. Claim remains unverified pending bank clearance.`,
    disputedAmountPaise: claimedAmountPaise,
    citedEvidenceIds,
    unverifiedClaims: claimCard ? [statement] : [],
    status: fallbackReason === "INSUFFICIENT_EVIDENCE" ? "INSUFFICIENT_EVIDENCE" : "FALLBACK"
  };
}

export function generateShopAiFallback({
  caseId,
  tenantId,
  cards = [],
  fallbackReason = "DETERMINISTIC_FALLBACK"
}) {
  const orderCard = cards.find((c) => c.cardType === "MERCHANT_ORDER_STATE");
  const orderStatus = orderCard?.data?.status || "PENDING";
  const amountPaise = orderCard?.data?.amountPaise || null;

  const citedEvidenceIds = cards
    .filter((c) => c.cardType === "MERCHANT_ORDER_STATE" || c.cardType === "PROVIDER_PAYMENT_STATUS")
    .map((c) => c.cardId);

  return {
    role: "SHOP_AI",
    caseId,
    tenantId,
    perspective: `Merchant Order ${orderCard?.data?.merchantOrderId || "N/A"} status in store ledger is '${orderStatus}'. Order amount: ${
      amountPaise ? `${paiseToRupees(amountPaise)} INR` : "N/A"
    }. Fulfillment is held pending authoritative payment reconciliation.`,
    orderStatusObserved: orderStatus,
    citedEvidenceIds,
    unverifiedClaims: [],
    status: fallbackReason === "INSUFFICIENT_EVIDENCE" ? "INSUFFICIENT_EVIDENCE" : "FALLBACK"
  };
}

export function generateInvestigatorAiFallback({
  caseId,
  tenantId,
  cards = [],
  deterministicClassification = null,
  fallbackReason = "DETERMINISTIC_FALLBACK"
}) {
  const paymentCard = cards.find((c) => c.cardType === "PROVIDER_PAYMENT_STATUS");
  const orderCard = cards.find((c) => c.cardType === "MERCHANT_ORDER_STATE");
  const claimCards = cards.filter((c) => c.cardType === "CUSTOMER_CLAIM_RECORD");

  const verifiedFacts = [];
  if (paymentCard) {
    verifiedFacts.push({
      dimension: "GATEWAY_PAYMENT",
      value: paymentCard.data.status,
      evidenceRef: paymentCard.evidenceRef || paymentCard.cardId
    });
  }
  if (orderCard) {
    verifiedFacts.push({
      dimension: "MERCHANT_ORDER",
      value: orderCard.data.status,
      evidenceRef: orderCard.evidenceRef || orderCard.cardId
    });
  }

  const unverifiedClaims = claimCards.map((c) => ({
    claimType: c.data.claimType || "CUSTOMER_CLAIM",
    text: c.data.statement,
    source: "CUSTOMER",
    evidenceRef: c.evidenceRef || null
  }));

  const conflictsAndContradictions = [];
  if (paymentCard && orderCard) {
    if (paymentCard.data.status === "CAPTURED" && orderCard.data.status === "PENDING") {
      conflictsAndContradictions.push("Gateway payment confirmed CAPTURED while merchant order remains PENDING.");
    }
  }

  const missingEvidence = deterministicClassification?.missingEvidence || [];
  const safeHoldRecommended = deterministicClassification?.safeHold || false;
  const safeHoldCode = deterministicClassification?.safeHoldCode || "NONE";
  const scenarioRef = deterministicClassification?.scenarioId || "DETERMINISTIC_EVALUATION";

  const citedEvidenceIds = cards.map((c) => c.cardId);

  return {
    role: "INVESTIGATOR_AI",
    caseId,
    tenantId,
    verifiedFacts,
    unverifiedClaims,
    conflictsAndContradictions,
    missingEvidence,
    deterministicScenarioRef: scenarioRef,
    safeHoldRecommended,
    safeHoldCode,
    citedEvidenceIds,
    reasoningSummary: `Deterministic investigation summary: Gateway reports '${
      paymentCard?.data?.status || "UNKNOWN"
    }' while local order reports '${
      orderCard?.data?.status || "UNKNOWN"
    }'. Customer claims are tracked as unverified claims. Classification: ${scenarioRef}.`,
    investigativeNextSteps: [
      "Review provider webhook ledger receipts",
      "Verify merchant store order synchronization",
      "Check safe hold status prior to any ledger adjustments"
    ],
    status: safeHoldRecommended ? "CONTRADICTION_UNRESOLVED" : "COMPLETED"
  };
}

export function generateResolutionPlannerAiFallback({
  caseId,
  tenantId,
  cards = [],
  deterministicClassification = null,
  investigatorOutput = null,
  fallbackReason = "DETERMINISTIC_FALLBACK"
}) {
  const suggestedNextStep =
    deterministicClassification?.suggestedNextStep || "ADVISORY_SAFE_HOLD_FOR_HUMAN_REVIEW";
  const safeHold = deterministicClassification?.safeHold || investigatorOutput?.safeHoldRecommended || false;

  const citedEvidenceIds = cards.map((c) => c.cardId);

  return {
    role: "RESOLUTION_PLANNER_AI",
    caseId,
    tenantId,
    suggestedNextStep,
    proposalSummary: `Advisory proposal: ${suggestedNextStep}. Based on deterministic classification (${
      deterministicClassification?.scenarioId || "UNKNOWN"
    }), recommend policy-governed review. No automated financial mutations authorized.`,
    proposalReasoning: `Safe resolution path adheres strictly to deterministic evidence engine findings. Verified provider facts take precedence over unverified claims. Safe-hold status: ${
      safeHold ? "ACTIVE" : "NONE"
    }. Proposal is strictly non-executable.`,
    citedEvidenceIds,
    isExecutable: false,
    authoritative: false,
    requiresPolicyEngine: true,
    requiresHumanReview: safeHold || false,
    status: safeHold ? "SAFE_HOLD_REQUIRED" : "PROPOSAL_GENERATED"
  };
}
