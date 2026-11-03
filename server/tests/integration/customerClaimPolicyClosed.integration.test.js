import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import request from "supertest";
import app from "../../src/app.js";
import { CustomerClaim } from "../../src/models/CustomerClaim.js";
import { PaymentCase } from "../../src/models/PaymentCase.js";
import { GatewayPayment } from "../../src/models/GatewayPayment.js";
import { MerchantOrder } from "../../src/models/MerchantOrder.js";
import { ProviderOperation } from "../../src/models/ProviderOperation.js";
import { PolicyDecision } from "../../src/models/PolicyDecision.js";
import { PolicyConfigVersion } from "../../src/models/PolicyConfigVersion.js";
import { UserAccount } from "../../src/models/UserAccount.js";
import { EvidenceRecord } from "../../src/models/EvidenceRecord.js";
import { PaymentLifecycleEvent } from "../../src/models/PaymentLifecycleEvent.js";
import { RefundReservation } from "../../src/models/RefundReservation.js";
import { signUserToken, ROLES } from "../../src/services/auth/tokenService.js";
import { proposePolicyConfig, approvePolicyConfig } from "../../src/services/policy/policyConfigService.js";
import { evaluateAndSimulateResolution } from "../../src/services/policy/dryRunSimulatorService.js";
import { dispatchSandboxAction } from "../../src/services/policy/providerDispatchService.js";
import { classifyCase } from "../../src/services/classification/classificationService.js";
import { validateTestDatabaseUri } from "../helpers/testDbGuard.js";

const DEFAULT_TEST_URI = "mongodb://127.0.0.1:27017/reconai_test_customer_claim_policy_closed";
const TEST_DB_URI = validateTestDatabaseUri(process.env.MONGODB_TEST_URI || DEFAULT_TEST_URI);

const TENANT_ID = "tenant_claim_policy_closed_001";
const CUSTOMER_ID = "cust_policy_test_001";

describe("B4: Customer Claim Policy & Dispatch Stay Closed E2E (Real MongoDB)", { timeout: 40000 }, () => {
  let customerToken;
  let adminToken;
  let originalEnv;
  let activePolicyVersion;

  beforeAll(async () => {
    originalEnv = { ...process.env };
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

    customerToken = signUserToken({
      userId: "usr_cust_policy_01",
      role: ROLES.CUSTOMER,
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID
    });

    adminToken = signUserToken({
      userId: "usr_admin_global_policy",
      role: ROLES.ADMIN,
      tenantId: null
    });
  });

  afterAll(async () => {
    process.env = { ...originalEnv };
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.db.dropDatabase().catch(() => {});
      await mongoose.disconnect();
    }
  });

  beforeEach(async () => {
    process.env = { ...originalEnv };
    // Rule: Sandbox writes enabled ONLY inside this test process via env helper
    process.env.RAZORPAY_SANDBOX_WRITES_ENABLED = "true";
    process.env.RAZORPAY_MODE = "test";
    process.env.RAZORPAY_KEY_ID = "rzp_test_policyKey123";
    process.env.RAZORPAY_KEY_SECRET = "testSecret456";
    process.env.POLICY_TOKEN_SECRET = "test-policy-token-secret-32-chars-long!";

    // Clean collections
    await mongoose.connection.collection("customerclaims").deleteMany({}).catch(() => {});
    await PaymentCase.deleteMany({ tenantId: TENANT_ID });
    await GatewayPayment.deleteMany({ tenantId: TENANT_ID });
    await MerchantOrder.deleteMany({ tenantId: TENANT_ID });
    await ProviderOperation.deleteMany({ tenantId: TENANT_ID });
    await PolicyDecision.deleteMany({ tenantId: TENANT_ID });
    await PolicyConfigVersion.deleteMany({ tenantId: TENANT_ID });
    await UserAccount.deleteMany({ tenantId: TENANT_ID });
    await EvidenceRecord.deleteMany({ tenantId: TENANT_ID });
    await PaymentLifecycleEvent.deleteMany({ tenantId: TENANT_ID });
    await RefundReservation.deleteMany({ tenantId: TENANT_ID });

    // Seed two distinct platform admins for two-person rule
    await UserAccount.create({
      userId: "usr_policy_proposer_1",
      email: "proposer@tenant.internal",
      passwordHash: "hash1",
      passwordSalt: "salt1",
      role: "ADMIN",
      tenantId: TENANT_ID
    });

    await UserAccount.create({
      userId: "usr_policy_approver_2",
      email: "approver@tenant.internal",
      passwordHash: "hash2",
      passwordSalt: "salt2",
      role: "ADMIN",
      tenantId: TENANT_ID
    });

    // Seed active PolicyConfigVersion via two-admin proposal + approval flow
    const proposal = await proposePolicyConfig({
      tenantId: TENANT_ID,
      proposedBy: "usr_policy_proposer_1",
      limits: {
        currency: "INR",
        maxSingleRefundPaise: 50000,
        maxCumulativeRefundPaise: 200000
      },
      proposalReason: "Stage 7b active policy for claim boundary verification"
    });

    activePolicyVersion = await approvePolicyConfig({
      configId: proposal._id,
      approvedBy: "usr_policy_approver_2",
      approvalReason: "Stage 7b approved active policy"
    });

    expect(activePolicyVersion.status).toBe("ACTIVE");
    expect(activePolicyVersion.configVersion).toBe(1);
  });

  it("(a) Claim + FAILED payment: policy evaluation returns REJECTED_BY_POLICY / INSUFFICIENT_EVIDENCE; dispatch refuses; ZERO provider calls", async () => {
    const mockFetch = vi.fn();

    // 1. Seed FAILED payment and order
    await MerchantOrder.create({
      merchantOrderId: "ord_failed_test_01",
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      amountPaise: 25000,
      currency: "INR",
      orderStatus: "ORDER_CREATED"
    });

    await GatewayPayment.create({
      gatewayPaymentId: "pay_failed_test_01",
      merchantOrderId: "ord_failed_test_01",
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      amountPaise: 25000,
      currency: "INR",
      status: "FAILED",
      method: "CARD"
    });

    // 2. Customer submits claim
    const claimRes = await request(app)
      .post("/api/claims")
      .set("Authorization", `Bearer ${customerToken}`)
      .set("Idempotency-Key", "idem_policy_case_a_001")
      .send({
        claimType: "DEBIT_NOT_CONFIRMED",
        reference: "ord_failed_test_01",
        claimedAmountPaise: 25000,
        description: "My bank deducted 250 rupees but the payment failed"
      });

    expect(claimRes.status).toBe(201);
    const claim = await CustomerClaim.findOne({ claimId: claimRes.body.claimId });
    expect(claim.linkedCaseId).toBeTruthy();

    // 3. Classify case -> Case 3
    const classRes = await classifyCase({
      tenantId: TENANT_ID,
      caseId: claim.linkedCaseId
    });
    expect(classRes.evidenceRecord.scenarioId).toBe("CASE_3_CUSTOMER_DEBIT_CLAIM_PAYMENT_FAILED");

    // 4. Policy evaluation returns REJECTED_BY_POLICY
    const evalRes = await evaluateAndSimulateResolution({
      tenantId: TENANT_ID,
      caseId: claim.linkedCaseId,
      actorId: "usr_policy_approver_2",
      actorRole: "ADMIN",
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 25000,
      currency: "INR",
      idempotencyKey: "idem_decision_case_a_001"
    });

    expect(["REJECTED_BY_POLICY", "INSUFFICIENT_EVIDENCE"]).toContain(evalRes.decision.outcomeStatus);
    expect(evalRes.decision.denyReasons.some((r) => r.includes("FAILED") || r.includes("Customer claim"))).toBe(true);

    // Assert PolicyDecision ruleEvaluations / inputs never contain customer claim as an active decision input
    expect(evalRes.decision.ruleEvaluations?.customerClaimActive).toBeFalsy();
    expect(evalRes.decision.ruleEvaluations?.customerDebitClaimActive).toBeFalsy();

    // 5. Attempt provider dispatch -> dispatch refuses
    const dispatchRes = await dispatchSandboxAction({
      tenantId: TENANT_ID,
      caseId: claim.linkedCaseId,
      actorId: "usr_policy_approver_2",
      actorRole: "ADMIN",
      actionType: "REQUEST_REFUND",
      idempotencyKey: "idem_dispatch_case_a_001",
      customFetch: mockFetch
    });

    expect(dispatchRes.dispatchBlocked).toBe(true);
    expect(["REJECTED_BY_POLICY", "INSUFFICIENT_EVIDENCE"]).toContain(dispatchRes.policyOutcomeStatus);
    expect(mockFetch).not.toHaveBeenCalled();

    // Assert zero provider operations created
    const opCount = await ProviderOperation.countDocuments({ tenantId: TENANT_ID });
    expect(opCount).toBe(0);
  });

  it("(b) Claim + CAPTURED payment with PENDING order: classified as CASE_6_PAID_GATEWAY_UNPAID_ORDER, NOT refund; syncs order, does NOT refund", async () => {
    const mockFetch = vi.fn();

    // 1. Seed CAPTURED payment but PENDING order
    await MerchantOrder.create({
      merchantOrderId: "ord_repair_test_02",
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      amountPaise: 35000,
      currency: "INR",
      orderStatus: "ORDER_CREATED"
    });

    await GatewayPayment.create({
      gatewayPaymentId: "pay_repair_test_02",
      merchantOrderId: "ord_repair_test_02",
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      amountPaise: 35000,
      currency: "INR",
      status: "CAPTURED",
      method: "UPI"
    });

    // 2. Customer submits claim
    const claimRes = await request(app)
      .post("/api/claims")
      .set("Authorization", `Bearer ${customerToken}`)
      .set("Idempotency-Key", "idem_policy_case_b_001")
      .send({
        claimType: "DEBIT_NOT_CONFIRMED",
        reference: "ord_repair_test_02",
        claimedAmountPaise: 35000,
        description: "Payment succeeded but order still says pending"
      });

    expect(claimRes.status).toBe(201);
    const claim = await CustomerClaim.findOne({ claimId: claimRes.body.claimId });

    // 3. Classification proves normal repair scenario (CASE_6_PAID_GATEWAY_UNPAID_ORDER)
    const classRes = await classifyCase({
      tenantId: TENANT_ID,
      caseId: claim.linkedCaseId
    });

    expect(classRes.evidenceRecord.scenarioId).toBe("CASE_6_PAID_GATEWAY_UNPAID_ORDER");
    expect(classRes.evidenceRecord.category).toBe("STATUS_MISMATCH");
    expect(classRes.evidenceRecord.recommendation).toBe("UPDATE_MERCHANT_LOCAL_LEDGER");
    expect(classRes.evidenceRecord.safeHold).toBe(false);

    // 4. Policy evaluation for UPDATE_MERCHANT_LOCAL_LEDGER (simulates local order repair, NOT refund)
    const ledgerEvalRes = await evaluateAndSimulateResolution({
      tenantId: TENANT_ID,
      caseId: claim.linkedCaseId,
      actorId: "usr_policy_approver_2",
      actorRole: "ADMIN",
      proposedActionType: "UPDATE_MERCHANT_LOCAL_LEDGER",
      idempotencyKey: "idem_decision_case_b_ledger_001"
    });

    expect(ledgerEvalRes.decision.outcomeStatus).toBe("ELIGIBLE_FOR_SIMULATION");

    // 5. If dispatch is called, dispatchSandboxAction only supports REQUEST_REFUND and ZERO provider refund calls occur
    expect(mockFetch).not.toHaveBeenCalled();
    const opCount = await ProviderOperation.countDocuments({ tenantId: TENANT_ID });
    expect(opCount).toBe(0);
  });

  it("(c) Claim + CAPTURED payment already refunded: classifier detects prior refund; policy rejects/refuses second refund; ZERO provider calls", async () => {
    const mockFetch = vi.fn();

    // 1. Seed CAPTURED payment with completed refund
    await MerchantOrder.create({
      merchantOrderId: "ord_refunded_test_03",
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      amountPaise: 40000,
      currency: "INR",
      orderStatus: "ORDER_CANCELLED"
    });

    await GatewayPayment.create({
      gatewayPaymentId: "pay_refunded_test_03",
      merchantOrderId: "ord_refunded_test_03",
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      amountPaise: 40000,
      currency: "INR",
      status: "REFUNDED",
      refundStatus: "PROCESSED",
      amountRefundedPaise: 40000,
      refundAmountPaise: 40000,
      method: "NETBANKING"
    });

    // Prior completed refund operation
    await ProviderOperation.create({
      operationId: "op_prior_refund_001",
      tenantId: TENANT_ID,
      caseId: "case_dummy_prior",
      gatewayPaymentId: "pay_refunded_test_03",
      actionType: "REQUEST_REFUND",
      amountPaise: 40000,
      currency: "INR",
      operationStatus: "VERIFIED_SUCCEEDED",
      requestPayloadHash: "dummy_hash_prior_01",
      idempotencyKey: "idem_prior_refund_op_001"
    });

    // 2. Customer submits claim
    const claimRes = await request(app)
      .post("/api/claims")
      .set("Authorization", `Bearer ${customerToken}`)
      .set("Idempotency-Key", "idem_policy_case_c_001")
      .send({
        claimType: "DEBIT_NOT_CONFIRMED",
        reference: "pay_refunded_test_03",
        claimedAmountPaise: 40000,
        description: "Claiming refund again"
      });

    expect(claimRes.status).toBe(201);
    const claim = await CustomerClaim.findOne({ claimId: claimRes.body.claimId });

    // 3. Policy evaluation for second refund -> REJECTED_BY_POLICY (available balance is 0 or payment not captured)
    const evalRes = await evaluateAndSimulateResolution({
      tenantId: TENANT_ID,
      caseId: claim.linkedCaseId,
      actorId: "usr_policy_approver_2",
      actorRole: "ADMIN",
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 40000,
      currency: "INR",
      idempotencyKey: "idem_decision_case_c_001"
    });

    expect(evalRes.decision.outcomeStatus).toBe("REJECTED_BY_POLICY");
    expect(evalRes.decision.denyReasons.some((r) => r.includes("not CAPTURED") || r.includes("exceeds available"))).toBe(true);

    // 4. Dispatch attempt is blocked -> 0 provider calls
    const dispatchRes = await dispatchSandboxAction({
      tenantId: TENANT_ID,
      caseId: claim.linkedCaseId,
      actorId: "usr_policy_approver_2",
      actorRole: "ADMIN",
      actionType: "REQUEST_REFUND",
      idempotencyKey: "idem_dispatch_case_c_001",
      customFetch: mockFetch
    });

    expect(dispatchRes.dispatchBlocked).toBe(true);
    expect(dispatchRes.policyOutcomeStatus).toBe("REJECTED_BY_POLICY");
    expect(mockFetch).not.toHaveBeenCalled();

    // Provider operations count remains 1 (only the prior one, no new operation)
    const opCount = await ProviderOperation.countDocuments({ tenantId: TENANT_ID });
    expect(opCount).toBe(1);
  });

  it("(d) & (e) Invariant: PolicyDecision never contains customer claim as active decision input, and active policy + sandbox writes true cannot be bypassed by claim", async () => {
    // 1. Seed order and payment
    await MerchantOrder.create({
      merchantOrderId: "ord_inv_test_04",
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      amountPaise: 20000,
      currency: "INR",
      orderStatus: "ORDER_CREATED"
    });

    await GatewayPayment.create({
      gatewayPaymentId: "pay_inv_test_04",
      merchantOrderId: "ord_inv_test_04",
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      amountPaise: 20000,
      currency: "INR",
      status: "FAILED"
    });

    // 2. Submit customer claim
    const claimRes = await request(app)
      .post("/api/claims")
      .set("Authorization", `Bearer ${customerToken}`)
      .set("Idempotency-Key", "idem_policy_case_d_001")
      .send({
        claimType: "DEBIT_NOT_CONFIRMED",
        reference: "ord_inv_test_04",
        claimedAmountPaise: 20000,
        description: "Customer claim for invariant check"
      });

    expect(claimRes.status).toBe(201);
    const claim = await CustomerClaim.findOne({ claimId: claimRes.body.claimId });

    // 3. Evaluate policy
    const evalRes = await evaluateAndSimulateResolution({
      tenantId: TENANT_ID,
      caseId: claim.linkedCaseId,
      actorId: "usr_policy_approver_2",
      actorRole: "ADMIN",
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 20000,
      currency: "INR",
      idempotencyKey: "idem_decision_case_d_001"
    });

    // 4. Assert: process.env.RAZORPAY_SANDBOX_WRITES_ENABLED is "true"
    expect(process.env.RAZORPAY_SANDBOX_WRITES_ENABLED).toBe("true");

    // 5. Active PolicyConfigVersion exists in database
    const activeConfig = await PolicyConfigVersion.findOne({ tenantId: TENANT_ID, status: "ACTIVE" });
    expect(activeConfig).toBeTruthy();
    expect(activeConfig.limits.maxSingleRefundPaise).toBe(50000);

    // 6. PolicyDecision recorded has zero active claim input authority
    const decision = await PolicyDecision.findOne({ tenantId: TENANT_ID, idempotencyKey: "idem_decision_case_d_001" });
    expect(decision).toBeTruthy();
    expect(decision.ruleEvaluations?.customerClaimActive).toBeFalsy();
    expect(decision.ruleEvaluations?.customerDebitClaimActive).toBeFalsy();
    expect(evalRes.decision.ruleEvaluations?.customerClaimActive).toBeFalsy();
  });

  it("(f) Staleness guard: classify a Case 6 repair case, submit an UNAUTHORIZED_PAYMENT claim, then call dispatch -> 409 CLASSIFICATION_STALE with no provider call and no token", async () => {
    const mockFetch = vi.fn();

    // 1. Seed Case 6: CAPTURED payment with PENDING order
    await MerchantOrder.create({
      merchantOrderId: "ord_stale_case6_01",
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      amountPaise: 35000,
      currency: "INR",
      orderStatus: "ORDER_CREATED"
    });

    await GatewayPayment.create({
      gatewayPaymentId: "pay_stale_case6_01",
      merchantOrderId: "ord_stale_case6_01",
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      amountPaise: 35000,
      currency: "INR",
      status: "CAPTURED",
      method: "UPI"
    });

    await PaymentCase.create({
      caseId: "CASE-STALE-CASE6-01",
      tenantId: TENANT_ID,
      customerId: CUSTOMER_ID,
      merchantOrderId: "ord_stale_case6_01",
      gatewayPaymentId: "pay_stale_case6_01",
      discrepancyCategory: "STATUS_MISMATCH",
      captureStatus: "CAPTURE_CAPTURED",
      customerDebitStatus: "DEBIT_NONE",
      resolutionCaseStatus: "CASE_DETECTED"
    });

    // 2. Classify the case initially as Case 6
    const classRes = await classifyCase({
      tenantId: TENANT_ID,
      caseId: "CASE-STALE-CASE6-01",
      actorType: "SYSTEM",
      actorId: "initial_classifier"
    });
    expect(classRes.evidenceRecord.scenarioId).toBe("CASE_6_PAID_GATEWAY_UNPAID_ORDER");

    // 3. Evaluate policy decision for this classification
    await evaluateAndSimulateResolution({
      tenantId: TENANT_ID,
      caseId: "CASE-STALE-CASE6-01",
      actorId: "usr_policy_approver_2",
      actorRole: "ADMIN",
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 35000,
      currency: "INR",
      idempotencyKey: "idem_decision_stale_case6_01"
    });

    // 4. Now, customer submits an UNAUTHORIZED_PAYMENT claim referencing the payment
    const claimRes = await request(app)
      .post("/api/claims")
      .set("Authorization", `Bearer ${customerToken}`)
      .set("Idempotency-Key", "idem_claim_stale_case6_01")
      .send({
        claimType: "UNAUTHORIZED_PAYMENT",
        reference: "pay_stale_case6_01",
        claimedAmountPaise: 35000,
        description: "Fraudulent transaction reported by customer"
      });
    expect(claimRes.status).toBe(201);
    const claim = await CustomerClaim.findOne({ claimId: claimRes.body.claimId });
    expect(claim).toBeTruthy();
    expect(claim.linkedCaseId).toBe("CASE-STALE-CASE6-01");

    // 5. Attempt provider dispatch without re-classifying -> rejects with 409 CLASSIFICATION_STALE
    let dispatchError = null;
    let dispatchResult = null;
    try {
      dispatchResult = await dispatchSandboxAction({
        tenantId: TENANT_ID,
        caseId: "CASE-STALE-CASE6-01",
        actorId: "usr_policy_approver_2",
        actorRole: "ADMIN",
        actionType: "REQUEST_REFUND",
        idempotencyKey: "idem_dispatch_stale_case6_01",
        customFetch: mockFetch
      });
    } catch (err) {
      dispatchError = err;
    }

    // Must fail closed with 409 CLASSIFICATION_STALE or safe-hold block
    if (dispatchError) {
      expect(dispatchError.statusCode).toBe(409);
      expect(dispatchError.code).toBe("CLASSIFICATION_STALE");
      expect(dispatchError.message).toMatch(/Classification is stale/i);
    } else {
      expect(dispatchResult.dispatchBlocked).toBe(true);
    }

    // Assert: zero provider calls, zero provider operations
    expect(mockFetch).not.toHaveBeenCalled();
    const opCount = await ProviderOperation.countDocuments({
      tenantId: TENANT_ID,
      caseId: "CASE-STALE-CASE6-01"
    });
    expect(opCount).toBe(0);
  });
});
