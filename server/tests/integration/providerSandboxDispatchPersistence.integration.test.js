import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import { ProviderOperation } from "../../src/models/ProviderOperation.js";
import { PaymentCase } from "../../src/models/PaymentCase.js";
import { GatewayPayment } from "../../src/models/GatewayPayment.js";
import { MerchantOrder } from "../../src/models/MerchantOrder.js";
import { PaymentAction } from "../../src/models/PaymentAction.js";
import {
  dispatchSandboxAction,
  recheckProviderOperationStatus,
  getProviderOperationsByCaseId
} from "../../src/services/policy/providerDispatchService.js";
import { RazorpayProviderError, RAZORPAY_ERROR_CODES } from "../../src/services/razorpay/razorpayClient.js";

function validateTestDatabaseUri(uri) {
  if (!uri || typeof uri !== "string") {
    throw new Error("MONGODB_TEST_URI must be provided as a non-empty string");
  }
  let dbName = "";
  try {
    const url = new URL(uri.replace(/^mongodb(\+srv)?:\/\//, "http://"));
    dbName = url.pathname.replace(/^\//, "");
  } catch {
    const match = uri.match(/\/([^/?]+)(\?|$)/);
    if (match) dbName = match[1];
  }
  if (!dbName || !dbName.toLowerCase().includes("test")) {
    throw new Error("Test database name must contain 'test'");
  }
  return uri;
}

const DEFAULT_TEST_URI = "mongodb://127.0.0.1:27017/reconai_test_provider_dispatch";
const TEST_DB_URI = validateTestDatabaseUri(process.env.MONGODB_TEST_URI || DEFAULT_TEST_URI);

describe("Sandbox Provider Adapter & Verified Outcome Handling - MongoDB Integration", { timeout: 35000 }, () => {
  const TENANT_A = "tenant_prov_int_alpha";
  const TENANT_B = "tenant_prov_int_beta";
  const CASE_ID_A = "CASE-PROV-INT-001";
  const CASE_ID_B = "CASE-PROV-INT-002";
  const CASE_ID_22 = "CASE-PROV-INT-022";

  const approvedPolicyConfig = {
    maxSingleRefundPaise: 500000,
    maxCumulativeRefundPaise: 2000000,
    currentCumulativeDailyPaise: 0
  };

  const originalEnv = { ...process.env };

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 5000 });
    await ProviderOperation.syncIndexes();
    await PaymentCase.syncIndexes();
    await GatewayPayment.syncIndexes();
    await MerchantOrder.syncIndexes();
    await PaymentAction.syncIndexes();
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.db.dropDatabase().catch(() => {});
      await mongoose.disconnect();
    }
    process.env = { ...originalEnv };
  });

  beforeEach(async () => {
    process.env = { ...originalEnv };
    process.env.RAZORPAY_MODE = "test";
    process.env.RAZORPAY_KEY_ID = "rzp_test_intKey12345";
    process.env.RAZORPAY_KEY_SECRET = "intSecret67890";
    process.env.RAZORPAY_SANDBOX_WRITES_ENABLED = "true";

    await ProviderOperation.deleteMany({});
    await PaymentCase.deleteMany({});
    await GatewayPayment.deleteMany({});
    await MerchantOrder.deleteMany({});
    await PaymentAction.deleteMany({});

    // Seed Standard Test Case
    await PaymentCase.create({
      caseId: CASE_ID_A,
      tenantId: TENANT_A,
      merchantOrderId: "ORD-PROV-001",
      gatewayPaymentId: "pay_test_prov_001",
      orderStatus: "ORDER_PENDING",
      paymentStatus: "CAPTURED",
      discrepancyCategory: "STATUS_MISMATCH",
      resolutionCaseStatus: "CASE_INVESTIGATING",
      currency: "INR"
    });

    await GatewayPayment.create({
      gatewayPaymentId: "pay_test_prov_001",
      tenantId: TENANT_A,
      merchantOrderId: "ORD-PROV-001",
      amountPaise: 12000,
      currency: "INR",
      status: "CAPTURED",
      method: "UPI",
      source: "RAZORPAY",
      importBatchId: "BATCH-01",
      gatewayCreatedAt: new Date()
    });

    await MerchantOrder.create({
      merchantOrderId: "ORD-PROV-001",
      tenantId: TENANT_A,
      amountPaise: 12000,
      currency: "INR",
      status: "PENDING",
      orderCreatedAt: new Date()
    });

    // Seed Case 22: Late Capture on Cancelled Order
    await PaymentCase.create({
      caseId: CASE_ID_22,
      tenantId: TENANT_A,
      merchantOrderId: "ORD-PROV-022",
      gatewayPaymentId: "pay_test_prov_022",
      orderStatus: "ORDER_CANCELLED",
      paymentStatus: "CAPTURED",
      discrepancyCategory: "STATUS_MISMATCH",
      resolutionCaseStatus: "CASE_SAFE_HOLD",
      isSafeHold: true,
      safeHoldCode: "LATE_CAPTURE_CANCELLED_ORDER",
      currency: "INR"
    });

    await GatewayPayment.create({
      gatewayPaymentId: "pay_test_prov_022",
      tenantId: TENANT_A,
      merchantOrderId: "ORD-PROV-022",
      amountPaise: 15000,
      currency: "INR",
      status: "CAPTURED",
      method: "CARD",
      source: "RAZORPAY",
      importBatchId: "BATCH-01",
      gatewayCreatedAt: new Date()
    });

    await MerchantOrder.create({
      merchantOrderId: "ORD-PROV-022",
      tenantId: TENANT_A,
      amountPaise: 15000,
      currency: "INR",
      status: "CANCELLED",
      orderCreatedAt: new Date()
    });
  });

  describe("1. Fail-Closed Safety: Missing Refund Limits & Case 22", () => {
    it("fails closed before any provider call when server-side policyConfig is null (missing limits)", async () => {
      const mockFetch = vi.fn();

      const result = await dispatchSandboxAction({
        tenantId: TENANT_A,
        caseId: CASE_ID_A,
        actorId: "admin-1",
        actorRole: "ADMIN",
        proposedActionType: "REQUEST_REFUND",
        idempotencyKey: "idem-missing-limits-01",
        policyConfig: null, // missing limits
        customFetch: mockFetch
      });

      expect(result.dispatchBlocked).toBe(true);
      expect(result.policyOutcomeStatus).toBe("INSUFFICIENT_EVIDENCE");
      expect(result.appliedRuleIds).toContain("R_REFUND_LIMITS_MISSING_FAIL_CLOSED");

      // Verify ZERO provider operations were persisted or dispatched
      expect(mockFetch).not.toHaveBeenCalled();
      const count = await ProviderOperation.countDocuments();
      expect(count).toBe(0);
    });

    it("fails closed before any provider call on Case 22 (late capture on cancelled order unconditionally held)", async () => {
      const mockFetch = vi.fn();

      const result = await dispatchSandboxAction({
        tenantId: TENANT_A,
        caseId: CASE_ID_22,
        actorId: "admin-1",
        actorRole: "ADMIN",
        proposedActionType: "REQUEST_REFUND",
        idempotencyKey: "idem-case22-hold-01",
        policyConfig: approvedPolicyConfig, // even with limits, Case 22 is strictly locked
        customFetch: mockFetch
      });

      expect(result.dispatchBlocked).toBe(true);
      expect(result.policyOutcomeStatus).toBe("SAFE_HOLD");
      expect(result.appliedRuleIds).toContain("R_LATE_CAPTURE_CANCELLED_ORDER_HOLD");

      // Verify ZERO provider operations were dispatched
      expect(mockFetch).not.toHaveBeenCalled();
      const count = await ProviderOperation.countDocuments();
      expect(count).toBe(0);
    });

    it("fails closed before any provider call when sandbox write gate is disabled", async () => {
      process.env.RAZORPAY_SANDBOX_WRITES_ENABLED = "false";
      const mockFetch = vi.fn();

      await expect(
        dispatchSandboxAction({
          tenantId: TENANT_A,
          caseId: CASE_ID_A,
          actorId: "admin-1",
          actorRole: "ADMIN",
          proposedActionType: "REQUEST_REFUND",
          idempotencyKey: "idem-gate-disabled-01",
          policyConfig: approvedPolicyConfig,
          customFetch: mockFetch
        })
      ).rejects.toThrow(/Sandbox write gate closed/);

      expect(mockFetch).not.toHaveBeenCalled();
      const count = await ProviderOperation.countDocuments();
      expect(count).toBe(0);
    });
  });

  describe("2. End-to-End Sandbox Dispatch & Independent Read Verification", () => {
    it("dispatches POST, verifies via authoritative GET, and persists VERIFIED_SUCCEEDED in MongoDB", async () => {
      const mockFetch = vi.fn()
        // 1. POST refund creation accepted
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => ({
            id: "rfnd_int_test_999",
            entity: "refund",
            amount: 12000,
            currency: "INR",
            payment_id: "pay_test_prov_001",
            status: "pending"
          })
        })
        // 2. Authoritative GET refund read returns processed
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => ({
            id: "rfnd_int_test_999",
            entity: "refund",
            amount: 12000,
            currency: "INR",
            payment_id: "pay_test_prov_001",
            status: "processed"
          })
        });

      const result = await dispatchSandboxAction({
        tenantId: TENANT_A,
        caseId: CASE_ID_A,
        actorId: "admin-1",
        actorRole: "ADMIN",
        proposedActionType: "REQUEST_REFUND",
        idempotencyKey: "idem-success-e2e-01",
        policyConfig: approvedPolicyConfig,
        customFetch: mockFetch
      });

      expect(result.dispatchBlocked).toBe(false);
      expect(result.isDuplicate).toBe(false);
      expect(result.operation.operationStatus).toBe("VERIFIED_SUCCEEDED");
      expect(result.operation.providerOperationId).toBe("rfnd_int_test_999");
      expect(result.operation.verificationStatus).toBe("PROCESSED");

      // Verify persisted in real MongoDB
      const persisted = await ProviderOperation.findOne({
        tenantId: TENANT_A,
        idempotencyKey: "idem-success-e2e-01"
      }).lean();

      expect(persisted).toBeDefined();
      expect(persisted.operationStatus).toBe("VERIFIED_SUCCEEDED");
      expect(persisted.providerOperationId).toBe("rfnd_int_test_999");
      expect(persisted.amountPaise).toBe(12000);
      expect(persisted.currency).toBe("INR");
      expect(persisted.verifiedAt).toBeDefined();
    });

    it("POST timeout transitions operation to OUTCOME_UNKNOWN without failing or retrying", async () => {
      const mockFetch = vi.fn().mockRejectedValue(
        new RazorpayProviderError(
          RAZORPAY_ERROR_CODES.TIMEOUT,
          "Razorpay API request timed out after 10000ms"
        )
      );

      const result = await dispatchSandboxAction({
        tenantId: TENANT_A,
        caseId: CASE_ID_A,
        actorId: "admin-1",
        actorRole: "ADMIN",
        proposedActionType: "REQUEST_REFUND",
        idempotencyKey: "idem-timeout-01",
        policyConfig: approvedPolicyConfig,
        customFetch: mockFetch
      });

      expect(result.dispatchBlocked).toBe(false);
      expect(result.operation.operationStatus).toBe("OUTCOME_UNKNOWN");

      // Confirm MongoDB state is OUTCOME_UNKNOWN (not failed!)
      const persisted = await ProviderOperation.findOne({
        tenantId: TENANT_A,
        idempotencyKey: "idem-timeout-01"
      }).lean();

      expect(persisted.operationStatus).toBe("OUTCOME_UNKNOWN");
      expect(persisted.failureReason).toContain("timed out");
    });
  });

  describe("3. Idempotency & Concurrency Guarantees", () => {
    it("replaying with identical idempotencyKey returns existing operation without duplicate provider call", async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => ({
            id: "rfnd_idem_01",
            payment_id: "pay_test_prov_001",
            amount: 12000,
            currency: "INR",
            status: "processed"
          })
        })
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => ({
            id: "rfnd_idem_01",
            payment_id: "pay_test_prov_001",
            amount: 12000,
            currency: "INR",
            status: "processed"
          })
        });

      // First call
      const res1 = await dispatchSandboxAction({
        tenantId: TENANT_A,
        caseId: CASE_ID_A,
        actorId: "admin-1",
        actorRole: "ADMIN",
        proposedActionType: "REQUEST_REFUND",
        idempotencyKey: "idem-replay-01",
        policyConfig: approvedPolicyConfig,
        customFetch: mockFetch
      });

      expect(res1.isDuplicate).toBe(false);
      expect(res1.operation.operationStatus).toBe("VERIFIED_SUCCEEDED");
      expect(mockFetch).toHaveBeenCalledTimes(2); // 1 POST + 1 GET

      // Second replay call
      const res2 = await dispatchSandboxAction({
        tenantId: TENANT_A,
        caseId: CASE_ID_A,
        actorId: "admin-1",
        actorRole: "ADMIN",
        proposedActionType: "REQUEST_REFUND",
        idempotencyKey: "idem-replay-01",
        policyConfig: approvedPolicyConfig,
        customFetch: mockFetch
      });

      expect(res2.isDuplicate).toBe(true);
      expect(res2.operation.operationId).toBe(res1.operation.operationId);
      // Confirm NO additional network calls were made on replay
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("replaying with conflicting parameters on same idempotencyKey throws 409 conflict", async () => {
      await ProviderOperation.create({
        operationId: "OP-CONFLICT-01",
        tenantId: TENANT_A,
        caseId: CASE_ID_A,
        idempotencyKey: "idem-conflict-key",
        operationType: "REFUND",
        operationStatus: "REQUESTED",
        gatewayPaymentId: "pay_test_prov_001",
        amountPaise: 12000,
        currency: "INR",
        requestPayloadHash: "hash-original"
      });

      await expect(
        dispatchSandboxAction({
          tenantId: TENANT_A,
          caseId: CASE_ID_A,
          actorId: "admin-1",
          actorRole: "ADMIN",
          proposedActionType: "REQUEST_REFUND",
          amountPaise: 5000, // conflicting amount
          idempotencyKey: "idem-conflict-key",
          policyConfig: approvedPolicyConfig
        })
      ).rejects.toThrow(/already used with conflicting parameters/);
    });
  });

  describe("4. Tenant Isolation & Redaction in Real MongoDB", () => {
    it("blocks cross-tenant dispatch when case belongs to another tenant", async () => {
      await expect(
        dispatchSandboxAction({
          tenantId: TENANT_B, // tenant B trying to dispatch on tenant A's case
          caseId: CASE_ID_A,
          actorId: "admin-1",
          actorRole: "ADMIN",
          proposedActionType: "REQUEST_REFUND",
          idempotencyKey: "idem-cross-tenant-01",
          policyConfig: approvedPolicyConfig
        })
      ).rejects.toThrow(/not found for tenant/);
    });

    it("redacts credentials and customer PII before saving to MongoDB", async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => ({
            id: "rfnd_redact_01",
            payment_id: "pay_test_prov_01",
            amount: 12000,
            currency: "INR",
            status: "pending",
            key_secret: "leak_secret_value",
            email: "sensitive@customer.com",
            contact: "+919999999999"
          })
        })
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => ({
            id: "rfnd_redact_01",
            payment_id: "pay_test_prov_01",
            amount: 12000,
            currency: "INR",
            status: "processed",
            key_secret: "leak_secret_value",
            email: "sensitive@customer.com"
          })
        });

      await dispatchSandboxAction({
        tenantId: TENANT_A,
        caseId: CASE_ID_A,
        actorId: "admin-1",
        actorRole: "ADMIN",
        proposedActionType: "REQUEST_REFUND",
        idempotencyKey: "idem-redact-check-01",
        policyConfig: approvedPolicyConfig,
        customFetch: mockFetch
      });

      const op = await ProviderOperation.findOne({
        tenantId: TENANT_A,
        idempotencyKey: "idem-redact-check-01"
      }).lean();

      expect(op.providerResponseRaw.key_secret).toBeUndefined();
      expect(op.providerResponseRaw.email).toBeUndefined();
      expect(op.providerResponseRaw.contact).toBeUndefined();
      expect(op.verificationEvidence.key_secret).toBeUndefined();
      expect(op.verificationEvidence.email).toBeUndefined();
    });
  });

  describe("5. Provider Idempotency Header, 409 Conflict, and Identity Mismatch Verification", () => {
    it("persists providerIdempotencyKey and sends exact X-Refund-Idempotency header tied to operation", async () => {
      let capturedHeaders = null;
      let capturedBody = null;

      const mockFetch = vi.fn()
        .mockImplementationOnce(async (url, opts) => {
          capturedHeaders = opts.headers;
          capturedBody = JSON.parse(opts.body);
          return {
            status: 200,
            ok: true,
            json: async () => ({
              id: "rfnd_idem_hdr_01",
              payment_id: "pay_test_prov_001",
              amount: 12000,
              currency: "INR",
              status: "pending"
            })
          };
        })
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => ({
            id: "rfnd_idem_hdr_01",
            payment_id: "pay_test_prov_001",
            amount: 12000,
            currency: "INR",
            status: "processed"
          })
        });

      const res = await dispatchSandboxAction({
        tenantId: TENANT_A,
        caseId: CASE_ID_A,
        actorId: "admin-1",
        actorRole: "ADMIN",
        proposedActionType: "REQUEST_REFUND",
        idempotencyKey: "idem-check-header-01",
        policyConfig: approvedPolicyConfig,
        customFetch: mockFetch
      });

      expect(res.dispatchBlocked).toBe(false);
      expect(res.operation.operationStatus).toBe("VERIFIED_SUCCEEDED");

      // Verify persisted operation in MongoDB
      const op = await ProviderOperation.findOne({
        tenantId: TENANT_A,
        idempotencyKey: "idem-check-header-01"
      }).lean();

      expect(op).toBeDefined();
      expect(op.providerIdempotencyKey).toBe(op.operationId);
      expect(capturedHeaders["X-Refund-Idempotency"]).toBe(op.operationId);
      expect(capturedBody.amount).toBe(12000);
      expect(capturedBody.notes.reconaiCaseId).toBe(CASE_ID_A);
    });

    it("treats provider HTTP 409 Conflict conservatively as OUTCOME_UNKNOWN without assuming success or failure", async () => {
      const mockFetch = vi.fn().mockImplementationOnce(async () => {
        return {
          status: 409,
          ok: false,
          json: async () => ({
            error: {
              code: "BAD_REQUEST_ERROR",
              description: "A refund with the same idempotency key is already in progress"
            }
          })
        };
      });

      const res = await dispatchSandboxAction({
        tenantId: TENANT_A,
        caseId: CASE_ID_A,
        actorId: "admin-1",
        actorRole: "ADMIN",
        proposedActionType: "REQUEST_REFUND",
        idempotencyKey: "idem-409-conflict-01",
        policyConfig: approvedPolicyConfig,
        customFetch: mockFetch
      });

      expect(res.dispatchBlocked).toBe(false);
      expect(res.operation.operationStatus).toBe("OUTCOME_UNKNOWN");
      expect(res.operation.verificationStatus).toBe("DISPATCH_CONFLICT_UNKNOWN");

      const op = await ProviderOperation.findOne({
        tenantId: TENANT_A,
        idempotencyKey: "idem-409-conflict-01"
      }).lean();

      expect(op.operationStatus).toBe("OUTCOME_UNKNOWN");
      expect(op.failureReason).toContain("409 Conflict");
    });

    it("transitions operation to SAFE_HOLD in MongoDB when authoritative read returns wrong payment ID", async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => ({
            id: "rfnd_wrong_payment_test",
            payment_id: "pay_test_prov_001",
            amount: 12000,
            currency: "INR",
            status: "pending"
          })
        })
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          json: async () => ({
            id: "rfnd_wrong_payment_test",
            payment_id: "pay_unrelated_foreign_payment_999", // Wrong payment ID!
            amount: 12000,
            currency: "INR",
            status: "processed"
          })
        });

      const res = await dispatchSandboxAction({
        tenantId: TENANT_A,
        caseId: CASE_ID_A,
        actorId: "admin-1",
        actorRole: "ADMIN",
        proposedActionType: "REQUEST_REFUND",
        idempotencyKey: "idem-wrong-payment-01",
        policyConfig: approvedPolicyConfig,
        customFetch: mockFetch
      });

      expect(res.dispatchBlocked).toBe(false);
      expect(res.operation.operationStatus).toBe("SAFE_HOLD");
      expect(res.operation.safeHoldReason).toContain("does not match expected");

      const op = await ProviderOperation.findOne({
        tenantId: TENANT_A,
        idempotencyKey: "idem-wrong-payment-01"
      }).lean();

      expect(op.operationStatus).toBe("SAFE_HOLD");
      expect(op.verificationStatus).toBe("PAYMENT_ID_MISMATCH");
      expect(op.safeHoldReason).toContain("does not match expected");
    });
  });
});
