import express from "express";
import cors from "cors";
import helmet from "helmet";
import { getEnv } from "./config/env.js";
import { httpLogger } from "./config/logger.js";
import { apiLimiter } from "./middleware/rateLimiter.js";
import { notFoundHandler } from "./middleware/notFound.js";
import { errorHandler } from "./middleware/errorHandler.js";
import healthRoutes from "./routes/healthRoutes.js";
import reconciliationRoutes from "./routes/reconciliationRoutes.js";
import exceptionRoutes from "./routes/exceptionRoutes.js";
import auditRoutes from "./routes/auditRoutes.js";

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

// Body parser
app.use(express.json());

// Request logging (active in non-test mode)
if (env.NODE_ENV !== "test") {
  app.use(httpLogger);
}

// Rate limiting
app.use("/api", apiLimiter);

// API Routes
app.use("/api", healthRoutes);
app.use("/api/reconciliation", reconciliationRoutes);
app.use("/api/exceptions", exceptionRoutes);
app.use("/api/audit", auditRoutes);

// 404 Handler for unmatched routes
app.use(notFoundHandler);

// Global Error Handler
app.use(errorHandler);

export default app;
