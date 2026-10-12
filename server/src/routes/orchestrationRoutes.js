import express from "express";
import { authenticate, requireRoles, requireTenantScope } from "../middleware/authMiddleware.js";
import { ROLES } from "../services/auth/tokenService.js";
import {
  checkOrchestratorGate,
  getOrchestratorMetrics,
  isOrchestratorKillSwitchActive,
  setOrchestratorKillSwitch
} from "../services/orchestration/orchestratorGate.js";
import { createAuditEvent } from "../services/audit/auditService.js";

const router = express.Router();

router.use(authenticate);

/**
 * GET /api/orchestration/status
 * Retrieves current orchestrator enablement gate, kill switch state, and operational metrics.
 */
router.get(
  "/status",
  requireRoles(ROLES.ADMIN, ROLES.AUDITOR, ROLES.PAYMENT_CONTROLLER),
  async (req, res, next) => {
    try {
      const gate = await checkOrchestratorGate();
      const metrics = getOrchestratorMetrics();
      const killSwitch = await isOrchestratorKillSwitchActive();

      res.status(200).json({
        success: true,
        data: {
          gate,
          killSwitchActive: killSwitch,
          metrics
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/orchestration/kill-switch
 * Toggles or engages operator kill switch to pause future task execution immediately.
 */
router.post(
  "/kill-switch",
  requireRoles(ROLES.ADMIN),
  async (req, res, next) => {
    try {
      const { active, reason } = req.body;
      const killSwitchEngaged = Boolean(active);
      await setOrchestratorKillSwitch(killSwitchEngaged, {
        updatedBy: req.user.userId || req.user.email || "admin",
        reason
      });

      await createAuditEvent({
        actorType: "ADMIN",
        actorId: req.user.userId || req.user.email || "admin",
        action: killSwitchEngaged ? "ORCHESTRATOR_KILL_SWITCH_ENGAGED" : "ORCHESTRATOR_KILL_SWITCH_DISENGAGED",
        tenantId: req.user.tenantId || "SYSTEM",
        entityType: "OrchestratorGate",
        entityId: "kill-switch",
        metadata: {
          engaged: killSwitchEngaged,
          timestamp: new Date().toISOString()
        }
      }).catch(() => {});

      res.status(200).json({
        success: true,
        data: {
          killSwitchActive: killSwitchEngaged,
          message: killSwitchEngaged
            ? "Operator kill switch engaged. Background task claiming halted."
            : "Operator kill switch disengaged. Background task claiming restored."
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
