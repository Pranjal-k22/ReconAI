import { describe, it, expect } from "vitest";
import { calculateConfidence } from "../../src/services/reconciliation/confidenceEngine.js";

describe("confidenceEngine", () => {
  it("returns high confidence >= 0.95 for MATCHED classification", () => {
    const score = calculateConfidence({ classification: "MATCHED", evidence: { timestampPlausible: true } });
    expect(score).toBe(1.0);
  });

  it("returns lower confidence ~0.45 for AMBIGUOUS classification", () => {
    const score = calculateConfidence({ classification: "AMBIGUOUS" });
    expect(score).toBe(0.45);
  });

  it("returns deterministic ~0.95 for clear anomaly classifications", () => {
    expect(calculateConfidence({ classification: "AMOUNT_MISMATCH" })).toBe(0.95);
    expect(calculateConfidence({ classification: "MISSING_SETTLEMENT" })).toBe(0.95);
    expect(calculateConfidence({ classification: "MISSING_PAYMENT" })).toBe(0.95);
  });
});
