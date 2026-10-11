import express from "express";
import { login, issueServiceToken, getCurrentUser, logout } from "../controllers/authController.js";
import { authenticate } from "../middleware/authMiddleware.js";

const router = express.Router();

// Public auth endpoints
router.post("/login", login);
router.post("/service-token", issueServiceToken);

// Protected endpoints
router.get("/me", authenticate, getCurrentUser);
router.post("/logout", authenticate, logout);

export default router;
