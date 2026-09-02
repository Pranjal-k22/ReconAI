import { asyncHandler } from "../utils/asyncHandler.js";
import { syncPaymentsSchema, syncSettlementsSchema } from "../validators/razorpayValidators.js";
import * as paymentSyncService from "../services/razorpay/paymentSyncService.js";
import * as settlementSyncService from "../services/razorpay/settlementSyncService.js";
import * as razorpayStatusService from "../services/razorpay/razorpayStatusService.js";

/**
 * POST /api/razorpay/sync/payments
 * Triggers READ-ONLY payment fetch and sync from Razorpay Test Mode.
 */
export const syncPayments = asyncHandler(async (req, res) => {
  const validated = syncPaymentsSchema.parse(req.body || {});

  const summary = await paymentSyncService.syncRazorpayPayments({
    from: validated.from,
    to: validated.to,
    actorId: validated.actorId
  });

  res.status(200).json({
    success: true,
    data: summary
  });
});

/**
 * POST /api/razorpay/sync/settlements
 * Triggers READ-ONLY settlement reconciliation fetch and sync from Razorpay Test Mode.
 */
export const syncSettlements = asyncHandler(async (req, res) => {
  const validated = syncSettlementsSchema.parse(req.body || {});

  const summary = await settlementSyncService.syncRazorpaySettlements({
    year: validated.year,
    month: validated.month,
    day: validated.day,
    actorId: validated.actorId
  });

  res.status(200).json({
    success: true,
    data: summary
  });
});

/**
 * GET /api/integrations/status
 * Returns safe system capability configuration status for Gemini & Razorpay.
 */
export const getIntegrationsStatus = asyncHandler(async (req, res) => {
  const status = razorpayStatusService.getIntegrationStatus();

  res.status(200).json({
    success: true,
    data: status
  });
});
