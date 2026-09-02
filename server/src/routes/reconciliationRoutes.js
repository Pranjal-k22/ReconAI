import { Router } from "express";
import {
  createRun,
  listRuns,
  getRun,
  getRunResults,
  getRunMetrics,
  getRunEvaluation
} from "../controllers/reconciliationController.js";

const router = Router();

router.post("/runs", createRun);
router.get("/runs", listRuns);
router.get("/runs/:runId", getRun);
router.get("/runs/:runId/results", getRunResults);
router.get("/runs/:runId/metrics", getRunMetrics);
router.get("/runs/:runId/evaluation", getRunEvaluation);

export default router;
