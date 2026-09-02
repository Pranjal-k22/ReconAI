import express from "express";
import cors from "cors";
import helmet from "helmet";
import pinoHttp from "pino-http";
import healthRoutes from "./routes/healthRoutes.js";

const app = express();

// Security and middleware
app.use(helmet());
app.use(cors({
  origin: process.env.CLIENT_URL || "http://localhost:5173",
  credentials: true
}));
app.use(express.json());

// Basic logging middleware (only active in non-test mode)
if (process.env.NODE_ENV !== "test") {
  app.use(pinoHttp());
}

// API Routes
app.use("/api", healthRoutes);

export default app;
