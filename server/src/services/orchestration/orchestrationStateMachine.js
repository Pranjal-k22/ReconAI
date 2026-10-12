import { AppError } from "../../utils/AppError.js";

/**
 * ReconAI 2.0 - Bounded Orchestration State Machine
 *
 * Enforces discrete, unidirectional, safe state transitions for the autonomous
 * resolution orchestration lifecycle:
 *
 * 1. QUEUED              - Task enqueued, awaiting worker claim
 * 2. CLAIMED             - Atomically leased by an authorized worker
 * 3. EVIDENCE_COLLECTION - Gathering authoritative gateway, merchant, and case evidence
 * 4. POLICY_EVALUATION   - Evaluating deterministic rules via resolutionPolicyEvaluator
 * 5. WAITING_FOR_RECHECK - Non-terminal hold scheduled for next monitoring check interval
 * 6. SAFE_HOLD           - Bounded protection hold (e.g. Case 22, ambiguous evidence, missing limits)
 * 7. ESCALATION_REQUIRED - Escalated for authorized human review (e.g. refund requests, disputes)
 * 8. COMPLETED           - Verified terminal state (fully reconciled, no outstanding mutations needed)
 * 9. FAILED_RETRYABLE    - Transient failure (rate limit, socket timeout during read-only check)
 * 10. FAILED_TERMINAL    - Permanent unrecoverable failure / poisoned task
 *
 * Non-executability invariant:
 * - A policy decision to "REQUEST_REFUND" can NEVER transition to "COMPLETED".
 *   The autonomous worker cannot execute provider mutations; it transitions to "ESCALATION_REQUIRED".
 * - Case 22 (late capture after cancelled order) transitions unconditionally to "SAFE_HOLD".
 * - Missing approved refund limits transitions to "SAFE_HOLD" or "ESCALATION_REQUIRED".
 */

export const ORCHESTRATION_STATES = Object.freeze([
  "QUEUED",
  "CLAIMED",
  "EVIDENCE_COLLECTION",
  "POLICY_EVALUATION",
  "WAITING_FOR_RECHECK",
  "SAFE_HOLD",
  "ESCALATION_REQUIRED",
  "COMPLETED",
  "FAILED_RETRYABLE",
  "FAILED_TERMINAL"
]);

export const TERMINAL_ORCHESTRATION_STATES = Object.freeze([
  "COMPLETED",
  "FAILED_TERMINAL"
]);

export const HELD_ORCHESTRATION_STATES = Object.freeze([
  "SAFE_HOLD",
  "ESCALATION_REQUIRED"
]);

/**
 * Explicit map of legal state transitions.
 * Any transition not explicitly listed is illegal and rejected.
 */
export const LEGAL_ORCHESTRATION_TRANSITIONS = Object.freeze({
  QUEUED: Object.freeze(["CLAIMED", "SAFE_HOLD", "FAILED_TERMINAL"]),
  CLAIMED: Object.freeze(["EVIDENCE_COLLECTION", "WAITING_FOR_RECHECK", "SAFE_HOLD", "FAILED_RETRYABLE", "FAILED_TERMINAL"]),
  EVIDENCE_COLLECTION: Object.freeze([
    "POLICY_EVALUATION",
    "WAITING_FOR_RECHECK",
    "SAFE_HOLD",
    "ESCALATION_REQUIRED",
    "FAILED_RETRYABLE",
    "FAILED_TERMINAL"
  ]),
  POLICY_EVALUATION: Object.freeze([
    "WAITING_FOR_RECHECK",
    "SAFE_HOLD",
    "ESCALATION_REQUIRED",
    "COMPLETED",
    "FAILED_RETRYABLE",
    "FAILED_TERMINAL"
  ]),
  WAITING_FOR_RECHECK: Object.freeze([
    "CLAIMED",
    "SAFE_HOLD",
    "ESCALATION_REQUIRED",
    "FAILED_TERMINAL"
  ]),
  SAFE_HOLD: Object.freeze(["QUEUED"]), // Only manual operator re-queue permitted
  ESCALATION_REQUIRED: Object.freeze(["QUEUED"]), // Only manual operator re-queue permitted
  COMPLETED: Object.freeze([]), // Terminal
  FAILED_RETRYABLE: Object.freeze(["QUEUED", "WAITING_FOR_RECHECK", "FAILED_TERMINAL"]),
  FAILED_TERMINAL: Object.freeze([]) // Terminal
});

/**
 * Checks whether a transition between two orchestration states is legally permitted.
 *
 * @param {string} fromState - Source state
 * @param {string} toState - Destination state
 * @returns {boolean} True if legal, false otherwise
 */
export function isValidOrchestrationTransition(fromState, toState) {
  if (!fromState || !toState) return false;
  if (!ORCHESTRATION_STATES.includes(fromState)) return false;
  if (!ORCHESTRATION_STATES.includes(toState)) return false;

  const allowed = LEGAL_ORCHESTRATION_TRANSITIONS[fromState];
  return Boolean(allowed && allowed.includes(toState));
}

/**
 * Asserts that a transition between two orchestration states is legally permitted.
 * Throws an AppError.badRequest if the transition is illegal.
 *
 * @param {string} fromState - Source state
 * @param {string} toState - Destination state
 * @throws {AppError} If transition is invalid
 */
export function assertValidOrchestrationTransition(fromState, toState) {
  if (!isValidOrchestrationTransition(fromState, toState)) {
    throw AppError.badRequest(
      `Illegal orchestration state transition from '${fromState}' to '${toState}'`
    );
  }
}
