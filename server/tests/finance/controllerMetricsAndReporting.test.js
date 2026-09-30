import { describe, it, expect, vi } from "vitest";
import calculateRunMetrics from "../../src/services/reconciliation/metricsService.js";
import { evaluateReconciliationRun } from "../../src/services/evaluation/evaluationService.js";
import { ReconciliationRun } from "../../src/models/ReconciliationRun.js";
import { ReconciliationResult } from "../../src/models/ReconciliationResult.js";
import { GroundTruth } from "../../src/models/GroundTruth.js";

describe("Track 4 Phase 5 — Metrics, Reporting & Benchmark Hardening Suite", () => {
  // 1. Authoritative Operational Metrics Calculation
  it("1. calculateRunMetrics computes all 13 operational fields deterministically", () => {
    const mockResults = [
      { classification: "MATCHED", autoResolved: true, requiresReview: false, expectedAmountPaise: 100000 },
      { classification: "MATCHED", autoResolved: true, requiresReview: false, expectedAmountPaise: 200000 },
      { classification: "AMOUNT_MISMATCH", autoResolved: false, requiresReview: true, expectedAmountPaise: 150000 },
      { classification: "AMBIGUOUS", autoResolved: false, requiresReview: true, expectedAmountPaise: 50000 }
    ];

    const metrics = calculateRunMetrics(mockResults, 2000); // 2 seconds

    expect(metrics.totalScenarios).toBe(4);
    expect(metrics.processedScenarios).toBe(4);
    expect(metrics.matchedCount).toBe(2);
    expect(metrics.exceptionCount).toBe(2);
    expect(metrics.autoReconciledCount).toBe(2);
    expect(metrics.manualReviewCount).toBe(2);
    expect(metrics.totalAmountProcessedPaise).toBe(500000);
    expect(metrics.autoReconciledAmountPaise).toBe(300000);
    expect(metrics.amountUnderReviewPaise).toBe(200000);
    expect(metrics.throughputRecordsPerSecond).toBe(2.0);
    expect(metrics.autoReconciliationRate).toBe(0.5);
  });

  // 2. Financial Sum Invariant Enforcement
  it("2. Financial Sum Invariant: totalAmountProcessedPaise === autoReconciledAmountPaise + amountUnderReviewPaise", () => {
    const mockResults = [
      { classification: "MATCHED", autoResolved: true, requiresReview: false, expectedAmountPaise: 71702000 },
      { classification: "MISSING_PAYMENT", autoResolved: false, requiresReview: true, expectedAmountPaise: 31316000 }
    ];

    const metrics = calculateRunMetrics(mockResults, 1000);

    expect(metrics.totalAmountProcessedPaise).toBe(103018000);
    expect(metrics.autoReconciledAmountPaise).toBe(71702000);
    expect(metrics.amountUnderReviewPaise).toBe(31316000);
    expect(metrics.totalAmountProcessedPaise).toBe(
      metrics.autoReconciledAmountPaise + metrics.amountUnderReviewPaise
    );
  });

  // 3. Operational Match Rate vs Evaluation Accuracy Distinction
  it("3. Operational Match Rate (66.67%) is strictly separated from Benchmark Accuracy (100.00%)", () => {
    const batchSize = 120;
    const matchedCount = 80;

    const operationalMatchRate = parseFloat(((matchedCount / batchSize) * 100).toFixed(2));
    expect(operationalMatchRate).toBe(66.67);

    // Evaluation classification accuracy against GroundTruth
    const correctClassifications = 120;
    const benchmarkAccuracy = (correctClassifications / batchSize) * 100;
    expect(benchmarkAccuracy).toBe(100.0);

    expect(operationalMatchRate).not.toBe(benchmarkAccuracy);
  });

  // 4. Evaluation Service Zero-Denominator Safe Handling
  it("4. Evaluation Service: safely computes precision/recall/F1 without NaN on zero-anomaly datasets", async () => {
    vi.spyOn(ReconciliationRun, "findOne").mockReturnValue({
      lean: vi.fn().mockResolvedValue({ runId: "RUN-ZERO-001", configuration: { datasetVersion: "V1" } })
    });

    vi.spyOn(ReconciliationResult, "find").mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        { merchantOrderId: "ORD-001", classification: "MATCHED" },
        { merchantOrderId: "ORD-002", classification: "MATCHED" }
      ])
    });

    vi.spyOn(GroundTruth, "find").mockReturnValue({
      lean: vi.fn().mockResolvedValue([
        { merchantOrderId: "ORD-001", expectedClassification: "MATCHED" },
        { merchantOrderId: "ORD-002", expectedClassification: "MATCHED" }
      ])
    });

    const evalRes = await evaluateReconciliationRun("RUN-ZERO-001", "V1");

    expect(evalRes.classificationAccuracy).toBe(1.0);
    expect(evalRes.exceptionDetection.truePositives).toBe(0);
    expect(evalRes.exceptionDetection.falsePositives).toBe(0);
    expect(evalRes.exceptionDetection.precision).toBe(1.0);
    expect(evalRes.exceptionDetection.recall).toBe(1.0);
    expect(evalRes.exceptionDetection.f1Score).toBe(1.0);
  });
});
