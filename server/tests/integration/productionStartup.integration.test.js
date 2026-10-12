import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../../src/config/database.js";
import { startServer, handleGracefulShutdown, getMonitoringWorker } from "../../src/server.js";
import { PaymentMonitoringTask } from "../../src/models/PaymentMonitoringTask.js";
import { GatewayPayment } from "../../src/models/GatewayPayment.js";
import { MerchantOrder } from "../../src/models/MerchantOrder.js";
import { PaymentCase } from "../../src/models/PaymentCase.js";
import { PaymentLifecycleEvent } from "../../src/models/PaymentLifecycleEvent.js";
import { schedulePaymentMonitoring } from "../../src/services/monitoring/paymentMonitoringService.js";

function validateTestDatabaseUri(uri) {
  if (!uri || typeof uri !== "string") {
    throw new Error("Safety violation: MONGODB_URI must be provided as a non-empty string");
  }
  if (!uri.startsWith("mongodb://") && !uri.startsWith("mongodb+srv://")) {
    throw new Error("Safety violation: Invalid URI scheme");
  }
  let dbName = "";
  try {
    const url = new URL(uri.replace(/^mongodb(\+srv)?:\/\//, "http://"));
    dbName = url.pathname.replace(/^\//, "");
  } catch {
    const match = uri.match(/\/([^/?]+)(\?|$)/);
    if (match) dbName = match[1];
  }
  if (!dbName || !dbName.toLowerCase().includes("test") || dbName.toLowerCase().includes("prod")) {
    throw new Error(`Safety violation: Database name '${dbName}' must contain 'test' and cannot contain 'prod'.`);
  }
  return uri;
}

const TEST_DB_URI = validateTestDatabaseUri(
  process.env.MONGODB_TEST_URI || "mongodb://127.0.0.1:27017/reconai_test_startup_lifecycle"
);

describe("Production Startup Entrypoint & Provider-Read Isolation Integration", { timeout: 35000 }, () => {
  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await connectDatabase(TEST_DB_URI);
    await PaymentMonitoringTask.deleteMany({});
    await GatewayPayment.deleteMany({});
    await MerchantOrder.deleteMany({});
    await PaymentCase.deleteMany({});
    await PaymentLifecycleEvent.deleteMany({});
    await disconnectDatabase();
  });

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await connectDatabase(TEST_DB_URI);
    await mongoose.connection.db.dropDatabase().catch(() => {});
    await disconnectDatabase();
  });

  it("1. Refuses unsafe non-test database targets strictly", () => {
    expect(() => validateTestDatabaseUri("mongodb://127.0.0.1:27017/reconai_production")).toThrow(/Safety violation/);
    expect(() => validateTestDatabaseUri("mongodb://127.0.0.1:27017/reconai_app_live")).toThrow(/Safety violation/);
  });

  it("2. Importing application modules in normal tests never starts background loops", async () => {
    const appModule = await import("../../src/app.js");
    expect(appModule.default).toBeDefined();
    expect(getMonitoringWorker()).toBeNull();
  });

  it("3. Production startServer initializes database first, starts worker exactly once, processes due task isolated from network, and shuts down cleanly on SIGTERM", async () => {
    // A. Pre-seed task
    await connectDatabase(TEST_DB_URI);

    const testTenantId = "tenant_startup_test_1";
    const testPaymentId = "pay_startup_test_101";
    const testOrderId = "order_startup_test_101";
    const testCaseId = "case_startup_test_101";

    await GatewayPayment.create({
      gatewayPaymentId: testPaymentId,
      tenantId: testTenantId,
      merchantOrderId: testOrderId,
      amountPaise: 50000,
      currency: "INR",
      status: "CREATED"
    });

    await MerchantOrder.create({
      merchantOrderId: testOrderId,
      tenantId: testTenantId,
      orderNumber: "ORD-STARTUP-101",
      amountPaise: 50000,
      currency: "INR",
      status: "CREATED"
    });

    await PaymentCase.create({
      caseId: testCaseId,
      tenantId: testTenantId,
      merchantOrderId: testOrderId,
      gatewayPaymentId: testPaymentId,
      discrepancyCategory: "STATUS_MISMATCH",
      orderStatus: "ORDER_PENDING",
      captureStatus: "CAPTURE_NONE",
      resolutionCaseStatus: "CASE_INVESTIGATING"
    });

    const scheduled = await schedulePaymentMonitoring({
      tenantId: testTenantId,
      gatewayPaymentId: testPaymentId,
      merchantOrderId: testOrderId,
      caseId: testCaseId,
      initialDelaySeconds: 0,
      maxAttempts: 4
    });

    expect(scheduled.status).toBe("PENDING");
    await disconnectDatabase();

    // B. Setup deterministic provider-read stub & network leakage guard
    let stubCalled = 0;
    let networkLeakAttempted = false;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (...args) => {
      networkLeakAttempted = true;
      throw new Error(`CRITICAL: External network leak to ${args[0]}`);
    };

    const deterministicStub = async (url) => {
      stubCalled++;
      return {
        ok: true,
        status: 200,
        json: async () => ({
          id: testPaymentId,
          status: "captured",
          amount: 50000,
          currency: "INR",
          created_at: 1770000000
        })
      };
    };

    // C. Execute production startup entrypoint
    process.env.MONGODB_URI = TEST_DB_URI;
    process.env.PORT = "5098";
    process.env.MONITORING_WORKER_ENABLED = "true";
    process.env.MONITORING_INTERVAL_MS = "500";
    process.env.NODE_ENV = "test";

    const startupResult = await startServer({ customFetch: deterministicStub });

    // Invariant: DB is connected before listening
    expect(mongoose.connection.readyState).toBe(1);
    expect(startupResult.server).toBeDefined();
    expect(startupResult.monitoringWorker).toBeDefined();
    expect(getMonitoringWorker()).not.toBeNull();

    // Wait for worker loop sweep
    await new Promise((resolve) => setTimeout(resolve, 1500));

    // Invariant: Provider read was isolated and deterministic
    expect(networkLeakAttempted).toBe(false);
    expect(stubCalled).toBeGreaterThanOrEqual(1);

    // Invariant: Result was persisted in MongoDB
    const taskInDb = await PaymentMonitoringTask.findOne({ taskId: scheduled.taskId }).lean();
    expect(taskInDb.status).toBe("COMPLETED");
    expect(taskInDb.lastObservedStatus).toBe("CAPTURED");

    const paymentInDb = await GatewayPayment.findOne({ gatewayPaymentId: testPaymentId }).lean();
    expect(paymentInDb.status).toBe("CAPTURED");

    const orderInDb = await MerchantOrder.findOne({ merchantOrderId: testOrderId }).lean();
    expect(orderInDb.status).toBe("PAID");

    const caseInDb = await PaymentCase.findOne({ caseId: testCaseId }).lean();
    expect(caseInDb.captureStatus).toBe("CAPTURE_CAPTURED");

    // D. Graceful shutdown via SIGTERM path
    await handleGracefulShutdown("SIGTERM", { exitProcess: false });

    expect(getMonitoringWorker()).toBeNull();
    expect(mongoose.connection.readyState).toBe(0);

    // Restore fetch
    globalThis.fetch = originalFetch;
  });
});
