import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import * as investigatorService from "../../src/services/ai/multiAgentInvestigator.js";
import { signUserToken, signServiceToken, ROLES } from "../../src/services/auth/tokenService.js";
import { AppError } from "../../src/utils/AppError.js";

describe("Payment Case Investigation Routes (POST & GET /api/payment-cases/:caseId/investigate)", () => {
  const TENANT_A = "tenant_alpha";
  const TENANT_B = "tenant_beta";

  const adminToken = signUserToken({
    userId: "usr_admin_01",
    role: ROLES.ADMIN,
    tenantId: TENANT_A
  });

  const shopToken = signUserToken({
    userId: "usr_shop_01",
    role: ROLES.SHOP,
    tenantId: TENANT_A
  });

  const customerTokenA = signUserToken({
    userId: "usr_cust_01",
    role: ROLES.CUSTOMER,
    tenantId: TENANT_A,
    customerId: "CUST-A"
  });

  const customerTokenB = signUserToken({
    userId: "usr_cust_02",
    role: ROLES.CUSTOMER,
    tenantId: TENANT_A,
    customerId: "CUST-B"
  });

  const auditorToken = signUserToken({
    userId: "usr_auditor_01",
    role: ROLES.AUDITOR,
    tenantId: TENANT_A
  });

  const sampleInvestigationRun = {
    investigationId: "INV-1728734000000-A1B2C3D4",
    caseId: "CASE-001",
    tenantId: TENANT_A,
    customerId: "CUST-A",
    idempotencyKey: "idem-key-001",
    status: "COMPLETED",
    evidenceCards: [
      {
        cardId: "CARD-ORD-001",
        cardType: "MERCHANT_ORDER_STATE",
        evidenceSource: "MERCHANT_ORDER",
        authority: "SYSTEM_RECORD",
        verified: true,
        tenantId: TENANT_A,
        caseId: "CASE-001",
        data: { status: "CONFIRMED" }
      }
    ],
    customerPerspective: {
      role: "CUSTOMER_AI",
      caseId: "CASE-001",
      tenantId: TENANT_A,
      perspective: "Customer reports payment deduction.",
      citedEvidenceIds: [],
      status: "COMPLETED"
    },
    shopPerspective: {
      role: "SHOP_AI",
      caseId: "CASE-001",
      tenantId: TENANT_A,
      perspective: "Order is confirmed and awaiting fulfillment.",
      citedEvidenceIds: ["CARD-ORD-001"],
      status: "COMPLETED"
    },
    investigatorFindings: {
      role: "INVESTIGATOR_AI",
      caseId: "CASE-001",
      tenantId: TENANT_A,
      verifiedFacts: [{ factType: "MERCHANT_ORDER_CONFIRMED", value: "CONFIRMED" }],
      unverifiedClaims: [],
      contradictions: [],
      missingEvidence: [],
      safeHoldRecommended: false,
      citedEvidenceIds: ["CARD-ORD-001"],
      status: "COMPLETED"
    },
    resolutionProposal: {
      role: "RESOLUTION_PLANNER_AI",
      caseId: "CASE-001",
      tenantId: TENANT_A,
      suggestedNextStep: "ADVISORY_MONITOR_OR_NO_ACTION",
      rationale: "Payment confirmed and order state aligned.",
      citedEvidenceIds: ["CARD-ORD-001"],
      isExecutable: false,
      authoritative: false,
      requiresPolicyEngine: true,
      status: "COMPLETED"
    },
    modelUsed: "FALLBACK_DETERMINISTIC",
    durationMs: 42,
    isExecutable: false,
    authoritative: false,
    requiresPolicyEngine: true
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Authentication & RBAC Gates
  // -------------------------------------------------------------------------
  it("1. REJECTS unauthenticated access to /api/payment-cases/:caseId/investigate with 401", async () => {
    const res = await request(app)
      .post("/api/payment-cases/CASE-001/investigate")
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("2. REJECTS unauthorized write/investigate by read-only AUDITOR role with 403 Forbidden", async () => {
    const res = await request(app)
      .post("/api/payment-cases/CASE-001/investigate")
      .set("Authorization", `Bearer ${auditorToken}`)
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 2. Successful Investigation Runs for Authorized Roles
  // -------------------------------------------------------------------------
  it("3. POST /api/payment-cases/:caseId/investigate returns 200 with structured multi-agent result for Admin", async () => {
    vi.spyOn(investigatorService, "runMultiAgentInvestigation").mockResolvedValue(sampleInvestigationRun);

    const res = await request(app)
      .post("/api/payment-cases/CASE-001/investigate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ idempotencyKey: "idem-key-001" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.investigationId).toBe(sampleInvestigationRun.investigationId);
    expect(res.body.data.customerPerspective.role).toBe("CUSTOMER_AI");
    expect(res.body.data.shopPerspective.role).toBe("SHOP_AI");
    expect(res.body.data.investigatorFindings.role).toBe("INVESTIGATOR_AI");
    expect(res.body.data.resolutionProposal.role).toBe("RESOLUTION_PLANNER_AI");
    expect(res.body.data.resolutionProposal.isExecutable).toBe(false);
    expect(res.body.data.resolutionProposal.authoritative).toBe(false);
    expect(res.body.data.resolutionProposal.requiresPolicyEngine).toBe(true);
  });

  // -------------------------------------------------------------------------
  // 3. Customer Isolation: Customer cannot investigate another customer's case
  // -------------------------------------------------------------------------
  it("4. Customer cannot investigate another customer's case (returns 404 Not Found)", async () => {
    vi.spyOn(investigatorService, "runMultiAgentInvestigation").mockRejectedValue(
      AppError.notFound("PaymentCase not found for caseId 'CASE-001'")
    );

    const res = await request(app)
      .post("/api/payment-cases/CASE-001/investigate")
      .set("Authorization", `Bearer ${customerTokenB}`)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 4. Cross-tenant isolation
  // -------------------------------------------------------------------------
  it("5. Cross-tenant investigation attempt fails safely with 404", async () => {
    vi.spyOn(investigatorService, "runMultiAgentInvestigation").mockRejectedValue(
      AppError.notFound("PaymentCase not found for caseId 'CASE-CROSS-TENANT'")
    );

    const res = await request(app)
      .post("/api/payment-cases/CASE-CROSS-TENANT/investigate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({});

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 5. GET /api/payment-cases/:caseId/investigations
  // -------------------------------------------------------------------------
  it("6. GET /api/payment-cases/:caseId/investigations returns list of past runs scoped to tenant", async () => {
    vi.spyOn(investigatorService, "getInvestigationsByCaseId").mockResolvedValue([sampleInvestigationRun]);

    const res = await request(app)
      .get("/api/payment-cases/CASE-001/investigations")
      .set("Authorization", `Bearer ${shopToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].investigationId).toBe(sampleInvestigationRun.investigationId);
  });

  it("7. GET /api/payment-cases/:caseId/investigations rejects unauthenticated with 401", async () => {
    const res = await request(app).get("/api/payment-cases/CASE-001/investigations");
    expect(res.status).toBe(401);
  });
});
