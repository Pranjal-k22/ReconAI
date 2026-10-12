import { describe, it, expect } from "vitest";
import {
  ORCHESTRATION_STATES,
  TERMINAL_ORCHESTRATION_STATES,
  HELD_ORCHESTRATION_STATES,
  LEGAL_ORCHESTRATION_TRANSITIONS,
  isValidOrchestrationTransition,
  assertValidOrchestrationTransition
} from "../../src/services/orchestration/orchestrationStateMachine.js";
import { AppError } from "../../src/utils/AppError.js";

describe("Orchestration State Machine Unit Tests", () => {
  it("1. Defines all 10 required orchestration states", () => {
    expect(ORCHESTRATION_STATES).toContain("QUEUED");
    expect(ORCHESTRATION_STATES).toContain("CLAIMED");
    expect(ORCHESTRATION_STATES).toContain("EVIDENCE_COLLECTION");
    expect(ORCHESTRATION_STATES).toContain("POLICY_EVALUATION");
    expect(ORCHESTRATION_STATES).toContain("WAITING_FOR_RECHECK");
    expect(ORCHESTRATION_STATES).toContain("SAFE_HOLD");
    expect(ORCHESTRATION_STATES).toContain("ESCALATION_REQUIRED");
    expect(ORCHESTRATION_STATES).toContain("COMPLETED");
    expect(ORCHESTRATION_STATES).toContain("FAILED_RETRYABLE");
    expect(ORCHESTRATION_STATES).toContain("FAILED_TERMINAL");
    expect(ORCHESTRATION_STATES.length).toBe(10);
  });

  it("2. Validates legal transitions from QUEUED", () => {
    expect(isValidOrchestrationTransition("QUEUED", "CLAIMED")).toBe(true);
    expect(isValidOrchestrationTransition("QUEUED", "SAFE_HOLD")).toBe(true);
    expect(isValidOrchestrationTransition("QUEUED", "FAILED_TERMINAL")).toBe(true);

    // Illegal transitions directly from QUEUED
    expect(isValidOrchestrationTransition("QUEUED", "COMPLETED")).toBe(false);
    expect(isValidOrchestrationTransition("QUEUED", "POLICY_EVALUATION")).toBe(false);
    expect(isValidOrchestrationTransition("QUEUED", "EVIDENCE_COLLECTION")).toBe(false);
  });

  it("3. Validates legal transitions from CLAIMED", () => {
    expect(isValidOrchestrationTransition("CLAIMED", "EVIDENCE_COLLECTION")).toBe(true);
    expect(isValidOrchestrationTransition("CLAIMED", "SAFE_HOLD")).toBe(true);
    expect(isValidOrchestrationTransition("CLAIMED", "FAILED_RETRYABLE")).toBe(true);
    expect(isValidOrchestrationTransition("CLAIMED", "FAILED_TERMINAL")).toBe(true);

    expect(isValidOrchestrationTransition("CLAIMED", "COMPLETED")).toBe(false);
  });

  it("4. Validates legal transitions from EVIDENCE_COLLECTION", () => {
    expect(isValidOrchestrationTransition("EVIDENCE_COLLECTION", "POLICY_EVALUATION")).toBe(true);
    expect(isValidOrchestrationTransition("EVIDENCE_COLLECTION", "WAITING_FOR_RECHECK")).toBe(true);
    expect(isValidOrchestrationTransition("EVIDENCE_COLLECTION", "SAFE_HOLD")).toBe(true);
    expect(isValidOrchestrationTransition("EVIDENCE_COLLECTION", "ESCALATION_REQUIRED")).toBe(true);
    expect(isValidOrchestrationTransition("EVIDENCE_COLLECTION", "FAILED_RETRYABLE")).toBe(true);

    expect(isValidOrchestrationTransition("EVIDENCE_COLLECTION", "COMPLETED")).toBe(false);
  });

  it("5. Validates legal transitions from POLICY_EVALUATION", () => {
    expect(isValidOrchestrationTransition("POLICY_EVALUATION", "COMPLETED")).toBe(true);
    expect(isValidOrchestrationTransition("POLICY_EVALUATION", "SAFE_HOLD")).toBe(true);
    expect(isValidOrchestrationTransition("POLICY_EVALUATION", "ESCALATION_REQUIRED")).toBe(true);
    expect(isValidOrchestrationTransition("POLICY_EVALUATION", "WAITING_FOR_RECHECK")).toBe(true);

    expect(isValidOrchestrationTransition("POLICY_EVALUATION", "CLAIMED")).toBe(false);
  });

  it("6. Rejects illegal transitions and throws AppError.badRequest", () => {
    expect(() => assertValidOrchestrationTransition("QUEUED", "COMPLETED")).toThrow(AppError);
    expect(() => assertValidOrchestrationTransition("QUEUED", "COMPLETED")).toThrow(/Illegal orchestration state transition/);

    expect(() => assertValidOrchestrationTransition("COMPLETED", "QUEUED")).toThrow(AppError);
    expect(() => assertValidOrchestrationTransition("FAILED_TERMINAL", "CLAIMED")).toThrow(AppError);
  });

  it("7. Terminal states permit no outbound transitions", () => {
    for (const termState of TERMINAL_ORCHESTRATION_STATES) {
      for (const anyState of ORCHESTRATION_STATES) {
        expect(isValidOrchestrationTransition(termState, anyState)).toBe(false);
      }
    }
  });

  it("8. Held states permit only manual operator re-queue to QUEUED", () => {
    for (const heldState of HELD_ORCHESTRATION_STATES) {
      expect(isValidOrchestrationTransition(heldState, "QUEUED")).toBe(true);
      expect(isValidOrchestrationTransition(heldState, "COMPLETED")).toBe(false);
      expect(isValidOrchestrationTransition(heldState, "CLAIMED")).toBe(false);
    }
  });
});
