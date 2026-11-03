# ReconAI 2.0 — Read-Only Workspace API Contract Inventory

This document defines the strict, code-derived read contract for the read-only operator workspace (`client`). All specifications are extracted directly from authoritative backend route handlers in `server/src/routes/paymentCaseRoutes.js` and `server/src/routes/paymentEventRoutes.js`.

---

## 1. Summary of Workspace Endpoints

| Resource | HTTP Method | Path | Allowed Roles | Scoping Mechanism |
|---|---|---|---|---|
| Payment Cases List | `GET` | `/api/payment-cases` | `ADMIN`, `SHOP`, `AUDITOR` | Tenant from JWT token (ADMIN system-wide) |
| Payment Case Detail | `GET` | `/api/payment-cases/:caseId` | `ADMIN`, `SHOP`, `AUDITOR` | Tenant ownership validated; mismatch yields 404 |
| Case Classification | `GET` | `/api/payment-cases/:caseId/classification` | `ADMIN`, `SHOP`, `AUDITOR` | Latest `EvidenceRecord`; customer/service roles yield 403 |
| Case Events Timeline | `GET` | `/api/payment-events/case/:caseId` | `ADMIN`, `SHOP`, `AUDITOR` | Append-only normalized lifecycle events |
| Multi-Agent Investigations | `GET` | `/api/payment-cases/:caseId/investigations` | `ADMIN`, `SHOP`, `AUDITOR` | Multi-agent investigation runs and advisory cards |
| Evidence Records | `GET` | `/api/payment-cases/:caseId/evidence` | `ADMIN`, `SHOP`, `AUDITOR` | Supporting evidence audit records |
| Policy Decisions | `GET` | `/api/payment-cases/:caseId/policy/decisions` | `ADMIN`, `SHOP`, `AUDITOR` | Deterministic resolution decisions & limits config version |
| Provider Operations | `GET` | `/api/payment-cases/:caseId/provider/operations` | `ADMIN`, `SHOP`, `AUDITOR` | Historical external provider operations (read-only audit) |
| Controlled Admin Classify | `POST` | `/api/payment-cases/:caseId/classify` | `ADMIN` | Re-evaluates deterministic classification against stored records; strict empty body `{}` |
| Controlled Admin Investigate | `POST` | `/api/payment-cases/:caseId/investigate` | `ADMIN` | Executes advisory multi-agent AI investigation; cost-guarded; strict empty body `{}` |

---

## 2. Detailed Endpoint Contracts

### 2.1 GET `/api/payment-cases`
- **Handler**: `server/src/routes/paymentCaseRoutes.js:48`
- **Authorized Roles**: `ADMIN`, `SHOP` (own tenant), `AUDITOR` (own tenant / `GLOBAL_AUDIT`)
- **Query Parameters**:
  - `page` (optional integer, default `1`)
  - `limit` (optional integer, default `50`)
  - `resolutionCaseStatus` (optional string enum)
  - `isSafeHold` (optional boolean string: `"true"` / `"false"`)
- **Response Format**:
  ```json
  {
    "success": true,
    "data": {
      "cases": [
        {
          "caseId": "CASE-...",
          "tenantId": "...",
          "gatewayPaymentId": "pay_...",
          "merchantOrderId": "order_...",
          "orderStatus": "ORDER_CREATED",
          "captureStatus": "CAPTURE_CAPTURED",
          "resolutionCaseStatus": "CASE_DETECTED",
          "discrepancyCategory": "STATUS_MISMATCH",
          "isSafeHold": false,
          "safeHoldReason": null,
          "detectedAt": "2026-10-26T...",
          "updatedAt": "2026-10-26T..."
        }
      ],
      "pagination": {
        "page": 1,
        "limit": 50,
        "total": 1,
        "pages": 1
      }
    }
  }
  ```

---

### 2.2 GET `/api/payment-cases/:caseId`
- **Handler**: `server/src/routes/paymentCaseRoutes.js:81`
- **Authorized Roles**: `ADMIN`, `SHOP` (own tenant), `AUDITOR` (own tenant / `GLOBAL_AUDIT`)
- **Path Parameters**: `:caseId` (string)
- **Response Format**:
  ```json
  {
    "success": true,
    "data": {
      "caseId": "CASE-...",
      "tenantId": "...",
      "gatewayPaymentId": "pay_...",
      "merchantOrderId": "order_...",
      "orderStatus": "ORDER_CREATED",
      "captureStatus": "CAPTURE_CAPTURED",
      "authorizationStatus": null,
      "refundStatus": null,
      "disputeStatus": null,
      "customerDebitStatus": null,
      "resolutionCaseStatus": "CASE_DETECTED",
      "discrepancyCategory": "STATUS_MISMATCH",
      "isSafeHold": true,
      "safeHoldReason": "...",
      "detectedAt": "2026-10-26T...",
      "updatedAt": "2026-10-26T..."
    }
  }
  ```

---

### 2.3 GET `/api/payment-cases/:caseId/classification`
- **Handler**: `server/src/routes/paymentCaseRoutes.js:600`
- **Authorized Roles**: `ADMIN`, `SHOP` (own tenant), `AUDITOR` (own tenant / `GLOBAL_AUDIT`)
- **Forbidden Roles**: `CUSTOMER`, `CUSTOMER_AI`, `SHOP_AI`, `PAYMENT_CONTROLLER`, all service principals (returns HTTP 403)
- **Response Format** (sanitized, secrets redacted):
  ```json
  {
    "success": true,
    "data": {
      "recordId": "EVID-...",
      "tenantId": "...",
      "caseId": "...",
      "scenarioId": "CASE_22_PAYMENT_CAPTURED_ORDER_CANCELLED",
      "category": "STATUS_MISMATCH",
      "reasonCode": "PAYMENT_CAPTURED_ORDER_CANCELLED",
      "confidence": 1.0,
      "facts": [
        {
          "dimension": "gatewayPayment.status",
          "value": "CAPTURED",
          "source": "GATEWAY_WEBHOOK",
          "authority": "GATEWAY_PROVIDER"
        }
      ],
      "claims": [
        {
          "claimType": "CUSTOMER_CLAIM",
          "statement": "...",
          "verified": false
        }
      ],
      "missingEvidence": [],
      "contradictions": [],
      "safeHold": true,
      "safeHoldCode": "ORDER_CANCELLED_PAYMENT_CAPTURED",
      "safeHoldReason": "Payment captured for an order marked cancelled",
      "suggestedNextStep": "ADVISORY_HOLD_FOR_MANUAL_REVIEW",
      "evaluationKey": "...",
      "inputHash": "...",
      "recordHash": "...",
      "evaluatedAt": "2026-10-26T..."
    }
  }
  ```

---

### 2.4 GET `/api/payment-events/case/:caseId`
- **Handler**: `server/src/routes/paymentEventRoutes.js:47`
- **Authorized Roles**: `ADMIN`, `SHOP` (own tenant), `AUDITOR`
- **Response Format**:
  ```json
  {
    "success": true,
    "data": [
      {
        "eventId": "evt_...",
        "tenantId": "...",
        "caseId": "...",
        "gatewayPaymentId": "pay_...",
        "merchantOrderId": "order_...",
        "sourceSystem": "GATEWAY_WEBHOOK",
        "normalizedEventType": "PAYMENT_CAPTURED",
        "amountPaise": 10000,
        "currency": "INR",
        "ingestedAt": "2026-10-26T...",
        "providerOccurredAt": "2026-10-26T..."
      }
    ]
  }
  ```

---

### 2.5 GET `/api/payment-cases/:caseId/investigations`
- **Handler**: `server/src/routes/paymentCaseRoutes.js:205`
- **Authorized Roles**: `ADMIN`, `SHOP` (own tenant), `AUDITOR`
- **Response Format**:
  ```json
  {
    "success": true,
    "data": [
      {
        "investigationId": "inv_...",
        "caseId": "...",
        "tenantId": "...",
        "status": "COMPLETED",
        "modelUsed": "FALLBACK_DETERMINISTIC",
        "customerPerspective": { "perspective": "...", "unverifiedClaims": [], "confidence": 0.8 },
        "shopPerspective": { "perspective": "...", "confidence": 0.95 },
        "investigatorFindings": { "perspective": "...", "contradictions": [], "confidence": 0.99 },
        "resolutionProposal": { "suggestedAction": "...", "reasons": [] },
        "evidenceCards": [],
        "durationMs": 45,
        "isExecutable": false,
        "authoritative": false,
        "createdAt": "2026-10-26T..."
      }
    ]
  }
  ```

---

### 2.6 GET `/api/payment-cases/:caseId/evidence`
- **Handler**: `server/src/routes/paymentCaseRoutes.js:229`
- **Authorized Roles**: `ADMIN`, `SHOP` (own tenant), `AUDITOR`
- **Response Format**: Same structure as `GET /api/payment-cases/:caseId/investigations` representing historical evidence runs.

---

### 2.7 GET `/api/payment-cases/:caseId/policy/decisions`
- **Handler**: `server/src/routes/paymentCaseRoutes.js:321`
- **Authorized Roles**: `ADMIN`, `SHOP` (own tenant), `AUDITOR`
- **Response Format**:
  ```json
  {
    "success": true,
    "data": [
      {
        "decisionId": "dec_...",
        "tenantId": "...",
        "caseId": "...",
        "proposedActionType": "REQUEST_REFUND",
        "outcomeStatus": "SAFE_HOLD",
        "appliedRuleIds": ["R_LATE_CAPTURE_CANCELLED_ORDER_HOLD"],
        "decisionReasons": ["Late capture on cancelled order triggers mandatory hold"],
        "allowReasons": [],
        "denyReasons": ["Cancelled order requires manual human review"],
        "missingEvidence": [],
        "amountPaise": 5000,
        "currency": "INR",
        "policyVersion": "2026-10-12.v1",
        "policyConfigVersion": 1,
        "policyConfigHash": "...",
        "classificationRecordId": "EVID-...",
        "classificationInputHash": "...",
        "createdAt": "2026-10-26T..."
      }
    ]
  }
  ```

---

### 2.8 GET `/api/payment-cases/:caseId/provider/operations`
- **Handler**: `server/src/routes/paymentCaseRoutes.js:424`
- **Authorized Roles**: `ADMIN`, `SHOP` (own tenant), `AUDITOR`
- **Response Format**:
  ```json
  {
    "success": true,
    "data": [
      {
        "operationId": "op_...",
        "tenantId": "...",
        "caseId": "...",
        "gatewayPaymentId": "pay_...",
        "operationType": "REFUND",
        "operationStatus": "REQUESTED",
        "provider": "RAZORPAY",
        "amountPaise": 5000,
        "currency": "INR",
        "idempotencyKey": "idem_...",
        "createdAt": "2026-10-26T..."
      }
    ]
  }
  ```

---

### 2.9 POST `/api/payment-cases/:caseId/classify`
- **Handler**: `server/src/routes/paymentCaseRoutes.js`
- **Authorized Roles**: `ADMIN` only (`requireRoles(ROLES.ADMIN)`). All other roles return HTTP 403 Forbidden.
- **Request Body**: Strict empty body `{}` (`if (req.body && Object.keys(req.body).length > 0) throw 400 Bad Request`).
- **Behavior**: Loads authoritative case and dependent records, builds classifier context, evaluates deterministic precedence rules, persists fresh `EvidenceRecord`, and appends `CASE_CLASSIFIED` audit event.
- **Audit Failure Safety**: Audit event logging is mandatory; returns HTTP 503 if audit fails.

### 2.10 POST `/api/payment-cases/:caseId/investigate`
- **Handler**: `server/src/routes/paymentCaseRoutes.js`
- **Authorized Roles**: `ADMIN` only (`requireRoles(ROLES.ADMIN)`). Customer access was deprecated in Stage 8b; non-ADMIN roles receive HTTP 403 Forbidden.
- **Request Body**: Strict empty body `{}` (`if (req.body && Object.keys(req.body).length > 0) throw 400 Bad Request`).
- **Cost Guard**: Enforces persistent MongoDB rate limits via `investigationCostGuard.js` (`AI_INVESTIGATION_HOURLY_ADMIN_LIMIT`, etc.). Exceeding quota returns HTTP 429 Rate Limit Exceeded.
- **Audit Logging & Rollback**: Records `INVESTIGATION_PERFORMED`. If audit persistence fails, newly created `AiInvestigationRun` is rolled back (deleted) and HTTP 503 is returned.
- **Advisory Only**: All output cards carry `isExecutable: false` and `authoritative: false`.

## 3. Security and Scoping Invariants

1. **Token-Only Scoping & Storage**:
   - The workspace NEVER sends an `x-tenant-id` header or URL tenant parameter.
   - For `SHOP` and `AUDITOR` users, the tenant is strictly bound to the authenticated JWT payload on the backend.
   - For `ADMIN` users in Stage 6b, no tenant selector is provided in the workspace UI.
   - Token Storage & XSS Consequence: In Stage 6b, the bearer JWT token is stored in the browser's `localStorage` under key `reconai_token` (`client/src/context/AuthContext.jsx:31,43`). Security consequence: Bearer tokens in `localStorage` can be read by any JavaScript running in the origin, meaning any XSS defect would allow token exfiltration and session impersonation. Production hardening roadmap requires migration to `httpOnly`, `Secure`, `SameSite=Strict` cookies.
2. **Sentinel Exclusion**:
   - The internal sentinel tenant `unassigned_provider_quarantine` is unconditionally excluded from all workspace queries and returns 404 / empty array.
3. **Strict Read-Only Enforcement for Financial Mutations**:
   - The client workspace contains zero dispatch, release, edit, or refund controls anywhere in the UI.
   - Exactly two controlled non-financial actions are exposed strictly for `ADMIN`: re-classification (`POST /api/payment-cases/:caseId/classify`) and advisory investigation (`POST /api/payment-cases/:caseId/investigate`), both enforcing strict empty bodies `{}` and fail-closed audit logging.
   - Customer claims intake (`POST /api/claims`, `GET /api/claims`) is strictly isolated in `client/src/api/claimsApi.js` as unverified evidence only.
