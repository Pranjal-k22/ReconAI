# RECONAI 2.0 — PHASE 9
# Sandbox Provider Adapter & Verified Outcome Handling

## 1. Executive Summary & Purpose

Phase 9 establishes the server-side Sandbox Provider Adapter and Conservative Verified Outcome Lifecycle for ReconAI 2.0.

In Phase 8, the deterministic resolution policy engine and dry-run simulator evaluated action eligibility with strictly non-executing simulation semantics. Phase 9 introduces a hardened, strictly gated provider adapter that interacts exclusively with Razorpay Test Mode under explicit multi-tier opt-in guards, coupled with an independent outcome verification state machine.

### Non-Negotiable Safety Invariants Enforced
1. **Default-Disabled Operation**: Local deterministic simulation and dry-run remain the default. Provider mutations are disabled by default (`RAZORPAY_SANDBOX_WRITES_ENABLED=false`).
2. **Zero Live Credentials or Production Writes**: Production endpoints (`api.razorpay.com` with live keys) and live financial writes are prohibited. There is NO production write mode.
3. **Explicit Test-Mode Sandbox Gate**: Operations fail closed unless `RAZORPAY_MODE === "test"`, `RAZORPAY_SANDBOX_WRITES_ENABLED === true`, and `RAZORPAY_KEY_ID` starts with `"rzp_test_"`.
4. **No Policy Invention or Request-Controlled Limits**: The policy engine remains the sole authority for eligibility. In the absence of approved server-side refund limits (`policyConfig === null`), refund actions fail closed before any provider call.
5. **Unconditional Safe Hold on Case 22**: Late capture on cancelled orders (`R_LATE_CAPTURE_CANCELLED_ORDER_HOLD`) is unconditionally held. Automated dispatch is strictly prohibited.
6. **Acceptance is Not Proof of Completion**: An accepted HTTP 200/201 response is never proof that a refund succeeded. Outcome verification requires an independent authoritative read (`GET /v1/payments/:id/refunds/:refundId`).
7. **Interruption & Timeout Semantics**: Network interruption, timeouts, or ambiguous reads transition to `OUTCOME_UNKNOWN`—never treated as provider failure and never retried blindly.

---

## 2. Adapter Architecture & System Boundary

The adapter is strictly separated into three concerns:
1. **Low-level Provider Client (`razorpayClient.js`)**: Encapsulates HTTP transport, timeout abort controllers, and error normalization.
2. **Sandbox Adapter (`razorpaySandboxAdapter.js`)**: Enforces startup and operation-time sandbox write gates, payload sanitization (deep PII and credential stripping), and authoritative status reads.
3. **Provider Dispatch Coordinator (`providerDispatchService.js`)**: Executes the 9-step resolution ordering, durable state persistence, idempotency verification, and independent outcome resolution.

### System Flow Diagram

```
[ Financial Controller / Admin ]
               │
               ▼
   [ 1. Authenticate & RBAC ]
               │
               ▼
   [ 2. Validate Tenant & Resource Binding ]
               │
               ▼
   [ 3. Obtain Evidence & Evaluate Policy ]
               │
               ├─ If Policy Denies or Limits Missing ─────────► [ STOP: Return 422 Blocked ]
               ├─ If Case 22 (Late Capture Cancelled Order) ──► [ STOP: Return 422 Blocked ]
               │
               ▼ (Eligible)
   [ 4. Evaluate Sandbox Write Gate ]
               │
               ├─ If Gate Closed (Default) ────────────────────► [ STOP: Return 403 Forbidden ]
               │
               ▼ (Gate Open)
   [ 5. Durably Persist ProviderOperation (REQUESTED) ]
               │
               ▼
   [ 6. Dispatch Sandbox POST (/v1/payments/:id/refund) ]
               │
               ├─ If Timeout / Network Drop ───────────────────► [ Persist OUTCOME_UNKNOWN ]
               │
               ▼ (Accepted)
   [ 7. Independent Authoritative GET Read ]
               │
               ├─ status: "processed" ─────────────────────────► [ Persist VERIFIED_SUCCEEDED ]
               ├─ status: "failed" ────────────────────────────► [ Persist VERIFIED_FAILED ]
               ├─ status: "pending" / Timeout ─────────────────► [ Persist OUTCOME_UNKNOWN ]
               └─ amount mismatch / conflict ──────────────────► [ Persist SAFE_HOLD ]
```

---

## 3. Configuration Variables & Startup Guards

| Environment Variable | Allowed Values | Default | Safety Invariant Enforced |
|---|---|---|---|
| `RAZORPAY_MODE` | `"test"`, `"live"` | `"test"` | Must be `"test"` for any provider dispatch. If `"live"`, mutations fail closed. |
| `RAZORPAY_SANDBOX_WRITES_ENABLED` | `true`, `false` | `false` | Explicit opt-in required for test mutations. Fails closed by default. |
| `RAZORPAY_KEY_ID` | String | `""` | Must start with `"rzp_test_"`. If starting with `"rzp_live_"`, blocked immediately. |
| `RAZORPAY_KEY_SECRET` | String (min 16) | `""` | Provider basic auth signing secret. Stripped from all logs and responses. |
| `RAZORPAY_REQUEST_TIMEOUT_MS` | Positive Integer | `10000` | AbortController deadline preventing hung HTTP sockets. |

Startup validation in `server/src/config/env.js` immediately halts execution if `RAZORPAY_SANDBOX_WRITES_ENABLED === true` while `RAZORPAY_MODE !== "test"` or `RAZORPAY_KEY_ID` does not start with `"rzp_test_"`.

---

## 4. Conservative Provider Outcome Lifecycle & Authoritative Identity Verification

The domain model represents these 5 discrete states in `ProviderOperation`:

| State | Definition | Triggering Evidence | Permitted Subsequent Transition |
|---|---|---|---|
| `REQUESTED` | Durably recorded in MongoDB prior to dispatch | Created before HTTP POST call | `OUTCOME_UNKNOWN`, `VERIFIED_SUCCEEDED`, `VERIFIED_FAILED`, `SAFE_HOLD` |
| `OUTCOME_UNKNOWN` | Ambiguous state; timeout, network drop, pending provider state, or HTTP 409 | POST timed out, network error, HTTP 409, GET timed out, or GET returned `status: "pending"` | Can be rechecked via read-only GET; **never** blindly re-refunded |
| `VERIFIED_SUCCEEDED` | Authoritative provider confirmation of completed refund with exact identity match | Authoritative GET returned `status: "processed"`, exact refund ID, exact payment ID, exact amount in paise, and expected currency | Terminal state |
| `VERIFIED_FAILED` | Authoritative provider confirmation that refund failed | Authoritative GET returned `status: "failed"` with matching refund ID, payment ID, amount, and currency | Terminal state |
| `SAFE_HOLD` | Identity mismatch, incomplete response, currency mismatch, amount discrepancy, or contradictory evidence | Authoritative GET response missing required identity fields, refund ID mismatch, payment ID mismatch, amount mismatch, unsupported status, or contradictory response | Manual operator investigation |

### Exact Identity Verification Rules
Before marking a refund `VERIFIED_SUCCEEDED`, the authoritative provider response must strictly contain and match:
1. **Expected Refund ID**: Must match `sanitized.id` exactly where known.
2. **Expected Gateway Payment ID**: Must match `sanitized.payment_id` exactly.
3. **Exact Requested Refund Amount (Paise)**: Must match `sanitized.amount` exactly.
4. **Expected Currency**: Must match `sanitized.currency` (e.g. `INR`).
5. **Supported Status**: Must be `processed` for success, or `failed` for conclusive failure.

**Safe-Hold Failure Rules**:
- Missing identity fields (`id`, `payment_id`, `amount`, `status`) fail closed to `SAFE_HOLD`.
- Any mismatch in refund ID, payment ID, amount, or currency transitions the operation to `SAFE_HOLD`.
- HTTP 200 with wrong identities is rejected and placed in `SAFE_HOLD`.
- Contradictory evidence (e.g., status is `failed` but payment ID belongs to an unrelated record) transitions to `SAFE_HOLD`, preventing false conclusions.

---

## 5. Provider Idempotency Header, Persistence, and Concurrency Controls

1. **Provider Outbound Idempotency Header (`X-Refund-Idempotency`)**:
   - Razorpay refunds API officially supports the `X-Refund-Idempotency` header for outbound POST `/v1/payments/:id/refund`.
   - The provider idempotency key is tied 1:1 to the durable `operationId` (e.g., `op_prov_...`) and persisted as `providerIdempotencyKey` in `ProviderOperation` with status `REQUESTED` before outbound dispatch.
   - Retries and status rechecks unconditionally reuse the exact same `providerIdempotencyKey` and identical payload.
   - Timeouts or network interruptions never generate a new provider idempotency key.
2. **Durable Unique Indexes**:
   ```javascript
   providerOperationSchema.index({ tenantId: 1, idempotencyKey: 1 }, { unique: true });
   providerOperationSchema.index({ tenantId: 1, providerIdempotencyKey: 1 });
   ```
3. **Payload Hash Check**:
   On repeated requests with the same `idempotencyKey`:
   - If payload hash matches: returns existing operation idempotently.
   - If payload hash differs: rejects immediately with `409 Conflict`.
4. **Conservative HTTP 409 Provider Response Handling**:
   - If the provider returns HTTP 409 Conflict, it is treated conservatively as `OUTCOME_UNKNOWN` (verification status: `DISPATCH_CONFLICT_UNKNOWN`).
   - The system assumes neither success nor failure without authoritative verification.
5. **Safe Replay on Unknown Outcome**:
   - If an existing operation is in `OUTCOME_UNKNOWN`, replaying the request does **not** issue a new mutation.
   - It triggers read-only status verification against `providerOperationId` if present, strictly enforcing financial safety.

---

## 6. Manual Sandbox Smoke Procedure

The following manual procedure is available for testing in non-production environments:

### Pre-conditions
1. Run local MongoDB and ensure test database is active.
2. Ensure Razorpay test credentials are set in `.env`:
   ```bash
   RAZORPAY_MODE=test
   RAZORPAY_KEY_ID=rzp_test_YOUR_KEY
   RAZORPAY_KEY_SECRET=YOUR_SECRET
   RAZORPAY_SANDBOX_WRITES_ENABLED=true
   ```
3. Create a test payment in Razorpay test mode (e.g. `pay_test_xxx`).

### Verification Steps
1. Attempt dispatch without approved server-side limits:
   ```bash
   POST /api/payment-cases/:caseId/provider/dispatch
   ```
   **Expected Result**: `422 Unprocessable Entity` with reason `R_REFUND_LIMITS_MISSING_FAIL_CLOSED`. Dispatch blocked.
2. Attempt dispatch on Case 22:
   ```bash
   POST /api/payment-cases/:caseId22/provider/dispatch
   ```
   **Expected Result**: `422 Unprocessable Entity` with reason `R_LATE_CAPTURE_CANCELLED_ORDER_HOLD`. Dispatch blocked.
3. Query operations endpoint:
   ```bash
   GET /api/payment-cases/:caseId/provider/operations
   ```
   **Expected Result**: `200 OK` returning sanitized provider operations.

---

## 7. Regression Gate Verification Summary

All 14 required regression gates have been executed and verified on `main`:

| Gate # | Suite Description | Result | Details |
|---|---|---|---|
| **Gate 1** | Provider adapter unit tests | **PASS** | 15/15 tests passing (`razorpaySandboxAdapter.test.js`) |
| **Gate 2** | Provider outcome and normalization tests | **PASS** | 11/11 tests passing (`providerOutcomeVerification.test.js`, `razorpayNormalizer.test.js`) |
| **Gate 3 & 4** | Policy evaluator, refund-limits, & Case 22 tests | **PASS** | 68/68 tests passing (`resolutionPolicyEvaluator.test.js`) |
| **Gate 5** | Phase 6 evidence-classification tests | **PASS** | 41/41 tests passing (`evidenceClassifier.test.js`) |
| **Gate 6** | Route authorization & tenant isolation tests | **PASS** | 57/57 tests passing across 4 suites |
| **Gate 7** | MongoDB persistence, idempotency, & concurrency tests | **PASS** | 20/20 tests passing across 2 integration suites |
| **Gate 8** | Monitoring and worker regression tests | **PASS** | 34/34 tests passing across 3 monitoring suites |
| **Gate 9** | Webhook signatures & ingestion tests | **PASS** | 25/25 tests passing across 2 webhook suites |
| **Gate 10** | Full real-MongoDB integration suite (`npm run test:integration`) | **PASS** | 61/61 tests passing across 8 integration suites |
| **Gate 11** | Full backend test suite (`npx vitest run`) | **PASS** | 544/544 tests passing across 65 test files |
| **Gate 12** | Frontend production build (`npm run build`) | **PASS** | 2,400 modules transformed, zero build errors |
| **Gate 13** | Whitespace & format check (`git diff --check`) | **PASS** | Clean working copy, zero errors |
| **Gate 14** | 120-scenario reconciliation benchmark | **PASS** | 120/120 correct (100.00% match rate) |

---

## 8. Confirmation of Stopping Invariants

- **No live provider writes** are enabled or executed.
- **Refund requests remain blocked** when approved refund limits are unavailable.
- **Case 22 remains unconditionally in safe hold**.
- **Unverified provider outcomes are never marked complete**.
- **Phase 10 has not started**.
