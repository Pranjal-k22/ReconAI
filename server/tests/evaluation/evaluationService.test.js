import { describe, it, expect, vi } from "vitest";
import { evaluateReconciliationRun } from "../../src/services/evaluation/evaluationService.js";
import { ReconciliationRun } from "../../src/models/ReconciliationRun.js";
import { ReconciliationResult } from "../../src/models/ReconciliationResult.js";
import { GroundTruth } from "../../src/models/GroundTruth.js";

describe("evaluationService", () => {
  it("calculates accuracy, precision, recall, F1, and per-class metrics dynamically", async () => {
    const mockRun = {
      runId: "RUN-TEST-001",
      configuration: { datasetVersion: "RECONAI_DEMO_V1" }
    };

    const mockGroundTruth = [
      { merchantOrderId: "ORD-1", expectedClassification: "MATCHED" },
      { merchantOrderId: "ORD-2", expectedClassification: "MATCHED" },
      { merchantOrderId: "ORD-3", expectedClassification: "AMOUNT_MISMATCH" },
      { merchantOrderId: "ORD-4", expectedClassification: "MISSING_SETTLEMENT" }
    ];

    const mockResults = [
      { merchantOrderId: "ORD-1", classification: "MATCHED", reasons: [] },
      { merchantOrderId: "ORD-2", classification: "MATCHED", reasons: [] },
      { merchantOrderId: "ORD-3", classification: "AMOUNT_MISMATCH", reasons: [] },
      { merchantOrderId: "ORD-4", classification: "MISSING_SETTLEMENT", reasons: [] }
    ];

    vi.spyOn(ReconciliationRun, "findOne").mockReturnValue({
      lean: vi.fn().mockResolvedValue(mockRun)
    });
    vi.spyOn(GroundTruth, "find").mockReturnValue({
      lean: vi.fn().mockResolvedValue(mockGroundTruth)
    });
    vi.spyOn(ReconciliationResult, "find").mockReturnValue({
      lean: vi.fn().mockResolvedValue(mockResults)
    });

    const report = await evaluateReconciliationRun("RUN-TEST-001");

    expect(report.totalScenarios).toBe(4);
    expect(report.correctClassifications).toBe(4);
    expect(report.incorrectClassifications).toBe(0);
    expect(report.classificationAccuracy).toBe(1.0);
    expect(report.exceptionDetection.precision).toBe(1.0);
    expect(report.exceptionDetection.recall).toBe(1.0);
    expect(report.exceptionDetection.f1Score).toBe(1.0);
    expect(report.misclassifiedScenarios).toEqual([]);

    vi.restoreAllMocks();
  });

  it("ALTERED PREDICTION FIXTURE: detects false positives and misclassifications dynamically", async () => {
    const mockRun = {
      runId: "RUN-TEST-002",
      configuration: { datasetVersion: "RECONAI_DEMO_V1" }
    };

    // Expected: ORD-1 is MATCHED, ORD-2 is AMOUNT_MISMATCH
    const mockGroundTruth = [
      { merchantOrderId: "ORD-1", expectedClassification: "MATCHED" },
      { merchantOrderId: "ORD-2", expectedClassification: "AMOUNT_MISMATCH" }
    ];

    // Predicted: ORD-1 is incorrectly predicted as AMOUNT_MISMATCH (False Positive!)
    const mockResults = [
      { merchantOrderId: "ORD-1", classification: "AMOUNT_MISMATCH", reasons: ["Discrepancy detected"] },
      { merchantOrderId: "ORD-2", classification: "AMOUNT_MISMATCH", reasons: [] }
    ];

    vi.spyOn(ReconciliationRun, "findOne").mockReturnValue({
      lean: vi.fn().mockResolvedValue(mockRun)
    });
    vi.spyOn(GroundTruth, "find").mockReturnValue({
      lean: vi.fn().mockResolvedValue(mockGroundTruth)
    });
    vi.spyOn(ReconciliationResult, "find").mockReturnValue({
      lean: vi.fn().mockResolvedValue(mockResults)
    });

    const report = await evaluateReconciliationRun("RUN-TEST-002");

    expect(report.totalScenarios).toBe(2);
    expect(report.correctClassifications).toBe(1);
    expect(report.incorrectClassifications).toBe(1);
    expect(report.classificationAccuracy).toBe(0.5);

    // False Positive detected: Expected clean MATCHED but predicted anomaly!
    expect(report.exceptionDetection.falsePositives).toBe(1);
    expect(report.exceptionDetection.truePositives).toBe(1);
    expect(report.exceptionDetection.precision).toBe(0.5); // 1 TP / (1 TP + 1 FP)
    expect(report.misclassifiedScenarios).toHaveLength(1);
    expect(report.misclassifiedScenarios[0].merchantOrderId).toBe("ORD-1");
    expect(report.misclassifiedScenarios[0].expectedClassification).toBe("MATCHED");
    expect(report.misclassifiedScenarios[0].predictedClassification).toBe("AMOUNT_MISMATCH");

    vi.restoreAllMocks();
  });
});
