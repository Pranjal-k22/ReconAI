import { ReconciliationResult } from "../../models/ReconciliationResult.js";
import { GroundTruth } from "../../models/GroundTruth.js";
import { ReconciliationRun } from "../../models/ReconciliationRun.js";
import { ALL_CLASSIFICATIONS } from "../reconciliation/metricsService.js";
import { AppError } from "../../utils/AppError.js";

/**
 * Benchmark Evaluation Service.
 * 
 * Evaluates persisted ReconciliationResult documents against GroundTruth answer keys.
 * GroundTruth import is restricted strictly to this evaluation module.
 */
export async function evaluateReconciliationRun(runId, datasetVersionInput) {
  const run = await ReconciliationRun.findOne({ runId }).lean();
  if (!run) {
    throw AppError.notFound(`Reconciliation run not found for runId '${runId}'`);
  }

  const datasetVersion = datasetVersionInput || run.configuration?.datasetVersion || "RECONAI_DEMO_V1";

  // Load persisted results for run and GroundTruth for dataset version
  const [results, groundTruthList] = await Promise.all([
    ReconciliationResult.find({ runId }).lean(),
    GroundTruth.find({ datasetVersion }).lean()
  ]);

  if (results.length === 0) {
    throw AppError.notFound(`No reconciliation results found for runId '${runId}'`);
  }

  if (groundTruthList.length === 0) {
    throw AppError.notFound(`No GroundTruth records found for datasetVersion '${datasetVersion}'`);
  }

  const gtMap = new Map(groundTruthList.map((gt) => [gt.merchantOrderId, gt]));

  let totalScenarios = 0;
  let correctClassifications = 0;
  let incorrectClassifications = 0;

  let truePositives = 0;
  let trueNegatives = 0;
  let falsePositives = 0;
  let falseNegatives = 0;

  const misclassifiedScenarios = [];

  // Per-class tracking
  const classStats = {};
  for (const c of ALL_CLASSIFICATIONS) {
    classStats[c] = {
      groundTruthCount: 0,
      predictedCount: 0,
      correctCount: 0
    };
  }

  for (const result of results) {
    const orderId = result.merchantOrderId;
    const gt = gtMap.get(orderId);
    if (!gt) continue;

    totalScenarios++;
    const expected = gt.expectedClassification;
    const predicted = result.classification;

    if (!classStats[expected]) {
      classStats[expected] = { groundTruthCount: 0, predictedCount: 0, correctCount: 0 };
    }
    classStats[expected].groundTruthCount++;

    if (!classStats[predicted]) {
      classStats[predicted] = { groundTruthCount: 0, predictedCount: 0, correctCount: 0 };
    }
    classStats[predicted].predictedCount++;

    const isCorrect = expected === predicted;

    if (isCorrect) {
      correctClassifications++;
      classStats[expected].correctCount++;
    } else {
      incorrectClassifications++;
      misclassifiedScenarios.push({
        merchantOrderId: orderId,
        expectedClassification: expected,
        predictedClassification: predicted,
        reasons: result.reasons || []
      });
    }

    // Exception Detection Metrics (Positive = expected != MATCHED)
    const isExpectedAnomaly = expected !== "MATCHED";
    const isPredictedAnomaly = predicted !== "MATCHED";

    if (isExpectedAnomaly && isPredictedAnomaly) {
      truePositives++;
    } else if (!isExpectedAnomaly && !isPredictedAnomaly) {
      trueNegatives++;
    } else if (!isExpectedAnomaly && isPredictedAnomaly) {
      falsePositives++;
    } else if (isExpectedAnomaly && !isPredictedAnomaly) {
      falseNegatives++;
    }
  }

  const classificationAccuracy = totalScenarios > 0 ? correctClassifications / totalScenarios : 0;

  const precision = truePositives + falsePositives > 0
    ? truePositives / (truePositives + falsePositives)
    : 1.0;

  const recall = truePositives + falseNegatives > 0
    ? truePositives / (truePositives + falseNegatives)
    : 1.0;

  const f1Score = precision + recall > 0
    ? (2 * precision * recall) / (precision + recall)
    : 1.0;

  // Build per-class precision and recall
  const perClassBreakdown = {};
  for (const [cls, stat] of Object.entries(classStats)) {
    const clsPrecision = stat.predictedCount > 0 ? stat.correctCount / stat.predictedCount : 1.0;
    const clsRecall = stat.groundTruthCount > 0 ? stat.correctCount / stat.groundTruthCount : 1.0;

    perClassBreakdown[cls] = {
      groundTruthCount: stat.groundTruthCount,
      predictedCount: stat.predictedCount,
      correctCount: stat.correctCount,
      precision: clsPrecision,
      recall: clsRecall
    };
  }

  return {
    runId,
    datasetVersion,
    totalScenarios,
    correctClassifications,
    incorrectClassifications,
    classificationAccuracy,
    exceptionDetection: {
      truePositives,
      trueNegatives,
      falsePositives,
      falseNegatives,
      precision,
      recall,
      f1Score
    },
    perClassBreakdown,
    misclassifiedScenarios
  };
}

export default evaluateReconciliationRun;
