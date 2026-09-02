import { getDatabaseStatus } from "../config/database.js";

export const getHealthStatus = (req, res) => {
  const dbStatus = getDatabaseStatus();

  return res.status(200).json({
    success: true,
    service: "reconai-api",
    status: "healthy",
    database: {
      status: dbStatus
    }
  });
};
