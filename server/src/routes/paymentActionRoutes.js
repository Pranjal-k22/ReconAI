import express from "express";
import {
  recordProposedAction,
  getActionsByCaseId,
  getActionByIdempotencyKey
} from "../services/ledger/paymentActionService.js";
import { authenticate, requireRoles, requireTenantScope } from "../middleware/authMiddleware.js";
import { ROLES } from "../services/auth/tokenService.js";

const router = express.Router();

router.use(authenticate);
router.use(requireTenantScope);

/**
 * GET /api/payment-actions/case/:caseId - Retrieves proposed/simulated actions for a case
 */
router.get("/case/:caseId", async (req, res, next) => {
  try {
    const { caseId } = req.params;
    const scopedTenantId =
      req.user.role === ROLES.ADMIN || req.user.role === ROLES.AUDITOR || req.user.role === ROLES.PAYMENT_CONTROLLER
        ? req.tenantFilter || null
        : req.user.tenantId;

    const actions = await getActionsByCaseId(caseId, scopedTenantId);
    res.status(200).json({ success: true, data: actions });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/payment-actions - Proposes or simulates a resolution action
 * Restricted strictly to PAYMENT_CONTROLLER and ADMIN principals.
 */
router.post(
  "/",
  requireRoles(ROLES.PAYMENT_CONTROLLER, ROLES.ADMIN),
  async (req, res, next) => {
    try {
      const payload = { ...req.body };

      // Derive tenantId from principal
      if (req.user.tenantId && !payload.tenantId) {
        payload.tenantId = req.user.tenantId;
      }

      payload.initiatedByActorType = payload.initiatedByActorType || req.user.identityType || "POLICY_ENGINE";
      payload.initiatedByActorId = req.user.sub;

      const result = await recordProposedAction(payload);
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
