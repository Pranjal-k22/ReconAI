import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { execFileSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import {
  ServicePrincipal,
  hashServiceCredential,
  verifyServiceCredential
} from "../../src/models/ServicePrincipal.js";
import {
  registerServicePrincipal,
  authenticateServiceCredential,
  initDefaultServices,
  clearInMemoryServices,
  reinitializeServiceRegistry,
  disableServicePrincipal,
  rotateServiceCredential,
  updateServiceScope,
  getServiceAuthorizationState
} from "../../src/services/auth/serviceRegistry.js";
import { ROLES } from "../../src/services/auth/tokenService.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const serverRootDir = path.resolve(__dirname, "../../");

/**
 * Sanitizes MongoDB connection URIs to prevent credential leakage in test logs.
 */
function sanitizeMongoUri(uri) {
  if (!uri) return "";
  try {
    return uri.replace(/\/\/(.*):(.*)@/, "//***:***@");
  } catch {
    return "[REDACTED_URI]";
  }
}

/**
 * Validates the test database URI to guarantee complete isolation.
 * Refuses execution if configured against production or the primary app database.
 */
function validateTestDatabaseUri(uri) {
  if (!uri || typeof uri !== "string") {
    throw new Error("MONGODB_TEST_URI must be provided as a non-empty string");
  }

  // Refuse if scheme is invalid
  if (!uri.startsWith("mongodb://") && !uri.startsWith("mongodb+srv://")) {
    throw new Error("Invalid MONGODB_TEST_URI scheme: must start with mongodb:// or mongodb+srv://");
  }

  // Refuse if matching configured app MONGODB_URI
  if (process.env.MONGODB_URI && uri.trim() === process.env.MONGODB_URI.trim()) {
    throw new Error(
      "Safety violation: MONGODB_TEST_URI matches development/app MONGODB_URI. Integration tests require an isolated test database."
    );
  }

  // Extract database name
  let dbName = "";
  try {
    const url = new URL(uri.replace(/^mongodb(\+srv)?:\/\//, "http://"));
    dbName = url.pathname.replace(/^\//, "");
  } catch {
    const match = uri.match(/\/([^/?]+)(\?|$)/);
    if (match) dbName = match[1];
  }

  if (!dbName) {
    throw new Error("Safety violation: MONGODB_TEST_URI must explicitly specify a database name.");
  }

  const lowerName = dbName.toLowerCase();

  // Guard: Database name must contain 'test'
  if (!lowerName.includes("test")) {
    throw new Error(
      `Safety violation: Test database name '${dbName}' must contain 'test' to guarantee isolation.`
    );
  }

  // Guard: Database name must not contain 'prod' or 'production'
  if (lowerName.includes("prod")) {
    throw new Error(
      `Safety violation: Test database name '${dbName}' contains 'prod'. Execution refused.`
    );
  }

  return uri;
}

const DEFAULT_TEST_URI = "mongodb://127.0.0.1:27017/reconai_test_service_persistence";
const TEST_DB_URI = validateTestDatabaseUri(process.env.MONGODB_TEST_URI || DEFAULT_TEST_URI);
const SANITIZED_TEST_URI = sanitizeMongoUri(TEST_DB_URI);

// Probe connection availability
let isMongoAvailable = false;
let mongoSkipReason = "";

try {
  await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 2500 });
  if (mongoose.connection.readyState === 1) {
    isMongoAvailable = true;
  }
} catch (err) {
  isMongoAvailable = false;
  mongoSkipReason = `MongoDB connection failed at ${SANITIZED_TEST_URI}: ${err.message}`;
} finally {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

describe("ReconAI 2.0 - ServicePrincipal & Registry Real MongoDB Persistence Integration", { timeout: 30000 }, () => {
  const trackedServiceIds = new Set();

  function generateTestServiceId(scenario) {
    const id = `svc_integ_${scenario}_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    trackedServiceIds.add(id);
    return id;
  }

  beforeAll(async () => {
    if (!isMongoAvailable) {
      console.warn(`\n⚠️  [INTEGRATION TEST SKIPPED] ${mongoSkipReason}\nPersistence integration tests require a live isolated MongoDB instance. In-memory substitution is disabled.`);
      return;
    }

    // Connect to isolated test database
    await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 5000 });
    clearInMemoryServices();
    await initDefaultServices();
  });

  afterAll(async () => {
    if (isMongoAvailable) {
      if (mongoose.connection.readyState !== 1) {
        try {
          await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 5000 });
        } catch {}
      }

      // Restore default svc_shop_ai if modified during test
      try {
        await ServicePrincipal.updateOne(
          { serviceId: "svc_shop_ai" },
          { $set: { isActive: true } }
        );
      } catch {}

      // Clean up ONLY tracked test records created by this suite
      if (trackedServiceIds.size > 0) {
        await ServicePrincipal.deleteMany({
          serviceId: { $in: Array.from(trackedServiceIds) }
        });
      }

      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
    }
  });

  it.skipIf(!isMongoAvailable)(
    "1. creates a service principal in MongoDB and verifies authentication with timing-safe validation",
    async () => {
      const serviceId = generateTestServiceId("auth");
      const secret = "integ-secret-key-alpha-99!";

      // Register principal
      const created = await registerServicePrincipal({
        serviceId,
        secret,
        role: ROLES.SHOP_AI,
        tenantId: "sh_integ_merchant_alpha",
        scopes: ["READ_STORE_EVIDENCE", "PROPOSE_ACTION"]
      });

      expect(created).toBeDefined();
      expect(created.serviceId).toBe(serviceId);

      // Verify direct MongoDB persistence
      const docInDb = await ServicePrincipal.findOne({ serviceId }).lean();
      expect(docInDb).not.toBeNull();
      expect(docInDb.serviceRole).toBe(ROLES.SHOP_AI);
      expect(docInDb.tenantId).toBe("sh_integ_merchant_alpha");
      expect(docInDb.credentialVersion).toBe(1);
      expect(docInDb.isActive).toBe(true);

      // Authenticate with valid secret
      const authSuccess = await authenticateServiceCredential({
        serviceId,
        clientSecret: secret
      });
      expect(authSuccess).not.toBeNull();
      expect(authSuccess.serviceId).toBe(serviceId);
      expect(authSuccess.role).toBe(ROLES.SHOP_AI);
      expect(authSuccess.tenantId).toBe("sh_integ_merchant_alpha");
      expect(authSuccess.credentialVersion).toBe(1);

      // Authenticate with invalid secret fails
      const authFailed = await authenticateServiceCredential({
        serviceId,
        clientSecret: "incorrect-secret-value"
      });
      expect(authFailed).toBeNull();
    }
  );

  it.skipIf(!isMongoAvailable)(
    "2. disables the principal, closes DB connection, reconnects, and verifies it remains disabled",
    async () => {
      const serviceId = generateTestServiceId("disable");
      const secret = "integ-secret-disable-test-123!";

      await registerServicePrincipal({
        serviceId,
        secret,
        role: ROLES.SHOP_AI,
        tenantId: "sh_integ_merchant_alpha"
      });

      // Disable principal
      await disableServicePrincipal(serviceId);

      // --- DATABASE RECONNECTION & APP REINITIALIZATION ---
      await mongoose.disconnect();
      expect(mongoose.connection.readyState).toBe(0);
      clearInMemoryServices();

      await mongoose.connect(TEST_DB_URI);
      expect(mongoose.connection.readyState).toBe(1);
      await reinitializeServiceRegistry();

      // Verify directly in MongoDB
      const docAfterRestart = await ServicePrincipal.findOne({ serviceId }).lean();
      expect(docAfterRestart.isActive).toBe(false);
      expect(docAfterRestart.credentialVersion).toBe(2);

      // Verify authentication fails for disabled service
      const authResult = await authenticateServiceCredential({
        serviceId,
        clientSecret: secret
      });
      expect(authResult).toBeNull();

      // Verify authoritative state check
      const state = await getServiceAuthorizationState(serviceId);
      expect(state.isActive).toBe(false);
    }
  );

  it.skipIf(!isMongoAvailable)(
    "3. rotates the credential, reconnects DB, and verifies old credential is rejected while new works",
    async () => {
      const serviceId = generateTestServiceId("rotate");
      const oldSecret = "initial-secret-v1-abc";
      const newSecret = "rotated-secret-v2-xyz";

      await registerServicePrincipal({
        serviceId,
        secret: oldSecret,
        role: ROLES.CUSTOMER_AI,
        tenantId: "sh_integ_merchant_alpha",
        customerId: "cust_integ_441"
      });

      // Rotate credential to v2
      await rotateServiceCredential(serviceId, newSecret);

      // --- DATABASE RECONNECTION & APP REINITIALIZATION ---
      await mongoose.disconnect();
      clearInMemoryServices();
      await mongoose.connect(TEST_DB_URI);
      await reinitializeServiceRegistry();

      // Direct MongoDB check
      const doc = await ServicePrincipal.findOne({ serviceId }).lean();
      expect(doc.credentialVersion).toBe(2);

      // Old credential must fail
      const oldAuth = await authenticateServiceCredential({
        serviceId,
        clientSecret: oldSecret
      });
      expect(oldAuth).toBeNull();

      // New credential must succeed with incremented version
      const newAuth = await authenticateServiceCredential({
        serviceId,
        clientSecret: newSecret
      });
      expect(newAuth).not.toBeNull();
      expect(newAuth.credentialVersion).toBe(2);
      expect(newAuth.customerId).toBe("cust_integ_441");
    }
  );

  it.skipIf(!isMongoAvailable)(
    "4. removes a service scope, reconnects DB, and verifies the permission stays removed",
    async () => {
      const serviceId = generateTestServiceId("scope");
      const secret = "scope-test-secret-456";

      await registerServicePrincipal({
        serviceId,
        secret,
        role: ROLES.PAYMENT_CONTROLLER,
        scopes: ["PROPOSE_ACTION", "APPEND_EVENT"]
      });

      // Remove PROPOSE_ACTION scope
      await updateServiceScope(serviceId, { scopes: ["APPEND_EVENT"] });

      // --- DATABASE RECONNECTION & APP REINITIALIZATION ---
      await mongoose.disconnect();
      clearInMemoryServices();
      await mongoose.connect(TEST_DB_URI);
      await reinitializeServiceRegistry();

      // Direct MongoDB check
      const doc = await ServicePrincipal.findOne({ serviceId }).lean();
      expect(doc.scopes).toEqual(["APPEND_EVENT"]);
      expect(doc.scopes).not.toContain("PROPOSE_ACTION");

      // Authorization state check
      const state = await getServiceAuthorizationState(serviceId);
      expect(state.scopes).toEqual(["APPEND_EVENT"]);
      expect(state.scopes).not.toContain("PROPOSE_ACTION");
    }
  );

  it.skipIf(!isMongoAvailable)(
    "5. reassigns tenant/customer scope, reconnects DB, and verifies previous binding is not restored",
    async () => {
      const serviceId = generateTestServiceId("tenant");
      const secret = "tenant-test-secret-789";

      await registerServicePrincipal({
        serviceId,
        secret,
        role: ROLES.SHOP_AI,
        tenantId: "sh_original_tenant",
        customerId: null
      });

      // Reassign tenant
      await updateServiceScope(serviceId, { tenantId: "sh_new_reassigned_tenant" });

      // --- DATABASE RECONNECTION & APP REINITIALIZATION ---
      await mongoose.disconnect();
      clearInMemoryServices();
      await mongoose.connect(TEST_DB_URI);
      await reinitializeServiceRegistry();

      // Direct MongoDB check
      const doc = await ServicePrincipal.findOne({ serviceId }).lean();
      expect(doc.tenantId).toBe("sh_new_reassigned_tenant");

      // Authorization state check
      const state = await getServiceAuthorizationState(serviceId);
      expect(state.tenantId).toBe("sh_new_reassigned_tenant");
      expect(state.tenantId).not.toBe("sh_original_tenant");
    }
  );

  it.skipIf(!isMongoAvailable)(
    "6. verifies default service bootstrapping does not reactivate a disabled service or overwrite rotated credentials",
    async () => {
      // Disable default service svc_shop_ai
      await disableServicePrincipal("svc_shop_ai");
      await rotateServiceCredential("svc_shop_ai", "rotated-default-secret-999");

      // --- DATABASE RECONNECTION & APP REINITIALIZATION ---
      await mongoose.disconnect();
      clearInMemoryServices();
      await mongoose.connect(TEST_DB_URI);

      // Re-run bootstrap initialization
      await initDefaultServices();

      // Must remain disabled and retain version >= 2
      const state = await getServiceAuthorizationState("svc_shop_ai");
      expect(state.isActive).toBe(false);
      expect(state.credentialVersion).toBeGreaterThanOrEqual(2);

      // Direct DB check
      const doc = await ServicePrincipal.findOne({ serviceId: "svc_shop_ai" }).lean();
      expect(doc.isActive).toBe(false);
      expect(doc.credentialVersion).toBeGreaterThanOrEqual(2);
    }
  );

  it.skipIf(!isMongoAvailable)(
    "7. initializes a separate registry instance via a genuine separate Node.js OS process and reads authoritative DB state",
    async () => {
      const serviceId = generateTestServiceId("multiprocess");
      const secret = "multiprocess-secret-init-1";
      const rotatedSecret = "multiprocess-secret-rotated-2";

      // Setup principal in primary process
      await registerServicePrincipal({
        serviceId,
        secret,
        role: ROLES.SHOP_AI,
        tenantId: "sh_multiprocess_tenant",
        scopes: ["READ_STORE_EVIDENCE", "PROPOSE_ACTION"]
      });

      await disableServicePrincipal(serviceId);
      await rotateServiceCredential(serviceId, rotatedSecret);
      await updateServiceScope(serviceId, { scopes: ["READ_STORE_EVIDENCE"] });

      // --- GENUINE MULTI-PROCESS TESTING ---
      // Spawn an independent Node.js process with clean memory space that connects to the same TEST_DB_URI
      const childCode = `
        import mongoose from "mongoose";
        import { getServiceAuthorizationState } from "./src/services/auth/serviceRegistry.js";
        
        const [, uri, targetId] = process.argv;
        try {
          await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
          const state = await getServiceAuthorizationState(targetId);
          console.log(JSON.stringify({ success: true, state }));
        } catch (err) {
          console.log(JSON.stringify({ success: false, error: err.message }));
        } finally {
          if (mongoose.connection.readyState !== 0) {
            await mongoose.disconnect();
          }
        }
      `;

      const stdout = execFileSync(
        process.execPath,
        ["--input-type=module", "-e", childCode, TEST_DB_URI, serviceId],
        {
          cwd: serverRootDir,
          encoding: "utf8",
          env: {
            ...process.env,
            NODE_ENV: "development",
            MONGODB_URI: TEST_DB_URI
          }
        }
      );

      const parsed = JSON.parse(stdout.trim());
      expect(parsed.success).toBe(true);

      const childState = parsed.state;
      expect(childState).not.toBeNull();
      expect(childState.serviceId).toBe(serviceId);
      expect(childState.isActive).toBe(false);
      expect(childState.credentialVersion).toBe(3); // created(1) -> disable(+1) -> rotate(+1) = 3
      expect(childState.tenantId).toBe("sh_multiprocess_tenant");
      expect(childState.scopes).toEqual(["READ_STORE_EVIDENCE"]);
      expect(childState.scopes).not.toContain("PROPOSE_ACTION");
    }
  );

  it.skipIf(!isMongoAvailable)(
    "8. verifies production requests fail closed (503) when the authoritative persistent datastore is unavailable",
    async () => {
      const prevEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      // Disconnect DB to simulate outage in production
      await mongoose.disconnect();
      clearInMemoryServices();

      try {
        await expect(
          authenticateServiceCredential({
            serviceId: "svc_payment_controller",
            clientSecret: "any-secret"
          })
        ).rejects.toThrow(/datastore unavailable in production: failing closed/i);

        await expect(
          getServiceAuthorizationState("svc_payment_controller")
        ).rejects.toThrow(/datastore unavailable in production: failing closed/i);
      } finally {
        process.env.NODE_ENV = prevEnv;
        await mongoose.connect(TEST_DB_URI);
      }
    }
  );

  it.skipIf(!isMongoAvailable)(
    "9. verifies plaintext service secrets are never stored or logged in MongoDB records",
    async () => {
      const serviceId = generateTestServiceId("plaintext");
      const plaintextSecret = "super-confidential-secret-plaintext-audit-value-9999!";

      await registerServicePrincipal({
        serviceId,
        secret: plaintextSecret,
        role: ROLES.SHOP_AI,
        tenantId: "sh_plaintext_audit_tenant"
      });

      // Query raw MongoDB document
      const doc = await ServicePrincipal.findOne({ serviceId }).lean();
      expect(doc).not.toBeNull();

      const serialized = JSON.stringify(doc);

      // Secret must NEVER be present anywhere in the document
      expect(serialized).not.toContain(plaintextSecret);
      expect(doc.secret).toBeUndefined();
      expect(doc.clientSecret).toBeUndefined();
      expect(doc.password).toBeUndefined();

      // Must store scrypt hash and salt
      expect(doc.credentialHash).toBeDefined();
      expect(doc.credentialHash.length).toBe(128); // 64 bytes in hex
      expect(doc.credentialSalt).toBeDefined();
      expect(doc.credentialSalt.length).toBe(32); // 16 bytes in hex
    }
  );

  it.skipIf(!isMongoAvailable)(
    "10. cleans up only test records created by this suite and leaves other principals intact",
    async () => {
      const cleanupId = generateTestServiceId("cleanup");
      await registerServicePrincipal({
        serviceId: cleanupId,
        secret: "cleanup-test-secret-111",
        role: ROLES.SHOP_AI,
        tenantId: "sh_cleanup_tenant"
      });

      // Document exists before cleanup
      const beforeDoc = await ServicePrincipal.findOne({ serviceId: cleanupId }).lean();
      expect(beforeDoc).not.toBeNull();

      // Perform selective cleanup of tracked test records
      const deleteResult = await ServicePrincipal.deleteMany({
        serviceId: { $in: Array.from(trackedServiceIds) }
      });
      expect(deleteResult.deletedCount).toBeGreaterThanOrEqual(1);

      // Cleaned document is gone
      const afterDoc = await ServicePrincipal.findOne({ serviceId: cleanupId }).lean();
      expect(afterDoc).toBeNull();

      // Default service principals remain completely intact
      const defaultDoc = await ServicePrincipal.findOne({ serviceId: "svc_payment_controller" }).lean();
      expect(defaultDoc).not.toBeNull();
    }
  );
});
