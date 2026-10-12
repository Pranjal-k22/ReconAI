# RECONAI 2.0 — PHASE 10: AUTONOMOUS WORKER, DURABLE ORCHESTRATION & SAFE RESOLUTION LIFECYCLE
## Architecture, Invariants, and Operational Guide

**Author**: ReconAI 2.0 Architecture Team  
**Date**: October 12, 2026  
**Status**: APPROVED & SHIPPED  
**Starting Commit**: `c590e7d0d5adfb83341067868dc929e4cc33fd9d`  

---

## 1. Executive Summary & Objective

Phase 10 implements the **autonomous, tenant-safe orchestration layer** for ReconAI 2.0. It coordinates existing monitoring tasks, evidence collection, deterministic policy evaluations, read-only provider status verifications, and escalations.

### Core Architecture Axiom
**Autonomous execution is strictly non-mutating.**  
The orchestration worker coordinates discovery, read-only verification, and deterministic policy evaluation. It is **permanently prohibited from executing financial mutations** (no refunds, no captures, no order cancellations/reopenings, no ledger mutations).

When a deterministic resolution policy indicates that a refund or financial mutation is eligible, the worker records an `ESCALATION_REQUIRED` decision for authorized human operator dispatch, strictly preventing rogue autonomous mutations.

---

## 2. Non-Negotiable Safety Invariants

1. **Zero Autonomous Financial Writes**:
   - The autonomous worker cannot dispatch refunds, capture payments, void authorizations, cancel/reopen merchant orders, or mutate canonical settlement/payment records.
   - Provider writes remain disabled by default.
2. **Centralized Enablement Gate & Kill Switch**:
   - Worker is **disabled by default** (`ORCHESTRATOR_WORKER_ENABLED=false`).
   - Requires explicit server-side environment configuration. Client requests, AI suggestions, webhook payloads, or database fields cannot dynamically enable it.
   - An in-memory and API-accessible operator kill switch allows immediate halting of all task claiming.
3. **Case 22 Unconditionally in `SAFE_HOLD`**:
   - Late capture after a cancelled order cannot be refunded or reopened autonomously.
   - Transitions unconditionally to `SAFE_HOLD` (`R_LATE_CAPTURE_CANCELLED_ORDER_HOLD`) with `escalationState: PENDING_OPERATOR_REVIEW`.
4. **Missing Approved Refund Limits Fail Closed**:
   - The absence of trusted, approved server-side refund limits stops any refund action before any provider call (`R_REFUND_LIMITS_MISSING_FAIL_CLOSED`).
5. **No Speculative Outcome Determination**:
   - Timeouts, network interruptions, or ambiguous provider responses are never treated as confirmation of success or failure.
   - Transient failures trigger bounded exponential backoff; exhausted retries transition to `SAFE_HOLD`.
6. **Strict Separation of AI, Policy, and Execution**:
   - AI outputs are purely advisory. Only the server-side deterministic policy evaluator (`evaluateResolutionPolicy`) determines eligibility.
   - AI assertions cannot bypass policy limits, override Case 22, or authorize execution.
7. **PII and Secret Sanitization**:
   - Passwords, authorization headers, tokens, client secrets, card details, CVVs, and customer PII are strictly redacted from task history and logs.

---

## 3. Orchestration Architecture Diagram

```
 [ Payment Case Event / Webhook / API ]
                 │
                 ▼
 [ queueOrchestrationTask ] ─────────► [ Compound Unique Index: { tenantId, idempotencyKey } ]
                 │
                 ▼
 [ QUEUED in MongoDB ]
                 │
                 ▼ (Atomic findOneAndUpdate with Lease Lock)
 [ CLAIMED by Worker ] ──────────────► [ Leased: lockedUntil = now + 30s, lockedBy = workerId ]
                 │
                 ├─ If Worker Crashes ──► [ Stale Lease Recovered after lockedUntil ]
                 │
                 ▼
 [ EVIDENCE_COLLECTION ] ─────────────► [ Validate Tenant & Resource Bindings ]
                 │                     ├─ Tenant mismatch ──► [ SAFE_HOLD ]
                 │                     └─ Case 22 detected ─► [ SAFE_HOLD (Unconditional) ]
                 │
                 ▼ (Read-Only Provider Recheck via GET /v1/payments/:id)
                 ├─ Timeout / Network Drop ──────────────────► [ WAITING_FOR_RECHECK / SAFE_HOLD ]
                 │
                 ▼
 [ POLICY_EVALUATION ] ───────────────► [ Deterministic Policy Engine (Server-Side Limits) ]
                 │
                 ├─ SAFE_HOLD Mandated ──────────────────────► [ SAFE_HOLD ]
                 ├─ Missing Limits / Escalation Required ───► [ ESCALATION_REQUIRED ]
                 ├─ Action: REQUEST_REFUND ──────────────────► [ ESCALATION_REQUIRED (Human Dispatch) ]
                 ├─ Action: WAIT_AND_MONITOR ────────────────► [ WAITING_FOR_RECHECK (Backoff Schedule) ]
                 └─ Fully Reconciled / No Action ────────────► [ COMPLETED ]
```

---

## 4. The 10 Discrete Orchestration States

| State | Description | Permitted Outbound Transitions | Terminal? |
|---|---|---|---|
| `QUEUED` | Task enqueued, awaiting worker claim | `CLAIMED`, `SAFE_HOLD`, `FAILED_TERMINAL` | No |
| `CLAIMED` | Leased atomically by worker process | `EVIDENCE_COLLECTION`, `WAITING_FOR_RECHECK`, `SAFE_HOLD`, `FAILED_RETRYABLE`, `FAILED_TERMINAL` | No |
| `EVIDENCE_COLLECTION` | Gathering authoritative evidence records | `POLICY_EVALUATION`, `WAITING_FOR_RECHECK`, `SAFE_HOLD`, `ESCALATION_REQUIRED`, `FAILED_RETRYABLE`, `FAILED_TERMINAL` | No |
| `POLICY_EVALUATION` | Evaluating deterministic policy rules | `WAITING_FOR_RECHECK`, `SAFE_HOLD`, `ESCALATION_REQUIRED`, `COMPLETED`, `FAILED_RETRYABLE`, `FAILED_TERMINAL` | No |
| `WAITING_FOR_RECHECK` | Scheduled for next bounded check interval | `CLAIMED`, `SAFE_HOLD`, `ESCALATION_REQUIRED`, `FAILED_TERMINAL` | No |
| `SAFE_HOLD` | Protection hold (Case 22, ambiguous evidence, missing limits) | `QUEUED` (Manual operator re-queue only) | Held |
| `ESCALATION_REQUIRED` | Escalated for authorized human review (refund requests) | `QUEUED` (Manual operator re-queue only) | Held |
| `COMPLETED` | Verified terminal state (fully reconciled) | *(None)* | **Yes** |
| `FAILED_RETRYABLE` | Transient network/DB error during run | `QUEUED`, `WAITING_FOR_RECHECK`, `FAILED_TERMINAL` | No |
| `FAILED_TERMINAL` | Unrecoverable failure / poisoned task | *(None)* | **Yes** |

---

## 5. Concurrency Control, Leases, and Ownership Safety

1. **Atomic Distributed Leasing (`findOneAndUpdate`)**:
   Tasks are claimed atomically using compare-and-set semantics:
   ```javascript
   {
     $or: [
       { state: { $in: ["QUEUED", "WAITING_FOR_RECHECK"] }, nextRunAt: { $lte: asOfTime }, lockedUntil: { $lte: asOfTime } },
       { state: { $in: ["CLAIMED", "EVIDENCE_COLLECTION", "POLICY_EVALUATION"] }, lockedUntil: { $lte: asOfTime } }
     ]
   }
   ```
2. **Safe Lease Renewal (`renewOrchestrationTaskLease`)**:
   - Long-running tasks safely renew their lease while actively processing before the lease expires.
   - Renewal updates MongoDB atomically: `{ taskId, lockedBy: workerId, lockedUntil: { $gte: asOfTime }, state: { $in: ["CLAIMED", "EVIDENCE_COLLECTION", "POLICY_EVALUATION"] } }`.
   - Renewal succeeds only if the worker remains the valid, unexpired owner. If renewal fails, the worker loses ownership and halts execution cleanly with `{ status: "LEASE_LOST" }`.
3. **Atomic State Transition Ownership Guard**:
   - All state transitions in `transitionTaskState` enforce an atomic conditional update verifying current lease ownership:
     `{ taskId: task.taskId, lockedBy: workerId, lockedUntil: { $gte: asOfTime } }`.
   - If the task was recovered by another worker after a timeout or crash, any subsequent mutation attempt by the former worker throws `AppError.conflict(..., code: "LEASE_OWNERSHIP_LOST")`.
   - The former worker is permanently prevented from overwriting the new owner's state or corrupting orchestration history.
4. **Stale Lease Recovery**:
   If a worker process crashes, its lease expires after `leaseDurationMs` (default 30 seconds). A surviving worker automatically recovers the task, increments `attemptCount`, records `staleLeasesRecovered` in metrics, and resumes processing without duplicating external side-effects.
5. **Compound Idempotency Index**:
   ```javascript
   orchestrationTaskSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
   ```
   Repeated triggers with identical idempotency keys return the existing run rather than spawning competing runs.
6. **Bounded Retry Schedule**:
   Adheres strictly to the approved progression: `[60s, 300s, 900s, 1800s]`. Max attempts default to 4. When attempts are exhausted, the task safely halts in `SAFE_HOLD` or `ESCALATION_REQUIRED`.

---

## 6. Process-Shared Kill Switch & Operational Controls

### Durable, Process-Shared Control Architecture (`OrchestrationControl`)
- The operator kill switch is backed durably by MongoDB via the `OrchestrationControl` model (`{ controlKey: "GLOBAL_ORCHESTRATION_CONTROL" }` with a unique index).
- Setting the switch via `POST /api/orchestration/kill-switch` in the API process is immediately observed across process boundaries by separate worker processes (`node src/worker.js` and worker pools).
- Evaluated before claiming new work and before each consequential execution step (read-only provider status check, policy evaluation).
- When engaged, workers stop claiming new tasks, cleanly halt in-flight tasks to `WAITING_FOR_RECHECK` with cleared locks, and never convert interruptions into financial outcomes.
- If MongoDB is unreachable or the switch document is unreadable, workers strictly fail closed (`DATABASE_UNAVAILABLE_FAIL_CLOSED`).
- Process restarts cannot silently restore an enabled state if the persistent switch is active.

### Environment Variables

| Variable | Description | Default | Requirement |
|---|---|---|---|
| `ORCHESTRATOR_WORKER_ENABLED` | Enable autonomous orchestration sweeps | `false` | Must be explicitly `true` to start sweeps. Fails closed by default. |
| `ORCHESTRATOR_INTERVAL_MS` | Polling sweep interval | `30000` | Positive integer (ms). |
| `ORCHESTRATOR_LEASE_DURATION_MS` | Distributed lease lock duration | `30000` | Positive integer (ms). |
| `ORCHESTRATOR_MAX_CONCURRENT_TASKS` | Concurrency batch ceiling per sweep | `5` | Positive integer. |
| `ORCHESTRATOR_MAX_ATTEMPTS` | Maximum retry attempts per task | `4` | Positive integer. |

### Operator Kill Switch API
- **Endpoint**: `POST /api/orchestration/kill-switch`
- **RBAC**: Strictly restricted to `ADMIN`.
- **Payload**: `{ "active": true }` to halt; `{ "active": false }` to resume.
- **Audit**: Emits `ORCHESTRATOR_KILL_SWITCH_ENGAGED` / `ORCHESTRATOR_KILL_SWITCH_DISENGAGED` audit log and persists state to `OrchestrationControl`.

---

## 7. Regression Verification Gates

All 15 required regression gates have passed cleanly on `main`:

| Gate | Description | Passed / Total | Result |
|---|---|---|---|
| **Gate 1** | Orchestration service & state machine tests | 23 / 23 | **PASS** |
| **Gate 2** | Orchestration routes & shared kill switch tests | 14 / 14 | **PASS** |
| **Gate 3** | Task leases, renewal, stale recovery, and concurrency | 10 / 10 | **PASS** |
| **Gate 4** | Provider adapter & outcome verification tests | 48 / 48 | **PASS** |
| **Gate 5** | Policy evaluator & refund-limit tests | 68 / 68 | **PASS** |
| **Gate 6** | Case 22 & Phase 6 classification tests | 41 / 41 | **PASS** |
| **Gate 7** | Route authorization & tenant isolation tests | 143 / 143 | **PASS** |
| **Gate 8** | Real MongoDB persistence & concurrency tests | 74 / 74 (9 suites) | **PASS** |
| **Gate 9** | Monitoring & worker runtime tests | 34 / 34 | **PASS** |
| **Gate 10** | Webhook signature & ingestion tests | 25 / 25 | **PASS** |
| **Gate 11** | Full real-MongoDB integration suite (`npm run test:integration`) | 74 / 74 (9 suites) | **PASS** |
| **Gate 12** | Full backend test suite (`npx vitest run`) | 592 / 592 (68 files) | **PASS** |
| **Gate 13** | Frontend production build (`npm run build`) | 2,400 modules, 0 errors | **PASS** |
| **Gate 14** | Whitespace & format check (`git diff --check`) | Clean working copy | **PASS** |
| **Gate 15** | 120-scenario reconciliation benchmark | 120 / 120 (100.00%) | **PASS** |

---

## 8. Explicit Stopping Condition

Phase 10 final correction is complete and all safety invariants have been preserved. No further development phases may be started pending formal review and acceptance.
