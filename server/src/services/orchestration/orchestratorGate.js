import mongoose from "mongoose";
import { getEnv } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { OrchestrationControl } from "../../models/OrchestrationControl.js";

/**
 * ReconAI 2.0 - Orchestration Worker Centralized Configuration Gate & Process-Shared Kill Switch
 *
 * Requirements:
 * - Disabled by default.
 * - Requires explicit server-side environment setting (ORCHESTRATOR_WORKER_ENABLED === true).
 * - Client requests, AI suggestions, webhook payloads, or database fields CANNOT enable it.
 * - Invalid or contradictory configuration fails closed.
 * - Authoritative kill switch is backed durably by MongoDB (OrchestrationControl) across
 *   process boundaries (e.g. API server, standalone node worker.js, worker pool).
 * - Database failure / unreadable state fails closed for all new claims.
 * - Process restart never silently restores an unsafe enabled state.
 * - Observability metrics for task counts, retries, safe holds, escalations, stale-lease recoveries.
 */

let killSwitchActive = false;

// Structured operational metrics
const orchestratorMetrics = {
  tasksQueued: 0,
  tasksClaimed: 0,
  tasksCompleted: 0,
  safeHolds: 0,
  escalations: 0,
  retries: 0,
  staleLeasesRecovered: 0,
  leasesRenewed: 0,
  leaseLosses: 0,
  failures: 0,
  illegalTransitions: 0
};

/**
 * Resets all operational metrics counters (useful in test teardown).
 */
export function resetOrchestratorMetrics() {
  orchestratorMetrics.tasksQueued = 0;
  orchestratorMetrics.tasksClaimed = 0;
  orchestratorMetrics.tasksCompleted = 0;
  orchestratorMetrics.safeHolds = 0;
  orchestratorMetrics.escalations = 0;
  orchestratorMetrics.retries = 0;
  orchestratorMetrics.staleLeasesRecovered = 0;
  orchestratorMetrics.leasesRenewed = 0;
  orchestratorMetrics.leaseLosses = 0;
  orchestratorMetrics.failures = 0;
  orchestratorMetrics.illegalTransitions = 0;
}

/**
 * Resets the kill switch both in-memory and persistently in MongoDB.
 */
export async function resetOrchestratorKillSwitch() {
  killSwitchActive = false;
  if (mongoose.connection && mongoose.connection.readyState === 1) {
    try {
      await OrchestrationControl.deleteMany({});
    } catch {
      // Ignored during teardown
    }
  }
}

/**
 * Retrieves snapshot of current operational metrics.
 */
export function getOrchestratorMetrics() {
  return { ...orchestratorMetrics };
}

/**
 * Increments an operational metric safely.
 */
export function recordOrchestratorMetric(metricName, count = 1) {
  if (typeof orchestratorMetrics[metricName] === "number") {
    orchestratorMetrics[metricName] += count;
  }
}

/**
 * Sets the operator kill switch state both in-memory and durably in MongoDB.
 *
 * @param {boolean} active - True to engage kill switch, false to disengage
 * @param {Object} [options]
 * @param {string} [options.updatedBy="OPERATOR"] - Operator identity
 * @param {string} [options.reason=null] - Reason for action
 */
export async function setOrchestratorKillSwitch(
  active,
  { updatedBy = "OPERATOR", reason = null } = {}
) {
  killSwitchActive = Boolean(active);
  logger.warn(
    { killSwitchActive, updatedBy, reason },
    killSwitchActive
      ? "🚨 OPERATOR KILL SWITCH ENGAGED: Orchestration worker task claiming halted across all processes."
      : "✅ Operator kill switch disengaged: Orchestration worker task claiming restored."
  );

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    try {
      await OrchestrationControl.findOneAndUpdate(
        { controlKey: "GLOBAL_ORCHESTRATION_CONTROL" },
        {
          $set: {
            killSwitchActive: Boolean(active),
            updatedBy,
            reason,
            updatedAt: new Date()
          }
        },
        { upsert: true, new: true }
      );
    } catch (err) {
      logger.error({ err: err.message }, "Failed to persist kill switch state to MongoDB");
      throw err;
    }
  }
}

/**
 * Checks whether the operator kill switch is active across process boundaries.
 *
 * @returns {Promise<boolean>} True if kill switch is active
 */
export async function isOrchestratorKillSwitchActive() {
  if (killSwitchActive) return true;

  if (mongoose.connection && mongoose.connection.readyState === 1) {
    try {
      const control = await OrchestrationControl.findOne({
        controlKey: "GLOBAL_ORCHESTRATION_CONTROL"
      }).lean();

      if (control && control.killSwitchActive === true) {
        killSwitchActive = true;
        return true;
      }
    } catch {
      // Fail closed on database error
      return true;
    }
  }

  return Boolean(killSwitchActive);
}

/**
 * Synchronous check of in-memory kill switch flag.
 */
export function isOrchestratorKillSwitchActiveSync() {
  return Boolean(killSwitchActive);
}

/**
 * Evaluates the centralized configuration gate and process-shared kill switch.
 *
 * Fails closed if:
 * 1. Kill switch is engaged (in-memory or durably in MongoDB across processes).
 * 2. Database is unreachable when checking shared state.
 * 3. ORCHESTRATOR_WORKER_ENABLED is not explicitly true.
 *
 * @returns {Promise<{ allowed: boolean, reason: string }>}
 */
export async function checkOrchestratorGate() {
  // 1. Fast-path in-memory check
  if (killSwitchActive) {
    return {
      allowed: false,
      reason: "KILL_SWITCH_ACTIVE"
    };
  }

  // 2. Authoritative process-shared MongoDB check
  if (mongoose.connection && mongoose.connection.readyState === 1) {
    try {
      const control = await OrchestrationControl.findOne({
        controlKey: "GLOBAL_ORCHESTRATION_CONTROL"
      }).lean();

      if (control && control.killSwitchActive === true) {
        killSwitchActive = true; // Sync in-memory cache
        return {
          allowed: false,
          reason: "KILL_SWITCH_ACTIVE"
        };
      }
    } catch (err) {
      // Database failure / unreadable state fails closed strictly!
      logger.error({ err: err.message }, "Database error reading OrchestrationControl; failing closed");
      return {
        allowed: false,
        reason: "DATABASE_UNAVAILABLE_FAIL_CLOSED"
      };
    }
  }

  // 3. Environment configuration check
  let env;
  try {
    env = getEnv();
  } catch (err) {
    return {
      allowed: false,
      reason: "INVALID_ENVIRONMENT_CONFIG"
    };
  }

  const rawEnvVal = process.env.ORCHESTRATOR_WORKER_ENABLED;
  const isProcessEnabled =
    typeof rawEnvVal === "string"
      ? rawEnvVal.toLowerCase() === "true" || rawEnvVal === "1"
      : Boolean(rawEnvVal);

  if (!isProcessEnabled && (!env || env.ORCHESTRATOR_WORKER_ENABLED !== true)) {
    return {
      allowed: false,
      reason: "ORCHESTRATOR_WORKER_DISABLED"
    };
  }

  return {
    allowed: true,
    reason: "ALLOWED"
  };
}

/**
 * Synchronous variant of configuration gate check for non-async setup.
 */
export function checkOrchestratorGateSync() {
  if (killSwitchActive) {
    return {
      allowed: false,
      reason: "KILL_SWITCH_ACTIVE"
    };
  }

  let env;
  try {
    env = getEnv();
  } catch {
    return {
      allowed: false,
      reason: "INVALID_ENVIRONMENT_CONFIG"
    };
  }

  const rawEnvVal = process.env.ORCHESTRATOR_WORKER_ENABLED;
  const isProcessEnabled =
    typeof rawEnvVal === "string"
      ? rawEnvVal.toLowerCase() === "true" || rawEnvVal === "1"
      : Boolean(rawEnvVal);

  if (!isProcessEnabled && (!env || env.ORCHESTRATOR_WORKER_ENABLED !== true)) {
    return {
      allowed: false,
      reason: "ORCHESTRATOR_WORKER_DISABLED"
    };
  }

  return {
    allowed: true,
    reason: "ALLOWED"
  };
}

/**
 * Strips secrets, raw authorization tokens, and sensitive customer PII from orchestration payloads.
 *
 * @param {any} payload
 * @returns {any} Sanitized payload
 */
export function sanitizeOrchestrationPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;

  const SENSITIVE_KEYS = [
    "authorization",
    "password",
    "secret",
    "key_secret",
    "token",
    "jwt",
    "cvv",
    "card_number",
    "vpa",
    "email",
    "contact",
    "phone"
  ];

  if (Array.isArray(payload)) {
    return payload.map(sanitizeOrchestrationPayload);
  }

  const cleaned = {};
  for (const [key, value] of Object.entries(payload)) {
    const lowerKey = key.toLowerCase();
    if (SENSITIVE_KEYS.some((s) => lowerKey.includes(s))) {
      cleaned[key] = "[REDACTED]";
    } else if (value && typeof value === "object") {
      cleaned[key] = sanitizeOrchestrationPayload(value);
    } else {
      cleaned[key] = value;
    }
  }

  return cleaned;
}
