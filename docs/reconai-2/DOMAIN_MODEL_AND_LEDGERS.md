# ReconAI 2.0 — Domain Model & Ledgers Specification

## 1. Scope and Architectural Intent

ReconAI 2.0 establishes an autonomous AI payment monitoring and resolution system on top of the deterministic Track 4 reconciliation engine.

Phase 2 establishes the persistence models and foundational append-only ledger services:
1. **PaymentCase**: The durable aggregate tracking a payment discrepancy across **eight canonical lifecycle dimensions**, strictly handling uncertain financial states.
2. **PaymentLifecycleEvent**: The append-only, normalized evidence ledger recording multi-system telemetry with strict **payload minimization allowlisting** and verified currency validation.
3. **PaymentAction**: The idempotent ledger recording proposed or simulated resolution decisions with **strict non-executing Phase 2 safety boundaries**.

---

## 2. The Eight Canonical Lifecycle Dimensions & Uncertain State Semantics

In ReconAI 2.0, payment states cannot be reduced to a single monolithic status string. A payment aggregate independently tracks eight canonical orthogonal dimensions:

| # | Dimension | Canonical Field | Key Enum States | Uncertain State Semantics |
|---|---|---|---|---|
| 1 | **Order state** | `orderStatus` (alias: `orderState`) | `ORDER_CREATED`, `ORDER_PENDING`, `ORDER_PAID`, `ORDER_PARTIALLY_PAID`, `ORDER_CANCELLED`, `ORDER_FULFILLED`, `UNKNOWN` | Defaults to `UNKNOWN` when cart state unevidenced. |
| 2 | **Customer debit state** | `customerDebitStatus` (alias: `customerDebitState`) | `DEBIT_NONE`, `DEBIT_REPORTED`, `DEBIT_VERIFIED`, `DEBIT_REVERSED`, `UNKNOWN` | **Strictly defaults to `UNKNOWN`**. A case without payment evidence does not imply the customer was not debited. Gateway failure alone does not set customer debit to `DEBIT_NONE`. |
| 3 | **Authorization state** | `authorizationStatus` (alias: `authorizationState`) | `AUTH_NONE`, `AUTH_PENDING`, `AUTH_AUTHORIZED`, `AUTH_EXPIRED`, `AUTH_VOIDED`, `UNKNOWN` | **Defaults to `UNKNOWN`**. Bank pre-authorization does not equate to capture. `AUTH_NONE` used only when affirmatively verified as unattempted. |
| 4 | **Capture state** | `captureStatus` (alias: `captureState`) | `CAPTURE_NONE`, `CAPTURE_CAPTURED`, `CAPTURE_PARTIALLY_CAPTURED`, `CAPTURE_FAILED`, `UNKNOWN` | **Defaults to `UNKNOWN`**. Gateway capture does not equate to settlement. `CAPTURE_NONE` used only when affirmatively verified. |
| 5 | **Settlement state** | `settlementStatus` (alias: `settlementState`) | `SETTLEMENT_NONE`, `SETTLEMENT_PENDING`, `SETTLEMENT_SETTLED`, `SETTLEMENT_ADJUSTED`, `UNKNOWN` | **Defaults to `UNKNOWN`**. Nodal merchant settlement tracking. |
| 6 | **Refund state** | `refundStatus` (alias: `refundState`) | `REFUND_NONE`, `REFUND_ELIGIBLE`, `REFUND_INITIATED`, `REFUND_PENDING`, `REFUND_CONFIRMED`, `REFUND_FAILED`, `UNKNOWN` | **Defaults to `UNKNOWN`**. Refund request does not equate to confirmed refund. |
| 7 | **Dispute state** | `disputeStatus` (alias: `disputeState`) | `DISPUTE_NONE`, `DISPUTE_INQUIRY`, `DISPUTE_FORMAL_CHARGEBACK`, `DISPUTE_UNDER_REVIEW`, `DISPUTE_WON`, `DISPUTE_LOST`, `UNKNOWN` | **Defaults to `UNKNOWN`**. Contestation and chargeback status. |
| 8 | **Resolution-case state** | `resolutionCaseStatus` (alias: `resolutionCaseState`) | `CASE_DETECTED`, `CASE_INVESTIGATING`, `CASE_PENDING_POLICY`, `CASE_ACTION_IN_PROGRESS`, `CASE_VERIFYING_OUTCOME`, `CASE_RESOLVED`, `CASE_SAFE_HOLD`, `CASE_EXTERNAL_ESCALATION` | AI resolution workflow status. Begins at `CASE_DETECTED` while financial dimensions remain unconfirmed. Closed case does not prove verified provider outcome. |

---

## 3. Strict Currency Validation

The ReconAI 2.0 active ledger operates in integer minor units (paise) within the **Indian Rupee (`INR`)** financial domain:
- Supported currency set: `SUPPORTED_CURRENCIES = ["INR"]`.
- All models (`PaymentCase`, `PaymentAction`, `PaymentLifecycleEvent`) and ledger services enforce strict validation against this set.
- Malformed strings (e.g. lowercase `inr`, non-3-letter codes), non-string types, and unsupported foreign currencies (`USD`, `EUR`) are strictly rejected.
- Floating-point amounts are forbidden in financial representations; all monetary metrics are validated integer paise.

---

## 4. Persisted Evidence Minimization & Metadata Sanitization

A denylist of known field names is insufficient to guarantee PII protection against unfamiliar aliases. ReconAI 2.0 enforces:
1. **Strict Evidence Allowlist (`ALLOWED_EVIDENCE_FIELDS`)**: Only approved identifiers, timestamps, and error codes are stored. Generic `amount` is omitted in favor of explicit integer `amountPaise`.
2. **Generic Metadata Sanitization (`sanitizeMetadata`)**: In `PaymentCase.metadata` and `PaymentAction.metadata`, PII keys, arbitrary nested objects, and arrays are stripped. Only primitive attributes (max 10 keys, strings capped at 128 chars) are permitted.
3. **Provenance Minimization**: Raw webhook and provider payloads are never stored; only minimal operational metadata (`ingressChannel`, `sourceIp`, etc.) is kept.
4. **Deterministic Fingerprints**: Computed on the final validated, sanitized evidence payload.

---

## 5. Action Ledger Safety Boundaries (Phase 2 Non-Executing State)

Phase 2 is strictly a storage and intent-recording phase; it does **not** authorize or execute financial operations.

Accepted Phase 2 Action Statuses:
- `PROPOSED`: Intent registered by AI Planner or monitor.
- `SIMULATED`: Dry-run outcome simulated against financial ledger rules.
- `REJECTED_BY_POLICY`: Policy gate denied proposed action.
- `HELD_IN_SAFE_HOLD`: Action quarantined under safe-hold criteria.

**Strictly Prohibited in Phase 2:**
Statuses representing execution authorization or financial outcomes (`READY_FOR_EXECUTION`, `EXECUTION_PENDING`, `EXECUTED_UNCONFIRMED`, `EXECUTED`, `VERIFIED_SUCCESS`, `POLICY_AUTHORIZED`) are rejected at both schema and service layers.
