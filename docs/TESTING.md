# ReconAI — Testing Strategy & Verification Architecture

ReconAI employs a multi-tiered test suite ensuring deterministic matching accuracy, multi-tenant isolation, cryptographic webhook verification, GroundTruth isolation, AI advisory boundaries, PII redaction, API contracts, and client read-only invariant safety.

---

## 1. Test Execution Commands

### Server Unit Tests
```bash
npm test --prefix server
# Executes 795 unit tests across 80 test files (fast, mock/in-memory)
```

### Server Integration Tests (Real MongoDB)
```bash
npm run test:integration --prefix server
# Executes 156 integration tests across 14 test files against real MongoDB instances
```

### Track 4 Deterministic Benchmark Scenarios
```bash
npx vitest run tests/reconciliation/benchmarkCompatibility.test.js --dir server
# Evaluates reconciliation engine against all 120 synthetic benchmark scenarios (100.00% match rate)
```

### Production Monitoring & Provider-Read Smoke Test
```bash
node server/scripts/monitoringSmokeTest.js
# Executes 7 production startup, worker loop, DB readiness, and provider-read isolation gates
```

### Client Unit & Workspace Invariant Tests
```bash
npm test --prefix client
# Executes 26 Vitest + React Testing Library tests across 5 test files
```

### Client Production Bundle Compilation
```bash
npm run build --prefix client
# Compiles optimized production bundle into client/dist/ (verified clean, 0 errors, built in 17.51s)
```

---

## 2. Test Suite Architecture

```text
server/tests/
├── ai/
│   ├── aiSchemas.test.js                 # Zod structured output & recommendation allow-list
│   ├── exceptionInvestigator.test.js     # Business exception investigator payload minimization
│   ├── fallbackExplanation.test.js       # Deterministic fallback explanations
│   ├── geminiService.test.js             # Google GenAI provider infrastructure & 15s timeout
│   └── multiAgentInvestigation.test.js   # Four-perspective advisory multi-agent run tests
│
├── audit/
│   └── auditService.test.js              # Central audit trail & recursive secret redacting ([REDACTED])
│
├── auth/
│   ├── authAndRbac.test.js               # Salted scrypt hashing, JWT issuance & 5-role RBAC enforcement
│   ├── quarantineSentinelRejection.test.js # Quarantine sentinel rejection invariants
│   ├── securityHardening.test.js         # Token revocation, timing attack mitigation & tampering tests
│   └── tenantIsolation.test.js           # Multi-tenant scoping and cross-tenant boundary tests
│
├── classification/
│   ├── classifierPrecedenceInvariant.test.js # regex over comments and Function#toString branch counting (40 rules)
│   ├── evidenceClassifier.test.js        # 30 canonical payment scenario classification rules
│   ├── evidencePrecedence.test.js        # Precedence hierarchy and contradiction stability (36 pairs)
│   ├── inputHashClockStability.test.js   # Clock-stable input hash and staleness invariant tests
│   └── noAdminHoldWriters.test.js        # Ensures safe-hold codes originate solely from classifier
│
├── demo/
│   └── benchmarkGenerator.test.js        # PRNG seed validation & 120-scenario dataset distribution
│
├── evaluation/
│   └── evaluationService.test.js         # Benchmark evaluation metrics (Accuracy, Precision, Recall, F1)
│
├── exceptions/
│   ├── exceptionService.test.js          # Exception case persistence & compound unique index
│   ├── humanReviewService.test.js        # Human decision workflow & classification preservation
│   ├── safetyGate.test.js                # Safety Gate policy & anomaly lockout rules
│   └── severityService.test.js           # Deterministic exception severity scoring
│
├── finance/
│   ├── controllerMetricsAndReporting.test.js # 13 operational metrics & financial sum invariant
│   ├── controllerSafetyAndHardening.test.js # Autonomous controller safety gates
│   └── financeControllerAgent.test.js    # Batch orchestration & autonomous controller state machine
│
├── integration/
│   ├── classificationHashDispatch.integration.test.js # Real-Mongo material-state classification hash tests
│   ├── classifierDbDriven.integration.test.js # Real-Mongo context building from database entities
│   ├── evidencePersistence.integration.test.js # Immutable EvidenceRecord persistence
│   ├── monitoringPersistence.integration.test.js # Polling task queue and worker execution
│   ├── multiAgentInvestigationPersistence.integration.test.js # Advisory agent runs persistence
│   ├── orchestrationPersistence.integration.test.js # Orchestration task workflow persistence
│   ├── policyConfigConcurrency.integration.test.js # Concurrent policy config activation safety
│   ├── policyLimitsGovernedE2E.integration.test.js # Two-person governance approval E2E tests
│   ├── policySimulationPersistence.integration.test.js # Dry-run simulation persistence
│   ├── productionStartup.integration.test.js # Real server bootstrap and dependency invariant tests
│   ├── providerSandboxDispatchPersistence.integration.test.js # Idempotent provider dispatch ledger
│   ├── quarantineSentinelIsolation.integration.test.js # 100% sentinel exclusion across all routes
│   ├── servicePersistence.integration.test.js # Persistent ServicePrincipal credential verification
│   └── webhookPersistence.integration.test.js # Webhook HMAC verification, deduplication & in-flight locks
│
├── ledger/
│   ├── paymentAction.test.js             # PaymentAction ledger operations
│   ├── paymentCase.test.js               # 8-dimension state machine transitions
│   └── paymentLifecycleEvent.test.js     # Append-only lifecycle event streams
│
├── models/
│   ├── auditLog.test.js
│   ├── exceptionCase.test.js
│   ├── gatewayPayment.test.js
│   ├── groundTruth.test.js
│   ├── merchantOrder.test.js
│   ├── reconciliationModels.test.js
│   ├── servicePrincipal.test.js
│   └── settlementRecord.test.js
│
├── monitoring/
│   ├── monitoringRuntimeWiring.test.js   # Background worker loop wiring
│   ├── monitoringScheduler.test.js       # Durable task queue and exponential backoff
│   └── paymentStateMachine.test.js       # Monotonic state progression rules
│
├── orchestration/
│   ├── orchestrationStateMachine.test.js # Orchestration state progression
│   └── orchestratorGateAndService.test.js # Task enqueuing and concurrency safety
│
├── policy/
│   ├── limitSemanticsTruth.test.js       # Fail-closed zero-limit semantics
│   ├── policyAuthorizationToken.test.js  # Cryptographic single-use policy token verification
│   ├── policyConfigValidation.test.js    # Two-person approval validation
│   ├── providerPreflightService.test.js  # Preflight read consistency verification
│   └── resolutionPolicyEvaluator.test.js # Policy decision evaluations
│
├── provider/
│   ├── providerOutcomeVerification.test.js # Idempotent provider outcome reconciliation
│   └── razorpaySandboxAdapter.test.js    # Sandbox write adapter invariants
│
├── razorpay/
│   ├── paymentSyncService.test.js        # Paginated payment fetching & bulk upsert
│   ├── razorpayClient.test.js            # Test Mode Safety Guard (blocking rzp_live_ keys)
│   ├── razorpayIsolationGuard.test.js    # Proof of zero engine/GroundTruth imports
│   ├── razorpayNormalizer.test.js        # PII stripping (email, phone, VPA) & signed math
│   └── settlementSyncService.test.js     # Settlement recon sync & line item hash IDs
│
├── reconciliation/
│   ├── aiSeparation.test.js              # Proof that AI is never invoked in batch reconciliation
│   ├── benchmarkCompatibility.test.js    # 120-scenario engine compatibility test (100% accuracy)
│   ├── candidateMatcher.test.js          # Evidence hierarchy & reference matching
│   ├── confidenceEngine.test.js          # Match rule weights & confidence calculation
│   ├── groundTruthIsolationGuard.test.js # Static isolation guard preventing GroundTruth imports
│   ├── matchingEngine.test.js            # Pure in-memory matching engine unit tests
│   ├── metricsService.test.js            # Operational metrics & sum invariant validation
│   ├── normalizationService.test.js      # Input payload string/money normalization
│   └── safetyGate.test.js                # Auto-resolution vs human review isolation
│
└── routes/
    ├── aiInvestigationRoutes.test.js
    ├── auditRoutes.test.js
    ├── exceptionRoutes.test.js
    ├── orchestrationRoutes.test.js
    ├── paymentCaseClassificationRoutes.test.js
    ├── paymentCaseInvestigationRoutes.test.js
    ├── paymentCasePolicyRoutes.test.js
    ├── paymentCaseProviderRoutes.test.js
    ├── paymentEventRoutes.test.js
    ├── policyConfigRoutes.test.js
    ├── razorpayRoutes.test.js
    ├── reconciliationRoutes.test.js
    └── workspaceApiContract.test.js      # Contract tests asserting response shapes for workspace GETs

client/src/tests/
├── setup.js                              # JSDOM & Testing Library setup
├── casesApi.test.js                      # Read-only export assertion & tenant header stripping
├── RoleGuard.test.jsx                    # Role-based route guard tests (Admin/Shop/Auditor vs Customer)
├── CasesListPage.test.jsx                # List view rendering, safe-hold queue filter, and age
├── CaseDetailPage.test.jsx               # 8-dimension grid, Case 22 banner, and XSS safety
└── formatMoney.test.js                   # Integer paise-to-INR math tests (0, 1 paise, large numbers)
```

---

## 3. Verified Verification Baseline (Stage 6)

| Harness | Target | Test Files | Total Tests | Passing | Failing |
| :--- | :--- | :---: | :---: | :---: | :---: |
| Server Unit Tests | `npm test --prefix server` | 80 | 795 | **795** | 0 |
| Server Integration Tests | `npm run test:integration --prefix server` | 14 | 156 | **156** | 0 |
| Benchmark Compatibility | `npx vitest run tests/reconciliation/...` | 1 | 120 | **120** | 0 |
| Client Unit Tests | `npm test --prefix client` | 5 | 26 | **26** | 0 |
| Production Smoke Test | `node server/scripts/monitoringSmokeTest.js` | 1 | 7 gates | **7** | 0 |
| Client Build | `npm run build --prefix client` | - | 0 errors | **BUILT (17.51s)** | 0 |
| **Total Automated Tests** | | **100** | **977** | **977** | **0** |
