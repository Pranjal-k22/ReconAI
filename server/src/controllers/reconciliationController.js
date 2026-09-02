import { asyncHandler } from "../utils/asyncHandler.js";
import { createRunSchema } from "../validators/reconciliationValidators.js";
import * as reconciliationService from "../services/reconciliation/reconciliationService.js";
import * as evaluationService from "../services/evaluation/evaluationService.js";

/**
 * POST /api/reconciliation/runs
 * Executes a batch reconciliation run.
 */
export const createRun = asyncHandler(async (req, res) => {
  const validated = createRunSchema.parse(req.body);
  const run = await reconciliationService.runReconciliationBatch(validated);

  res.status(201).json({
    success: true,
    data: run
  });
});

/**
 * GET /api/reconciliation/runs
 * Lists reconciliation runs with pagination.
 */
export const listRuns = asyncHandler(async (req, res) => {
  const { page, limit } = req.query;
  const data = await reconciliationService.listReconciliationRuns({ page, limit });

  res.status(200).json({
    success: true,
    data
  });
});

/**
 * GET /api/reconciliation/runs/:runId
 * Retrieves metadata and operational metrics for a run.
 */
export const getRun = asyncHandler(async (req, res) => {
  const { runId } = req.params;
  const run = await reconciliationService.getReconciliationRunById(runId);

  res.status(200).json({
    success: true,
    data: run
  });
});

/**
 * GET /api/reconciliation/runs/:runId/results
 * Retrieves paginated results for a run with filtering.
 */
export const getRunResults = asyncHandler(async (req, res) => {
  const { runId } = req.params;
  const { classification, requiresReview, resolutionStatus, page, limit } = req.query;

  const data = await reconciliationService.getRunResults(runId, {
    classification,
    requiresReview,
    resolutionStatus,
    page,
    limit
  });

  res.status(200).json({
    success: true,
    data
  });
});

/**
 * GET /api/reconciliation/runs/:runId/metrics
 * Retrieves operational metrics for a run.
 */
export const getRunMetrics = asyncHandler(async (req, res) => {
  const { runId } = req.params;
  const metrics = await reconciliationService.getRunMetrics(runId);

  res.status(200).json({
    success: true,
    data: metrics
  });
});

/**
 * GET /api/reconciliation/runs/:runId/evaluation
 * Evaluates run results against GroundTruth benchmark.
 */
export const getRunEvaluation = asyncHandler(async (req, res) => {
  const { runId } = req.params;
  const { datasetVersion } = req.query;

  const evaluation = await evaluationService.evaluateReconciliationRun(runId, datasetVersion);

  res.status(200).json({
    success: true,
    data: evaluation
  });
});
