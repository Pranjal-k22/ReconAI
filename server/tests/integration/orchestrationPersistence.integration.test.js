import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { OrchestrationTask } from "../../src/models/OrchestrationTask.js";
import { PaymentCase } from "../../src/models/PaymentCase.js";
import { GatewayPayment } from "../../src/models/GatewayPayment.js";
import { MerchantOrder } from "../../src/models/MerchantOrder.js";
import { OrchestrationControl } from "../../src/models/OrchestrationControl.js";
import {
  queueOrchestrationTask,
  claimDueOrchestrationTask,
  renewOrchestrationTaskLease,
  processOrchestrationTask,
  sweepDueOrchestrationTasks
} from "../../src/services/orchestration/orchestrationService.js";
import {
  setOrchestratorKillSwitch,
  getOrchestratorMetrics,
  resetOrchestratorMetrics,
  checkOrchestratorGate
} from "../../src/services/orchestration/orchestratorGate.js";

function validateTestDatabaseUri(uri) {
  if (!uri || typeof uri !== "string") {
    throw new Error("MONGODB_TEST_URI must be provided as a non-empty string");
  }
  let dbName = "";
  try {
    const url = new URL(uri.replace(/^mongodb(\+srv)?:\/\//, "http://"));
    dbName = url.pathname.replace(/^\//, "");
  } catch {
    const match = uri.match(/\/([^/?]+)(\?|$)/);
    if (match) dbName = match[1];
  }
  if (!dbName || !dbName.toLowerCase().includes("test")) {
    throw new Error("Test database name must contain 'test'");
  }
  return uri;
}

const DEFAULT_TEST_URI = "mongodb://127.0.0.1:27017/reconai_test_orchestration_persistence";
const TEST_DB_URI = validateTestDatabaseUri(process.env.MONGODB_TEST_URI || DEFAULT_TEST_URI);

describe("Autonomous Orchestration Worker - Real MongoDB Integration", { timeout: 35000 }, () => {
  const TENANT_A = "tenant_orch_int_alpha";
  const CASE_ID_1 = "CASE-ORCH-INT-001";
  const CASE_ID_22 = "CASE-ORCH-INT-022";

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 5000 });
    await OrchestrationTask.deleteMany({});
    await OrchestrationControl.deleteMany({});
    await PaymentCase.deleteMany({});
    await GatewayPayment.deleteMany({});
    await MerchantOrder.deleteMany({});
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.db.dropDatabase().catch(() => {});
      await mongoose.disconnect();
    }
  });

  beforeEach(async () => {
    resetOrchestratorMetrics();
    await setOrchestratorKillSwitch(false);
    process.env.ORCHESTRATOR_WORKER_ENABLED = "true";

    await OrchestrationTask.deleteMany({});
    await OrchestrationControl.deleteMany({});
    await PaymentCase.deleteMany({});
    await GatewayPayment.deleteMany({});
    await MerchantOrder.deleteMany({});
  });

  describe("1. Unique Idempotency & Database Deduplication", () => {
    it("enforces unique compound index on { tenantId: 1, idempotencyKey: 1 } at the database level", async () => {
      const task1 = await queueOrchestrationTask({
        tenantId: TENANT_A,
        caseId: CASE_ID_1,
        idempotencyKey: "idem_int_001"
      });

      const task2 = await queueOrchestrationTask({
        tenantId: TENANT_A,
        caseId: CASE_ID_1,
        idempotencyKey: "idem_int_001"
      });

      expect(task1.taskId).toBe(task2.taskId);

      const count = await OrchestrationTask.countDocuments({
        tenantId: TENANT_A,
        idempotencyKey: "idem_int_001"
      });
      expect(count).toBe(1);
    });
  });

  describe("2. Atomic Distributed Leases & Concurrency Protection", () => {
    it("guarantees only ONE concurrent worker can claim a due task; second worker gets null", async () => {
      await queueOrchestrationTask({
        tenantId: TENANT_A,
        caseId: CASE_ID_1,
        idempotencyKey: "idem_concurrency_01"
      });

      // Two workers attempt atomic claim simultaneously
      const [claim1, claim2] = await Promise.all([
        claimDueOrchestrationTask({ workerId: "worker-A" }),
        claimDueOrchestrationTask({ workerId: "worker-B" })
      ]);

      // Exactly one succeeds, one gets null
      const claimedWorker = claim1 ? "worker-A" : claim2 ? "worker-B" : null;
      expect(claimedWorker).not.toBeNull();
      expect(Boolean(claim1 && claim2)).toBe(false);

      const winner = claim1 || claim2;
      expect(winner.state).toBe("CLAIMED");
      expect(winner.lockedBy).toBe(claimedWorker);
      expect(winner.attemptCount).toBe(1);
    });

    it("recovers stale lease safely after simulated worker crash", async () => {
      const pastTime = new Date(Date.now() - 60000); // 60s ago (lease expired)

      await OrchestrationTask.create({
        taskId: "task_crashed_worker",
        tenantId: TENANT_A,
        caseId: CASE_ID_1,
        idempotencyKey: "idem_stale_recovery",
        state: "EVIDENCE_COLLECTION",
        lockedUntil: pastTime,
        lockedBy: "crashed-worker-99",
        attemptCount: 1,
        nextRunAt: pastTime
      });

      // Worker B sweeps/claims due tasks
      const recovered = await claimDueOrchestrationTask({
        workerId: "worker-recovery",
        asOfTime: new Date()
      });

      expect(recovered).not.toBeNull();
      expect(recovered.taskId).toBe("task_crashed_worker");
      expect(recovered.lockedBy).toBe("worker-recovery");
      expect(recovered.attemptCount).toBe(2);

      const metrics = getOrchestratorMetrics();
      expect(metrics.staleLeasesRecovered).toBe(1);
    });

    it("renews lease safely in MongoDB while task is actively running and prevents second worker from reclaiming", async () => {
      const t0 = new Date();
      await queueOrchestrationTask({
        tenantId: TENANT_A,
        caseId: CASE_ID_1,
        idempotencyKey: "idem_renewal_test_01",
        asOfTime: t0
      });

      // Worker 1 claims task with 30s lease
      const claimed = await claimDueOrchestrationTask({
        workerId: "worker-active-1",
        leaseDurationMs: 30000,
        asOfTime: t0
      });
      expect(claimed).not.toBeNull();
      expect(claimed.lockedBy).toBe("worker-active-1");

      // At T0 + 20s, Worker 1 renews lease for 60s
      const t20 = new Date(t0.getTime() + 20000);
      const renewal = await renewOrchestrationTaskLease({
        taskId: claimed.taskId,
        workerId: "worker-active-1",
        leaseDurationMs: 60000,
        asOfTime: t20
      });

      expect(renewal.renewed).toBe(true);
      expect(renewal.task.lockedUntil.getTime()).toBe(t20.getTime() + 60000);

      // Verify in MongoDB directly
      const inDb = await OrchestrationTask.findOne({ taskId: claimed.taskId }).lean();
      expect(inDb.lockedUntil.getTime()).toBe(t20.getTime() + 60000);

      // At T0 + 35s (past original 30s lease, but within renewed lease), Worker 2 tries to claim
      const t35 = new Date(t0.getTime() + 35000);
      const claimAttempt = await claimDueOrchestrationTask({
        workerId: "worker-competitor",
        asOfTime: t35
      });
      expect(claimAttempt).toBeNull(); // Reclaim blocked because lease was renewed
    });

    it("prevents former worker from persisting state transitions after losing lease ownership", async () => {
      const t0 = new Date();
      await queueOrchestrationTask({
        tenantId: TENANT_A,
        caseId: CASE_ID_1,
        idempotencyKey: "idem_lease_loss_guard",
        asOfTime: t0
      });

      // Worker 1 claims task with 30s lease
      const claimed1 = await claimDueOrchestrationTask({
        workerId: "worker-delayed-1",
        leaseDurationMs: 30000,
        asOfTime: t0
      });
      expect(claimed1).not.toBeNull();

      // At T0 + 40s (Worker 1's lease expired), Worker 2 recovers the stale lease
      const t40 = new Date(t0.getTime() + 40000);
      const claimed2 = await claimDueOrchestrationTask({
        workerId: "worker-fast-2",
        leaseDurationMs: 30000,
        asOfTime: t40
      });
      expect(claimed2).not.toBeNull();
      expect(claimed2.lockedBy).toBe("worker-fast-2");

      // Seed resources so worker-1 could have processed if it hadn't lost lease
      await GatewayPayment.create({
        gatewayPaymentId: "pay_lease_loss",
        tenantId: TENANT_A,
        status: "CAPTURED",
        amountPaise: 10000
      });
      await MerchantOrder.create({
        merchantOrderId: "order_lease_loss",
        tenantId: TENANT_A,
        status: "PAID",
        amountPaise: 10000
      });
      await PaymentCase.create({
        caseId: CASE_ID_1,
        tenantId: TENANT_A,
        gatewayPaymentId: "pay_lease_loss",
        merchantOrderId: "order_lease_loss",
        discrepancyCategory: "STATUS_MISMATCH"
      });

      // Former Worker 1 wakes up at T0 + 45s and tries to process task
      const outcomeWorker1 = await processOrchestrationTask(claimed1, {
        workerId: "worker-delayed-1",
        asOfTime: new Date(t0.getTime() + 45000)
      });

      // Former worker's attempt must be aborted due to lease loss
      expect(outcomeWorker1.status).toBe("LEASE_LOST");

      // Verify that task in MongoDB is STILL owned by Worker 2 and NOT corrupted by Worker 1
      const inDbAfter = await OrchestrationTask.findOne({ taskId: claimed1.taskId }).lean();
      expect(inDbAfter.lockedBy).toBe("worker-fast-2");
      expect(inDbAfter.state).toBe("CLAIMED");
    });
  });

  describe("3. End-to-End Orchestration & Case 22 Containment", () => {
    it("executes full 7-step pipeline in MongoDB and tracks complete stateHistory", async () => {
      // Seed matching payment and order
      await GatewayPayment.create({
        gatewayPaymentId: "pay_orch_matched_1",
        tenantId: TENANT_A,
        merchantOrderId: "order_orch_matched_1",
        amountPaise: 25000,
        currency: "INR",
        status: "CAPTURED"
      });

      await MerchantOrder.create({
        merchantOrderId: "order_orch_matched_1",
        tenantId: TENANT_A,
        amountPaise: 25000,
        currency: "INR",
        status: "PAID"
      });

      await PaymentCase.create({
        caseId: CASE_ID_1,
        tenantId: TENANT_A,
        gatewayPaymentId: "pay_orch_matched_1",
        merchantOrderId: "order_orch_matched_1",
        discrepancyCategory: "STATUS_MISMATCH",
        orderStatus: "ORDER_PAID",
        captureStatus: "CAPTURE_CAPTURED",
        resolutionCaseStatus: "CASE_INVESTIGATING"
      });

      const task = await queueOrchestrationTask({
        tenantId: TENANT_A,
        caseId: CASE_ID_1,
        idempotencyKey: "idem_e2e_matched_1",
        gatewayPaymentId: "pay_orch_matched_1",
        merchantOrderId: "order_orch_matched_1"
      });

      const claimed = await claimDueOrchestrationTask({ workerId: "worker-e2e" });
      expect(claimed).not.toBeNull();

      const outcome = await processOrchestrationTask(claimed, {
        workerId: "worker-e2e",
        policyConfig: { maxSingleRefundPaise: 500000, maxCumulativeRefundPaise: 2000000 }
      });

      expect(outcome.status).toBe("WAITING_FOR_RECHECK");
      expect(outcome.nextRunAt).toBeDefined();

      const inDb = await OrchestrationTask.findOne({ taskId: task.taskId }).lean();
      expect(inDb.state).toBe("WAITING_FOR_RECHECK");
      expect(inDb.lockedUntil).toBeNull();
      expect(inDb.stateHistory.length).toBeGreaterThanOrEqual(4);

      const statesInHistory = inDb.stateHistory.map((h) => h.toState);
      expect(statesInHistory).toContain("QUEUED");
      expect(statesInHistory).toContain("CLAIMED");
      expect(statesInHistory).toContain("EVIDENCE_COLLECTION");
      expect(statesInHistory).toContain("POLICY_EVALUATION");
      expect(statesInHistory).toContain("WAITING_FOR_RECHECK");
    });

    it("Case 22 (late capture on cancelled order) transitions unconditionally to SAFE_HOLD in MongoDB with ZERO mutations", async () => {
      await GatewayPayment.create({
        gatewayPaymentId: "pay_case22_int",
        tenantId: TENANT_A,
        merchantOrderId: "order_case22_int",
        amountPaise: 30000,
        currency: "INR",
        status: "CAPTURED"
      });

      await MerchantOrder.create({
        merchantOrderId: "order_case22_int",
        tenantId: TENANT_A,
        amountPaise: 30000,
        currency: "INR",
        status: "CANCELLED"
      });

      await PaymentCase.create({
        caseId: CASE_ID_22,
        tenantId: TENANT_A,
        gatewayPaymentId: "pay_case22_int",
        merchantOrderId: "order_case22_int",
        discrepancyCategory: "CANCELLED_ORDER_CAPTURED",
        orderStatus: "ORDER_CANCELLED",
        captureStatus: "CAPTURE_CAPTURED",
        resolutionCaseStatus: "CASE_SAFE_HOLD"
      });

      await queueOrchestrationTask({
        tenantId: TENANT_A,
        caseId: CASE_ID_22,
        idempotencyKey: "idem_c22_int",
        gatewayPaymentId: "pay_case22_int",
        merchantOrderId: "order_case22_int"
      });

      const sweep = await sweepDueOrchestrationTasks({
        workerId: "worker-c22-sweep",
        policyConfig: { maxSingleRefundPaise: 500000, maxCumulativeRefundPaise: 2000000 }
      });

      expect(sweep.processedCount).toBe(1);
      expect(sweep.safeHoldCount).toBe(1);

      const inDb = await OrchestrationTask.findOne({ caseId: CASE_ID_22, tenantId: TENANT_A }).lean();
      expect(inDb.state).toBe("SAFE_HOLD");
      expect(inDb.safeHoldCode).toBe("R_LATE_CAPTURE_CANCELLED_ORDER_HOLD");
      expect(inDb.escalationState).toBe("PENDING_OPERATOR_REVIEW");

      // Verify ZERO mutations on canonical records
      const preservedOrder = await MerchantOrder.findOne({ merchantOrderId: "order_case22_int" }).lean();
      expect(preservedOrder.status).toBe("CANCELLED");

      const preservedPayment = await GatewayPayment.findOne({ gatewayPaymentId: "pay_case22_int" }).lean();
      expect(preservedPayment.status).toBe("CAPTURED");
    });
  });

  describe("4. Process-Shared Kill Switch Across Process Boundaries", () => {
    it("persists kill switch to MongoDB OrchestrationControl and stops separate worker process claims", async () => {
      await queueOrchestrationTask({
        tenantId: TENANT_A,
        caseId: CASE_ID_1,
        idempotencyKey: "idem_shared_switch_1"
      });

      // API process engages kill switch durably in MongoDB
      await setOrchestratorKillSwitch(true, {
        updatedBy: "ADMIN_OPERATOR_API",
        reason: "Emergency kill switch audit"
      });

      // Verify persistence in MongoDB OrchestrationControl collection
      const controlDoc = await OrchestrationControl.findOne({
        controlKey: "GLOBAL_ORCHESTRATION_CONTROL"
      }).lean();
      expect(controlDoc).not.toBeNull();
      expect(controlDoc.killSwitchActive).toBe(true);
      expect(controlDoc.updatedBy).toBe("ADMIN_OPERATOR_API");

      // Separate worker process attempts claim (checks MongoDB gate)
      const claimResult = await claimDueOrchestrationTask({
        workerId: "standalone-node-worker-process"
      });

      expect(claimResult).toBeNull();

      // Disengage cleanly
      await setOrchestratorKillSwitch(false, { updatedBy: "ADMIN_OPERATOR_API" });
      const allowedClaim = await claimDueOrchestrationTask({
        workerId: "standalone-node-worker-process"
      });
      expect(allowedClaim).not.toBeNull();
    });

    it("fails closed when shared control database state is unreadable or encounters DB error", async () => {
      // Temporarily mock OrchestrationControl.findOne to reject
      const origFindOne = OrchestrationControl.findOne;
      OrchestrationControl.findOne = () => ({
        lean: () => Promise.reject(new Error("Connection reset by peer"))
      });

      try {
        const gate = await checkOrchestratorGate();
        expect(gate.allowed).toBe(false);
        expect(gate.reason).toBe("DATABASE_UNAVAILABLE_FAIL_CLOSED");

        const claim = await claimDueOrchestrationTask();
        expect(claim).toBeNull();
      } finally {
        OrchestrationControl.findOne = origFindOne;
      }
    });

    it("stops an in-flight worker before consequential step when kill switch is engaged mid-run", async () => {
      // Seed payment case
      await PaymentCase.create({
        caseId: "CASE-MID-RUN",
        tenantId: TENANT_A,
        discrepancyCategory: "STATUS_MISMATCH"
      });

      const task = await queueOrchestrationTask({
        tenantId: TENANT_A,
        caseId: "CASE-MID-RUN",
        idempotencyKey: "idem_mid_run"
      });

      const claimed = await claimDueOrchestrationTask({ workerId: "worker-mid-run" });
      expect(claimed).not.toBeNull();

      // Engage kill switch while task is in flight
      await setOrchestratorKillSwitch(true, { updatedBy: "ADMIN", reason: "Mid-run halt" });

      const outcome = await processOrchestrationTask(claimed, { workerId: "worker-mid-run" });
      expect(outcome.status).toBe("WAITING_FOR_RECHECK");

      // Verify task in DB released locks cleanly
      const inDb = await OrchestrationTask.findOne({ taskId: task.taskId }).lean();
      expect(inDb.state).toBe("WAITING_FOR_RECHECK");
      expect(inDb.lockedUntil).toBeNull();
      expect(inDb.lockedBy).toBeNull();
    });
  });
});
