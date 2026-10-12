import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import * as simulatorService from "../../src/services/policy/dryRunSimulatorService.js";
import { signUserToken, ROLES } from "../../src/services/auth/tokenService.js";
import { AppError } from "../../src/utils/AppError.js";

describe("Payment Case Policy Evaluation & Simulation Routes (POST & GET /api/payment-cases/:caseId/policy/*)", () => {
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

  const auditorToken = signUserToken({
    userId: "usr_auditor_01",
    role: ROLES.AUDITOR,
    tenantId: TENANT_A
  });

  const customerToken = signUserToken({
    userId: "usr_cust_01",
    role: ROLES.CUSTOMER,
    tenantId: TENANT_A,
    customerId: "CUST-001"
  });

  const sampleDecision = {
    decisionId: "DEC-20261012-A1B2C3D4",
    tenantId: TENANT_A,
    caseId: "CASE-001",
    idempotencyKey: "idem-key-001",
    proposedActionType: "UPDATE_MERCHANT_LOCAL_LEDGER",
    outcomeStatus: "ELIGIBLE_FOR_SIMULATION",
    appliedRuleIds: ["R_LOCAL_LEDGER_REPAIR_ELIGIBLE"],
    decisionReasons: ["Verified captured payment with pending merchant order."],
    allowReasons: ["Verified captured payment with pending merchant order."],
    denyReasons: [],
    amountPaise: 150000,
    currency: "INR",
    isExecutable: false,
    authoritative: false,
    executionState: "NON_EXECUTABLE_SIMULATION",
    simulationResult: {
      simulatedStep: "MERCHANT_ORDER_REPAIR_SIMULATED",
      simulatedNewOrderStatus: "ORDER_PAID",
      canonicalMutationsExecuted: 0,
      dryRun: true
    }
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // 1. Authentication & RBAC Gates
  // -------------------------------------------------------------------------
  it("1. REJECTS unauthenticated access to /policy/evaluate with 401", async () => {
    const res = await request(app)
      .post("/api/payment-cases/CASE-001/policy/evaluate")
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("2. REJECTS customer role from /policy/evaluate with 403 Forbidden", async () => {
    const res = await request(app)
      .post("/api/payment-cases/CASE-001/policy/evaluate")
      .set("Authorization", `Bearer ${customerToken}`)
      .send({
        proposedActionType: "UPDATE_MERCHANT_LOCAL_LEDGER",
        idempotencyKey: "idem-001"
      });
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it("3. REJECTS read-only AUDITOR role on POST /policy/evaluate with 403 Forbidden", async () => {
    const res = await request(app)
      .post("/api/payment-cases/CASE-001/policy/evaluate")
      .set("Authorization", `Bearer ${auditorToken}`)
      .send({
        proposedActionType: "UPDATE_MERCHANT_LOCAL_LEDGER",
        idempotencyKey: "idem-001"
      });
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 2. Input Validation
  // -------------------------------------------------------------------------
  it("4. Rejects request missing proposedActionType with 400 Bad Request", async () => {
    const res = await request(app)
      .post("/api/payment-cases/CASE-001/policy/evaluate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        idempotencyKey: "idem-001"
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.message).toMatch(/proposedActionType is required/i);
  });

  it("5. Rejects request missing idempotencyKey with 400 Bad Request", async () => {
    const res = await request(app)
      .post("/api/payment-cases/CASE-001/policy/evaluate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        proposedActionType: "UPDATE_MERCHANT_LOCAL_LEDGER"
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error?.message).toMatch(/idempotencyKey is required/i);
  });

  // -------------------------------------------------------------------------
  // 3. Successful Evaluation & Dry-Run Simulation
  // -------------------------------------------------------------------------
  it("6. POST /policy/evaluate returns 200 with structured decision and simulation result", async () => {
    vi.spyOn(simulatorService, "evaluateAndSimulateResolution").mockResolvedValue({
      isDuplicate: false,
      decision: sampleDecision
    });

    const res = await request(app)
      .post("/api/payment-cases/CASE-001/policy/evaluate")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({
        proposedActionType: "UPDATE_MERCHANT_LOCAL_LEDGER",
        idempotencyKey: "idem-key-001"
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.decision.decisionId).toBe(sampleDecision.decisionId);
    expect(res.body.data.decision.outcomeStatus).toBe("ELIGIBLE_FOR_SIMULATION");
    expect(res.body.data.decision.isExecutable).toBe(false);
    expect(res.body.data.decision.executionState).toBe("NON_EXECUTABLE_SIMULATION");
    expect(res.body.data.decision.simulationResult.canonicalMutationsExecuted).toBe(0);
  });

  // -------------------------------------------------------------------------
  // 4. GET /policy/decisions
  // -------------------------------------------------------------------------
  it("7. GET /policy/decisions returns list of decisions for case scoped to tenant", async () => {
    vi.spyOn(simulatorService, "getDecisionsByCaseId").mockResolvedValue([sampleDecision]);

    const res = await request(app)
      .get("/api/payment-cases/CASE-001/policy/decisions")
      .set("Authorization", `Bearer ${shopToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].decisionId).toBe(sampleDecision.decisionId);
  });

  it("8. GET /policy/decisions allows read-only AUDITOR role", async () => {
    vi.spyOn(simulatorService, "getDecisionsByCaseId").mockResolvedValue([sampleDecision]);

    const res = await request(app)
      .get("/api/payment-cases/CASE-001/policy/decisions")
      .set("Authorization", `Bearer ${auditorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});
