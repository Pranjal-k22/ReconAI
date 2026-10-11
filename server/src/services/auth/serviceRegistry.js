import crypto from "crypto";
import { getEnv } from "../../config/env.js";
import { ROLES, SERVICE_ROLES } from "./tokenService.js";
import { AppError } from "../../utils/AppError.js";

/**
 * ReconAI 2.0 - Service Identity Registry & Credential Binding
 *
 * Enforces explicit, server-side 1:1 binding between machine credentials
 * and fixed service identities. Prevents callers from claiming elevated roles,
 * unauthorized tenants, or cross-service impersonation.
 */

// In-memory registry for machine principals
const serviceRegistry = new Map();

/**
 * Initializes default system service principals derived securely from SERVICE_TOKEN_SECRET.
 */
function initDefaultServices() {
  const env = getEnv();
  const baseSecret = env.SERVICE_TOKEN_SECRET;

  const defaults = [
    {
      serviceId: "svc_payment_controller",
      secret: `${baseSecret}:payment_controller`,
      role: ROLES.PAYMENT_CONTROLLER,
      tenantId: null,
      customerId: null,
      scopes: ["PROPOSE_ACTION", "APPEND_EVENT"]
    },
    {
      serviceId: "svc_customer_ai",
      secret: `${baseSecret}:customer_ai`,
      role: ROLES.CUSTOMER_AI,
      tenantId: "sh_merchant_alpha",
      customerId: "cust_4421",
      scopes: ["READ_CUSTOMER_EVIDENCE"]
    },
    {
      serviceId: "svc_shop_ai",
      secret: `${baseSecret}:shop_ai`,
      role: ROLES.SHOP_AI,
      tenantId: "sh_merchant_alpha",
      customerId: null,
      scopes: ["READ_STORE_EVIDENCE"],
    isActive: true,
    credentialVersion: 1
  }
];

  for (const s of defaults) {
    if (!serviceRegistry.has(s.serviceId)) {
      serviceRegistry.set(s.serviceId, { ...s, isActive: true, credentialVersion: 1 });
    }
  }
}

/**
 * Registers or updates a service principal in the server-side registry.
 */
export function registerServicePrincipal({
  serviceId,
  secret,
  role,
  tenantId = null,
  customerId = null,
  scopes = [],
  isActive = true,
  credentialVersion = 1
}) {
  if (!serviceId || !secret || !role) {
    throw AppError.badRequest("serviceId, secret, and role are required");
  }

  if (!SERVICE_ROLES.includes(role)) {
    throw AppError.badRequest(`Invalid service role '${role}'. Allowed: ${SERVICE_ROLES.join(", ")}`);
  }

  if (role === ROLES.CUSTOMER_AI && (!customerId || !tenantId)) {
    throw AppError.badRequest("CUSTOMER_AI requires fixed customerId and tenantId");
  }

  if (role === ROLES.SHOP_AI && !tenantId) {
    throw AppError.badRequest("SHOP_AI requires fixed tenantId");
  }

  const existing = serviceRegistry.get(serviceId.trim());

  serviceRegistry.set(serviceId.trim(), {
    serviceId: serviceId.trim(),
    secret: secret.trim(),
    role,
    tenantId: tenantId ? tenantId.trim() : null,
    customerId: customerId ? customerId.trim() : null,
    scopes: Array.isArray(scopes) ? scopes : [],
    isActive,
    credentialVersion: existing ? (existing.credentialVersion || 1) + 1 : credentialVersion
  });
}

/**
 * Authenticates service credentials using timing-safe comparison.
 * Returns the immutable, server-bound identity on success, or null on failure.
 */
export function authenticateServiceCredential({ serviceId, clientSecret }) {
  if (!serviceId || !clientSecret || typeof clientSecret !== "string") {
    return null;
  }

  initDefaultServices();

  const record = serviceRegistry.get(serviceId.trim());
  if (!record || record.isActive === false) {
    return null;
  }

  // Constant-time comparison using SHA-256 digests
  const providedDigest = crypto.createHash("sha256").update(clientSecret.trim()).digest();
  const storedDigest = crypto.createHash("sha256").update(record.secret).digest();

  if (!crypto.timingSafeEqual(providedDigest, storedDigest)) {
    return null;
  }

  return {
    serviceId: record.serviceId,
    role: record.role,
    tenantId: record.tenantId,
    customerId: record.customerId,
    scopes: [...record.scopes],
    credentialVersion: record.credentialVersion || 1
  };
}

/**
 * Retrieves the current authoritative authorization state for a service identity.
 */
export function getServiceAuthorizationState(serviceId) {
  if (!serviceId || typeof serviceId !== "string") {
    return null;
  }

  initDefaultServices();

  const record = serviceRegistry.get(serviceId.trim());
  if (!record) {
    return null;
  }

  return {
    serviceId: record.serviceId,
    role: record.role,
    tenantId: record.tenantId,
    customerId: record.customerId,
    scopes: [...record.scopes],
    isActive: record.isActive !== false,
    credentialVersion: record.credentialVersion || 1
  };
}

/**
 * Disables a service principal, immediately revoking all issued service tokens.
 */
export function disableServicePrincipal(serviceId) {
  if (!serviceId || typeof serviceId !== "string") {
    throw AppError.badRequest("serviceId is required");
  }

  initDefaultServices();

  const record = serviceRegistry.get(serviceId.trim());
  if (!record) {
    throw AppError.notFound(`Service principal '${serviceId}' not found`);
  }

  record.isActive = false;
  record.credentialVersion = (record.credentialVersion || 1) + 1;
  return record;
}

/**
 * Rotates a service credential, immediately invalidating tokens issued with previous versions.
 */
export function rotateServiceCredential(serviceId, newSecret) {
  if (!serviceId || !newSecret || typeof newSecret !== "string") {
    throw AppError.badRequest("serviceId and newSecret are required");
  }

  initDefaultServices();

  const record = serviceRegistry.get(serviceId.trim());
  if (!record) {
    throw AppError.notFound(`Service principal '${serviceId}' not found`);
  }

  record.secret = newSecret.trim();
  record.credentialVersion = (record.credentialVersion || 1) + 1;
  return record;
}

/**
 * Updates a service principal's scope or tenant association, immediately binding
 * all subsequent requests to the new authorization boundaries.
 */
export function updateServiceScope(serviceId, { scopes, tenantId, customerId, role }) {
  if (!serviceId || typeof serviceId !== "string") {
    throw AppError.badRequest("serviceId is required");
  }

  initDefaultServices();

  const record = serviceRegistry.get(serviceId.trim());
  if (!record) {
    throw AppError.notFound(`Service principal '${serviceId}' not found`);
  }

  if (Array.isArray(scopes)) record.scopes = scopes;
  if (typeof tenantId !== "undefined") record.tenantId = tenantId;
  if (typeof customerId !== "undefined") record.customerId = customerId;
  if (role) record.role = role;
  return record;
}

/**
 * Resets service registry to default configuration (test utility).
 */
export function resetServiceRegistry() {
  serviceRegistry.clear();
  initDefaultServices();
}
