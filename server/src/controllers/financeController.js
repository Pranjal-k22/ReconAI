import { asyncHandler } from "../utils/asyncHandler.js";
import { createControllerRunSchema } from "../validators/financeValidators.js";
import * as financeControllerAgent from "../services/finance/financeControllerAgent.js";

/**
 * POST /api/finance-controller/run
 * Triggers an autonomous Track 4 Finance Controller Agent batch run.
 */
export const createControllerRun = asyncHandler(async (req, res) => {
  const validated = createControllerRunSchema.parse(req.body);
  const run = await financeControllerAgent.runFinanceControllerBatch(validated);

  res.status(201).json({
    success: true,
    data: run
  });
});

/**
 * GET /api/finance-controller/runs
 * Lists historical Finance Controller runs with pagination.
 */
export const listControllerRuns = asyncHandler(async (req, res) => {
  const { page, limit, status } = req.query;
  const data = await financeControllerAgent.listControllerRuns({ page, limit, status });

  res.status(200).json({
    success: true,
    data
  });
});

/**
 * GET /api/finance-controller/runs/:runId
 * Retrieves metadata, state, and metrics for a Finance Controller run.
 */
export const getControllerRun = asyncHandler(async (req, res) => {
  const { runId } = req.params;
  const run = await financeControllerAgent.getControllerRunById(runId);

  res.status(200).json({
    success: true,
    data: run
  });
});

/**
 * GET /api/finance-controller/runs/:runId/report
 * Retrieves the full Track 4 Finance Controller Report.
 */
export const getControllerRunReport = asyncHandler(async (req, res) => {
  const { runId } = req.params;
  const report = await financeControllerAgent.getControllerRunReport(runId);

  res.status(200).json({
    success: true,
    data: report
  });
});

/**
 * GET /api/finance-controller/runs/:runId/status
 * Retrieves lightweight state machine progress for polling.
 */
export const getControllerRunStatus = asyncHandler(async (req, res) => {
  const { runId } = req.params;
  const statusInfo = await financeControllerAgent.getControllerRunStatus(runId);

  res.status(200).json({
    success: true,
    data: statusInfo
  });
});
