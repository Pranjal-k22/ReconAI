# ReconAI 2.0 — Measurable Acceptance Criteria & Verification Framework

> **DOCUMENT STATUS: GATE 1 VERIFIED; GATE 3 IMPLEMENTED & VERIFIED WITH MOCKED TRANSPORT (NO REAL RAZORPAY TEST-MODE RUN YET)**
> *Gate 1 (Zero Cross-Tenant Access Leaks) has been implemented, hardened, and verified with automated test suites. Gate 3 (Zero Actions Initiated Directly by LLM Generation via Signed PolicyAuthorizationToken) is implemented; verified with mocked provider transport; no real Razorpay test-mode run yet.*

---

## 1. Quantitative System Acceptance Gates

To certify that ReconAI 2.0 has successfully evolved into an enterprise-grade autonomous payment monitoring and resolution controller, the implementation in future phases must satisfy **Seven Uncompromising Acceptance Gates**:

```text
┌────────────────────────────────────────────────────────────────────────┐
│               RECONAI 2.0 QUANTITATIVE ACCEPTANCE GATES                │
├────────────────────────────────────────┬───────────────────────────────┤
│ Gate 1: Zero Cross-Tenant Access Leaks │ 100% tenant isolation tests   │
│ Gate 2: Zero Duplicate Financial Writes│ 100 concurrent race tests     │
│ Gate 3: Zero Unconstrained LLM Actions │ 0 direct LLM write invocations│
│ Gate 4: Zero Premature Case Closures   │ 100% provider verified before │
│ Gate 5: Zero State Regressions         │ 100% monotonic state ordering │
│ Gate 6: Complete Audit Ledger Coverage │ 100% mutations logged & hashed│
│ Gate 7: Autonomous Crash Recovery      │ 100% expired leases recovered │
└────────────────────────────────────────┴───────────────────────────────┘
```

### Gate 1: Zero Cross-Tenant Access Leaks & Scoped Auditor Enclosure
- **Criterion**: In automated security penetration tests, any user, AI agent, or auditor authenticated with `tenantId: "sh_alpha"` or `customerId: "cust_001"` must receive `HTTP 403 Forbidden` or `HTTP 404 Not Found` when attempting to query or act on any resource owned by `tenantId: "sh_beta"` or `customerId: "cust_002"`. Auditors are strictly scoped to their assigned tenant; cross-tenant auditing requires verified server-side `GLOBAL_AUDIT` claims and logs audit events. Human credentials require salted `scrypt` provenance, machine credentials bind to durable `ServicePrincipal` records, token revocations persist in a TTL database, and live authorization state is verified on every protected request. Re-starting an instance never restores revoked scopes or disabled accounts.
- **Measurement**: 100% pass rate across multi-tenant authorization, auditor isolation, durable machine persistence, and security hardening test suites; 0 data leaks.

### Gate 2: Zero Duplicate Financial Writes Under Concurrency
- **Criterion**: When 100 concurrent threads or distributed worker nodes attempt to resolve the same eligible payment case simultaneously, exactly **one** provider write action is dispatched, and the remaining 99 requests are cleanly rejected by the concurrency lock or idempotency ledger.
- **Measurement**: Zero double refunds or double ledger credits under load testing.

### Gate 3: Zero Actions Initiated Directly by LLM Generation (Hardened in Stage 3)
- **Status**: **IMPLEMENTED; VERIFIED WITH MOCKED PROVIDER TRANSPORT; NO REAL RAZORPAY TEST-MODE RUN YET**.
- **Criterion**: Every executed provider action must possess a cryptographically signed `PolicyAuthorizationToken` emitted by the deterministic Policy Engine. If the policy token is missing, expired, tampered with, bound to a different tenant/case/payment/amount/currency/idempotencyKey, or already consumed, the Provider Action Adapter throws a typed `UnauthorizedActionExecutionError` with 0 network calls and 0 `ProviderOperation` rows.
- **Measurement**: Zero actions executed without passing all deterministic policy invariants, fresh provider preflight GET verification, and single-use token verification. Verified across 100% of adversarial unit and integration tests with mocked provider transport; no real Razorpay test-mode run yet.


### Gate 4: Zero Premature Case Closures
- **Criterion**: No `PaymentCase` may transition to `CASE_RESOLVED` while any sub-state is in `REFUND_INITIATED`, `AUTH_PENDING`, or `SETTLEMENT_PENDING` without receiving an authoritative cryptographic webhook (`refund.processed`, `settlement.processed`) or verified server-side GET confirmation.
- **Measurement**: 100% of resolved cases possess verified provider evidence hashes.

### Gate 5: Zero State Regressions From Out-of-Order Webhooks
- **Criterion**: The state machine must reject any state regression (e.g. attempting to move `CAPTURE_CAPTURED` back to `CAPTURE_NONE` due to a delayed `payment.authorized` webhook).
- **Measurement**: 100% compliance with monotonic state progression rules under simulated out-of-order event delivery.

### Gate 6: Complete Audit Trail Immutability
- **Criterion**: Every agent evidence exchange, diagnostic reasoning output, policy validation, provider API call, and customer notification must append a structured event to `AuditLog`. No `UPDATE` or `DELETE` API endpoints exist.
- **Measurement**: 100% audit trail coverage; zero untracked mutations.

### Gate 7: Autonomous Fault Recovery
- **Criterion**: If a background worker crashes or network fails while a payment action lease is active (`CASE_ACTION_IN_PROGRESS`), the subsequent worker sweep must automatically identify the expired lease, query the provider with the case idempotency key, and complete case resolution without human intervention.
- **Measurement**: 100% of simulated worker crash scenarios recover to `RESOLVED` or `SAFE_HOLD` within 2 worker sweep intervals.

---

## 2. Operational SLAs & Performance Targets

ReconAI 2.0 defines explicit operational metrics for its autonomous payment control center:

| Metric | Target SLA / Threshold | Description |
| :--- | :---: | :--- |
| **Autonomous Resolution Rate** | $\ge \mathbf{80.0\%}$ | Percentage of routine eligible payment exceptions resolved autonomously without human or bank contact. |
| **Average Routine Resolution Time** | $\le \mathbf{60\text{ seconds}}$ | End-to-end time from webhook detection/claim intake to verified provider resolution. |
| **False-Action Rate** | $\mathbf{0.00\%}$ | Erroneous refunds or unauthorized merchant credits executed autonomously. |
| **Safe-Hold Routing Precision** | $\mathbf{100.0\%}$ | Percentage of fraud claims, formal chargebacks, and ambiguous candidate matches correctly routed to `SAFE_HOLD`. |
| **Monitoring Ingestion Lag** | $\le \mathbf{500\text{ ms}}$ | Time from incoming webhook receipt to canonical state normalization and case indexing. |
| **Audit Redaction Efficacy** | $\mathbf{100.0\%}$ | Zero API keys, passwords, or raw cardholder numbers exposed in logs or audit records. |

---

## 3. Evaluation Framework: Separation of Benchmarks

> **CRITICAL ARCHITECTURAL DISTINCTION**:  
> ReconAI maintains **Two Completely Separate Evaluation Frameworks**:

### Framework A: Track 4 Deterministic Financial Reconciliation Benchmark (Preserved)
- **Dataset**: `RECONAI_DEMO_V1` (Seed `RECONAI_DEMO_2026`).
- **Scope**: 120 static batch scenarios across 10 anomaly classes (80 MATCHED, 40 Anomalies).
- **Metric**: Benchmark accuracy against isolated `GroundTruth` (100.00% verified match rate).
- **Purpose**: Fulfills the Track 4 automated finance controller evaluation requirements.

### Framework B: ReconAI 2.0 Autonomous Payment Resolution Test Harness (New)
- **Dataset**: Real-time event simulations covering all 30 payment edge cases.
- **Scope**: Live multi-agent interactions, webhook streams, out-of-order delivery, provider timeouts, and concurrency bursts.
- **Metric**: Autonomous resolution rate, safe-hold accuracy, idempotency verification, and zero false actions.
- **Purpose**: Validates real-world autonomous payment monitoring and resolution capabilities.

---

## 4. Governed Versioned Policy-Limits Configuration (Stage 4 Part B)

> "No monetary limits ship with the repo. Limits exist only as two-person-approved per-tenant records. With none active, refunds fail closed. No UI for configuration yet."

### Gate 8: Two-Person Governance Boundary
- **Criterion**: Monetary refund limits cannot be created, defaulted, or updated unilaterally by a single identity. A proposal submitted by an `ADMIN` can only be activated by a different authenticated `ADMIN` (`approvedBy !== proposedBy`).
- **Measurement**: 100% of self-approval and non-ADMIN approval attempts are rejected with HTTP 403 Forbidden.

### Gate 9: Immutability and Unique Active Configuration
- **Criterion**: Once created, `limits`, `contentHash`, `tenantId`, and `configVersion` are strictly immutable. MongoDB partial unique index on `{ tenantId: 1 }` where `{ status: 'ACTIVE' }` guarantees at most one active configuration exists per tenant. Activation atomically supersedes the current active version.
- **Measurement**: 100% of mutation attempts via PUT, PATCH, or DELETE return HTTP 405 Method Not Allowed; parallel approval races yield exactly one ACTIVE record.

### Gate 10: Fail-Closed Refund Enforcement & Decision Binding
- **Criterion**: When a tenant has no active policy config, or its config is DEACTIVATED, refund policy evaluation unconditionally returns `INSUFFICIENT_EVIDENCE` with zero preflight reads, zero balance reservations, zero tokens issued, and zero provider HTTP requests.
- **Decision Binding**: If active configuration changes between policy decision and provider dispatch, dispatch is refused with HTTP 409 `POLICY_CONFIG_CHANGED`. `PolicyAuthorizationToken` cryptographically binds `policyConfigVersion` and `policyConfigHash`.
- **Measurement**: 100% fail-closed behavior across unconfigured and deactivated tenants; 0 provider calls made without verified two-person-approved active configuration.
### Gate 11: Honest Limit Semantics and Reachability
- **Limit Semantics Plain Meaning**: `maxSingleRefundPaise` caps single refund executions against the transaction's refundable balance. Per-day velocity caps and cumulative-per-payment caps are documented as NOT IMPLEMENTED in production today (`currentCumulativeDailyPaise` is not derived from database history).
- **Two-Person Provisioning**: Activation requires two distinct ADMIN accounts (`approvedBy !== proposedBy`); second ADMIN account is provisioned via `accountService.provisionUserAccount`.
- **Honest Reachability**: 30 deterministic rules are implemented; exactly 8 are reachable from production data (`DB_DERIVABLE`: Cases 5, 6, 10, 11, 12, 18, 19, 22). The remaining 22 require claim intake, ingestion-time interception, reserved status, or synthetic context. No claim that 30 scenarios are supported end to end.
