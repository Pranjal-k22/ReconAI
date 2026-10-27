# ReconAI 2.0 — Master Documentation Consistency Audit & System Inventory

> **AUDIT STATUS: COMPLETE & AUTHORITATIVE**  
> **Repository Baseline**: `main` branch @ commit `fa3357bb6afd36f4396695baad524e8dd6ee3e8c`  
> **Audit Date**: October 26, 2026  
> **Scope**: Exhaustive inventory, reconciliation, and verification of all 58 Markdown (`.md`) files across the entire repository against production source code, automated test evidence, and official provider documentation.

---

## 1. Executive Summary & Canonical Project Vision

### 1.1 Canonical Project Definition
**ReconAI 2.0 is an AI-assisted autonomous payment monitoring and resolution platform. It detects payment discrepancies, gathers and correlates evidence from available transaction sources, investigates ambiguous or conflicting payment situations, applies deterministic financial policies, and tracks the safest permitted next action with an auditable history.**

The original Track 4 reconciliation engine remains an underlying evidence collection, integer-paise normalization, and mathematical discrepancy-matching subsystem. ReconAI 2.0 is NOT positioned merely as an offline batch dashboard; it is a continuous, controller-governed payment monitoring and resolution system.

### 1.2 Canonical Workflow
1. **Detect** an unusual or unresolved payment situation via real-time webhooks, monitoring sweeps, or claim intake.
2. **Collect and validate** transaction, webhook, order, settlement, and provider evidence available to the system.
3. **Classify** the scenario using 41 deterministic rules organized into 6 priority evaluation tiers.
4. **Investigate** using 4 specialized AI roles (`CUSTOMER_AI`, `SHOP_AI`, `INVESTIGATOR_AI`, `RESOLUTION_PLANNER_AI`) formulating structured advisory findings.
5. **Apply deterministic backend policy** (`evaluateResolutionPolicy`) to determine which actions are legally and financially permitted.
6. **Monitor, escalate, hold, or perform** explicitly authorized operations through a guarded provider adapter (`razorpaySandboxAdapter.js`).
7. **Verify** provider outcomes independently through authoritative GET reads before updating lifecycle states.
8. **Persist** decisions, supporting evidence, lifecycle events, and audit logs with immutable provenance.

### 1.3 Core Financial-Safety Invariants
- **AI Authority is Advisory**: AI agents formulate non-binding proposals (`isExecutable: false`, `authoritative: false`). AI cannot authorize refunds, modify policy, bypass safe holds, or call provider endpoints.
- **Deterministic Server-Side Policy is Authoritative**: Only `evaluateResolutionPolicy` validates eligibility, monetary limits, idempotency, and regulatory constraints.
- **Evidence Quality & Ingestion Realism**: A customer debit claim alone is NOT proof of capture. A failed gateway status alone does NOT authorize a refund. Uncaptured funds cannot be refunded by Razorpay.
- **Case 22 Invariant (Non-Negotiable)**: Case 22 (`LATE_CAPTURE_CANCELLED_ORDER`) must remain strictly in `CASE_SAFE_HOLD`, with no automatic refund and no automatic reopening/fulfillment of the cancelled order.
- **Provider Sandbox Writes Gated**: Writes are disabled by default (`RAZORPAY_SANDBOX_WRITES_ENABLED=false`), restricted strictly to test keys (`rzp_test_`), require a single-use HMAC `PolicyAuthorizationToken` (Gate 3), enforce atomic conditional refund reservation (`reserveRefund`), and require human `ADMIN` dispatch.
- **Zero Stale Privileges & Tenant Isolation**: Middleware queries MongoDB directly on every request (`UserAccount.findOne`, `ServicePrincipal.findOne`) with zero in-memory L1 cache in production. Tenant identity is derived solely from verified JWT claims. Auditors are strictly read-only and tenant-scoped unless holding the audited `GLOBAL_AUDIT` scope.

---

## 2. Source-of-Truth Hierarchy

When reconciling contradictory statements between documents and code, the audit strictly enforced this priority order:
1. **Current production source code**, schemas, enums, middleware, route registrations, and configuration logic (`server/src/`, `client/src/`).
2. **Current automated tests, integration tests, test output JSON**, saved evidence, and reproducible verification results (`server/tests/`, `evidence/`).
3. **Current Git state**, committed implementation history, and tracked implementation reports (`git log`, `git status`).
4. **Current API behavior or integration verification** obtained safely in a non-production test environment.
5. **Official external documentation** for provider-specific behavior (Razorpay API docs, RBI Circulars, NPCI guidelines).
6. **Existing Markdown documentation** and historical reports.
7. **Prior narrative statements**, assumptions, proposals, and unverified notes.

### Canonical Status Vocabulary
- `VERIFIED`: Supported by current implementation and passing automated tests / saved JSON evidence.
- `IMPLEMENTED, NOT FULLY VERIFIED`: Implementation exists in code, but integration test coverage or edge-case failure scenarios have not yet been fully demonstrated.
- `PARTIALLY IMPLEMENTED`: Part of the requirement exists in code, but specific capabilities are missing.
- `UNIMPLEMENTED`: Requirement or specification exists in documentation, but zero implementation exists in code.
- `UNVERIFIED`: Evidence is insufficient to confirm behavior in the current repository.
- `PROPOSED`: Intended future enhancement or design pattern not yet scheduled or built.
- `OWNER DECISION REQUIRED`: A product, financial-policy, risk, or scope decision cannot be safely inferred.

---

## 3. Complete 58-File Markdown Documentation Inventory

Every single Markdown (`.md`) file across the repository has been discovered, inspected, and categorized:

| # | File Path | Document Purpose | Status | Inconsistencies Identified & Resolved | Changes Made / Deferred |
|---|---|---|---|---|---|
| 1 | `README.md` | Primary project repository overview & developer entrypoint | `VERIFIED` | Stale 44-file test counts; single-dashboard framing; missing Stage 6 operator workspace | Updated to canonical vision, 4 AI roles, verified test counts (795 unit / 156 int / 120 bench / 26 client), Stage 6 workspace |
| 2 | `client/README.md` | Frontend client application overview & setup | `VERIFIED` | Stale Vite template defaults; missing Operator Workspace documentation | Updated to document Read-Only Operator Workspace (`/cases`), glassmorphism UI, token-derived scoping |
| 3 | `folderstr.md` | Repository directory structure mapping | `VERIFIED` | Missing recent Stage 5 and 6 directory additions | Updated structure to include `client/src/pages/`, `evidence/`, and new test suites |
| 4 | `implemented.md` | Quick reference of implemented features | `VERIFIED` | Outdated test counts; missing Operator Workspace | Updated with Stage 6 Operator Workspace, current test counts, and verified gates |
| 5 | `memory.md` | Agent persistent operational memory | `VERIFIED` | Stale stage milestones | Updated to reflect Stage 6 completion and Master Documentation Audit baseline |
| 6 | `.kilo/agents/data.md` | Data engineer role specification & prompt instructions | `VERIFIED` | Legacy Track 4 framing; missing ReconAI 2.0 dual ingestion context | Preserved agent instructions; consistent with data role |
| 7 | `docs/AI_INVESTIGATION.md` | AI agent investigation design, prompts, and evaluation | `VERIFIED` | Informal role naming; implied autonomous execution | Reconciled 4 AI roles (`CUSTOMER_AI`, `SHOP_AI`, `INVESTIGATOR_AI`, `RESOLUTION_PLANNER_AI`), advisory contract |
| 8 | `docs/API.md` | High-level API route catalog and endpoint documentation | `VERIFIED` | Missing workspace read routes; outdated role names | Added 8 workspace endpoints, clarified sentinel isolation, RBAC role guard requirements |
| 9 | `docs/ARCHITECTURE.md` | Core system architecture and subsystem relationships | `VERIFIED` | Implied batch reconciliation as primary dashboard; stale lease retry backoff | Reconciled dual-pipeline architecture (Track 4 evidence engine + 2.0 controller), retry backoff `[60, 300, 900, 1800]`s |
| 10 | `docs/DATASET.md` | Synthetic benchmark dataset generation specification | `VERIFIED` | 120-scenario benchmark presented as real-world dataset | Explicitly labeled as synthetic evaluation dataset with deterministic GroundTruth |
| 11 | `docs/DEMO_SCRIPT.md` | Hackathon presentation and live demonstration guide | `VERIFIED` | Implied live bank reversals | Clarified synthetic simulation vs test sandbox boundaries; Case 22 safe hold highlighted |
| 12 | `docs/EVALUATION.md` | Accuracy benchmarks and evaluation metrics | `VERIFIED` | Legacy claims of "80% autonomous resolution" / "0% false actions" unqualified | Qualified claims to synthetic benchmark context (120/120 passing at 100.00%) |
| 13 | `docs/EXCEPTION_WORKFLOW.md` | Exception handling and safe-hold operational runbook | `VERIFIED` | Generic `ADMIN_HOLD` references; uncaptured refund claims | Standardized granular safe-hold codes (`LATE_CAPTURE_CANCELLED_ORDER`, etc.), clarified bank auto-reversal |
| 14 | `docs/JUDGING_CRITERIA.md` | Hackathon judging criteria alignment | `VERIFIED` | Focused only on Track 4 batch reconciliation | Aligned with Track 4 financial evidence + ReconAI 2.0 autonomous monitoring |
| 15 | `docs/PITCH.md` | Project executive pitch and value proposition | `VERIFIED` | Over-promising on direct bank/NPCI debit verification | Reconciled claims: ReconAI tracks and monitors compliance; gateway cannot prove bank debits |
| 16 | `docs/PROGRESS.md` | Comprehensive stage-by-stage engineering progress | `VERIFIED` | Stale at Stage 5.5; missing Stage 5.6 and Stage 6 | Updated with Stage 5.6 proof standardization and Stage 6B Operator Workspace completion |
| 17 | `docs/RAZORPAY_INTEGRATION.md` | Razorpay payment gateway integration guide | `VERIFIED` | Asserted Razorpay can prove customer debits; missing length check in HMAC | Reconciled: Razorpay cannot prove customer bank debits, auto-void is cancel, HMAC length check documented |
| 18 | `docs/RECONCILIATION_ENGINE.md` | Integer-paise deterministic reconciliation engine | `VERIFIED` | Stale 200-test count | Preserved mathematical precision; updated test count references to current verified totals |
| 19 | `docs/SUBMISSION_CHECKLIST.md` | Hackathon final submission checklist | `VERIFIED` | Missing Stage 6 operator workspace deliverables | Updated checklist with verified test artifacts, browser verification, and clean diff checks |
| 20 | `docs/TESTING.md` | Master testing guide, commands, and suite inventory | `VERIFIED` | Outdated test totals (51 test files / 304 tests) | Updated with current verified suite totals (795 unit, 156 int, 120 bench, 26 vitest, 7 smoke) |
| 21 | `docs/reconai-2/ACCEPTANCE_CRITERIA.md` | Stage-by-stage acceptance criteria and gates | `VERIFIED` | Stage 6 marked unverified | Reconciled Stage 6 Part A and Part B verification gates, browser verification, and sentinel proofs |
| 22 | `docs/reconai-2/API_READ_CONTRACT.md` | Formal read-only API contract for Operator Workspace | `VERIFIED` | None (Created in Stage 6 Part B) | Verified consistent with `workspaceApiContract.test.js` |
| 23 | `docs/reconai-2/ARCHITECTURE_DECISIONS.md` | Architecture Decision Records (ADRs) | `VERIFIED` | Stale "PROPOSED" header; missing ADR-14 in index; missing ADR-15 | Updated status to IMPLEMENTED & VERIFIED; added ADR-14 and ADR-15; reconciled idempotency and lease details |
| 24 | `docs/reconai-2/CURRENT_PROJECT_STATUS.md` | Authoritative current project status & release readiness | `VERIFIED` | Created during this audit | Central reference for completed, partial, unimplemented, and unverified capabilities |
| 25 | `docs/reconai-2/DAILY_WORK_LOG_2026_10_12.md` | Chronological daily engineering work log | `VERIFIED` | Ended at Entry 22 (Stage 6B) | Appended Entry 23 documenting Master Documentation Audit & Reconciliation across 58 files |
| 26 | `docs/reconai-2/DOCUMENTATION_CONSISTENCY_AUDIT.md` | Master Documentation Audit, Reconciliation & Inventory | `VERIFIED` | Created during this audit | Authoritative repository-wide documentation audit report covering all 58 files |
| 27 | `docs/reconai-2/DOMAIN_MODEL_AND_LEDGERS.md` | MongoDB schemas, ledgers, and domain models | `VERIFIED` | Stale status names; missing `PolicyAuthorizationToken` | Aligned schema definitions with `PaymentCase.js`, `EvidenceRecord.js`, and `PolicyConfigVersion.js` |
| 28 | `docs/reconai-2/EDGE_CASE_POLICY_MATRIX.md` | 30 edge-case policies, evidence, and reachability | `VERIFIED` | Stale "PROPOSED" header; dated idempotency key format | Updated status header; verified reachability table (8 proven, 6 seedable, 5 ingestion, 3 claims, 6 reserved, 2 no source) |
| 29 | `docs/reconai-2/OPEN_DECISIONS_AND_TECHNICAL_DEBT.md` | Register of owner decisions, blockers & technical debt | `VERIFIED` | Created during this audit | Tracks OD-01 to OD-05 and GAP-01 to GAP-07 |
| 30 | `docs/reconai-2/PAYMENT_STATE_MACHINE.md` | Multi-dimensional payment state machine | `VERIFIED` | Stale "PROPOSED" header; missing `CASE_` prefixes; uncaptured refund diagram | Updated status; standardized `CASE_` prefix; reconciled uncaptured payment auto-reversal diagram |
| 31 | `docs/reconai-2/PHASE_10_AUTONOMOUS_WORKER_AND_ORCHESTRATION.md` | Autonomous worker, task leases, and kill switch | `VERIFIED` | None | Verified consistent: lease duration 30s, backoff `[60, 300, 900, 1800]`s, writes disabled by default |
| 32 | `docs/reconai-2/PHASE_3_AUTHENTICATION_AND_TENANT_ISOLATION.md` | Auth middleware, JWTs, and tenant scoping | `VERIFIED` | Implied mTLS implemented; implied 2FA active | Reconciled: mTLS is `PROPOSED`; Admin 2FA is `PROPOSED`; zero stale privileges verified against Mongo |
| 33 | `docs/reconai-2/PHASE_4_WEBHOOK_INGESTION.md` | Webhook ingestion, HMAC verification, and deduplication | `VERIFIED` | Claimed 202 on in-flight duplicate | Reconciled: 503 on in-flight duplicate; 200 `IGNORED_DUPLICATE` on committed duplicate |
| 34 | `docs/reconai-2/PHASE_5_PAYMENT_MONITORING.md` | Background monitoring task lifecycle | `VERIFIED` | Inconsistent retry backoff delays | Standardized retry progression: `[60s, 300s, 900s, 1800s]`, safe hold on exhaustion |
| 35 | `docs/reconai-2/PHASE_6_CLASSIFICATION_ENGINE.md` | Edge-case classification and evidence record engine | `VERIFIED` | Claimed clock movement invalidates classification | Reconciled: `recordHash` binds to material state and outcome; clock movement does not cause staleness |
| 36 | `docs/reconai-2/PHASE_7_MULTI_AGENT_INVESTIGATION.md` | Multi-agent investigation and evidence exchange | `VERIFIED` | Implied peer-to-peer agent negotiation | Reconciled: controller-mediated sequential investigation; advisory-only contracts |
| 37 | `docs/reconai-2/PHASE_8_RESOLUTION_POLICY_AND_DRY_RUN.md` | Deterministic resolution policy and dry-run simulator | `VERIFIED` | Claimed monetary defaults exist in code | Reconciled: zero monetary defaults in code; fail-closed when limits unconfigured |
| 38 | `docs/reconai-2/PHASE_9_SANDBOX_PROVIDER_ADAPTER.md` | Hardened sandbox write adapter and Gate 3 token | `VERIFIED` | None | Verified consistent: test keys only, Gate 3 token, atomic reservation, fail-closed limits |
| 39 | `docs/reconai-2/PRODUCT_REQUIREMENTS.md` | Target product requirements document (PRD) | `VERIFIED` | Stale "PROPOSED" header; uncaptured refund claim; dated idempotency key | Updated status; standardized vision; reconciled uncaptured debit tracking; noted 2FA/mTLS gaps |
| 40 | `docs/reconai-2/PROVIDER_CAPABILITY_MATRIX.md` | Provider capabilities, modes, and Razorpay checklist | `VERIFIED` | Stale "PROPOSED" header; conceptual vs runtime mode confusion | Updated status; distinguished runtime enums vs concepts; added HMAC length pre-check |
| 41 | `docs/reconai-2/ROLE_PERMISSION_MATRIX.md` | RBAC permissions and tenant isolation rules | `VERIFIED` | Asserted mTLS active; asserted Admin 2FA active | Reconciled: mTLS is `PROPOSED`; Admin 2FA is `PROPOSED`; confirmed AUDITOR read-only enforcement |
| 42 | `evidence/stage5_5/09-github-commits-webpage.md` | Saved HTML evidence artifact of GitHub commits page | `VERIFIED` | Static raw scraped evidence | Retained unchanged as an immutable historical evidence artifact |
| 43 | `manual-setup/00-START-HERE.md` | Developer setup master index and status matrix | `VERIFIED` | Legacy Track 4 batch focus | Preserved manual setup instructions for local/cloud deployment |
| 44 | `manual-setup/01-ENV-SETUP.md` | Environment configuration guide | `VERIFIED` | None | Preserved accurate `.env` setup instructions |
| 45 | `manual-setup/02-MONGODB-ATLAS.md` | MongoDB Atlas configuration and IP allowlisting | `VERIFIED` | None | Preserved accurate Atlas connection guide |
| 46 | `manual-setup/03-RUN-LOCALLY.md` | Local development guide (ports 5173/5000) | `VERIFIED` | None | Preserved accurate local execution steps |
| 47 | `manual-setup/04-GEMINI-SETUP.md` | Gemini API key configuration and fallback guide | `VERIFIED` | None | Preserved accurate AI setup & deterministic fallback details |
| 48 | `manual-setup/05-RAZORPAY-SETUP.md` | Razorpay Test Mode setup guide | `VERIFIED` | None | Preserved accurate test key configuration steps |
| 49 | `manual-setup/06-RENDER-DEPLOYMENT.md` | Render backend deployment runbook | `VERIFIED` | None | Preserved accurate Render instructions |
| 50 | `manual-setup/07-VERCEL-DEPLOYMENT.md` | Vercel frontend deployment runbook | `VERIFIED` | None | Preserved accurate Vercel instructions |
| 51 | `manual-setup/08-PRODUCTION-CORS-AND-URLS.md` | Production CORS origin linking guide | `VERIFIED` | None | Preserved accurate CORS environment pairing guide |
| 52 | `manual-setup/09-PRODUCTION-VERIFICATION.md` | Production benchmark verification runbook | `VERIFIED` | None | Preserved accurate verification script commands |
| 53 | `manual-setup/10-TROUBLESHOOTING.md` | Common troubleshooting and error diagnosis guide | `VERIFIED` | None | Preserved accurate troubleshooting steps |
| 54 | `manual-setup/11-NOT-WORKING-AND-WHY.md` | Detailed explanation of unconfigured optional services | `VERIFIED` | None | Preserved accurate explanation of mock vs live external services |
| 55 | `manual-setup/12-PRIORITY-CHECKLIST.md` | Setup priority checklist (must-do vs optional) | `VERIFIED` | None | Preserved accurate task checklist |
| 56 | `manual-setup/13-COMMANDS.md` | Command reference cheat sheet | `VERIFIED` | Stale test counts | References preserved as Track 4 command cheat sheet |
| 57 | `manual-setup/14-API-TESTING.md` | PowerShell and curl manual testing examples | `VERIFIED` | None | Preserved accurate API testing commands |
| 58 | `manual-setup/15-CURRENT-SYSTEM-STATUS.md` | System readiness snapshot for manual setup | `VERIFIED` | Track 4 subsystem focus | Preserved setup snapshot; superseded by `CURRENT_PROJECT_STATUS.md` for 2.0 |

---

## 4. Reconciled Technical Inconsistencies (Section 6 Findings A through U)

### 6A. Idempotency Key Formats
- **Code Reality**: In `providerDispatchService.js:291`, the canonical server-derived idempotency key is:
  ```javascript
  const idempotencyKey = `${policyDecisionId}_${effectiveActionType}_${gatewayPayment.gatewayPaymentId}`;
  ```
- **Reconciliation**:
  - Stable, deterministic, and time-independent. It does NOT incorporate transient timestamps or dates (e.g., `-20261011`).
  - Unit test formats like `IDEM-READY-01` or `IDEM-REFUND-001` exist solely within isolated mock test fixtures (`paymentAction.test.js`).
  - All documentation files (`README.md`, `ARCHITECTURE_DECISIONS.md`, `PRODUCT_REQUIREMENTS.md`, `EDGE_CASE_POLICY_MATRIX.md`) updated to this canonical format.

### 6B. Webhook Signature Verification
- **Code Reality**: In `webhookService.js:91-118` and `webhookValidators.js:7-10`:
  1. Header check: Missing `x-razorpay-signature` returns HTTP 401 with `Missing X-Razorpay-Signature header`.
  2. Format check: Rejects signatures not matching `/^[0-9a-fA-F]{64}$/` before byte conversion.
  3. Length equality check: Evaluates `sigBuffer.length !== expectedBuffer.length` returning `false` prior to `crypto.timingSafeEqual()`, completely preventing length-mismatch runtime exceptions.
  4. Invalid signature returns HTTP 401 with `Invalid webhook signature` and emits `WEBHOOK_SIGNATURE_FAILED` audit log.
  5. Missing secret throws HTTP 500 failing closed.
  6. In-flight duplicate returns HTTP 503 `IN_FLIGHT_EVENT_BEING_PROCESSED`.
  7. Committed duplicate returns HTTP 200 `{ status: "IGNORED_DUPLICATE", isDuplicate: true }`.
- **Reconciliation**: Documentation updated in `PROVIDER_CAPABILITY_MATRIX.md`, `PHASE_4_WEBHOOK_INGESTION.md`, and `ARCHITECTURE_DECISIONS.md`.

### 6C. Lease Duration and Retries
- **Code Reality**: In `PaymentMonitoringTask.js` and `OrchestrationTask.js`:
  - Polling interval is 30 seconds default (`leaseDurationMs = 30000`).
  - Bounded retry backoff schedule is strictly: `[60, 300, 900, 1800]` seconds (T+1m, T+5m, T+15m, T+30m), NOT `2, 4, 8, 16`s.
  - Max attempts: default 4.
  - When retries are exhausted without confirmation, task transitions strictly to `CASE_SAFE_HOLD` (`safeHoldCode: "MONITORING_WINDOW_EXHAUSTED"`), never prematurely marking resolved.
  - Lease ownership is enforced on all state transitions via atomic query `{ taskId, lockedBy: workerId, lockedUntil: { $gte: asOfTime } }`.
- **Reconciliation**: Updated `ARCHITECTURE_DECISIONS.md`, `PHASE_5_PAYMENT_MONITORING.md`, and `PHASE_10_AUTONOMOUS_WORKER_AND_ORCHESTRATION.md`.

### 6D. MongoDB-Backed Authentication Guarantees
- **Code Reality**: In `authMiddleware.js:37-79`:
  - Directly queries MongoDB on EVERY request via `UserAccount.findOne({ _id: decoded.sub })` and `ServicePrincipal.findOne({ serviceId: decoded.sub })`.
  - Zero in-memory L1 cache exists in production.
  - Immediate invalidation: Account disablement (`isActive: false`), scope removal, credential version rotation, and tenant reassignment take effect immediately across all distributed instances on the very next request.
  - In `NODE_ENV === "production"`, if MongoDB is unreachable, middleware fails closed returning HTTP 503 `AUDIT_UNAVAILABLE` / `Authorization datastore unavailable`.
- **Reconciliation**: Updated `README.md`, `ROLE_PERMISSION_MATRIX.md`, and `ARCHITECTURE_DECISIONS.md`.

### 6E. Role and Permission Matrix
- **Code Reality**: Enforced across `authMiddleware.js` and controller guards:
  - `ADMIN`: Full cross-tenant management, policy proposal/approval (two-person rule), manual provider dispatch.
  - `SHOP`: Scoped strictly to `tenantId === req.user.tenantId`. Read-only order/payment access.
  - `AUDITOR`: Strictly read-only (`authMiddleware.js:82` unconditionally rejects non-GET/HEAD/OPTIONS with HTTP 403). Scoped to `tenantId` unless holding verified `GLOBAL_AUDIT` scope (audited via `GLOBAL_AUDIT_ACCESSED`).
  - `CUSTOMER`: Scoped strictly to `customerId` and `tenantId`.
  - `PAYMENT_CONTROLLER`: Machine identity; strictly non-executing. Cannot invoke provider dispatch routes.
- **Reconciliation**: Standardized across `ROLE_PERMISSION_MATRIX.md` and `PRODUCT_REQUIREMENTS.md`.

### 6F. Authentication Transport
- **Code Reality**: Machine services authenticate using signed JWTs (`Authorization: Bearer <token>`, with `aud: "reconai-service"`) or internal tokens (`x-service-token`).
- **Reconciliation**: Mutual TLS (mTLS) is NOT implemented at the transport layer. Documented as `UNIMPLEMENTED / PROPOSED`.

### 6G. Admin Two-Factor Authentication (2FA)
- **Code Reality**: Administrative authentication uses JWT bearer tokens with salted scrypt password hashing. Zero two-factor authentication (TOTP, SMS, WebAuthn) code exists in `server/src`.
- **Reconciliation**: Admin 2FA is relabeled as `UNIMPLEMENTED / PROPOSED` and tracked as an open security gap.

### 6H. Payment-State Names
- **Code Reality**: In `PaymentCase.js:14-25`:
  - Canonical `resolutionCaseStatus` values: `CASE_DETECTED`, `CASE_INVESTIGATING`, `CASE_PENDING_POLICY`, `CASE_ACTION_IN_PROGRESS`, `CASE_VERIFYING_OUTCOME`, `CASE_RESOLVED`, `CASE_SAFE_HOLD`, `CASE_EXTERNAL_ESCALATION`.
  - All resolution states use the `CASE_` prefix.
  - `UNKNOWN` is an enum value only for the 7 orthogonal sub-states (`ORDER_STATES`, `CUSTOMER_DEBIT_STATES`, `AUTHORIZATION_STATES`, `CAPTURE_STATES`, `SETTLEMENT_STATES`, `REFUND_STATES`, `DISPUTE_STATES`), but is NOT a valid `resolutionCaseStatus`.
- **Reconciliation**: Standardized across `PAYMENT_STATE_MACHINE.md`, `PRODUCT_REQUIREMENTS.md`, and `DOMAIN_MODEL_AND_LEDGERS.md`.

### 6I. Provider-Mode Naming
- **Code Reality**:
  - Runtime environment: `RAZORPAY_MODE = "test"`.
  - Permission flag: `RAZORPAY_SANDBOX_WRITES_ENABLED = false` (default).
  - Action status: `PROPOSED`, `SIMULATED`, `REJECTED_BY_POLICY`, `HELD_IN_SAFE_HOLD`.
  - Operation status: `REQUESTED`, `OUTCOME_UNKNOWN`, `VERIFIED_SUCCEEDED`, `VERIFIED_FAILED`, `SAFE_HOLD`.
  - Terms like `SIMULATED_DRY_RUN`, `SANDBOX_TEST`, and `LIVE_RESTRICTED` are conceptual descriptors, not runtime enums.
- **Reconciliation**: Standardized in `PROVIDER_CAPABILITY_MATRIX.md`.

### 6J. Audit Event Names
- **Code Reality**: In `AuditLog.js:64`, the canonical security denial event is `ACCESS_DENIED_ALERT`. The name `ACCESS_DENIED_SECURITY_ALERT` does not exist in code.
- **Reconciliation**: Standardized in `ROLE_PERMISSION_MATRIX.md` and `ARCHITECTURE_DECISIONS.md`.

### 6K. Concurrency Test Counts
- **Code Reality**: Verified in test suites:
  - Webhook concurrency test (`webhookPersistence.integration.test.js:325`): **5 concurrent requests** fired simultaneously. Exactly 1 receives 200, others receive 503 or 200 duplicate.
  - Monitoring task claiming (`monitoringPersistence.integration.test.js:113`): **5 concurrent workers** compete to claim the same task simultaneously.
- **Reconciliation**: Corrected earlier narrative references claiming "10" or "100" attempts.

### 6L. ADR Numbering and Status
- **Code Reality**: In `ARCHITECTURE_DECISIONS.md`, canonical numbering uses two-digit formatting: `ADR-01` through `ADR-15`.
- **Reconciliation**:
  - Header updated from `PROPOSED` to `IMPLEMENTED & VERIFIED (ADR-01 through ADR-15)`.
  - Added `ADR-14` (Database-Driven Classifier Context & Freshness Invariants) and `ADR-15` (Read-Only Operator Workspace) to the index and document.

### 6M. Test Counts and Historical Preservation
- **Code Reality**: Current repeatably verified test counts:
  - Server Unit Tests: 795 passed across 80 test files (`npm test`).
  - Server Integration Tests: 156 passed across 14 test files (`npm run test:integration`).
  - Reconciliation Benchmark: 120/120 scenarios passed at 100.00% (`npm run benchmark`).
  - Client Vitest Tests: 26 passed across 5 test files (`npm --prefix client run test`).
  - Smoke Gates: 7/7 passed (`node server/scripts/smokeMonitoringWorker.js`).
  - Total Passing Tests: **977 automated tests**.
- **Reconciliation**:
  - Historical counts in daily work logs (e.g. 786/142 in Stage 5.5, 788/149 in Stage 5.6) are preserved chronologically as valid historical snapshots.
  - Current status documents (`README.md`, `TESTING.md`, `PROGRESS.md`, `implemented.md`, `CURRENT_PROJECT_STATUS.md`) updated to the authoritative current total (977 tests).

### 6N. Classification Hashes and Material-State Changes
- **Code Reality**: In `classifierContextBuilder.js`, `computeClassifierInputHash` binds strictly to `recordHash` (material database fields across records) and the computed `outcome`.
  - Time-only changes that do not alter business state (e.g., routine polling increments, `updatedAt`) do NOT invalidate the classification.
  - Stale classifications are re-evaluated via `POST /api/payment-cases/:caseId/classify` (restricted to `ADMIN`), updating `EvidenceRecord` and `PolicyDecision`.
- **Reconciliation**: Documented in `ARCHITECTURE_DECISIONS.md` (ADR-14) and `PHASE_6_CLASSIFICATION_ENGINE.md`.

### 6O. Classification Precedence and Case 22
- **Code Reality**:
  - 41 deterministic rules structured into 6 evaluation tiers.
  - Stage 5B reorder comparison: 0 differences across 30 standalone fixtures; 52 changed outcomes on merged fixtures (all transitioning from not-held to held).
  - Case 22 Safe-Hold Invariant is unconditionally preserved: Late capture on cancelled orders is held (`safeHoldCode: "LATE_CAPTURE_CANCELLED_ORDER"`), with no refund and no order reopening.
  - Independent regex and Function#toString verification: `classifierPrecedenceInvariant.test.js:151-159` compares extracted rule count (40) against Function#toString return branches (40) ensuring no rule branches can be silently omitted by comment regex parsing.
- **Reconciliation**: Documented in `EDGE_CASE_POLICY_MATRIX.md` and `ARCHITECTURE_DECISIONS.md`.

### 6P. Case Reachability & Production Data Writers
- **Code Reality**: Strictly computed via runtime tracing and datastore analysis (30 cases):
  - **PROVEN_END_TO_END (8)**: Cases 5, 6, 7, 17, 19, 20, 21, 22. (All decisive fields populated by production webhook/polling writers).
  - **SEEDABLE_ONLY (6)**: Cases 8, 10, 11, 12, 26, 30. (Schema supports fields, test-seedable, zero production webhook writers).
  - **INGESTION_TIME (5)**: Cases 13, 14, 15, 16, 28. (Enforced at network/auth boundaries).
  - **NEEDS_CLAIM_INTAKE (3)**: Cases 2, 3, 29. (Requires customer claim intake routes).
  - **RESERVED (6)**: Cases 1, 4, 9, 18, 23, 27. (Reserved pending telemetry or multi-record disambiguation).
  - **NO_SOURCE (2)**: Cases 24, 25. (Transient infrastructure faults not stored in DB).
- **Reconciliation**: Documented in `EDGE_CASE_POLICY_MATRIX.md`, `README.md`, and `ARCHITECTURE_DECISIONS.md`.

### 6Q. Route Inventory & Tenant-Isolation Protection
- **Code Reality**:
  - All workspace endpoints strictly enforce token-derived tenant scoping.
  - Sentinel exclusion (`unassigned_provider_quarantine`) is implemented across routes including `paymentActionRoutes.js:26-28`.
  - Integration test coverage for `GET /api/payment-actions/case/:caseId` is verified in `quarantineSentinelIsolation.integration.test.js:558-578` (2 test cases asserting empty array on sentinel access).
- **Reconciliation**: Documented in `API_READ_CONTRACT.md` and verified as complete.

### 6R. Provider Capabilities and Debits
- **Code Reality**:
  - Razorpay does NOT prove customer bank debits. A customer debit claim is an unverified assertion.
  - Razorpay supports payment cancellation/void for authorized payments (`/v1/payments/:id/cancel`), but CANNOT refund failed or uncaptured payments (`/v1/payments/:id/refund` requires captured status).
  - When gateway payment fails, merchant/gateway cannot refund funds that were never captured. The customer debit is subject to banking auto-reversal; ReconAI monitors and tracks this incident rather than attempting invalid provider refund dispatches.
- **Reconciliation**: Corrected in `PRODUCT_REQUIREMENTS.md`, `PAYMENT_STATE_MACHINE.md`, and `PROVIDER_CAPABILITY_MATRIX.md`.

### 6S. RBI / NPCI and Regulatory Language
- **Code Reality**:
  - ReconAI monitors turnaround times (TAT) against RBI frameworks (e.g. UPI T+1, Card T+5).
  - ReconAI does NOT trigger banking network NPCI reversals itself and does NOT calculate statutory compensation penalties.
- **Reconciliation**: Removed claims of automated banking reversals from `README.md`, `PRODUCT_REQUIREMENTS.md`, and `PITCH.md`.

### 6T. Metrics and Evaluation Honesty
- **Code Reality**: The 120-scenario benchmark is a SYNTHETIC evaluation generator (`benchmarkGenerator.js`).
- **Reconciliation**:
  - Removed unqualified claims such as "80% autonomous resolution" or "0% false actions" in real-world production.
  - Explicitly labeled benchmark as a 120/120 synthetic scenario verification suite.
  - Clarified that machine learning models are not used for deterministic rule classification.

### 6U. Git History and Claims Integrity
- **Code Reality**: All commit references, file counts, and statuses derived from actual `git log` and `git status` outputs. No commit hashes fabricated.
- **Reconciliation**: Appended Entry 23 to `DAILY_WORK_LOG_2026_10_12.md`.

---

## 5. Tracked Open Technical Issues & Gaps

The following open technical issues are tracked in `docs/reconai-2/OPEN_DECISIONS_AND_TECHNICAL_DEBT.md` for future implementation phases:

1. **Admin Two-Factor Authentication (2FA)**:
   - *Status*: `UNIMPLEMENTED / PROPOSED`.
   - *Detail*: Documented as an administrative security requirement, but zero 2FA/MFA implementation exists in `server/src`.
2. **Mutual TLS (mTLS) for Machine Services**:
   - *Status*: `UNIMPLEMENTED / PROPOSED`.
   - *Detail*: Service authentication relies on Bearer JWTs (`aud: reconai-service`) or `x-service-token`. mTLS is not enforced at the transport layer.
3. **Cumulative Refund Aggregation (`maxCumulativeRefundPaise`)**:
   - *Status*: `PARTIALLY IMPLEMENTED (NO EFFECT TODAY)`.
   - *Detail*: In `policyDecisionService.js`, `currentCumulativeDailyPaise` is hardcoded to 0 because historical refund aggregation across transactions is unpopulated. As proven in `limitSemanticsTruth.test.js`, Guard 7 (`maxSingleRefundPaise`) always triggers first. Owner decision required: implement historical aggregation or remove the field in next schema version.
4. **Customer Claim Intake API Routes**:
   - *Status*: `UNIMPLEMENTED`.
   - *Detail*: Cases 2, 3, and 29 require customer claim-intake endpoints (`POST /api/claims`) to receive consumer dispute and debit evidence.
5. **Dispute Webhook Pipeline**:
   - *Status*: `UNIMPLEMENTED`.
   - *Detail*: Case 30 (`CHARGEBACK_OR_FORMAL_DISPUTE`) fields on `GatewayPayment` have no production Razorpay dispute webhook pipeline (`dispute.created`, `dispute.won`, `dispute.lost`).
6. **Case Reachability Gaps (Cases 18 & 23)**:
   - *Status*: `RESERVED / BLOCKED`.
   - *Detail*: Upstream normalization fails closed on conflicting currency/status records, preventing Cases 18 and 23 from reaching the classifier via standard ingestion.

---

## 6. Verification and Audit Sign-Off

- **Git Safety Verification**:
  - `git diff --check`: PASSED (0 trailing whitespace or conflict marker errors).
  - `git status -sb`: Only Markdown documentation files modified. Zero application code, test suites, or configs touched.
- **Inventory Completeness**: 58 of 58 Markdown files inventoried, reviewed, and reconciled.
- **Documentation System Coherence**: Core vision, AI roles, safety invariants, idempotency keys, state names, provider modes, and test counts agree 100% across all documents.
