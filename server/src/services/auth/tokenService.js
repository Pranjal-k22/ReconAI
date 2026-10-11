import jwt from "jsonwebtoken";
import crypto from "crypto";
import mongoose from "mongoose";
import { getEnv } from "../../config/env.js";
import { AppError } from "../../utils/AppError.js";
import { RevokedToken } from "../../models/RevokedToken.js";

/**
 * ReconAI 2.0 - Token & Identity Service
 *
 * Provides cryptographic token generation, verification, algorithm enforcement,
 * and durable persistent token revocation for Human and Machine/Service identities.
 */

export const ROLES = Object.freeze({
  CUSTOMER: "CUSTOMER",
  SHOP: "SHOP",
  ADMIN: "ADMIN",
  AUDITOR: "AUDITOR",
  CUSTOMER_AI: "CUSTOMER_AI",
  SHOP_AI: "SHOP_AI",
  PAYMENT_CONTROLLER: "PAYMENT_CONTROLLER"
});

export const HUMAN_ROLES = Object.freeze([
  ROLES.CUSTOMER,
  ROLES.SHOP,
  ROLES.ADMIN,
  ROLES.AUDITOR
]);

export const SERVICE_ROLES = Object.freeze([
  ROLES.CUSTOMER_AI,
  ROLES.SHOP_AI,
  ROLES.PAYMENT_CONTROLLER
]);

export const IDENTITY_TYPES = Object.freeze({
  HUMAN: "HUMAN",
  SERVICE: "SERVICE"
});

// In-memory revocation set for invalidated token JTIs (JWT IDs)
const revokedTokens = new Set();

/**
 * Signs a JWT for a verified Human user principal.
 */
export function signUserToken({
  userId,
  role,
  tenantId = null,
  customerId = null,
  scopes = [],
  expiresIn = null,
  authVersion = 1
}) {
  if (!userId || typeof userId !== "string") {
    throw AppError.badRequest("userId is required and must be a string");
  }

  if (!HUMAN_ROLES.includes(role)) {
    throw AppError.badRequest(`Invalid human role '${role}'. Allowed: ${HUMAN_ROLES.join(", ")}`);
  }

  if (role === ROLES.CUSTOMER && (!customerId || !tenantId)) {
    throw AppError.badRequest("CUSTOMER role requires customerId and tenantId");
  }

  if (role === ROLES.SHOP && !tenantId) {
    throw AppError.badRequest("SHOP role requires tenantId");
  }

  const env = getEnv();
  const jti = crypto.randomUUID();

  const payload = {
    sub: userId.trim(),
    identityType: IDENTITY_TYPES.HUMAN,
    role,
    tenantId: tenantId ? tenantId.trim() : null,
    customerId: customerId ? customerId.trim() : null,
    scopes: Array.isArray(scopes) ? scopes : [],
    authVersion: Number(authVersion) || 1,
    jti
  };

  return jwt.sign(payload, env.JWT_SECRET, {
    algorithm: "HS256",
    expiresIn: expiresIn || env.JWT_EXPIRES_IN,
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE
  });
}

/**
 * Signs a token for a verified Machine / Service identity.
 * Bounded by strict audience ('reconai-service') and short-lived expiry.
 */
export function signServiceToken({
  serviceId,
  role,
  tenantId = null,
  customerId = null,
  scopes = [],
  expiresIn = "15m",
  credentialVersion = 1
}) {
  if (!serviceId || typeof serviceId !== "string") {
    throw AppError.badRequest("serviceId is required and must be a string");
  }

  if (!SERVICE_ROLES.includes(role)) {
    throw AppError.badRequest(`Invalid service role '${role}'. Allowed: ${SERVICE_ROLES.join(", ")}`);
  }

  if (role === ROLES.CUSTOMER_AI && (!customerId || !tenantId)) {
    throw AppError.badRequest("CUSTOMER_AI requires customerId and tenantId");
  }

  if (role === ROLES.SHOP_AI && !tenantId) {
    throw AppError.badRequest("SHOP_AI requires tenantId");
  }

  const env = getEnv();
  const jti = crypto.randomUUID();

  const payload = {
    sub: serviceId.trim(),
    identityType: IDENTITY_TYPES.SERVICE,
    role,
    tenantId: tenantId ? tenantId.trim() : null,
    customerId: customerId ? customerId.trim() : null,
    scopes: Array.isArray(scopes) ? scopes : [],
    credentialVersion: Number(credentialVersion) || 1,
    jti
  };

  return jwt.sign(payload, env.SERVICE_TOKEN_SECRET, {
    algorithm: "HS256",
    expiresIn,
    issuer: env.JWT_ISSUER,
    audience: env.SERVICE_TOKEN_AUDIENCE
  });
}

/**
 * Verifies and decodes a signed token.
 * Prevents algorithm confusion, rejects unverified signatures, expired tokens,
 * wrong audiences, and revoked JTIs.
 */
export function verifyToken(token, { expectedAudience = null } = {}) {
  if (!token || typeof token !== "string" || token.trim().length === 0) {
    throw AppError.unauthorized("Missing or empty token");
  }

  const rawToken = token.startsWith("Bearer ") ? token.slice(7).trim() : token.trim();

  // Decode header without verifying to strictly check algorithm
  const decodedHeader = jwt.decode(rawToken, { complete: true });
  if (!decodedHeader || !decodedHeader.header || decodedHeader.header.alg !== "HS256") {
    throw AppError.unauthorized("Invalid token header or unsupported algorithm. Only HS256 is accepted.");
  }

  const env = getEnv();

  // Determine secret and audience based on target identity type
  const isServiceToken =
    decodedHeader.payload &&
    (decodedHeader.payload.identityType === IDENTITY_TYPES.SERVICE ||
      decodedHeader.payload.aud === env.SERVICE_TOKEN_AUDIENCE);

  const secret = isServiceToken ? env.SERVICE_TOKEN_SECRET : env.JWT_SECRET;
  const targetAudience = expectedAudience || (isServiceToken ? env.SERVICE_TOKEN_AUDIENCE : env.JWT_AUDIENCE);

  try {
    const verified = jwt.verify(rawToken, secret, {
      algorithms: ["HS256"],
      issuer: env.JWT_ISSUER,
      audience: targetAudience
    });

    // Check revocation
    if (verified.jti && revokedTokens.has(verified.jti)) {
      throw AppError.unauthorized("Token has been revoked");
    }

    // Verify mandatory claims
    if (!verified.sub || !verified.role || !verified.identityType) {
      throw AppError.unauthorized("Token missing mandatory claims");
    }

    return verified;
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    if (err.name === "TokenExpiredError") {
      throw AppError.unauthorized("Token has expired");
    }
    if (err.name === "JsonWebTokenError") {
      throw AppError.unauthorized("Invalid token signature or malformed payload");
    }
    throw AppError.unauthorized("Authentication failed");
  }
}

/**
 * Checks if a token JTI has been revoked in-memory or in persistent store.
 */
export async function isTokenRevoked(jti) {
  if (!jti || typeof jti !== "string") return false;
  const cleanJti = jti.trim();

  if (revokedTokens.has(cleanJti)) {
    return true;
  }

  const env = getEnv();
  if (env.NODE_ENV === "production" && (!mongoose.connection || mongoose.connection.readyState !== 1)) {
    throw AppError.internal("Revocation store unavailable; failing closed", 503);
  }

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    try {
      const exists = await RevokedToken.exists({ jti: cleanJti });
      if (exists) {
        revokedTokens.add(cleanJti);
        return true;
      }
    } catch {
      // In production, if persistent revocation backend fails, fail closed
      if (env.NODE_ENV === "production") {
        throw AppError.internal("Revocation store unavailable; failing closed", 503);
      }
    }
  }

  return false;
}

/**
 * Revokes a token by its unique JWT ID (jti) both in-memory and persistently.
 */
export async function revokeToken(jti, { expiresAt = null, reason = "LOGOUT" } = {}) {
  if (jti && typeof jti === "string") {
    const cleanJti = jti.trim();
    revokedTokens.add(cleanJti);

    if (mongoose.connection && mongoose.connection.readyState === 1) {
      try {
        await RevokedToken.findOneAndUpdate(
          { jti: cleanJti },
          {
            jti: cleanJti,
            expiresAt: expiresAt || new Date(Date.now() + 24 * 60 * 60 * 1000),
            reason
          },
          { upsert: true, new: true }
        );
      } catch {
        // Fallback to in-memory set
      }
    }
  }
}

/**
 * Clears revoked tokens list (primarily used for test cleanup).
 */
export async function clearRevocationList() {
  revokedTokens.clear();
  if (mongoose.connection && mongoose.connection.readyState === 1) {
    try {
      await RevokedToken.deleteMany({});
    } catch {}
  }
}
