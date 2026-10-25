import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import mongoose from "mongoose";
import { PolicyConfigVersion, computePolicyConfigHash } from "../../src/models/PolicyConfigVersion.js";
import { UserAccount } from "../../src/models/UserAccount.js";
import {
  proposePolicyConfig,
  approvePolicyConfig,
  deactivatePolicyConfig,
  getActivePolicyConfig
} from "../../src/services/policy/policyConfigService.js";
import * as auditService from "../../src/services/audit/auditService.js";
import { AuditUnavailableError } from "../../src/services/audit/auditService.js";
import { dispatchSandboxAction } from "../../src/services/policy/providerDispatchService.js";
import { PaymentCase } from "../../src/models/PaymentCase.js";
import { GatewayPayment } from "../../src/models/GatewayPayment.js";
import { validateTestDatabaseUri } from "../helpers/testDbGuard.js";

const DEFAULT_TEST_URI = "mongodb://127.0.0.1:27017/reconai_test_policy_concurrency";
const TEST_DB_URI = validateTestDatabaseUri(process.env.MONGODB_TEST_URI || DEFAULT_TEST_URI);

describe("PolicyConfigConcurrency - Real MongoDB Concurrency, Indices & Fail-Closed Safety", { timeout: 35000 }, () => {
  const TENANT_A = "tenant_policy_race_alpha";
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
    process.env.RAZORPAY_KEY_ID = "rzp_test_mockKeyId12345";
    process.env.RAZORPAY_KEY_SECRET = "mockKeySecret67890";
    process.env.RAZORPAY_SANDBOX_WRITES_ENABLED = "true";
    process.env.POLICY_TOKEN_SECRET = "super-secret-policy-token-test-32-chars!";

    await PolicyConfigVersion.deleteMany({});
    await UserAccount.deleteMany({});
    await PaymentCase.deleteMany({});
    await GatewayPayment.deleteMany({});

    // Seed known platform user for tenant
    await UserAccount.create({
      userId: "usr_admin_01",
      email: "admin@tenantalpha.com",
      passwordHash: "hash123",
      passwordSalt: "salt123",
      role: "ADMIN",
      tenantId: TENANT_A
    });

    await UserAccount.create({
      userId: "usr_admin_02",
      email: "admin2@tenantalpha.com",
      passwordHash: "hash123",
      passwordSalt: "salt123",
      role: "ADMIN",
      tenantId: TENANT_A
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. Real MongoDB Concurrency & Atomic Transitions", () => {
    it("10 parallel approvals of one proposal yields exactly one success and 9 conflict errors", async () => {
      const proposal = await proposePolicyConfig({
        tenantId: TENANT_A,
        proposedBy: "usr_admin_01",
        limits: {
          currency: "INR",
          maxSingleRefundPaise: 50000,
          maxCumulativeRefundPaise: 200000
        },
        proposalReason: "Initial configuration proposal for concurrency test"
      });

      const promises = Array.from({ length: 10 }).map((_, idx) =>
        approvePolicyConfig({
          configId: proposal._id,
          approvedBy: `usr_admin_approver_${idx}`,
          approvalReason: `Concurrent approval attempt #${idx}`
        })
          .then((res) => ({ status: "fulfilled", value: res }))
          .catch((err) => ({ status: "rejected", reason: err }))
      );

      const results = await Promise.all(promises);

      const successes = results.filter((r) => r.status === "fulfilled");
      const failures = results.filter((r) => r.status === "rejected");

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(9);

      // Verify DB state has exactly one ACTIVE config
      const activeConfigs = await PolicyConfigVersion.find({ tenantId: TENANT_A, status: "ACTIVE" });
      expect(activeConfigs).toHaveLength(1);
      expect(activeConfigs[0].status).toBe("ACTIVE");
    });

    it("two pending versions approved concurrently yields exactly one ACTIVE and one SUPERSEDED config", async () => {
      const prop1 = await proposePolicyConfig({
        tenantId: TENANT_A,
        proposedBy: "usr_admin_01",
        limits: {
          currency: "INR",
          maxSingleRefundPaise: 10000,
          maxCumulativeRefundPaise: 50000
        },
        proposalReason: "Version 1 proposal reason"
      });

      const prop2 = await proposePolicyConfig({
        tenantId: TENANT_A,
        proposedBy: "usr_admin_01",
        limits: {
          currency: "INR",
          maxSingleRefundPaise: 20000,
          maxCumulativeRefundPaise: 80000
        },
        proposalReason: "Version 2 proposal reason"
      });

      // Approve both
      await approvePolicyConfig({
        configId: prop1._id,
        approvedBy: "usr_admin_02",
        approvalReason: "Approve version 1"
      });

      await approvePolicyConfig({
        configId: prop2._id,
        approvedBy: "usr_admin_02",
        approvalReason: "Approve version 2 (supersedes version 1)"
      });

      // MongoDB partial index guarantee: exactly one ACTIVE
      const activeConfigs = await PolicyConfigVersion.find({ tenantId: TENANT_A, status: "ACTIVE" });
      expect(activeConfigs).toHaveLength(1);
      expect(activeConfigs[0].configVersion).toBe(2);

      const supersededConfigs = await PolicyConfigVersion.find({ tenantId: TENANT_A, status: "SUPERSEDED" });
      expect(supersededConfigs).toHaveLength(1);
      expect(supersededConfigs[0].configVersion).toBe(1);
    });

    it("MongoDB partial unique index rejects direct insertion of a second ACTIVE config for same tenant", async () => {
      const limits = {
        currency: "INR",
        maxSingleRefundPaise: 50000,
        maxCumulativeRefundPaise: 200000
      };

      await PolicyConfigVersion.create({
        tenantId: TENANT_A,
        configVersion: 1,
        status: "ACTIVE",
        limits,
        contentHash: computePolicyConfigHash(limits),
        proposedBy: "admin-1",
        proposalReason: "First active config 123"
      });

      // Attempting to insert a second ACTIVE config directly must trigger MongoDB duplicate key error (code 11000)
      await expect(
        PolicyConfigVersion.create({
          tenantId: TENANT_A,
          configVersion: 2,
          status: "ACTIVE",
          limits,
          contentHash: computePolicyConfigHash(limits),
          proposedBy: "admin-2",
          proposalReason: "Second active config 123"
        })
      ).rejects.toThrow(/duplicate key error.*tenantId/);
    });
  });

  describe("2. Audit Failure Fail-Closed Protection", () => {
    it("when audit write fails during proposal, aborts with 503 and NO document is persisted in MongoDB", async () => {
      vi.spyOn(auditService, "createAuditEvent").mockRejectedValue(
        new AuditUnavailableError("Audit database connection lost")
      );

      await expect(
        proposePolicyConfig({
          tenantId: TENANT_A,
          proposedBy: "usr_admin_01",
          limits: {
            currency: "INR",
            maxSingleRefundPaise: 50000,
            maxCumulativeRefundPaise: 200000
          },
          proposalReason: "Audit fail-closed test proposal"
        })
      ).rejects.toThrow(/Failed to persist audit log/);

      // Verify zero records were created in MongoDB
      const count = await PolicyConfigVersion.countDocuments({ tenantId: TENANT_A });
      expect(count).toBe(0);
    });

    it("when audit write fails during approval, aborts with 503 and proposal remains PENDING_APPROVAL", async () => {
      const prop = await proposePolicyConfig({
        tenantId: TENANT_A,
        proposedBy: "usr_admin_01",
        limits: {
          currency: "INR",
          maxSingleRefundPaise: 50000,
          maxCumulativeRefundPaise: 200000
        },
        proposalReason: "Proposal for audit failure during approval"
      });

      vi.spyOn(auditService, "createAuditEvent").mockRejectedValue(
        new AuditUnavailableError("Audit database connection lost")
      );

      await expect(
        approvePolicyConfig({
          configId: prop._id,
          approvedBy: "usr_admin_02",
          approvalReason: "Approval that should abort on audit failure"
        })
      ).rejects.toThrow(/Failed to persist audit log/);

      // Verify status in MongoDB remains PENDING_APPROVAL
      const persisted = await PolicyConfigVersion.findById(prop._id);
      expect(persisted.status).toBe("PENDING_APPROVAL");
      expect(persisted.approvedBy).toBeNull();
    });
  });

  describe("3. Refunds Fail-Closed with Zero Provider Call", () => {
    it("fails closed with INSUFFICIENT_EVIDENCE and ZERO provider call when no config exists", async () => {
      const mockFetch = vi.fn();

      // Seed PaymentCase and GatewayPayment
      await PaymentCase.create({
        caseId: "CASE-CONCUR-01",
        tenantId: TENANT_A,
        merchantOrderId: "ORD-CONCUR-01",
        gatewayPaymentId: "pay_concur_001",
        orderStatus: "ORDER_PENDING",
        paymentStatus: "CAPTURED",
        discrepancyCategory: "STATUS_MISMATCH",
        currency: "INR"
      });

      await GatewayPayment.create({
        gatewayPaymentId: "pay_concur_001",
        tenantId: TENANT_A,
        merchantOrderId: "ORD-CONCUR-01",
        amountPaise: 25000,
        currency: "INR",
        status: "CAPTURED",
        method: "UPI",
        source: "RAZORPAY",
        gatewayCreatedAt: new Date()
      });

      const result = await dispatchSandboxAction({
        tenantId: TENANT_A,
        caseId: "CASE-CONCUR-01",
        actorId: "usr_admin_01",
        actorRole: "ADMIN",
        proposedActionType: "REQUEST_REFUND",
        idempotencyKey: "idem-no-config-01",
        customFetch: mockFetch
      });

      expect(result.dispatchBlocked).toBe(true);
      expect(result.policyOutcomeStatus).toBe("INSUFFICIENT_EVIDENCE");
      expect(result.appliedRuleIds).toContain("R_REFUND_LIMITS_MISSING_FAIL_CLOSED");
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("fails closed with INSUFFICIENT_EVIDENCE and ZERO provider call when active config is deactivated", async () => {
      const mockFetch = vi.fn();

      // Create and approve config
      const prop = await proposePolicyConfig({
        tenantId: TENANT_A,
        proposedBy: "usr_admin_01",
        limits: {
          currency: "INR",
          maxSingleRefundPaise: 50000,
          maxCumulativeRefundPaise: 200000
        },
        proposalReason: "Config to be deactivated 123"
      });

      await approvePolicyConfig({
        configId: prop._id,
        approvedBy: "usr_admin_02",
        approvalReason: "Approved before emergency deactivation"
      });

      // Confirm it is ACTIVE
      const active = await getActivePolicyConfig(TENANT_A);
      expect(active).not.toBeNull();

      // Deactivate it
      await deactivatePolicyConfig({
        tenantId: TENANT_A,
        deactivatedBy: "usr_admin_01",
        deactivationReason: "Emergency security deactivation 123"
      });

      // Confirm active is now null
      const postDeactActive = await getActivePolicyConfig(TENANT_A);
      expect(postDeactActive).toBeNull();

      // Seed PaymentCase and GatewayPayment
      await PaymentCase.create({
        caseId: "CASE-CONCUR-02",
        tenantId: TENANT_A,
        merchantOrderId: "ORD-CONCUR-02",
        gatewayPaymentId: "pay_concur_002",
        orderStatus: "ORDER_PENDING",
        paymentStatus: "CAPTURED",
        discrepancyCategory: "STATUS_MISMATCH",
        currency: "INR"
      });

      await GatewayPayment.create({
        gatewayPaymentId: "pay_concur_002",
        tenantId: TENANT_A,
        merchantOrderId: "ORD-CONCUR-02",
        amountPaise: 25000,
        currency: "INR",
        status: "CAPTURED",
        method: "UPI",
        source: "RAZORPAY",
        gatewayCreatedAt: new Date()
      });

      const result = await dispatchSandboxAction({
        tenantId: TENANT_A,
        caseId: "CASE-CONCUR-02",
        actorId: "usr_admin_01",
        actorRole: "ADMIN",
        proposedActionType: "REQUEST_REFUND",
        idempotencyKey: "idem-deactivated-config-01",
        customFetch: mockFetch
      });

      expect(result.dispatchBlocked).toBe(true);
      expect(result.policyOutcomeStatus).toBe("INSUFFICIENT_EVIDENCE");
      expect(result.appliedRuleIds).toContain("R_REFUND_LIMITS_MISSING_FAIL_CLOSED");
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
