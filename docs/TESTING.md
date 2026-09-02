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

- **Total Test Files**: 41
- **Total Unit & Integration Tests**: 170 / 170 Passing (0 Failing)
- **Engine Benchmark Accuracy**: 120 / 120 (100.00%)
- **Frontend Production Build**: PASS (0 errors)
