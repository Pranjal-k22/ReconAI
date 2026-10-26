import express from "express";
import {
  appendLifecycleEvent,
  getEventsByCaseId,
  getEventsByPaymentId
} from "../services/ledger/paymentLifecycleEventService.js";
import { PaymentLifecycleEvent } from "../models/PaymentLifecycleEvent.js";
import { authenticate, requireRoles, requireTenantScope } from "../middleware/authMiddleware.js";
import { ROLES } from "../services/auth/tokenService.js";

import { AppError } from "../utils/AppError.js";

const router = express.Router();

router.use(authenticate);
router.use(requireTenantScope);

/**
 * GET /api/payment-events - Lists lifecycle events with quarantine sentinel exclusion
 */
router.get("/", async (req, res, next) => {
  try {
    const scopedTenantId =
      req.user.role === ROLES.ADMIN || req.user.role === ROLES.AUDITOR || req.user.role === ROLES.PAYMENT_CONTROLLER
        ? req.tenantFilter || req.query.tenantId || null
        : req.user.tenantId;

    if (scopedTenantId && scopedTenantId.trim() === "unassigned_provider_quarantine") {
      return res.status(200).json({ success: true, data: [] });
    }

    const query = scopedTenantId
      ? { tenantId: scopedTenantId.trim() }
      : { tenantId: { $ne: "unassigned_provider_quarantine" } };

    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const events = await PaymentLifecycleEvent.find(query).limit(limit).sort({ ingestedAt: -1 }).lean();
    res.status(200).json({ success: true, data: events });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/payment-events/case/:caseId - Retrieves normalized lifecycle events for a case
 */
router.get("/case/:caseId", async (req, res, next) => {
  try {
    const { caseId } = req.params;
    const scopedTenantId =
      req.user.role === ROLES.ADMIN || req.user.role === ROLES.AUDITOR || req.user.role === ROLES.PAYMENT_CONTROLLER
        ? req.tenantFilter || null
        : req.user.tenantId;

    const events = await getEventsByCaseId(caseId, scopedTenantId);
    res.status(200).json({ success: true, data: events });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/payment-events/payment/:paymentId - Retrieves normalized lifecycle events for a payment
 */
router.get("/payment/:paymentId", async (req, res, next) => {
  try {
    const { paymentId } = req.params;
    const scopedTenantId =
      req.user.role === ROLES.ADMIN || req.user.role === ROLES.AUDITOR || req.user.role === ROLES.PAYMENT_CONTROLLER
        ? req.tenantFilter || null
        : req.user.tenantId;

    const events = await getEventsByPaymentId(paymentId, scopedTenantId);
    res.status(200).json({ success: true, data: events });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/payment-events - Ingests normalized lifecycle event into append-only ledger
 * Restricted to PAYMENT_CONTROLLER and ADMIN principals.
 */
router.post(
  "/",
  requireRoles(ROLES.PAYMENT_CONTROLLER, ROLES.ADMIN),
  async (req, res, next) => {
    try {
      const payload = { ...req.body };

      // Security Safeguard 1: External API callers cannot assert internal 'RECONAI_SYSTEM' provenance
      if (payload.sourceSystem === "RECONAI_SYSTEM") {
        throw AppError.badRequest("Callers cannot assert 'RECONAI_SYSTEM' provenance via ingestion API");
      }

      // Security Safeguard 2: Callers cannot assert server-verified telemetry trust metadata
      if (
        payload.serverVerifiedTelemetry !== undefined ||
        payload.metadata?.serverVerifiedTelemetry !== undefined ||
        payload.rawPayload?.serverVerifiedTelemetry !== undefined ||
        payload.provenance?.serverVerifiedTelemetry !== undefined
      ) {
        throw AppError.badRequest("Caller-supplied 'serverVerifiedTelemetry' is prohibited; telemetry verification cannot be asserted via API payload");
      }

      if (req.user.tenantId && !payload.tenantId) {
        payload.tenantId = req.user.tenantId;
      }

      payload.actorId = req.user.sub;

      const result = await appendLifecycleEvent(payload);
      res.status(201).json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
