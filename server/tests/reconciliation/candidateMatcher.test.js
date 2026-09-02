import { describe, it, expect } from "vitest";
import {
  matchPaymentCandidates,
  matchSettlementCandidates,
  isTimestampPlausible
} from "../../src/services/reconciliation/candidateMatcher.js";

describe("candidateMatcher", () => {
  const order = {
    merchantOrderId: "ORD-000001",
    amountPaise: 149900,
    currency: "INR",
    createdAtSource: new Date("2026-08-01T10:00:00.000Z")
  };

  it("calculates structured evidence for matching direct payment", () => {
    const payment = {
      gatewayPaymentId: "PAY-000001-A",
      merchantOrderId: "ORD-000001",
      amountPaise: 149900,
      currency: "INR",
      status: "CAPTURED",
      gatewayCreatedAt: new Date("2026-08-01T10:02:00.000Z")
    };

    const candidates = matchPaymentCandidates(order, [payment]);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].evidence.directOrderReference).toBe(true);
    expect(candidates[0].evidence.mismatchedOrderReference).toBe(false);
    expect(candidates[0].evidence.amountMatches).toBe(true);
    expect(candidates[0].evidence.currencyMatches).toBe(true);
  });

  it("AMOUNT-ALONE SAFETY TEST: Two payments with identical amounts without direct reference links are not matched automatically", () => {
    const unlinkedPayments = [
      {
        gatewayPaymentId: "PAY-999-A",
        merchantOrderId: "ORD-OTHER-1", // Conflicting or unlinked order reference
        amountPaise: 149900,
        currency: "INR",
        status: "CAPTURED"
      },
      {
        gatewayPaymentId: "PAY-999-B",
        merchantOrderId: "ORD-OTHER-2",
        amountPaise: 149900,
        currency: "INR",
        status: "CAPTURED"
      }
    ];

    const candidates = matchPaymentCandidates(order, unlinkedPayments);
    expect(candidates).toHaveLength(2);
    // Both fail direct reference check!
    expect(candidates[0].evidence.directOrderReference).toBe(false);
    expect(candidates[1].evidence.directOrderReference).toBe(false);
    expect(candidates[0].evidence.mismatchedOrderReference).toBe(true);
    expect(candidates[1].evidence.mismatchedOrderReference).toBe(true);
  });

  it("evaluates timestamp plausibility correctly", () => {
    const oDate = new Date("2026-08-01T10:00:00.000Z");
    const pValid = new Date("2026-08-01T10:05:00.000Z");
    const pTooLate = new Date("2026-08-20T10:00:00.000Z");

    expect(isTimestampPlausible(oDate, pValid)).toBe(true);
    expect(isTimestampPlausible(oDate, pTooLate)).toBe(false);
  });

  it("matches settlement candidates to payment candidate", () => {
    const paymentCandidate = {
      gatewayPaymentId: "PAY-001-A",
      amountPaise: 149900,
      currency: "INR"
    };

    const settlement = {
      settlementRecordId: "SETREC-001-A",
      entityId: "PAY-001-A",
      grossAmountPaise: 149900,
      currency: "INR"
    };

    const matches = matchSettlementCandidates(order, paymentCandidate, [settlement]);
    expect(matches).toHaveLength(1);
    expect(matches[0].evidence.entityMatchesPayment).toBe(true);
    expect(matches[0].evidence.grossMatchesPayment).toBe(true);
  });
});
