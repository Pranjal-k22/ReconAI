import { describe, it, expect } from "vitest";
import {
  aiAnalysisOutputSchema,
  ALLOWED_RECOMMENDED_NEXT_STEPS,
  FORBIDDEN_ACTIONS
} from "../../src/services/ai/aiSchemas.js";

describe("AI Schemas & Allowed Action Rules", () => {
  it("should validate a valid AI analysis output", () => {
    const validData = {
      summary: "Amount discrepancy of 500 INR detected between expected order total and captured payment.",
      likelyCause: "Discount code was applied at checkout but not recorded in merchant order metadata.",
      evidence: [
        "Expected Order Total: 1500 INR",
        "Captured Gateway Payment: 1000 INR",
        "Discrepancy: -500 INR"
      ],
      recommendedNextStep: "VERIFY_SOURCE_RECORD",
      riskNotes: ["Accepting without check may result in inaccurate ledger balance."],
      aiConfidence: 0.85
    };

    const parsed = aiAnalysisOutputSchema.parse(validData);
    expect(parsed.summary).toBe(validData.summary);
    expect(parsed.recommendedNextStep).toBe("VERIFY_SOURCE_RECORD");
    expect(parsed.aiConfidence).toBe(0.85);
  });

  it("should accept all allowed recommended next steps", () => {
    ALLOWED_RECOMMENDED_NEXT_STEPS.forEach((step) => {
      const data = {
        summary: "Valid summary",
        likelyCause: "Valid cause",
        evidence: [],
        recommendedNextStep: step,
        riskNotes: [],
        aiConfidence: null
      };

      const parsed = aiAnalysisOutputSchema.parse(data);
      expect(parsed.recommendedNextStep).toBe(step);
    });
  });

  it("should reject forbidden financial execution actions", () => {
    FORBIDDEN_ACTIONS.forEach((action) => {
      const invalidData = {
        summary: "Forbidden recommendation test",
        likelyCause: "Test cause",
        evidence: [],
        recommendedNextStep: action,
        riskNotes: [],
        aiConfidence: 0.99
      };

      expect(() => aiAnalysisOutputSchema.parse(invalidData)).toThrow();
    });
  });

  it("should reject empty summary or likelyCause", () => {
    expect(() =>
      aiAnalysisOutputSchema.parse({
        summary: "",
        likelyCause: "Valid cause",
        evidence: [],
        recommendedNextStep: "MANUAL_REVIEW"
      })
    ).toThrow();

    expect(() =>
      aiAnalysisOutputSchema.parse({
        summary: "Valid summary",
        likelyCause: "",
        evidence: [],
        recommendedNextStep: "MANUAL_REVIEW"
      })
    ).toThrow();
  });

  it("should enforce maximum array length limits", () => {
    const tooManyEvidence = Array(15).fill("Evidence line");
    expect(() =>
      aiAnalysisOutputSchema.parse({
        summary: "Valid summary",
        likelyCause: "Valid cause",
        evidence: tooManyEvidence,
        recommendedNextStep: "MANUAL_REVIEW"
      })
    ).toThrow();
  });
});
