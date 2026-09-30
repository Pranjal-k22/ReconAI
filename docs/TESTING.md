# ReconAI — Testing Strategy & Verification Architecture

ReconAI employs a multi-tiered test suite ensuring deterministic matching accuracy, GroundTruth isolation, AI safety boundaries, PII redacting, and API contract robustness.

---

## Test Execution

Run the backend test suite:

```bash
cd server
npm test
```

Build the frontend client bundle:

```bash
cd client
npm run build
```

---

## Test Suite Architecture

```text
server/tests/
├── ai/
│   ├── aiSchemas.test.js              # Zod AI output schema validation & recommendation allow-list
│   ├── exceptionInvestigator.test.js  # Business AI investigator & payload minimization
│   ├── fallbackExplanation.test.js    # Deterministic fallback explanations for 11 exception types
│   └── geminiService.test.js          # Google GenAI provider infrastructure & 15s timeout
│
├── audit/
│   └── auditService.test.js           # Central audit trail & recursive secret redacting ([REDACTED])
│
├── demo/
│   └── benchmarkGenerator.test.js     # PRNG seed validation & 120-scenario dataset distribution
│
├── evaluation/
│   └── evaluationService.test.js      # Benchmark evaluation metrics (Accuracy, Precision, Recall, F1)
│
├── exceptions/
│   ├── exceptionService.test.js       # Exception case persistence & compound unique index
│   ├── humanReviewService.test.js     # Human decision workflow & classification preservation
│   ├── safetyGate.test.js             # Safety Gate policy & anomaly lockout rules
│   └── severityService.test.js        # Deterministic exception severity scoring
│
├── models/
│   ├── auditLog.test.js
│   ├── exceptionCase.test.js
│   ├── gatewayPayment.test.js
│   ├── groundTruth.test.js
│   ├── merchantOrder.test.js
│   ├── reconciliationModels.test.js
│   └── settlementRecord.test.js
│
├── razorpay/
│   ├── paymentSyncService.test.js     # Paginated payment fetching & bulk upsert
│   ├── razorpayClient.test.js         # Test Mode Safety Guard (blocking rzp_live_ keys)
│   ├── razorpayIsolationGuard.test.js # Proof of zero engine/GroundTruth imports
│   ├── razorpayNormalizer.test.js     # PII stripping (email, phone, VPA) & net amount signed math
│   └── settlementSyncService.test.js  # Settlement recon sync & line item hash IDs
│
├── reconciliation/
│   ├── aiSeparation.test.js           # Proof that AI is never invoked in batch reconciliation
│   ├── benchmarkCompatibility.test.js # 120-scenario engine compatibility test (100% accuracy)
│   ├── candidateMatcher.test.js       # Evidence hierarchy & reference matching
│   ├── confidenceEngine.test.js       # Match rule weights & confidence calculation
│   ├── groundTruthIsolationGuard.test.js # Static isolation guard preventing GroundTruth imports in engine
│   ├── matchingEngine.test.js         # Pure in-memory matching engine unit tests
│   ├── metricsService.test.js         # Operational metrics & sum invariant validation
│   ├── normalizationService.test.js   # Input payload string/money normalization
│   └── safetyGate.test.js             # Auto-resolution vs human review isolation
│
└── routes/
    ├── aiInvestigationRoutes.test.js  # REST API integration tests
    ├── auditRoutes.test.js
    ├── exceptionRoutes.test.js
    ├── razorpayRoutes.test.js
    └── reconciliationRoutes.test.js
```

---

## GroundTruth Architecture Isolation Guard

The file `server/tests/reconciliation/groundTruthIsolationGuard.test.js` statically inspects all source code files inside `server/src/services/reconciliation/` to verify zero import statements referencing `GroundTruth.js` or `ground_truth.json`.

GroundTruth answer keys are strictly imported ONLY inside `server/src/services/evaluation/evaluationService.js`.

---

## Verified Test Baseline

- **Total Test Files**: 42
- **Total Unit & Integration Tests**: 183 / 183 Passing (0 Failing)
- **Engine Benchmark Accuracy**: 120 / 120 (100.00%)
- **Frontend Production Build**: PASS (0 errors)


---

## Track 4 Phase 2 Implementation

### CURRENTLY IMPLEMENTED
- **Finance Controller Agent**: Autonomous state-machine backend service in [`financeControllerAgent.js`](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/src/services/finance/financeControllerAgent.js) (`IDLE` → `INGESTING` → `VALIDATING` → `RECONCILING` → `SAFETY_EVALUATION` → `EXCEPTION_PROCESSING` → `REPORTING` → `COMPLETED`).
- **Finance Controller Model**: Mongoose model in [`FinanceControllerRun.js`](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/src/models/FinanceControllerRun.js).
- **Controller REST API**: Endpoints in [`financeController.js`](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/src/controllers/financeController.js) and [`financeRoutes.js`](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/src/routes/financeRoutes.js) (`POST /api/finance-controller/run`, `GET /api/finance-controller/runs`, `GET /api/finance-controller/runs/:runId`, `GET /api/finance-controller/runs/:runId/report`, `GET /api/finance-controller/runs/:runId/status`).
- **Controller Test Suite**: Unit, state machine, safety, and REST route tests in [`financeControllerAgent.test.js`](file:///c:/WEB%20DEVELOPMENT/ReconAI/server/tests/finance/financeControllerAgent.test.js) (11 tests, 100% passing).
- **Live Verification Script**: Script in `server/scripts/testFinanceControllerRun.js` verifying 0 invariant mismatches between direct matching engine and controller agent.

### VERIFIED
- **Backend Test Suite**: 42 test files, 181 tests passed (0 failing, 0 skipped).
- **Direct Engine vs Controller Parity**: 120/120 scenarios matched identically with zero invariant mismatches.
- **Frontend Build**: Vite build passed cleanly in 8.60s.

---

## Track 4 Phase 3A — Metric + Progress Semantics Verification

### VERIFIED TEST RESULTS
- **Backend Test Suite**: 42 test files, **183/183 tests passed** (0 failing, 0 skipped).
- **Frontend Build**: Vite production build completed cleanly in 7.69s (0 errors).
- **Throughput Verification**: `Controller Throughput` verified at **12.51 records/sec** for full persisted controller workflow (including ingestion, validation, DB persistence of results & exceptions, safety gate evaluation, and automated AI exception investigation dispatch).
- **Financial Sum Invariant**: Verified $\text{₹10,30,180.00} = \text{₹7,17,020.00} + \text{₹3,13,160.00}$.
- **Unresolved Exceptions**: Verified 40 exceptions in `OPEN` / `UNDER_REVIEW` status.
- **Safety Invariant**: Gemini AI verified 100% advisory with zero financial execution authority.


