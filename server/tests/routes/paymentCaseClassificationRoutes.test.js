import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import * as classificationService from "../../src/services/classification/classificationService.js";
import * as auditService from "../../src/services/audit/auditService.js";
import { PaymentCase } from "../../src/models/PaymentCase.js";
import * as serviceRegistry from "../../src/services/auth/serviceRegistry.js";
import { signUserToken, signServiceToken, ROLES } from "../../src/services/auth/tokenService.js";
import { AppError } from "../../src/utils/AppError.js";

describe("Payment Case Classification Routes (POST & GET /api/payment-cases/:caseId/classif*)", () => {
  const TENANT_A = "tenant_alpha";
  const TENANT_B = "tenant_beta";

  const adminToken = signUserToken({
    userId: "usr_admin_01",
    role: ROLES.ADMIN,
    tenantId: TENANT_A
  });

  const shopTokenA = signUserToken({
    userId: "usr_shop_01",
    role: ROLES.SHOP,
    tenantId: TENANT_A
  });

  const shopTokenB = signUserToken({
    userId: "usr_shop_02",
    role: ROLES.SHOP,
    tenantId: TENANT_B
  });

  const auditorTokenA = signUserToken({
    userId: "usr_auditor_01",
    role: ROLES.AUDITOR,
    tenantId: TENANT_A
  });

  const globalAuditorToken = signUserToken({
    userId: "usr_global_auditor",
    role: ROLES.AUDITOR,
    tenantId: TENANT_A,
    scopes: ["GLOBAL_AUDIT"]
  });

  const customerToken = signUserToken({
    userId: "usr_cust_01",
    role: ROLES.CUSTOMER,
    tenantId: TENANT_A,
    customerId: "CUST-001"
  });

  const paymentControllerToken = signServiceToken({
    serviceId: "svc_payment_controller",
    role: ROLES.PAYMENT_CONTROLLER,
    tenantId: TENANT_A
  });

  const customerAiToken = signServiceToken({
    serviceId: "svc_customer_ai",
    role: ROLES.CUSTOMER_AI,
    tenantId: TENANT_A,
    customerId: "CUST-001"
  });

  const sampleEvidenceRecord = {
    recordId: "EVID-TEST-001",
    tenantId: TENANT_A,
    caseId: "CASE-001",
    scenarioId: "SCN_PAID_GATEWAY_UNPAID_ORDER",
    category: "DISCREPANCY",
    reasonCode: "PAID_UNPAID_MISMATCH",
    ruleId: "R_STATUS_MISMATCH_CAPTURE_SUCCESS",
    confidence: "HIGH",
    safeHold: false,
    safeHoldCode: null,
    recommendation: "UPDATE_MERCHANT_LOCAL_LEDGER",
    suggestedNextStep: "LOCAL_LEDGER_REPAIR",
    missingEvidence: [],
    contradictions: [],
    inputHash: "abc123canonicalhash",
    provenance: {
      gatewayPayment: { collection: "gatewaypayments", id: "pay_001" },
      merchantOrder: { collection: "merchantorders", id: "order_001" }
    },
    secretKey: "SECRET_INTERNAL_KEY_DO_NOT_LEAK",
    apiKey: "SENSITIVE_API_KEY",
    evaluatedAt: new Date().toISOString()
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(serviceRegistry, "getServiceAuthorizationState").mockImplementation(async (serviceId) => {
      if (serviceId === "svc_payment_controller") {
        return {
          serviceId: "svc_payment_controller",
          role: ROLES.PAYMENT_CONTROLLER,
          tenantId: TENANT_A,
          isActive: true,
          credentialVersion: 1
        };
      }
      if (serviceId === "svc_customer_ai") {
        return {
          serviceId: "svc_customer_ai",
          role: ROLES.CUSTOMER_AI,
          tenantId: TENANT_A,
          customerId: "CUST-001",
          isActive: true,
          credentialVersion: 1
        };
      }
      return null;
    });
  });

  // =========================================================================
  // 1. POST /api/payment-cases/:caseId/classify
  // =========================================================================
  describe("POST /api/payment-cases/:caseId/classify", () => {
    it("1. Rejects unauthenticated request with 401", async () => {
      const res = await request(app).post("/api/payment-cases/CASE-001/classify").send({});
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("2. Rejects non-ADMIN roles with 403 Forbidden", async () => {
      const forbiddenTokens = [
        shopTokenA,
        auditorTokenA,
        customerToken,
        paymentControllerToken,
        customerAiToken
      ];

      for (const token of forbiddenTokens) {
        const res = await request(app)
          .post("/api/payment-cases/CASE-001/classify")
          .set("Authorization", `Bearer ${token}`)
          .send({});
        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
      }
    });

    it("3. Rejects non-empty request body with 400 Bad Request (strict empty body)", async () => {
      const res = await request(app)
        .post("/api/payment-cases/CASE-001/classify")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ callerEvidence: "injected_scenario", override: true });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.message).toMatch(/strict empty body/i);
    });

    it("4. Returns 404 when PaymentCase is not found in tenant", async () => {
      vi.spyOn(PaymentCase, "findOne").mockReturnValue({
        lean: vi.fn().mockResolvedValue(null)
      });

      const res = await request(app)
        .post("/api/payment-cases/CASE-UNKNOWN/classify")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("5. Successfully classifies case with empty body and returns redacted response", async () => {
      vi.spyOn(PaymentCase, "findOne").mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          caseId: "CASE-001",
          tenantId: TENANT_A,
          status: "OPEN"
        })
      });

      const classifySpy = vi.spyOn(classificationService, "classifyCase").mockResolvedValue({
        evidenceRecord: sampleEvidenceRecord,
        isReplay: false
      });

      const res = await request(app)
        .post("/api/payment-cases/CASE-001/classify")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({});

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.recordId).toBe("EVID-TEST-001");
      expect(res.body.data.scenarioId).toBe("SCN_PAID_GATEWAY_UNPAID_ORDER");
      expect(res.body.data.inputHash).toBe("abc123canonicalhash");
      expect(res.body.isReplay).toBe(false);

      // Redaction assertion: secret/sensitive keys are stripped
      expect(res.body.data.secretKey).toBeUndefined();
      expect(res.body.data.apiKey).toBeUndefined();

      expect(classifySpy).toHaveBeenCalledTimes(1);
    });
  });

  // =========================================================================
  // 2. GET /api/payment-cases/:caseId/classification
  // =========================================================================
  describe("GET /api/payment-cases/:caseId/classification", () => {
    it("6. Rejects unauthenticated request with 401", async () => {
      const res = await request(app).get("/api/payment-cases/CASE-001/classification");
      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it("7. Rejects CUSTOMER and service roles with 403 Forbidden", async () => {
      const forbiddenTokens = [customerToken, customerAiToken, paymentControllerToken];

      for (const token of forbiddenTokens) {
        const res = await request(app)
          .get("/api/payment-cases/CASE-001/classification")
          .set("Authorization", `Bearer ${token}`);
        expect(res.status).toBe(403);
        expect(res.body.success).toBe(false);
      }
    });

    it("8. Allows ADMIN role to retrieve classification", async () => {
      vi.spyOn(PaymentCase, "findOne").mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          caseId: "CASE-001",
          tenantId: TENANT_A
        })
      });

      vi.spyOn(classificationService, "getCaseClassification").mockResolvedValue(sampleEvidenceRecord);

      const res = await request(app)
        .get("/api/payment-cases/CASE-001/classification")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.recordId).toBe("EVID-TEST-001");
      expect(res.body.data.secretKey).toBeUndefined();
    });

    it("9. Allows SHOP role to retrieve classification on own tenant", async () => {
      vi.spyOn(PaymentCase, "findOne").mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          caseId: "CASE-001",
          tenantId: TENANT_A
        })
      });

      vi.spyOn(classificationService, "getCaseClassification").mockResolvedValue(sampleEvidenceRecord);

      const res = await request(app)
        .get("/api/payment-cases/CASE-001/classification")
        .set("Authorization", `Bearer ${shopTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.recordId).toBe("EVID-TEST-001");
    });

    it("10. Rejects SHOP role from other tenant with 404 (tenant isolation)", async () => {
      vi.spyOn(PaymentCase, "findOne").mockReturnValue({
        lean: vi.fn().mockResolvedValue(null)
      });

      const res = await request(app)
        .get("/api/payment-cases/CASE-001/classification")
        .set("Authorization", `Bearer ${shopTokenB}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("11. Allows AUDITOR role on own tenant", async () => {
      vi.spyOn(PaymentCase, "findOne").mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          caseId: "CASE-001",
          tenantId: TENANT_A
        })
      });

      vi.spyOn(classificationService, "getCaseClassification").mockResolvedValue(sampleEvidenceRecord);

      const res = await request(app)
        .get("/api/payment-cases/CASE-001/classification")
        .set("Authorization", `Bearer ${auditorTokenA}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.recordId).toBe("EVID-TEST-001");
    });

    it("12. Allows AUDITOR with GLOBAL_AUDIT to access other tenant and emits GLOBAL_AUDIT_ACCESSED audit row", async () => {
      vi.spyOn(PaymentCase, "findOne").mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          caseId: "CASE-B-001",
          tenantId: TENANT_B
        })
      });

      const auditSpy = vi.spyOn(auditService, "createAuditEvent").mockResolvedValue({});
      vi.spyOn(classificationService, "getCaseClassification").mockResolvedValue({
        ...sampleEvidenceRecord,
        tenantId: TENANT_B,
        caseId: "CASE-B-001"
      });

      const res = await request(app)
        .get("/api/payment-cases/CASE-B-001/classification?tenantId=tenant_beta")
        .set("Authorization", `Bearer ${globalAuditorToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(auditSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: TENANT_B,
          entityId: "CASE-B-001",
          action: "GLOBAL_AUDIT_ACCESSED"
        })
      );
    });

    it("13. Returns 404 when case has no classification yet", async () => {
      vi.spyOn(PaymentCase, "findOne").mockReturnValue({
        lean: vi.fn().mockResolvedValue({
          caseId: "CASE-001",
          tenantId: TENANT_A
        })
      });

      vi.spyOn(classificationService, "getCaseClassification").mockRejectedValue(
        AppError.notFound("No classification record found for case 'CASE-001' in tenant 'tenant_alpha'")
      );

      const res = await request(app)
        .get("/api/payment-cases/CASE-001/classification")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error?.message).toMatch(/no classification record found/i);
    });
  });
});
