# ReconAI Folder Structure

reconai/
├── client/
│   ├── public/
│   ├── src/
│   │   ├── api/
│   │   ├── assets/
│   │   ├── components/
│   │   │   ├── common/
│   │   │   └── layout/
│   │   ├── constants/
│   │   ├── hooks/
│   │   ├── pages/
│   │   ├── utils/
│   │   ├── App.jsx
│   │   ├── index.css
│   │   └── main.jsx
│   ├── .env.example
│   ├── .gitignore
│   ├── index.html
│   ├── package.json
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
│   │   ├── generateDemoData.js
│   │   ├── resetDemo.js
│   │   ├── seedDemoData.js
│   │   ├── testLiveReconciliationRun.js
│   │   └── testStep8AuditedRun.js
│   ├── src/
│   │   ├── config/
│   │   │   ├── database.js
│   │   │   ├── env.js
│   │   │   └── logger.js
│   │   ├── controllers/
│   │   │   ├── auditController.js
│   │   │   ├── exceptionController.js
│   │   │   ├── healthController.js
│   │   │   ├── razorpayController.js
│   │   │   └── reconciliationController.js
│   │   ├── middleware/
│   │   │   ├── errorHandler.js
│   │   │   ├── notFound.js
│   │   │   └── rateLimiter.js
│   │   ├── models/
│   │   │   ├── helpers/
│   │   │   │   └── validators.js
│   │   │   ├── AuditLog.js
│   │   │   ├── ExceptionCase.js
│   │   │   ├── GatewayPayment.js
│   │   │   ├── GroundTruth.js
│   │   │   ├── MerchantOrder.js
│   │   │   ├── ReconciliationResult.js
│   │   │   ├── ReconciliationRun.js
│   │   │   └── SettlementRecord.js
│   │   ├── routes/
│   │   │   ├── auditRoutes.js
│   │   │   ├── exceptionRoutes.js
│   │   │   ├── healthRoutes.js
│   │   │   ├── integrationRoutes.js
│   │   │   ├── razorpayRoutes.js
│   │   │   └── reconciliationRoutes.js
│   │   ├── services/
│   │   │   ├── ai/
│   │   │   │   ├── aiSchemas.js
│   │   │   │   ├── exceptionInvestigator.js
│   │   │   │   ├── fallbackExplanation.js
│   │   │   │   └── geminiService.js
│   │   │   ├── audit/
│   │   │   │   └── auditService.js
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
│   │   │   │   └── syntheticFeePolicy.js
│   │   │   ├── razorpay/
│   │   │   │   ├── paymentSyncService.js
│   │   │   │   ├── razorpayClient.js
│   │   │   │   ├── razorpayNormalizer.js
│   │   │   │   ├── razorpayStatusService.js
│   │   │   │   └── settlementSyncService.js
│   │   │   └── reconciliation/
│   │   │       ├── anomalyClassifier.js
│   │   │       ├── candidateMatcher.js
│   │   │       ├── confidenceEngine.js
│   │   │       ├── matchingEngine.js
│   │   │       ├── metricsService.js
│   │   │       ├── normalizationService.js
│   │   │       └── reconciliationService.js
│   │   ├── utils/
│   │   │   ├── AppError.js
│   │   │   ├── asyncHandler.js
│   │   │   └── money.js
│   │   ├── validators/
│   │   │   ├── exceptionValidators.js
│   │   │   ├── razorpayValidators.js
│   │   │   └── reconciliationValidators.js
│   │   ├── app.js
│   │   └── server.js
│   ├── tests/
│   │   ├── ai/
│   │   │   ├── aiSchemas.test.js
│   │   │   ├── exceptionInvestigator.test.js
│   │   │   ├── fallbackExplanation.test.js
│   │   │   └── geminiService.test.js
│   │   ├── audit/
│   │   │   └── auditService.test.js
│   │   ├── demo/
│   │   │   └── benchmarkGenerator.test.js
│   │   ├── evaluation/
│   │   │   └── evaluationService.test.js
│   │   ├── exceptions/
│   │   │   ├── exceptionService.test.js
│   │   │   ├── humanReviewService.test.js
│   │   │   ├── safetyGate.test.js
│   │   │   └── severityService.test.js
│   │   ├── models/
│   │   │   ├── auditLog.test.js
│   │   │   ├── exceptionCase.test.js
│   │   │   ├── gatewayPayment.test.js
│   │   │   ├── groundTruth.test.js
│   │   │   ├── merchantOrder.test.js
│   │   │   ├── reconciliationModels.test.js
│   │   │   └── settlementRecord.test.js
│   │   ├── razorpay/
│   │   │   ├── paymentSyncService.test.js
│   │   │   ├── razorpayClient.test.js
│   │   │   ├── razorpayIsolationGuard.test.js
│   │   │   ├── razorpayNormalizer.test.js
│   │   │   └── settlementSyncService.test.js
│   │   ├── reconciliation/
│   │   │   ├── aiSeparation.test.js
│   │   │   ├── benchmarkCompatibility.test.js
│   │   │   ├── candidateMatcher.test.js
│   │   │   ├── confidenceEngine.test.js
│   │   │   ├── groundTruthIsolationGuard.test.js
│   │   │   ├── matchingEngine.test.js
│   │   │   ├── metricsService.test.js
│   │   │   ├── normalizationService.test.js
│   │   │   └── safetyGate.test.js
│   │   ├── routes/
│   │   │   ├── aiInvestigationRoutes.test.js
│   │   │   ├── auditRoutes.test.js
│   │   │   ├── exceptionRoutes.test.js
│   │   │   ├── razorpayRoutes.test.js
│   │   │   └── reconciliationRoutes.test.js
│   │   ├── envInvariant.test.js
│   │   ├── health.test.js
│   │   ├── infrastructure.test.js
│   │   └── money.test.js
│   ├── .env.example
│   └── package.json
│
├── docs/
│   ├── AI_INVESTIGATION.md
│   ├── ARCHITECTURE.md
│   ├── DATASET.md
│   ├── EVALUATION.md
│   ├── EXCEPTION_WORKFLOW.md
│   ├── PROGRESS.md
│   ├── RAZORPAY_INTEGRATION.md
│   └── RECONCILIATION_ENGINE.md
├── .gitignore
├── folderstr.md
├── implemented.md
├── memory.md
├── package.json
└── README.md
