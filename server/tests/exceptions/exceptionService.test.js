import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createExceptionsForRun,
  getExceptionById,
  listExceptions,
  getExceptionsSummary
} from "../../src/services/exceptions/exceptionService.js";
import { ExceptionCase } from "../../src/models/ExceptionCase.js";
import { ReconciliationResult } from "../../src/models/ReconciliationResult.js";

describe("exceptionService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("creates ExceptionCase documents ONLY for results requiring review", async () => {
    const mockResults = [
      { resultId: "RES-1", merchantOrderId: "ORD-1", classification: "MATCHED", requiresReview: false, confidence: 1.0, reasons: [], expectedAmountPaise: 149900 },
      { resultId: "RES-2", merchantOrderId: "ORD-2", classification: "AMOUNT_MISMATCH", requiresReview: true, confidence: 0.95, reasons: ["Amount differs"], expectedAmountPaise: 149900, differencePaise: -500000 },
      { resultId: "RES-3", merchantOrderId: "ORD-3", classification: "MISSING_SETTLEMENT", requiresReview: true, confidence: 0.95, reasons: ["No settlement"], expectedAmountPaise: 149900 }
    ];

    vi.spyOn(ExceptionCase, "insertMany").mockImplementation(async (docs) => docs);

    const created = await createExceptionsForRun("RUN-001", mockResults);

    // Only 2 results required review (MATCHED was excluded!)
    expect(created).toHaveLength(2);
    expect(created[0].merchantOrderId).toBe("ORD-2");
    expect(created[0].type).toBe("AMOUNT_MISMATCH");
    expect(created[0].severity).toBe("HIGH");
    expect(created[0].financialImpactPaise).toBe(500000);

    expect(created[1].merchantOrderId).toBe("ORD-3");
    expect(created[1].type).toBe("MISSING_SETTLEMENT");
    expect(created[1].severity).toBe("MEDIUM");
  });

  it("getExceptionsSummary computes totals, severity breakdown, and open financial impact", async () => {
    const mockExceptions = [
      { status: "OPEN", severity: "HIGH", type: "AMOUNT_MISMATCH", financialImpactPaise: 10000 },
      { status: "OPEN", severity: "MEDIUM", type: "MISSING_SETTLEMENT", financialImpactPaise: 149900 },
      { status: "RESOLVED", severity: "HIGH", type: "AMOUNT_MISMATCH", financialImpactPaise: 5000 }
    ];

    vi.spyOn(ExceptionCase, "find").mockReturnValue({
      lean: vi.fn().mockResolvedValue(mockExceptions)
    });

    const summary = await getExceptionsSummary();

    expect(summary.totalCount).toBe(3);
    expect(summary.totalOpen).toBe(2);
    expect(summary.resolved).toBe(1);
    expect(summary.openFinancialImpactPaise).toBe(159900); // 10000 + 149900
    expect(summary.bySeverity.HIGH).toBe(2);
    expect(summary.bySeverity.MEDIUM).toBe(1);
    expect(summary.byType.AMOUNT_MISMATCH).toBe(2);
  });
});
