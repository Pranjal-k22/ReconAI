import { normalizeScenarioInputs } from "./normalizationService.js";
import { matchPaymentCandidates, matchSettlementCandidates } from "./candidateMatcher.js";
import { classifyScenario } from "./anomalyClassifier.js";
import { calculateConfidence } from "./confidenceEngine.js";

/**
 * Pure deterministic financial reconciliation engine.
 * 
 * Reconciles a single scenario containing a merchant order, gateway payments,
 * and settlement records.
 * 
 * MUST NOT:
 * - Query or mutate MongoDB
 * - Access benchmark answer keys or evaluation models
 * - Call Gemini or external APIs
 * - Generate persistence keys (resultId, runId, exceptionId)
 * 
 * @param {Object} scenario
 * @param {Object} scenario.merchantOrder - MerchantOrder input record
 * @param {Array}  [scenario.gatewayPayments=[]] - Array of GatewayPayment input records
 * @param {Array}  [scenario.settlementRecords=[]] - Array of SettlementRecord input records
 * @returns {Object} Structured reconciliation result
 */
export function reconcileScenario({ merchantOrder, gatewayPayments = [], settlementRecords = [] }) {
  // 1. Input Normalization
  const {
    merchantOrder: normOrder,
    gatewayPayments: normPayments,
    settlementRecords: normSettlements,
    warnings
  } = normalizeScenarioInputs({ merchantOrder, gatewayPayments, settlementRecords });

  // 2. Candidate Matching Evidence
  const paymentCandidateMatches = matchPaymentCandidates(normOrder, normPayments);
  const settlementCandidateMatches = normPayments.flatMap((p) =>
    matchSettlementCandidates(normOrder, p, normSettlements)
  );

  // 3. Classification
  const classificationResult = classifyScenario({
    merchantOrder: normOrder,
    gatewayPayments: normPayments,
    settlementRecords: normSettlements
  });

  // 4. Evidence Assembly
  const combinedEvidence = {
    ...classificationResult.ruleEvidence,
    normalizationWarnings: warnings,
    candidateMatching: {
      paymentsEvaluated: paymentCandidateMatches.length,
      settlementsEvaluated: settlementCandidateMatches.length
    }
  };

  // 5. Confidence Calculation
  const confidence = calculateConfidence({
    classification: classificationResult.classification,
    evidence: combinedEvidence,
    warnings
  });

  // 6. Final Structured Reconciliation Output
  return {
    merchantOrderId: normOrder?.merchantOrderId || merchantOrder?.merchantOrderId || null,
    classification: classificationResult.classification,
    confidence,
    gatewayPaymentIds: classificationResult.gatewayPaymentIds || [],
    settlementRecordIds: classificationResult.settlementRecordIds || [],
    expectedAmountPaise: classificationResult.expectedAmountPaise,
    actualAmountPaise: classificationResult.actualAmountPaise,
    differencePaise: classificationResult.differencePaise,
    requiresReview: classificationResult.requiresReview,
    reasons: classificationResult.reasons || [],
    ruleEvidence: combinedEvidence
  };
}

export default reconcileScenario;
