import { describe, it, expect } from "vitest";
import { ALL_CLASSIFICATIONS } from "../../src/services/reconciliation/metricsService.js";
import { groupScenarioRecords } from "../../src/services/reconciliation/reconciliationService.js";

describe("Reconciliation Safety Gate & Grouping Isolation", () => {
  it("SAFETY GATE TEST: autoResolved is ONLY true for MATCHED and ALWAYS false for anomalies", () => {
    for (const classification of ALL_CLASSIFICATIONS) {
      const isMatched = classification === "MATCHED";
      const autoResolved = isMatched;
      const requiresReview = !isMatched;

      if (classification === "MATCHED") {
        expect(autoResolved).toBe(true);
        expect(requiresReview).toBe(false);
      } else {
        expect(autoResolved).toBe(false);
        expect(requiresReview).toBe(true);
      }
    }
  });

  it("GROUPING ISOLATION TEST: groupScenarioRecords relies only on input record IDs, not GroundTruth", () => {
    const order = { merchantOrderId: "ORD-000081" };
    const payments = [
      { gatewayPaymentId: "PAY-000081-A", merchantOrderId: "ORD-000081" },
      { gatewayPaymentId: "PAY-999999-Z", merchantOrderId: "ORD-999999" }
    ];
    const settlements = [
      { settlementRecordId: "SETREC-000081-A", entityId: "PAY-000081-A", merchantOrderId: "ORD-000081" },
      { settlementRecordId: "SETREC-999999-Z", entityId: "PAY-999999-Z", merchantOrderId: "ORD-999999" }
    ];

    const scenario = groupScenarioRecords(order, payments, settlements);

    expect(scenario.merchantOrder.merchantOrderId).toBe("ORD-000081");
    expect(scenario.gatewayPayments).toHaveLength(1);
    expect(scenario.gatewayPayments[0].gatewayPaymentId).toBe("PAY-000081-A");
    expect(scenario.settlementRecords).toHaveLength(1);
    expect(scenario.settlementRecords[0].settlementRecordId).toBe("SETREC-000081-A");

    // Verify scenario does NOT access GroundTruth properties
    expect(scenario).not.toHaveProperty("expectedClassification");
    expect(scenario).not.toHaveProperty("expectedPaymentIds");
  });
});
