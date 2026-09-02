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

/**
 * Creates a single audit log entry.
 */
export async function createAuditEvent({
  actorType = "SYSTEM",
  actorId = "system",
  action,
  entityType,
  entityId,
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

  const auditDoc = await AuditLog.create({
    eventId,
    timestamp: new Date(),
    actorType,
    actorId,
    action,
    entityType,
    entityId,
    runId,
    before: sanitizedBefore,
    after: sanitizedAfter,
    metadata: sanitizedMetadata,
    reason
  });

  return auditDoc;
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

  return await AuditLog.insertMany(auditDocs);
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
  limit = 50
} = {}) {
  const query = {};

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

  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
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
export async function getAuditEventById(eventId) {
  const log = await AuditLog.findOne({ eventId }).lean();
  if (!log) {
    throw AppError.notFound(`Audit log event not found for eventId '${eventId}'`);
  }
  return log;
}
