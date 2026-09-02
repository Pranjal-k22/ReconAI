import { GatewayPayment } from "../../models/GatewayPayment.js";
import { createAuditEvent } from "../audit/auditService.js";
import { isRazorpayConfigured, validateTestModeSafety, fetchRazorpayApi } from "./razorpayClient.js";
import { normalizeRazorpayPayment } from "./razorpayNormalizer.js";
import { AppError } from "../../utils/AppError.js";
import logger from "../../config/logger.js";

export const MAX_RAZORPAY_SYNC_RECORDS = 1000;
export const PAGE_SIZE = 100;

function generatePaymentBatchId() {
  const dateStr = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 8);
  const randStr = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `RZP-PAY-${dateStr}-${randStr}`;
}

/**
 * Synchronizes payments from Razorpay Test Mode API into local GatewayPayment collection.
 * 
 * GUARANTEES:
 * - Read-only GET execution (Zero money-moving calls).
 * - Idempotent upsert by gatewayPaymentId.
 * - PII stripping (No customer emails, VPAs, or full card details stored).
 * - Does NOT trigger automatic reconciliation.
 */
export async function syncRazorpayPayments({ from, to, actorId = "system-sync", _customFetch = null } = {}) {
  if (!isRazorpayConfigured() && !_customFetch) {
    throw AppError.badRequest("Razorpay API is not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.");
  }

  validateTestModeSafety();

  const batchId = generatePaymentBatchId();
  const startTime = Date.now();

  // Audit event: RAZORPAY_SYNC_STARTED
  await createAuditEvent({
    actorType: "SYSTEM",
    actorId,
    action: "RAZORPAY_SYNC_STARTED",
    entityType: "GatewayPayment",
    entityId: batchId,
    metadata: {
      syncType: "PAYMENTS",
      batchId,
      from: from || null,
      to: to || null
    }
  });

  const queryParams = {
    count: PAGE_SIZE,
    skip: 0
  };
  if (from) queryParams.from = from;
  if (to) queryParams.to = to;

  let totalFetched = 0;
  let invalidCount = 0;
  const normalizedRecords = [];

  try {
    let hasMore = true;

    while (hasMore && totalFetched < MAX_RAZORPAY_SYNC_RECORDS) {
      const responseData = await fetchRazorpayApi("/v1/payments", queryParams, _customFetch);
      const items = Array.isArray(responseData?.items) ? responseData.items : [];

      if (items.length === 0) {
        hasMore = false;
        break;
      }

      for (const item of items) {
        try {
          const norm = normalizeRazorpayPayment(item, batchId);
          normalizedRecords.push(norm);
        } catch (normErr) {
          invalidCount++;
          logger.warn({ err: normErr.message, itemId: item?.id }, "Skipping invalid Razorpay payment item");
        }
      }

      totalFetched += items.length;

      if (items.length < PAGE_SIZE) {
        hasMore = false;
      } else {
        queryParams.skip += items.length;
      }
    }

    let insertedCount = 0;
    let updatedCount = 0;

    if (normalizedRecords.length > 0) {
      const bulkOps = normalizedRecords.map((rec) => ({
        updateOne: {
          filter: { gatewayPaymentId: rec.gatewayPaymentId },
          update: { $set: rec },
          upsert: true
        }
      }));

      const bulkResult = await GatewayPayment.bulkWrite(bulkOps);
      insertedCount = bulkResult.upsertedCount || 0;
      updatedCount = bulkResult.modifiedCount || (bulkResult.matchedCount - insertedCount) || 0;
    }

    const durationMs = Date.now() - startTime;

    const summary = {
      batchId,
      mode: "test",
      fetched: totalFetched,
      inserted: insertedCount,
      updated: updatedCount,
      skipped: 0,
      invalid: invalidCount,
      durationMs
    };

    // Audit event: RAZORPAY_SYNC_COMPLETED
    await createAuditEvent({
      actorType: "SYSTEM",
      actorId,
      action: "RAZORPAY_SYNC_COMPLETED",
      entityType: "GatewayPayment",
      entityId: batchId,
      metadata: {
        syncType: "PAYMENTS",
        ...summary
      }
    });

    return summary;
  } catch (err) {
    const failureReason = err.message || "Razorpay payment synchronization failed";

    // Audit event: RAZORPAY_SYNC_FAILED
    await createAuditEvent({
      actorType: "SYSTEM",
      actorId,
      action: "RAZORPAY_SYNC_FAILED",
      entityType: "GatewayPayment",
      entityId: batchId,
      metadata: {
        syncType: "PAYMENTS",
        batchId,
        reason: failureReason
      }
    });

    throw err;
  }
}
