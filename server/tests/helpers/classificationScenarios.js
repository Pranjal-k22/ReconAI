const TENANT = "tenant_merch_01";

export const CLASSIFICATION_SCENARIOS = [
  {
    caseNum: 1,
    scenarioId: "CASE_1_FRONTEND_TIMEOUT_PAYMENT_SUCCESS",
    input: {
      gatewayPayment: { gatewayPaymentId: "pay_01", status: "CAPTURED", amountPaise: 50000, currency: "INR", tenantId: TENANT },
      merchantOrder: { merchantOrderId: "order_01", status: "PENDING", amountPaise: 50000, currency: "INR", tenantId: TENANT },
      lifecycleEvents: [{
        eventId: "evt_server_verified_fe_001",
        sourceSystem: "RECONAI_SYSTEM",
        serverVerifiedTelemetry: true,
        tenantId: TENANT,
        merchantOrderId: "order_01",
        gatewayPaymentId: "pay_01",
        normalizedEventType: "CHECKOUT_TIMEOUT",
        occurredAt: new Date()
      }],
      context: { tenantId: TENANT }
    },
    expectedSafeHold: false,
    expectedSafeHoldCode: "NONE"
  },
  {
    caseNum: 2,
    scenarioId: "CASE_2_CUSTOMER_DEBIT_CLAIM_GATEWAY_PENDING",
    input: {
      gatewayPayment: { status: "PENDING", amountPaise: 50000, currency: "INR", tenantId: TENANT },
      customerClaims: [{ text: "Debited from my bank account", claimType: "DEBIT_CLAIM" }],
      context: { pendingMinutes: 65, customerDebitClaim: true, tenantId: TENANT }
    },
    expectedSafeHold: true,
    expectedSafeHoldCode: "CUSTOMER_DEBIT_ON_GATEWAY_PENDING"
  },
  {
    caseNum: 3,
    scenarioId: "CASE_3_CUSTOMER_DEBIT_CLAIM_PAYMENT_FAILED",
    input: {
      gatewayPayment: { status: "FAILED", amountPaise: 50000, currency: "INR", tenantId: TENANT },
      customerClaims: [{ text: "Debited but failed", claimType: "DEBIT_CLAIM" }],
      context: { customerDebitClaim: true, reversalOverdue: true, tenantId: TENANT }
    },
    expectedSafeHold: true,
    expectedSafeHoldCode: "CUSTOMER_DEBIT_ON_GATEWAY_FAILURE"
  },
  {
    caseNum: 4,
    scenarioId: "CASE_4_LATE_AUTHORIZATION_AFTER_TIMEOUT",
    input: {
      gatewayPayment: { status: "AUTHORIZED", amountPaise: 50000, currency: "INR", tenantId: TENANT },
      context: { isLateAuthorization: true, tenantId: TENANT }
    },
    expectedSafeHold: false,
    expectedSafeHoldCode: "NONE"
  },
  {
    caseNum: 5,
    scenarioId: "CASE_5_CAPTURED_PAYMENT_DELAYED_SETTLEMENT",
    input: {
      gatewayPayment: { status: "CAPTURED", amountPaise: 50000, currency: "INR", tenantId: TENANT },
      merchantOrder: { status: "PAID", amountPaise: 50000, currency: "INR", tenantId: TENANT },
      context: { delayedSettlement: true, elapsedHoursSincePayment: 48, tenantId: TENANT }
    },
    expectedSafeHold: false,
    expectedSafeHoldCode: "NONE"
  },
  {
    caseNum: 6,
    scenarioId: "CASE_6_PAID_GATEWAY_UNPAID_ORDER",
    input: {
      gatewayPayment: { status: "CAPTURED", amountPaise: 50000, currency: "INR", tenantId: TENANT },
      merchantOrder: { status: "PENDING", amountPaise: 50000, currency: "INR", tenantId: TENANT },
      context: { tenantId: TENANT }
    },
    expectedSafeHold: false,
    expectedSafeHoldCode: "NONE"
  },
  {
    caseNum: 7,
    scenarioId: "CASE_7_DUPLICATE_PAYMENT_ATTEMPTS",
    input: {
      context: { duplicatePaymentAttempts: true, amountsDiffer: true, tenantId: TENANT }
    },
    expectedSafeHold: true,
    expectedSafeHoldCode: "DUPLICATE_PAYMENT_AMOUNTS_DIFFER"
  },
  {
    caseNum: 8,
    scenarioId: "CASE_8_PARTIAL_CAPTURE",
    input: {
      gatewayPayment: {
        status: "PARTIALLY_CAPTURED",
        amountPaise: 50000,
        amountCapturedPaise: 30000,
        amountAuthorizedPaise: 50000,
        currency: "INR",
        tenantId: TENANT
      },
      context: { partialCapture: true, tenantId: TENANT }
    },
    expectedSafeHold: true,
    expectedSafeHoldCode: "PARTIAL_CAPTURE"
  },
  {
    caseNum: 9,
    scenarioId: "CASE_9_PARTIAL_PAYMENT",
    input: {
      gatewayPayment: { amountPaise: 25000, currency: "INR", tenantId: TENANT },
      merchantOrder: { amountPaise: 50000, currency: "INR", tenantId: TENANT },
      context: { partialPaymentExplicit: true, partialPaymentWindowExpired: true, tenantId: TENANT }
    },
    expectedSafeHold: true,
    expectedSafeHoldCode: "PARTIAL_PAYMENT"
  },
  {
    caseNum: 10,
    scenarioId: "CASE_10_PARTIAL_REFUND",
    input: {
      gatewayPayment: {
        status: "CAPTURED",
        amountPaise: 50000,
        amountCapturedPaise: 50000,
        amountRefundedPaise: 60000,
        currency: "INR",
        tenantId: TENANT
      },
      context: { partialRefund: true, tenantId: TENANT }
    },
    expectedSafeHold: true,
    expectedSafeHoldCode: "PARTIAL_REFUND_EXCEEDS_CAPTURED"
  },
  {
    caseNum: 11,
    scenarioId: "CASE_11_FULL_REFUND_INITIATED_NOT_COMPLETED",
    input: {
      gatewayPayment: { status: "CAPTURED", refundStatus: "PENDING", tenantId: TENANT },
      context: { refundPending: true, refundPendingDays: 10, tenantId: TENANT }
    },
    expectedSafeHold: true,
    expectedSafeHoldCode: "REFUND_PENDING_TIMEOUT"
  },
  {
    caseNum: 12,
    scenarioId: "CASE_12_FAILED_REFUND",
    input: {
      gatewayPayment: { status: "CAPTURED", refundStatus: "FAILED", tenantId: TENANT },
      context: { refundFailed: true, tenantId: TENANT }
    },
    expectedSafeHold: true,
    expectedSafeHoldCode: "REFUND_FAILED"
  },
  {
    caseNum: 13,
    scenarioId: "CASE_13_STALE_EVENT_AFTER_REFUND",
    input: {
      gatewayPayment: { status: "REFUNDED", tenantId: TENANT },
      context: { isStaleEvent: true, tenantId: TENANT }
    },
    expectedSafeHold: false,
    expectedSafeHoldCode: "NONE"
  },
  {
    caseNum: 14,
    scenarioId: "CASE_14_DUPLICATE_WEBHOOK_DELIVERY",
    input: {
      context: { isDuplicateWebhook: true, tenantId: TENANT }
    },
    expectedSafeHold: false,
    expectedSafeHoldCode: "NONE"
  },
  {
    caseNum: 15,
    scenarioId: "CASE_15_FORGED_WEBHOOK",
    input: {
      context: { signatureValid: false, tenantId: TENANT }
    },
    expectedSafeHold: true,
    expectedSafeHoldCode: "POLICY_REJECTED"
  },
  {
    caseNum: 16,
    scenarioId: "CASE_16_OUT_OF_ORDER_WEBHOOK",
    input: {
      gatewayPayment: { status: "CREATED", tenantId: TENANT },
      context: { incomingEvent: { eventType: "payment.captured" }, isOutOfOrder: true, tenantId: TENANT }
    },
    expectedSafeHold: false,
    expectedSafeHoldCode: "NONE"
  },
  {
    caseNum: 17,
    scenarioId: "CASE_17_LOST_WEBHOOK",
    input: {
      gatewayPayment: { status: "CAPTURED", tenantId: TENANT },
      context: { source: "GATEWAY_API_POLL", pollResult: true, tenantId: TENANT }
    },
    expectedSafeHold: false,
    expectedSafeHoldCode: "NONE"
  },
  {
    caseNum: 18,
    scenarioId: "CASE_18_CONFLICTING_PROVIDER_MERCHANT_RECORDS",
    input: {
      gatewayPayment: { gatewayPaymentId: "pay_18", merchantOrderId: "order_A", tenantId: TENANT },
      merchantOrder: { merchantOrderId: "order_B", tenantId: TENANT },
      context: { tenantId: TENANT }
    },
    expectedSafeHold: true,
    expectedSafeHoldCode: "CONFLICTING_RECORDS"
  },
  {
    caseNum: 19,
    scenarioId: "CASE_19_AMOUNT_OR_CURRENCY_MISMATCH",
    input: {
      gatewayPayment: { amountPaise: 60000, currency: "INR", tenantId: TENANT },
      merchantOrder: { amountPaise: 50000, currency: "INR", tenantId: TENANT },
      context: { tenantId: TENANT }
    },
    expectedSafeHold: true,
    expectedSafeHoldCode: "AMOUNT_CURRENCY_MISMATCH"
  },
  {
    caseNum: 20,
    scenarioId: "CASE_20_DUPLICATE_SETTLEMENT_RECORD",
    input: {
      context: { duplicateSettlement: true, tenantId: TENANT }
    },
    expectedSafeHold: false,
    expectedSafeHoldCode: "NONE"
  },
  {
    caseNum: 21,
    scenarioId: "CASE_21_MISSING_SETTLEMENT_RECORD",
    input: {
      gatewayPayment: { gatewayPaymentId: "pay_021", status: "CAPTURED", amountPaise: 50000, currency: "INR", tenantId: TENANT },
      merchantOrder: { merchantOrderId: "ORD-021", status: "PAID", amountPaise: 50000, currency: "INR", tenantId: TENANT },
      settlementRecords: [],
      context: { missingSettlementOverdue: true, elapsedHoursSincePayment: 150, tenantId: TENANT }
    },
    expectedSafeHold: true,
    expectedSafeHoldCode: "MISSING_SETTLEMENT"
  },
  {
    caseNum: 22,
    scenarioId: "CASE_22_PAYMENT_CAPTURED_ORDER_CANCELLED",
    input: {
      gatewayPayment: { status: "CAPTURED", tenantId: TENANT },
      merchantOrder: { status: "CANCELLED", tenantId: TENANT },
      context: { tenantId: TENANT }
    },
    expectedSafeHold: true,
    expectedSafeHoldCode: "LATE_CAPTURE_CANCELLED_ORDER"
  },
  {
    caseNum: 23,
    scenarioId: "CASE_23_AMBIGUOUS_PAYMENT_CANDIDATES",
    input: {
      context: { ambiguousCandidates: true, candidateMatches: [{ id: "pay_1" }, { id: "pay_2" }], confidence: 0.6, tenantId: TENANT }
    },
    expectedSafeHold: true,
    expectedSafeHoldCode: "AMBIGUOUS_PAYMENTS"
  },
  {
    caseNum: 24,
    scenarioId: "CASE_24_PROVIDER_UNAVAILABLE_RATE_LIMITED",
    input: {
      context: { providerError: { status: 429, attempts: 5 }, tenantId: TENANT }
    },
    expectedSafeHold: true,
    expectedSafeHoldCode: "PROVIDER_ERROR"
  },
  {
    caseNum: 25,
    scenarioId: "CASE_25_DATABASE_OUTAGE_DURING_ACTION",
    input: {
      context: { databaseOutage: true, unresolvableOnReconnect: true, tenantId: TENANT }
    },
    expectedSafeHold: true,
    expectedSafeHoldCode: "DATABASE_OUTAGE_RECOVERY"
  },
  {
    caseNum: 26,
    scenarioId: "CASE_26_WORKER_CRASH_ACTION_PENDING",
    input: {
      context: { workerCrashedLeaseExpired: true, leaseRenewalCount: 3, tenantId: TENANT }
    },
    expectedSafeHold: true,
    expectedSafeHoldCode: "WORKER_LEASE_EXPIRED"
  },
  {
    caseNum: 27,
    scenarioId: "CASE_27_CONCURRENT_RESOLUTION_ATTEMPTS",
    input: {
      context: { lockConflict: true, tenantId: TENANT }
    },
    expectedSafeHold: false,
    expectedSafeHoldCode: "NONE"
  },
  {
    caseNum: 28,
    scenarioId: "CASE_28_CROSS_TENANT_ACCESS_ATTEMPT",
    input: {
      context: { crossTenantAttempt: true, actorTenantId: TENANT, tenantId: "other_tenant" }
    },
    expectedSafeHold: true,
    expectedSafeHoldCode: "POLICY_REJECTED"
  },
  {
    caseNum: 29,
    scenarioId: "CASE_29_FRAUD_ALLEGATION_UNAUTHORIZED_PAYMENT",
    input: {
      context: { fraudAllegation: true, tenantId: TENANT }
    },
    expectedSafeHold: true,
    expectedSafeHoldCode: "FRAUD_SUSPICION"
  },
  {
    caseNum: 30,
    scenarioId: "CASE_30_CHARGEBACK_OR_FORMAL_DISPUTE",
    input: {
      context: { formalDispute: true, tenantId: TENANT }
    },
    expectedSafeHold: true,
    expectedSafeHoldCode: "FORMAL_DISPUTE"
  }
];
