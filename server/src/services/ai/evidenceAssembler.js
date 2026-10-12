import { sanitizeEvidenceText } from "./promptSanitizer.js";

/**
 * ReconAI 2.0 - Controller-Mediated Evidence Assembler & Scoper
 *
 * Implements strict tenant-isolated, role-bounded evidence card construction.
 * Ensures that agents receive ONLY minimal, allowlisted evidence cards
 * without cross-tenant leakage, credentials, or PII.
 */

/**
 * Assembles all approved evidence cards for a given case from verified source records.
 */
export function assembleEvidenceCards({
  caseDoc,
  evidenceRecord = null,
  gatewayPayment = null,
  merchantOrder = null,
  customerClaims = [],
  lifecycleEvents = []
}) {
  const cards = [];
  const tenantId = caseDoc?.tenantId || evidenceRecord?.tenantId || gatewayPayment?.tenantId || merchantOrder?.tenantId || "UNKNOWN_TENANT";
  const caseId = caseDoc?.caseId || evidenceRecord?.caseId || "UNKNOWN_CASE";

  // 1. Gateway Payment Evidence Card
  if (gatewayPayment) {
    cards.push({
      cardId: `CARD-PROV-${gatewayPayment.gatewayPaymentId || "PAY"}`,
      cardType: "PROVIDER_PAYMENT_STATUS",
      evidenceSource: "GATEWAY_PROVIDER",
      authority: "PROVIDER_VERIFIED",
      verified: true,
      tenantId,
      caseId,
      evidenceRef: gatewayPayment.gatewayPaymentId || null,
      data: {
        gatewayPaymentId: gatewayPayment.gatewayPaymentId,
        status: gatewayPayment.status,
        amountPaise: gatewayPayment.amountPaise,
        currency: gatewayPayment.currency || "INR",
        method: gatewayPayment.method || gatewayPayment.paymentMethod || "UNKNOWN",
        capturedAt: gatewayPayment.capturedAt ? new Date(gatewayPayment.capturedAt).toISOString() : null,
        authorizedAt: gatewayPayment.authorizedAt ? new Date(gatewayPayment.authorizedAt).toISOString() : null
      }
    });
  }

  // 2. Merchant Order Evidence Card
  if (merchantOrder) {
    cards.push({
      cardId: `CARD-ORD-${merchantOrder.merchantOrderId || "ORD"}`,
      cardType: "MERCHANT_ORDER_STATE",
      evidenceSource: "MERCHANT_ORDER",
      authority: "SYSTEM_RECORD",
      verified: true,
      tenantId,
      caseId,
      evidenceRef: merchantOrder.merchantOrderId || null,
      data: {
        merchantOrderId: merchantOrder.merchantOrderId,
        status: merchantOrder.status,
        amountPaise: merchantOrder.amountPaise,
        currency: merchantOrder.currency || "INR",
        orderCreatedAt: merchantOrder.orderCreatedAt ? new Date(merchantOrder.orderCreatedAt).toISOString() : null
      }
    });
  }

  // 3. Customer Claims Cards (Always marked UNVERIFIED claims)
  if (Array.isArray(customerClaims)) {
    customerClaims.forEach((claim, idx) => {
      const claimId = claim.claimId || `CLM-${idx + 1}`;
      cards.push({
        cardId: `CARD-CUST-${claimId}`,
        cardType: "CUSTOMER_CLAIM_RECORD",
        evidenceSource: "CUSTOMER_CLAIM",
        authority: "CUSTOMER_CLAIM",
        verified: false,
        tenantId,
        caseId,
        evidenceRef: claimId,
        data: {
          claimId,
          customerId: claim.customerId || caseDoc?.customerId || null,
          claimType: claim.claimType || "CUSTOMER_DEBIT_CLAIM",
          statement: sanitizeEvidenceText(claim.text || claim.statement || "Customer reported payment issue", 500),
          receivedAt: claim.receivedAt ? new Date(claim.receivedAt).toISOString() : new Date().toISOString()
        }
      });
    });
  }

  // 4. Deterministic Classification Card (from EvidenceRecord)
  if (evidenceRecord) {
    cards.push({
      cardId: `CARD-CLASSIF-${evidenceRecord.recordId || "EVID"}`,
      cardType: "DETERMINISTIC_CLASSIFICATION",
      evidenceSource: "DETERMINISTIC_CLASSIFIER",
      authority: "SYSTEM_RECORD",
      verified: true,
      tenantId,
      caseId,
      evidenceRef: evidenceRecord.recordId || null,
      data: {
        scenarioId: evidenceRecord.scenarioId,
        category: evidenceRecord.category,
        reasonCode: evidenceRecord.reasonCode,
        ruleId: evidenceRecord.ruleId,
        confidence: evidenceRecord.confidence,
        safeHold: evidenceRecord.safeHold,
        safeHoldCode: evidenceRecord.safeHoldCode,
        recommendation: evidenceRecord.recommendation,
        suggestedNextStep: evidenceRecord.suggestedNextStep || "ADVISORY_HOLD_FOR_REVIEW",
        missingEvidence: evidenceRecord.missingEvidence || [],
        contradictions: evidenceRecord.contradictions || [],
        isExecutable: false
      }
    });
  }

  // 5. Append-Only Lifecycle Event Cards
  if (Array.isArray(lifecycleEvents)) {
    lifecycleEvents.slice(0, 5).forEach((evt) => {
      cards.push({
        cardId: `CARD-EVT-${evt.eventId || "EVT"}`,
        cardType: "LIFECYCLE_EVENT_RECORD",
        evidenceSource: "LEDGER_EVENT",
        authority: "SYSTEM_RECORD",
        verified: true,
        tenantId,
        caseId,
        evidenceRef: evt.eventId,
        data: {
          eventId: evt.eventId,
          sourceSystem: evt.sourceSystem,
          normalizedEventType: evt.normalizedEventType,
          ingestedAt: evt.ingestedAt ? new Date(evt.ingestedAt).toISOString() : null
        }
      });
    });
  }

  return cards;
}

/**
 * Customer AI Access Filter
 * Customer AI sees ONLY customer's own claims and high-level payment/order summaries.
 * Strictly filters out merchant internal notes, webhook internals, and other customers.
 */
export function filterCardsForCustomer(cards, customerId = null) {
  return cards
    .filter((c) => {
      // Must not belong to another customer
      if (c.cardType === "CUSTOMER_CLAIM_RECORD" && customerId && c.data.customerId && c.data.customerId !== customerId) {
        return false;
      }
      // Allowed card types for customer view
      return (
        c.cardType === "CUSTOMER_CLAIM_RECORD" ||
        c.cardType === "PROVIDER_PAYMENT_STATUS" ||
        c.cardType === "MERCHANT_ORDER_STATE"
      );
    })
    .map((c) => {
      // Deep copy with customer-safe projection
      if (c.cardType === "PROVIDER_PAYMENT_STATUS") {
        return {
          ...c,
          data: {
            status: c.data.status,
            amountPaise: c.data.amountPaise,
            currency: c.data.currency,
            capturedAt: c.data.capturedAt
          }
        };
      }
      return c;
    });
}

/**
 * Shop AI Access Filter
 * Shop AI sees merchant order, payment status, deterministic findings,
 * and customer claims without unnecessary personal customer identifiers.
 */
export function filterCardsForShop(cards, tenantId) {
  return cards
    .filter((c) => c.tenantId === tenantId)
    .filter((c) => c.cardType !== "LIFECYCLE_EVENT_RECORD" || c.data.sourceSystem !== "GATEWAY_WEBHOOK")
    .map((c) => {
      if (c.cardType === "CUSTOMER_CLAIM_RECORD") {
        return {
          ...c,
          data: {
            claimId: c.data.claimId,
            claimType: c.data.claimType,
            statement: c.data.statement,
            receivedAt: c.data.receivedAt
          }
        };
      }
      return c;
    });
}

/**
 * Investigator AI Access Filter
 * Receives all controller-assembled evidence cards for the specific authorized case.
 */
export function filterCardsForInvestigator(cards, tenantId, caseId) {
  return cards.filter((c) => c.tenantId === tenantId && c.caseId === caseId);
}

/**
 * Resolution Planner AI Access Filter
 * Receives deterministic classification, verified provider status, merchant order,
 * and investigator findings.
 */
export function filterCardsForResolutionPlanner(cards, tenantId, caseId) {
  return cards.filter(
    (c) =>
      c.tenantId === tenantId &&
      c.caseId === caseId &&
      (c.cardType === "DETERMINISTIC_CLASSIFICATION" ||
        c.cardType === "PROVIDER_PAYMENT_STATUS" ||
        c.cardType === "MERCHANT_ORDER_STATE")
  );
}

/**
 * Validates cited evidence IDs against the approved card set.
 * Detects hallucinated or unapproved citations.
 */
export function validateCitedEvidence(citedEvidenceIds, approvedCards) {
  if (!Array.isArray(citedEvidenceIds)) {
    return { validIds: [], invalidIds: [], allValid: true };
  }

  const approvedIdSet = new Set(approvedCards.map((c) => c.cardId));
  const validIds = [];
  const invalidIds = [];

  for (const id of citedEvidenceIds) {
    if (typeof id === "string" && approvedIdSet.has(id.trim())) {
      validIds.push(id.trim());
    } else {
      invalidIds.push(id);
    }
  }

  return {
    validIds,
    invalidIds,
    allValid: invalidIds.length === 0
  };
}
