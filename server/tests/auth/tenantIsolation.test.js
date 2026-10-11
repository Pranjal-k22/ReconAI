import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { MerchantOrder } from "../../src/models/MerchantOrder.js";
import * as paymentCaseService from "../../src/services/ledger/paymentCaseService.js";
import * as paymentActionService from "../../src/services/ledger/paymentActionService.js";
import * as financeControllerAgent from "../../src/services/finance/financeControllerAgent.js";
import { AppError } from "../../src/utils/AppError.js";
import {
  signUserToken,
  signServiceToken,
  ROLES
} from "../../src/services/auth/tokenService.js";

describe("Phase 3 - Tenant Isolation & Route Coverage Suite", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const getCustomerToken = (customerId = "cust_alpha_01", tenantId = "sh_tenant_alpha") =>
    signUserToken({
      userId: "usr_cust_alpha",
      role: ROLES.CUSTOMER,
      customerId,
      tenantId
    });

  const getShopAlphaToken = () =>
    signUserToken({
      userId: "usr_shop_alpha",
      role: ROLES.SHOP,
      tenantId: "sh_tenant_alpha"
    });

  const getShopBetaToken = () =>
    signUserToken({
      userId: "usr_shop_beta",
      role: ROLES.SHOP,
      tenantId: "sh_tenant_beta"
    });

  const getAdminToken = () =>
    signUserToken({
      userId: "usr_admin",
      role: ROLES.ADMIN
    });

  const getPaymentControllerToken = () =>
    signServiceToken({
      serviceId: "svc_payment_controller",
      role: ROLES.PAYMENT_CONTROLLER
    });

  // --- 21. Cross-tenant reads are denied ---
  it("21. Cross-tenant reads return 404/Not Found without leaking entity existence", async () => {
    vi.spyOn(paymentCaseService, "getPaymentCaseById").mockImplementation(async (caseId, scopedTenantId) => {
      if (scopedTenantId && scopedTenantId !== "sh_tenant_alpha") {
        throw AppError.notFound(`PaymentCase not found for caseId '${caseId}'`);
      }
      return { caseId, tenantId: "sh_tenant_alpha", customerId: "cust_alpha_01" };
    });

    const shopBetaToken = getShopBetaToken();
    const res = await request(app)
      .get("/api/payment-cases/CASE-ALPHA-01")
      .set("Authorization", `Bearer ${shopBetaToken}`);

    // Must be 404 to avoid leaking cross-tenant existence
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  // --- 22. Cross-tenant updates are denied ---
  it("22. Cross-tenant modifications are rejected with 403 Forbidden", async () => {
    const shopBetaToken = getShopBetaToken();
    const res = await request(app)
      .patch("/api/payment-cases/CASE-ALPHA-01/safe-hold")
      .set("Authorization", `Bearer ${shopBetaToken}`)
      .send({
        isSafeHold: true,
        safeHoldCode: "POLICY_VIOLATION",
        safeHoldReason: "Attempted cross-tenant tamper"
      });

    // Shop role cannot execute admin safe-hold reviews (403)
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  // --- 23. Tenant-aware list, filter, pagination cannot leak records ---
  it("23. Listing payment cases scopes exclusively to caller tenant and customer", async () => {
    let capturedFilter = null;
    vi.spyOn(paymentCaseService, "listPaymentCases").mockImplementation(async (filter) => {
      capturedFilter = filter;
      return {
        cases: [{ caseId: "CASE-ALPHA-001", tenantId: filter.tenantId }],
        pagination: { page: 1, limit: 50, total: 1, pages: 1 }
      };
    });

    // Customer views cases -> scoped to their tenantId AND customerId
    const custAlphaToken = getCustomerToken("cust_alpha_01", "sh_tenant_alpha");
    const custRes = await request(app)
      .get("/api/payment-cases")
      .set("Authorization", `Bearer ${custAlphaToken}`);
    expect(custRes.status).toBe(200);
    expect(capturedFilter.tenantId).toBe("sh_tenant_alpha");
    expect(capturedFilter.customerId).toBe("cust_alpha_01");

    // Shop views cases -> scoped to their tenantId
    const shopAlphaToken = getShopAlphaToken();
    const shopRes = await request(app)
      .get("/api/payment-cases")
      .set("Authorization", `Bearer ${shopAlphaToken}`);
    expect(shopRes.status).toBe(200);
    expect(capturedFilter.tenantId).toBe("sh_tenant_alpha");
    expect(capturedFilter.customerId).toBeUndefined();
  });

  // --- 24. IDs supplied in request body cannot bypass ownership ---
  it("24. Body tenantId or customerId spoofing is strictly blocked or overridden by verified identity", async () => {
    let capturedPayload = null;
    vi.spyOn(paymentCaseService, "createPaymentCase").mockImplementation(async (payload) => {
      capturedPayload = payload;
      return { ...payload };
    });

    const custToken = getCustomerToken("cust_real_01", "sh_tenant_alpha");

    // Attempting to spoof cross-tenantId is rejected with 403 Forbidden
    const spoofTenantRes = await request(app)
      .post("/api/payment-cases")
      .set("Authorization", `Bearer ${custToken}`)
      .send({
        caseId: "CASE-SPOOF-01",
        amountPaise: 15000,
        currency: "INR",
        tenantId: "sh_tenant_spoofed_victim"
      });
    expect(spoofTenantRes.status).toBe(403);
    expect(spoofTenantRes.body.success).toBe(false);

    // Attempting to spoof customerId within tenant has customerId derived strictly from authenticated token
    const spoofCustRes = await request(app)
      .post("/api/payment-cases")
      .set("Authorization", `Bearer ${custToken}`)
      .send({
        caseId: "CASE-SPOOF-02",
        amountPaise: 15000,
        currency: "INR",
        tenantId: "sh_tenant_alpha",
        customerId: "cust_spoofed_victim"
      });
    expect(spoofCustRes.status).toBe(201);
    expect(capturedPayload.customerId).toBe("cust_real_01");
    expect(capturedPayload.tenantId).toBe("sh_tenant_alpha");
  });

  // --- 25. Event and action creation derive tenant from trusted scope ---
  it("25. Action proposal derives tenantId from authenticated principal and rejects non-executing callers", async () => {
    const shopToken = getShopAlphaToken();

    // Shop cannot propose actions directly (only PAYMENT_CONTROLLER and ADMIN)
    const unauthorizedRes = await request(app)
      .post("/api/payment-actions")
      .set("Authorization", `Bearer ${shopToken}`)
      .send({
        actionId: "ACT-SHOP-ILLEGAL",
        caseId: "CASE-ALPHA-001",
        actionType: "UPDATE_MERCHANT_LOCAL_LEDGER",
        actionStatus: "PROPOSED",
        idempotencyKey: "idemp-shop-01"
      });
    expect(unauthorizedRes.status).toBe(403);

    let capturedAction = null;
    vi.spyOn(paymentActionService, "recordProposedAction").mockImplementation(async (payload) => {
      capturedAction = payload;
      return { ...payload };
    });

    // Payment Controller proposes action
    const controllerToken = getPaymentControllerToken();
    const validRes = await request(app)
      .post("/api/payment-actions")
      .set("Authorization", `Bearer ${controllerToken}`)
      .send({
        actionId: "ACT-CTRL-VALID-01",
        caseId: "CASE-ALPHA-001",
        tenantId: "sh_tenant_alpha",
        actionType: "UPDATE_MERCHANT_LOCAL_LEDGER",
        actionStatus: "PROPOSED",
        idempotencyKey: "idemp-ctrl-01"
      });
    expect(validRes.status).toBe(201);
    expect(capturedAction.tenantId).toBe("sh_tenant_alpha");
    expect(capturedAction.initiatedByActorId).toBe("svc_payment_controller");
  });

  // --- 26. Missing or ambiguous legacy ownership does not leak ---
  it("26. Legacy records with null tenantId remain unassigned and do not leak to tenant users", () => {
    const legacyDoc = new MerchantOrder({
      merchantOrderId: "LEGACY-ORDER-999",
      amountPaise: 100000,
      currency: "INR",
      status: "CREATED"
      // tenantId omitted -> defaults to null
    });

    expect(legacyDoc.tenantId).toBeNull();
    expect(legacyDoc.customerId).toBeNull();
    expect(legacyDoc.validateSync()).toBeUndefined();

    const tenantScopedDoc = new MerchantOrder({
      merchantOrderId: "ORDER-TENANT-001",
      amountPaise: 50000,
      currency: "INR",
      tenantId: "sh_tenant_alpha",
      customerId: "cust_001"
    });
    expect(tenantScopedDoc.tenantId).toBe("sh_tenant_alpha");
    expect(tenantScopedDoc.customerId).toBe("cust_001");
  });

  // --- 27 & 28. Public route inventory & protection ---
  it("27 & 28. Health check is public; sensitive APIs reject unauthenticated requests", async () => {
    // Health is public (does not reject with 401 Unauthorized)
    const healthRes = await request(app).get("/api/health");
    expect(healthRes.status).not.toBe(401);
    expect([200, 503]).toContain(healthRes.status);

    // Core financial routes reject unauthenticated
    const exceptionsRes = await request(app).get("/api/exceptions");
    expect(exceptionsRes.status).toBe(401);

    const auditRes = await request(app).get("/api/audit");
    expect(auditRes.status).toBe(401);

    const casesRes = await request(app).get("/api/payment-cases");
    expect(casesRes.status).toBe(401);
  });

  // --- 29. Error status code consistency (401 vs 403 vs 404) ---
  it("29. Returns consistent status codes (401 for unauthenticated, 403 for unauthorized role, 404 for missing resource)", async () => {
    // 401: No token
    const res401 = await request(app).get("/api/audit");
    expect(res401.status).toBe(401);

    // 403: Customer trying to access Admin audit route
    const custToken = getCustomerToken();
    const res403 = await request(app)
      .get("/api/audit")
      .set("Authorization", `Bearer ${custToken}`);
    expect(res403.status).toBe(403);

    // 404: Resource not found for authorized admin
    vi.spyOn(paymentCaseService, "getPaymentCaseById").mockRejectedValue(
      AppError.notFound("PaymentCase not found for caseId 'CASE-NON-EXISTENT-999'")
    );

    const adminToken = getAdminToken();
    const res404 = await request(app)
      .get("/api/payment-cases/CASE-NON-EXISTENT-999")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(res404.status).toBe(404);
  });

  // --- 30. Authenticated finance controller workflow ---
  it("30. Legitimate admin workflows succeed on finance-controller endpoints", async () => {
    vi.spyOn(financeControllerAgent, "listControllerRuns").mockResolvedValue({
      runs: [{ runId: "FCRUN-001" }],
      pagination: { page: 1, limit: 20, total: 1, pages: 1 }
    });

    const adminToken = getAdminToken();
    const res = await request(app)
      .get("/api/finance-controller/runs")
      .set("Authorization", `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.runs).toHaveLength(1);
  });
});
