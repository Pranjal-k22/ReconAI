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
import {
  ingestRazorpayWebhook,
  isValidReplayHash,
  reprocessQuarantinedWebhookEvents
} from "../../src/services/webhook/webhookService.js";
import { migratePaymentLifecycleIndexes } from "../../scripts/migrateIndexes.js";

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
    try {
      if (mongoose.connection.readyState !== 0) {
        await mongoose.disconnect();
      }
      await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 3000 });
    } catch (err) {
      throw new Error(
        `[CRITICAL INTEGRATION FAILURE] MongoDB is unreachable at ${SANITIZED_TEST_URI}: ${err.message}. Real MongoDB is required for integration tests.`
      );
    }

    process.env.RAZORPAY_WEBHOOK_SECRET = TEST_SECRET;

    // Ensure model indexes are created in MongoDB
    await PaymentLifecycleEvent.syncIndexes();
    await GatewayPayment.syncIndexes();
    await MerchantOrder.syncIndexes();
    await PaymentCase.syncIndexes();
  });

  afterAll(async () => {
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
  });

  it("1. durable event persistence in real MongoDB with schema validation and sanitization", async () => {

    const testEventId = `evt_integ_${Date.now()}_01`;
    const paymentId = `pay_integ_${Date.now()}_01`;
    const accountId = "acc_integ_test_01";
    const tenantId = "sh_integ_merchant";
    const deduplicationKey = `RAZORPAY:${accountId}:${testEventId}`;

    trackedDeduplicationKeys.add(deduplicationKey);
    trackedPaymentIds.add(paymentId);

    // Pre-seed GatewayPayment for server-side tenant mapping
    await GatewayPayment.create({
      tenantId,
      gatewayPaymentId: paymentId,
      merchantOrderId: "order_test_01",
      provider: "RAZORPAY",
      status: "AUTHORIZED",
      amountPaise: 25000,
      currency: "INR"
    });

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

    const testEventId = `evt_integ_${Date.now()}_dup`;
    const paymentId = `pay_integ_${Date.now()}_dup`;
    const accountId = "acc_integ_test_dup";
    const deduplicationKey = `RAZORPAY:${accountId}:${testEventId}`;

    trackedDeduplicationKeys.add(deduplicationKey);
    trackedPaymentIds.add(paymentId);

    // Pre-seed GatewayPayment for server-side tenant mapping
    await GatewayPayment.create({
      tenantId: "sh_integ_merchant",
      gatewayPaymentId: paymentId,
      merchantOrderId: "order_dup_01",
      provider: "RAZORPAY",
      status: "AUTHORIZED",
      amountPaise: 15000,
      currency: "INR"
    });

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

    const testEventId = `evt_integ_concurrent_${Date.now()}`;
    const paymentId = `pay_integ_concurrent_${Date.now()}`;
    const accountId = "acc_integ_concurrent";
    const deduplicationKey = `RAZORPAY:${accountId}:${testEventId}`;

    trackedDeduplicationKeys.add(deduplicationKey);
    trackedPaymentIds.add(paymentId);

    // Pre-seed GatewayPayment for server-side tenant mapping
    await GatewayPayment.create({
      tenantId: "sh_integ_merchant",
      gatewayPaymentId: paymentId,
      merchantOrderId: "order_concurrent_01",
      provider: "RAZORPAY",
      status: "AUTHORIZED",
      amountPaise: 50000,
      currency: "INR"
    });

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

    const testEventId = `evt_integ_reconnect_${Date.now()}`;
    const paymentId = `pay_integ_reconnect_${Date.now()}`;
    const accountId = "acc_integ_reconnect";
    const deduplicationKey = `RAZORPAY:${accountId}:${testEventId}`;

    trackedDeduplicationKeys.add(deduplicationKey);
    trackedPaymentIds.add(paymentId);

    // Pre-seed GatewayPayment for server-side tenant mapping
    await GatewayPayment.create({
      tenantId: "sh_integ_merchant",
      gatewayPaymentId: paymentId,
      merchantOrderId: "order_reconnect_01",
      provider: "RAZORPAY",
      status: "AUTHORIZED",
      amountPaise: 30000,
      currency: "INR"
    });

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

  it("6. replay with changed event-ID header is acknowledged as duplicate via MongoDB accountBodyHash unique index", async () => {

    const testEventId1 = `evt_integ_hdr1_${Date.now()}`;
    const testEventId2 = `evt_integ_hdr2_${Date.now()}`;
    const paymentId = `pay_integ_hdr_${Date.now()}`;
    const accountId = "acc_integ_hdr";

    trackedDeduplicationKeys.add(`RAZORPAY:${accountId}:${testEventId1}`);
    trackedDeduplicationKeys.add(`RAZORPAY:${accountId}:${testEventId2}`);
    trackedPaymentIds.add(paymentId);

    // Pre-seed GatewayPayment for server-side tenant mapping
    await GatewayPayment.create({
      tenantId: "sh_integ_merchant",
      gatewayPaymentId: paymentId,
      merchantOrderId: "order_hdr_01",
      provider: "RAZORPAY",
      status: "AUTHORIZED",
      amountPaise: 42000,
      currency: "INR"
    });

    const rawBody = JSON.stringify({
      entity: "event",
      account_id: accountId,
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: paymentId,
            amount: 42000,
            currency: "INR",
            notes: { tenantId: "sh_integ_merchant" }
          }
        }
      }
    });

    const signature = signBody(rawBody);

    // Delivery 1 with header evt_integ_hdr1
    const res1 = await request(app)
      .post("/api/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", signature)
      .set("X-Razorpay-Event-Id", testEventId1)
      .send(rawBody);

    expect(res1.status).toBe(200);
    expect(res1.body.data.status).toBe("ACCEPTED");
    const origEventId = res1.body.data.eventId;

    // Delivery 2 with same body, same signature, DIFFERENT header evt_integ_hdr2
    const res2 = await request(app)
      .post("/api/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", signature)
      .set("X-Razorpay-Event-Id", testEventId2)
      .send(rawBody);

    expect(res2.status).toBe(200);
    expect(res2.body.data.status).toBe("DUPLICATE_ACKNOWLEDGED");
    expect(res2.body.data.isDuplicate).toBe(true);
    expect(res2.body.data.eventId).toBe(origEventId);

    // Verify in real MongoDB that exactly ONE document exists for this payment
    const count = await PaymentLifecycleEvent.countDocuments({ gatewayPaymentId: paymentId });
    expect(count).toBe(1);
  });

  it("7. event ID with different signed body is quarantined in real MongoDB (EVENT_ID_PAYLOAD_MISMATCH)", async () => {

    const eventId = `evt_integ_mismatch_${Date.now()}`;
    const accountId = "acc_integ_mismatch";
    const legitPaymentId = `pay_legit_${Date.now()}`;
    trackedDeduplicationKeys.add(`RAZORPAY:${accountId}:${eventId}`);
    trackedPaymentIds.add(legitPaymentId);

    // Pre-seed GatewayPayment for server-side tenant mapping
    await GatewayPayment.create({
      tenantId: "sh_integ_merchant",
      gatewayPaymentId: legitPaymentId,
      merchantOrderId: "order_legit_01",
      provider: "RAZORPAY",
      status: "AUTHORIZED",
      amountPaise: 5000,
      currency: "INR"
    });

    const body1 = JSON.stringify({
      entity: "event",
      account_id: accountId,
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: legitPaymentId,
            amount: 5000,
            currency: "INR",
            notes: { tenantId: "sh_integ_merchant" }
          }
        }
      }
    });

    const res1 = await request(app)
      .post("/api/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", signBody(body1))
      .set("X-Razorpay-Event-Id", eventId)
      .send(body1);

    expect(res1.status).toBe(200);
    expect(res1.body.data.status).toBe("ACCEPTED");

    // Same event ID with different payload
    const body2 = JSON.stringify({
      entity: "event",
      account_id: accountId,
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: `pay_spoofed_${Date.now()}`,
            amount: 999999,
            currency: "INR",
            notes: { tenantId: "sh_integ_merchant" }
          }
        }
      }
    });

    const res2 = await request(app)
      .post("/api/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", signBody(body2))
      .set("X-Razorpay-Event-Id", eventId)
      .send(body2);

    expect(res2.status).toBe(200);
    expect(res2.body.data.status).toBe("QUARANTINED");
    expect(res2.body.data.reason).toBe("EVENT_ID_PAYLOAD_MISMATCH");
  });

  it("8. late capture on CANCELLED order against real MongoDB preserves CANCELLED status and flags SAFE_HOLD in PaymentCase", async () => {

    const orderId = `order_integ_canc_${Date.now()}`;
    const paymentId = `pay_integ_canc_${Date.now()}`;
    const caseId = `CASE_INTEG_CANC_${Date.now()}`;
    const tenantId = "sh_integ_merchant";

    trackedOrderIds.add(orderId);
    trackedPaymentIds.add(paymentId);
    trackedCaseIds.add(caseId);

    // Seed CANCELLED order in MongoDB
    await MerchantOrder.create({
      merchantOrderId: orderId,
      tenantId,
      amountPaise: 6000,
      currency: "INR",
      status: "CANCELLED"
    });

    // Seed PaymentCase in MongoDB
    await PaymentCase.create({
      caseId,
      tenantId,
      merchantOrderId: orderId,
      expectedAmountPaise: 6000,
      currency: "INR",
      discrepancyCategory: "GENERAL_EXCEPTION",
      orderStatus: "ORDER_CANCELLED",
      captureStatus: "CAPTURE_NONE",
      resolutionCaseStatus: "CASE_DETECTED"
    });

    const rawBody = JSON.stringify({
      entity: "event",
      account_id: "acc_integ_canc",
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: orderId,
            amount: 6000,
            currency: "INR",
            notes: { tenantId }
          }
        }
      }
    });

    const eventId = `evt_integ_canc_${Date.now()}`;
    trackedDeduplicationKeys.add(`RAZORPAY:acc_integ_canc:${eventId}`);

    const res = await request(app)
      .post("/api/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", signBody(rawBody))
      .set("X-Razorpay-Event-Id", eventId)
      .send(rawBody);

    expect(res.status).toBe(200);
    expect(res.body.data.conflictFlag).toBe("CANCELLED_ORDER_CAPTURED");

    // Invariant in MongoDB: MerchantOrder remains CANCELLED
    const orderInDb = await MerchantOrder.findOne({ merchantOrderId: orderId }).lean();
    expect(orderInDb.status).toBe("CANCELLED");

    // Invariant in MongoDB: GatewayPayment is CAPTURED
    const paymentInDb = await GatewayPayment.findOne({ gatewayPaymentId: paymentId }).lean();
    expect(paymentInDb.status).toBe("CAPTURED");

    // Invariant in MongoDB: PaymentCase flagged with safe hold
    const caseInDb = await PaymentCase.findOne({ caseId }).lean();
    expect(caseInDb.orderStatus).toBe("ORDER_CANCELLED");
    expect(caseInDb.captureStatus).toBe("CAPTURE_CAPTURED");
    expect(caseInDb.discrepancyCategory).toBe("CANCELLED_ORDER_CAPTURED");
    expect(caseInDb.safeHoldCode).toBe("LATE_CAPTURE_CANCELLED_ORDER");
    expect(caseInDb.resolutionCaseStatus).toBe("CASE_SAFE_HOLD");
  });

  it("9. verify accountBodyHash partial unique index: multiple documents with omitted, null, and empty-string accountBodyHash coexist without collision, while duplicate string hashes are rejected", async () => {

    // Inspect actual MongoDB index definition
    const indexes = await PaymentLifecycleEvent.collection.indexes();
    const hashIndex = indexes.find(
      (idx) => idx.name === "accountBodyHash_partial_unique_v2" || idx.name === "accountBodyHash_1"
    );
    expect(hashIndex).toBeDefined();
    expect(hashIndex.unique).toBe(true);
    expect(hashIndex.partialFilterExpression).toEqual({
      accountBodyHash: { $type: "string", $gt: "" }
    });

    // 1. Create and persist distinct lifecycle events through the normal model path
    // with omitted, null, and empty-string accountBodyHash
    const evtOmitted1 = `evt_probe_omitted_${Date.now()}_1`;
    const evtOmitted2 = `evt_probe_omitted_${Date.now()}_2`;
    const evtNull1 = `evt_probe_null_${Date.now()}_1`;
    const evtNull2 = `evt_probe_null_${Date.now()}_2`;
    const evtEmpty1 = `evt_probe_empty_${Date.now()}_1`;
    const evtEmpty2 = `evt_probe_empty_${Date.now()}_2`;

    trackedEventIds.add(evtOmitted1);
    trackedEventIds.add(evtOmitted2);
    trackedEventIds.add(evtNull1);
    trackedEventIds.add(evtNull2);
    trackedEventIds.add(evtEmpty1);
    trackedEventIds.add(evtEmpty2);

    const docOmitted1 = await PaymentLifecycleEvent.create({
      eventId: evtOmitted1,
      tenantId: "sh_probe_tenant",
      sourceSystem: "GATEWAY_WEBHOOK",
      deduplicationKey: `KEY_OMITTED_${Date.now()}_1`,
      normalizedEventType: "ORDER_CREATED",
      payloadFingerprint: "fp_omitted_1"
    });
    expect(docOmitted1.accountBodyHash).toBeUndefined();

    const docOmitted2 = await PaymentLifecycleEvent.create({
      eventId: evtOmitted2,
      tenantId: "sh_probe_tenant",
      sourceSystem: "GATEWAY_WEBHOOK",
      deduplicationKey: `KEY_OMITTED_${Date.now()}_2`,
      normalizedEventType: "ORDER_CREATED",
      payloadFingerprint: "fp_omitted_2"
    });
    expect(docOmitted2.accountBodyHash).toBeUndefined();

    // Explicit null
    const docNull1 = await PaymentLifecycleEvent.create({
      eventId: evtNull1,
      tenantId: "sh_probe_tenant",
      sourceSystem: "GATEWAY_WEBHOOK",
      deduplicationKey: `KEY_NULL_${Date.now()}_1`,
      accountBodyHash: null,
      normalizedEventType: "ORDER_CREATED",
      payloadFingerprint: "fp_null_1"
    });
    expect(docNull1.accountBodyHash).toBeUndefined();

    const docNull2 = await PaymentLifecycleEvent.create({
      eventId: evtNull2,
      tenantId: "sh_probe_tenant",
      sourceSystem: "GATEWAY_WEBHOOK",
      deduplicationKey: `KEY_NULL_${Date.now()}_2`,
      accountBodyHash: null,
      normalizedEventType: "ORDER_CREATED",
      payloadFingerprint: "fp_null_2"
    });
    expect(docNull2.accountBodyHash).toBeUndefined();

    // Explicit empty string ""
    const docEmpty1 = await PaymentLifecycleEvent.create({
      eventId: evtEmpty1,
      tenantId: "sh_probe_tenant",
      sourceSystem: "GATEWAY_WEBHOOK",
      deduplicationKey: `KEY_EMPTY_${Date.now()}_1`,
      accountBodyHash: "",
      normalizedEventType: "ORDER_CREATED",
      payloadFingerprint: "fp_empty_1"
    });
    expect(docEmpty1.accountBodyHash).toBeUndefined();

    const docEmpty2 = await PaymentLifecycleEvent.create({
      eventId: evtEmpty2,
      tenantId: "sh_probe_tenant",
      sourceSystem: "GATEWAY_WEBHOOK",
      deduplicationKey: `KEY_EMPTY_${Date.now()}_2`,
      accountBodyHash: "   ",
      normalizedEventType: "ORDER_CREATED",
      payloadFingerprint: "fp_empty_2"
    });
    expect(docEmpty2.accountBodyHash).toBeUndefined();

    // Direct driver insert with raw BSON empty string to verify index level partial filter ($gt: '')
    const rawEvtEmpty1 = `evt_probe_raw_empty1_${Date.now()}`;
    const rawEvtEmpty2 = `evt_probe_raw_empty2_${Date.now()}`;
    trackedEventIds.add(rawEvtEmpty1);
    trackedEventIds.add(rawEvtEmpty2);

    await PaymentLifecycleEvent.collection.insertOne({
      eventId: rawEvtEmpty1,
      tenantId: "sh_probe_tenant",
      sourceSystem: "GATEWAY_WEBHOOK",
      deduplicationKey: `KEY_RAW_EMPTY1_${Date.now()}`,
      accountBodyHash: "",
      normalizedEventType: "ORDER_CREATED",
      currency: "INR",
      payloadFingerprint: "fp_raw_empty1",
      createdAt: new Date(),
      updatedAt: new Date()
    });

    await PaymentLifecycleEvent.collection.insertOne({
      eventId: rawEvtEmpty2,
      tenantId: "sh_probe_tenant",
      sourceSystem: "GATEWAY_WEBHOOK",
      deduplicationKey: `KEY_RAW_EMPTY2_${Date.now()}`,
      accountBodyHash: "",
      normalizedEventType: "ORDER_CREATED",
      currency: "INR",
      payloadFingerprint: "fp_raw_empty2",
      createdAt: new Date(),
      updatedAt: new Date()
    });

    // 2. Both Mongoose and raw driver writes succeed: multiple non-hash docs coexist
    const countTotal = await PaymentLifecycleEvent.countDocuments({
      eventId: {
        $in: [
          evtOmitted1,
          evtOmitted2,
          evtNull1,
          evtNull2,
          evtEmpty1,
          evtEmpty2,
          rawEvtEmpty1,
          rawEvtEmpty2
        ]
      }
    });
    expect(countTotal).toBe(8);

    // 3. Verify that duplicate non-empty string hashes for the same account are STILL rejected
    const testHash = `RAZORPAY_BODY:acc_unique_probe:${Date.now()}`;
    const hashEvt1 = `evt_hash_probe_1_${Date.now()}`;
    const hashEvt2 = `evt_hash_probe_2_${Date.now()}`;
    trackedEventIds.add(hashEvt1);
    trackedEventIds.add(hashEvt2);

    await PaymentLifecycleEvent.create({
      eventId: hashEvt1,
      tenantId: "sh_probe_tenant",
      sourceSystem: "GATEWAY_WEBHOOK",
      deduplicationKey: `KEY_HASH_${Date.now()}_1`,
      accountBodyHash: testHash,
      normalizedEventType: "PAYMENT_CAPTURED",
      payloadFingerprint: "fingerprint_hash_1"
    });

    let duplicateRejected = false;
    try {
      await PaymentLifecycleEvent.create({
        eventId: hashEvt2,
        tenantId: "sh_probe_tenant",
        sourceSystem: "GATEWAY_WEBHOOK",
        deduplicationKey: `KEY_HASH_${Date.now()}_2`, // Different deduplicationKey
        accountBodyHash: testHash, // DUPLICATE accountBodyHash
        normalizedEventType: "PAYMENT_CAPTURED",
        payloadFingerprint: "fingerprint_hash_2"
      });
    } catch (err) {
      if (err.code === 11000 || (err.message && err.message.includes("E11000"))) {
        duplicateRejected = true;
      }
    }
    expect(duplicateRejected).toBe(true);

    // 4. Test survival after reconnecting
    await mongoose.disconnect();
    expect(mongoose.connection.readyState).toBe(0);

    await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 5000 });
    expect(mongoose.connection.readyState).toBe(1);

    const doc3 = await PaymentLifecycleEvent.create({
      eventId: `evt_probe_after_reconnect_${Date.now()}`,
      tenantId: "sh_probe_tenant",
      sourceSystem: "GATEWAY_WEBHOOK",
      deduplicationKey: `KEY_PROBE_${Date.now()}_3`,
      normalizedEventType: "ORDER_CREATED",
      payloadFingerprint: "fingerprint_probe_3"
    });
    expect(doc3).toBeDefined();
    trackedEventIds.add(doc3.eventId);
  });

  it("10. conflicting late capture after failure against real MongoDB persists GatewayPayment CAPTURED with isLateCapture and flags PaymentCase with resolutionCaseStatus CASE_SAFE_HOLD and safeHoldCode LATE_CAPTURE_AFTER_FAILURE", async () => {

    const paymentId = `pay_integ_late_fail_${Date.now()}`;
    const orderId = `order_integ_late_fail_${Date.now()}`;
    const caseId = `CASE_INTEG_LATE_FAIL_${Date.now()}`;
    const tenantId = "sh_integ_merchant";

    trackedPaymentIds.add(paymentId);
    trackedOrderIds.add(orderId);
    trackedCaseIds.add(caseId);

    // Seed GatewayPayment initially as FAILED
    await GatewayPayment.create({
      gatewayPaymentId: paymentId,
      merchantOrderId: orderId,
      tenantId,
      amountPaise: 9500,
      currency: "INR",
      status: "FAILED",
      method: "UPI",
      source: "RAZORPAY",
      gatewayCreatedAt: new Date()
    });

    // Seed PaymentCase with captureStatus: CAPTURE_FAILED
    await PaymentCase.create({
      caseId,
      tenantId,
      merchantOrderId: orderId,
      gatewayPaymentId: paymentId,
      expectedAmountPaise: 9500,
      currency: "INR",
      discrepancyCategory: "GENERAL_EXCEPTION",
      orderStatus: "ORDER_CREATED",
      captureStatus: "CAPTURE_FAILED",
      resolutionCaseStatus: "CASE_DETECTED"
    });

    // Webhook delivers late payment.captured
    const eventId = `evt_integ_late_fail_${Date.now()}`;
    trackedDeduplicationKeys.add(`RAZORPAY:acc_integ_late_fail:${eventId}`);

    const rawBody = JSON.stringify({
      entity: "event",
      account_id: "acc_integ_late_fail",
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: orderId,
            amount: 9500,
            currency: "INR",
            notes: { tenantId }
          }
        }
      }
    });

    const res = await request(app)
      .post("/api/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", signBody(rawBody))
      .set("X-Razorpay-Event-Id", eventId)
      .send(rawBody);

    expect(res.status).toBe(200);
    expect(res.body.data.conflictFlag).toBe("LATE_CAPTURE_AFTER_FAILURE");

    // Invariant in MongoDB: GatewayPayment transitioned to CAPTURED with isLateCapture
    const paymentInDb = await GatewayPayment.findOne({ gatewayPaymentId: paymentId }).lean();
    expect(paymentInDb.status).toBe("CAPTURED");
    expect(paymentInDb.isLateCapture).toBe(true);
    expect(paymentInDb.previousStatus).toBe("FAILED");

    // Invariant in MongoDB: PaymentCase exact fields
    const caseInDb = await PaymentCase.findOne({ caseId }).lean();
    expect(caseInDb.captureStatus).toBe("CAPTURE_CAPTURED");
    expect(caseInDb.discrepancyCategory).toBe("STATUS_MISMATCH");
    expect(caseInDb.safeHoldCode).toBe("LATE_CAPTURE_AFTER_FAILURE");
    expect(caseInDb.resolutionCaseStatus).toBe("CASE_SAFE_HOLD");
  });

  it("11. confirm the application never treats an empty string as a valid replay-protection hash", async () => {

    // Direct unit helper verification
    expect(isValidReplayHash("")).toBe(false);
    expect(isValidReplayHash("   ")).toBe(false);
    expect(isValidReplayHash(null)).toBe(false);
    expect(isValidReplayHash(undefined)).toBe(false);
    expect(isValidReplayHash("RAZORPAY_BODY:acc:hash123")).toBe(true);

    // Ingestion test: verify that having documents with empty/null hashes in the database
    // never causes a webhook to falsely match as a duplicate
    const orderId = `order_empty_hash_guard_${Date.now()}`;
    const paymentId = `pay_empty_hash_guard_${Date.now()}`;
    const eventId = `evt_empty_hash_guard_${Date.now()}`;
    const tenantId = "sh_empty_hash_merchant";

    trackedOrderIds.add(orderId);
    trackedPaymentIds.add(paymentId);
    trackedEventIds.add(eventId);

    await MerchantOrder.create({
      merchantOrderId: orderId,
      tenantId,
      amountPaise: 5000,
      currency: "INR",
      status: "CREATED"
    });

    const rawBody = JSON.stringify({
      entity: "event",
      account_id: "acc_empty_guard",
      event: "payment.captured",
      contains: ["payment"],
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: orderId,
            amount: 5000,
            currency: "INR",
            status: "captured",
            notes: { tenantId }
          }
        }
      }
    });

    const res = await request(app)
      .post("/api/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", signBody(rawBody))
      .set("X-Razorpay-Event-Id", eventId)
      .send(rawBody);

    expect(res.status).toBe(200);
    expect(res.body.data.isDuplicate).toBe(false);
    expect(res.body.data.status).toBe("ACCEPTED");
  });

  it("12. verify gapless index migration activates replacement partial unique index before retiring legacy index with zero uniqueness gap", async () => {

    // Use a disposable collection in the test database to safely demonstrate migration
    const db = mongoose.connection.db;
    const testColName = `disposable_lifecycle_migration_${Date.now()}`;
    const testCol = db.collection(testColName);
    await testCol.drop().catch(() => {});

    try {
      // 1. Establish legacy state: index with old sparse: true
      await testCol.createIndex(
        { accountBodyHash: 1 },
        { name: "accountBodyHash_1", unique: true, sparse: true }
      );

      const legacyIndexes = await testCol.indexes();
      const initialIdx = legacyIndexes.find((idx) => idx.name === "accountBodyHash_1");
      expect(initialIdx.sparse).toBe(true);
      expect(initialIdx.partialFilterExpression).toBeUndefined();

      // 2. Insert representative legacy documents
      const legacyDocs = [
        { eventId: "legacy_1", deduplicationKey: "LEGACY:1", payloadFingerprint: "fp1" },
        { eventId: "legacy_2", deduplicationKey: "LEGACY:2", accountBodyHash: "RAZORPAY_BODY:acc:hash1", payloadFingerprint: "fp2" },
        { eventId: "legacy_3", deduplicationKey: "LEGACY:3", accountBodyHash: "RAZORPAY_BODY:acc:hash2", payloadFingerprint: "fp3" }
      ];
      await testCol.insertMany(legacyDocs);

      const countBefore = await testCol.countDocuments();
      expect(countBefore).toBe(3);

      // 3. Run gapless migration function
      const migrationResult = await migratePaymentLifecycleIndexes({
        collection: () => testCol
      });
      expect(migrationResult.status).toBe("MIGRATED");
      expect(migrationResult.replacementIndex).toBe("accountBodyHash_partial_unique_v2");
      expect(migrationResult.retiredIndices).toContain("accountBodyHash_1");

      // 4. Verify all documents preserved without data loss
      const countAfter = await testCol.countDocuments();
      expect(countAfter).toBe(3);

      // 5. Verify index upgraded to replacement partial unique with $gt: '' and legacy retired
      const updatedIndexes = await testCol.indexes();
      const upgradedIdx = updatedIndexes.find((idx) => idx.name === "accountBodyHash_partial_unique_v2");
      expect(upgradedIdx).toBeDefined();
      expect(upgradedIdx.unique).toBe(true);
      expect(upgradedIdx.sparse).toBeUndefined();
      expect(upgradedIdx.partialFilterExpression).toEqual({
        accountBodyHash: { $type: "string", $gt: "" }
      });

      const retiredIdx = updatedIndexes.find((idx) => idx.name === "accountBodyHash_1");
      expect(retiredIdx).toBeUndefined();

      // 6. Verify post-migration coexistence of omitted, null, and empty strings
      await testCol.insertOne({ eventId: "new_omitted", deduplicationKey: "NEW:1", payloadFingerprint: "fp4" });
      await testCol.insertOne({ eventId: "new_null", deduplicationKey: "NEW:2", accountBodyHash: null, payloadFingerprint: "fp5" });
      await testCol.insertOne({ eventId: "new_empty_1", deduplicationKey: "NEW:3", accountBodyHash: "", payloadFingerprint: "fp6" });
      await testCol.insertOne({ eventId: "new_empty_2", deduplicationKey: "NEW:4", accountBodyHash: "", payloadFingerprint: "fp7" });

      const countWithBlanks = await testCol.countDocuments();
      expect(countWithBlanks).toBe(7);

      // 7. Verify duplicate valid hash is rejected
      let duplicateBlocked = false;
      try {
        await testCol.insertOne({ eventId: "new_dup", deduplicationKey: "NEW:5", accountBodyHash: "RAZORPAY_BODY:acc:hash1", payloadFingerprint: "fp8" });
      } catch (err) {
        if (err.code === 11000) duplicateBlocked = true;
      }
      expect(duplicateBlocked).toBe(true);

      // 8. Verify idempotency on second run
      const secondRun = await migratePaymentLifecycleIndexes({
        collection: () => testCol
      });
      expect(secondRun.status).toBe("NO_CHANGE_NEEDED");
      expect(secondRun.replacementIndex).toBe("accountBodyHash_partial_unique_v2");
    } finally {
      await testCol.drop().catch(() => {});
    }
  });

  it("13. verify migration precondition fails closed when duplicate valid hashes exist and preserves previous index", async () => {

    const db = mongoose.connection.db;
    const testColName = `disposable_precondition_fail_${Date.now()}`;
    const testCol = db.collection(testColName);
    await testCol.drop().catch(() => {});

    try {
      // 1. Establish legacy state with old index
      await testCol.createIndex(
        { accountBodyHash: 1 },
        { name: "accountBodyHash_1", unique: false } // unindexed/corrupt duplicate state
      );

      // 2. Insert duplicate non-empty hashes
      await testCol.insertOne({ eventId: "d1", deduplicationKey: "KD1", accountBodyHash: "RAZORPAY_BODY:acc:colliding_hash" });
      await testCol.insertOne({ eventId: "d2", deduplicationKey: "KD2", accountBodyHash: "RAZORPAY_BODY:acc:colliding_hash" });

      // 3. Attempt migration - must fail closed without dropping old index or modifying records
      let caughtError = null;
      try {
        await migratePaymentLifecycleIndexes({
          collection: () => testCol
        });
      } catch (err) {
        caughtError = err;
      }

      expect(caughtError).toBeDefined();
      expect(caughtError.code).toBe("DUPLICATE_HASHES_FOUND");
      expect(caughtError.duplicates).toHaveLength(1);
      expect(caughtError.duplicates[0]._id).toBe("RAZORPAY_BODY:acc:colliding_hash");

      // 4. Invariant: records preserved intact
      const docCount = await testCol.countDocuments();
      expect(docCount).toBe(2);

      // 5. Invariant: legacy index retained, replacement not created
      const currentIndexes = await testCol.indexes();
      const legacyIdx = currentIndexes.find((i) => i.name === "accountBodyHash_1");
      const replacementIdx = currentIndexes.find((i) => i.name === "accountBodyHash_partial_unique_v2");
      expect(legacyIdx).toBeDefined();
      expect(replacementIdx).toBeUndefined();
    } finally {
      await testCol.drop().catch(() => {});
    }
  });

  it("14. disconnect during a mutation path -> mutation not reported successful, no partial state (audit fails closed)", async () => {
    const testEventId = `evt_integ_${Date.now()}_audit_fail`;
    const paymentId = `pay_integ_${Date.now()}_audit_fail`;
    const orderId = `order_integ_${Date.now()}_audit_fail`;
    const tenantId = "sh_integ_merchant";

    trackedPaymentIds.add(paymentId);
    trackedOrderIds.add(orderId);

    // Pre-seed order and gateway payment in Mongo
    await MerchantOrder.create({
      tenantId,
      merchantOrderId: orderId,
      amountPaise: 50000,
      currency: "INR",
      status: "PENDING"
    });

    await GatewayPayment.create({
      tenantId,
      gatewayPaymentId: paymentId,
      merchantOrderId: orderId,
      provider: "RAZORPAY",
      status: "AUTHORIZED",
      amountPaise: 50000,
      currency: "INR"
    });

    // Simulate production environment where audit failure must fail-closed
    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    try {
      // Disconnect Mongo right before webhook processing
      await mongoose.disconnect();
      expect(mongoose.connection.readyState).toBe(0);

      const payload = {
        entity: "event",
        account_id: "acc_integ_test_01",
        event: "payment.captured",
        contains: ["payment"],
        payload: {
          payment: {
            entity: {
              id: paymentId,
              order_id: `order_rzp_${Date.now()}`,
              amount: 50000,
              currency: "INR",
              status: "captured",
              captured: true,
              amount_refunded: 0
            }
          }
        },
        created_at: Math.floor(Date.now() / 1000)
      };

      const rawBody = JSON.stringify(payload);
      const signature = signBody(rawBody);

      let caughtErr = null;
      let result = null;
      try {
        result = await ingestRazorpayWebhook({
          eventId: testEventId,
          signature,
          rawBody,
          parsedBody: payload
        });
      } catch (err) {
        caughtErr = err;
      }

      // Either caught error (AuditUnavailableError / 5xx) or result indicates failure (not SUCCESS)
      const failed = caughtErr !== null || (result && result.status !== "SUCCESS");
      expect(failed).toBe(true);

      // Reconnect to verify state integrity
      await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 5000 });

      // MerchantOrder must NOT have transitioned to PAID
      const persistedOrder = await MerchantOrder.findOne({ merchantOrderId: orderId }).lean();
      expect(persistedOrder.status).not.toBe("PAID");
      expect(persistedOrder.status).toBe("PENDING");

      // GatewayPayment must NOT have transitioned to CAPTURED
      const persistedPayment = await GatewayPayment.findOne({ gatewayPaymentId: paymentId }).lean();
      expect(persistedPayment.status).not.toBe("CAPTURED");
      expect(persistedPayment.status).toBe("AUTHORIZED");
    } finally {
      process.env.NODE_ENV = prevEnv;
      if (mongoose.connection.readyState !== 1) {
        try {
          await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 5000 });
        } catch {}
      }
    }
  });

  it("15. audit failure mid-webhook returns 503, provider retry applies mutation once, further retry is duplicate, no partial state", async () => {
    const tenantId = "sh_integ_audit_fail";
    const paymentId = `pay_integ_audit_fail_${Date.now()}`;
    const orderId = `order_integ_audit_fail_${Date.now()}`;
    const testEventId = `evt_integ_audit_fail_${Date.now()}`;
    const accountId = "acc_integ_audit_01";
    const deduplicationKey = `RAZORPAY:${accountId}:${testEventId}`;

    trackedDeduplicationKeys.add(deduplicationKey);
    trackedPaymentIds.add(paymentId);
    trackedOrderIds.add(orderId);

    // Pre-seed order and gateway payment in Mongo
    await MerchantOrder.create({
      tenantId,
      merchantOrderId: orderId,
      amountPaise: 65000,
      currency: "INR",
      status: "PENDING"
    });

    await GatewayPayment.create({
      tenantId,
      gatewayPaymentId: paymentId,
      merchantOrderId: orderId,
      provider: "RAZORPAY",
      status: "AUTHORIZED",
      amountPaise: 65000,
      currency: "INR"
    });

    const payload = {
      entity: "event",
      account_id: accountId,
      event: "payment.captured",
      contains: ["payment"],
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: orderId,
            amount: 65000,
            currency: "INR",
            status: "captured",
            captured: true,
            amount_refunded: 0
          }
        }
      },
      created_at: Math.floor(Date.now() / 1000)
    };

    const rawBody = JSON.stringify(payload);
    const signature = signBody(rawBody);

    const prevEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "production";

    // Force an audit failure mid-webhook by having AuditLog.create throw
    const originalAuditCreate = AuditLog.create;
    AuditLog.create = async () => {
      const err = new Error("Database disk full / audit collection write rejected");
      err.code = "AUDIT_WRITE_FAILED";
      throw err;
    };

    try {
      // Step 1: Send webhook during audit failure -> Expect 503 Service Unavailable
      const res1 = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signature)
        .set("X-Razorpay-Event-Id", testEventId)
        .send(rawBody);

      expect(res1.status).toBe(503);

      // Verify no partial state in MongoDB
      const storedEvent = await PaymentLifecycleEvent.findOne({ deduplicationKey }).lean();
      expect(storedEvent).toBeTruthy();
      expect(storedEvent.processingStatus).toBe("RECEIVED"); // NOT PROCESSED!

      const orderAfterFail = await MerchantOrder.findOne({ merchantOrderId: orderId }).lean();
      expect(orderAfterFail.status).toBe("PENDING"); // NOT PAID!

      const paymentAfterFail = await GatewayPayment.findOne({ gatewayPaymentId: paymentId }).lean();
      expect(paymentAfterFail.status).toBe("AUTHORIZED"); // NOT CAPTURED!

      // Step 2: Restore audit logging and NODE_ENV
      AuditLog.create = originalAuditCreate;
      process.env.NODE_ENV = prevEnv;

      // Wait beyond the SHORT_TIMEOUT_MS (500ms) so stored RECEIVED event qualifies for retry
      await new Promise((resolve) => setTimeout(resolve, 550));

      // Provider retry with the exact same event
      const res2 = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signature)
        .set("X-Razorpay-Event-Id", testEventId)
        .send(rawBody);

      expect(res2.status).toBe(200);
      expect(res2.body.data.status).toBe("ACCEPTED");

      // Verify mutations applied exactly once
      const orderAfterRetry = await MerchantOrder.findOne({ merchantOrderId: orderId }).lean();
      expect(orderAfterRetry.status).toBe("PAID");

      const paymentAfterRetry = await GatewayPayment.findOne({ gatewayPaymentId: paymentId }).lean();
      expect(paymentAfterRetry.status).toBe("CAPTURED");

      const eventAfterRetry = await PaymentLifecycleEvent.findOne({ deduplicationKey }).lean();
      expect(eventAfterRetry.processingStatus).toBe("PROCESSED");

      const auditEntry = await AuditLog.findOne({
        action: "WEBHOOK_INGESTED",
        "metadata.deduplicationKey": deduplicationKey
      }).lean();
      expect(auditEntry).toBeTruthy();

      // Step 3: A further retry is a no-op duplicate
      const res3 = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signature)
        .set("X-Razorpay-Event-Id", testEventId)
        .send(rawBody);

      expect(res3.status).toBe(200);
      expect(res3.body.data.status).toBe("DUPLICATE_ACKNOWLEDGED");
      expect(res3.body.data.isDuplicate).toBe(true);

      // Verify still exactly 1 event and order remains PAID
      const finalCount = await PaymentLifecycleEvent.countDocuments({ deduplicationKey });
      expect(finalCount).toBe(1);
      const finalOrder = await MerchantOrder.findOne({ merchantOrderId: orderId }).lean();
      expect(finalOrder.status).toBe("PAID");
    } finally {
      AuditLog.create = originalAuditCreate;
      process.env.NODE_ENV = prevEnv;
    }
  });

  it("16. unmapped event arrives before payment record, mapping appears, event is applied exactly once without payload notes", async () => {
    const paymentId = `pay_integ_unmapped_${Date.now()}`;
    const orderId = `order_integ_unmapped_${Date.now()}`;
    const testEventId = `evt_integ_unmapped_${Date.now()}`;
    const accountId = "acc_integ_unmapped_01";
    const deduplicationKey = `RAZORPAY:${accountId}:${testEventId}`;
    const authoritativeTenant = "sh_authoritative_merchant_001";
    const maliciousNotesTenant = "sh_attacker_spoofed_tenant_999";

    trackedDeduplicationKeys.add(deduplicationKey);
    trackedPaymentIds.add(paymentId);
    trackedOrderIds.add(orderId);

    // Event arrives for payment not yet in DB; payload notes claim attacker tenant
    const payload = {
      entity: "event",
      account_id: accountId,
      event: "payment.captured",
      contains: ["payment"],
      payload: {
        payment: {
          entity: {
            id: paymentId,
            order_id: orderId,
            amount: 72000,
            currency: "INR",
            status: "captured",
            captured: true,
            amount_refunded: 0,
            notes: { tenantId: maliciousNotesTenant }
          }
        }
      },
      created_at: Math.floor(Date.now() / 1000)
    };

    const rawBody = JSON.stringify(payload);
    const signature = signBody(rawBody);

    // Ingest event before any DB record exists
    const res1 = await request(app)
      .post("/api/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", signature)
      .set("X-Razorpay-Event-Id", testEventId)
      .send(rawBody);

    expect(res1.status).toBe(200);
    expect(res1.body.data.status).toBe("QUARANTINED_UNRESOLVED_TENANT");
    expect(res1.body.data.reason).toBe("UNMAPPED_TENANT");

    // Verify stored event in Mongo is quarantined with unassigned tenant, NEVER attacker tenant
    const quarantinedDoc = await PaymentLifecycleEvent.findOne({ deduplicationKey }).lean();
    expect(quarantinedDoc).toBeTruthy();
    expect(quarantinedDoc.processingStatus).toBe("QUARANTINED");
    expect(quarantinedDoc.tenantId).toBe("unassigned_provider_quarantine");
    expect(quarantinedDoc.tenantId).not.toBe(maliciousNotesTenant);

    // Now server-side mapping appears (e.g. checkout order sync or backoffice creation)
    await GatewayPayment.create({
      tenantId: authoritativeTenant,
      gatewayPaymentId: paymentId,
      merchantOrderId: orderId,
      provider: "RAZORPAY",
      status: "AUTHORIZED",
      amountPaise: 72000,
      currency: "INR"
    });

    await MerchantOrder.create({
      tenantId: authoritativeTenant,
      merchantOrderId: orderId,
      amountPaise: 72000,
      currency: "INR",
      status: "PENDING"
    });

    // Trigger quarantined event recovery using authoritative server tenant
    const recoveryResult = await reprocessQuarantinedWebhookEvents({
      tenantId: authoritativeTenant,
      gatewayPaymentId: paymentId,
      merchantOrderId: orderId
    });

    expect(recoveryResult.reprocessedCount).toBe(1);
    expect(recoveryResult.results[0].status).toBe("REPROCESSED");
    expect(recoveryResult.results[0].tenantId).toBe(authoritativeTenant);

    // Verify event is now PROCESSED and bound to authoritative tenant
    const processedEvent = await PaymentLifecycleEvent.findOne({ deduplicationKey }).lean();
    expect(processedEvent.processingStatus).toBe("PROCESSED");
    expect(processedEvent.tenantId).toBe(authoritativeTenant);

    // Verify order and payment mutations applied under authoritative tenant
    const updatedPayment = await GatewayPayment.findOne({ gatewayPaymentId: paymentId }).lean();
    expect(updatedPayment.status).toBe("CAPTURED");
    expect(updatedPayment.tenantId).toBe(authoritativeTenant);

    const updatedOrder = await MerchantOrder.findOne({ merchantOrderId: orderId }).lean();
    expect(updatedOrder.status).toBe("PAID");
    expect(updatedOrder.tenantId).toBe(authoritativeTenant);

    // Provider retry of webhook after mapping and recovery -> DUPLICATE_ACKNOWLEDGED
    const res2 = await request(app)
      .post("/api/webhooks/razorpay")
      .set("Content-Type", "application/json")
      .set("X-Razorpay-Signature", signature)
      .set("X-Razorpay-Event-Id", testEventId)
      .send(rawBody);

    expect(res2.status).toBe(200);
    expect(res2.body.data.status).toBe("DUPLICATE_ACKNOWLEDGED");
    expect(res2.body.data.isDuplicate).toBe(true);

    // Assert that no records were ever created or mutated under maliciousNotesTenant
    const attackerOrder = await MerchantOrder.findOne({ tenantId: maliciousNotesTenant }).lean();
    expect(attackerOrder).toBeNull();
    const attackerPayment = await GatewayPayment.findOne({ tenantId: maliciousNotesTenant }).lean();
    expect(attackerPayment).toBeNull();
  });
});
