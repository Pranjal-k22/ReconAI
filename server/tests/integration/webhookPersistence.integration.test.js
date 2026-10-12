import { describe, it, expect, beforeAll, afterAll } from "vitest";
import mongoose from "mongoose";
import request from "supertest";
import crypto from "crypto";
import app from "../../src/app.js";
import { PaymentLifecycleEvent } from "../../src/models/PaymentLifecycleEvent.js";
import { GatewayPayment } from "../../src/models/GatewayPayment.js";
import { MerchantOrder } from "../../src/models/MerchantOrder.js";
import { PaymentCase } from "../../src/models/PaymentCase.js";
import { AuditLog } from "../../src/models/AuditLog.js";
import { ingestRazorpayWebhook } from "../../src/services/webhook/webhookService.js";

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

const DEFAULT_TEST_URI = "mongodb://127.0.0.1:27017/reconai_test_webhook_persistence";
const TEST_DB_URI = validateTestDatabaseUri(process.env.MONGODB_TEST_URI || DEFAULT_TEST_URI);
const SANITIZED_TEST_URI = sanitizeMongoUri(TEST_DB_URI);

let isMongoAvailable = false;
let mongoSkipReason = "";

try {
  await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 2500 });
  if (mongoose.connection.readyState === 1) {
    isMongoAvailable = true;
  }
} catch (err) {
  isMongoAvailable = false;
  mongoSkipReason = `MongoDB connection failed at ${SANITIZED_TEST_URI}: ${err.message}`;
} finally {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

const TEST_SECRET = "persistent_test_webhook_secret_key_32_bytes_ok!";

function signBody(bodyStr, secret = TEST_SECRET) {
  return crypto.createHmac("sha256", secret).update(Buffer.from(bodyStr, "utf8")).digest("hex");
}

describe("ReconAI 2.0 - Provider Webhook Ingestion Real MongoDB Persistence Integration", { timeout: 35000 }, () => {
  const trackedEventIds = new Set();
  const trackedDeduplicationKeys = new Set();
  const trackedPaymentIds = new Set();
  const trackedOrderIds = new Set();
  const trackedCaseIds = new Set();

  beforeAll(async () => {
    if (!isMongoAvailable) {
      console.warn(
        `\n⚠️  [INTEGRATION TEST SKIPPED] ${mongoSkipReason}\nPersistence integration tests require a live isolated MongoDB instance. In-memory substitution is disabled.`
      );
      return;
    }

    process.env.RAZORPAY_WEBHOOK_SECRET = TEST_SECRET;

    // Connect to isolated test database
    await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 5000 });

    // Ensure model indexes are created in MongoDB
    await PaymentLifecycleEvent.syncIndexes();
    await GatewayPayment.syncIndexes();
    await MerchantOrder.syncIndexes();
    await PaymentCase.syncIndexes();
  });

  afterAll(async () => {
    if (isMongoAvailable) {
      if (mongoose.connection.readyState !== 1) {
        try {
          await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 5000 });
        } catch {}
      }

      // Clean up tracked test records
      if (trackedDeduplicationKeys.size > 0) {
        await PaymentLifecycleEvent.deleteMany({
          deduplicationKey: { $in: Array.from(trackedDeduplicationKeys) }
        });
      }

      if (trackedPaymentIds.size > 0) {
        await GatewayPayment.deleteMany({
          gatewayPaymentId: { $in: Array.from(trackedPaymentIds) }
        });
      }

      if (trackedOrderIds.size > 0) {
        await MerchantOrder.deleteMany({
          merchantOrderId: { $in: Array.from(trackedOrderIds) }
        });
      }

      if (trackedCaseIds.size > 0) {
        await PaymentCase.deleteMany({
          caseId: { $in: Array.from(trackedCaseIds) }
        });
      }

      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
    }
  });

  it("1. durable event persistence in real MongoDB with schema validation and sanitization", async () => {
    if (!isMongoAvailable) {
      console.warn("Skipping real DB test: MongoDB not available");
      return;
    }

    const testEventId = `evt_integ_${Date.now()}_01`;
    const paymentId = `pay_integ_${Date.now()}_01`;
    const accountId = "acc_integ_test_01";
    const tenantId = "sh_integ_merchant";
    const deduplicationKey = `RAZORPAY:${accountId}:${testEventId}`;

    trackedDeduplicationKeys.add(deduplicationKey);
    trackedPaymentIds.add(paymentId);

    const rawBody = JSON.stringify({
      entity: "event",
      account_id: accountId,
      event: "payment.captured",
      created_at: 1728734400,
      payload: {
        payment: {
          entity: {
            id: paymentId,
            amount: 25000,
            currency: "INR",
            method: "upi",
            notes: {
              tenantId,
              secretToken: "must_be_redacted_secret"
            }
          }
        }
      }
    });

    const signature = signBody(rawBody);

    const res = await request(app)
      .post("/api/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", signature)
      .set("X-Razorpay-Event-Id", testEventId)
      .send(rawBody);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("ACCEPTED");
    expect(res.body.data.isDuplicate).toBe(false);

    // Verify document exists in real MongoDB
    const persisted = await PaymentLifecycleEvent.findOne({ deduplicationKey }).lean();
    expect(persisted).not.toBeNull();
    expect(persisted.tenantId).toBe(tenantId);
    expect(persisted.gatewayPaymentId).toBe(paymentId);
    expect(persisted.normalizedEventType).toBe("PAYMENT_CAPTURED");
    expect(persisted.amountPaise).toBe(25000);
    expect(persisted.currency).toBe("INR");
    expect(persisted.payloadFingerprint).toBeDefined();

    // Verify sanitized data (secret redacted)
    expect(persisted.normalizedPayload.payment.entity.notes.secretToken).toBe("[REDACTED]");

    // Verify GatewayPayment state progression in MongoDB
    const paymentRecord = await GatewayPayment.findOne({ gatewayPaymentId: paymentId }).lean();
    expect(paymentRecord).not.toBeNull();
    expect(paymentRecord.status).toBe("CAPTURED");
    expect(paymentRecord.tenantId).toBe(tenantId);
  });

  it("2. durable deduplication: duplicate delivery returns DUPLICATE_ACKNOWLEDGED without duplicate DB rows", async () => {
    if (!isMongoAvailable) return;

    const testEventId = `evt_integ_${Date.now()}_dup`;
    const paymentId = `pay_integ_${Date.now()}_dup`;
    const accountId = "acc_integ_test_dup";
    const deduplicationKey = `RAZORPAY:${accountId}:${testEventId}`;

    trackedDeduplicationKeys.add(deduplicationKey);
    trackedPaymentIds.add(paymentId);

    const rawBody = JSON.stringify({
      entity: "event",
      account_id: accountId,
      event: "payment.captured",
      created_at: 1728734400,
      payload: {
        payment: {
          entity: {
            id: paymentId,
            amount: 15000,
            currency: "INR",
            notes: { tenantId: "sh_integ_merchant" }
          }
        }
      }
    });

    const signature = signBody(rawBody);

    // First request
    const res1 = await request(app)
      .post("/api/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", signature)
      .set("X-Razorpay-Event-Id", testEventId)
      .send(rawBody);

    expect(res1.status).toBe(200);
    expect(res1.body.data.status).toBe("ACCEPTED");
    expect(res1.body.data.isDuplicate).toBe(false);

    // Duplicate request
    const res2 = await request(app)
      .post("/api/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", signature)
      .set("X-Razorpay-Event-Id", testEventId)
      .send(rawBody);

    expect(res2.status).toBe(200);
    expect(res2.body.data.status).toBe("DUPLICATE_ACKNOWLEDGED");
    expect(res2.body.data.isDuplicate).toBe(true);
    expect(res2.body.data.eventId).toBe(res1.body.data.eventId);

    // Verify exactly ONE document exists in MongoDB
    const count = await PaymentLifecycleEvent.countDocuments({ deduplicationKey });
    expect(count).toBe(1);
  });

  it("3. concurrent duplicate deliveries against real MongoDB are handled idempotently via E11000", async () => {
    if (!isMongoAvailable) return;

    const testEventId = `evt_integ_concurrent_${Date.now()}`;
    const paymentId = `pay_integ_concurrent_${Date.now()}`;
    const accountId = "acc_integ_concurrent";
    const deduplicationKey = `RAZORPAY:${accountId}:${testEventId}`;

    trackedDeduplicationKeys.add(deduplicationKey);
    trackedPaymentIds.add(paymentId);

    const rawBody = JSON.stringify({
      entity: "event",
      account_id: accountId,
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: paymentId,
            amount: 50000,
            currency: "INR",
            notes: { tenantId: "sh_integ_merchant" }
          }
        }
      }
    });

    const signature = signBody(rawBody);

    // Fire 5 concurrent requests simultaneously
    const responses = await Promise.all(
      Array.from({ length: 5 }).map(() =>
        request(app)
          .post("/api/webhooks/razorpay")
          .set("Content-Type", "application/json")
          .set("X-Razorpay-Signature", signature)
          .set("X-Razorpay-Event-Id", testEventId)
          .send(rawBody)
      )
    );

    // All must succeed with 200 HTTP status
    responses.forEach((res) => {
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    // Exactly 1 must be ACCEPTED, exactly 4 must be DUPLICATE_ACKNOWLEDGED
    const accepted = responses.filter((r) => r.body.data.status === "ACCEPTED");
    const duplicates = responses.filter((r) => r.body.data.status === "DUPLICATE_ACKNOWLEDGED");

    expect(accepted.length).toBe(1);
    expect(duplicates.length).toBe(4);

    // Exactly one row exists in MongoDB
    const count = await PaymentLifecycleEvent.countDocuments({ deduplicationKey });
    expect(count).toBe(1);
  });

  it("4. deduplication survives database disconnect and reconnect", async () => {
    if (!isMongoAvailable) return;

    const testEventId = `evt_integ_reconnect_${Date.now()}`;
    const paymentId = `pay_integ_reconnect_${Date.now()}`;
    const accountId = "acc_integ_reconnect";
    const deduplicationKey = `RAZORPAY:${accountId}:${testEventId}`;

    trackedDeduplicationKeys.add(deduplicationKey);
    trackedPaymentIds.add(paymentId);

    const rawBody = JSON.stringify({
      entity: "event",
      account_id: accountId,
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: paymentId,
            amount: 30000,
            currency: "INR",
            notes: { tenantId: "sh_integ_merchant" }
          }
        }
      }
    });

    const signature = signBody(rawBody);

    // Ingest event
    const res1 = await request(app)
      .post("/api/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", signature)
      .set("X-Razorpay-Event-Id", testEventId)
      .send(rawBody);

    expect(res1.status).toBe(200);
    expect(res1.body.data.status).toBe("ACCEPTED");

    // Simulate complete DB disconnect and reconnection
    await mongoose.disconnect();
    expect(mongoose.connection.readyState).toBe(0);

    await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 5000 });
    expect(mongoose.connection.readyState).toBe(1);

    // Ingest the same event after reconnection
    const res2 = await request(app)
      .post("/api/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", signature)
      .set("X-Razorpay-Event-Id", testEventId)
      .send(rawBody);

    expect(res2.status).toBe(200);
    expect(res2.body.data.status).toBe("DUPLICATE_ACKNOWLEDGED");
    expect(res2.body.data.isDuplicate).toBe(true);

    const count = await PaymentLifecycleEvent.countDocuments({ deduplicationKey });
    expect(count).toBe(1);
  });

  it("5. out-of-order deliveries against real MongoDB cannot regress CAPTURED to FAILED", async () => {
    if (!isMongoAvailable) return;

    const paymentId = `pay_ooo_${Date.now()}`;
    const tenantId = "sh_integ_ooo";
    const orderId = `order_ooo_${Date.now()}`;

    trackedPaymentIds.add(paymentId);
    trackedOrderIds.add(orderId);

    // Seed CAPTURED payment directly in MongoDB
    await GatewayPayment.create({
      gatewayPaymentId: paymentId,
      tenantId,
      merchantOrderId: orderId,
      amountPaise: 10000,
      currency: "INR",
      status: "CAPTURED",
      method: "CARD",
      source: "RAZORPAY",
      gatewayCreatedAt: new Date()
    });

    // Ingest delayed out-of-order payment.failed event
    const failedEventId = `evt_delayed_fail_${Date.now()}`;
    trackedDeduplicationKeys.add(`RAZORPAY:acc_ooo:${failedEventId}`);

    const failedRaw = JSON.stringify({
      entity: "event",
      account_id: "acc_ooo",
      event: "payment.failed",
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: orderId,
            amount: 10000,
            currency: "INR",
            notes: { tenantId }
          }
        }
      }
    });

    const res = await request(app)
      .post("/api/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", signBody(failedRaw))
      .set("X-Razorpay-Event-Id", failedEventId)
      .send(failedRaw);

    expect(res.status).toBe(200);

    // Verify in real MongoDB: GatewayPayment status remains CAPTURED
    const paymentInDb = await GatewayPayment.findOne({ gatewayPaymentId: paymentId }).lean();
    expect(paymentInDb.status).toBe("CAPTURED");
  });
});
