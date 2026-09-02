import { safeSubtractPaise, paiseToRupees } from "../../utils/money.js";

/**
 * Derives a deterministic fallback explanation when Gemini is unavailable or unconfigured.
 * Returns the exact same shape as structured Gemini JSON analysis.
 */
export function generateFallbackExplanation({ exceptionCase, reconciliationResult }) {
  const type = exceptionCase?.type || reconciliationResult?.classification || "INVALID_DATA";
  const merchantOrderId = exceptionCase?.merchantOrderId || reconciliationResult?.merchantOrderId || "UNKNOWN";
  const reasons = reconciliationResult?.reasons || [];
  const expectedPaise = reconciliationResult?.expectedAmountPaise ?? null;
  const actualPaise = reconciliationResult?.actualAmountPaise ?? null;
  const diffPaise = reconciliationResult?.differencePaise ?? null;

  let summary = "";
  let likelyCause = "";
  let evidence = [];
  let recommendedNextStep = "MANUAL_REVIEW";
  let riskNotes = [];

  switch (type) {
    case "AMOUNT_MISMATCH":
      summary = `Deterministic reconciliation flagged a payment amount mismatch for order ${merchantOrderId}. Expected ₹${expectedPaise !== null ? paiseToRupees(expectedPaise) : 'N/A'} but received ₹${actualPaise !== null ? paiseToRupees(actualPaise) : 'N/A'}.`;
      likelyCause = "Customer paid an unexpected amount, partial payment was processed, or promotional discount/fee was incorrectly subtracted prior to payment capture.";
      evidence = [
        `Expected Amount: ₹${expectedPaise !== null ? paiseToRupees(expectedPaise) : 'N/A'}`,
        `Actual Captured Payment: ₹${actualPaise !== null ? paiseToRupees(actualPaise) : 'N/A'}`,
        `Discrepancy: ${diffPaise !== null ? (diffPaise > 0 ? '+' : '') + paiseToRupees(diffPaise) : 'N/A'} INR`,
        ...reasons.slice(0, 3)
      ];
      recommendedNextStep = "VERIFY_SOURCE_RECORD";
      riskNotes = ["Accepting this transaction without verification may cause ledger balance mismatch."];
      break;

    case "MISSING_PAYMENT":
      summary = `No valid gateway payment record was detected for merchant order ${merchantOrderId}.`;
      likelyCause = "Customer abandoned checkout, payment attempt failed at gateway, or webhooks/settlement files were delayed.";
      evidence = [
        `Merchant Order ID: ${merchantOrderId}`,
        `Order Amount: ₹${expectedPaise !== null ? paiseToRupees(expectedPaise) : 'N/A'}`,
        "Gateway Payment Record: None found",
        ...reasons.slice(0, 3)
      ];
      recommendedNextStep = "CHECK_PAYMENT";
      riskNotes = ["Fulfilling an order without confirmed payment capture leads to revenue loss."];
      break;

    case "MISSING_SETTLEMENT":
      summary = `Payment was captured for merchant order ${merchantOrderId}, but net settlement payout is missing from bank settlement records.`;
      likelyCause = "Settlement T+2 delay, gateway rolling reserve hold, or batch payout unlinked to transaction ID.";
      evidence = [
        `Merchant Order ID: ${merchantOrderId}`,
        `Captured Payment ID: ${reconciliationResult?.matchedPaymentId || 'N/A'}`,
        "Settlement Payout Record: None found",
        ...reasons.slice(0, 3)
      ];
      recommendedNextStep = "CHECK_SETTLEMENT";
      riskNotes = ["Cash flow impact if payment is captured by gateway but bank settlement fails."];
      break;

    case "DUPLICATE_PAYMENT":
      summary = `Multiple gateway payments were captured for a single merchant order ${merchantOrderId}.`;
      likelyCause = "Customer retried checkout due to gateway timeout or duplicate webhooks triggered multiple captures.";
      evidence = [
        `Merchant Order ID: ${merchantOrderId}`,
        "Multiple gateway payments detected for identical order ID.",
        ...reasons.slice(0, 3)
      ];
      recommendedNextStep = "CHECK_PAYMENT";
      riskNotes = ["Customer was likely double-charged; refund or credit adjustment may be required."];
      break;

    case "DUPLICATE_SETTLEMENT":
      summary = `Multiple settlement line items were logged for transaction ${merchantOrderId}.`;
      likelyCause = "Gateway batch payout report contained duplicate rows or reprocessing occurred.";
      evidence = [
        `Merchant Order ID: ${merchantOrderId}`,
        "Duplicate settlement entry found in bank payout files.",
        ...reasons.slice(0, 3)
      ];
      recommendedNextStep = "CHECK_SETTLEMENT";
      riskNotes = ["Risk of overstating settled cash balances."];
      break;

    case "FEE_MISMATCH":
      summary = `Gateway fee or GST charged on merchant order ${merchantOrderId} deviates from contract rate.`;
      likelyCause = "Mislabeled card category (e.g. international vs domestic), custom pricing slab mismatch, or tax rounding differences.";
      evidence = [
        `Merchant Order ID: ${merchantOrderId}`,
        ...reasons.slice(0, 3)
      ];
      recommendedNextStep = "CHECK_FEE";
      riskNotes = ["Systemic fee miscalculations over large volumes can erode merchant margins."];
      break;

    case "REFUND_MISMATCH":
      summary = `Refund record for order ${merchantOrderId} does not match original captured payment or order total.`;
      likelyCause = "Partial refund processed, currency conversion fee, or unauthorized refund initiative.";
      evidence = [
        `Merchant Order ID: ${merchantOrderId}`,
        ...reasons.slice(0, 3)
      ];
      recommendedNextStep = "CHECK_REFUND";
      riskNotes = ["Refunding more than original capture or refunding uncaptured transactions."];
      break;

    case "REFERENCE_MISMATCH":
      summary = `Transaction reference IDs do not align across order, payment, or settlement records for ${merchantOrderId}.`;
      likelyCause = "Truncated bank reference number (RRN/UTR), custom gateway payment ID mapping, or missing metadata.";
      evidence = [
        `Merchant Order ID: ${merchantOrderId}`,
        ...reasons.slice(0, 3)
      ];
      recommendedNextStep = "VERIFY_SOURCE_RECORD";
      riskNotes = ["Difficulty tracing funds during audit without consistent reference IDs."];
      break;

    case "STATUS_MISMATCH":
      summary = `Payment status conflict detected for merchant order ${merchantOrderId}.`;
      likelyCause = "Order status is PAID but gateway payment is FAILED or AUTHORIZED without CAPTURED status.";
      evidence = [
        `Merchant Order ID: ${merchantOrderId}`,
        ...reasons.slice(0, 3)
      ];
      recommendedNextStep = "CHECK_PAYMENT";
      riskNotes = ["Risk of shipping order items without confirmed payment settlement."];
      break;

    case "AMBIGUOUS":
      summary = `Automatic reconciliation remains blocked for order ${merchantOrderId} because candidate records contain ambiguous matching evidence.`;
      likelyCause = "Multiple payment candidates match order amount, or settlement reference links to multiple payment records with equal confidence.";
      evidence = [
        `Merchant Order ID: ${merchantOrderId}`,
        "Multiple candidate payment records detected.",
        "Settlement evidence does not uniquely identify a single payment candidate.",
        ...reasons.slice(0, 3)
      ];
      recommendedNextStep = "MANUAL_REVIEW";
      riskNotes = ["Selecting either candidate automatically could create an incorrect financial match."];
      break;

    case "INVALID_DATA":
    default:
      summary = `Reconciliation failed due to corrupted or missing transaction fields for order ${merchantOrderId}.`;
      likelyCause = "Malformed payload, invalid currency format, or missing mandatory order identifiers.";
      evidence = [
        `Merchant Order ID: ${merchantOrderId}`,
        ...reasons.slice(0, 3)
      ];
      recommendedNextStep = "MANUAL_REVIEW";
      riskNotes = ["Data integrity defect requires system source log inspection."];
      break;
  }

  return {
    summary,
    likelyCause,
    evidence,
    recommendedNextStep,
    riskNotes,
    aiConfidence: null
  };
}
