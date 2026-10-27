# ReconAI System Memory & Knowledge Context

## 1. Project Identity & Architecture Evolution
- **ReconAI 1.0**: Deterministic three-way financial reconciliation engine (Merchant Orders, Gateway Payments, Settlement Records) with 120 synthetic benchmark scenarios, GroundTruth isolation, and advisory Gemini AI exception investigation.
- **ReconAI 2.0**: Enterprise-grade autonomous payment monitoring and resolution controller with multi-tenant RBAC, cryptographic webhook ingestion, background poller worker, 8-dimension monotonic payment state machine, 30-scenario deterministic classification precedence engine, material-state hash staleness gates, governed two-person policy limits, and a read-only operator workspace.

---

## 2. Core Technological Stack
- **Frontend**: React (Vite, JavaScript), Tailwind CSS, Lucide Icons, Axios, Recharts.
- **Client Testing**: Vitest 1.6.1 + React Testing Library + JSDOM (`npm test --prefix client`).
- **Backend API**: Node.js + Express (ES Modules).
- **Backend Testing**: Vitest (Unit, Integration, Benchmarks, Smoke Tests).
- **Database**: MongoDB + Mongoose (real MongoDB integration for all authoritative suites).
- **Security & Cryptography**: Salted memory-hard `scrypt` hashing, JWT (HMAC SHA-256), crypto `timingSafeEqual`, Razorpay webhook HMAC SHA-256 verification.
- **AI Service**: Google Gemini API (`@google/genai`) strictly advisory; structured Zod validation, fallback generator, never directly mutates financial or case truth.

---

## 3. Financial & Operational Safety Invariants
1. **Integer Paise Representation**: All monetary values are strictly represented and calculated in integer paise ($1\text{ INR} = 100\text{ paise}$) using pure integer arithmetic (`Math.trunc`, safe addition/subtraction). Floating-point arithmetic is forbidden.
2. **Deterministic Priority**: Transaction matching, candidate pairing, anomaly categorization, and 30-scenario edge case classifications are 100% deterministic and pure. LLMs never classify or match transactions.
3. **Fail-Closed Policy Limits**: Monetary refund limits cannot ship defaulted or seeded. Limits exist only as two-person-approved per-tenant records (`approvedBy !== proposedBy`). If no policy configuration is active, automated refunds fail closed.
4. **Advisory AI Boundary**: All multi-agent investigation perspectives (Customer, Shop, Findings, Resolution) are marked `isExecutable: false`, `authoritative: false`, and labeled "Advisory only" in all user interfaces.
5. **Writes Disabled**: `RAZORPAY_SANDBOX_WRITES_ENABLED=false` is enforced; provider action execution is stubbed/mocked; no automated machine dispatch is triggered without human authorization.
6. **Token-Only Multi-Tenant Scoping**: All tenant context is derived strictly from verified JWT claims server-side. The client API layer strips all `x-tenant-id` headers and query parameters.
7. **Append-Only Auditing**: Every state mutation, webhook receipt, worker poll, policy evaluation, and human decision appends an immutable event to `AuditLog` or `PaymentLifecycleEvent`. No `UPDATE` or `DELETE` endpoints exist.

---

## 4. Payment State Machine (8 Dimensions)
The canonical state of any payment exception is tracked across 8 monotonic dimensions in `PaymentCase`:
1. `orderStatus`: `ORDER_NONE` -> `ORDER_CREATED` -> `ORDER_PAID` / `ORDER_CANCELLED`
2. `captureStatus`: `CAPTURE_NONE` -> `CAPTURE_PENDING` -> `CAPTURE_CAPTURED` / `CAPTURE_FAILED`
3. `authorizationStatus`: `AUTH_NONE` -> `AUTH_PENDING` -> `AUTH_AUTHORIZED` / `AUTH_FAILED`
4. `refundStatus`: `REFUND_NONE` -> `REFUND_PENDING` -> `REFUND_PROCESSED` / `REFUND_FAILED`
5. `disputeStatus`: `DISPUTE_NONE` -> `DISPUTE_OPEN` -> `DISPUTE_WON` / `DISPUTE_LOST`
6. `customerDebitStatus`: `DEBIT_NONE` -> `DEBIT_CLAIMED` -> `DEBIT_VERIFIED` / `DEBIT_REJECTED`
7. `resolutionCaseStatus`: `CASE_NONE` -> `CASE_DETECTED` -> `CASE_ACTION_IN_PROGRESS` -> `CASE_RESOLVED` / `CASE_SAFE_HOLD`
8. `discrepancyCategory`: Deterministic categorization (e.g. `STATUS_MISMATCH`, `AMOUNT_MISMATCH`, `CANCELLED_ORDER_CAPTURED`).

---

## 5. Classification Engine & Material-State Hash
- **30 Canonical Payment Scenarios**: Covering standard repairs, delayed settlements, duplicate payment attempts, partial payments, partial refunds, customer debit claims, and safe-hold categories.
- **Precedence Rule Engine**: 40 rule branches enforced by AST-level branch counting against `Function#toString`. Stability is asserted across all 36 unmergeable contradictory pairs.
- **52 Changed Merged Outcomes (Owner Decision ADR-14)**: The Stage 5B reorder changed 52 outcomes on merged inputs, all from not-held to held (100% fail-closed).
- **Material-State Record Hash (`recordHash`)**:
  - *Included*: Document IDs, statuses, amounts in paise, currencies, capture/refund/dispute/settlement states, linked IDs, and customer claims.
  - *Purged*: Mutable operational timestamps (`updatedAt`), revision markers (`__v`), background task counters (`pollCount`, `leaseExpiresAt`), audit streams, and telemetry metadata.
  - *Renewal Invariant*: If a provider status changes, the classification becomes stale, invalidating existing policy decisions. Renewal requires re-evaluation via `POST /api/payment-cases/:caseId/classify` (callable by `ADMIN` or `SERVICE`), which writes a fresh `EvidenceRecord`.

---

## 6. Read-Only Operator Workspace (Stage 6B)
- **Client Architecture**:
  - `client/src/api/casesApi.js`: Strictly GET functions exported; strips all `x-tenant-id` variations; implements bounded retry (max 2) for 503/network errors.
  - `client/src/components/common/RoleGuard.jsx`: Enforces access for `ADMIN`, `SHOP`, and `AUDITOR`; renders `"not available for your role"` for `CUSTOMER` and machine service accounts without initiating data fetchers.
  - `client/src/components/common/ExpandableText.jsx`: Pure text-only truncation/expansion (zero `dangerouslySetInnerHTML`). Hostile script tags render safely as inert string literals.
  - `client/src/utils/formatMoney.js`: Pure integer paise-to-INR math (`formatPaiseToInr`).
- **Workspace Pages**:
  - `CasesListPage.jsx`: Live API data badge, status filtering, safe-hold queue filter (`?safeHold=true`), pagination, and case age display.
  - `CaseDetailPage.jsx`: 8-dimension state grid, amount mismatch calculation, facts vs claims separation, unverified badges, staleness badge, lifecycle timeline, four advisory agent cards, policy decisions with `policyConfigVersion`, read-only provider operations, and Case 22 safe-hold banner (*"late capture on a cancelled order: held, no automatic refund or reopen"*).
- **Dev-Only Demo Seed**:
  - `server/scripts/seedWorkspaceDemo.js`: Refuses in production, requires localhost Mongo and database name containing `"test"` and not `"prod"`, requires `DEMO_SEED_PASSWORD`. Seeds Tenants A and B, multi-role users, Case 22, Case 6, Case 5, an investigation run, hostile claim text, and cross-tenant isolation cases. Zero limits seeded.

---

## 7. Current Test & Verification Footprint

| Test Harness | Scope | Files | Tests | Result |
| :--- | :--- | :---: | :---: | :---: |
| Server Unit Tests | Core services, classifiers, models, routes | 80 | 795 | **PASS (100%)** |
| Server Integration Tests | Real MongoDB multi-tenant, webhooks, monitoring | 14 | 156 | **PASS (100%)** |
| Synthetic Benchmark | Deterministic 120-scenario compatibility | 1 | 120 | **PASS (100.00%)** |
| Client Unit Tests | Cases API, RoleGuard, formatters, workspace pages | 5 | 26 | **PASS (100%)** |
| Production Smoke Test | Startup & provider-read isolation gates | 1 | 7 gates | **PASS (100%)** |
| Production Client Build | Vite SPA production bundle | - | 0 errors | **BUILT (17.51s)** |
| **Total Automated Tests** | | **100** | **977** | **ALL PASS** |
