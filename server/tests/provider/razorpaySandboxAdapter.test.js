import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  checkSandboxWriteGate,
  isSandboxWriteEnabled,
  executeSandboxRefund,
  verifySandboxRefundStatus,
  verifyPaymentStatus,
  sanitizeProviderPayload,
  SandboxGateClosedError
} from "../../src/services/razorpay/razorpaySandboxAdapter.js";

describe("Razorpay Sandbox Provider Adapter", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.RAZORPAY_MODE = "test";
    process.env.RAZORPAY_KEY_ID = "rzp_test_mockKeyId12345";
    process.env.RAZORPAY_KEY_SECRET = "mockKeySecret67890";
    process.env.RAZORPAY_SANDBOX_WRITES_ENABLED = "true";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("1. Strict Sandbox-Only Write Gate Checks", () => {
    it("fails closed when RAZORPAY_SANDBOX_WRITES_ENABLED is false", () => {
      process.env.RAZORPAY_SANDBOX_WRITES_ENABLED = "false";
      expect(() => checkSandboxWriteGate()).toThrow(SandboxGateClosedError);
      expect(isSandboxWriteEnabled()).toBe(false);
    });

    it("fails closed when RAZORPAY_SANDBOX_WRITES_ENABLED is undefined", () => {
      delete process.env.RAZORPAY_SANDBOX_WRITES_ENABLED;
      expect(() => checkSandboxWriteGate()).toThrow(SandboxGateClosedError);
      expect(isSandboxWriteEnabled()).toBe(false);
    });

    it("fails closed when RAZORPAY_MODE is live", () => {
      process.env.RAZORPAY_MODE = "live";
      expect(() => checkSandboxWriteGate()).toThrow(/Live provider mutations are strictly prohibited/);
      expect(isSandboxWriteEnabled()).toBe(false);
    });

    it("fails closed when RAZORPAY_KEY_ID starts with rzp_live_", () => {
      process.env.RAZORPAY_KEY_ID = "rzp_live_secretProdKey999";
      expect(() => checkSandboxWriteGate()).toThrow(/does not match test prefix 'rzp_test_'/);
      expect(isSandboxWriteEnabled()).toBe(false);
    });

    it("fails closed when RAZORPAY_KEY_ID is missing or arbitrary string", () => {
      process.env.RAZORPAY_KEY_ID = "arbitrary_custom_key";
      expect(() => checkSandboxWriteGate()).toThrow(/does not match test prefix 'rzp_test_'/);
      expect(isSandboxWriteEnabled()).toBe(false);
    });

    it("opens gate only when test mode, test key prefix, and writes explicitly enabled", () => {
      expect(checkSandboxWriteGate()).toBe(true);
      expect(isSandboxWriteEnabled()).toBe(true);
    });
  });

  describe("2. executeSandboxRefund Input Invariants & Dispatch Safety", () => {
    it("fails closed if gate is closed before dispatch", async () => {
      process.env.RAZORPAY_SANDBOX_WRITES_ENABLED = "false";
      await expect(
        executeSandboxRefund({
          gatewayPaymentId: "pay_test_001",
          amountPaise: 10000
        })
      ).rejects.toThrow(SandboxGateClosedError);
    });

    it("rejects invalid, zero, or negative amountPaise", async () => {
      await expect(
        executeSandboxRefund({
          gatewayPaymentId: "pay_test_001",
          amountPaise: 0
        })
      ).rejects.toThrow(/positive safe integer/);

      await expect(
        executeSandboxRefund({
          gatewayPaymentId: "pay_test_001",
          amountPaise: -500
        })
      ).rejects.toThrow(/positive safe integer/);

      await expect(
        executeSandboxRefund({
          gatewayPaymentId: "pay_test_001",
          amountPaise: "100.50"
        })
      ).rejects.toThrow(/positive safe integer/);
    });

    it("rejects empty or invalid gatewayPaymentId", async () => {
      await expect(
        executeSandboxRefund({
          gatewayPaymentId: "",
          amountPaise: 10000
        })
      ).rejects.toThrow(/gatewayPaymentId is required/);
    });

    it("sanitizes customer PII from notes prior to dispatch and makes mocked call (zero real network I/O)", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          id: "rfnd_test_refund_123",
          entity: "refund",
          amount: 15000,
          currency: "INR",
          payment_id: "pay_test_001",
          status: "processed",
          notes: {
            reconaiCaseId: "CASE-001"
          }
        })
      });

      const result = await executeSandboxRefund({
        gatewayPaymentId: "pay_test_001",
        amountPaise: 15000,
        notes: {
          reconaiCaseId: "CASE-001",
          email: "customer@example.com",
          phone: "+919876543210",
          contact: "+919876543210",
          address: "123 Main St"
        },
        customFetch: mockFetch
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callArgs = mockFetch.mock.calls[0];
      expect(callArgs[0]).toContain("/v1/payments/pay_test_001/refund");
      expect(callArgs[1].method).toBe("POST");

      // Verify dispatched body had PII stripped
      const dispatchedBody = JSON.parse(callArgs[1].body);
      expect(dispatchedBody.amount).toBe(15000);
      expect(dispatchedBody.notes.email).toBeUndefined();
      expect(dispatchedBody.notes.phone).toBeUndefined();
      expect(dispatchedBody.notes.contact).toBeUndefined();
      expect(dispatchedBody.notes.address).toBeUndefined();
      expect(dispatchedBody.notes.reconaiCaseId).toBe("CASE-001");

      // Verify returned result
      expect(result.providerRefundId).toBe("rfnd_test_refund_123");
      expect(result.providerPaymentId).toBe("pay_test_001");
      expect(result.amountPaise).toBe(15000);
      expect(result.providerStatus).toBe("processed");
    });

    it("sends X-Refund-Idempotency header when providerIdempotencyKey is passed", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          id: "rfnd_test_idem_header",
          payment_id: "pay_test_001",
          amount: 15000,
          currency: "INR",
          status: "processed"
        })
      });

      await executeSandboxRefund({
        gatewayPaymentId: "pay_test_001",
        amountPaise: 15000,
        providerIdempotencyKey: "OP-20261012-ABCDEF12",
        customFetch: mockFetch
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const callHeaders = mockFetch.mock.calls[0][1].headers;
      expect(callHeaders["X-Refund-Idempotency"]).toBe("OP-20261012-ABCDEF12");
    });
  });

  describe("3. Authoritative Read Verification (verifySandboxRefundStatus)", () => {
    it("classifies processed refund matching all identity fields as VERIFIED_SUCCEEDED", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          id: "rfnd_test_100",
          payment_id: "pay_test_001",
          amount: 5000,
          currency: "INR",
          status: "processed"
        })
      });

      const result = await verifySandboxRefundStatus({
        gatewayPaymentId: "pay_test_001",
        refundId: "rfnd_test_100",
        expectedAmountPaise: 5000,
        expectedCurrency: "INR",
        customFetch: mockFetch
      });

      expect(result.verified).toBe(true);
      expect(result.outcome).toBe("VERIFIED_SUCCEEDED");
      expect(result.status).toBe("PROCESSED");
      expect(result.amountPaise).toBe(5000);
      expect(result.currency).toBe("INR");
    });

    it("classifies failed refund matching identities as VERIFIED_FAILED", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          id: "rfnd_test_101",
          payment_id: "pay_test_001",
          amount: 5000,
          currency: "INR",
          status: "failed",
          error_description: "Card issuing bank declined refund"
        })
      });

      const result = await verifySandboxRefundStatus({
        gatewayPaymentId: "pay_test_001",
        refundId: "rfnd_test_101",
        expectedAmountPaise: 5000,
        expectedCurrency: "INR",
        customFetch: mockFetch
      });

      expect(result.verified).toBe(true);
      expect(result.outcome).toBe("VERIFIED_FAILED");
      expect(result.status).toBe("FAILED");
      expect(result.failureReason).toBe("Card issuing bank declined refund");
    });

    it("rejects verification with SAFE_HOLD when provider returns wrong refund ID", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          id: "rfnd_wrong_id_999",
          payment_id: "pay_test_001",
          amount: 5000,
          currency: "INR",
          status: "processed"
        })
      });

      const result = await verifySandboxRefundStatus({
        gatewayPaymentId: "pay_test_001",
        refundId: "rfnd_expected_id_100",
        expectedAmountPaise: 5000,
        customFetch: mockFetch
      });

      expect(result.verified).toBe(false);
      expect(result.outcome).toBe("SAFE_HOLD");
      expect(result.status).toBe("REFUND_ID_MISMATCH");
      expect(result.safeHoldReason).toContain("does not match expected");
    });

    it("rejects verification with SAFE_HOLD when provider returns wrong payment ID", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          id: "rfnd_test_100",
          payment_id: "pay_other_payment_999",
          amount: 5000,
          currency: "INR",
          status: "processed"
        })
      });

      const result = await verifySandboxRefundStatus({
        gatewayPaymentId: "pay_test_001",
        refundId: "rfnd_test_100",
        expectedAmountPaise: 5000,
        customFetch: mockFetch
      });

      expect(result.verified).toBe(false);
      expect(result.outcome).toBe("SAFE_HOLD");
      expect(result.status).toBe("PAYMENT_ID_MISMATCH");
    });

    it("rejects verification with SAFE_HOLD when provider returns wrong amount", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          id: "rfnd_test_100",
          payment_id: "pay_test_001",
          amount: 99999, // Mismatched amount
          currency: "INR",
          status: "processed"
        })
      });

      const result = await verifySandboxRefundStatus({
        gatewayPaymentId: "pay_test_001",
        refundId: "rfnd_test_100",
        expectedAmountPaise: 5000,
        customFetch: mockFetch
      });

      expect(result.verified).toBe(false);
      expect(result.outcome).toBe("SAFE_HOLD");
      expect(result.status).toBe("AMOUNT_MISMATCH");
    });

    it("rejects verification with SAFE_HOLD when provider returns wrong currency", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          id: "rfnd_test_100",
          payment_id: "pay_test_001",
          amount: 5000,
          currency: "USD",
          status: "processed"
        })
      });

      const result = await verifySandboxRefundStatus({
        gatewayPaymentId: "pay_test_001",
        refundId: "rfnd_test_100",
        expectedAmountPaise: 5000,
        expectedCurrency: "INR",
        customFetch: mockFetch
      });

      expect(result.verified).toBe(false);
      expect(result.outcome).toBe("SAFE_HOLD");
      expect(result.status).toBe("CURRENCY_MISMATCH");
    });

    it("rejects verification with SAFE_HOLD when provider response is missing identity fields (id, payment_id, amount)", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          entity: "refund",
          status: "processed"
          // missing id, payment_id, amount
        })
      });

      const result = await verifySandboxRefundStatus({
        gatewayPaymentId: "pay_test_001",
        refundId: "rfnd_test_100",
        customFetch: mockFetch
      });

      expect(result.verified).toBe(false);
      expect(result.outcome).toBe("SAFE_HOLD");
      expect(result.status).toBe("PROVIDER_PAYLOAD_INCOMPLETE");
    });

    it("rejects verification with SAFE_HOLD when provider returns unexpected refund status", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          id: "rfnd_test_100",
          payment_id: "pay_test_001",
          amount: 5000,
          currency: "INR",
          status: "unsupported_custom_state"
        })
      });

      const result = await verifySandboxRefundStatus({
        gatewayPaymentId: "pay_test_001",
        refundId: "rfnd_test_100",
        expectedAmountPaise: 5000,
        customFetch: mockFetch
      });

      expect(result.verified).toBe(false);
      expect(result.outcome).toBe("SAFE_HOLD");
      expect(result.status).toBe("UNEXPECTED_PROVIDER_STATUS");
    });

    it("rejects failure verification with SAFE_HOLD when status is failed but payment ID does not match (contradictory evidence)", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          id: "rfnd_test_101",
          payment_id: "pay_wrong_payment", // Mismatched payment ID
          amount: 5000,
          currency: "INR",
          status: "failed"
        })
      });

      const result = await verifySandboxRefundStatus({
        gatewayPaymentId: "pay_test_001",
        refundId: "rfnd_test_101",
        customFetch: mockFetch
      });

      expect(result.verified).toBe(false);
      expect(result.outcome).toBe("SAFE_HOLD");
      expect(result.status).toBe("PAYMENT_ID_MISMATCH");
    });

    it("classifies pending refund as OUTCOME_UNKNOWN", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          id: "rfnd_test_102",
          payment_id: "pay_test_001",
          amount: 5000,
          currency: "INR",
          status: "pending"
        })
      });

      const result = await verifySandboxRefundStatus({
        gatewayPaymentId: "pay_test_001",
        refundId: "rfnd_test_102",
        expectedAmountPaise: 5000,
        customFetch: mockFetch
      });

      expect(result.verified).toBe(false);
      expect(result.outcome).toBe("OUTCOME_UNKNOWN");
      expect(result.status).toBe("PENDING");
    });

    it("classifies read timeout or network failure as OUTCOME_UNKNOWN", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("ETIMEDOUT connecting to provider"));

      const result = await verifySandboxRefundStatus({
        gatewayPaymentId: "pay_test_001",
        refundId: "rfnd_test_103",
        customFetch: mockFetch
      });

      expect(result.verified).toBe(false);
      expect(result.outcome).toBe("OUTCOME_UNKNOWN");
      expect(result.status).toBe("READ_FAILED_OR_TIMEOUT");
    });
  });

  describe("4. Secret and PII Redaction Integrity", () => {
    it("sanitizeProviderPayload strips credentials, tokens, and PII", () => {
      const raw = {
        id: "rfnd_test_1",
        entity: "refund",
        amount: 10000,
        key_secret: "super-secret-key",
        secret: "another-secret",
        authorization: "Basic dXNyOnB3ZA==",
        email: "alice@example.com",
        contact: "+919876543210",
        vpa: "alice@upi",
        card_id: "card_123",
        token_id: "tok_456",
        notes: {
          reconCaseId: "CASE-01",
          email: "alice@example.com",
          address: "456 Private Way"
        }
      };

      const sanitized = sanitizeProviderPayload(raw);
      expect(sanitized.key_secret).toBeUndefined();
      expect(sanitized.secret).toBeUndefined();
      expect(sanitized.authorization).toBeUndefined();
      expect(sanitized.email).toBeUndefined();
      expect(sanitized.contact).toBeUndefined();
      expect(sanitized.vpa).toBeUndefined();
      expect(sanitized.card_id).toBeUndefined();
      expect(sanitized.token_id).toBeUndefined();
      expect(sanitized.notes.email).toBeUndefined();
      expect(sanitized.notes.address).toBeUndefined();
      expect(sanitized.notes.reconCaseId).toBe("CASE-01");
      expect(sanitized.amount).toBe(10000);
    });
  });
});
