import { Router } from "express";
import { syncPayments, syncSettlements } from "../controllers/razorpayController.js";

const router = Router();

router.post("/sync/payments", syncPayments);
router.post("/sync/settlements", syncSettlements);

export default router;
