import { describe, it, expect } from "vitest";
import { generateBenchmarkData, BENCHMARK_CONSTANTS } from "../../src/services/demo/benchmarkGenerator.js";
import { MerchantOrder } from "../../src/models/MerchantOrder.js";
import { GatewayPayment } from "../../src/models/GatewayPayment.js";
import { SettlementRecord } from "../../src/models/SettlementRecord.js";
import { GroundTruth } from "../../src/models/GroundTruth.js";

describe("Deterministic 120-Scenario Benchmark Generator", () => {
  it("should generate exactly 120 scenarios with target classification distribution", () => {
    const data = generateBenchmarkData();

    expect(data.merchantOrders).toHaveLength(120);
    expect(data.groundTruth).toHaveLength(120);

    const counts = {};
    for (const gt of data.groundTruth) {
      counts[gt.expectedClassification] = (counts[gt.expectedClassification] || 0) + 1;
    }

    expect(counts).toEqual(BENCHMARK_CONSTANTS.DISTRIBUTION);
  });

  it("should be 100% deterministic given the same seed", () => {
    const data1 = generateBenchmarkData("RECONAI_DEMO_2026");
    const data2 = generateBenchmarkData("RECONAI_DEMO_2026");

    expect(data1.summary).toEqual(data2.summary);
    expect(data1.merchantOrders).toEqual(data2.merchantOrders);
    expect(data1.gatewayPayments).toEqual(data2.gatewayPayments);
    expect(data1.settlementRecords).toEqual(data2.settlementRecords);
    expect(data1.groundTruth).toEqual(data2.groundTruth);
  });

  it("should validate all generated Mongoose documents against schema rules", async () => {
    const data = generateBenchmarkData();

    for (const order of data.merchantOrders) {
      const doc = new MerchantOrder(order);
      await expect(doc.validate()).resolves.toBeUndefined();
    }

    for (const pay of data.gatewayPayments) {
      const doc = new GatewayPayment(pay);
      await expect(doc.validate()).resolves.toBeUndefined();
    }

    for (const setRec of data.settlementRecords) {
      const doc = new SettlementRecord(setRec);
      await expect(doc.validate()).resolves.toBeUndefined();
    }

    for (const gt of data.groundTruth) {
      const doc = new GroundTruth(gt);
      await expect(doc.validate()).resolves.toBeUndefined();
    }
  });

  it("should enforce GroundTruth leakage prevention on input records", () => {
    const data = generateBenchmarkData();

    const forbiddenFields = [
      "expectedClassification",
      "expectedPaymentIds",
      "expectedSettlementRecordIds",
      "expectedRequiresReview",
      "groundTruth",
      "expectedResult"
    ];

    const inputRecords = [
      ...data.merchantOrders,
      ...data.gatewayPayments,
      ...data.settlementRecords
    ];

    for (const record of inputRecords) {
      for (const field of forbiddenFields) {
        expect(record).not.toHaveProperty(field);
      }
    }
  });

  it("should generate the stable primary ambiguous graceful-failure scenario (ORD-000116)", () => {
    const data = generateBenchmarkData();

    const ambGt = data.groundTruth.find(
      (gt) => gt.merchantOrderId === BENCHMARK_CONSTANTS.PRIMARY_AMBIGUOUS_ORDER_ID
    );

    expect(ambGt).toBeDefined();
    expect(ambGt.expectedClassification).toBe("AMBIGUOUS");
    expect(ambGt.expectedRequiresReview).toBe(true);
    expect(ambGt.expectedPaymentIds).toHaveLength(2);

    const ambPayments = data.gatewayPayments.filter(
      (p) => p.merchantOrderId === BENCHMARK_CONSTANTS.PRIMARY_AMBIGUOUS_ORDER_ID
    );
    expect(ambPayments).toHaveLength(2);
  });
});
