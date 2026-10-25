import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import crypto from "crypto";
import app from "../../src/app.js";
import {
  resetInMemoryWebhookStore,
  seedInMemoryOrder,
  seedInMemoryPayment,
  seedInMemoryCase,
  getInMemoryPayment,
  getInMemoryOrder,
  getInMemoryCase,
  getInMemoryEvents
} from "../../src/services/webhook/webhookService.js";
import { AuditLog } from "../../src/models/AuditLog.js";

const TEST_WEBHOOK_SECRET = "test_webhook_secret_key_32_chars_ok!";

function signPayload(bodyStr, secret = TEST_WEBHOOK_SECRET) {
  return crypto.createHmac("sha256", secret).update(Buffer.from(bodyStr, "utf8")).digest("hex");
}

describe("Razorpay Webhook Ingestion, Deduplication, & Safety Suite", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
    resetInMemoryWebhookStore();

    // Pre-seed server records for deduplication test fixtures per Item b
    seedInMemoryPayment({
      gatewayPaymentId: "pay_dup_test_123",
      tenantId: "sh_merchant_alpha",
      amountPaise: 10000,
      currency: "INR",
      status: "CREATED"
    });
    seedInMemoryPayment({
      gatewayPaymentId: "pay_replay_diff_header",
      tenantId: "sh_merchant_beta",
      amountPaise: 15000,
      currency: "INR",
      status: "CREATED"
    });
    seedInMemoryPayment({
      gatewayPaymentId: "pay_legit_101",
      tenantId: "sh_merchant_gamma",
      amountPaise: 1000,
      currency: "INR",
      status: "CREATED"
    });
    seedInMemoryPayment({
      gatewayPaymentId: "pay_concurrent_99",
      tenantId: "sh_merchant_alpha",
      amountPaise: 7500,
      currency: "INR",
      status: "CREATED"
    });
    seedInMemoryPayment({
      gatewayPaymentId: "pay_no_header_id_1",
      tenantId: "sh_merchant_alpha",
      amountPaise: 4500,
      currency: "INR",
      status: "CREATED"
    });
    seedInMemoryPayment({
      gatewayPaymentId: "pay_older_retry_88",
      tenantId: "sh_merchant_alpha",
      amountPaise: 2500,
      currency: "INR",
      status: "CREATED"
    });
    seedInMemoryPayment({
      gatewayPaymentId: "pay_retry_historical",
      tenantId: "sh_merchant_alpha",
      amountPaise: 2000,
      currency: "INR",
      status: "CREATED"
    });
  });

  describe("1. Deduplication & Idempotency", () => {
    it("6. duplicate delivery with the same provider event ID does not create another accepted event", async () => {
      const eventId = "evt_rzp_dup_001";
      const paymentId = "pay_dup_test_123";
      const payloadObj = {
        entity: "event",
        account_id: "acc_merchant_alpha",
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: paymentId,
              amount: 10000,
              currency: "INR",
              notes: { tenantId: "sh_merchant_alpha" }
            }
          }
        }
      };

      const rawBody = JSON.stringify(payloadObj);
      const signature = signPayload(rawBody);

      // First delivery
      const res1 = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signature)
        .set("X-Razorpay-Event-Id", eventId)
        .send(rawBody);

      expect(res1.status).toBe(200);
      expect(res1.body.data.status).toBe("ACCEPTED");
      expect(res1.body.data.isDuplicate).toBe(false);
      const firstEventId = res1.body.data.eventId;

      // Second delivery (duplicate retry)
      const res2 = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signature)
        .set("X-Razorpay-Event-Id", eventId)
        .send(rawBody);

      expect(res2.status).toBe(200);
      expect(res2.body.data.status).toBe("DUPLICATE_ACKNOWLEDGED");
      expect(res2.body.data.isDuplicate).toBe(true);
      expect(res2.body.data.eventId).toBe(firstEventId);

      // Verify that only 1 event was recorded
      const events = getInMemoryEvents().filter((e) => e.sourceEventId === eventId);
      expect(events.length).toBe(1);
    });

    it("same body + same signature + changed event-ID header is recognized as duplicate via raw body hash", async () => {
      const paymentId = "pay_replay_diff_header";
      const payloadObj = {
        entity: "event",
        account_id: "acc_merchant_beta",
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: paymentId,
              amount: 15000,
              currency: "INR",
              notes: { tenantId: "sh_merchant_beta" }
            }
          }
        }
      };

      const rawBody = JSON.stringify(payloadObj);
      const signature = signPayload(rawBody);

      // Delivery 1 with event ID evt_orig_100
      const res1 = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signature)
        .set("X-Razorpay-Event-Id", "evt_orig_100")
        .send(rawBody);

      expect(res1.status).toBe(200);
      expect(res1.body.data.status).toBe("ACCEPTED");
      const originalEventId = res1.body.data.eventId;

      // Delivery 2 with identical body + identical signature BUT changed event ID header evt_replayed_200
      const res2 = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signature)
        .set("X-Razorpay-Event-Id", "evt_replayed_200")
        .send(rawBody);

      expect(res2.status).toBe(200);
      expect(res2.body.data.status).toBe("DUPLICATE_ACKNOWLEDGED");
      expect(res2.body.data.isDuplicate).toBe(true);
      expect(res2.body.data.eventId).toBe(originalEventId);

      // Only 1 event exists in store
      const events = getInMemoryEvents().filter((e) => e.gatewayPaymentId === paymentId);
      expect(events.length).toBe(1);
    });

    it("same event-ID + different signed body is quarantined (EVENT_ID_PAYLOAD_MISMATCH) and does not mutate state", async () => {
      const eventId = "evt_collision_tamper_01";
      const body1 = JSON.stringify({
        entity: "event",
        account_id: "acc_merchant_gamma",
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_legit_101",
              amount: 1000,
              currency: "INR",
              notes: { tenantId: "sh_merchant_gamma" }
            }
          }
        }
      });

      // 1. Initial valid ingestion
      const res1 = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signPayload(body1))
        .set("X-Razorpay-Event-Id", eventId)
        .send(body1);

      expect(res1.status).toBe(200);
      expect(res1.body.data.status).toBe("ACCEPTED");

      // 2. Anomaly: Same event ID arrives with a DIFFERENT payload
      const body2 = JSON.stringify({
        entity: "event",
        account_id: "acc_merchant_gamma",
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_spoofed_202",
              amount: 999999,
              currency: "INR",
              notes: { tenantId: "sh_merchant_gamma" }
            }
          }
        }
      });

      const res2 = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signPayload(body2))
        .set("X-Razorpay-Event-Id", eventId)
        .send(body2);

      expect(res2.status).toBe(200);
      expect(res2.body.data.status).toBe("QUARANTINED");
      expect(res2.body.data.reason).toBe("EVENT_ID_PAYLOAD_MISMATCH");

      // Verify that spoofed payment was NOT created
      expect(getInMemoryPayment("pay_spoofed_202")).toBeUndefined();
    });

    it("7. concurrent duplicate delivery remains idempotent", async () => {
      const eventId = "evt_rzp_concurrent_002";
      const rawBody = JSON.stringify({
        entity: "event",
        account_id: "acc_alpha",
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_concurrent_99",
              amount: 7500,
              currency: "INR",
              notes: { tenantId: "sh_merchant_alpha" }
            }
          }
        }
      });
      const signature = signPayload(rawBody);

      // Dispatch 3 concurrent requests simultaneously
      const [res1, res2, res3] = await Promise.all([
        request(app)
          .post("/api/webhooks/razorpay")
          .set("Content-Type", "application/json")
          .set("X-Razorpay-Signature", signature)
          .set("X-Razorpay-Event-Id", eventId)
          .send(rawBody),
        request(app)
          .post("/api/webhooks/razorpay")
          .set("Content-Type", "application/json")
          .set("X-Razorpay-Signature", signature)
          .set("X-Razorpay-Event-Id", eventId)
          .send(rawBody),
        request(app)
          .post("/api/webhooks/razorpay")
          .set("Content-Type", "application/json")
          .set("X-Razorpay-Signature", signature)
          .set("X-Razorpay-Event-Id", eventId)
          .send(rawBody)
      ]);

      // All 3 return 200 OK
      expect(res1.status).toBe(200);
      expect(res2.status).toBe(200);
      expect(res3.status).toBe(200);

      const statuses = [res1.body.data.status, res2.body.data.status, res3.body.data.status];
      expect(statuses.filter((s) => s === "ACCEPTED").length).toBe(1);
      expect(statuses.filter((s) => s === "DUPLICATE_ACKNOWLEDGED").length).toBe(2);

      const events = getInMemoryEvents().filter((e) => e.sourceEventId === eventId);
      expect(events.length).toBe(1);
    });

    it("13. missing provider event ID follows documented body hash fallback", async () => {
      const rawBody = JSON.stringify({
        entity: "event",
        account_id: "acc_alpha",
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_no_header_id_1",
              amount: 4500,
              currency: "INR",
              notes: { tenantId: "sh_merchant_alpha" }
            }
          }
        }
      });
      const signature = signPayload(rawBody);

      // Request WITHOUT X-Razorpay-Event-Id header
      const res1 = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signature)
        .send(rawBody);

      expect(res1.status).toBe(200);
      expect(res1.body.data.status).toBe("ACCEPTED");

      const events = getInMemoryEvents().filter((e) => e.gatewayPaymentId === "pay_no_header_id_1");
      expect(events.length).toBe(1);
      expect(events[0].sourceEventId).toMatch(/^fallback_/);
      expect(events[0].deduplicationKey).toMatch(/^RAZORPAY_FALLBACK:/);

      // Sending exact same body again without header is deduplicated by body hash
      const res2 = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signature)
        .send(rawBody);

      expect(res2.status).toBe(200);
      expect(res2.body.data.status).toBe("DUPLICATE_ACKNOWLEDGED");
      expect(res2.body.data.isDuplicate).toBe(true);
    });
  });

  describe("2. Out-of-Order Safety & Replay Safety", () => {
    it("9. out-of-order events cannot regress canonical GatewayPayment or PaymentCase state", async () => {
      const paymentId = "pay_ooo_101";
      const orderId = "order_ooo_101";
      const tenantId = "sh_merchant_alpha";

      // 1. Initial order and case in CAPTURED state
      seedInMemoryPayment({
        gatewayPaymentId: paymentId,
        tenantId,
        merchantOrderId: orderId,
        amountPaise: 12000,
        currency: "INR",
        status: "CAPTURED",
        method: "UPI"
      });

      seedInMemoryCase({
        caseId: "CASE-OOO-101",
        tenantId,
        merchantOrderId: orderId,
        gatewayPaymentId: paymentId,
        discrepancyCategory: "GENERAL_EXCEPTION",
        orderStatus: "ORDER_PAID",
        customerDebitStatus: "DEBIT_VERIFIED",
        authorizationStatus: "AUTH_AUTHORIZED",
        captureStatus: "CAPTURE_CAPTURED",
        settlementStatus: "SETTLEMENT_NONE",
        refundStatus: "REFUND_NONE",
        disputeStatus: "DISPUTE_NONE",
        resolutionCaseStatus: "CASE_DETECTED",
        expectedAmountPaise: 12000,
        actualAmountPaise: 12000,
        currency: "INR"
      });

      // 2. An older/delayed payment.authorized webhook arrives
      const olderAuthRaw = JSON.stringify({
        entity: "event",
        event: "payment.authorized",
        payload: {
          payment: {
            entity: {
              id: paymentId,
              order_id: orderId,
              amount: 12000,
              currency: "INR",
              notes: { tenantId }
            }
          }
        }
      });

      const resAuth = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signPayload(olderAuthRaw))
        .set("X-Razorpay-Event-Id", "evt_older_auth_01")
        .send(olderAuthRaw);

      expect(resAuth.status).toBe(200);

      // GatewayPayment must NOT have regressed to AUTHORIZED
      const paymentAfterAuth = getInMemoryPayment(paymentId);
      expect(paymentAfterAuth.status).toBe("CAPTURED");

      // PaymentCase captureStatus must NOT have regressed
      const caseAfterAuth = getInMemoryCase("CASE-OOO-101");
      expect(caseAfterAuth.captureStatus).toBe("CAPTURE_CAPTURED");

      // 3. A delayed payment.failed webhook arrives
      const olderFailedRaw = JSON.stringify({
        entity: "event",
        event: "payment.failed",
        payload: {
          payment: {
            entity: {
              id: paymentId,
              order_id: orderId,
              amount: 12000,
              currency: "INR",
              notes: { tenantId }
            }
          }
        }
      });

      const resFailed = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signPayload(olderFailedRaw))
        .set("X-Razorpay-Event-Id", "evt_older_fail_02")
        .send(olderFailedRaw);

      expect(resFailed.status).toBe(200);

      // Still remains CAPTURED
      const paymentAfterFail = getInMemoryPayment(paymentId);
      expect(paymentAfterFail.status).toBe("CAPTURED");

      const caseAfterFail = getInMemoryCase("CASE-OOO-101");
      expect(caseAfterFail.captureStatus).toBe("CAPTURE_CAPTURED");
    });

    it("10. older but valid provider retries are accepted without assuming nonexistent timestamp headers", async () => {
      const rawBody = JSON.stringify({
        entity: "event",
        event: "payment.captured",
        created_at: 1672531200, // 2023-01-01
        payload: {
          payment: {
            entity: {
              id: "pay_retry_historical",
              amount: 2000,
              currency: "INR",
              notes: { tenantId: "sh_merchant_alpha" }
            }
          }
        }
      });

      const res = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signPayload(rawBody))
        .set("X-Razorpay-Event-Id", "evt_retry_historical_01")
        .send(rawBody);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("ACCEPTED");

      const events = getInMemoryEvents().filter((e) => e.sourceEventId === "evt_retry_historical_01");
      expect(events.length).toBe(1);
      expect(events[0].providerOccurredAt).toEqual(new Date(1672531200 * 1000));
      expect(events[0].ingestedAt).toBeDefined();
    });

    it("captured event associated with an order previously marked CANCELLED remains CANCELLED and is flagged for safe handling", async () => {
      const orderId = "order_cancelled_999";
      const paymentId = "pay_late_on_cancelled";
      const tenantId = "sh_merchant_alpha";

      // Seed CANCELLED merchant order
      seedInMemoryOrder({
        merchantOrderId: orderId,
        tenantId,
        amountPaise: 8000,
        currency: "INR",
        status: "CANCELLED"
      });

      // Seed PaymentCase for the cancelled order
      seedInMemoryCase({
        caseId: "CASE-CANCELLED-999",
        tenantId,
        merchantOrderId: orderId,
        gatewayPaymentId: null,
        orderStatus: "ORDER_CANCELLED",
        captureStatus: "CAPTURE_NONE",
        resolutionCaseStatus: "CASE_DETECTED"
      });

      // Valid signed payment.captured arrives for this cancelled order
      const rawBody = JSON.stringify({
        entity: "event",
        account_id: "acc_alpha",
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: paymentId,
              order_id: orderId,
              amount: 8000,
              currency: "INR",
              notes: { tenantId }
            }
          }
        }
      });

      const res = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signPayload(rawBody))
        .set("X-Razorpay-Event-Id", "evt_late_capture_cancelled")
        .send(rawBody);

      expect(res.status).toBe(200);
      expect(res.body.data.conflictFlag).toBe("CANCELLED_ORDER_CAPTURED");

      // Invariant 1: MerchantOrder must NOT have been reversed or reopened
      const orderAfter = getInMemoryOrder(orderId);
      expect(orderAfter.status).toBe("CANCELLED");

      // Invariant 2: GatewayPayment records accurate provider truth (funds were captured)
      const paymentAfter = getInMemoryPayment(paymentId);
      expect(paymentAfter.status).toBe("CAPTURED");

      // Invariant 3: PaymentCase is flagged for safe hold and manual investigation
      const caseAfter = getInMemoryCase("CASE-CANCELLED-999");
      expect(caseAfter.orderStatus).toBe("ORDER_CANCELLED");
      expect(caseAfter.captureStatus).toBe("CAPTURE_CAPTURED");
      expect(caseAfter.discrepancyCategory).toBe("CANCELLED_ORDER_CAPTURED");
      expect(caseAfter.safeHoldCode).toBe("LATE_CAPTURE_CANCELLED_ORDER");
      expect(caseAfter.resolutionCaseStatus).toBe("CASE_SAFE_HOLD");

      // Invariant 4: Durable event ledger preserves the capture evidence
      const events = getInMemoryEvents().filter((e) => e.gatewayPaymentId === paymentId);
      expect(events.length).toBe(1);
      expect(events[0].normalizedEventType).toBe("PAYMENT_CAPTURED");
      expect(events[0].provenance.conflictFlag).toBe("CANCELLED_ORDER_CAPTURED");
    });

    it("late capture for a different payment attempt belonging to the same order preserves both attempts", async () => {
      const orderId = "order_multi_attempt_555";
      const attempt1PayId = "pay_attempt_1_failed";
      const attempt2PayId = "pay_attempt_2_captured";
      const tenantId = "sh_merchant_alpha";

      // Seed order
      seedInMemoryOrder({
        merchantOrderId: orderId,
        tenantId,
        amountPaise: 15000,
        currency: "INR",
        status: "CREATED"
      });

      // Seed Attempt 1: Failed payment
      seedInMemoryPayment({
        gatewayPaymentId: attempt1PayId,
        merchantOrderId: orderId,
        tenantId,
        amountPaise: 15000,
        currency: "INR",
        status: "FAILED"
      });

      seedInMemoryCase({
        caseId: "CASE-MULTI-555",
        tenantId,
        merchantOrderId: orderId,
        gatewayPaymentId: attempt1PayId,
        captureStatus: "CAPTURE_FAILED",
        resolutionCaseStatus: "CASE_DETECTED"
      });

      // Customer makes Attempt 2: payment.captured arrives
      const rawBody = JSON.stringify({
        entity: "event",
        account_id: "acc_alpha",
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: attempt2PayId,
              order_id: orderId,
              amount: 15000,
              currency: "INR",
              notes: { tenantId }
            }
          }
        }
      });

      const res = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signPayload(rawBody))
        .set("X-Razorpay-Event-Id", "evt_attempt_2_success")
        .send(rawBody);

      expect(res.status).toBe(200);

      // Attempt 1 remains FAILED
      const attempt1After = getInMemoryPayment(attempt1PayId);
      expect(attempt1After.status).toBe("FAILED");

      // Attempt 2 is CAPTURED
      const attempt2After = getInMemoryPayment(attempt2PayId);
      expect(attempt2After.status).toBe("CAPTURED");

      // Case captureStatus updates to CAPTURED
      const caseAfter = getInMemoryCase("CASE-MULTI-555");
      expect(caseAfter.captureStatus).toBe("CAPTURE_CAPTURED");
    });

    it("conflicting late capture for an already-failed payment entity transitions payment safely and flags case for review", async () => {
      const paymentId = "pay_async_upi_late_capture";
      const orderId = "order_async_upi_777";
      const tenantId = "sh_merchant_alpha";

      // Seed payment initially as FAILED
      seedInMemoryPayment({
        gatewayPaymentId: paymentId,
        merchantOrderId: orderId,
        tenantId,
        amountPaise: 5000,
        currency: "INR",
        status: "FAILED"
      });

      seedInMemoryCase({
        caseId: "CASE-LATE-777",
        tenantId,
        merchantOrderId: orderId,
        gatewayPaymentId: paymentId,
        captureStatus: "CAPTURE_FAILED",
        resolutionCaseStatus: "CASE_DETECTED"
      });

      // Bank confirms late capture via Razorpay webhook
      const rawBody = JSON.stringify({
        entity: "event",
        account_id: "acc_alpha",
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: paymentId,
              order_id: orderId,
              amount: 5000,
              currency: "INR",
              notes: { tenantId }
            }
          }
        }
      });

      const res = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signPayload(rawBody))
        .set("X-Razorpay-Event-Id", "evt_bank_late_capture")
        .send(rawBody);

      expect(res.status).toBe(200);
      expect(res.body.data.conflictFlag).toBe("LATE_CAPTURE_AFTER_FAILURE");

      // GatewayPayment accurately transitions to CAPTURED with late capture flag
      const paymentAfter = getInMemoryPayment(paymentId);
      expect(paymentAfter.status).toBe("CAPTURED");
      expect(paymentAfter.isLateCapture).toBe(true);
      expect(paymentAfter.previousStatus).toBe("FAILED");

      // PaymentCase flags discrepancy for review
      const caseAfter = getInMemoryCase("CASE-LATE-777");
      expect(caseAfter.captureStatus).toBe("CAPTURE_CAPTURED");
      expect(caseAfter.discrepancyCategory).toBe("STATUS_MISMATCH");
      expect(caseAfter.safeHoldCode).toBe("LATE_CAPTURE_AFTER_FAILURE");
      expect(caseAfter.resolutionCaseStatus).toBe("CASE_SAFE_HOLD");
    });
  });

  describe("3. Handling Unknown, Malformed & Unmatched Events", () => {
    it("11. validly signed but unknown event types are quarantined without mutating payment state", async () => {
      const rawBody = JSON.stringify({
        entity: "event",
        event: "subscription.charged", // Unsupported / unknown event type
        payload: {
          subscription: {
            entity: {
              id: "sub_12345",
              amount: 99900
            }
          }
        }
      });

      const res = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signPayload(rawBody))
        .set("X-Razorpay-Event-Id", "evt_unknown_type_99")
        .send(rawBody);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("QUARANTINED_UNSUPPORTED_EVENT_TYPE");

      const events = getInMemoryEvents().filter((e) => e.sourceEventId === "evt_unknown_type_99");
      expect(events.length).toBe(1);
      expect(events[0].normalizedEventType).toBe("WEBHOOK_RECEIVED");
      expect(events[0].provenance.processingStatus).toBe("QUARANTINED_UNSUPPORTED_EVENT_TYPE");

      // No payment was created in store
      expect(getInMemoryPayment("sub_12345")).toBeUndefined();
    });

    it("12. malformed signed payload envelope is rejected with 400 Bad Request", async () => {
      const rawBody = JSON.stringify({
        entity: "event"
        // missing "event"
      });

      const res = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signPayload(rawBody))
        .send(rawBody);

      expect(res.status).toBe(400);
      expect(res.body.error.message).toMatch(/malformed webhook payload/i);
    });

    it("14. unmatched events are durably recorded under quarantine without guessing a payment match", async () => {
      const rawBody = JSON.stringify({
        entity: "event",
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_unknown_orphan_99",
              amount: 5000,
              currency: "INR"
              // No notes.tenantId and no matching local order
            }
          }
        }
      });

      const res = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signPayload(rawBody))
        .set("X-Razorpay-Event-Id", "evt_orphan_01")
        .send(rawBody);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("QUARANTINED_UNRESOLVED_TENANT");

      const events = getInMemoryEvents().filter((e) => e.sourceEventId === "evt_orphan_01");
      expect(events.length).toBe(1);
      expect(events[0].tenantId).toBe("unassigned_provider_quarantine");
      expect(events[0].provenance.processingStatus).toBe("QUARANTINED_UNRESOLVED_TENANT");
    });

    it("15. cross-tenant or ambiguous correlation does not mutate another tenant's records", async () => {
      // Merchant A owns order_alpha_99
      seedInMemoryOrder({
        merchantOrderId: "order_alpha_99",
        tenantId: "sh_merchant_alpha",
        amountPaise: 5000,
        currency: "INR",
        status: "CREATED"
      });

      // Attacker sends webhook with notes claiming sh_merchant_attacker for order_alpha_99
      const rawBody = JSON.stringify({
        entity: "event",
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_spoofed_01",
              order_id: "order_alpha_99",
              amount: 5000,
              currency: "INR",
              notes: { tenantId: "sh_merchant_attacker" }
            }
          }
        }
      });

      const res = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signPayload(rawBody))
        .set("X-Razorpay-Event-Id", "evt_cross_tenant_spoof")
        .send(rawBody);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("QUARANTINED");
      expect(res.body.data.reason).toBe("CROSS_TENANT_MISMATCH");

      // Merchant A's order must NOT be mutated
      const orderAfter = getInMemoryOrder("order_alpha_99");
      if (orderAfter) {
        expect(orderAfter.status).toBe("CREATED");
      }
    });
  });

  describe("4. Invariant Protection & Non-Interference", () => {
    it("17. rejected events do not alter PaymentCase or PaymentAction ledgers", async () => {
      seedInMemoryCase({
        caseId: "CASE-STABLE-001",
        tenantId: "sh_merchant_alpha",
        merchantOrderId: "order_stable_001",
        gatewayPaymentId: "pay_stable_001",
        discrepancyCategory: "GENERAL_EXCEPTION",
        orderStatus: "ORDER_PENDING",
        customerDebitStatus: "UNKNOWN",
        authorizationStatus: "AUTH_NONE",
        captureStatus: "CAPTURE_NONE",
        settlementStatus: "UNKNOWN",
        refundStatus: "UNKNOWN",
        disputeStatus: "UNKNOWN",
        resolutionCaseStatus: "CASE_DETECTED",
        expectedAmountPaise: 1000,
        currency: "INR"
      });

      const badSig = "0".repeat(64);
      const rawBody = JSON.stringify({
        entity: "event",
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_stable_001",
              order_id: "order_stable_001",
              amount: 1000
            }
          }
        }
      });

      // Rejected webhook due to invalid signature
      const res = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", badSig)
        .send(rawBody);

      expect(res.status).toBe(401);

      // Verify PaymentCase was untouched
      const c = getInMemoryCase("CASE-STABLE-001");
      expect(c.captureStatus).toBe("CAPTURE_NONE");
      expect(c.orderStatus).toBe("ORDER_PENDING");
    });
  });

  describe("5. ITEM b — Webhook Tenant from Server-Side Mapping Only", () => {
    it("forged notes tenant for a mapped payment is quarantined with CROSS_TENANT_MISMATCH", async () => {
      seedInMemoryPayment({
        gatewayPaymentId: "pay_b_forged",
        tenantId: "tenant_real",
        amountPaise: 5000,
        currency: "INR",
        status: "CREATED"
      });

      const rawBody = JSON.stringify({
        entity: "event",
        account_id: "acc_rzp",
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_b_forged",
              amount: 5000,
              currency: "INR",
              notes: { tenantId: "tenant_forged_attacker" }
            }
          }
        }
      });

      const res = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signPayload(rawBody))
        .set("X-Razorpay-Event-Id", "evt_b_forged_01")
        .send(rawBody);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("QUARANTINED");
      expect(res.body.data.reason).toBe("CROSS_TENANT_MISMATCH");

      const paymentInStore = getInMemoryPayment("pay_b_forged");
      expect(paymentInStore.status).toBe("CREATED");
    });

    it("unmapped payment is quarantined with UNMAPPED_TENANT (no payment or case created)", async () => {
      const rawBody = JSON.stringify({
        entity: "event",
        account_id: "acc_rzp",
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_b_unmapped",
              amount: 5000,
              currency: "INR",
              notes: { tenantId: "tenant_claimed_only" }
            }
          }
        }
      });

      const res = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signPayload(rawBody))
        .set("X-Razorpay-Event-Id", "evt_b_unmapped_01")
        .send(rawBody);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("QUARANTINED_UNRESOLVED_TENANT");
      expect(res.body.data.reason).toBe("UNMAPPED_TENANT");

      expect(getInMemoryPayment("pay_b_unmapped")).toBeUndefined();
    });

    it("notes absent resolves tenant cleanly from server mapping and mutates state", async () => {
      seedInMemoryPayment({
        gatewayPaymentId: "pay_b_no_notes",
        tenantId: "tenant_real",
        amountPaise: 5000,
        currency: "INR",
        status: "CREATED"
      });

      const rawBody = JSON.stringify({
        entity: "event",
        account_id: "acc_rzp",
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_b_no_notes",
              amount: 5000,
              currency: "INR"
            }
          }
        }
      });

      const res = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signPayload(rawBody))
        .set("X-Razorpay-Event-Id", "evt_b_no_notes_01")
        .send(rawBody);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("ACCEPTED");

      const paymentInStore = getInMemoryPayment("pay_b_no_notes");
      expect(paymentInStore.status).toBe("CAPTURED");
      expect(paymentInStore.tenantId).toBe("tenant_real");
    });

    it("two tenants with colliding order references are quarantined with COLLIDING_ORDER_REFERENCES", async () => {
      seedInMemoryOrder({
        merchantOrderId: "order_b_colliding",
        tenantId: "tenant_alpha"
      });
      // In-memory store array simulation for collision
      const memOrdersMap = [
        { merchantOrderId: "order_b_colliding", tenantId: "tenant_alpha" },
        { merchantOrderId: "order_b_colliding", tenantId: "tenant_beta" }
      ];
      seedInMemoryPayment({
        gatewayPaymentId: "pay_b_colliding",
        merchantOrderId: "order_b_colliding",
        tenantId: "tenant_alpha",
        status: "CREATED"
      });
      // Cross-record collision between payment tenant and order tenant
      seedInMemoryOrder({
        merchantOrderId: "order_b_colliding",
        tenantId: "tenant_beta"
      });

      const rawBody = JSON.stringify({
        entity: "event",
        account_id: "acc_rzp",
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_b_colliding",
              order_id: "order_b_colliding",
              amount: 5000,
              currency: "INR"
            }
          }
        }
      });

      const res = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signPayload(rawBody))
        .set("X-Razorpay-Event-Id", "evt_b_collide_01")
        .send(rawBody);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("QUARANTINED_UNRESOLVED_TENANT");
      expect(res.body.data.reason).toBe("COLLIDING_ORDER_REFERENCES");
    });
  });

  describe("6. ITEM d — Order Events by Provider Timestamp & Refund Ordering", () => {
    it("older same-rank event after newer is dropped with STALE_EVENT_DROPPED without mutating payment", async () => {
      seedInMemoryPayment({
        gatewayPaymentId: "pay_d_older",
        tenantId: "tenant_d",
        amountPaise: 5000,
        currency: "INR",
        status: "CAPTURED",
        lastProviderEventAt: new Date(1700000100 * 1000)
      });

      const rawBody = JSON.stringify({
        entity: "event",
        account_id: "acc_rzp",
        event: "payment.captured",
        created_at: 1700000050, // Older than 1700000100
        payload: {
          payment: {
            entity: {
              id: "pay_d_older",
              amount: 5000,
              currency: "INR"
            }
          }
        }
      });

      const res = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signPayload(rawBody))
        .set("X-Razorpay-Event-Id", "evt_d_older_01")
        .send(rawBody);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("STALE_EVENT_DROPPED");

      const paymentInStore = getInMemoryPayment("pay_d_older");
      expect(paymentInStore.lastProviderEventAt).toEqual(new Date(1700000100 * 1000));
    });

    it("equal provider timestamp same-rank event is dropped with STALE_EVENT_DROPPED", async () => {
      seedInMemoryPayment({
        gatewayPaymentId: "pay_d_equal",
        tenantId: "tenant_d",
        amountPaise: 5000,
        currency: "INR",
        status: "CAPTURED",
        lastProviderEventAt: new Date(1700000100 * 1000)
      });

      const rawBody = JSON.stringify({
        entity: "event",
        account_id: "acc_rzp",
        event: "payment.captured",
        created_at: 1700000100, // Equal timestamp
        payload: {
          payment: {
            entity: {
              id: "pay_d_equal",
              amount: 5000,
              currency: "INR"
            }
          }
        }
      });

      const res = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signPayload(rawBody))
        .set("X-Razorpay-Event-Id", "evt_d_equal_01")
        .send(rawBody);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("STALE_EVENT_DROPPED");
    });

    it("refund created arriving after processed is dropped and does not overwrite terminal processed status", async () => {
      seedInMemoryPayment({
        gatewayPaymentId: "pay_d_ref_proc",
        tenantId: "tenant_d",
        amountPaise: 5000,
        currency: "INR",
        status: "CAPTURED",
        refundStatus: "processed",
        lastProviderEventAt: new Date(1700000100 * 1000)
      });

      const rawBody = JSON.stringify({
        entity: "event",
        account_id: "acc_rzp",
        event: "refund.created",
        created_at: 1700000200,
        payload: {
          payment: {
            entity: {
              id: "pay_d_ref_proc",
              amount: 5000,
              currency: "INR"
            }
          },
          refund: {
            entity: {
              id: "rfnd_001",
              status: "created"
            }
          }
        }
      });

      const res = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signPayload(rawBody))
        .set("X-Razorpay-Event-Id", "evt_d_ref_created_late")
        .send(rawBody);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("STALE_EVENT_DROPPED");

      const paymentInStore = getInMemoryPayment("pay_d_ref_proc");
      expect(paymentInStore.refundStatus).toBe("processed");
    });

    it("refund failed arriving after processed is dropped and never overwrites terminal processed refund", async () => {
      seedInMemoryPayment({
        gatewayPaymentId: "pay_d_ref_term",
        tenantId: "tenant_d",
        amountPaise: 5000,
        currency: "INR",
        status: "CAPTURED",
        refundStatus: "processed",
        lastProviderEventAt: new Date(1700000100 * 1000)
      });

      const rawBody = JSON.stringify({
        entity: "event",
        account_id: "acc_rzp",
        event: "refund.failed",
        created_at: 1700000200,
        payload: {
          payment: {
            entity: {
              id: "pay_d_ref_term",
              amount: 5000,
              currency: "INR"
            }
          },
          refund: {
            entity: {
              id: "rfnd_002",
              status: "failed"
            }
          }
        }
      });

      const res = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signPayload(rawBody))
        .set("X-Razorpay-Event-Id", "evt_d_ref_failed_late")
        .send(rawBody);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe("STALE_EVENT_DROPPED");

      const paymentInStore = getInMemoryPayment("pay_d_ref_term");
      expect(paymentInStore.refundStatus).toBe("processed");
    });
  });

  describe("7. ITEM g — PAID Only After Amount and Currency Match", () => {
    it("exact match mutates order to PAID and sets case to ORDER_PAID", async () => {
      seedInMemoryOrder({
        merchantOrderId: "order_g_exact",
        tenantId: "tenant_g",
        amountPaise: 50000,
        currency: "INR",
        status: "CREATED"
      });
      seedInMemoryCase({
        caseId: "CASE_G_EXACT",
        tenantId: "tenant_g",
        merchantOrderId: "order_g_exact",
        gatewayPaymentId: "pay_g_exact",
        captureStatus: "CAPTURE_NONE",
        resolutionCaseStatus: "CASE_DETECTED"
      });

      const rawBody = JSON.stringify({
        entity: "event",
        account_id: "acc_rzp",
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_g_exact",
              order_id: "order_g_exact",
              amount: 50000,
              amount_captured: 50000,
              currency: "INR"
            }
          }
        }
      });

      const res = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signPayload(rawBody))
        .set("X-Razorpay-Event-Id", "evt_g_exact_01")
        .send(rawBody);

      expect(res.status).toBe(200);

      const orderAfter = getInMemoryOrder("order_g_exact");
      expect(orderAfter.status).toBe("PAID");

      const caseAfter = getInMemoryCase("CASE_G_EXACT");
      expect(caseAfter.orderStatus).toBe("ORDER_PAID");
      expect(caseAfter.resolutionCaseStatus).not.toBe("CASE_SAFE_HOLD");
    });

    it("1 paise off does NOT mutate order, safe-holds case with AMOUNT_CURRENCY_MISMATCH", async () => {
      seedInMemoryOrder({
        merchantOrderId: "order_g_1off",
        tenantId: "tenant_g",
        amountPaise: 50000,
        currency: "INR",
        status: "CREATED"
      });
      seedInMemoryCase({
        caseId: "CASE_G_1OFF",
        tenantId: "tenant_g",
        merchantOrderId: "order_g_1off",
        gatewayPaymentId: "pay_g_1off",
        captureStatus: "CAPTURE_NONE",
        resolutionCaseStatus: "CASE_DETECTED"
      });

      const rawBody = JSON.stringify({
        entity: "event",
        account_id: "acc_rzp",
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_g_1off",
              order_id: "order_g_1off",
              amount: 50001,
              amount_captured: 50001, // 1 paise off
              currency: "INR"
            }
          }
        }
      });

      const res = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signPayload(rawBody))
        .set("X-Razorpay-Event-Id", "evt_g_1off_01")
        .send(rawBody);

      expect(res.status).toBe(200);

      const orderAfter = getInMemoryOrder("order_g_1off");
      expect(orderAfter.status).toBe("CREATED"); // Unmutated!

      const caseAfter = getInMemoryCase("CASE_G_1OFF");
      expect(caseAfter.resolutionCaseStatus).toBe("CASE_SAFE_HOLD");
      expect(caseAfter.safeHoldCode).toBe("AMOUNT_CURRENCY_MISMATCH");
    });

    it("currency mismatch does NOT mutate order, safe-holds case with AMOUNT_CURRENCY_MISMATCH", async () => {
      seedInMemoryOrder({
        merchantOrderId: "order_g_curr",
        tenantId: "tenant_g",
        amountPaise: 50000,
        currency: "INR",
        status: "CREATED"
      });
      seedInMemoryCase({
        caseId: "CASE_G_CURR",
        tenantId: "tenant_g",
        merchantOrderId: "order_g_curr",
        gatewayPaymentId: "pay_g_curr",
        captureStatus: "CAPTURE_NONE",
        resolutionCaseStatus: "CASE_DETECTED"
      });

      const rawBody = JSON.stringify({
        entity: "event",
        account_id: "acc_rzp",
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_g_curr",
              order_id: "order_g_curr",
              amount: 50000,
              amount_captured: 50000,
              currency: "USD" // Currency mismatch!
            }
          }
        }
      });

      const res = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signPayload(rawBody))
        .set("X-Razorpay-Event-Id", "evt_g_curr_01")
        .send(rawBody);

      expect(res.status).toBe(200);

      const orderAfter = getInMemoryOrder("order_g_curr");
      expect(orderAfter.status).toBe("CREATED"); // Unmutated!

      const caseAfter = getInMemoryCase("CASE_G_CURR");
      expect(caseAfter.resolutionCaseStatus).toBe("CASE_SAFE_HOLD");
      expect(caseAfter.safeHoldCode).toBe("AMOUNT_CURRENCY_MISMATCH");
    });

    it("missing captured amount does NOT mutate order, safe-holds case with INSUFFICIENT_EVIDENCE", async () => {
      seedInMemoryOrder({
        merchantOrderId: "order_g_missing",
        tenantId: "tenant_g",
        amountPaise: 50000,
        currency: "INR",
        status: "CREATED"
      });
      seedInMemoryCase({
        caseId: "CASE_G_MISSING",
        tenantId: "tenant_g",
        merchantOrderId: "order_g_missing",
        gatewayPaymentId: "pay_g_missing",
        captureStatus: "CAPTURE_NONE",
        resolutionCaseStatus: "CASE_DETECTED"
      });

      const rawBody = JSON.stringify({
        entity: "event",
        account_id: "acc_rzp",
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_g_missing",
              order_id: "order_g_missing",
              amount: 50000,
              // amount_captured intentionally absent: nominal amount must not be assumed!
              currency: "INR"
            }
          }
        }
      });

      const res = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signPayload(rawBody))
        .set("X-Razorpay-Event-Id", "evt_g_missing_01")
        .send(rawBody);

      expect(res.status).toBe(200);

      const orderAfter = getInMemoryOrder("order_g_missing");
      expect(orderAfter.status).toBe("CREATED"); // Unmutated!

      const caseAfter = getInMemoryCase("CASE_G_MISSING");
      expect(caseAfter.resolutionCaseStatus).toBe("CASE_SAFE_HOLD");
      expect(caseAfter.safeHoldCode).toBe("INSUFFICIENT_EVIDENCE");
    });

    it("partial capture does NOT mark order PAID, safe-holds case with AMOUNT_CURRENCY_MISMATCH", async () => {
      seedInMemoryOrder({
        merchantOrderId: "order_g_partial",
        tenantId: "tenant_g",
        amountPaise: 50000,
        currency: "INR",
        status: "CREATED"
      });
      seedInMemoryCase({
        caseId: "CASE_G_PARTIAL",
        tenantId: "tenant_g",
        merchantOrderId: "order_g_partial",
        gatewayPaymentId: "pay_g_partial",
        captureStatus: "CAPTURE_NONE",
        resolutionCaseStatus: "CASE_DETECTED"
      });

      const rawBody = JSON.stringify({
        entity: "event",
        account_id: "acc_rzp",
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_g_partial",
              order_id: "order_g_partial",
              amount: 50000,
              amount_captured: 30000, // Partial capture!
              currency: "INR"
            }
          }
        }
      });

      const res = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signPayload(rawBody))
        .set("X-Razorpay-Event-Id", "evt_g_partial_01")
        .send(rawBody);

      expect(res.status).toBe(200);

      const orderAfter = getInMemoryOrder("order_g_partial");
      expect(orderAfter.status).toBe("CREATED"); // Unmutated!

      const caseAfter = getInMemoryCase("CASE_G_PARTIAL");
      expect(caseAfter.resolutionCaseStatus).toBe("CASE_SAFE_HOLD");
      expect(caseAfter.safeHoldCode).toBe("AMOUNT_CURRENCY_MISMATCH");
    });
  });
});
