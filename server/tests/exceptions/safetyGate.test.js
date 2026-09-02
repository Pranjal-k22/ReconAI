import { describe, it, expect } from "vitest";
import { evaluateSafetyGate } from "../../src/services/exceptions/safetyGateService.js";

describe("Safety Gate Rules Test Suite", () => {
  it("Test 1: MATCHED with confidence 1.0 and requiresReview = false permits automatic resolution", () => {
    const gate = evaluateSafetyGate({
      classification: "MATCHED",
      confidence: 1.0,
      requiresReview: false
    });

    expect(gate.allowedAutomaticResolution).toBe(true);
    expect(gate.requiresHumanReview).toBe(false);
  });

  it("Test 2: MATCHED with confidence 0.90 (< 0.95) blocks automatic resolution", () => {
    const gate = evaluateSafetyGate({
      classification: "MATCHED",
      confidence: 0.90,
      requiresReview: false
    });

    expect(gate.allowedAutomaticResolution).toBe(false);
    expect(gate.requiresHumanReview).toBe(true);
    expect(gate.reason).toContain("below safety threshold");
  });

  it("Test 3: AMOUNT_MISMATCH with confidence 0.99 (>= 0.95) blocks automatic resolution", () => {
    const gate = evaluateSafetyGate({
      classification: "AMOUNT_MISMATCH",
      confidence: 0.99,
      requiresReview: true
    });

    expect(gate.allowedAutomaticResolution).toBe(false);
    expect(gate.requiresHumanReview).toBe(true);
    expect(gate.reason).toContain("requires human review regardless of confidence");
  });

  it("Test 4: AMBIGUOUS with confidence 0.45 requires manual human review", () => {
    const gate = evaluateSafetyGate({
      classification: "AMBIGUOUS",
      confidence: 0.45,
      requiresReview: true
    });

    expect(gate.allowedAutomaticResolution).toBe(false);
    expect(gate.requiresHumanReview).toBe(true);
  });
});
