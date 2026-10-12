import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { signUserToken, signServiceToken, ROLES } from "../../src/services/auth/tokenService.js";
import { initDefaultServices } from "../../src/services/auth/serviceRegistry.js";
import * as orchGate from "../../src/services/orchestration/orchestratorGate.js";
import * as orchService from "../../src/services/orchestration/orchestrationService.js";
import { OrchestrationTask } from "../../src/models/OrchestrationTask.js";

describe("Orchestration Routes (GET /api/orchestration/status, POST /kill-switch, /api/payment-cases/:caseId/orchestration/*)", () => {
  const TENANT_A = "tenant_orch_alpha";
  const TENANT_B = "tenant_orch_beta";

  let controllerToken;

  beforeAll(async () => {
    await initDefaultServices();
    controllerToken = signServiceToken({
      serviceId: "svc_payment_controller",
      role: ROLES.PAYMENT_CONTROLLER,
      tenantId: TENANT_A
    });
  });

  const adminToken = signUserToken({
    userId: "usr_admin_orch",
    role: ROLES.ADMIN,
    tenantId: TENANT_A
  });

  const shopToken = signUserToken({
    userId: "usr_shop_orch",
    role: ROLES.SHOP,
    tenantId: TENANT_A
  });

  const customerToken = signUserToken({
    userId: "usr_cust_orch",
    role: ROLES.CUSTOMER,
    tenantId: TENANT_A,
    customerId: "CUST-ORCH-01"
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    orchGate.setOrchestratorKillSwitch(false);
  });

  describe("1. GET /api/orchestration/status", () => {
    it("returns 401 when unauthenticated", async () => {
      const res = await request(app).get("/api/orchestration/status");
      expect(res.status).toBe(401);
    });

    it("returns 403 for unauthorized CUSTOMER role", async () => {
      const res = await request(app)
        .get("/api/orchestration/status")
        .set("Authorization", `Bearer ${customerToken}`);
      expect(res.status).toBe(403);
    });

    it("returns 200 with gate, kill switch, and metrics for ADMIN", async () => {
      const res = await request(app)
        .get("/api/orchestration/status")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.gate).toBeDefined();
      expect(res.body.data.killSwitchActive).toBe(false);
      expect(res.body.data.metrics).toBeDefined();
    });

    it("returns 200 for PAYMENT_CONTROLLER", async () => {
      const res = await request(app)
        .get("/api/orchestration/status")
        .set("Authorization", `Bearer ${controllerToken}`);
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe("2. POST /api/orchestration/kill-switch", () => {
    it("returns 401 when unauthenticated", async () => {
      const res = await request(app)
        .post("/api/orchestration/kill-switch")
        .send({ active: true });
      expect(res.status).toBe(401);
    });

    it("returns 403 for non-ADMIN role (e.g. SHOP)", async () => {
      const res = await request(app)
        .post("/api/orchestration/kill-switch")
        .set("Authorization", `Bearer ${shopToken}`)
        .send({ active: true });
      expect(res.status).toBe(403);
    });

    it("returns 403 for PAYMENT_CONTROLLER (kill switch is restricted strictly to ADMIN)", async () => {
      const res = await request(app)
        .post("/api/orchestration/kill-switch")
        .set("Authorization", `Bearer ${controllerToken}`)
        .send({ active: true });
      expect(res.status).toBe(403);
    });

    it("returns 200 and engages kill switch when called by ADMIN", async () => {
      const res = await request(app)
        .post("/api/orchestration/kill-switch")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ active: true });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.killSwitchActive).toBe(true);
      expect(await orchGate.isOrchestratorKillSwitchActive()).toBe(true);

      // Disengage cleanly
      const resDisengage = await request(app)
        .post("/api/orchestration/kill-switch")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ active: false });

      expect(resDisengage.status).toBe(200);
      expect(resDisengage.body.data.killSwitchActive).toBe(false);
      expect(await orchGate.isOrchestratorKillSwitchActive()).toBe(false);
    });
  });

  describe("3. GET /api/payment-cases/:caseId/orchestration/tasks", () => {
    it("returns 401 when unauthenticated", async () => {
      const res = await request(app).get("/api/payment-cases/CASE-001/orchestration/tasks");
      expect(res.status).toBe(401);
    });

    it("returns 200 with tasks scoped to tenant", async () => {
      vi.spyOn(OrchestrationTask, "find").mockReturnValue({
        sort: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([
            { taskId: "task_1", caseId: "CASE-001", tenantId: TENANT_A, state: "QUEUED" }
          ])
        })
      });

      const res = await request(app)
        .get("/api/payment-cases/CASE-001/orchestration/tasks")
        .set("Authorization", `Bearer ${shopToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].taskId).toBe("task_1");
    });
  });

  describe("4. POST /api/payment-cases/:caseId/orchestration/enqueue", () => {
    it("returns 401 when unauthenticated", async () => {
      const res = await request(app)
        .post("/api/payment-cases/CASE-001/orchestration/enqueue")
        .send({ idempotencyKey: "key-1" });
      expect(res.status).toBe(401);
    });

    it("returns 403 for SHOP role (restricted to ADMIN and PAYMENT_CONTROLLER)", async () => {
      const res = await request(app)
        .post("/api/payment-cases/CASE-001/orchestration/enqueue")
        .set("Authorization", `Bearer ${shopToken}`)
        .send({ idempotencyKey: "key-1" });
      expect(res.status).toBe(403);
    });

    it("returns 400 when idempotencyKey is missing", async () => {
      const res = await request(app)
        .post("/api/payment-cases/CASE-001/orchestration/enqueue")
        .set("Authorization", `Bearer ${controllerToken}`)
        .send({});
      expect(res.status).toBe(400);
      expect(res.body.error.message).toContain("idempotencyKey is required");
    });

    it("returns 201 when enqueued successfully by PAYMENT_CONTROLLER", async () => {
      vi.spyOn(orchService, "queueOrchestrationTask").mockResolvedValue({
        taskId: "task_new_001",
        caseId: "CASE-001",
        tenantId: TENANT_A,
        state: "QUEUED",
        idempotencyKey: "idem-valid-1"
      });

      const res = await request(app)
        .post("/api/payment-cases/CASE-001/orchestration/enqueue")
        .set("Authorization", `Bearer ${controllerToken}`)
        .send({ idempotencyKey: "idem-valid-1" });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.taskId).toBe("task_new_001");
      expect(res.body.data.state).toBe("QUEUED");
    });
  });
});
