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
│   │   └── seedDemoData.js
│   ├── src/
│   │   ├── config/
│   │   │   ├── database.js
│   │   │   ├── env.js
│   │   │   └── logger.js
│   │   ├── controllers/
│   │   │   └── healthController.js
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
│   │   │   └── healthRoutes.js
│   │   ├── services/
│   │   │   └── demo/
│   │   │       ├── benchmarkGenerator.js
│   │   │       ├── csvExporter.js
│   │   │       └── prng.js
│   │   ├── utils/
│   │   │   ├── AppError.js
│   │   │   ├── asyncHandler.js
│   │   │   └── money.js
│   │   ├── validators/
│   │   ├── app.js
│   │   └── server.js
│   ├── tests/
│   │   ├── demo/
│   │   │   └── benchmarkGenerator.test.js
│   │   ├── models/
│   │   │   ├── auditLog.test.js
│   │   │   ├── exceptionCase.test.js
│   │   │   ├── gatewayPayment.test.js
│   │   │   ├── groundTruth.test.js
│   │   │   ├── merchantOrder.test.js
│   │   │   ├── reconciliationModels.test.js
│   │   │   └── settlementRecord.test.js
│   │   ├── envInvariant.test.js
│   │   ├── health.test.js
│   │   ├── infrastructure.test.js
│   │   └── money.test.js
│   ├── .env.example
│   └── package.json
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── DATASET.md
│   └── PROGRESS.md
├── .gitignore
├── folderstr.md
├── implemented.md
├── memory.md
├── package.json
└── README.md
