import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import { PaymentCase } from "../../src/models/PaymentCase.js";
import { GatewayPayment } from "../../src/models/GatewayPayment.js";
import { MerchantOrder } from "../../src/models/MerchantOrder.js";
import { ProviderOperation } from "../../src/models/ProviderOperation.js";
import { SettlementRecord } from "../../src/models/SettlementRecord.js";
import { PaymentLifecycleEvent } from "../../src/models/PaymentLifecycleEvent.js";
import { EvidenceRecord } from "../../src/models/EvidenceRecord.js";
import { AuditLog } from "../../src/models/AuditLog.js";
import { PolicyDecision } from "../../src/models/PolicyDecision.js";
import { PolicyConfigVersion, computePolicyConfigHash } from "../../src/models/PolicyConfigVersion.js";
import { buildClassifierContext } from "../../src/services/classification/classifierContextBuilder.js";
import { classifyCase } from "../../src/services/classification/classificationService.js";
import { executeAuthorizedDispatch } from "../../src/services/policy/providerDispatchService.js";
import * as auditService from "../../src/services/audit/auditService.js";
import { validateTestDatabaseUri } from "../helpers/testDbGuard.js";
import { ROLES } from "../../src/services/auth/tokenService.js";

const DEFAULT_TEST_URI = "mongodb://127.0.0.1:27017/reconai_test_classifier_db_driven";
const TEST_DB_URI = validateTestDatabaseUri(process.env.MONGODB_TEST_URI || DEFAULT_TEST_URI);

const TENANT_A = "tenant_db_classifier_alpha";
const TENANT_B = "tenant_db_classifier_beta";

describe("Database-Driven Classifier Context & Reachability (Real MongoDB Integration)", { timeout: 35000 }, () => {
  const actor = {
    userId: "usr_admin_db_tester",
    role: ROLES.ADMIN,
    tenantId: TENANT_A
  };

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 5000 });
  });

  afterAll(async () => {
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.db.dropDatabase().catch(() => {});
      await mongoose.disconnect();
    }
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    if (mongoose.connection.readyState === 1) {
      await Promise.all([
        PaymentCase.deleteMany({}),
        GatewayPayment.deleteMany({}),
        MerchantOrder.deleteMany({}),
        ProviderOperation.deleteMany({}),
        SettlementRecord.deleteMany({}),
        PaymentLifecycleEvent.deleteMany({}),
        EvidenceRecord.deleteMany({}),
        AuditLog.deleteMany({}),
        PolicyDecision.deleteMany({}),
        PolicyConfigVersion.deleteMany({})
      ]);
    }
  });

  // =========================================================================
  // 1. SCENARIOS PROVEN FROM DATABASE ALONE (B5/B6)
  // =========================================================================

  it("1. PROVEN_FROM_DB: Case 6 — CASE_6_PAID_GATEWAY_UNPAID_ORDER", async () => {
    await PaymentCase.create({
      caseId: "CASE-SCN-06",
      tenantId: TENANT_A,
      status: "OPEN",
      discrepancyCategory: "STATUS_MISMATCH",
      gatewayPaymentId: "pay_scn_06",
      merchantOrderId: "ord_scn_06"
    });

    await GatewayPayment.create({
      gatewayPaymentId: "pay_scn_06",
      tenantId: TENANT_A,
      amountPaise: 10000,
      currency: "INR",
      status: "CAPTURED",
      method: "UPI"
    });

    await MerchantOrder.create({
      merchantOrderId: "ord_scn_06",
      tenantId: TENANT_A,
      amountPaise: 10000,
      currency: "INR",
      status: "CREATED"
    });

    const res = await classifyCase({ tenantId: TENANT_A, caseId: "CASE-SCN-06", actor });
    expect(res.finding.scenarioId).toBe("CASE_6_PAID_GATEWAY_UNPAID_ORDER");
    expect(res.finding.safeHold).toBe(false);
    expect(res.finding.safeHoldCode).toBe("NONE");
    expect(res.evidenceRecord).toBeDefined();
    expect(res.inputHash).toBeDefined();
    expect(res.provenance.gatewayPayment.collection).toBe("gatewaypayments");
    expect(res.provenance.merchantOrder.collection).toBe("merchantorders");
  });

  it("2. PROVEN_FROM_DB: Case 22 — CASE_22_PAYMENT_CAPTURED_ORDER_CANCELLED (Safe-Hold)", async () => {
    await PaymentCase.create({
      caseId: "CASE-SCN-22",
      tenantId: TENANT_A,
      status: "OPEN",
      discrepancyCategory: "STATUS_MISMATCH",
      gatewayPaymentId: "pay_scn_22",
      merchantOrderId: "ord_scn_22"
    });

    await GatewayPayment.create({
      gatewayPaymentId: "pay_scn_22",
      tenantId: TENANT_A,
      amountPaise: 10000,
      currency: "INR",
      status: "CAPTURED",
      method: "CARD"
    });

    await MerchantOrder.create({
      merchantOrderId: "ord_scn_22",
      tenantId: TENANT_A,
      amountPaise: 10000,
      currency: "INR",
      status: "CANCELLED"
    });

    const res = await classifyCase({ tenantId: TENANT_A, caseId: "CASE-SCN-22", actor });
    expect(res.finding.scenarioId).toBe("CASE_22_PAYMENT_CAPTURED_ORDER_CANCELLED");
    expect(res.finding.safeHold).toBe(true);
    expect(res.finding.safeHoldCode).toBe("LATE_CAPTURE_CANCELLED_ORDER");
  });

  it("3. PROVEN_FROM_DB: Case 19 — CASE_19_AMOUNT_OR_CURRENCY_MISMATCH (Safe-Hold)", async () => {
    await PaymentCase.create({
      caseId: "CASE-SCN-19",
      tenantId: TENANT_A,
      status: "OPEN",
      discrepancyCategory: "AMOUNT_CURRENCY_MISMATCH",
      gatewayPaymentId: "pay_scn_19",
      merchantOrderId: "ord_scn_19"
    });

    await GatewayPayment.create({
      gatewayPaymentId: "pay_scn_19",
      tenantId: TENANT_A,
      amountPaise: 10000,
      currency: "INR",
      status: "CAPTURED",
      method: "UPI"
    });

    await MerchantOrder.create({
      merchantOrderId: "ord_scn_19",
      tenantId: TENANT_A,
      amountPaise: 15000,
      currency: "INR",
      status: "PAID"
    });

    const res = await classifyCase({ tenantId: TENANT_A, caseId: "CASE-SCN-19", actor });
    expect(res.finding.scenarioId).toBe("CASE_19_AMOUNT_OR_CURRENCY_MISMATCH");
    expect(res.finding.safeHold).toBe(true);
    expect(res.finding.safeHoldCode).toBe("AMOUNT_CURRENCY_MISMATCH");
  });

  it("4. PROVEN_FROM_DB: Case 7 — CASE_7_DUPLICATE_PAYMENT_ATTEMPTS (Safe-Hold)", async () => {
    await PaymentCase.create({
      caseId: "CASE-SCN-07",
      tenantId: TENANT_A,
      status: "OPEN",
      discrepancyCategory: "DUPLICATE_PAYMENT",
      gatewayPaymentId: "pay_scn_07_a",
      merchantOrderId: "ord_scn_07"
    });

    await GatewayPayment.create([
      {
        gatewayPaymentId: "pay_scn_07_a",
        tenantId: TENANT_A,
        merchantOrderId: "ord_scn_07",
        amountPaise: 5000,
        currency: "INR",
        status: "CAPTURED",
        method: "UPI"
      },
      {
        gatewayPaymentId: "pay_scn_07_b",
        tenantId: TENANT_A,
        merchantOrderId: "ord_scn_07",
        amountPaise: 6000, // Differing amounts triggers safe-hold rule
        currency: "INR",
        status: "CAPTURED",
        method: "UPI"
      }
    ]);

    await MerchantOrder.create({
      merchantOrderId: "ord_scn_07",
      tenantId: TENANT_A,
      amountPaise: 5000,
      currency: "INR",
      status: "PAID"
    });

    const res = await classifyCase({ tenantId: TENANT_A, caseId: "CASE-SCN-07", actor });
    expect(res.finding.scenarioId).toBe("CASE_7_DUPLICATE_PAYMENT_ATTEMPTS");
    expect(res.finding.safeHold).toBe(true);
    expect(res.finding.safeHoldCode).toBe("DUPLICATE_PAYMENT_AMOUNTS_DIFFER");
  });

  it("5. PROVEN_FROM_DB: Case 12 — CASE_12_FAILED_REFUND", async () => {
    await PaymentCase.create({
      caseId: "CASE-SCN-12",
      tenantId: TENANT_A,
      status: "OPEN",
      discrepancyCategory: "STATUS_MISMATCH",
      gatewayPaymentId: "pay_scn_12",
      merchantOrderId: "ord_scn_12"
    });

    await GatewayPayment.create({
      gatewayPaymentId: "pay_scn_12",
      tenantId: TENANT_A,
      amountPaise: 8000,
      currency: "INR",
      status: "CAPTURED",
      refundStatus: "FAILED",
      method: "UPI"
    });

    await MerchantOrder.create({
      merchantOrderId: "ord_scn_12",
      tenantId: TENANT_A,
      amountPaise: 8000,
      currency: "INR",
      status: "PAID"
    });

    await ProviderOperation.create({
      operationId: "op_ref_failed_12",
      tenantId: TENANT_A,
      caseId: "CASE-SCN-12",
      gatewayPaymentId: "pay_scn_12",
      operationType: "REFUND",
      operationStatus: "VERIFIED_FAILED",
      amountPaise: 8000,
      currency: "INR",
      idempotencyKey: "idem_ref_fail_12"
    });

    const res = await classifyCase({ tenantId: TENANT_A, caseId: "CASE-SCN-12", actor });
    expect(res.finding.scenarioId).toBe("CASE_12_FAILED_REFUND");
    expect(res.finding.safeHold).toBe(true);
    expect(res.finding.safeHoldCode).toBe("REFUND_FAILED");
  });

  it("6. PROVEN_FROM_DB: Case 11 — CASE_11_FULL_REFUND_INITIATED_NOT_COMPLETED", async () => {
    await PaymentCase.create({
      caseId: "CASE-SCN-11",
      tenantId: TENANT_A,
      status: "OPEN",
      discrepancyCategory: "STATUS_MISMATCH",
      gatewayPaymentId: "pay_scn_11",
      merchantOrderId: "ord_scn_11"
    });

    await GatewayPayment.create({
      gatewayPaymentId: "pay_scn_11",
      tenantId: TENANT_A,
      amountPaise: 8000,
      currency: "INR",
      status: "CAPTURED",
      refundStatus: "PENDING",
      method: "UPI"
    });

    await MerchantOrder.create({
      merchantOrderId: "ord_scn_11",
      tenantId: TENANT_A,
      amountPaise: 8000,
      currency: "INR",
      status: "PAID"
    });

    await ProviderOperation.create({
      operationId: "op_ref_pending_11",
      tenantId: TENANT_A,
      caseId: "CASE-SCN-11",
      gatewayPaymentId: "pay_scn_11",
      operationType: "REFUND",
      operationStatus: "REQUESTED",
      amountPaise: 8000,
      currency: "INR",
      idempotencyKey: "idem_ref_pend_11"
    });

    const res = await classifyCase({ tenantId: TENANT_A, caseId: "CASE-SCN-11", actor });
    expect(res.finding.scenarioId).toBe("CASE_11_FULL_REFUND_INITIATED_NOT_COMPLETED");
  });

  it("7. PROVEN_FROM_DB: Case 10 — CASE_10_PARTIAL_REFUND", async () => {
    await PaymentCase.create({
      caseId: "CASE-SCN-10",
      tenantId: TENANT_A,
      status: "OPEN",
      discrepancyCategory: "STATUS_MISMATCH",
      gatewayPaymentId: "pay_scn_10",
      merchantOrderId: "ord_scn_10"
    });

    await GatewayPayment.create({
      gatewayPaymentId: "pay_scn_10",
      tenantId: TENANT_A,
      amountPaise: 10000,
      currency: "INR",
      status: "CAPTURED",
      refundAmountPaise: 4000,
      method: "CARD"
    });

    await MerchantOrder.create({
      merchantOrderId: "ord_scn_10",
      tenantId: TENANT_A,
      amountPaise: 10000,
      currency: "INR",
      status: "PAID"
    });

    await SettlementRecord.create({
      settlementRecordId: "set_rec_10",
      settlementId: "SETTLE_10",
      tenantId: TENANT_A,
      entityId: "pay_scn_10",
      merchantOrderId: "ord_scn_10",
      grossAmountPaise: 10000,
      netAmountPaise: 9800,
      currency: "INR"
    });

    const res = await classifyCase({ tenantId: TENANT_A, caseId: "CASE-SCN-10", actor });
    expect(res.finding.scenarioId).toBe("CASE_10_PARTIAL_REFUND");
  });

  it("8. PROVEN_FROM_DB: Case 8 — CASE_8_PARTIAL_CAPTURE", async () => {
    await PaymentCase.create({
      caseId: "CASE-SCN-08",
      tenantId: TENANT_A,
      status: "OPEN",
      discrepancyCategory: "STATUS_MISMATCH",
      gatewayPaymentId: "pay_scn_08",
      merchantOrderId: "ord_scn_08"
    });

    await GatewayPayment.create({
      gatewayPaymentId: "pay_scn_08",
      tenantId: TENANT_A,
      amountPaise: 10000,
      amountAuthorizedPaise: 10000,
      capturedAmountPaise: 5000,
      currency: "INR",
      status: "CAPTURED",
      method: "CARD"
    });

    await MerchantOrder.create({
      merchantOrderId: "ord_scn_08",
      tenantId: TENANT_A,
      amountPaise: 10000,
      currency: "INR",
      status: "PARTIALLY_PAID"
    });

    const res = await classifyCase({ tenantId: TENANT_A, caseId: "CASE-SCN-08", actor });
    expect(res.finding.scenarioId).toBe("CASE_8_PARTIAL_CAPTURE");
    expect(res.finding.safeHold).toBe(true);
    expect(res.finding.safeHoldCode).toBe("PARTIAL_CAPTURE");
  });

  it("9. PROVEN_FROM_DB: Case 20 — CASE_20_DUPLICATE_SETTLEMENT_RECORD", async () => {
    await PaymentCase.create({
      caseId: "CASE-SCN-20",
      tenantId: TENANT_A,
      status: "OPEN",
      discrepancyCategory: "STATUS_MISMATCH",
      gatewayPaymentId: "pay_scn_20",
      merchantOrderId: "ord_scn_20"
    });

    await GatewayPayment.create({
      gatewayPaymentId: "pay_scn_20",
      tenantId: TENANT_A,
      amountPaise: 10000,
      currency: "INR",
      status: "CAPTURED",
      method: "UPI"
    });

    await SettlementRecord.create([
      {
        settlementRecordId: "set_rec_20_a",
        settlementId: "SETTLE_DUP_123",
        tenantId: TENANT_A,
        entityId: "pay_scn_20",
        merchantOrderId: "ord_scn_20",
        grossAmountPaise: 10000,
        netAmountPaise: 9800,
        currency: "INR"
      },
      {
        settlementRecordId: "set_rec_20_b",
        settlementId: "SETTLE_DUP_123",
        tenantId: TENANT_A,
        entityId: "pay_scn_20",
        merchantOrderId: "ord_scn_20",
        grossAmountPaise: 10000,
        netAmountPaise: 9800,
        currency: "INR"
      }
    ]);

    const res = await classifyCase({ tenantId: TENANT_A, caseId: "CASE-SCN-20", actor });
    expect(res.finding.scenarioId).toBe("CASE_20_DUPLICATE_SETTLEMENT_RECORD");
    expect(res.finding.safeHold).toBe(false);
  });

  it("10. PROVEN_FROM_DB: Case 21 — CASE_21_MISSING_SETTLEMENT_RECORD (Safe-Hold)", async () => {
    const sixDaysAgo = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000);

    await PaymentCase.create({
      caseId: "CASE-SCN-21",
      tenantId: TENANT_A,
      status: "OPEN",
      discrepancyCategory: "STATUS_MISMATCH",
      gatewayPaymentId: "pay_scn_21",
      merchantOrderId: "ord_scn_21"
    });

    await GatewayPayment.create({
      gatewayPaymentId: "pay_scn_21",
      tenantId: TENANT_A,
      amountPaise: 10000,
      currency: "INR",
      status: "CAPTURED",
      createdAt: sixDaysAgo,
      gatewayCreatedAt: sixDaysAgo,
      method: "UPI"
    });

    await MerchantOrder.create({
      merchantOrderId: "ord_scn_21",
      tenantId: TENANT_A,
      amountPaise: 10000,
      currency: "INR",
      status: "PAID"
    });

    const res = await classifyCase({ tenantId: TENANT_A, caseId: "CASE-SCN-21", actor });
    expect(res.finding.scenarioId).toBe("CASE_21_MISSING_SETTLEMENT_RECORD");
    expect(res.finding.safeHold).toBe(true);
    expect(res.finding.safeHoldCode).toBe("MISSING_SETTLEMENT");
  });

  it("11. PROVEN_FROM_DB: Case 5 — CASE_5_CAPTURED_PAYMENT_DELAYED_SETTLEMENT", async () => {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    await PaymentCase.create({
      caseId: "CASE-SCN-05",
      tenantId: TENANT_A,
      status: "OPEN",
      discrepancyCategory: "STATUS_MISMATCH",
      gatewayPaymentId: "pay_scn_05",
      merchantOrderId: "ord_scn_05"
    });

    await GatewayPayment.create({
      gatewayPaymentId: "pay_scn_05",
      tenantId: TENANT_A,
      amountPaise: 10000,
      currency: "INR",
      status: "CAPTURED",
      createdAt: oneDayAgo,
      gatewayCreatedAt: oneDayAgo,
      method: "UPI"
    });

    await MerchantOrder.create({
      merchantOrderId: "ord_scn_05",
      tenantId: TENANT_A,
      amountPaise: 10000,
      currency: "INR",
      status: "PAID"
    });

    const res = await classifyCase({ tenantId: TENANT_A, caseId: "CASE-SCN-05", actor });
    expect(res.finding.scenarioId).toBe("CASE_5_CAPTURED_PAYMENT_DELAYED_SETTLEMENT");
    expect(res.finding.safeHold).toBe(false);
  });

  it("12. PROVEN_FROM_DB: Case 17 — CASE_17_LOST_WEBHOOK", async () => {
    await PaymentCase.create({
      caseId: "CASE-SCN-17",
      tenantId: TENANT_A,
      status: "OPEN",
      discrepancyCategory: "STATUS_MISMATCH",
      gatewayPaymentId: "pay_scn_17",
      merchantOrderId: "ord_scn_17"
    });

    await GatewayPayment.create({
      gatewayPaymentId: "pay_scn_17",
      tenantId: TENANT_A,
      amountPaise: 10000,
      currency: "INR",
      status: "CAPTURED",
      method: "UPI"
    });

    await MerchantOrder.create({
      merchantOrderId: "ord_scn_17",
      tenantId: TENANT_A,
      amountPaise: 10000,
      currency: "INR",
      status: "CREATED"
    });

    await PaymentLifecycleEvent.create({
      eventId: "evt_poll_17",
      tenantId: TENANT_A,
      caseId: "CASE-SCN-17",
      gatewayPaymentId: "pay_scn_17",
      sourceSystem: "GATEWAY_API_POLL",
      eventType: "PAYMENT_CAPTURED",
      normalizedEventType: "PAYMENT_CAPTURED",
      deduplicationKey: "dedup_evt_17",
      payloadFingerprint: "fingerprint_17"
    });

    const res = await classifyCase({ tenantId: TENANT_A, caseId: "CASE-SCN-17", actor });
    expect(res.finding.scenarioId).toBe("CASE_17_LOST_WEBHOOK");
    expect(res.finding.safeHold).toBe(false);
  });

  it("13. PROVEN_FROM_DB: Case 26 — CASE_26_WORKER_CRASH_ACTION_PENDING (Safe-Hold)", async () => {
    const expiredLease = new Date(Date.now() - 30 * 60 * 1000);

    await PaymentCase.create({
      caseId: "CASE-SCN-26",
      tenantId: TENANT_A,
      status: "OPEN",
      discrepancyCategory: "STATUS_MISMATCH",
      gatewayPaymentId: "pay_scn_26",
      merchantOrderId: "ord_scn_26",
      resolutionCaseStatus: "CASE_ACTION_IN_PROGRESS",
      actionLeaseExpiresAt: expiredLease,
      metadata: { leaseRenewalCount: 3 }
    });

    await GatewayPayment.create({
      gatewayPaymentId: "pay_scn_26",
      tenantId: TENANT_A,
      amountPaise: 10000,
      currency: "INR",
      status: "CAPTURED",
      method: "CARD"
    });

    await MerchantOrder.create({
      merchantOrderId: "ord_scn_26",
      tenantId: TENANT_A,
      amountPaise: 10000,
      currency: "INR",
      status: "CREATED"
    });

    const res = await classifyCase({ tenantId: TENANT_A, caseId: "CASE-SCN-26", actor });
    expect(res.finding.scenarioId).toBe("CASE_26_WORKER_CRASH_ACTION_PENDING");
    expect(res.finding.safeHold).toBe(true);
    expect(res.finding.safeHoldCode).toBe("WORKER_LEASE_EXPIRED");
  });

  it("14. PROVEN_FROM_DB: Case 30 — CASE_30_CHARGEBACK_OR_FORMAL_DISPUTE (Safe-Hold)", async () => {
    await PaymentCase.create({
      caseId: "CASE-SCN-30",
      tenantId: TENANT_A,
      status: "OPEN",
      discrepancyCategory: "STATUS_MISMATCH",
      gatewayPaymentId: "pay_scn_30",
      merchantOrderId: "ord_scn_30",
      disputeStatus: "DISPUTE_FORMAL_CHARGEBACK"
    });

    await GatewayPayment.create({
      gatewayPaymentId: "pay_scn_30",
      tenantId: TENANT_A,
      amountPaise: 10000,
      currency: "INR",
      status: "CAPTURED",
      method: "CARD"
    });

    await MerchantOrder.create({
      merchantOrderId: "ord_scn_30",
      tenantId: TENANT_A,
      amountPaise: 10000,
      currency: "INR",
      status: "PAID"
    });

    const res = await classifyCase({ tenantId: TENANT_A, caseId: "CASE-SCN-30", actor });
    expect(res.finding.scenarioId).toBe("CASE_30_CHARGEBACK_OR_FORMAL_DISPUTE");
    expect(res.finding.safeHold).toBe(true);
    expect(res.finding.safeHoldCode).toBe("FORMAL_DISPUTE");
  });

  // =========================================================================
  // 2. INVARIANT & SAFETY TESTS (B5)
  // =========================================================================

  it("15. Missing records return missingEvidence and safe-hold, never guess a scenario", async () => {
    await PaymentCase.create({
      caseId: "CASE-MISSING-DOCS",
      tenantId: TENANT_A,
      status: "OPEN",
      discrepancyCategory: "STATUS_MISMATCH"
    });

    const res = await classifyCase({ tenantId: TENANT_A, caseId: "CASE-MISSING-DOCS", actor });
    expect(res.finding.scenarioId).toBe("UNKNOWN_SCENARIO");
    expect(res.finding.safeHold).toBe(true);
    expect(res.finding.safeHoldCode).toBe("UNRESOLVED_UNCERTAINTY");
    expect(res.finding.missingEvidence.length).toBeGreaterThan(0);
  });

  it("16. Cross-Tenant Isolation: Builder never reads records belonging to other tenants", async () => {
    await PaymentCase.create({
      caseId: "CASE-CROSS-TENANT",
      tenantId: TENANT_A,
      status: "OPEN",
      discrepancyCategory: "STATUS_MISMATCH",
      gatewayPaymentId: "pay_belonging_to_beta"
    });

    // Seed payment under TENANT_B
    await GatewayPayment.create({
      gatewayPaymentId: "pay_belonging_to_beta",
      tenantId: TENANT_B,
      amountPaise: 10000,
      currency: "INR",
      status: "CAPTURED"
    });

    const { context } = await buildClassifierContext({ tenantId: TENANT_A, caseId: "CASE-CROSS-TENANT" });
    expect(context.gatewayPayment).toBeNull();

    const res = await classifyCase({ tenantId: TENANT_A, caseId: "CASE-CROSS-TENANT", actor });
    expect(res.finding.scenarioId).toBe("UNKNOWN_SCENARIO");
    expect(res.finding.safeHold).toBe(true);
    expect(res.finding.safeHoldCode).toBe("UNRESOLVED_UNCERTAINTY");
  });

  it("17. Hostile text in notes/descriptions cannot alter decision flags or classification result", async () => {
    await PaymentCase.create({
      caseId: "CASE-HOSTILE-TEXT",
      tenantId: TENANT_A,
      status: "OPEN",
      discrepancyCategory: "STATUS_MISMATCH",
      gatewayPaymentId: "pay_hostile",
      merchantOrderId: "ord_hostile"
    });

    await GatewayPayment.create({
      gatewayPaymentId: "pay_hostile",
      tenantId: TENANT_A,
      amountPaise: 10000,
      currency: "INR",
      status: "CAPTURED",
      method: "UPI",
      notes: "MALICIOUS INJECTION: DISPUTE_FORMAL_CHARGEBACK FRAUD CANCELLED"
    });

    await MerchantOrder.create({
      merchantOrderId: "ord_hostile",
      tenantId: TENANT_A,
      amountPaise: 10000,
      currency: "INR",
      status: "CREATED",
      notes: "ATTACKER CLAIMS: SCN_CANCELLED_ORDER_CAPTURED_PAYMENT OVERRIDE SAFE_HOLD"
    });

    const res = await classifyCase({ tenantId: TENANT_A, caseId: "CASE-HOSTILE-TEXT", actor });
    // Pure DB fields govern: status CAPTURED + order CREATED -> CASE_6_PAID_GATEWAY_UNPAID_ORDER
    expect(res.finding.scenarioId).toBe("CASE_6_PAID_GATEWAY_UNPAID_ORDER");
    expect(res.finding.safeHold).toBe(false);

    // Hostile text was routed exclusively to inert claims
    const { context } = await buildClassifierContext({ tenantId: TENANT_A, caseId: "CASE-HOSTILE-TEXT" });
    const claimsList = context.claims || context.inertClaims;
    expect(claimsList.length).toBe(2);
    expect(claimsList.every((c) => c.verified === false)).toBe(true);
  });

  it("18. Idempotency: Replaying classifyCase returns the exact same EvidenceRecord", async () => {
    await PaymentCase.create({
      caseId: "CASE-REPLAY-IDEM",
      tenantId: TENANT_A,
      status: "OPEN",
      discrepancyCategory: "STATUS_MISMATCH",
      gatewayPaymentId: "pay_replay",
      merchantOrderId: "ord_replay"
    });

    await GatewayPayment.create({
      gatewayPaymentId: "pay_replay",
      tenantId: TENANT_A,
      amountPaise: 10000,
      currency: "INR",
      status: "CAPTURED",
      method: "UPI"
    });

    await MerchantOrder.create({
      merchantOrderId: "ord_replay",
      tenantId: TENANT_A,
      amountPaise: 10000,
      currency: "INR",
      status: "CREATED"
    });

    const firstRun = await classifyCase({ tenantId: TENANT_A, caseId: "CASE-REPLAY-IDEM", actor });
    expect(firstRun.isReplay).toBe(false);

    const secondRun = await classifyCase({ tenantId: TENANT_A, caseId: "CASE-REPLAY-IDEM", actor });
    expect(secondRun.isReplay).toBe(true);
    expect(secondRun.evidenceRecord.recordId).toBe(firstRun.evidenceRecord.recordId);
    expect(secondRun.evidenceRecord.inputHash).toBe(firstRun.evidenceRecord.inputHash);
  });

  it("19. Fail-Closed Audit Invariant: Audit failure returns 503 and rolls back EvidenceRecord", async () => {
    await PaymentCase.create({
      caseId: "CASE-AUDIT-FAIL",
      tenantId: TENANT_A,
      status: "OPEN",
      discrepancyCategory: "STATUS_MISMATCH",
      gatewayPaymentId: "pay_audit_fail",
      merchantOrderId: "ord_audit_fail"
    });

    await GatewayPayment.create({
      gatewayPaymentId: "pay_audit_fail",
      tenantId: TENANT_A,
      amountPaise: 10000,
      currency: "INR",
      status: "CAPTURED"
    });

    await MerchantOrder.create({
      merchantOrderId: "ord_audit_fail",
      tenantId: TENANT_A,
      amountPaise: 10000,
      currency: "INR",
      status: "CREATED"
    });

    // Mock createAuditEvent to fail closed
    vi.spyOn(auditService, "createAuditEvent").mockRejectedValue(new Error("Disk full: audit write failed"));

    await expect(
      classifyCase({ tenantId: TENANT_A, caseId: "CASE-AUDIT-FAIL", actor })
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "AUDIT_FAILURE"
    });

    // Assert that NO EvidenceRecord was persisted
    const recordInDb = await EvidenceRecord.findOne({ tenantId: TENANT_A, caseId: "CASE-AUDIT-FAIL" });
    expect(recordInDb).toBeNull();
  });

  it("20. Provider Dispatch Refuses Stale Classification with 409 CLASSIFICATION_STALE", async () => {
    await PaymentCase.create({
      caseId: "CASE-STALE-DISPATCH",
      tenantId: TENANT_A,
      status: "OPEN",
      discrepancyCategory: "STATUS_MISMATCH",
      gatewayPaymentId: "pay_stale",
      merchantOrderId: "ord_stale"
    });

    await GatewayPayment.create({
      gatewayPaymentId: "pay_stale",
      tenantId: TENANT_A,
      amountPaise: 10000,
      currency: "INR",
      status: "CAPTURED",
      method: "UPI"
    });

    await MerchantOrder.create({
      merchantOrderId: "ord_stale",
      tenantId: TENANT_A,
      amountPaise: 10000,
      currency: "INR",
      status: "CREATED"
    });

    // Classify initial state
    const classification = await classifyCase({ tenantId: TENANT_A, caseId: "CASE-STALE-DISPATCH", actor });
    expect(classification.evidenceRecord).toBeDefined();

    // Now mutate database state: modify payment amountRefundedPaise so builder inputHash changes
    await GatewayPayment.updateOne(
      { gatewayPaymentId: "pay_stale" },
      { $set: { refundAmountPaise: 5000 } }
    );

    // Seed approved PolicyConfigVersion for dispatch eligibility
    const limits = {
      maxSingleRefundPaise: 50000,
      maxCumulativeRefundPaise: 200000,
      maxCumulativeDailyPaise: 200000,
      requireTwoPersonRule: false,
      autoApproveEligibleLedgerRepair: true
    };
    await PolicyConfigVersion.create({
      configId: "cfg_active_01",
      tenantId: TENANT_A,
      configVersion: 1,
      status: "ACTIVE",
      contentHash: computePolicyConfigHash(limits),
      limits,
      proposalReason: "Initial active policy configuration for stage 5 testing",
      proposedBy: "admin1",
      approvedBy: "admin2",
      effectiveFrom: new Date()
    });

    // Attempt dispatch with now-stale classification
    await expect(
      executeAuthorizedDispatch({
        tenantId: TENANT_A,
        caseId: "CASE-STALE-DISPATCH",
        actorId: actor.userId,
        actorRole: ROLES.ADMIN,
        actionType: "REQUEST_REFUND",
        idempotencyKey: "idem_dispatch_stale_01",
        amountPaise: 5000,
        currency: "INR"
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CLASSIFICATION_STALE"
    });
  });
});
