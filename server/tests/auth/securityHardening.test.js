import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import app from "../../src/app.js";
import { validateEnv, PROHIBITED_DEV_SECRETS } from "../../src/config/env.js";
import { hashPassword, verifyPassword } from "../../src/models/UserAccount.js";
import {
  provisionUserAccount,
  authenticateUserCredentials,
  clearInMemoryAccounts
} from "../../src/services/auth/accountService.js";
import {
  registerServicePrincipal,
  authenticateServiceCredential,
  resetServiceRegistry
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

describe("Phase 3 Security Correction - Hardening Suite", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    clearInMemoryAccounts();
    resetServiceRegistry();
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
    it("binds machine credentials to fixed server-side service profile", () => {
      registerServicePrincipal({
        serviceId: "svc_test_custom_agent",
        secret: "custom-agent-secret-key-12345",
        role: ROLES.SHOP_AI,
        tenantId: "sh_alpha"
      });

      // Authenticating with correct secret returns immutable profile
      const auth = authenticateServiceCredential({
        serviceId: "svc_test_custom_agent",
        clientSecret: "custom-agent-secret-key-12345"
      });
      expect(auth).not.toBeNull();
      expect(auth.role).toBe(ROLES.SHOP_AI);
      expect(auth.tenantId).toBe("sh_alpha");

      // Wrong secret returns null
      const failed = authenticateServiceCredential({
        serviceId: "svc_test_custom_agent",
        clientSecret: "wrong-secret"
      });
      expect(failed).toBeNull();
    });

    it("POST /api/auth/service-token rejects cross-service role elevation and tenant injection", async () => {
      registerServicePrincipal({
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
});
