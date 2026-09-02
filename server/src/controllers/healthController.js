import { getDatabaseStatus } from "../config/database.js";

export const getHealthStatus = (req, res) => {
  const dbStatus = getDatabaseStatus();
  const isHealthy = dbStatus === "connected";

  const statusCode = isHealthy ? 200 : 503;

  return res.status(statusCode).json({
    success: isHealthy,
    service: "reconai-api",
    status: isHealthy ? "healthy" : "degraded",
    database: {
      status: dbStatus
    }
  });
};
