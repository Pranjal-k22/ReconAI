import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { OrchestrationTask } from "../../src/models/OrchestrationTask.js";
import { PaymentCase } from "../../src/models/PaymentCase.js";
import { GatewayPayment } from "../../src/models/GatewayPayment.js";
import { MerchantOrder } from "../../src/models/MerchantOrder.js";
import { OrchestrationControl } from "../../src/models/OrchestrationControl.js";
import { ProviderOperation } from "../../src/models/ProviderOperation.js";
import {
  queueOrchestrationTask,
  claimDueOrchestrationTask,
  renewOrchestrationTaskLease,
  transitionTaskState,
  processOrchestrationTask,
  sweepDueOrchestrationTasks
} from "../../src/services/orchestration/orchestrationService.js";
import {
  setOrchestratorKillSwitch,
  getOrchestratorMetrics,
  resetOrchestratorMetrics,
  checkOrchestratorGate
} from "../../src/services/orchestration/orchestratorGate.js";

import { validateTestDatabaseUri } from "../helpers/testDbGuard.js";

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
    await ProviderOperation.deleteMany({});
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
    await ProviderOperation.deleteMany({});
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

    it("guarantees long-running task lease renewal prevents concurrency, blocks competing workers during valid lease, and aborts former worker after legitimate lease expiry and reclaim", async () => {
      let currentTime = new Date("2026-10-12T10:00:00.000Z");
      const clock = () => new Date(currentTime.getTime());

      const caseId = "CASE-LONG-RUN-CONCURRENCY";
      const idempotencyKey = "idem_long_run_concurrency";

      // Seed resources
      await GatewayPayment.create({
        gatewayPaymentId: "pay_long_run_01",
        tenantId: TENANT_A,
        merchantOrderId: "order_long_run_01",
        amountPaise: 20000,
        currency: "INR",
        status: "CAPTURED"
      });
      await MerchantOrder.create({
        merchantOrderId: "order_long_run_01",
        tenantId: TENANT_A,
        amountPaise: 20000,
        currency: "INR",
        status: "PAID"
      });
      await PaymentCase.create({
        caseId,
        tenantId: TENANT_A,
        gatewayPaymentId: "pay_long_run_01",
        merchantOrderId: "order_long_run_01",
        discrepancyCategory: "STATUS_MISMATCH",
        orderStatus: "ORDER_PAID",
        captureStatus: "CAPTURE_CAPTURED",
        resolutionCaseStatus: "CASE_INVESTIGATING"
      });

      // 1. Task queued at T0
      const queuedTask = await queueOrchestrationTask({
        tenantId: TENANT_A,
        caseId,
        idempotencyKey,
        gatewayPaymentId: "pay_long_run_01",
        merchantOrderId: "order_long_run_01",
        asOfTime: clock()
      });
      expect(queuedTask).not.toBeNull();

      // 1. Worker A claims the task at T0 with 30s lease
      const claimedA = await claimDueOrchestrationTask({
        workerId: "worker-A",
        leaseDurationMs: 30000,
        clock
      });
      expect(claimedA).not.toBeNull();
      expect(claimedA.lockedBy).toBe("worker-A");
      expect(claimedA.lockedUntil.getTime()).toBe(currentTime.getTime() + 30000); // T0 + 30s

      const recordedFetchCalls = [];
      let workerBClaimAttempt1Result = "UNTESTED";
      let workerBReclaimResult = null;

      // Deterministic read-only fetch implementation simulating a long-running provider check
      const customFetch = async (url, options = {}) => {
        recordedFetchCalls.push({
          url: String(url),
          method: options.method || "GET"
        });

        // 2. Keep worker A processing longer than original 30-second lease:
        // Advance clock to T0 + 35s (> original 30s lease, but within the renewed lease which is T0 + 45s)
        currentTime = new Date(currentTime.getTime() + 20000); // now T0 + 35s

        // 3. Attempt to have worker B claim or recover the same task while A is still active
        const claimBAttempt1 = await claimDueOrchestrationTask({
          workerId: "worker-B",
          clock
        });
        workerBClaimAttempt1Result = claimBAttempt1;

        // 5. Simulate genuine lease expiry: advance clock past Worker A's renewed lease (T0 + 45s) to T0 + 50s
        currentTime = new Date(currentTime.getTime() + 15000); // now T0 + 50s

        // Worker B legitimately reclaims the task after Worker A's renewed lease expired
        workerBReclaimResult = await claimDueOrchestrationTask({
          workerId: "worker-B",
          leaseDurationMs: 30000,
          clock
        });

        // Return strictly read-only provider data
        return {
          ok: true,
          status: 200,
          json: async () => ({
            id: "pay_long_run_01",
            status: "captured",
            amount: 20000,
            currency: "INR"
          })
        };
      };

      // Set time to T0 + 15s before Worker A enters Step 4 renewal (which extends lease to T0 + 45s)
      currentTime = new Date(currentTime.getTime() + 15000); // T0 + 15s

      // Worker A processes task with controlled clock and customFetch
      const outcomeA = await processOrchestrationTask(claimedA, {
        workerId: "worker-A",
        clock,
        customFetch,
        policyConfig: { maxSingleRefundPaise: 500000, maxCumulativeRefundPaise: 2000000 }
      });

      // 4. Verify that B cannot execute the task concurrently while A holds a valid renewed lease
      expect(workerBClaimAttempt1Result).toBeNull();

      // 5. Verify that B legitimately reclaimed the task after lease genuinely expired
      expect(workerBReclaimResult).not.toBeNull();
      expect(workerBReclaimResult.lockedBy).toBe("worker-B");
      expect(workerBReclaimResult.attemptCount).toBe(2);

      // 6. Verify that A loses ownership and cannot commit a state transition after B legitimately reclaims the task
      expect(outcomeA.status).toBe("LEASE_LOST");

      // Verify direct transition by former Worker A is also rejected with LEASE_OWNERSHIP_LOST
      await expect(
        transitionTaskState(claimedA, "POLICY_EVALUATION", {
          workerId: "worker-A",
          clock
        })
      ).rejects.toThrow();

      // Verify in MongoDB that task is STILL owned by Worker B and Worker A made ZERO updates after reclaim
      const inDb = await OrchestrationTask.findOne({ taskId: claimedA.taskId }).lean();
      expect(inDb.lockedBy).toBe("worker-B");
      expect(inDb.state).toBe("CLAIMED");

      // 7. Verify duplicate scheduling remains idempotent
      const duplicateTask = await queueOrchestrationTask({
        tenantId: TENANT_A,
        caseId,
        idempotencyKey,
        asOfTime: clock()
      });
      expect(duplicateTask.taskId).toBe(claimedA.taskId);
      const taskCount = await OrchestrationTask.countDocuments({
        tenantId: TENANT_A,
        idempotencyKey
      });
      expect(taskCount).toBe(1);

      // 7. Verify NO provider mutation occurred (all calls were strictly read-only GET requests)
      expect(recordedFetchCalls.length).toBe(1);
      expect(recordedFetchCalls[0].method).toBe("GET");
      const providerOperationsCount = await ProviderOperation.countDocuments({});
      expect(providerOperationsCount).toBe(0);

      // Verify Worker B can now proceed to process the reclaimed task cleanly
      const outcomeB = await processOrchestrationTask(workerBReclaimResult, {
        workerId: "worker-B",
        clock,
        policyConfig: { maxSingleRefundPaise: 500000, maxCumulativeRefundPaise: 2000000 }
      });
      expect(["WAITING_FOR_RECHECK", "COMPLETED"]).toContain(outcomeB.status);
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

    it("P0-02 Real MongoDB: Worker A loses lease to Worker B and cannot transition afterward", async () => {
      const caseId = "CASE-LEASE-LOSS-REAL";
      const idempotencyKey = `idem_loss_${Date.now()}`;

      await PaymentCase.create({
        caseId,
        tenantId: TENANT_A,
        discrepancyCategory: "STATUS_MISMATCH"
      });

      const task = await queueOrchestrationTask({
        tenantId: TENANT_A,
        caseId,
        idempotencyKey
      });

      // Worker A claims task with a short real lease of 200ms
      const claimedA = await claimDueOrchestrationTask({
        workerId: "worker-A",
        leaseDurationMs: 200
      });
      expect(claimedA).not.toBeNull();
      expect(claimedA.lockedBy).toBe("worker-A");

      // Wait 300ms for Worker A's lease to expire in real MongoDB
      await new Promise((resolve) => setTimeout(resolve, 300));

      // Worker B legitimately claims the expired task
      const claimedB = await claimDueOrchestrationTask({
        workerId: "worker-B",
        leaseDurationMs: 30000
      });
      expect(claimedB).not.toBeNull();
      expect(claimedB.lockedBy).toBe("worker-B");

      // Negative check 1: Missing or null workerId is rejected before query
      await expect(
        transitionTaskState(claimedA, "EVIDENCE_COLLECTION", {})
      ).rejects.toThrow(/workerId is required/i);

      await expect(
        transitionTaskState(claimedA, "EVIDENCE_COLLECTION", { workerId: null })
      ).rejects.toThrow(/workerId is required/i);

      // Negative check 2: Worker A attempts to transition after losing lease to Worker B
      await expect(
        transitionTaskState(claimedA, "EVIDENCE_COLLECTION", { workerId: "worker-A" })
      ).rejects.toThrow(/lease lost or expired/i);

      // Verify in MongoDB that Worker B remains the sole owner and Worker A made no mutation
      const docInDb = await OrchestrationTask.findOne({ taskId: task.taskId }).lean();
      expect(docInDb.lockedBy).toBe("worker-B");
      expect(docInDb.state).toBe("CLAIMED");

      // Positive check: Worker B can legitimately transition the owned task
      const transitionedB = await transitionTaskState(claimedB, "EVIDENCE_COLLECTION", {
        workerId: "worker-B"
      });
      expect(transitionedB.state).toBe("EVIDENCE_COLLECTION");
      expect(transitionedB.lockedBy).toBe("worker-B");
    });

    it("P0-03 Real MongoDB: short real lease with slow operation expires and cannot be extended by frozen timestamp", async () => {
      const caseId = "CASE-REAL-CLOCK-BOUNDARY";
      const idempotencyKey = `idem_clock_${Date.now()}`;
      const originalEnv = process.env.NODE_ENV;

      try {
        // Enforce production mode: static Date injection must be ignored
        process.env.NODE_ENV = "production";

        await PaymentCase.create({
          caseId,
          tenantId: TENANT_A,
          discrepancyCategory: "STATUS_MISMATCH"
        });

        const task = await queueOrchestrationTask({
          tenantId: TENANT_A,
          caseId,
          idempotencyKey
        });

        // Worker claims task with a short real lease of 150ms
        const claimed = await claimDueOrchestrationTask({
          workerId: "worker-real-clock",
          leaseDurationMs: 150
        });
        expect(claimed).not.toBeNull();
        expect(claimed.lockedBy).toBe("worker-real-clock");

        // Freeze timestamp from when lease was valid
        const frozenTimestamp = new Date();

        // Slow operation: sleep 250ms so real lease expires
        await new Promise((resolve) => setTimeout(resolve, 250));

        // Attempt lease renewal with frozen timestamp
        // Production lease check must read the real clock and ignore the frozen timestamp
        const renewal = await renewOrchestrationTaskLease({
          taskId: task.taskId,
          workerId: "worker-real-clock",
          leaseDurationMs: 30000,
          asOfTime: frozenTimestamp
        });
        expect(renewal.renewed).toBe(false);
        expect(renewal.reason).toBe("LEASE_LOST_OR_EXPIRED");

        // Attempt state transition with frozen timestamp
        await expect(
          transitionTaskState(claimed, "EVIDENCE_COLLECTION", {
            workerId: "worker-real-clock",
            asOfTime: frozenTimestamp
          })
        ).rejects.toThrow(/lease lost or expired/i);
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
    });
  });
});
