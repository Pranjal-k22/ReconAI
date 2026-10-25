import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import mongoose from "mongoose";
import { PolicyDecision } from "../../src/models/PolicyDecision.js";
import { PaymentAction } from "../../src/models/PaymentAction.js";
import { PaymentCase } from "../../src/models/PaymentCase.js";
import { GatewayPayment } from "../../src/models/GatewayPayment.js";
import { MerchantOrder } from "../../src/models/MerchantOrder.js";
import {
  evaluateAndSimulateResolution,
  getDecisionsByCaseId
} from "../../src/services/policy/dryRunSimulatorService.js";

import { validateTestDatabaseUri } from "../helpers/testDbGuard.js";

const DEFAULT_TEST_URI = "mongodb://127.0.0.1:27017/reconai_test_policy_simulation";
const TEST_DB_URI = validateTestDatabaseUri(process.env.MONGODB_TEST_URI || DEFAULT_TEST_URI);

describe("Deterministic Resolution Policy & Dry-Run Simulator - MongoDB Integration", { timeout: 35000 }, () => {
  const TENANT_A = "tenant_policy_int_alpha";
  const TENANT_B = "tenant_policy_int_beta";
  const CASE_ID_A = "CASE-POL-INT-001";
  const CASE_ID_B = "CASE-POL-INT-002";

  const validPolicyConfig = {
    maxSingleRefundPaise: 500000,
    maxCumulativeRefundPaise: 2000000,
    currentCumulativeDailyPaise: 0
  };

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 5000 });
    await PolicyDecision.syncIndexes();
    await PaymentAction.syncIndexes();
    await PaymentCase.syncIndexes();
    await GatewayPayment.syncIndexes();
    await MerchantOrder.syncIndexes();
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.db.dropDatabase().catch(() => {});
      await mongoose.disconnect();
    }
  });

  beforeEach(async () => {
    if (mongoose.connection.readyState === 1) {
      await PolicyDecision.deleteMany({});
      await PaymentAction.deleteMany({});
      await PaymentCase.deleteMany({});
      await GatewayPayment.deleteMany({});
      await MerchantOrder.deleteMany({});
    }

    // Seed test case in Tenant A (Captured payment, pending order)
    await PaymentCase.create({
      caseId: CASE_ID_A,
      tenantId: TENANT_A,
      customerId: "CUST-POL-001",
      gatewayPaymentId: "pay_pol_int_01",
      merchantOrderId: "ORD-POL-INT-01",
      discrepancyCategory: "STATUS_MISMATCH",
      resolutionCaseStatus: "CASE_INVESTIGATING",
      isSafeHold: false,
      customerDebitStatus: "DEBIT_VERIFIED"
    });

    await GatewayPayment.create({
      gatewayPaymentId: "pay_pol_int_01",
      tenantId: TENANT_A,
      status: "CAPTURED",
      amountPaise: 120000,
      currency: "INR",
      merchantOrderId: "ORD-POL-INT-01"
    });

    await MerchantOrder.create({
      merchantOrderId: "ORD-POL-INT-01",
      tenantId: TENANT_A,
      status: "PENDING",
      amountPaise: 120000,
      currency: "INR"
    });

    // Seed test case in Tenant B
    await PaymentCase.create({
      caseId: CASE_ID_B,
      tenantId: TENANT_B,
      customerId: "CUST-POL-002",
      gatewayPaymentId: "pay_pol_int_02",
      merchantOrderId: "ORD-POL-INT-02",
      discrepancyCategory: "STATUS_MISMATCH",
      resolutionCaseStatus: "CASE_INVESTIGATING",
      isSafeHold: false
    });
  });

  it("1. Persists PolicyDecision and PaymentAction to real MongoDB with valid schemas", async () => {
    const res = await evaluateAndSimulateResolution({
      tenantId: TENANT_A,
      caseId: CASE_ID_A,
      proposedActionType: "UPDATE_MERCHANT_LOCAL_LEDGER",
      idempotencyKey: "idem-pol-001",
      policyConfig: validPolicyConfig
    });

    expect(res.isDuplicate).toBe(false);
    expect(res.decision).toBeDefined();
    expect(res.decision.decisionId).toMatch(/^DEC-/);
    expect(res.decision.tenantId).toBe(TENANT_A);
    expect(res.decision.caseId).toBe(CASE_ID_A);
    expect(res.decision.outcomeStatus).toBe("ELIGIBLE_FOR_SIMULATION");
    expect(res.decision.isExecutable).toBe(false);
    expect(res.decision.executionState).toBe("NON_EXECUTABLE_SIMULATION");

    // Verify DB retrieval of PolicyDecision
    const fetchedDecision = await PolicyDecision.findOne({ decisionId: res.decision.decisionId }).lean();
    expect(fetchedDecision).not.toBeNull();
    expect(fetchedDecision.idempotencyKey).toBe("idem-pol-001");
    expect(fetchedDecision.simulationResult.simulatedStep).toBe("MERCHANT_ORDER_REPAIR_SIMULATED");

    // Verify DB retrieval of PaymentAction
    const fetchedAction = await PaymentAction.findOne({ actionId: res.decision.actionId }).lean();
    expect(fetchedAction).not.toBeNull();
    expect(fetchedAction.actionStatus).toBe("SIMULATED");
    expect(fetchedAction.actionType).toBe("UPDATE_MERCHANT_LOCAL_LEDGER");
  });

  it("2. Enforces idempotency: repeated request with same key and identical inputs returns cached decision without duplicate writes", async () => {
    const idempotencyKey = "idem-repeat-001";

    const res1 = await evaluateAndSimulateResolution({
      tenantId: TENANT_A,
      caseId: CASE_ID_A,
      proposedActionType: "UPDATE_MERCHANT_LOCAL_LEDGER",
      idempotencyKey,
      policyConfig: validPolicyConfig
    });

    const res2 = await evaluateAndSimulateResolution({
      tenantId: TENANT_A,
      caseId: CASE_ID_A,
      proposedActionType: "UPDATE_MERCHANT_LOCAL_LEDGER",
      idempotencyKey,
      policyConfig: validPolicyConfig
    });

    expect(res1.isDuplicate).toBe(false);
    expect(res2.isDuplicate).toBe(true);
    expect(res2.decision.decisionId).toBe(res1.decision.decisionId);

    const decisionCount = await PolicyDecision.countDocuments({ tenantId: TENANT_A, idempotencyKey });
    expect(decisionCount).toBe(1);

    const actionCount = await PaymentAction.countDocuments({ tenantId: TENANT_A, idempotencyKey });
    expect(actionCount).toBe(1);
  });

  it("3. Reusing same idempotencyKey with materially different inputs produces a controlled 409 conflict", async () => {
    const idempotencyKey = "idem-conflict-001";

    await evaluateAndSimulateResolution({
      tenantId: TENANT_A,
      caseId: CASE_ID_A,
      proposedActionType: "UPDATE_MERCHANT_LOCAL_LEDGER",
      idempotencyKey,
      policyConfig: validPolicyConfig
    });

    // Attempt with different proposedActionType
    await expect(
      evaluateAndSimulateResolution({
        tenantId: TENANT_A,
        caseId: CASE_ID_A,
        proposedActionType: "WAIT_AND_MONITOR", // Different input!
        idempotencyKey,
        policyConfig: validPolicyConfig
      })
    ).rejects.toThrow(/already used with materially different parameters/i);
  });

  it("4. Enforces row-level tenant isolation in getDecisionsByCaseId", async () => {
    await evaluateAndSimulateResolution({
      tenantId: TENANT_A,
      caseId: CASE_ID_A,
      proposedActionType: "UPDATE_MERCHANT_LOCAL_LEDGER",
      idempotencyKey: "idem-tenant-iso-001",
      policyConfig: validPolicyConfig
    });

    // Query under Tenant A: returns 1
    const decisionsA = await getDecisionsByCaseId(CASE_ID_A, TENANT_A);
    expect(decisionsA).toHaveLength(1);

    // Query under Tenant B: returns 0 (cannot cross tenant boundary)
    const decisionsB = await getDecisionsByCaseId(CASE_ID_A, TENANT_B);
    expect(decisionsB).toHaveLength(0);
  });

  it("5. Non-executability invariant: Policy evaluation and simulation do NOT mutate GatewayPayment, MerchantOrder, or PaymentCase", async () => {
    const paymentBefore = await GatewayPayment.findOne({ gatewayPaymentId: "pay_pol_int_01", tenantId: TENANT_A }).lean();
    const orderBefore = await MerchantOrder.findOne({ merchantOrderId: "ORD-POL-INT-01", tenantId: TENANT_A }).lean();
    const caseBefore = await PaymentCase.findOne({ caseId: CASE_ID_A, tenantId: TENANT_A }).lean();

    await evaluateAndSimulateResolution({
      tenantId: TENANT_A,
      caseId: CASE_ID_A,
      proposedActionType: "UPDATE_MERCHANT_LOCAL_LEDGER",
      idempotencyKey: "idem-immut-001",
      policyConfig: validPolicyConfig
    });

    const paymentAfter = await GatewayPayment.findOne({ gatewayPaymentId: "pay_pol_int_01", tenantId: TENANT_A }).lean();
    const orderAfter = await MerchantOrder.findOne({ merchantOrderId: "ORD-POL-INT-01", tenantId: TENANT_A }).lean();
    const caseAfter = await PaymentCase.findOne({ caseId: CASE_ID_A, tenantId: TENANT_A }).lean();

    // Verify canonical state and amounts are 100% pristine
    expect(paymentAfter.status).toBe(paymentBefore.status);
    expect(paymentAfter.amountPaise).toBe(paymentBefore.amountPaise);
    expect(orderAfter.status).toBe(orderBefore.status); // Still PENDING, not mutated
    expect(orderAfter.amountPaise).toBe(orderBefore.amountPaise);
    expect(caseAfter.resolutionCaseStatus).toBe(caseBefore.resolutionCaseStatus);
    expect(caseAfter.isSafeHold).toBe(caseBefore.isSafeHold);
  });

  it("6. Concurrent simulation requests with identical idempotencyKey resolve without race-condition duplicates", async () => {
    const idempotencyKey = "idem-concurrent-001";

    const promises = Array.from({ length: 5 }, () =>
      evaluateAndSimulateResolution({
        tenantId: TENANT_A,
        caseId: CASE_ID_A,
        proposedActionType: "WAIT_AND_MONITOR",
        idempotencyKey,
        policyConfig: validPolicyConfig
      })
    );

    const results = await Promise.all(promises);

    // Exactly one was first (isDuplicate === false), others were duplicates (isDuplicate === true)
    const duplicates = results.filter((r) => r.isDuplicate);
    const nonDuplicates = results.filter((r) => !r.isDuplicate);

    expect(nonDuplicates).toHaveLength(1);
    expect(duplicates).toHaveLength(4);

    const totalDecisions = await PolicyDecision.countDocuments({ tenantId: TENANT_A, idempotencyKey });
    expect(totalDecisions).toBe(1);
  });

  it("7. Case 22 (Late capture on cancelled order) persists SAFE_HOLD and HELD_IN_SAFE_HOLD action status with unmutated order", async () => {
    // Update order in Tenant A to CANCELLED
    await MerchantOrder.updateOne({ merchantOrderId: "ORD-POL-INT-01", tenantId: TENANT_A }, { status: "CANCELLED" });
    await PaymentCase.updateOne({ caseId: CASE_ID_A, tenantId: TENANT_A }, { discrepancyCategory: "CASE_22_CANCELLED_ORDER_CAPTURED" });

    const res = await evaluateAndSimulateResolution({
      tenantId: TENANT_A,
      caseId: CASE_ID_A,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 120000,
      idempotencyKey: "idem-case22-hold-001",
      policyConfig: validPolicyConfig
    });

    expect(res.decision.outcomeStatus).toBe("SAFE_HOLD");
    expect(res.decision.appliedRuleIds).toContain("R_LATE_CAPTURE_CANCELLED_ORDER_HOLD");

    // Verify persisted PaymentAction has actionStatus === "HELD_IN_SAFE_HOLD"
    const fetchedAction = await PaymentAction.findOne({ actionId: res.decision.actionId }).lean();
    expect(fetchedAction).not.toBeNull();
    expect(fetchedAction.actionStatus).toBe("HELD_IN_SAFE_HOLD");

    // Verify order remains CANCELLED and unmutated
    const orderAfter = await MerchantOrder.findOne({ merchantOrderId: "ORD-POL-INT-01", tenantId: TENANT_A }).lean();
    expect(orderAfter.status).toBe("CANCELLED");
  });

  it("8. In-flight simulated refund commitments prevent subsequent simulations from exceeding available balance", async () => {
    // Payment is 120000 paise (₹1,200). Order is RETURN_APPROVED (not cancelled)
    await MerchantOrder.updateOne({ merchantOrderId: "ORD-POL-INT-01", tenantId: TENANT_A }, { status: "RETURN_APPROVED" });

    // First simulation: simulate ₹1,000 (100000 paise) refund
    const res1 = await evaluateAndSimulateResolution({
      tenantId: TENANT_A,
      caseId: CASE_ID_A,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 100000,
      idempotencyKey: "idem-inflight-001",
      policyConfig: validPolicyConfig,
      providedEvidence: {
        paymentCase: { caseId: CASE_ID_A, tenantId: TENANT_A, gatewayPaymentId: "pay_pol_int_01", merchantOrderId: "ORD-POL-INT-01" },
        gatewayPayment: { gatewayPaymentId: "pay_pol_int_01", tenantId: TENANT_A, status: "CAPTURED", amountPaise: 120000, currency: "INR" },
        merchantOrder: { merchantOrderId: "ORD-POL-INT-01", tenantId: TENANT_A, status: "RETURN_APPROVED", amountPaise: 120000, currency: "INR" },
        inFlightCommitmentsPaise: 0
      }
    });

    expect(res1.decision.outcomeStatus).toBe("ELIGIBLE_FOR_SIMULATION");

    // Second simulation: attempts ₹500 (50000 paise), but remaining available is ₹200 (120000 - 100000 = 20000)
    // The service queries existing simulated actions (100000 in-flight)
    const res2 = await evaluateAndSimulateResolution({
      tenantId: TENANT_A,
      caseId: CASE_ID_A,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 50000,
      idempotencyKey: "idem-inflight-002",
      policyConfig: validPolicyConfig,
      providedEvidence: {
        paymentCase: { caseId: CASE_ID_A, tenantId: TENANT_A, gatewayPaymentId: "pay_pol_int_01", merchantOrderId: "ORD-POL-INT-01" },
        gatewayPayment: { gatewayPaymentId: "pay_pol_int_01", tenantId: TENANT_A, status: "CAPTURED", amountPaise: 120000, currency: "INR" },
        merchantOrder: { merchantOrderId: "ORD-POL-INT-01", tenantId: TENANT_A, status: "RETURN_APPROVED", amountPaise: 120000, currency: "INR" },
        inFlightCommitmentsPaise: 100000 // In-flight commitment from previous simulation
      }
    });

    expect(res2.decision.outcomeStatus).toBe("REJECTED_BY_POLICY");
    expect(res2.decision.appliedRuleIds).toContain("R_REFUND_EXCEEDS_REFUNDABLE_BALANCE");
  });

  it("9. Caller-supplied approval flags in providedEvidence cannot bypass Case 22 safe hold in MongoDB", async () => {
    await MerchantOrder.updateOne({ merchantOrderId: "ORD-POL-INT-01", tenantId: TENANT_A }, { status: "CANCELLED" });
    await PaymentCase.updateOne({ caseId: CASE_ID_A, tenantId: TENANT_A }, { discrepancyCategory: "CASE_22_CANCELLED_ORDER_CAPTURED" });

    const res = await evaluateAndSimulateResolution({
      tenantId: TENANT_A,
      caseId: CASE_ID_A,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 120000,
      idempotencyKey: "idem-case22-forged-001",
      policyConfig: validPolicyConfig,
      advisoryAiSuggestion: "ADVISORY_REFUND_IMMEDIATELY",
      providedEvidence: {
        paymentCase: { caseId: CASE_ID_A, tenantId: TENANT_A, gatewayPaymentId: "pay_pol_int_01", merchantOrderId: "ORD-POL-INT-01" },
        gatewayPayment: { gatewayPaymentId: "pay_pol_int_01", tenantId: TENANT_A, status: "CAPTURED", amountPaise: 120000, currency: "INR" },
        merchantOrder: { merchantOrderId: "ORD-POL-INT-01", tenantId: TENANT_A, status: "CANCELLED", amountPaise: 120000, currency: "INR" },
        approvedCancellationRefund: true,
        adminApproval: { approved: true, actorId: "malicious_admin" }
      }
    });

    expect(res.decision.outcomeStatus).toBe("SAFE_HOLD");
    expect(res.decision.appliedRuleIds).toContain("R_LATE_CAPTURE_CANCELLED_ORDER_HOLD");

    const fetchedAction = await PaymentAction.findOne({ actionId: res.decision.actionId }).lean();
    expect(fetchedAction.actionStatus).toBe("HELD_IN_SAFE_HOLD");
    expect(fetchedAction.reasonCode).toBe("R_LATE_CAPTURE_CANCELLED_ORDER_HOLD");

    const orderAfter = await MerchantOrder.findOne({ merchantOrderId: "ORD-POL-INT-01", tenantId: TENANT_A }).lean();
    expect(orderAfter.status).toBe("CANCELLED");
  });

  it("10. Missing policyConfig fails closed in MongoDB integration with INSUFFICIENT_EVIDENCE", async () => {
    // When no policy configuration is supplied, refund evaluation fails closed
    const res = await evaluateAndSimulateResolution({
      tenantId: TENANT_A,
      caseId: CASE_ID_A,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 120000,
      idempotencyKey: "idem-missing-config-001",
      policyConfig: null // No approved limits supplied
    });

    expect(res.decision.outcomeStatus).toBe("INSUFFICIENT_EVIDENCE");
    expect(res.decision.appliedRuleIds).toContain("R_REFUND_LIMITS_MISSING_FAIL_CLOSED");
    expect(res.decision.missingEvidence).toContain("POLICY_CONFIG");

    // Action status is recorded as REJECTED_BY_POLICY
    const fetchedAction = await PaymentAction.findOne({ actionId: res.decision.actionId }).lean();
    expect(fetchedAction.actionStatus).toBe("REJECTED_BY_POLICY");
  });

  it("11. Unsupported or stale policyVersion is rejected before decision persistence", async () => {
    await expect(
      evaluateAndSimulateResolution({
        tenantId: TENANT_A,
        caseId: CASE_ID_A,
        proposedActionType: "WAIT_AND_MONITOR",
        idempotencyKey: "idem-unsupported-ver-001",
        policyVersion: "stale-v0"
      })
    ).rejects.toThrow(/Policy version 'stale-v0' is unsupported/i);

    // Verify zero decisions persisted for this idempotency key
    const count = await PolicyDecision.countDocuments({ idempotencyKey: "idem-unsupported-ver-001" });
    expect(count).toBe(0);
  });
});
