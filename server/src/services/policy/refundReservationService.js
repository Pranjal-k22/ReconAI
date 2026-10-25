import crypto from "crypto";
import { GatewayPayment } from "../../models/GatewayPayment.js";
import { RefundReservation } from "../../models/RefundReservation.js";
import { createAuditEvent } from "../audit/auditService.js";
import { logger } from "../../config/logger.js";

/**
 * ReconAI 2.0 - Atomic Refund Reservation Service (Gate B4)
 *
 * Implements atomic conditional balance reservation on GatewayPayment to prevent
 * concurrent dispatches from exceeding the refundable balance.
 */

/**
 * Reserves refundable amount before sending to provider.
 * Guaranteed atomic via single conditional findOneAndUpdate on GatewayPayment.
 * Same idempotency key produces the same reservation and is never counted twice.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.gatewayPaymentId
 * @param {number} params.amountPaise
 * @param {string} params.idempotencyKey
 * @param {number} [params.ttlSeconds=300]
 * @returns {Promise<{ success: boolean, reservation?: Object, reason?: string }>}
 */
export async function reserveRefund({
  tenantId,
  gatewayPaymentId,
  amountPaise,
  idempotencyKey,
  ttlSeconds = 300
}) {
  if (!tenantId || !gatewayPaymentId || !idempotencyKey) {
    return { success: false, reason: "Missing required reservation parameters" };
  }
  if (typeof amountPaise !== "number" || amountPaise <= 0 || !Number.isSafeInteger(amountPaise)) {
    return { success: false, reason: "amountPaise must be a positive safe integer" };
  }

  const cleanTenant = String(tenantId).trim();
  const cleanPaymentId = String(gatewayPaymentId).trim();
  const cleanKey = String(idempotencyKey).trim();

  // 1. Check for existing reservation under the same idempotency key
  const existingReservation = await RefundReservation.findOne({
    tenantId: cleanTenant,
    idempotencyKey: cleanKey
  }).lean();

  if (existingReservation) {
    if (existingReservation.status === "RESERVED") {
      return {
        success: true,
        isExisting: true,
        reservation: existingReservation
      };
    }
    if (existingReservation.status === "CONVERTED") {
      return {
        success: false,
        reason: "RESERVATION_ALREADY_CONVERTED",
        reservation: existingReservation
      };
    }
    // If RELEASED, a retry can re-reserve
  }

  // 2. Single atomic conditional update on GatewayPayment
  const updatedPayment = await GatewayPayment.findOneAndUpdate(
    {
      tenantId: cleanTenant,
      gatewayPaymentId: cleanPaymentId,
      $expr: {
        $gte: [
          {
            $subtract: [
              { $subtract: [{ $ifNull: ["$capturedAmountPaise", "$amountPaise"] }, { $ifNull: ["$refundAmountPaise", 0] }] },
              { $ifNull: ["$reservedRefundPaise", 0] }
            ]
          },
          amountPaise
        ]
      }
    },
    {
      $inc: { reservedRefundPaise: amountPaise }
    },
    { new: true }
  ).lean();

  if (!updatedPayment) {
    logger.warn(
      { tenantId: cleanTenant, gatewayPaymentId: cleanPaymentId, amountPaise },
      "Atomic refund reservation rejected: insufficient refundable balance"
    );
    return {
      success: false,
      reason: "INSUFFICIENT_REFUNDABLE_BALANCE"
    };
  }

  // 3. Create or update durable RefundReservation record
  const reservationId = `RES-${crypto.randomUUID()}`;
  const expiresAt = new Date(Date.now() + (ttlSeconds || 300) * 1000);

  let reservation;
  try {
    reservation = await RefundReservation.findOneAndUpdate(
      { tenantId: cleanTenant, idempotencyKey: cleanKey },
      {
        $set: {
          reservationId,
          tenantId: cleanTenant,
          gatewayPaymentId: cleanPaymentId,
          idempotencyKey: cleanKey,
          amountPaise,
          status: "RESERVED",
          expiresAt,
          releaseReason: null
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    ).lean();
  } catch (err) {
    // If unique constraint collided, rollback the atomic increment
    await GatewayPayment.updateOne(
      { tenantId: cleanTenant, gatewayPaymentId: cleanPaymentId },
      { $inc: { reservedRefundPaise: -amountPaise } }
    ).catch(() => {});
    throw err;
  }

  // 4. Emit audit log: REFUND_RESERVED
  await createAuditEvent({
    actorType: "SYSTEM",
    actorId: "refund-reservation-service",
    action: "REFUND_RESERVED",
    tenantId: cleanTenant,
    entityType: "RefundReservation",
    entityId: reservation.reservationId,
    metadata: {
      reservationId: reservation.reservationId,
      gatewayPaymentId: cleanPaymentId,
      amountPaise,
      idempotencyKey: cleanKey,
      expiresAt: expiresAt.toISOString()
    }
  });

  return {
    success: true,
    isExisting: false,
    reservation,
    payment: updatedPayment
  };
}

/**
 * Releases a reserved refund balance back to the payment.
 * Called on rejection, VERIFIED_FAILED, or expiry.
 * Strictly idempotent: subsequent calls with same key are safe no-ops.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.gatewayPaymentId
 * @param {string} params.idempotencyKey
 * @param {string} [params.reason=null]
 * @returns {Promise<{ success: boolean, alreadyReleased?: boolean }>}
 */
export async function releaseRefundReservation({
  tenantId,
  gatewayPaymentId,
  idempotencyKey,
  reason = null
}) {
  const cleanTenant = String(tenantId).trim();
  const cleanKey = String(idempotencyKey).trim();
  const cleanPaymentId = String(gatewayPaymentId).trim();

  const reservation = await RefundReservation.findOne({
    tenantId: cleanTenant,
    idempotencyKey: cleanKey
  });

  if (!reservation || reservation.status !== "RESERVED") {
    return { success: true, alreadyReleased: true };
  }

  reservation.status = "RELEASED";
  reservation.releaseReason = reason;
  await reservation.save();

  // Atomically decrement reservedRefundPaise on GatewayPayment
  await GatewayPayment.updateOne(
    { tenantId: cleanTenant, gatewayPaymentId: cleanPaymentId },
    { $inc: { reservedRefundPaise: -reservation.amountPaise } }
  );

  // Emit audit log: REFUND_RESERVATION_RELEASED
  await createAuditEvent({
    actorType: "SYSTEM",
    actorId: "refund-reservation-service",
    action: "REFUND_RESERVATION_RELEASED",
    tenantId: cleanTenant,
    entityType: "RefundReservation",
    entityId: reservation.reservationId,
    metadata: {
      reservationId: reservation.reservationId,
      gatewayPaymentId: cleanPaymentId,
      amountPaise: reservation.amountPaise,
      idempotencyKey: cleanKey,
      reason
    }
  }).catch(() => {});

  return { success: true, alreadyReleased: false };
}

/**
 * Converts a reserved refund to permanent refunded balance on VERIFIED_SUCCEEDED.
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.gatewayPaymentId
 * @param {string} params.idempotencyKey
 * @returns {Promise<{ success: boolean, alreadyConverted?: boolean }>}
 */
export async function convertRefundReservation({
  tenantId,
  gatewayPaymentId,
  idempotencyKey
}) {
  const cleanTenant = String(tenantId).trim();
  const cleanKey = String(idempotencyKey).trim();
  const cleanPaymentId = String(gatewayPaymentId).trim();

  const reservation = await RefundReservation.findOne({
    tenantId: cleanTenant,
    idempotencyKey: cleanKey
  });

  if (!reservation || reservation.status !== "RESERVED") {
    return { success: true, alreadyConverted: true };
  }

  reservation.status = "CONVERTED";
  await reservation.save();

  // Atomically convert reserved to refunded
  await GatewayPayment.updateOne(
    { tenantId: cleanTenant, gatewayPaymentId: cleanPaymentId },
    {
      $inc: {
        reservedRefundPaise: -reservation.amountPaise,
        refundAmountPaise: reservation.amountPaise
      }
    }
  );

  return { success: true, alreadyConverted: false };
}
