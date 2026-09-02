import { Router } from "express";
import { queryAuditLogs, getAuditEvent } from "../controllers/auditController.js";

const router = Router();

router.get("/", queryAuditLogs);
router.get("/:eventId", getAuditEvent);

export default router;
