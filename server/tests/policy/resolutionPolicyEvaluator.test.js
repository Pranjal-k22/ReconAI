import { describe, it, expect, vi } from "vitest";
import {
  evaluateResolutionPolicy,
  DEFAULT_POLICY_VERSION
} from "../../src/services/policy/resolutionPolicyEvaluator.js";
import * as razorpayClient from "../../src/services/razorpay/razorpayClient.js";

describe("Phase 8 — Deterministic Resolution Policy Evaluator & Refund Safety", () => {
  const TENANT = "tenant_alpha";
  const OTHER_TENANT = "tenant_beta";
  const CASE_ID = "CASE-POL-001";
  const VALID_CONFIG = {
    maxSingleRefundPaise: 500000, // ₹5,000 max single refund
    maxCumulativeRefundPaise: 2000000, // ₹20,000 max daily cumulative
    currentCumulativeDailyPaise: 0
  };

  const sampleGatewayPayment = {
    gatewayPaymentId: "pay_test_cap_01",
    tenantId: TENANT,
    status: "CAPTURED",
    amountPaise: 150000, // ₹1,500
    currency: "INR",
    merchantOrderId: "ORD-001"
  };

  const sampleMerchantOrder = {
    merchantOrderId: "ORD-001",
    tenantId: TENANT,
    status: "PENDING",
    amountPaise: 150000,
    currency: "INR"
  };

  // -------------------------------------------------------------------------
  // 1. Permitted WAIT_AND_MONITOR decision
  // -------------------------------------------------------------------------
  it("1. Permitted wait/monitor decision is evaluated and simulated without financial mutation", () => {
    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "WAIT_AND_MONITOR",
      authoritativeEvidence: {
        gatewayPayment: { ...sampleGatewayPayment, status: "PENDING" },
        merchantOrder: sampleMerchantOrder
      }
    });

    expect(result.outcomeStatus).toBe("ELIGIBLE_FOR_SIMULATION");
    expect(result.appliedRuleIds).toContain("R_WAIT_AND_MONITOR_ELIGIBLE");
    expect(result.isExecutable).toBe(false);
    expect(result.executionState).toBe("NON_EXECUTABLE_SIMULATION");
  });

  // -------------------------------------------------------------------------
  // 2. Permitted RECHECK_PROVIDER_STATUS
  // -------------------------------------------------------------------------
  it("2. Permitted provider status recheck is represented without any provider write call", () => {
    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "RECHECK_PROVIDER_STATUS",
      authoritativeEvidence: {
        gatewayPayment: sampleGatewayPayment,
        merchantOrder: sampleMerchantOrder
      }
    });

    expect(result.outcomeStatus).toBe("ELIGIBLE_FOR_SIMULATION");
    expect(result.appliedRuleIds).toContain("R_RECHECK_PROVIDER_STATUS_ELIGIBLE");
    expect(result.appliedRuleIds).toContain("R_PROVIDER_CAPABILITY_READ_ONLY");
    expect(result.isExecutable).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 3. Proposed UPDATE_MERCHANT_LOCAL_LEDGER
  // -------------------------------------------------------------------------
  it("3. Proposed local-ledger correction remains simulated and non-executable", () => {
    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "UPDATE_MERCHANT_LOCAL_LEDGER",
      authoritativeEvidence: {
        gatewayPayment: sampleGatewayPayment, // CAPTURED
        merchantOrder: sampleMerchantOrder // PENDING
      }
    });

    expect(result.outcomeStatus).toBe("ELIGIBLE_FOR_SIMULATION");
    expect(result.appliedRuleIds).toContain("R_LOCAL_LEDGER_REPAIR_ELIGIBLE");
    expect(result.amountPaise).toBe(150000);
    expect(result.isExecutable).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 4. Refund proposal with verified eligibility is simulated only
  // -------------------------------------------------------------------------
  it("4. Refund proposal with verified eligibility is simulated only and never sent to a provider", () => {
    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 150000,
      policyConfig: VALID_CONFIG,
      authoritativeEvidence: {
        gatewayPayment: sampleGatewayPayment,
        merchantOrder: { ...sampleMerchantOrder, status: "CANCELLED" }
      }
    });

    expect(result.outcomeStatus).toBe("ELIGIBLE_FOR_SIMULATION");
    expect(result.appliedRuleIds).toContain("R_REFUND_ELIGIBLE_FOR_SIMULATION");
    expect(result.amountPaise).toBe(150000);
    expect(result.isExecutable).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 5. Missing refund limits fail closed
  // -------------------------------------------------------------------------
  it("5. Missing refund limits fail closed with INSUFFICIENT_EVIDENCE", () => {
    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 150000,
      policyConfig: null, // Missing policy config
      authoritativeEvidence: {
        gatewayPayment: sampleGatewayPayment,
        merchantOrder: sampleMerchantOrder
      }
    });

    expect(result.outcomeStatus).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.appliedRuleIds).toContain("R_REFUND_LIMITS_MISSING_FAIL_CLOSED");
    expect(result.missingEvidence).toContain("POLICY_CONFIG");
  });

  // -------------------------------------------------------------------------
  // 6. Missing or conflicting capture/refund evidence fails closed
  // -------------------------------------------------------------------------
  it("6. Missing authoritative gateway payment evidence fails closed with INSUFFICIENT_EVIDENCE", () => {
    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 150000,
      policyConfig: VALID_CONFIG,
      authoritativeEvidence: {
        gatewayPayment: null, // Missing payment evidence
        merchantOrder: sampleMerchantOrder
      }
    });

    expect(result.outcomeStatus).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.appliedRuleIds).toContain("R_REFUND_UNVERIFIED_DEBIT_CLAIM");
    expect(result.missingEvidence).toContain("AUTHORITATIVE_GATEWAY_PAYMENT");
  });

  // -------------------------------------------------------------------------
  // 7. Customer debit claim without authoritative support cannot authorize refund
  // -------------------------------------------------------------------------
  it("7. Customer debit claim without authoritative gateway capture cannot authorize a refund", () => {
    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 50000,
      policyConfig: VALID_CONFIG,
      authoritativeEvidence: {
        gatewayPayment: { ...sampleGatewayPayment, status: "PENDING" }, // Only pending
        merchantOrder: sampleMerchantOrder
      }
    });

    expect(result.outcomeStatus).toBe("REJECTED_BY_POLICY");
    expect(result.appliedRuleIds).toContain("R_REFUND_GATEWAY_PENDING");
  });

  // -------------------------------------------------------------------------
  // 8. Gateway failure alone cannot authorize a refund
  // -------------------------------------------------------------------------
  it("8. Gateway failure alone cannot authorize a refund without captured funds", () => {
    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 150000,
      policyConfig: VALID_CONFIG,
      authoritativeEvidence: {
        gatewayPayment: { ...sampleGatewayPayment, status: "FAILED" },
        merchantOrder: sampleMerchantOrder
      }
    });

    expect(result.outcomeStatus).toBe("REJECTED_BY_POLICY");
    expect(result.appliedRuleIds).toContain("R_REFUND_GATEWAY_FAILED_NO_FUNDS");
  });

  // -------------------------------------------------------------------------
  // 9. Existing refund totals and refundable balance limits correctly enforced
  // -------------------------------------------------------------------------
  it("9. Existing refund totals and refundable-balance limits are correctly enforced", () => {
    // Payment was 150000 paise (₹1,500), already refunded 100000 paise (₹1,000). Remaining is 50000 paise (₹500).
    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 100000, // Proposed ₹1,000 > available ₹500
      policyConfig: VALID_CONFIG,
      authoritativeEvidence: {
        gatewayPayment: sampleGatewayPayment,
        refundRecords: [{ amountPaise: 100000, status: "PROCESSED" }]
      }
    });

    expect(result.outcomeStatus).toBe("REJECTED_BY_POLICY");
    expect(result.appliedRuleIds).toContain("R_REFUND_EXCEEDS_REFUNDABLE_BALANCE");
  });

  it("9b. Single refund limit exceeding threshold is rejected", () => {
    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 600000, // ₹6,000 > ₹5,000 limit
      policyConfig: VALID_CONFIG,
      authoritativeEvidence: {
        gatewayPayment: { ...sampleGatewayPayment, amountPaise: 700000 }
      }
    });

    expect(result.outcomeStatus).toBe("REJECTED_BY_POLICY");
    expect(result.appliedRuleIds).toContain("R_REFUND_EXCEEDS_SINGLE_LIMIT");
  });

  // -------------------------------------------------------------------------
  // 10. Wrong tenant, merchant, order, or cross-tenant attempt is rejected
  // -------------------------------------------------------------------------
  it("10. Cross-tenant payment attempt is rejected by policy", () => {
    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "WAIT_AND_MONITOR",
      authoritativeEvidence: {
        gatewayPayment: { ...sampleGatewayPayment, tenantId: OTHER_TENANT }
      }
    });

    expect(result.outcomeStatus).toBe("REJECTED_BY_POLICY");
    expect(result.appliedRuleIds).toContain("R_CROSS_TENANT_PAYMENT_BLOCKED");
  });

  // -------------------------------------------------------------------------
  // 11. Late capture on cancelled order remains on safe hold
  // -------------------------------------------------------------------------
  it("11. Late capture on a cancelled order remains in SAFE_HOLD and order cannot be reopened", () => {
    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "UPDATE_MERCHANT_LOCAL_LEDGER",
      authoritativeEvidence: {
        gatewayPayment: sampleGatewayPayment,
        merchantOrder: { ...sampleMerchantOrder, status: "CANCELLED" },
        paymentCase: { isSafeHold: true, safeHoldCode: "LATE_CAPTURE_CANCELLED_ORDER" }
      }
    });

    expect(result.outcomeStatus).toBe("SAFE_HOLD");
    expect(result.appliedRuleIds).toContain("R_LATE_CAPTURE_CANCELLED_ORDER_HOLD");
  });

  // -------------------------------------------------------------------------
  // 12. Formal disputes and fraud allegations follow safe-hold quarantine
  // -------------------------------------------------------------------------
  it("12a. Formal dispute / chargeback (Case 30) strictly blocks automated refund with SAFE_HOLD", () => {
    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 150000,
      policyConfig: VALID_CONFIG,
      authoritativeEvidence: {
        gatewayPayment: sampleGatewayPayment,
        disputeRecord: { disputeId: "disp_001", status: "UNDER_REVIEW" }
      }
    });

    expect(result.outcomeStatus).toBe("SAFE_HOLD");
    expect(result.appliedRuleIds).toContain("R_FORMAL_DISPUTE_SAFE_HOLD");
  });

  it("12b. Fraud allegation (Case 29) freezes automated refunds with SAFE_HOLD", () => {
    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 150000,
      policyConfig: VALID_CONFIG,
      classificationFinding: { scenarioId: "CASE_29_FRAUD_CLAIM" },
      authoritativeEvidence: {
        gatewayPayment: sampleGatewayPayment
      }
    });

    expect(result.outcomeStatus).toBe("SAFE_HOLD");
    expect(result.appliedRuleIds).toContain("R_FRAUD_ALLEGATION_SAFE_HOLD");
  });

  // -------------------------------------------------------------------------
  // 13. Unknown action type & unsupported policy version are rejected
  // -------------------------------------------------------------------------
  it("13. Unknown action type and unsupported policy versions are rejected safely", () => {
    const resBadAction = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "EXECUTE_ARBITRARY_TRANSFER"
    });
    expect(resBadAction.outcomeStatus).toBe("REJECTED_BY_POLICY");
    expect(resBadAction.appliedRuleIds).toContain("R_UNKNOWN_ACTION_TYPE");

    const resBadVer = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "WAIT_AND_MONITOR",
      policyVersion: "9999-99-99.v9"
    });
    expect(resBadVer.outcomeStatus).toBe("REJECTED_BY_POLICY");
    expect(resBadVer.appliedRuleIds).toContain("R_UNSUPPORTED_POLICY_VERSION");
  });

  // -------------------------------------------------------------------------
  // 14. AI proposals cannot override deterministic policy decisions
  // -------------------------------------------------------------------------
  it("14. AI proposal cannot override deterministic policy (e.g. AI recommends refund on pending payment)", () => {
    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "REQUEST_REFUND",
      advisoryAiSuggestion: "ADVISORY_REQUEST_CUSTOMER_BANK_STATEMENT",
      policyConfig: VALID_CONFIG,
      authoritativeEvidence: {
        gatewayPayment: { ...sampleGatewayPayment, status: "PENDING" }
      }
    });

    // Despite AI context, deterministic rule rejects refund on pending payment
    expect(result.outcomeStatus).toBe("REJECTED_BY_POLICY");
    expect(result.appliedRuleIds).toContain("R_AI_ADVISORY_CHECK");
    expect(result.appliedRuleIds).toContain("R_REFUND_GATEWAY_PENDING");
  });

  // -------------------------------------------------------------------------
  // 22. Invariant: zero provider write methods exist on razorpayClient
  // -------------------------------------------------------------------------
  it("22. Proves zero provider write APIs are called or exist on razorpayClient", () => {
    expect(razorpayClient.createRefund).toBeUndefined();
    expect(razorpayClient.capturePayment).toBeUndefined();
    expect(razorpayClient.createTransfer).toBeUndefined();
  });

  // -------------------------------------------------------------------------
  // 25. Complete 30-Scenario Policy Matrix Coverage Assertions
  // -------------------------------------------------------------------------
  describe("25. Comprehensive Policy Matrix Coverage (All 30 Edge Cases)", () => {
    const testCases = [
      { id: "CASE_1_FRONTEND_TIMEOUT_PAYMENT_SUCCESS", action: "UPDATE_MERCHANT_LOCAL_LEDGER", expected: "ELIGIBLE_FOR_SIMULATION" },
      { id: "CASE_2_CUSTOMER_DEBIT_CLAIM_PAYMENT_PENDING", action: "WAIT_AND_MONITOR", expected: "ELIGIBLE_FOR_SIMULATION" },
      { id: "CASE_3_CUSTOMER_DEBIT_CLAIM_PAYMENT_FAILED", action: "WAIT_AND_MONITOR", expected: "ELIGIBLE_FOR_SIMULATION" },
      { id: "CASE_4_LATE_AUTHORIZATION", action: "WAIT_AND_MONITOR", expected: "ELIGIBLE_FOR_SIMULATION" },
      { id: "CASE_5_CAPTURED_DELAYED_SETTLEMENT", action: "WAIT_AND_MONITOR", expected: "ELIGIBLE_FOR_SIMULATION" },
      { id: "CASE_6_PAID_GATEWAY_UNPAID_ORDER", action: "UPDATE_MERCHANT_LOCAL_LEDGER", expected: "ELIGIBLE_FOR_SIMULATION" },
      { id: "CASE_7_DUPLICATE_PAYMENT", action: "WAIT_AND_MONITOR", expected: "ELIGIBLE_FOR_SIMULATION" },
      { id: "CASE_8_PARTIAL_CAPTURE", action: "SAFE_HOLD", expected: "SAFE_HOLD" },
      { id: "CASE_9_PARTIAL_PAYMENT", action: "WAIT_AND_MONITOR", expected: "ELIGIBLE_FOR_SIMULATION" },
      { id: "CASE_10_PARTIAL_REFUND", action: "UPDATE_MERCHANT_LOCAL_LEDGER", expected: "ELIGIBLE_FOR_SIMULATION" },
      { id: "CASE_11_REFUND_PENDING_TIMEOUT", action: "WAIT_AND_MONITOR", expected: "ELIGIBLE_FOR_SIMULATION" },
      { id: "CASE_12_REFUND_FAILED", action: "SAFE_HOLD", expected: "SAFE_HOLD" },
      { id: "CASE_13_STALE_EVENT_DELIVERY", action: "WAIT_AND_MONITOR", expected: "ELIGIBLE_FOR_SIMULATION" },
      { id: "CASE_14_DUPLICATE_WEBHOOK", action: "WAIT_AND_MONITOR", expected: "ELIGIBLE_FOR_SIMULATION" },
      { id: "CASE_15_FORGED_WEBHOOK", action: "SAFE_HOLD", expected: "SAFE_HOLD" },
      { id: "CASE_16_OUT_OF_ORDER_WEBHOOK", action: "RECHECK_PROVIDER_STATUS", expected: "ELIGIBLE_FOR_SIMULATION" },
      { id: "CASE_17_LOST_WEBHOOK", action: "RECHECK_PROVIDER_STATUS", expected: "ELIGIBLE_FOR_SIMULATION" },
      { id: "CASE_18_CONFLICTING_PROVIDER_MERCHANT_RECORDS", action: "SAFE_HOLD", expected: "SAFE_HOLD" },
      { id: "CASE_19_AMOUNT_CURRENCY_MISMATCH", action: "SAFE_HOLD", expected: "SAFE_HOLD" },
      { id: "CASE_20_DUPLICATE_SETTLEMENT", action: "UPDATE_MERCHANT_LOCAL_LEDGER", expected: "ELIGIBLE_FOR_SIMULATION" },
      { id: "CASE_21_MISSING_SETTLEMENT", action: "EXTERNAL_ESCALATION_REQUIRED", expected: "ELIGIBLE_FOR_SIMULATION" },
      { id: "CASE_22_CANCELLED_ORDER_CAPTURED", action: "REQUEST_REFUND", expected: "ELIGIBLE_FOR_SIMULATION" },
      { id: "CASE_23_AMBIGUOUS_CANDIDATE_MATCH", action: "SAFE_HOLD", expected: "SAFE_HOLD" },
      { id: "CASE_24_PROVIDER_UNAVAILABLE", action: "WAIT_AND_MONITOR", expected: "ELIGIBLE_FOR_SIMULATION" },
      { id: "CASE_25_DATABASE_OUTAGE_RECOVERY", action: "RECHECK_PROVIDER_STATUS", expected: "ELIGIBLE_FOR_SIMULATION" },
      { id: "CASE_26_WORKER_LEASE_EXPIRED", action: "RECHECK_PROVIDER_STATUS", expected: "ELIGIBLE_FOR_SIMULATION" },
      { id: "CASE_27_CONCURRENT_ATTEMPT", action: "WAIT_AND_MONITOR", expected: "ELIGIBLE_FOR_SIMULATION" },
      { id: "CASE_28_CROSS_TENANT_BLOCKED", action: "WAIT_AND_MONITOR", expected: "REJECTED_BY_POLICY" },
      { id: "CASE_29_FRAUD_CLAIM", action: "SAFE_HOLD", expected: "SAFE_HOLD" },
      { id: "CASE_30_FORMAL_DISPUTE", action: "SAFE_HOLD", expected: "SAFE_HOLD" }
    ];

    testCases.forEach(({ id, action, expected }) => {
      it(`verifies scenario ${id} maps to policy outcome ${expected}`, () => {
        const evidence = {
          gatewayPayment: {
            ...sampleGatewayPayment,
            tenantId: id === "CASE_28_CROSS_TENANT_BLOCKED" ? OTHER_TENANT : TENANT,
            status: id === "CASE_2_CUSTOMER_DEBIT_CLAIM_PAYMENT_PENDING" ? "PENDING" : "CAPTURED"
          },
          merchantOrder: {
            ...sampleMerchantOrder,
            status: id === "CASE_22_CANCELLED_ORDER_CAPTURED" ? "CANCELLED" : "PENDING"
          }
        };

        const result = evaluateResolutionPolicy({
          tenantId: TENANT,
          caseId: `CASE-${id}`,
          proposedActionType: action,
          policyConfig: VALID_CONFIG,
          classificationFinding: { scenarioId: id },
          authoritativeEvidence: evidence
        });

        expect(result.outcomeStatus).toBe(expected);
      });
    });
  });
});
