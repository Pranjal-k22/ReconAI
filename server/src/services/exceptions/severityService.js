/**
 * Deterministic Exception Severity and Financial Impact Service.
 */

/**
 * Calculates conservative financial impact in integer paise for a reconciliation result.
 */
export function calculateFinancialImpact(result = {}) {
  const { classification, expectedAmountPaise, differencePaise } = result;
  const expPaise = (typeof expectedAmountPaise === "number" && Number.isSafeInteger(expectedAmountPaise)) ? expectedAmountPaise : 0;
  const diffPaise = (typeof differencePaise === "number" && Number.isSafeInteger(differencePaise)) ? Math.abs(differencePaise) : 0;

  switch (classification) {
    case "AMOUNT_MISMATCH":
    case "FEE_MISMATCH":
    case "REFUND_MISMATCH":
    case "DUPLICATE_PAYMENT":
      return diffPaise > 0 ? diffPaise : expPaise;

    case "MISSING_PAYMENT":
    case "MISSING_SETTLEMENT":
    case "DUPLICATE_SETTLEMENT":
    case "REFERENCE_MISMATCH":
    case "AMBIGUOUS":
    case "INVALID_DATA":
      return expPaise;

    default:
      return diffPaise > 0 ? diffPaise : expPaise;
  }
}

/**
 * Calculates deterministic severity level (LOW, MEDIUM, HIGH, CRITICAL).
 */
export function calculateSeverity(classification, financialImpactPaise = 0) {
  const impact = Math.abs(financialImpactPaise || 0);

  // CRITICAL: Severe data integrity risks or high financial exposure (>= ₹10,000)
  if (
    classification === "DUPLICATE_PAYMENT" ||
    classification === "DUPLICATE_SETTLEMENT" ||
    classification === "INVALID_DATA" ||
    impact >= 1000000
  ) {
    return "CRITICAL";
  }

  // LOW: Any discrepancy with minor financial exposure (< ₹1,000)
  if (impact < 100000) {
    return "LOW";
  }

  // HIGH: Direct financial mismatch or ambiguity with high exposure (>= ₹5,000)
  if (
    classification === "AMOUNT_MISMATCH" ||
    classification === "REFUND_MISMATCH" ||
    classification === "REFERENCE_MISMATCH" ||
    classification === "AMBIGUOUS" ||
    impact >= 500000
  ) {
    return "HIGH";
  }

  // MEDIUM: Standard missing records or fee mismatch (₹1,000 - ₹5,000)
  return "MEDIUM";
}

export default {
  calculateFinancialImpact,
  calculateSeverity
};
