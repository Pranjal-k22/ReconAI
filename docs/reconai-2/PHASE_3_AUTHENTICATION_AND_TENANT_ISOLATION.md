# ReconAI 2.0 — Phase 3 Implementation Report: Authentication, RBAC & Tenant Isolation

> **PHASE 3 STATUS:** PASS_PENDING_REVIEW  
> **SCOPE:** Complete Authentication, Role-Based Access Control (RBAC), Service Identities, and Row-Level Tenant Isolation.  
> **GIT WORKFLOW:** Committed and published directly on canonical `main`.

---

## 1. Executive Summary

Phase 3 introduces an enterprise-grade multi-tenant security architecture for ReconAI 2.0. Every incoming request must present a cryptographically verified identity. All protected routes enforce deny-by-default role boundaries and row-level tenant scoping inside database access paths.

### Invariant & Boundary Guarantees
1. **Deny by Default:** Sensitive routes reject unauthenticated requests (`401 Unauthorized`) and insufficient role access (`403 Forbidden`).
2. **Explicit Identities:** Human identities (`CUSTOMER`, `SHOP`, `ADMIN`, `AUDITOR`) and Machine/Service identities (`CUSTOMER_AI`, `SHOP_AI`, `PAYMENT_CONTROLLER`) use segregated signing keys, distinct audiences, and non-overlapping claim boundaries.
3. **Tenant Boundary Protection:** Tenant scope is derived strictly from the authenticated principal token—never from untrusted request headers, query parameters, or request bodies.
4. **Non-Executing Safety Boundary:** AI identities and controllers remain non-executing. Action statuses remain strictly restricted to Phase 2 safe allowlist (`PROPOSED`, `SIMULATED`, `REJECTED_BY_POLICY`, `HELD_IN_SAFE_HOLD`). Direct payment disbursement, provider refund write endpoints, and autonomous execution are prohibited and absent.
5. **Deterministic Compatibility:** All 120/120 Track 4 deterministic reconciliation scenarios continue to pass with 100% accuracy.

---

## 2. Authentication Architecture & Token Verification

### 2.1 Cryptographic Signing & Algorithm Enforcement
- **Library:** `jsonwebtoken` (industry standard, maintained).
- **Algorithm:** Strictly enforced HMAC-SHA256 (`HS256`).
- **Algorithm Confusion Prevention:** The decoding middleware checks the JWT header algorithm prior to verification. Unsigned tokens (`alg: "none"`), RS256 confusion attempts, or malformed headers are rejected before processing.
- **Audience & Issuer Binding:**
  - Human User Tokens: `iss: "reconai-auth-service"`, `aud: "reconai-api"`.
  - Machine Service Tokens: `iss: "reconai-auth-service"`, `aud: "reconai-service"`.

### 2.2 Token Payloads & Claims
```json
{
  "sub": "usr_shop_merchant_01",
  "identityType": "HUMAN",
  "role": "SHOP",
  "tenantId": "sh_merchant_alpha",
  "customerId": null,
  "scopes": [],
  "jti": "550e8400-e29b-41d4-a716-446655440000",
  "iss": "reconai-auth-service",
  "aud": "reconai-api",
  "exp": 1789000000
}
```

### 2.3 Expiry, Durable Revocation & Rotation
- **Human Tokens:** Expire in 1 hour (`JWT_EXPIRES_IN=1h`).
- **Machine Service Tokens:** Short-lived tokens with 15-minute expiry (`15m`).
- **Durable Token Revocation:** Revocations are persisted to the database via the `RevokedToken` collection with a MongoDB TTL index (`expiresAt: 1, expireAfterSeconds: 0`), backed by an in-memory fast-path cache. Revocation persists across service restarts and multiple container instances. In production, if the revocation store is unreachable, protected routes fail closed (`503 Service Unavailable`).
- **Production Secret Validation:** In production (`NODE_ENV === "production"`), `JWT_SECRET` and `SERVICE_TOKEN_SECRET` must be distinct, at least 32 characters, and cannot match known development fallbacks. Startup aborts immediately if secrets are insecure.

### 2.4 Human Login Credential Provenance
- **Account Verification:** Authenticates against `UserAccount` collection using salted `scrypt` hashing (N=16384, r=8, p=1) and `crypto.timingSafeEqual`.
- **Zero User Enumeration:** Invalid identifiers or incorrect passwords return a generic "Invalid credentials" error (`HTTP 401 Unauthorized`).
- **Server-Derived Claims:** Token claims (`role`, `tenantId`, `customerId`, `scopes`) are loaded exclusively from verified account records. Caller-supplied role or tenant fields in the request body are strictly ignored.

### 2.5 Fixed Service Identity Credential Binding
- **Machine Authentication:** Authenticates against `serviceRegistry` via `POST /api/auth/service-token` using `x-service-id` and `x-service-secret`.
- **Fixed Profile Binding:** Credentials are bound 1:1 to immutable server-side profiles (`CUSTOMER_AI`, `SHOP_AI`, `PAYMENT_CONTROLLER`).
- **Prohibition of Elevation:** Callers cannot request arbitrary roles or tenant scopes; overrides trigger `HTTP 403 Forbidden`.

### 2.6 Immediate Authorization-Lifetime Validation & Zero Stale-Token Window
- **Live Verification on Every Request:** `authMiddleware.authenticate` queries the current server-side account authorization state on each request.
- **Account Disablement:** If an account is disabled (`isActive === false`), subsequent requests with active tokens are immediately rejected with `HTTP 401 Unauthorized`.
- **Privilege / Scope / Tenant Changes:** When an account's role is downgraded, scope removed (e.g. `GLOBAL_AUDIT`), or tenant changed, the middleware synchronizes request claims with current server-side authority. Downstream route handlers immediately enforce the updated boundaries (`403 Forbidden` on stripped privileges), eliminating stale JWT privilege caching.
- **Service Invalidation:** Disabling a service principal or rotating its secret immediately invalidates previously issued tokens (`401 Unauthorized`) via `credentialVersion` checks.
- **Fail-Closed Guarantee:** In production, if the authorization datastore is unreachable, requests fail closed (`503 Service Unavailable`).

### 2.7 Controlled Operator Account & Service Provisioning Procedures
- **Human Accounts:** Provisioned exclusively via trusted server-side administrative procedures (`accountService.provisionUserAccount`). No unauthenticated public user registration exists. Operators configure `userId`, `email`, password (salted `scrypt`), `role`, `tenantId`, `customerId`, and `scopes`.
- **Administrative Account Controls:**
  - `disableUserAccount(userId, reason)`: Disables the account and increments `authVersion`, immediately terminating session authorization.
  - `updateUserAuthorization(userId, { role, tenantId, customerId, scopes })`: Dynamically updates permissions and logs an audit trail event.
  - `invalidateUserSessions(userId)`: Increments `authVersion` to force immediate re-authentication across all active tokens.
- **Machine Services:** Pre-configured in `serviceRegistry` derived from deployment secrets (`SERVICE_TOKEN_SECRET`) or registered via `registerServicePrincipal`. Operators rotate secrets via `rotateServiceCredential(serviceId, newSecret)` or revoke access via `disableServicePrincipal(serviceId)`.

---

## 3. Human vs Machine/Service Identities

| Identity Name | Type | Allowed Roles / Functions | Primary Boundary |
| :--- | :--- | :--- | :--- |
| **`CUSTOMER`** | HUMAN | Retail customer | Bound strictly to `customerId` & `tenantId`. View own cases/claims only. |
| **`SHOP`** | HUMAN | Merchant / store operator | Bound strictly to `tenantId`. View store orders, cases, and settlements. Cannot see other merchants. |
| **`ADMIN`** | HUMAN | Operations administrator | Cross-tenant inspection, safe-hold review, policy threshold management. All actions audited. |
| **`AUDITOR`** | HUMAN | Compliance officer | **Tenant-scoped by default**. Strictly read-only (`POST`/`PUT`/`PATCH`/`DELETE` denied with 403). Cross-tenant access requires explicit `GLOBAL_AUDIT` claim and logs audit events. |
| **`CUSTOMER_AI`** | SERVICE | Customer assistant | Scoped to customer evidence. Cannot see wholesale costs or provider secrets. Non-executing. |
| **`SHOP_AI`** | SERVICE | Store assistant | Scoped to store evidence. Cannot see customer PII or cross-tenant data. Non-executing. |
| **`PAYMENT_CONTROLLER`**| SERVICE | Core engine service | Propose/simulate actions and append events. Strictly prohibited from live disbursement or provider execution. |

---

## 4. Protected Routes & Public Route Inventory

### 4.1 Intentionally Public Routes (Explicitly Justified)
1. **`GET /api/health`**
   - *Justification:* Standard Kubernetes/orchestrator liveness and readiness probe. Reports service liveness without requiring privileged tokens.
2. **`POST /api/auth/login`**
   - *Justification:* Initial authentication gateway for human credentials to receive signed JWT session.
3. **`POST /api/auth/service-token`**
   - *Justification:* Machine-to-machine token exchange endpoint guarded by `x-service-secret`.

### 4.2 Protected Route Inventory
All other endpoints are strictly protected by `authenticate`, role checks, and tenant scope derivation:
- `/api/auth/me` & `/api/auth/logout`: Authenticated sessions only.
- `/api/payment-cases`: Scoped by caller's `tenantId` and `customerId`.
- `/api/payment-actions`: Restricted to `PAYMENT_CONTROLLER` and `ADMIN`. Proposals only.
- `/api/payment-events`: Append-only event ingestion.
- `/api/reconciliation`: Restricted to `ADMIN`, `SHOP`, `AUDITOR`.
- `/api/exceptions`: Restricted to `ADMIN`, `SHOP`, `AUDITOR`.
- `/api/audit`: Restricted to `ADMIN`, `AUDITOR` (read-only; mutations return 404).
- `/api/razorpay`: Restricted to `ADMIN`, `SHOP`.
- `/api/integrations`: Restricted to `ADMIN`, `SHOP`.
- `/api/finance-controller`: Restricted to `ADMIN`, `AUDITOR`, `SHOP`.

---

## 5. Row-Level Tenant Isolation & Legacy Data Strategy

### 5.1 Schema Enhancements
Explicit `tenantId` (and `customerId` where applicable) added to:
- `MerchantOrder`: `{ tenantId: String, customerId: String, default: null }`, index `{ tenantId: 1, merchantOrderId: 1 }`
- `GatewayPayment`: `{ tenantId: String, customerId: String, default: null }`, index `{ tenantId: 1, gatewayPaymentId: 1 }`
- `SettlementRecord`: `{ tenantId: String, default: null }`, index `{ tenantId: 1, settlementRecordId: 1 }`
- `ExceptionCase`: `{ tenantId: String, default: null }`, index `{ tenantId: 1, runId: 1 }`
- `AuditLog`: `{ tenantId: String, default: null }`
- `ReconciliationRun`: `{ tenantId: String, default: null }`
- `ReconciliationResult`: `{ tenantId: String, default: null }`
- `FinanceControllerRun`: `{ tenantId: String, default: null }`

### 5.2 Database Query Scoping
Database access paths scope queries directly in Mongo filters:
- For `SHOP` / `SHOP_AI`: `filter.tenantId = req.user.tenantId`
- For `CUSTOMER` / `CUSTOMER_AI`: `filter.tenantId = req.user.tenantId; filter.customerId = req.user.customerId`
- For `ADMIN` / `AUDITOR`: Full system visibility; optional tenant scoping via explicit filter.

### 5.3 Legacy Data & Backfill Strategy
- **Isolation Invariant:** Legacy records with ambiguous or absent ownership have `tenantId: null`. They are **never** automatically assigned to a random or active tenant.
- **Security Guarantee:** Tenant-scoped queries (`{ tenantId: "sh_alpha" }`) will never return unassigned legacy records (`tenantId: null`), preventing cross-tenant information leaks.
- **Dry-Run Backfill Recommendation:** When merchant ownership can be verified with 100% cryptographic certainty (e.g., from Razorpay account configuration or merchant master tables), a separate, reviewable administrative migration script can be run with owner approval. No unverified production updates have been executed.

---

## 6. Audit & Security Logging

Security events are immutably logged into `AuditLog`:
- `AUTH_LOGIN_SUCCESS`: Issued upon human or machine token generation.
- `ACCESS_DENIED_ALERT`: Emitted when an unauthorized role attempts route access, or when cross-tenant injection is detected.
- `TOKEN_REVOKED`: Logged upon explicit session termination.
- Zero Token / Secret Leakage: Log payloads strictly sanitize access tokens, passwords, and signing secrets.

---

## 7. Required Environment Variables

Add to `server/.env`:
```env
# ReconAI 2.0 - Phase 3 Authentication & Security Configuration
JWT_SECRET=your-32-character-min-secure-jwt-secret-here
JWT_EXPIRES_IN=1h
JWT_ISSUER=reconai-auth-service
JWT_AUDIENCE=reconai-api
SERVICE_TOKEN_SECRET=your-32-character-min-service-token-secret-here
SERVICE_TOKEN_AUDIENCE=reconai-service
```
*(No real credentials are committed).*

---

## 8. Verification & Test Summary

- **Backend Test Suite:** 50 test files passed (50/50), 288 tests passed (288/288).
- **Security Hardening Suite:** 19/19 tests passed covering production secret validation, salted scrypt hashing, account provenance, fixed service credential binding, durable TTL revocation, immediate authorization-lifetime validation, and 503 production fail-closed behavior.
- **Auditor Tenant Isolation Suite:** 6/6 integration tests passed verifying scoped auditor restrictions, cross-tenant denial, mutation prohibition (403), global audit grant verification, and audit trail logging.
- **Deterministic Reconciliation Engine:** 120/120 scenarios evaluated at 100.00% accuracy.
- **Frontend Production Build:** `vite build` completed successfully with 0 errors.
- **Git Hygiene:** `git diff --check` executed with 0 errors.
- **Financial Safety:** Provider write execution endpoints remain completely absent. Phase 4 webhook and multi-agent workers have not started.
