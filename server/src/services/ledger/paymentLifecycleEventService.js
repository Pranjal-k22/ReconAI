import crypto from "crypto";
import { PaymentLifecycleEvent } from "../../models/PaymentLifecycleEvent.js";
import { createAuditEvent } from "../audit/auditService.js";
import { AppError } from "../../utils/AppError.js";
import { logger } from "../../config/logger.js";
import {
  SUPPORTED_CURRENCIES,
  isValidCurrency,
  isNonNegativeSafeInteger
} from "../../models/helpers/validators.js";

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
 * Strict Allowlist of normalized evidence attributes for payment lifecycle events.
 * Ambiguous generic 'amount' is explicitly removed; only unambiguous integer 'amountPaise'
 * is accepted. Arbitrary customer PII (e.g. customerName, billingAddress, email,
 * phone, notes, card tokens, raw provider bodies) is strictly dropped.
 */
export const ALLOWED_EVIDENCE_FIELDS = new Set([
  // Core provider and merchant references (max 128 chars)
  "merchantOrderId",
  "gatewayPaymentId",
  "sourceEventId",
  "settlementId",
  "refundId",
  "disputeId",
  "arn",
  "rrn",
  "upiTxnId",
  "bankTransactionId",
  "orderRef",
  "paymentId",

  // Normalized transaction metrics & status (unambiguous integer paise)
  "amountPaise",
  "currency",
  "status",
  "paymentMethod",
  "method",
  "bank",
  "wallet",
  "issuer",
  "authCode",
  "errorCode",
  "errorDescription",
  "discrepancyReason",

  // Normalized timestamps (ISO string or epoch ms)
  "occurredAt",
  "authorizedAt",
  "capturedAt",
  "settledAt",
  "refundedAt",
  "disputedAt"
]);

/**
 * Sanitizes and minimizes evidence payload against the strict allowlist.
 * Enforces type validation, reasonable length limits, and integer minor units.
 * Guarantees that unknown keys, unfamiliar customer aliases (e.g. customerName,
 * billingAddress, customNotes), and sensitive credentials cannot be persisted.
 */
export function sanitizeLifecyclePayload(payload = {}) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return {};

  const sanitized = {};

  for (const [key, val] of Object.entries(payload)) {
    // Only accept keys explicitly registered in ALLOWED_EVIDENCE_FIELDS
    if (!ALLOWED_EVIDENCE_FIELDS.has(key)) {
      continue;
    }

    if (val === null || val === undefined) {
      continue;
    }

    // Unambiguous monetary amount in integer paise
    if (key === "amountPaise") {
      if (isNonNegativeSafeInteger(val)) {
        sanitized.amountPaise = val;
      }
      continue;
    }

    // Currency must match supported code
    if (key === "currency") {
      if (typeof val === "string" && isValidCurrency(val)) {
        sanitized.currency = val;
      }
      continue;
    }

    // String attributes with reasonable length limits
    if (typeof val === "string") {
      const trimmed = val.trim();
      if (key === "errorDescription") {
        sanitized[key] = trimmed.slice(0, 256);
      } else {
        sanitized[key] = trimmed.slice(0, 128);
      }
      continue;
    }

    // Boolean or numeric codes
    if (typeof val === "boolean") {
      sanitized[key] = val;
      continue;
    }

    // Timestamps
    if (val instanceof Date) {
      sanitized[key] = val.toISOString();
      continue;
    }
  }

  return sanitized;
}

/**
 * Sanitizes provenance audit data to ensure no PII or raw provider payloads are stored.
 */
export function sanitizeProvenance(provenance = {}) {
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) return {};

  const allowedProvenanceKeys = new Set(["ingressChannel", "sourceIp", "userAgent", "workerId", "receivedAt"]);
  const clean = {};

  for (const [key, val] of Object.entries(provenance)) {
    if (allowedProvenanceKeys.has(key) && typeof val === "string") {
      clean[key] = val.slice(0, 128).trim();
    }
  }

  return clean;
}

/**
 * Computes a deterministic SHA-256 hash of a normalized payload object.
 */
export function calculatePayloadFingerprint(payload = {}) {
  // Sort keys deterministically
  const keys = Object.keys(payload || {}).sort();
  const sortedObj = {};
  for (const k of keys) {
    sortedObj[k] = payload[k];
  }
  const sortedStr = JSON.stringify(sortedObj);
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
 * Appends a normalized payment lifecycle event with deterministic deduplication and payload minimization.
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

  // Strict currency validation
  if (typeof currency !== "string" || !isValidCurrency(currency)) {
    throw AppError.badRequest(`Invalid or unsupported currency '${currency}'. Supported: ${SUPPORTED_CURRENCIES.join(", ")}`);
  }

  // 1. Sanitize & minimize payload using strict allowlist (rawPayload is never persisted)
  const normalizedPayload = sanitizeLifecyclePayload(rawPayload);

  // 2. Sanitize provenance
  const cleanProvenance = sanitizeProvenance(provenance);

  // 3. Compute deterministic fingerprint on final validated data
  const payloadFingerprint = calculatePayloadFingerprint(normalizedPayload);

  // 4. Derive deterministic deduplication key
  const deduplicationKey = generateDeduplicationKey({
    tenantId: tenantId.trim(),
    sourceSystem,
    sourceEventId,
    normalizedEventType,
    merchantOrderId,
    gatewayPaymentId,
    payloadFingerprint
  });

  // 5. Check for existing duplicate event before write
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
      currency,
      providerOccurredAt: providerOccurredAt ? new Date(providerOccurredAt) : null,
      sourceObservedAt: sourceObservedAt ? new Date(sourceObservedAt) : null,
      ingestedAt: new Date(),
      normalizedPayload,
      payloadFingerprint,
      provenance: cleanProvenance
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
