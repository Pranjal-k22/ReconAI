import express from "express";
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
 */
router.post(
  "/:caseId/investigate",
  requireRoles(
    ROLES.ADMIN,
    ROLES.PAYMENT_CONTROLLER,
    ROLES.AUDITOR,
    ROLES.SHOP,
    ROLES.SHOP_AI,
    ROLES.CUSTOMER,
    ROLES.CUSTOMER_AI
  ),
  async (req, res, next) => {
    try {
      const { caseId } = req.params;
      const { idempotencyKey } = req.body || {};

      const isGlobal =
        req.user.role === ROLES.ADMIN ||
        req.user.role === ROLES.PAYMENT_CONTROLLER ||
        (req.user.role === ROLES.AUDITOR && Array.isArray(req.user.scopes) && req.user.scopes.includes("GLOBAL_AUDIT"));
      const scopedTenantId = isGlobal ? req.tenantFilter || req.user.tenantId || req.body?.tenantId : req.user.tenantId;

      if (!scopedTenantId) {
        throw AppError.badRequest("tenantId could not be determined for investigation");
      }

      const result = await runMultiAgentInvestigation({
        caseId,
        tenantId: scopedTenantId,
        customerId: req.user.customerId || null,
        actorRole: req.user.role,
        idempotencyKey
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

      // Security: Ordinary API evaluation requests cannot supply or override effective refund limits.
      // Caller-supplied policyConfig is strictly ignored; evaluation uses server-side approved configuration only.
      // In the absence of an authorized server-side limits record, effectivePolicyConfig resolves to null (fail-closed).
      const effectivePolicyConfig = null;

      const isGlobal =
        req.user.role === ROLES.ADMIN ||
        req.user.role === ROLES.PAYMENT_CONTROLLER;
      const scopedTenantId = isGlobal ? req.tenantFilter || req.user.tenantId || req.body?.tenantId : req.user.tenantId;

      if (!scopedTenantId) {
        throw AppError.badRequest("tenantId could not be determined for policy evaluation");
      }

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
router.post(
  "/:caseId/provider/dispatch",
  requireRoles(ROLES.ADMIN, ROLES.PAYMENT_CONTROLLER),
  async (req, res, next) => {
    try {
      const { caseId } = req.params;
      const {
        proposedActionType = "REQUEST_REFUND",
        amountPaise,
        currency = "INR",
        idempotencyKey,
        policyVersion
      } = req.body || {};

      if (!idempotencyKey) {
        throw AppError.badRequest("idempotencyKey is required");
      }

      // Security: Select active policy version server-side; reject unsupported versions
      const effectivePolicyVersion = policyVersion || DEFAULT_POLICY_VERSION;
      if (!SUPPORTED_POLICY_VERSIONS.includes(effectivePolicyVersion)) {
        throw AppError.badRequest(
          `Policy version '${effectivePolicyVersion}' is unsupported. Supported: ${SUPPORTED_POLICY_VERSIONS.join(", ")}`
        );
      }

      // Security: Provider dispatch cannot accept caller-supplied refund limits.
      // Must fail closed if server-side approved refund limits are absent.
      const effectivePolicyConfig = null;

      const isGlobal =
        req.user.role === ROLES.ADMIN ||
        req.user.role === ROLES.PAYMENT_CONTROLLER;
      const scopedTenantId = isGlobal ? req.tenantFilter || req.user.tenantId || req.body?.tenantId : req.user.tenantId;

      if (!scopedTenantId) {
        throw AppError.badRequest("tenantId could not be determined for provider dispatch");
      }

      const result = await dispatchSandboxAction({
        tenantId: scopedTenantId,
        caseId,
        actorId: req.user.sub || req.user.userId,
        actorRole: req.user.role,
        proposedActionType,
        amountPaise,
        currency,
        idempotencyKey,
        policyConfig: effectivePolicyConfig,
        policyVersion: effectivePolicyVersion
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

      const tasks = await OrchestrationTask.find({ caseId, tenantId: scopedTenantId })
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

export default router;
