import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import request from "supertest";
import mongoose from "mongoose";
import app from "../../src/app.js";
import { PaymentLifecycleEvent } from "../../src/models/PaymentLifecycleEvent.js";
import { AuditLog } from "../../src/models/AuditLog.js";
import { PaymentCase } from "../../src/models/PaymentCase.js";
import { PolicyDecision } from "../../src/models/PolicyDecision.js";
import { ProviderOperation } from "../../src/models/ProviderOperation.js";
import { PolicyConfigVersion, computePolicyConfigHash } from "../../src/models/PolicyConfigVersion.js";
import { AiInvestigationRun } from "../../src/models/AiInvestigationRun.js";
import { PaymentAction } from "../../src/models/PaymentAction.js";
import { OrchestrationTask } from "../../src/models/OrchestrationTask.js";
import { signUserToken, ROLES } from "../../src/services/auth/tokenService.js";
import { validateTestDatabaseUri } from "../helpers/testDbGuard.js";

const DEFAULT_TEST_URI = "mongodb://127.0.0.1:27017/reconai_test_quarantine_isolation";
const TEST_DB_URI = validateTestDatabaseUri(process.env.MONGODB_TEST_URI || DEFAULT_TEST_URI);
const SENTINEL_TENANT = "unassigned_provider_quarantine";
const VALID_TENANT = "tenant_test_valid_01";

describe("Quarantine Sentinel Tenant Isolation — Real MongoDB Integration", { timeout: 35000 }, () => {
  let adminToken;
  let sentinelConfigId;
  let validConfigId;

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 5000 });

    adminToken = signUserToken({
      userId: "admin-quarantine-audit-tester",
      role: ROLES.ADMIN,
      tenantId: null
    });
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.db.dropDatabase().catch(() => {});
      await mongoose.disconnect();
    }
  });

  beforeEach(async () => {
    if (mongoose.connection.readyState === 1) {
      await Promise.all([
        PaymentLifecycleEvent.deleteMany({}),
        AuditLog.deleteMany({}),
        PaymentCase.deleteMany({}),
        PolicyDecision.deleteMany({}),
        ProviderOperation.deleteMany({}),
        PolicyConfigVersion.deleteMany({}),
        AiInvestigationRun.deleteMany({}),
        PaymentAction.deleteMany({}),
        OrchestrationTask.deleteMany({})
      ]);

      // Seed Quarantined (Sentinel) records
      await PaymentLifecycleEvent.create({
        eventId: "ple_sentinel_001",
        tenantId: SENTINEL_TENANT,
        caseId: "case_sentinel_001",
        gatewayPaymentId: "pay_sentinel_001",
        sourceSystem: "GATEWAY_WEBHOOK",
        deduplicationKey: "dedup_sentinel_001",
        normalizedEventType: "PAYMENT_CAPTURED",
        payloadFingerprint: "fingerprint_sentinel_001",
        amountPaise: 10000,
        currency: "INR"
      });

      await AuditLog.create({
        eventId: "aud_sentinel_001",
        tenantId: SENTINEL_TENANT,
        actorType: "SYSTEM",
        action: "DATA_IMPORTED",
        entityType: "PaymentLifecycleEvent",
        entityId: "ple_sentinel_001"
      });

      await PaymentCase.create({
        caseId: "case_sentinel_001",
        tenantId: SENTINEL_TENANT,
        gatewayPaymentId: "pay_sentinel_001",
        merchantOrderId: "order_sentinel_001",
        orderStatus: "ORDER_CREATED",
        captureStatus: "CAPTURE_NONE",
        resolutionCaseStatus: "CASE_DETECTED",
        discrepancyCategory: "STATUS_MISMATCH"
      });

      await PolicyDecision.create({
        decisionId: "dec_sentinel_001",
        tenantId: SENTINEL_TENANT,
        caseId: "case_sentinel_001",
        idempotencyKey: "idem_sentinel_001",
        inputHash: "hash_sentinel_001",
        policyVersion: "2026-10-12.v1",
        proposedActionType: "REQUEST_REFUND",
        outcomeStatus: "SAFE_HOLD",
        safeHoldCode: "UNRESOLVED_UNCERTAINTY",
        appliedRuleIds: ["RULE_HOLD"]
      });

      await ProviderOperation.create({
        operationId: "op_sentinel_001",
        tenantId: SENTINEL_TENANT,
        caseId: "case_sentinel_001",
        gatewayPaymentId: "pay_sentinel_001",
        actionType: "REQUEST_REFUND",
        provider: "RAZORPAY",
        status: "BLOCKED",
        idempotencyKey: "idem_op_sentinel_001",
        amountPaise: 10000,
        currency: "INR"
      });

      const rawInsertRes = await mongoose.connection.db.collection("policyconfigversions").insertOne({
        tenantId: SENTINEL_TENANT,
        configVersion: 1,
        status: "ACTIVE",
        limits: {
          currency: "INR",
          maxSingleRefundPaise: 50000,
          maxCumulativeRefundPaise: 100000
        },
        contentHash: "dummyhash_sentinel",
        proposedBy: "admin-seed",
        proposalReason: "Initial sentinel seed",
        approvedBy: "auditor-seed",
        approvalReason: "Seed approval",
        createdAt: new Date(),
        updatedAt: new Date()
      });
      sentinelConfigId = rawInsertRes.insertedId.toString();

      await AiInvestigationRun.create({
        investigationId: "inv_sentinel_001",
        caseId: "case_sentinel_001",
        tenantId: SENTINEL_TENANT,
        idempotencyKey: "idem_inv_sentinel_001",
        status: "COMPLETED",
        modelUsed: "FALLBACK_DETERMINISTIC",
        durationMs: 50
      });

      await PaymentAction.create({
        actionId: "act_sentinel_001",
        tenantId: SENTINEL_TENANT,
        caseId: "case_sentinel_001",
        actionType: "SAFE_HOLD",
        actionStatus: "HELD_IN_SAFE_HOLD",
        initiatedByActorType: "SYSTEM_MONITOR",
        initiatedByActorId: "system",
        idempotencyKey: "idem_sentinel_001",
        reasonCode: "SENTINEL_ISOLATION",
        proposedAt: new Date()
      });

      await OrchestrationTask.create({
        taskId: "task_sentinel_001",
        tenantId: SENTINEL_TENANT,
        caseId: "case_sentinel_001",
        idempotencyKey: "idem_task_sentinel_001",
        state: "QUEUED"
      });

      // Seed Valid Tenant records to verify real data is returned
      await PaymentLifecycleEvent.create({
        eventId: "ple_valid_001",
        tenantId: VALID_TENANT,
        caseId: "case_valid_001",
        gatewayPaymentId: "pay_valid_001",
        sourceSystem: "GATEWAY_WEBHOOK",
        deduplicationKey: "dedup_valid_001",
        normalizedEventType: "PAYMENT_CAPTURED",
        payloadFingerprint: "fingerprint_valid_001",
        amountPaise: 25000,
        currency: "INR"
      });

      await AuditLog.create({
        eventId: "aud_valid_001",
        tenantId: VALID_TENANT,
        actorType: "SYSTEM",
        action: "DATA_IMPORTED",
        entityType: "PaymentLifecycleEvent",
        entityId: "ple_valid_001"
      });

      await PaymentCase.create({
        caseId: "case_valid_001",
        tenantId: VALID_TENANT,
        gatewayPaymentId: "pay_valid_001",
        merchantOrderId: "order_valid_001",
        orderStatus: "ORDER_CREATED",
        captureStatus: "CAPTURE_CAPTURED",
        resolutionCaseStatus: "CASE_DETECTED",
        discrepancyCategory: "STATUS_MISMATCH"
      });

      await PolicyDecision.create({
        decisionId: "dec_valid_001",
        tenantId: VALID_TENANT,
        caseId: "case_valid_001",
        idempotencyKey: "idem_valid_001",
        inputHash: "hash_valid_001",
        policyVersion: "2026-10-12.v1",
        proposedActionType: "REQUEST_REFUND",
        outcomeStatus: "ELIGIBLE_FOR_SIMULATION",
        appliedRuleIds: ["RULE_ALLOW"]
      });

      await ProviderOperation.create({
        operationId: "op_valid_001",
        tenantId: VALID_TENANT,
        caseId: "case_valid_001",
        gatewayPaymentId: "pay_valid_001",
        actionType: "REQUEST_REFUND",
        provider: "RAZORPAY",
        status: "PENDING",
        idempotencyKey: "idem_op_valid_001",
        amountPaise: 25000,
        currency: "INR"
      });

      const validLimits = {
        currency: "INR",
        maxSingleRefundPaise: 50000,
        maxCumulativeRefundPaise: 100000
      };
      const validConfig = await PolicyConfigVersion.create({
        tenantId: VALID_TENANT,
        configVersion: 1,
        status: "ACTIVE",
        limits: validLimits,
        contentHash: computePolicyConfigHash(validLimits),
        proposedBy: "admin-seed",
        proposalReason: "Initial valid seed",
        approvedBy: "auditor-seed",
        approvalReason: "Seed approval"
      });
      validConfigId = validConfig._id.toString();

      await AiInvestigationRun.create({
        investigationId: "inv_valid_001",
        caseId: "case_valid_001",
        tenantId: VALID_TENANT,
        idempotencyKey: "idem_inv_valid_001",
        status: "COMPLETED",
        modelUsed: "FALLBACK_DETERMINISTIC",
        durationMs: 40
      });

      await PaymentAction.create({
        actionId: "act_valid_001",
        tenantId: VALID_TENANT,
        caseId: "case_valid_001",
        actionType: "REQUEST_REFUND",
        actionStatus: "HELD_IN_SAFE_HOLD",
        initiatedByActorType: "HUMAN_ADMIN",
        initiatedByActorId: "admin",
        idempotencyKey: "idem_valid_001",
        reasonCode: "SAFE_HOLD_PENDING",
        proposedAt: new Date()
      });

      await OrchestrationTask.create({
        taskId: "task_valid_001",
        tenantId: VALID_TENANT,
        caseId: "case_valid_001",
        idempotencyKey: "idem_task_valid_001",
        state: "QUEUED"
      });
    }
  });

  describe("1. payment-events endpoints", () => {
    it("GET /api/payment-events never returns sentinel events without filter", async () => {
      const res = await request(app)
        .get("/api/payment-events")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const events = res.body.data;
      expect(events.length).toBeGreaterThan(0);
      expect(events.some((e) => e.tenantId === SENTINEL_TENANT)).toBe(false);
      expect(events.some((e) => e.eventId === "ple_sentinel_001")).toBe(false);
      expect(events.some((e) => e.eventId === "ple_valid_001")).toBe(true);
    });

    it("GET /api/payment-events?tenantId=<sentinel> returns empty list", async () => {
      const res = await request(app)
        .get(`/api/payment-events?tenantId=${SENTINEL_TENANT}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it("GET /api/payment-events/case/:caseId with sentinel case returns empty list", async () => {
      const res = await request(app)
        .get("/api/payment-events/case/case_sentinel_001")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it("GET /api/payment-events/payment/:paymentId with sentinel payment returns empty list", async () => {
      const res = await request(app)
        .get("/api/payment-events/payment/pay_sentinel_001")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });
  });

  describe("2. payment-cases endpoints", () => {
    it("GET /api/payment-cases never returns sentinel case without filter", async () => {
      const res = await request(app)
        .get("/api/payment-cases")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const cases = res.body.data.cases;
      expect(cases.length).toBeGreaterThan(0);
      expect(cases.some((c) => c.tenantId === SENTINEL_TENANT)).toBe(false);
      expect(cases.some((c) => c.caseId === "case_sentinel_001")).toBe(false);
      expect(cases.some((c) => c.caseId === "case_valid_001")).toBe(true);
    });

    it("GET /api/payment-cases?tenantId=<sentinel> returns empty list", async () => {
      const res = await request(app)
        .get(`/api/payment-cases?tenantId=${SENTINEL_TENANT}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.cases).toEqual([]);
      expect(res.body.data.pagination.total).toBe(0);
    });

    it("GET /api/payment-cases/:caseId returns 404 for sentinel case", async () => {
      const res = await request(app)
        .get("/api/payment-cases/case_sentinel_001")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe("3. evidence & investigation endpoints", () => {
    it("GET /api/payment-cases/:caseId/investigations returns empty list for sentinel case", async () => {
      const res = await request(app)
        .get("/api/payment-cases/case_sentinel_001/investigations")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it("GET /api/payment-cases/:caseId/investigations?tenantId=<sentinel> returns empty list", async () => {
      const res = await request(app)
        .get(`/api/payment-cases/case_sentinel_001/investigations?tenantId=${SENTINEL_TENANT}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it("GET /api/payment-cases/:caseId/evidence returns empty list for sentinel case", async () => {
      const res = await request(app)
        .get("/api/payment-cases/case_sentinel_001/evidence")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it("GET /api/payment-cases/:caseId/evidence?tenantId=<sentinel> returns empty list", async () => {
      const res = await request(app)
        .get(`/api/payment-cases/case_sentinel_001/evidence?tenantId=${SENTINEL_TENANT}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it("GET /api/payment-cases/:caseId/classification returns 404 for sentinel case", async () => {
      const res = await request(app)
        .get("/api/payment-cases/case_sentinel_001/classification")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("GET /api/payment-cases/:caseId/classification?tenantId=<sentinel> returns 404", async () => {
      const res = await request(app)
        .get(`/api/payment-cases/case_valid_001/classification?tenantId=${SENTINEL_TENANT}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe("4. policy decisions endpoints", () => {
    it("GET /api/payment-cases/:caseId/policy/decisions returns empty list for sentinel case", async () => {
      const res = await request(app)
        .get("/api/payment-cases/case_sentinel_001/policy/decisions")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it("GET /api/payment-cases/:caseId/policy/decisions?tenantId=<sentinel> returns empty list", async () => {
      const res = await request(app)
        .get(`/api/payment-cases/case_sentinel_001/policy/decisions?tenantId=${SENTINEL_TENANT}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });
  });

  describe("5. provider operations endpoints", () => {
    it("GET /api/payment-cases/:caseId/provider/operations returns empty list for sentinel case", async () => {
      const res = await request(app)
        .get("/api/payment-cases/case_sentinel_001/provider/operations")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it("GET /api/payment-cases/:caseId/provider/operations?tenantId=<sentinel> returns empty list", async () => {
      const res = await request(app)
        .get(`/api/payment-cases/case_sentinel_001/provider/operations?tenantId=${SENTINEL_TENANT}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });
  });

  describe("6. audit endpoints", () => {
    it("GET /api/audit never returns sentinel audit rows without filter", async () => {
      const res = await request(app)
        .get("/api/audit")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const logs = res.body.data.logs;
      expect(logs.length).toBeGreaterThan(0);
      expect(logs.some((e) => e.tenantId === SENTINEL_TENANT)).toBe(false);
      expect(logs.some((e) => e.eventId === "aud_sentinel_001")).toBe(false);
      expect(logs.some((e) => e.eventId === "aud_valid_001")).toBe(true);
    });

    it("GET /api/audit?tenantId=<sentinel> returns empty list", async () => {
      const res = await request(app)
        .get(`/api/audit?tenantId=${SENTINEL_TENANT}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.logs).toEqual([]);
      expect(res.body.data.pagination.total).toBe(0);
    });

    it("GET /api/audit/:eventId returns 404 for sentinel event", async () => {
      const res = await request(app)
        .get("/api/audit/aud_sentinel_001")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });

    it("GET /api/audit/:eventId?tenantId=<sentinel> returns 404", async () => {
      const res = await request(app)
        .get(`/api/audit/aud_sentinel_001?tenantId=${SENTINEL_TENANT}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe("7. policy-config endpoints", () => {
    it("GET /api/policy-config never returns sentinel config without filter", async () => {
      const res = await request(app)
        .get("/api/policy-config")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      const configs = res.body.data.records;
      expect(configs.length).toBeGreaterThan(0);
      expect(configs.some((c) => c.tenantId === SENTINEL_TENANT)).toBe(false);
      expect(configs.some((c) => c._id.toString() === sentinelConfigId)).toBe(false);
      expect(configs.some((c) => c._id.toString() === validConfigId)).toBe(true);
    });

    it("GET /api/policy-config?tenantId=<sentinel> returns empty list", async () => {
      const res = await request(app)
        .get(`/api/policy-config?tenantId=${SENTINEL_TENANT}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.records).toEqual([]);
      expect(res.body.data.pagination.total).toBe(0);
    });

    it("GET /api/policy-config/active?tenantId=<sentinel> returns null active config", async () => {
      const res = await request(app)
        .get(`/api/policy-config/active?tenantId=${SENTINEL_TENANT}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toBeNull();
    });

    it("GET /api/policy-config/:id returns 404 for sentinel policy config", async () => {
      const res = await request(app)
        .get(`/api/policy-config/${sentinelConfigId}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  describe("8. payment-actions endpoints", () => {
    it("GET /api/payment-actions/case/:caseId with sentinel case returns empty list", async () => {
      const res = await request(app)
        .get("/api/payment-actions/case/case_sentinel_001")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it("GET /api/payment-actions/case/:caseId?tenantId=<sentinel> returns empty list", async () => {
      const res = await request(app)
        .get(`/api/payment-actions/case/case_valid_001?tenantId=${SENTINEL_TENANT}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });
  });

  describe("9. orchestration endpoints", () => {
    it("GET /api/payment-cases/:caseId/orchestration/tasks returns empty list for sentinel case", async () => {
      const res = await request(app)
        .get("/api/payment-cases/case_sentinel_001/orchestration/tasks")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });

    it("GET /api/payment-cases/:caseId/orchestration/tasks?tenantId=<sentinel> returns empty list", async () => {
      const res = await request(app)
        .get(`/api/payment-cases/case_valid_001/orchestration/tasks?tenantId=${SENTINEL_TENANT}`)
        .set("Authorization", `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data).toEqual([]);
    });
  });
});
