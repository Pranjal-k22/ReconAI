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
│   │   ├── utils/
│   │   │   ├── AppError.js
│   │   │   ├── asyncHandler.js
│   │   │   └── money.js
│   │   ├── validators/
│   │   ├── app.js
│   │   └── server.js
│   ├── tests/
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
│   └── PROGRESS.md
├── .gitignore
├── folderstr.md
├── implemented.md
├── memory.md
├── package.json
└── README.md
