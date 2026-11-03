import express from "express";
import { z } from "zod";
import {
  createPaymentCase,
  getPaymentCaseById,
  updatePaymentCaseSafeHold,
  listPaymentCases
} from "../services/ledger/paymentCaseService.js";
import {
  runMultiAgentInvestigation,
  getInvestigationsByCaseId
} from "../services/ai/multiAgentInvestigator.js";
import {
  evaluateAndSimulateResolution,
  getDecisionsByCaseId
} from "../services/policy/dryRunSimulatorService.js";
import {
  dispatchSandboxAction,
  getProviderOperationsByCaseId,
  recheckProviderOperationStatus
} from "../services/policy/providerDispatchService.js";
import {
  DEFAULT_POLICY_VERSION,
  SUPPORTED_POLICY_VERSIONS
} from "../services/policy/resolutionPolicyEvaluator.js";
import { authenticate, requireRoles, requireTenantScope } from "../middleware/authMiddleware.js";
import { ROLES } from "../services/auth/tokenService.js";
import { AppError } from "../utils/AppError.js";
import { OrchestrationTask } from "../models/OrchestrationTask.js";
import { queueOrchestrationTask } from "../services/orchestration/orchestrationService.js";
import {
  classifyCase,
  getCaseClassification,
  redactClassificationResponse
} from "../services/classification/classificationService.js";
import { createAuditEvent } from "../services/audit/auditService.js";
import { PaymentCase } from "../models/PaymentCase.js";
import { CustomerClaim } from "../models/CustomerClaim.js";
import {
  checkInvestigationCostGuard,
  recordInvestigationCostUsage
} from "../services/ai/investigationCostGuard.js";

const router = express.Router();

// All payment case endpoints require authentication and tenant boundary checks
router.use(authenticate);
router.use(requireTenantScope);

/**
 * GET /api/payment-cases - Lists payment cases with strict row-level tenant and customer scoping
 */
router.get("/", async (req, res, next) => {
  try {
    const { resolutionCaseStatus, isSafeHold, page = 1, limit = 50 } = req.query;

    const filter = {
      page: parseInt(page, 10),
      limit: parseInt(limit, 10)
    };

    if (resolutionCaseStatus) filter.resolutionCaseStatus = resolutionCaseStatus;
    if (typeof isSafeHold !== "undefined") filter.isSafeHold = isSafeHold === "true";

    // Row-level tenant enforcement
    if (req.user.role === ROLES.CUSTOMER || req.user.role === ROLES.CUSTOMER_AI) {
      filter.tenantId = req.user.tenantId;
      filter.customerId = req.user.customerId;
    } else if (req.user.role === ROLES.SHOP || req.user.role === ROLES.SHOP_AI) {
      filter.tenantId = req.user.tenantId;
    } else if (req.tenantFilter) {
      // ADMIN or AUDITOR filtering by specific tenant
      filter.tenantId = req.tenantFilter;
    }

    const result = await listPaymentCases(filter);
    res.status(200).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/payment-cases/:caseId - Retrieves single case with strict ownership validation
 */
router.get("/:caseId", async (req, res, next) => {
  try {
    const { caseId } = req.params;
    const isGlobal =
      req.user.role === ROLES.ADMIN ||
      req.user.role === ROLES.PAYMENT_CONTROLLER ||
      (req.user.role === ROLES.AUDITOR && Array.isArray(req.user.scopes) && req.user.scopes.includes("GLOBAL_AUDIT"));
    const scopedTenantId = isGlobal ? null : req.user.tenantId;

    const paymentCase = await getPaymentCaseById(caseId, scopedTenantId);

    // Customer scoping check
    if (
      (req.user.role === ROLES.CUSTOMER || req.user.role === ROLES.CUSTOMER_AI) &&
      paymentCase.customerId !== req.user.customerId
    ) {
      throw AppError.notFound(`PaymentCase not found for caseId '${caseId}'`);
    }

    res.status(200).json({ success: true, data: paymentCase });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/payment-cases - Creates a new payment investigation case
 */
router.post(
  "/",
  requireRoles(ROLES.CUSTOMER, ROLES.SHOP, ROLES.ADMIN, ROLES.CUSTOMER_AI, ROLES.SHOP_AI, ROLES.PAYMENT_CONTROLLER),
  async (req, res, next) => {
    try {
      const payload = { ...req.body };

      // Strictly derive tenant and customer context from authenticated principal
      if (req.user.role === ROLES.CUSTOMER || req.user.role === ROLES.CUSTOMER_AI) {
        payload.tenantId = req.user.tenantId;
        payload.customerId = req.user.customerId;
      } else if (req.user.role === ROLES.SHOP || req.user.role === ROLES.SHOP_AI) {
        payload.tenantId = req.user.tenantId;
      } else if (!payload.tenantId && req.tenantFilter) {
        payload.tenantId = req.tenantFilter;
      }

      payload.actorId = req.user.sub;

      const result = await createPaymentCase(payload);
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PATCH /api/payment-cases/:caseId/safe-hold - Admin-only safe-hold quarantine review
 */
router.patch("/:caseId/safe-hold", requireRoles(ROLES.ADMIN), async (req, res, next) => {
  try {
    const { caseId } = req.params;
    const { isSafeHold, safeHoldCode, safeHoldReason } = req.body;

    const updated = await updatePaymentCaseSafeHold({
      caseId,
      isSafeHold,
      safeHoldCode,
      safeHoldReason,
      actorId: req.user.sub
    });

    res.status(200).json({ success: true, data: updated });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/payment-cases/:caseId/investigate - Runs controller-mediated 4-agent AI investigation
 * Restricted strictly to ADMIN with strict empty body and persistent cost guardrails.
 */
router.post(
  "/:caseId/investigate",
  requireRoles(ROLES.ADMIN),
  async (req, res, next) => {
    try {
      const { caseId } = req.params;

      // Strict empty body enforcement: caller cannot supply arbitrary payload
      if (req.body && Object.keys(req.body).length > 0) {
        throw AppError.badRequest("investigateCase requires strict empty body; caller-supplied payload is prohibited");
      }

      let scopedTenantId = req.tenantFilter || req.query?.tenantId || req.user.tenantId;
      if (!scopedTenantId) {
        const found = await PaymentCase.findOne({ caseId: caseId.trim() }).lean();
        if (!found || String(found.tenantId).trim() === "unassigned_provider_quarantine") {
          throw AppError.notFound(`PaymentCase '${caseId}' not found`);
        }
        scopedTenantId = found.tenantId;
      }

      if (String(scopedTenantId).trim() === "unassigned_provider_quarantine") {
        throw AppError.notFound(`PaymentCase '${caseId}' not found in tenant '${scopedTenantId}'`);
      }

      const caseDoc = await PaymentCase.findOne({
        caseId: caseId.trim(),
        tenantId: scopedTenantId
      }).lean();

      if (!caseDoc) {
        throw AppError.notFound(`PaymentCase '${caseId}' not found in tenant '${scopedTenantId}'`);
      }

      const adminId = req.user.userId || req.user.id || req.user.sub || req.user.email || "admin";

      // Enforce MongoDB-persisted cost guard before invoking LLM investigation
      await checkInvestigationCostGuard({
        adminId,
        tenantId: scopedTenantId
      });

      const result = await runMultiAgentInvestigation({
        caseId: caseId.trim(),
        tenantId: scopedTenantId,
        customerId: null,
        actorRole: req.user.role
      });

      // Atomically record cost usage upon successful completion
      await recordInvestigationCostUsage({
        adminId,
        tenantId: scopedTenantId
      });

      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/payment-cases/:caseId/investigations - Retrieves past investigation runs
 */
router.get("/:caseId/investigations", async (req, res, next) => {
  try {
    const { caseId } = req.params;
    const isGlobal =
      req.user.role === ROLES.ADMIN ||
      req.user.role === ROLES.PAYMENT_CONTROLLER ||
      (req.user.role === ROLES.AUDITOR && Array.isArray(req.user.scopes) && req.user.scopes.includes("GLOBAL_AUDIT"));
    const scopedTenantId = isGlobal ? req.tenantFilter || req.user.tenantId || req.query?.tenantId : req.user.tenantId;

    const results = await getInvestigationsByCaseId(
      caseId,
      scopedTenantId,
      (req.user.role === ROLES.CUSTOMER || req.user.role === ROLES.CUSTOMER_AI) ? req.user.customerId : null
    );

    res.status(200).json({ success: true, data: results });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/payment-cases/:caseId/evidence - Retrieves past investigation and evidence records
 */
router.get("/:caseId/evidence", async (req, res, next) => {
  try {
    const { caseId } = req.params;
    const isGlobal =
      req.user.role === ROLES.ADMIN ||
      req.user.role === ROLES.PAYMENT_CONTROLLER ||
      (req.user.role === ROLES.AUDITOR && Array.isArray(req.user.scopes) && req.user.scopes.includes("GLOBAL_AUDIT"));
    const scopedTenantId = isGlobal ? req.tenantFilter || req.user.tenantId || req.query?.tenantId : req.user.tenantId;

    const results = await getInvestigationsByCaseId(
      caseId,
      scopedTenantId,
      (req.user.role === ROLES.CUSTOMER || req.user.role === ROLES.CUSTOMER_AI) ? req.user.customerId : null
    );

    res.status(200).json({ success: true, data: results });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/payment-cases/:caseId/policy/evaluate - Evaluates deterministic resolution policy and simulates eligible action
 */
router.post(
  "/:caseId/policy/evaluate",
  requireRoles(ROLES.ADMIN, ROLES.PAYMENT_CONTROLLER, ROLES.SHOP),
  async (req, res, next) => {
    try {
      const { caseId } = req.params;
      const {
        proposedActionType,
        amountPaise,
        currency = "INR",
        idempotencyKey,
        policyVersion,
        advisoryAiSuggestion
      } = req.body || {};

      if (!proposedActionType) {
        throw AppError.badRequest("proposedActionType is required");
      }
      if (!idempotencyKey) {
        throw AppError.badRequest("idempotencyKey is required");
      }

      // Security: Select active policy version server-side; reject unsupported, stale, or weaker versions
      const effectivePolicyVersion = policyVersion || DEFAULT_POLICY_VERSION;
      if (!SUPPORTED_POLICY_VERSIONS.includes(effectivePolicyVersion)) {
        throw AppError.badRequest(
          `Policy version '${effectivePolicyVersion}' is unsupported. Supported immutable versions: ${SUPPORTED_POLICY_VERSIONS.join(", ")}`
        );
      }

      const isGlobal =
        req.user.role === ROLES.ADMIN ||
        req.user.role === ROLES.PAYMENT_CONTROLLER;
      const scopedTenantId = isGlobal ? req.tenantFilter || req.user.tenantId || req.body?.tenantId : req.user.tenantId;

      if (!scopedTenantId) {
        throw AppError.badRequest("tenantId could not be determined for policy evaluation");
      }

      // Security: Ordinary API evaluation requests cannot supply or override effective refund limits.
      // Limits are loaded strictly from the active, two-person-approved PolicyConfigVersion record in DB inside evaluateAndSimulateResolution.
      // Caller-supplied policyConfig is strictly ignored; route enforces server-controlled null config.
      const effectivePolicyConfig = null;

      const result = await evaluateAndSimulateResolution({
        tenantId: scopedTenantId,
        caseId,
        actorId: req.user.sub || req.user.userId,
        actorRole: req.user.role,
        proposedActionType,
        amountPaise,
        currency,
        idempotencyKey,
        policyConfig: effectivePolicyConfig,
        policyVersion: effectivePolicyVersion,
        advisoryAiSuggestion
      });

      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/payment-cases/:caseId/policy/decisions - Retrieves past policy decisions
 */
router.get(
  "/:caseId/policy/decisions",
  requireRoles(ROLES.ADMIN, ROLES.PAYMENT_CONTROLLER, ROLES.SHOP, ROLES.AUDITOR),
  async (req, res, next) => {
    try {
      const { caseId } = req.params;
      const isGlobal =
        req.user.role === ROLES.ADMIN ||
        req.user.role === ROLES.PAYMENT_CONTROLLER ||
        (req.user.role === ROLES.AUDITOR && Array.isArray(req.user.scopes) && req.user.scopes.includes("GLOBAL_AUDIT"));
      const scopedTenantId = isGlobal ? req.tenantFilter || req.user.tenantId || req.query?.tenantId : req.user.tenantId;

      const decisions = await getDecisionsByCaseId(caseId, scopedTenantId);
      res.status(200).json({ success: true, data: decisions });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/payment-cases/:caseId/provider/dispatch
 * Dispatches an approved sandbox provider action (e.g. Test Mode refund).
 * Strictly gated by Test Mode, RAZORPAY_SANDBOX_WRITES_ENABLED, and deterministic policy eligibility.
 */
/**
 * POST /api/payment-cases/:caseId/provider/dispatch
 * Dispatches an approved sandbox provider action (e.g. Test Mode refund).
 * Strictly gated: accepts ONLY { actionType: "REQUEST_REFUND" } plus :caseId path parameter.
 * Any extra body field -> 400 Bad Request, no side effects.
 * Amount and idempotency key are derived strictly server-side.
 */
router.post(
  "/:caseId/provider/dispatch",
  requireRoles(ROLES.ADMIN),
  async (req, res, next) => {
    try {
      // 1. Strict schema validation: route accepts ONLY { actionType: "REQUEST_REFUND" }
      const strictDispatchSchema = z
        .object({
          actionType: z.literal("REQUEST_REFUND")
        })
        .strict();

      const parseResult = strictDispatchSchema.safeParse(req.body);
      if (!parseResult.success) {
        throw AppError.badRequest(
          "Invalid dispatch request body: route accepts strictly { actionType: 'REQUEST_REFUND' } and no other fields",
          parseResult.error.format()
        );
      }

      const { actionType } = parseResult.data;
      const { caseId } = req.params;

      if (!caseId || typeof caseId !== "string" || !caseId.trim()) {
        throw AppError.badRequest("Canonical :caseId path parameter is required");
      }

      const isGlobal =
        req.user.role === ROLES.ADMIN ||
        req.user.role === ROLES.PAYMENT_CONTROLLER;
      const scopedTenantId = req.user.tenantId || (isGlobal ? req.tenantFilter : null);

      if (!scopedTenantId) {
        throw AppError.badRequest("tenantId could not be determined for provider dispatch");
      }

      const result = await dispatchSandboxAction({
        tenantId: scopedTenantId,
        caseId: caseId.trim(),
        actorId: req.user.sub || req.user.userId,
        actorRole: req.user.role,
        actionType
      });

      if (result.dispatchBlocked) {
        return res.status(422).json({
          success: false,
          error: result.reason,
          data: result
        });
      }

      res.status(200).json({ success: true, data: result });
    } catch (err) {
      if (err.name === "SandboxGateClosedError") {
        return res.status(403).json({
          success: false,
          error: err.message,
          code: err.code,
          details: err.details
        });
      }
      next(err);
    }
  }
);

/**
 * GET /api/payment-cases/:caseId/provider/operations
 * Retrieves historical provider operations for this case.
 */
router.get(
  "/:caseId/provider/operations",
  requireRoles(ROLES.ADMIN, ROLES.PAYMENT_CONTROLLER, ROLES.SHOP, ROLES.AUDITOR),
  async (req, res, next) => {
    try {
      const { caseId } = req.params;
      const isGlobal =
        req.user.role === ROLES.ADMIN ||
        req.user.role === ROLES.PAYMENT_CONTROLLER ||
        (req.user.role === ROLES.AUDITOR && Array.isArray(req.user.scopes) && req.user.scopes.includes("GLOBAL_AUDIT"));
      const scopedTenantId = isGlobal ? req.tenantFilter || req.user.tenantId || req.query?.tenantId : req.user.tenantId;

      const operations = await getProviderOperationsByCaseId(caseId, scopedTenantId);
      res.status(200).json({ success: true, data: operations });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/payment-cases/:caseId/provider/operations/:operationId/recheck
 * Re-checks provider outcome via read-only authoritative verification.
 */
router.post(
  "/:caseId/provider/operations/:operationId/recheck",
  requireRoles(ROLES.ADMIN, ROLES.PAYMENT_CONTROLLER),
  async (req, res, next) => {
    try {
      const { caseId, operationId } = req.params;
      const isGlobal =
        req.user.role === ROLES.ADMIN ||
        req.user.role === ROLES.PAYMENT_CONTROLLER;
      const scopedTenantId = isGlobal ? req.tenantFilter || req.user.tenantId || req.body?.tenantId : req.user.tenantId;

      const result = await recheckProviderOperationStatus({
        tenantId: scopedTenantId,
        operationId
      });

      res.status(200).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/payment-cases/:caseId/orchestration/tasks
 * Lists historical orchestration tasks for this case scoped to tenant.
 */
router.get(
  "/:caseId/orchestration/tasks",
  requireRoles(ROLES.ADMIN, ROLES.PAYMENT_CONTROLLER, ROLES.SHOP, ROLES.AUDITOR),
  async (req, res, next) => {
    try {
      const { caseId } = req.params;
      const isGlobal =
        req.user.role === ROLES.ADMIN ||
        req.user.role === ROLES.PAYMENT_CONTROLLER ||
        (req.user.role === ROLES.AUDITOR && Array.isArray(req.user.scopes) && req.user.scopes.includes("GLOBAL_AUDIT"));
      const scopedTenantId = isGlobal ? req.tenantFilter || req.user.tenantId || req.query?.tenantId : req.user.tenantId;

      if (scopedTenantId && String(scopedTenantId).trim() === "unassigned_provider_quarantine") {
        return res.status(200).json({ success: true, data: [] });
      }

      const query = { caseId };
      if (scopedTenantId) {
        query.tenantId = scopedTenantId;
      } else {
        query.tenantId = { $ne: "unassigned_provider_quarantine" };
      }

      const tasks = await OrchestrationTask.find(query)
        .sort({ createdAt: -1 })
        .lean();

      res.status(200).json({ success: true, data: tasks });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/payment-cases/:caseId/orchestration/enqueue
 * Manually enqueues an orchestration task for this case.
 */
router.post(
  "/:caseId/orchestration/enqueue",
  requireRoles(ROLES.ADMIN, ROLES.PAYMENT_CONTROLLER),
  async (req, res, next) => {
    try {
      const { caseId } = req.params;
      const { idempotencyKey, triggerSource = "API", metadata } = req.body;
      const isGlobal =
        req.user.role === ROLES.ADMIN ||
        req.user.role === ROLES.PAYMENT_CONTROLLER;
      const scopedTenantId = isGlobal ? req.tenantFilter || req.user.tenantId || req.body?.tenantId : req.user.tenantId;

      if (!idempotencyKey) {
        throw AppError.badRequest("idempotencyKey is required to enqueue orchestration task");
      }

      const task = await queueOrchestrationTask({
        tenantId: scopedTenantId,
        caseId,
        idempotencyKey,
        triggerSource,
        metadata
      });

      res.status(201).json({ success: true, data: task });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/payment-cases/:caseId/classify
 * Executes authoritative, database-driven evidence classification (B2).
 * Restricted strictly to ADMIN with strict empty body.
 */
router.post(
  "/:caseId/classify",
  requireRoles(ROLES.ADMIN),
  async (req, res, next) => {
    try {
      const { caseId } = req.params;

      // Strict empty body enforcement: caller cannot supply or inject evidence
      if (req.body && Object.keys(req.body).length > 0) {
        throw AppError.badRequest("classifyCase requires strict empty body; caller-supplied evidence is prohibited");
      }

      let scopedTenantId = req.tenantFilter || req.query?.tenantId || req.user.tenantId;
      if (!scopedTenantId) {
        const found = await PaymentCase.findOne({ caseId: caseId.trim() }).lean();
        if (!found || String(found.tenantId).trim() === "unassigned_provider_quarantine") {
          throw AppError.notFound(`PaymentCase '${caseId}' not found`);
        }
        scopedTenantId = found.tenantId;
      }

      if (String(scopedTenantId).trim() === "unassigned_provider_quarantine") {
        throw AppError.notFound(`PaymentCase '${caseId}' not found in tenant '${scopedTenantId}'`);
      }

      // Tenant ownership check: tenant mismatch returns 404
      const caseDoc = await PaymentCase.findOne({
        caseId: caseId.trim(),
        tenantId: scopedTenantId
      }).lean();

      if (!caseDoc) {
        throw AppError.notFound(`PaymentCase '${caseId}' not found in tenant '${scopedTenantId}'`);
      }

      const result = await classifyCase({
        tenantId: scopedTenantId,
        caseId: caseId.trim(),
        actor: req.user
      });

      res.status(200).json({
        success: true,
        data: redactClassificationResponse(result.evidenceRecord),
        isReplay: result.isReplay
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/payment-cases/:caseId/classification
 * Retrieves authoritative classification finding for a case (B2).
 * RBAC: ADMIN, SHOP (own tenant), AUDITOR (own tenant or GLOBAL_AUDIT audited).
 * CUSTOMER and all machine service roles return HTTP 403.
 * Tenant mismatch returns HTTP 404.
 */
router.get(
  "/:caseId/classification",
  async (req, res, next) => {
    try {
      const { caseId } = req.params;

      // Role check: CUSTOMER and all service roles are strictly forbidden
      if (
        req.user.role === ROLES.CUSTOMER ||
        req.user.role === ROLES.CUSTOMER_AI ||
        req.user.role === ROLES.SHOP_AI ||
        req.user.role === ROLES.PAYMENT_CONTROLLER ||
        (req.user.role && req.user.role.startsWith("SERVICE_"))
      ) {
        throw AppError.forbidden("Access denied: role not authorized to view classification findings");
      }

      // Allowed roles: ADMIN, SHOP, AUDITOR
      if (
        req.user.role !== ROLES.ADMIN &&
        req.user.role !== ROLES.SHOP &&
        req.user.role !== ROLES.AUDITOR
      ) {
        throw AppError.forbidden("Access denied: role not recognized for classification access");
      }

      let scopedTenantId = req.user.tenantId;

      if (req.user.role === ROLES.ADMIN) {
        scopedTenantId = req.tenantFilter || req.query.tenantId || req.user.tenantId;
      } else if (req.user.role === ROLES.AUDITOR) {
        const hasGlobalAudit = Array.isArray(req.user.scopes) && req.user.scopes.includes("GLOBAL_AUDIT");
        if (hasGlobalAudit && (req.tenantFilter || req.query.tenantId)) {
          scopedTenantId = req.tenantFilter || req.query.tenantId;
          // Emit append-only GLOBAL_AUDIT_ACCESSED audit event per ADR-12
          await createAuditEvent({
            tenantId: scopedTenantId,
            action: "GLOBAL_AUDIT_ACCESSED",
            entityType: "PaymentCase",
            entityId: caseId.trim(),
            actorId: req.user.sub || req.user.id || req.user.userId || "AUDITOR",
            actorType: "HUMAN",
            metadata: { endpoint: req.originalUrl, caseId }
          });
        } else {
          scopedTenantId = req.user.tenantId;
        }
      } else if (req.user.role === ROLES.SHOP) {
        scopedTenantId = req.user.tenantId;
      }

      const isGlobal =
        req.user.role === ROLES.ADMIN ||
        (req.user.role === ROLES.AUDITOR && Array.isArray(req.user.scopes) && req.user.scopes.includes("GLOBAL_AUDIT"));

      if (scopedTenantId && String(scopedTenantId).trim() === "unassigned_provider_quarantine") {
        throw AppError.notFound(`PaymentCase '${caseId}' not found in tenant '${scopedTenantId}'`);
      }

      const caseQuery = { caseId: caseId.trim() };
      if (scopedTenantId) {
        caseQuery.tenantId = scopedTenantId;
      } else if (isGlobal) {
        caseQuery.tenantId = { $ne: "unassigned_provider_quarantine" };
      }

      // Tenant ownership check: tenant mismatch returns 404
      const caseDoc = await PaymentCase.findOne(caseQuery).lean();

      if (!caseDoc) {
        throw AppError.notFound(`PaymentCase '${caseId}' not found in tenant '${scopedTenantId}'`);
      }

      const effectiveTenantId = scopedTenantId || caseDoc.tenantId;

      const record = await getCaseClassification({
        tenantId: effectiveTenantId,
        caseId: caseId.trim()
      });

      res.status(200).json({
        success: true,
        data: redactClassificationResponse(record)
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/payment-cases/:caseId/claims
 * Returns unverified customer claims associated with a payment case.
 * Restricted to ADMIN, SHOP (own tenant), and AUDITOR (tenant-scoped or GLOBAL_AUDIT).
 * CUSTOMER and service roles return 403.
 * Sentinel tenant unassigned_provider_quarantine returns 404.
 */
router.get(
  "/:caseId/claims",
  requireRoles(ROLES.ADMIN, ROLES.SHOP, ROLES.AUDITOR),
  async (req, res, next) => {
    try {
      const { caseId } = req.params;
      const isGlobal = (req.user?.role === ROLES.ADMIN || (req.user?.role === ROLES.AUDITOR && req.user?.isGlobalAudit));
      const scopedTenantId = req.user?.tenantId;

      if (!scopedTenantId && !isGlobal) {
        throw AppError.notFound(`PaymentCase '${caseId}' not found`);
      }

      const caseQuery = { caseId: caseId.trim() };
      if (scopedTenantId) {
        caseQuery.tenantId = scopedTenantId;
      } else if (isGlobal) {
        caseQuery.tenantId = { $ne: "unassigned_provider_quarantine" };
      }

      const caseDoc = await PaymentCase.findOne(caseQuery).lean();
      if (!caseDoc || caseDoc.tenantId === "unassigned_provider_quarantine") {
        throw AppError.notFound(`PaymentCase '${caseId}' not found`);
      }

      // If global auditor accesses cross-tenant, emit audit event
      if (req.user?.role === ROLES.AUDITOR && req.user?.isGlobalAudit && scopedTenantId !== caseDoc.tenantId) {
        await createAuditEvent({
          actorType: "HUMAN",
          actorId: req.user.userId || req.user.email || "auditor_global",
          action: "GLOBAL_AUDIT_ACCESSED",
          entityType: "PAYMENT_CASE",
          entityId: caseDoc.caseId,
          tenantId: caseDoc.tenantId,
          metadata: {
            accessedTenantId: caseDoc.tenantId,
            route: `/api/payment-cases/${caseId}/claims`
          }
        });
      }

      const claims = await CustomerClaim.find({
        tenantId: caseDoc.tenantId,
        linkedCaseId: caseDoc.caseId
      })
        .sort({ createdAt: -1 })
        .lean();

      res.status(200).json({
        success: true,
        data: claims.map((c) => ({
          claimId: c.claimId,
          claimType: c.claimType,
          referenceType: c.referenceType,
          referenceValue: c.referenceValue,
          claimedAmountPaise: c.claimedAmountPaise,
          description: (c.description || "").slice(0, 1000),
          verified: false,
          label: "claim, unverified",
          authority: "CUSTOMER_CLAIM",
          createdAt: c.createdAt ? new Date(c.createdAt).toISOString() : null
        }))
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
