import crypto from "crypto";

/**
 * PII Sanitization for Razorpay Payment records.
 * Explicitly redacts customer email, phone/contact, VPA, card details, and notes address.
 */
export function sanitizePaymentRawData(rawPayment = {}) {
  if (!rawPayment || typeof rawPayment !== "object") return {};

  const sanitized = { ...rawPayment };

  // Strip customer PII
  delete sanitized.email;
  delete sanitized.contact;
  delete sanitized.vpa;
  delete sanitized.card_id;
  delete sanitized.card;
  delete sanitized.token_id;

  if (sanitized.notes && typeof sanitized.notes === "object") {
    const safeNotes = { ...sanitized.notes };
    delete safeNotes.address;
    delete safeNotes.email;
    delete safeNotes.phone;
    delete safeNotes.contact;
    sanitized.notes = safeNotes;
  }

  // Preserve Razorpay order_id as provider metadata
  if (rawPayment.order_id) {
    sanitized.razorpayOrderId = rawPayment.order_id;
  }

  return sanitized;
}

/**
 * Maps Razorpay status string to GatewayPayment model status enum.
 */
export function mapPaymentStatus(statusStr) {
  if (!statusStr) return "UNKNOWN";
  const s = String(statusStr).toLowerCase();

  switch (s) {
    case "created":
      return "CREATED";
    case "authorized":
      return "AUTHORIZED";
    case "captured":
      return "CAPTURED";
    case "failed":
      return "FAILED";
    case "refunded":
      return "REFUNDED";
    default:
      return "UNKNOWN";
  }
}

/**
 * Maps Razorpay payment method string to GatewayPayment model method enum.
 */
export function mapPaymentMethod(methodStr) {
  if (!methodStr) return "OTHER";
  const m = String(methodStr).toLowerCase();

  switch (m) {
    case "card":
      return "CARD";
    case "upi":
      return "UPI";
    case "netbanking":
      return "NETBANKING";
    case "wallet":
      return "WALLET";
    case "emi":
      return "EMI";
    default:
      return "OTHER";
  }
}

/**
 * Normalizes a raw Razorpay payment object into GatewayPayment model shape.
 * 
 * CRITICAL RULE: Does NOT set merchantOrderId automatically from Razorpay order_id.
 */
export function normalizeRazorpayPayment(rawPayment, importBatchId) {
  if (!rawPayment || !rawPayment.id) {
    throw new Error("Invalid Razorpay payment: missing id");
  }

  const sanitizedRaw = sanitizePaymentRawData(rawPayment);

  const amountPaise = typeof rawPayment.amount === "number" ? Math.round(rawPayment.amount) : 0;
  const feePaise = typeof rawPayment.fee === "number" ? Math.round(rawPayment.fee) : 0;
  const taxPaise = typeof rawPayment.tax === "number" ? Math.round(rawPayment.tax) : 0;
  const refundPaise = typeof rawPayment.amount_refunded === "number" ? Math.round(rawPayment.amount_refunded) : 0;

  const createdAt = rawPayment.created_at
    ? new Date(rawPayment.created_at * 1000)
    : new Date();

  return {
    gatewayPaymentId: String(rawPayment.id),
    merchantOrderId: null, // Left unset unless explicit mapping exists
    amountPaise,
    currency: rawPayment.currency ? String(rawPayment.currency).toUpperCase() : "INR",
    status: mapPaymentStatus(rawPayment.status),
    method: mapPaymentMethod(rawPayment.method),
    gatewayFeePaise: feePaise,
    gatewayTaxPaise: taxPaise,
    refundAmountPaise: refundPaise,
    gatewayCreatedAt: createdAt,
    source: "RAZORPAY",
    importBatchId,
    rawData: sanitizedRaw
  };
}

/**
 * Generates a deterministic settlement record ID from stable provider evidence.
 */
export function generateSettlementRecordId(settlementId, entityId, type, createdAt, amount) {
  const seedStr = `${settlementId || ''}:${entityId || ''}:${type || ''}:${createdAt || ''}:${amount || 0}`;
  const hash = crypto.createHash("sha256").update(seedStr).digest("hex").substring(0, 12).toUpperCase();
  return `RZPREC-${hash}`;
}

/**
 * Maps Razorpay settlement recon record type to SettlementRecord model type enum.
 */
export function mapSettlementType(typeStr) {
  if (!typeStr) return "OTHER";
  const t = String(typeStr).toLowerCase();

  switch (t) {
    case "payment":
      return "PAYMENT";
    case "refund":
      return "REFUND";
    case "transfer":
      return "TRANSFER";
    case "adjustment":
      return "ADJUSTMENT";
    default:
      return "OTHER";
  }
}

/**
 * Normalizes a raw Razorpay combined settlement reconciliation line item into SettlementRecord shape.
 */
export function normalizeRazorpaySettlement(rawSettlement, importBatchId) {
  if (!rawSettlement) {
    throw new Error("Invalid Razorpay settlement record: empty payload");
  }

  const settlementId = rawSettlement.settlement_id ? String(rawSettlement.settlement_id) : "SET-UNLINKED";
  const entityId = rawSettlement.entity_id ? String(rawSettlement.entity_id) : (rawSettlement.payment_id ? String(rawSettlement.payment_id) : "ENTITY-UNKNOWN");
  const type = rawSettlement.type ? String(rawSettlement.type).toLowerCase() : "payment";
  const amount = typeof rawSettlement.amount === "number" ? Math.round(rawSettlement.amount) : 0;
  const createdAtSec = rawSettlement.created_at || rawSettlement.settled_at || 0;

  const settlementRecordId = generateSettlementRecordId(settlementId, entityId, type, createdAtSec, amount);

  const feePaise = typeof rawSettlement.fee === "number" ? Math.round(rawSettlement.fee) : 0;
  const taxPaise = typeof rawSettlement.tax === "number" ? Math.round(rawSettlement.tax) : 0;

  // Signed Net Amount Convention:
  // If credit > 0 => positive net payout (credit amount or credit - fee - tax)
  // If debit > 0 => negative net payout (-debit amount)
  let netAmountPaise = 0;
  const credit = typeof rawSettlement.credit === "number" ? Math.round(rawSettlement.credit) : 0;
  const debit = typeof rawSettlement.debit === "number" ? Math.round(rawSettlement.debit) : 0;

  if (credit > 0) {
    netAmountPaise = credit;
  } else if (debit > 0) {
    netAmountPaise = -debit;
  } else {
    // Fallback if debit/credit not explicitly separated
    netAmountPaise = type === "refund" ? -amount : (amount - feePaise - taxPaise);
  }

  const settledAt = rawSettlement.settled_at
    ? new Date(rawSettlement.settled_at * 1000)
    : (rawSettlement.created_at ? new Date(rawSettlement.created_at * 1000) : new Date());

  const sanitizedRaw = {
    ...rawSettlement,
    razorpayOrderId: rawSettlement.order_id || null,
    paymentId: rawSettlement.payment_id || null
  };
  delete sanitizedRaw.email;
  delete sanitizedRaw.contact;
  delete sanitizedRaw.vpa;

  return {
    settlementRecordId,
    settlementId,
    merchantOrderId: null, // Left unset unless explicit mapping
    entityId,
    type: mapSettlementType(type),
    grossAmountPaise: amount,
    feePaise,
    taxPaise,
    netAmountPaise,
    currency: rawSettlement.currency ? String(rawSettlement.currency).toUpperCase() : "INR",
    settledAt,
    utr: rawSettlement.settlement_utr ? String(rawSettlement.settlement_utr) : null,
    source: "RAZORPAY",
    importBatchId,
    rawData: sanitizedRaw
  };
}
