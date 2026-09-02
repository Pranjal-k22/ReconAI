import { isValidPaise } from "../../utils/money.js";

/**
 * Helper to safely trim strings or return null if empty/nil.
 */
function cleanString(val) {
  if (val === null || val === undefined) return null;
  const str = String(val).trim();
  return str.length > 0 ? str : null;
}

/**
 * Helper to safely format dates.
 */
function parseDate(val) {
  if (!val) return null;
  const d = new Date(val);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Normalizes a single MerchantOrder object.
 */
export function normalizeOrder(order) {
  if (!order || typeof order !== "object") {
    return { normalized: null, warnings: ["MerchantOrder object is missing or invalid"] };
  }

  const warnings = [];
  const merchantOrderId = cleanString(order.merchantOrderId);
  if (!merchantOrderId) {
    warnings.push("MerchantOrder missing merchantOrderId");
  }

  const currency = cleanString(order.currency)?.toUpperCase() || "INR";
  const status = cleanString(order.status)?.toUpperCase() || "CREATED";
  const createdAtSource = parseDate(order.createdAtSource);

  let amountPaise = order.amountPaise;
  if (amountPaise !== null && amountPaise !== undefined) {
    if (!isValidPaise(amountPaise, false)) {
      warnings.push(`MerchantOrder amountPaise is invalid: ${amountPaise}`);
    }
  } else {
    amountPaise = null;
  }

  return {
    normalized: {
      merchantOrderId,
      customerReference: cleanString(order.customerReference),
      amountPaise,
      currency,
      status,
      source: cleanString(order.source) || "SYNTHETIC",
      createdAtSource,
      metadata: order.metadata || {}
    },
    warnings
  };
}

/**
 * Normalizes a single GatewayPayment object.
 */
export function normalizePayment(payment) {
  if (!payment || typeof payment !== "object") {
    return { normalized: null, warnings: ["GatewayPayment object is missing or invalid"] };
  }

  const warnings = [];
  const gatewayPaymentId = cleanString(payment.gatewayPaymentId);
  if (!gatewayPaymentId) {
    warnings.push("GatewayPayment missing gatewayPaymentId");
  }

  const merchantOrderId = cleanString(payment.merchantOrderId);
  const currency = cleanString(payment.currency)?.toUpperCase() || "INR";
  const status = cleanString(payment.status)?.toUpperCase() || "CAPTURED";
  const method = cleanString(payment.method)?.toUpperCase() || "UPI";
  const gatewayCreatedAt = parseDate(payment.gatewayCreatedAt);

  let amountPaise = payment.amountPaise;
  if (amountPaise !== null && amountPaise !== undefined) {
    if (!isValidPaise(amountPaise, false)) {
      warnings.push(`GatewayPayment amountPaise is invalid: ${amountPaise}`);
    }
  } else {
    amountPaise = null;
  }

  const feePaise = isValidPaise(payment.feePaise, false) ? payment.feePaise : 0;
  const taxPaise = isValidPaise(payment.taxPaise, false) ? payment.taxPaise : 0;
  const refundAmountPaise = isValidPaise(payment.refundAmountPaise, false) ? payment.refundAmountPaise : 0;

  return {
    normalized: {
      gatewayPaymentId,
      merchantOrderId,
      amountPaise,
      currency,
      status,
      method,
      feePaise,
      taxPaise,
      refundAmountPaise,
      gatewayCreatedAt
    },
    warnings
  };
}

/**
 * Normalizes a single SettlementRecord object.
 */
export function normalizeSettlement(settlement) {
  if (!settlement || typeof settlement !== "object") {
    return { normalized: null, warnings: ["SettlementRecord object is missing or invalid"] };
  }

  const warnings = [];
  const settlementRecordId = cleanString(settlement.settlementRecordId);
  if (!settlementRecordId) {
    warnings.push("SettlementRecord missing settlementRecordId");
  }

  const settlementId = cleanString(settlement.settlementId);
  const entityId = cleanString(settlement.entityId);
  const merchantOrderId = cleanString(settlement.merchantOrderId);
  const currency = cleanString(settlement.currency)?.toUpperCase() || "INR";
  const type = cleanString(settlement.type)?.toUpperCase() || "PAYMENT";
  const settledAt = parseDate(settlement.settledAt);
  const utr = cleanString(settlement.utr);

  let grossAmountPaise = settlement.grossAmountPaise;
  if (grossAmountPaise !== null && grossAmountPaise !== undefined) {
    if (!isValidPaise(grossAmountPaise, false)) {
      warnings.push(`SettlementRecord grossAmountPaise is invalid: ${grossAmountPaise}`);
    }
  } else {
    grossAmountPaise = null;
  }

  let netAmountPaise = settlement.netAmountPaise;
  if (netAmountPaise !== null && netAmountPaise !== undefined) {
    if (!isValidPaise(netAmountPaise, true)) {
      warnings.push(`SettlementRecord netAmountPaise is invalid: ${netAmountPaise}`);
    }
  } else {
    netAmountPaise = null;
  }

  const feePaise = isValidPaise(settlement.feePaise, false) ? settlement.feePaise : 0;
  const taxPaise = isValidPaise(settlement.taxPaise, false) ? settlement.taxPaise : 0;

  return {
    normalized: {
      settlementRecordId,
      settlementId,
      entityId,
      merchantOrderId,
      grossAmountPaise,
      feePaise,
      taxPaise,
      netAmountPaise,
      currency,
      settledAt,
      utr,
      type
    },
    warnings
  };
}

/**
 * Normalizes all records for a reconciliation scenario.
 */
export function normalizeScenarioInputs({ merchantOrder, gatewayPayments = [], settlementRecords = [] }) {
  const allWarnings = [];

  const { normalized: normOrder, warnings: orderWarnings } = normalizeOrder(merchantOrder);
  allWarnings.push(...orderWarnings);

  const normPayments = [];
  if (Array.isArray(gatewayPayments)) {
    for (const p of gatewayPayments) {
      const { normalized: np, warnings: pw } = normalizePayment(p);
      allWarnings.push(...pw);
      if (np) normPayments.push(np);
    }
  }

  const normSettlements = [];
  if (Array.isArray(settlementRecords)) {
    for (const s of settlementRecords) {
      const { normalized: ns, warnings: sw } = normalizeSettlement(s);
      allWarnings.push(...sw);
      if (ns) normSettlements.push(ns);
    }
  }

  return {
    merchantOrder: normOrder,
    gatewayPayments: normPayments,
    settlementRecords: normSettlements,
    warnings: allWarnings
  };
}
