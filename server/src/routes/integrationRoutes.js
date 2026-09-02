import { Router } from "express";
import { getIntegrationsStatus } from "../controllers/razorpayController.js";

const router = Router();

router.get("/status", getIntegrationsStatus);

export default router;
