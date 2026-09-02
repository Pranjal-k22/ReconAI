export const getHealthStatus = (req, res) => {
  return res.status(200).json({
    success: true,
    service: "reconai-api",
    status: "healthy"
  });
};
