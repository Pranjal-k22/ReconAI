import { signUserToken, signServiceToken, revokeToken, ROLES } from "../services/auth/tokenService.js";
import { authenticateUserCredentials } from "../services/auth/accountService.js";
import { authenticateServiceCredential } from "../services/auth/serviceRegistry.js";
import { getEnv } from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import { createAuditEvent } from "../services/audit/auditService.js";

/**
 * ReconAI 2.0 - Auth Controller
 *
 * Enforces verifiable credential provenance for human users
 * and fixed, immutable server-side identity bindings for machine services.
 */

export async function login(req, res, next) {
  try {
    const { identifier, userId, email, password } = req.body;
    const userIdentifier = identifier || userId || email;

    // Role cannot be a machine service role via user login
    if (req.body.role && [ROLES.CUSTOMER_AI, ROLES.SHOP_AI, ROLES.PAYMENT_CONTROLLER].includes(req.body.role)) {
      throw AppError.badRequest(`Service role '${req.body.role}' cannot authenticate via user login endpoint`);
    }

    if (!userIdentifier || !password) {
      throw AppError.badRequest("Account identifier and password are required");
    }

    // Authenticate credentials against verified account store (scrypt hash + timingSafeEqual)
    const verifiedAccount = await authenticateUserCredentials({
      identifier: userIdentifier,
      password
    });

    if (!verifiedAccount) {
      // Record failed authentication alert without leaking whether user exists
      createAuditEvent({
        actorType: "SYSTEM",
        actorId: "auth-gateway",
        action: "AUTH_LOGIN_FAILED",
        entityType: "UserAccount",
        entityId: "unknown",
        metadata: { identifier: userIdentifier, ip: req.ip }
      }).catch(() => {});

      throw AppError.unauthorized("Invalid credentials");
    }

    // Token claims are derived strictly from the verified account store—never untrusted body claims
    const token = signUserToken({
      userId: verifiedAccount.userId,
      role: verifiedAccount.role,
      tenantId: verifiedAccount.tenantId,
      customerId: verifiedAccount.customerId,
      scopes: verifiedAccount.scopes,
      authVersion: verifiedAccount.authVersion || 1
    });

    createAuditEvent({
      actorType: "HUMAN",
      actorId: verifiedAccount.userId,
      action: "AUTH_LOGIN_SUCCESS",
      entityType: "UserSession",
      entityId: verifiedAccount.userId,
      metadata: {
        role: verifiedAccount.role,
        tenantId: verifiedAccount.tenantId,
        customerId: verifiedAccount.customerId
      }
    }).catch(() => {});

    res.status(200).json({
      success: true,
      data: {
        token,
        user: {
          userId: verifiedAccount.userId,
          email: verifiedAccount.email,
          role: verifiedAccount.role,
          tenantId: verifiedAccount.tenantId,
          customerId: verifiedAccount.customerId,
          scopes: verifiedAccount.scopes
        }
      }
    });
  } catch (err) {
    next(err);
  }
}

export async function issueServiceToken(req, res, next) {
  try {
    const serviceId = req.headers["x-service-id"] || req.body.serviceId;
    const clientSecret = req.headers["x-service-secret"] || req.body.clientSecret || req.body.serviceSecret;

    if (!serviceId || !clientSecret) {
      throw AppError.unauthorized("serviceId and service secret are required");
    }

    // Verify machine credential against server-side service identity registry (timingSafeEqual)
    const serviceProfile = await authenticateServiceCredential({
      serviceId,
      clientSecret
    });

    if (!serviceProfile) {
      createAuditEvent({
        actorType: "SYSTEM",
        actorId: "service-gateway",
        action: "AUTH_LOGIN_FAILED",
        entityType: "ServicePrincipalSession",
        entityId: serviceId,
        metadata: { serviceId, ip: req.ip, reason: "INVALID_SERVICE_CREDENTIAL" }
      }).catch(() => {});

      throw AppError.unauthorized("Invalid service credentials");
    }

    // Reject callers attempting to request arbitrary roles or cross-tenant scopes
    if (req.body.role && req.body.role !== serviceProfile.role) {
      throw AppError.forbidden("Cross-service role elevation prohibited");
    }
    if (req.body.tenantId && req.body.tenantId !== serviceProfile.tenantId) {
      throw AppError.forbidden("Cross-tenant service scope injection prohibited");
    }

    // Claims are derived strictly from the fixed server-side service profile
    const token = signServiceToken({
      serviceId: serviceProfile.serviceId,
      role: serviceProfile.role,
      tenantId: serviceProfile.tenantId,
      customerId: serviceProfile.customerId,
      scopes: serviceProfile.scopes,
      credentialVersion: serviceProfile.credentialVersion || 1,
      expiresIn: req.body.expiresIn || "15m"
    });

    createAuditEvent({
      actorType: "SERVICE",
      actorId: serviceProfile.serviceId,
      action: "AUTH_LOGIN_SUCCESS",
      entityType: "ServicePrincipalSession",
      entityId: serviceProfile.serviceId,
      metadata: {
        role: serviceProfile.role,
        tenantId: serviceProfile.tenantId,
        customerId: serviceProfile.customerId
      }
    }).catch(() => {});

    res.status(200).json({
      success: true,
      data: {
        token,
        service: {
          serviceId: serviceProfile.serviceId,
          role: serviceProfile.role,
          tenantId: serviceProfile.tenantId,
          customerId: serviceProfile.customerId,
          scopes: serviceProfile.scopes,
          credentialVersion: serviceProfile.credentialVersion || 1
        }
      }
    });
  } catch (err) {
    next(err);
  }
}

export function getCurrentUser(req, res) {
  res.status(200).json({
    success: true,
    data: {
      user: req.user
    }
  });
}

export function logout(req, res) {
  if (req.user && req.user.jti) {
    revokeToken(req.user.jti);

    createAuditEvent({
      actorType: req.user.identityType || "HUMAN",
      actorId: req.user.sub,
      action: "TOKEN_REVOKED",
      entityType: "UserSession",
      entityId: req.user.jti,
      metadata: { role: req.user.role }
    }).catch(() => {});
  }
  res.status(200).json({
    success: true,
    data: {
      message: "Session logged out and token revoked successfully"
    }
  });
}
