import { describe, it, expect, beforeEach } from "vitest";
import {
  checkOrchestratorGate,
  setOrchestratorKillSwitch,
  isOrchestratorKillSwitchActive,
  getOrchestratorMetrics,
  resetOrchestratorMetrics,
  sanitizeOrchestrationPayload
} from "../../src/services/orchestration/orchestratorGate.js";
import {
  queueOrchestrationTask,
  claimDueOrchestrationTask,
  processOrchestrationTask,
  sweepDueOrchestrationTasks,
  resetInMemoryOrchestrationStore,
  calculateOrchestrationBackoffTime
} from "../../src/services/orchestration/orchestrationService.js";
import { startOrchestrationWorker } from "../../src/services/orchestration/orchestrationWorker.js";

describe("Orchestrator Gate and Service Unit Tests", () => {
  beforeEach(() => {
    resetOrchestratorMetrics();
    resetInMemoryOrchestrationStore();
    setOrchestratorKillSwitch(false);
  });

  describe("1. Centralized Configuration Gate & Kill Switch", () => {
    it("fails closed by default when ORCHESTRATOR_WORKER_ENABLED is false", () => {
      // By default in test environment, ORCHESTRATOR_WORKER_ENABLED is false
      const gate = checkOrchestratorGate();
      expect(gate.allowed).toBe(false);
      expect(gate.reason).toBe("ORCHESTRATOR_WORKER_DISABLED");
    });

    it("fails closed immediately when operator kill switch is engaged", () => {
      setOrchestratorKillSwitch(true);
      expect(isOrchestratorKillSwitchActive()).toBe(true);

      const gate = checkOrchestratorGate();
      expect(gate.allowed).toBe(false);
      expect(gate.reason).toBe("KILL_SWITCH_ACTIVE");

      setOrchestratorKillSwitch(false);
      expect(isOrchestratorKillSwitchActive()).toBe(false);
    });

    it("worker startup fails closed and returns disabled handle when gate is not allowed", () => {
      const worker = startOrchestrationWorker({ runImmediate: false });
      expect(worker.isEnabled).toBe(false);
      expect(worker.isRunning()).toBe(false);
      worker.stop();
    });

    it("claimDueOrchestrationTask returns null immediately when gate is disabled", async () => {
      const task = await claimDueOrchestrationTask();
      expect(task).toBeNull();
    });

    it("sweepDueOrchestrationTasks returns zero processed count when gate is disabled", async () => {
      const sweep = await sweepDueOrchestrationTasks();
      expect(sweep.processedCount).toBe(0);
      expect(sweep.reason).toBe("ORCHESTRATOR_WORKER_DISABLED");
    });
  });

  describe("2. Payload Sanitization & Operational Observability", () => {
    it("strips raw secrets, tokens, passwords, and sensitive PII from payloads", () => {
      const dirtyPayload = {
        authorization: "Bearer secret-token-12345",
        password: "SuperSecretPassword!",
        jwt: "eyJhbGciOi...",
        client_secret: "rzp_secret_9999",
        card_number: "4111111111111111",
        cvv: "123",
        email: "customer@merchant.com",
        phone: "+919876543210",
        nested: {
          token: "nested-token-999",
          safeField: "order_12345"
        },
        caseId: "case_test_001"
      };

      const cleaned = sanitizeOrchestrationPayload(dirtyPayload);
      expect(cleaned.authorization).toBe("[REDACTED]");
      expect(cleaned.password).toBe("[REDACTED]");
      expect(cleaned.jwt).toBe("[REDACTED]");
      expect(cleaned.client_secret).toBe("[REDACTED]");
      expect(cleaned.card_number).toBe("[REDACTED]");
      expect(cleaned.cvv).toBe("[REDACTED]");
      expect(cleaned.email).toBe("[REDACTED]");
      expect(cleaned.phone).toBe("[REDACTED]");
      expect(cleaned.nested.token).toBe("[REDACTED]");
      expect(cleaned.nested.safeField).toBe("order_12345");
      expect(cleaned.caseId).toBe("case_test_001");
    });

    it("tracks metrics for queued, claimed, safe holds, retries, and escalations", async () => {
      const metrics = getOrchestratorMetrics();
      expect(metrics.tasksQueued).toBe(0);
      expect(metrics.safeHolds).toBe(0);
      expect(metrics.escalations).toBe(0);

      await queueOrchestrationTask({
        tenantId: "tenant_t1",
        caseId: "case_c1",
        idempotencyKey: "idem_k1"
      });

      const updated = getOrchestratorMetrics();
      expect(updated.tasksQueued).toBe(1);
    });
  });

  describe("3. Bounded Backoff Schedule & Idempotent Queuing", () => {
    it("calculates exponential backoff strictly according to [60s, 300s, 900s, 1800s]", () => {
      const baseTime = new Date("2026-10-12T12:00:00Z");

      const t0 = calculateOrchestrationBackoffTime({ attemptCount: 0, asOfTime: baseTime });
      expect(t0.getTime() - baseTime.getTime()).toBe(60 * 1000);

      const t1 = calculateOrchestrationBackoffTime({ attemptCount: 1, asOfTime: baseTime });
      expect(t1.getTime() - baseTime.getTime()).toBe(300 * 1000);

      const t2 = calculateOrchestrationBackoffTime({ attemptCount: 2, asOfTime: baseTime });
      expect(t2.getTime() - baseTime.getTime()).toBe(900 * 1000);

      const t3 = calculateOrchestrationBackoffTime({ attemptCount: 3, asOfTime: baseTime });
      expect(t3.getTime() - baseTime.getTime()).toBe(1800 * 1000);

      // Attempt >= 4 caps at 1800s
      const t4 = calculateOrchestrationBackoffTime({ attemptCount: 4, asOfTime: baseTime });
      expect(t4.getTime() - baseTime.getTime()).toBe(1800 * 1000);
    });

    it("idempotently returns existing task when queued repeatedly with the same idempotencyKey", async () => {
      const task1 = await queueOrchestrationTask({
        tenantId: "tenant_alpha",
        caseId: "case_001",
        idempotencyKey: "idem_alpha_1"
      });

      const task2 = await queueOrchestrationTask({
        tenantId: "tenant_alpha",
        caseId: "case_001",
        idempotencyKey: "idem_alpha_1"
      });

      expect(task1.taskId).toBe(task2.taskId);
    });
  });

  describe("4. Non-Executability Invariant & Safety Guardrails", () => {
    it("Case 22 (late capture on cancelled order) is placed unconditionally in SAFE_HOLD with zero mutations", async () => {
      const task = {
        taskId: "task_case22",
        tenantId: "tenant_test",
        caseId: "case_22",
        state: "CLAIMED",
        stateHistory: [],
        attemptCount: 1,
        mockPaymentCase: {
          caseId: "case_22",
          tenantId: "tenant_test",
          orderStatus: "ORDER_CANCELLED",
          captureStatus: "CAPTURE_CAPTURED",
          discrepancyCategory: "CANCELLED_ORDER_CAPTURED"
        },
        mockGatewayPayment: {
          gatewayPaymentId: "pay_c22",
          tenantId: "tenant_test",
          status: "CAPTURED",
          amountPaise: 50000
        },
        mockMerchantOrder: {
          merchantOrderId: "order_c22",
          tenantId: "tenant_test",
          status: "CANCELLED",
          amountPaise: 50000
        }
      };

      // Mock gate allowed for isolated unit test
      process.env.ORCHESTRATOR_WORKER_ENABLED = "true";

      const outcome = await processOrchestrationTask(task, {
        workerId: "test-worker",
        policyConfig: { maxSingleRefundPaise: 100000, maxCumulativeRefundPaise: 500000 }
      });

      process.env.ORCHESTRATOR_WORKER_ENABLED = "false";

      expect(outcome.status).toBe("SAFE_HOLD");
      expect(outcome.case22Held).toBe(true);
      expect(task.state).toBe("SAFE_HOLD");
      expect(task.safeHoldCode).toBe("R_LATE_CAPTURE_CANCELLED_ORDER_HOLD");
    });

    it("Autonomous worker NEVER executes refunds; proposes ESCALATION_REQUIRED instead", async () => {
      const task = {
        taskId: "task_refund_attempt",
        tenantId: "tenant_test",
        caseId: "case_normal",
        proposedActionType: "REQUEST_REFUND",
        state: "CLAIMED",
        stateHistory: [],
        attemptCount: 1,
        mockPaymentCase: {
          caseId: "case_normal",
          tenantId: "tenant_test",
          orderStatus: "ORDER_CANCELLED",
          captureStatus: "CAPTURE_NONE",
          discrepancyCategory: "FRONTEND_DROPPED_AFTER_SUCCESS",
          amountPaise: 10000,
          currency: "INR"
        },
        mockGatewayPayment: {
          gatewayPaymentId: "pay_normal",
          tenantId: "tenant_test",
          status: "AUTHORIZED",
          amountPaise: 10000,
          currency: "INR"
        },
        mockMerchantOrder: {
          merchantOrderId: "order_normal",
          tenantId: "tenant_test",
          status: "ORDER_PENDING",
          amountPaise: 10000,
          currency: "INR"
        }
      };

      process.env.ORCHESTRATOR_WORKER_ENABLED = "true";

      const outcome = await processOrchestrationTask(task, {
        workerId: "test-worker",
        policyConfig: { maxSingleRefundPaise: 100000, maxCumulativeRefundPaise: 500000 }
      });

      process.env.ORCHESTRATOR_WORKER_ENABLED = "false";

      expect(outcome.status).toBe("ESCALATION_REQUIRED");
      expect(outcome.reason).toBe("MUTATION_REQUIRES_HUMAN_APPROVAL");
      expect(task.state).toBe("ESCALATION_REQUIRED");
      expect(task.escalationState).toBe("PENDING_OPERATOR_APPROVAL");
    });

    it("Missing approved refund limits fail closed to ESCALATION_REQUIRED before any action", async () => {
      const task = {
        taskId: "task_missing_limits",
        tenantId: "tenant_test",
        caseId: "case_missing_limits",
        proposedActionType: "REQUEST_REFUND",
        state: "CLAIMED",
        stateHistory: [],
        attemptCount: 1,
        mockPaymentCase: {
          caseId: "case_missing_limits",
          tenantId: "tenant_test",
          orderStatus: "ORDER_PENDING",
          captureStatus: "CAPTURE_NONE",
          discrepancyCategory: "STATUS_MISMATCH"
        },
        mockGatewayPayment: {
          gatewayPaymentId: "pay_lim",
          tenantId: "tenant_test",
          status: "AUTHORIZED",
          amountPaise: 20000
        },
        mockMerchantOrder: {
          merchantOrderId: "order_lim",
          tenantId: "tenant_test",
          status: "ORDER_PENDING",
          amountPaise: 20000
        }
      };

      process.env.ORCHESTRATOR_WORKER_ENABLED = "true";

      // Passing policyConfig = null (missing server-side approved limits)
      const outcome = await processOrchestrationTask(task, {
        workerId: "test-worker",
        policyConfig: null
      });

      process.env.ORCHESTRATOR_WORKER_ENABLED = "false";

      expect(outcome.status).toBe("ESCALATION_REQUIRED");
      expect(task.state).toBe("ESCALATION_REQUIRED");
      expect(task.escalationReason).toContain("Fail-closed refund policy requires explicit limits");
    });

    it("Cross-tenant resource reference fails closed to SAFE_HOLD", async () => {
      const task = {
        taskId: "task_cross_tenant",
        tenantId: "tenant_A",
        caseId: "case_A1",
        state: "CLAIMED",
        stateHistory: [],
        attemptCount: 1,
        mockPaymentCase: {
          caseId: "case_A1",
          tenantId: "tenant_A",
          discrepancyCategory: "STATUS_MISMATCH"
        },
        mockGatewayPayment: {
          gatewayPaymentId: "pay_B1",
          tenantId: "tenant_FOREIGN_B", // Foreign tenant!
          status: "AUTHORIZED",
          amountPaise: 50000
        }
      };

      process.env.ORCHESTRATOR_WORKER_ENABLED = "true";

      const outcome = await processOrchestrationTask(task, {
        workerId: "test-worker"
      });

      process.env.ORCHESTRATOR_WORKER_ENABLED = "false";

      expect(outcome.status).toBe("SAFE_HOLD");
      expect(outcome.reason).toBe("CROSS_TENANT_BLOCKED");
      expect(task.state).toBe("SAFE_HOLD");
      expect(task.safeHoldCode).toBe("CROSS_TENANT_BLOCKED");
    });
  });
});
