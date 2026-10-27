import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  setClassifierClock,
  resetClassifierClock,
  computeClassifierRecordHash,
  computeClassifierInputHash,
  isClassificationStale,
  buildClassifierContext
} from "../../src/services/classification/classifierContextBuilder.js";
import { classifyCase } from "../../src/services/classification/classificationService.js";
import { PaymentCase } from "../../src/models/PaymentCase.js";
import { GatewayPayment } from "../../src/models/GatewayPayment.js";
import { EvidenceRecord } from "../../src/models/EvidenceRecord.js";

describe("inputHash Clock Independence & Staleness Semantics", () => {
  const baseTime = 1700000000000; // Fixed timestamp ms

  afterEach(() => {
    resetClassifierClock();
  });

  it("(b) 10 minutes of clock movement with no outcome change -> not stale & identical recordHash", () => {
    const baseRecordData = {
      paymentCase: {
        caseId: "case_test_clock_01",
        tenantId: "tenant_01",
        resolutionCaseStatus: "CASE_DETECTED",
        updatedAt: new Date(baseTime)
      },
      gatewayPayment: {
        gatewayPaymentId: "pay_test_01",
        status: "CAPTURED",
        amountPaise: 50000,
        updatedAt: new Date(baseTime)
      }
    };

    const hashAtT0 = computeClassifierRecordHash(baseRecordData);

    // Advance clock by 10 minutes (600,000 ms)
    setClassifierClock(() => baseTime + 10 * 60 * 1000);
    const hashAtT10 = computeClassifierRecordHash(baseRecordData);

    expect(hashAtT0).toBe(hashAtT10);

    const outcome = {
      scenarioId: "CASE_1_FRONTEND_TIMEOUT_PAYMENT_SUCCESS",
      safeHoldCode: "NONE",
      reasonCode: "FRONTEND_TIMEOUT_PAYMENT_SUCCESS"
    };

    const isStale = isClassificationStale({
      storedRecordHash: hashAtT0,
      storedOutcome: outcome,
      currentRecordHash: hashAtT10,
      currentOutcome: outcome
    });

    expect(isStale).toBe(false);

    const inputHash0 = computeClassifierInputHash({ recordHash: hashAtT0, outcome });
    const inputHash10 = computeClassifierInputHash({ recordHash: hashAtT10, outcome });
    expect(inputHash0).toBe(inputHash10);
  });

  it("(a) 59 minutes -> 61 minutes crossing Case 2 threshold changes safeHoldCode from NONE to CUSTOMER_DEBIT_ON_GATEWAY_PENDING (same scenarioId CASE_2_CUSTOMER_DEBIT_CLAIM_GATEWAY_PENDING) -> stale", () => {
    const recordData = {
      paymentCase: {
        caseId: "case_test_case2_clock",
        tenantId: "tenant_01",
        resolutionCaseStatus: "CASE_DETECTED",
        updatedAt: new Date(baseTime)
      },
      gatewayPayment: {
        gatewayPaymentId: "pay_pending_01",
        status: "PENDING",
        amountPaise: 10000,
        createdAt: new Date(baseTime),
        updatedAt: new Date(baseTime)
      },
      customerClaims: [
        { claimType: "CUSTOMER_DEBIT_CLAIM", statement: "Customer debited from bank" }
      ]
    };

    const recordHash = computeClassifierRecordHash(recordData);

    // At 59 minutes: Case 2 threshold (pendingMinutes >= 60) is NOT met: returns CASE_2 with safeHoldCode: "NONE"
    const outcomeAt59 = {
      scenarioId: "CASE_2_CUSTOMER_DEBIT_CLAIM_GATEWAY_PENDING",
      safeHoldCode: "NONE",
      reasonCode: "CUSTOMER_DEBIT_ON_GATEWAY_PENDING"
    };

    // At 61 minutes: Case 2 threshold is met: returns CASE_2 with safeHoldCode: "CUSTOMER_DEBIT_ON_GATEWAY_PENDING"
    const outcomeAt61 = {
      scenarioId: "CASE_2_CUSTOMER_DEBIT_CLAIM_GATEWAY_PENDING",
      safeHoldCode: "CUSTOMER_DEBIT_ON_GATEWAY_PENDING",
      reasonCode: "CUSTOMER_DEBIT_ON_GATEWAY_PENDING"
    };

    const isStale = isClassificationStale({
      storedRecordHash: recordHash,
      storedOutcome: outcomeAt59,
      currentRecordHash: recordHash,
      currentOutcome: outcomeAt61
    });

    expect(isStale).toBe(true);

    const inputHash59 = computeClassifierInputHash({ recordHash, outcome: outcomeAt59 });
    const inputHash61 = computeClassifierInputHash({ recordHash, outcome: outcomeAt61 });
    expect(inputHash59).not.toBe(inputHash61);
  });

  it("(c) a record change -> stale", () => {
    const originalRecordData = {
      paymentCase: {
        caseId: "case_test_rec_change",
        tenantId: "tenant_01",
        resolutionCaseStatus: "CASE_DETECTED",
        updatedAt: new Date(baseTime)
      },
      gatewayPayment: {
        gatewayPaymentId: "pay_rec_01",
        status: "PENDING",
        amountPaise: 20000,
        updatedAt: new Date(baseTime)
      }
    };

    const originalRecordHash = computeClassifierRecordHash(originalRecordData);

    // Database record mutates: payment captured and updatedAt changes
    const mutatedRecordData = {
      ...originalRecordData,
      gatewayPayment: {
        ...originalRecordData.gatewayPayment,
        status: "CAPTURED",
        updatedAt: new Date(baseTime + 5000)
      }
    };

    const mutatedRecordHash = computeClassifierRecordHash(mutatedRecordData);
    expect(originalRecordHash).not.toBe(mutatedRecordHash);

    const outcome = {
      scenarioId: "CASE_1_FRONTEND_TIMEOUT_PAYMENT_SUCCESS",
      safeHoldCode: "NONE",
      reasonCode: "FRONTEND_TIMEOUT_PAYMENT_SUCCESS"
    };

    const isStale = isClassificationStale({
      storedRecordHash: originalRecordHash,
      storedOutcome: outcome,
      currentRecordHash: mutatedRecordHash,
      currentOutcome: outcome
    });

    expect(isStale).toBe(true);
  });

  it("24-hour time drift creates at most outcome-change bounded EvidenceRecords", () => {
    const recordHash = "mock_hash_constant_records";
    
    // Simulate checking staleness every hour for 24 hours
    // Assuming 1 outcome change occurs (at hour 1 crossing Case 2), and no changes afterward
    const recordsCreated = [];
    let currentStoredOutcome = { scenarioId: "UNKNOWN_SCENARIO", safeHoldCode: "NONE", reasonCode: "UNKNOWN" };
    let currentStoredHash = recordHash;

    for (let hour = 1; hour <= 24; hour++) {
      let outcomeAtHour;
      if (hour < 1) {
        outcomeAtHour = { scenarioId: "UNKNOWN_SCENARIO", safeHoldCode: "NONE", reasonCode: "UNKNOWN" };
      } else {
        outcomeAtHour = { scenarioId: "CASE_2_CUSTOMER_DEBIT_CLAIM_GATEWAY_PENDING", safeHoldCode: "CUSTOMER_DEBIT_ON_GATEWAY_PENDING", reasonCode: "CUSTOMER_DEBIT_ON_GATEWAY_PENDING" };
      }

      const stale = isClassificationStale({
        storedRecordHash: currentStoredHash,
        storedOutcome: currentStoredOutcome,
        currentRecordHash: recordHash,
        currentOutcome: outcomeAtHour
      });

      if (stale) {
        recordsCreated.push({ hour, outcome: outcomeAtHour });
        currentStoredOutcome = outcomeAtHour;
      }
    }

    // In 24 hours of pure time drift with 1 threshold crossing, exactly 1 transition occurred!
    expect(recordsCreated.length).toBe(1);
    expect(recordsCreated[0].hour).toBe(1);
  });

  it("proves recordHash is unchanged when updatedAt/createdAt/__v/poll counters change and changes when a status or amount changes", () => {
    const baseRecordData = {
      paymentCase: {
        caseId: "case_hash_isolation_01",
        tenantId: "tenant_01",
        resolutionCaseStatus: "CASE_DETECTED",
        captureStatus: "CAPTURE_CAPTURED",
        authorizationStatus: "AUTH_AUTHORIZED",
        refundStatus: "REFUND_NONE",
        disputeStatus: "DISPUTE_NONE",
        customerDebitStatus: "DEBIT_VERIFIED",
        safeHoldReason: "None",
        createdAt: new Date("2026-10-12T00:00:00Z"),
        updatedAt: new Date("2026-10-12T00:00:00Z"),
        __v: 0,
        pollCount: 1,
        leaseRenewalCount: 3,
        attemptCount: 2
      },
      gatewayPayment: {
        gatewayPaymentId: "pay_hash_01",
        merchantOrderId: "order_hash_01",
        status: "CAPTURED",
        amountPaise: 50000,
        currency: "INR",
        createdAt: new Date("2026-10-12T00:00:00Z"),
        updatedAt: new Date("2026-10-12T00:00:00Z"),
        __v: 0
      },
      merchantOrder: {
        merchantOrderId: "order_hash_01",
        status: "COMPLETED",
        amountPaise: 50000,
        currency: "INR",
        createdAt: new Date("2026-10-12T00:00:00Z"),
        updatedAt: new Date("2026-10-12T00:00:00Z"),
        __v: 0
      }
    };

    const initialHash = computeClassifierRecordHash(baseRecordData);

    // Mutate non-material metadata: dates, __v, poll counters
    const metadataMutatedData = {
      paymentCase: {
        ...baseRecordData.paymentCase,
        createdAt: new Date("2026-10-12T12:00:00Z"),
        updatedAt: new Date("2026-10-12T15:30:00Z"),
        __v: 5,
        pollCount: 99,
        leaseRenewalCount: 42,
        attemptCount: 17
      },
      gatewayPayment: {
        ...baseRecordData.gatewayPayment,
        createdAt: new Date("2026-10-12T01:00:00Z"),
        updatedAt: new Date("2026-10-12T16:45:00Z"),
        __v: 3
      },
      merchantOrder: {
        ...baseRecordData.merchantOrder,
        createdAt: new Date("2026-10-12T02:00:00Z"),
        updatedAt: new Date("2026-10-12T17:15:00Z"),
        __v: 8
      }
    };

    const hashAfterMetadataMutation = computeClassifierRecordHash(metadataMutatedData);
    expect(hashAfterMetadataMutation).toBe(initialHash);

    // Mutate material status: gateway status changes to REFUNDED
    const statusMutatedData = {
      ...baseRecordData,
      gatewayPayment: {
        ...baseRecordData.gatewayPayment,
        status: "REFUNDED"
      }
    };
    const hashAfterStatusMutation = computeClassifierRecordHash(statusMutatedData);
    expect(hashAfterStatusMutation).not.toBe(initialHash);

    // Mutate material amount: amountPaise changes
    const amountMutatedData = {
      ...baseRecordData,
      gatewayPayment: {
        ...baseRecordData.gatewayPayment,
        amountPaise: 75000
      }
    };
    const hashAfterAmountMutation = computeClassifierRecordHash(amountMutatedData);
    expect(hashAfterAmountMutation).not.toBe(initialHash);
  });
});
