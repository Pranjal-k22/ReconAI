import express from "express";
import {
  createControllerRun,
  listControllerRuns,
  getControllerRun,
  getControllerRunReport,
  getControllerRunStatus
} from "../controllers/financeController.js";

const router = express.Router();

router.post("/run", createControllerRun);
router.get("/runs", listControllerRuns);
router.get("/runs/:runId", getControllerRun);
router.get("/runs/:runId/report", getControllerRunReport);
router.get("/runs/:runId/status", getControllerRunStatus);

export default router;
