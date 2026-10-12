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
});
