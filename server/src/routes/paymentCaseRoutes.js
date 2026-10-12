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
import { authenticate, requireRoles, requireTenantScope } from "../middleware/authMiddleware.js";
import { ROLES } from "../services/auth/tokenService.js";
import { AppError } from "../utils/AppError.js";

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

export default router;
