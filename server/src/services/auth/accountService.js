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
    scopes: account.scopes || []
  };
}

/**
 * Clears in-memory test fixtures.
 */
export function clearInMemoryAccounts() {
  inMemoryAccountStore.clear();
}
