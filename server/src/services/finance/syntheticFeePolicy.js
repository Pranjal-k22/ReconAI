/**
 * Synthetic Fee Policy for ReconAI Demo Benchmark (RECONAI_DEMO_V1 / BATCH-DEMO-V1).
 * Standard synthetic gateway fee: 2% + 18% GST on fee.
 * 
 * Note: Used strictly for synthetic benchmark evaluation and data generation.
 */
export function calculateSyntheticFee(amountPaise) {
  if (typeof amountPaise !== "number" || !Number.isSafeInteger(amountPaise) || amountPaise < 0) {
    return { feePaise: 0, taxPaise: 0, netAmountPaise: amountPaise || 0 };
  }
  const feePaise = Math.round(amountPaise * 0.02);
  const taxPaise = Math.round(feePaise * 0.18);
  const netAmountPaise = amountPaise - feePaise - taxPaise;
  return { feePaise, taxPaise, netAmountPaise };
}

export default calculateSyntheticFee;
