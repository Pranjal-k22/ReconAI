# ReconAI 2.0 — Phase 6: Edge-Case Classification & Evidence Engine Specification

> **DOCUMENT STATUS: ACCEPTED & IMPLEMENTED**  
> **Phase:** Phase 6 — Deterministic Edge-Case Classification and Evidence Collection  
> **Engine Service:** `server/src/services/classification/evidenceClassifier.js`  
> **Model:** `server/src/models/EvidenceRecord.js`  
> **Test Suites:** `server/tests/classification/evidenceClassifier.test.js` & `server/tests/integration/evidencePersistence.integration.test.js`

---

## 1. Overview & Governance Principles

Phase 6 implements a deterministic, explainable classification and evidence-collection engine covering all 30 payment lifecycle edge cases specified in `EDGE_CASE_POLICY_MATRIX.md`. Note on production reachability: 30 deterministic rules are implemented in the engine. Reachability is evaluated via runtime proxy tracing and DB-driven classification (Stage 5 Part B). There is no claim that 30 scenarios are supported end to end from live production feeds without intake routes.

### Core Safety Safeguards Enforced:
1. **Rule of Positive Evidence**: Only cryptographically verified provider events establish gateway authorization, capture, failure, or refund facts.
2. **Customer Claims vs. Provider Facts**: Statements from customers alleging bank account debits are classified strictly as unverified claims (`CUSTOMER_CLAIM`), never as bank or NPCI debit facts.
3. **Timeouts Are Unknown Outcomes**: A timeout indicates that final state is unobserved; it is never assumed to be a confirmed failure or an automatic justification for refund.
4. **Late Capture on Cancelled Orders**: If gateway capture arrives after merchant order cancellation, the cancellation status is strictly preserved under safe-hold (`LATE_CAPTURE_CANCELLED_ORDER`). It is never automatically refunded or reopened.
5. **Exact Integer Arithmetic**: All monetary values are evaluated in integer paise with strict ISO currency validation (INR). Floating-point comparisons are prohibited.
6. **Cross-Tenant Boundary Integrity**: Data with mismatched tenant, customer, or account ownership is quarantined and rejected (`POLICY_REJECTED`).
7. **Hostile Text Neutralization**: Customer and merchant claim text is sanitized and treated as inert string data. Embedded instruction injections (e.g. system override prompts) are neutralized and cannot override provider facts.
8. **Strict Separation of Classification from Execution**: Phase 6 classifies scenarios and issues recommendations (e.g., `UPDATE_MERCHANT_LOCAL_LEDGER`, `WAIT_AND_MONITOR`, `IMMEDIATE_SAFE_HOLD`), but does **NOT** execute refunds, captures, payouts, transfers, ledger writes, or external notifications. Phase 7 (AI Agents) and Phase 8 (Action Execution) remain disabled.

---

## 2. Complete 30-Scenario Traceability Matrix

| # | Scenario ID | Discrepancy Category | Reason Code | Deterministic Rule ID | Authoritative Evidence | Facts vs. Claims Distinction | Safe Hold Code | Recommendation | Test Coverage |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `CASE_1_FRONTEND_TIMEOUT_PAYMENT_SUCCESS` | `FRONTEND_DROPPED_AFTER_SUCCESS` | `FRONTEND_DROPPED_AFTER_SUCCESS` | `RULE_CASE_1_FRONTEND_TIMEOUT` | Provider `CAPTURED` event; Authenticated client checkout timeout/drop event; Order `PENDING` | Provider capture and authenticated client timeout are confirmed facts; causation requires positive authenticated telemetry | `NONE` | `UPDATE_MERCHANT_LOCAL_LEDGER` | `evidenceClassifier.test.js` (Case 1 Positive & Regression) |
| 2 | `CASE_2_CUSTOMER_DEBIT_CLAIM_GATEWAY_PENDING` | `CUSTOMER_DEBIT_ON_GATEWAY_PENDING` | `CUSTOMER_DEBIT_ON_GATEWAY_PENDING` | `RULE_CASE_2_CUSTOMER_DEBIT_PENDING` | Provider `PENDING`; Customer debit statement | Customer debit is unverified claim; Gateway pending is confirmed fact | `NONE` / `CUSTOMER_DEBIT_ON_GATEWAY_PENDING` (if >= 60m) | `WAIT_AND_MONITOR` | `evidenceClassifier.test.js` (Case 2) |
| 3 | `CASE_3_CUSTOMER_DEBIT_CLAIM_PAYMENT_FAILED` | `CUSTOMER_DEBIT_ON_GATEWAY_FAILURE` | `CUSTOMER_DEBIT_ON_GATEWAY_FAILURE` | `RULE_CASE_3_CUSTOMER_DEBIT_FAILED` | Provider `FAILED`; Customer debit claim | Gateway failure is verified fact; debit claim tracked per RBI TAT | `NONE` / `CUSTOMER_DEBIT_ON_GATEWAY_FAILURE` (if overdue) | `TRACK_AUTO_REVERSAL` | `evidenceClassifier.test.js` (Case 3) |
| 4 | `CASE_4_LATE_AUTHORIZATION_AFTER_TIMEOUT` | `LATE_AUTHORIZATION` | `LATE_AUTHORIZATION` | `RULE_CASE_4_LATE_AUTHORIZATION` | Provider `AUTHORIZED` event after checkout timeout | Authorization is verified fact; inventory availability is unverified | `NONE` | `CHECK_INVENTORY_THEN_CAPTURE_OR_VOID` | `evidenceClassifier.test.js` (Case 4) |
| 5 | `CASE_5_CAPTURED_PAYMENT_DELAYED_SETTLEMENT` | `DELAYED_SETTLEMENT` | `DELAYED_SETTLEMENT` | `RULE_CASE_5_DELAYED_SETTLEMENT` | Provider `CAPTURED`; settlement pending ($T < 72\text{h}$) | Capture is verified fact; settlement delay is verified pending bank batch | `NONE` | `WAIT_FOR_SETTLEMENT` | `evidenceClassifier.test.js` (Case 5) |
| 6 | `CASE_6_PAID_GATEWAY_UNPAID_ORDER` | `STATUS_MISMATCH` | `STATUS_MISMATCH` | `RULE_CASE_6_STATUS_MISMATCH` | Provider `CAPTURED`; Order `PENDING` | Verified provider payment fact vs unupdated local ledger record | `NONE` | `UPDATE_MERCHANT_LOCAL_LEDGER` | `evidenceClassifier.test.js` (Case 6) |
| 7 | `CASE_7_DUPLICATE_PAYMENT_ATTEMPTS` | `DUPLICATE_PAYMENT` | `DUPLICATE_PAYMENT` | `RULE_CASE_7_DUPLICATE_PAYMENTS` | 2 distinct `CAPTURED` payments for 1 order | Two distinct provider captures verified; 2nd attempt isolated | `NONE` / `DUPLICATE_PAYMENT_AMOUNTS_DIFFER` (if diff amounts) | `REFUND_DUPLICATE_PAYMENT` | `evidenceClassifier.test.js` (Case 7) |
| 8 | `CASE_8_PARTIAL_CAPTURE` | `PARTIAL_CAPTURE` | `PARTIAL_CAPTURE` | `RULE_CASE_8_PARTIAL_CAPTURE` | Provider `amountCaptured < amountAuthorized` | Verified split capture fact; merchant fulfillment terms unknown | `PARTIAL_CAPTURE` | `IMMEDIATE_SAFE_HOLD` | `evidenceClassifier.test.js` (Case 8) |
| 9 | `CASE_9_PARTIAL_PAYMENT` | `PARTIAL_PAYMENT` | `PARTIAL_PAYMENT` | `RULE_CASE_9_PARTIAL_PAYMENT` | Payment `amountPaise < order.amountPaise` | Verified paise deficit; layaway policy unconfirmed | `NONE` / `PARTIAL_PAYMENT` (if expired) | `HOLD_PARTIALLY_PAID` | `evidenceClassifier.test.js` (Case 9) |
| 10 | `CASE_10_PARTIAL_REFUND` | `PARTIAL_REFUND` | `PARTIAL_REFUND` | `RULE_CASE_10_PARTIAL_REFUND` | Provider `amountRefunded < amountCaptured` | Verified provider refund fact; balance tracked in paise | `NONE` / `PARTIAL_REFUND_EXCEEDS_CAPTURED` (if exceeds) | `UPDATE_MERCHANT_LOCAL_LEDGER` | `evidenceClassifier.test.js` (Case 10) |
| 11 | `CASE_11_FULL_REFUND_INITIATED_NOT_COMPLETED` | `REFUND_PENDING_TIMEOUT` | `REFUND_PENDING_TIMEOUT` | `RULE_CASE_11_REFUND_PENDING` | Provider refund record `status === 'pending'` | Verified provider in-flight refund fact; bank clearance unobserved | `NONE` / `REFUND_PENDING_TIMEOUT` (if >7 days) | `MONITOR_REFUND` | `evidenceClassifier.test.js` (Case 11) |
| 12 | `CASE_12_FAILED_REFUND` | `REFUND_FAILED` | `REFUND_FAILED` | `RULE_CASE_12_REFUND_FAILED` | Provider `refund.failed` webhook / error code | Verified provider failure fact; alternative bank account unverified | `REFUND_FAILED` | `IMMEDIATE_SAFE_HOLD` | `evidenceClassifier.test.js` (Case 12) |
| 13 | `CASE_13_STALE_EVENT_AFTER_REFUND` | `STALE_EVENT_DELIVERY` | `STALE_EVENT_DELIVERY` | `RULE_CASE_13_STALE_EVENT` | Case in terminal state; event timestamp older | Terminal state is confirmed fact; incoming event verified stale | `NONE` | `NO_OP_DROP_STALE` | `evidenceClassifier.test.js` (Case 13) |
| 14 | `CASE_14_DUPLICATE_WEBHOOK_DELIVERY` | `DUPLICATE_WEBHOOK` | `DUPLICATE_WEBHOOK` | `RULE_CASE_14_DUPLICATE_WEBHOOK` | Ingested event ID matches existing record | Duplicate event delivery verified by event ledger | `NONE` | `NO_OP_DUPLICATE_ACK` | `evidenceClassifier.test.js` (Case 14) |
| 15 | `CASE_15_FORGED_WEBHOOK` | `FORGED_WEBHOOK` | `FORGED_WEBHOOK` | `RULE_CASE_15_FORGED_WEBHOOK` | HMAC signature mismatch (`timingSafeEqual` false) | Cryptographic signature failure is verified fact; payload untrusted | `POLICY_REJECTED` | `REJECT_FORGED_EVENT` | `evidenceClassifier.test.js` (Case 15) |
| 16 | `CASE_16_OUT_OF_ORDER_WEBHOOK` | `OUT_OF_ORDER_WEBHOOK` | `OUT_OF_ORDER_WEBHOOK` | `RULE_CASE_16_OUT_OF_ORDER_WEBHOOK` | `payment.captured` received while state `CREATED` | Advanced state is verified fact; intermediate auth unobserved | `NONE` | `FORWARD_STATE_JUMP` | `evidenceClassifier.test.js` (Case 16) |
| 17 | `CASE_17_LOST_WEBHOOK` | `LOST_WEBHOOK` | `LOST_WEBHOOK` | `RULE_CASE_17_LOST_WEBHOOK` | Server GET query returns `CAPTURED`; 0 webhooks | Verified API poll fact; provider webhook receipts unobserved | `NONE` | `RECONSTRUCT_FROM_POLL` | `evidenceClassifier.test.js` (Case 17) |
| 18 | `CASE_18_CONFLICTING_PROVIDER_MERCHANT_RECORDS` | `CONFLICTING_PROVIDER_MERCHANT_RECORDS` | `CONFLICTING_PROVIDER_MERCHANT_RECORDS` | `RULE_CASE_18_CONFLICTING_RECORDS` | Provider references Order A; merchant references Order B | Conflicting cross-record identifiers verified | `CONFLICTING_RECORDS` | `IMMEDIATE_SAFE_HOLD` | `evidenceClassifier.test.js` (Case 18) |
| 19 | `CASE_19_AMOUNT_OR_CURRENCY_MISMATCH` | `AMOUNT_CURRENCY_MISMATCH` | `AMOUNT_CURRENCY_MISMATCH` | `RULE_CASE_19_AMOUNT_CURRENCY_MISMATCH` | Integer paise difference $>0$ or currency code mismatch | Discrepancy confirmed in positive integer math | `AMOUNT_CURRENCY_MISMATCH` | `IMMEDIATE_SAFE_HOLD` | `evidenceClassifier.test.js` (Case 19) |
| 20 | `CASE_20_DUPLICATE_SETTLEMENT_RECORD` | `DUPLICATE_SETTLEMENT` | `DUPLICATE_SETTLEMENT_RECORD` | `RULE_CASE_20_DUPLICATE_SETTLEMENT` | 2 settlement rows with identical entityId & settlementId | Duplicate payout rows verified in settlement batch | `NONE` | `MERCHANT_LEDGER_DEDUPLICATION` | `evidenceClassifier.test.js` (Case 20) |
| 21 | `CASE_21_MISSING_SETTLEMENT_RECORD` | `MISSING_SETTLEMENT` | `MISSING_SETTLEMENT_RECORD` | `RULE_CASE_21_MISSING_SETTLEMENT` | Provider captured; zero settlement rows after $T+5\text{ days}$ | Verified capture fact; absence of settlement UTR verified | `MISSING_SETTLEMENT` | `ESCALATE_TO_GATEWAY_SUPPORT` | `evidenceClassifier.test.js` (Case 21) |
| 22 | `CASE_22_PAYMENT_CAPTURED_ORDER_CANCELLED` | `CANCELLED_ORDER_CAPTURED` | `CANCELLED_ORDER_CAPTURED` | `RULE_CASE_22_CANCELLED_ORDER_CAPTURED` | Gateway `CAPTURED`; Merchant order `CANCELLED` | Verified capture fact and verified cancellation fact | `LATE_CAPTURE_CANCELLED_ORDER` | `SAFE_HOLD_PRESERVE_CANCELLATION` | `evidenceClassifier.test.js` (Case 22) |
| 23 | `CASE_23_AMBIGUOUS_PAYMENT_CANDIDATES` | `AMBIGUOUS_CANDIDATE_MATCH` | `AMBIGUOUS_PAYMENTS` | `RULE_CASE_23_AMBIGUOUS_CANDIDATES` | Multiple candidate payments match; confidence $<0.95$ | Multiple unlinked candidates verified; definitive linkage missing | `AMBIGUOUS_PAYMENTS` | `IMMEDIATE_SAFE_HOLD` | `evidenceClassifier.test.js` (Case 23) |
| 24 | `CASE_24_PROVIDER_UNAVAILABLE_RATE_LIMITED` | `PROVIDER_UNAVAILABLE` | `PROVIDER_THROTTLED_OR_UNAVAILABLE` | `RULE_CASE_24_PROVIDER_UNAVAILABLE` | Provider HTTP 429 Too Many Requests or 5xx server error | Provider error verified; payment outcome unobserved/unknown | `NONE` / `PROVIDER_ERROR` (if >5) | `EXPONENTIAL_BACKOFF_RETRY` | `evidenceClassifier.test.js` (Case 24) |
| 25 | `CASE_25_DATABASE_OUTAGE_DURING_ACTION` | `DATABASE_OUTAGE_RECOVERY` | `DATABASE_OUTAGE_RECOVERY` | `RULE_CASE_25_DATABASE_OUTAGE` | Mongo connection timeout exception during active lease | Database outage event verified; in-flight lease holds state | `NONE` / `DATABASE_OUTAGE_RECOVERY` (if unresolvable) | `DATABASE_LEASE_RECOVERY` | `evidenceClassifier.test.js` (Case 25) |
| 26 | `CASE_26_WORKER_CRASH_ACTION_PENDING` | `WORKER_LEASE_EXPIRED` | `EXPIRED_LEASE_RECOVERY` | `RULE_CASE_26_EXPIRED_LEASE` | `actionLeaseExpiresAt < Date.now()` on in-progress case | Expired lease verified; worker completion unobserved | `NONE` / `WORKER_LEASE_EXPIRED` (if >= 3) | `EXPIRED_LEASE_RECLAIM` | `evidenceClassifier.test.js` (Case 26) |
| 27 | `CASE_27_CONCURRENT_RESOLUTION_ATTEMPTS` | `CONCURRENT_ATTEMPT` | `CONCURRENT_MUTATION_RACE` | `RULE_CASE_27_CONCURRENT_MUTATION` | Atomic lock acquisition collision on active worker lease | Race condition collision verified; lock rejected safely | `NONE` | `LOCK_ACQUISITION_REJECT` | `evidenceClassifier.test.js` (Case 27) |
| 28 | `CASE_28_CROSS_TENANT_ACCESS_ATTEMPT` | `CROSS_TENANT_BLOCKED` | `CROSS_TENANT_VIOLATION` | `RULE_CASE_28_CROSS_TENANT_VIOLATION` | Token tenant ID $\neq$ Case tenant ID or cross-tenant records | Cross-tenant boundary mismatch verified | `POLICY_REJECTED` | `REJECT_CROSS_TENANT` | `evidenceClassifier.test.js` (Case 28) |
| 29 | `CASE_29_FRAUD_ALLEGATION_UNAUTHORIZED_PAYMENT` | `FRAUD_CLAIM` | `FRAUD_SUSPICION` | `RULE_CASE_29_FRAUD_SUSPICION` | Cardholder claims unauthorized payment / risk score $>85$ | Cardholder allegation is unverified claim; risk flags verified | `FRAUD_SUSPICION` | `FREEZE_AUTOMATION_SAFE_HOLD` | `evidenceClassifier.test.js` (Case 29) |
| 30 | `CASE_30_CHARGEBACK_OR_FORMAL_DISPUTE` | `FORMAL_DISPUTE` | `FORMAL_DISPUTE` | `RULE_CASE_30_FORMAL_DISPUTE` | Provider `dispute.created` webhook / chargeback notification | Formal dispute opened by provider; merchant defense unobserved | `FORMAL_DISPUTE` | `ROUTE_TO_REPRESENTMENT_SAFE_HOLD` | `evidenceClassifier.test.js` (Case 30) |

---

## 2.1. Stage 5.6 Strict Production Reachability Audit (Code-Computed)

A scenario is classified as `PROVEN_END_TO_END` strictly iff an integration test produces that scenario ID AND every decisive field has a production writer in non-test `server/src` code (excluding legacy CSV import and sandbox-only dispatch writers). If a test produces it from DB seeding but decisive fields lack production writers, it is classified as `SEEDABLE_ONLY`. The definitive breakdown computed by `server/scripts/computeStrictReachability.js` across the 30 edge cases is:

| Category | Count | Scenarios / Production Writers / Justifications |
|:---|:---:|:---|
| **PROVEN_END_TO_END** | 8 | Cases 5, 6, 7, 17, 19, 20, 21, 22. All decisive fields have verified production writers in `server/src`. |
| **SEEDABLE_ONLY** | 6 | Case 8 (`PARTIAL_CAPTURE` — schema fields `amountAuthorizedPaise`/`amountCapturedPaise` have no production ingestion writers), Case 10 (`PARTIAL_REFUND` — no webhook writes partial refund amount), Case 11 (`FULL_REFUND_INITIATED_NOT_COMPLETED` — refund initiation written only via sandbox dispatch `providerDispatchService.js:667`), Case 12 (`FAILED_REFUND` — refund failure written only via sandbox dispatch `providerDispatchService.js:770`), Case 26 (`WORKER_CRASH_ACTION_PENDING` — decisive field `actionLeaseExpiresAt` has no background worker writer), Case 30 (`CHARGEBACK_OR_FORMAL_DISPUTE` — `gatewayPayment.dispute` has no gateway dispute webhook pipeline). |
| **INGESTION_TIME** | 5 | Case 13 (`server/src/services/webhook/webhookService.js:235`), Case 14 (`server/src/services/webhook/webhookService.js:210`), Case 15 (`server/src/services/webhook/webhookService.js:193`), Case 16 (`server/src/services/webhook/webhookService.js:1022`), Case 28 (`server/src/middleware/authMiddleware.js:230`). Enforced at network/webhook/auth boundaries. |
| **NEEDS_CLAIM_INTAKE** | 3 | Case 2, Case 3, Case 29 (require authenticated claim intake endpoints not yet implemented). |
| **RESERVED** | 6 | Case 1, Case 4, Case 9, Case 18, Case 23, Case 27 (reserved in classifier/policy domain models). |
| **NO_SOURCE** | 2 | Case 24, Case 25 (runtime infrastructure faults not stored in persistence records). |
| **Total** | 30 | Strict production reachable count is strictly **8** (`PROVEN_END_TO_END`). |

---

## 3. Persistence Model: `EvidenceRecord`

To store immutable, tenant-scoped classification findings without duplicating large raw payloads or customer PII, the `EvidenceRecord` Mongoose model was created:

- **Schema Fields**:
  - `recordId`: Deterministic unique identifier (`EVID-{timestamp}-{random}`).
  - `tenantId`: Strict multi-tenant isolation key.
  - `scenarioId`: Controlled enum covering all 30 scenario IDs + `UNKNOWN_SCENARIO`.
  - `category`: Matches canonical `DISCREPANCY_CATEGORIES`.
  - `reasonCode`: Controlled reason code.
  - `ruleId`: Deterministic rule identifier.
  - `confidence`: Floating-point scalar ($0.0 \dots 1.0$).
  - `facts`: Structured array of `{ dimension, value, source, authority, verifiedAt, evidenceRef }`.
  - `claims`: Structured array of `{ claimType, claimedValue, source, authority, receivedAt, evidenceRef, verified }`.
  - `contradictions`: Array of explicit conflict strings.
  - `missingEvidence`: Array of explicit unobserved data requirements.
  - `safeHold`: Boolean flag indicating if immediate hold is required.
  - `safeHoldCode`: Controlled enum from `SAFE_HOLD_CODES`.
  - `safeHoldReason`: Bounded explanation string ($\le 256$ chars).
  - `recommendation`: Controlled recommendation string (strictly advisory).
  - `suggestedNextStep`: Non-executable advisory descriptive guidance string (e.g. `ADVISORY_RECONCILE_LOCAL_LEDGER`, `ADVISORY_WAIT_AND_MONITOR`, `ADVISORY_SAFE_HOLD_FOR_HUMAN_REVIEW`). All action authorization fields (`actionEligibility`) are strictly removed.
  - Non-executability contract: Classification findings explicitly emit `isExecutable: false`, `authoritative: false`, `requiresPolicyEngine: true`.
  - `evaluationKey`: Compound evaluation key for durable deduplication.
  - `supportingEvidence`: Array of entity references (`sourceSystem`, `entityType`, `entityId`, `eventId`, `timestamp`).
  - `redactedMetadata`: Sanitized metadata with sensitive tokens stripped via `sanitizeMetadata`.
  - `evaluatedAt`: Timestamp.
- **Indexes**:
  - Compound unique index: `{ tenantId: 1, evaluationKey: 1 }` (with partial filter `{ evaluationKey: { $type: "string" } }`).
  - Compound tenant index: `{ tenantId: 1, recordId: 1 }`.
  - Compound scenario index: `{ tenantId: 1, scenarioId: 1 }`.

---

## 4. Frontend Telemetry Provenance & Trust Boundary Model

A rigorous security analysis of frontend evidence provenance established that:
1. **Absence of Client Ingestion Endpoint**: ReconAI currently hosts no client-side telemetry/beacon ingestion endpoints. `PaymentLifecycleEvent.SOURCE_SYSTEMS` does not include browser or client runtimes.
2. **Caller Forgery Prevention**: Callers cannot supply `{ authenticated: true, sessionId: "...", eventId: "..." }` or any arbitrary boolean flag in `context` to elevate a client claim into a verified provider fact. Any caller-supplied frontend claim in `context` is strictly recorded in `claims` as an unverified customer claim (`authority: "CUSTOMER_CLAIM"`, `verified: false`).
3. **Route & Service Provenance Enforcement**:
   - `POST /api/payment-events` strictly rejects caller-supplied `serverVerifiedTelemetry` (HTTP 400).
   - `POST /api/payment-events` strictly rejects external callers claiming `sourceSystem: "RECONAI_SYSTEM"` (HTTP 400).
   - `appendLifecycleEvent` in `paymentLifecycleEventService.js` strictly rejects caller-supplied `serverVerifiedTelemetry` in payload or provenance (HTTP 400).
   - Unauthorized principals (`CUSTOMER`, `SHOP`, etc.) cannot access `POST /api/payment-events` (HTTP 403).
4. **Server-Verified Provenance Requirement**: Case 1 (`CASE_1_FRONTEND_TIMEOUT_PAYMENT_SUCCESS`) is classified only when evidence originates from authoritative server-side ledger events (`RECONAI_SYSTEM` or `MERCHANT_ORDER`) carrying explicit cryptographic/server verification (`serverVerifiedTelemetry: true`) bound strictly to the matching tenant, merchant order, and gateway payment ID.
5. **Safe Status Mismatch Fallback**: In the absence of server-verified telemetry (the default in the current architecture), `CAPTURED` gateway payment plus `PENDING` merchant order safely classifies as `CASE_6_PAID_GATEWAY_UNPAID_ORDER` (`STATUS_MISMATCH`) with explicit missing-evidence indicators explaining that trusted frontend checkout telemetry is unobserved. Case 1 remains unconfirmed in ordinary production flows.
6. **Partial Capture Reservation**: The documented Razorpay Payment entity exposes only `amount` and boolean `captured`. Without an `amount_authorized` field in standard production payloads, Case 8 (`CASE_8_PARTIAL_CAPTURE`) cannot be detected from production data and is marked `[RESERVED: not detectable from documented fields]` alongside Case 1.

---

## 5. Verification Gates and Results

| Gate | Description | Observed Result | Status |
|---|---|---|---|
| 1 | Focused classification/evidence unit tests | 41 passed in `evidenceClassifier.test.js` (including 7 comprehensive security provenance tests) | **PASS** |
| 2 | Complete 30-scenario coverage suite | All 30 scenarios asserted with exact IDs, codes, facts, claims, safe-holds | **PASS** |
| 3 | Real-MongoDB evidence persistence and isolation tests | 4 passed in `evidencePersistence.integration.test.js` | **PASS** |
| 4 | Monitoring state-machine, scheduler, runtime-wiring tests | 34 passed in `tests/monitoring` | **PASS** |
| 5 | Full webhook signature and ingestion suite | 25 passed in `tests/webhook` | **PASS** |
| 6 | Endpoint & service provenance security tests | 8 passed in `tests/routes/paymentEventRoutes.test.js` | **PASS** |
| 7 | Full real-MongoDB integration suite | 37 passed across 5 test suites | **PASS** |
| 8 | Full backend unit suite (`npm test`) | 413 passed across 58 test files | **PASS** |
| 9 | Frontend production build (`npm run build`) | Built in 7.68s with zero errors | **PASS** |
| 10 | `git diff --check` | Clean diff, zero trailing whitespace/conflict markers | **PASS** |
| 11 | 120-scenario reconciliation benchmark | 120/120 classifications match (100.00% match rate) | **PASS** |

---

## 6. Strict Production Reachability Audit (Per-Case Table)

Below is the per-case reachability analysis generated directly from `evidence/stage5_6/05-strict-reachability.json`.

| Case | Scenario ID | Category | Decisive Doc Line | Production Writer (file:line) | One-Line Reachability Reason |
|---|---|---|---|---|---|
| 1 | `CASE_1_FRONTEND_TIMEOUT_PAYMENT_SUCCESS` | **RESERVED** | `EDGE_CASE_POLICY_MATRIX.md:16` | `NONE` | Requires authenticated client telemetry beacon endpoint with server-verified signature (not yet implemented). |
| 2 | `CASE_2_CUSTOMER_DEBIT_CLAIM_GATEWAY_PENDING` | **NEEDS_CLAIM_INTAKE** | `EDGE_CASE_POLICY_MATRIX.md:32` | `NONE` | Requires customer portal claim intake route (out of scope for Stage 5). |
| 3 | `CASE_3_CUSTOMER_DEBIT_CLAIM_PAYMENT_FAILED` | **NEEDS_CLAIM_INTAKE** | `EDGE_CASE_POLICY_MATRIX.md:48` | `NONE` | Requires customer portal claim intake route for debit claims on failed payments. |
| 4 | `CASE_4_LATE_AUTHORIZATION_AFTER_TIMEOUT` | **RESERVED** | `EDGE_CASE_POLICY_MATRIX.md:64` | `NONE` | Requires late-auth timeout correlation worker; reserved in classifier and policy domain models. |
| 5 | `CASE_5_CAPTURED_PAYMENT_DELAYED_SETTLEMENT` | **PROVEN_END_TO_END** | `EDGE_CASE_POLICY_MATRIX.md:80` | `server/src/services/webhook/webhookService.js:1165 (status: CAPTURED)` | Standard webhook ingestion writes CAPTURED; absence of settlements is initial ingestion state within 72h window. |
| 6 | `CASE_6_PAID_GATEWAY_UNPAID_ORDER` | **PROVEN_END_TO_END** | `EDGE_CASE_POLICY_MATRIX.md:96` | `server/src/services/webhook/webhookService.js:1165 (Payment) & server/src/services/reconciliation/normalizationService.js:70 (Order)` | Webhook writes payment capture while order remains in created/pending state in merchant ledger. |
| 7 | `CASE_7_DUPLICATE_PAYMENT_ATTEMPTS` | **PROVEN_END_TO_END** | `EDGE_CASE_POLICY_MATRIX.md:112` | `server/src/services/webhook/webhookService.js:1145` | Webhook service ingests distinct payment attempts for the same merchant order ID. |
| 8 | `CASE_8_PARTIAL_CAPTURE` | **SEEDABLE_ONLY** | `EDGE_CASE_POLICY_MATRIX.md:145` | `NONE (Defined in schema server/src/models/GatewayPayment.js:107,118; zero production writers in server/src)` | Schema fields added in Part B enable test seeding, but standard Razorpay webhook ingestion has zero production writers for split capture. |
| 9 | `CASE_9_PARTIAL_PAYMENT` | **RESERVED** | `EDGE_CASE_POLICY_MATRIX.md:161` | `NONE` | Installment agreement tracking model reserved for future stage. |
| 10 | `CASE_10_PARTIAL_REFUND` | **SEEDABLE_ONLY** | `EDGE_CASE_POLICY_MATRIX.md:177` | `NONE in webhook ingestion (legacy CSV import server/src/services/reconciliation/normalizationService.js:94; sandbox dispatch server/src/services/policy/providerDispatchService.js:667)` | No production webhook populates partial refund amount on GatewayPayment; seedable in database. |
| 11 | `CASE_11_FULL_REFUND_INITIATED_NOT_COMPLETED` | **SEEDABLE_ONLY** | `EDGE_CASE_POLICY_MATRIX.md:193` | `NONE in webhook ingestion (sandbox dispatch server/src/services/policy/providerDispatchService.js:667)` | Refund initiation performed only through sandbox dispatch; no production webhook sets in-flight pending refund state without manual seed. |
| 12 | `CASE_12_FAILED_REFUND` | **SEEDABLE_ONLY** | `EDGE_CASE_POLICY_MATRIX.md:209` | `NONE in webhook ingestion (sandbox dispatch error handler server/src/services/policy/providerDispatchService.js:770)` | Webhook handler does not update GatewayPayment refundStatus to uppercase 'FAILED' matching classifier check; seedable in database. |
| 13 | `CASE_13_STALE_EVENT_AFTER_REFUND` | **INGESTION_TIME** | `EDGE_CASE_POLICY_MATRIX.md:225` | `server/src/services/webhook/webhookService.js:235 & server/src/services/webhook/webhookService.js:994` | Terminal state idempotency and stale event rejection are enforced at ingestion time by webhook service. |
| 14 | `CASE_14_DUPLICATE_WEBHOOK_DELIVERY` | **INGESTION_TIME** | `EDGE_CASE_POLICY_MATRIX.md:241` | `server/src/services/webhook/webhookService.js:210` | Enforced at ingestion time via unique deduplicationKey index; returns HTTP 200 DUPLICATE_ACKNOWLEDGED. |
| 15 | `CASE_15_FORGED_WEBHOOK` | **INGESTION_TIME** | `EDGE_CASE_POLICY_MATRIX.md:257` | `server/src/services/webhook/webhookService.js:193` | Enforced at network boundary; invalid HMAC signature triggers immediate HTTP 401 rejection before DB write. |
| 16 | `CASE_16_OUT_OF_ORDER_WEBHOOK` | **INGESTION_TIME** | `EDGE_CASE_POLICY_MATRIX.md:273` | `server/src/services/webhook/webhookService.js:1022,1047` | Monotonic state machine drops out-of-order and lower-rank events at ingestion boundary. |
| 17 | `CASE_17_LOST_WEBHOOK` | **PROVEN_END_TO_END** | `EDGE_CASE_POLICY_MATRIX.md:289` | `server/src/services/razorpay/razorpayClient.js:180 (API poll status ingestion)` | Background poller queries Razorpay API directly, creating payment record without corresponding webhook event. |
| 18 | `CASE_18_CONFLICTING_PROVIDER_MERCHANT_RECORDS` | **RESERVED** | `EDGE_CASE_POLICY_MATRIX.md:305` | `NONE` | Requires cross-provider settlement audit interface; reserved in domain matrix. |
| 19 | `CASE_19_AMOUNT_OR_CURRENCY_MISMATCH` | **PROVEN_END_TO_END** | `EDGE_CASE_POLICY_MATRIX.md:321` | `server/src/services/webhook/webhookService.js:1165 (Payment) & server/src/services/reconciliation/normalizationService.js:70 (Order)` | Webhook records actual payment currency/amount; order normalization records merchant requested currency/amount. |
| 20 | `CASE_20_DUPLICATE_SETTLEMENT_RECORD` | **PROVEN_END_TO_END** | `EDGE_CASE_POLICY_MATRIX.md:337` | `server/src/services/reconciliation/normalizationService.js:125` | Settlement file importer ingests bank settlement batches containing duplicate UTR reference numbers. |
| 21 | `CASE_21_MISSING_SETTLEMENT_RECORD` | **PROVEN_END_TO_END** | `EDGE_CASE_POLICY_MATRIX.md:353` | `server/src/services/webhook/webhookService.js:1165` | Webhook writes CAPTURED; absence of settlement beyond 120 hours (T+5 days) is derived from payment timestamp drift. |
| 22 | `CASE_22_PAYMENT_CAPTURED_ORDER_CANCELLED` | **PROVEN_END_TO_END** | `EDGE_CASE_POLICY_MATRIX.md:369` | `server/src/services/webhook/webhookService.js:1165 (Payment) & server/src/services/reconciliation/normalizationService.js:70 (Order)` | Webhook captures payment after order is cancelled in merchant system; triggers Safeguard 6 safe-hold. |
| 23 | `CASE_23_AMBIGUOUS_PAYMENT_CANDIDATES` | **RESERVED** | `EDGE_CASE_POLICY_MATRIX.md:385` | `NONE` | Multi-candidate ambiguity resolver reserved for AI investigator phase. |
| 24 | `CASE_24_PROVIDER_UNAVAILABLE_RATE_LIMITED` | **NO_SOURCE** | `EDGE_CASE_POLICY_MATRIX.md:401` | `NONE` | Runtime transient network fault; not persisted in database collections. |
| 25 | `CASE_25_DATABASE_OUTAGE_DURING_ACTION` | **NO_SOURCE** | `EDGE_CASE_POLICY_MATRIX.md:417` | `NONE` | Infrastructure connectivity fault; not stored as a domain database record. |
| 26 | `CASE_26_WORKER_CRASH_ACTION_PENDING` | **SEEDABLE_ONLY** | `EDGE_CASE_POLICY_MATRIX.md:433` | `NONE (Defined in schema server/src/models/PaymentCase.js:105; zero background worker lease writers in server/src)` | Schema supports lease expiration, but no background worker actively claims/renews action leases in server/src. |
| 27 | `CASE_27_CONCURRENT_RESOLUTION_ATTEMPTS` | **RESERVED** | `EDGE_CASE_POLICY_MATRIX.md:449` | `NONE` | Concurrent case locking protocol reserved for Stage 6 multi-operator workspace. |
| 28 | `CASE_28_CROSS_TENANT_ACCESS_ATTEMPT` | **INGESTION_TIME** | `EDGE_CASE_POLICY_MATRIX.md:465` | `server/src/middleware/authMiddleware.js:230` | Enforced at API gateway boundary by auth middleware; returns HTTP 403 before ledger operations. |
| 29 | `CASE_29_FRAUD_ALLEGATION_UNAUTHORIZED_PAYMENT` | **NEEDS_CLAIM_INTAKE** | `EDGE_CASE_POLICY_MATRIX.md:481` | `NONE` | Requires customer fraud report submission route (out of scope for Stage 5). |
| 30 | `CASE_30_CHARGEBACK_OR_FORMAL_DISPUTE` | **SEEDABLE_ONLY** | `EDGE_CASE_POLICY_MATRIX.md:497` | `NONE` | Razorpay dispute webhook ingestion pipeline not yet implemented; representable only via seed. |

### Production Inactive Cases: Cases 18 & 23

Cases 18 and 23 (conflicting and ambiguous records) have no production source and therefore never fire today:
- **Case 18 (`CASE_18_CONFLICTING_PROVIDER_MERCHANT_RECORDS`):** Represents contradictory status or amount across multiple gateway records for the same transaction. In the current production pipeline, incoming webhook deliveries and polling jobs enforce single-record upsert semantics. No production component writes or persists conflicting duplicate gateway payment documents, so Case 18 never fires in production.
- **Case 23 (`CASE_23_AMBIGUOUS_PAYMENT_CANDIDATES`):** Represents ambiguous partial matching across order references where multiple candidate orders match payment details. In current production normalization, order references are mapped 1-to-1 via strict `merchantOrderId` index lookups without heuristic fuzzy or partial candidate matching. Hence, Case 23 has no production source and never fires today.

### Six Reserved Cases and Reasons

- **Case 1 (`CASE_1_FRONTEND_TIMEOUT_PAYMENT_SUCCESS`):** Requires authenticated client telemetry beacon endpoint with server-verified signature (not yet implemented). (Doc line: `EDGE_CASE_POLICY_MATRIX.md:16`).
- **Case 4 (`CASE_4_LATE_AUTHORIZATION_AFTER_TIMEOUT`):** Requires late-auth timeout correlation worker; reserved in classifier and policy domain models. (Doc line: `EDGE_CASE_POLICY_MATRIX.md:64`).
- **Case 9 (`CASE_9_PARTIAL_PAYMENT`):** Installment agreement tracking model reserved for future stage. (Doc line: `EDGE_CASE_POLICY_MATRIX.md:161`).
- **Case 18 (`CASE_18_CONFLICTING_PROVIDER_MERCHANT_RECORDS`):** Requires cross-provider settlement audit interface; reserved in domain matrix. (Doc line: `EDGE_CASE_POLICY_MATRIX.md:305`).
- **Case 23 (`CASE_23_AMBIGUOUS_PAYMENT_CANDIDATES`):** Multi-candidate ambiguity resolver reserved for AI investigator phase. (Doc line: `EDGE_CASE_POLICY_MATRIX.md:385`).
- **Case 27 (`CASE_27_CONCURRENT_RESOLUTION_ATTEMPTS`):** Concurrent case locking protocol reserved for Stage 6 multi-operator workspace. (Doc line: `EDGE_CASE_POLICY_MATRIX.md:449`).

### Owner Decision: Precedence Reordering Impact on Merged Inputs

> [!IMPORTANT]
> **OWNER DECISION:** Stage 5B reorder changed 52 outcomes on merged inputs, all from not-held to held; classifications persisted before ac18699 for such inputs may differ. The standalone-fixture evaluation confirms 0 differences across all 30 standalone edge-case scenario fixtures.
