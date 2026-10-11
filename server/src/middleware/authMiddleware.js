import { verifyToken, ROLES, IDENTITY_TYPES } from "../services/auth/tokenService.js";
import { AppError } from "../utils/AppError.js";
import { logger } from "../config/logger.js";
import { createAuditEvent } from "../services/audit/auditService.js";

/**
 * ReconAI 2.0 - Authentication & RBAC Middleware
 *
 * Enforces verified identities, deny-by-default role authorization,
 * service boundaries, and row-level tenant scoping.
 */

/**
 * Authenticates request principal from Bearer JWT or x-service-token.
 */
export async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  const serviceHeader = req.headers["x-service-token"];

  const rawToken = authHeader || serviceHeader;

  if (!rawToken || typeof rawToken !== "string") {
    return next(AppError.unauthorized("Authentication required. Missing token."));
  }

  try {
    const verified = verifyToken(rawToken);
    req.user = verified;
    next();
  } catch (err) {
    // Log security failure without leaking token
    logger.warn(
      { ip: req.ip, path: req.path, error: err.message },
      "Authentication failed on protected route"
    );

    // Record audit event for auth failure
    createAuditEvent({
      actorType: "SYSTEM",
      actorId: "security-guard",
      action: "CONTROLLER_SAFETY_GATE_EVALUATED",
      entityType: "AuthPrincipal",
      entityId: "unknown",
      metadata: {
        path: req.path,
        method: req.method,
        ip: req.ip,
        reason: err.message
      }
    }).catch(() => {});

    return next(AppError.unauthorized(err.message || "Invalid or expired credentials"));
  }
}

/**
 * Authorizes request based on explicit role allowlist (Deny-by-default).
 */
export function requireRoles(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(AppError.unauthorized("Authentication required"));
    }

    if (!allowedRoles.includes(req.user.role)) {
      logger.warn(
        {
          userId: req.user.sub,
          role: req.user.role,
          allowedRoles,
          path: req.path
        },
        "Role authorization denied"
      );

      // Record access denial alert
      createAuditEvent({
        actorType: req.user.identityType || "HUMAN",
        actorId: req.user.sub,
        action: "ACCESS_DENIED_ALERT",
        entityType: "RouteAccess",
        entityId: req.path,
        metadata: {
          role: req.user.role,
          allowedRoles,
          tenantId: req.user.tenantId,
          path: req.path
        }
      }).catch(() => {});

      return next(AppError.forbidden("Access denied: insufficient role privileges"));
    }

    next();
  };
}

/**
 * Enforces identity type (HUMAN vs SERVICE).
 */
export function requireIdentityType(expectedType) {
  return (req, res, next) => {
    if (!req.user || req.user.identityType !== expectedType) {
      return next(
        AppError.forbidden(`Access denied: requires ${expectedType} identity`)
      );
    }
    next();
  };
}

/**
 * Enforces strict tenant scoping for merchant and store identities.
 * Prevents callers from claiming or querying another tenant's records.
 */
export function requireTenantScope(req, res, next) {
  if (!req.user) {
    return next(AppError.unauthorized("Authentication required"));
  }

  // Admins and Auditors have system-wide scope, can optionally filter by query
  if (req.user.role === ROLES.ADMIN || req.user.role === ROLES.AUDITOR || req.user.role === ROLES.PAYMENT_CONTROLLER) {
    req.tenantFilter = req.query.tenantId || req.body.tenantId || null;
    return next();
  }

  // For SHOP and SHOP_AI: must have assigned tenantId
  if (!req.user.tenantId) {
    return next(AppError.forbidden("Access denied: no tenant context bound to user identity"));
  }

  // Check if caller attempted to inject a different tenantId in query or body
  const attemptedTenantId = req.params.tenantId || req.query.tenantId || req.body.tenantId;
  if (attemptedTenantId && attemptedTenantId.trim() !== req.user.tenantId) {
    logger.warn(
      {
        userId: req.user.sub,
        userTenant: req.user.tenantId,
        attemptedTenantId
      },
      "Cross-tenant access attempt blocked"
    );

    createAuditEvent({
      actorType: req.user.identityType || "HUMAN",
      actorId: req.user.sub,
      action: "ACCESS_DENIED_ALERT",
      entityType: "TenantResource",
      entityId: attemptedTenantId,
      metadata: {
        userTenant: req.user.tenantId,
        attemptedTenantId,
        reason: "CROSS_TENANT_ID_MISMATCH"
      }
    }).catch(() => {});

    return next(AppError.forbidden("Access denied: cross-tenant access prohibited"));
  }

  req.tenantFilter = req.user.tenantId;
  next();
}

/**
 * Enforces strict customer ownership scoping.
 */
export function requireCustomerScope(req, res, next) {
  if (!req.user) {
    return next(AppError.unauthorized("Authentication required"));
  }

  // Admins and Payment Controllers have cross-customer review scope
  if (req.user.role === ROLES.ADMIN || req.user.role === ROLES.PAYMENT_CONTROLLER) {
    req.customerFilter = req.query.customerId || req.body.customerId || null;
    return next();
  }

  if (!req.user.customerId) {
    return next(AppError.forbidden("Access denied: no customer context bound to identity"));
  }

  const attemptedCustomerId = req.params.customerId || req.query.customerId || req.body.customerId;
  if (attemptedCustomerId && attemptedCustomerId.trim() !== req.user.customerId) {
    return next(AppError.forbidden("Access denied: cross-customer access prohibited"));
  }

  req.customerFilter = req.user.customerId;
  next();
}
