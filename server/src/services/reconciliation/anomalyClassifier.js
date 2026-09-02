import { calculateSyntheticFee } from "../finance/syntheticFeePolicy.js";
import { formatINR } from "../../utils/money.js";

/**
 * Deterministically classifies a normalized reconciliation scenario.
 */
export function classifyScenario({ merchantOrder, gatewayPayments = [], settlementRecords = [] }) {
  // 1. INVALID_DATA Checks
  if (!merchantOrder || !merchantOrder.merchantOrderId) {
    return {
      classification: "INVALID_DATA",
      requiresReview: true,
      expectedAmountPaise: 0,
      actualAmountPaise: 0,
      differencePaise: 0,
      gatewayPaymentIds: gatewayPayments.map((p) => p.gatewayPaymentId).filter(Boolean),
      settlementRecordIds: settlementRecords.map((s) => s.settlementRecordId).filter(Boolean),
      reasons: ["Merchant order record is missing or invalid."],
      ruleEvidence: { invalidData: true, reason: "Missing merchantOrderId" }
    };
  }

  const orderCurrency = merchantOrder.currency;
  const currencyMismatch = gatewayPayments.some((p) => p.currency !== orderCurrency) ||
    settlementRecords.some((s) => s.currency !== orderCurrency);

  const unknownStatusWithMissingLinkage = (merchantOrder.status === "UNKNOWN") &&
    gatewayPayments.some((p) => p.status === "UNKNOWN" && (!p.merchantOrderId || p.merchantOrderId !== merchantOrder.merchantOrderId));

  if (currencyMismatch || unknownStatusWithMissingLinkage) {
    const payIds = gatewayPayments.map((p) => p.gatewayPaymentId).filter(Boolean);
    const setIds = settlementRecords.map((s) => s.settlementRecordId).filter(Boolean);
    return {
      classification: "INVALID_DATA",
      requiresReview: true,
      expectedAmountPaise: merchantOrder.amountPaise || 0,
      actualAmountPaise: gatewayPayments[0]?.amountPaise || 0,
      differencePaise: (gatewayPayments[0]?.amountPaise || 0) - (merchantOrder.amountPaise || 0),
      gatewayPaymentIds: payIds,
      settlementRecordIds: setIds,
      reasons: [
        currencyMismatch
          ? `Currency mismatch detected across linked records (Order currency: ${orderCurrency}).`
          : "Invalid data: Unknown status with missing linking keys."
      ],
      ruleEvidence: {
        currencyMismatch,
        unknownStatusWithMissingLinkage,
        orderCurrency,
        paymentCurrencies: gatewayPayments.map((p) => p.currency),
        settlementCurrencies: settlementRecords.map((s) => s.currency)
      }
    };
  }

  // 2. MISSING_PAYMENT Check
  if (!gatewayPayments || gatewayPayments.length === 0) {
    return {
      classification: "MISSING_PAYMENT",
      requiresReview: true,
      expectedAmountPaise: merchantOrder.amountPaise,
      actualAmountPaise: null,
      differencePaise: null,
      gatewayPaymentIds: [],
      settlementRecordIds: [],
      reasons: ["No gateway payment record was found for merchant order."],
      ruleEvidence: {
        merchantOrderId: merchantOrder.merchantOrderId,
        orderAmountPaise: merchantOrder.amountPaise,
        paymentCandidateCount: 0
      }
    };
  }

  const directPayments = gatewayPayments.filter(
    (p) => p.merchantOrderId && p.merchantOrderId === merchantOrder.merchantOrderId
  );

  // 3. REFERENCE_MISMATCH Check
  if (gatewayPayments.length === 1) {
    const singlePay = gatewayPayments[0];
    if (singlePay.merchantOrderId && singlePay.merchantOrderId !== merchantOrder.merchantOrderId) {
      const setIds = settlementRecords.map((s) => s.settlementRecordId).filter(Boolean);
      const diffPaise = (singlePay.amountPaise || 0) - (merchantOrder.amountPaise || 0);
      return {
        classification: "REFERENCE_MISMATCH",
        requiresReview: true,
        expectedAmountPaise: merchantOrder.amountPaise,
        actualAmountPaise: singlePay.amountPaise,
        differencePaise: diffPaise,
        gatewayPaymentIds: [singlePay.gatewayPaymentId],
        settlementRecordIds: setIds,
        reasons: [
          `Gateway payment references conflicting order ID '${singlePay.merchantOrderId}' instead of '${merchantOrder.merchantOrderId}'.`
        ],
        ruleEvidence: {
          merchantOrderId: merchantOrder.merchantOrderId,
          paymentMerchantOrderId: singlePay.merchantOrderId,
          gatewayPaymentId: singlePay.gatewayPaymentId
        }
      };
    }
  }

  // 4. Multiple Payment Candidates: AMBIGUOUS vs DUPLICATE_PAYMENT
  if (gatewayPayments.length > 1) {
    const payIds = gatewayPayments.map((p) => p.gatewayPaymentId);
    const setIds = settlementRecords.map((s) => s.settlementRecordId);

    // Check if any payment is linked to settlement by entityId
    const linkedSettlements = settlementRecords.filter((s) =>
      gatewayPayments.some((p) => s.entityId === p.gatewayPaymentId)
    );

    if (linkedSettlements.length === 0) {
      // Unlinked settlement evidence -> AMBIGUOUS
      return {
        classification: "AMBIGUOUS",
        requiresReview: true,
        expectedAmountPaise: merchantOrder.amountPaise,
        actualAmountPaise: merchantOrder.amountPaise,
        differencePaise: 0,
        gatewayPaymentIds: payIds,
        settlementRecordIds: setIds,
        reasons: [
          "Multiple payment candidates exist with unlinked settlement evidence; deterministic selection is unsafe."
        ],
        ruleEvidence: {
          candidatePaymentIds: payIds,
          unlinkedSettlementRecordIds: setIds,
          directPaymentCount: directPayments.length
        }
      };
    }

    // Direct payments with linked settlement evidence -> DUPLICATE_PAYMENT
    if (directPayments.length > 1) {
      const capturedPayments = directPayments.filter((p) => p.status === "CAPTURED" || p.status === "PAID");
      const totalCapturedAmount = capturedPayments.reduce((sum, p) => sum + (p.amountPaise || 0), 0);
      const diffPaise = totalCapturedAmount - merchantOrder.amountPaise;

      return {
        classification: "DUPLICATE_PAYMENT",
        requiresReview: true,
        expectedAmountPaise: merchantOrder.amountPaise,
        actualAmountPaise: totalCapturedAmount,
        differencePaise: diffPaise,
        gatewayPaymentIds: payIds,
        settlementRecordIds: setIds,
        reasons: [
          `Multiple captured gateway payments (${capturedPayments.length}) were detected for a single merchant order.`
        ],
        ruleEvidence: {
          merchantOrderId: merchantOrder.merchantOrderId,
          duplicatePaymentIds: payIds,
          capturedPaymentsCount: capturedPayments.length,
          totalCapturedAmountPaise: totalCapturedAmount
        }
      };
    }

    // Default multi-payment ambiguity
    return {
      classification: "AMBIGUOUS",
      requiresReview: true,
      expectedAmountPaise: merchantOrder.amountPaise,
      actualAmountPaise: merchantOrder.amountPaise,
      differencePaise: 0,
      gatewayPaymentIds: payIds,
      settlementRecordIds: setIds,
      reasons: [
        "Multiple payment candidates exist; deterministic selection cannot uniquely identify single payment."
      ],
      ruleEvidence: {
        candidatePaymentIds: payIds,
        directPaymentCount: directPayments.length
      }
    };
  }

  // From here, exactly 1 payment record exists
  const primaryPayment = gatewayPayments[0];

  // 5. STATUS_MISMATCH Check
  if (
    (merchantOrder.status === "PAID" && primaryPayment.status === "FAILED") ||
    (merchantOrder.status === "FAILED" && (primaryPayment.status === "CAPTURED" || primaryPayment.status === "PAID"))
  ) {
    const setIds = settlementRecords.map((s) => s.settlementRecordId).filter(Boolean);
    return {
      classification: "STATUS_MISMATCH",
      requiresReview: true,
      expectedAmountPaise: merchantOrder.amountPaise,
      actualAmountPaise: primaryPayment.amountPaise,
      differencePaise: (primaryPayment.amountPaise || 0) - (merchantOrder.amountPaise || 0),
      gatewayPaymentIds: [primaryPayment.gatewayPaymentId],
      settlementRecordIds: setIds,
      reasons: [
        `Status conflict between merchant order (${merchantOrder.status}) and gateway payment (${primaryPayment.status}).`
      ],
      ruleEvidence: {
        orderStatus: merchantOrder.status,
        paymentStatus: primaryPayment.status
      }
    };
  }

  // 6. DUPLICATE_SETTLEMENT Check
  const paymentTypeSettlements = settlementRecords.filter((s) => s.type === "PAYMENT" && s.entityId === primaryPayment.gatewayPaymentId);
  if (paymentTypeSettlements.length > 1) {
    const setIds = settlementRecords.map((s) => s.settlementRecordId);
    return {
      classification: "DUPLICATE_SETTLEMENT",
      requiresReview: true,
      expectedAmountPaise: merchantOrder.amountPaise,
      actualAmountPaise: primaryPayment.amountPaise,
      differencePaise: 0,
      gatewayPaymentIds: [primaryPayment.gatewayPaymentId],
      settlementRecordIds: setIds,
      reasons: [
        `Multiple settlement payout records (${paymentTypeSettlements.length}) exist for gateway payment ${primaryPayment.gatewayPaymentId}.`
      ],
      ruleEvidence: {
        gatewayPaymentId: primaryPayment.gatewayPaymentId,
        duplicateSettlementRecordIds: setIds
      }
    };
  }

  // 7. REFUND_MISMATCH Check
  const refundSettlements = settlementRecords.filter((s) => s.type === "REFUND");
  const isRefundScenario =
    merchantOrder.status === "REFUNDED" ||
    primaryPayment.status === "REFUNDED" ||
    primaryPayment.refundAmountPaise > 0 ||
    refundSettlements.length > 0;

  if (isRefundScenario) {
    const expectedRefundPaise = primaryPayment.refundAmountPaise || 0;
    const actualRefundPaise = refundSettlements.reduce(
      (sum, s) => sum + (s.grossAmountPaise !== null && s.grossAmountPaise !== undefined ? s.grossAmountPaise : Math.abs(s.netAmountPaise || 0)),
      0
    );

    if (expectedRefundPaise !== actualRefundPaise) {
      const setIds = settlementRecords.map((s) => s.settlementRecordId);
      const diffPaise = actualRefundPaise - expectedRefundPaise;
      return {
        classification: "REFUND_MISMATCH",
        requiresReview: true,
        expectedAmountPaise: expectedRefundPaise,
        actualAmountPaise: actualRefundPaise,
        differencePaise: diffPaise,
        gatewayPaymentIds: [primaryPayment.gatewayPaymentId],
        settlementRecordIds: setIds,
        reasons: [
          `Refund amount mismatch: Gateway refund is ${formatINR(expectedRefundPaise)} while bank settlement refund is ${formatINR(actualRefundPaise)}.`
        ],
        ruleEvidence: {
          expectedRefundPaise,
          actualRefundPaise,
          differencePaise: diffPaise,
          settlementRefundCount: refundSettlements.length
        }
      };
    }
  }

  // 8. AMOUNT_MISMATCH Check
  if (primaryPayment.amountPaise !== merchantOrder.amountPaise) {
    const setIds = settlementRecords.map((s) => s.settlementRecordId);
    const diffPaise = primaryPayment.amountPaise - merchantOrder.amountPaise;
    return {
      classification: "AMOUNT_MISMATCH",
      requiresReview: true,
      expectedAmountPaise: merchantOrder.amountPaise,
      actualAmountPaise: primaryPayment.amountPaise,
      differencePaise: diffPaise,
      gatewayPaymentIds: [primaryPayment.gatewayPaymentId],
      settlementRecordIds: setIds,
      reasons: [
        `Gateway payment amount (${formatINR(primaryPayment.amountPaise)}) differs from merchant order amount (${formatINR(merchantOrder.amountPaise)}).`
      ],
      ruleEvidence: {
        orderAmountPaise: merchantOrder.amountPaise,
        paymentAmountPaise: primaryPayment.amountPaise,
        differencePaise: diffPaise
      }
    };
  }

  // 9. MISSING_SETTLEMENT Check
  if (!settlementRecords || settlementRecords.length === 0) {
    return {
      classification: "MISSING_SETTLEMENT",
      requiresReview: true,
      expectedAmountPaise: merchantOrder.amountPaise,
      actualAmountPaise: primaryPayment.amountPaise,
      differencePaise: 0,
      gatewayPaymentIds: [primaryPayment.gatewayPaymentId],
      settlementRecordIds: [],
      reasons: ["Captured gateway payment has no corresponding bank settlement record."],
      ruleEvidence: {
        merchantOrderId: merchantOrder.merchantOrderId,
        gatewayPaymentId: primaryPayment.gatewayPaymentId,
        settlementCount: 0
      }
    };
  }

  // 10. FEE_MISMATCH Check
  const primarySettlement = settlementRecords.find((s) => s.entityId === primaryPayment.gatewayPaymentId || s.type === "PAYMENT") || settlementRecords[0];
  const { feePaise: expFee, taxPaise: expTax, netAmountPaise: expNet } = calculateSyntheticFee(merchantOrder.amountPaise);

  const actualFee = primarySettlement.feePaise;
  const actualTax = primarySettlement.taxPaise;
  const actualNet = primarySettlement.netAmountPaise;

  const feeDiffers = actualFee !== expFee || actualTax !== expTax || actualNet !== expNet;

  if (feeDiffers) {
    const diffPaise = actualNet - expNet;
    return {
      classification: "FEE_MISMATCH",
      requiresReview: true,
      expectedAmountPaise: expNet,
      actualAmountPaise: actualNet,
      differencePaise: diffPaise,
      gatewayPaymentIds: [primaryPayment.gatewayPaymentId],
      settlementRecordIds: settlementRecords.map((s) => s.settlementRecordId),
      reasons: [
        `Settlement fee/tax (${formatINR(actualFee)} fee, ${formatINR(actualTax)} tax) differs from synthetic fee policy (${formatINR(expFee)} fee, ${formatINR(expTax)} tax).`
      ],
      ruleEvidence: {
        expectedFeePaise: expFee,
        actualFeePaise: actualFee,
        expectedTaxPaise: expTax,
        actualTaxPaise: actualTax,
        expectedNetPaise: expNet,
        actualNetPaise: actualNet,
        differencePaise: diffPaise
      }
    };
  }

  // 11. MATCHED
  return {
    classification: "MATCHED",
    requiresReview: false,
    expectedAmountPaise: merchantOrder.amountPaise,
    actualAmountPaise: primaryPayment.amountPaise,
    differencePaise: 0,
    gatewayPaymentIds: [primaryPayment.gatewayPaymentId],
    settlementRecordIds: settlementRecords.map((s) => s.settlementRecordId),
    reasons: ["Order, payment, and settlement successfully reconciled with zero discrepancies."],
    ruleEvidence: {
      orderAmountPaise: merchantOrder.amountPaise,
      paymentAmountPaise: primaryPayment.amountPaise,
      settlementNetPaise: actualNet,
      feePaise: actualFee,
      taxPaise: actualTax,
      matches: {
        orderPaymentAmount: true,
        orderPaymentReference: true,
        settlementEntityLink: true,
        feePolicyMatches: true,
        netPayoutMatches: true
      }
    }
  };
}

export default classifyScenario;
