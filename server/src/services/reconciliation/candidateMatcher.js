/**
 * Evaluates whether timestamps between order creation and payment creation are plausible.
 */
export function isTimestampPlausible(orderDate, paymentDate) {
  if (!orderDate || !paymentDate) return true;
  const oTime = new Date(orderDate).getTime();
  const pTime = new Date(paymentDate).getTime();
  if (isNaN(oTime) || isNaN(pTime)) return true;

  const diffMs = pTime - oTime;
  const maxDelayMs = 7 * 24 * 60 * 60 * 1000; // 7 days
  const allowedClockSkewMs = -5 * 60 * 1000; // -5 minutes
  return diffMs >= allowedClockSkewMs && diffMs <= maxDelayMs;
}

/**
 * Evaluates payment candidates for a given merchant order.
 */
export function matchPaymentCandidates(merchantOrder, gatewayPayments = []) {
  if (!merchantOrder || !Array.isArray(gatewayPayments)) {
    return [];
  }

  const orderId = merchantOrder.merchantOrderId;
  const orderAmount = merchantOrder.amountPaise;
  const orderCurrency = merchantOrder.currency;

  return gatewayPayments.map((payment) => {
    const paymentId = payment.gatewayPaymentId;
    const paymentOrderId = payment.merchantOrderId;

    const directOrderReference = Boolean(paymentOrderId && orderId && paymentOrderId === orderId);
    const mismatchedOrderReference = Boolean(paymentOrderId && orderId && paymentOrderId !== orderId);
    const amountMatches = Boolean(orderAmount !== null && payment.amountPaise !== null && payment.amountPaise === orderAmount);
    const currencyMatches = Boolean(orderCurrency && payment.currency && payment.currency === orderCurrency);
    const statusCompatible = ["CAPTURED", "AUTHORIZED", "REFUNDED", "PARTIALLY_REFUNDED", "PAID"].includes(payment.status);
    const timestampPlausible = isTimestampPlausible(merchantOrder.createdAtSource, payment.gatewayCreatedAt);

    return {
      payment,
      gatewayPaymentId: paymentId,
      evidence: {
        directOrderReference,
        mismatchedOrderReference,
        amountMatches,
        currencyMatches,
        statusCompatible,
        timestampPlausible
      }
    };
  });
}

/**
 * Evaluates settlement candidates for a given payment candidate.
 */
export function matchSettlementCandidates(merchantOrder, paymentCandidate, settlementRecords = []) {
  if (!paymentCandidate || !Array.isArray(settlementRecords)) {
    return [];
  }

  const payment = paymentCandidate.payment || paymentCandidate;
  const paymentId = payment.gatewayPaymentId;
  const orderId = merchantOrder?.merchantOrderId;

  return settlementRecords.map((settlement) => {
    const entityMatchesPayment = Boolean(settlement.entityId && paymentId && settlement.entityId === paymentId);
    const directOrderReference = Boolean(settlement.merchantOrderId && orderId && settlement.merchantOrderId === orderId);
    const mismatchedOrderReference = Boolean(settlement.merchantOrderId && orderId && settlement.merchantOrderId !== orderId);
    const grossMatchesPayment = Boolean(settlement.grossAmountPaise !== null && payment.amountPaise !== null && settlement.grossAmountPaise === payment.amountPaise);
    const currencyMatches = Boolean(settlement.currency && payment.currency && settlement.currency === payment.currency);

    return {
      settlement,
      settlementRecordId: settlement.settlementRecordId,
      evidence: {
        entityMatchesPayment,
        directOrderReference,
        mismatchedOrderReference,
        grossMatchesPayment,
        currencyMatches
      }
    };
  });
}
