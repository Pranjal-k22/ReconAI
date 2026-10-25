import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import { PolicyConfigVersion, computePolicyConfigHash } from "../../src/models/PolicyConfigVersion.js";
import { UserAccount } from "../../src/models/UserAccount.js";
import { PaymentCase } from "../../src/models/PaymentCase.js";
import { GatewayPayment } from "../../src/models/GatewayPayment.js";
import { MerchantOrder } from "../../src/models/MerchantOrder.js";
import { ProviderOperation } from "../../src/models/ProviderOperation.js";
import { PolicyDecision } from "../../src/models/PolicyDecision.js";
import { RefundReservation } from "../../src/models/RefundReservation.js";
import { PaymentLifecycleEvent } from "../../src/models/PaymentLifecycleEvent.js";
import {
  proposePolicyConfig,
  approvePolicyConfig,
  deactivatePolicyConfig,
  getActivePolicyConfig
} from "../../src/services/policy/policyConfigService.js";
import { dispatchSandboxAction } from "../../src/services/policy/providerDispatchService.js";
import { evaluateAndSimulateResolution } from "../../src/services/policy/dryRunSimulatorService.js";
import { validateTestDatabaseUri } from "../helpers/testDbGuard.js";

const DEFAULT_TEST_URI = "mongodb://127.0.0.1:27017/reconai_test_policy_e2e";
const TEST_DB_URI = validateTestDatabaseUri(process.env.MONGODB_TEST_URI || DEFAULT_TEST_URI);

describe("Governed Policy Limits & End-to-End Dispatch Lifecycle", { timeout: 35000 }, () => {
  const TENANT_E2E = "tenant_governed_e2e";
  const CASE_ID_E2E = "CASE-E2E-GOV-001";
  const PAYMENT_ID_E2E = "pay_e2e_gov_001";
  const ORDER_ID_E2E = "ORD-E2E-GOV-001";

  const originalEnv = { ...process.env };

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 5000 });
    await PolicyConfigVersion.syncIndexes();
    await UserAccount.syncIndexes();
    await PaymentCase.syncIndexes();
    await GatewayPayment.syncIndexes();
    await MerchantOrder.syncIndexes();
    await ProviderOperation.syncIndexes();
    await PolicyDecision.syncIndexes();
    await RefundReservation.syncIndexes();
    await PaymentLifecycleEvent.syncIndexes();
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
    process.env.RAZORPAY_KEY_ID = "rzp_test_e2eKey12345";
    process.env.RAZORPAY_KEY_SECRET = "e2eSecret67890";
    process.env.RAZORPAY_SANDBOX_WRITES_ENABLED = "true";
    process.env.POLICY_TOKEN_SECRET = "super-secret-policy-token-test-32-chars!";

    await PolicyConfigVersion.deleteMany({});
    await UserAccount.deleteMany({});
    await PaymentCase.deleteMany({});
    await GatewayPayment.deleteMany({});
    await MerchantOrder.deleteMany({});
    await ProviderOperation.deleteMany({});
    await PolicyDecision.deleteMany({});
    await RefundReservation.deleteMany({});
    await PaymentLifecycleEvent.deleteMany({});

    // Seed known platform admins for tenant
    await UserAccount.create({
      userId: "usr_admin_proposer",
      email: "proposer@e2e.com",
      passwordHash: "hash1",
      passwordSalt: "salt1",
      role: "ADMIN",
      tenantId: TENANT_E2E
    });

    await UserAccount.create({
      userId: "usr_admin_approver",
      email: "approver@e2e.com",
      passwordHash: "hash2",
      passwordSalt: "salt2",
      role: "ADMIN",
      tenantId: TENANT_E2E
    });

    // Seed captured payment and pending merchant order (documented fields only)
    await GatewayPayment.create({
      gatewayPaymentId: PAYMENT_ID_E2E,
      tenantId: TENANT_E2E,
      merchantOrderId: ORDER_ID_E2E,
      amountPaise: 45000,
      currency: "INR",
      status: "CAPTURED",
      method: "CARD",
      source: "RAZORPAY",
      gatewayCreatedAt: new Date()
    });

    await MerchantOrder.create({
      merchantOrderId: ORDER_ID_E2E,
      tenantId: TENANT_E2E,
      amountPaise: 45000,
      currency: "INR",
      status: "PENDING",
      orderCreatedAt: new Date()
    });

    await PaymentCase.create({
      caseId: CASE_ID_E2E,
      tenantId: TENANT_E2E,
      merchantOrderId: ORDER_ID_E2E,
      gatewayPaymentId: PAYMENT_ID_E2E,
      orderStatus: "ORDER_PENDING",
      paymentStatus: "CAPTURED",
      discrepancyCategory: "STATUS_MISMATCH",
      currency: "INR"
    });
  });

  it("Full Lifecycle: Propose & Approve -> Decision Records Version -> Dispatch Succeeds -> Deactivate Fails Closed -> Config Change Returns 409", async () => {
    // 1. Propose and approve a policy config via the service
    const proposal = await proposePolicyConfig({
      tenantId: TENANT_E2E,
      proposedBy: "usr_admin_proposer",
      limits: {
        currency: "INR",
        maxSingleRefundPaise: 50000,
        maxCumulativeRefundPaise: 200000
      },
      proposalReason: "Initial approved refund policy for E2E testing"
    });

    expect(proposal.status).toBe("PENDING_APPROVAL");
    expect(proposal.configVersion).toBe(1);

    const approved = await approvePolicyConfig({
      configId: proposal._id,
      approvedBy: "usr_admin_approver",
      approvalReason: "Verified by secondary admin for E2E testing"
    });

    expect(approved.status).toBe("ACTIVE");
    expect(approved.configVersion).toBe(1);

    // 2. Policy Decision records configVersion and contentHash
    const simulationResult = await evaluateAndSimulateResolution({
      tenantId: TENANT_E2E,
      caseId: CASE_ID_E2E,
      actorId: "usr_admin_approver",
      actorRole: "ADMIN",
      proposedActionType: "REQUEST_REFUND",
      idempotencyKey: "idem-decision-gov-01"
    });

    expect(simulationResult.decision.outcomeStatus).toBe("ELIGIBLE_FOR_SIMULATION");
    expect(simulationResult.decision.policyConfigVersion).toBe(1);
    expect(simulationResult.decision.contentHash).toBe(approved.contentHash);

    // 3. Dispatch with sandbox writes enabled -> operation proceeds
    const mockFetch = vi.fn().mockImplementation(async (url, opts) => {
      const urlStr = String(url);
      const method = (opts?.method || "GET").toUpperCase();

      if (method === "GET" && !urlStr.includes("/refunds")) {
        return {
          status: 200,
          ok: true,
          json: async () => ({
            id: PAYMENT_ID_E2E,
            entity: "payment",
            amount: 45000,
            amount_captured: 45000,
            amount_refunded: 0,
            currency: "INR",
            status: "captured",
            order_id: ORDER_ID_E2E
          })
        };
      }

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

      if (method === "GET" && urlStr.includes("/refunds/")) {
        return {
          status: 200,
          ok: true,
          json: async () => ({
            id: "rfnd_e2e_gov_001",
            entity: "refund",
            amount: 45000,
            currency: "INR",
            payment_id: PAYMENT_ID_E2E,
            status: "processed"
          })
        };
      }

      if (method === "POST" && urlStr.includes("/refund")) {
        return {
          status: 200,
          ok: true,
          json: async () => ({
            id: "rfnd_e2e_gov_001",
            entity: "refund",
            amount: 45000,
            currency: "INR",
            payment_id: PAYMENT_ID_E2E,
            status: "processed"
          })
        };
      }
      return { status: 200, ok: true, json: async () => ({}) };
    });

    const dispatchResult = await dispatchSandboxAction({
      tenantId: TENANT_E2E,
      caseId: CASE_ID_E2E,
      actorId: "usr_admin_approver",
      actorRole: "ADMIN",
      proposedActionType: "REQUEST_REFUND",
      idempotencyKey: "idem-dispatch-gov-01",
      customFetch: mockFetch
    });

    expect(dispatchResult.dispatchBlocked).toBe(false);
    expect(dispatchResult.operation.operationStatus).toBe("VERIFIED_SUCCEEDED");
    expect(mockFetch).toHaveBeenCalled();

    // 4. Deactivate the config -> the next dispatch fails closed
    await deactivatePolicyConfig({
      tenantId: TENANT_E2E,
      deactivatedBy: "usr_admin_approver",
      deactivationReason: "Emergency security deactivation for test"
    });

    const activeConfigAfterDeactivation = await getActivePolicyConfig(TENANT_E2E);
    expect(activeConfigAfterDeactivation).toBeNull();

    const deactFetch = vi.fn();
    const blockedResult = await dispatchSandboxAction({
      tenantId: TENANT_E2E,
      caseId: CASE_ID_E2E,
      actorId: "usr_admin_approver",
      actorRole: "ADMIN",
      proposedActionType: "REQUEST_REFUND",
      idempotencyKey: "idem-after-deact-01",
      customFetch: deactFetch
    });

    expect(blockedResult.dispatchBlocked).toBe(true);
    expect(blockedResult.policyOutcomeStatus).toBe("INSUFFICIENT_EVIDENCE");
    expect(blockedResult.appliedRuleIds).toContain("R_REFUND_LIMITS_MISSING_FAIL_CLOSED");
    expect(deactFetch).not.toHaveBeenCalled();

    // 5. Change the config between decision and dispatch -> 409 POLICY_CONFIG_CHANGED
    // Reactivate a new version (version 2)
    const prop2 = await proposePolicyConfig({
      tenantId: TENANT_E2E,
      proposedBy: "usr_admin_proposer",
      limits: {
        currency: "INR",
        maxSingleRefundPaise: 60000,
        maxCumulativeRefundPaise: 250000
      },
      proposalReason: "Version 2 limits proposal"
    });

    const approvedV2 = await approvePolicyConfig({
      configId: prop2._id,
      approvedBy: "usr_admin_approver",
      approvalReason: "Approve version 2 limits"
    });
    expect(approvedV2.configVersion).toBe(2);

    // Seed fresh un-refunded case for version mismatch dispatch test
    const CASE_ID_V2 = "CASE-E2E-GOV-002";
    const PAYMENT_ID_V2 = "pay_e2e_gov_002";
    const ORDER_ID_V2 = "ORD-E2E-GOV-002";

    await GatewayPayment.create({
      gatewayPaymentId: PAYMENT_ID_V2,
      tenantId: TENANT_E2E,
      merchantOrderId: ORDER_ID_V2,
      amountPaise: 50000,
      currency: "INR",
      status: "CAPTURED",
      method: "CARD",
      source: "RAZORPAY",
      gatewayCreatedAt: new Date()
    });

    await MerchantOrder.create({
      merchantOrderId: ORDER_ID_V2,
      tenantId: TENANT_E2E,
      amountPaise: 50000,
      currency: "INR",
      status: "PENDING",
      orderCreatedAt: new Date()
    });

    await PaymentCase.create({
      caseId: CASE_ID_V2,
      tenantId: TENANT_E2E,
      merchantOrderId: ORDER_ID_V2,
      gatewayPaymentId: PAYMENT_ID_V2,
      orderStatus: "ORDER_PENDING",
      paymentStatus: "CAPTURED",
      discrepancyCategory: "STATUS_MISMATCH",
      currency: "INR"
    });

    // Simulate decision under version 2
    const decV2 = await evaluateAndSimulateResolution({
      tenantId: TENANT_E2E,
      caseId: CASE_ID_V2,
      actorId: "usr_admin_approver",
      actorRole: "ADMIN",
      proposedActionType: "REQUEST_REFUND",
      idempotencyKey: "idem-decision-gov-v2"
    });
    expect(decV2.decision.policyConfigVersion).toBe(2);

    // 5. Change the config between decision and dispatch -> 409 POLICY_CONFIG_CHANGED
    // Propose and approve version 3 via service, superseding version 2 in MongoDB
    const prop3 = await proposePolicyConfig({
      tenantId: TENANT_E2E,
      proposedBy: "usr_admin_proposer",
      limits: {
        currency: "INR",
        maxSingleRefundPaise: 75000,
        maxCumulativeRefundPaise: 300000
      },
      proposalReason: "Version 3 limits update after decision"
    });

    const approvedV3 = await approvePolicyConfig({
      configId: prop3._id,
      approvedBy: "usr_admin_approver",
      approvalReason: "Approve version 3 limits"
    });
    expect(approvedV3.configVersion).toBe(3);

    // Attempting to dispatch on CASE_ID_V2 (whose latest decision was under version 2) must fail with 409
    await expect(
      dispatchSandboxAction({
        tenantId: TENANT_E2E,
        caseId: CASE_ID_V2,
        actorId: "usr_admin_approver",
        actorRole: "ADMIN",
        proposedActionType: "REQUEST_REFUND",
        idempotencyKey: "idem-race-mismatch-01"
      })
    ).rejects.toThrow(/Active policy configuration changed or was deactivated after policy decision/);
  });
});
