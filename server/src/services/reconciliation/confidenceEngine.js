/**
 * Calculates a deterministic confidence score (0.00 - 1.00) for a reconciliation result.
 * 
 * Confidence represents the STRENGTH OF EVIDENCE for the classification, not AI probability or permission.
 */
export function calculateConfidence({ classification, evidence = {}, warnings = [] }) {
  if (!classification) return 0.0;

  switch (classification) {
    case "MATCHED": {
      // High confidence if all evidence checks passed
      let score = 1.0;
      if (warnings && warnings.length > 0) score -= 0.05;
      if (evidence.timestampPlausible === false) score -= 0.05;
      return Math.max(0.80, score);
    }

    case "AMOUNT_MISMATCH":
    case "FEE_MISMATCH":
    case "REFUND_MISMATCH":
    case "MISSING_SETTLEMENT":
    case "DUPLICATE_PAYMENT":
    case "DUPLICATE_SETTLEMENT":
    case "STATUS_MISMATCH":
    case "REFERENCE_MISMATCH":
    case "MISSING_PAYMENT": {
      // Deterministically identified anomaly with clear evidence
      let score = 0.95;
      if (warnings && warnings.length > 0) score -= 0.05;
      return Math.max(0.70, score);
    }

    case "INVALID_DATA": {
      // High certainty that data is invalid/unusable
      return 0.95;
    }

    case "AMBIGUOUS": {
      // Low confidence because multiple interpretations or unlinked records exist
      return 0.45;
    }

    default:
      return 0.50;
  }
}

export default calculateConfidence;
