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
      "totalAmountProcessedPaise": 100309582,
      "autoReconciledAmountPaise": 71702000,
      "amountUnderReviewPaise": 28607582,
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

## Track 4 Phase 1 Architecture Plan (Proposed Phase 2 Endpoints)

### `POST /api/finance-controller/run` (PLANNED)
Triggers autonomous Track 4 Finance Controller agent batch execution.

### `GET /api/finance-controller/runs` (PLANNED)
Lists historical controller agent batch runs.

### `GET /api/finance-controller/runs/:runId` (PLANNED)
Retrieves status, state history, and metrics for a specific controller run.

### `GET /api/finance-controller/runs/:runId/report` (PLANNED)
Retrieves the complete Track 4 Finance Controller Report (match rate, unresolved exception list, throughput, financial summary).

### `GET /api/finance-controller/runs/:runId/status` (PLANNED)
Lightweight polling endpoint for active controller state machine status.

