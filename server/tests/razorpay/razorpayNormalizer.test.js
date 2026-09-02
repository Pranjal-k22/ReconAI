import { describe, it, expect } from "vitest";
import {
  sanitizePaymentRawData,
  mapPaymentStatus,
  mapPaymentMethod,
  normalizeRazorpayPayment,
  generateSettlementRecordId,
  mapSettlementType,
  normalizeRazorpaySettlement
} from "../../src/services/razorpay/razorpayNormalizer.js";

describe("Razorpay Normalizer, PII Sanitizer & Signed Net Calculations", () => {
  it("PII STRIPPING: should sanitize customer email, phone, VPA, and card payloads from rawData", () => {
    const rawPayment = {
      id: "pay_PII_001",
      entity: "payment",
      amount: 150000,
      currency: "INR",
      status: "captured",
      method: "upi",
      email: "customer@example.com",
      contact: "+919876543210",
      vpa: "customer@upi",
      card_id: "card_123456",
      card: { number: "4111xxxx1111", cvv: "123" },
      notes: {
        order_ref: "ORD-999",
        address: "123 Private St",
        email: "customer@example.com"
      }
    };

    const sanitized = sanitizePaymentRawData(rawPayment);

    expect(sanitized.email).toBeUndefined();
    expect(sanitized.contact).toBeUndefined();
    expect(sanitized.vpa).toBeUndefined();
    expect(sanitized.card_id).toBeUndefined();
    expect(sanitized.card).toBeUndefined();
    expect(sanitized.notes.address).toBeUndefined();
    expect(sanitized.notes.email).toBeUndefined();
    expect(sanitized.notes.order_ref).toBe("ORD-999");
  });

  it("MERCHANT ID SAFETY: should NOT set merchantOrderId automatically from Razorpay order_id", () => {
    const rawPayment = {
      id: "pay_ORD_001",
      amount: 200000,
      status: "captured",
      method: "card",
      order_id: "order_RZP_12345"
    };

    const norm = normalizeRazorpayPayment(rawPayment, "BATCH-TEST");

    expect(norm.gatewayPaymentId).toBe("pay_ORD_001");
    expect(norm.merchantOrderId).toBeNull(); // Mandatory safety invariant!
    expect(norm.rawData.razorpayOrderId).toBe("order_RZP_12345");
  });

  it("PAYMENT NORMALIZATION: should correctly map status, method, and integer paise amounts", () => {
    const rawPayment = {
      id: "pay_TEST_001",
      amount: 149900,
      currency: "inr",
      status: "captured",
      method: "netbanking",
      fee: 2998,
      tax: 540,
      amount_refunded: 0,
      created_at: 1785542400
    };

    const norm = normalizeRazorpayPayment(rawPayment, "BATCH-PAY-01");

    expect(norm.gatewayPaymentId).toBe("pay_TEST_001");
    expect(norm.amountPaise).toBe(149900);
    expect(norm.currency).toBe("INR");
    expect(norm.status).toBe("CAPTURED");
    expect(norm.method).toBe("NETBANKING");
    expect(norm.gatewayFeePaise).toBe(2998);
    expect(norm.gatewayTaxPaise).toBe(540);
    expect(norm.refundAmountPaise).toBe(0);
    expect(norm.source).toBe("RAZORPAY");
    expect(norm.gatewayCreatedAt).toBeInstanceOf(Date);
  });

  it("DETERMINISTIC SETTLEMENT ID: normalizing same settlement evidence twice should yield identical settlementRecordId", () => {
    const id1 = generateSettlementRecordId("set_001", "pay_001", "payment", 1785542400, 100000);
    const id2 = generateSettlementRecordId("set_001", "pay_001", "payment", 1785542400, 100000);
    const idDiff = generateSettlementRecordId("set_001", "pay_002", "payment", 1785542400, 100000);

    expect(id1).toBe(id2);
    expect(id1).toMatch(/^RZPREC-[A-F0-9]{12}$/);
    expect(id1).not.toBe(idDiff);
  });

  it("SIGNED NET AMOUNT CONVENTION: credit > 0 produces positive net amount; debit > 0 produces negative net amount", () => {
    const rawCreditPayment = {
      settlement_id: "set_PAY_01",
      entity_id: "pay_100",
      type: "payment",
      amount: 100000,
      fee: 2000,
      tax: 360,
      credit: 97640,
      debit: 0,
      settled_at: 1785542400
    };

    const creditNorm = normalizeRazorpaySettlement(rawCreditPayment, "BATCH-SET-01");
    expect(creditNorm.type).toBe("PAYMENT");
    expect(creditNorm.netAmountPaise).toBe(97640);
    expect(creditNorm.grossAmountPaise).toBe(100000);

    const rawDebitRefund = {
      settlement_id: "set_REF_01",
      entity_id: "rfnd_200",
      payment_id: "pay_100",
      type: "refund",
      amount: 50000,
      fee: 0,
      tax: 0,
      credit: 0,
      debit: 50000,
      settled_at: 1785542400
    };

    const debitNorm = normalizeRazorpaySettlement(rawDebitRefund, "BATCH-SET-01");
    expect(debitNorm.type).toBe("REFUND");
    expect(debitNorm.netAmountPaise).toBe(-50000); // Negative net amount for refund payout debit!
    expect(debitNorm.entityId).toBe("rfnd_200");
  });
});
