import { AppError } from "../utils/AppError.js";

export const notFoundHandler = (req, res, next) => {
  const error = AppError.notFound(`Route not found: ${req.method} ${req.originalUrl}`);
  next(error);
};
