import { asyncHandler } from "../utils/asyncHandler.js";
import * as auditService from "../services/audit/auditService.js";

/**
 * GET /api/audit
 * Queries audit logs with filtering and pagination.
 */
export const queryAuditLogs = asyncHandler(async (req, res) => {
  const { runId, action, entityType, entityId, actorType, from, to, page, limit } = req.query;

  const data = await auditService.queryAuditLogs({
    runId,
    action,
    entityType,
    entityId,
    actorType,
    from,
    to,
    page,
    limit
  });

  res.status(200).json({
    success: true,
    data
  });
});

/**
 * GET /api/audit/:eventId
 * Retrieves a single audit log event by eventId.
 */
export const getAuditEvent = asyncHandler(async (req, res) => {
  const { eventId } = req.params;
  const log = await auditService.getAuditEventById(eventId);

  res.status(200).json({
    success: true,
    data: log
  });
});
