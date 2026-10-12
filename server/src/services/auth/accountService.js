import mongoose from "mongoose";
import { UserAccount, hashPassword, verifyPassword } from "../../models/UserAccount.js";
import { AppError } from "../../utils/AppError.js";

/**
 * ReconAI 2.0 - Account Service
 *
 * Verifies human credentials against trusted storage.
 * Prohibits caller-supplied role/tenant elevation.
 */

// In-memory provisioning store used for isolated test suites or when database is offline
const inMemoryAccountStore = new Map();

/**
 * Provisions a verified human account in the datastore.
 */
export async function provisionUserAccount({
  userId,
  email,
  password,
  role,
  tenantId = null,
  customerId = null,
  scopes = [],
  isActive = true
}) {
  if (!userId || !email || !password || !role) {
    throw AppError.badRequest("userId, email, password, and role are required");
  }

  const { hash, salt } = hashPassword(password);

  const accountDoc = {
    userId: userId.trim(),
    email: email.trim().toLowerCase(),
    passwordHash: hash,
    passwordSalt: salt,
    role,
    tenantId: tenantId ? tenantId.trim() : null,
    customerId: customerId ? customerId.trim() : null,
    scopes: Array.isArray(scopes) ? scopes : [],
    isActive
  };

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    const existing = await UserAccount.findOne({
      $or: [{ userId: accountDoc.userId }, { email: accountDoc.email }]
    });
    if (existing) {
      existing.passwordHash = hash;
      existing.passwordSalt = salt;
      existing.role = role;
      existing.tenantId = accountDoc.tenantId;
      existing.customerId = accountDoc.customerId;
      existing.scopes = accountDoc.scopes;
      existing.isActive = isActive;
      await existing.save();
      return existing;
    }
    return await UserAccount.create(accountDoc);
  }

  // Fallback to in-memory store
  inMemoryAccountStore.set(accountDoc.userId, accountDoc);
  inMemoryAccountStore.set(accountDoc.email, accountDoc);
  return accountDoc;
}

/**
 * Authenticates user credentials against the persistent account store.
 * Returns verified identity claims on success, or null on failure (avoiding user enumeration).
 */
export async function authenticateUserCredentials({ identifier, password }) {
  if (!identifier || typeof identifier !== "string" || !password || typeof password !== "string") {
    return null;
  }

  const cleanIdentifier = identifier.trim().toLowerCase();

  let account = null;

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    account = await UserAccount.findOne({
      $or: [
        { email: cleanIdentifier },
        { userId: identifier.trim() }
      ]
    });
  } else {
    account = inMemoryAccountStore.get(cleanIdentifier) || inMemoryAccountStore.get(identifier.trim());
  }

  if (!account || !account.isActive) {
    return null;
  }

  const isMatch = verifyPassword(password, account.passwordHash, account.passwordSalt);
  if (!isMatch) {
    return null;
  }

  return {
    userId: account.userId,
    email: account.email,
    role: account.role,
    tenantId: account.tenantId || null,
    customerId: account.customerId || null,
    scopes: account.scopes || [],
    authVersion: account.authVersion || 1
  };
}

/**
 * Retrieves the current authoritative server-side authorization state for a user.
 * In production, fails closed (503) if the persistent store is unreachable.
 */
export async function getAccountAuthorizationState(userId) {
  if (!userId || typeof userId !== "string") {
    return null;
  }

  const cleanUserId = userId.trim();

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    try {
      const account = await UserAccount.findOne({ userId: cleanUserId });
      if (!account) return null;
      return {
        found: true,
        userId: account.userId,
        email: account.email,
        role: account.role,
        tenantId: account.tenantId || null,
        customerId: account.customerId || null,
        scopes: account.scopes || [],
        isActive: account.isActive,
        authVersion: account.authVersion || 1
      };
    } catch (err) {
      if (process.env.NODE_ENV === "production") {
        throw AppError.internal("Authorization datastore error: failing closed", 503);
      }
    }
  }

  // Fail closed in production if datastore is unavailable
  if (process.env.NODE_ENV === "production") {
    throw AppError.internal("Authorization datastore unavailable: failing closed", 503);
  }

  // Development / test in-memory fallback
  const mem = inMemoryAccountStore.get(cleanUserId);
  if (mem) {
    return {
      found: true,
      userId: mem.userId,
      email: mem.email,
      role: mem.role,
      tenantId: mem.tenantId || null,
      customerId: mem.customerId || null,
      scopes: mem.scopes || [],
      isActive: mem.isActive,
      authVersion: mem.authVersion || 1
    };
  }

  return null;
}

/**
 * Disables a human user account, immediately invalidating any active sessions.
 */
export async function disableUserAccount(userId, reason = "ADMINISTRATIVE_ACTION") {
  if (!userId || typeof userId !== "string") {
    throw AppError.badRequest("userId is required");
  }

  const cleanUserId = userId.trim();

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    const account = await UserAccount.findOne({ userId: cleanUserId });
    if (!account) {
      throw AppError.notFound(`UserAccount '${cleanUserId}' not found`);
    }
    account.isActive = false;
    account.authVersion = (account.authVersion || 1) + 1;
    await account.save();
    return account;
  }

  const mem = inMemoryAccountStore.get(cleanUserId);
  if (!mem) {
    throw AppError.notFound(`UserAccount '${cleanUserId}' not found in store`);
  }
  mem.isActive = false;
  mem.authVersion = (mem.authVersion || 1) + 1;
  return mem;
}

/**
 * Updates a user's role, tenant, customer, or scopes, incrementing authVersion
 * to immediately reflect new authorization boundaries across all requests.
 */
export async function updateUserAuthorization(
  userId,
  { role, tenantId, customerId, scopes, invalidateSessions = false }
) {
  if (!userId || typeof userId !== "string") {
    throw AppError.badRequest("userId is required");
  }

  const cleanUserId = userId.trim();

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    const account = await UserAccount.findOne({ userId: cleanUserId });
    if (!account) {
      throw AppError.notFound(`UserAccount '${cleanUserId}' not found`);
    }
    if (role) account.role = role;
    if (typeof tenantId !== "undefined") account.tenantId = tenantId;
    if (typeof customerId !== "undefined") account.customerId = customerId;
    if (Array.isArray(scopes)) account.scopes = scopes;
    if (invalidateSessions) {
      account.authVersion = (account.authVersion || 1) + 1;
    }
    await account.save();
    return account;
  }

  const mem = inMemoryAccountStore.get(cleanUserId);
  if (!mem) {
    throw AppError.notFound(`UserAccount '${cleanUserId}' not found in store`);
  }
  if (role) mem.role = role;
  if (typeof tenantId !== "undefined") mem.tenantId = tenantId;
  if (typeof customerId !== "undefined") mem.customerId = customerId;
  if (Array.isArray(scopes)) mem.scopes = scopes;
  if (invalidateSessions) {
    mem.authVersion = (mem.authVersion || 1) + 1;
  }
  return mem;
}

/**
 * Explicitly invalidates all active sessions for a user by incrementing authVersion.
 */
export async function invalidateUserSessions(userId) {
  return await updateUserAuthorization(userId, { invalidateSessions: true });
}

/**
 * Clears in-memory test fixtures.
 */
export function clearInMemoryAccounts() {
  inMemoryAccountStore.clear();
}

/**
 * Provisions default demo accounts in the persistent database if not already present.
 */
export async function initDefaultAccounts() {
  const defaultAccounts = [
    {
      userId: "usr_admin_01",
      email: "admin@reconai.com",
      password: "AdminPassword123!",
      role: "ADMIN",
      tenantId: "tenant_default",
      scopes: ["GLOBAL_AUDIT", "FULL_ACCESS"]
    },
    {
      userId: "usr_shop_01",
      email: "shop@reconai.com",
      password: "ShopPassword123!",
      role: "SHOP",
      tenantId: "tenant_default"
    },
    {
      userId: "usr_auditor_01",
      email: "auditor@reconai.com",
      password: "AuditorPassword123!",
      role: "AUDITOR",
      tenantId: "tenant_default",
      scopes: ["GLOBAL_AUDIT"]
    }
  ];

  for (const acct of defaultAccounts) {
    try {
      await provisionUserAccount(acct);
    } catch {
      // Ignore if exists or error
    }
  }
}
