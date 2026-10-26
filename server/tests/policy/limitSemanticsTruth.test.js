import { describe, it, expect } from "vitest";
import { evaluateResolutionPolicy } from "../../src/services/policy/resolutionPolicyEvaluator.js";

describe("A5: Limit Semantics Truth Verification — maxCumulativeRefundPaise has no effect today", () => {
  const TENANT_ID = "tenant_truth_01";
  const CASE_ID = "CASE-LIMIT-TRUTH-01";

  const baseValidEvidence = {
    paymentCase: {
      caseId: CASE_ID,
      tenantId: TENANT_ID,
      orderStatus: "ORDER_CREATED",
      captureStatus: "CAPTURE_NONE",
      resolutionCaseStatus: "CASE_DETECTED",
      discrepancyCategory: "STATUS_MISMATCH"
    },
    gatewayPayment: {
      gatewayPaymentId: "pay_limit_01",
      tenantId: TENANT_ID,
      status: "CAPTURED",
      amountPaise: 500000,
      currency: "INR"
    },
    merchantOrder: {
      merchantOrderId: "order_limit_01",
      tenantId: TENANT_ID,
      amountPaise: 500000,
      currency: "INR",
      status: "ORDER_CREATED"
    },
    refundRecords: []
  };

  const testMatrix = [
    { targetRefund: 10000, maxSingle: 50000, cumulativeVariants: [50000, 100000, 500000, 10000000] },
    { targetRefund: 50000, maxSingle: 50000, cumulativeVariants: [50000, 75000, 200000, 10000000] },
    { targetRefund: 50001, maxSingle: 50000, cumulativeVariants: [50000, 50001, 100000, 10000000] },
    { targetRefund: 150000, maxSingle: 100000, cumulativeVariants: [100000, 150000, 300000, 10000000] },
    { targetRefund: 300000, maxSingle: 200000, cumulativeVariants: [200000, 250000, 300000, 10000000] }
  ];

  testMatrix.forEach(({ targetRefund, maxSingle, cumulativeVariants }, index) => {
    it(`Row ${index + 1}: targetRefund=${targetRefund}, maxSingle=${maxSingle} outcome is invariant across maxCumulative variants`, () => {
      const results = cumulativeVariants.map((maxCumulative) => {
        const policyConfig = {
          currency: "INR",
          maxSingleRefundPaise: maxSingle,
          maxCumulativeRefundPaise: maxCumulative,
          currentCumulativeDailyPaise: 0
        };

        const result = evaluateResolutionPolicy({
          tenantId: TENANT_ID,
          caseId: CASE_ID,
          actorId: "admin_user",
          actorRole: "ADMIN",
          proposedActionType: "REQUEST_REFUND",
          amountPaise: targetRefund,
          currency: "INR",
          authoritativeEvidence: {
            ...baseValidEvidence,
            gatewayPayment: {
              ...baseValidEvidence.gatewayPayment,
              amountPaise: Math.max(targetRefund, 500000)
            }
          },
          policyConfig
        });

        return {
          maxCumulative,
          outcomeStatus: result.outcomeStatus,
          appliedRuleIds: result.appliedRuleIds,
          denyReasons: result.denyReasons
        };
      });

      // Proof: Every variant of maxCumulativeRefundPaise produces the exact same outcomeStatus and appliedRuleIds
      const first = results[0];
      for (const res of results) {
        expect(res.outcomeStatus).toBe(first.outcomeStatus);
        expect(res.appliedRuleIds).toEqual(first.appliedRuleIds);
        // Guard 8 (R_REFUND_EXCEEDS_CUMULATIVE_LIMIT) is NEVER reached because single limit triggers first
        expect(res.appliedRuleIds).not.toContain("R_REFUND_EXCEEDS_CUMULATIVE_LIMIT");
      }

      if (targetRefund > maxSingle) {
        expect(first.outcomeStatus).toBe("REJECTED_BY_POLICY");
        expect(first.appliedRuleIds).toContain("R_REFUND_EXCEEDS_SINGLE_LIMIT");
      }
    });
  });

  it("proves that R_REFUND_EXCEEDS_CUMULATIVE_LIMIT is unreachable when currentCumulativeDailyPaise = 0 and single <= cumulative", () => {
    // If targetRefund <= maxSingle <= maxCumulative, refund passes Guard 7 and Guard 8
    const passes = evaluateResolutionPolicy({
      tenantId: TENANT_ID,
      caseId: CASE_ID,
      actorId: "admin_user",
      actorRole: "ADMIN",
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 20000,
      currency: "INR",
      authoritativeEvidence: baseValidEvidence,
      policyConfig: {
        currency: "INR",
        maxSingleRefundPaise: 25000,
        maxCumulativeRefundPaise: 50000,
        currentCumulativeDailyPaise: 0
      }
    });
    expect(passes.appliedRuleIds).not.toContain("R_REFUND_EXCEEDS_SINGLE_LIMIT");
    expect(passes.appliedRuleIds).not.toContain("R_REFUND_EXCEEDS_CUMULATIVE_LIMIT");

    // If targetRefund > maxCumulative >= maxSingle, refund triggers Guard 7 (Single limit) first, never reaching Guard 8
    const rejectedBySingle = evaluateResolutionPolicy({
      tenantId: TENANT_ID,
      caseId: CASE_ID,
      actorId: "admin_user",
      actorRole: "ADMIN",
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 60000,
      currency: "INR",
      authoritativeEvidence: baseValidEvidence,
      policyConfig: {
        currency: "INR",
        maxSingleRefundPaise: 25000,
        maxCumulativeRefundPaise: 50000,
        currentCumulativeDailyPaise: 0
      }
    });
    expect(rejectedBySingle.outcomeStatus).toBe("REJECTED_BY_POLICY");
    expect(rejectedBySingle.appliedRuleIds).toContain("R_REFUND_EXCEEDS_SINGLE_LIMIT");
    expect(rejectedBySingle.appliedRuleIds).not.toContain("R_REFUND_EXCEEDS_CUMULATIVE_LIMIT");
  });
});
