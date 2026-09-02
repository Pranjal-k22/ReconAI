import { ZodError } from "zod";
import { AppError } from "../utils/AppError.js";
import { logger } from "../config/logger.js";

export const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let errorCode = err.code || "INTERNAL_ERROR";
  let message = err.message || "Internal server error";
  let details = err.details || null;

  // Handle Zod validation errors
  if (err instanceof ZodError) {
    statusCode = 400;
    errorCode = "VALIDATION_ERROR";
    message = "Validation failed for request parameters";
    details = err.errors.map((e) => ({
      field: e.path.join("."),
      message: e.message
    }));
  }
  // Handle JSON Syntax Errors
  else if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    statusCode = 400;
    errorCode = "BAD_REQUEST";
    message = "Malformed JSON payload in request body";
  }
  // Handle unexpected non-operational errors
  else if (!(err instanceof AppError)) {
    logger.error(`Unhandled System Error: ${err.message}`, { stack: err.stack });
    statusCode = 500;
    errorCode = "INTERNAL_ERROR";
    message = process.env.NODE_ENV === "production" ? "Internal server error" : err.message;
  }

  return res.status(statusCode).json({
    success: false,
    error: {
      code: errorCode,
      message,
      ...(details ? { details } : {})
    }
  });
};
