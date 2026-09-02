import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import * as exceptionService from "../../src/services/exceptions/exceptionService.js";
import * as humanReviewService from "../../src/services/exceptions/humanReviewService.js";

describe("Exception REST API Routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("GET /api/exceptions lists paginated exceptions", async () => {
    const mockList = {
      exceptions: [{ exceptionId: "EXC-001", type: "AMOUNT_MISMATCH" }],
      pagination: { page: 1, limit: 50, total: 1, pages: 1 }
    };

    vi.spyOn(exceptionService, "listExceptions").mockResolvedValue(mockList);

    const res = await request(app).get("/api/exceptions");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.exceptions).toHaveLength(1);
  });

  it("GET /api/exceptions/summary retrieves exception statistics", async () => {
    const mockSummary = { totalCount: 40, totalOpen: 40, openFinancialImpactPaise: 28607582 };
    vi.spyOn(exceptionService, "getExceptionsSummary").mockResolvedValue(mockSummary);

    const res = await request(app).get("/api/exceptions/summary");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.totalOpen).toBe(40);
  });

  it("GET /api/exceptions/:exceptionId retrieves single exception details", async () => {
    const mockExc = { exceptionId: "EXC-001", type: "AMOUNT_MISMATCH", status: "OPEN" };
    vi.spyOn(exceptionService, "getExceptionById").mockResolvedValue(mockExc);

    const res = await request(app).get("/api/exceptions/EXC-001");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.exceptionId).toBe("EXC-001");
  });

  it("PATCH /api/exceptions/:exceptionId/decision applies human decision", async () => {
    const mockOutput = {
      exceptionCase: { exceptionId: "EXC-001", status: "RESOLVED", humanDecision: "MARK_RESOLVED" },
      reconciliationResult: { resultId: "RES-001", resolutionStatus: "RESOLVED" }
    };

    vi.spyOn(humanReviewService, "applyHumanDecision").mockResolvedValue(mockOutput);

    const res = await request(app)
      .patch("/api/exceptions/EXC-001/decision")
      .send({
        decision: "MARK_RESOLVED",
        resolutionNotes: "Verified amount mismatch against finance portal manually.",
        actorId: "demo-finance-reviewer"
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.exceptionCase.status).toBe("RESOLVED");
  });

  it("PATCH /api/exceptions/:exceptionId/decision returns 400 for short resolutionNotes", async () => {
    const res = await request(app)
      .patch("/api/exceptions/EXC-001/decision")
      .send({
        decision: "MARK_RESOLVED",
        resolutionNotes: "ok" // Less than 5 chars!
      });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
