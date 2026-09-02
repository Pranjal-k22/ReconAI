import { describe, it, expect } from "vitest";
import { calculateRunMetrics, ALL_CLASSIFICATIONS } from "../../src/services/reconciliation/metricsService.js";

describe("metricsService", () => {
  it("calculates accurate operational metrics and financial totals", () => {
    const mockResults = [
      { classification: "MATCHED", autoResolved: true, requiresReview: false, expectedAmountPaise: 149900 },
      { classification: "MATCHED", autoResolved: true, requiresReview: false, expectedAmountPaise: 200000 },
      { classification: "AMOUNT_MISMATCH", autoResolved: false, requiresReview: true, expectedAmountPaise: 149900 },
      { classification: "MISSING_SETTLEMENT", autoResolved: false, requiresReview: true, expectedAmountPaise: 50000 }
    ];

    const metrics = calculateRunMetrics(mockResults, 500); // 500ms duration

    expect(metrics.totalScenarios).toBe(4);
    expect(metrics.matchedCount).toBe(2);
    expect(metrics.exceptionCount).toBe(2);
    expect(metrics.autoReconciledCount).toBe(2);
    expect(metrics.manualReviewCount).toBe(2);
    expect(metrics.autoReconciliationRate).toBe(0.5);
    expect(metrics.durationMs).toBe(500);
    expect(metrics.throughputRecordsPerSecond).toBe(8); // 4 records / 0.5s

    // Financial totals:
    // Total = 149900 + 200000 + 149900 + 50000 = 549800
    // Auto = 149900 + 200000 = 349900
    // Review = 149900 + 50000 = 199900
    expect(metrics.totalAmountProcessedPaise).toBe(549800);
    expect(metrics.autoReconciledAmountPaise).toBe(349900);
    expect(metrics.amountUnderReviewPaise).toBe(199900);

    // Verify equation: auto + review == total
    expect(metrics.autoReconciledAmountPaise + metrics.amountUnderReviewPaise).toBe(metrics.totalAmountProcessedPaise);

    // Classification breakdown should include all 12 classes
    expect(Object.keys(metrics.classificationBreakdown)).toHaveLength(ALL_CLASSIFICATIONS.length);
    expect(metrics.classificationBreakdown.MATCHED).toBe(2);
    expect(metrics.classificationBreakdown.AMOUNT_MISMATCH).toBe(1);
    expect(metrics.classificationBreakdown.MISSING_SETTLEMENT).toBe(1);
    expect(metrics.classificationBreakdown.AMBIGUOUS).toBe(0);
  });

  it("handles zero results safely without division by zero errors", () => {
    const metrics = calculateRunMetrics([], 0);
    expect(metrics.totalScenarios).toBe(0);
    expect(metrics.autoReconciliationRate).toBe(0);
    expect(metrics.throughputRecordsPerSecond).toBe(0);
    expect(metrics.totalAmountProcessedPaise).toBe(0);
  });

  it("strictly computes financial totals from MerchantOrder values (expectedAmountPaise) and verifies sum invariant", () => {
    const mockResults = [
      {
        classification: "MATCHED",
        autoResolved: true,
        requiresReview: false,
        expectedAmountPaise: 100000,
        actualAmountPaise: 100000,
        differencePaise: 0
      },
      {
        classification: "AMOUNT_MISMATCH",
        autoResolved: false,
        requiresReview: true,
        expectedAmountPaise: 200000,
        actualAmountPaise: 150000, // actual payment amount differs from order amount
        differencePaise: -50000
      }
    ];

    const metrics = calculateRunMetrics(mockResults, 100);

    // Expected: order 1 (100000) + order 2 (200000) = 300000
    // Auto: order 1 = 100000
    // Review: order 2 = 200000 (NOT actual 150000)
    expect(metrics.totalAmountProcessedPaise).toBe(300000);
    expect(metrics.autoReconciledAmountPaise).toBe(100000);
    expect(metrics.amountUnderReviewPaise).toBe(200000);
    expect(metrics.autoReconciledAmountPaise + metrics.amountUnderReviewPaise).toBe(metrics.totalAmountProcessedPaise);
  });
});
