import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from "vitest";
import mongoose from "mongoose";
import { PaymentCase } from "../../src/models/PaymentCase.js";
import { GatewayPayment } from "../../src/models/GatewayPayment.js";
import { MerchantOrder } from "../../src/models/MerchantOrder.js";
import { ProviderOperation } from "../../src/models/ProviderOperation.js";
import { EvidenceRecord } from "../../src/models/EvidenceRecord.js";
import { AuditLog } from "../../src/models/AuditLog.js";
import { PolicyDecision } from "../../src/models/PolicyDecision.js";
import { PolicyConfigVersion, computePolicyConfigHash } from "../../src/models/PolicyConfigVersion.js";
import { PaymentMonitoringTask } from "../../src/models/PaymentMonitoringTask.js";
import { PaymentLifecycleEvent } from "../../src/models/PaymentLifecycleEvent.js";
import {
  setClassifierClock,
  resetClassifierClock,
  buildClassifierContext,
  isClassificationStale
} from "../../src/services/classification/classifierContextBuilder.js";
import { classifyCase } from "../../src/services/classification/classificationService.js";
import { dispatchSandboxAction } from "../../src/services/policy/providerDispatchService.js";
import {
  schedulePaymentMonitoring,
  executeMonitoringRecheck
} from "../../src/services/monitoring/paymentMonitoringService.js";
import { validateTestDatabaseUri } from "../helpers/testDbGuard.js";
import { ROLES } from "../../src/services/auth/tokenService.js";

const DEFAULT_TEST_URI = "mongodb://127.0.0.1:27017/reconai_test_hash_dispatch";
const TEST_DB_URI = validateTestDatabaseUri(process.env.MONGODB_TEST_URI || DEFAULT_TEST_URI);

const TENANT = "tenant_hash_dispatch_test";

describe("Classification Hash Clock-Stability & Dispatch Integration (Real MongoDB)", { timeout: 35000 }, () => {
  const baseTime = 1700000000000; // Fixed epoch ms

  const actor = {
    userId: "usr_admin_hash_tester",
    role: ROLES.ADMIN,
    tenantId: TENANT
  };

  const mockCustomFetch = async (url, options) => {
    return {
      ok: true,
      status: 200,
      json: async () => ({
        id: "rfr_mock_hash_test_123",
        entity: "refund",
        amount: 5000,
        currency: "INR",
        payment_id: "pay_hash_test_01",
        status: "processed"
      })
    };
  };

  beforeAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    await mongoose.connect(TEST_DB_URI, { serverSelectionTimeoutMS: 5000 });
  });

  afterAll(async () => {
    resetClassifierClock();
    if (mongoose.connection.readyState === 1) {
      await mongoose.connection.db.dropDatabase().catch(() => {});
      await mongoose.disconnect();
    }
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    resetClassifierClock();
    if (mongoose.connection.readyState === 1) {
      await Promise.all([
        PaymentCase.deleteMany({}),
        GatewayPayment.deleteMany({}),
        MerchantOrder.deleteMany({}),
        ProviderOperation.deleteMany({}),
        EvidenceRecord.deleteMany({}),
        AuditLog.deleteMany({}),
        PolicyDecision.deleteMany({}),
        PolicyConfigVersion.deleteMany({}),
        PaymentMonitoringTask.deleteMany({}),
        PaymentLifecycleEvent.deleteMany({})
      ]);

      // Seed approved active PolicyConfigVersion for dispatch eligibility
      const limits = {
        maxSingleRefundPaise: 50000,
        maxCumulativeRefundPaise: 200000,
        maxCumulativeDailyPaise: 200000,
        requireTwoPersonRule: false,
        autoApproveEligibleLedgerRepair: true
      };
      await PolicyConfigVersion.create({
        configId: "cfg_active_hash_test",
        tenantId: TENANT,
        configVersion: 1,
        status: "ACTIVE",
        contentHash: computePolicyConfigHash(limits),
        limits,
        proposalReason: "Initial active policy configuration for hash stability tests",
        proposedBy: "admin_p1",
        approvedBy: "admin_a1",
        effectiveFrom: new Date(baseTime)
      });
    }
  });

  afterEach(() => {
    resetClassifierClock();
  });

  it("(a) time-only change that crosses a threshold and flips the outcome -> 409 CLASSIFICATION_STALE", async () => {
    const caseId = "CASE-HASH-TIME-STALE";
    const paymentId = "pay_hash_time_stale";
    const orderId = "ord_hash_time_stale";

    // Seed at T0: Payment CAPTURED, Order CREATED, 0 settlements
    await PaymentCase.create({
      caseId,
      tenantId: TENANT,
      status: "OPEN",
      discrepancyCategory: "STATUS_MISMATCH",
      gatewayPaymentId: paymentId,
      merchantOrderId: orderId
    });

    await GatewayPayment.create({
      gatewayPaymentId: paymentId,
      tenantId: TENANT,
      amountPaise: 10000,
      currency: "INR",
      status: "CAPTURED",
      method: "UPI",
      createdAt: new Date(baseTime),
      updatedAt: new Date(baseTime)
    });

    await MerchantOrder.create({
      merchantOrderId: orderId,
      tenantId: TENANT,
      amountPaise: 10000,
      currency: "INR",
      status: "CREATED",
      createdAt: new Date(baseTime),
      updatedAt: new Date(baseTime)
    });

    // Classify at T0: elapsedHours = 0 <= 120 -> classifies as CASE_6_PAID_GATEWAY_UNPAID_ORDER (safeHold: false)
    setClassifierClock(() => baseTime);
    const initialClassification = await classifyCase({ tenantId: TENANT, caseId, actor });
    expect(initialClassification.finding.scenarioId).toBe("CASE_6_PAID_GATEWAY_UNPAID_ORDER");
    expect(initialClassification.finding.safeHold).toBe(false);
    expect(initialClassification.finding.safeHoldCode).toBe("NONE");

    // Advance injected clock past 120-hour threshold to 121 hours (435,600,000 ms)
    // Zero database records are touched
    setClassifierClock(() => baseTime + 121 * 60 * 60 * 1000);

    // Attempt dispatch: recomputed outcome flips to CASE_21_MISSING_SETTLEMENT_RECORD (safeHold: true),
    // changing currentBuilderHash and triggering 409 CLASSIFICATION_STALE
    await expect(
      dispatchSandboxAction({
        tenantId: TENANT,
        caseId,
        actorId: actor.userId,
        actorRole: ROLES.ADMIN,
        actionType: "REQUEST_REFUND",
        idempotencyKey: "idem_time_stale_dispatch_01",
        amountPaise: 5000,
        customFetch: mockCustomFetch
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CLASSIFICATION_STALE"
    });
  });

  it("(b) time-only change with no outcome flip -> not stale", async () => {
    const caseId = "CASE-HASH-TIME-NOT-STALE";
    const paymentId = "pay_hash_time_not_stale";
    const orderId = "ord_hash_time_not_stale";

    await PaymentCase.create({
      caseId,
      tenantId: TENANT,
      status: "OPEN",
      discrepancyCategory: "STATUS_MISMATCH",
      gatewayPaymentId: paymentId,
      merchantOrderId: orderId
    });

    await GatewayPayment.create({
      gatewayPaymentId: paymentId,
      tenantId: TENANT,
      amountPaise: 10000,
      currency: "INR",
      status: "CAPTURED",
      method: "UPI",
      createdAt: new Date(baseTime),
      updatedAt: new Date(baseTime)
    });

    await MerchantOrder.create({
      merchantOrderId: orderId,
      tenantId: TENANT,
      amountPaise: 10000,
      currency: "INR",
      status: "CREATED",
      createdAt: new Date(baseTime),
      updatedAt: new Date(baseTime)
    });

    // Classify at T0
    setClassifierClock(() => baseTime);
    const initialClassification = await classifyCase({ tenantId: TENANT, caseId, actor });
    expect(initialClassification.finding.scenarioId).toBe("CASE_6_PAID_GATEWAY_UNPAID_ORDER");

    // Advance clock by 10 minutes (well below 120-hour threshold)
    setClassifierClock(() => baseTime + 10 * 60 * 1000);

    // Staleness check passes because recordHash and outcome are unchanged.
    // Dispatch proceeds to write gate and rejects with SANDBOX_GATE_CLOSED (not CLASSIFICATION_STALE)
    try {
      await dispatchSandboxAction({
        tenantId: TENANT,
        caseId,
        actorId: actor.userId,
        actorRole: ROLES.ADMIN,
        actionType: "REQUEST_REFUND",
        idempotencyKey: "idem_time_not_stale_dispatch_02",
        amountPaise: 5000,
        customFetch: mockCustomFetch
      });
      expect.fail("Expected dispatch to reach sandbox write gate");
    } catch (err) {
      expect(err.code).not.toBe("CLASSIFICATION_STALE");
      expect(err.code).toBe("SANDBOX_GATE_CLOSED");
    }
  });

  it("(c) a record change -> stale", async () => {
    const caseId = "CASE-HASH-RECORD-STALE";
    const paymentId = "pay_hash_record_stale";
    const orderId = "ord_hash_record_stale";

    await PaymentCase.create({
      caseId,
      tenantId: TENANT,
      status: "OPEN",
      discrepancyCategory: "STATUS_MISMATCH",
      gatewayPaymentId: paymentId,
      merchantOrderId: orderId
    });

    await GatewayPayment.create({
      gatewayPaymentId: paymentId,
      tenantId: TENANT,
      amountPaise: 10000,
      currency: "INR",
      status: "CAPTURED",
      method: "UPI",
      createdAt: new Date(baseTime),
      updatedAt: new Date(baseTime)
    });

    await MerchantOrder.create({
      merchantOrderId: orderId,
      tenantId: TENANT,
      amountPaise: 10000,
      currency: "INR",
      status: "CREATED",
      createdAt: new Date(baseTime),
      updatedAt: new Date(baseTime)
    });

    // Classify at T0
    setClassifierClock(() => baseTime);
    await classifyCase({ tenantId: TENANT, caseId, actor });

    // Mutate database record: partial refund of 5000 paise recorded
    await GatewayPayment.updateOne(
      { gatewayPaymentId: paymentId },
      { $set: { refundAmountPaise: 5000, updatedAt: new Date(baseTime + 5000) } }
    );

    // Clock stays at T0 (no clock movement)
    // Dispatch rejects with 409 CLASSIFICATION_STALE due to recordHash change
    await expect(
      dispatchSandboxAction({
        tenantId: TENANT,
        caseId,
        actorId: actor.userId,
        actorRole: ROLES.ADMIN,
        actionType: "REQUEST_REFUND",
        idempotencyKey: "idem_rec_stale_dispatch_03",
        amountPaise: 5000,
        customFetch: mockCustomFetch
      })
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CLASSIFICATION_STALE"
    });
  });

  it("(d) replay returns the same EvidenceRecord", async () => {
    const caseId = "CASE-HASH-REPLAY";
    const paymentId = "pay_hash_replay";
    const orderId = "ord_hash_replay";

    await PaymentCase.create({
      caseId,
      tenantId: TENANT,
      status: "OPEN",
      discrepancyCategory: "STATUS_MISMATCH",
      gatewayPaymentId: paymentId,
      merchantOrderId: orderId
    });

    await GatewayPayment.create({
      gatewayPaymentId: paymentId,
      tenantId: TENANT,
      amountPaise: 10000,
      currency: "INR",
      status: "CAPTURED",
      method: "UPI",
      createdAt: new Date(baseTime),
      updatedAt: new Date(baseTime)
    });

    await MerchantOrder.create({
      merchantOrderId: orderId,
      tenantId: TENANT,
      amountPaise: 10000,
      currency: "INR",
      status: "CREATED",
      createdAt: new Date(baseTime),
      updatedAt: new Date(baseTime)
    });

    setClassifierClock(() => baseTime);

    const firstRun = await classifyCase({ tenantId: TENANT, caseId, actor });
    expect(firstRun.isReplay).toBe(false);
    expect(firstRun.evidenceRecord).toBeDefined();

    // Replay classification under identical state
    const secondRun = await classifyCase({ tenantId: TENANT, caseId, actor });
    expect(secondRun.isReplay).toBe(true);
    expect(secondRun.evidenceRecord.recordId).toBe(firstRun.evidenceRecord.recordId);
    expect(secondRun.evidenceRecord._id.toString()).toBe(firstRun.evidenceRecord._id.toString());
    expect(secondRun.inputHash).toBe(firstRun.inputHash);

    // Exactly 1 EvidenceRecord exists in the database
    const totalRecords = await EvidenceRecord.countDocuments({ tenantId: TENANT, caseId });
    expect(totalRecords).toBe(1);
  });

  it("simulated 24-hour time-only drift creates exactly 2 EvidenceRecords across 1 threshold crossing", async () => {
    const caseId = "CASE-HASH-24H-DRIFT";
    const paymentId = "pay_hash_24h_drift";

    await PaymentCase.create({
      caseId,
      tenantId: TENANT,
      status: "OPEN",
      discrepancyCategory: "CUSTOMER_DEBIT_ON_GATEWAY_PENDING",
      gatewayPaymentId: paymentId,
      customerDebitStatus: "DEBIT_REPORTED",
      createdAt: new Date(baseTime),
      updatedAt: new Date(baseTime)
    });

    await GatewayPayment.create({
      gatewayPaymentId: paymentId,
      tenantId: TENANT,
      amountPaise: 10000,
      currency: "INR",
      status: "CREATED",
      method: "UPI",
      createdAt: new Date(baseTime),
      updatedAt: new Date(baseTime)
    });

    // Run classification hour-by-hour from Hour 0 to Hour 24 (25 classification calls)
    const classifications = [];
    for (let hour = 0; hour <= 24; hour++) {
      setClassifierClock(() => baseTime + hour * 60 * 60 * 1000);
      const res = await classifyCase({ tenantId: TENANT, caseId, actor });
      classifications.push({
        hour,
        recordId: res.evidenceRecord.recordId,
        safeHoldCode: res.finding.safeHoldCode,
        isReplay: res.isReplay
      });
    }

    // Hour 0 (0m): pendingMinutes < 60 -> safeHoldCode: "NONE", isReplay: false
    expect(classifications[0].safeHoldCode).toBe("NONE");
    expect(classifications[0].isReplay).toBe(false);

    // Hour 1 (60m): threshold crossed -> safeHoldCode: "CUSTOMER_DEBIT_ON_GATEWAY_PENDING", outcome flips -> isReplay: false (new record created)
    expect(classifications[1].safeHoldCode).toBe("CUSTOMER_DEBIT_ON_GATEWAY_PENDING");
    expect(classifications[1].isReplay).toBe(false);
    expect(classifications[1].recordId).not.toBe(classifications[0].recordId);

    // Hours 2 through 24: outcome remains CUSTOMER_DEBIT_ON_GATEWAY_PENDING, not stale -> isReplay: true
    for (let h = 2; h <= 24; h++) {
      expect(classifications[h].safeHoldCode).toBe("CUSTOMER_DEBIT_ON_GATEWAY_PENDING");
      expect(classifications[h].isReplay).toBe(true);
      expect(classifications[h].recordId).toBe(classifications[1].recordId);
    }

    // Exactly 2 EvidenceRecords exist in the database across 25 evaluations over 24 hours
    const totalRecords = await EvidenceRecord.countDocuments({ tenantId: TENANT, caseId });
    expect(totalRecords).toBe(2);
  });

  describe("Material-State Only Invariants & Real Monitoring Recheck (A1)", () => {
    it("(a) classify, then run real monitoring recheck writing same provider status -> not stale and dispatch staleness gate passes", async () => {
      const caseId = "CASE-MON-SAME-STATUS";
      const paymentId = "pay_mon_same_status";
      const orderId = "ord_mon_same_status";

      await PaymentCase.create({
        caseId,
        tenantId: TENANT,
        status: "OPEN",
        captureStatus: "CAPTURE_CAPTURED",
        discrepancyCategory: "STATUS_MISMATCH",
        gatewayPaymentId: paymentId,
        merchantOrderId: orderId
      });

      await GatewayPayment.create({
        gatewayPaymentId: paymentId,
        tenantId: TENANT,
        amountPaise: 10000,
        currency: "INR",
        status: "CAPTURED",
        method: "UPI",
        createdAt: new Date(baseTime),
        updatedAt: new Date(baseTime)
      });

      await MerchantOrder.create({
        merchantOrderId: orderId,
        tenantId: TENANT,
        amountPaise: 10000,
        currency: "INR",
        status: "CREATED",
        createdAt: new Date(baseTime),
        updatedAt: new Date(baseTime)
      });

      // Seed initial webhook event so zeroWebhooks is false both before and after monitoring recheck
      await PaymentLifecycleEvent.create({
        eventId: "evt_init_webhook_mon_same",
        tenantId: TENANT,
        caseId,
        gatewayPaymentId: paymentId,
        merchantOrderId: orderId,
        sourceSystem: "GATEWAY_WEBHOOK",
        deduplicationKey: "dedup_webhook_mon_same",
        payloadFingerprint: "fp_test_webhook_01",
        normalizedEventType: "PAYMENT_CAPTURED",
        amountPaise: 10000,
        currency: "INR",
        occurredAt: new Date(baseTime)
      });

      setClassifierClock(() => baseTime);

      // 1. Initial classification
      const classification = await classifyCase({ tenantId: TENANT, caseId, actor });
      expect(classification.finding.scenarioId).toBe("CASE_6_PAID_GATEWAY_UNPAID_ORDER");

      // 2. Schedule real monitoring task without merchantOrderId so order is not prematurely marked PAID
      const task = await schedulePaymentMonitoring({
        tenantId: TENANT,
        gatewayPaymentId: paymentId,
        caseId,
        asOfTime: new Date(baseTime)
      });

      // 3. Execute real monitoring recheck with mocked fetch returning SAME status ("captured")
      const mockFetchSameStatus = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          id: paymentId,
          entity: "payment",
          amount: 10000,
          currency: "INR",
          status: "captured"
        })
      });

      const recheckResult = await executeMonitoringRecheck(task, {
        asOfTime: new Date(baseTime + 30000),
        customFetch: mockFetchSameStatus
      });
      expect(recheckResult.success).toBe(true);

      // Verify payment status is still CAPTURED in DB
      const updatedPayment = await GatewayPayment.findOne({ gatewayPaymentId: paymentId }).lean();
      expect(updatedPayment.status).toBe("CAPTURED");

      // Verify staleness check passes
      const currentCtx = await buildClassifierContext({ tenantId: TENANT, caseId });
      expect(currentCtx.inputHash).toBe(classification.inputHash);

      // 4. Attempt dispatch: staleness check must pass because material state is unchanged
      try {
        await dispatchSandboxAction({
          tenantId: TENANT,
          caseId,
          actorId: actor.userId,
          actorRole: ROLES.ADMIN,
          actionType: "REQUEST_REFUND",
          idempotencyKey: "idem_mon_same_status_dispatch",
          amountPaise: 5000,
          customFetch: mockCustomFetch
        });
        expect.fail("Expected dispatch to reach sandbox write gate");
      } catch (err) {
        expect(err.code).not.toBe("CLASSIFICATION_STALE");
        expect(err.code).toBe("SANDBOX_GATE_CLOSED");
      }
    });

    it("(b) monitoring recheck returns changed status -> stale", async () => {
      const caseId = "CASE-MON-CHANGED-STATUS";
      const paymentId = "pay_mon_changed_status";
      const orderId = "ord_mon_changed_status";

      await PaymentCase.create({
        caseId,
        tenantId: TENANT,
        status: "OPEN",
        discrepancyCategory: "STATUS_MISMATCH",
        gatewayPaymentId: paymentId,
        merchantOrderId: orderId
      });

      await GatewayPayment.create({
        gatewayPaymentId: paymentId,
        tenantId: TENANT,
        amountPaise: 10000,
        currency: "INR",
        status: "CAPTURED",
        method: "UPI",
        createdAt: new Date(baseTime),
        updatedAt: new Date(baseTime)
      });

      await MerchantOrder.create({
        merchantOrderId: orderId,
        tenantId: TENANT,
        amountPaise: 10000,
        currency: "INR",
        status: "CREATED",
        createdAt: new Date(baseTime),
        updatedAt: new Date(baseTime)
      });

      setClassifierClock(() => baseTime);

      // 1. Initial classification (finding is Case 6)
      const initial = await classifyCase({ tenantId: TENANT, caseId, actor });
      expect(initial.finding.scenarioId).toBe("CASE_6_PAID_GATEWAY_UNPAID_ORDER");

      // 2. Schedule and execute monitoring recheck returning CHANGED status ("refunded")
      const task = await schedulePaymentMonitoring({
        tenantId: TENANT,
        gatewayPaymentId: paymentId,
        caseId,
        asOfTime: new Date(baseTime)
      });

      const mockFetchChangedStatus = async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          id: paymentId,
          entity: "payment",
          amount: 10000,
          currency: "INR",
          status: "refunded"
        })
      });

      await executeMonitoringRecheck(task, {
        asOfTime: new Date(baseTime + 30000),
        customFetch: mockFetchChangedStatus
      });

      // Verify payment status mutated in DB to REFUNDED
      const updatedPayment = await GatewayPayment.findOne({ gatewayPaymentId: paymentId }).lean();
      expect(updatedPayment.status).toBe("REFUNDED");

      // 3. Verify classification is STALE
      const { recordHash: newRecordHash, outcome: newOutcome, inputHash: newInputHash } = await buildClassifierContext({
        tenantId: TENANT,
        caseId
      });

      const stale = isClassificationStale({
        storedRecordHash: initial.evidenceRecord.recordHash,
        storedOutcome: {
          scenarioId: initial.evidenceRecord.scenarioId,
          safeHoldCode: initial.evidenceRecord.safeHoldCode,
          reasonCode: initial.evidenceRecord.reasonCode
        },
        currentRecordHash: newRecordHash,
        currentOutcome: newOutcome
      });

      expect(stale).toBe(true);
      expect(newInputHash).not.toBe(initial.inputHash);
      expect(newRecordHash).not.toBe(initial.evidenceRecord.recordHash);
    });

    it("(c) non-material write (touch updatedAt, bump poll counter) -> not stale and dispatch staleness gate passes", async () => {
      const caseId = "CASE-MON-NON-MATERIAL";
      const paymentId = "pay_mon_non_material";
      const orderId = "ord_mon_non_material";

      await PaymentCase.create({
        caseId,
        tenantId: TENANT,
        status: "OPEN",
        discrepancyCategory: "STATUS_MISMATCH",
        gatewayPaymentId: paymentId,
        merchantOrderId: orderId
      });

      await GatewayPayment.create({
        gatewayPaymentId: paymentId,
        tenantId: TENANT,
        amountPaise: 10000,
        currency: "INR",
        status: "CAPTURED",
        method: "UPI",
        createdAt: new Date(baseTime),
        updatedAt: new Date(baseTime)
      });

      await MerchantOrder.create({
        merchantOrderId: orderId,
        tenantId: TENANT,
        amountPaise: 10000,
        currency: "INR",
        status: "CREATED",
        createdAt: new Date(baseTime),
        updatedAt: new Date(baseTime)
      });

      setClassifierClock(() => baseTime);
      const initial = await classifyCase({ tenantId: TENANT, caseId, actor });

      // Non-material writes:
      // 1. Touch updatedAt on GatewayPayment
      await GatewayPayment.updateOne(
        { gatewayPaymentId: paymentId },
        { $set: { updatedAt: new Date(baseTime + 120000) } }
      );

      // 2. Touch updatedAt on PaymentCase
      await PaymentCase.updateOne(
        { caseId },
        { $set: { updatedAt: new Date(baseTime + 120000) } }
      );

      // 3. Create a monitoring task with poll attempts
      await PaymentMonitoringTask.create({
        taskId: "task_bump_poll_01",
        tenantId: TENANT,
        gatewayPaymentId: paymentId,
        caseId,
        status: "IN_PROGRESS",
        attemptCount: 3,
        maxAttempts: 4
      });

      // Verify classification is NOT stale
      const { recordHash: currentRecordHash, inputHash: currentInputHash } = await buildClassifierContext({
        tenantId: TENANT,
        caseId
      });
      expect(currentRecordHash).toBe(initial.evidenceRecord.recordHash);
      expect(currentInputHash).toBe(initial.inputHash);

      // Attempt dispatch: staleness check must pass because material state is unchanged
      try {
        await dispatchSandboxAction({
          tenantId: TENANT,
          caseId,
          actorId: actor.userId,
          actorRole: ROLES.ADMIN,
          actionType: "REQUEST_REFUND",
          idempotencyKey: "idem_non_material_dispatch",
          amountPaise: 5000,
          customFetch: mockCustomFetch
        });
        expect.fail("Expected dispatch to reach sandbox write gate");
      } catch (err) {
        expect(err.code).not.toBe("CLASSIFICATION_STALE");
        expect(err.code).toBe("SANDBOX_GATE_CLOSED");
      }
    });
  });
});
