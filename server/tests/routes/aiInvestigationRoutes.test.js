import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import * as exceptionInvestigator from "../../src/services/ai/exceptionInvestigator.js";
import { AppError } from "../../src/utils/AppError.js";

describe("AI Investigation API Routes (POST /api/exceptions/:exceptionId/investigate)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("POST /api/exceptions/:exceptionId/investigate should return 200 with analysis data", async () => {
    const mockInvestigation = {
      exceptionId: "EXC-ROUTE-001",
      source: "FALLBACK",
      analysis: {
        summary: "Deterministic fallback explanation for test exception.",
        likelyCause: "Payment discrepancy.",
        evidence: ["Expected: 1000 INR", "Actual: 900 INR"],
        recommendedNextStep: "VERIFY_SOURCE_RECORD",
        riskNotes: [],
        aiConfidence: null
      }
    };

    vi.spyOn(exceptionInvestigator, "investigateException").mockResolvedValue(mockInvestigation);

    const res = await request(app)
      .post("/api/exceptions/EXC-ROUTE-001/investigate")
      .send({ actorId: "test-api-reviewer" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.exceptionId).toBe("EXC-ROUTE-001");
    expect(res.body.data.source).toBe("FALLBACK");
    expect(res.body.data.analysis.summary).toBe(mockInvestigation.analysis.summary);
    expect(res.body.data.analysis.recommendedNextStep).toBe("VERIFY_SOURCE_RECORD");
  });

  it("POST /api/exceptions/:exceptionId/investigate should return 404 for non-existent exception", async () => {
    vi.spyOn(exceptionInvestigator, "investigateException").mockRejectedValue(
      AppError.notFound("ExceptionCase not found for exceptionId 'EXC-NONEXISTENT'")
    );

    const res = await request(app)
      .post("/api/exceptions/EXC-NONEXISTENT/investigate")
      .send({ actorId: "test-api-reviewer" });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
