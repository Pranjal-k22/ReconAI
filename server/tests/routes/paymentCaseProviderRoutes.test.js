import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import * as dispatchService from "../../src/services/policy/providerDispatchService.js";
import { signUserToken, signServiceToken, ROLES } from "../../src/services/auth/tokenService.js";
import { AppError } from "../../src/utils/AppError.js";

describe("Payment Case Provider Dispatch Routes (POST & GET /api/payment-cases/:caseId/provider/*)", () => {
  const TENANT_A = "tenant_prov_alpha";
  const TENANT_B = "tenant_prov_beta";

  const adminToken = signUserToken({
    userId: "usr_admin_prov",
    role: ROLES.ADMIN,
    tenantId: TENANT_A
  });

  const controllerToken = signServiceToken({
    serviceId: "svc_ctrl_prov",
    role: ROLES.PAYMENT_CONTROLLER,
    tenantId: TENANT_A
  });

  const shopToken = signUserToken({
    userId: "usr_shop_prov",
    role: ROLES.SHOP,
    tenantId: TENANT_A
  });

  const customerToken = signUserToken({
    userId: "usr_cust_prov",
    role: ROLES.CUSTOMER,
    tenantId: TENANT_A,
    customerId: "CUST-PROV-01"
  });

  const sampleOp = {
    operationId: "OP-20261012-A1B2C3D4",
    tenantId: TENANT_A,
    caseId: "CASE-PROV-001",
    idempotencyKey: "idem-prov-001",
    operationType: "REFUND",
    operationStatus: "VERIFIED_SUCCEEDED",
    gatewayPaymentId: "pay_test_001",
    amountPaise: 12000,
    currency: "INR",
    provider: "RAZORPAY",
    providerOperationId: "rfnd_test_001",
    verificationStatus: "PROCESSED"
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. Authentication and RBAC Enforcement", () => {
    it("returns 401 when no auth header is provided", async () => {
      const res = await request(app)
        .post("/api/payment-cases/CASE-PROV-001/provider/dispatch")
        .send({ idempotencyKey: "key-1" });

      expect(res.status).toBe(401);
    });

    it("returns 403 when customer attempts provider dispatch", async () => {
      const res = await request(app)
        .post("/api/payment-cases/CASE-PROV-001/provider/dispatch")
        .set("Authorization", `Bearer ${customerToken}`)
        .send({ idempotencyKey: "key-1" });

      expect(res.status).toBe(403);
    });

    it("returns 403 when merchant/shop attempts provider dispatch (requires ADMIN or PAYMENT_CONTROLLER)", async () => {
      const res = await request(app)
        .post("/api/payment-cases/CASE-PROV-001/provider/dispatch")
        .set("Authorization", `Bearer ${shopToken}`)
        .send({ idempotencyKey: "key-1" });

      expect(res.status).toBe(403);
    });

    it("allows ADMIN or PAYMENT_CONTROLLER role to access dispatch route", async () => {
      vi.spyOn(dispatchService, "dispatchSandboxAction").mockResolvedValue({
        dispatchBlocked: false,
        isDuplicate: false,
        operation: sampleOp
      });

      const res = await request(app)
        .post("/api/payment-cases/CASE-PROV-001/provider/dispatch")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ idempotencyKey: "idem-ctrl-01" });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.operation.operationId).toBe("OP-20261012-A1B2C3D4");
    });
  });

  describe("2. Request-Controlled Enablement and Policy Config Rejection", () => {
    it("strictly rejects caller-supplied refund limits; missing server-side limits blocks dispatch with 422", async () => {
      vi.spyOn(dispatchService, "dispatchSandboxAction").mockImplementation(async (args) => {
        // Confirm server-side policyConfig is strictly null regardless of what client sent
        expect(args.policyConfig).toBeNull();

        return {
          dispatchBlocked: true,
          reason: "Action is not eligible for provider dispatch under approved policy.",
          policyOutcomeStatus: "INSUFFICIENT_EVIDENCE",
          appliedRuleIds: ["R_REFUND_LIMITS_MISSING_FAIL_CLOSED"],
          denyReasons: ["Binding guardrail: Policy configuration is missing. Fail-closed refund policy requires explicit limits."]
        };
      });

      const res = await request(app)
        .post("/api/payment-cases/CASE-PROV-001/provider/dispatch")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({
          idempotencyKey: "key-inject-test",
          policyConfig: {
            maxSingleRefundPaise: 999999999,
            maxCumulativeRefundPaise: 999999999
          }
        });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain("Action is not eligible for provider dispatch");
      expect(res.body.data.appliedRuleIds).toContain("R_REFUND_LIMITS_MISSING_FAIL_CLOSED");
    });

    it("blocks dispatch when Case 22 is evaluated by policy", async () => {
      vi.spyOn(dispatchService, "dispatchSandboxAction").mockResolvedValue({
        dispatchBlocked: true,
        reason: "Action is not eligible for provider dispatch under approved policy.",
        policyOutcomeStatus: "SAFE_HOLD",
        appliedRuleIds: ["R_LATE_CAPTURE_CANCELLED_ORDER_HOLD"],
        denyReasons: ["Late capture associated with cancelled order must remain on safe hold."]
      });

      const res = await request(app)
        .post("/api/payment-cases/CASE-22-LATE-CAPTURE/provider/dispatch")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ idempotencyKey: "key-case22" });

      expect(res.status).toBe(422);
      expect(res.body.success).toBe(false);
      expect(res.body.data.policyOutcomeStatus).toBe("SAFE_HOLD");
      expect(res.body.data.appliedRuleIds).toContain("R_LATE_CAPTURE_CANCELLED_ORDER_HOLD");
    });
  });

  describe("3. GET Operations and Recheck Endpoints", () => {
    it("lists operations for case scoped to tenant", async () => {
      vi.spyOn(dispatchService, "getProviderOperationsByCaseId").mockResolvedValue([sampleOp]);

      const res = await request(app)
        .get("/api/payment-cases/CASE-PROV-001/provider/operations")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].operationId).toBe("OP-20261012-A1B2C3D4");
    });

    it("triggers recheck on an operation", async () => {
      vi.spyOn(dispatchService, "recheckProviderOperationStatus").mockResolvedValue({
        operation: sampleOp,
        verificationResult: { verified: true, outcome: "VERIFIED_SUCCEEDED" }
      });

      const res = await request(app)
        .post("/api/payment-cases/CASE-PROV-001/provider/operations/OP-20261012-A1B2C3D4/recheck")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.operation.operationId).toBe("OP-20261012-A1B2C3D4");
    });
  });
});
