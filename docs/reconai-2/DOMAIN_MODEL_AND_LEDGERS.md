# ReconAI 2.0 — Phase 2 Domain Model, Event Ledger & Action Ledger Specification

> **DOCUMENT STATUS: PHASE 2 IMPLEMENTED — AWAITING CHATGPT & OWNER REVIEW**
> *This document details the persistent domain models, event evidence ledger, and action ledger implemented in Phase 2. It records the owner-approved provisional guardrails and operational foundations.*

---

## 1. Owner-Approved Provisional Safety Guardrails

The project owner approved the following five binding provisional guardrails for Phase 2 and subsequent phases:

1. **Refund Limits**: Fail closed until approved transaction and cumulative-velocity limits are configured. Cases that cannot be proven eligible must require administrative review or enter `SAFE_HOLD`. No unapproved monetary limits are invented.
2. **Failed Payment with Customer Debit Claim**: A customer claim alone is not proof of debit. A gateway failure alone does not authorize a refund. Supporting authoritative evidence is required, or the case remains in `SAFE_HOLD`. Direct bank inquiry access is not assumed.
3. **Deterministic Local Simulation & Dry-Run by Default**: Deterministic local simulation and dry-run behavior are used by default. Razorpay Test Mode may be introduced in a later, explicitly authorized phase; zero external payment-provider calls occur in Phase 2.
4. **Late Capture After Order Cancellation**: Use `SAFE_HOLD` until sufficient evidence supports a decision to fulfill or refund. Never automatically refund or reverse cancellation in Phase 2.
5. **Direct Bank / NPCI Integration Boundary**: Out of scope. Future adapter boundaries are preserved without claiming access to bank or NPCI inquiry systems.

> **Note on Scope**: This limited approval applies specifically to these five provisional safety defaults. All other proposed architecture decisions from Phase 1 remain `PROPOSED — AWAITING OWNER REVIEW`.

---

## 2. Entity Architecture & Relationships

Phase 2 establishes the persistent storage and ledger foundation for ReconAI 2.0 without altering the existing Track 4 deterministic reconciliation models (`MerchantOrder`, `GatewayPayment`, `SettlementRecord`, `ReconciliationRun`, `ReconciliationResult`, `ExceptionCase`, `AuditLog`, `GroundTruth`):

```text
               ┌────────────────────────────────────────┐
               │              PaymentCase               │
               │  (8-Dimensional State Machine Root)    │
               └───────┬────────────────────────┬───────┘
                       │ 1:N                    │ 1:N
                       ▼                        ▼
       ┌────────────────────────┐      ┌────────────────────────┐
       │  PaymentLifecycleEvent │      │     PaymentAction      │
       │ (Append-Only Evidence) │      │(Idempotent Intent/Act) │
       └────────────────────────┘      └────────────────────────┘
```

### Entity Reference Summary
- [`PaymentCase`](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/src/models/PaymentCase.js): The durable investigation and resolution entity tracking the 8-dimensional payment lifecycle.
- [`PaymentLifecycleEvent`](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/src/models/PaymentLifecycleEvent.js): The append-only ledger for normalized lifecycle evidence with payload fingerprinting and deduplication.
- [`PaymentAction`](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/src/models/PaymentAction.js): The persistent action ledger recording proposed, simulated, and policy-checked resolution actions with tenant-scoped idempotency keys.

---

## 3. PaymentCase Domain Model

- **File**: [`server/src/models/PaymentCase.js`](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/src/models/PaymentCase.js)
- **Service**: [`server/src/services/ledger/paymentCaseService.js`](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/src/services/ledger/paymentCaseService.js)

### Key Fields & Schema Design
- `caseId`: Unique string identifier (`CASE-{YYYYMMDD}-{RANDOM}`).
- `tenantId`: Mandatory merchant store identifier enforcing tenant isolation.
- `customerId`, `merchantOrderId`, `gatewayPaymentId`: Optional indexed cross-correlation identifiers.
- `discrepancyCategory`: Validated enum covering 27 payment discrepancy categories (e.g., `FRONTEND_DROPPED_AFTER_SUCCESS`, `CUSTOMER_DEBIT_ON_GATEWAY_FAILURE`, `LATE_AUTHORIZATION`, etc.).
- **8 Orthogonal Lifecycle Dimensions**:
  1. `orderState`: `ORDER_CREATED`, `ORDER_PENDING`, `ORDER_PAID`, `ORDER_PARTIALLY_PAID`, `ORDER_CANCELLED`, `ORDER_FULFILLED`, `UNKNOWN`.
  2. `customerDebitState`: `DEBIT_NONE`, `DEBIT_REPORTED`, `DEBIT_VERIFIED`, `DEBIT_REVERSED`, `UNKNOWN`.
  3. `authorizationState`: `AUTH_NONE`, `AUTH_PENDING`, `AUTH_AUTHORIZED`, `AUTH_EXPIRED`, `AUTH_VOIDED`, `UNKNOWN`.
  4. `captureState`: `CAPTURE_NONE`, `CAPTURE_CAPTURED`, `CAPTURE_PARTIALLY_CAPTURED`, `CAPTURE_FAILED`, `UNKNOWN`.
  5. `settlementState`: `SETTLEMENT_NONE`, `SETTLEMENT_PENDING`, `SETTLEMENT_SETTLED`, `SETTLEMENT_ADJUSTED`, `UNKNOWN`.
  6. `refundState`: `REFUND_NONE`, `REFUND_ELIGIBLE`, `REFUND_INITIATED`, `REFUND_PENDING`, `REFUND_CONFIRMED`, `REFUND_FAILED`, `UNKNOWN`.
  7. `disputeState`: `DISPUTE_NONE`, `DISPUTE_INQUIRY`, `DISPUTE_FORMAL_CHARGEBACK`, `DISPUTE_UNDER_REVIEW`, `DISPUTE_WON`, `DISPUTE_LOST`, `UNKNOWN`.
  8. `resolutionCaseState`: `CASE_DETECTED`, `CASE_INVESTIGATING`, `CASE_PENDING_POLICY`, `CASE_ACTION_IN_PROGRESS`, `CASE_VERIFYING_OUTCOME`, `CASE_RESOLVED`, `CASE_SAFE_HOLD`, `CASE_EXTERNAL_ESCALATION`.
- `expectedAmountPaise`, `actualAmountPaise`: Integer paise (`>= 0`, integer safe).
- `currency`: Default `"INR"`.
- `isSafeHold`: Explicit boolean flag.
- `safeHoldCode`: Validated enum (`PROVISIONAL_REFUND_LIMIT_REQUIRED`, `UNVERIFIED_DEBIT_CLAIM`, `LATE_CAPTURE_CANCELLED_ORDER`, `FRAUD_SUSPICION`, `FORMAL_DISPUTE`, `AMBIGUOUS_PAYMENTS`, `POLICY_REJECTED`, `ADMIN_HOLD`, `NONE`).
- `correlationKey`: Scoped deduplication key preventing duplicate case creation for the same logical issue.
- `actionLeaseExpiresAt`: Lease timestamp for optimistic concurrency control.

### Indexes
- `{ caseId: 1 }` (unique)
- `{ tenantId: 1, caseId: 1 }`
- `{ tenantId: 1, correlationKey: 1 }` (unique, partial index on string)
- `{ tenantId: 1, resolutionCaseState: 1 }`
- `{ tenantId: 1, isSafeHold: 1 }`

---

## 4. PaymentLifecycleEvent Ledger

- **File**: [`server/src/models/PaymentLifecycleEvent.js`](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/src/models/PaymentLifecycleEvent.js)
- **Service**: [`server/src/services/ledger/paymentLifecycleEventService.js`](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/src/services/ledger/paymentLifecycleEventService.js)

### Append-Only Guarantees & Deduplication
- **Append-Only Invariant**: The application service exposes only `appendLifecycleEvent`, `getEventsByCaseId`, and `getEventsByPaymentId`. Calling `updateLifecycleEvent()` or `deleteLifecycleEvent()` throws `AppError.badRequest("PaymentLifecycleEvent is append-only. Updates/deletions are prohibited by architecture invariant.")`.
- **Deduplication Strategy**:
  - Events with `sourceEventId`: Scoped key `${tenantId}:${sourceSystem}:${sourceEventId}`.
  - Events without `sourceEventId`: Deterministic content fingerprint key `${tenantId}:${sourceSystem}:${normalizedEventType}:${correlationRef}:${fingerprint[:16]}`.
  - Duplicate submissions are recognized deterministically: existing records are returned with `{ isDuplicate: true, event: existing }` without throwing unhandled exceptions or creating duplicate database rows.
- **Privacy & PII Sanitization**:
  - Automatically strips: `card`, `card_number`, `card_id`, `pan`, `cvv`, `expiry_month`, `expiry_year`, `password`, `secret`, `api_key`, `token`, `email`, `contact`, `phone`, `vpa`.
  - Computes a deterministic SHA-256 `payloadFingerprint` over the sanitized payload.
- **Separated Temporal Provenance**:
  - `providerOccurredAt`: Timestamp reported by the provider/bank.
  - `sourceObservedAt`: Timestamp observed by the merchant.
  - `ingestedAt`: Timestamp persisted into ReconAI ledger.

---

## 5. PaymentAction Ledger

- **File**: [`server/src/models/PaymentAction.js`](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/src/models/PaymentAction.js)
- **Service**: [`server/src/services/ledger/paymentActionService.js`](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/src/services/ledger/paymentActionService.js)

### Scoped Idempotency & Safety Boundaries
- **Action Type Allowlist**:
  - `WAIT_AND_MONITOR`
  - `POLL_PROVIDER_STATUS`
  - `UPDATE_MERCHANT_LOCAL_LEDGER`
  - `SIMULATE_REFUND_CUSTOMER`
  - `EXECUTE_PROVIDER_REFUND`
  - `VOID_AUTHORIZATION`
  - `CAPTURE_AUTHORIZED_PAYMENT`
  - `LOCK_SAFE_HOLD`
  - `ESCALATE_EXTERNAL_DISPUTE`
- **Scoped Idempotency Index**: Compound unique index `{ tenantId: 1, idempotencyKey: 1 }`.
  Concurrent attempts to create the same logical action are caught by database uniqueness or pre-write lookup and return the existing action without double-creation.
- **Phase 2 Execution Boundary**:
  - Live execution statuses (`EXECUTION_PENDING`, `EXECUTED_UNCONFIRMED`, `VERIFICATION_PENDING`, `VERIFIED_SUCCESS`) are **blocked** by default in Phase 2.
  - Allowed Phase 2 statuses: `PROPOSED`, `SIMULATED`, `REJECTED_BY_POLICY`, `HELD_IN_SAFE_HOLD`.
  - Zero external payment-provider write network calls (verified by static architecture guard test).

---

## 6. Verification & Test Results

The backend test suite was run with Vitest:

- **Command**: `npm test` inside `server/`
- **Total Test Files**: **47 passed (47 total)** (added 3 new test files)
- **Total Tests**: **218 passed (218 total)** (added 18 new unit tests)
- **Track 4 Benchmark Compatibility**: **120 / 120 Scenarios Correct (100.00% match rate preserved)**
- **Static Write Isolation Guard**: Verified zero payment provider write invocations in `server/src/services/ledger/`.

---

## 7. Known Limitations & Out of Scope for Phase 2

1. **Authentication & RBAC**: Tenant scoping is modeled on schemas, but authentication tokens and RBAC middleware enforcement are scheduled for Phase 3.
2. **Public REST APIs & Webhooks**: No external HTTP endpoints or webhook signature receivers were created in this phase.
3. **Payment State Transition Engine**: Storage models are validated, but automated state-transition reducers and monitoring workers belong to later phases.
4. **Provider Write Integrations**: Zero write calls to Razorpay or partner banks.
