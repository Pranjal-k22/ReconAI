# ReconAI 2.0 — Domain Model & Ledgers Specification

## 1. Scope and Architectural Intent

ReconAI 2.0 establishes an autonomous AI payment monitoring and resolution system on top of the deterministic Track 4 reconciliation engine.

Phase 2 establishes the persistence models and foundational append-only ledger services:
1. **PaymentCase**: The durable aggregate tracking a payment discrepancy across **eight canonical lifecycle dimensions**.
2. **PaymentLifecycleEvent**: The append-only, normalized evidence ledger recording multi-system telemetry with strict **payload minimization allowlisting**.
3. **PaymentAction**: The idempotent ledger recording proposed or simulated resolution decisions with **strict non-executing Phase 2 safety boundaries**.

---

## 2. The Eight Canonical Lifecycle Dimensions

In ReconAI 2.0, payment states cannot be reduced to a single monolithic status string. A payment aggregate independently tracks eight canonical orthogonal dimensions:

| # | Dimension | Field Name | Key States | Architectural Rule |
|---|---|---|---|---|
| 1 | **Order state** | `orderStatus` (alias: `orderState`) | `ORDER_CREATED`, `ORDER_PENDING`, `ORDER_PAID`, `ORDER_PARTIALLY_PAID`, `ORDER_CANCELLED`, `ORDER_FULFILLED`, `UNKNOWN` | Merchant cart/order progress. |
| 2 | **Customer debit state** | `customerDebitStatus` (alias: `customerDebitState`) | `DEBIT_NONE`, `DEBIT_REPORTED`, `DEBIT_VERIFIED`, `DEBIT_REVERSED`, `UNKNOWN` | Whether money left the customer account. Gateway failure != absence of debit. |
| 3 | **Authorization state** | `authorizationStatus` (alias: `authorizationState`) | `AUTH_NONE`, `AUTH_PENDING`, `AUTH_AUTHORIZED`, `AUTH_EXPIRED`, `AUTH_VOIDED`, `UNKNOWN` | Gateway bank hold. Auth != capture. |
| 4 | **Capture state** | `captureStatus` (alias: `captureState`) | `CAPTURE_NONE`, `CAPTURE_CAPTURED`, `CAPTURE_PARTIALLY_CAPTURED`, `CAPTURE_FAILED`, `UNKNOWN` | Claimed funds by gateway. Capture != settlement. |
| 5 | **Settlement state** | `settlementStatus` (alias: `settlementState`) | `SETTLEMENT_NONE`, `SETTLEMENT_PENDING`, `SETTLEMENT_SETTLED`, `SETTLEMENT_ADJUSTED`, `UNKNOWN` | Funds received in merchant nodal account. |
| 6 | **Refund state** | `refundStatus` (alias: `refundState`) | `REFUND_NONE`, `REFUND_ELIGIBLE`, `REFUND_INITIATED`, `REFUND_PENDING`, `REFUND_CONFIRMED`, `REFUND_FAILED`, `UNKNOWN` | Reversal progress. Refund request != confirmed refund. |
| 7 | **Dispute state** | `disputeStatus` (alias: `disputeState`) | `DISPUTE_NONE`, `DISPUTE_INQUIRY`, `DISPUTE_FORMAL_CHARGEBACK`, `DISPUTE_UNDER_REVIEW`, `DISPUTE_WON`, `DISPUTE_LOST`, `UNKNOWN` | Customer or issuing-bank contestation. |
| 8 | **Resolution-case state** | `resolutionCaseStatus` (alias: `resolutionCaseState`) | `CASE_DETECTED`, `CASE_INVESTIGATING`, `CASE_PENDING_POLICY`, `CASE_ACTION_IN_PROGRESS`, `CASE_VERIFYING_OUTCOME`, `CASE_RESOLVED`, `CASE_SAFE_HOLD`, `CASE_EXTERNAL_ESCALATION` | AI resolution workflow status. Closed case != proof of provider outcome. |

### Auxiliary Fields
- `reversalStatus`: Optional supplementary tracking for automated nodal reversals.
- `reconStatus`: Optional link to the Track 4 reconciliation engine.
- `investigationStatus`: Optional tracking for autonomous agent sub-investigations.

---

## 3. Action Ledger Safety Boundaries (Phase 2 Non-Executing State)

Phase 2 is strictly a storage and intent-recording phase; it does **not** authorize or execute financial operations.

Accepted Phase 2 Action Statuses:
- `PROPOSED`: Intent registered by AI Planner or monitor.
- `SIMULATED`: Dry-run outcome simulated against financial ledger rules.
- `REJECTED_BY_POLICY`: Policy gate denied proposed action.
- `HELD_IN_SAFE_HOLD`: Action quarantined under safe-hold criteria.

**Strictly Prohibited in Phase 2:**
Statuses representing execution authorization or financial outcomes (`READY_FOR_EXECUTION`, `EXECUTION_PENDING`, `EXECUTED_UNCONFIRMED`, `EXECUTED`, `VERIFIED_SUCCESS`, `POLICY_AUTHORIZED`) are rejected at both schema and service layers.

---

## 4. Evidence Payload Minimization (Strict Allowlist)

A denylist of known field names is insufficient to guarantee PII protection against unfamiliar aliases. ReconAI 2.0 enforces a **strict allowlist** (`ALLOWED_EVIDENCE_FIELDS`).

Only approved normalized attributes are persisted:
- Identifier references: `merchantOrderId`, `gatewayPaymentId`, `sourceEventId`, `settlementId`, `refundId`, `arn`, `rrn`, `upiTxnId`.
- Financial metrics: `amountPaise`, `currency`, `status`, `method`, `bank`, `errorCode`, `errorDescription`.
- Timestamps: `occurredAt`, `capturedAt`, `settledAt`.

All arbitrary customer PII (including names, addresses, contacts, emails, VPAs, credentials, unvetted metadata) is strictly stripped.

---

## 5. Test Suite Structure

Tests are organized under `server/tests/ledger/`:
- `paymentCase.test.js`: 8-dimensional independence, state boundaries, safe-hold, integer paise.
- `paymentAction.test.js`: Phase 2 status restriction, idempotency duplicate handling, static write-isolation guard.
- `paymentLifecycleEvent.test.js`: Strict allowlist payload minimization, deterministic fingerprinting, append-only invariant.
