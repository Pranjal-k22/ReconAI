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
    case "refund.failed":
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
    case "refund.failed":
      return "CAPTURED";
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
  const hasProviderOccurredAt = typeof eventEnvelope.created_at === "number" || typeof paymentEntity.created_at === "number";
  const providerOccurredAt = eventEnvelope.created_at
    ? new Date(eventEnvelope.created_at * 1000)
    : paymentEntity.created_at
    ? new Date(paymentEntity.created_at * 1000)
    : null;

  const isMissingProviderEventAt = !hasProviderOccurredAt;
  const providerEventAt = providerOccurredAt || new Date();

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

  // 6. Durable Deduplication & Anomaly Detection (Event-ID + Raw Body Hash)
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

  // 7. Tenant Resolution & Cross-Tenant Safety (Server-Side Mapping Only per Item b)
  const notesTenant =
    paymentEntity.notes?.tenantId ||
    paymentEntity.notes?.tenant_id ||
    eventEnvelope.payload?.order?.entity?.notes?.tenantId ||
    null;

  let matchingOrder = null;
  let matchingPayment = null;
  let serverTenantId = null;
  let hasTenantCollision = false;

  if (isMongoConnected) {
    if (merchantOrderId) {
      const orders = await MerchantOrder.find({ merchantOrderId }).lean();
      const distinctOrderTenants = [...new Set(orders.map((o) => o.tenantId).filter(Boolean))];
      if (distinctOrderTenants.length > 1) {
        hasTenantCollision = true;
      } else if (orders.length > 0) {
        matchingOrder = orders[0];
      }
    }
    if (gatewayPaymentId) {
      matchingPayment = await GatewayPayment.findOne({ gatewayPaymentId }).lean();
    }
  } else {
    if (merchantOrderId) {
      const memOrder = inMemoryOrders.get(merchantOrderId) || null;
      if (Array.isArray(memOrder)) {
        const distinctOrderTenants = [...new Set(memOrder.map((o) => o.tenantId).filter(Boolean))];
        if (distinctOrderTenants.length > 1) {
          hasTenantCollision = true;
          matchingOrder = null;
        } else {
          matchingOrder = memOrder[0] || null;
        }
      } else {
        matchingOrder = memOrder;
      }
    }
    if (gatewayPaymentId) {
      matchingPayment = inMemoryPayments.get(gatewayPaymentId) || null;
    }
  }

  // Cross-record collision between payment tenant and order tenant
  if (matchingPayment?.tenantId && matchingOrder?.tenantId && matchingPayment.tenantId !== matchingOrder.tenantId) {
    hasTenantCollision = true;
  }

  if (!hasTenantCollision) {
    if (matchingPayment?.tenantId) {
      serverTenantId = matchingPayment.tenantId;
    } else if (matchingOrder?.tenantId) {
      serverTenantId = matchingOrder.tenantId;
    }
  }

  // Check 0: Unsupported event types
  if (normalizedEventType === "WEBHOOK_RECEIVED") {
    const quarantinedEventDoc = {
      eventId: `evt_wh_${crypto.randomUUID()}`,
      tenantId: "unassigned_provider_quarantine",
      sourceSystem: "GATEWAY_WEBHOOK",
      sourceEventId,
      deduplicationKey,
      accountBodyHash,
      normalizedEventType: "WEBHOOK_RECEIVED",
      merchantOrderId,
      gatewayPaymentId,
      amountPaise,
      currency,
      providerEventAt,
      providerOccurredAt,
      sourceObservedAt: providerOccurredAt,
      ingestedAt: new Date(),
      normalizedPayload: sanitizeWebhookPayload(eventEnvelope.payload),
      payloadFingerprint,
      provenance: {
        provider: "RAZORPAY",
        status: "QUARANTINED_UNSUPPORTED_EVENT_TYPE",
        processingStatus: "QUARANTINED_UNSUPPORTED_EVENT_TYPE",
        reason: "UNSUPPORTED_EVENT_TYPE",
        eventName
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
      status: "QUARANTINED_UNSUPPORTED_EVENT_TYPE",
      reason: "UNSUPPORTED_EVENT_TYPE",
      eventId: quarantinedEventDoc.eventId
    };
  }

  // Check 1: If NO server mapping exists (or colliding references) -> quarantine as UNMAPPED_TENANT
  if (!serverTenantId) {
    await createAuditEvent({
      actorType: "RAZORPAY_ADAPTER",
      actorId: "webhook-ingress",
      action: "WEBHOOK_QUARANTINED",
      entityType: "WebhookEvent",
      entityId: deduplicationKey,
      metadata: {
        reason: hasTenantCollision ? "COLLIDING_ORDER_REFERENCES" : "UNMAPPED_TENANT",
        claimedTenant: notesTenant,
        merchantOrderId,
        gatewayPaymentId,
        fallbackProviderEventAt: isMissingProviderEventAt
      }
    }).catch(() => {});

    const quarantinedEventDoc = {
      eventId: `evt_wh_${crypto.randomUUID()}`,
      tenantId: "unassigned_provider_quarantine",
      sourceSystem: "GATEWAY_WEBHOOK",
      sourceEventId,
      deduplicationKey,
      accountBodyHash,
      normalizedEventType: "WEBHOOK_RECEIVED",
      merchantOrderId,
      gatewayPaymentId,
      amountPaise,
      currency,
      providerEventAt,
      providerOccurredAt,
      sourceObservedAt: providerOccurredAt,
      ingestedAt: new Date(),
      normalizedPayload: sanitizeWebhookPayload(eventEnvelope.payload),
      payloadFingerprint,
      provenance: {
        provider: "RAZORPAY",
        status: "QUARANTINED_UNMAPPED_TENANT",
        processingStatus: "QUARANTINED_UNRESOLVED_TENANT",
        claimedTenant: notesTenant,
        reason: hasTenantCollision ? "COLLIDING_ORDER_REFERENCES" : "UNMAPPED_TENANT"
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
      status: "QUARANTINED_UNRESOLVED_TENANT",
      reason: hasTenantCollision ? "COLLIDING_ORDER_REFERENCES" : "UNMAPPED_TENANT",
      eventId: quarantinedEventDoc.eventId
    };
  }

  // Check 2: If notes disagree with server mapping -> cross-tenant quarantine + ACCESS_DENIED audit
  if (notesTenant && notesTenant !== serverTenantId) {
    await createAuditEvent({
      actorType: "RAZORPAY_ADAPTER",
      actorId: "webhook-ingress",
      action: "ACCESS_DENIED_ALERT",
      entityType: "WebhookEvent",
      entityId: deduplicationKey,
      metadata: {
        reason: "CROSS_TENANT_ID_MISMATCH",
        claimedTenant: notesTenant,
        serverTenant: serverTenantId,
        merchantOrderId,
        gatewayPaymentId,
        fallbackProviderEventAt: isMissingProviderEventAt
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
      providerEventAt,
      providerOccurredAt,
      sourceObservedAt: providerOccurredAt,
      ingestedAt: new Date(),
      normalizedPayload: sanitizeWebhookPayload(eventEnvelope.payload),
      payloadFingerprint,
      provenance: {
        provider: "RAZORPAY",
        status: "QUARANTINED_CROSS_TENANT_MISMATCH",
        claimedTenant: notesTenant,
        serverTenant: serverTenantId
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

  // Authoritative tenant is ALWAYS and ONLY serverTenantId
  const resolvedTenantId = serverTenantId;
  const isUnmatchedTenant = false;
  const isUnsupportedEventType = normalizedEventType === "WEBHOOK_RECEIVED";

  let processingOutcome = "ACCEPTED";
  if (isUnsupportedEventType) {
    processingOutcome = "QUARANTINED_UNSUPPORTED_EVENT_TYPE";
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
    providerEventAt,
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
    const isRefundEvent = eventName.startsWith("refund.");
    const newRefundStatus = isRefundEvent
      ? (paymentEntity.status ? paymentEntity.status.toLowerCase() : (
          eventName === "refund.created" ? "created" :
          eventName === "refund.processed" ? "processed" :
          eventName === "refund.failed" ? "failed" :
          eventName === "refund.pending" ? "pending" : "created"
        ))
      : null;

    // A. Timestamp & Rank Ordering Invariants (Item d)
    if (matchingPayment) {
      // 1. Refund Ordering Rules
      if (isRefundEvent && matchingPayment.refundStatus) {
        const curRefund = matchingPayment.refundStatus.toLowerCase();
        const nextRefund = newRefundStatus ? newRefundStatus.toLowerCase() : "";

        // Terminal check: processed and failed are terminal and never overwrite each other
        if (curRefund === "processed" || curRefund === "failed") {
          await createAuditEvent({
            actorType: "RAZORPAY_ADAPTER",
            actorId: "webhook-ingress",
            action: "STALE_EVENT_DROPPED",
            entityType: "PaymentLifecycleEvent",
            entityId: deduplicationKey,
            metadata: {
              reason: "REFUND_TERMINAL_IMMUTABLE",
              currentRefundStatus: curRefund,
              attemptedRefundStatus: nextRefund,
              providerEventAt,
              fallbackProviderEventAt: isMissingProviderEventAt
            }
          });

          return {
            success: true,
            status: "STALE_EVENT_DROPPED",
            reason: "REFUND_TERMINAL_IMMUTABLE",
            eventId: lifecycleEvent.eventId
          };
        }

        const REFUND_STATUS_RANK = { created: 1, pending: 2, processed: 3, failed: 3 };
        const curRank = REFUND_STATUS_RANK[curRefund] || 0;
        const nextRank = REFUND_STATUS_RANK[nextRefund] || 0;

        if (nextRank < curRank) {
          await createAuditEvent({
            actorType: "RAZORPAY_ADAPTER",
            actorId: "webhook-ingress",
            action: "STALE_EVENT_DROPPED",
            entityType: "PaymentLifecycleEvent",
            entityId: deduplicationKey,
            metadata: {
              reason: "REFUND_LOWER_RANK_DROPPED",
              currentRefundStatus: curRefund,
              attemptedRefundStatus: nextRefund,
              providerEventAt,
              fallbackProviderEventAt: isMissingProviderEventAt
            }
          });

          return {
            success: true,
            status: "STALE_EVENT_DROPPED",
            reason: "REFUND_LOWER_RANK_DROPPED",
            eventId: lifecycleEvent.eventId
          };
        }

        if (nextRank === curRank) {
          if (matchingPayment.lastProviderEventAt && providerEventAt <= new Date(matchingPayment.lastProviderEventAt)) {
            await createAuditEvent({
              actorType: "RAZORPAY_ADAPTER",
              actorId: "webhook-ingress",
              action: "STALE_EVENT_DROPPED",
              entityType: "PaymentLifecycleEvent",
              entityId: deduplicationKey,
              metadata: {
                reason: "REFUND_SAME_RANK_STALE_OR_EQUAL",
                currentRefundStatus: curRefund,
                attemptedRefundStatus: nextRefund,
                providerEventAt,
                lastProviderEventAt: matchingPayment.lastProviderEventAt,
                fallbackProviderEventAt: isMissingProviderEventAt
              }
            });

            return {
              success: true,
              status: "STALE_EVENT_DROPPED",
              reason: "REFUND_SAME_RANK_STALE_OR_EQUAL",
              eventId: lifecycleEvent.eventId
            };
          }
        }
      }

      // 2. Same-Rank Payment Status Ordering
      if (!isRefundEvent && matchingPayment.status === newPaymentStatus) {
        if (matchingPayment.lastProviderEventAt && providerEventAt <= new Date(matchingPayment.lastProviderEventAt)) {
          await createAuditEvent({
            actorType: "RAZORPAY_ADAPTER",
            actorId: "webhook-ingress",
            action: "STALE_EVENT_DROPPED",
            entityType: "PaymentLifecycleEvent",
            entityId: deduplicationKey,
            metadata: {
              reason: "PAYMENT_SAME_RANK_STALE_OR_EQUAL",
              currentStatus: matchingPayment.status,
              attemptedStatus: newPaymentStatus,
              providerEventAt,
              lastProviderEventAt: matchingPayment.lastProviderEventAt,
              fallbackProviderEventAt: isMissingProviderEventAt
            }
          });

          return {
            success: true,
            status: "STALE_EVENT_DROPPED",
            reason: "PAYMENT_SAME_RANK_STALE_OR_EQUAL",
            eventId: lifecycleEvent.eventId
          };
        }
      }
    }

    // B. Apply Gateway Payment Updates
    if (gatewayPaymentId && newPaymentStatus) {
      if (matchingPayment) {
        const canTransition = isRefundEvent || canTransitionGatewayStatus(matchingPayment.status, newPaymentStatus);

        if (canTransition) {
          const updateFields = {
            status: newPaymentStatus,
            lastProviderEventAt: providerEventAt,
            rawData: sanitizeWebhookPayload(paymentEntity)
          };
          if (newRefundStatus) {
            updateFields.refundStatus = newRefundStatus;
          }
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
          lastProviderEventAt: providerEventAt,
          refundStatus: newRefundStatus || null,
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

    // C. Evidence-Backed Order Mutation & Safe-Hold Application (Item g & i)
    let safeHoldApplied = false;
    let appliedSafeHoldCode = null;
    let appliedSafeHoldReason = null;

    if (eventName === "payment.captured" || eventName === "order.paid") {
      let capturedAmountEvidence = null;
      if (typeof paymentEntity.amount_captured === "number") {
        capturedAmountEvidence = paymentEntity.amount_captured;
      } else if (typeof eventEnvelope.payload?.order?.entity?.amount_paid === "number") {
        capturedAmountEvidence = eventEnvelope.payload.order.entity.amount_paid;
      }

      if (isOrderCancelled) {
        safeHoldApplied = true;
        appliedSafeHoldCode = "LATE_CAPTURE_CANCELLED_ORDER";
        appliedSafeHoldReason = "Late capture received for cancelled order. Awaiting operator review.";
      } else if (isLateCaptureAfterFailure) {
        safeHoldApplied = true;
        appliedSafeHoldCode = "LATE_CAPTURE_AFTER_FAILURE";
        appliedSafeHoldReason = "Conflicting late capture arrived after payment failure was recorded.";
        if (matchingOrder) {
          const paymentCurr = currency;
          const orderCurr = (matchingOrder.currency || "INR").toUpperCase();
          if (capturedAmountEvidence === matchingOrder.amountPaise && paymentCurr === orderCurr) {
            if (isMongoConnected) {
              await MerchantOrder.updateOne(
                { merchantOrderId: matchingOrder.merchantOrderId, tenantId: resolvedTenantId },
                { $set: { status: "PAID" } }
              );
            } else {
              matchingOrder.status = "PAID";
            }
          }
        }
      } else if (matchingOrder) {
        const paymentCurr = currency;
        const orderCurr = (matchingOrder.currency || "INR").toUpperCase();

        if (capturedAmountEvidence === null || capturedAmountEvidence === undefined) {
          safeHoldApplied = true;
          appliedSafeHoldCode = "INSUFFICIENT_EVIDENCE";
          appliedSafeHoldReason = "Payment captured amount evidence is missing; order cannot be marked PAID.";
        } else if (capturedAmountEvidence !== matchingOrder.amountPaise || paymentCurr !== orderCurr) {
          safeHoldApplied = true;
          appliedSafeHoldCode = "AMOUNT_CURRENCY_MISMATCH";
          appliedSafeHoldReason = `Captured amount (${capturedAmountEvidence}) or currency (${paymentCurr}) does not match order amount (${matchingOrder.amountPaise}) or currency (${orderCurr}).`;
        } else {
          // Exact match: mutate order to PAID
          if (isMongoConnected) {
            await MerchantOrder.updateOne(
              { merchantOrderId: matchingOrder.merchantOrderId, tenantId: resolvedTenantId },
              { $set: { status: "PAID" } }
            );
          } else {
            matchingOrder.status = "PAID";
          }
        }
      }
    }

    // D. Update orthogonal dimensions in PaymentCase
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

          if (eventName === "payment.captured" || eventName === "order.paid") {
            existingCase.captureStatus = "CAPTURE_CAPTURED";
            if (amountPaise) existingCase.actualAmountPaise = amountPaise;
            caseModified = true;

            if (safeHoldApplied) {
              existingCase.resolutionCaseStatus = "CASE_SAFE_HOLD";
              existingCase.safeHoldCode = appliedSafeHoldCode;
              existingCase.discrepancyCategory = appliedSafeHoldCode === "LATE_CAPTURE_CANCELLED_ORDER"
                ? "CANCELLED_ORDER_CAPTURED"
                : appliedSafeHoldCode === "LATE_CAPTURE_AFTER_FAILURE"
                ? "STATUS_MISMATCH"
                : "AMOUNT_CURRENCY_MISMATCH";
              if (isOrderCancelled) {
                existingCase.orderStatus = "ORDER_CANCELLED";
              } else if (!isLateCaptureAfterFailure) {
                // Not mutated to PAID, preserve current
              } else {
                existingCase.orderStatus = "ORDER_PAID";
              }
            } else {
              existingCase.orderStatus = "ORDER_PAID";
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

          if (safeHoldApplied) {
            await createAuditEvent({
              actorType: "RAZORPAY_ADAPTER",
              actorId: "webhook-ingress",
              action: "SAFE_HOLD_APPLIED",
              tenantId: resolvedTenantId,
              entityType: "PaymentCase",
              entityId: existingCase.caseId,
              metadata: {
                gatewayPaymentId,
                caseId: existingCase.caseId,
                safeHoldCode: appliedSafeHoldCode,
                reason: appliedSafeHoldReason
              }
            });
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
              if (eventName === "payment.captured" || eventName === "order.paid") {
                kase.captureStatus = "CAPTURE_CAPTURED";
                if (amountPaise) kase.actualAmountPaise = amountPaise;

                if (safeHoldApplied) {
                  kase.resolutionCaseStatus = "CASE_SAFE_HOLD";
                  kase.safeHoldCode = appliedSafeHoldCode;
                  kase.discrepancyCategory = appliedSafeHoldCode === "LATE_CAPTURE_CANCELLED_ORDER"
                    ? "CANCELLED_ORDER_CAPTURED"
                    : appliedSafeHoldCode === "LATE_CAPTURE_AFTER_FAILURE"
                    ? "STATUS_MISMATCH"
                    : "AMOUNT_CURRENCY_MISMATCH";
                  if (isOrderCancelled) {
                    kase.orderStatus = "ORDER_CANCELLED";
                  } else if (!isLateCaptureAfterFailure) {
                    // Not mutated to PAID
                  } else {
                    kase.orderStatus = "ORDER_PAID";
                  }
                } else {
                  kase.orderStatus = "ORDER_PAID";
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

  // 10. Audit Event Logging (Fail closed per Item a: unhandled errors propagate to return 5xx)
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
      conflictFlag,
      fallbackProviderEventAt: isMissingProviderEventAt
    }
  });

  return {
    success: true,
    status: processingOutcome,
    isDuplicate: false,
    conflictFlag,
    eventId: lifecycleEvent.eventId
  };
}
