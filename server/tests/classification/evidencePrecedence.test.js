import { describe, it, expect } from "vitest";
import { classifyPaymentScenario } from "../../src/services/classification/evidenceClassifier.js";

const TENANT = "tenant_precedence_01";

describe("Deterministic Classifier Rule Precedence & Conflict Resolution (B4)", () => {
  const conflictPairs = [
    {
      name: "1. fraud allegation + duplicate payment attempts -> fraud safe-hold outranks duplicate payment",
      input: {
        gatewayPayment: {
          gatewayPaymentId: "pay_dup_01",
          status: "CAPTURED",
          amountPaise: 5000,
          currency: "INR",
          tenantId: TENANT
        },
        merchantOrder: {
          merchantOrderId: "order_dup_01",
          status: "PAID",
          amountPaise: 5000,
          currency: "INR",
          tenantId: TENANT
        },
        customerClaims: [
          { text: "Unauthorized account takeover fraud", claimType: "FRAUD_CLAIM", tenantId: TENANT }
        ],
        context: {
          tenantId: TENANT,
          fraudAllegation: true,
          duplicatePaymentAttempts: true,
          capturedPayments: [
            { gatewayPaymentId: "pay_dup_01", amountPaise: 5000, status: "CAPTURED" },
            { gatewayPaymentId: "pay_dup_02", amountPaise: 5000, status: "CAPTURED" }
          ],
          amountsDiffer: false
        }
      },
      expectedScenarioId: "CASE_29_FRAUD_ALLEGATION_UNAUTHORIZED_PAYMENT",
      expectedSafeHold: true,
      expectedSafeHoldCode: "FRAUD_SUSPICION"
    },
    {
      name: "2. formal dispute + refund pending -> dispute safe-hold outranks pending refund monitor",
      input: {
        gatewayPayment: {
          gatewayPaymentId: "pay_disp_01",
          status: "CAPTURED",
          refundStatus: "PENDING",
          dispute: { id: "disp_chargeback_99" },
          amountPaise: 10000,
          currency: "INR",
          tenantId: TENANT
        },
        merchantOrder: {
          merchantOrderId: "order_disp_01",
          status: "PAID",
          amountPaise: 10000,
          currency: "INR",
          tenantId: TENANT
        },
        context: {
          tenantId: TENANT,
          formalDispute: true,
          refundPending: true,
          refundPendingDays: 2 // Normal window, would be non-held Case 11 if not for dispute
        }
      },
      expectedScenarioId: "CASE_30_CHARGEBACK_OR_FORMAL_DISPUTE",
      expectedSafeHold: true,
      expectedSafeHoldCode: "FORMAL_DISPUTE"
    },
    {
      name: "3. forged webhook + duplicate webhook / status mismatch -> forged webhook security rejection outranks operational processing",
      input: {
        gatewayPayment: {
          gatewayPaymentId: "pay_forged_01",
          status: "CAPTURED",
          amountPaise: 7500,
          currency: "INR",
          tenantId: TENANT
        },
        merchantOrder: {
          merchantOrderId: "order_forged_01",
          status: "PENDING",
          amountPaise: 7500,
          currency: "INR",
          tenantId: TENANT
        },
        context: {
          tenantId: TENANT,
          signatureValid: false, // Forged HMAC
          isDuplicateWebhook: true, // Duplicate
          pollResult: true // API Poll
        }
      },
      expectedScenarioId: "CASE_15_FORGED_WEBHOOK",
      expectedSafeHold: true,
      expectedSafeHoldCode: "POLICY_REJECTED"
    },
    {
      name: "4. cross-tenant attempt + fraud allegation / dispute -> cross-tenant boundary rejection outranks all scenario evaluation",
      input: {
        gatewayPayment: {
          gatewayPaymentId: "pay_cross_01",
          status: "CAPTURED",
          amountPaise: 5000,
          currency: "INR",
          tenantId: "tenant_victim"
        },
        merchantOrder: {
          merchantOrderId: "order_cross_01",
          status: "PENDING",
          amountPaise: 5000,
          currency: "INR",
          tenantId: "tenant_attacker"
        },
        customerClaims: [
          { text: "Stolen card fraud", claimType: "FRAUD_CLAIM", tenantId: "tenant_victim" }
        ],
        context: {
          tenantId: "tenant_attacker",
          actorTenantId: "tenant_attacker",
          crossTenantAttempt: true,
          fraudAllegation: true,
          formalDispute: true
        }
      },
      expectedScenarioId: "CASE_28_CROSS_TENANT_ACCESS_ATTEMPT",
      expectedSafeHold: true,
      expectedSafeHoldCode: "POLICY_REJECTED"
    },
    {
      name: "5. conflicting records + repair eligible (status mismatch) -> conflicting records safe-hold outranks local ledger repair",
      input: {
        gatewayPayment: {
          gatewayPaymentId: "pay_conf_01",
          merchantOrderId: "order_PROVIDER_REF",
          status: "CAPTURED",
          amountPaise: 5000,
          currency: "INR",
          tenantId: TENANT
        },
        merchantOrder: {
          merchantOrderId: "order_MERCHANT_REF",
          status: "PENDING",
          amountPaise: 5000,
          currency: "INR",
          tenantId: TENANT
        },
        context: {
          tenantId: TENANT,
          conflictingRecords: true // Provider notes link to different order than merchant order
        }
      },
      expectedScenarioId: "CASE_18_CONFLICTING_PROVIDER_MERCHANT_RECORDS",
      expectedSafeHold: true,
      expectedSafeHoldCode: "CONFLICTING_RECORDS"
    },
    {
      name: "6. amount mismatch + status mismatch -> amount mismatch safe-hold outranks local ledger status update",
      input: {
        gatewayPayment: {
          gatewayPaymentId: "pay_amt_01",
          merchantOrderId: "order_amt_01",
          status: "CAPTURED",
          amountPaise: 4000, // 4000 paise vs 5000 paise
          currency: "INR",
          tenantId: TENANT
        },
        merchantOrder: {
          merchantOrderId: "order_amt_01",
          status: "PENDING",
          amountPaise: 5000,
          currency: "INR",
          tenantId: TENANT
        },
        context: {
          tenantId: TENANT,
          partialPaymentExplicit: false // Non-installment
        }
      },
      expectedScenarioId: "CASE_19_AMOUNT_OR_CURRENCY_MISMATCH",
      expectedSafeHold: true,
      expectedSafeHoldCode: "AMOUNT_CURRENCY_MISMATCH"
    },
    {
      name: "7. cancelled-order captured + paid-unpaid-order -> safeguard 6 preserves cancellation under safe-hold over status repair",
      input: {
        gatewayPayment: {
          gatewayPaymentId: "pay_canc_01",
          merchantOrderId: "order_canc_01",
          status: "CAPTURED",
          amountPaise: 6000,
          currency: "INR",
          tenantId: TENANT
        },
        merchantOrder: {
          merchantOrderId: "order_canc_01",
          status: "CANCELLED",
          amountPaise: 6000,
          currency: "INR",
          tenantId: TENANT
        },
        context: {
          tenantId: TENANT,
          pollResult: true // Reconstructed from poll, but cancellation must be preserved
        }
      },
      expectedScenarioId: "CASE_22_PAYMENT_CAPTURED_ORDER_CANCELLED",
      expectedSafeHold: true,
      expectedSafeHoldCode: "LATE_CAPTURE_CANCELLED_ORDER"
    },
    {
      name: "8. missing settlement (> 5 days) + status mismatch -> missing settlement safe-hold outranks ledger repair (Owner Decision Fix)",
      input: {
        gatewayPayment: {
          gatewayPaymentId: "pay_settle_01",
          merchantOrderId: "order_settle_01",
          status: "CAPTURED",
          amountPaise: 5000,
          currency: "INR",
          tenantId: TENANT
        },
        merchantOrder: {
          merchantOrderId: "order_settle_01",
          status: "PENDING",
          amountPaise: 5000,
          currency: "INR",
          tenantId: TENANT
        },
        settlementRecords: [],
        context: {
          tenantId: TENANT,
          elapsedHoursSincePayment: 140, // > 120h (T+5 days overdue)
          missingSettlementOverdue: true
        }
      },
      expectedScenarioId: "CASE_21_MISSING_SETTLEMENT_RECORD",
      expectedSafeHold: true,
      expectedSafeHoldCode: "MISSING_SETTLEMENT"
    }
  ];

  conflictPairs.forEach((cp, idx) => {
    it(cp.name, () => {
      const result = classifyPaymentScenario(cp.input);
      expect(result.scenarioId).toBe(cp.expectedScenarioId);
      expect(result.safeHold).toBe(cp.expectedSafeHold);
      expect(result.safeHoldCode).toBe(cp.expectedSafeHoldCode);
    });
  });
});
