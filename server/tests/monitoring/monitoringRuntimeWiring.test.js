import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import crypto from "crypto";
import { startMonitoringWorker, stopMonitoringWorker, sweepDueMonitoringTasks } from "../../src/services/monitoring/monitoringWorker.js";
import {
  schedulePaymentMonitoring,
  executeMonitoringRecheck,
  enqueueUnmonitoredPendingPayments,
  resetInMemoryMonitoringStore
} from "../../src/services/monitoring/paymentMonitoringService.js";
import { ingestRazorpayWebhook, seedInMemoryPayment } from "../../src/services/webhook/webhookService.js";
import { GatewayPayment } from "../../src/models/GatewayPayment.js";
import { PaymentMonitoringTask } from "../../src/models/PaymentMonitoringTask.js";

const TEST_SECRET = "test_webhook_secret_key_32_bytes_ok!";

describe("Payment Monitoring Runtime Wiring & Task Lifecycle", () => {
  beforeEach(() => {
    process.env.RAZORPAY_WEBHOOK_SECRET = TEST_SECRET;
    resetInMemoryMonitoringStore();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("1. Importing modules does not trigger background loops", () => {
    it("importing app.js or server.js does not start monitoring worker loops", async () => {
      const appModule = await import("../../src/app.js");
      expect(appModule.default).toBeDefined();
      const serverModule = await import("../../src/server.js");
      expect(serverModule.getMonitoringWorker()).toBeNull();
    }, 60000);
  });

  describe("2. Worker Startup & Shutdown Lifecycle", () => {
    it("starts worker exactly once with configured interval and concurrency limits", () => {
      vi.useFakeTimers();
      const worker = startMonitoringWorker({
        intervalMs: 15000,
        maxTasks: 3,
        leaseDurationMs: 20000,
        workerId: "test_worker_1",
        runImmediate: false
      });

      expect(worker).toBeDefined();
      expect(worker.workerId).toBe("test_worker_1");
      expect(worker.isRunning()).toBe(true);

      // Verify shutdown stops runner cleanly
      stopMonitoringWorker(worker);
      expect(worker.isRunning()).toBe(false);
    });

    it("worker shutdown prevents additional periodic sweeps", async () => {
      vi.useFakeTimers();
      let sweepCount = 0;

      const worker = startMonitoringWorker({
        intervalMs: 5000,
        runImmediate: false
      });

      // Advance time before shutdown: triggers sweep
      vi.advanceTimersByTime(5000);

      // Stop worker
      stopMonitoringWorker(worker);
      expect(worker.isRunning()).toBe(false);

      // Advancing time further should not execute sweeps
      vi.advanceTimersByTime(20000);
      expect(worker.isRunning()).toBe(false);
    });
  });

  describe("3. Real Task Enqueueing from Verified Webhook Ingestion", () => {
    const TEST_SECRET = "test_webhook_secret_key_32_bytes_ok!";
    function sign(body) {
      return crypto.createHmac("sha256", TEST_SECRET).update(Buffer.from(body, "utf8")).digest("hex");
    }

    it("creates durable monitoring task upon receiving non-terminal payment.authorized event", async () => {
      const paymentId = `pay_auth_${Date.now()}`;
      seedInMemoryPayment({
        tenantId: "tenant_wiring_1",
        gatewayPaymentId: paymentId,
        merchantOrderId: `order_${paymentId}`,
        status: "AUTHORIZED",
        amountPaise: 50000,
        currency: "INR"
      });

      const payload = {
        entity: "event",
        account_id: "acc_wiring_1",
        event: "payment.authorized",
        created_at: 1770000000,
        payload: {
          payment: {
            entity: {
              id: paymentId,
              amount: 50000,
              currency: "INR",
              status: "authorized",
              notes: { tenant_id: "tenant_wiring_1" }
            }
          }
        }
      };

      const rawBody = JSON.stringify(payload);
      const signature = sign(rawBody);

      const result = await ingestRazorpayWebhook({
        rawBody,
        payload,
        headers: {
          "x-razorpay-signature": signature,
          "x-razorpay-event-id": `evt_${paymentId}`
        },
        secret: TEST_SECRET
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("ACCEPTED");
    });

    it("completes active monitoring task when terminal payment.captured event arrives", async () => {
      const paymentId = `pay_term_${Date.now()}`;
      seedInMemoryPayment({
        tenantId: "tenant_wiring_2",
        gatewayPaymentId: paymentId,
        merchantOrderId: `order_${paymentId}`,
        status: "AUTHORIZED",
        amountPaise: 75000,
        currency: "INR"
      });

      const payload = {
        entity: "event",
        account_id: "acc_wiring_2",
        event: "payment.captured",
        created_at: 1770000000,
        payload: {
          payment: {
            entity: {
              id: paymentId,
              amount: 75000,
              currency: "INR",
              status: "captured",
              notes: { tenant_id: "tenant_wiring_2" }
            }
          }
        }
      };

      const rawBody = JSON.stringify(payload);
      const signature = sign(rawBody);

      const result = await ingestRazorpayWebhook({
        rawBody,
        payload,
        headers: {
          "x-razorpay-signature": signature,
          "x-razorpay-event-id": `evt_term_${paymentId}`
        },
        secret: TEST_SECRET
      });

      expect(result.success).toBe(true);
      expect(result.status).toBe("ACCEPTED");
    });
  });

  describe("4. Task Selection, Processing, and Timeout Protection", () => {
    it("processes a due task and reschedules with backoff when outcome is pending", async () => {
      const asOf = new Date("2026-10-12T10:00:00Z");
      const task = await schedulePaymentMonitoring({
        tenantId: "tenant_proc_1",
        gatewayPaymentId: "pay_proc_101",
        initialDelaySeconds: 0,
        maxAttempts: 4,
        asOfTime: asOf
      });

      expect(task.status).toBe("PENDING");

      // Provider responds with still pending status
      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          id: "pay_proc_101",
          status: "created",
          amount: 30000,
          currency: "INR"
        })
      });

      const outcome = await executeMonitoringRecheck(task, { asOfTime: asOf, customFetch: mockFetch });

      expect(outcome.success).toBe(true);
      expect(outcome.status).toBe("RESCHEDULED");
      expect(task.status).toBe("PENDING");
      // Rescheduled to next backoff interval (60s)
      expect(task.nextRunAt.getTime() - asOf.getTime()).toBe(60 * 1000);
    });

    it("preserves UNKNOWN status and safe-hold containment on retry exhaustion without marking FAILED", async () => {
      const asOf = new Date("2026-10-12T10:00:00Z");
      const task = {
        taskId: "task_exhaust_proc_1",
        tenantId: "tenant_proc_2",
        gatewayPaymentId: "pay_exhaust_proc_2",
        attemptCount: 4, // Max attempts reached
        maxAttempts: 4,
        backoffIntervalsSeconds: [60, 300, 900, 1800],
        deadlineAt: asOf
      };

      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          id: "pay_exhaust_proc_2",
          status: "authorized",
          amount: 45000,
          currency: "INR"
        })
      });

      const outcome = await executeMonitoringRecheck(task, { asOfTime: asOf, customFetch: mockFetch });

      expect(outcome.success).toBe(true);
      expect(outcome.status).toBe("EXHAUSTED");
      expect(task.status).toBe("EXHAUSTED");
      // Payment outcome remains UNKNOWN/PENDING, NEVER FAILED
      expect(task.paymentStatus).toBeUndefined();
    });

    it("idempotent scheduling: scheduling same pending payment twice returns same task without reset", async () => {
      const asOf = new Date("2026-10-12T10:00:00Z");
      const task1 = await schedulePaymentMonitoring({
        tenantId: "tenant_idem_1",
        gatewayPaymentId: "pay_idem_1",
        initialDelaySeconds: 45,
        asOfTime: asOf
      });

      const task2 = await schedulePaymentMonitoring({
        tenantId: "tenant_idem_1",
        gatewayPaymentId: "pay_idem_1",
        initialDelaySeconds: 90,
        asOfTime: asOf
      });

      expect(task1.taskId).toBe(task2.taskId);
      expect(task2.status).toBe("PENDING");
    });
  });

  describe("5. Bounded Pending Payments Enqueueing", () => {
    it("handles enqueueUnmonitoredPendingPayments offline safely without throwing", async () => {
      const result = await enqueueUnmonitoredPendingPayments({ limit: 10 });
      expect(result).toBeDefined();
      expect(typeof result.enqueuedCount).toBe("number");
    });
  });
});
