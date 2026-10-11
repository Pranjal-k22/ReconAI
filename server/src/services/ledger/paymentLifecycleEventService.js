import crypto from "crypto";
import { PaymentLifecycleEvent } from "../../models/PaymentLifecycleEvent.js";
import { createAuditEvent } from "../audit/auditService.js";
import { AppError } from "../../utils/AppError.js";
import { logger } from "../../config/logger.js";

/**
 * Generates a stable unique Event ID.
 * Example: EVT-20261011-9A2C4E
 */
export function generateEventId() {
  const dateStr = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 8);
  const randStr = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `EVT-${dateStr}-${randStr}`;
}

/**
 * Recursively strips sensitive payment credentials and PII:
 * - Card numbers, PAN, CVV, expiry dates
 * - Passwords, API secrets, auth tokens
 * - Contact numbers, emails, customer VPAs
 */
export function sanitizeLifecyclePayload(payload = {}) {
  if (!payload || typeof payload !== "object") return {};

  const sanitized = Array.isArray(payload) ? [...payload] : { ...payload };

  const forbiddenKeys = new Set([
    "card",
    "card_number",
    "card_id",
    "pan",
    "cvv",
    "cvv2",
    "expiry_month",
    "expiry_year",
    "password",
    "secret",
    "api_key",
    "token",
    "token_id",
    "email",
    "contact",
    "phone",
    "vpa",
    "pin"
  ]);

  for (const [key, val] of Object.entries(sanitized)) {
    if (forbiddenKeys.has(key.toLowerCase())) {
      delete sanitized[key];
    } else if (val && typeof val === "object") {
      sanitized[key] = sanitizeLifecyclePayload(val);
    }
  }

  return sanitized;
}

/**
 * Computes a deterministic SHA-256 hash of a payload object.
 */
export function calculatePayloadFingerprint(payload = {}) {
  // Sort keys deterministically
  const sortedStr = JSON.stringify(payload, Object.keys(payload || {}).sort());
  return crypto.createHash("sha256").update(sortedStr).digest("hex");
}

/**
 * Generates a scoped deduplication key for an event.
 * If sourceEventId is present: ${tenantId}:${sourceSystem}:${sourceEventId}
 * If sourceEventId is missing: ${tenantId}:${sourceSystem}:${normalizedEventType}:${correlationRef}:${fingerprint}
 */
export function generateDeduplicationKey({
  tenantId,
  sourceSystem,
  sourceEventId = null,
  normalizedEventType,
  merchantOrderId = null,
  gatewayPaymentId = null,
  payloadFingerprint
}) {
  if (sourceEventId && String(sourceEventId).trim().length > 0) {
    return `${tenantId}:${sourceSystem}:${String(sourceEventId).trim()}`;
  }

  const correlationRef = merchantOrderId || gatewayPaymentId || "unlinked";
  return `${tenantId}:${sourceSystem}:${normalizedEventType}:${correlationRef}:${payloadFingerprint.substring(0, 16)}`;
}

/**
 * Appends a normalized payment lifecycle event with deterministic deduplication and PII scrubbing.
 * If the event was already recorded, returns { isDuplicate: true, event: existingEvent } without error.
 */
export async function appendLifecycleEvent({
  tenantId,
  caseId = null,
  sourceSystem,
  sourceEventId = null,
  normalizedEventType,
  merchantOrderId = null,
  gatewayPaymentId = null,
  settlementId = null,
  refundId = null,
  amountPaise = null,
  currency = "INR",
  providerOccurredAt = null,
  sourceObservedAt = null,
  rawPayload = {},
  provenance = {},
  actorId = "system-event-ingestor"
} = {}) {
  if (!tenantId || typeof tenantId !== "string" || tenantId.trim().length === 0) {
    throw AppError.badRequest("tenantId is required and must be a non-empty string");
  }

  if (!sourceSystem) {
    throw AppError.badRequest("sourceSystem is required");
  }

  if (!normalizedEventType) {
    throw AppError.badRequest("normalizedEventType is required");
  }

  // 1. Sanitize payload
  const normalizedPayload = sanitizeLifecyclePayload(rawPayload);

  // 2. Compute fingerprint
  const payloadFingerprint = calculatePayloadFingerprint(normalizedPayload);

  // 3. Derive deterministic deduplication key
  const deduplicationKey = generateDeduplicationKey({
    tenantId: tenantId.trim(),
    sourceSystem,
    sourceEventId,
    normalizedEventType,
    merchantOrderId,
    gatewayPaymentId,
    payloadFingerprint
  });

  // 4. Check for existing duplicate event before write
  const existing = await PaymentLifecycleEvent.findOne({ deduplicationKey });
  if (existing) {
    logger.info({ deduplicationKey, eventId: existing.eventId }, "Duplicate PaymentLifecycleEvent acknowledged");
    return { isDuplicate: true, event: existing };
  }

  const eventId = generateEventId();

  try {
    const event = await PaymentLifecycleEvent.create({
      eventId,
      tenantId: tenantId.trim(),
      caseId: caseId ? caseId.trim() : null,
      sourceSystem,
      sourceEventId: sourceEventId ? String(sourceEventId).trim() : null,
      deduplicationKey,
      normalizedEventType,
      merchantOrderId: merchantOrderId ? merchantOrderId.trim() : null,
      gatewayPaymentId: gatewayPaymentId ? gatewayPaymentId.trim() : null,
      settlementId: settlementId ? settlementId.trim() : null,
      refundId: refundId ? refundId.trim() : null,
      amountPaise,
      currency: currency.toUpperCase(),
      providerOccurredAt: providerOccurredAt ? new Date(providerOccurredAt) : null,
      sourceObservedAt: sourceObservedAt ? new Date(sourceObservedAt) : null,
      ingestedAt: new Date(),
      normalizedPayload,
      payloadFingerprint,
      provenance
    });

    // Record audit entry
    await createAuditEvent({
      actorType: "SYSTEM",
      actorId,
      action: "DATA_IMPORTED",
      entityType: "PaymentLifecycleEvent",
      entityId: eventId,
      metadata: {
        tenantId,
        eventId,
        sourceSystem,
        normalizedEventType,
        deduplicationKey
      }
    });

    return { isDuplicate: false, event };
  } catch (err) {
    // Handle concurrent duplicate key race
    if (err.code === 11000) {
      const raceExisting = await PaymentLifecycleEvent.findOne({ deduplicationKey });
      if (raceExisting) {
        return { isDuplicate: true, event: raceExisting };
      }
      throw AppError.conflict(`Duplicate event detected for deduplicationKey '${deduplicationKey}'`);
    }
    throw err;
  }
}

/**
 * Retrieves lifecycle events associated with a case ID.
 */
export async function getEventsByCaseId(caseId, tenantId = null) {
  if (!caseId) {
    throw AppError.badRequest("caseId is required");
  }

  const query = { caseId };
  if (tenantId) query.tenantId = tenantId;

  return await PaymentLifecycleEvent.find(query).sort({ ingestedAt: 1 }).lean();
}

/**
 * Retrieves lifecycle events associated with a gateway payment ID.
 */
export async function getEventsByPaymentId(gatewayPaymentId, tenantId = null) {
  if (!gatewayPaymentId) {
    throw AppError.badRequest("gatewayPaymentId is required");
  }

  const query = { gatewayPaymentId };
  if (tenantId) query.tenantId = tenantId;

  return await PaymentLifecycleEvent.find(query).sort({ ingestedAt: 1 }).lean();
}

/**
 * ARCHITECTURAL INVARIANT:
 * PaymentLifecycleEvent is an append-only evidence ledger.
 * Direct mutation or deletion is strictly forbidden.
 */
export async function updateLifecycleEvent() {
  throw AppError.badRequest("PaymentLifecycleEvent is append-only. Updates are prohibited by architecture invariant.");
}

export async function deleteLifecycleEvent() {
  throw AppError.badRequest("PaymentLifecycleEvent is append-only. Deletions are prohibited by architecture invariant.");
}
