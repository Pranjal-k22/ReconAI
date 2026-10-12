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
        merchantOrder: { ...sampleMerchantOrder, status: "RETURNED" }
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
  // 9. Authoritative Refundable Balance & Partial Capture Enforcements
  // -------------------------------------------------------------------------
  it("9a. Originally requested amount exceeds actual captured amount: refund up to captured is eligible", () => {
    // Requested amountPaise = 200000 (₹2,000), but capturedAmountPaise = 100000 (₹1,000)
    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 100000,
      policyConfig: VALID_CONFIG,
      authoritativeEvidence: {
        gatewayPayment: {
          ...sampleGatewayPayment,
          amountPaise: 200000,
          capturedAmountPaise: 100000
        }
      }
    });

    expect(result.outcomeStatus).toBe("ELIGIBLE_FOR_SIMULATION");
    expect(result.amountPaise).toBe(100000);
  });

  it("9b. Proposed refund exceeds captured balance but is below originally requested amount: fails closed", () => {
    // Requested amountPaise = 200000 (₹2,000), but capturedAmountPaise = 100000 (₹1,000). Proposed: 150000 (₹1,500).
    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 150000,
      policyConfig: VALID_CONFIG,
      authoritativeEvidence: {
        gatewayPayment: {
          ...sampleGatewayPayment,
          amountPaise: 200000,
          capturedAmountPaise: 100000
        }
      }
    });

    expect(result.outcomeStatus).toBe("REJECTED_BY_POLICY");
    expect(result.appliedRuleIds).toContain("R_REFUND_EXCEEDS_REFUNDABLE_BALANCE");
    expect(result.denyReasons[0]).toMatch(/exceeds available refundable balance/);
  });

  it("9c. Completed and pending refunds reduce the remaining balance correctly", () => {
    // Captured: ₹1,500 (150000 paise). Completed: ₹500 (50000 paise). Available: ₹700 (70000 paise).
    const resultCompletedOnly = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 70000,
      policyConfig: VALID_CONFIG,
      authoritativeEvidence: {
        gatewayPayment: sampleGatewayPayment,
        refundRecords: [
          { amountPaise: 50000, status: "PROCESSED" },
          { amountPaise: 30000, status: "CONFIRMED" }
        ]
      }
    });
    // Available = 150000 - 80000 = 70000
    expect(resultCompletedOnly.outcomeStatus).toBe("ELIGIBLE_FOR_SIMULATION");

    const resultExceeds = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 70001,
      policyConfig: VALID_CONFIG,
      authoritativeEvidence: {
        gatewayPayment: sampleGatewayPayment,
        refundRecords: [
          { amountPaise: 50000, status: "PROCESSED" },
          { amountPaise: 30000, status: "CONFIRMED" }
        ]
      }
    });
    expect(resultExceeds.outcomeStatus).toBe("REJECTED_BY_POLICY");
    expect(resultExceeds.appliedRuleIds).toContain("R_REFUND_EXCEEDS_REFUNDABLE_BALANCE");
  });

  it("9d. In-flight commitments from prior simulations reduce the remaining balance correctly", () => {
    // Captured = 150000 paise. inFlightCommitmentsPaise = 100000 paise. Available = 50000 paise.
    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 60000, // Exceeds remaining 50000
      policyConfig: VALID_CONFIG,
      authoritativeEvidence: {
        gatewayPayment: sampleGatewayPayment,
        inFlightCommitmentsPaise: 100000
      }
    });

    expect(result.outcomeStatus).toBe("REJECTED_BY_POLICY");
    expect(result.appliedRuleIds).toContain("R_REFUND_EXCEEDS_REFUNDABLE_BALANCE");
  });

  it("9e. Currency mismatch between payment and refund request fails closed", () => {
    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 100000,
      currency: "INR",
      policyConfig: VALID_CONFIG,
      authoritativeEvidence: {
        gatewayPayment: { ...sampleGatewayPayment, currency: "USD" }
      }
    });

    expect(result.outcomeStatus).toBe("REJECTED_BY_POLICY");
    expect(result.appliedRuleIds).toContain("R_CURRENCY_MISMATCH_FAIL_CLOSED");
  });

  it("9f. Missing or unverified captured-amount evidence fails closed with INSUFFICIENT_EVIDENCE or SAFE_HOLD", () => {
    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 100000,
      policyConfig: VALID_CONFIG,
      classificationFinding: { scenarioId: "CASE_8_PARTIAL_CAPTURE" },
      authoritativeEvidence: {
        gatewayPayment: { ...sampleGatewayPayment, status: "PARTIAL_CAPTURE", capturedAmountPaise: null }
      }
    });

    expect(result.outcomeStatus).toBe("SAFE_HOLD");
    expect(result.appliedRuleIds).toContain("R_PARTIAL_CAPTURE_SAFE_HOLD");
  });

  it("9g. Single refund limit exceeding threshold is rejected", () => {
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

  it("9h. Conflicting captured amount evidence across provider fields fails closed with SAFE_HOLD", () => {
    // Gateway payment specifies capturedAmountPaise = 100000, but rawData.amount_captured = 80000
    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 80000,
      policyConfig: VALID_CONFIG,
      authoritativeEvidence: {
        gatewayPayment: {
          ...sampleGatewayPayment,
          capturedAmountPaise: 100000,
          rawData: {
            amount_captured: 80000
          }
        }
      }
    });

    expect(result.outcomeStatus).toBe("SAFE_HOLD");
    expect(result.appliedRuleIds).toContain("R_CAPTURED_AMOUNT_CONFLICT_FAIL_CLOSED");
    expect(result.conflicts).toContain("CONFLICTING_CAPTURED_AMOUNT_EVIDENCE");
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
  // 11. Case 22: Late capture on cancelled order remains on safe hold
  // -------------------------------------------------------------------------
  it("11a. Late capture on cancelled order without approved evidence remains in SAFE_HOLD", () => {
    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 150000,
      policyConfig: VALID_CONFIG,
      classificationFinding: { scenarioId: "CASE_22_CANCELLED_ORDER_CAPTURED" },
      authoritativeEvidence: {
        gatewayPayment: sampleGatewayPayment,
        merchantOrder: { ...sampleMerchantOrder, status: "CANCELLED" }
      }
    });

    expect(result.outcomeStatus).toBe("SAFE_HOLD");
    expect(result.appliedRuleIds).toContain("R_LATE_CAPTURE_CANCELLED_ORDER_HOLD");
  });

  it("11b. AI advisory recommendation cannot override Case 22 safe hold", () => {
    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "REQUEST_REFUND",
      advisoryAiSuggestion: "ADVISORY_REQUEST_REFUND_IMMEDIATELY",
      amountPaise: 150000,
      policyConfig: VALID_CONFIG,
      classificationFinding: { scenarioId: "CASE_22_CANCELLED_ORDER_CAPTURED" },
      authoritativeEvidence: {
        gatewayPayment: sampleGatewayPayment,
        merchantOrder: { ...sampleMerchantOrder, status: "CANCELLED" }
      }
    });

    expect(result.outcomeStatus).toBe("SAFE_HOLD");
    expect(result.appliedRuleIds).toContain("R_LATE_CAPTURE_CANCELLED_ORDER_HOLD");
  });

  it("11c. Late capture cannot reopen a cancelled order via UPDATE_MERCHANT_LOCAL_LEDGER", () => {
    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "UPDATE_MERCHANT_LOCAL_LEDGER",
      authoritativeEvidence: {
        gatewayPayment: sampleGatewayPayment,
        merchantOrder: { ...sampleMerchantOrder, status: "CANCELLED" }
      }
    });

    expect(result.outcomeStatus).toBe("SAFE_HOLD");
    expect(result.appliedRuleIds).toContain("R_LATE_CAPTURE_CANCELLED_ORDER_HOLD");
  });

  it("11d. Caller-supplied approvedCancellationRefund: true cannot bypass Case 22 safe hold", () => {
    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 150000,
      policyConfig: VALID_CONFIG,
      classificationFinding: { scenarioId: "CASE_22_CANCELLED_ORDER_CAPTURED" },
      authoritativeEvidence: {
        gatewayPayment: sampleGatewayPayment,
        merchantOrder: { ...sampleMerchantOrder, status: "CANCELLED" },
        approvedCancellationRefund: true
      }
    });

    expect(result.outcomeStatus).toBe("SAFE_HOLD");
    expect(result.appliedRuleIds).toContain("R_LATE_CAPTURE_CANCELLED_ORDER_HOLD");
  });

  it("11e. Caller-supplied adminApproval: { approved: true } cannot bypass Case 22 safe hold", () => {
    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 150000,
      policyConfig: VALID_CONFIG,
      classificationFinding: { scenarioId: "CASE_22_CANCELLED_ORDER_CAPTURED" },
      authoritativeEvidence: {
        gatewayPayment: sampleGatewayPayment,
        merchantOrder: { ...sampleMerchantOrder, status: "CANCELLED" },
        adminApproval: { approved: true, actorId: "admin_forger" }
      }
    });

    expect(result.outcomeStatus).toBe("SAFE_HOLD");
    expect(result.appliedRuleIds).toContain("R_LATE_CAPTURE_CANCELLED_ORDER_HOLD");
  });

  it("11f. Forged approval fields combined with AI refund recommendation still produce SAFE_HOLD", () => {
    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 150000,
      advisoryAiSuggestion: "ADVISORY_REFUND_CUSTOMER_NOW",
      policyConfig: VALID_CONFIG,
      classificationFinding: { scenarioId: "CASE_22_CANCELLED_ORDER_CAPTURED" },
      authoritativeEvidence: {
        gatewayPayment: sampleGatewayPayment,
        merchantOrder: { ...sampleMerchantOrder, status: "CANCELLED" },
        approvedCancellationRefund: true,
        adminApproval: { approved: true }
      }
    });

    expect(result.outcomeStatus).toBe("SAFE_HOLD");
    expect(result.appliedRuleIds).toContain("R_LATE_CAPTURE_CANCELLED_ORDER_HOLD");
  });

  it("11g. In the absence of a trusted server approval mechanism, Case 22 unconditionally remains on SAFE_HOLD", () => {
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

    expect(result.outcomeStatus).toBe("SAFE_HOLD");
    expect(result.appliedRuleIds).toContain("R_LATE_CAPTURE_CANCELLED_ORDER_HOLD");
    expect(result.conflicts).toContain("LATE_CAPTURE_ON_CANCELLED_ORDER");
  });

  // -------------------------------------------------------------------------
  // 11_dup. Case 7: Conclusive Duplicate-Payment Evidence Verification
  // -------------------------------------------------------------------------
  it("11e. Conclusive duplicate payments with verified captures enable refund simulation", () => {
    const duplicatePayments = [
      {
        gatewayPaymentId: "pay_dup_01",
        tenantId: TENANT,
        status: "CAPTURED",
        amountPaise: 150000,
        currency: "INR",
        merchantOrderId: "ORD-001"
      },
      {
        gatewayPaymentId: "pay_dup_02",
        tenantId: TENANT,
        status: "CAPTURED",
        amountPaise: 150000,
        currency: "INR",
        merchantOrderId: "ORD-001"
      }
    ];

    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 150000,
      policyConfig: VALID_CONFIG,
      classificationFinding: { scenarioId: "CASE_7_DUPLICATE_PAYMENT" },
      authoritativeEvidence: {
        gatewayPayment: duplicatePayments[1],
        merchantOrder: sampleMerchantOrder,
        duplicatePayments,
        candidateScore: 0.99
      }
    });

    expect(result.outcomeStatus).toBe("ELIGIBLE_FOR_SIMULATION");
    expect(result.appliedRuleIds).toContain("R_CONCLUSIVE_DUPLICATE_PAYMENTS_VERIFIED");
    expect(result.appliedRuleIds).toContain("R_REFUND_ELIGIBLE_FOR_SIMULATION");
  });

  it("11f. Duplicate payment candidate without distinct second attempt returns INSUFFICIENT_EVIDENCE", () => {
    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 150000,
      policyConfig: VALID_CONFIG,
      classificationFinding: { scenarioId: "CASE_7_DUPLICATE_PAYMENT" },
      authoritativeEvidence: {
        gatewayPayment: sampleGatewayPayment,
        merchantOrder: sampleMerchantOrder,
        duplicatePayments: [sampleGatewayPayment] // Only 1 attempt
      }
    });

    expect(result.outcomeStatus).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.appliedRuleIds).toContain("R_DUPLICATE_EVIDENCE_INSUFFICIENT");
  });

  it("11g. Duplicate payment candidate where second payment is not CAPTURED returns SAFE_HOLD", () => {
    const duplicatePayments = [
      { ...sampleGatewayPayment, gatewayPaymentId: "pay_01", status: "CAPTURED" },
      { ...sampleGatewayPayment, gatewayPaymentId: "pay_02", status: "PENDING" }
    ];

    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 150000,
      policyConfig: VALID_CONFIG,
      classificationFinding: { scenarioId: "CASE_7_DUPLICATE_PAYMENT" },
      authoritativeEvidence: {
        gatewayPayment: duplicatePayments[0],
        merchantOrder: sampleMerchantOrder,
        duplicatePayments
      }
    });

    expect(result.outcomeStatus).toBe("SAFE_HOLD");
    expect(result.appliedRuleIds).toContain("R_DUPLICATE_PAYMENT_NOT_CAPTURED");
  });

  it("11h. Duplicate candidate with conflicting merchantOrderId returns SAFE_HOLD", () => {
    const duplicatePayments = [
      { ...sampleGatewayPayment, gatewayPaymentId: "pay_01", merchantOrderId: "ORD-001" },
      { ...sampleGatewayPayment, gatewayPaymentId: "pay_02", merchantOrderId: "ORD-999" }
    ];

    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 150000,
      policyConfig: VALID_CONFIG,
      classificationFinding: { scenarioId: "CASE_7_DUPLICATE_PAYMENT" },
      authoritativeEvidence: {
        gatewayPayment: duplicatePayments[0],
        merchantOrder: sampleMerchantOrder,
        duplicatePayments
      }
    });

    expect(result.outcomeStatus).toBe("SAFE_HOLD");
    expect(result.appliedRuleIds).toContain("R_CONFLICTING_ORDER_PAYMENT_LINK");
  });

  it("11i. Duplicate candidate across tenants is rejected by policy", () => {
    const duplicatePayments = [
      { ...sampleGatewayPayment, gatewayPaymentId: "pay_01", tenantId: TENANT },
      { ...sampleGatewayPayment, gatewayPaymentId: "pay_02", tenantId: OTHER_TENANT }
    ];

    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 150000,
      policyConfig: VALID_CONFIG,
      classificationFinding: { scenarioId: "CASE_7_DUPLICATE_PAYMENT" },
      authoritativeEvidence: {
        gatewayPayment: duplicatePayments[0],
        merchantOrder: sampleMerchantOrder,
        duplicatePayments
      }
    });

    expect(result.outcomeStatus).toBe("REJECTED_BY_POLICY");
    expect(result.appliedRuleIds).toContain("R_CROSS_TENANT_PAYMENT_BLOCKED");
  });

  it("11j. Ambiguous duplicate candidate below confidence threshold returns SAFE_HOLD", () => {
    const duplicatePayments = [
      { ...sampleGatewayPayment, gatewayPaymentId: "pay_01" },
      { ...sampleGatewayPayment, gatewayPaymentId: "pay_02" }
    ];

    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "REQUEST_REFUND",
      amountPaise: 150000,
      policyConfig: VALID_CONFIG,
      classificationFinding: { scenarioId: "CASE_7_DUPLICATE_PAYMENT" },
      authoritativeEvidence: {
        gatewayPayment: duplicatePayments[0],
        merchantOrder: sampleMerchantOrder,
        duplicatePayments,
        candidateScore: 0.85 // below 0.95 threshold
      }
    });

    expect(result.outcomeStatus).toBe("SAFE_HOLD");
    expect(result.appliedRuleIds).toContain("R_AMBIGUOUS_CANDIDATES_SAFE_HOLD");
  });

  // -------------------------------------------------------------------------
  // 11_case1. Case 1 Provenance Reconciliation
  // -------------------------------------------------------------------------
  it("11k. Case 1 without server-verified telemetry falls back to status-mismatch ledger repair", () => {
    const result = evaluateResolutionPolicy({
      tenantId: TENANT,
      caseId: CASE_ID,
      proposedActionType: "UPDATE_MERCHANT_LOCAL_LEDGER",
      classificationFinding: { scenarioId: "CASE_1_FRONTEND_TIMEOUT_PAYMENT_SUCCESS" },
      authoritativeEvidence: {
        gatewayPayment: sampleGatewayPayment,
        merchantOrder: sampleMerchantOrder,
        serverVerifiedTelemetry: false
      }
    });

    expect(result.outcomeStatus).toBe("ELIGIBLE_FOR_SIMULATION");
    expect(result.appliedRuleIds).toContain("R_UNVERIFIED_TIMEOUT_FALLBACK_TO_STATUS_MISMATCH");
    expect(result.appliedRuleIds).toContain("R_LOCAL_LEDGER_REPAIR_ELIGIBLE");
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
      { id: "CASE_22_CANCELLED_ORDER_CAPTURED", action: "REQUEST_REFUND", expected: "SAFE_HOLD" },
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
