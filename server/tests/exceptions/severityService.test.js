import { describe, it, expect } from "vitest";
import { calculateFinancialImpact, calculateSeverity } from "../../src/services/exceptions/severityService.js";

describe("severityService", () => {
  it("calculates conservative financial impact in integer paise", () => {
    expect(calculateFinancialImpact({ classification: "AMOUNT_MISMATCH", differencePaise: -10000 })).toBe(10000); // ₹100
    expect(calculateFinancialImpact({ classification: "MISSING_PAYMENT", expectedAmountPaise: 149900 })).toBe(149900); // ₹1,499
    expect(calculateFinancialImpact({ classification: "FEE_MISMATCH", differencePaise: 2002 })).toBe(2002);
  });

  it("calculates severity levels deterministically", () => {
    expect(calculateSeverity("DUPLICATE_PAYMENT", 149900)).toBe("CRITICAL");
    expect(calculateSeverity("INVALID_DATA", 5000)).toBe("CRITICAL");
    expect(calculateSeverity("AMOUNT_MISMATCH", 149900)).toBe("HIGH");
    expect(calculateSeverity("AMBIGUOUS", 149900)).toBe("HIGH");
    expect(calculateSeverity("MISSING_SETTLEMENT", 149900)).toBe("MEDIUM");
    expect(calculateSeverity("FEE_MISMATCH", 5000)).toBe("LOW");
  });
});
