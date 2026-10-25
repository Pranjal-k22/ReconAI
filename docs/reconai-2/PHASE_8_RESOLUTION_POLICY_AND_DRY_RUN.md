# Phase 8 — Deterministic Resolution Policy Engine and Dry-Run Simulator

## 1. Executive Summary

Phase 8 implements the deterministic resolution policy engine and dry-run simulation layer for ReconAI 2.0.

It evaluates proposed payment resolutions against:
- Verified server-side authoritative evidence (Phase 4 webhooks, Phase 5 monitoring, Phase 6 deterministic classification).
- Explicit eligibility rules and risk controls.
- Mandatory fail-closed refund limits and velocity controls.
- Role-based authorization, tenant isolation, and provider capability constraints.
- Durable idempotency keys and concurrency controls.

**Phase 8 is strictly simulation-only.** Local dry-run simulations produce structured records (`actionStatus: "SIMULATED"`, `executionState: "NON_EXECUTABLE_SIMULATION"`, `isExecutable: false`). No real financial operations, refund dispatches, ledger mutations, or external messages are executed in Phase 8 simulation mode. In Stage 3, a dedicated hardened sandbox write adapter (`razorpaySandboxAdapter.js`) exists for test-mode write operations; it remains disabled by default (`RAZORPAY_SANDBOX_WRITES_ENABLED=false`), strictly requires a cryptographically signed single-use Gate 3 `PolicyAuthorizationToken`, enforces fail-closed policy limits, and permits only `rzp_test_` test keys.

---

## 2. Core Architectural Guarantees

1. **Deterministic Server Policy Supremacy**:
   - AI agent suggestions (from Phase 7 Resolution Planner) are untrusted and advisory. The deterministic engine evaluates all proposals purely against verified evidence and rule IDs. AI suggestions never constitute authorization.
2. **Pure Policy Evaluator Separation**:
   - `evaluateResolutionPolicy` in `resolutionPolicyEvaluator.js` is pure and deterministic: zero database queries, zero network I/O, zero side-effects.
   - Separation of concerns: policy evaluation logic is decoupled from persistence and action ledger recording.
3. **Approved Dry-Run Action Catalogue**:
   - `WAIT_AND_MONITOR`: Simulates scheduling of monitoring sweeps with backoff.
   - `RECHECK_PROVIDER_STATUS`: Simulates read-only GET provider status rechecks.
   - `UPDATE_MERCHANT_LOCAL_LEDGER`: Simulates local ledger reconciliation without mutating canonical records.
   - `REQUEST_REFUND`: Simulates refund proposal calculation without contacting external providers.
   - `SAFE_HOLD`: Applies quarantine and records safe-hold reason codes.
   - `NOTIFY_PARTIES`: Simulates notification intent without dispatching live SMS or emails.
   - `EXTERNAL_ESCALATION_REQUIRED`: Records escalation requirements without external contact.
33: 4. **Mandatory Refund Safety Policy & Configuration Provenance**:
34:    - **Trusted Policy Configuration Provenance**:
35:      - ReconAI 2.0 currently has no persistent, authorized server-side policy configuration model or workflow.
36:      - To prevent caller-supplied caps from inflating limits, ordinary evaluation requests are strictly stripped of `policyConfig` at the route boundary (`effectivePolicyConfig = null`).
37:      - Active policy version is locked server-side to immutable supported versions (`DEFAULT_POLICY_VERSION = "2026-10-12.v1"`, `SUPPORTED_POLICY_VERSIONS = ["2026-10-12.v1"]`). Stale, unsupported, or weaker versions are rejected with HTTP 400 Bad Request.
38:      - When approved limits are unavailable or missing, refund requests fail closed to `INSUFFICIENT_EVIDENCE` (`R_REFUND_LIMITS_MISSING_FAIL_CLOSED`).
39:      - Non-refund dry runs (`UPDATE_MERCHANT_LOCAL_LEDGER`, `WAIT_AND_MONITOR`, `RECHECK_PROVIDER_STATUS`, etc.) evaluate and simulate safely against verified server evidence without requiring refund limits.
40:    - **Fail-Closed Limits**: Refund evaluation requires explicit approved limits (`maxSingleRefundPaise` and `maxCumulativeRefundPaise`). If limits are missing or invalid, evaluation fails closed to `INSUFFICIENT_EVIDENCE`.
41:    - **Customer Claims Are Not Proof**: Unverified customer debit claims without gateway capture cannot authorize refunds (`REJECTED_BY_POLICY`).
42:    - **Gateway Failure Alone Is Insufficient**: Failed gateway payments have zero captured funds; refunds are rejected (`REJECTED_BY_POLICY`).
43:    - **Authoritative Refundable Balance Invariant**:
44:      - Formula: `availableRefundablePaise = authoritativeCapturedPaise - (completedRefundsPaise + pendingRefundsPaise + inFlightCommitmentsPaise)`.
45:      - Authoritative captured amount is established from verified provider capture evidence (`capturedAmountPaise`, `amountCapturedPaise`, `rawData.amount_captured`, or verified `CAPTURED` payment status).
46:      - The requested payment amount, authorized amount, or merchant order amount is **never** substituted for a smaller or unverified captured amount.
47:      - Completed refunds (`completedRefundsPaise`), pending refunds (`pendingRefundsPaise`), and in-flight simulation commitments (`inFlightCommitmentsPaise`) are deducted from the available balance.
48:      - Currency must match explicitly (INR). Mismatches fail closed to `REJECTED_BY_POLICY`.
49:    - **Double-Refund In-Flight Prevention**: Active in-flight refunds (`REFUND_PENDING`) or existing simulated/proposed actions block additional refund proposals.
50:    - **Captured-Amount Evidence Conflict Detection**:
51:      - If candidate captured-amount evidence fields (`capturedAmountPaise`, `amountCapturedPaise`, `rawData.amount_captured`) disagree, the engine fails closed to `SAFE_HOLD` (`R_CAPTURED_AMOUNT_CONFLICT_FAIL_CLOSED`), preventing silent fallback to a more favorable balance.
52:    - **Late Capture on Cancelled Order (Case 22)**:
53:      - Verified capture on a cancelled order deterministically evaluates to `SAFE_HOLD` (`R_LATE_CAPTURE_CANCELLED_ORDER_HOLD`) with action status `HELD_IN_SAFE_HOLD`.
54:      - AI advisory suggestions and caller-supplied approval flags (`approvedCancellationRefund`, `adminApproval`, etc.) cannot bypass safe hold and are rejected as non-authoritative.
55:      - Order cannot be automatically reopened or refunded.
56:      - No trusted server-side approval mechanism exists; therefore Case 22 unconditionally remains on `SAFE_HOLD`.
57:      - Canonical `MerchantOrder` remains `CANCELLED` and canonical financial records are 100% unmutated.
58:    - **Conclusive Duplicate Payment Evidence (Case 7)**:
59:      - Requires at least two distinct payment attempts for the same correlated order.
60:      - Both payments must be independently verified as `CAPTURED` by the provider.
61:      - Both attempts must be bound to the same tenant, with matching currencies and amounts.
62:      - Duplicate candidate score must be >= 0.95. Ambiguous candidates, mismatched orders, cross-tenant attempts, or uncaptured payments fail closed to `SAFE_HOLD` or `INSUFFICIENT_EVIDENCE`.
63:    - **Case 1 Provenance Reconciliation**:
64:      - ReconAI currently has no trusted frontend telemetry verification source.
65:      - Ordinary `CAPTURED` payment with `PENDING` order routes through the evidence-faithful status mismatch ledger repair policy (`R_UNVERIFIED_TIMEOUT_FALLBACK_TO_STATUS_MISMATCH`) without causal inference of frontend timeout.
66:    - **Formal Dispute / Fraud Allegations**: Chargebacks (Case 30) and fraud allegations (Case 29) freeze automated refunds into `SAFE_HOLD`.
5. **Durable Idempotency & Concurrency**:
   - Persisted in MongoDB via `PolicyDecision` model with unique compound index `{ tenantId: 1, idempotencyKey: 1 }`.
   - Identical inputs replay existing decisions without duplicate action creation.
   - Materially different inputs with same key return a controlled HTTP 409 conflict.
   - Concurrent requests are serialized safely through database-level unique constraints.

---

## 3. Policy Outcome Statuses

Every policy evaluation produces one of five controlled statuses:
- **`ELIGIBLE_FOR_SIMULATION`**: Proposal satisfies all evidence, capability, and limit checks; dry-run simulation executed locally.
- **`PROPOSAL_ONLY`**: Proposal is recorded as an intent or advisory suggestion; cannot be simulated or executed.
- **`REJECTED_BY_POLICY`**: Proposal fails deterministic safety checks (e.g. cross-tenant, over limit, invalid state).
- **`SAFE_HOLD`**: Ambiguous, conflicting, fraudulent, disputed evidence, or late capture on cancelled order quarantines the case.
- **`INSUFFICIENT_EVIDENCE`**: Missing authoritative records or unconfigured limits fail closed.

---

## 4. 30-Scenario Policy Matrix Traceability

All 30 scenarios from `EDGE_CASE_POLICY_MATRIX.md` are evaluated deterministically:

| Scenario ID | Primary Detection Condition | Recommended Dry-Run Action | Policy Outcome | Safety Invariant |
| :--- | :--- | :--- | :--- | :--- |
| `CASE_1_FRONTEND_TIMEOUT_PAYMENT_SUCCESS` | Captured payment with pending order (unverified telemetry) | `UPDATE_MERCHANT_LOCAL_LEDGER` | `ELIGIBLE_FOR_SIMULATION` | Status-mismatch fallback without causal inference |
| `CASE_2_CUSTOMER_DEBIT_CLAIM_PAYMENT_PENDING` | Customer debit claim with pending gateway payment | `WAIT_AND_MONITOR` | `ELIGIBLE_FOR_SIMULATION` | Refund blocked while pending |
| `CASE_3_CUSTOMER_DEBIT_CLAIM_PAYMENT_FAILED` | Customer debit claim with failed gateway payment | `WAIT_AND_MONITOR` | `ELIGIBLE_FOR_SIMULATION` | Await bank auto-reversal TAT |
| `CASE_4_LATE_AUTHORIZATION` | Authorized webhook arriving after order timeout | `WAIT_AND_MONITOR` | `ELIGIBLE_FOR_SIMULATION` | Read-only adapter; no write capture |
| `CASE_5_CAPTURED_DELAYED_SETTLEMENT` | Payment captured but settlement missing in batch | `WAIT_AND_MONITOR` | `ELIGIBLE_FOR_SIMULATION` | Refund rejected (legitimate payment) |
| `CASE_6_PAID_GATEWAY_UNPAID_ORDER` | Gateway captured, order unpaid | `UPDATE_MERCHANT_LOCAL_LEDGER` | `ELIGIBLE_FOR_SIMULATION` | Local ledger repair simulated |
| `CASE_7_DUPLICATE_PAYMENT` | Conclusive duplicate captured payments verified | `WAIT_AND_MONITOR` / `REQUEST_REFUND` | `ELIGIBLE_FOR_SIMULATION` | Conclusive dual-capture verification required |
| `CASE_8_PARTIAL_CAPTURE` | Amount captured < amount authorized | `SAFE_HOLD` | `SAFE_HOLD` | Merchant contract review required |
| `CASE_9_PARTIAL_PAYMENT` | Paid amount < order total | `WAIT_AND_MONITOR` | `ELIGIBLE_FOR_SIMULATION` | Partial payment held; refund blocked |
| `CASE_10_PARTIAL_REFUND` | Refund amount < captured amount | `UPDATE_MERCHANT_LOCAL_LEDGER` | `ELIGIBLE_FOR_SIMULATION` | Net integer paise ledger adjustment |
| `CASE_11_REFUND_PENDING_TIMEOUT` | Existing refund in flight past window | `WAIT_AND_MONITOR` | `ELIGIBLE_FOR_SIMULATION` | Duplicate refund blocked |
| `CASE_12_REFUND_FAILED` | Refund failed at acquiring bank | `SAFE_HOLD` | `SAFE_HOLD` | Escalate for alternate bank details |
| `CASE_13_STALE_EVENT_DELIVERY` | Stale event delivered after terminal state | `WAIT_AND_MONITOR` | `ELIGIBLE_FOR_SIMULATION` | Monotonic drop; no regression |
| `CASE_14_DUPLICATE_WEBHOOK` | Duplicate webhook event ID | `WAIT_AND_MONITOR` | `ELIGIBLE_FOR_SIMULATION` | Deduplicated; zero mutation |
| `CASE_15_FORGED_WEBHOOK` | Invalid HMAC signature | `SAFE_HOLD` | `SAFE_HOLD` | Cryptographic signature rejection |
| `CASE_16_OUT_OF_ORDER_WEBHOOK` | Captured before authorized webhook | `RECHECK_PROVIDER_STATUS` | `ELIGIBLE_FOR_SIMULATION` | Forward state synchronization |
| `CASE_17_LOST_WEBHOOK` | Webhook lost; verified via polling sweep | `RECHECK_PROVIDER_STATUS` | `ELIGIBLE_FOR_SIMULATION` | Polling state recovery |
| `CASE_18_CONFLICTING_PROVIDER_MERCHANT_RECORDS` | Cross-order mismatch between provider and order | `SAFE_HOLD` | `SAFE_HOLD` | Operator review required |
| `CASE_19_AMOUNT_CURRENCY_MISMATCH` | Currency or amount differs by > 0 paise | `SAFE_HOLD` | `SAFE_HOLD` | Automated mutation prohibited |
| `CASE_20_DUPLICATE_SETTLEMENT` | Duplicate settlement import rows | `UPDATE_MERCHANT_LOCAL_LEDGER` | `ELIGIBLE_FOR_SIMULATION` | Unique settlement deduplication |
| `CASE_21_MISSING_SETTLEMENT` | Settlement missing past T+5 window | `EXTERNAL_ESCALATION_REQUIRED` | `ELIGIBLE_FOR_SIMULATION` | Gateway support escalation |
| `CASE_22_CANCELLED_ORDER_CAPTURED` | Order cancelled, payment captured | `REQUEST_REFUND` / `SAFE_HOLD` | `SAFE_HOLD` | Safe hold enforced; no auto-refund without approved evidence |
| `CASE_23_AMBIGUOUS_CANDIDATE_MATCH` | Multiple payment candidates match single order | `SAFE_HOLD` | `SAFE_HOLD` | Operator pairing required |
| `CASE_24_PROVIDER_UNAVAILABLE` | Gateway API returns HTTP 429 / 5xx | `WAIT_AND_MONITOR` | `ELIGIBLE_FOR_SIMULATION` | Exponential backoff retry plan |
| `CASE_25_DATABASE_OUTAGE_RECOVERY` | Recovery after database outage | `RECHECK_PROVIDER_STATUS` | `ELIGIBLE_FOR_SIMULATION` | Reconnect recovery sweep |
| `CASE_26_WORKER_LEASE_EXPIRED` | Worker node crashed during processing | `RECHECK_PROVIDER_STATUS` | `ELIGIBLE_FOR_SIMULATION` | Expired action lease reclamation |
| `CASE_27_CONCURRENT_ATTEMPT` | Multiple workers resolve same case | `WAIT_AND_MONITOR` | `ELIGIBLE_FOR_SIMULATION` | Atomic lock serialization |
| `CASE_28_CROSS_TENANT_BLOCKED` | Attempt to evaluate another tenant's payment | `WAIT_AND_MONITOR` / any | `REJECTED_BY_POLICY` | Row-level boundary enforcement |
| `CASE_29_FRAUD_CLAIM` | Customer reports card stolen / fraud claim | `SAFE_HOLD` | `SAFE_HOLD` | All automated actions frozen |
| `CASE_30_FORMAL_DISPUTE` | Chargeback or formal dispute received | `SAFE_HOLD` | `SAFE_HOLD` | Automated refund strictly blocked |

---

## 5. API Endpoints

### 5.1 `POST /api/payment-cases/:caseId/policy/evaluate`
- **Authorized Roles**: `ADMIN`, `PAYMENT_CONTROLLER`, `SHOP`. (AUDITOR is restricted to read-only GET endpoints).
- **Request Body**:
  ```json
  {
    "proposedActionType": "UPDATE_MERCHANT_LOCAL_LEDGER",
    "amountPaise": 150000,
    "currency": "INR",
    "idempotencyKey": "idem-case-001",
    "policyVersion": "2026-10-12.v1"
  }
  ```
- **Response**:
  ```json
  {
    "success": true,
    "data": {
      "isDuplicate": false,
      "decision": {
        "decisionId": "DEC-20261012-A1B2C3D4",
        "tenantId": "tenant_alpha",
        "caseId": "CASE-001",
        "outcomeStatus": "ELIGIBLE_FOR_SIMULATION",
        "appliedRuleIds": ["R_LOCAL_LEDGER_REPAIR_ELIGIBLE"],
        "simulationResult": {
          "simulatedStep": "MERCHANT_ORDER_REPAIR_SIMULATED",
          "simulatedNewOrderStatus": "ORDER_PAID",
          "canonicalMutationsExecuted": 0,
          "dryRun": true
        },
        "isExecutable": false,
        "authoritative": false,
        "executionState": "NON_EXECUTABLE_SIMULATION"
      }
    }
  }
  ```

### 5.2 `GET /api/payment-cases/:caseId/policy/decisions`
- **Authorized Roles**: `ADMIN`, `PAYMENT_CONTROLLER`, `SHOP`, `AUDITOR`.
- Returns historical decisions for the case scoped to tenant.

---

## 6. Verification Gates and Results

| Gate | Scope | Command | Result |
| :--- | :--- | :--- | :--- |
| **1, 2, 3, 4** | Policy Evaluator & Matrix Coverage | `npx vitest run tests/policy/resolutionPolicyEvaluator.test.js` | **PASS** (68/68 tests) |
| **5 & 6** | Real-MongoDB Persistence & Concurrency | `npx vitest run tests/integration/policySimulationPersistence.integration.test.js` | **PASS** (11/11 tests) |
| **7** | Route Endpoints & Access Control | `npx vitest run tests/routes/paymentCasePolicyRoutes.test.js` | **PASS** (15/15 tests) |
| **8** | Monitoring & State Machine | `npx vitest run tests/monitoring` | **PASS** (34/34 tests across 3 files) |
| **9** | Webhook Signatures & Ingestion | `npx vitest run tests/webhook` | **PASS** (25/25 tests across 2 files) |
| **10** | Full Real-MongoDB Integration Suite | `npm run test:integration` | **PASS** (52/52 tests across 7 suites) |
| **11** | Full Backend Unit Test Suite | `npm test` | **PASS** (515/515 tests across 62 files) |
| **12** | Frontend Production Build | `npm run build` (in `client/`) | **PASS** (Built in 8.27s, 0 errors) |
| **13** | Git Diff & Whitespace Hygiene | `git diff --check` | **PASS** (Clean, 0 errors) |
| **14** | 120-Scenario Reconciliation Benchmark | `npx vitest run tests/reconciliation/benchmarkCompatibility.test.js` | **PASS** (120/120 scenarios, 100.00% match) |

---

## 7. Safety Invariants and Approved Roadmap

- **Zero Provider Write APIs**: `razorpayClient.js` contains no mutation endpoints.
- **Zero Financial State Mutations**: `GatewayPayment`, `MerchantOrder`, settlement records, and `PaymentCase` states are 100% unmutated.
- **Simulation Only**: All outputs are non-executable dry-runs (`isExecutable: false`, `executionState: "NON_EXECUTABLE_SIMULATION"`).
- **Approved Downstream Roadmap**:
  - **Phase 9 (Sandbox Provider Adapter and Outcome Verification)**: Restricted to sandbox provider adapter with explicit test-mode safeguards and outcome verification. No autonomous worker execution.
  - **Phase 10 (Autonomous Resolution Worker and Orchestration)**: Autonomous execution, background workers, and orchestration are deferred to Phase 10.
  - **Phase 9 has NOT started.** System stops here for review.
