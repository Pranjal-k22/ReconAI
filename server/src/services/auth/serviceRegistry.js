import mongoose from "mongoose";
import { getEnv } from "../../config/env.js";
import { ROLES, SERVICE_ROLES } from "./tokenService.js";
import { AppError } from "../../utils/AppError.js";
import {
  ServicePrincipal,
  hashServiceCredential,
  verifyServiceCredential
} from "../../models/ServicePrincipal.js";

/**
 * ReconAI 2.0 - Service Identity Registry & Credential Binding
 *
 * Enforces explicit, server-side 1:1 binding between machine credentials
 * and fixed service identities with durable MongoDB persistence.
 * Prevents callers from claiming elevated roles, unauthorized tenants,
 * or cross-service impersonation across restarts and multi-instance deployments.
 */

// Durable in-memory persistent store used when MongoDB is offline during test suites
const inMemoryServicePrincipalStore = new Map();

// Volatile L1 memory cache cleared upon restart / reinitialization
let serviceMemoryCache = new Map();

/**
 * Initializes default system service principals derived securely from SERVICE_TOKEN_SECRET.
 * Restart-Safe Invariant: Never overwrites an existing principal, restores revoked scopes,
 * reverts rotated credentials, or re-activates disabled services upon startup.
 */
export async function initDefaultServices() {
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
      serviceId: "svc_cust_ai",
      secret: `${baseSecret}:cust_ai`,
      role: ROLES.CUSTOMER_AI,
      tenantId: "sh_merchant_01",
      customerId: "cust_123",
      scopes: ["READ_CUSTOMER_EVIDENCE"]
    },
    {
      serviceId: "svc_shop_ai",
      secret: `${baseSecret}:shop_ai`,
      role: ROLES.SHOP_AI,
      tenantId: "sh_merchant_alpha",
      customerId: null,
      scopes: ["READ_STORE_EVIDENCE"]
    }
  ];

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    for (const s of defaults) {
      const existing = await ServicePrincipal.findOne({ serviceId: s.serviceId });
      // Restart-safe: do not overwrite existing record
      if (!existing) {
        const { hash, salt } = hashServiceCredential(s.secret);
        await ServicePrincipal.create({
          serviceId: s.serviceId,
          serviceRole: s.role,
          tenantId: s.tenantId,
          customerId: s.customerId,
          scopes: s.scopes,
          isActive: true,
          credentialVersion: 1,
          credentialHash: hash,
          credentialSalt: salt
        });
      }
    }
    return;
  }

  // In production, if persistent datastore is offline, fail closed
  if (process.env.NODE_ENV === "production") {
    throw AppError.internal("Service principal datastore unavailable in production: failing closed", 503);
  }

  // Non-production fallback to durable in-memory store
  for (const s of defaults) {
    if (!inMemoryServicePrincipalStore.has(s.serviceId)) {
      const { hash, salt } = hashServiceCredential(s.secret);
      inMemoryServicePrincipalStore.set(s.serviceId, {
        serviceId: s.serviceId,
        serviceRole: s.role,
        tenantId: s.tenantId,
        customerId: s.customerId,
        scopes: [...s.scopes],
        isActive: true,
        credentialVersion: 1,
        credentialHash: hash,
        credentialSalt: salt
      });
    }
  }
}

/**
 * Registers or updates a service principal in the persistent server-side registry.
 */
export async function registerServicePrincipal({
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

  if (tenantId && tenantId.trim() === "unassigned_provider_quarantine") {
    throw AppError.badRequest(
      "Tenant 'unassigned_provider_quarantine' is a protected internal quarantine sentinel and cannot be assigned to service principals"
    );
  }

  const { hash, salt } = hashServiceCredential(secret);
  const cleanId = serviceId.trim();
  serviceMemoryCache.delete(cleanId);

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    const existing = await ServicePrincipal.findOne({ serviceId: cleanId });
    if (existing) {
      existing.serviceRole = role;
      existing.tenantId = tenantId ? tenantId.trim() : null;
      existing.customerId = customerId ? customerId.trim() : null;
      existing.scopes = Array.isArray(scopes) ? scopes : [];
      existing.isActive = isActive;
      existing.credentialVersion = (existing.credentialVersion || 1) + 1;
      existing.credentialHash = hash;
      existing.credentialSalt = salt;
      await existing.save();
      return existing;
    }

    return await ServicePrincipal.create({
      serviceId: cleanId,
      serviceRole: role,
      tenantId: tenantId ? tenantId.trim() : null,
      customerId: customerId ? customerId.trim() : null,
      scopes: Array.isArray(scopes) ? scopes : [],
      isActive,
      credentialVersion,
      credentialHash: hash,
      credentialSalt: salt
    });
  }

  if (process.env.NODE_ENV === "production") {
    throw AppError.internal("Service principal datastore unavailable in production: failing closed", 503);
  }

  const existingMem = inMemoryServicePrincipalStore.get(cleanId);
  const updatedDoc = {
    serviceId: cleanId,
    serviceRole: role,
    tenantId: tenantId ? tenantId.trim() : null,
    customerId: customerId ? customerId.trim() : null,
    scopes: Array.isArray(scopes) ? scopes : [],
    isActive,
    credentialVersion: existingMem ? (existingMem.credentialVersion || 1) + 1 : credentialVersion,
    credentialHash: hash,
    credentialSalt: salt
  };
  inMemoryServicePrincipalStore.set(cleanId, updatedDoc);
  return updatedDoc;
}

/**
 * Authenticates service credentials against persistent store using timing-safe comparison.
 * Returns the immutable, server-bound identity on success, or null on failure.
 */
export async function authenticateServiceCredential({ serviceId, clientSecret }) {
  if (!serviceId || !clientSecret || typeof clientSecret !== "string") {
    return null;
  }

  await initDefaultServices();

  let record = null;
  const cleanId = serviceId.trim();

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    record = await ServicePrincipal.findOne({ serviceId: cleanId });
  } else if (process.env.NODE_ENV === "production") {
    throw AppError.internal("Service principal datastore unavailable in production: failing closed", 503);
  } else {
    record = inMemoryServicePrincipalStore.get(cleanId);
  }

  if (!record || record.isActive === false) {
    return null;
  }

  const isMatch = verifyServiceCredential(
    clientSecret,
    record.credentialHash,
    record.credentialSalt
  );

  if (!isMatch) {
    return null;
  }

  return {
    serviceId: record.serviceId,
    role: record.serviceRole || record.role,
    tenantId: record.tenantId || null,
    customerId: record.customerId || null,
    scopes: [...(record.scopes || [])],
    credentialVersion: record.credentialVersion || 1
  };
}

/**
 * Retrieves the current authoritative authorization state for a service identity.
 * In production, fails closed (503) if the persistent store is unreachable.
 */
export async function getServiceAuthorizationState(serviceId) {
  if (!serviceId || typeof serviceId !== "string") {
    return null;
  }

  const cleanId = serviceId.trim();

  if (serviceMemoryCache.has(cleanId)) {
    return serviceMemoryCache.get(cleanId);
  }

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    try {
      await initDefaultServices();
      const record = await ServicePrincipal.findOne({ serviceId: cleanId });
      if (!record) return null;
      const state = {
        serviceId: record.serviceId,
        role: record.serviceRole || record.role,
        tenantId: record.tenantId || null,
        customerId: record.customerId || null,
        scopes: [...(record.scopes || [])],
        isActive: record.isActive !== false,
        credentialVersion: record.credentialVersion || 1
      };
      serviceMemoryCache.set(cleanId, state);
      return state;
    } catch (err) {
      if (process.env.NODE_ENV === "production") {
        throw AppError.internal("Service authorization datastore error: failing closed", 503);
      }
    }
  }

  if (process.env.NODE_ENV === "production") {
    throw AppError.internal("Service authorization datastore unavailable in production: failing closed", 503);
  }

  await initDefaultServices();
  const record = inMemoryServicePrincipalStore.get(cleanId);
  if (!record) return null;

  const state = {
    serviceId: record.serviceId,
    role: record.serviceRole || record.role,
    tenantId: record.tenantId || null,
    customerId: record.customerId || null,
    scopes: [...(record.scopes || [])],
    isActive: record.isActive !== false,
    credentialVersion: record.credentialVersion || 1
  };
  serviceMemoryCache.set(cleanId, state);
  return state;
}

/**
 * Disables a service principal, persisting the change and incrementing credential version.
 */
export async function disableServicePrincipal(serviceId) {
  if (!serviceId || typeof serviceId !== "string") {
    throw AppError.badRequest("serviceId is required");
  }

  await initDefaultServices();
  const cleanId = serviceId.trim();
  serviceMemoryCache.delete(cleanId);

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    const record = await ServicePrincipal.findOne({ serviceId: cleanId });
    if (!record) {
      throw AppError.notFound(`Service principal '${serviceId}' not found`);
    }
    record.isActive = false;
    record.credentialVersion = (record.credentialVersion || 1) + 1;
    await record.save();
    return record;
  }

  if (process.env.NODE_ENV === "production") {
    throw AppError.internal("Service principal datastore unavailable in production: failing closed", 503);
  }

  const record = inMemoryServicePrincipalStore.get(cleanId);
  if (!record) {
    throw AppError.notFound(`Service principal '${serviceId}' not found`);
  }
  record.isActive = false;
  record.credentialVersion = (record.credentialVersion || 1) + 1;
  return record;
}

/**
 * Rotates a service credential, persisting the new hash and incrementing credential version.
 */
export async function rotateServiceCredential(serviceId, newSecret) {
  if (!serviceId || !newSecret || typeof newSecret !== "string") {
    throw AppError.badRequest("serviceId and newSecret are required");
  }

  await initDefaultServices();
  const cleanId = serviceId.trim();
  serviceMemoryCache.delete(cleanId);
  const { hash, salt } = hashServiceCredential(newSecret);

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    const record = await ServicePrincipal.findOne({ serviceId: cleanId });
    if (!record) {
      throw AppError.notFound(`Service principal '${serviceId}' not found`);
    }
    record.credentialHash = hash;
    record.credentialSalt = salt;
    record.credentialVersion = (record.credentialVersion || 1) + 1;
    await record.save();
    return record;
  }

  if (process.env.NODE_ENV === "production") {
    throw AppError.internal("Service principal datastore unavailable in production: failing closed", 503);
  }

  const record = inMemoryServicePrincipalStore.get(cleanId);
  if (!record) {
    throw AppError.notFound(`Service principal '${serviceId}' not found`);
  }
  record.credentialHash = hash;
  record.credentialSalt = salt;
  record.credentialVersion = (record.credentialVersion || 1) + 1;
  return record;
}

/**
 * Updates a service principal's scope or tenant association in persistent storage.
 */
export async function updateServiceScope(serviceId, { scopes, tenantId, customerId, role }) {
  if (!serviceId || typeof serviceId !== "string") {
    throw AppError.badRequest("serviceId is required");
  }

  await initDefaultServices();
  const cleanId = serviceId.trim();
  serviceMemoryCache.delete(cleanId);

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    const record = await ServicePrincipal.findOne({ serviceId: cleanId });
    if (!record) {
      throw AppError.notFound(`Service principal '${serviceId}' not found`);
    }
    if (Array.isArray(scopes)) record.scopes = scopes;
    if (typeof tenantId !== "undefined") record.tenantId = tenantId ? tenantId.trim() : null;
    if (typeof customerId !== "undefined") record.customerId = customerId ? customerId.trim() : null;
    if (role) {
      if (!SERVICE_ROLES.includes(role)) {
        throw AppError.badRequest(`Invalid service role '${role}'`);
      }
      record.serviceRole = role;
    }
    await record.save();
    return record;
  }

  if (process.env.NODE_ENV === "production") {
    throw AppError.internal("Service principal datastore unavailable in production: failing closed", 503);
  }

  const record = inMemoryServicePrincipalStore.get(cleanId);
  if (!record) {
    throw AppError.notFound(`Service principal '${serviceId}' not found`);
  }
  if (Array.isArray(scopes)) record.scopes = scopes;
  if (typeof tenantId !== "undefined") record.tenantId = tenantId ? tenantId.trim() : null;
  if (typeof customerId !== "undefined") record.customerId = customerId ? customerId.trim() : null;
  if (role) {
    if (!SERVICE_ROLES.includes(role)) {
      throw AppError.badRequest(`Invalid service role '${role}'`);
    }
    record.serviceRole = role;
  }
  return record;
}

/**
 * Clears volatile L1 cache to simulate restart / new application instance loading state from durable store.
 */
export function clearInMemoryServices() {
  serviceMemoryCache.clear();
}

/**
 * Simulates full server restart: clears volatile memory cache and executes startup bootstrap.
 */
export async function reinitializeServiceRegistry() {
  clearInMemoryServices();
  await initDefaultServices();
}

/**
 * Resets service registry completely (test teardown utility).
 */
export async function resetServiceRegistry() {
  if (mongoose.connection && mongoose.connection.readyState === 1) {
    await ServicePrincipal.deleteMany({});
  }
  inMemoryServicePrincipalStore.clear();
  serviceMemoryCache.clear();
  await initDefaultServices();
}
