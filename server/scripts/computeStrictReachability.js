import fs from "fs";
import path from "path";

// ReconAI 2.0 - Stage 5.6 Strict Reachability Audit with Production Writers
export const SCENARIOS = [
  {
    caseNumber: 1,
    scenarioId: "CASE_1_FRONTEND_TIMEOUT_PAYMENT_SUCCESS",
    category: "RESERVED",
    decisiveFields: ["authenticatedFrontendEvent", "serverVerifiedTelemetry"],
    productionWriter: "NONE",
    reason: "Requires authenticated client telemetry beacon endpoint with server-verified signature (not yet implemented).",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:16"
  },
  {
    caseNumber: 2,
    scenarioId: "CASE_2_CUSTOMER_DEBIT_CLAIM_GATEWAY_PENDING",
    category: "NEEDS_CLAIM_INTAKE",
    decisiveFields: ["customerClaims[].claimType === 'CUSTOMER_DEBIT_CLAIM'", "pendingMinutes >= 60"],
    productionWriter: "NONE",
    reason: "Requires customer portal claim intake route (out of scope for Stage 5).",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:32"
  },
  {
    caseNumber: 3,
    scenarioId: "CASE_3_CUSTOMER_DEBIT_CLAIM_PAYMENT_FAILED",
    category: "NEEDS_CLAIM_INTAKE",
    decisiveFields: ["customerClaims[].claimType === 'CUSTOMER_DEBIT_CLAIM'", "gatewayPayment.status === 'FAILED'"],
    productionWriter: "NONE",
    reason: "Requires customer portal claim intake route for debit claims on failed payments.",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:48"
  },
  {
    caseNumber: 4,
    scenarioId: "CASE_4_LATE_AUTHORIZATION_AFTER_TIMEOUT",
    category: "RESERVED",
    decisiveFields: ["gatewayPayment.status === 'AUTHORIZED'", "isLateAuthorization === true"],
    productionWriter: "NONE",
    reason: "Requires late-auth timeout correlation worker; reserved in classifier and policy domain models.",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:64"
  },
  {
    caseNumber: 5,
    scenarioId: "CASE_5_CAPTURED_PAYMENT_DELAYED_SETTLEMENT",
    category: "PROVEN_END_TO_END",
    decisiveFields: ["gatewayPayment.status === 'CAPTURED'", "settlementRecords.length === 0", "elapsedHours <= 72"],
    productionWriter: "server/src/services/webhook/webhookService.js:1165 (status: CAPTURED)",
    reason: "Standard webhook ingestion writes CAPTURED; absence of settlements is initial ingestion state within 72h window.",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:80"
  },
  {
    caseNumber: 6,
    scenarioId: "CASE_6_PAID_GATEWAY_UNPAID_ORDER",
    category: "PROVEN_END_TO_END",
    decisiveFields: ["gatewayPayment.status === 'CAPTURED'", "merchantOrder.orderStatus === 'ORDER_CREATED'"],
    productionWriter: "server/src/services/webhook/webhookService.js:1165 (Payment) & server/src/services/reconciliation/normalizationService.js:70 (Order)",
    reason: "Webhook writes payment capture while order remains in created/pending state in merchant ledger.",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:96"
  },
  {
    caseNumber: 7,
    scenarioId: "CASE_7_DUPLICATE_PAYMENT_ATTEMPTS",
    category: "PROVEN_END_TO_END",
    decisiveFields: ["duplicatePayments.length > 1"],
    productionWriter: "server/src/services/webhook/webhookService.js:1145",
    reason: "Webhook service ingests distinct payment attempts for the same merchant order ID.",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:112"
  },
  {
    caseNumber: 8,
    scenarioId: "CASE_8_PARTIAL_CAPTURE",
    category: "SEEDABLE_ONLY",
    decisiveFields: ["amountAuthorizedPaise", "amountCapturedPaise", "gatewayPayment.status === 'PARTIALLY_CAPTURED'"],
    productionWriter: "NONE (Defined in schema server/src/models/GatewayPayment.js:107,118; zero production writers in server/src)",
    reason: "Schema fields added in Part B enable test seeding, but standard Razorpay webhook ingestion has zero production writers for split capture.",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:145"
  },
  {
    caseNumber: 9,
    scenarioId: "CASE_9_PARTIAL_PAYMENT",
    category: "RESERVED",
    decisiveFields: ["gatewayPayment.amountPaise < merchantOrder.amountPaise", "isInstallment === true"],
    productionWriter: "NONE",
    reason: "Installment agreement tracking model reserved for future stage.",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:161"
  },
  {
    caseNumber: 10,
    scenarioId: "CASE_10_PARTIAL_REFUND",
    category: "SEEDABLE_ONLY",
    decisiveFields: ["gatewayPayment.refundAmountPaise > 0"],
    productionWriter: "NONE in webhook ingestion (legacy CSV import server/src/services/reconciliation/normalizationService.js:94; sandbox dispatch server/src/services/policy/providerDispatchService.js:667)",
    reason: "No production webhook populates partial refund amount on GatewayPayment; seedable in database.",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:177"
  },
  {
    caseNumber: 11,
    scenarioId: "CASE_11_FULL_REFUND_INITIATED_NOT_COMPLETED",
    category: "SEEDABLE_ONLY",
    decisiveFields: ["ProviderOperation.status === 'PENDING'", "gatewayPayment.refundStatus === 'PENDING'"],
    productionWriter: "NONE in webhook ingestion (sandbox dispatch server/src/services/policy/providerDispatchService.js:667)",
    reason: "Refund initiation performed only through sandbox dispatch; no production webhook sets in-flight pending refund state without manual seed.",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:193"
  },
  {
    caseNumber: 12,
    scenarioId: "CASE_12_FAILED_REFUND",
    category: "SEEDABLE_ONLY",
    decisiveFields: ["gatewayPayment.refundStatus === 'FAILED'"],
    productionWriter: "NONE in webhook ingestion (sandbox dispatch error handler server/src/services/policy/providerDispatchService.js:770)",
    reason: "Webhook handler does not update GatewayPayment refundStatus to uppercase 'FAILED' matching classifier check; seedable in database.",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:209"
  },
  {
    caseNumber: 13,
    scenarioId: "CASE_13_STALE_EVENT_AFTER_REFUND",
    category: "INGESTION_TIME",
    decisiveFields: ["LATE_EVENT_DETECTED", "REFUND_TERMINAL_IMMUTABLE"],
    productionWriter: "server/src/services/webhook/webhookService.js:235 & server/src/services/webhook/webhookService.js:994",
    reason: "Terminal state idempotency and stale event rejection are enforced at ingestion time by webhook service.",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:225"
  },
  {
    caseNumber: 14,
    scenarioId: "CASE_14_DUPLICATE_WEBHOOK_DELIVERY",
    category: "INGESTION_TIME",
    decisiveFields: ["deduplicationKey collision"],
    productionWriter: "server/src/services/webhook/webhookService.js:210",
    reason: "Enforced at ingestion time via unique deduplicationKey index; returns HTTP 200 DUPLICATE_ACKNOWLEDGED.",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:241"
  },
  {
    caseNumber: 15,
    scenarioId: "CASE_15_FORGED_WEBHOOK",
    category: "INGESTION_TIME",
    decisiveFields: ["HMAC signature failure"],
    productionWriter: "server/src/services/webhook/webhookService.js:193",
    reason: "Enforced at network boundary; invalid HMAC signature triggers immediate HTTP 401 rejection before DB write.",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:257"
  },
  {
    caseNumber: 16,
    scenarioId: "CASE_16_OUT_OF_ORDER_WEBHOOK",
    category: "INGESTION_TIME",
    decisiveFields: ["REFUND_LOWER_RANK_DROPPED", "REFUND_SAME_RANK_STALE_OR_EQUAL"],
    productionWriter: "server/src/services/webhook/webhookService.js:1022,1047",
    reason: "Monotonic state machine drops out-of-order and lower-rank events at ingestion boundary.",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:273"
  },
  {
    caseNumber: 17,
    scenarioId: "CASE_17_LOST_WEBHOOK",
    category: "PROVEN_END_TO_END",
    decisiveFields: ["gatewayPayment.status === 'CAPTURED'", "zeroWebhooks === true", "pollResult === true"],
    productionWriter: "server/src/services/razorpay/razorpayClient.js:180 (API poll status ingestion)",
    reason: "Background poller queries Razorpay API directly, creating payment record without corresponding webhook event.",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:289"
  },
  {
    caseNumber: 18,
    scenarioId: "CASE_18_CONFLICTING_PROVIDER_MERCHANT_RECORDS",
    category: "RESERVED",
    decisiveFields: ["Direct conflicting ledger states across external systems"],
    productionWriter: "NONE",
    reason: "Requires cross-provider settlement audit interface; reserved in domain matrix.",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:305"
  },
  {
    caseNumber: 19,
    scenarioId: "CASE_19_AMOUNT_OR_CURRENCY_MISMATCH",
    category: "PROVEN_END_TO_END",
    decisiveFields: ["gatewayPayment.currency !== merchantOrder.currency || gatewayPayment.amountPaise !== merchantOrder.amountPaise"],
    productionWriter: "server/src/services/webhook/webhookService.js:1165 (Payment) & server/src/services/reconciliation/normalizationService.js:70 (Order)",
    reason: "Webhook records actual payment currency/amount; order normalization records merchant requested currency/amount.",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:321"
  },
  {
    caseNumber: 20,
    scenarioId: "CASE_20_DUPLICATE_SETTLEMENT_RECORD",
    category: "PROVEN_END_TO_END",
    decisiveFields: ["Duplicate settlement UTR / batch rows in settlementRecords"],
    productionWriter: "server/src/services/reconciliation/normalizationService.js:125",
    reason: "Settlement file importer ingests bank settlement batches containing duplicate UTR reference numbers.",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:337"
  },
  {
    caseNumber: 21,
    scenarioId: "CASE_21_MISSING_SETTLEMENT_RECORD",
    category: "PROVEN_END_TO_END",
    decisiveFields: ["gatewayPayment.status === 'CAPTURED'", "settlementRecords.length === 0", "elapsedHours > 120"],
    productionWriter: "server/src/services/webhook/webhookService.js:1165",
    reason: "Webhook writes CAPTURED; absence of settlement beyond 120 hours (T+5 days) is derived from payment timestamp drift.",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:353"
  },
  {
    caseNumber: 22,
    scenarioId: "CASE_22_PAYMENT_CAPTURED_ORDER_CANCELLED",
    category: "PROVEN_END_TO_END",
    decisiveFields: ["gatewayPayment.status === 'CAPTURED'", "merchantOrder.status === 'CANCELLED'"],
    productionWriter: "server/src/services/webhook/webhookService.js:1165 (Payment) & server/src/services/reconciliation/normalizationService.js:70 (Order)",
    reason: "Webhook captures payment after order is cancelled in merchant system; triggers Safeguard 6 safe-hold.",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:369"
  },
  {
    caseNumber: 23,
    scenarioId: "CASE_23_AMBIGUOUS_PAYMENT_CANDIDATES",
    category: "RESERVED",
    decisiveFields: ["Multiple candidate orders with identical amount and matching time window"],
    productionWriter: "NONE",
    reason: "Multi-candidate ambiguity resolver reserved for AI investigator phase.",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:385"
  },
  {
    caseNumber: 24,
    scenarioId: "CASE_24_PROVIDER_UNAVAILABLE_RATE_LIMITED",
    category: "NO_SOURCE",
    decisiveFields: ["Transient HTTP 429/503 from provider network"],
    productionWriter: "NONE",
    reason: "Runtime transient network fault; not persisted in database collections.",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:401"
  },
  {
    caseNumber: 25,
    scenarioId: "CASE_25_DATABASE_OUTAGE_DURING_ACTION",
    category: "NO_SOURCE",
    decisiveFields: ["MongoDB disconnection / replica set failover during action execution"],
    productionWriter: "NONE",
    reason: "Infrastructure connectivity fault; not stored as a domain database record.",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:417"
  },
  {
    caseNumber: 26,
    scenarioId: "CASE_26_WORKER_CRASH_ACTION_PENDING",
    category: "SEEDABLE_ONLY",
    decisiveFields: ["paymentCase.actionLeaseExpiresAt < Date.now()"],
    productionWriter: "NONE (Defined in schema server/src/models/PaymentCase.js:105; zero background worker lease writers in server/src)",
    reason: "Schema supports lease expiration, but no background worker actively claims/renews action leases in server/src.",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:433"
  },
  {
    caseNumber: 27,
    scenarioId: "CASE_27_CONCURRENT_RESOLUTION_ATTEMPTS",
    category: "RESERVED",
    decisiveFields: ["Optimistic concurrency lock collision on resolution case"],
    productionWriter: "NONE",
    reason: "Concurrent case locking protocol reserved for Stage 6 multi-operator workspace.",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:449"
  },
  {
    caseNumber: 28,
    scenarioId: "CASE_28_CROSS_TENANT_ACCESS_ATTEMPT",
    category: "INGESTION_TIME",
    decisiveFields: ["req.user.tenantId !== targetTenantId"],
    productionWriter: "server/src/middleware/authMiddleware.js:230",
    reason: "Enforced at API gateway boundary by auth middleware; returns HTTP 403 before ledger operations.",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:465"
  },
  {
    caseNumber: 29,
    scenarioId: "CASE_29_FRAUD_ALLEGATION_UNAUTHORIZED_PAYMENT",
    category: "NEEDS_CLAIM_INTAKE",
    decisiveFields: ["customerClaims[].text matching FRAUD_KEYWORDS_REGEX"],
    productionWriter: "NONE",
    reason: "Requires customer fraud report submission route (out of scope for Stage 5).",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:481"
  },
  {
    caseNumber: 30,
    scenarioId: "CASE_30_CHARGEBACK_OR_FORMAL_DISPUTE",
    category: "SEEDABLE_ONLY",
    decisiveFields: ["gatewayPayment.dispute object with status open/under_review"],
    productionWriter: "NONE",
    reason: "Razorpay dispute webhook ingestion pipeline not yet implemented; representable only via seed.",
    docLine: "EDGE_CASE_POLICY_MATRIX.md:497"
  }
];

export function computeReachabilityStats() {
  const counts = {
    PROVEN_END_TO_END: 0,
    SEEDABLE_ONLY: 0,
    INGESTION_TIME: 0,
    NEEDS_CLAIM_INTAKE: 0,
    RESERVED: 0,
    NO_SOURCE: 0
  };

  const grouped = {};
  for (const k of Object.keys(counts)) {
    grouped[k] = [];
  }

  SCENARIOS.forEach(s => {
    counts[s.category] = (counts[s.category] || 0) + 1;
    grouped[s.category].push(s);
  });

  return { total: SCENARIOS.length, counts, grouped };
}

// Generate files if executed directly
const stats = computeReachabilityStats();
const repoRoot = path.resolve(process.cwd());

const jsonOutput = {
  total: stats.total,
  counts: stats.counts,
  scenarios: SCENARIOS
};

fs.writeFileSync(path.join(repoRoot, "evidence/stage5_6/05-strict-reachability.json"), JSON.stringify(jsonOutput, null, 2), "utf8");

const textLines = [
  "=== RECONAI 2.0: STRICT PRODUCTION REACHABILITY AUDIT ===",
  `Total Edge Cases: ${stats.total}`,
  `Category Breakdown:`,
  `  - PROVEN_END_TO_END: ${stats.counts.PROVEN_END_TO_END}`,
  `  - SEEDABLE_ONLY: ${stats.counts.SEEDABLE_ONLY}`,
  `  - INGESTION_TIME: ${stats.counts.INGESTION_TIME}`,
  `  - NEEDS_CLAIM_INTAKE: ${stats.counts.NEEDS_CLAIM_INTAKE}`,
  `  - RESERVED: ${stats.counts.RESERVED}`,
  `  - NO_SOURCE: ${stats.counts.NO_SOURCE}`,
  "",
  "DETAILED PER-CASE AUDIT (30 CASES):",
  ...SCENARIOS.map(s => {
    return [
      `Case ${s.caseNumber}: ${s.scenarioId}`,
      `  Category: ${s.category}`,
      `  Reason: ${s.reason}`,
      `  Doc Line: ${s.docLine}`,
      `  Decisive Fields: ${s.decisiveFields.join(", ")}`,
      `  Production Writer: ${s.productionWriter}`
    ].join("\n");
  })
];

fs.writeFileSync(path.join(repoRoot, "evidence/stage5_6/05-strict-reachability.txt"), textLines.join("\n"), "utf8");
console.log(textLines.slice(0, 15).join("\n"));
console.log(`\nGenerated 05-strict-reachability.json and .txt successfully.`);
