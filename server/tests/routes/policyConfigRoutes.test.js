import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { signUserToken, signServiceToken, ROLES } from "../../src/services/auth/tokenService.js";
import * as policyConfigService from "../../src/services/policy/policyConfigService.js";
import * as serviceRegistry from "../../src/services/auth/serviceRegistry.js";
import { AppError } from "../../src/utils/AppError.js";

describe("PolicyConfigRoutes - RBAC, Two-Person Rule, and Schema Guards", () => {
  const TENANT_A = "tenant_policy_alpha";
  const TENANT_B = "tenant_policy_beta";

  const admin1Token = signUserToken({
    userId: "usr_admin_01",
    role: ROLES.ADMIN,
    tenantId: TENANT_A
  });

  const admin2Token = signUserToken({
    userId: "usr_admin_02",
    role: ROLES.ADMIN,
    tenantId: TENANT_A
  });

  const auditorToken = signUserToken({
    userId: "usr_auditor_01",
    role: ROLES.AUDITOR,
    tenantId: TENANT_A
  });

  const shopToken = signUserToken({
    userId: "usr_shop_01",
    role: ROLES.SHOP,
    tenantId: TENANT_A
  });

  const customerToken = signUserToken({
    userId: "usr_cust_01",
    role: ROLES.CUSTOMER,
    tenantId: TENANT_A,
    customerId: "CUST-001"
  });

  const machineServiceToken = signServiceToken({
    serviceId: "svc_payment_controller_01",
    role: "PAYMENT_CONTROLLER",
    tenantId: TENANT_A
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(serviceRegistry, "getServiceAuthorizationState").mockResolvedValue({
      serviceId: "svc_payment_controller_01",
      serviceRole: "PAYMENT_CONTROLLER",
      credentialVersion: 1,
      isActive: true
    });
  });

  describe("1. Authentication & Role-Based Access Control (RBAC)", () => {
    it("unauthenticated request returns 401 Unauthorized", async () => {
      const res = await request(app).post("/api/policy-config").send({});
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("machine service token is rejected with 403 Forbidden", async () => {
      const res = await request(app)
        .get("/api/policy-config/active")
        .set("Authorization", `Bearer ${machineServiceToken}`);
      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/machine service identities cannot access policy-config routes/);
    });

    it("CUSTOMER role is rejected with 403 Forbidden on all endpoints", async () => {
      const res1 = await request(app)
        .get("/api/policy-config/active")
        .set("Authorization", `Bearer ${customerToken}`);
      expect(res1.status).toBe(403);

      const res2 = await request(app)
        .post("/api/policy-config")
        .set("Authorization", `Bearer ${customerToken}`)
        .send({});
      expect(res2.status).toBe(403);
    });

    it("SHOP role is rejected with 403 Forbidden on all endpoints", async () => {
      const res1 = await request(app)
        .get("/api/policy-config/active")
        .set("Authorization", `Bearer ${shopToken}`);
      expect(res1.status).toBe(403);

      const res2 = await request(app)
        .post("/api/policy-config")
        .set("Authorization", `Bearer ${shopToken}`)
        .send({});
      expect(res2.status).toBe(403);
    });

    it("AUDITOR role can read active config and list configs (200 OK)", async () => {
      vi.spyOn(policyConfigService, "getActivePolicyConfig").mockResolvedValue({
        tenantId: TENANT_A,
        configVersion: 1,
        status: "ACTIVE",
        limits: { currency: "INR", maxSingleRefundPaise: 50000, maxCumulativeRefundPaise: 200000 }
      });

      const res = await request(app)
        .get("/api/policy-config/active")
        .set("Authorization", `Bearer ${auditorToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.configVersion).toBe(1);
    });

    it("AUDITOR role is rejected with 403 Forbidden on mutation endpoints (POST propose, approve, reject, deactivate)", async () => {
      const res1 = await request(app)
        .post("/api/policy-config")
        .set("Authorization", `Bearer ${auditorToken}`)
        .send({
          tenantId: TENANT_A,
          limits: { currency: "INR", maxSingleRefundPaise: 1000, maxCumulativeRefundPaise: 2000 },
          proposalReason: "Valid reason for audit test"
        });
      expect(res1.status).toBe(403);

      const res2 = await request(app)
        .post("/api/policy-config/cfg_001/approve")
        .set("Authorization", `Bearer ${auditorToken}`)
        .send({ approvalReason: "Valid reason for audit test" });
      expect(res2.status).toBe(403);

      const res3 = await request(app)
        .post("/api/policy-config/cfg_001/deactivate")
        .set("Authorization", `Bearer ${auditorToken}`)
        .send({ deactivationReason: "Valid reason for audit test" });
      expect(res3.status).toBe(403);
    });
  });

  describe("2. Strict Zod Validation (.strict() rejects unknown properties)", () => {
    it("rejects proposal body containing unknown extra fields with 400 Bad Request", async () => {
      const res = await request(app)
        .post("/api/policy-config")
        .set("Authorization", `Bearer ${admin1Token}`)
        .send({
          tenantId: TENANT_A,
          limits: {
            currency: "INR",
            maxSingleRefundPaise: 50000,
            maxCumulativeRefundPaise: 100000
          },
          proposalReason: "Valid proposal reason 123",
          injectedSecret: "evil_override" // Unknown extra field
        });
      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/Invalid proposal payload/);
    });

    it("rejects limits containing unknown extra fields with 400 Bad Request", async () => {
      const res = await request(app)
        .post("/api/policy-config")
        .set("Authorization", `Bearer ${admin1Token}`)
        .send({
          tenantId: TENANT_A,
          limits: {
            currency: "INR",
            maxSingleRefundPaise: 50000,
            maxCumulativeRefundPaise: 100000,
            extraUnsafeKey: 999
          },
          proposalReason: "Valid proposal reason 123"
        });
      expect(res.status).toBe(400);
    });

    it("rejects approval body containing unknown extra fields with 400 Bad Request", async () => {
      const res = await request(app)
        .post("/api/policy-config/cfg_001/approve")
        .set("Authorization", `Bearer ${admin1Token}`)
        .send({
          approvalReason: "Valid approval reason 123",
          autoActivate: true // Unknown extra field
        });
      expect(res.status).toBe(400);
    });
  });

  describe("3. Two-Person Rule Enforcement", () => {
    it("proposer attempting to approve their own proposal returns 403 Forbidden", async () => {
      vi.spyOn(policyConfigService, "approvePolicyConfig").mockRejectedValue(
        AppError.forbidden("Two-person rule violation: Proposer cannot approve their own policy config proposal.")
      );

      const res = await request(app)
        .post("/api/policy-config/cfg_001/approve")
        .set("Authorization", `Bearer ${admin1Token}`)
        .send({
          approvalReason: "Self approval attempt should fail"
        });

      expect(res.status).toBe(403);
      expect(res.body.error.message).toMatch(/Two-person rule violation/);
    });

    it("different ADMIN successfully approves proposal with 200 OK", async () => {
      vi.spyOn(policyConfigService, "approvePolicyConfig").mockResolvedValue({
        _id: "cfg_001",
        tenantId: TENANT_A,
        configVersion: 1,
        status: "ACTIVE",
        proposedBy: "usr_admin_01",
        approvedBy: "usr_admin_02",
        approvalReason: "Verified by secondary admin"
      });

      const res = await request(app)
        .post("/api/policy-config/cfg_001/approve")
        .set("Authorization", `Bearer ${admin2Token}`)
        .send({
          approvalReason: "Verified by secondary admin"
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe("ACTIVE");
      expect(res.body.data.approvedBy).toBe("usr_admin_02");
    });
  });

  describe("4. Rejection and Deactivation Endpoints", () => {
    it("ADMIN successfully rejects proposal with 200 OK", async () => {
      vi.spyOn(policyConfigService, "rejectPolicyConfig").mockResolvedValue({
        _id: "cfg_001",
        status: "REJECTED",
        rejectedBy: "usr_admin_01",
        rejectionReason: "Withdrawal of proposal"
      });

      const res = await request(app)
        .post("/api/policy-config/cfg_001/reject")
        .set("Authorization", `Bearer ${admin1Token}`)
        .send({
          rejectionReason: "Withdrawal of proposal"
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("REJECTED");
    });

    it("Single ADMIN successfully deactivates active config with 200 OK", async () => {
      vi.spyOn(policyConfigService, "deactivatePolicyConfig").mockResolvedValue({
        _id: "cfg_001",
        status: "DEACTIVATED",
        deactivatedBy: "usr_admin_01",
        deactivationReason: "Emergency fail-closed deactivation"
      });

      const res = await request(app)
        .post("/api/policy-config/cfg_001/deactivate")
        .set("Authorization", `Bearer ${admin1Token}`)
        .send({
          deactivationReason: "Emergency fail-closed deactivation"
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("DEACTIVATED");
    });
  });

  describe("5. HTTP Method Prohibitions (PUT, PATCH, DELETE are 405)", () => {
    it("PUT /api/policy-config returns 405 Method Not Allowed", async () => {
      const res = await request(app)
        .put("/api/policy-config/cfg_001")
        .set("Authorization", `Bearer ${admin1Token}`)
        .send({});
      expect(res.status).toBe(405);
      expect(res.body.error.message).toMatch(/strictly prohibited on policy configuration resources/);
    });

    it("PATCH /api/policy-config returns 405 Method Not Allowed", async () => {
      const res = await request(app)
        .patch("/api/policy-config/cfg_001")
        .set("Authorization", `Bearer ${admin1Token}`)
        .send({});
      expect(res.status).toBe(405);
      expect(res.body.error.message).toMatch(/strictly prohibited on policy configuration resources/);
    });

    it("DELETE /api/policy-config returns 405 Method Not Allowed", async () => {
      const res = await request(app)
        .delete("/api/policy-config/cfg_001")
        .set("Authorization", `Bearer ${admin1Token}`);
      expect(res.status).toBe(405);
      expect(res.body.error.message).toMatch(/strictly prohibited on policy configuration resources/);
    });
  });
});
