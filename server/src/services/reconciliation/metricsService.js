export const ALL_CLASSIFICATIONS = [
  "MATCHED",
  "AMOUNT_MISMATCH",
  "MISSING_PAYMENT",
  "MISSING_SETTLEMENT",
  "DUPLICATE_PAYMENT",
  "DUPLICATE_SETTLEMENT",
  "FEE_MISMATCH",
  "REFUND_MISMATCH",
  "REFERENCE_MISMATCH",
  "STATUS_MISMATCH",
  "AMBIGUOUS",
  "INVALID_DATA"
];

/**
 * Calculates operational metrics from a set of reconciliation results.
 * Benchmark evaluation answer keys are NOT required or accessed here.
 */
export function calculateRunMetrics(results = [], durationMs = 0) {
  const totalScenarios = results.length;
  let matchedCount = 0;
  let exceptionCount = 0;
  let autoReconciledCount = 0;
  let manualReviewCount = 0;

  let totalAmountProcessedPaise = 0;
  let autoReconciledAmountPaise = 0;
  let amountUnderReviewPaise = 0;

  // Initialize breakdown map with zeros for all 12 classifications
  const classificationBreakdown = {};
  for (const c of ALL_CLASSIFICATIONS) {
    classificationBreakdown[c] = 0;
  }

  for (const r of results) {
    const cls = r.classification;
    if (cls && classificationBreakdown[cls] !== undefined) {
      classificationBreakdown[cls]++;
    } else if (cls) {
      classificationBreakdown[cls] = 1;
    }

    if (cls === "MATCHED") {
      matchedCount++;
    }

    if (r.requiresReview) {
      exceptionCount++;
      manualReviewCount++;
    }

    if (r.autoResolved) {
      autoReconciledCount++;
    }

    const expPaise = (r.expectedAmountPaise && typeof r.expectedAmountPaise === "number") ? r.expectedAmountPaise : 0;
    totalAmountProcessedPaise += expPaise;

    if (r.autoResolved) {
      autoReconciledAmountPaise += expPaise;
    }
  }

  // Financial Sum Invariant Guarantee: total = autoReconciled + underReview
  amountUnderReviewPaise = Math.max(0, totalAmountProcessedPaise - autoReconciledAmountPaise);


  const autoReconciliationRate = totalScenarios > 0 ? autoReconciledCount / totalScenarios : 0;
  const durationSec = durationMs / 1000;
  const throughputRecordsPerSecond = durationSec > 0 ? totalScenarios / durationSec : 0;

  return {
    totalScenarios,
    processedScenarios: totalScenarios,
    matchedCount,
    exceptionCount,
    autoReconciledCount,
    manualReviewCount,
    autoReconciliationRate,
    durationMs,
    throughputRecordsPerSecond,
    totalAmountProcessedPaise,
    autoReconciledAmountPaise,
    amountUnderReviewPaise,
    classificationBreakdown
  };
}

export default calculateRunMetrics;
