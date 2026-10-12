import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  verifySandboxRefundStatus,
  executeSandboxRefund
} from "../../src/services/razorpay/razorpaySandboxAdapter.js";
import {
  dispatchSandboxAction,
  computeDispatchPayloadHash
} from "../../src/services/policy/providerDispatchService.js";
import { ProviderOperation } from "../../src/models/ProviderOperation.js";
import { PaymentCase } from "../../src/models/PaymentCase.js";
import { GatewayPayment } from "../../src/models/GatewayPayment.js";
import { MerchantOrder } from "../../src/models/MerchantOrder.js";

describe("Independent Provider Outcome Verification Semantics", () => {
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

  describe("1. Acceptance Response Alone is Not Proof of Completion", () => {
    it("POST returning 200 with status 'pending' is NOT verified success; independent read returns OUTCOME_UNKNOWN", async () => {
      // 1. Dispatch POST returns accepted response
      const postFetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          id: "rfnd_post_accepted_01",
          entity: "refund",
          amount: 25000,
          currency: "INR",
          payment_id: "pay_test_001",
          status: "pending"
        })
      });

      const postResult = await executeSandboxRefund({
        gatewayPaymentId: "pay_test_001",
        amountPaise: 25000,
        customFetch: postFetch
      });

      expect(postResult.providerStatus).toBe("pending");

      // 2. Authoritative GET read
      const getFetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          id: "rfnd_post_accepted_01",
          payment_id: "pay_test_001",
          amount: 25000,
          currency: "INR",
          status: "pending"
        })
      });

      const verifyResult = await verifySandboxRefundStatus({
        gatewayPaymentId: "pay_test_001",
        refundId: postResult.providerRefundId,
        customFetch: getFetch
      });

      // Must NOT be verified succeeded!
      expect(verifyResult.verified).toBe(false);
      expect(verifyResult.outcome).toBe("OUTCOME_UNKNOWN");
      expect(verifyResult.status).toBe("PENDING");
    });

    it("Subsequent authoritative GET returning 'processed' confirms VERIFIED_SUCCEEDED", async () => {
      const getFetch = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          id: "rfnd_post_accepted_01",
          payment_id: "pay_test_001",
          amount: 25000,
          currency: "INR",
          status: "processed"
        })
      });

      const verifyResult = await verifySandboxRefundStatus({
        gatewayPaymentId: "pay_test_001",
        refundId: "rfnd_post_accepted_01",
        customFetch: getFetch
      });

      expect(verifyResult.verified).toBe(true);
      expect(verifyResult.outcome).toBe("VERIFIED_SUCCEEDED");
      expect(verifyResult.status).toBe("PROCESSED");
    });
  });

  describe("2. Timeout, Interruption, and Ambiguity Handling", () => {
    it("Timeout during verification read produces OUTCOME_UNKNOWN without failing operation", async () => {
      const timeoutFetch = vi.fn().mockRejectedValue(new Error("Request timeout after 10000ms"));

      const verifyResult = await verifySandboxRefundStatus({
        gatewayPaymentId: "pay_test_001",
        refundId: "rfnd_timeout_01",
        customFetch: timeoutFetch
      });

      expect(verifyResult.verified).toBe(false);
      expect(verifyResult.outcome).toBe("OUTCOME_UNKNOWN");
      expect(verifyResult.status).toBe("READ_FAILED_OR_TIMEOUT");
    });

    it("Missing refund identifier or payment ID returns OUTCOME_UNKNOWN", async () => {
      const verifyResult = await verifySandboxRefundStatus({
        gatewayPaymentId: "",
        refundId: "rfnd_missing_01"
      });

      expect(verifyResult.verified).toBe(false);
      expect(verifyResult.outcome).toBe("OUTCOME_UNKNOWN");
      expect(verifyResult.status).toBe("MISSING_IDENTIFIERS");
    });
  });

  describe("3. Dispatch Payload Hash & Idempotency Key Semantics", () => {
    it("generates deterministic hash for identical dispatch payloads", () => {
      const hash1 = computeDispatchPayloadHash({
        tenantId: "sh_alpha",
        caseId: "CASE-01",
        gatewayPaymentId: "pay_01",
        amountPaise: 12000,
        currency: "INR",
        proposedActionType: "REQUEST_REFUND"
      });

      const hash2 = computeDispatchPayloadHash({
        tenantId: "sh_alpha",
        caseId: "CASE-01",
        gatewayPaymentId: "pay_01",
        amountPaise: 12000,
        currency: "INR",
        proposedActionType: "REQUEST_REFUND"
      });

      expect(hash1).toBe(hash2);
    });

    it("generates different hash when amount or payment differs", () => {
      const hash1 = computeDispatchPayloadHash({
        tenantId: "sh_alpha",
        caseId: "CASE-01",
        gatewayPaymentId: "pay_01",
        amountPaise: 12000,
        currency: "INR",
        proposedActionType: "REQUEST_REFUND"
      });

      const hash2 = computeDispatchPayloadHash({
        tenantId: "sh_alpha",
        caseId: "CASE-01",
        gatewayPaymentId: "pay_01",
        amountPaise: 15000,
        currency: "INR",
        proposedActionType: "REQUEST_REFUND"
      });

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("4. HTTP 200 Acceptance Rejection & Conservative Conflict Handling", () => {
    it("HTTP 200 with wrong payment ID or amount must NEVER produce VERIFIED_SUCCEEDED; fails to SAFE_HOLD", async () => {
      const getFetchWrongPayment = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          id: "rfnd_test_ok_01",
          payment_id: "pay_unrelated_foreign_payment",
          amount: 25000,
          currency: "INR",
          status: "processed"
        })
      });

      const resPaymentMismatch = await verifySandboxRefundStatus({
        gatewayPaymentId: "pay_test_001",
        refundId: "rfnd_test_ok_01",
        expectedAmountPaise: 25000,
        customFetch: getFetchWrongPayment
      });

      expect(resPaymentMismatch.verified).toBe(false);
      expect(resPaymentMismatch.outcome).toBe("SAFE_HOLD");
      expect(resPaymentMismatch.status).toBe("PAYMENT_ID_MISMATCH");

      const getFetchWrongAmount = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          id: "rfnd_test_ok_01",
          payment_id: "pay_test_001",
          amount: 99999,
          currency: "INR",
          status: "processed"
        })
      });

      const resAmountMismatch = await verifySandboxRefundStatus({
        gatewayPaymentId: "pay_test_001",
        refundId: "rfnd_test_ok_01",
        expectedAmountPaise: 25000,
        customFetch: getFetchWrongAmount
      });

      expect(resAmountMismatch.verified).toBe(false);
      expect(resAmountMismatch.outcome).toBe("SAFE_HOLD");
      expect(resAmountMismatch.status).toBe("AMOUNT_MISMATCH");
    });

    it("HTTP 200 with missing required fields fails to SAFE_HOLD", async () => {
      const getFetchMissing = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          status: "processed"
          // missing id, payment_id, amount
        })
      });

      const resMissing = await verifySandboxRefundStatus({
        gatewayPaymentId: "pay_test_001",
        refundId: "rfnd_test_ok_01",
        expectedAmountPaise: 25000,
        customFetch: getFetchMissing
      });

      expect(resMissing.verified).toBe(false);
      expect(resMissing.outcome).toBe("SAFE_HOLD");
      expect(resMissing.status).toBe("PROVIDER_PAYLOAD_INCOMPLETE");
    });

    it("HTTP 200 with unexpected status fails to SAFE_HOLD", async () => {
      const getFetchUnexpected = vi.fn().mockResolvedValue({
        status: 200,
        ok: true,
        json: async () => ({
          id: "rfnd_test_ok_01",
          payment_id: "pay_test_001",
          amount: 25000,
          currency: "INR",
          status: "unknown_custom_provider_state"
        })
      });

      const resUnexpected = await verifySandboxRefundStatus({
        gatewayPaymentId: "pay_test_001",
        refundId: "rfnd_test_ok_01",
        expectedAmountPaise: 25000,
        customFetch: getFetchUnexpected
      });

      expect(resUnexpected.verified).toBe(false);
      expect(resUnexpected.outcome).toBe("SAFE_HOLD");
      expect(resUnexpected.status).toBe("UNEXPECTED_PROVIDER_STATUS");
    });
  });
});
