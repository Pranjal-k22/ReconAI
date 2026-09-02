/**
 * Formal Safety Gate Policy Service for ReconAI.
 * 
 * Enforces strict financial safety rules determining whether a reconciliation
 * scenario can be automatically resolved or MUST be routed for human review.
 */
export const CONFIDENCE_THRESHOLDS = {
  HIGH: 0.95,
  MEDIUM: 0.75,
  LOW: 0.0
};

/**
 * Evaluates whether automatic resolution is permitted for a reconciliation result.
 * 
 * @param {Object} params
 * @param {string} params.classification - Anomaly/Match classification
 * @param {number} params.confidence - Deterministic confidence score (0.00 - 1.00)
 * @param {boolean} [params.requiresReview] - Boolean flag from matching engine
 * @returns {Object} { allowedAutomaticResolution: boolean, requiresHumanReview: boolean, reason: string }
 */
export function evaluateSafetyGate({ classification, confidence, requiresReview = false }) {
  const conf = typeof confidence === "number" ? confidence : 0;

  // Rule B: Anomaly classifications MUST NEVER be auto-resolved regardless of confidence
  if (classification !== "MATCHED") {
    return {
      allowedAutomaticResolution: false,
      requiresHumanReview: true,
      reason: `Financial anomaly '${classification}' requires human review regardless of confidence score (${conf}).`
    };
  }

  // Rule C: MATCHED with confidence < 0.95 is blocked from auto-reconciliation
  if (conf < CONFIDENCE_THRESHOLDS.HIGH) {
    return {
      allowedAutomaticResolution: false,
      requiresHumanReview: true,
      reason: `MATCHED result confidence (${conf}) is below safety threshold (${CONFIDENCE_THRESHOLDS.HIGH}).`
    };
  }

  // Rule A: Clean MATCHED with high confidence >= 0.95 and requiresReview === false
  if (!requiresReview) {
    return {
      allowedAutomaticResolution: true,
      requiresHumanReview: false,
      reason: `Clean exact match with high confidence (${conf}).`
    };
  }

  return {
    allowedAutomaticResolution: false,
    requiresHumanReview: true,
    reason: `Review explicitly requested by engine.`
  };
}

export default evaluateSafetyGate;
