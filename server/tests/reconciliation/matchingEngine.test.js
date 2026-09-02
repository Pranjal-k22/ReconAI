import { describe, it, expect } from "vitest";
import { reconcileScenario } from "../../src/services/reconciliation/matchingEngine.js";

describe("matchingEngine - All 12 Classification Tests", () => {
  it("classifies MATCHED for clean exact 3-way match", () => {
    const res = reconcileScenario({
      merchantOrder: {
        merchantOrderId: "ORD-001",
        amountPaise: 149900,
        currency: "INR",
        status: "PAID"
      },
      gatewayPayments: [
        {
          gatewayPaymentId: "PAY-001-A",
          merchantOrderId: "ORD-001",
          amountPaise: 149900,
          currency: "INR",
          status: "CAPTURED",
          feePaise: 2998,
          taxPaise: 540
        }
      ],
      settlementRecords: [
        {
          settlementRecordId: "SETREC-001-A",
          settlementId: "SET-001",
          entityId: "PAY-001-A",
          merchantOrderId: "ORD-001",
          grossAmountPaise: 149900,
          feePaise: 2998,
          taxPaise: 540,
          netAmountPaise: 146362,
          currency: "INR",
          type: "PAYMENT"
        }
      ]
    });

    expect(res.classification).toBe("MATCHED");
    expect(res.requiresReview).toBe(false);
    expect(res.confidence).toBeGreaterThanOrEqual(0.95);
    expect(res.differencePaise).toBe(0);
    expect(res.gatewayPaymentIds).toEqual(["PAY-001-A"]);
    expect(res.settlementRecordIds).toEqual(["SETREC-001-A"]);
  });

  it("classifies AMOUNT_MISMATCH when gateway amount differs from order", () => {
    const res = reconcileScenario({
      merchantOrder: {
        merchantOrderId: "ORD-002",
        amountPaise: 149900,
        currency: "INR",
        status: "PAID"
      },
      gatewayPayments: [
        {
          gatewayPaymentId: "PAY-002-A",
          merchantOrderId: "ORD-002",
          amountPaise: 139900,
          currency: "INR",
          status: "CAPTURED"
        }
      ],
      settlementRecords: [
        {
          settlementRecordId: "SETREC-002-A",
          settlementId: "SET-001",
          entityId: "PAY-002-A",
          merchantOrderId: "ORD-002",
          grossAmountPaise: 139900,
          currency: "INR"
        }
      ]
    });

    expect(res.classification).toBe("AMOUNT_MISMATCH");
    expect(res.requiresReview).toBe(true);
    expect(res.expectedAmountPaise).toBe(149900);
    expect(res.actualAmountPaise).toBe(139900);
    expect(res.differencePaise).toBe(-10000); // 139900 - 149900
  });

  it("classifies MISSING_PAYMENT when no gateway payment exists", () => {
    const res = reconcileScenario({
      merchantOrder: {
        merchantOrderId: "ORD-003",
        amountPaise: 149900,
        currency: "INR",
        status: "PENDING"
      },
      gatewayPayments: [],
      settlementRecords: []
    });

    expect(res.classification).toBe("MISSING_PAYMENT");
    expect(res.requiresReview).toBe(true);
    expect(res.expectedAmountPaise).toBe(149900);
    expect(res.actualAmountPaise).toBeNull();
    expect(res.differencePaise).toBeNull();
  });

  it("classifies MISSING_SETTLEMENT when captured payment has no settlement record", () => {
    const res = reconcileScenario({
      merchantOrder: {
        merchantOrderId: "ORD-004",
        amountPaise: 149900,
        currency: "INR",
        status: "PAID"
      },
      gatewayPayments: [
        {
          gatewayPaymentId: "PAY-004-A",
          merchantOrderId: "ORD-004",
          amountPaise: 149900,
          currency: "INR",
          status: "CAPTURED"
        }
      ],
      settlementRecords: []
    });

    expect(res.classification).toBe("MISSING_SETTLEMENT");
    expect(res.requiresReview).toBe(true);
    expect(res.expectedAmountPaise).toBe(149900);
    expect(res.actualAmountPaise).toBe(149900);
    expect(res.differencePaise).toBe(0);
    expect(res.settlementRecordIds).toEqual([]);
  });

  it("classifies DUPLICATE_PAYMENT when multiple captured payments claim single order", () => {
    const res = reconcileScenario({
      merchantOrder: {
        merchantOrderId: "ORD-005",
        amountPaise: 149900,
        currency: "INR",
        status: "PAID"
      },
      gatewayPayments: [
        {
          gatewayPaymentId: "PAY-005-A",
          merchantOrderId: "ORD-005",
          amountPaise: 149900,
          currency: "INR",
          status: "CAPTURED"
        },
        {
          gatewayPaymentId: "PAY-005-B",
          merchantOrderId: "ORD-005",
          amountPaise: 149900,
          currency: "INR",
          status: "CAPTURED"
        }
      ],
      settlementRecords: [
        {
          settlementRecordId: "SETREC-005-A",
          settlementId: "SET-001",
          entityId: "PAY-005-A",
          merchantOrderId: "ORD-005",
          grossAmountPaise: 149900,
          currency: "INR"
        }
      ]
    });

    expect(res.classification).toBe("DUPLICATE_PAYMENT");
    expect(res.requiresReview).toBe(true);
    expect(res.gatewayPaymentIds).toHaveLength(2);
    expect(res.expectedAmountPaise).toBe(149900);
    expect(res.actualAmountPaise).toBe(299800);
    expect(res.differencePaise).toBe(149900);
  });

  it("classifies DUPLICATE_SETTLEMENT when multiple settlement records exist for one payment", () => {
    const res = reconcileScenario({
      merchantOrder: {
        merchantOrderId: "ORD-006",
        amountPaise: 149900,
        currency: "INR",
        status: "PAID"
      },
      gatewayPayments: [
        {
          gatewayPaymentId: "PAY-006-A",
          merchantOrderId: "ORD-006",
          amountPaise: 149900,
          currency: "INR",
          status: "CAPTURED"
        }
      ],
      settlementRecords: [
        {
          settlementRecordId: "SETREC-006-A",
          settlementId: "SET-001",
          entityId: "PAY-006-A",
          merchantOrderId: "ORD-006",
          grossAmountPaise: 149900,
          netAmountPaise: 146362,
          currency: "INR",
          type: "PAYMENT"
        },
        {
          settlementRecordId: "SETREC-006-B",
          settlementId: "SET-002",
          entityId: "PAY-006-A",
          merchantOrderId: "ORD-006",
          grossAmountPaise: 149900,
          netAmountPaise: 146362,
          currency: "INR",
          type: "PAYMENT"
        }
      ]
    });

    expect(res.classification).toBe("DUPLICATE_SETTLEMENT");
    expect(res.requiresReview).toBe(true);
    expect(res.settlementRecordIds).toHaveLength(2);
  });

  it("classifies FEE_MISMATCH when actual settlement fee differs from synthetic fee policy", () => {
    const res = reconcileScenario({
      merchantOrder: {
        merchantOrderId: "ORD-007",
        amountPaise: 149900,
        currency: "INR",
        status: "PAID"
      },
      gatewayPayments: [
        {
          gatewayPaymentId: "PAY-007-A",
          merchantOrderId: "ORD-007",
          amountPaise: 149900,
          currency: "INR",
          status: "CAPTURED"
        }
      ],
      settlementRecords: [
        {
          settlementRecordId: "SETREC-007-A",
          settlementId: "SET-001",
          entityId: "PAY-007-A",
          merchantOrderId: "ORD-007",
          grossAmountPaise: 149900,
          feePaise: 5000, // ₹50 instead of synthetic 2998
          taxPaise: 900,  // ₹9 instead of synthetic 540
          netAmountPaise: 144000,
          currency: "INR",
          type: "PAYMENT"
        }
      ]
    });

    expect(res.classification).toBe("FEE_MISMATCH");
    expect(res.requiresReview).toBe(true);
  });

  it("classifies REFUND_MISMATCH when gateway refund differs from settlement refund", () => {
    const res = reconcileScenario({
      merchantOrder: {
        merchantOrderId: "ORD-008",
        amountPaise: 149900,
        currency: "INR",
        status: "REFUNDED"
      },
      gatewayPayments: [
        {
          gatewayPaymentId: "PAY-008-A",
          merchantOrderId: "ORD-008",
          amountPaise: 149900,
          currency: "INR",
          status: "REFUNDED",
          refundAmountPaise: 50000 // ₹500
        }
      ],
      settlementRecords: [
        {
          settlementRecordId: "SETREC-008-A",
          settlementId: "SET-001",
          entityId: "PAY-008-A",
          merchantOrderId: "ORD-008",
          grossAmountPaise: 149900,
          feePaise: 2998,
          taxPaise: 540,
          netAmountPaise: 146362,
          currency: "INR",
          type: "PAYMENT"
        },
        {
          settlementRecordId: "SETREC-008-B",
          settlementId: "SET-001",
          entityId: "PAY-008-A",
          merchantOrderId: "ORD-008",
          grossAmountPaise: 30000, // ₹300 refund payout
          feePaise: 0,
          taxPaise: 0,
          netAmountPaise: -30000,
          currency: "INR",
          type: "REFUND"
        }
      ]
    });

    expect(res.classification).toBe("REFUND_MISMATCH");
    expect(res.requiresReview).toBe(true);
    expect(res.expectedAmountPaise).toBe(50000);
    expect(res.actualAmountPaise).toBe(30000);
    expect(res.differencePaise).toBe(-20000);
  });

  it("classifies REFERENCE_MISMATCH when payment references wrong order ID", () => {
    const res = reconcileScenario({
      merchantOrder: {
        merchantOrderId: "ORD-009",
        amountPaise: 149900,
        currency: "INR",
        status: "PAID"
      },
      gatewayPayments: [
        {
          gatewayPaymentId: "PAY-009-A",
          merchantOrderId: "ORD-99999", // Conflict!
          amountPaise: 149900,
          currency: "INR",
          status: "CAPTURED"
        }
      ],
      settlementRecords: []
    });

    expect(res.classification).toBe("REFERENCE_MISMATCH");
    expect(res.requiresReview).toBe(true);
  });

  it("classifies STATUS_MISMATCH when order is PAID but payment is FAILED", () => {
    const res = reconcileScenario({
      merchantOrder: {
        merchantOrderId: "ORD-010",
        amountPaise: 149900,
        currency: "INR",
        status: "PAID"
      },
      gatewayPayments: [
        {
          gatewayPaymentId: "PAY-010-A",
          merchantOrderId: "ORD-010",
          amountPaise: 149900,
          currency: "INR",
          status: "FAILED"
        }
      ],
      settlementRecords: []
    });

    expect(res.classification).toBe("STATUS_MISMATCH");
    expect(res.requiresReview).toBe(true);
  });

  it("classifies INVALID_DATA when currency conflicts across records", () => {
    const res = reconcileScenario({
      merchantOrder: {
        merchantOrderId: "ORD-011",
        amountPaise: 149900,
        currency: "INR",
        status: "PAID"
      },
      gatewayPayments: [
        {
          gatewayPaymentId: "PAY-011-A",
          merchantOrderId: "ORD-011",
          amountPaise: 149900,
          currency: "USD", // Mismatch!
          status: "CAPTURED"
        }
      ],
      settlementRecords: []
    });

    expect(res.classification).toBe("INVALID_DATA");
    expect(res.requiresReview).toBe(true);
  });

  it("CRITICAL AMBIGUOUS DEMO TEST: ORD-000116 remains AMBIGUOUS and requires review", () => {
    const res = reconcileScenario({
      merchantOrder: {
        merchantOrderId: "ORD-000116",
        amountPaise: 149900,
        currency: "INR",
        status: "PAID"
      },
      gatewayPayments: [
        {
          gatewayPaymentId: "PAY-000116-A",
          merchantOrderId: "ORD-000116",
          amountPaise: 149900,
          currency: "INR",
          status: "CAPTURED"
        },
        {
          gatewayPaymentId: "PAY-000116-B",
          merchantOrderId: "ORD-000116",
          amountPaise: 149900,
          currency: "INR",
          status: "CAPTURED"
        }
      ],
      settlementRecords: [
        {
          settlementRecordId: "SETREC-000116-A",
          settlementId: "SET-202608-12",
          entityId: "pay_UNLINKED_AMBIGUOUS",
          merchantOrderId: null,
          grossAmountPaise: 149900,
          feePaise: 2998,
          taxPaise: 540,
          netAmountPaise: 146362,
          currency: "INR",
          type: "PAYMENT"
        }
      ]
    });

    expect(res.classification).toBe("AMBIGUOUS");
    expect(res.requiresReview).toBe(true);
    expect(res.confidence).toBeLessThan(0.70);
    expect(res.gatewayPaymentIds).toContain("PAY-000116-A");
    expect(res.gatewayPaymentIds).toContain("PAY-000116-B");
    // Engine does NOT arbitrarily select one candidate as clean match!
  });
});
