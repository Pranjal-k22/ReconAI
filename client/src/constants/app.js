export const DEFAULT_ACTOR_ID = "demo-finance-reviewer";
export const BENCHMARK_DATASET_VERSION = "RECONAI_DEMO_V1";
export const BENCHMARK_SEED = "RECONAI_DEMO_2026";
export const PRIMARY_DEMO_ORDER_ID = "ORD-000116";

export const CLASSIFICATION_DESCRIPTIONS = {
  MATCHED: "Order, payment, and settlement amounts and references match perfectly.",
  AMOUNT_MISMATCH: "Discrepancy detected between order amount and payment amount.",
  MISSING_SETTLEMENT: "Payment recorded by gateway but no settlement record found.",
  DUPLICATE_PAYMENT: "Multiple payment records reference the same merchant order.",
  DUPLICATE_SETTLEMENT: "Multiple settlement items reference the same gateway payment.",
  FEE_MISMATCH: "Calculated gateway fee differs from standard fee policy.",
  REFUND_MISMATCH: "Refund amount recorded does not match original transaction.",
  MISSING_PAYMENT: "Order placed by customer has no recorded gateway payment.",
  REFERENCE_MISMATCH: "Transaction identifiers mismatch between order and payment.",
  STATUS_MISMATCH: "Order or payment status conflicts with settlement state.",
  AMBIGUOUS: "Multiple candidate payments exist with equal match evidence.",
  INVALID_DATA: "Corrupted or missing mandatory financial payload fields."
};
