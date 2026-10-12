import { ingestRazorpayWebhook } from "../services/webhook/webhookService.js";
import { AppError } from "../utils/AppError.js";

/**
 * Controller handling Razorpay incoming webhook events.
 */
export async function handleRazorpayWebhook(req, res, next) {
  try {
    // 1. Verify content-type
    const contentType = req.headers["content-type"] || "";
    if (!contentType.includes("application/json")) {
      return next(AppError.badRequest("Invalid content-type: application/json required"));
    }

    // 2. Raw body presence check
    if (!req.rawBody || req.rawBody.length === 0) {
      return next(AppError.badRequest("Empty or missing raw request body"));
    }

    // 3. Process webhook event
    const result = await ingestRazorpayWebhook({
      rawBody: req.rawBody,
      headers: req.headers,
      payload: req.body
    });

    return res.status(200).json({
      success: true,
      data: {
        status: result.status,
        eventId: result.eventId || null,
        isDuplicate: result.isDuplicate || false,
        reason: result.reason || null
      }
    });
  } catch (err) {
    return next(err);
  }
}
