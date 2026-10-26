# ReconAI 2.0 — Architecture Decision Records (ADRs)

> **DOCUMENT STATUS: PROPOSED — AWAITING OWNER REVIEW**  
> *This document details the core architectural decisions, design tradeoffs, and technical patterns for ReconAI 2.0. No application code has been modified.*

---

## Index of Architectural Decisions

- [ADR-01: Preservation of Track 4 Deterministic Reconciliation Subsystem](#adr-01-preservation-of-track-4-deterministic-reconciliation-subsystem)
- [ADR-02: Policy-Enforced Autonomous Execution Boundary](#adr-02-policy-enforced-autonomous-execution-boundary)
- [ADR-03: Multi-Agent Scoped Evidence Exchange Architecture](#adr-03-multi-agent-scoped-evidence-exchange-architecture)
- [ADR-04: Multi-Tenant Data Isolation and Schema Hardening](#adr-04-multi-tenant-data-isolation-and-schema-hardening)
- [ADR-05: Unified Role-Based Access Control (RBAC) Architecture](#adr-05-unified-role-based-access-control-rbac-architecture)
- [ADR-06: Dual-Adapter Payment Provider Isolation (Read vs Write)](#adr-06-dual-adapter-payment-provider-isolation-read-vs-write)
- [ADR-07: Cryptographic Webhook Ingestion Engine with HMAC-SHA256](#adr-07-cryptographic-webhook-ingestion-engine-with-hmac-sha256)
- [ADR-08: Financial Idempotency, Action Leases, and Concurrency Locks](#adr-08-financial-idempotency-action-leases-and-concurrency-locks)
- [ADR-09: Asynchronous Payment Monitoring Worker & Outbox Pipeline](#adr-09-asynchronous-payment-monitoring-worker--outbox-pipeline)
- [ADR-10: Centralized Append-Only Audit Trail for Multi-Agent Actions](#adr-10-centralized-append-only-audit-trail-for-multi-agent-actions)
- [ADR-11: Phase 3 Authentication, RBAC, and Row-Level Tenant Isolation Enforcement](#adr-11-phase-3-authentication-rbac-and-row-level-tenant-isolation-enforcement)
- [ADR-12: Phase 3 Security Correction — Auditor Scope, Identity Provenance, Service Binding, and Persistent Revocation](#adr-12-phase-3-security-correction--auditor-scope-identity-provenance-service-binding-and-persistent-revocation)
- [ADR-13: Governed Versioned Policy-Limits Configuration and Two-Person Approval Boundary](#adr-13-governed-versioned-policy-limits-configuration-and-two-person-approval-boundary)

---

## ADR-01: Preservation of Track 4 Deterministic Reconciliation Subsystem

### Context
ReconAI 1.0 established an integer-paise deterministic reconciliation engine across Merchant Orders, Gateway Payments, and Settlements. It includes a 120-scenario benchmark dataset generator, isolated GroundTruth validation, and an automated Finance Controller agent. With the expansion to ReconAI 2.0 (autonomous payment monitoring and resolution), we must decide how to integrate the existing codebase.

### Decision
**We will NOT discard or replace the existing deterministic reconciliation engine.**  
Instead, the deterministic engine is preserved in its entirety as the **Financial Evidence Subsystem** of ReconAI 2.0:
1. The 120-scenario synthetic benchmark generator (`benchmarkGenerator.js`) and GroundTruth evaluator (`evaluationService.js`) remain untouched to maintain compliance with Track 4 hackathon judging criteria.
2. The pure in-memory matching engine (`matchingEngine.js`) will continue to provide authoritative, mathematical discrepancy detection for batch records.
3. The new real-time Payment Controller will invoke the matching engine whenever multi-record correlation is required.

### Tradeoffs & Consequences
- **Positive**: Zero regression in verified benchmark accuracy (100.00% across 120 scenarios); preserves all 44 existing Vitest test files (200 passing tests); anchors AI reasoning in mathematically proven financial truth.
- **Negative**: The system maintains two ingestion pipelines: real-time event webhooks and batch CSV/synthetic imports.

---

## ADR-02: Policy-Enforced Autonomous Execution Boundary

### Context
Allowing an LLM (such as Gemini) to autonomously trigger financial disbursements, refunds, or credits based purely on text generation introduces unacceptable risks of financial loss, prompt injection exploits, and regulatory non-compliance. Conversely, requiring human manual clicks for every routine failed payment defeats the goal of an autonomous resolution controller.

### Decision
**We strictly enforce the principle: "AI Reasoner Proposes $\rightarrow$ Deterministic Policy Authorizes $\rightarrow$ Adapter Executes."**

```text
[Multi-Agent Reasoning] 
         ↓ Structured Proposal (Zod Validated)
[Server-Side Deterministic Resolution Policy Engine]
         ├── Verification 1: Payment ownership & tenant match
         ├── Verification 2: Authoritative provider state confirms failure/capture
         ├── Verification 3: Net monetary amount match (Integer Paise)
         ├── Verification 4: Idempotency check (No duplicate refund in progress or completed)
         ├── Verification 5: Statutory & Merchant Policy eligibility check (e.g. RBI TAT)
         └── Verification 6: Concurrency lease acquired
         ↓ PASS / FAIL
[Execution OR Safe-Hold Queue]
```

Under no circumstances will a natural-language LLM output directly invoke a payment-provider write API. A recommendation is rejected if any policy invariant fails.

### Tradeoffs & Consequences
- **Positive**: Eliminates financial hallucination risk; satisfies banking compliance standards; provides automated resolution for 100% policy-compliant cases while safely quarantining edge cases.
- **Negative**: Requires rigorous encoding of merchant and regulatory policy rules in deterministic TypeScript/JavaScript.

---

## ADR-03: Multi-Agent Scoped Evidence Exchange Architecture

### Context
A unified payment dispute involves disparate parties with divergent incentives and sensitive data: the customer, the merchant, and the gateway. Sharing full merchant profit margins or gateway API keys with a customer-facing agent, or sharing customer personal contact data with a merchant-facing agent, violates privacy laws (GDPR, DPDP Act) and security boundaries.

### Decision
We partition the reasoning layer into specialized, scoped agents communicating via versioned, validated JSON contracts:

1. **Customer AI Agent**: Scoped strictly to the authenticated customer's session. Receives customer payment claims and debit proofs. Masked merchant fulfillment status is shared, but internal fees and secrets are hidden.
2. **Shop AI Agent**: Scoped strictly to the authenticated merchant store. Verifies inventory and local order status. Customer PII (email, phone, card payload) is stripped.
3. **Payment Investigator Agent**: Receives normalized diagnostic tokens from Customer AI, Shop AI, Gateway Webhooks, and Settlements. Evaluates facts without possessing write permissions.
4. **Resolution Planner Agent**: Converts diagnostic findings into structured action recommendations adhering to strict enum allow-lists.

### Tradeoffs & Consequences
- **Positive**: Strict data minimization; prevents prompt injection propagation across tenant boundaries; clean separation of concerns.
- **Negative**: Introduces message serialization overhead and requires schema maintenance for agent-to-agent communication.

---

## ADR-04: Multi-Tenant Data Isolation and Schema Hardening

### Context
Phase 0 audit confirmed that existing Mongoose models (`MerchantOrder`, `GatewayPayment`, `SettlementRecord`, `ExceptionCase`) lack tenant identifiers (`merchantId`, `customerId`). All database queries in ReconAI 1.0 were global. To support a real-world platform where multiple merchants and customers interact securely, strict multi-tenancy is required.

### Decision
Every core domain model in ReconAI 2.0 will include mandatory tenant scoping fields:
- `MerchantOrder`: `tenantId` (Merchant Store ID), `customerId` (Customer Identity ID).
- `GatewayPayment`: `tenantId` (Merchant Store ID), `customerId` (Customer Identity ID, when linkable).
- `SettlementRecord`: `tenantId` (Merchant Store ID).
- `PaymentCase`: `tenantId` (Merchant Store ID), `customerId` (Customer Identity ID).
- Compound unique indexes will enforce uniqueness within a tenant: e.g., `{ tenantId: 1, merchantOrderId: 1 }`.
- All database queries within controller services must include `{ tenantId }` in the MongoDB query filter.

### Tradeoffs & Consequences
- **Positive**: Prevents cross-tenant data leaks; enables true SaaS multi-store deployment.
- **Negative**: Requires data model migration and updating of existing query helper functions in Phase 2.

---

## ADR-05: Unified Role-Based Access Control (RBAC) Architecture

### Context
ReconAI 1.0 contained zero authentication middleware. All endpoints were open. ReconAI 2.0 requires distinct roles with granular permissions for customers, merchants, internal admins, auditors, and autonomous AI agents.

### Decision
We establish 7 distinct architectural roles:
1. `CUSTOMER`: Authenticated retail shopper. Can view only their own cases and submit debit claims.
2. `SHOP`: Authenticated merchant operator. Can view only their own store's cases, orders, and settlements.
3. `ADMIN`: System-level finance administrator. Can inspect all cases, configure policy parameters, and act on safe-holds.
4. `AUDITOR`: Read-only compliance officer. Can inspect immutable audit trails and evaluation benchmarks.
5. `CUSTOMER_AI`: Internal service identity for customer advocacy. Can read customer-approved evidence only.
6. `SHOP_AI`: Internal service identity for merchant operations. Can read merchant order records only.
7. `PAYMENT_CONTROLLER`: Internal privileged service identity for executing policy-authorized actions.

JWT tokens with HMAC-SHA256 signatures will authenticate HTTP requests, and an `authorizeRole([...])` middleware will guard all API endpoints.

---

## ADR-06: Dual-Adapter Payment Provider Isolation & Hardened Sandbox Dispatch (Gate 3)

### Context
The existing `razorpayClient.js` is strictly read-only and explicitly protected by `validateTestModeSafety()`, which rejects live keys (`rzp_live_`). We must support write actions (specifically refunds in test mode) without compromising the read-only guarantees of the existing ingestion pipeline or introducing financial race conditions.

### Decision
We introduce a **Hardened Dual-Adapter Architecture**:
1. **Read-Only Ingestion Adapter (`razorpayClient.js`)**: Remains strictly read-only. Queries payments and settlements via HTTP GET. Does not possess or expose write endpoints.
2. **Hardened Sandbox Write Adapter (`razorpaySandboxAdapter.js`)**: A separate, heavily guarded service module:
   - **Default Disabled**: Invariant flag `RAZORPAY_SANDBOX_WRITES_ENABLED=false` by default. Disabled state immediately rejects writes with zero network calls and zero database mutations.
   - **Test Key Invariant**: Only test keys beginning with `rzp_test_` are permitted. Live keys (`rzp_live_`) trigger immediate exception rejection.
   - **Gate 3 Cryptographic Authorization (`PolicyAuthorizationToken`)**: Every write operation strictly requires a valid HMAC-SHA256 token signed with `POLICY_TOKEN_SECRET` (at least 32 characters, distinct from `JWT_SECRET` and `SERVICE_TOKEN_SECRET`). The token is bound to `tenantId`, `caseId`, `gatewayPaymentId`, `amountPaise`, `currency`, and `idempotencyKey` with a short 120s TTL (max 300s). Replay is prevented via unique index on `tokenId` in `ProviderOperation`. The token is never logged or exposed in HTTP responses.
   - **Server-Derived Dispatch Evidence**: The dispatch route (`POST /api/payment-cases/:caseId/provider/dispatch`) is restricted strictly to authenticated human `ADMIN` principals (machine identities, background workers, and PAYMENT_CONTROLLER cannot dispatch; returns HTTP 403) and strictly validates body against `{ actionType }`. Caller-supplied amounts, limits, approval flags, or idempotency keys result in HTTP 400 Bad Request. All evidence is gathered server-side (`dispatchEvidenceCollector.js`).
   - **Fail-Closed Policy Limits**: Policy evaluation fails closed to `INSUFFICIENT_EVIDENCE` if policy limits are missing in production.
   - **Authoritative Fresh Provider Preflight**: Executes GET `/v1/payments/:id` and `/v1/payments/:id/refunds` before token issuance or send. Mismatches trigger `SAFE_HOLD` (`PROVIDER_PREFLIGHT_MISMATCH`); network errors trigger `INSUFFICIENT_EVIDENCE`.
   - **Atomic Conditional Refund Reservation**: Executes an atomic MongoDB findOneAndUpdate with `$expr: { $gte: [ { $subtract: [ "$capturedAmountPaise", { $add: ["$refundAmountPaise", "$reservedRefundPaise"] } ] }, amountPaise ] }` and a unique reservation record (`RefundReservation`) to prevent double-spending across concurrent requests.
   - **Official Refund Idempotency Header**: Sends official header `X-Refund-Idempotency` per Razorpay API documentation.
   - **No Blind Retries for Unknown Outcomes**: Before retrying an operation marked `OUTCOME_UNKNOWN`, the adapter queries provider refunds matching by idempotency key/reference and amount to adopt existing IDs before issuing new dispatches.
   - **Append-Only Redacted Audit Events**: Emits `TOKEN_ISSUED`, `TOKEN_REJECTED`, `PROVIDER_PREFLIGHT_MISMATCH`, `REFUND_RESERVED`, `REFUND_RESERVATION_RELEASED`, `PROVIDER_DISPATCH_REQUESTED`, and `PROVIDER_OUTCOME_RECORDED` (audit failure fails closed).


---

## ADR-07: Cryptographic Webhook Ingestion Engine with HMAC-SHA256

### Context
Razorpay relies on real-time webhooks (`payment.captured`, `payment.failed`, `refund.processed`, etc.) to inform merchants of payment state changes. If webhooks are accepted without cryptographic validation, malicious actors could forge `payment.captured` webhooks to obtain goods for free or trigger unauthorized refunds.

### Decision
We implement a dedicated Webhook Ingestion Engine:
1. **Raw Body Buffering**: Express middleware preserves the raw `Buffer` of incoming webhook requests before JSON parsing to prevent HMAC verification mismatch.
2. **HMAC-SHA256 Signature Validation**: The controller calculates `crypto.createHmac('sha256', WEBHOOK_SECRET).update(rawBody).digest('hex')` and validates it against `req.headers['x-razorpay-signature']` using timing-safe comparison (`crypto.timingSafeEqual`).
3. **Idempotent Ingestion**: Every incoming webhook event ID (`event.id`) is recorded in an `IngestedWebhookEvent` collection. Duplicates are immediately acknowledged with HTTP 200 and discarded.
4. **Outbox Ingestion**: Validated events are placed into an in-memory or database outbox to ensure immediate HTTP 200 response to Razorpay while processing occurs asynchronously.

---

## ADR-08: Financial Idempotency, Action Leases, and Concurrency Locks

### Context
In distributed payment architectures, network retries or concurrent agent triggers can dispatch duplicate refund requests, causing double-refunding of a single transaction.

### Decision
Every financial mutation is guarded by:
1. **Deterministic Idempotency Key**: Generated as `IDEM-{actionType}-{paymentId}-{caseId}`.
2. **MongoDB Compound Unique Constraint**: An `ActionExecutionRecord` collection enforces uniqueness on `{ idempotencyKey: 1 }`.
3. **Case-Level Optimistic Locking / Action Lease**: Before an action is dispatched, the `PaymentCase` status transitions to `ACTION_IN_PROGRESS` with an `actionLeaseExpiresAt = Date.now() + 30000` (30-second lease). If another process attempts to act on the same case, it receives a concurrency conflict error.
4. **Provider Idempotency Header**: The key is transmitted in the provider HTTP header `X-Razorpay-Idempotency-Key`.

---

## ADR-09: Asynchronous Payment Monitoring Worker & Outbox Pipeline

### Context
Payments often fail transiently or experience late authorization up to 30 minutes after checkout timeout. Synchronous HTTP request-response cycles cannot continuously watch payments across multi-hour timelines.

### Decision
We introduce an autonomous background worker pipeline:
1. **Payment Monitoring Worker**: Runs on a configurable interval (e.g., every 30 seconds). Queries pending cases where `status === 'DETECTED'` or `status === 'INVESTIGATING'` with action `WAIT_AND_MONITOR`.
2. **Authoritative Polling**: For stuck payments exceeding provider SLAs without a webhook, the worker queries the provider GET endpoint to reconstruct true state.
3. **Dead-Letter Recovery**: If a worker crashes while a case has an active lease, the subsequent worker sweep identifies expired leases (`actionLeaseExpiresAt < Date.now()`), queries the provider to determine whether the action executed, and safely updates the case.

---

## ADR-10: Centralized Append-Only Audit Ledger for Multi-Agent Actions

### Context
Every autonomous AI decision and financial action must be completely auditable by compliance regulators and human administrators.

### Decision
We expand the existing `auditService.js` and `AuditLog` collection:
1. All agent evidence exchanges, diagnostic reasoning traces, policy authorizations, provider write dispatches, and outcome verifications are logged as discrete, immutable audit events.
2. The existing recursive credential and PII sanitization is maintained (`[REDACTED]`).
3. No update or delete operations are permitted on the audit ledger.
4. Every audit log record links directly to `caseId`, `actorType` (`AI`, `SYSTEM`, `POLICY_ENGINE`, `PROVIDER`, `HUMAN`), and `action`.

---

## ADR-11: Phase 3 Authentication, RBAC, and Row-Level Tenant Isolation Enforcement

### Context
ReconAI 2.0 requires robust multi-tenant boundaries, distinct machine/service principals (`CUSTOMER_AI`, `SHOP_AI`, `PAYMENT_CONTROLLER`), and deny-by-default role authorization.

### Decision
1. **Cryptographic Tokens:** Implemented via `jsonwebtoken` using HMAC-SHA256 (`HS256`). Segregated secret keys and audiences between human sessions (`aud: "reconai-api"`) and machine services (`aud: "reconai-service"`).
2. **Server-Side Authorization Middleware:** `authenticate`, `requireRoles`, `requireTenantScope`, and `requireCustomerScope` enforce access inside Express before database queries execute.
3. **Row-Level Tenant Scoping:** Tenant and customer IDs are derived from verified tokens and injected directly into Mongoose filters. Spoofed IDs in request bodies or query parameters are strictly blocked or overridden.
4. **Legacy Data Isolation:** Pre-existing records without explicit tenant ownership default to `tenantId: null` and remain quarantined from normal tenant queries to eliminate cross-tenant data leakage.
5. **Non-Executing Safety Guardrails:** AI and controller identities remain strictly non-executing in Phase 3. Live payment operations and autonomous disbursement remain prohibited.

---

## ADR-12: Phase 3 Security Correction — Auditor Scope, Identity Provenance, Service Binding, and Persistent Revocation

### Context
A focused security audit identified that:
1. `AUDITOR` had been described with global read-only access rather than strict tenant scoping.
2. Human account credential verification lacked explicit salted hashing and verifiable account provenance.
3. Service token issuance allowed callers to request arbitrary roles without fixed server-side identity bindings.
4. Production environments risked silent fallback to predictable development secrets.
5. In-memory token revocation was not durable across service restarts or distributed container instances.

### Decision
1. **Constrained Auditor Scope:** `AUDITOR` is tenant-scoped by default to `token.tenantId`. Cross-tenant querying is strictly prohibited unless an explicit privileged `GLOBAL_AUDIT` claim is present in `token.scopes`. Approved global audit requests emit an append-only `GLOBAL_AUDIT_ACCESSED` audit event. All mutations (`POST`, `PUT`, `PATCH`, `DELETE`) by an auditor are unconditionally rejected with `HTTP 403 Forbidden`. Cross-tenant lookups return `404 Not Found` to prevent existence leaks.
2. **Human Credential Provenance:** Human authentication validates against the persistent `UserAccount` store using salted `scrypt` hashing (N=16384, r=8, p=1) and constant-time `crypto.timingSafeEqual`. Claims (role, tenantId, customerId, scopes) are derived solely from verified server records—never caller-submitted request fields. Failed logins return generic error messages to eliminate account enumeration.
3. **Fixed Service Identity Credential Binding:** Machine services must present discrete credentials verified against a fixed server-side service registry (`serviceRegistry.js`). Credentials map 1:1 to immutable service profiles (`CUSTOMER_AI`, `SHOP_AI`, `PAYMENT_CONTROLLER`). Caller-supplied role or scope overrides are rejected with `HTTP 403 Forbidden`. Secrets are evaluated using constant-time comparison.
4. **Fail-Closed Production Signing Secrets:** `env.js` validates in `NODE_ENV === "production"` that `JWT_SECRET` and `SERVICE_TOKEN_SECRET` are at least 32 characters, distinct from each other, and do not match prohibited development defaults. Missing or insecure production configuration immediately aborts application startup.
5. **Durable Token Revocation:** Invalidated tokens (by JTI) are persisted to the database via the `RevokedToken` Mongoose collection with MongoDB TTL indexing (`expiresAt: 1`, `expireAfterSeconds: 0`). Middleware evaluates both in-memory cache and persistent datastore on every protected request. In production, datastore unavailability triggers fail-closed denial.
6. **Immediate Authorization-Lifetime Validation:** `authMiddleware.authenticate` verifies live server-side authorization state on every protected request. Disabling an account or service immediately rejects active tokens (`HTTP 401 Unauthorized`). Privilege downgrades, scope removals (e.g. `GLOBAL_AUDIT`), and tenant changes immediately bind requests to current permissions, denying removed privileges (`HTTP 403 Forbidden`) with zero stale-privilege window. Service credential rotation invalidates previous tokens via `credentialVersion`. In production, datastore failures fail closed (`HTTP 503 Service Unavailable`).
7. **Persistent Machine-Service Authorization & Restart-Safe Provisioning:** Mutable machine identity authorization state is persisted to the shared MongoDB datastore via `ServicePrincipal` with unique `serviceId` index, validated `serviceRole` enum (`CUSTOMER_AI`, `SHOP_AI`, `PAYMENT_CONTROLLER`), scrypt `credentialHash` and `credentialSalt`, monotonic `credentialVersion`, and `isActive` status. Plaintext machine secrets, bearer tokens, or signing keys are strictly prohibited from being persisted. Startup bootstrap is restart-safe: booting or restarting instances never reactivates disabled services, never reverts rotated credential versions, never restores revoked scopes, and never alters existing tenant/customer bindings. Every protected route validates live state from the persistent datastore. Multi-instance deployments immediately reflect emergency disablement, credential rotation, and scope reduction. In production, datastore unavailability triggers fail-closed denial (`HTTP 503 Service Unavailable`).

---

## ADR-13: Governed Versioned Policy-Limits Configuration and Two-Person Approval Boundary

### Context
Allowing arbitrary or default monetary refund limits in code or deployment configs creates grave financial loss risks and violates core banking separation-of-duties principles. If refund limits default to fallback values or can be unilaterally created or modified by a single person or autonomous machine identity, rogue actions or compromised keys can trigger unconstrained financial disbursements.

### Decision
1. **Zero Monetary Defaults:** No monetary limits ship with the repo. Limits exist ONLY as two-person-approved per-tenant records stored in the append-only `PolicyConfigVersion` collection. With no active configuration, all refund evaluations fail closed to `INSUFFICIENT_EVIDENCE`.
2. **Two-Person Approval Rule:** A configuration proposed by an `ADMIN` can ONLY be activated when approved by a different authenticated `ADMIN` (`approvedBy !== proposedBy`). Proposers cannot approve their own configurations.
3. **Append-Only & Immutable Records:** Once created, `limits`, `contentHash`, `tenantId`, and `configVersion` are strictly immutable at both Mongoose schema and service levels. Modifications via `PUT`, `PATCH`, or `DELETE` are permanently unavailable (HTTP 405 Method Not Allowed). Any change requires proposing a new version with incremented `configVersion`.
4. **Single Active Record Guarantee:** MongoDB enforces a unique partial index on `{ tenantId: 1 }` where `{ status: "ACTIVE" }`. Activation atomically supersedes the existing active version before activating the pending version. Two active configs can never exist simultaneously for a tenant.
5. **Fail-Closed Emergency Deactivation:** Any single `ADMIN` can immediately deactivate an active configuration, transitioning it to `DEACTIVATED`. This ensures emergency kill-switch operation is fast (one person needed to halt operations; two people needed to loosen/activate limits).
6. **Strict RBAC & Tenant Scoping:** Full configuration access is restricted to `ADMIN`. Read-only access is permitted for `AUDITOR` (strictly tenant-scoped; global auditor access is audited via `GLOBAL_AUDIT_ACCESSED`). `SHOP`, `CUSTOMER`, and all machine identities/service principals are denied (HTTP 403 Forbidden).
7. **Single Production Evaluation Path:** The dispatch engine and simulation routes read active limits solely from `getActivePolicyConfig(tenantId)`. Injected limits parameters are completely removed from production services.
8. **Tamper-Evident Token & Execution Binding:** The dispatch service verifies that the active configuration has not changed between policy decision and dispatch; any mismatch aborts with HTTP 409 `POLICY_CONFIG_CHANGED`. `PolicyAuthorizationToken` cryptographically binds `policyConfigVersion` and `policyConfigHash`, verified by the adapter before execution.
9. **Fail-Closed Audit Trail & Truthfulness:** All state transitions write intent (`POLICY_CONFIG_*_REQUESTED`) before conditional database mutation with fail-closed behavior (HTTP 503). Outcomes (`POLICY_CONFIG_APPROVED`, `_ACTIVATED`, `_REJECTED`, `_DEACTIVATED`) are recorded ONLY for winning attempts; losing/blocked attempts write `POLICY_CONFIG_CHANGE_BLOCKED` with the reason.
10. **Limit Semantics Plain Meaning Today:**
    - `maxSingleRefundPaise`: Evaluated directly against the payment's refundable balance (`refundableBalancePaise <= maxSingleRefundPaise`). It caps individual refund executions.
    - `maxCumulativeRefundPaise`: In evaluator logic, checks `(currentCumulativeDailyPaise + refundableBalancePaise) <= maxCumulativeRefundPaise`.
    - **NO EFFECT TODAY:** With `currentCumulativeDailyPaise = 0` and `maxSingleRefundPaise <= maxCumulativeRefundPaise` enforced, `maxCumulativeRefundPaise` has **no effect today** on evaluation outcomes because single refund limit Guard 7 always triggers first. True "per-day velocity caps" and "cumulative-per-payment caps" across multiple historical transactions are NOT IMPLEMENTED in production today (history aggregation is unpopulated). OWNER DECISION: implement real aggregation, or remove the field. Do not change evaluator behavior.
11. **Second ADMIN Account Provisioning:**
    - Because two-person rule enforcement requires `approvedBy !== proposedBy`, every operating tenant must provision at least two administrator identities.
    - A second ADMIN account is provisioned using `accountService.provisionUserAccount({ tenantId, email, role: "ADMIN", ... })` by an existing bootstrap administrator.
12. **No UI for Configuration Yet:** Policy configuration is strictly server-side API only in ReconAI 2.0 Stage 4.

---

## ADR-14: Database-Driven Classifier Context, Input Hash Provenance, and Consumer Freshness Invariants

### Context
In prior stages, the edge-case classification engine accepted an arbitrary in-memory context object. This design allowed callers or test fixtures to inject synthetic context directly, decoupling classification decisions from authoritative datastores and risking ungrounded financial evaluations. Furthermore, consumers (investigators, simulation evaluators, and sandbox dispatchers) did not verify that classification findings matched current database state.

### Decision
1. **Authoritative Datastore Derivation (`buildClassifierContext`):**
   - The classifier context builder (`classifierContextBuilder.js`) derives context strictly from tenant-scoped MongoDB collections: `PaymentCase`, `GatewayPayment`, `MerchantOrder`, `ProviderOperation`, `SettlementRecord`, `PaymentLifecycleEvent`, and `OrchestrationTask`.
   - The caller cannot provide request-body evidence or in-memory overrides.
   - Cross-tenant boundaries are strictly enforced: tenantId comes solely from authenticated principal context.
2. **Field Provenance and Cryptographic Input Hash:**
   - Every populated field records its exact datastore provenance (`collection` and `documentId`).
   - A deterministic, canonical JSON serialization followed by SHA-256 produces `inputHash`.
   - `EvidenceRecord` persists `provenance` and `inputHash`.
3. **Inert Claims Isolation & Zero Defaulting:**
   - Free-form text fields (notes, customer claims, descriptions) are strictly quarantined into an inert `claims` list and never mapped to decision facts.
   - Missing database records leave fields undefined; the classifier falls through to `UNKNOWN_SCENARIO` / `UNRESOLVED_UNCERTAINTY` (fail-closed safe hold) without guessing or defaulting to actionable scenarios.
4. **Governed Classification Routes & Fail-Closed Audit:**
   - `POST /api/payment-cases/:caseId/classify`: Restricted to `ADMIN` only. Accepts a strictly empty request body (`{}`). Emits a mandatory `CASE_CLASSIFIED` audit log. If the audit log write fails, the uncommitted `EvidenceRecord` is deleted and HTTP 503 is returned (fail-closed).
   - `GET /api/payment-cases/:caseId/classification`: Restricted to `ADMIN`, `SHOP` (own tenant only), and `AUDITOR` (own tenant or `GLOBAL_AUDIT` audited). Sensitive internal credentials and secrets are stripped via redaction.
5. **Consumer Freshness & Staleness Invariants:**
   - Downstream consumers (`multiAgentInvestigator`, `dryRunSimulatorService`) obtain classification via `classifyCase` or verify `inputHash === currentBuilderHash`. If hashes diverge, evaluation yields `INSUFFICIENT_EVIDENCE`.
   - `PolicyDecision` stores `classificationRecordId` and `classificationInputHash`.
   - `providerDispatchService` recomputes the current builder hash and refuses dispatch with HTTP 409 `CLASSIFICATION_STALE` if the hash has changed since the policy decision was made.
6. **Code-Derived Precedence (Safe-Hold Priority):**
   - 41 deterministic rules are structured into 6 evaluation tiers.
   - Any rule triggering a safe hold strictly outranks non-safe-hold rules within and across tiers. Specifically, Case 21 (`MISSING_SETTLEMENT`, safe-hold) takes priority over Case 6 (`STATUS_MISMATCH`, non-safe-hold) when settlement records are absent after the aging threshold.
7. **Proven Reachability Table (Computed from Test JSON):**
   - Of the 30 edge-case scenarios:
     - **PROVEN_FROM_DB (14):** Cases 5, 6, 7, 8, 10, 11, 12, 17, 19, 20, 21, 22, 26, 30.
     - **INGESTION_TIME (3):** Cases 14, 15, 28 (handled at network/webhook/auth boundaries).
     - **NEEDS_CLAIM_INTAKE (3):** Cases 2, 3, 29 (require authenticated claim intake endpoints).
     - **RESERVED (8):** Cases 1, 4, 9, 13, 16, 18, 23, 27.
     - **NO_SOURCE (2):** Cases 24, 25 (external infrastructure faults not stored in DB records).
