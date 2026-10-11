import { signUserToken, signServiceToken, revokeToken, ROLES } from "../services/auth/tokenService.js";
import { getEnv } from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import { createAuditEvent } from "../services/audit/auditService.js";

/**
 * ReconAI 2.0 - Auth Controller
 */

export async function login(req, res, next) {
  try {
    const { userId, role = ROLES.CUSTOMER, tenantId, customerId, scopes } = req.body;

    if (!userId) {
      throw AppError.badRequest("userId is required");
    }

    // Role cannot be a machine service role via user login
    if ([ROLES.CUSTOMER_AI, ROLES.SHOP_AI, ROLES.PAYMENT_CONTROLLER].includes(role)) {
      throw AppError.badRequest(`Service role '${role}' cannot authenticate via user login endpoint`);
    }

    const token = signUserToken({
      userId,
      role,
      tenantId,
      customerId,
      scopes
    });

    await createAuditEvent({
      actorType: "HUMAN",
      actorId: userId,
      action: "AUTH_LOGIN_SUCCESS",
      entityType: "UserSession",
      entityId: userId,
      metadata: { role, tenantId, customerId }
    }).catch(() => {});

    res.status(200).json({
      success: true,
      data: {
        token,
        user: {
          userId,
          role,
          tenantId: tenantId || null,
          customerId: customerId || null
        }
      }
    });
  } catch (err) {
    next(err);
  }
}

export async function issueServiceToken(req, res, next) {
  try {
    const serviceSecret = req.headers["x-service-secret"];
    const env = getEnv();

    if (!serviceSecret || serviceSecret !== env.SERVICE_TOKEN_SECRET) {
      throw AppError.unauthorized("Invalid or missing service secret");
    }

    const { serviceId, role, tenantId, customerId, scopes, expiresIn } = req.body;

    if (!serviceId) {
      throw AppError.badRequest("serviceId is required");
    }

    const token = signServiceToken({
      serviceId,
      role,
      tenantId,
      customerId,
      scopes,
      expiresIn
    });

    await createAuditEvent({
      actorType: "SERVICE",
      actorId: serviceId,
      action: "AUTH_LOGIN_SUCCESS",
      entityType: "ServicePrincipalSession",
      entityId: serviceId,
      metadata: { role, tenantId, customerId }
    }).catch(() => {});

    res.status(200).json({
      success: true,
      data: {
        token,
        service: {
          serviceId,
          role,
          tenantId: tenantId || null,
          customerId: customerId || null
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
