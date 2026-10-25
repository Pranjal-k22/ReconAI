/**
 * ReconAI 2.0 - Phase 5 Controlled Production Startup & Provider-Read Smoke Test
 *
 * Verifies the actual production application startup entrypoint (startServer),
 * worker activation, deterministic provider-read isolation (zero network calls),
 * task discovery & canonical persistence, and clean graceful shutdown (SIGTERM).
 */

// Step 0: Capture pre-exported environment variables BEFORE setting test environment
const preExportedMongoUri = process.env.MONGODB_URI;

/**
 * Validates the database URI to guarantee complete isolation.
 * Refuses unsafe database targets before resetting or deleting any data.
 * Guard requirements:
 * - Must be a non-empty string starting with mongodb:// or mongodb+srv://
 * - Database name must contain 'test'
 * - Database name must not contain 'prod'
 * - Must differ from pre-exported MONGODB_URI
 */
function validateTestDatabaseUri(uri, initialMongoUri) {
  if (!uri || typeof uri !== "string" || uri.trim().length === 0) {
    throw new Error("Configuration safety violation: MONGODB_TEST_URI must be provided as a non-empty string");
  }

  const trimmedUri = uri.trim();
  if (!trimmedUri.startsWith("mongodb://") && !trimmedUri.startsWith("mongodb+srv://")) {
    throw new Error("Configuration safety violation: Invalid URI scheme, must start with mongodb:// or mongodb+srv://");
  }

  let hostname = "";
  let dbName = "";
  try {
    const url = new URL(trimmedUri.replace(/^mongodb(\+srv)?:\/\//, "http://"));
    hostname = url.hostname;
    dbName = url.pathname.replace(/^\//, "");
  } catch {
    const match = trimmedUri.match(/^mongodb(?:\+srv)?:\/\/([^/:?#]+)(?::\d+)?\/([^/?]+)/);
    if (match) {
      hostname = match[1];
      dbName = match[2];
    }
  }

  const isLocalHost = hostname === "localhost" || hostname === "127.0.0.1";
  const allowRemote = process.env.ALLOW_REMOTE_TEST_DB === "true";
  if (!isLocalHost && !allowRemote) {
    throw new Error(
      `Configuration safety violation: MONGODB_TEST_URI host '${hostname}' is not localhost/127.0.0.1. Remote test databases are refused unless ALLOW_REMOTE_TEST_DB=true.`
    );
  }

  if (!dbName) {
    throw new Error("Configuration safety violation: Database URI must explicitly specify a database name.");
  }

  const lowerName = dbName.toLowerCase();
  if (!lowerName.includes("test")) {
    throw new Error(`Configuration safety violation: Database name '${dbName}' must contain 'test' to guarantee isolation.`);
  }

  if (lowerName.includes("prod")) {
    throw new Error(`Configuration safety violation: Database name '${dbName}' contains 'prod'. Execution refused.`);
  }

  if (initialMongoUri && typeof initialMongoUri === "string" && initialMongoUri.trim().length > 0) {
    const trimmedInitial = initialMongoUri.trim();
    if (trimmedUri === trimmedInitial) {
      throw new Error(
        `Configuration safety violation: Test database URI ('${trimmedUri}') must differ from MONGODB_URI ('${trimmedInitial}').`
      );
    }

    let initialDbName = "";
    try {
      const initialUrl = new URL(trimmedInitial.replace(/^mongodb(\+srv)?:\/\//, "http://"));
      initialDbName = initialUrl.pathname.replace(/^\//, "");
    } catch {
      const match = trimmedInitial.match(/\/([^/?]+)(\?|$)/);
      if (match) initialDbName = match[1];
    }

    if (initialDbName && initialDbName.toLowerCase() === lowerName) {
      throw new Error(
        `Configuration safety violation: Test database name '${dbName}' must differ from MONGODB_URI database name '${initialDbName}'.`
      );
    }
  }

  return trimmedUri;
}

const SMOKE_TEST_DB_URI = validateTestDatabaseUri(
  process.env.MONGODB_TEST_URI || "mongodb://127.0.0.1:27017/reconai_test_monitoring_smoke",
  preExportedMongoUri
);

// Configure isolated test environment variables BEFORE importing application modules
process.env.NODE_ENV = "test";
process.env.MONGODB_URI = SMOKE_TEST_DB_URI;
process.env.PORT = process.env.PORT || "5099";
process.env.MONITORING_WORKER_ENABLED = "true";
process.env.MONITORING_INTERVAL_MS = "1000";

// Dynamically import modules now that environment variables are fully configured
const mongoose = (await import("mongoose")).default;
const { connectDatabase, disconnectDatabase } = await import("../src/config/database.js");
const { startServer, handleGracefulShutdown, getMonitoringWorker } = await import("../src/server.js");
const { PaymentMonitoringTask } = await import("../src/models/PaymentMonitoringTask.js");
const { GatewayPayment } = await import("../src/models/GatewayPayment.js");
const { MerchantOrder } = await import("../src/models/MerchantOrder.js");
const { PaymentCase } = await import("../src/models/PaymentCase.js");
const { PaymentLifecycleEvent } = await import("../src/models/PaymentLifecycleEvent.js");
const { AuditLog } = await import("../src/models/AuditLog.js");
const { schedulePaymentMonitoring } = await import("../src/services/monitoring/paymentMonitoringService.js");

const testTenantId = "tenant_smoke_test_001";
const testPaymentId = "pay_smoke_001";
const testOrderId = "order_smoke_001";
const testCaseId = "case_smoke_001";

/**
 * Clean up ONLY this smoke test's own records by explicit tenant/entity identifiers.
 * Never drops the database or deletes untracked collections.
 */
async function cleanupSmokeTestRecords() {
  await PaymentMonitoringTask.deleteMany({
    $or: [
      { tenantId: testTenantId },
      { gatewayPaymentId: testPaymentId },
      { caseId: testCaseId }
    ]
  });
  await GatewayPayment.deleteMany({
    $or: [
      { tenantId: testTenantId },
      { gatewayPaymentId: testPaymentId }
    ]
  });
  await MerchantOrder.deleteMany({
    $or: [
      { tenantId: testTenantId },
      { merchantOrderId: testOrderId }
    ]
  });
  await PaymentCase.deleteMany({
    $or: [
      { tenantId: testTenantId },
      { caseId: testCaseId }
    ]
  });
  await PaymentLifecycleEvent.deleteMany({
    $or: [
      { tenantId: testTenantId },
      { gatewayPaymentId: testPaymentId }
    ]
  });
  await AuditLog.deleteMany({
    $or: [
      { tenantId: testTenantId },
      { entityId: testPaymentId },
      { entityId: testCaseId },
      { "metadata.gatewayPaymentId": testPaymentId }
    ]
  });
}

async function runProductionStartupSmokeTest() {
  console.log("=================================================================");
  console.log("🔍 PHASE 5 PRODUCTION STARTUP & PROVIDER-READ ISOLATION AUDIT");
  console.log("=================================================================");

  // 1. Validate and configure isolated test database
  console.log(`[1/7] Validating database target safety: ${SMOKE_TEST_DB_URI}...`);
  console.log("✅ Target validated: isolated test database confirmed.");

  // Pre-seed setup connection
  await connectDatabase(SMOKE_TEST_DB_URI);
  console.log("[2/7] Pre-cleaning isolated test database records (scoped to test entities only)...");
  await cleanupSmokeTestRecords();

  // 2. Seed test entities
  console.log(`[3/7] Seeding test payment attempt (${testPaymentId}) and order (${testOrderId})...`);
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
    orderNumber: "ORD-SMOKE-TEST-001",
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
  console.log(`✅ Durable task persisted: ${scheduledTask.taskId} (status: ${scheduledTask.status})`);

  // Disconnect pre-seed connection so startServer exercises full startup lifecycle
  await disconnectDatabase();

  // 3. Establish deterministic provider-read stub & network guard
  console.log("[4/7] Establishing deterministic provider-read stub and network isolation guard...");
  const stubCalls = [];
  let externalFetchAttempts = 0;

  // Intercept globalThis.fetch to guarantee zero external HTTP requests
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (...args) => {
    externalFetchAttempts++;
    throw new Error(`CRITICAL VIOLATION: External network call attempted to ${args[0]}!`);
  };

  const deterministicStub = async (url) => {
    stubCalls.push({ url: url.toString(), timestamp: new Date() });
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: testPaymentId,
        status: "captured",
        amount: 99900,
        amount_captured: 99900,
        currency: "INR",
        created_at: 1770000000
      })
    };
  };

  // 4. Exercise production startup entrypoint (startServer)
  console.log("[5/7] Executing production application startup entrypoint (startServer)...");
  const startupResult = await startServer({ customFetch: deterministicStub });
  expectCondition(startupResult.server !== null, "HTTP Server listening instance created");
  expectCondition(startupResult.monitoringWorker !== null, "In-process monitoring worker initialized");
  expectCondition(getMonitoringWorker() !== null, "getMonitoringWorker() reflects active worker instance");

  // Verify database connected before worker sweep
  expectCondition(mongoose.connection.readyState === 1, "Database connection verified ready");
  console.log("✅ Production entrypoint started successfully. Worker active in-process.");

  // Await worker loop sweep execution
  console.log("⏳ Awaiting worker loop processing of due task (2 seconds)...");
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // 5. Verify task discovery, canonical persistence, and network isolation
  console.log("[6/7] Verifying canonical persistence and provider-read isolation...");
  expectCondition(externalFetchAttempts === 0, "Zero external HTTP network calls verified");
  expectCondition(stubCalls.length >= 1, `Deterministic provider stub executed (${stubCalls.length} times)`);
  console.log(`   Provider-read calls recorded: ${stubCalls.length} (target: ${stubCalls[0]?.url})`);

  const taskInDb = await PaymentMonitoringTask.findOne({ taskId: scheduledTask.taskId }).lean();
  console.log(`   Persisted Task Status: ${taskInDb?.status} (Outcome: ${taskInDb?.outcomeReason})`);
  expectCondition(taskInDb?.status === "COMPLETED", "Task status transitioned to COMPLETED");

  const paymentInDb = await GatewayPayment.findOne({ gatewayPaymentId: testPaymentId }).lean();
  console.log(`   Persisted GatewayPayment Status: ${paymentInDb?.status}`);
  expectCondition(paymentInDb?.status === "CAPTURED", "GatewayPayment status updated to CAPTURED");

  const orderInDb = await MerchantOrder.findOne({ merchantOrderId: testOrderId }).lean();
  console.log(`   Persisted MerchantOrder Status: ${orderInDb?.status}`);
  expectCondition(orderInDb?.status === "PAID", "MerchantOrder status updated to PAID");

  const caseInDb = await PaymentCase.findOne({ caseId: testCaseId }).lean();
  expectCondition(caseInDb?.captureStatus === "CAPTURE_CAPTURED", "PaymentCase captureStatus updated to CAPTURE_CAPTURED");

  const lifecycleEvent = await PaymentLifecycleEvent.findOne({ gatewayPaymentId: testPaymentId }).lean();
  expectCondition(lifecycleEvent !== null, "Append-only PaymentLifecycleEvent recorded");
  console.log(`   Lifecycle Event: ${lifecycleEvent?.eventId} (${lifecycleEvent?.sourceSystem})`);

  // 6. Graceful shutdown via SIGTERM path
  console.log("[7/7] Initiating production graceful shutdown (SIGTERM handler)...");
  await handleGracefulShutdown("SIGTERM", { exitProcess: false });

  expectCondition(getMonitoringWorker() === null, "Worker stopped and cleared from process state");
  expectCondition(mongoose.connection.readyState === 0, "Database connection closed cleanly");
  console.log("✅ Graceful shutdown completed cleanly. Worker stopped, DB disconnected.");

  // Restore fetch
  globalThis.fetch = originalFetch;

  // Clean test database: remove only its own records (never drop database)
  await connectDatabase(SMOKE_TEST_DB_URI);
  await cleanupSmokeTestRecords();
  await disconnectDatabase();

  console.log("=================================================================");
  console.log("🎉 ALL PRODUCTION STARTUP & PROVIDER ISOLATION GATES PASSED");
  console.log("=================================================================");
}

function expectCondition(cond, description) {
  if (!cond) {
    throw new Error(`Assertion failed: ${description}`);
  }
  console.log(`   ✓ ${description}`);
}

runProductionStartupSmokeTest().catch((err) => {
  console.error("❌ Smoke test failed:", err);
  process.exit(1);
});
