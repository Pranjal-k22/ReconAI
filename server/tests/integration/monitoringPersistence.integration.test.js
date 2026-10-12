import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import crypto from "crypto";
import { PaymentMonitoringTask } from "../../src/models/PaymentMonitoringTask.js";
import { GatewayPayment } from "../../src/models/GatewayPayment.js";
import { MerchantOrder } from "../../src/models/MerchantOrder.js";
import { PaymentCase } from "../../src/models/PaymentCase.js";
import { PaymentLifecycleEvent } from "../../src/models/PaymentLifecycleEvent.js";
import { AuditLog } from "../../src/models/AuditLog.js";
import {
  schedulePaymentMonitoring,
  executeMonitoringRecheck
} from "../../src/services/monitoring/paymentMonitoringService.js";
import {
  claimDueMonitoringTask,
  sweepDueMonitoringTasks
} from "../../src/services/monitoring/monitoringWorker.js";
import { RazorpayProviderError, RAZORPAY_ERROR_CODES } from "../../src/services/razorpay/razorpayClient.js";

/**
 * Sanitizes MongoDB connection URIs to prevent credential leakage in test logs.
 */
function sanitizeMongoUri(uri) {
  if (!uri) return "";
  try {
    return uri.replace(/\/\/(.*):(.*)@/, "//***:***@");
  } catch {
    return "[REDACTED_URI]";
  }
}

/**
 * Validates the test database URI to guarantee complete isolation.
 */
function validateTestDatabaseUri(uri) {
  if (!uri || typeof uri !== "string") {
    throw new Error("MONGODB_TEST_URI must be provided as a non-empty string");
  }

  if (!uri.startsWith("mongodb://") && !uri.startsWith("mongodb+srv://")) {
    throw new Error("Invalid MONGODB_TEST_URI scheme: must start with mongodb:// or mongodb+srv://");
  }

  if (process.env.MONGODB_URI && uri.trim() === process.env.MONGODB_URI.trim()) {
    throw new Error(
      "Safety violation: MONGODB_TEST_URI matches development/app MONGODB_URI. Integration tests require an isolated test database."
    );
  }

  let dbName = "";
  try {
    const url = new URL(uri.replace(/^mongodb(\+srv)?:\/\//, "http://"));
    dbName = url.pathname.replace(/^\//, "");
  } catch {
    const match = uri.match(/\/([^/?]+)(\?|$)/);
    if (match) dbName = match[1];
  }

  if (!dbName) {
    throw new Error("Safety violation: MONGODB_TEST_URI must explicitly specify a database name.");
  }

  const lowerName = dbName.toLowerCase();
  if (!lowerName.includes("test")) {
    throw new Error(
      `Safety violation: Test database name '${dbName}' must contain 'test' to guarantee isolation.`
    );
  }

  if (lowerName.includes("prod")) {
    throw new Error(
      `Safety violation: Test database name '${dbName}' contains 'prod'. Execution refused.`
    );
  }

  return uri;
}

const DEFAULT_TEST_URI = "mongodb://127.0.0.1:27017/reconai_test_monitoring_persistence";
const TEST_DB_URI = validateTestDatabaseUri(process.env.MONGODB_TEST_URI || DEFAULT_TEST_URI);
const SANITIZED_TEST_URI = sanitizeMongoUri(TEST_DB_URI);

describe("ReconAI 2.0 - Payment Monitoring Real MongoDB Persistence & Concurrency Integration", { timeout: 35000 }, () => {
  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 5000 });
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.db.dropDatabase().catch(() => {});
      await mongoose.disconnect();
    }
  });

  beforeEach(async () => {
    if (mongoose.connection.readyState === 1) {
      await PaymentMonitoringTask.deleteMany({});
      await GatewayPayment.deleteMany({});
      await MerchantOrder.deleteMany({});
      await PaymentCase.deleteMany({});
      await PaymentLifecycleEvent.deleteMany({});
      await AuditLog.deleteMany({});
    }
  });

  it("1. Schedules durable monitoring task surviving disconnect and reconnect", async () => {
    const tenantId = "tenant_persist_1";
    const paymentId = "pay_durable_101";

    const scheduled = await schedulePaymentMonitoring({
      tenantId,
      gatewayPaymentId: paymentId,
      merchantOrderId: "order_101",
      initialDelaySeconds: 10,
      maxAttempts: 4,
      deadlineMinutes: 60
    });

    expect(scheduled.taskId).toBeDefined();

    // Verify written to MongoDB
    const persisted = await PaymentMonitoringTask.findOne({ taskId: scheduled.taskId }).lean();
    expect(persisted).not.toBeNull();
    expect(persisted.tenantId).toBe(tenantId);
    expect(persisted.gatewayPaymentId).toBe(paymentId);
    expect(persisted.status).toBe("PENDING");

    // Simulate database disconnect and reconnect
    await mongoose.disconnect();
    expect(mongoose.connection.readyState).toBe(0);

    await mongoose.connect(TEST_DB_URI);
    expect(mongoose.connection.readyState).toBe(1);

    // Verify task survives intact across reconnect
    const reloaded = await PaymentMonitoringTask.findOne({ taskId: scheduled.taskId }).lean();
    expect(reloaded).not.toBeNull();
    expect(reloaded.gatewayPaymentId).toBe(paymentId);
    expect(reloaded.status).toBe("PENDING");
  });

  it("2. Concurrency Protection: Exactly one worker atomically claims a due task", async () => {
    const tenantId = "tenant_race_1";
    const paymentId = "pay_race_201";
    const pastTime = new Date(Date.now() - 5000);

    await schedulePaymentMonitoring({
      tenantId,
      gatewayPaymentId: paymentId,
      initialDelaySeconds: 0,
      asOfTime: pastTime
    });

    // 5 concurrent workers try to claim the same task simultaneously
    const workers = ["worker_A", "worker_B", "worker_C", "worker_D", "worker_E"];
    const now = new Date();

    const claimPromises = workers.map((workerId) =>
      claimDueMonitoringTask({ workerId, leaseDurationMs: 15000, asOfTime: now })
    );

    const claimResults = await Promise.all(claimPromises);
    const successfulClaims = claimResults.filter((res) => res !== null);

    // Invariant: Exactly one worker must succeed in claiming the task!
    expect(successfulClaims).toHaveLength(1);
    const winner = successfulClaims[0];
    expect(winner.status).toBe("IN_PROGRESS");
    expect(winner.attemptCount).toBe(1);
    expect(workers).toContain(winner.lockedBy);

    // Verify persisted task reflects winner
    const inDb = await PaymentMonitoringTask.findOne({ gatewayPaymentId: paymentId }).lean();
    expect(inDb.status).toBe("IN_PROGRESS");
    expect(inDb.lockedBy).toBe(winner.lockedBy);
  });

  it("3. Worker Crash Recovery: Reclaims task after lease expiration without human intervention", async () => {
    const tenantId = "tenant_crash_1";
    const paymentId = "pay_crashed_301";
    const crashTime = new Date("2026-10-12T09:00:00Z");

    // Simulate task claimed by worker_dead which crashed, leaving lease expired at 09:00:30Z
    await PaymentMonitoringTask.create({
      taskId: "task_crashed_worker",
      tenantId,
      gatewayPaymentId: paymentId,
      status: "IN_PROGRESS",
      attemptCount: 1,
      maxAttempts: 4,
      backoffIntervalsSeconds: [60, 300, 900, 1800],
      nextRunAt: crashTime,
      lockedUntil: new Date("2026-10-12T09:00:30Z"), // Expired!
      lockedBy: "worker_dead"
    });

    // Healthy worker sweeps at 09:01:00Z (after lease expiration)
    const sweepTime = new Date("2026-10-12T09:01:00Z");
    const reclaimed = await claimDueMonitoringTask({
      workerId: "worker_healthy",
      leaseDurationMs: 30000,
      asOfTime: sweepTime
    });

    expect(reclaimed).not.toBeNull();
    expect(reclaimed.taskId).toBe("task_crashed_worker");
    expect(reclaimed.lockedBy).toBe("worker_healthy");
    expect(reclaimed.attemptCount).toBe(2);
    expect(reclaimed.status).toBe("IN_PROGRESS");
  });

  it("4. Full Sweep Execution: Updates canonical GatewayPayment, MerchantOrder, and PaymentCase on capture", async () => {
    const tenantId = "tenant_sweep_1";
    const paymentId = "pay_sweep_401";
    const orderId = "order_sweep_401";
    const caseId = "case_sweep_401";

    await GatewayPayment.create({
      gatewayPaymentId: paymentId,
      merchantOrderId: orderId,
      tenantId,
      amountPaise: 120000,
      currency: "INR",
      status: "CREATED"
    });

    await MerchantOrder.create({
      merchantOrderId: orderId,
      tenantId,
      orderNumber: "ORD-SWEEP-401",
      amountPaise: 120000,
      currency: "INR",
      status: "CREATED"
    });

    await PaymentCase.create({
      caseId,
      tenantId,
      merchantOrderId: orderId,
      discrepancyCategory: "STATUS_MISMATCH",
      orderStatus: "ORDER_PENDING",
      captureStatus: "CAPTURE_NONE",
      resolutionCaseStatus: "CASE_INVESTIGATING"
    });

    await schedulePaymentMonitoring({
      tenantId,
      gatewayPaymentId: paymentId,
      merchantOrderId: orderId,
      caseId,
      initialDelaySeconds: 0,
      asOfTime: new Date(Date.now() - 1000)
    });

    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: paymentId,
        status: "captured",
        amount: 120000,
        currency: "INR",
        created_at: 1770000000
      })
    });

    const sweepResult = await sweepDueMonitoringTasks({
      maxTasks: 5,
      customFetch: mockFetch,
      workerId: "worker_integration"
    });

    expect(sweepResult.processedCount).toBe(1);
    expect(sweepResult.completedCount).toBe(1);

    // Verify GatewayPayment updated to CAPTURED
    const updatedPayment = await GatewayPayment.findOne({ gatewayPaymentId: paymentId, tenantId }).lean();
    expect(updatedPayment.status).toBe("CAPTURED");

    // Verify MerchantOrder updated to PAID
    const updatedOrder = await MerchantOrder.findOne({ merchantOrderId: orderId, tenantId }).lean();
    expect(updatedOrder.status).toBe("PAID");

    // Verify PaymentCase updated
    const updatedCase = await PaymentCase.findOne({ caseId, tenantId }).lean();
    expect(updatedCase.captureStatus).toBe("CAPTURE_CAPTURED");
    expect(updatedCase.orderStatus).toBe("ORDER_PAID");

    // Verify durable audit log recorded
    const auditLogs = await AuditLog.find({ tenantId }).lean();
    expect(auditLogs.length).toBeGreaterThan(0);
  });

  it("5. Monotonic Protection: Does not regress a CAPTURED payment to FAILED upon out-of-order poll", async () => {
    const tenantId = "tenant_noreg_1";
    const paymentId = "pay_noreg_501";

    await GatewayPayment.create({
      gatewayPaymentId: paymentId,
      tenantId,
      amountPaise: 50000,
      status: "CAPTURED"
    });

    const task = await PaymentMonitoringTask.create({
      taskId: "task_noreg_501",
      tenantId,
      gatewayPaymentId: paymentId,
      status: "IN_PROGRESS",
      attemptCount: 1,
      maxAttempts: 4,
      backoffIntervalsSeconds: [60, 300, 900, 1800]
    });

    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: paymentId,
        status: "failed",
        amount: 50000,
        currency: "INR"
      })
    });

    await executeMonitoringRecheck(task, { customFetch: mockFetch, workerId: "worker_test" });

    // Payment MUST remain CAPTURED!
    const preservedPayment = await GatewayPayment.findOne({ gatewayPaymentId: paymentId, tenantId }).lean();
    expect(preservedPayment.status).toBe("CAPTURED");
  });

  it("6. Late Capture on Cancelled Order: Preserves CANCELLED order and applies Safe-Hold", async () => {
    const tenantId = "tenant_cancelled_1";
    const paymentId = "pay_late_cancelled_601";
    const orderId = "order_cancelled_601";
    const caseId = "case_cancelled_601";

    await GatewayPayment.create({
      gatewayPaymentId: paymentId,
      merchantOrderId: orderId,
      tenantId,
      amountPaise: 80000,
      status: "CREATED"
    });

    await MerchantOrder.create({
      merchantOrderId: orderId,
      tenantId,
      amountPaise: 80000,
      status: "CANCELLED"
    });

    await PaymentCase.create({
      caseId,
      tenantId,
      merchantOrderId: orderId,
      discrepancyCategory: "CANCELLED_ORDER_CAPTURED",
      orderStatus: "ORDER_CANCELLED",
      resolutionCaseStatus: "CASE_INVESTIGATING"
    });

    const task = await PaymentMonitoringTask.create({
      taskId: "task_late_cancelled_601",
      tenantId,
      gatewayPaymentId: paymentId,
      merchantOrderId: orderId,
      caseId,
      status: "IN_PROGRESS",
      attemptCount: 1,
      maxAttempts: 4,
      backoffIntervalsSeconds: [60, 300, 900, 1800]
    });

    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: paymentId,
        status: "captured",
        amount: 80000,
        currency: "INR"
      })
    });

    const outcome = await executeMonitoringRecheck(task, { customFetch: mockFetch });
    expect(outcome.conflictFlag).toBe("CANCELLED_ORDER_CAPTURED");

    // Invariants:
    // 1. Order status MUST remain CANCELLED (never reopened to PAID)
    const checkOrder = await MerchantOrder.findOne({ merchantOrderId: orderId, tenantId }).lean();
    expect(checkOrder.status).toBe("CANCELLED");

    // 2. GatewayPayment records late capture
    const checkPayment = await GatewayPayment.findOne({ gatewayPaymentId: paymentId, tenantId }).lean();
    expect(checkPayment.status).toBe("CAPTURED");
    expect(checkPayment.isLateCapture).toBe(true);

    // 3. PaymentCase transitions to CASE_SAFE_HOLD
    const checkCase = await PaymentCase.findOne({ caseId, tenantId }).lean();
    expect(checkCase.resolutionCaseStatus).toBe("CASE_SAFE_HOLD");
    expect(checkCase.safeHoldCode).toBe("LATE_CAPTURE_CANCELLED_ORDER");
    expect(checkCase.isSafeHold).toBe(true);
  });

  it("7. Exhausted Retries: Puts PaymentCase on Safe-Hold without marking payment FAILED or refunding", async () => {
    const tenantId = "tenant_exhaust_1";
    const paymentId = "pay_exhaust_701";
    const caseId = "case_exhaust_701";

    await GatewayPayment.create({
      gatewayPaymentId: paymentId,
      tenantId,
      amountPaise: 25000,
      status: "CREATED"
    });

    await PaymentCase.create({
      caseId,
      tenantId,
      discrepancyCategory: "STATUS_MISMATCH",
      resolutionCaseStatus: "CASE_INVESTIGATING"
    });

    const task = await PaymentMonitoringTask.create({
      taskId: "task_exhaust_701",
      tenantId,
      gatewayPaymentId: paymentId,
      caseId,
      status: "IN_PROGRESS",
      attemptCount: 4, // Max attempts reached
      maxAttempts: 4,
      backoffIntervalsSeconds: [60, 300, 900, 1800]
    });

    // Provider returns status "created" (still pending)
    const mockFetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        id: paymentId,
        status: "created",
        amount: 25000,
        currency: "INR"
      })
    });

    const outcome = await executeMonitoringRecheck(task, { customFetch: mockFetch });
    expect(outcome.status).toBe("EXHAUSTED");

    // Invariants:
    // 1. GatewayPayment is NOT marked FAILED! It remains CREATED/PENDING.
    const checkPayment = await GatewayPayment.findOne({ gatewayPaymentId: paymentId, tenantId }).lean();
    expect(checkPayment.status).toBe("CREATED");

    // 2. PaymentCase placed on CASE_SAFE_HOLD for human inspection
    const checkCase = await PaymentCase.findOne({ caseId, tenantId }).lean();
    expect(checkCase.resolutionCaseStatus).toBe("CASE_SAFE_HOLD");
    expect(checkCase.safeHoldCode).toBe("ADMIN_HOLD");
    expect(checkCase.isSafeHold).toBe(true);
  });
});
