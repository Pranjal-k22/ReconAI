import { asyncHandler } from "../utils/asyncHandler.js";
import { humanDecisionSchema, investigateRequestSchema } from "../validators/exceptionValidators.js";
import * as exceptionService from "../services/exceptions/exceptionService.js";
import * as humanReviewService from "../services/exceptions/humanReviewService.js";
import * as exceptionInvestigator from "../services/ai/exceptionInvestigator.js";

/**
 * GET /api/exceptions
 * Lists ExceptionCase records with filtering and pagination.
 */
export const listExceptions = asyncHandler(async (req, res) => {
  const { status, type, severity, runId, merchantOrderId, page, limit } = req.query;

  const data = await exceptionService.listExceptions({
    status,
    type,
    severity,
    runId,
    merchantOrderId,
    page,
    limit
  });

  res.status(200).json({
    success: true,
    data
  });
});

/**
 * GET /api/exceptions/summary
 * Retrieves aggregate summary metrics for all exceptions.
 */
export const getSummary = asyncHandler(async (req, res) => {
  const summary = await exceptionService.getExceptionsSummary();

  res.status(200).json({
    success: true,
    data: summary
  });
});

/**
 * GET /api/exceptions/:exceptionId
 * Retrieves a single ExceptionCase with its associated ReconciliationResult.
 */
export const getException = asyncHandler(async (req, res) => {
  const { exceptionId } = req.params;
  const exc = await exceptionService.getExceptionById(exceptionId);

  res.status(200).json({
    success: true,
    data: exc
  });
});

/**
 * PATCH /api/exceptions/:exceptionId/decision
 * Applies a human review decision to an exception.
 */
export const applyDecision = asyncHandler(async (req, res) => {
  const { exceptionId } = req.params;
  const validated = humanDecisionSchema.parse(req.body);

  const result = await humanReviewService.applyHumanDecision({
    exceptionId,
    decision: validated.decision,
    resolutionNotes: validated.resolutionNotes,
    actorId: validated.actorId
  });

  res.status(200).json({
    success: true,
    data: result
  });
});

/**
 * POST /api/exceptions/:exceptionId/investigate
 * Triggers AI (or deterministic fallback) investigation for an exception.
 */
export const investigateException = asyncHandler(async (req, res) => {
  const { exceptionId } = req.params;
  const validated = investigateRequestSchema.parse(req.body || {});

  const result = await exceptionInvestigator.investigateException({
    exceptionId,
    actorId: validated.actorId
  });

  res.status(200).json({
    success: true,
    data: result
  });
});
