import rateLimit from "express-rate-limit";

export const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 300, // Limit each IP to 300 requests per window
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test",
  handler: (req, res) => {
    res.status(429).json({
      success: false,
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests from this IP, please try again later"
      }
    });
  }
});
