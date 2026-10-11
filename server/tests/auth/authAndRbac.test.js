import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import app from "../../src/app.js";
import { getEnv } from "../../src/config/env.js";
import {
  signUserToken,
  signServiceToken,
  revokeToken,
  clearRevocationList,
  ROLES,
  IDENTITY_TYPES
} from "../../src/services/auth/tokenService.js";
import * as reconciliationService from "../../src/services/reconciliation/reconciliationService.js";
import * as auditService from "../../src/services/audit/auditService.js";

describe("Phase 3 - Authentication & RBAC Verification Suite", () => {
  const env = getEnv();

  beforeEach(() => {
    clearRevocationList();
  });

  const getAdminToken = () =>
    signUserToken({
      userId: "usr_admin_01",
      role: ROLES.ADMIN
    });

  const getCustomerToken = (customerId = "cust_123", tenantId = "sh_merchant_01") =>
    signUserToken({
      userId: "usr_cust_01",
      role: ROLES.CUSTOMER,
      customerId,
      tenantId
    });

  const getShopToken = (tenantId = "sh_merchant_01") =>
    signUserToken({
      userId: "usr_shop_01",
      role: ROLES.SHOP,
      tenantId
    });

  const getAuditorToken = () =>
    signUserToken({
      userId: "usr_auditor_01",
      role: ROLES.AUDITOR
    });

  const getControllerServiceToken = () =>
    signServiceToken({
      serviceId: "svc_payment_controller",
      role: ROLES.PAYMENT_CONTROLLER
    });

  const getCustomerAiToken = (customerId = "cust_123", tenantId = "sh_merchant_01") =>
    signServiceToken({
      serviceId: "svc_cust_ai",
      role: ROLES.CUSTOMER_AI,
      customerId,
      tenantId
    });

  const getShopAiToken = (tenantId = "sh_merchant_01") =>
    signServiceToken({
      serviceId: "svc_shop_ai",
      role: ROLES.SHOP_AI,
      tenantId
    });

  // --- 1. Missing credentials on a protected route ---
  it("1. Missing credentials on a protected route returns 401 Unauthorized", async () => {
    const res = await request(app).get("/api/reconciliation/runs");
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  // --- 2. Malformed token ---
  it("2. Malformed token returns 401 Unauthorized", async () => {
    const res = await request(app)
      .get("/api/reconciliation/runs")
      .set("Authorization", "Bearer not-a-valid-jwt-token-string");
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("UNAUTHORIZED");
  });

  // --- 3. Incorrect signature ---
  it("3. Token with incorrect signature returns 401 Unauthorized", async () => {
    const invalidSignatureToken = jwt.sign(
      {
        sub: "usr_fake_admin",
        role: ROLES.ADMIN,
        identityType: IDENTITY_TYPES.HUMAN,
        jti: "test-jti-01"
      },
      "wrong-secret-key-that-does-not-match-env-32chars!",
      {
        algorithm: "HS256",
        expiresIn: "1h",
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE
      }
    );

    const res = await request(app)
      .get("/api/reconciliation/runs")
      .set("Authorization", `Bearer ${invalidSignatureToken}`);
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  // --- 4. Expired token ---
  it("4. Expired token is rejected with 401 Unauthorized", async () => {
    const expiredToken = signUserToken({
      userId: "usr_expired_01",
      role: ROLES.ADMIN,
      expiresIn: "-1s"
    });

    const res = await request(app)
      .get("/api/reconciliation/runs")
      .set("Authorization", `Bearer ${expiredToken}`);
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/expired/i);
  });

  // --- 5. Wrong issuer and audience ---
  it("5. Token with wrong issuer or audience is rejected", async () => {
    const badAudToken = jwt.sign(
      {
        sub: "usr_admin_01",
        role: ROLES.ADMIN,
        identityType: IDENTITY_TYPES.HUMAN,
        jti: "jti-wrong-aud"
      },
      env.JWT_SECRET,
      {
        algorithm: "HS256",
        issuer: env.JWT_ISSUER,
        audience: "wrong-audience-for-another-system"
      }
    );

    const res = await request(app)
      .get("/api/reconciliation/runs")
      .set("Authorization", `Bearer ${badAudToken}`);
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  // --- 6. Rejection of unsigned or unsupported-algorithm tokens ---
  it("6. Unsigned (alg: none) tokens are strictly rejected", async () => {
    // Construct unsigned token: header.payload.
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        sub: "usr_attacker",
        role: ROLES.ADMIN,
        identityType: IDENTITY_TYPES.HUMAN,
        iss: env.JWT_ISSUER,
        aud: env.JWT_AUDIENCE
      })
    ).toString("base64url");
    const unsignedToken = `${header}.${payload}.`;

    const res = await request(app)
      .get("/api/reconciliation/runs")
      .set("Authorization", `Bearer ${unsignedToken}`);
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  // --- 7. Missing mandatory claims ---
  it("7. Token missing mandatory claims (e.g. missing role or identityType) is rejected", async () => {
    const missingClaimsToken = jwt.sign(
      {
        sub: "usr_missing_role",
        jti: "jti-missing-claims"
      },
      env.JWT_SECRET,
      {
        algorithm: "HS256",
        issuer: env.JWT_ISSUER,
        audience: env.JWT_AUDIENCE
      }
    );

    const res = await request(app)
      .get("/api/reconciliation/runs")
      .set("Authorization", `Bearer ${missingClaimsToken}`);
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  // --- 8. Role claims supplied by the client cannot elevate privilege ---
  it("8. Public login endpoint rejects machine/service role elevation attempts", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({
        userId: "hacker_01",
        role: ROLES.PAYMENT_CONTROLLER
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/cannot authenticate via user login/i);
  });

  // --- 9. Revoked credentials are rejected ---
  it("9. Revoked token is rejected with 401 Unauthorized", async () => {
    const token = signUserToken({
      userId: "usr_revoked_01",
      role: ROLES.ADMIN
    });

    const decoded = jwt.decode(token);
    revokeToken(decoded.jti);

    const res = await request(app)
      .get("/api/reconciliation/runs")
      .set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/revoked/i);
  });

  // --- 10. Authentication errors do not leak secrets ---
  it("10. Authentication error responses do not leak secrets or stack traces", async () => {
    const res = await request(app)
      .get("/api/reconciliation/runs")
      .set("Authorization", "Bearer invalid-secret-token");
    expect(res.status).toBe(401);
    expect(JSON.stringify(res.body)).not.toContain(env.JWT_SECRET);
    expect(JSON.stringify(res.body)).not.toContain(env.SERVICE_TOKEN_SECRET);
    expect(res.body.stack).toBeUndefined();
  });

  // --- 11 & 12. CUSTOMER role permissions & boundary ---
  it("11. CUSTOMER cannot access merchant-scoped reconciliation endpoints (403)", async () => {
    const customerToken = getCustomerToken();
    const res = await request(app)
      .get("/api/reconciliation/runs")
      .set("Authorization", `Bearer ${customerToken}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  // --- 13 & 14. SHOP role access & scoping ---
  it("13. SHOP can access permitted reconciliation runs under its tenant scope", async () => {
    vi.spyOn(reconciliationService, "listReconciliationRuns").mockResolvedValue({
      runs: [{ runId: "RUN-SHOP-01", tenantId: "sh_alpha" }],
      pagination: { page: 1, limit: 20, total: 1, pages: 1 }
    });

    const shopToken = getShopToken("sh_alpha");
    const res = await request(app)
      .get("/api/reconciliation/runs")
      .set("Authorization", `Bearer ${shopToken}`);
    // Status 200 (runs list returned)
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("14. SHOP attempting cross-tenant injection is rejected with 403 Forbidden", async () => {
    const shopToken = getShopToken("sh_alpha");
    const res = await request(app)
      .get("/api/reconciliation/runs?tenantId=sh_beta")
      .set("Authorization", `Bearer ${shopToken}`);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  // --- 15. ADMIN requires valid admin identity ---
  it("15. ADMIN identity allows access to system-wide audit and safe-hold reviews", async () => {
    vi.spyOn(auditService, "queryAuditLogs").mockResolvedValue({
      logs: [{ eventId: "AUD-001" }],
      pagination: { page: 1, limit: 50, total: 1, pages: 1 }
    });

    const adminToken = getAdminToken();
    const res = await request(app)
      .get("/api/audit")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // --- 16. AUDITOR is strictly read-only ---
  it("16. AUDITOR write/mutation attempts on payment actions are denied (403)", async () => {
    const auditorToken = getAuditorToken();
    const res = await request(app)
      .post("/api/payment-actions")
      .set("Authorization", `Bearer ${auditorToken}`)
      .send({
        actionId: "ACT-AUDIT-TEST",
        caseId: "CASE-001",
        tenantId: "sh_alpha",
        actionType: "UPDATE_MERCHANT_LOCAL_LEDGER",
        actionStatus: "PROPOSED",
        idempotencyKey: "idemp-audit-01"
      });
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  // --- 17. CUSTOMER_AI cannot use SHOP_AI or ADMIN privileges ---
  it("17. CUSTOMER_AI cannot access admin audit logs (403)", async () => {
    const custAiToken = getCustomerAiToken();
    const res = await request(app)
      .get("/api/audit")
      .set("Authorization", `Bearer ${custAiToken}`);
    expect(res.status).toBe(403);
  });

  // --- 18. SHOP_AI cannot access unrelated tenants or audit ledger ---
  it("18. SHOP_AI cannot access audit ledger (403)", async () => {
    const shopAiToken = getShopAiToken("sh_alpha");
    const res = await request(app)
      .get("/api/audit")
      .set("Authorization", `Bearer ${shopAiToken}`);
    expect(res.status).toBe(403);
  });

  // --- 19. PAYMENT_CONTROLLER cannot execute real financial operations ---
  it("19. Live financial execution statuses (EXECUTED) are rejected by policy allowlist", async () => {
    const controllerToken = getControllerServiceToken();
    const res = await request(app)
      .post("/api/payment-actions")
      .set("Authorization", `Bearer ${controllerToken}`)
      .send({
        actionId: "ACT-EXEC-01",
        caseId: "CASE-TEST-001",
        tenantId: "sh_alpha",
        actionType: "EXECUTE_PROVIDER_REFUND",
        actionStatus: "EXECUTED", // Illegal execution status!
        reasonCode: "SUSPECTED_DOUBLE_DEBIT",
        idempotencyKey: "idemp-illegal-exec"
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error.message).toMatch(/Status 'EXECUTED' is not allowed|prohibited/i);
  });

  // --- 20. Service token with wrong audience or secret is rejected ---
  it("20. Service token issuance without valid secret is rejected with 401", async () => {
    const res = await request(app)
      .post("/api/auth/service-token")
      .set("x-service-secret", "invalid-secret")
      .send({
        serviceId: "test_svc",
        role: ROLES.PAYMENT_CONTROLLER
      });
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});
