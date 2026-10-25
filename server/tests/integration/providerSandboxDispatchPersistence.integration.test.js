import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import crypto from "crypto";
import request from "supertest";
import mongoose from "mongoose";
import app from "../../src/app.js";
import { ProviderOperation } from "../../src/models/ProviderOperation.js";
import { PaymentCase } from "../../src/models/PaymentCase.js";
import { GatewayPayment } from "../../src/models/GatewayPayment.js";
import { MerchantOrder } from "../../src/models/MerchantOrder.js";
import { PaymentAction } from "../../src/models/PaymentAction.js";
import { RefundReservation } from "../../src/models/RefundReservation.js";
import { PaymentLifecycleEvent } from "../../src/models/PaymentLifecycleEvent.js";
import { PolicyConfigVersion, computePolicyConfigHash } from "../../src/models/PolicyConfigVersion.js";
import {
  dispatchSandboxAction,
  recheckProviderOperationStatus,
  getProviderOperationsByCaseId,
  computeDispatchPayloadHash
} from "../../src/services/policy/providerDispatchService.js";
import {
  reserveRefund,
  releaseRefundReservation
} from "../../src/services/policy/refundReservationService.js";
import { RazorpayProviderError, RAZORPAY_ERROR_CODES } from "../../src/services/razorpay/razorpayClient.js";

import { validateTestDatabaseUri } from "../helpers/testDbGuard.js";

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
    await RefundReservation.syncIndexes();
    await PaymentLifecycleEvent.syncIndexes();
    await PolicyConfigVersion.syncIndexes();
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
    process.env.POLICY_TOKEN_SECRET = "super-secret-policy-token-test-32-chars!";

    await ProviderOperation.deleteMany({});
    await PaymentCase.deleteMany({});
    await GatewayPayment.deleteMany({});
    await MerchantOrder.deleteMany({});
    await PaymentAction.deleteMany({});
    await RefundReservation.deleteMany({});
    await PaymentLifecycleEvent.deleteMany({});
    await PolicyConfigVersion.deleteMany({});

    // Seed Active Governed PolicyConfig for TENANT_A and TENANT_B
    const seedLimits = {
      currency: "INR",
      maxSingleRefundPaise: 500000,
      maxCumulativeRefundPaise: 2000000
    };
    await PolicyConfigVersion.create({
      tenantId: TENANT_A,
      configVersion: 1,
      status: "ACTIVE",
      limits: seedLimits,
      contentHash: computePolicyConfigHash(seedLimits),
      proposedBy: "admin-proposer",
      approvedBy: "admin-approver",
      proposalReason: "Initial approved refund limits for test tenant",
      approvalReason: "Verified business justification for test limits",
      activatedAt: new Date()
    });

    await PolicyConfigVersion.create({
      tenantId: TENANT_B,
      configVersion: 1,
      status: "ACTIVE",
      limits: seedLimits,
      contentHash: computePolicyConfigHash(seedLimits),
      proposedBy: "admin-proposer",
      approvedBy: "admin-approver",
      proposalReason: "Initial approved refund limits for test tenant B",
      approvalReason: "Verified business justification for test limits",
      activatedAt: new Date()
    });

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

  function createIntegrationMockFetch({
    refundId = "rfnd_int_test_999",
    amountPaise = 12000,
    currency = "INR",
    paymentId = "pay_test_prov_001",
    postRefundStatus = "pending",
    postResponseOverride = null,
    getRefundStatus = "processed",
    postError = null,
    getError = null,
    customPostHandler = null,
    customGetRefundHandler = null
  } = {}) {
    return vi.fn().mockImplementation(async (url, options = {}) => {
      const urlStr = String(url);
      const method = (options.method || "GET").toUpperCase();

      // 1. Preflight payment GET
      if (method === "GET" && !urlStr.includes("/refund")) {
        return {
          status: 200,
          ok: true,
          json: async () => ({
            id: paymentId,
            entity: "payment",
            amount: amountPaise,
            amount_captured: amountPaise,
            amount_refunded: 0,
            currency,
            status: "captured",
            order_id: "ORD-PROV-001"
          })
        };
      }

      // 2. Preflight refunds list GET
      if (method === "GET" && urlStr.endsWith("/refunds")) {
        return {
          status: 200,
          ok: true,
          json: async () => ({
            entity: "collection",
            count: 0,
            items: []
          })
        };
      }

      // 3. POST refund
      if (method === "POST") {
        if (customPostHandler) return customPostHandler(url, options);
        if (postError) throw postError;
        if (postResponseOverride) return postResponseOverride;
        return {
          status: 200,
          ok: true,
          json: async () => ({
            id: refundId,
            entity: "refund",
            amount: amountPaise,
            currency,
            payment_id: paymentId,
            status: postRefundStatus,
            notes: options.body ? JSON.parse(options.body).notes : {}
          })
        };
      }

      // 4. Authoritative GET single refund
      if (method === "GET" && urlStr.includes("/refunds/")) {
        if (customGetRefundHandler) return customGetRefundHandler(url, options);
        if (getError) throw getError;
        return {
          status: 200,
          ok: true,
          json: async () => ({
            id: refundId,
            entity: "refund",
            amount: amountPaise,
            currency,
            payment_id: paymentId,
            status: getRefundStatus
          })
        };
      }

      return { status: 200, ok: true, json: async () => ({}) };
    });
  }

  describe("1. Fail-Closed Safety: Missing Refund Limits & Case 22", () => {
    it("fails closed before any provider call when server-side policyConfig is null (missing limits)", async () => {
      // Clear all active policy configurations so tenant has no limits record
      await PolicyConfigVersion.deleteMany({});
      const mockFetch = vi.fn();

      const result = await dispatchSandboxAction({
        tenantId: TENANT_A,
        caseId: CASE_ID_A,
        actorId: "admin-1",
        actorRole: "ADMIN",
        proposedActionType: "REQUEST_REFUND",
        idempotencyKey: "idem-missing-limits-01",
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
      const mockFetch = createIntegrationMockFetch({
        refundId: "rfnd_int_test_999",
        amountPaise: 12000,
        currency: "INR",
        paymentId: "pay_test_prov_001",
        postRefundStatus: "pending",
        getRefundStatus: "processed"
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
      expect(persisted.tokenId).toBeDefined();
    });

    it("POST timeout transitions operation to OUTCOME_UNKNOWN without failing or retrying", async () => {
      const mockFetch = createIntegrationMockFetch({
        postError: new RazorpayProviderError(
          RAZORPAY_ERROR_CODES.TIMEOUT,
          "Razorpay API request timed out after 10000ms"
        )
      });

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
      const mockFetch = createIntegrationMockFetch({
        refundId: "rfnd_idem_01",
        getRefundStatus: "processed"
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
      const initialCallCount = mockFetch.mock.calls.length;

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
      expect(mockFetch.mock.calls.length).toBe(initialCallCount);
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

      const mockFetch = createIntegrationMockFetch();

      await expect(
        dispatchSandboxAction({
          tenantId: TENANT_A,
          caseId: CASE_ID_A,
          actorId: "admin-1",
          actorRole: "ADMIN",
          proposedActionType: "REQUEST_REFUND",
          idempotencyKey: "idem-conflict-key",
          policyConfig: approvedPolicyConfig,
          customFetch: mockFetch
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
      const mockFetch = createIntegrationMockFetch({
        refundId: "rfnd_redact_01",
        postResponseOverride: {
          status: 200,
          ok: true,
          json: async () => ({
            id: "rfnd_redact_01",
            payment_id: "pay_test_prov_001",
            amount: 12000,
            currency: "INR",
            status: "pending",
            key_secret: "leak_secret_value",
            email: "sensitive@customer.com",
            contact: "+919999999999"
          })
        }
      });

      const res = await dispatchSandboxAction({
        tenantId: TENANT_A,
        caseId: CASE_ID_A,
        actorId: "admin-1",
        actorRole: "ADMIN",
        proposedActionType: "REQUEST_REFUND",
        idempotencyKey: "idem-redact-01",
        policyConfig: approvedPolicyConfig,
        customFetch: mockFetch
      });

      expect(res.dispatchBlocked).toBe(false);

      const op = await ProviderOperation.findOne({
        tenantId: TENANT_A,
        idempotencyKey: "idem-redact-01"
      }).lean();

      expect(op.providerResponseRaw.key_secret).toBeUndefined();
      expect(op.providerResponseRaw.email).toBeUndefined();
      expect(op.providerResponseRaw.contact).toBeUndefined();
    });
  });

  describe("5. Provider Idempotency Header, 409 Conflict, and Identity Mismatch Verification", () => {
    it("persists providerIdempotencyKey and sends exact X-Refund-Idempotency header tied to operation", async () => {
      let capturedHeaders = null;
      let capturedBody = null;

      const mockFetch = createIntegrationMockFetch({
        refundId: "rfnd_idem_hdr_01",
        customPostHandler: async (url, options) => {
          capturedHeaders = options.headers;
          capturedBody = JSON.parse(options.body);
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
        }
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

      expect(op.providerIdempotencyKey).toBe(op.idempotencyKey);
      expect(capturedHeaders["X-Refund-Idempotency"]).toBe(op.idempotencyKey);
      expect(capturedBody.amount).toBe(12000);
      expect(capturedBody.notes.reconaiCaseId).toBe(CASE_ID_A);
    });

    it("treats provider HTTP 409 Conflict conservatively as OUTCOME_UNKNOWN without assuming success or failure", async () => {
      const mockFetch = createIntegrationMockFetch({
        customPostHandler: async () => {
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
        }
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
      const mockFetch = createIntegrationMockFetch({
        refundId: "rfnd_wrong_payment_test",
        customGetRefundHandler: async () => {
          return {
            status: 200,
            ok: true,
            json: async () => ({
              id: "rfnd_wrong_payment_test",
              payment_id: "pay_unrelated_foreign_payment_999", // Wrong payment ID!
              amount: 12000,
              currency: "INR",
              status: "processed"
            })
          };
        }
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

  describe("6. Real-Mongo Atomic Refund Reservation & Concurrency (Gate B4)", () => {
    it("10 parallel dispatches with different keys whose total exceeds balance: total reserved never exceeds balance, correct number succeed, releases are idempotent", async () => {
      // Payment has 50000 paise (Rs 500)
      await GatewayPayment.updateOne(
        { gatewayPaymentId: "pay_test_prov_001", tenantId: TENANT_A },
        { amountPaise: 50000, refundAmountPaise: 0, reservedRefundPaise: 0 }
      );
      await MerchantOrder.updateOne(
        { merchantOrderId: "ORD-PROV-001", tenantId: TENANT_A },
        { amountPaise: 50000 }
      );

      // Attempt 10 parallel refund reservations of 10000 paise each (10 * 10000 = 100000 > 50000)
      // Exactly 5 can succeed (5 * 10000 = 50000)
      const parallelKeys = Array.from({ length: 10 }, (_, i) => `idem-parallel-b4-${i + 1}`);

      const results = await Promise.all(
        parallelKeys.map((key) =>
          reserveRefund({
            tenantId: TENANT_A,
            gatewayPaymentId: "pay_test_prov_001",
            amountPaise: 10000,
            idempotencyKey: key
          })
        )
      );

      const successfulReservations = results.filter((r) => r.success);
      const failedReservations = results.filter((r) => !r.success);

      expect(successfulReservations.length).toBe(5);
      expect(failedReservations.length).toBe(5);

      // Verify GatewayPayment in real Mongo: reservedRefundPaise is exactly 50000, never exceeded
      const updatedPayment = await GatewayPayment.findOne({
        gatewayPaymentId: "pay_test_prov_001",
        tenantId: TENANT_A
      }).lean();

      expect(updatedPayment.reservedRefundPaise).toBe(50000);
      expect(updatedPayment.amountPaise - (updatedPayment.refundAmountPaise || 0) - updatedPayment.reservedRefundPaise).toBe(0);

      // Verify idempotency of release
      const firstSuccessKey = parallelKeys[results.findIndex((r) => r.success)];
      const release1 = await releaseRefundReservation({
        tenantId: TENANT_A,
        gatewayPaymentId: "pay_test_prov_001",
        idempotencyKey: firstSuccessKey,
        reason: "TEST_RELEASE"
      });
      expect(release1.success).toBe(true);
      expect(release1.alreadyReleased).toBe(false);

      // Second release with same key is a safe no-op
      const release2 = await releaseRefundReservation({
        tenantId: TENANT_A,
        gatewayPaymentId: "pay_test_prov_001",
        idempotencyKey: firstSuccessKey,
        reason: "TEST_RELEASE_DUPLICATE"
      });
      expect(release2.success).toBe(true);
      expect(release2.alreadyReleased).toBe(true);

      // Verify payment balance was restored by exactly 10000
      const paymentAfterRelease = await GatewayPayment.findOne({
        gatewayPaymentId: "pay_test_prov_001",
        tenantId: TENANT_A
      }).lean();
      expect(paymentAfterRelease.reservedRefundPaise).toBe(40000);
    });

    it("real ingestion path: signed captured webhook with documented entity shape populates capturedAmountPaise in DB, allows reservation up to balance, and rejects reservation exceeding balance", async () => {
      const webhookSecret = "persistent_test_webhook_secret_key_32_bytes_ok!";
      process.env.RAZORPAY_WEBHOOK_SECRET = webhookSecret;

      const paymentId = `pay_real_ingest_${Date.now()}`;
      const orderId = `order_real_ingest_${Date.now()}`;
      const eventId = `evt_real_ingest_${Date.now()}`;
      const accountId = "acc_real_ingest_001";

      // Pre-seed merchant order for tenant mapping
      await MerchantOrder.create({
        merchantOrderId: orderId,
        tenantId: TENANT_A,
        amountPaise: 25000,
        currency: "INR",
        status: "PENDING"
      });

      // Construct raw webhook payload matching official documented Razorpay Payment entity shape
      // Notice: NO amount_captured field exists in documented payload; only amount, status: captured, captured: true
      const rawBody = JSON.stringify({
        entity: "event",
        account_id: accountId,
        event: "payment.captured",
        contains: ["payment"],
        payload: {
          payment: {
            entity: {
              id: paymentId,
              entity: "payment",
              amount: 25000,
              currency: "INR",
              status: "captured",
              order_id: orderId,
              invoice_id: null,
              international: false,
              method: "upi",
              amount_refunded: 0,
              refund_status: null,
              captured: true,
              description: "ReconAI real ingestion test",
              email: "buyer@example.com",
              contact: "+919999999999",
              fee: 50,
              tax: 9,
              created_at: Math.floor(Date.now() / 1000)
            }
          }
        },
        created_at: Math.floor(Date.now() / 1000)
      });

      const signature = crypto.createHmac("sha256", webhookSecret).update(Buffer.from(rawBody, "utf8")).digest("hex");

      // Ingest via real HTTP route
      const webhookRes = await request(app)
        .post("/api/webhooks/razorpay")
        .set("Content-Type", "application/json")
        .set("X-Razorpay-Signature", signature)
        .set("X-Razorpay-Event-Id", eventId)
        .send(rawBody);

      expect(webhookRes.status).toBe(200);
      expect(webhookRes.body.success).toBe(true);

      // Verify GatewayPayment.capturedAmountPaise was populated by CODE (never set by hand!)
      const ingestedPayment = await GatewayPayment.findOne({
        gatewayPaymentId: paymentId,
        tenantId: TENANT_A
      }).lean();

      expect(ingestedPayment).toBeDefined();
      expect(ingestedPayment.status).toBe("CAPTURED");
      expect(ingestedPayment.capturedAmountPaise).toBe(25000);
      expect(ingestedPayment.amountPaise).toBe(25000);

      // First reservation for 15000 paise (15000 <= 25000) succeeds
      const res1 = await reserveRefund({
        tenantId: TENANT_A,
        gatewayPaymentId: paymentId,
        amountPaise: 15000,
        idempotencyKey: `idem-real-ingest-01-${Date.now()}`
      });
      expect(res1.success).toBe(true);
      expect(res1.reservation.amountPaise).toBe(15000);

      // Second reservation for 15000 paise (remaining balance is 10000, 15000 > 10000) fails
      const res2 = await reserveRefund({
        tenantId: TENANT_A,
        gatewayPaymentId: paymentId,
        amountPaise: 15000,
        idempotencyKey: `idem-real-ingest-02-${Date.now()}`
      });
      expect(res2.success).toBe(false);
      expect(res2.reason).toBe("INSUFFICIENT_REFUNDABLE_BALANCE");

      // Verify in MongoDB that total reserved is 15000, never exceeding balance
      const finalPayment = await GatewayPayment.findOne({
        gatewayPaymentId: paymentId,
        tenantId: TENANT_A
      }).lean();
      expect(finalPayment.reservedRefundPaise).toBe(15000);
    });

    it("crash between ProviderOperation insert and POST leaves REQUESTED operation; reconcile resolves without blind re-send", async () => {
      const idempotencyKey = "idem-crashed-insert-01";
      const crashedOpId = "op_crashed_test_123";

      // 1. Establish reservation as if dispatch steps 1-2 executed
      await reserveRefund({
        tenantId: TENANT_A,
        gatewayPaymentId: "pay_test_prov_001",
        amountPaise: 12000,
        idempotencyKey
      });

      const inputHash = computeDispatchPayloadHash({
        tenantId: TENANT_A,
        caseId: CASE_ID_A,
        gatewayPaymentId: "pay_test_prov_001",
        amountPaise: 12000,
        currency: "INR",
        actionType: "REQUEST_REFUND"
      });

      // 2. Insert ProviderOperation doc in REQUESTED state (simulating crash immediately after insert before POST)
      await ProviderOperation.create({
        operationId: crashedOpId,
        tenantId: TENANT_A,
        caseId: CASE_ID_A,
        gatewayPaymentId: "pay_test_prov_001",
        actionType: "REQUEST_REFUND",
        amountPaise: 12000,
        currency: "INR",
        idempotencyKey,
        providerIdempotencyKey: idempotencyKey,
        operationStatus: "REQUESTED",
        verificationStatus: "UNVERIFIED",
        policyDecisionId: "POL-001",
        tokenId: "tok_crashed_test_123",
        requestPayloadHash: inputHash,
        requestedAt: new Date()
      });

      // Verify MongoDB has REQUESTED operation
      const initialOp = await ProviderOperation.findOne({ tenantId: TENANT_A, idempotencyKey }).lean();
      expect(initialOp.operationStatus).toBe("REQUESTED");

      // 3. Reconcile / retry attempt: simulate provider having received the refund
      let retryPostCount = 0;
      const reconcileMockFetch = vi.fn().mockImplementation(async (url, options = {}) => {
        const urlStr = String(url);
        const method = (options.method || "GET").toUpperCase();

        if (method === "GET" && !urlStr.includes("/refund")) {
          return {
            status: 200,
            ok: true,
            json: async () => ({
              id: "pay_test_prov_001",
              entity: "payment",
              amount: 12000,
              amount_captured: 12000,
              amount_refunded: 0,
              currency: "INR",
              status: "captured",
              order_id: "ORD-PROV-001"
            })
          };
        }
        if (method === "GET" && urlStr.endsWith("/refunds")) {
          return {
            status: 200,
            ok: true,
            json: async () => ({
              entity: "collection",
              count: 1,
              items: [
                {
                  id: "rfnd_reconciled_after_crash_01",
                  payment_id: "pay_test_prov_001",
                  amount: 12000,
                  currency: "INR",
                  status: "processed",
                  receipt: `RCP-${crashedOpId}`,
                  notes: { operationId: crashedOpId }
                }
              ]
            })
          };
        }
        if (method === "GET" && urlStr.includes("/refunds/rfnd_reconciled_after_crash_01")) {
          return {
            status: 200,
            ok: true,
            json: async () => ({
              id: "rfnd_reconciled_after_crash_01",
              payment_id: "pay_test_prov_001",
              amount: 12000,
              currency: "INR",
              status: "processed"
            })
          };
        }
        if (method === "POST") {
          retryPostCount++;
          throw new Error("BLIND_RETRY_FORBIDDEN: POST was called during reconcile!");
        }
        return { status: 404, ok: false, json: async () => ({}) };
      });

      const retryRes = await dispatchSandboxAction({
        tenantId: TENANT_A,
        caseId: CASE_ID_A,
        actorId: "admin-1",
        actorRole: "ADMIN",
        proposedActionType: "REQUEST_REFUND",
        idempotencyKey,
        policyConfig: approvedPolicyConfig,
        customFetch: reconcileMockFetch
      });

      // 4. Invariant: Reconciled successfully without a blind POST re-send
      expect(retryPostCount).toBe(0);
      expect(retryRes.dispatchBlocked).toBe(false);
      expect(retryRes.operation.operationStatus).toBe("VERIFIED_SUCCEEDED");
      expect(retryRes.operation.providerOperationId).toBe("rfnd_reconciled_after_crash_01");

      // Verify final MongoDB state
      const resolvedOp = await ProviderOperation.findOne({
        tenantId: TENANT_A,
        idempotencyKey
      }).lean();

      expect(resolvedOp.operationStatus).toBe("VERIFIED_SUCCEEDED");
      expect(resolvedOp.providerOperationId).toBe("rfnd_reconciled_after_crash_01");
    });
  });
});
