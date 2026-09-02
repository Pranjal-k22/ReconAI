import { Router } from "express";
import {
  listExceptions,
  getSummary,
  getException,
  applyDecision,
  investigateException
} from "../controllers/exceptionController.js";

const router = Router();

router.get("/summary", getSummary);
router.get("/", listExceptions);
router.get("/:exceptionId", getException);
router.patch("/:exceptionId/decision", applyDecision);
router.post("/:exceptionId/investigate", investigateException);

export default router;
