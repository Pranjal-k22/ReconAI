import { describe, it, expect, beforeEach } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { ExceptionCase } from "../../src/models/ExceptionCase.js";
import { ReconciliationResult } from "../../src/models/ReconciliationResult.js";
import { AuditLog } from "../../src/models/AuditLog.js";

describe("AI Investigation API Routes (POST /api/exceptions/:exceptionId/investigate)", () => {
  beforeEach(async () => {
    await ExceptionCase.deleteMany({});
    await ReconciliationResult.deleteMany({});
    await AuditLog.deleteMany({});
  });

  it("POST /api/exceptions/:exceptionId/investigate should return 200 with fallback analysis when Gemini is unconfigured", async () => {
    const resDoc = await ReconciliationResult.create({
      resultId: "RES-ROUTE-001",
      runId: "RUN-ROUTE-001",
      merchantOrderId: "ORD-ROUTE-001",
      status: "OPEN",
      classification: "AMOUNT_MISMATCH",
      confidence: 0.8,
      requiresReview: true,
      resolutionStatus: "OPEN",
      expectedAmountPaise: 100000,
      actualAmountPaise: 90000,
      differencePaise: -10000,
      reasons: ["Amount mismatch"]
    });

    const excDoc = await ExceptionCase.create({
      exceptionId: "EXC-ROUTE-001",
      runId: "RUN-ROUTE-001",
      resultId: resDoc.resultId,
      merchantOrderId: "ORD-ROUTE-001",
      type: "AMOUNT_MISMATCH",
      severity: "HIGH",
      confidence: 0.8,
      financialImpactPaise: 10000,
      title: "Exception: AMOUNT_MISMATCH",
      deterministicExplanation: "Amount mismatch",
      status: "OPEN"
    });

    const res = await request(app)
      .post(`/api/exceptions/${excDoc.exceptionId}/investigate`)
      .send({ actorId: "test-api-reviewer" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.exceptionId).toBe("EXC-ROUTE-001");
    expect(res.body.data.source).toBeDefined();
    expect(res.body.data.analysis).toBeDefined();
    expect(res.body.data.analysis.summary).toBeDefined();
    expect(res.body.data.analysis.recommendedNextStep).toBeDefined();
  });

  it("POST /api/exceptions/:exceptionId/investigate should return 404 for non-existent exception", async () => {
    const res = await request(app)
      .post("/api/exceptions/EXC-NONEXISTENT/investigate")
      .send({ actorId: "test-api-reviewer" });

    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
