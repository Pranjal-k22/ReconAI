export class AppError extends Error {
  constructor(message, statusCode = 500, code = "INTERNAL_ERROR", details = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }

  static notFound(message = "Resource not found", details = null) {
    return new AppError(message, 404, "NOT_FOUND", details);
  }

  static validationError(message = "Validation error", details = null) {
    return new AppError(message, 400, "VALIDATION_ERROR", details);
  }

  static badRequest(message = "Bad request", details = null) {
    return new AppError(message, 400, "BAD_REQUEST", details);
  }

  static conflict(message = "Resource state conflict", details = null) {
    return new AppError(message, 409, "CONFLICT", details);
  }

  static rateLimited(message = "Too many requests, please try again later", details = null) {
    return new AppError(message, 429, "RATE_LIMITED", details);
  }
}
