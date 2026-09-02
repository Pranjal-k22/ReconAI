import { describe, it, expect } from "vitest";
import { ExceptionCase } from "../../src/models/ExceptionCase.js";

describe("ExceptionCase Model Schema & Validation", () => {
  it("should validate a valid exception case", async () => {
    const exc = new ExceptionCase({
      exceptionId: "EXC-00001",
      runId: "RUN-001",
      resultId: "RES-00002",
      merchantOrderId: "ORD-100002",
      type: "AMOUNT_MISMATCH",
      severity: "HIGH",
      confidence: 0.98,
      financialImpactPaise: 900,
      title: "Amount discrepancy detected",
      deterministicExplanation: "Gateway payment amount ₹1,490.00 does not match order amount ₹1,499.00 (Difference: -₹9.00)",
      aiExplanation: "Possible promotional discount unapplied at gateway checkout.",
      aiRecommendation: "Verify merchant checkout log for promo code 'DISCOUNT9'.",
      aiConfidence: 0.85,
      status: "OPEN",
      humanDecision: "NONE"
    });

    const err = await exc.validate();
    expect(err).toBeUndefined();
  });

  it("should reject MATCHED as an exception type", async () => {
    const invalidExc = new ExceptionCase({
      exceptionId: "EXC-MATCHED",
      runId: "RUN-001",
      resultId: "RES-00001",
      type: "MATCHED",
      title: "Invalid matched exception",
      deterministicExplanation: "Should fail"
    });

    await expect(invalidExc.validate()).rejects.toThrow();
  });

  it("should reject invalid severity or status", async () => {
    const badExc = new ExceptionCase({
      exceptionId: "EXC-BAD-SEV",
      runId: "RUN-001",
      resultId: "RES-001",
      type: "AMOUNT_MISMATCH",
      severity: "SUPER_CRITICAL",
      title: "Bad severity",
      deterministicExplanation: "Fail"
    });

    await expect(badExc.validate()).rejects.toThrow();
  });

  it("should enforce separate storage for deterministic and AI explanations", () => {
    const exc = new ExceptionCase({
      exceptionId: "EXC-SEP-001",
      runId: "RUN-001",
      resultId: "RES-001",
      type: "MISSING_PAYMENT",
      title: "Missing Payment",
      deterministicExplanation: "Deterministic rule: Zero payments found for order.",
      aiExplanation: "AI advisory: Payment attempt failed during bank OTP."
    });

    expect(exc.deterministicExplanation).not.toEqual(exc.aiExplanation);
    expect(exc.deterministicExplanation).toContain("Deterministic rule");
    expect(exc.aiExplanation).toContain("AI advisory");
  });
});
