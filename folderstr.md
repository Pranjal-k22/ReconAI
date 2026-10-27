# ReconAI Folder Structure (ReconAI 2.0 — Post Stage 6B)

```text
ReconAI/
├── client/
│   ├── public/
│   ├── src/
│   │   ├── api/
│   │   │   ├── auditApi.js
│   │   │   ├── axios.js
│   │   │   ├── casesApi.js               # Read-only operator workspace API layer (token-only tenant scoping)
│   │   │   ├── exceptionApi.js
│   │   │   ├── financeControllerApi.js
│   │   │   ├── integrationApi.js
│   │   │   ├── razorpayApi.js
│   │   │   └── reconciliationApi.js
│   │   ├── components/
│   │   │   ├── common/
│   │   │   │   ├── Badge.jsx
│   │   │   │   ├── Button.jsx
│   │   │   │   ├── Card.jsx
│   │   │   │   ├── EmptyState.jsx
│   │   │   │   ├── ErrorState.jsx
│   │   │   │   ├── ExpandableText.jsx    # Text-only expandable component (zero dangerouslySetInnerHTML)
│   │   │   │   ├── LoadingState.jsx
│   │   │   │   ├── MetricCard.jsx
│   │   │   │   ├── PageHeader.jsx
│   │   │   │   ├── Pagination.jsx
│   │   │   │   ├── RoleGuard.jsx         # Role-aware navigation barrier (Admin/Shop/Auditor vs Customer)
│   │   │   │   └── ToastContext.jsx
│   │   │   └── layout/
│   │   │       ├── AppLayout.jsx
│   │   │       ├── IntegrationStatus.jsx
│   │   │       ├── MobileSidebar.jsx
│   │   │       ├── Sidebar.jsx
│   │   │       └── Topbar.jsx
│   │   ├── constants/
│   │   │   └── app.js
│   │   ├── pages/
│   │   │   ├── AuditTrailPage.jsx
│   │   │   ├── CaseDetailPage.jsx        # 8-dimension state grid, facts vs claims, advisory cards, timeline
│   │   │   ├── CasesListPage.jsx         # Paginated payment cases, status filter, safe-hold queue view
│   │   │   ├── DashboardPage.jsx
│   │   │   ├── EvaluationPage.jsx
│   │   │   ├── ExceptionDetailPage.jsx
│   │   │   ├── ExceptionsPage.jsx
│   │   │   ├── ImportDataPage.jsx
│   │   │   ├── NotFoundPage.jsx
│   │   │   ├── RazorpaySyncPage.jsx
│   │   │   ├── ReconciliationDetailPage.jsx
│   │   │   └── ReconciliationRunsPage.jsx
│   │   ├── tests/
│   │   │   ├── CaseDetailPage.test.jsx
│   │   │   ├── CasesListPage.test.jsx
│   │   │   ├── RoleGuard.test.jsx
│   │   │   ├── casesApi.test.js
│   │   │   ├── formatMoney.test.js
│   │   │   └── setup.js
│   │   ├── utils/
│   │   │   ├── date.js
│   │   │   ├── enum.js
│   │   │   ├── formatMoney.js            # Pure integer paise-to-INR arithmetic (no float rounding)
│   │   │   └── money.js
│   │   ├── App.jsx
│   │   ├── index.css
│   │   └── main.jsx
│   ├── .env.example
│   ├── index.html
│   ├── package.json
│   ├── vercel.json
│   └── vite.config.js
│
├── server/
│   ├── data/
│   │   └── generated/
│   │       ├── dataset_summary.json
│   │       ├── gateway_payments.csv
│   │       ├── ground_truth.json
│   │       ├── merchant_orders.csv
│   │       └── settlements.csv
│   ├── scripts/
│   │   ├── captureScreenshotsCdp.js      # Headless browser automation via CDP for verification
│   │   ├── computeStrictReachability.js
│   │   ├── executeFreshRun.js
│   │   ├── generateDemoData.js
│   │   ├── introspectRoutes.js           # Introspects Express router stack (method | path | middleware)
│   │   ├── monitoringSmokeTest.js        # 7 production startup & provider-read isolation gates
│   │   ├── resetDemo.js
│   │   ├── runWorkspaceDemoServer.js     # Isolated local demo server on port 5000
│   │   ├── seedDemoData.js
│   │   ├── seedWorkspaceDemo.js          # Dev-only seed script (Tenants A & B, multi-role accounts, cases)
│   │   ├── testLiveReconciliationRun.js
│   │   └── testStep8AuditedRun.js
│   ├── src/
│   │   ├── config/
│   │   │   ├── database.js
│   │   │   ├── env.js
│   │   │   └── logger.js
│   │   ├── controllers/
│   │   │   ├── auditController.js
│   │   │   ├── authController.js
│   │   │   ├── exceptionController.js
│   │   │   ├── financeController.js
│   │   │   ├── healthController.js
│   │   │   ├── orchestrationController.js
│   │   │   ├── paymentActionController.js
│   │   │   ├── paymentCaseController.js
│   │   │   ├── paymentEventController.js
│   │   │   ├── policyConfigController.js
│   │   │   ├── razorpayController.js
│   │   │   ├── reconciliationController.js
│   │   │   └── webhookController.js
│   │   ├── middleware/
│   │   │   ├── authenticate.js
│   │   │   ├── errorHandler.js
│   │   │   ├── notFound.js
│   │   │   ├── rateLimiter.js
│   │   │   └── requireTenantScope.js
│   │   ├── models/
│   │   │   ├── helpers/
│   │   │   │   └── validators.js
│   │   │   ├── AiInvestigationRun.js
│   │   │   ├── AuditLog.js
│   │   │   ├── EvidenceRecord.js         # Immutable classification records with material recordHash
│   │   │   ├── ExceptionCase.js
│   │   │   ├── GatewayPayment.js
│   │   │   ├── GroundTruth.js
│   │   │   ├── MerchantOrder.js
│   │   │   ├── PaymentAction.js
│   │   │   ├── PaymentCase.js            # Canonical 8-dimension payment state machine record
│   │   │   ├── PaymentLifecycleEvent.js  # Append-only canonical lifecycle ledger
│   │   │   ├── PaymentMonitoringTask.js  # Durable background worker polling tasks with monotonic leases
│   │   │   ├── PolicyConfiguration.js    # Two-person governed monetary limit configurations
│   │   │   ├── PolicyDecision.js         # Formal policy evaluations with policyConfigVersion
│   │   │   ├── ProviderOperation.js      # Provider idempotency and read/write execution audit ledger
│   │   │   ├── ReconciliationResult.js
│   │   │   ├── ReconciliationRun.js
│   │   │   ├── ServicePrincipal.js       # Persistent machine service accounts
│   │   │   ├── SettlementRecord.js
│   │   │   └── UserAccount.js            # Human user accounts with memory-hard scrypt hashing
│   │   ├── routes/
│   │   │   ├── auditRoutes.js
│   │   │   ├── authRoutes.js
│   │   │   ├── exceptionRoutes.js
│   │   │   ├── financeRoutes.js
│   │   │   ├── healthRoutes.js
│   │   │   ├── orchestrationRoutes.js
│   │   │   ├── paymentActionRoutes.js
│   │   │   ├── paymentCaseRoutes.js      # List, detail, classification, evidence, investigations, policy
│   │   │   ├── paymentEventRoutes.js     # Lifecycle events query endpoints
│   │   │   ├── policyConfigRoutes.js     # Two-person policy limit proposals & activations
│   │   │   ├── razorpayRoutes.js
│   │   │   ├── reconciliationRoutes.js
│   │   │   └── webhookRoutes.js          # Cryptographic Razorpay HMAC SHA-256 ingress
│   │   ├── services/
│   │   │   ├── ai/
│   │   │   │   ├── aiSchemas.js
│   │   │   │   ├── exceptionInvestigator.js
│   │   │   │   ├── fallbackExplanation.js
│   │   │   │   ├── geminiService.js
│   │   │   │   ├── multiAgentInvestigator.js
│   │   │   │   └── promptSanitizer.js
│   │   │   ├── audit/
│   │   │   │   └── auditService.js
│   │   │   ├── auth/
│   │   │   │   ├── accountService.js
│   │   │   │   ├── serviceRegistry.js
│   │   │   │   └── tokenService.js
│   │   │   ├── classification/
│   │   │   │   ├── classificationService.js
│   │   │   │   ├── classifierContextBuilder.js # Material-state hash & canonical context builder
│   │   │   │   └── evidenceClassifier.js     # 30-scenario deterministic classification rules
│   │   │   ├── demo/
│   │   │   │   ├── benchmarkGenerator.js
│   │   │   │   ├── csvExporter.js
│   │   │   │   └── prng.js
│   │   │   ├── evaluation/
│   │   │   │   └── evaluationService.js
│   │   │   ├── exceptions/
│   │   │   │   ├── exceptionService.js
│   │   │   │   ├── humanReviewService.js
│   │   │   │   ├── safetyGateService.js
│   │   │   │   └── severityService.js
│   │   │   ├── finance/
│   │   │   │   ├── financeControllerAgent.js
│   │   │   │   └── syntheticFeePolicy.js
│   │   │   ├── ledger/
│   │   │   │   ├── paymentActionService.js
│   │   │   │   ├── paymentCaseService.js
│   │   │   │   └── paymentLifecycleEventService.js
│   │   │   ├── monitoring/
│   │   │   │   ├── monitoringWorker.js       # Background poller with monotonic leases and exponential backoff
│   │   │   │   └── paymentMonitoringService.js
│   │   │   ├── orchestration/
│   │   │   │   ├── orchestrationEngine.js
│   │   │   │   ├── orchestrationService.js
│   │   │   │   ├── orchestrationStateMachine.js
│   │   │   │   ├── orchestrationWorker.js
│   │   │   │   └── orchestratorGate.js
│   │   │   ├── policy/
│   │   │   │   ├── dispatchEvidenceCollector.js
│   │   │   │   ├── dryRunSimulatorService.js
│   │   │   │   ├── policyAuthorizationToken.js
│   │   │   │   ├── policyConfigService.js
│   │   │   │   ├── providerDispatchService.js
│   │   │   │   ├── providerPreflightService.js
│   │   │   │   ├── refundReservationService.js
│   │   │   │   └── resolutionPolicyEvaluator.js
│   │   │   ├── razorpay/
│   │   │   │   ├── paymentSyncService.js
│   │   │   │   ├── razorpayClient.js
│   │   │   │   ├── razorpayNormalizer.js
│   │   │   │   ├── razorpaySandboxAdapter.js
│   │   │   │   ├── razorpayStatusService.js
│   │   │   │   └── settlementSyncService.js
│   │   │   ├── reconciliation/
│   │   │   │   ├── anomalyClassifier.js
│   │   │   │   ├── candidateMatcher.js
│   │   │   │   ├── confidenceEngine.js
│   │   │   │   ├── matchingEngine.js
│   │   │   │   ├── metricsService.js
│   │   │   │   ├── normalizationService.js
│   │   │   │   └── reconciliationService.js
│   │   │   ├── stateMachine/
│   │   │   │   └── paymentStateMachine.js    # Monotonic 8-dimension lifecycle state transitions
│   │   │   └── webhook/
│   │   │       └── webhookService.js         # HMAC verification & in-flight concurrency locking
│   │   ├── utils/
│   │   │   ├── AppError.js
│   │   │   ├── asyncHandler.js
│   │   │   └── money.js
│   │   ├── validators/
│   │   │   ├── exceptionValidators.js
│   │   │   ├── financeValidators.js
│   │   │   ├── razorpayValidators.js
│   │   │   ├── reconciliationValidators.js
│   │   │   └── webhookValidators.js
│   │   ├── app.js
│   │   ├── server.js
│   │   └── worker.js
│   ├── tests/
│   │   ├── ai/
│   │   ├── audit/
│   │   ├── auth/
│   │   ├── classification/
│   │   ├── demo/
│   │   ├── evaluation/
│   │   ├── exceptions/
│   │   ├── finance/
│   │   ├── helpers/
│   │   ├── integration/
│   │   ├── ledger/
│   │   ├── models/
│   │   ├── monitoring/
│   │   ├── orchestration/
│   │   ├── policy/
│   │   ├── provider/
│   │   ├── razorpay/
│   │   ├── reconciliation/
│   │   ├── routes/
│   │   └── webhook/
│   ├── .env.example
│   ├── package.json
│   └── vitest.config.js
│
├── docs/
│   ├── reconai-2/
│   │   ├── ACCEPTANCE_CRITERIA.md
│   │   ├── API_READ_CONTRACT.md              # Complete specification for workspace GET endpoints
│   │   ├── ARCHITECTURE_DECISIONS.md         # ADR-01 through ADR-15
│   │   ├── CURRENT_PROJECT_STATUS.md         # Authoritative release readiness and status
│   │   ├── DAILY_WORK_LOG_2026_10_12.md      # Detailed daily audit trail (entries 1 to 23)
│   │   ├── DOCUMENTATION_CONSISTENCY_AUDIT.md# Master documentation audit across all 58 markdown files
│   │   ├── DOMAIN_MODEL_AND_LEDGERS.md
│   │   ├── EDGE_CASE_POLICY_MATRIX.md
│   │   ├── OPEN_DECISIONS_AND_TECHNICAL_DEBT.md# Register of owner decisions and technical debt
│   │   ├── PAYMENT_STATE_MACHINE.md
│   │   ├── PHASE_10_AUTONOMOUS_WORKER_AND_ORCHESTRATION.md
│   │   ├── PHASE_3_AUTHENTICATION_AND_TENANT_ISOLATION.md
│   │   ├── PHASE_4_WEBHOOK_INGESTION.md
│   │   ├── PHASE_5_PAYMENT_MONITORING.md
│   │   ├── PHASE_6_CLASSIFICATION_ENGINE.md
│   │   ├── PHASE_7_MULTI_AGENT_INVESTIGATION.md
│   │   ├── PHASE_8_RESOLUTION_POLICY_AND_DRY_RUN.md
│   │   ├── PHASE_9_SANDBOX_PROVIDER_ADAPTER.md
│   │   ├── PRODUCT_REQUIREMENTS.md
│   │   ├── PROVIDER_CAPABILITY_MATRIX.md
│   │   └── ROLE_PERMISSION_MATRIX.md
│   ├── AI_INVESTIGATION.md
│   ├── API.md
│   ├── ARCHITECTURE.md
│   ├── DATASET.md
│   ├── DEMO_SCRIPT.md
│   ├── EVALUATION.md
│   ├── EXCEPTION_WORKFLOW.md
│   ├── JUDGING_CRITERIA.md
│   ├── PITCH.md
│   ├── PROGRESS.md
│   ├── RAZORPAY_INTEGRATION.md
│   ├── RECONCILIATION_ENGINE.md
│   ├── SUBMISSION_CHECKLIST.md
│   └── TESTING.md
│
├── folderstr.md
├── implemented.md
├── memory.md
└── README.md
```
