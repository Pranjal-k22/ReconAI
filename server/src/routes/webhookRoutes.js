import { Router } from "express";
import { handleRazorpayWebhook } from "../controllers/webhookController.js";

const router = Router();

// Ingress route for Razorpay webhook notifications (signature-verified)
router.post("/razorpay", handleRazorpayWebhook);

export default router;
