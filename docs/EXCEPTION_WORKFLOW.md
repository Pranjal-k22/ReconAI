# ReconAI Exception Management & Audit Workflow

## Purpose
This document specifies the financial exception management layer, safety gates, severity scoring, human review decision workflows, append-only audit trail design, and classification preservation guarantees implemented in ReconAI.

---

## Why Exceptions Exist
In automated financial reconciliation, no transaction anomaly or low-confidence match should be auto-reconciled without verification. Anomaly classifications (such as amount mismatches, unlinked settlements, duplicate payments, or ambiguous matches) represent financial risk or data integrity issues. ReconAI routes all non-clean results to an **Exception Queue** for human review and AI-assisted investigation.

---

## Safety Gate Policy
The Safety Gate ([`safetyGateService.js`](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/src/services/exceptions/safetyGateService.js)) enforces strict deterministic rules governing automatic resolution:

- **Rule A (Auto Resolution Allowed)**: `classification === "MATCHED"` AND `confidence >= 0.95` AND `requiresReview === false` $\rightarrow$ `allowedAutomaticResolution = true`.
- **Rule B (Anomaly Lockout)**: If `classification !== "MATCHED"` $\rightarrow$ `allowedAutomaticResolution = false` regardless of confidence score (e.g. `AMOUNT_MISMATCH` with 0.99 confidence is STILL locked for human review).
- **Rule C (Low Confidence Lockout)**: If `classification === "MATCHED"` BUT `confidence < 0.95` $\rightarrow$ `allowedAutomaticResolution = false`.

---

## Confidence Thresholds
```text
>= 0.95          High confidence (Auto-reconciliation allowed ONLY if classification is MATCHED)
>= 0.75 < 0.95   Medium confidence (Human review required)
< 0.75           Low confidence (Manual investigation required)
```

> **Note**: Confidence score measures matching evidence strength. It NEVER overrides anomaly classification rules.

---

## Exception Creation
During batch reconciliation orchestration ([`reconciliationService.js`](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/src/services/reconciliation/reconciliationService.js)), for every scenario where `requiresReview === true` or `classification !== "MATCHED"`, an `ExceptionCase` document is created with:
- **`exceptionId`**: Unique identifier (e.g., `EXC-20260902113400-FA3I-ORD-000116`).
- **`type`**: Equal to the anomaly classification (e.g., `AMOUNT_MISMATCH`, `AMBIGUOUS`). `MATCHED` is strictly forbidden as an exception type.
- **`deterministicExplanation`**: Concise reason extracted from rule evidence.
- **`status`**: Initialized to `"OPEN"`.
- **`humanDecision`**: Initialized to `"NONE"`.

---

## Severity Rules & Financial Impact
Calculated deterministically by [`severityService.js`](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/src/services/exceptions/severityService.js):

### Financial Impact Calculation
- `AMOUNT_MISMATCH`, `FEE_MISMATCH`, `REFUND_MISMATCH`: $\text{abs}(\text{differencePaise})$
- `MISSING_PAYMENT`, `MISSING_SETTLEMENT`, `REFERENCE_MISMATCH`, `AMBIGUOUS`, `INVALID_DATA`: $\text{expectedAmountPaise}$ (Order amount at risk)
- `DUPLICATE_PAYMENT`: Potential duplicate exposure amount.

### Severity Levels
- **`CRITICAL`**: `DUPLICATE_PAYMENT`, `DUPLICATE_SETTLEMENT`, `INVALID_DATA` or financial impact $\ge$ ₹10,000 (1,000,000 paise).
- **`HIGH`**: `AMOUNT_MISMATCH`, `REFUND_MISMATCH`, `REFERENCE_MISMATCH`, `AMBIGUOUS` or financial impact $\ge$ ₹5,000 (500,000 paise).
- **`MEDIUM`**: `MISSING_SETTLEMENT`, `FEE_MISMATCH`, `MISSING_PAYMENT` or financial impact $\ge$ ₹1,000 (100,000 paise).
- **`LOW`**: Discrepancies with minor exposure ($<$ ₹1,000).

---

## Human Review Decision Workflow
Finance reviewers inspect exception details and apply decisions via `PATCH /api/exceptions/:exceptionId/decision`:

1. **`APPROVE_MATCH`**: Reviewer confirms transaction is acceptable despite anomaly.
   - `ExceptionCase.status`: `"RESOLVED"`
   - `ExceptionCase.humanDecision`: `"APPROVE_MATCH"`
   - `ReconciliationResult.resolutionStatus`: `"APPROVED"`
   - `ReconciliationResult.autoResolved`: `false` (human approved, not auto-reconciled)
   - `ReconciliationResult.requiresReview`: `false`
2. **`KEEP_EXCEPTION`**: Reviewer confirms anomaly remains valid and needs further investigation.
   - `ExceptionCase.status`: `"UNDER_REVIEW"`
   - `ExceptionCase.humanDecision`: `"KEEP_EXCEPTION"`
   - `ReconciliationResult.resolutionStatus`: `"UNDER_REVIEW"`
   - `ReconciliationResult.requiresReview`: `true`
3. **`MARK_RESOLVED`**: External resolution completed.
   - `ExceptionCase.status`: `"RESOLVED"`
   - `ExceptionCase.humanDecision`: `"MARK_RESOLVED"`
   - `ReconciliationResult.resolutionStatus`: `"RESOLVED"`
   - `ReconciliationResult.requiresReview`: `false`

---

## Original Classification Preservation Guarantee
**MANDATORY ARCHITECTURE INVARIANT**: A human review decision NEVER alters the original `ReconciliationResult.classification` or engine prediction.
- Example: If a reviewer applies `APPROVE_MATCH` or `MARK_RESOLVED` to an `AMOUNT_MISMATCH` exception, `result.classification` remains **`AMOUNT_MISMATCH`**.
- This separates **System Prediction** from **Human Operational Resolution**, maintaining evaluation benchmark integrity and ground truth auditability.

---

## Audit Trail & Append-Only Policy
All system, engine, and human actions are centrally recorded by [`auditService.js`](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/src/services/audit/auditService.js):

- **Sanitization Guarantee**: Secrets (`password`, `token`, `authorization`, `MONGODB_URI`, `GEMINI_API_KEY`, `RAZORPAY_KEY_SECRET`) are recursively redacted to `"[REDACTED]"`.
- **Append-Only Policy**: The REST API exposes `GET /api/audit` and `GET /api/audit/:eventId`. **NO UPDATE, PUT, OR DELETE** endpoints exist for audit logs.

### Key Audit Events
- `RECONCILIATION_STARTED`
- `MATCH_CREATED`
- `EXCEPTION_CREATED`
- `HUMAN_DECISION`
- `RECONCILIATION_COMPLETED`

---

## Ambiguous Failure Example (`ORD-000116`)
In the synthetic benchmark dataset, `ORD-000116` represents a primary ambiguous multi-payment order.
- Engine Classification: `AMBIGUOUS`
- Confidence: `0.45`
- Safety Gate: Auto-reconciliation BLOCKED (`requiresHumanReview = true`)
- Initial Status: `OPEN`
- Live Demonstration Decision: Applied `KEEP_EXCEPTION` with notes.
- Updated Status: `UNDER_REVIEW`
- Classification Preserved: `AMBIGUOUS`

---

## Current Live Benchmark Exception Metrics (`RUN-20260902113400-FA3I`)
- **Total Scenarios**: 120
- **Clean Matches**: 80 (`MATCHED`)
- **Exceptions Created**: 40
- **Audit Events Generated**: 122
- **Breakdown by Severity**:
  - CRITICAL: 12
  - HIGH: 3
  - MEDIUM: 3
  - LOW: 22
- **Breakdown by Type**:
  - `AMOUNT_MISMATCH`: 8
  - `MISSING_SETTLEMENT`: 6
  - `DUPLICATE_PAYMENT`: 5
  - `FEE_MISMATCH`: 5
  - `REFUND_MISMATCH`: 4
  - `MISSING_PAYMENT`: 4
  - `REFERENCE_MISMATCH`: 3
  - `AMBIGUOUS`: 3
  - `INVALID_DATA`: 2

---

## Track 4 Phase 2A Metric Semantics & Operational Invariants

- **AI Advisory Boundary Principle**: **AI investigation does NOT equal financial resolution.** Gemini AI API provides root-cause explanations (`aiExplanation`) and recommendations, but exception status remains **`OPEN`** or **`UNDER_REVIEW`** until an explicit human review decision is applied (`APPROVE_MATCH`, `KEEP_EXCEPTION`, or `MARK_RESOLVED`).
- **Unresolved Exceptions Definition**: An exception is defined as `unresolved` at controller run completion if its `ExceptionCase.status` is in `("OPEN", "UNDER_REVIEW")`.
- **Human Review Actions**:
  - `APPROVE_MATCH` → Sets status to `RESOLVED` (human decision: `APPROVE_MATCH`), removed from unresolved queue.
  - `KEEP_EXCEPTION` → Retains status as `OPEN` / `UNDER_REVIEW`, remains in unresolved queue for merchant/gateway resolution.
  - `MARK_RESOLVED` → Sets status to `RESOLVED` (human decision: `MARK_RESOLVED`), removed from unresolved queue.
- **Original Classification Preservation**: Human review decisions update resolution workflow state (`status`), but NEVER change `ReconciliationResult.classification`.

---

## Track 4 Phase 4 — Safety & Audit Hardening Verification

- **Phase Status**: VERIFIED & HARDENED (PASS).
- **Verified Exception & Safety Invariants**:
  - **Safety Gate Integration**: Finance Controller Agent invokes `evaluateSafetyGate` directly. Verified that non-MATCHED classifications (e.g. `AMOUNT_MISMATCH`, `AMBIGUOUS`, `DUPLICATE_PAYMENT`) are locked out from auto-resolution regardless of confidence score.
  - **Human Review Control**: AI investigation does NOT resolve exceptions. All 40 benchmark exceptions remain `OPEN` / `UNDER_REVIEW` until human decisions (`APPROVE_MATCH`, `KEEP_EXCEPTION`, `MARK_RESOLVED`) are executed.
  - **Original Classification Preservation**: Verified that applying human decisions changes `status` to `APPROVED` or `RESOLVED`, but `classification` remains immutably preserved (e.g., `AMBIGUOUS`).
  - **Append-Only Audit Guarantee**: Verified zero `UPDATE` or `DELETE` API paths exist for audit events. Sensitive keys (`password`, `token`, `authorization`, `GEMINI_API_KEY`, `RAZORPAY_KEY_SECRET`) are recursively redacted to `"[REDACTED]"`.


