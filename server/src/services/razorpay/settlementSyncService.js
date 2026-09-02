import { SettlementRecord } from "../../models/SettlementRecord.js";
import { createAuditEvent } from "../audit/auditService.js";
import { isRazorpayConfigured, validateTestModeSafety, fetchRazorpayApi } from "./razorpayClient.js";
import { normalizeRazorpaySettlement } from "./razorpayNormalizer.js";
import { AppError } from "../../utils/AppError.js";
import logger from "../../config/logger.js";

export const MAX_RAZORPAY_SETTLEMENT_SYNC_RECORDS = 1000;
export const SETTLEMENT_PAGE_SIZE = 500;

function generateSettlementBatchId() {
  const dateStr = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 8);
  const randStr = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `RZP-SET-${dateStr}-${randStr}`;
}

/**
 * Synchronizes settlement reconciliation records from Razorpay Test Mode API into local SettlementRecord collection.
 * 
 * GUARANTEES:
 * - Read-only GET execution (Zero money-moving calls).
 * - Deterministic line-item IDs (RZPREC-hash).
 * - Idempotent upsert by settlementRecordId.
 * - Proper signed net amount convention (Credit > 0 positive, Debit > 0 negative).
 * - Does NOT trigger automatic reconciliation.
 */
export async function syncRazorpaySettlements({ year, month, day, actorId = "system-sync", _customFetch = null } = {}) {
  if (!isRazorpayConfigured() && !_customFetch) {
    throw AppError.badRequest("Razorpay API is not configured. Please set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET.");
  }

  const parsedYear = parseInt(year, 10);
  const parsedMonth = parseInt(month, 10);

  if (isNaN(parsedYear) || parsedYear < 2000 || parsedYear > 2100) {
    throw AppError.badRequest("Invalid year for settlement sync. Must be a 4-digit year.");
  }
  if (isNaN(parsedMonth) || parsedMonth < 1 || parsedMonth > 12) {
    throw AppError.badRequest("Invalid month for settlement sync. Must be between 1 and 12.");
  }

  let parsedDay = null;
  if (day !== undefined && day !== null && day !== "") {
    parsedDay = parseInt(day, 10);
    if (isNaN(parsedDay) || parsedDay < 1 || parsedDay > 31) {
      throw AppError.badRequest("Invalid day for settlement sync. Must be between 1 and 31.");
    }
  }

  validateTestModeSafety();

  const batchId = generateSettlementBatchId();
  const startTime = Date.now();

  // Audit event: RAZORPAY_SYNC_STARTED
  await createAuditEvent({
    actorType: "SYSTEM",
    actorId,
    action: "RAZORPAY_SYNC_STARTED",
    entityType: "SettlementRecord",
    entityId: batchId,
    metadata: {
      syncType: "SETTLEMENTS",
      batchId,
      year: parsedYear,
      month: parsedMonth,
      day: parsedDay
    }
  });

  const queryParams = {
    year: parsedYear,
    month: parsedMonth,
    count: SETTLEMENT_PAGE_SIZE,
    skip: 0
  };
  if (parsedDay) queryParams.day = parsedDay;

  let totalFetched = 0;
  let invalidCount = 0;
  const normalizedRecords = [];

  try {
    let hasMore = true;

    while (hasMore && totalFetched < MAX_RAZORPAY_SETTLEMENT_SYNC_RECORDS) {
      const responseData = await fetchRazorpayApi("/v1/settlements/recon/combined", queryParams, _customFetch);
      
      // Handle array or wrapped object response
      const items = Array.isArray(responseData)
        ? responseData
        : (Array.isArray(responseData?.items) ? responseData.items : []);

      if (items.length === 0) {
        hasMore = false;
        break;
      }

      for (const item of items) {
        try {
          const norm = normalizeRazorpaySettlement(item, batchId);
          normalizedRecords.push(norm);
        } catch (normErr) {
          invalidCount++;
          logger.warn({ err: normErr.message }, "Skipping invalid Razorpay settlement item");
        }
      }

      totalFetched += items.length;

      if (items.length < SETTLEMENT_PAGE_SIZE) {
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
          filter: { settlementRecordId: rec.settlementRecordId },
          update: { $set: rec },
          upsert: true
        }
      }));

      const bulkResult = await SettlementRecord.bulkWrite(bulkOps);
      insertedCount = bulkResult.upsertedCount || 0;
      updatedCount = bulkResult.modifiedCount || (bulkResult.matchedCount - insertedCount) || 0;
    }

    const durationMs = Date.now() - startTime;

    const summary = {
      batchId,
      mode: "test",
      year: parsedYear,
      month: parsedMonth,
      day: parsedDay,
      fetched: totalFetched,
      inserted: insertedCount,
      updated: updatedCount,
      invalid: invalidCount,
      durationMs
    };

    // Audit event: RAZORPAY_SYNC_COMPLETED
    await createAuditEvent({
      actorType: "SYSTEM",
      actorId,
      action: "RAZORPAY_SYNC_COMPLETED",
      entityType: "SettlementRecord",
      entityId: batchId,
      metadata: {
        syncType: "SETTLEMENTS",
        ...summary
      }
    });

    return summary;
  } catch (err) {
    const failureReason = err.message || "Razorpay settlement synchronization failed";

    // Audit event: RAZORPAY_SYNC_FAILED
    await createAuditEvent({
      actorType: "SYSTEM",
      actorId,
      action: "RAZORPAY_SYNC_FAILED",
      entityType: "SettlementRecord",
      entityId: batchId,
      metadata: {
        syncType: "SETTLEMENTS",
        batchId,
        year: parsedYear,
        month: parsedMonth,
        reason: failureReason
      }
    });

    throw err;
  }
}
