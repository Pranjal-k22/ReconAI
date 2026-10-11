import { verifyToken, isTokenRevoked, ROLES, IDENTITY_TYPES } from "../services/auth/tokenService.js";
import { getAccountAuthorizationState } from "../services/auth/accountService.js";
import { getServiceAuthorizationState } from "../services/auth/serviceRegistry.js";
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

    // 1. Verify token has not been revoked (checking memory and persistent store)
    if (verified.jti && (await isTokenRevoked(verified.jti))) {
      return next(AppError.unauthorized("Token has been revoked"));
    }

    // 2. Immediate Authorization-Lifetime Validation
    if (verified.identityType === IDENTITY_TYPES.SERVICE) {
      const serviceState = await getServiceAuthorizationState(verified.sub || verified.serviceId);
      if (!serviceState || serviceState.isActive === false) {
        return next(AppError.unauthorized("Service principal has been disabled or unregistered"));
      }

      // Invalidate if credential was rotated since token was issued
      if (
        verified.credentialVersion &&
        serviceState.credentialVersion &&
        verified.credentialVersion < serviceState.credentialVersion
      ) {
        return next(AppError.unauthorized("Service credential has been rotated; re-authentication required"));
      }

      // Synchronize claims with current authoritative server state
      verified.serviceId = serviceState.serviceId;
      verified.role = serviceState.role;
      verified.tenantId = serviceState.tenantId;
      verified.customerId = serviceState.customerId;
      verified.scopes = serviceState.scopes;
    } else {
      const accountState = await getAccountAuthorizationState(verified.sub || verified.userId);
      if (accountState) {
        if (!accountState.isActive) {
          return next(AppError.unauthorized("Account has been disabled"));
        }
        if (
          verified.authVersion &&
          accountState.authVersion &&
          verified.authVersion < accountState.authVersion
        ) {
          return next(AppError.unauthorized("Authorization state has changed; re-authentication required"));
        }
        // Synchronize claims with current authoritative server state
        verified.role = accountState.role;
        verified.tenantId = accountState.tenantId;
        verified.customerId = accountState.customerId;
        verified.scopes = accountState.scopes;
      } else if (process.env.NODE_ENV === "production") {
        return next(AppError.unauthorized("Account does not exist"));
      }
    }

    // 3. AUDITOR is strictly read-only across all endpoints
    if (verified.role === ROLES.AUDITOR && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      return next(AppError.forbidden("Access denied: AUDITOR role is strictly read-only"));
    }

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

    return next(err.isOperational ? err : AppError.unauthorized(err.message || "Invalid or expired credentials"));
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
 * Enforces strict tenant scoping for merchant, auditor, and store identities.
 * Prevents callers from claiming or querying another tenant's records.
 */
export function requireTenantScope(req, res, next) {
  if (!req.user) {
    return next(AppError.unauthorized("Authentication required"));
  }

  // Admins and Payment Controllers have system-wide scope
  if (req.user.role === ROLES.ADMIN || req.user.role === ROLES.PAYMENT_CONTROLLER) {
    req.tenantFilter = req.query.tenantId || req.body.tenantId || null;
    return next();
  }

  // AUDITOR scope enforcement: default to assigned tenantId; global access requires explicit GLOBAL_AUDIT scope
  if (req.user.role === ROLES.AUDITOR) {
    const hasGlobalAudit = Array.isArray(req.user.scopes) && req.user.scopes.includes("GLOBAL_AUDIT");
    if (hasGlobalAudit) {
      // Audit log event for approved global-audit access
      createAuditEvent({
        actorType: req.user.identityType || "HUMAN",
        actorId: req.user.sub,
        action: "GLOBAL_AUDIT_ACCESSED",
        entityType: "TenantResource",
        entityId: req.query.tenantId || req.body.tenantId || "GLOBAL",
        metadata: {
          path: req.path,
          method: req.method,
          scopes: req.user.scopes
        }
      }).catch(() => {});

      req.tenantFilter = req.query.tenantId || req.body.tenantId || null;
      return next();
    }

    // Scoped auditor without GLOBAL_AUDIT must have assigned tenantId
    if (!req.user.tenantId) {
      return next(AppError.forbidden("Access denied: no tenant context bound to auditor identity"));
    }

    const attemptedTenantId = req.params.tenantId || req.query.tenantId || req.body.tenantId;
    if (attemptedTenantId && attemptedTenantId.trim() !== req.user.tenantId) {
      createAuditEvent({
        actorType: req.user.identityType || "HUMAN",
        actorId: req.user.sub,
        action: "ACCESS_DENIED_ALERT",
        entityType: "TenantResource",
        entityId: attemptedTenantId,
        metadata: {
          userTenant: req.user.tenantId,
          attemptedTenantId,
          reason: "AUDITOR_CROSS_TENANT_ACCESS_DENIED"
        }
      }).catch(() => {});

      return next(AppError.forbidden("Access denied: cross-tenant access prohibited for scoped auditor"));
    }

    req.tenantFilter = req.user.tenantId;
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
