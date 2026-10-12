import crypto from "crypto";
import mongoose from "mongoose";
import { getEnv } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { AppError } from "../../utils/AppError.js";
import { PaymentLifecycleEvent } from "../../models/PaymentLifecycleEvent.js";
import { GatewayPayment } from "../../models/GatewayPayment.js";
import { MerchantOrder } from "../../models/MerchantOrder.js";
import { PaymentCase } from "../../models/PaymentCase.js";
import { PaymentMonitoringTask } from "../../models/PaymentMonitoringTask.js";
import { createAuditEvent } from "../audit/auditService.js";
import {
  canTransitionGatewayStatus,
  evaluateCanonicalTransition
} from "../stateMachine/paymentStateMachine.js";
import { schedulePaymentMonitoring } from "../monitoring/paymentMonitoringService.js";
import {
  isValidSignatureFormat,
  razorpayWebhookEnvelopeSchema,
  sanitizeWebhookPayload
} from "../../validators/webhookValidators.js";

export { canTransitionGatewayStatus };

// Non-production in-memory stores for unit testing when MongoDB is offline
const inMemoryEvents = new Map(); // deduplicationKey -> eventDoc
const inMemoryBodyHashes = new Map(); // accountBodyHash -> deduplicationKey
const inMemoryPayments = new Map(); // gatewayPaymentId -> paymentDoc
const inMemoryOrders = new Map(); // merchantOrderId -> orderDoc
const inMemoryCases = new Map(); // caseId -> caseDoc

/**
 * Validates whether a hash string is a non-empty string suitable for replay protection.
 * Prevents treating empty strings, nulls, or blanks as replay keys.
 */
export function isValidReplayHash(hash) {
  return typeof hash === "string" && hash.trim().length > 0;
}

export function resetInMemoryWebhookStore() {
  inMemoryEvents.clear();
  inMemoryBodyHashes.clear();
  inMemoryPayments.clear();
  inMemoryOrders.clear();
  inMemoryCases.clear();
}

export function seedInMemoryOrder(order) {
  inMemoryOrders.set(order.merchantOrderId, { ...order });
}

export function seedInMemoryPayment(payment) {
  inMemoryPayments.set(payment.gatewayPaymentId, { ...payment });
}

export function seedInMemoryCase(kase) {
  inMemoryCases.set(kase.caseId, { ...kase });
}

export function getInMemoryCase(caseId) {
  return inMemoryCases.get(caseId);
}

export function getInMemoryPayment(gatewayPaymentId) {
  return inMemoryPayments.get(gatewayPaymentId);
}

export function getInMemoryOrder(merchantOrderId) {
  return inMemoryOrders.get(merchantOrderId);
}

export function getInMemoryEvents() {
  return Array.from(inMemoryEvents.values());
}

/**
 * Verifies Razorpay webhook HMAC-SHA256 signature using constant-time comparison.
 * Must verify against the exact, unparsed raw bytes.
 */
export function verifyRazorpaySignature(rawBody, signature, secret) {
  if (!secret || typeof secret !== "string" || secret.trim().length === 0) {
    throw AppError.internal("Razorpay webhook secret is not configured: failing closed", 500);
  }

  if (!rawBody || (!Buffer.isBuffer(rawBody) && typeof rawBody !== "string")) {
    return false;
  }

  if (!isValidSignatureFormat(signature)) {
    return false;
  }

  const rawBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8");
  const expectedHex = crypto
    .createHmac("sha256", secret.trim())
    .update(rawBuffer)
    .digest("hex");

  const sigBuffer = Buffer.from(signature.trim(), "hex");
  const expectedBuffer = Buffer.from(expectedHex, "hex");

  if (sigBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(sigBuffer, expectedBuffer);
}

/**
 * Normalizes Razorpay event string to canonical ReconAI lifecycle event type.
 */
export function mapRazorpayEventType(eventString) {
  switch (eventString) {
    case "payment.authorized":
      return "PAYMENT_AUTHORIZED";
    case "payment.captured":
      return "PAYMENT_CAPTURED";
    case "payment.failed":
      return "PAYMENT_FAILED";
    case "order.paid":
      return "ORDER_UPDATED";
    case "refund.created":
    case "refund.processed":
      return "PAYMENT_REFUNDED";
    case "dispute.created":
      return "DISPUTE_CREATED";
    case "dispute.won":
    case "dispute.lost":
      return "DISPUTE_UPDATED";
    default:
      return "WEBHOOK_RECEIVED";
  }
}

/**
 * Normalizes payment status for GatewayPayment model.
 */
export function mapToGatewayPaymentStatus(eventString) {
  switch (eventString) {
    case "payment.authorized":
      return "AUTHORIZED";
    case "payment.captured":
      return "CAPTURED";
    case "payment.failed":
      return "FAILED";
    case "refund.created":
    case "refund.processed":
      return "REFUNDED";
    default:
      return null;
  }
}

/**
 * Ingests and processes a verified Razorpay webhook delivery.
 * Enforces signature validation, durable deduplication, tenant isolation,
 * out-of-order safety, and auditability.
 */
export async function ingestRazorpayWebhook({ rawBody, headers, payload, customSecret = null }) {
  const env = getEnv();
  const secret = customSecret || env.RAZORPAY_WEBHOOK_SECRET || process.env.RAZORPAY_WEBHOOK_SECRET;

  const signatureHeader = headers["x-razorpay-signature"];

  // 1. Signature Verification (Fail-closed on missing secret or invalid signature)
  if (!signatureHeader) {
    await createAuditEvent({
      actorType: "RAZORPAY_ADAPTER",
      actorId: "webhook-ingress",
      action: "WEBHOOK_SIGNATURE_FAILED",
      entityType: "WebhookRequest",
      entityId: "missing_signature",
      metadata: { reason: "Missing X-Razorpay-Signature header" }
    }).catch(() => {});

    throw AppError.unauthorized("Missing X-Razorpay-Signature header");
  }

  const isSigValid = verifyRazorpaySignature(rawBody, signatureHeader, secret);
  if (!isSigValid) {
    await createAuditEvent({
      actorType: "RAZORPAY_ADAPTER",
      actorId: "webhook-ingress",
      action: "WEBHOOK_SIGNATURE_FAILED",
      entityType: "WebhookRequest",
      entityId: "invalid_signature",
      metadata: { reason: "HMAC signature mismatch" }
    }).catch(() => {});

    throw AppError.unauthorized("Invalid webhook signature");
  }

  // 2. Production Datastore Availability Check (Fail Closed)
  const isMongoConnected = Boolean(mongoose.connection && mongoose.connection.readyState === 1);
  if (!isMongoConnected && process.env.NODE_ENV === "production") {
    throw AppError.internal("Webhook datastore unavailable in production: failing closed", 503);
  }

  // 3. Envelope & Schema Validation
  const parseResult = razorpayWebhookEnvelopeSchema.safeParse(payload);
  if (!parseResult.success) {
    await createAuditEvent({
      actorType: "RAZORPAY_ADAPTER",
      actorId: "webhook-ingress",
      action: "WEBHOOK_QUARANTINED",
      entityType: "WebhookRequest",
      entityId: "malformed_envelope",
      metadata: { errors: parseResult.error.errors }
    }).catch(() => {});

    throw AppError.badRequest("Malformed webhook payload envelope");
  }

  const eventEnvelope = parseResult.data;
  const eventName = eventEnvelope.event;
  const normalizedEventType = mapRazorpayEventType(eventName);

  // 4. Extract Identifiers and Entity Payload
  const rawBuffer = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody, "utf8");
  const payloadFingerprint = crypto.createHash("sha256").update(rawBuffer).digest("hex");

  const paymentEntity =
    eventEnvelope.payload?.payment?.entity ||
    eventEnvelope.payload?.order?.entity ||
    eventEnvelope.payload?.refund?.entity ||
    {};

  const gatewayPaymentId = paymentEntity.id || eventEnvelope.payload?.payment?.entity?.id || null;
  const merchantOrderId = paymentEntity.order_id || eventEnvelope.payload?.order?.entity?.id || null;
  const providerOccurredAt = eventEnvelope.created_at
    ? new Date(eventEnvelope.created_at * 1000)
    : paymentEntity.created_at
    ? new Date(paymentEntity.created_at * 1000)
    : null;

  const amountPaise = typeof paymentEntity.amount === "number" ? paymentEntity.amount : null;
  const currency = (paymentEntity.currency || "INR").toUpperCase();

  // 5. Durable Idempotency & Raw Body Hash Derivation
  const headerEventId = headers["x-razorpay-event-id"] ? headers["x-razorpay-event-id"].trim() : null;
  const accountId = (eventEnvelope.account_id || "").trim() || "default";

  // Raw body SHA-256 fingerprint scoped to the provider account
  const accountBodyHash =
    payloadFingerprint && typeof payloadFingerprint === "string" && payloadFingerprint.trim().length > 0
      ? `RAZORPAY_BODY:${accountId}:${payloadFingerprint.trim()}`
      : undefined;

  let deduplicationKey = "";
  let sourceEventId = "";

  if (headerEventId) {
    deduplicationKey = `RAZORPAY:${accountId}:${headerEventId}`;
    sourceEventId = headerEventId;
  } else {
    // Documented stable fallback: provider + account + body SHA-256 hash
    deduplicationKey = `RAZORPAY_FALLBACK:${accountId}:${payloadFingerprint}`;
    sourceEventId = `fallback_${payloadFingerprint.substring(0, 16)}`;
  }

  // 6. Tenant Resolution & Cross-Tenant Safety
  const notesTenant =
    paymentEntity.notes?.tenantId ||
    paymentEntity.notes?.tenant_id ||
    eventEnvelope.payload?.order?.entity?.notes?.tenantId ||
    null;

  let resolvedTenantId = null;
  let matchingOrder = null;
  let matchingPayment = null;

  if (isMongoConnected) {
    if (merchantOrderId) {
      matchingOrder = await MerchantOrder.findOne({ merchantOrderId }).lean();
    }
    if (gatewayPaymentId) {
      matchingPayment = await GatewayPayment.findOne({ gatewayPaymentId }).lean();
    }
  } else {
    if (merchantOrderId) {
      matchingOrder = inMemoryOrders.get(merchantOrderId) || null;
    }
    if (gatewayPaymentId) {
      matchingPayment = inMemoryPayments.get(gatewayPaymentId) || null;
    }
  }

  // Cross-tenant injection detection
  if (notesTenant && matchingOrder?.tenantId && notesTenant !== matchingOrder.tenantId) {
    // Cross-tenant mismatch detected! Quarantine and alert
    await createAuditEvent({
      actorType: "RAZORPAY_ADAPTER",
      actorId: "webhook-ingress",
      action: "ACCESS_DENIED_ALERT",
      entityType: "WebhookEvent",
      entityId: deduplicationKey,
      metadata: {
        reason: "CROSS_TENANT_ID_MISMATCH",
        claimedTenant: notesTenant,
        orderTenant: matchingOrder.tenantId,
        merchantOrderId
      }
    }).catch(() => {});

    const quarantinedEventDoc = {
      eventId: `evt_wh_${crypto.randomUUID()}`,
      tenantId: notesTenant,
      sourceSystem: "GATEWAY_WEBHOOK",
      sourceEventId,
      deduplicationKey,
      accountBodyHash,
      normalizedEventType: "WEBHOOK_RECEIVED",
      merchantOrderId,
      gatewayPaymentId,
      amountPaise,
      currency,
      providerOccurredAt,
      sourceObservedAt: providerOccurredAt,
      ingestedAt: new Date(),
      normalizedPayload: sanitizeWebhookPayload(eventEnvelope.payload),
      payloadFingerprint,
      provenance: {
        provider: "RAZORPAY",
        status: "QUARANTINED_CROSS_TENANT_MISMATCH",
        claimedTenant: notesTenant,
        orderTenant: matchingOrder.tenantId
      }
    };

    if (isMongoConnected) {
      await PaymentLifecycleEvent.create(quarantinedEventDoc).catch(() => {});
    } else {
      inMemoryEvents.set(deduplicationKey, quarantinedEventDoc);
      if (isValidReplayHash(accountBodyHash)) {
        inMemoryBodyHashes.set(accountBodyHash.trim(), deduplicationKey);
      }
    }

    return {
      success: true,
      status: "QUARANTINED",
      reason: "CROSS_TENANT_MISMATCH",
      eventId: quarantinedEventDoc.eventId
    };
  }

  // Resolve authoritative tenant
  if (notesTenant) {
    resolvedTenantId = notesTenant;
  } else if (matchingOrder?.tenantId) {
    resolvedTenantId = matchingOrder.tenantId;
  } else if (matchingPayment?.tenantId) {
    resolvedTenantId = matchingPayment.tenantId;
  } else {
    resolvedTenantId = "unassigned_provider_quarantine";
  }

  const isUnmatchedTenant = resolvedTenantId === "unassigned_provider_quarantine";
  const isUnsupportedEventType = normalizedEventType === "WEBHOOK_RECEIVED";

  let processingOutcome = "ACCEPTED";
  if (isUnsupportedEventType) {
    processingOutcome = "QUARANTINED_UNSUPPORTED_EVENT_TYPE";
  } else if (isUnmatchedTenant) {
    processingOutcome = "QUARANTINED_UNRESOLVED_TENANT";
  }

  // 7. Durable Deduplication & Anomaly Detection (Event-ID + Raw Body Hash)
  if (isMongoConnected) {
    // Check A: Has this exact event ID been ingested?
    const existingByEventId = await PaymentLifecycleEvent.findOne({ deduplicationKey }).lean();
    if (existingByEventId) {
      // Security Anomaly Check: Same event ID + different signed body
      if (existingByEventId.payloadFingerprint !== payloadFingerprint) {
        await createAuditEvent({
          actorType: "RAZORPAY_ADAPTER",
          actorId: "webhook-ingress",
          action: "WEBHOOK_QUARANTINED",
          entityType: "WebhookEvent",
          entityId: deduplicationKey,
          metadata: {
            reason: "EVENT_ID_PAYLOAD_MISMATCH",
            existingFingerprint: existingByEventId.payloadFingerprint,
            newFingerprint: payloadFingerprint,
            sourceEventId
          }
        }).catch(() => {});

        return {
          success: true,
          status: "QUARANTINED",
          reason: "EVENT_ID_PAYLOAD_MISMATCH",
          eventId: existingByEventId.eventId
        };
      }

      // Legitimate identical retry: duplicate acknowledged
      await createAuditEvent({
        actorType: "RAZORPAY_ADAPTER",
        actorId: "webhook-ingress",
        action: "WEBHOOK_DUPLICATE_SKIPPED",
        entityType: "PaymentLifecycleEvent",
        entityId: existingByEventId.eventId,
        metadata: { deduplicationKey, sourceEventId }
      }).catch(() => {});

      return {
        success: true,
        status: "DUPLICATE_ACKNOWLEDGED",
        isDuplicate: true,
        eventId: existingByEventId.eventId
      };
    }

    // Check B: Has this exact raw body hash already been processed for this provider account?
    // (Protects against replays with modified/different event-ID headers)
    if (isValidReplayHash(accountBodyHash)) {
      const existingByBody = await PaymentLifecycleEvent.findOne({
        accountBodyHash: accountBodyHash.trim()
      }).lean();
      if (existingByBody) {
        await createAuditEvent({
          actorType: "RAZORPAY_ADAPTER",
          actorId: "webhook-ingress",
          action: "WEBHOOK_DUPLICATE_SKIPPED",
          entityType: "PaymentLifecycleEvent",
          entityId: existingByBody.eventId,
          metadata: {
            reason: "RAW_BODY_REPLAY_DIFFERENT_EVENT_ID",
            originalEventId: existingByBody.sourceEventId,
            replayEventId: sourceEventId,
            accountBodyHash
          }
        }).catch(() => {});

        return {
          success: true,
          status: "DUPLICATE_ACKNOWLEDGED",
          isDuplicate: true,
          eventId: existingByBody.eventId
        };
      }
    }
  } else {
    // In-memory offline checks
    if (inMemoryEvents.has(deduplicationKey)) {
      const existing = inMemoryEvents.get(deduplicationKey);
      if (existing.payloadFingerprint !== payloadFingerprint) {
        await createAuditEvent({
          actorType: "RAZORPAY_ADAPTER",
          actorId: "webhook-ingress",
          action: "WEBHOOK_QUARANTINED",
          entityType: "WebhookEvent",
          entityId: deduplicationKey,
          metadata: {
            reason: "EVENT_ID_PAYLOAD_MISMATCH",
            existingFingerprint: existing.payloadFingerprint,
            newFingerprint: payloadFingerprint,
            sourceEventId
          }
        }).catch(() => {});

        return {
          success: true,
          status: "QUARANTINED",
          reason: "EVENT_ID_PAYLOAD_MISMATCH",
          eventId: existing.eventId
        };
      }

      await createAuditEvent({
        actorType: "RAZORPAY_ADAPTER",
        actorId: "webhook-ingress",
        action: "WEBHOOK_DUPLICATE_SKIPPED",
        entityType: "PaymentLifecycleEvent",
        entityId: existing.eventId,
        metadata: { deduplicationKey, sourceEventId }
      }).catch(() => {});

      return {
        success: true,
        status: "DUPLICATE_ACKNOWLEDGED",
        isDuplicate: true,
        eventId: existing.eventId
      };
    }

    if (isValidReplayHash(accountBodyHash) && inMemoryBodyHashes.has(accountBodyHash.trim())) {
      const existingKey = inMemoryBodyHashes.get(accountBodyHash.trim());
      const existing = inMemoryEvents.get(existingKey);
      await createAuditEvent({
        actorType: "RAZORPAY_ADAPTER",
        actorId: "webhook-ingress",
        action: "WEBHOOK_DUPLICATE_SKIPPED",
        entityType: "PaymentLifecycleEvent",
        entityId: existing?.eventId || "unknown",
        metadata: {
          reason: "RAW_BODY_REPLAY_DIFFERENT_EVENT_ID",
          originalEventId: existing?.sourceEventId,
          replayEventId: sourceEventId,
          accountBodyHash
        }
      }).catch(() => {});

      return {
        success: true,
        status: "DUPLICATE_ACKNOWLEDGED",
        isDuplicate: true,
        eventId: existing?.eventId || null
      };
    }
  }

  // 8. Durable Event Creation
  const isOrderCancelled = Boolean(matchingOrder && matchingOrder.status === "CANCELLED");
  const newPaymentStatus = mapToGatewayPaymentStatus(eventName);
  const isLateCaptureAfterFailure = Boolean(
    matchingPayment && matchingPayment.status === "FAILED" && newPaymentStatus === "CAPTURED"
  );

  const conflictFlag = isOrderCancelled
    ? "CANCELLED_ORDER_CAPTURED"
    : isLateCaptureAfterFailure
    ? "LATE_CAPTURE_AFTER_FAILURE"
    : null;

  const eventDoc = {
    eventId: `evt_wh_${crypto.randomUUID()}`,
    tenantId: resolvedTenantId,
    sourceSystem: "GATEWAY_WEBHOOK",
    sourceEventId,
    deduplicationKey,
    accountBodyHash,
    normalizedEventType,
    merchantOrderId,
    gatewayPaymentId,
    amountPaise,
    currency,
    providerOccurredAt,
    sourceObservedAt: providerOccurredAt,
    ingestedAt: new Date(),
    normalizedPayload: sanitizeWebhookPayload(eventEnvelope.payload),
    payloadFingerprint,
    schemaVersion: "1.0.0",
    provenance: {
      provider: "RAZORPAY",
      accountId,
      deliveryAttempt: headers["x-razorpay-delivery-attempt"] || 1,
      signatureVerified: true,
      hasHeaderEventId: !!headerEventId,
      processingStatus: processingOutcome,
      conflictFlag
    }
  };

  let lifecycleEvent = null;
  if (isMongoConnected) {
    try {
      lifecycleEvent = await PaymentLifecycleEvent.create(eventDoc);
    } catch (err) {
      if (err.code === 11000 || (err.message && err.message.includes("E11000"))) {
        const queryOr = [{ deduplicationKey }];
        if (isValidReplayHash(accountBodyHash)) {
          queryOr.push({ accountBodyHash: accountBodyHash.trim() });
        }
        const existing = await PaymentLifecycleEvent.findOne({
          $or: queryOr
        }).lean();

        if (existing && existing.payloadFingerprint !== payloadFingerprint) {
          await createAuditEvent({
            actorType: "RAZORPAY_ADAPTER",
            actorId: "webhook-ingress",
            action: "WEBHOOK_QUARANTINED",
            entityType: "WebhookEvent",
            entityId: deduplicationKey,
            metadata: {
              reason: "EVENT_ID_PAYLOAD_MISMATCH",
              existingFingerprint: existing.payloadFingerprint,
              newFingerprint: payloadFingerprint,
              sourceEventId
            }
          }).catch(() => {});

          return {
            success: true,
            status: "QUARANTINED",
            reason: "EVENT_ID_PAYLOAD_MISMATCH",
            eventId: existing.eventId
          };
        }

        await createAuditEvent({
          actorType: "RAZORPAY_ADAPTER",
          actorId: "webhook-ingress",
          action: "WEBHOOK_DUPLICATE_SKIPPED",
          entityType: "PaymentLifecycleEvent",
          entityId: existing?.eventId || deduplicationKey,
          metadata: { deduplicationKey, sourceEventId, accountBodyHash }
        }).catch(() => {});

        return {
          success: true,
          status: "DUPLICATE_ACKNOWLEDGED",
          isDuplicate: true,
          eventId: existing?.eventId || null
        };
      }
      throw err;
    }
  } else {
    inMemoryEvents.set(deduplicationKey, eventDoc);
    if (isValidReplayHash(accountBodyHash)) {
      inMemoryBodyHashes.set(accountBodyHash.trim(), deduplicationKey);
    }
    lifecycleEvent = eventDoc;
  }

  // 9. Canonical State Progression & Out-of-Order Safety
  if (!isUnmatchedTenant && !isUnsupportedEventType) {
    if (gatewayPaymentId && newPaymentStatus) {
      if (matchingPayment) {
        const canTransition = canTransitionGatewayStatus(matchingPayment.status, newPaymentStatus);

        if (canTransition) {
          const updateFields = {
            status: newPaymentStatus,
            rawData: sanitizeWebhookPayload(paymentEntity)
          };
          if (isLateCaptureAfterFailure) {
            updateFields.isLateCapture = true;
            updateFields.previousStatus = "FAILED";
          }

          if (isMongoConnected) {
            await GatewayPayment.updateOne(
              { gatewayPaymentId },
              { $set: updateFields }
            );
          } else {
            Object.assign(matchingPayment, updateFields);
          }
        } else {
          logger.warn(
            {
              gatewayPaymentId,
              currentStatus: matchingPayment.status,
              attemptedStatus: newPaymentStatus,
              eventName
            },
            "Out-of-order webhook delivery: state regression prevented"
          );
        }
      } else {
        const newPaymentDoc = {
          gatewayPaymentId,
          tenantId: resolvedTenantId,
          merchantOrderId,
          amountPaise: amountPaise || 0,
          currency,
          status: newPaymentStatus,
          method: (paymentEntity.method || "UPI").toUpperCase(),
          source: "RAZORPAY",
          gatewayCreatedAt: providerOccurredAt || new Date(),
          rawData: sanitizeWebhookPayload(paymentEntity)
        };
        if (isMongoConnected) {
          await GatewayPayment.create(newPaymentDoc).catch(() => {});
        } else {
          inMemoryPayments.set(gatewayPaymentId, newPaymentDoc);
        }
      }

      // Settle active monitoring tasks upon receiving authoritative provider webhook
      if (gatewayPaymentId && (newPaymentStatus === "CAPTURED" || newPaymentStatus === "FAILED" || newPaymentStatus === "REFUNDED")) {
        if (isMongoConnected) {
          await PaymentMonitoringTask.updateMany(
            { gatewayPaymentId, status: { $in: ["PENDING", "IN_PROGRESS"] } },
            { $set: { status: "COMPLETED", lockedUntil: null, lastObservedStatus: newPaymentStatus, outcomeReason: "WEBHOOK_EVENT_ARRIVED" } }
          ).catch(() => {});
        }
      } else if (gatewayPaymentId && !isUnmatchedTenant && (newPaymentStatus === "CREATED" || newPaymentStatus === "AUTHORIZED" || newPaymentStatus === "PENDING")) {
        // Enqueue/update monitoring task for eligible pending/authorized payments
        await schedulePaymentMonitoring({
          tenantId: resolvedTenantId,
          gatewayPaymentId,
          merchantOrderId,
          initialDelaySeconds: 60
        }).catch((err) => {
          logger.warn({ err: err.message, gatewayPaymentId }, "Failed to auto-schedule payment monitoring from webhook");
        });
      }
    }

    // Update orthogonal dimensions in PaymentCase without regressing terminal states or reversing cancellations
    if (gatewayPaymentId || merchantOrderId) {
      if (isMongoConnected) {
        const caseConditions = [];
        if (gatewayPaymentId) caseConditions.push({ gatewayPaymentId });
        if (merchantOrderId) caseConditions.push({ merchantOrderId });
        const caseQuery = { tenantId: resolvedTenantId, $or: caseConditions };

        const existingCase = await PaymentCase.findOne(caseQuery);
        if (existingCase) {
          let caseModified = false;
          if (gatewayPaymentId && !existingCase.gatewayPaymentId) {
            existingCase.gatewayPaymentId = gatewayPaymentId;
            caseModified = true;
          }

          if (eventName === "payment.captured") {
            existingCase.captureStatus = "CAPTURE_CAPTURED";
            if (amountPaise) existingCase.actualAmountPaise = amountPaise;
            caseModified = true;

            if (isOrderCancelled) {
              // Conflicting evidence: Capture on cancelled order! Flag for safe handling
              existingCase.discrepancyCategory = "CANCELLED_ORDER_CAPTURED";
              existingCase.safeHoldCode = "LATE_CAPTURE_CANCELLED_ORDER";
              existingCase.resolutionCaseStatus = "CASE_SAFE_HOLD";
              existingCase.orderStatus = "ORDER_CANCELLED";
            } else if (isLateCaptureAfterFailure) {
              // Conflicting evidence: Late capture after failure! Flag for safe handling
              existingCase.discrepancyCategory = "STATUS_MISMATCH";
              existingCase.safeHoldCode = "ADMIN_HOLD";
              existingCase.resolutionCaseStatus = "CASE_SAFE_HOLD";
            }
          } else if (eventName === "payment.authorized") {
            if (existingCase.captureStatus !== "CAPTURE_CAPTURED") {
              existingCase.authorizationStatus = "AUTH_AUTHORIZED";
              caseModified = true;
            }
          } else if (eventName === "payment.failed") {
            if (existingCase.captureStatus !== "CAPTURE_CAPTURED") {
              existingCase.captureStatus = "CAPTURE_FAILED";
              caseModified = true;
            } else {
              logger.warn(
                { gatewayPaymentId, caseId: existingCase.caseId },
                "Out-of-order payment.failed ignored for previously captured case"
              );
            }
          }

          if (caseModified) {
            await existingCase.save();
          }
        }
      } else {
        // In-memory case update
        for (const [cId, kase] of inMemoryCases.entries()) {
          if (
            (gatewayPaymentId && kase.gatewayPaymentId === gatewayPaymentId) ||
            (merchantOrderId && kase.merchantOrderId === merchantOrderId)
          ) {
            if (kase.tenantId === resolvedTenantId) {
              if (eventName === "payment.captured") {
                kase.captureStatus = "CAPTURE_CAPTURED";
                if (amountPaise) kase.actualAmountPaise = amountPaise;

                if (isOrderCancelled) {
                  kase.discrepancyCategory = "CANCELLED_ORDER_CAPTURED";
                  kase.safeHoldCode = "LATE_CAPTURE_CANCELLED_ORDER";
                  kase.resolutionCaseStatus = "CASE_SAFE_HOLD";
                  kase.orderStatus = "ORDER_CANCELLED";
                } else if (isLateCaptureAfterFailure) {
                  kase.discrepancyCategory = "STATUS_MISMATCH";
                  kase.safeHoldCode = "ADMIN_HOLD";
                  kase.resolutionCaseStatus = "CASE_SAFE_HOLD";
                }
              } else if (eventName === "payment.authorized") {
                if (kase.captureStatus !== "CAPTURE_CAPTURED") {
                  kase.authorizationStatus = "AUTH_AUTHORIZED";
                }
              } else if (eventName === "payment.failed") {
                if (kase.captureStatus !== "CAPTURE_CAPTURED") {
                  kase.captureStatus = "CAPTURE_FAILED";
                }
              }
            }
          }
        }
      }
    }
  }

  // 10. Audit Event Logging
  await createAuditEvent({
    actorType: "RAZORPAY_ADAPTER",
    actorId: "webhook-ingress",
    action: isUnmatchedTenant || isUnsupportedEventType ? "WEBHOOK_QUARANTINED" : "WEBHOOK_INGESTED",
    entityType: "PaymentLifecycleEvent",
    entityId: lifecycleEvent.eventId,
    metadata: {
      eventName,
      normalizedEventType,
      deduplicationKey,
      accountBodyHash,
      tenantId: resolvedTenantId,
      gatewayPaymentId,
      merchantOrderId,
      processingOutcome,
      conflictFlag
    }
  }).catch(() => {});

  return {
    success: true,
    status: processingOutcome,
    isDuplicate: false,
    conflictFlag,
    eventId: lifecycleEvent.eventId
  };
}
