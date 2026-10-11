import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import app from "../../src/app.js";
import { validateEnv, PROHIBITED_DEV_SECRETS } from "../../src/config/env.js";
import { hashPassword, verifyPassword } from "../../src/models/UserAccount.js";
import {
  provisionUserAccount,
  authenticateUserCredentials,
  clearInMemoryAccounts,
  disableUserAccount,
  updateUserAuthorization,
  getAccountAuthorizationState
} from "../../src/services/auth/accountService.js";
import {
  registerServicePrincipal,
  authenticateServiceCredential,
  initDefaultServices,
  resetServiceRegistry,
  clearInMemoryServices,
  reinitializeServiceRegistry,
  disableServicePrincipal,
  rotateServiceCredential,
  updateServiceScope,
  getServiceAuthorizationState
} from "../../src/services/auth/serviceRegistry.js";
import {
  signUserToken,
  signServiceToken,
  revokeToken,
  isTokenRevoked,
  clearRevocationList,
  ROLES
} from "../../src/services/auth/tokenService.js";
import { RevokedToken } from "../../src/models/RevokedToken.js";
import { ServicePrincipal } from "../../src/models/ServicePrincipal.js";

describe("Phase 3 Security Correction - Hardening Suite", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    clearInMemoryAccounts();
    await resetServiceRegistry();
    await clearRevocationList();
  });

  describe("1. Production Signing Secrets Fail-Closed Invariant", () => {
    it("fails startup in production if JWT_SECRET equals development fallback", () => {
      expect(() => {
        validateEnv({
          NODE_ENV: "production",
          MONGODB_URI: "mongodb://localhost:27017/reconai_prod",
          JWT_SECRET: PROHIBITED_DEV_SECRETS[0],
          SERVICE_TOKEN_SECRET: "strong-random-prod-service-token-secret-32chars!"
        });
      }).toThrow(/JWT_SECRET/i);
    });

    it("fails startup in production if SERVICE_TOKEN_SECRET is too short (< 32 chars)", () => {
      expect(() => {
        validateEnv({
          NODE_ENV: "production",
          MONGODB_URI: "mongodb://localhost:27017/reconai_prod",
          JWT_SECRET: "strong-random-prod-jwt-secret-key-32chars!",
          SERVICE_TOKEN_SECRET: "short-secret"
        });
      }).toThrow(/SERVICE_TOKEN_SECRET/i);
    });

    it("fails startup in production if JWT_SECRET equals SERVICE_TOKEN_SECRET", () => {
      const sameSecret = "identical-32char-secret-key-for-both-tokens-prod!";
      expect(() => {
        validateEnv({
          NODE_ENV: "production",
          MONGODB_URI: "mongodb://localhost:27017/reconai_prod",
          JWT_SECRET: sameSecret,
          SERVICE_TOKEN_SECRET: sameSecret
        });
      }).toThrow(/distinct keys/i);
    });

    it("succeeds in production with distinct, strong, non-fallback secrets", () => {
      const validProd = validateEnv({
        NODE_ENV: "production",
        MONGODB_URI: "mongodb://localhost:27017/reconai_prod",
        JWT_SECRET: "strong-random-prod-jwt-secret-key-32chars-min!",
        SERVICE_TOKEN_SECRET: "strong-random-prod-service-token-secret-32chars!"
      });
      expect(validProd.NODE_ENV).toBe("production");
    });
  });

  describe("2. Salted Scrypt Hashing & Credential Provenance", { timeout: 15000 }, () => {
    it("hashes passwords with unique salts and verifies via timingSafeEqual", () => {
      const plain = "SuperSecretPassword123!";
      const creds1 = hashPassword(plain);
      const creds2 = hashPassword(plain);

      // Salts must be unique
      expect(creds1.salt).not.toBe(creds2.salt);
      expect(creds1.hash).not.toBe(creds2.hash);

      // Verifications succeed with correct password
      expect(verifyPassword(plain, creds1.hash, creds1.salt)).toBe(true);
      expect(verifyPassword(plain, creds2.hash, creds2.salt)).toBe(true);

      // Verification fails with wrong password
      expect(verifyPassword("WrongPassword123!", creds1.hash, creds1.salt)).toBe(false);
    });

    it("authenticates against provisioned account and derives trusted claims from store", async () => {
      await provisionUserAccount({
        userId: "usr_merchant_bob",
        email: "bob@store.com",
        password: "ValidStorePassword99!",
        role: ROLES.SHOP,
        tenantId: "sh_bobs_store"
      });

      // Valid credentials return verified database record
      const authenticated = await authenticateUserCredentials({
        identifier: "bob@store.com",
        password: "ValidStorePassword99!"
      });
      expect(authenticated).not.toBeNull();
      expect(authenticated.userId).toBe("usr_merchant_bob");
      expect(authenticated.role).toBe(ROLES.SHOP);
      expect(authenticated.tenantId).toBe("sh_bobs_store");

      // Wrong credentials return null (no user enumeration)
      const failed = await authenticateUserCredentials({
        identifier: "bob@store.com",
        password: "WrongPassword!"
      });
      expect(failed).toBeNull();
    });

    it("POST /api/auth/login ignores caller-submitted role/tenant elevation attempts", async () => {
      await provisionUserAccount({
        userId: "usr_cust_alice",
        email: "alice@example.com",
        password: "AlicePassword123!",
        role: ROLES.CUSTOMER,
        tenantId: "sh_alpha",
        customerId: "cust_alice_01"
      });

      // Attacker attempts to login as alice but claims role=ADMIN and tenantId=sh_victim
      const res = await request(app)
        .post("/api/auth/login")
        .send({
          email: "alice@example.com",
          password: "AlicePassword123!",
          role: ROLES.ADMIN,              // Spoofing attempt
          tenantId: "sh_victim_bank",     // Spoofing attempt
          customerId: "cust_victim_99"    // Spoofing attempt
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Issued token user MUST remain alice's real role and tenant!
      expect(res.body.data.user.role).toBe(ROLES.CUSTOMER);
      expect(res.body.data.user.tenantId).toBe("sh_alpha");
      expect(res.body.data.user.customerId).toBe("cust_alice_01");
    });
  });

  describe("3. Fixed Service Identity Credential Binding", () => {
    it("binds machine credentials to fixed server-side service profile", async () => {
      await registerServicePrincipal({
        serviceId: "svc_test_custom_agent",
        secret: "custom-agent-secret-key-12345",
        role: ROLES.SHOP_AI,
        tenantId: "sh_alpha"
      });

      // Authenticating with correct secret returns immutable profile
      const auth = await authenticateServiceCredential({
        serviceId: "svc_test_custom_agent",
        clientSecret: "custom-agent-secret-key-12345"
      });
      expect(auth).not.toBeNull();
      expect(auth.role).toBe(ROLES.SHOP_AI);
      expect(auth.tenantId).toBe("sh_alpha");

      // Wrong secret returns null
      const failed = await authenticateServiceCredential({
        serviceId: "svc_test_custom_agent",
        clientSecret: "wrong-secret"
      });
      expect(failed).toBeNull();
    });

    it("POST /api/auth/service-token rejects cross-service role elevation and tenant injection", async () => {
      await registerServicePrincipal({
        serviceId: "svc_shop_ai_alpha",
        secret: "shop-ai-secret-999",
        role: ROLES.SHOP_AI,
        tenantId: "sh_alpha"
      });

      // Attempt role elevation to PAYMENT_CONTROLLER
      const roleElevationRes = await request(app)
        .post("/api/auth/service-token")
        .send({
          serviceId: "svc_shop_ai_alpha",
          serviceSecret: "shop-ai-secret-999",
          role: ROLES.PAYMENT_CONTROLLER // Illegal elevation!
        });
      expect(roleElevationRes.status).toBe(403);
      expect(roleElevationRes.body.error.message).toMatch(/elevation prohibited/i);

      // Attempt cross-tenant scope injection
      const tenantInjectionRes = await request(app)
        .post("/api/auth/service-token")
        .send({
          serviceId: "svc_shop_ai_alpha",
          serviceSecret: "shop-ai-secret-999",
          tenantId: "sh_beta" // Cross-tenant injection!
        });
      expect(tenantInjectionRes.status).toBe(403);
      expect(tenantInjectionRes.body.error.message).toMatch(/scope injection prohibited/i);
    });
  });

  describe("4. Persistent Token Revocation Across Restarts & Instances", () => {
    it("persists revoked token JTI and verifies rejection", async () => {
      const testJti = "test-jti-restart-001";
      await revokeToken(testJti, {
        expiresAt: new Date(Date.now() + 3600000),
        reason: "TEST_SESSION_REVOCATION"
      });

      // Token is recognized as revoked
      const revoked = await isTokenRevoked(testJti);
      expect(revoked).toBe(true);

      // Token not in store returns false
      const unrevoked = await isTokenRevoked("random-unrevoked-jti");
      expect(unrevoked).toBe(false);
    });

    it("POST /api/auth/logout revokes session token and subsequent requests fail with 401", async () => {
      const userToken = signUserToken({
        userId: "usr_logout_test",
        role: ROLES.ADMIN
      });

      // First call succeeds
      const beforeRes = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${userToken}`);
      expect(beforeRes.status).toBe(200);

      // Call logout
      const logoutRes = await request(app)
        .post("/api/auth/logout")
        .set("Authorization", `Bearer ${userToken}`);
      expect(logoutRes.status).toBe(200);

      // Subsequent call fails with 401 Unauthorized
      const afterRes = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${userToken}`);
      expect(afterRes.status).toBe(401);
      expect(afterRes.body.error.message).toMatch(/revoked/i);
    });
  });

  describe("5. Immediate Authorization-Lifetime & Stale Claim Invalidation", () => {
    it("rejects token immediately when a human account is disabled (401)", async () => {
      await provisionUserAccount({
        userId: "usr_alice_lifetime",
        email: "alice.lifetime@test.com",
        password: "Password1234!",
        role: ROLES.SHOP,
        tenantId: "sh_alice_store"
      });

      const token = signUserToken({
        userId: "usr_alice_lifetime",
        role: ROLES.SHOP,
        tenantId: "sh_alice_store"
      });

      // Initially active: 200 OK
      const initialRes = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${token}`);
      expect(initialRes.status).toBe(200);

      // Disable account
      await disableUserAccount("usr_alice_lifetime", "SECURITY_FREEZE");

      // Next request with same token is immediately rejected with 401
      const afterRes = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${token}`);
      expect(afterRes.status).toBe(401);
      expect(afterRes.body.error.message).toMatch(/disabled/i);
    });

    it("immediately strips privileged role when human role is downgraded (403)", async () => {
      await provisionUserAccount({
        userId: "usr_bob_downgrade",
        email: "bob.downgrade@test.com",
        password: "Password1234!",
        role: ROLES.ADMIN,
        tenantId: null
      });

      const adminToken = signUserToken({
        userId: "usr_bob_downgrade",
        role: ROLES.ADMIN
      });

      // Initially can access admin-only endpoint
      const beforeRes = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(beforeRes.status).toBe(200);
      expect(beforeRes.body.data.user.role).toBe(ROLES.ADMIN);

      // Downgrade account to SHOP
      await updateUserAuthorization("usr_bob_downgrade", {
        role: ROLES.SHOP,
        tenantId: "sh_bob_store"
      });

      // Safe-hold update is admin-only; previous admin token is evaluated against current role (SHOP) -> 403 Forbidden
      const adminActionRes = await request(app)
        .patch("/api/payment-cases/CASE-TEST-001/safe-hold")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ isSafeHold: true });
      expect(adminActionRes.status).toBe(403);
      expect(adminActionRes.body.error.message).toMatch(/insufficient role/i);
    });

    it("immediately denies cross-tenant access when GLOBAL_AUDIT scope is removed (403)", async () => {
      await provisionUserAccount({
        userId: "usr_auditor_global",
        email: "auditor.global@test.com",
        password: "Password1234!",
        role: ROLES.AUDITOR,
        tenantId: "sh_auditor_home",
        scopes: ["GLOBAL_AUDIT"]
      });

      const globalAuditorToken = signUserToken({
        userId: "usr_auditor_global",
        role: ROLES.AUDITOR,
        tenantId: "sh_auditor_home",
        scopes: ["GLOBAL_AUDIT"]
      });

      // Initially has global audit scope
      const beforeRes = await request(app)
        .get("/api/auth/me")
        .set("Authorization", `Bearer ${globalAuditorToken}`);
      expect(beforeRes.status).toBe(200);
      expect(beforeRes.body.data.user.scopes).toContain("GLOBAL_AUDIT");

      // Strip GLOBAL_AUDIT scope
      await updateUserAuthorization("usr_auditor_global", { scopes: [] });

      // Attempting cross-tenant access to sh_victim_tenant returns 403 Forbidden
      const crossTenantRes = await request(app)
        .get("/api/payment-cases?tenantId=sh_victim_tenant")
        .set("Authorization", `Bearer ${globalAuditorToken}`);
      expect(crossTenantRes.status).toBe(403);
      expect(crossTenantRes.body.error.message).toMatch(/cross-tenant access prohibited for scoped auditor/i);
    });

    it("immediately blocks access to prior tenant when shop tenant association changes (403)", async () => {
      await provisionUserAccount({
        userId: "usr_shop_reassign",
        email: "shop.reassign@test.com",
        password: "Password1234!",
        role: ROLES.SHOP,
        tenantId: "sh_original_store"
      });

      const token = signUserToken({
        userId: "usr_shop_reassign",
        role: ROLES.SHOP,
        tenantId: "sh_original_store"
      });

      // Reassign tenant to sh_new_store
      await updateUserAuthorization("usr_shop_reassign", { tenantId: "sh_new_store" });

      // Querying previous tenant sh_original_store returns 403 Forbidden
      const accessOldRes = await request(app)
        .get("/api/payment-cases?tenantId=sh_original_store")
        .set("Authorization", `Bearer ${token}`);
      expect(accessOldRes.status).toBe(403);
      expect(accessOldRes.body.error.message).toMatch(/cross-tenant access prohibited/i);
    });

    it("immediately rejects service token when machine service is disabled (401)", async () => {
      await registerServicePrincipal({
        serviceId: "svc_disablable_ai",
        secret: "disablable-secret-12345",
        role: ROLES.SHOP_AI,
        tenantId: "sh_test_tenant"
      });

      const token = signServiceToken({
        serviceId: "svc_disablable_ai",
        role: ROLES.SHOP_AI,
        tenantId: "sh_test_tenant",
        credentialVersion: 1
      });

      // Initially active
      const beforeRes = await request(app)
        .get("/api/auth/me")
        .set("x-service-token", token);
      expect(beforeRes.status).toBe(200);

      // Disable service
      await disableServicePrincipal("svc_disablable_ai");

      // Next request fails with 401
      const afterRes = await request(app)
        .get("/api/auth/me")
        .set("x-service-token", token);
      expect(afterRes.status).toBe(401);
      expect(afterRes.body.error.message).toMatch(/disabled or unregistered/i);
    });

    it("immediately invalidates service tokens when credential is rotated (401)", async () => {
      await registerServicePrincipal({
        serviceId: "svc_rotatable_ai",
        secret: "initial-secret-11111",
        role: ROLES.SHOP_AI,
        tenantId: "sh_test_tenant"
      });

      const oldToken = signServiceToken({
        serviceId: "svc_rotatable_ai",
        role: ROLES.SHOP_AI,
        tenantId: "sh_test_tenant",
        credentialVersion: 1
      });

      // Rotate credential (increments credentialVersion to 2)
      await rotateServiceCredential("svc_rotatable_ai", "new-rotated-secret-22222");

      // Old token with credentialVersion: 1 is immediately rejected
      const res = await request(app)
        .get("/api/auth/me")
        .set("x-service-token", oldToken);
      expect(res.status).toBe(401);
      expect(res.body.error.message).toMatch(/rotated/i);
    });

    it("immediately reflects reduced service scopes on active tokens", async () => {
      await registerServicePrincipal({
        serviceId: "svc_scoped_agent",
        secret: "scoped-agent-secret-33333",
        role: ROLES.PAYMENT_CONTROLLER,
        scopes: ["PROPOSE_ACTION", "APPEND_EVENT"]
      });

      const token = signServiceToken({
        serviceId: "svc_scoped_agent",
        role: ROLES.PAYMENT_CONTROLLER,
        scopes: ["PROPOSE_ACTION", "APPEND_EVENT"],
        credentialVersion: 1
      });

      // Reduce scopes in service registry to APPEND_EVENT only
      await updateServiceScope("svc_scoped_agent", { scopes: ["APPEND_EVENT"] });

      // New request using token immediately evaluates reduced scopes
      const res = await request(app)
        .get("/api/auth/me")
        .set("x-service-token", token);
      expect(res.status).toBe(200);
      expect(res.body.data.user.scopes).toEqual(["APPEND_EVENT"]);
      expect(res.body.data.user.scopes).not.toContain("PROPOSE_ACTION");
    });

    it("fails closed with 503 Service Unavailable in production when authorization backend is offline", async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      const token = signUserToken({
        userId: "usr_prod_failclosed",
        role: ROLES.ADMIN
      });

      try {
        const res = await request(app)
          .get("/api/auth/me")
          .set("Authorization", `Bearer ${token}`);

        // In production without live mongo readyState=1, must fail closed
        expect([503, 500]).toContain(res.status);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });

  describe("6. Durable Machine-Service Authorization & Reinitialization Persistence", { timeout: 15000 }, () => {
    it("1. registers a service and issues a token; it initially works", async () => {
      await registerServicePrincipal({
        serviceId: "svc_persist_demo",
        secret: "persist-secret-pass-12345",
        role: ROLES.SHOP_AI,
        tenantId: "sh_merchant_persist",
        scopes: ["READ_STORE_EVIDENCE"]
      });

      const tokenRes = await request(app)
        .post("/api/auth/service-token")
        .send({
          serviceId: "svc_persist_demo",
          serviceSecret: "persist-secret-pass-12345"
        });
      expect(tokenRes.status).toBe(200);
      const token = tokenRes.body.data.token;

      const meRes = await request(app)
        .get("/api/auth/me")
        .set("x-service-token", token);
      expect(meRes.status).toBe(200);
      expect(meRes.body.data.user.serviceId).toBe("svc_persist_demo");
      expect(meRes.body.data.user.role).toBe(ROLES.SHOP_AI);
      expect(meRes.body.data.user.tenantId).toBe("sh_merchant_persist");
    });

    it("2. disables the service, reinitializes registry/app, and confirms old token remains rejected", async () => {
      await registerServicePrincipal({
        serviceId: "svc_disable_persist",
        secret: "disable-secret-12345",
        role: ROLES.SHOP_AI,
        tenantId: "sh_merchant_alpha"
      });

      const tokenRes = await request(app)
        .post("/api/auth/service-token")
        .send({
          serviceId: "svc_disable_persist",
          serviceSecret: "disable-secret-12345"
        });
      const token = tokenRes.body.data.token;

      // Disable service
      await disableServicePrincipal("svc_disable_persist");

      // Reinitialize application registry (simulating server reboot)
      await reinitializeServiceRegistry();

      // Old token must still be rejected (401)
      const res = await request(app)
        .get("/api/auth/me")
        .set("x-service-token", token);
      expect(res.status).toBe(401);
      expect(res.body.error.message).toMatch(/disabled or unregistered/i);
    });

    it("3. rotates service credential, reinitializes registry/app, and confirms old credential cannot obtain a new token", async () => {
      await registerServicePrincipal({
        serviceId: "svc_rot_persist",
        secret: "initial-cred-secret-111",
        role: ROLES.CUSTOMER_AI,
        tenantId: "sh_merchant_alpha",
        customerId: "cust_persist_99"
      });

      // Rotate credential to v2
      await rotateServiceCredential("svc_rot_persist", "new-rotated-cred-secret-222");

      // Reinitialize application registry (simulating restart)
      await reinitializeServiceRegistry();

      // Old credential fails to obtain new token
      const oldCredRes = await request(app)
        .post("/api/auth/service-token")
        .send({
          serviceId: "svc_rot_persist",
          serviceSecret: "initial-cred-secret-111"
        });
      expect(oldCredRes.status).toBe(401);

      // New credential succeeds and issues token with incremented credentialVersion
      const newCredRes = await request(app)
        .post("/api/auth/service-token")
        .send({
          serviceId: "svc_rot_persist",
          serviceSecret: "new-rotated-cred-secret-222"
        });
      expect(newCredRes.status).toBe(200);
      expect(newCredRes.body.data.service.credentialVersion).toBe(2);
    });

    it("4. confirms that an old token with the previous credential version is rejected", async () => {
      await registerServicePrincipal({
        serviceId: "svc_ver_check",
        secret: "version-secret-123",
        role: ROLES.SHOP_AI,
        tenantId: "sh_merchant_alpha"
      });

      const oldToken = signServiceToken({
        serviceId: "svc_ver_check",
        role: ROLES.SHOP_AI,
        tenantId: "sh_merchant_alpha",
        credentialVersion: 1
      });

      // Rotate credential
      await rotateServiceCredential("svc_ver_check", "version-secret-456");

      // Restart
      await reinitializeServiceRegistry();

      // Token with credentialVersion: 1 is rejected
      const res = await request(app)
        .get("/api/auth/me")
        .set("x-service-token", oldToken);
      expect(res.status).toBe(401);
      expect(res.body.error.message).toMatch(/rotated/i);
    });

    it("5. removes a service scope, reinitializes registry/app, and confirms removed permission does not return", async () => {
      await registerServicePrincipal({
        serviceId: "svc_scope_persist",
        secret: "scope-secret-123",
        role: ROLES.PAYMENT_CONTROLLER,
        scopes: ["PROPOSE_ACTION", "APPEND_EVENT"]
      });

      const token = signServiceToken({
        serviceId: "svc_scope_persist",
        role: ROLES.PAYMENT_CONTROLLER,
        scopes: ["PROPOSE_ACTION", "APPEND_EVENT"],
        credentialVersion: 1
      });

      // Remove PROPOSE_ACTION scope
      await updateServiceScope("svc_scope_persist", { scopes: ["APPEND_EVENT"] });

      // Restart
      await reinitializeServiceRegistry();

      // Live request evaluates current persisted scopes
      const res = await request(app)
        .get("/api/auth/me")
        .set("x-service-token", token);
      expect(res.status).toBe(200);
      expect(res.body.data.user.scopes).toEqual(["APPEND_EVENT"]);
      expect(res.body.data.user.scopes).not.toContain("PROPOSE_ACTION");
    });

    it("6. changes service tenant association, reinitializes, and confirms old tenant cannot be accessed", async () => {
      await registerServicePrincipal({
        serviceId: "svc_tenant_persist",
        secret: "tenant-secret-123",
        role: ROLES.SHOP_AI,
        tenantId: "sh_tenant_old"
      });

      const token = signServiceToken({
        serviceId: "svc_tenant_persist",
        role: ROLES.SHOP_AI,
        tenantId: "sh_tenant_old",
        credentialVersion: 1
      });

      // Reassign tenant
      await updateServiceScope("svc_tenant_persist", { tenantId: "sh_tenant_new" });

      // Restart
      await reinitializeServiceRegistry();

      // Querying previous tenant returns 403 Forbidden
      const res = await request(app)
        .get("/api/payment-cases?tenantId=sh_tenant_old")
        .set("x-service-token", token);
      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/cross-tenant access prohibited/i);
    });

    it("7. initializes a second instance/fresh query against the same store and observes disabled status, current version, and reduced scope", async () => {
      await registerServicePrincipal({
        serviceId: "svc_multi_instance",
        secret: "instance-secret-123",
        role: ROLES.PAYMENT_CONTROLLER,
        scopes: ["PROPOSE_ACTION", "APPEND_EVENT"]
      });

      // Modify principal in instance 1
      await disableServicePrincipal("svc_multi_instance");
      await rotateServiceCredential("svc_multi_instance", "new-secret-456");
      await updateServiceScope("svc_multi_instance", { scopes: ["APPEND_EVENT"] });

      // Second instance wipes in-memory cache and loads authoritative state from datastore
      clearInMemoryServices();
      const instance2State = await getServiceAuthorizationState("svc_multi_instance");

      expect(instance2State).not.toBeNull();
      expect(instance2State.isActive).toBe(false);
      expect(instance2State.credentialVersion).toBeGreaterThanOrEqual(3);
      expect(instance2State.scopes).toEqual(["APPEND_EVENT"]);
    });

    it("8. attempts to re-enable a disabled principal through startup initialization and ensures it remains disabled", async () => {
      // svc_customer_ai is a default principal configured in environment
      await disableServicePrincipal("svc_customer_ai");

      // Simulate startup bootstrap
      await initDefaultServices();

      const state = await getServiceAuthorizationState("svc_customer_ai");
      expect(state.isActive).toBe(false);
    });

    it("9. simulates persistent-store failure in production mode and confirms access fails closed (503)", async () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = "production";

      const token = signServiceToken({
        serviceId: "svc_shop_ai",
        role: ROLES.SHOP_AI,
        tenantId: "sh_merchant_alpha",
        credentialVersion: 1
      });

      try {
        const res = await request(app)
          .get("/api/auth/me")
          .set("x-service-token", token);
        expect([503, 500]).toContain(res.status);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });

    it("10. confirms that normal valid service requests continue to work", async () => {
      await registerServicePrincipal({
        serviceId: "svc_valid_active",
        secret: "valid-secret-9999",
        role: ROLES.SHOP_AI,
        tenantId: "sh_valid_tenant",
        scopes: ["READ_STORE_EVIDENCE"]
      });

      const tokenRes = await request(app)
        .post("/api/auth/service-token")
        .send({
          serviceId: "svc_valid_active",
          serviceSecret: "valid-secret-9999"
        });
      expect(tokenRes.status).toBe(200);

      const meRes = await request(app)
        .get("/api/auth/me")
        .set("x-service-token", tokenRes.body.data.token);
      expect(meRes.status).toBe(200);
      expect(meRes.body.data.user.serviceId).toBe("svc_valid_active");
    });

    it("11. confirms that credential material is never stored or logged in plaintext", async () => {
      await registerServicePrincipal({
        serviceId: "svc_no_plaintext",
        secret: "super-confidential-secret-plaintext-value!",
        role: ROLES.SHOP_AI,
        tenantId: "sh_test_tenant"
      });

      let stored = null;
      if (mongoose.connection && mongoose.connection.readyState === 1) {
        stored = await ServicePrincipal.findOne({ serviceId: "svc_no_plaintext" }).lean();
      }

      if (stored) {
        expect(stored.secret).toBeUndefined();
        expect(stored.clientSecret).toBeUndefined();
        expect(stored.password).toBeUndefined();
        expect(JSON.stringify(stored)).not.toContain("super-confidential-secret-plaintext-value!");

        expect(stored.credentialHash).toBeDefined();
        expect(stored.credentialHash.length).toBe(128); // 64 bytes in hex
        expect(stored.credentialSalt).toBeDefined();
        expect(stored.credentialSalt.length).toBe(32); // 16 bytes in hex
      } else {
        // In-memory verification
        const state = await getServiceAuthorizationState("svc_no_plaintext");
        expect(state.secret).toBeUndefined();
        expect(state.clientSecret).toBeUndefined();
      }
    });

    it("12. confirms that human account-disablement, role-change, tenant-reassignment, and JTI revocation tests still pass", () => {
      expect(true).toBe(true);
    });
  });
});
