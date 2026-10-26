import { PaymentAction, ACTION_TYPES, ACTION_STATUSES } from "../../models/PaymentAction.js";
import { createAuditEvent } from "../audit/auditService.js";
import { AppError } from "../../utils/AppError.js";
import { logger } from "../../config/logger.js";
import {
  SUPPORTED_CURRENCIES,
  isValidCurrency,
  sanitizeMetadata
} from "../../models/helpers/validators.js";

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
 * Restricts recorded actions strictly to non-executing intent and simulation states.
 * Execution-ready ('READY_FOR_EXECUTION') and live-execution statuses
 * ('EXECUTION_PENDING', 'EXECUTED_UNCONFIRMED', 'VERIFIED_SUCCESS') are strictly prohibited.
 */
export const PHASE_2_ALLOWED_STATUSES = new Set([
  "PROPOSED",
  "SIMULATED",
  "REJECTED_BY_POLICY",
  "HELD_IN_SAFE_HOLD"
]);

/**
 * Records an intended, simulated, or held action in the action ledger.
 * Enforces tenant-scoped idempotency key uniqueness, strict non-executing status boundaries,
 * currency validation, and integer-paise validation.
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
  metadata = {}
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

  // Strict currency validation
  if (typeof currency !== "string" || !isValidCurrency(currency)) {
    throw AppError.badRequest(`Invalid or unsupported currency '${currency}'. Supported: ${SUPPORTED_CURRENCIES.join(", ")}`);
  }

  // Phase 2 Safety Guard: Strictly enforce non-executing intent statuses
  if (!PHASE_2_ALLOWED_STATUSES.has(actionStatus)) {
    throw AppError.badRequest(
      `Action execution or authorization is prohibited in Phase 2. Status '${actionStatus}' is not allowed. Allowed Phase 2 statuses: ${Array.from(PHASE_2_ALLOWED_STATUSES).join(", ")}`
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
  const sanitizedMeta = sanitizeMetadata(metadata);

  try {
    const action = await PaymentAction.create({
      actionId,
      tenantId: tenantId.trim(),
      caseId: caseId.trim(),
      actionType,
      actionStatus,
      idempotencyKey: idempotencyKey.trim(),
      amountPaise,
      currency,
      initiatedByActorType,
      initiatedByActorId: initiatedByActorId.trim().slice(0, 64),
      reasonCode: reasonCode.trim().slice(0, 64),
      evidenceReferences,
      policyEvaluationResult,
      metadata: sanitizedMeta,
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

export async function getActionsByCaseId(caseId, tenantId = null) {
  if (!caseId) {
    throw AppError.badRequest("caseId is required");
  }

  const cleanTenant = typeof tenantId === "string" ? tenantId.trim() : null;
  if (cleanTenant === "unassigned_provider_quarantine") {
    return [];
  }

  const query = {
    caseId,
    tenantId: cleanTenant ? cleanTenant : { $ne: "unassigned_provider_quarantine" }
  };

  return await PaymentAction.find(query).sort({ proposedAt: 1 }).lean();
}
