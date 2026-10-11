import { PaymentAction, ACTION_TYPES, ACTION_STATUSES } from "../../models/PaymentAction.js";
import { createAuditEvent } from "../audit/auditService.js";
import { AppError } from "../../utils/AppError.js";
import { logger } from "../../config/logger.js";

/**
 * Generates a stable unique Action ID.
 * Example: ACT-20261011-3E7F9D
 */
export function generateActionId() {
  const dateStr = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 8);
  const randStr = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `ACT-${dateStr}-${randStr}`;
}

/**
 * Phase 2 Allowed Action Statuses.
 * Live/External execution statuses (EXECUTION_PENDING, EXECUTED_UNCONFIRMED, VERIFIED_SUCCESS)
 * are strictly blocked by Phase 2 safety boundaries.
 */
export const PHASE_2_ALLOWED_STATUSES = new Set([
  "PROPOSED",
  "SIMULATED",
  "REJECTED_BY_POLICY",
  "HELD_IN_SAFE_HOLD"
]);

/**
 * Records a proposed or simulated resolution action in the action ledger.
 * Enforces tenant-scoped idempotency key uniqueness, status allowlists, and Phase 2 safety constraints.
 */
export async function recordProposedAction({
  tenantId,
  caseId,
  actionType,
  actionStatus = "PROPOSED",
  idempotencyKey,
  amountPaise = null,
  currency = "INR",
  initiatedByActorType,
  initiatedByActorId,
  reasonCode,
  evidenceReferences = [],
  policyEvaluationResult = null,
  metadata = {},
  _allowExecutionStatusesForTests = false
} = {}) {
  if (!tenantId || typeof tenantId !== "string" || tenantId.trim().length === 0) {
    throw AppError.badRequest("tenantId is required and must be a non-empty string");
  }

  if (!caseId || typeof caseId !== "string" || caseId.trim().length === 0) {
    throw AppError.badRequest("caseId is required and must be a non-empty string");
  }

  if (!actionType || !ACTION_TYPES.includes(actionType)) {
    throw AppError.badRequest(`Invalid actionType '${actionType}'. Allowed types: ${ACTION_TYPES.join(", ")}`);
  }

  if (!idempotencyKey || typeof idempotencyKey !== "string" || idempotencyKey.trim().length === 0) {
    throw AppError.badRequest("idempotencyKey is required and must be a non-empty string");
  }

  if (!initiatedByActorType) {
    throw AppError.badRequest("initiatedByActorType is required");
  }

  if (!initiatedByActorId) {
    throw AppError.badRequest("initiatedByActorId is required");
  }

  if (!reasonCode) {
    throw AppError.badRequest("reasonCode is required");
  }

  // Phase 2 Safety Guard: Prohibit external live execution claims
  if (!_allowExecutionStatusesForTests && !PHASE_2_ALLOWED_STATUSES.has(actionStatus)) {
    throw AppError.badRequest(
      `External financial action execution is disabled in Phase 2. Status '${actionStatus}' is not allowed. Allowed Phase 2 statuses: ${Array.from(PHASE_2_ALLOWED_STATUSES).join(", ")}`
    );
  }

  // Idempotency check: look up existing action within tenant scope
  const existing = await PaymentAction.findOne({
    tenantId: tenantId.trim(),
    idempotencyKey: idempotencyKey.trim()
  });

  if (existing) {
    logger.info(
      { tenantId, idempotencyKey, actionId: existing.actionId },
      "Duplicate PaymentAction detected by scoped idempotencyKey"
    );
    return { isDuplicate: true, action: existing };
  }

  const actionId = generateActionId();

  try {
    const action = await PaymentAction.create({
      actionId,
      tenantId: tenantId.trim(),
      caseId: caseId.trim(),
      actionType,
      actionStatus,
      idempotencyKey: idempotencyKey.trim(),
      amountPaise,
      currency: currency.toUpperCase(),
      initiatedByActorType,
      initiatedByActorId: initiatedByActorId.trim(),
      reasonCode: reasonCode.trim(),
      evidenceReferences,
      policyEvaluationResult,
      metadata,
      proposedAt: new Date()
    });

    // Record audit event
    await createAuditEvent({
      actorType: "SYSTEM",
      actorId: initiatedByActorId,
      action: "CONTROLLER_SAFETY_GATE_EVALUATED",
      entityType: "PaymentAction",
      entityId: actionId,
      metadata: {
        tenantId,
        caseId,
        actionId,
        actionType,
        actionStatus,
        idempotencyKey
      }
    });

    return { isDuplicate: false, action };
  } catch (err) {
    // Handle concurrent duplicate key race condition
    if (err.code === 11000) {
      const raceExisting = await PaymentAction.findOne({
        tenantId: tenantId.trim(),
        idempotencyKey: idempotencyKey.trim()
      });
      if (raceExisting) {
        return { isDuplicate: true, action: raceExisting };
      }
      throw AppError.conflict(`Duplicate action detected for idempotencyKey '${idempotencyKey}' in tenant '${tenantId}'`);
    }
    throw err;
  }
}

/**
 * Retrieves a PaymentAction by tenantId and idempotencyKey.
 */
export async function getActionByIdempotencyKey(tenantId, idempotencyKey) {
  if (!tenantId || !idempotencyKey) {
    throw AppError.badRequest("tenantId and idempotencyKey are required");
  }

  return await PaymentAction.findOne({
    tenantId: tenantId.trim(),
    idempotencyKey: idempotencyKey.trim()
  });
}

/**
 * Retrieves all PaymentActions associated with a case ID.
 */
export async function getActionsByCaseId(caseId, tenantId = null) {
  if (!caseId) {
    throw AppError.badRequest("caseId is required");
  }

  const query = { caseId };
  if (tenantId) query.tenantId = tenantId;

  return await PaymentAction.find(query).sort({ proposedAt: 1 }).lean();
}
