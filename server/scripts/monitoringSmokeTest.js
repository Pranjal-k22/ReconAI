/**
 * ReconAI 2.0 - Phase 5 Controlled Runtime Worker Smoke Test
 *
 * Verifies real end-to-end runtime worker startup, task discovery, processing,
 * state persistence, and graceful shutdown against an isolated test MongoDB database.
 */
import mongoose from "mongoose";
import { connectDatabase, disconnectDatabase } from "../src/config/database.js";
import { logger } from "../src/config/logger.js";
import { PaymentMonitoringTask } from "../src/models/PaymentMonitoringTask.js";
import { GatewayPayment } from "../src/models/GatewayPayment.js";
import { MerchantOrder } from "../src/models/MerchantOrder.js";
import { PaymentCase } from "../src/models/PaymentCase.js";
import { PaymentLifecycleEvent } from "../src/models/PaymentLifecycleEvent.js";
import { AuditLog } from "../src/models/AuditLog.js";
import {
  schedulePaymentMonitoring,
  enqueueUnmonitoredPendingPayments
} from "../src/services/monitoring/paymentMonitoringService.js";
import {
  startMonitoringWorker,
  stopMonitoringWorker
} from "../src/services/monitoring/monitoringWorker.js";

const SMOKE_TEST_DB_URI = "mongodb://127.0.0.1:27017/reconai_test_monitoring_smoke";

async function runSmokeTest() {
  console.log("=================================================");
  console.log("🔍 STARTING PHASE 5 RUNTIME WORKER SMOKE TEST");
  console.log("=================================================");

  // 1. Connect to isolated test database
  console.log(`[1/6] Connecting to isolated test database: ${SMOKE_TEST_DB_URI}...`);
  await connectDatabase(SMOKE_TEST_DB_URI);
  console.log("✅ Database connection established.");

  // 2. Clean smoke test collections
  console.log("[2/6] Resetting smoke test collections...");
  await PaymentMonitoringTask.deleteMany({});
  await GatewayPayment.deleteMany({});
  await MerchantOrder.deleteMany({});
  await PaymentCase.deleteMany({});
  await PaymentLifecycleEvent.deleteMany({});
  await AuditLog.deleteMany({});
  console.log("✅ Collections clean.");

  // 3. Seed pending payment and order
  const testTenantId = "tenant_smoke_test_001";
  const testPaymentId = "pay_smoke_001";
  const testOrderId = "order_smoke_001";
  const testCaseId = "case_smoke_001";

  console.log(`[3/6] Seeding pending payment (${testPaymentId}) and order (${testOrderId})...`);
  await GatewayPayment.create({
    gatewayPaymentId: testPaymentId,
    tenantId: testTenantId,
    merchantOrderId: testOrderId,
    amountPaise: 99900,
    currency: "INR",
    status: "CREATED"
  });

  await MerchantOrder.create({
    merchantOrderId: testOrderId,
    tenantId: testTenantId,
    orderNumber: "ORD-SMOKE-001",
    amountPaise: 99900,
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

  // Schedule task due immediately
  const scheduledTask = await schedulePaymentMonitoring({
    tenantId: testTenantId,
    gatewayPaymentId: testPaymentId,
    merchantOrderId: testOrderId,
    caseId: testCaseId,
    initialDelaySeconds: 0,
    maxAttempts: 4
  });
  console.log(`✅ Durable monitoring task registered: ${scheduledTask.taskId} (status: ${scheduledTask.status})`);

  // 4. Start runtime monitoring worker with mock read-only provider fetch
  console.log("[4/6] Activating runtime monitoring worker...");
  const mockFetch = async (url) => {
    console.log(`📡 [Provider Read] GET ${url}`);
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: testPaymentId,
        status: "captured",
        amount: 99900,
        currency: "INR",
        created_at: 1770000000
      })
    };
  };

  const worker = startMonitoringWorker({
    intervalMs: 1000,
    maxTasks: 5,
    leaseDurationMs: 10000,
    workerId: "smoke_worker_primary",
    customFetch: mockFetch,
    runImmediate: true
  });
  console.log(`✅ Worker active [ID: ${worker.workerId}]. Awaiting sweep execution...`);

  // Wait for worker sweep to process task
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // 5. Verify task processing and canonical persistence
  console.log("[5/6] Verifying persistence and canonical state transitions...");
  const taskInDb = await PaymentMonitoringTask.findOne({ taskId: scheduledTask.taskId }).lean();
  console.log(`   Task Status in DB: ${taskInDb?.status} (Outcome: ${taskInDb?.outcomeReason})`);
  if (taskInDb?.status !== "COMPLETED") {
    throw new Error(`Smoke test failed: Task status expected 'COMPLETED', got '${taskInDb?.status}'`);
  }

  const paymentInDb = await GatewayPayment.findOne({ gatewayPaymentId: testPaymentId }).lean();
  console.log(`   GatewayPayment Status: ${paymentInDb?.status}`);
  if (paymentInDb?.status !== "CAPTURED") {
    throw new Error(`Smoke test failed: GatewayPayment expected 'CAPTURED', got '${paymentInDb?.status}'`);
  }

  const orderInDb = await MerchantOrder.findOne({ merchantOrderId: testOrderId }).lean();
  console.log(`   MerchantOrder Status: ${orderInDb?.status}`);
  if (orderInDb?.status !== "PAID") {
    throw new Error(`Smoke test failed: MerchantOrder expected 'PAID', got '${orderInDb?.status}'`);
  }

  const caseInDb = await PaymentCase.findOne({ caseId: testCaseId }).lean();
  console.log(`   PaymentCase Capture Status: ${caseInDb?.captureStatus}, Order: ${caseInDb?.orderStatus}`);

  const lifecycleEvent = await PaymentLifecycleEvent.findOne({ gatewayPaymentId: testPaymentId }).lean();
  console.log(`   Lifecycle Event Recorded: ${lifecycleEvent?.eventId} (${lifecycleEvent?.normalizedEventType})`);
  if (!lifecycleEvent) {
    throw new Error("Smoke test failed: No PaymentLifecycleEvent recorded.");
  }

  const auditEvents = await AuditLog.find({ tenantId: testTenantId }).lean();
  console.log(`   Audit Events Count: ${auditEvents.length}`);
  if (auditEvents.length === 0) {
    throw new Error("Smoke test failed: No AuditLog records found.");
  }

  // 6. Graceful Shutdown
  console.log("[6/6] Initiating graceful worker shutdown...");
  stopMonitoringWorker(worker);
  console.log(`   Worker isRunning(): ${worker.isRunning()}`);
  if (worker.isRunning()) {
    throw new Error("Smoke test failed: Worker isRunning() still true after stop().");
  }

  // Drop smoke test database and disconnect
  await mongoose.connection.db.dropDatabase();
  await disconnectDatabase();
  console.log("✅ Graceful shutdown completed. Disconnected from database.");

  console.log("=================================================");
  console.log("🎉 PHASE 5 RUNTIME WORKER SMOKE TEST: ALL CHECKS PASSED");
  console.log("=================================================");
}

runSmokeTest().catch((err) => {
  console.error("❌ Smoke test failed:", err);
  process.exit(1);
});
