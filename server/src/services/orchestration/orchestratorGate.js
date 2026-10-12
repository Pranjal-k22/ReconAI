import { getEnv } from "../../config/env.js";
import { logger } from "../../config/logger.js";

/**
 * ReconAI 2.0 - Orchestration Worker Centralized Configuration Gate & Kill Switch
 *
 * Requirements:
 * - Disabled by default.
 * - Requires explicit server-side environment setting (ORCHESTRATOR_WORKER_ENABLED === true).
 * - Client requests, AI suggestions, webhook payloads, or database fields CANNOT enable it.
 * - Invalid or contradictory configuration fails closed.
 * - In-memory operator kill switch enables immediate pausing of all future task execution.
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
  orchestratorMetrics.failures = 0;
  orchestratorMetrics.illegalTransitions = 0;
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
 * Sets the operator kill switch state.
 *
 * @param {boolean} active - True to engage kill switch, false to disengage
 */
export function setOrchestratorKillSwitch(active) {
  killSwitchActive = Boolean(active);
  logger.warn(
    { killSwitchActive },
    killSwitchActive
      ? "🚨 OPERATOR KILL SWITCH ENGAGED: Orchestration worker task claiming halted immediately."
      : "✅ Operator kill switch disengaged: Orchestration worker task claiming restored."
  );
}

/**
 * Checks whether the operator kill switch is active.
 *
 * @returns {boolean} True if kill switch is active
 */
export function isOrchestratorKillSwitchActive() {
  return killSwitchActive;
}

/**
 * Evaluates the centralized configuration gate and kill switch.
 *
 * Fails closed if:
 * 1. Kill switch is engaged.
 * 2. ORCHESTRATOR_WORKER_ENABLED is not explicitly true.
 *
 * @returns {{ allowed: boolean, reason: string }}
 */
export function checkOrchestratorGate() {
  if (killSwitchActive) {
    return {
      allowed: false,
      reason: "KILL_SWITCH_ACTIVE"
    };
  }

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
