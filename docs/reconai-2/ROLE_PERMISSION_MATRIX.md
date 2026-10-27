# ReconAI 2.0 — Role-Based Access Control (RBAC) & Tenant Permission Matrix

> **DOCUMENT STATUS: IMPLEMENTED & VERIFIED IN PHASE 3**  
> *This document specifies the authorization architecture, role definitions, tenant scoping rules, and permission matrix for ReconAI 2.0. Enforced via Express auth middleware and database query scoping.*

---

## 1. Security Context & Authentication Model

ReconAI 2.0 introduces an enterprise-grade multi-tenant authorization framework. Every incoming request must present an authenticated identity, verified through:
1. **User Identities (Customer, Merchant, Admin, Auditor)**: Authenticated via signed JSON Web Tokens (JWT) using HMAC-SHA256 (`Authorization: Bearer <token>`). Tokens contain:
   ```json
   {
     "sub": "usr_9981",
     "tenantId": "sh_merchant_alpha",
     "customerId": "cust_4421",
     "role": "CUSTOMER",
     "exp": 1791823900
   }
   ```
2. **Service Identities (Customer AI, Shop AI, Payment Controller)**: Authenticated via signed service JWTs (`Authorization: Bearer <token>`, with `aud: "reconai-service"`) or internal service tokens (`x-service-token`) validated against the persistent `ServicePrincipal` datastore. *(Note: Mutual TLS / mTLS transport binding is `UNIMPLEMENTED / PROPOSED` and not enforced at the transport layer).*

---

## 2. The 7 Target Architectural Roles

### 2.1 Human Identities
1. **`CUSTOMER`**:
   - Represents the retail purchaser.
   - *Scope*: Strictly bound to `customerId === token.customerId`.
   - *Capabilities*: View personal payment statuses, submit debit claims, view resolution outcomes.
   - *Restrictions*: Prohibited from querying other customers, merchant order queues, provider configurations, or internal audit trails.

2. **`SHOP`**:
   - Represents the merchant / shopkeeper / e-commerce store operator.
   - *Scope*: Strictly bound to `tenantId === token.tenantId`.
   - *Capabilities*: View store orders, gateway payment receipts, settlement schedules, and initiate inquiry tickets.
   - *Restrictions*: Prohibited from querying other merchants, customer payment credentials, raw customer card numbers, or system-wide administrator settings.

3. **`ADMIN`**:
   - Represents the privileged finance operations controller.
   - *Scope*: System-wide access across tenants. *(Note: Multi-factor authentication / 2FA is a documented security target but is currently `UNIMPLEMENTED / PROPOSED`; no second-factor flow exists in code today).*
   - *Capabilities*: Full visibility over live payment cases, AI interactions, safe-hold queue, configuration of policy thresholds, and manual overrides.
   - *Restrictions*: Cannot bypass append-only audit logging; all admin actions are logged with actor identity.

4. **`AUDITOR`**:
   - Represents internal/external compliance auditors and risk officers.
   - *Scope*: **Strictly tenant-scoped by default** to `tenantId === token.tenantId`. Does *not* have automatic cross-tenant access.
   - *Privileged Global Audit*: Global organization-wide auditing requires an explicit, verified server-side permission grant (`scopes.includes("GLOBAL_AUDIT")`). Every access under this privileged grant is recorded in the append-only `AuditLog` (`GLOBAL_AUDIT_ACCESSED`).
   - *Capabilities*: Read-only query of cases, lifecycle events, payment actions, and audit ledgers within assigned scope; inspect cryptographic evidence proofs; view evaluation benchmarks.
   - *Restrictions*: Zero write or mutation permissions across all endpoints (`POST`, `PUT`, `PATCH`, `DELETE` are unconditionally rejected with `HTTP 403 Forbidden`). Cross-tenant queries return `HTTP 404 Not Found` on single-resource lookups to eliminate resource-existence leaks.

### 2.2 Agent & System Service Identities
5. **`CUSTOMER_AI`**:
   - Scoped assistant serving the authenticated customer.
   - *Scope*: Can read only the authenticated customer's order references and payment status summaries.
   - *Capabilities*: Answer customer status questions, intake debit claims, provide human-friendly explanations.
   - *Restrictions*: Cannot view merchant wholesale costs, fees, provider API secrets, or execute financial actions.

6. **`SHOP_AI`**:
   - Scoped assistant serving the authenticated merchant store.
   - *Scope*: Can read only the authenticated store's order details and inventory reservations.
   - *Capabilities*: Inquire about unpaid orders, confirm delivery/cancellation state.
   - *Restrictions*: Cannot view customer emails, phone numbers, VPAs, or cross-tenant stores.

7. **`PAYMENT_CONTROLLER`**:
   - Privileged backend engine service identity.
   - *Scope*: Orchestrator of policy-checked operations.
   - *Capabilities*: Read normalized multi-source evidence, invoke Policy Engine, dispatch verified provider adapter actions, update canonical cases.
   - *Restrictions*: Constrained by deterministic policy rules; cannot disburse funds without verified policy pass.

---

## 3. Comprehensive Permission Matrix

| Entity / Resource | Action | `CUSTOMER` | `SHOP` | `ADMIN` | `AUDITOR` | `CUSTOMER_AI` | `SHOP_AI` | `PAYMENT_CONTROLLER` |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **Customer Payment Claim** | Create / Submit | ✅ (Own) | ❌ | ✅ | ❌ | ✅ (On behalf) | ❌ | ❌ |
| **Customer Payment Claim** | View Details | ✅ (Own) | ❌ | ✅ | ✅ | ✅ (Own) | ❌ | ✅ |
| **Merchant Order** | View Details | ✅ (Own Order) | ✅ (Own Store) | ✅ | ✅ | ✅ (Summary) | ✅ (Own Store) | ✅ |
| **Merchant Order Ledger** | Update to PAID | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ (Policy Validated) |
| **Gateway Payment** | View Read-Only | ✅ (Masked Own) | ✅ (Own Store) | ✅ | ✅ | ✅ (Masked Own) | ✅ (Own Store) | ✅ |
| **Settlement Payout** | View Records | ❌ | ✅ (Own Store) | ✅ | ✅ | ❌ | ✅ (Own Store) | ✅ |
| **Payment Case** | View Status | ✅ (Own Case) | ✅ (Own Store) | ✅ | ✅ | ✅ (Own Case) | ✅ (Own Store) | ✅ |
| **Payment Case** | Diagnose / Reason | ❌ | ❌ | ❌ | ❌ | ✅ (Claim side) | ✅ (Shop side) | ✅ (Investigator) |
| **Resolution Action** | Recommend | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (Planner Agent) |
| **Resolution Policy** | Validate / Authorize | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (Deterministic Engine) |
| **Provider Write API** | Execute Refund | ❌ | ❌ | ✅ (Manual Protected Route; Gate 3 Token Required) | ❌ | ❌ | ❌ | ❌ (Autonomous Worker Refunds Prohibited) |
| **Safe-Hold Queue** | Review / Release | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Audit Ledger** | View Events | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ |
| **Audit Ledger** | Append Event | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (System Central) |
| **System Configuration** | Read / Write | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Policy Limits Configuration (/api/policy-config)** | Propose / Approve / Reject / Deactivate | ❌ | ❌ | ✅ (Two-Person Rule) | ❌ | ❌ | ❌ | ❌ |
| **Policy Limits Configuration (/api/policy-config)** | View Active / History | ❌ | ❌ | ✅ | ✅ (Tenant-Scoped / Global Audited) | ❌ | ❌ | ❌ |

> **Provider Write Dispatch Hardening (Stage 3 & 4)**:
> 1. Provider write execution is restricted strictly to authenticated human `ADMIN` principals triggering `POST /api/payment-cases/:caseId/provider/dispatch`. Machine identities (including PAYMENT_CONTROLLER, background workers, schedulers, and AI agents) cannot dispatch (returns HTTP 403 Forbidden).
> 2. The dispatch route accepts ONLY `{ actionType }` alongside `:caseId`. Caller-supplied amounts, limits, approval flags, or idempotency keys are strictly rejected with HTTP 400.
> 3. Autonomous or machine-triggered refunds by background workers, schedulers, or service principals are strictly prohibited.
> 4. Execution requires a valid, unexpired, single-use `PolicyAuthorizationToken` (Gate 3) signed with `POLICY_TOKEN_SECRET`.
> 5. Writes are disabled by default (`RAZORPAY_SANDBOX_WRITES_ENABLED=false`) and restricted to test keys (`rzp_test_...`).

> **Governed Versioned Policy-Limits Configuration (Stage 4B)**:
> "No monetary limits ship with the repo. Limits exist only as two-person-approved per-tenant records. With none active, refunds fail closed. No UI for configuration yet."
> 1. Propose, approve, reject, deactivate, rollback endpoints strictly require `ADMIN` role. Proposers cannot approve their own configurations (`approvedBy !== proposedBy`).
> 2. Read endpoints (`GET /api/policy-config`, `GET /api/policy-config/active`) permit `ADMIN` and `AUDITOR` (strictly tenant-scoped to `token.tenantId` unless privileged `GLOBAL_AUDIT` scope is present and audited via `GLOBAL_AUDIT_ACCESSED`).
> 3. `SHOP`, `CUSTOMER`, and all machine identities/service principals are rejected with HTTP 403 Forbidden. Unauthenticated requests are rejected with HTTP 401 Unauthorized.
> 4. `PUT`, `PATCH`, `DELETE` are permanently unavailable (HTTP 405 Method Not Allowed).


---

## 4. Row-Level Tenant Scoping Implementation Rules

Every database query inside ReconAI 2.0 controller services must enforce **Mandatory Tenant Scoping**:

### Rule 1: Customer Row Scoping
When a request originates from `role === 'CUSTOMER'` or `role === 'CUSTOMER_AI'`:
```javascript
// Enforcement Pattern
const filter = {
  customerId: req.user.customerId,
  tenantId: req.user.tenantId,
  ...(caseId ? { caseId } : {})
};
const paymentCase = await PaymentCase.findOne(filter);
if (!paymentCase) {
  throw AppError.notFound("Payment case not found or access denied.");
}
```

### Rule 2: Shop Row Scoping
When a request originates from `role === 'SHOP'` or `role === 'SHOP_AI'`:
```javascript
// Enforcement Pattern
const filter = {
  tenantId: req.user.tenantId,
  ...(caseId ? { caseId } : {})
};
const paymentCase = await PaymentCase.findOne(filter);
if (!paymentCase) {
  throw AppError.notFound("Payment case not found or access denied.");
}
```

### Rule 3: Admin Multi-Tenancy Scoping
When a request originates from `role === 'ADMIN'`:
- Global access is permitted, but the query may optionally be scoped to a specific `tenantId` via header or query parameter for multi-store inspection.

### Rule 4: Auditor Scoping & Global Audit Verification
When a request originates from `role === 'AUDITOR'`:
- **Default**: Scoped strictly to `req.user.tenantId`. If the auditor attempts to pass a different `tenantId` query parameter or access another tenant's resource, it is rejected (`HTTP 403 Forbidden` for query mismatches, `HTTP 404 Not Found` for single resource queries to prevent existence leakage).
- **Explicit Global Grant**: If and only if the verified token contains `scopes.includes("GLOBAL_AUDIT")`, the auditor is allowed cross-tenant read-only queries. Each such query emits a `GLOBAL_AUDIT_ACCESSED` event to the `AuditLog`.
- **Read-Only Invariant**: All non-idempotent HTTP methods (`POST`, `PUT`, `PATCH`, `DELETE`) are rejected with `HTTP 403 Forbidden` before route handlers execute.

---

## 5. Security Responses on Unauthorized Access

If an identity attempts an unauthorized action or attempts to access a cross-tenant resource:
1. **HTTP Status Code**:
   - Missing or expired token $\rightarrow$ `HTTP 401 Unauthorized`.
   - Valid token, but role or tenant ownership mismatch $\rightarrow$ `HTTP 403 Forbidden` (or `HTTP 404 Not Found` to prevent resource enumeration).
2. **Audit Alert Emission**:
   An immediate security audit event is appended to `AuditLog`:
   ```json
   {
     "actorType": "SYSTEM",
     "actorId": "security-guard",
     "action": "ACCESS_DENIED_ALERT",
     "entityType": "PaymentCase",
     "entityId": "CASE-9921",
     "metadata": {
       "requestingUser": "usr_hacker",
       "requestingTenant": "sh_evil_corp",
       "targetTenant": "sh_merchant_alpha",
       "ip": "192.168.1.105",
       "reason": "CROSS_TENANT_ACCESS_ATTEMPT"
     }
   }
   ```
3. **No Information Leakage**: Error response payload strictly returns `{ "success": false, "error": { "code": "FORBIDDEN", "message": "Access denied." } }`. Zero internal tenant or database schema details are returned.

---

## 6. Machine-Service Principal Lifecycle & Persistent Revocation Guarantees

Machine identities (`CUSTOMER_AI`, `SHOP_AI`, `PAYMENT_CONTROLLER`) are managed and persisted in the `ServicePrincipal` MongoDB datastore:

1. **Identity & Scope Binding**:
   - `CUSTOMER_AI`: Bound strictly to a fixed customer (`customerId`) and merchant tenant (`tenantId`). Permitted scopes default to `["READ_CUSTOMER_EVIDENCE"]`.
   - `SHOP_AI`: Bound strictly to a fixed merchant tenant (`tenantId`). Permitted scopes default to `["READ_STORE_EVIDENCE"]`.
   - `PAYMENT_CONTROLLER`: System controller identity. Permitted scopes default to `["PROPOSE_ACTION", "APPEND_EVENT"]`. Strictly non-executing in Phase 3.
2. **Durable Credential Storage**:
   - Credential verification material is stored exclusively as salted `scrypt` hashes (`credentialHash` and `credentialSalt`). Plaintext machine secrets, bearer tokens, or signing keys are never stored or logged.
3. **Restart-Safe Provisioning**:
   - Environment variables supply credentials only during initial bootstrap when a service does not already exist. Server restarts never overwrite existing records, never reactivate disabled principals, never revert rotated credential versions, and never restore revoked scopes.
4. **Immediate Invalidation Guarantees**:
   - Disabling a service principal (`isActive: false`) or rotating its credential increments `credentialVersion`, causing existing service tokens to be rejected immediately (`HTTP 401 Unauthorized`) on the next request.
   - Scope reduction or tenant reassignment immediately constrains active tokens to current server state on the next request, returning `HTTP 403 Forbidden` for removed permissions or old tenants with zero stale-privilege window.
   - In production, persistent datastore unavailability triggers fail-closed denial (`HTTP 503 Service Unavailable`).
