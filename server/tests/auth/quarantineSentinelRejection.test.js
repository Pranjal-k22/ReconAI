import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../../src/app.js";
import { provisionUserAccount, updateUserAuthorization } from "../../src/services/auth/accountService.js";
import { registerServicePrincipal } from "../../src/services/auth/serviceRegistry.js";
import { signUserToken, signServiceToken, verifyToken, ROLES } from "../../src/services/auth/tokenService.js";
import { getEnv } from "../../src/config/env.js";
import * as paymentCaseService from "../../src/services/ledger/paymentCaseService.js";

describe("Quarantine Sentinel Tenant Hardening", () => {
  const SENTINEL_TENANT = "unassigned_provider_quarantine";
  let adminToken;

  beforeEach(() => {
    adminToken = signUserToken({
      userId: "admin-quarantine-tester",
      role: ROLES.ADMIN,
      tenantId: null
    });
  });

  describe("1. Account Provisioning Rejection", () => {
    it("rejects provisionUserAccount with sentinel tenantId with 400 Bad Request", async () => {
      await expect(
        provisionUserAccount({
          userId: "user-sentinel-01",
          email: "sentinel01@example.com",
          password: "SecurePassword123!",
          role: ROLES.SHOP,
          tenantId: SENTINEL_TENANT
        })
      ).rejects.toThrow(/protected internal quarantine sentinel/i);
    });
  });

  describe("2. Authorization Update Rejection", () => {
    it("rejects updateUserAuthorization with sentinel tenantId with 400 Bad Request", async () => {
      // First provision valid user
      await provisionUserAccount({
        userId: "user-valid-for-update",
        email: "validupdate@example.com",
        password: "SecurePassword123!",
        role: ROLES.SHOP,
        tenantId: "tenant_valid_01"
      });

      await expect(
        updateUserAuthorization("user-valid-for-update", {
          tenantId: SENTINEL_TENANT
        })
      ).rejects.toThrow(/protected internal quarantine sentinel/i);
    });
  });

  describe("3. Service Principal Registration Rejection", () => {
    it("rejects registerServicePrincipal with sentinel tenantId with 400 Bad Request", async () => {
      await expect(
        registerServicePrincipal({
          serviceId: "sp-sentinel-01",
          secret: "ValidSecret12345!A",
          role: ROLES.SHOP_AI,
          tenantId: SENTINEL_TENANT
        })
      ).rejects.toThrow(/protected internal quarantine sentinel/i);
    });
  });

  describe("4. Token Claims Rejection", () => {
    it("rejects signUserToken claiming sentinel tenantId with 400 Bad Request", () => {
      expect(() =>
        signUserToken({
          userId: "user-token-sentinel",
          role: ROLES.SHOP,
          tenantId: SENTINEL_TENANT
        })
      ).toThrow(/protected internal quarantine sentinel/i);
    });

    it("rejects signServiceToken claiming sentinel tenantId with 400 Bad Request", () => {
      expect(() =>
        signServiceToken({
          serviceId: "service-token-sentinel",
          role: ROLES.SHOP_AI,
          tenantId: SENTINEL_TENANT
        })
      ).toThrow(/protected internal quarantine sentinel/i);
    });

    it("rejects verifyToken when decoding a token carrying sentinel tenantId with 401 Unauthorized", () => {
      const env = getEnv();
      // Forge a signed token carrying sentinel tenantId
      const forgedToken = jwt.sign(
        {
          sub: "forged-sentinel-user",
          identityType: "HUMAN",
          role: ROLES.SHOP,
          tenantId: SENTINEL_TENANT,
          jti: "forged-jti-001"
        },
        env.JWT_SECRET,
        {
          algorithm: "HS256",
          expiresIn: "1h",
          issuer: env.JWT_ISSUER,
          audience: env.JWT_AUDIENCE
        }
      );

      expect(() => verifyToken(forgedToken)).toThrow(/quarantine sentinel/i);
    });
  });

  describe("5. ADMIN Query with Sentinel Tenant Filter Behavior", () => {
    it("scopes query to sentinel tenant filter and returns empty results (no cases under quarantine sentinel)", async () => {
      let passedFilter = null;
      vi.spyOn(paymentCaseService, "listPaymentCases").mockImplementation(async (filter) => {
        passedFilter = filter;
        return {
          cases: [],
          pagination: { page: 1, limit: 50, total: 0, pages: 0 }
        };
      });

      const res = await request(app)
        .get(`/api/payment-cases?tenantId=${SENTINEL_TENANT}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(passedFilter).toBeDefined();
      expect(passedFilter.tenantId).toBe(SENTINEL_TENANT);
      expect(res.body.data.cases).toEqual([]);
      expect(res.body.data.pagination.total).toBe(0);
    });
  });
});
