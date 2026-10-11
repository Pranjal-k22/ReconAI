# ReconAI — REST API Specification

Base URL: `/api`

All API responses follow the standard ReconAI payload envelope:

```json
{
  "success": true,
  "data": { ... }
}
```

Error responses follow:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable error description",
    "details": null
  }
}
```

---

## 0. Authentication & Identity REST APIs (Added 12/10/2026)

ReconAI 2.0 enforces cryptographic authentication and deny-by-default role authorization on all non-public endpoints.

### Authentication Headers
- **Human User Session:** `Authorization: Bearer <jwt>`
- **Machine / AI Service Token:** `x-service-token: <jwt>` or `Authorization: Bearer <jwt>`
- **Service Credential Issuance:** `x-service-id: <serviceId>` and `x-service-secret: <secret>` (or in JSON request body)

---

### `POST /api/auth/login`
Authenticates a human user principal using memory-hard salted `scrypt` hashing.

**Request Body:**
```json
{
  "identifier": "admin@reconai.local",
  "password": "SecurePassword123!"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "userId": "usr_admin_01",
      "email": "admin@reconai.local",
      "role": "ADMIN",
      "tenantId": null,
      "customerId": null,
      "scopes": ["GLOBAL_AUDIT"]
    }
  }
}
```

---

### `POST /api/auth/service-token`
Issues a short-lived machine service JWT bound strictly to the service principal's persistent record in MongoDB.

**Request Headers / Body:**
```json
{
  "serviceId": "svc_customer_ai",
  "serviceSecret": "reconai-service-token-secret-32chars-min!:customer_ai"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "service": {
      "serviceId": "svc_customer_ai",
      "role": "CUSTOMER_AI",
      "tenantId": "sh_merchant_alpha",
      "customerId": "cust_4421",
      "scopes": ["READ_CUSTOMER_EVIDENCE"],
      "credentialVersion": 1
    }
  }
}
```

---

### `GET /api/auth/me`
Returns current session profile. Evaluates current server authorization state live from the persistent datastore on every request.

**Headers:**
`Authorization: Bearer <token>` or `x-service-token: <token>`

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "user": {
      "sub": "svc_customer_ai",
      "identityType": "SERVICE",
      "role": "CUSTOMER_AI",
      "tenantId": "sh_merchant_alpha",
      "customerId": "cust_4421",
      "scopes": ["READ_CUSTOMER_EVIDENCE"]
    }
  }
}
```

---

### `POST /api/auth/logout`
Terminates human session and durably registers the token's `jti` in the MongoDB `RevokedToken` collection.

**Headers:**
`Authorization: Bearer <token>`

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "message": "Session logged out and token revoked successfully"
  }
}
```

---

## 1. Health Endpoint

### `GET /api/health`
Returns system health and live MongoDB database connection status.

**Response (200 OK):**
```json
{
  "success": true,
  "service": "reconai-api",
  "status": "healthy",
  "database": {
    "status": "connected",
    "host": "cluster0.mongodb.net",
    "name": "reconai"
  }
}
```

---

## 2. Reconciliation REST APIs

### `POST /api/reconciliation/runs`
Executes a batch reconciliation run using the pure deterministic matching engine.

**Request Body:**
```json
{
  "name": "ReconAI Demo Benchmark",
  "sourceMode": "SYNTHETIC"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "data": {
    "runId": "RUN-20260902122249-2EZ2",
    "status": "COMPLETED_WITH_EXCEPTIONS",
    "processedRecords": 120,
    "durationMs": 535,
    "metrics": {
      "totalScenarios": 120,
      "matchedCount": 80,
      "exceptionCount": 40,
      "autoReconciledCount": 80,
      "manualReviewCount": 40,
      "autoReconciliationRate": 0.6667,
      "totalAmountProcessedPaise": 103018000,
      "autoReconciledAmountPaise": 71702000,
      "amountUnderReviewPaise": 31316000,
      "classificationBreakdown": {
        "MATCHED": 80,
        "AMOUNT_MISMATCH": 8,
        "MISSING_SETTLEMENT": 6,
        "DUPLICATE_PAYMENT": 5,
        "FEE_MISMATCH": 5,
        "REFUND_MISMATCH": 4,
        "MISSING_PAYMENT": 4,
        "REFERENCE_MISMATCH": 3,
        "AMBIGUOUS": 3,
        "INVALID_DATA": 2
      }
    }
  }
}
```

### `GET /api/reconciliation/runs`
Lists reconciliation runs with pagination.

**Query Parameters:** `page`, `limit`.

### `GET /api/reconciliation/runs/:runId`
Retrieves run metadata and metrics for a run ID.

### `GET /api/reconciliation/runs/:runId/results`
Retrieves paginated result records for a run.

**Query Parameters:** `classification`, `requiresReview`, `resolutionStatus`, `page`, `limit`.

### `GET /api/reconciliation/runs/:runId/metrics`
Retrieves operational metrics for a run.

### `GET /api/reconciliation/runs/:runId/evaluation`
Evaluates run results against GroundTruth benchmark.

---

## 3. Exceptions REST APIs

### `GET /api/exceptions`
Lists ExceptionCase records with filtering and pagination.

**Query Parameters:** `status`, `type`, `severity`, `merchantOrderId`, `runId`, `page`, `limit`.

### `GET /api/exceptions/summary`
Retrieves aggregate summary metrics for all exceptions.

### `GET /api/exceptions/:exceptionId`
Retrieves a single ExceptionCase with associated ReconciliationResult.

### `PATCH /api/exceptions/:exceptionId/decision`
Applies a human review decision (`KEEP_EXCEPTION`, `APPROVE_MATCH`, `MARK_RESOLVED`).

**Request Body:**
```json
{
  "decision": "KEEP_EXCEPTION",
  "resolutionNotes": "Reviewed candidate payment evidence. Kept in queue for merchant confirmation.",
  "actorId": "demo-finance-reviewer"
}
```

### `POST /api/exceptions/:exceptionId/investigate`
Triggers on-demand AI (or deterministic fallback) investigation for an exception.

---

## 4. Audit REST APIs

### `GET /api/audit`
Queries append-only audit logs with filtering and pagination.

**Query Parameters:** `runId`, `action`, `entityType`, `entityId`, `actorType`, `page`, `limit`.

### `GET /api/audit/:eventId`
Retrieves a single audit log event by eventId.

---

## 5. Razorpay & Integrations APIs

### `GET /api/integrations/status`
Returns safe integration status for Gemini, Razorpay, and MongoDB.

### `POST /api/razorpay/sync/payments`
Triggers READ-ONLY payment fetch and sync from Razorpay Test Mode.

### `POST /api/razorpay/sync/settlements`
Triggers READ-ONLY settlement reconciliation fetch and sync from Razorpay Test Mode.

---

---

## 6. Finance Controller REST APIs

### `POST /api/finance-controller/run`
Triggers autonomous Track 4 Finance Controller agent batch execution across synthetic scenarios.

**Request Body:**
```json
{
  "batchSize": 120,
  "triggerSource": "DEMO_BENCHMARK",
  "enableAiInvestigation": true
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "data": {
    "runId": "FCRUN-20260930112205-FLIR",
    "status": "COMPLETED_WITH_EXCEPTIONS",
    "durationMs": 9592,
    "metrics": {
      "batchSize": 120,
      "processedRecords": 120,
      "matchedRecords": 80,
      "exceptionRecords": 40,
      "autoResolvedRecords": 80,
      "manualReviewRecords": 40,
      "unresolvedRecords": 40,
      "matchRate": 66.67,
      "exceptionRate": 33.33,
      "throughput": 12.51,
      "totalAmountProcessedPaise": 103018000,
      "autoReconciledAmountPaise": 71702000,
      "amountUnderReviewPaise": 31316000
    }
  }
}
```

### `GET /api/finance-controller/runs`
Lists historical controller agent batch runs.

### `GET /api/finance-controller/runs/:runId`
Retrieves status, state history, and metrics for a specific controller run.

### `GET /api/finance-controller/runs/:runId/report`
Retrieves the complete Track 4 Finance Controller Report (13 operational metrics, financial sum invariant, unresolved exception list, dynamic classification & severity summaries, throughput semantics, and benchmark accuracy evaluation).

### `GET /api/finance-controller/runs/:runId/status`
Lightweight status endpoint for controller state machine execution.


