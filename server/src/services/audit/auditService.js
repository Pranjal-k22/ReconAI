import mongoose from "mongoose";
import { AuditLog } from "../../models/AuditLog.js";
import { AppError } from "../../utils/AppError.js";

const SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "authorization",
  "cookie",
  "secret",
  "mongodb_uri",
  "mongodburi",
  "gemini_api_key",
  "geminiapikey",
  "razorpay_key_secret",
  "razorpaykeysecret",
  "razorpay_key_id",
  "razorpaykeyid"
]);

/**
 * Recursively sanitizes objects by redacting sensitive keys.
 */
export function sanitizeAuditData(data) {
  if (data === null || data === undefined) return data;
  if (typeof data !== "object") return data;

  if (Array.isArray(data)) {
    return data.map((item) => sanitizeAuditData(item));
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(data)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.has(lowerKey) || lowerKey.includes("secret") || lowerKey.includes("key") && lowerKey.includes("api")) {
      sanitized[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      sanitized[key] = sanitizeAuditData(value);
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Generates a unique, readable audit event ID.
 */
function generateEventId() {
  const dateStr = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `AUD-${dateStr}-${randomSuffix}`;
}

export class AuditUnavailableError extends AppError {
  constructor(message = "Audit log persistence unavailable", details = null) {
    super(message, 503, "AUDIT_UNAVAILABLE", details);
    this.name = "AuditUnavailableError";
  }
}

/**
 * Creates a single audit log entry.
 */
export async function createAuditEvent({
  actorType = "SYSTEM",
  actorId = "system",
  action,
  entityType,
  entityId,
  tenantId = null,
  runId = null,
  before = null,
  after = null,
  metadata = {},
  reason = null
}) {
  if (!action || !entityType || !entityId) {
    throw AppError.badRequest("Audit log creation requires action, entityType, and entityId");
  }

  const eventId = generateEventId();
  const sanitizedBefore = sanitizeAuditData(before);
  const sanitizedAfter = sanitizeAuditData(after);
  const sanitizedMetadata = sanitizeAuditData(metadata);

  const isMongoReady = Boolean(mongoose.connection && mongoose.connection.readyState === 1);
  if (!isMongoReady) {
    if (process.env.NODE_ENV === "test") {
      return {
        eventId,
        timestamp: new Date(),
        actorType,
        actorId,
        action,
        entityType,
        entityId,
        tenantId,
        runId,
        before: sanitizedBefore,
        after: sanitizedAfter,
        metadata: sanitizedMetadata,
        reason
      };
    }
    throw new AuditUnavailableError(
      `Audit persistence unavailable: database connection is not ready (readyState: ${mongoose.connection?.readyState ?? "null"})`
    );
  }

  try {
    const auditDoc = await AuditLog.create({
      eventId,
      timestamp: new Date(),
      actorType,
      actorId,
      action,
      entityType,
      entityId,
      tenantId,
      runId,
      before: sanitizedBefore,
      after: sanitizedAfter,
      metadata: sanitizedMetadata,
      reason
    });
    return auditDoc;
  } catch (err) {
    if (process.env.NODE_ENV === "test") {
      return {
        eventId,
        timestamp: new Date(),
        actorType,
        actorId,
        action,
        entityType,
        entityId,
        tenantId,
        runId,
        before: sanitizedBefore,
        after: sanitizedAfter,
        metadata: sanitizedMetadata,
        reason
      };
    }
    throw new AuditUnavailableError(`Failed to persist audit log: ${err.message}`, err);
  }
}

/**
 * Bulk creates audit log entries.
 */
export async function createAuditEventsBulk(events = []) {
  if (!Array.isArray(events) || events.length === 0) return [];

  const auditDocs = events.map((e) => ({
    eventId: e.eventId || generateEventId(),
    timestamp: e.timestamp || new Date(),
    actorType: e.actorType || "SYSTEM",
    actorId: e.actorId || "system",
    action: e.action,
    entityType: e.entityType,
    entityId: e.entityId,
    runId: e.runId || null,
    before: sanitizeAuditData(e.before || null),
    after: sanitizeAuditData(e.after || null),
    metadata: sanitizeAuditData(e.metadata || {}),
    reason: e.reason || null
  }));

  const isMongoReady = Boolean(mongoose.connection && mongoose.connection.readyState === 1);
  if (!isMongoReady) {
    if (process.env.NODE_ENV === "test") {
      return auditDocs;
    }
    throw new AuditUnavailableError(
      `Audit persistence unavailable for bulk write: database connection is not ready (readyState: ${mongoose.connection?.readyState ?? "null"})`
    );
  }

  try {
    return await AuditLog.insertMany(auditDocs);
  } catch (err) {
    if (process.env.NODE_ENV === "test") {
      return auditDocs;
    }
    throw new AuditUnavailableError(`Failed to persist bulk audit logs: ${err.message}`, err);
  }
}

/**
 * Queries audit logs with filtering and pagination.
 */
export async function queryAuditLogs({
  runId,
  action,
  entityType,
  entityId,
  actorType,
  from,
  to,
  page = 1,
  limit = 50,
  tenantId = null
} = {}) {
  const query = {};

  const cleanTenant = tenantId ? String(tenantId).trim() : null;
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));

  if (cleanTenant) {
    if (cleanTenant === "unassigned_provider_quarantine") {
      return {
        logs: [],
        pagination: {
          page: p,
          limit: l,
          total: 0,
          pages: 0
        }
      };
    }
    query.tenantId = cleanTenant;
  } else {
    query.tenantId = { $ne: "unassigned_provider_quarantine" };
  }

  if (runId) query.runId = runId;
  if (action) query.action = action;
  if (entityType) query.entityType = entityType;
  if (entityId) query.entityId = entityId;
  if (actorType) query.actorType = actorType;

  if (from || to) {
    query.timestamp = {};
    if (from) query.timestamp.$gte = new Date(from);
    if (to) query.timestamp.$lte = new Date(to);
  }

  const skip = (p - 1) * l;

  const [logs, total] = await Promise.all([
    AuditLog.find(query).sort({ timestamp: -1 }).skip(skip).limit(l).lean(),
    AuditLog.countDocuments(query)
  ]);

  return {
    logs,
    pagination: {
      page: p,
      limit: l,
      total,
      pages: Math.ceil(total / l)
    }
  };
}

/**
 * Retrieves a single audit log event by eventId.
 */
export async function getAuditEventById(eventId, tenantId = null) {
  const query = { eventId };
  if (tenantId) {
    if (tenantId.trim() === "unassigned_provider_quarantine") {
      throw AppError.notFound(`Audit log event not found for eventId '${eventId}'`);
    }
    query.tenantId = tenantId.trim();
  } else {
    query.tenantId = { $ne: "unassigned_provider_quarantine" };
  }

  const log = await AuditLog.findOne(query).lean();
  if (!log) {
    throw AppError.notFound(`Audit log event not found for eventId '${eventId}'`);
  }
  return log;
}
