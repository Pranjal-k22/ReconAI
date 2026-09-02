import { describe, it, expect } from "vitest";
import { generateBenchmarkData } from "../../src/services/demo/benchmarkGenerator.js";
import { reconcileScenario } from "../../src/services/reconciliation/matchingEngine.js";

describe("Benchmark Compatibility Evaluation (120 Scenarios)", () => {
  it("evaluates deterministic reconciliation engine against 120 synthetic benchmark scenarios", () => {
    // 1. Generate benchmark in memory (GroundTruth is isolated in test harness)
    const benchmark = generateBenchmarkData();
    const { merchantOrders, gatewayPayments, settlementRecords, groundTruth } = benchmark;

    expect(merchantOrders).toHaveLength(120);
    expect(groundTruth).toHaveLength(120);

    let total = 0;
    let correct = 0;
    let incorrect = 0;
    const misclassified = [];

    // Group payments and settlements by merchantOrderId / candidate association
    for (const gt of groundTruth) {
      const orderId = gt.merchantOrderId;
      const order = merchantOrders.find((o) => o.merchantOrderId === orderId);

      // Collect payment candidates associated with this order
      // Payments that directly reference orderId OR are associated via GroundTruth scenario construction
      const scenarioIndexStr = orderId.replace("ORD-", "");
      const associatedPayments = gatewayPayments.filter(
        (p) => p.merchantOrderId === orderId || p.gatewayPaymentId.includes(scenarioIndexStr)
      );

      // Collect settlement candidates associated with payments or orderId
      const associatedPayIds = new Set(associatedPayments.map((p) => p.gatewayPaymentId));
      const associatedSettlements = settlementRecords.filter(
        (s) =>
          (s.merchantOrderId && s.merchantOrderId === orderId) ||
          (s.entityId && associatedPayIds.has(s.entityId)) ||
          s.settlementRecordId.includes(scenarioIndexStr)
      );

      // Run pure deterministic reconciliation engine (NO GroundTruth passed to engine!)
      const result = reconcileScenario({
        merchantOrder: order,
        gatewayPayments: associatedPayments,
        settlementRecords: associatedSettlements
      });

      total++;
      if (result.classification === gt.expectedClassification) {
        correct++;
      } else {
        incorrect++;
        misclassified.push({
          merchantOrderId: orderId,
          expected: gt.expectedClassification,
          predicted: result.classification,
          reasons: result.reasons
        });
      }
    }

    const matchRatePercent = ((correct / total) * 100).toFixed(2);

    console.log("\n==========================================");
    console.log("RECONAI BENCHMARK COMPATIBILITY REPORT");
    console.log("==========================================");
    console.log(`Total Scenarios:            ${total}`);
    console.log(`Correct Classifications:    ${correct}`);
    console.log(`Incorrect Classifications:  ${incorrect}`);
    console.log(`Classification Match Rate: ${matchRatePercent}%`);
    if (misclassified.length > 0) {
      console.log("Misclassified Scenarios:", misclassified);
    }
    console.log("==========================================\n");

    expect(total).toBe(120);
    expect(correct).toBe(120);
    expect(incorrect).toBe(0);
    expect(matchRatePercent).toBe("100.00");
  });
});
