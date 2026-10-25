# ReconAI 2.0 — Phase 5: Payment Lifecycle Monitoring and Deterministic State Machine

## 1. Executive Summary

Phase 5 introduces a centralized, deterministic state machine and durable payment lifecycle monitoring engine for ReconAI 2.0. The implementation pairs verified provider events with bounded, read-only provider status rechecks via Razorpay GET `/v1/payments/:id`.

Crucially, Phase 5 enforces **strict financial safety and canonical monotonicity**:
- **Monotonic Progression**: Once a payment reaches an authoritative terminal state (`CAPTURED`, `REFUNDED`), delayed, out-of-order, or contradictory provider notifications cannot regress the canonical status back to `FAILED` or `PENDING`.
- **Edge-Case Preservation Under Safe-Hold**:
  - Late captures arriving after a reported failure update `GatewayPayment` to `CAPTURED`, record `isLateCapture: true`, flag `LATE_CAPTURE_AFTER_FAILURE`, and place `PaymentCase` under `CASE_SAFE_HOLD` (`ADMIN_HOLD`).
  - Late captures associated with a cancelled merchant order preserve `MerchantOrder.status = "CANCELLED"`, record `isLateCapture: true`, flag `CANCELLED_ORDER_CAPTURED`, and place `PaymentCase` under `CASE_SAFE_HOLD` (`LATE_CAPTURE_CANCELLED_ORDER`) with zero automatic refund execution or order reopening.
- **Critical Timeout Policy**: A provider status query timeout, network interruption, or retry ceiling exhaustion means the payment outcome is **UNKNOWN**, not that the payment failed. Under no circumstances is a payment marked `FAILED` or refunded automatically due to a monitoring timeout.
- **Durable Concurrency & Crash Recovery**: Scheduled checks are persisted in MongoDB (`PaymentMonitoringTask`), claimed atomically with optimistic lease locks (`findOneAndUpdate`), and automatically reclaimed if a worker node crashes mid-task.

---

## 2. Orthogonal Canonical State Dimensions

ReconAI 2.0 preserves the strict separation of 8 independent payment lifecycle dimensions:

| Dimension | Managed Domain Model | Canonical States / Values | Description |
| :--- | :--- | :--- | :--- |
| **1. Merchant Order Lifecycle** | `MerchantOrder.status` | `CREATED`, `PENDING`, `PAID`, `PARTIALLY_PAID`, `CANCELLED`, `REFUNDED`, `FULFILLED` | Business commerce state; cancelled orders are immutable and cannot be reopened by payment events. |
| **2. Customer Debit Evidence** | `PaymentCase.customerDebitStatus` | `DEBIT_NONE`, `DEBIT_REPORTED`, `DEBIT_VERIFIED`, `DEBIT_REVERSED`, `UNKNOWN` | Customer account debit claim; defaults to `UNKNOWN` unless backed by authoritative evidence. |
| **3. Payment Authorization** | `PaymentCase.authorizationStatus` | `AUTH_NONE`, `AUTH_PENDING`, `AUTH_AUTHORIZED`, `AUTH_EXPIRED`, `AUTH_VOIDED`, `UNKNOWN` | Gateway pre-authorization hold state. |
| **4. Payment Capture** | `GatewayPayment.status` / `PaymentCase.captureStatus` | `CREATED`, `AUTHORIZED`, `CAPTURED`, `FAILED`, `REFUNDED`, `PARTIALLY_REFUNDED`, `UNKNOWN` | Authoritative settlement/capture state on the gateway. |
| **5. Settlement** | `PaymentCase.settlementStatus` | `SETTLEMENT_NONE`, `SETTLEMENT_PENDING`, `SETTLEMENT_SETTLED`, `SETTLEMENT_ADJUSTED`, `UNKNOWN` | Provider payout batching and bank settlement. |
| **6. Refunds** | `PaymentCase.refundStatus` | `REFUND_NONE`, `REFUND_ELIGIBLE`, `REFUND_INITIATED`, `REFUND_PENDING`, `REFUND_CONFIRMED`, `REFUND_FAILED`, `UNKNOWN` | Autonomous refunds remain disabled in Phase 5. |
| **7. Disputes** | `PaymentCase.disputeStatus` | `DISPUTE_NONE`, `DISPUTE_INQUIRY`, `DISPUTE_FORMAL_CHARGEBACK`, `DISPUTE_UNDER_REVIEW`, `DISPUTE_WON`, `DISPUTE_LOST`, `UNKNOWN` | Chargeback and retrieval request tracking. |
| **8. Resolution Case Status** | `PaymentCase.resolutionCaseStatus` | `CASE_DETECTED`, `CASE_INVESTIGATING`, `CASE_PENDING_POLICY`, `CASE_SAFE_HOLD`, `CASE_RESOLVED`, `CASE_EXTERNAL_ESCALATION` | Internal investigation and operator hold management. |

---

## 3. Deterministic State Machine Rules

The state transition engine is centralized in `server/src/services/stateMachine/paymentStateMachine.js` and shared symmetrically by both webhook ingestion and monitoring rechecks.

### 3.1 Gateway Payment Transitions (`canTransitionGatewayStatus`)
- `CREATED` / `PENDING` / `UNKNOWN` → Any forward state (`AUTHORIZED`, `CAPTURED`, `FAILED`).
- `AUTHORIZED` → `CAPTURED` or `FAILED`.
- `CAPTURED` → `REFUNDED` or `PARTIALLY_REFUNDED` (terminal for forward capture; regression to `FAILED` is strictly blocked).
- `FAILED` → `CAPTURED` allowed only for provider-verified late captures.
- `REFUNDED` → Terminal. No further transitions allowed.

### 3.2 Merchant Order Transitions (`canTransitionOrderStatus`)
- `CREATED` / `PENDING` → `PAID`, `CANCELLED`.
- `PAID` → `FULFILLED`, `REFUNDED`, `CANCELLED`.
- `CANCELLED` → Strictly terminal. Payment capture events cannot reopen cancelled orders.

### 3.3 Conflict Handling Matrix

| Scenario | Incoming Evidence | Gateway Payment Effect | Merchant Order Effect | Payment Case Effect |
| :--- | :--- | :--- | :--- | :--- |
| **Standard Capture** | Provider `captured` | `status = "CAPTURED"` | `status = "PAID"` | `captureStatus = "CAPTURE_CAPTURED"`, `orderStatus = "ORDER_PAID"` |
| **Stale Regression** | Provider `failed` after `CAPTURED` | **No change** (`CAPTURED` preserved) | **No change** (`PAID` preserved) | Evaluated as `STALE_REGRESSION_BLOCKED`, event recorded in append-only ledger |
| **Late Capture after Failure** | Provider `captured` after `FAILED` | `status = "CAPTURED"`, `isLateCapture = true` | `status = "PAID"` (if not cancelled) | `resolutionCaseStatus = "CASE_SAFE_HOLD"`, `safeHoldCode = "LATE_CAPTURE_AFTER_FAILURE"`, `isSafeHold = true` |
| **Capture on Cancelled Order** | Provider `captured` on `CANCELLED` order | `status = "CAPTURED"`, `isLateCapture = true` | **No change** (`CANCELLED` strictly preserved) | `resolutionCaseStatus = "CASE_SAFE_HOLD"`, `safeHoldCode = "LATE_CAPTURE_CANCELLED_ORDER"`, `isSafeHold = true` |
| **Retry Exhaustion / Timeout** | Polling retry ceiling reached | **No change** (`PENDING`/`UNKNOWN` preserved) | **No change** | `resolutionCaseStatus = "CASE_SAFE_HOLD"`, `safeHoldCode = "MONITORING_RETRY_EXHAUSTED"`, `safeHoldReason = "MONITORING_RETRY_EXHAUSTED"` |

---

## 4. Monitoring Architecture and Scheduler

### 4.1 Bounded Retries with Exponential Backoff and Jitter
- **Configurable Backoff Intervals**: `[60s, 300s, 900s, 1800s]`.
- **Retry Ceiling**: Configured via `MONITORING_MAX_ATTEMPTS` (default: 4 attempts).
- **Monitoring Deadline**: Configured via `MONITORING_DEADLINE_MINUTES` (default: 60 minutes).
- **Transient Provider Handling**:
  - `429 (Rate Limit)`: Rescheduled with backoff interval.
  - `Timeout / Network Error`: Rescheduled with backoff interval.
  - `401 / 403 (Auth Error)`: Fails closed safely (`status = "FAILED"`, `reason = "PROVIDER_CREDENTIAL_ERROR"`), without mutating payment or order records.

### 4.2 Durable MongoDB Persistence and Concurrency Control
Monitoring jobs are persisted in the `PaymentMonitoringTask` collection:
- **Atomic Claiming**: Uses MongoDB `findOneAndUpdate` with compound filter:
  ```javascript
  {
    $or: [
      { status: "PENDING", nextRunAt: { $lte: asOfTime }, $or: [{ lockedUntil: null }, { lockedUntil: { $lte: asOfTime } }] },
      { status: "IN_PROGRESS", lockedUntil: { $lte: asOfTime } }
    ]
  }
  ```
- **Optimistic Lease Locks**: When claimed, `lockedUntil` is set to `asOfTime + MONITORING_LEASE_DURATION_MS` (default: 30s) and `lockedBy` is set to `workerId`.
- **Automatic Crash Recovery**: If a worker process dies mid-task, its lease expires. The next sweep by any active worker automatically reclaims the task without manual intervention.
- **Cross-Instance Concurrency**: Enforces concurrency ceiling via `MONITORING_MAX_CONCURRENT_READS` (default: 5 concurrent reads).

### 4.3 Redaction and Sensitive Field Protection
- Provider responses are sanitized via `sanitizeWebhookPayload` before storage in `GatewayPayment.rawData`.
- API keys, secrets, tokens, passwords, and PII are redacted from all audit logs via `sanitizeAuditData`.
- Provider HTTP Basic Auth credentials are never logged or exposed in HTTP responses.

### 4.4 Runtime Deployment Topologies

Phase 5 supports both deployment models with identical atomic claiming and concurrency safety:

- **Option A — Unified In-Process Worker (Default):**
  - Activated by API server startup in [server.js](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/src/server.js).
  - Starts after database connection is ready (`connectDatabase(env.MONGODB_URI)`).
  - Controlled by `MONITORING_WORKER_ENABLED` (default: `true`).
  - Unit tests importing [app.js](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/src/app.js) never start background workers.
  - Automatically stops sweeps on `SIGINT` and `SIGTERM` before database teardown.
- **Option B — Dedicated Standalone Worker Fleet:**
  - Dedicated entrypoint in [worker.js](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/src/worker.js) runnable via `npm run start:worker`.
  - Independent process lifecycle for high-volume deployments.
  - Safely coexists with multiple instances via MongoDB atomic lease claiming (`findOneAndUpdate`).

### 4.5 Real Task Enqueueing Pathways

1. **Provider Webhook Ingress ([webhookService.js](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/src/services/webhook/webhookService.js)):**
   - Non-terminal authorized/created events (`payment.authorized`, `payment.created`) auto-schedule durable monitoring with 60s initial delay.
   - Authoritative terminal events (`payment.captured`, `payment.failed`, `payment.refunded`) automatically complete and settle active monitoring tasks (`outcomeReason: "WEBHOOK_EVENT_ARRIVED"`).
2. **Provider Sync Pipeline ([paymentSyncService.js](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/src/services/razorpay/paymentSyncService.js)):**
   - Synced pending or authorized payment attempts are idempotently enqueued for monitoring.
3. **Bounded Reconciliation Discovery (`enqueueUnmonitoredPendingPayments`):**
   - Bounded scanner (default limit: 50 records) discovers existing pending payments in the database that lack active monitoring tasks, ensuring no attempt is orphaned.

---

## 5. Environment Configuration

| Environment Variable | Default | Purpose |
| :--- | :--- | :--- |
| `MONITORING_WORKER_ENABLED` | `true` | Enables or disables background monitoring runner in `server.js` |
| `MONITORING_INTERVAL_MS` | `30000` | Background runner polling interval in milliseconds |
| `MONITORING_LEASE_DURATION_MS` | `30000` | Distributed lease duration before expired lock recovery |
| `MONITORING_MAX_CONCURRENT_READS` | `5` | Maximum concurrent provider read operations per sweep |
| `MONITORING_MAX_ATTEMPTS` | `4` | Maximum bounded status recheck retry attempts |
| `MONITORING_DEADLINE_MINUTES` | `60` | Maximum lifetime of an active monitoring task |

---

## 6. Audit Events

Phase 5 registers the following append-only audit actions in `AuditLog`:
- `MONITORING_TASK_SCHEDULED`: Emitted when a monitoring task is registered for a pending payment.
- `MONITORING_RECHECK_EXECUTED`: Emitted when an authoritative terminal status is confirmed by provider poll.
- `MONITORING_POLL_RESCHEDULED`: Emitted when a transient error or pending state triggers backoff rescheduling.
- `MONITORING_RETRY_EXHAUSTED`: Emitted when retry ceiling or monitoring deadline is reached without terminal status.
- `MONITORING_LEASE_EXPIRED_RECOVERED`: Emitted when an abandoned or crashed worker task is recovered.
- `MONITORING_SAFE_HOLD_APPLIED`: Emitted when safe-hold is placed on a discrepancy case.

---

## 7. Verification Gates and Results

| Gate | Target / Suite | Result |
| :--- | :--- | :--- |
| **1. Lifecycle State Machine Unit Tests** | `tests/monitoring/paymentStateMachine.test.js` | **PASS** (15/15 tests) |
| **2. Monitoring Scheduler & Retry Unit Tests** | `tests/monitoring/monitoringScheduler.test.js` | **PASS** (10/10 tests) |
| **3. Runtime Wiring & Task Lifecycle Tests** | `tests/monitoring/monitoringRuntimeWiring.test.js` | **PASS** (9/9 tests) |
| **4. Real-MongoDB Persistence & Concurrency** | `tests/integration/monitoringPersistence.integration.test.js` | **PASS** (7/7 tests) |
| **5. Production Startup & Network Isolation** | `tests/integration/productionStartup.integration.test.js` | **PASS** (3/3 tests) |
| **6. Webhook Ingestion & Signature Suite** | `tests/webhook/` | **PASS** (25/25 tests) |
| **7. Full Integration Suite (Real MongoDB)** | `npm run test:integration` | **PASS** (33/33 tests across 4 suites) |
| **8. Full Backend Unit & Domain Suite** | `npm test` | **PASS** (363/363 tests across 56 suites) |
| **9. Real Runtime Smoke Test** | `node scripts/monitoringSmokeTest.js` | **PASS** (Production entrypoint, zero network calls, clean SIGTERM) |
| **10. 120-Scenario Reconciliation Benchmark** | `tests/reconciliation/benchmarkCompatibility.test.js` | **PASS** (120/120 classifications, 100.00% match rate) |
| **11. Frontend Production Build** | `npm run build` (in `/client`) | **PASS** (Zero build errors) |
| **12. Git Diff Check** | `git diff --check` | **PASS** (Clean whitespace, no conflicts) |

---

## 8. Scope Limitations and Boundaries

- **No Financial Write APIs**: No refunds, captures, payouts, transfers, or order cancellations are executed by Phase 5.
- **Provider Read-Only**: The monitoring engine exclusively calls GET `/v1/payments/:id`.
- **Phase 6 Isolated**: Edge-case investigation and resolution recommendation engines remain unstarted.
