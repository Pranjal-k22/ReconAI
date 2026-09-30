import pino from "pino";
import pinoHttp from "pino-http";

const redactPaths = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "*.authorization",
  "*.cookie",
  "*.RAZORPAY_KEY_SECRET",
  "*.GEMINI_API_KEY",
  "*.MONGODB_URI"
];

export const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === "test" ? "silent" : "info"),
  redact: {
    paths: redactPaths,
    censor: "[REDACTED]"
  }
});

export const httpLogger = pinoHttp({
  logger,
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 500 || err) return "error";
    if (res.statusCode >= 400) return "warn";
    return "info";
  },
  customSuccessMessage: (req, res, responseTime) => {
    return `${req.method} ${req.url} - ${res.statusCode} (${responseTime}ms)`;
  },
  customErrorMessage: (req, res, err) => {
    return `${req.method} ${req.url} - ${res.statusCode} ERROR: ${err.message}`;
  }
});

export default logger;
