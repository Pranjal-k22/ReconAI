import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import crypto from "crypto";
import app from "../../src/app.js";
import { verifyRazorpaySignature } from "../../src/services/webhook/webhookService.js";

const TEST_WEBHOOK_SECRET = "test_webhook_secret_key_32_chars_ok!";

function generateSignature(body, secret = TEST_WEBHOOK_SECRET) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === "string" ? body : JSON.stringify(body), "utf8");
  return crypto.createHmac("sha256", secret).update(buf).digest("hex");
}

describe("Razorpay Webhook Signature Verification Suite", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    process.env.RAZORPAY_WEBHOOK_SECRET = TEST_WEBHOOK_SECRET;
  });

  describe("1. Raw Byte Signature Computation & Constant-Time Validation", () => {
    it("1. accepts a valid HMAC-SHA256 signature calculated against exact raw bytes", () => {
      const payloadString = JSON.stringify({
        entity: "event",
        event: "payment.captured",
        payload: { payment: { entity: { id: "pay_test_001", amount: 5000 } } }
      });
      const validSig = generateSignature(payloadString, TEST_WEBHOOK_SECRET);

      const isValid = verifyRazorpaySignature(payloadString, validSig, TEST_WEBHOOK_SECRET);
      expect(isValid).toBe(true);
    });

    it("2. rejects tampered payload body when signature does not match altered bytes", () => {
      const originalPayload = JSON.stringify({
        entity: "event",
        event: "payment.captured",
        payload: { payment: { entity: { id: "pay_test_001", amount: 5000 } } }
      });
      const signatureForOriginal = generateSignature(originalPayload, TEST_WEBHOOK_SECRET);

      // Attacker changes amount from 5000 to 999999
      const tamperedPayload = JSON.stringify({
        entity: "event",
        event: "payment.captured",
        payload: { payment: { entity: { id: "pay_test_001", amount: 999999 } } }
      });

      const isValid = verifyRazorpaySignature(tamperedPayload, signatureForOriginal, TEST_WEBHOOK_SECRET);
      expect(isValid).toBe(false);
    });

    it("3. rejects missing, malformed, or incorrect length signature", () => {
      const body = '{"entity":"event","event":"payment.captured"}';

      // Missing
      expect(verifyRazorpaySignature(body, null, TEST_WEBHOOK_SECRET)).toBe(false);
      expect(verifyRazorpaySignature(body, "", TEST_WEBHOOK_SECRET)).toBe(false);

      // Malformed length (63 or 65 chars instead of 64)
      expect(verifyRazorpaySignature(body, "a".repeat(63), TEST_WEBHOOK_SECRET)).toBe(false);
      expect(verifyRazorpaySignature(body, "a".repeat(65), TEST_WEBHOOK_SECRET)).toBe(false);

      // Non-hex characters
      expect(verifyRazorpaySignature(body, "z".repeat(64), TEST_WEBHOOK_SECRET)).toBe(false);

      // Wrong signature value
      const wrongSig = "0".repeat(64);
      expect(verifyRazorpaySignature(body, wrongSig, TEST_WEBHOOK_SECRET)).toBe(false);
    });

    it("4. fails closed when webhook secret is missing or empty", () => {
      const body = '{"entity":"event"}';
      const sig = "a".repeat(64);

      // Missing secret must throw error failing closed
      expect(() => verifyRazorpaySignature(body, sig, null)).toThrow(/webhook secret is not configured/i);
      expect(() => verifyRazorpaySignature(body, sig, "")).toThrow(/webhook secret is not configured/i);
      expect(() => verifyRazorpaySignature(body, sig, "   ")).toThrow(/webhook secret is not configured/i);
    });

    it("5. confirms JSON whitespace and formatting alterations invalidate signature", () => {
      // Body formatted without spaces
      const compactBody = '{"entity":"event","event":"payment.captured"}';
      const signatureForCompact = generateSignature(compactBody, TEST_WEBHOOK_SECRET);

      // Body formatted with extra spaces / indentation
      const prettyBody = '{\n  "entity": "event",\n  "event": "payment.captured"\n}';

      // Comparing prettyBody with signature of compactBody must fail
      const isValid = verifyRazorpaySignature(prettyBody, signatureForCompact, TEST_WEBHOOK_SECRET);
      expect(isValid).toBe(false);
    });
  });

  describe("2. Route Ingress Signature Enforcement (POST /api/webhooks/razorpay)", () => {
    it("POST /api/webhooks/razorpay rejects request with missing X-Razorpay-Signature (401)", async () => {
      const res = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ entity: "event", event: "payment.captured" }));

      expect(res.status).toBe(401);
      expect(res.body.error.message).toMatch(/missing x-razorpay-signature/i);
    });

    it("POST /api/webhooks/razorpay rejects request with invalid signature (401)", async () => {
      const rawPayload = JSON.stringify({ entity: "event", event: "payment.captured" });
      const badSig = "f".repeat(64);

      const res = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", badSig)
        .send(rawPayload);

      expect(res.status).toBe(401);
      expect(res.body.error.message).toMatch(/invalid webhook signature/i);
    });

    it("POST /api/webhooks/razorpay fails closed with 500 when secret is unconfigured", async () => {
      delete process.env.RAZORPAY_WEBHOOK_SECRET;

      const rawPayload = JSON.stringify({ entity: "event", event: "payment.captured" });
      const sig = "f".repeat(64);

      const res = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", sig)
        .send(rawPayload);

      expect([500, 503]).toContain(res.status);
    });

    it("POST /api/webhooks/razorpay rejects oversized body (> 1MB) with 413", async () => {
      // 1.5MB body
      const hugeData = "x".repeat(1.5 * 1024 * 1024);
      const hugePayload = JSON.stringify({ entity: "event", data: hugeData });
      const sig = generateSignature(hugePayload, TEST_WEBHOOK_SECRET);

      const res = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", sig)
        .send(hugePayload);

      expect(res.status).toBe(413);
    });

    it("invalid signature cannot reserve deduplication key or poison legitimate later ingestion", async () => {
      const eventId = "evt_poison_attempt_01";
      const validPayload = JSON.stringify({
        entity: "event",
        account_id: "acc_test_poison",
        event: "payment.captured",
        payload: {
          payment: {
            entity: {
              id: "pay_poison_01",
              amount: 5000,
              currency: "INR",
              notes: { tenantId: "sh_poison_test" }
            }
          }
        }
      });
      const validSig = generateSignature(validPayload, TEST_WEBHOOK_SECRET);
      const badSig = "0".repeat(64);

      // 1. Attacker attempts to poison event ID with an invalid signature
      const res1 = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", badSig)
        .set("X-Razorpay-Event-Id", eventId)
        .send(validPayload);

      expect(res1.status).toBe(401);

      // 2. Legitimate provider delivers same event ID with valid signature
      const res2 = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", validSig)
        .set("X-Razorpay-Event-Id", eventId)
        .send(validPayload);

      expect(res2.status).toBe(200);
      expect(res2.body.data.status).toBe("ACCEPTED");
      expect(res2.body.data.isDuplicate).toBe(false);
    });
  });
});
