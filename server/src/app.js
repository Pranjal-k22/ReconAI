import express from "express";
import cors from "cors";
import helmet from "helmet";
import { getEnv } from "./config/env.js";
import { httpLogger } from "./config/logger.js";
import { apiLimiter } from "./middleware/rateLimiter.js";
import { notFoundHandler } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";
import { authenticate, requireRoles, requireTenantScope } from "./middleware/authMiddleware.js";
import { ROLES } from "./services/auth/tokenService.js";
import healthRoutes from "./routes/healthRoutes.js";
import authRoutes from "./routes/authRoutes.js";
import paymentCaseRoutes from "./routes/paymentCaseRoutes.js";
import paymentActionRoutes from "./routes/paymentActionRoutes.js";
import paymentEventRoutes from "./routes/paymentEventRoutes.js";
import reconciliationRoutes from "./routes/reconciliationRoutes.js";
import exceptionRoutes from "./routes/exceptionRoutes.js";
import auditRoutes from "./routes/auditRoutes.js";
import razorpayRoutes from "./routes/razorpayRoutes.js";
import integrationRoutes from "./routes/integrationRoutes.js";
import financeRoutes from "./routes/financeRoutes.js";
import webhookRoutes from "./routes/webhookRoutes.js";
import orchestrationRoutes from "./routes/orchestrationRoutes.js";

const env = getEnv();
const app = express();

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: env.CLIENT_URL || "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    credentials: true
  })
);

// Body parser with raw body preservation for cryptographic webhook signature verification
app.use(
  express.json({
    limit: "1mb",
    verify: (req, res, buf) => {
      req.rawBody = buf;
    }
  })
);

// Request logging (active in non-test mode)
if (env.NODE_ENV !== "test") {
  app.use(httpLogger);
}

// Rate limiting
app.use("/api", apiLimiter);

// Public root status probe for browser visitors on port 5000
app.get("/", (req, res) => {
  res.status(200).json({
    success: true,
    service: "ReconAI 2.0 API Server",
    status: "healthy",
    frontendUrl: env.CLIENT_URL || "http://localhost:5173",
    endpoints: {
      health: "/api/health",
      auth: "/api/auth/login",
      paymentCases: "/api/payment-cases",
      reconciliation: "/api/reconciliation/runs"
    },
    message: "ReconAI API backend is running. Access the application console at http://localhost:5173"
  });
});

// Public API Routes (Explicitly Justified)
// 1. GET /api/health: Public liveness/readiness probe for deployment orchestrators
app.use("/api", healthRoutes);
// 2. /api/auth: Public login and service-token issuance endpoints (authenticated inside for /me and /logout)
app.use("/api/auth", authRoutes);
// 3. /api/webhooks: Provider ingress routes guarded by cryptographic HMAC signature verification
app.use("/api/webhooks", webhookRoutes);

// Protected ReconAI 2.0 Ledger & Identity Routes
app.use("/api/payment-cases", paymentCaseRoutes);
app.use("/api/payment-actions", paymentActionRoutes);
app.use("/api/payment-events", paymentEventRoutes);

// Protected Core Financial & Reconciliation Routes (Deny by default)
app.use(
  "/api/reconciliation",
  authenticate,
  requireRoles(ROLES.ADMIN, ROLES.SHOP, ROLES.AUDITOR),
  requireTenantScope,
  reconciliationRoutes
);
app.use(
  "/api/exceptions",
  authenticate,
  requireRoles(ROLES.ADMIN, ROLES.SHOP, ROLES.AUDITOR),
  requireTenantScope,
  exceptionRoutes
);
app.use(
  "/api/audit",
  authenticate,
  requireRoles(ROLES.ADMIN, ROLES.AUDITOR),
  auditRoutes
);
app.use(
  "/api/razorpay",
  authenticate,
  requireRoles(ROLES.ADMIN, ROLES.SHOP),
  requireTenantScope,
  razorpayRoutes
);
app.use(
  "/api/integrations",
  authenticate,
  requireRoles(ROLES.ADMIN, ROLES.SHOP),
  requireTenantScope,
  integrationRoutes
);
app.use(
  "/api/finance-controller",
  authenticate,
  requireRoles(ROLES.ADMIN, ROLES.AUDITOR, ROLES.SHOP),
  requireTenantScope,
  financeRoutes
);
app.use("/api/orchestration", orchestrationRoutes);

// 404 Handler for unmatched routes
app.use(notFoundHandler);

// Global Error Handler
app.use(errorHandler);

export default app;
