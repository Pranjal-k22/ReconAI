# ReconAI 2.0 — Role-Based Access Control (RBAC) & Tenant Permission Matrix

> **DOCUMENT STATUS: PROPOSED — AWAITING OWNER REVIEW**  
> *This document specifies the authorization architecture, role definitions, tenant scoping rules, and permission matrix for ReconAI 2.0. No application code has been modified.*

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
2. **Service Identities (Customer AI, Shop AI, Payment Controller)**: Authenticated via signed, short-lived internal service tokens (`x-service-token`) and internal mTLS communication.

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
   - *Scope*: System-wide access across tenants with multi-factor authentication (2FA).
   - *Capabilities*: Full visibility over live payment cases, AI interactions, safe-hold queue, configuration of policy thresholds, and manual overrides.
   - *Restrictions*: Cannot bypass append-only audit logging; all admin actions are logged with actor identity.

4. **`AUDITOR`**:
   - Represents internal/external compliance auditors and risk officers.
   - *Scope*: Global read-only access.
   - *Capabilities*: Query immutable audit ledger, inspect cryptographic evidence proofs, view evaluation benchmarks.
   - *Restrictions*: Zero write or mutation permissions across all endpoints.

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
| **Provider Write API** | Execute Refund | ❌ | ❌ | ✅ (Manual) | ❌ | ❌ | ❌ | ✅ (Idempotent Sandbox) |
| **Safe-Hold Queue** | Review / Release | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |
| **Audit Ledger** | View Events | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ | ✅ |
| **Audit Ledger** | Append Event | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ (System Central) |
| **System Configuration** | Read / Write | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ |

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
