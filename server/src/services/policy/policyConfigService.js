import { PolicyConfigVersion, computePolicyConfigHash } from "../../models/PolicyConfigVersion.js";
import { UserAccount } from "../../models/UserAccount.js";
import { ServicePrincipal } from "../../models/ServicePrincipal.js";
import { GatewayPayment } from "../../models/GatewayPayment.js";
import { MerchantOrder } from "../../models/MerchantOrder.js";
import { createAuditEvent, AuditUnavailableError } from "../audit/auditService.js";
import { AppError } from "../../utils/AppError.js";
import { logger } from "../../config/logger.js";

export { computePolicyConfigHash };

const CONTROL_CHAR_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
const ALLOWED_LIMIT_KEYS = new Set(["currency", "maxSingleRefundPaise", "maxCumulativeRefundPaise"]);

/**
 * Sanitizes reasons by stripping control characters and enforcing length constraints (10 to 500 chars).
 */
export function sanitizeReason(reason, fieldName = "reason") {
  if (typeof reason !== "string") {
    throw AppError.badRequest(`${fieldName} must be a string`);
  }
  const cleaned = reason.replace(CONTROL_CHAR_REGEX, "").trim();
  if (cleaned.length < 10 || cleaned.length > 500) {
    throw AppError.badRequest(`${fieldName} must be between 10 and 500 characters after stripping control characters`);
  }
  return cleaned;
}

/**
 * Validates limits structure, types, and constraints.
 * No monetary limits are defaulted; explicit positive integers only.
 */
export function validateLimits(limits) {
  if (!limits || typeof limits !== "object" || Array.isArray(limits)) {
    throw AppError.badRequest("limits must be a non-null object");
  }

  // Reject unknown fields
  for (const key of Object.keys(limits)) {
    if (!ALLOWED_LIMIT_KEYS.has(key)) {
      throw AppError.badRequest(`Unknown field '${key}' in policy limits`);
    }
  }

  if (!("maxSingleRefundPaise" in limits) || !("maxCumulativeRefundPaise" in limits)) {
    throw AppError.badRequest("limits must contain maxSingleRefundPaise and maxCumulativeRefundPaise");
  }

  const { currency, maxSingleRefundPaise, maxCumulativeRefundPaise } = limits;

  if (currency !== undefined && currency !== "INR") {
    throw AppError.badRequest(`Unsupported currency '${currency}'. Supported: INR`);
  }

  if (
    typeof maxSingleRefundPaise !== "number" ||
    !Number.isInteger(maxSingleRefundPaise) ||
    Number.isNaN(maxSingleRefundPaise) ||
    maxSingleRefundPaise <= 0 ||
    maxSingleRefundPaise > Number.MAX_SAFE_INTEGER
  ) {
    throw AppError.badRequest(
      "maxSingleRefundPaise must be a strictly positive integer safe paise value"
    );
  }

  if (
    typeof maxCumulativeRefundPaise !== "number" ||
    !Number.isInteger(maxCumulativeRefundPaise) ||
    Number.isNaN(maxCumulativeRefundPaise) ||
    maxCumulativeRefundPaise <= 0 ||
    maxCumulativeRefundPaise > Number.MAX_SAFE_INTEGER
  ) {
    throw AppError.badRequest(
      "maxCumulativeRefundPaise must be a strictly positive integer safe paise value"
    );
  }

  if (maxSingleRefundPaise > maxCumulativeRefundPaise) {
    throw AppError.badRequest(
      `maxSingleRefundPaise (${maxSingleRefundPaise}) cannot exceed maxCumulativeRefundPaise (${maxCumulativeRefundPaise})`
    );
  }

  return {
    currency: "INR",
    maxSingleRefundPaise,
    maxCumulativeRefundPaise
  };
}

/**
 * Verifies that the tenant is a known platform tenant and not the quarantine sentinel.
 */
export async function isKnownTenant(tenantId) {
  if (!tenantId || typeof tenantId !== "string") return false;
  const clean = tenantId.trim();
  if (!clean || clean === "unassigned_provider_quarantine") return false;

  const [user, svc, pay, ord] = await Promise.all([
    UserAccount.exists({ tenantId: clean }),
    ServicePrincipal.exists({ tenantId: clean }),
    GatewayPayment.exists({ tenantId: clean }),
    MerchantOrder.exists({ tenantId: clean })
  ]);
  return Boolean(user || svc || pay || ord);
}

/**
 * Proposes a new versioned PolicyConfig for a tenant (ADMIN only).
 */
export async function proposePolicyConfig({
  tenantId,
  proposedBy,
  limits,
  proposalReason,
  sourceConfigVersion = null
}) {
  if (!tenantId || typeof tenantId !== "string" || !tenantId.trim()) {
    throw AppError.badRequest("tenantId is required");
  }
  const cleanTenantId = tenantId.trim();

  if (cleanTenantId === "unassigned_provider_quarantine") {
    throw AppError.badRequest("Policy configuration cannot be proposed for the quarantine sentinel");
  }

  const known = await isKnownTenant(cleanTenantId);
  if (!known) {
    throw AppError.badRequest(`Unknown tenantId '${cleanTenantId}': tenant does not exist in platform records`);
  }

  if (!proposedBy || typeof proposedBy !== "string" || !proposedBy.trim()) {
    throw AppError.badRequest("proposedBy is required");
  }
  const cleanProposedBy = proposedBy.trim();

  const validatedLimits = validateLimits(limits);
  const cleanReason = sanitizeReason(proposalReason, "proposalReason");

  if (sourceConfigVersion !== null && sourceConfigVersion !== undefined) {
    if (typeof sourceConfigVersion !== "number" || !Number.isInteger(sourceConfigVersion) || sourceConfigVersion <= 0) {
      throw AppError.badRequest("sourceConfigVersion must be a positive integer");
    }
  }

  // Derive next configVersion (+1 monotonic per tenant)
  const latestDoc = await PolicyConfigVersion.findOne({ tenantId: cleanTenantId })
    .sort({ configVersion: -1 })
    .lean();
  const nextVersion = (latestDoc?.configVersion || 0) + 1;

  const contentHash = computePolicyConfigHash(validatedLimits);

  // Fail-closed audit write: MUST occur BEFORE the state change / document creation
  try {
    await createAuditEvent({
      actorType: "HUMAN",
      actorId: cleanProposedBy,
      action: "POLICY_CONFIG_PROPOSED",
      tenantId: cleanTenantId,
      entityType: "PolicyConfigVersion",
      entityId: `v${nextVersion}`,
      metadata: {
        configVersion: nextVersion,
        contentHash,
        proposedBy: cleanProposedBy,
        proposalReason: cleanReason,
        sourceConfigVersion: sourceConfigVersion || null,
        limits: validatedLimits
      }
    });
  } catch (auditErr) {
    throw new AuditUnavailableError(
      `Failed to persist audit log for POLICY_CONFIG_PROPOSED: ${auditErr.message}`,
      auditErr
    );
  }

  try {
    const createdDoc = await PolicyConfigVersion.create({
      tenantId: cleanTenantId,
      configVersion: nextVersion,
      status: "PENDING_APPROVAL",
      limits: validatedLimits,
      contentHash,
      proposedBy: cleanProposedBy,
      proposedAt: new Date(),
      proposalReason: cleanReason,
      sourceConfigVersion: sourceConfigVersion || null
    });
    return createdDoc.toObject();
  } catch (err) {
    logger.error({ err: err.message, tenantId: cleanTenantId, nextVersion }, "Failed to create PolicyConfigVersion record");
    throw err;
  }
}

/**
 * Approves a pending PolicyConfig proposal and atomically activates it (ADMIN only).
 * Enforces the two-person rule (approvedBy !== proposedBy).
 */
export async function approvePolicyConfig({ configId, approvedBy, approvalReason }) {
  if (!configId) {
    throw AppError.badRequest("configId is required");
  }
  if (!approvedBy || typeof approvedBy !== "string" || !approvedBy.trim()) {
    throw AppError.badRequest("approvedBy is required");
  }
  const cleanApprovedBy = approvedBy.trim();
  const cleanReason = sanitizeReason(approvalReason, "approvalReason");

  const target = await PolicyConfigVersion.findById(configId);
  if (!target) {
    throw AppError.notFound(`PolicyConfigVersion '${configId}' not found`);
  }

  if (target.status !== "PENDING_APPROVAL") {
    throw AppError.conflict(
      `PolicyConfigVersion '${configId}' is not pending approval (current status: ${target.status})`
    );
  }

  // Enforce Two-Person Rule: Proposer cannot approve their own configuration
  if (target.proposedBy === cleanApprovedBy) {
    throw AppError.forbidden("Two-person rule violation: Proposer cannot approve their own policy config proposal.");
  }

  // Audit events written BEFORE the state transition (Fail-closed)
  try {
    await createAuditEvent({
      actorType: "HUMAN",
      actorId: cleanApprovedBy,
      action: "POLICY_CONFIG_APPROVED",
      tenantId: target.tenantId,
      entityType: "PolicyConfigVersion",
      entityId: String(target.configVersion),
      metadata: {
        configId: String(target._id),
        configVersion: target.configVersion,
        contentHash: target.contentHash,
        proposedBy: target.proposedBy,
        approvedBy: cleanApprovedBy,
        approvalReason: cleanReason
      }
    });

    await createAuditEvent({
      actorType: "SYSTEM",
      actorId: cleanApprovedBy,
      action: "POLICY_CONFIG_ACTIVATED",
      tenantId: target.tenantId,
      entityType: "PolicyConfigVersion",
      entityId: String(target.configVersion),
      metadata: {
        configId: String(target._id),
        configVersion: target.configVersion,
        contentHash: target.contentHash,
        limits: target.limits
      }
    });
  } catch (auditErr) {
    throw new AuditUnavailableError(
      `Failed to persist audit log for POLICY_CONFIG_APPROVED/ACTIVATED: ${auditErr.message}`,
      auditErr
    );
  }

  // Two-step conditional atomic transition per B2:
  // 1. Verify target is still pending approval before touching any existing active config
  const isStillPending = await PolicyConfigVersion.exists({ _id: target._id, status: "PENDING_APPROVAL" });
  if (!isStillPending) {
    throw AppError.conflict("Policy config could not be activated (no longer pending approval)");
  }

  // Supersede any existing ACTIVE config for this tenant (excluding target)
  await PolicyConfigVersion.updateMany(
    { tenantId: target.tenantId, status: "ACTIVE", _id: { $ne: target._id } },
    { $set: { status: "SUPERSEDED", supersededAt: new Date() } }
  );

  // 2. Conditionally activate the target pending config
  const activated = await PolicyConfigVersion.findOneAndUpdate(
    { _id: target._id, status: "PENDING_APPROVAL" },
    {
      $set: {
        status: "ACTIVE",
        approvedBy: cleanApprovedBy,
        approvedAt: new Date(),
        approvalReason: cleanReason,
        activatedAt: new Date()
      }
    },
    { new: true }
  );

  if (!activated) {
    throw AppError.conflict("Policy config could not be activated (may have been concurrently processed)");
  }

  return activated.toObject();
}

/**
 * Rejects a pending PolicyConfig proposal (ADMIN only, including proposer withdrawal).
 */
export async function rejectPolicyConfig({ configId, rejectedBy, rejectionReason }) {
  if (!configId) {
    throw AppError.badRequest("configId is required");
  }
  if (!rejectedBy || typeof rejectedBy !== "string" || !rejectedBy.trim()) {
    throw AppError.badRequest("rejectedBy is required");
  }
  const cleanRejectedBy = rejectedBy.trim();
  const cleanReason = sanitizeReason(rejectionReason, "rejectionReason");

  const target = await PolicyConfigVersion.findById(configId);
  if (!target) {
    throw AppError.notFound(`PolicyConfigVersion '${configId}' not found`);
  }

  if (target.status !== "PENDING_APPROVAL") {
    throw AppError.conflict(
      `PolicyConfigVersion '${configId}' is not pending approval (current status: ${target.status})`
    );
  }

  // Fail-closed audit write BEFORE state transition
  try {
    await createAuditEvent({
      actorType: "HUMAN",
      actorId: cleanRejectedBy,
      action: "POLICY_CONFIG_REJECTED",
      tenantId: target.tenantId,
      entityType: "PolicyConfigVersion",
      entityId: String(target.configVersion),
      metadata: {
        configId: String(target._id),
        configVersion: target.configVersion,
        contentHash: target.contentHash,
        proposedBy: target.proposedBy,
        rejectedBy: cleanRejectedBy,
        rejectionReason: cleanReason
      }
    });
  } catch (auditErr) {
    throw new AuditUnavailableError(
      `Failed to persist audit log for POLICY_CONFIG_REJECTED: ${auditErr.message}`,
      auditErr
    );
  }

  const rejected = await PolicyConfigVersion.findOneAndUpdate(
    { _id: target._id, status: "PENDING_APPROVAL" },
    {
      $set: {
        status: "REJECTED",
        rejectedBy: cleanRejectedBy,
        rejectedAt: new Date(),
        rejectionReason: cleanReason
      }
    },
    { new: true }
  );

  if (!rejected) {
    throw AppError.conflict("Policy config could not be rejected (may have been concurrently processed)");
  }

  return rejected.toObject();
}

/**
 * Deactivates an ACTIVE PolicyConfig, causing subsequent refunds to fail closed (Single ADMIN).
 */
export async function deactivatePolicyConfig({ tenantId, deactivatedBy, deactivationReason, configId = null }) {
  if (!deactivatedBy || typeof deactivatedBy !== "string" || !deactivatedBy.trim()) {
    throw AppError.badRequest("deactivatedBy is required");
  }
  const cleanDeactivatedBy = deactivatedBy.trim();
  const cleanReason = sanitizeReason(deactivationReason, "deactivationReason");

  const query = configId ? { _id: configId, status: "ACTIVE" } : { tenantId: tenantId?.trim(), status: "ACTIVE" };

  const target = await PolicyConfigVersion.findOne(query);
  if (!target) {
    throw AppError.notFound("No active policy configuration found to deactivate");
  }

  // Fail-closed audit write BEFORE state transition
  try {
    await createAuditEvent({
      actorType: "HUMAN",
      actorId: cleanDeactivatedBy,
      action: "POLICY_CONFIG_DEACTIVATED",
      tenantId: target.tenantId,
      entityType: "PolicyConfigVersion",
      entityId: String(target.configVersion),
      metadata: {
        configId: String(target._id),
        configVersion: target.configVersion,
        contentHash: target.contentHash,
        deactivatedBy: cleanDeactivatedBy,
        deactivationReason: cleanReason
      }
    });
  } catch (auditErr) {
    throw new AuditUnavailableError(
      `Failed to persist audit log for POLICY_CONFIG_DEACTIVATED: ${auditErr.message}`,
      auditErr
    );
  }

  const deactivated = await PolicyConfigVersion.findOneAndUpdate(
    { _id: target._id, status: "ACTIVE" },
    {
      $set: {
        status: "DEACTIVATED",
        deactivatedBy: cleanDeactivatedBy,
        deactivatedAt: new Date(),
        deactivationReason: cleanReason
      }
    },
    { new: true }
  );

  if (!deactivated) {
    throw AppError.conflict("Active policy config was concurrently deactivated or modified");
  }

  return deactivated.toObject();
}

/**
 * Creates a rollback proposal copying limits from a previously approved source version (ADMIN only).
 * The resulting proposal still requires two-person approval.
 */
export async function rollbackPolicyConfig({ tenantId, sourceVersion, proposedBy, proposalReason }) {
  if (!tenantId || typeof tenantId !== "string" || !tenantId.trim()) {
    throw AppError.badRequest("tenantId is required");
  }
  const cleanTenantId = tenantId.trim();

  if (typeof sourceVersion !== "number" || !Number.isInteger(sourceVersion) || sourceVersion <= 0) {
    throw AppError.badRequest("sourceVersion must be a positive integer");
  }

  const sourceConfig = await PolicyConfigVersion.findOne({
    tenantId: cleanTenantId,
    configVersion: sourceVersion
  }).lean();

  if (!sourceConfig) {
    throw AppError.notFound(`Source PolicyConfigVersion v${sourceVersion} not found for tenant '${cleanTenantId}'`);
  }

  return await proposePolicyConfig({
    tenantId: cleanTenantId,
    proposedBy,
    limits: {
      currency: sourceConfig.limits.currency,
      maxSingleRefundPaise: sourceConfig.limits.maxSingleRefundPaise,
      maxCumulativeRefundPaise: sourceConfig.limits.maxCumulativeRefundPaise
    },
    proposalReason,
    sourceConfigVersion: sourceVersion
  });
}

/**
 * Retrieves the single ACTIVE PolicyConfig for a tenant.
 * Returns null if none exists, deactivated, or corrupted (Fail Closed).
 */
export async function getActivePolicyConfig(tenantId) {
  if (!tenantId || typeof tenantId !== "string" || tenantId.trim() === "unassigned_provider_quarantine") {
    return null;
  }
  const cleanTenant = tenantId.trim();

  const active = await PolicyConfigVersion.findOne({
    tenantId: cleanTenant,
    status: "ACTIVE"
  }).lean();

  if (!active) return null;

  // Validate integrity of limits and contentHash (Tamper detection)
  try {
    const computed = computePolicyConfigHash(active.limits);
    if (computed !== active.contentHash) {
      logger.error(
        { tenantId: cleanTenant, configVersion: active.configVersion },
        "PolicyConfigVersion contentHash mismatch: tampered or corrupted record. Failing closed."
      );
      return null;
    }
  } catch {
    return null;
  }

  return active;
}

/**
 * Lists PolicyConfig records for a tenant with optional status filtering.
 */
export async function listPolicyConfigs({ tenantId, status, page = 1, limit = 50 }) {
  const query = {};
  if (tenantId) query.tenantId = tenantId.trim();
  if (status) query.status = status.trim();

  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const skip = (safePage - 1) * safeLimit;

  const [records, total] = await Promise.all([
    PolicyConfigVersion.find(query).sort({ configVersion: -1 }).skip(skip).limit(safeLimit).lean(),
    PolicyConfigVersion.countDocuments(query)
  ]);

  return {
    records,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      pages: Math.ceil(total / safeLimit)
    }
  };
}

/**
 * Retrieves a single PolicyConfig record by ID.
 */
export async function getPolicyConfigById(configId) {
  if (!configId) throw AppError.badRequest("configId is required");
  const doc = await PolicyConfigVersion.findById(configId).lean();
  if (!doc) throw AppError.notFound(`PolicyConfigVersion '${configId}' not found`);
  return doc;
}
