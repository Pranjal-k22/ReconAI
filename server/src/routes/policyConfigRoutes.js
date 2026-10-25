import { Router } from "express";
import { z } from "zod";
import { authenticate, requireRoles } from "../middleware/authMiddleware.js";
import { ROLES } from "../services/auth/tokenService.js";
import {
  proposePolicyConfig,
  approvePolicyConfig,
  rejectPolicyConfig,
  deactivatePolicyConfig,
  rollbackPolicyConfig,
  getActivePolicyConfig,
  listPolicyConfigs,
  getPolicyConfigById
} from "../services/policy/policyConfigService.js";
import { createAuditEvent } from "../services/audit/auditService.js";
import { AppError } from "../utils/AppError.js";
import { asyncHandler } from "../utils/asyncHandler.js";

const router = Router();

// -----------------------------------------------------------------------------
// Strict Zod Schemas (.strict() rejects any unexpected properties)
// -----------------------------------------------------------------------------
const ProposePolicyConfigSchema = z
  .object({
    tenantId: z.string().trim().min(1, "tenantId cannot be empty"),
    limits: z
      .object({
        currency: z.literal("INR").default("INR"),
        maxSingleRefundPaise: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
        maxCumulativeRefundPaise: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
      })
      .strict()
      .refine((data) => data.maxSingleRefundPaise <= data.maxCumulativeRefundPaise, {
        message: "maxSingleRefundPaise cannot exceed maxCumulativeRefundPaise"
      }),
    proposalReason: z.string().trim().min(10).max(500),
    sourceConfigVersion: z.number().int().positive().optional()
  })
  .strict();

const ApprovePolicyConfigSchema = z
  .object({
    approvalReason: z.string().trim().min(10).max(500)
  })
  .strict();

const RejectPolicyConfigSchema = z
  .object({
    rejectionReason: z.string().trim().min(10).max(500)
  })
  .strict();

const DeactivatePolicyConfigSchema = z
  .object({
    deactivationReason: z.string().trim().min(10).max(500)
  })
  .strict();

const RollbackPolicyConfigSchema = z
  .object({
    tenantId: z.string().trim().min(1),
    sourceVersion: z.number().int().positive(),
    proposalReason: z.string().trim().min(10).max(500)
  })
  .strict();

// -----------------------------------------------------------------------------
// Global route protection:
// - All routes require authentication
// - Machine identities (service principals) are strictly forbidden
// -----------------------------------------------------------------------------
router.use(authenticate);

router.use((req, res, next) => {
  if (req.user?.identityType === "SERVICE") {
    return next(AppError.forbidden("Access denied: machine service identities cannot access policy-config routes"));
  }
  next();
});

// Helper for tenant scoping on reads
function resolveReadTenantId(req) {
  if (req.user.role === ROLES.ADMIN) {
    return req.query.tenantId ? String(req.query.tenantId).trim() : null;
  }

  if (req.user.role === ROLES.AUDITOR) {
    const hasGlobalAudit = Array.isArray(req.user.scopes) && req.user.scopes.includes("GLOBAL_AUDIT");
    if (hasGlobalAudit) {
      if (req.query.tenantId) {
        createAuditEvent({
          actorType: req.user.identityType || "HUMAN",
          actorId: req.user.sub || req.user.userId,
          action: "GLOBAL_AUDIT_ACCESSED",
          entityType: "PolicyConfigVersion",
          entityId: String(req.query.tenantId),
          metadata: { path: req.path, method: req.method, scopes: req.user.scopes }
        }).catch(() => {});
        return String(req.query.tenantId).trim();
      }
      return req.user.tenantId || null;
    }

    if (!req.user.tenantId) {
      throw AppError.forbidden("Access denied: no tenant context bound to auditor identity");
    }

    if (req.query.tenantId && String(req.query.tenantId).trim() !== req.user.tenantId) {
      createAuditEvent({
        actorType: req.user.identityType || "HUMAN",
        actorId: req.user.sub || req.user.userId,
        action: "ACCESS_DENIED_ALERT",
        entityType: "PolicyConfigVersion",
        entityId: String(req.query.tenantId),
        metadata: {
          userTenant: req.user.tenantId,
          attemptedTenantId: req.query.tenantId,
          reason: "AUDITOR_CROSS_TENANT_ACCESS_DENIED"
        }
      }).catch(() => {});
      throw AppError.forbidden("Access denied: cross-tenant access prohibited for scoped auditor");
    }

    return req.user.tenantId;
  }

  throw AppError.forbidden("Access denied: insufficient role privileges for policy configuration");
}

// -----------------------------------------------------------------------------
// POST /api/policy-config - Propose a new policy configuration (ADMIN only)
// -----------------------------------------------------------------------------
router.post(
  "/",
  requireRoles(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const parsed = ProposePolicyConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Invalid proposal payload: " + parsed.error.issues.map((i) => i.message).join(", "));
    }

    const { tenantId, limits, proposalReason, sourceConfigVersion } = parsed.data;
    const actorId = req.user.sub || req.user.userId;

    const result = await proposePolicyConfig({
      tenantId,
      proposedBy: actorId,
      limits,
      proposalReason,
      sourceConfigVersion
    });

    res.status(201).json({ success: true, data: result });
  })
);

// -----------------------------------------------------------------------------
// POST /api/policy-config/rollback - Propose rollback to an earlier version (ADMIN only)
// -----------------------------------------------------------------------------
router.post(
  "/rollback",
  requireRoles(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const parsed = RollbackPolicyConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Invalid rollback payload: " + parsed.error.issues.map((i) => i.message).join(", "));
    }

    const { tenantId, sourceVersion, proposalReason } = parsed.data;
    const actorId = req.user.sub || req.user.userId;

    const result = await rollbackPolicyConfig({
      tenantId,
      sourceVersion,
      proposedBy: actorId,
      proposalReason
    });

    res.status(201).json({ success: true, data: result });
  })
);

// -----------------------------------------------------------------------------
// GET /api/policy-config/active - Get current ACTIVE policy config (ADMIN & AUDITOR)
// -----------------------------------------------------------------------------
router.get(
  "/active",
  requireRoles(ROLES.ADMIN, ROLES.AUDITOR),
  asyncHandler(async (req, res) => {
    const tenantId = resolveReadTenantId(req);
    if (!tenantId) {
      throw AppError.badRequest("tenantId is required to query active policy configuration");
    }

    const activeConfig = await getActivePolicyConfig(tenantId);
    res.status(200).json({ success: true, data: activeConfig });
  })
);

// -----------------------------------------------------------------------------
// GET /api/policy-config - List policy configurations (ADMIN & AUDITOR)
// -----------------------------------------------------------------------------
router.get(
  "/",
  requireRoles(ROLES.ADMIN, ROLES.AUDITOR),
  asyncHandler(async (req, res) => {
    const tenantId = resolveReadTenantId(req);
    const { status, page, limit } = req.query;

    const result = await listPolicyConfigs({
      tenantId,
      status: status ? String(status) : undefined,
      page: page ? Number(page) : 1,
      limit: limit ? Number(limit) : 50
    });

    res.status(200).json({ success: true, data: result });
  })
);

// -----------------------------------------------------------------------------
// GET /api/policy-config/:id - Get a single policy config by ID (ADMIN & AUDITOR)
// -----------------------------------------------------------------------------
router.get(
  "/:id",
  requireRoles(ROLES.ADMIN, ROLES.AUDITOR),
  asyncHandler(async (req, res) => {
    const config = await getPolicyConfigById(req.params.id);

    // Enforce tenant boundary for scoped auditor
    if (req.user.role === ROLES.AUDITOR) {
      const hasGlobalAudit = Array.isArray(req.user.scopes) && req.user.scopes.includes("GLOBAL_AUDIT");
      if (!hasGlobalAudit && config.tenantId !== req.user.tenantId) {
        throw AppError.notFound(`PolicyConfigVersion '${req.params.id}' not found`);
      }
    }

    res.status(200).json({ success: true, data: config });
  })
);

// -----------------------------------------------------------------------------
// POST /api/policy-config/:id/approve - Approve proposal (ADMIN only, Two-person rule)
// -----------------------------------------------------------------------------
router.post(
  "/:id/approve",
  requireRoles(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const parsed = ApprovePolicyConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Invalid approval payload: " + parsed.error.issues.map((i) => i.message).join(", "));
    }

    const actorId = req.user.sub || req.user.userId;
    const result = await approvePolicyConfig({
      configId: req.params.id,
      approvedBy: actorId,
      approvalReason: parsed.data.approvalReason
    });

    res.status(200).json({ success: true, data: result });
  })
);

// -----------------------------------------------------------------------------
// POST /api/policy-config/:id/reject - Reject proposal (ADMIN only)
// -----------------------------------------------------------------------------
router.post(
  "/:id/reject",
  requireRoles(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const parsed = RejectPolicyConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Invalid rejection payload: " + parsed.error.issues.map((i) => i.message).join(", "));
    }

    const actorId = req.user.sub || req.user.userId;
    const result = await rejectPolicyConfig({
      configId: req.params.id,
      rejectedBy: actorId,
      rejectionReason: parsed.data.rejectionReason
    });

    res.status(200).json({ success: true, data: result });
  })
);

// -----------------------------------------------------------------------------
// POST /api/policy-config/:id/deactivate - Deactivate config (ADMIN only)
// -----------------------------------------------------------------------------
router.post(
  "/:id/deactivate",
  requireRoles(ROLES.ADMIN),
  asyncHandler(async (req, res) => {
    const parsed = DeactivatePolicyConfigSchema.safeParse(req.body);
    if (!parsed.success) {
      throw AppError.badRequest("Invalid deactivation payload: " + parsed.error.issues.map((i) => i.message).join(", "));
    }

    const actorId = req.user.sub || req.user.userId;
    const result = await deactivatePolicyConfig({
      configId: req.params.id,
      deactivatedBy: actorId,
      deactivationReason: parsed.data.deactivationReason
    });

    res.status(200).json({ success: true, data: result });
  })
);

// -----------------------------------------------------------------------------
// Method Not Allowed guards for update and delete endpoints (PUT, PATCH, DELETE)
// -----------------------------------------------------------------------------
router.all("*", (req, res, next) => {
  if (["PUT", "PATCH", "DELETE"].includes(req.method)) {
    return next(new AppError(`HTTP ${req.method} is strictly prohibited on policy configuration resources. Limits are append-only.`, 405, "METHOD_NOT_ALLOWED"));
  }
  next();
});

export default router;
