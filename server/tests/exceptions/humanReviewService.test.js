import { describe, it, expect, vi, beforeEach } from "vitest";
import { applyHumanDecision } from "../../src/services/exceptions/humanReviewService.js";
import { ExceptionCase } from "../../src/models/ExceptionCase.js";
import { ReconciliationResult } from "../../src/models/ReconciliationResult.js";
import * as auditService from "../../src/services/audit/auditService.js";

describe("humanReviewService", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("APPROVE_MATCH: resolves exception and sets APPROVED result while PRESERVING original classification", async () => {
    const mockException = {
      exceptionId: "EXC-001",
      resultId: "RES-001",
      merchantOrderId: "ORD-000081",
      status: "OPEN",
      humanDecision: "NONE",
      save: vi.fn().mockResolvedValue(true)
    };

    const mockResult = {
      resultId: "RES-001",
      classification: "AMOUNT_MISMATCH", // Original classification MUST NOT change!
      confidence: 0.95,
      resolutionStatus: "OPEN",
      autoResolved: false,
      requiresReview: true,
      save: vi.fn().mockResolvedValue(true)
    };

    vi.spyOn(ExceptionCase, "findOne").mockResolvedValue(mockException);
    vi.spyOn(ReconciliationResult, "findOne").mockResolvedValue(mockResult);
    vi.spyOn(auditService, "createAuditEvent").mockResolvedValue(true);

    const res = await applyHumanDecision({
      exceptionId: "EXC-001",
      decision: "APPROVE_MATCH",
      resolutionNotes: "Verified amount discrepancy manually with bank statement.",
      actorId: "demo-finance-reviewer"
    });

    expect(res.exceptionCase.status).toBe("RESOLVED");
    expect(res.exceptionCase.humanDecision).toBe("APPROVE_MATCH");
    expect(res.reconciliationResult.resolutionStatus).toBe("APPROVED");
    expect(res.reconciliationResult.requiresReview).toBe(false);

    // CRITICAL MANDATORY INVARIANT: Original classification MUST remain AMOUNT_MISMATCH!
    expect(res.reconciliationResult.classification).toBe("AMOUNT_MISMATCH");

    expect(auditService.createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "HUMAN_DECISION",
        entityId: "EXC-001",
        actorId: "demo-finance-reviewer"
      })
    );
  });

  it("KEEP_EXCEPTION: updates status to UNDER_REVIEW while keeping requiresReview = true and preserving classification", async () => {
    const mockException = {
      exceptionId: "EXC-002",
      resultId: "RES-002",
      merchantOrderId: "ORD-000116",
      status: "OPEN",
      humanDecision: "NONE",
      save: vi.fn().mockResolvedValue(true)
    };

    const mockResult = {
      resultId: "RES-002",
      classification: "AMBIGUOUS",
      confidence: 0.45,
      resolutionStatus: "OPEN",
      autoResolved: false,
      requiresReview: true,
      save: vi.fn().mockResolvedValue(true)
    };

    vi.spyOn(ExceptionCase, "findOne").mockResolvedValue(mockException);
    vi.spyOn(ReconciliationResult, "findOne").mockResolvedValue(mockResult);
    vi.spyOn(auditService, "createAuditEvent").mockResolvedValue(true);

    const res = await applyHumanDecision({
      exceptionId: "EXC-002",
      decision: "KEEP_EXCEPTION",
      resolutionNotes: "Flagged ambiguous scenario for secondary team review.",
      actorId: "demo-finance-reviewer"
    });

    expect(res.exceptionCase.status).toBe("UNDER_REVIEW");
    expect(res.exceptionCase.humanDecision).toBe("KEEP_EXCEPTION");
    expect(res.reconciliationResult.resolutionStatus).toBe("UNDER_REVIEW");
    expect(res.reconciliationResult.requiresReview).toBe(true);
    expect(res.reconciliationResult.classification).toBe("AMBIGUOUS");
  });

  it("MARK_RESOLVED: marks exception RESOLVED with custom notes and preserves classification", async () => {
    const mockException = {
      exceptionId: "EXC-003",
      resultId: "RES-003",
      merchantOrderId: "ORD-000100",
      status: "OPEN",
      humanDecision: "NONE",
      save: vi.fn().mockResolvedValue(true)
    };

    const mockResult = {
      resultId: "RES-003",
      classification: "FEE_MISMATCH",
      confidence: 0.95,
      resolutionStatus: "OPEN",
      autoResolved: false,
      requiresReview: true,
      save: vi.fn().mockResolvedValue(true)
    };

    vi.spyOn(ExceptionCase, "findOne").mockResolvedValue(mockException);
    vi.spyOn(ReconciliationResult, "findOne").mockResolvedValue(mockResult);
    vi.spyOn(auditService, "createAuditEvent").mockResolvedValue(true);

    const res = await applyHumanDecision({
      exceptionId: "EXC-003",
      decision: "MARK_RESOLVED",
      resolutionNotes: "Gateway fee difference accounted for in accounting portal.",
      actorId: "demo-finance-reviewer"
    });

    expect(res.exceptionCase.status).toBe("RESOLVED");
    expect(res.exceptionCase.humanDecision).toBe("MARK_RESOLVED");
    expect(res.reconciliationResult.resolutionStatus).toBe("RESOLVED");
    expect(res.reconciliationResult.requiresReview).toBe(false);
    expect(res.reconciliationResult.classification).toBe("FEE_MISMATCH");
  });

  it("throws 409 Conflict if attempting to overwrite already RESOLVED exception with conflicting decision", async () => {
    const mockException = {
      exceptionId: "EXC-004",
      status: "RESOLVED",
      humanDecision: "MARK_RESOLVED"
    };

    vi.spyOn(ExceptionCase, "findOne").mockResolvedValue(mockException);

    await expect(
      applyHumanDecision({
        exceptionId: "EXC-004",
        decision: "APPROVE_MATCH",
        resolutionNotes: "Trying to overwrite resolved exception."
      })
    ).rejects.toThrow("already RESOLVED");
  });
});
