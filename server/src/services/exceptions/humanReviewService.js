import { ExceptionCase } from "../../models/ExceptionCase.js";
import { ReconciliationResult } from "../../models/ReconciliationResult.js";
import { createAuditEvent } from "../audit/auditService.js";
import { AppError } from "../../utils/AppError.js";

const ALLOWED_DECISIONS = new Set(["APPROVE_MATCH", "KEEP_EXCEPTION", "MARK_RESOLVED"]);

/**
 * Applies a human review decision to an ExceptionCase and updates the associated ReconciliationResult.
 * 
 * CRITICAL RULE: Original ReconciliationResult.classification is NEVER altered.
 * Only workflow status fields (status, resolutionStatus, humanDecision, requiresReview) are updated.
 */
export async function applyHumanDecision({
  exceptionId,
  decision,
  resolutionNotes,
  actorId = "demo-finance-reviewer"
}) {
  if (!exceptionId) {
    throw AppError.badRequest("exceptionId is required");
  }

  if (!ALLOWED_DECISIONS.has(decision)) {
    throw AppError.badRequest(`Invalid human decision '${decision}'. Allowed decisions: APPROVE_MATCH, KEEP_EXCEPTION, MARK_RESOLVED.`);
  }

  const cleanNotes = (typeof resolutionNotes === "string") ? resolutionNotes.trim() : "";
  if (!cleanNotes || cleanNotes.length < 5) {
    throw AppError.badRequest("resolutionNotes is required and must be at least 5 characters long.");
  }

  const exc = await ExceptionCase.findOne({ exceptionId });
  if (!exc) {
    throw AppError.notFound(`ExceptionCase not found for exceptionId '${exceptionId}'`);
  }

  // Idempotency / State Protection
  if (exc.status === "RESOLVED" && exc.humanDecision !== "NONE" && exc.humanDecision !== decision) {
    throw AppError.conflict(
      `Exception '${exceptionId}' is already RESOLVED with decision '${exc.humanDecision}'. Cannot overwrite with '${decision}'.`
    );
  }

  const result = await ReconciliationResult.findOne({ resultId: exc.resultId });
  if (!result) {
    throw AppError.notFound(`Associated ReconciliationResult not found for resultId '${exc.resultId}'`);
  }

  const beforeState = {
    exceptionStatus: exc.status,
    humanDecision: exc.humanDecision,
    resolutionStatus: result.resolutionStatus,
    requiresReview: result.requiresReview
  };

  // Workflow state updates
  if (decision === "APPROVE_MATCH") {
    exc.status = "RESOLVED";
    exc.humanDecision = "APPROVE_MATCH";
    exc.resolutionNotes = cleanNotes;
    exc.resolvedAt = new Date();

    result.resolutionStatus = "APPROVED";
    result.autoResolved = false; // Human-approved, not auto-reconciled!
    result.requiresReview = false;
  } else if (decision === "KEEP_EXCEPTION") {
    exc.status = "UNDER_REVIEW";
    exc.humanDecision = "KEEP_EXCEPTION";
    exc.resolutionNotes = cleanNotes;

    result.resolutionStatus = "UNDER_REVIEW";
    result.requiresReview = true;
  } else if (decision === "MARK_RESOLVED") {
    exc.status = "RESOLVED";
    exc.humanDecision = "MARK_RESOLVED";
    exc.resolutionNotes = cleanNotes;
    exc.resolvedAt = new Date();

    result.resolutionStatus = "RESOLVED";
    result.requiresReview = false;
  }

  await exc.save();
  await result.save();

  const afterState = {
    exceptionStatus: exc.status,
    humanDecision: exc.humanDecision,
    resolutionStatus: result.resolutionStatus,
    requiresReview: result.requiresReview,
    resolutionNotes: cleanNotes
  };

  // Log append-only audit event for human decision
  await createAuditEvent({
    actorType: "HUMAN",
    actorId: actorId || "demo-finance-reviewer",
    action: "HUMAN_DECISION",
    entityType: "ExceptionCase",
    entityId: exc.exceptionId,
    runId: exc.runId,
    before: beforeState,
    after: afterState,
    metadata: {
      resultId: exc.resultId,
      merchantOrderId: exc.merchantOrderId,
      classification: result.classification,
      confidence: result.confidence
    },
    reason: cleanNotes
  });

  return {
    exceptionCase: exc,
    reconciliationResult: result
  };
}
