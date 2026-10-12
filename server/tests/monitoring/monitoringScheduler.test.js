import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  calculateNextBackoffTime,
  schedulePaymentMonitoring,
  executeMonitoringRecheck,
  resetInMemoryMonitoringStore
} from "../../src/services/monitoring/paymentMonitoringService.js";
import { RazorpayProviderError, RAZORPAY_ERROR_CODES } from "../../src/services/razorpay/razorpayClient.js";

describe("Payment Monitoring Scheduler - Bounded Retries & Timeout Policy", () => {
  beforeEach(() => {
    resetInMemoryMonitoringStore();
    vi.restoreAllMocks();
  });

  describe("calculateNextBackoffTime", () => {
    it("computes exponential backoff intervals deterministically", () => {
      const baseTime = new Date("2026-10-12T10:00:00Z");
      const intervals = [60, 300, 900, 1800];

      const t0 = calculateNextBackoffTime({ attemptCount: 0, backoffIntervalsSeconds: intervals, asOfTime: baseTime, jitterSeconds: 0 });
      expect(t0.getTime() - baseTime.getTime()).toBe(60 * 1000);

      const t1 = calculateNextBackoffTime({ attemptCount: 1, backoffIntervalsSeconds: intervals, asOfTime: baseTime, jitterSeconds: 0 });
      expect(t1.getTime() - baseTime.getTime()).toBe(300 * 1000);

      const t2 = calculateNextBackoffTime({ attemptCount: 2, backoffIntervalsSeconds: intervals, asOfTime: baseTime, jitterSeconds: 0 });
      expect(t2.getTime() - baseTime.getTime()).toBe(900 * 1000);

      const t3 = calculateNextBackoffTime({ attemptCount: 3, backoffIntervalsSeconds: intervals, asOfTime: baseTime, jitterSeconds: 0 });
      expect(t3.getTime() - baseTime.getTime()).toBe(1800 * 1000);
    });

    it("applies jitter safely without dipping below minimum 1 second", () => {
      const baseTime = new Date("2026-10-12T10:00:00Z");
      const t = calculateNextBackoffTime({ attemptCount: 0, backoffIntervalsSeconds: [60], asOfTime: baseTime, jitterSeconds: -100 });
      expect(t.getTime() - baseTime.getTime()).toBe(1000); // Clamped to 1s
    });
  });

  describe("schedulePaymentMonitoring", () => {
    it("validates required parameters strictly", async () => {
      await expect(schedulePaymentMonitoring({ tenantId: "", gatewayPaymentId: "pay_1" })).rejects.toThrow("tenantId is required");
      await expect(schedulePaymentMonitoring({ tenantId: "tenant_1", gatewayPaymentId: "" })).rejects.toThrow("gatewayPaymentId is required");
    });

    it("creates an in-memory task with initial schedule and deadline", async () => {
      const asOf = new Date("2026-10-12T10:00:00Z");
      const task = await schedulePaymentMonitoring({
        tenantId: "tenant_1",
        gatewayPaymentId: "pay_test_123",
        merchantOrderId: "order_123",
        initialDelaySeconds: 45,
        maxAttempts: 4,
        deadlineMinutes: 60,
        asOfTime: asOf
      });

      expect(task).toBeDefined();
      expect(task.tenantId).toBe("tenant_1");
      expect(task.gatewayPaymentId).toBe("pay_test_123");
      expect(task.status).toBe("PENDING");
      expect(task.nextRunAt.getTime()).toBe(asOf.getTime() + 45 * 1000);
      expect(task.deadlineAt.getTime()).toBe(asOf.getTime() + 60 * 60 * 1000);
    });
  });

  describe("executeMonitoringRecheck", () => {
    it("completes task when provider confirms captured status", async () => {
      const task = {
        taskId: "task_1",
        tenantId: "tenant_1",
        gatewayPaymentId: "pay_captured_1",
        attemptCount: 1,
        maxAttempts: 4,
        backoffIntervalsSeconds: [60, 300, 900, 1800]
      };

      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          id: "pay_captured_1",
          status: "captured",
          amount: 50000,
          currency: "INR",
          created_at: 1770000000
        })
      });

      const outcome = await executeMonitoringRecheck(task, { customFetch: mockFetch });

      expect(outcome.success).toBe(true);
      expect(outcome.status).toBe("COMPLETED");
      expect(outcome.paymentStatus).toBe("CAPTURED");
      expect(task.status).toBe("COMPLETED");
      expect(task.lastObservedStatus).toBe("CAPTURED");
    });

    it("reschedules task when payment is still pending and retries remain", async () => {
      const asOf = new Date("2026-10-12T10:00:00Z");
      const task = {
        taskId: "task_2",
        tenantId: "tenant_1",
        gatewayPaymentId: "pay_pending_1",
        attemptCount: 1,
        maxAttempts: 4,
        backoffIntervalsSeconds: [60, 300, 900, 1800],
        deadlineAt: new Date(asOf.getTime() + 3600000)
      };

      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          id: "pay_pending_1",
          status: "created",
          amount: 50000,
          currency: "INR"
        })
      });

      const outcome = await executeMonitoringRecheck(task, { asOfTime: asOf, customFetch: mockFetch });

      expect(outcome.success).toBe(true);
      expect(outcome.status).toBe("RESCHEDULED");
      expect(outcome.paymentStatus).toBe("CREATED");
      expect(task.status).toBe("PENDING");
      // Backoff interval for attemptCount 1 is 300s
      expect(task.nextRunAt.getTime() - asOf.getTime()).toBe(300 * 1000);
    });

    it("reschedules with backoff on transient rate-limiting (429)", async () => {
      const asOf = new Date("2026-10-12T10:00:00Z");
      const task = {
        taskId: "task_3",
        tenantId: "tenant_1",
        gatewayPaymentId: "pay_ratelimit_1",
        attemptCount: 0,
        maxAttempts: 4,
        backoffIntervalsSeconds: [60, 300, 900, 1800],
        deadlineAt: new Date(asOf.getTime() + 3600000)
      };

      const mockFetch = async () => {
        throw new RazorpayProviderError(RAZORPAY_ERROR_CODES.RATE_LIMIT, "Rate limit exceeded", { status: 429 });
      };

      const outcome = await executeMonitoringRecheck(task, { asOfTime: asOf, customFetch: mockFetch });

      expect(outcome.success).toBe(true);
      expect(outcome.status).toBe("RESCHEDULED");
      expect(task.status).toBe("PENDING");
      expect(task.nextRunAt.getTime() - asOf.getTime()).toBe(60 * 1000);
    });

    it("fails closed without state mutation on permanent auth failure", async () => {
      const task = {
        taskId: "task_4",
        tenantId: "tenant_1",
        gatewayPaymentId: "pay_authfail_1",
        attemptCount: 1,
        maxAttempts: 4,
        backoffIntervalsSeconds: [60, 300, 900, 1800]
      };

      const mockFetch = async () => {
        throw new RazorpayProviderError(RAZORPAY_ERROR_CODES.AUTH_ERROR, "Invalid API credentials", { status: 401 });
      };

      const outcome = await executeMonitoringRecheck(task, { customFetch: mockFetch });

      expect(outcome.success).toBe(false);
      expect(outcome.status).toBe("FAILED");
      expect(outcome.reason).toBe("PROVIDER_CREDENTIAL_ERROR");
      expect(task.status).toBe("FAILED");
    });

    it("CRITICAL TIMEOUT POLICY: marks task EXHAUSTED without marking payment FAILED or refunding", async () => {
      const asOf = new Date("2026-10-12T10:00:00Z");
      const task = {
        taskId: "task_5",
        tenantId: "tenant_1",
        gatewayPaymentId: "pay_exhausted_1",
        caseId: "case_exhausted_1",
        attemptCount: 4, // Max attempts reached
        maxAttempts: 4,
        backoffIntervalsSeconds: [60, 300, 900, 1800],
        deadlineAt: new Date(asOf.getTime() - 1000) // Deadline elapsed
      };

      const mockFetch = async () => {
        throw new RazorpayProviderError(RAZORPAY_ERROR_CODES.TIMEOUT, "Gateway connection timed out");
      };

      const outcome = await executeMonitoringRecheck(task, { asOfTime: asOf, customFetch: mockFetch });

      expect(outcome.success).toBe(true);
      expect(outcome.status).toBe("EXHAUSTED");
      expect(task.status).toBe("EXHAUSTED");
      expect(task.outcomeReason).toBe("MONITORING_RETRY_EXHAUSTED");
      // Payment status is NOT marked FAILED! Outcome is UNKNOWN.
      expect(task.lastObservedStatus).toBeUndefined();
    });

    it("preserves ability to accept a later verified capture after exhaustion", async () => {
      const task = {
        taskId: "task_6",
        tenantId: "tenant_1",
        gatewayPaymentId: "pay_late_after_exhaust_1",
        attemptCount: 5,
        maxAttempts: 4,
        status: "EXHAUSTED"
      };

      const mockFetch = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          id: "pay_late_after_exhaust_1",
          status: "captured",
          amount: 75000,
          currency: "INR"
        })
      });

      const outcome = await executeMonitoringRecheck(task, { customFetch: mockFetch });

      expect(outcome.success).toBe(true);
      expect(outcome.status).toBe("COMPLETED");
      expect(outcome.paymentStatus).toBe("CAPTURED");
      expect(task.status).toBe("COMPLETED");
      expect(task.lastObservedStatus).toBe("CAPTURED");
    });
  });
});
