import { describe, it, expect } from "vitest";
import {
  normalizeOrder,
  normalizePayment,
  normalizeSettlement,
  normalizeScenarioInputs
} from "../../src/services/reconciliation/normalizationService.js";

describe("normalizationService", () => {
  it("normalizes order fields correctly", () => {
    const rawOrder = {
      merchantOrderId: "  ORD-000001  ",
      customerReference: " CUST-101 ",
      amountPaise: 149900,
      currency: "inr",
      status: "paid",
      createdAtSource: "2026-08-01T10:00:00.000Z"
    };

    const { normalized, warnings } = normalizeOrder(rawOrder);
    expect(warnings).toHaveLength(0);
    expect(normalized.merchantOrderId).toBe("ORD-000001");
    expect(normalized.customerReference).toBe("CUST-101");
    expect(normalized.currency).toBe("INR");
    expect(normalized.status).toBe("PAID");
    expect(normalized.amountPaise).toBe(149900);
  });

  it("normalizes payment fields and preserves null missing values", () => {
    const rawPayment = {
      gatewayPaymentId: "PAY-001-A",
      merchantOrderId: null,
      amountPaise: 149900,
      currency: "inr",
      status: "captured",
      method: "upi"
    };

    const { normalized } = normalizePayment(rawPayment);
    expect(normalized.gatewayPaymentId).toBe("PAY-001-A");
    expect(normalized.merchantOrderId).toBeNull();
    expect(normalized.currency).toBe("INR");
    expect(normalized.status).toBe("CAPTURED");
  });

  it("normalizes settlement records cleanly", () => {
    const rawSettlement = {
      settlementRecordId: "SETREC-001",
      settlementId: "SET-001",
      entityId: "PAY-001-A",
      grossAmountPaise: 149900,
      feePaise: 2998,
      taxPaise: 540,
      netAmountPaise: 146362,
      currency: "inr",
      type: "payment"
    };

    const { normalized } = normalizeSettlement(rawSettlement);
    expect(normalized.settlementRecordId).toBe("SETREC-001");
    expect(normalized.entityId).toBe("PAY-001-A");
    expect(normalized.netAmountPaise).toBe(146362);
    expect(normalized.type).toBe("PAYMENT");
  });

  it("normalizes full scenario inputs preserving missing array items", () => {
    const { merchantOrder, gatewayPayments, settlementRecords, warnings } = normalizeScenarioInputs({
      merchantOrder: { merchantOrderId: "ORD-123", amountPaise: 5000 },
      gatewayPayments: [],
      settlementRecords: []
    });

    expect(merchantOrder.merchantOrderId).toBe("ORD-123");
    expect(gatewayPayments).toEqual([]);
    expect(settlementRecords).toEqual([]);
    expect(warnings).toHaveLength(0);
  });
});
