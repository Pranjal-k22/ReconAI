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

  it("6. replay with changed event-ID header is acknowledged as duplicate via MongoDB accountBodyHash unique index", async () => {
    if (!isMongoAvailable) return;

    const testEventId1 = `evt_integ_hdr1_${Date.now()}`;
    const testEventId2 = `evt_integ_hdr2_${Date.now()}`;
    const paymentId = `pay_integ_hdr_${Date.now()}`;
    const accountId = "acc_integ_hdr";

    trackedDeduplicationKeys.add(`RAZORPAY:${accountId}:${testEventId1}`);
    trackedDeduplicationKeys.add(`RAZORPAY:${accountId}:${testEventId2}`);
    trackedPaymentIds.add(paymentId);

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
    if (!isMongoAvailable) return;

    const eventId = `evt_integ_mismatch_${Date.now()}`;
    const accountId = "acc_integ_mismatch";
    trackedDeduplicationKeys.add(`RAZORPAY:${accountId}:${eventId}`);

    const body1 = JSON.stringify({
      entity: "event",
      account_id: accountId,
      event: "payment.captured",
      payload: {
        payment: {
          entity: {
            id: `pay_legit_${Date.now()}`,
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
    if (!isMongoAvailable) return;

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

  it("9. verify accountBodyHash partial unique index: multiple documents with omitted/null accountBodyHash coexist without collision, while duplicate string hashes are rejected", async () => {
    if (!isMongoAvailable) return;

    // Inspect actual MongoDB index definition
    const indexes = await PaymentLifecycleEvent.collection.indexes();
    const hashIndex = indexes.find((idx) => idx.name === "accountBodyHash_1");
    expect(hashIndex).toBeDefined();
    expect(hashIndex.unique).toBe(true);
    expect(hashIndex.partialFilterExpression).toEqual({
      accountBodyHash: { $type: "string" }
    });

    // 1. Create and persist 2 distinct lifecycle events through the normal model path omitting accountBodyHash
    const evtId1 = `evt_probe_nohash_${Date.now()}_1`;
    const evtId2 = `evt_probe_nohash_${Date.now()}_2`;
    trackedEventIds.add(evtId1);
    trackedEventIds.add(evtId2);

    const doc1 = await PaymentLifecycleEvent.create({
      eventId: evtId1,
      tenantId: "sh_probe_tenant",
      sourceSystem: "GATEWAY_WEBHOOK",
      deduplicationKey: `KEY_PROBE_${Date.now()}_1`,
      normalizedEventType: "ORDER_CREATED",
      payloadFingerprint: "fingerprint_probe_1"
    });
    expect(doc1.accountBodyHash).toBeUndefined();

    const doc2 = await PaymentLifecycleEvent.create({
      eventId: evtId2,
      tenantId: "sh_probe_tenant",
      sourceSystem: "GATEWAY_WEBHOOK",
      deduplicationKey: `KEY_PROBE_${Date.now()}_2`,
      normalizedEventType: "ORDER_CREATED",
      payloadFingerprint: "fingerprint_probe_2"
    });
    expect(doc2.accountBodyHash).toBeUndefined();

    // 2. Both writes succeed when other keys are distinct
    const countNoHash = await PaymentLifecycleEvent.countDocuments({
      eventId: { $in: [evtId1, evtId2] }
    });
    expect(countNoHash).toBe(2);

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

  it("10. conflicting late capture after failure against real MongoDB persists GatewayPayment CAPTURED with isLateCapture and flags PaymentCase with resolutionCaseStatus CASE_SAFE_HOLD and safeHoldCode ADMIN_HOLD", async () => {
    if (!isMongoAvailable) return;

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
    expect(caseInDb.safeHoldCode).toBe("ADMIN_HOLD");
    expect(caseInDb.resolutionCaseStatus).toBe("CASE_SAFE_HOLD");
  });
});
