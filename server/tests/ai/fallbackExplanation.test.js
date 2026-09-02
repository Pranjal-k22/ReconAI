import { describe, it, expect } from "vitest";
import { generateFallbackExplanation } from "../../src/services/ai/fallbackExplanation.js";
import { aiAnalysisOutputSchema } from "../../src/services/ai/aiSchemas.js";

describe("Deterministic Fallback Explanation Service", () => {
  const exceptionTypes = [
    "AMOUNT_MISMATCH",
    "MISSING_PAYMENT",
    "MISSING_SETTLEMENT",
    "DUPLICATE_PAYMENT",
    "DUPLICATE_SETTLEMENT",
    "FEE_MISMATCH",
    "REFUND_MISMATCH",
    "REFERENCE_MISMATCH",
    "STATUS_MISMATCH",
    "AMBIGUOUS",
    "INVALID_DATA"
  ];

  it("should generate a schema-valid fallback explanation for all 11 exception types", () => {
    exceptionTypes.forEach((type) => {
      const mockException = {
        exceptionId: `EXC-TEST-${type}`,
        merchantOrderId: "ORD-TEST-001",
        type,
        severity: "HIGH",
        financialImpactPaise: 50000,
        status: "OPEN"
      };

      const mockResult = {
        classification: type,
        expectedAmountPaise: 100000,
        actualAmountPaise: 50000,
        differencePaise: -50000,
        reasons: [`Reason line for ${type}`]
      };

      const fallback = generateFallbackExplanation({
        exceptionCase: mockException,
        reconciliationResult: mockResult
      });

      expect(fallback).toBeDefined();
      expect(fallback.aiConfidence).toBeNull();
      expect(typeof fallback.summary).toBe("string");
      expect(fallback.summary.length).toBeGreaterThan(0);
      expect(typeof fallback.likelyCause).toBe("string");
      expect(Array.isArray(fallback.evidence)).toBe(true);
      expect(Array.isArray(fallback.riskNotes)).toBe(true);

      // Verify that the output strictly satisfies Zod schema
      const parsed = aiAnalysisOutputSchema.parse(fallback);
      expect(parsed.recommendedNextStep).toBeDefined();
    });
  });

  it("should handle null/missing reconciliation result gracefully", () => {
    const fallback = generateFallbackExplanation({
      exceptionCase: { merchantOrderId: "ORD-NULL", type: "INVALID_DATA" },
      reconciliationResult: null
    });

    expect(fallback).toBeDefined();
    expect(fallback.summary).toContain("ORD-NULL");
    expect(fallback.aiConfidence).toBeNull();
  });
});
