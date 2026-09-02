import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import * as reconciliationService from "../../src/services/reconciliation/reconciliationService.js";
import * as evaluationService from "../../src/services/evaluation/evaluationService.js";

describe("Reconciliation REST API Routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("POST /api/reconciliation/runs executes a batch reconciliation run", async () => {
    const mockRunDoc = {
      runId: "RUN-20260902-TEST01",
      name: "Demo Run",
      sourceMode: "SYNTHETIC",
      status: "COMPLETED_WITH_EXCEPTIONS",
      totalRecords: 120,
      processedRecords: 120,
      metrics: { matchedCount: 80, exceptionCount: 40 }
    };

    vi.spyOn(reconciliationService, "runReconciliationBatch").mockResolvedValue(mockRunDoc);

    const res = await request(app)
      .post("/api/reconciliation/runs")
      .send({ name: "Demo Run", sourceMode: "SYNTHETIC" });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.runId).toBe("RUN-20260902-TEST01");
    expect(res.body.data.status).toBe("COMPLETED_WITH_EXCEPTIONS");
  });

  it("POST /api/reconciliation/runs returns 400 Bad Request for invalid sourceMode", async () => {
    const res = await request(app)
      .post("/api/reconciliation/runs")
      .send({ name: "Test", sourceMode: "INVALID_MODE" });

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("GET /api/reconciliation/runs lists paginated runs", async () => {
    const mockList = {
      runs: [{ runId: "RUN-001" }, { runId: "RUN-002" }],
      pagination: { page: 1, limit: 20, total: 2, pages: 1 }
    };

    vi.spyOn(reconciliationService, "listReconciliationRuns").mockResolvedValue(mockList);

    const res = await request(app).get("/api/reconciliation/runs?page=1&limit=20");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.runs).toHaveLength(2);
  });

  it("GET /api/reconciliation/runs/:runId retrieves single run metadata", async () => {
    const mockRun = { runId: "RUN-001", status: "COMPLETED" };
    vi.spyOn(reconciliationService, "getReconciliationRunById").mockResolvedValue(mockRun);

    const res = await request(app).get("/api/reconciliation/runs/RUN-001");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.runId).toBe("RUN-001");
  });

  it("GET /api/reconciliation/runs/:runId/results returns filtered results", async () => {
    const mockResults = {
      results: [{ resultId: "RES-001", classification: "MATCHED" }],
      pagination: { page: 1, limit: 50, total: 1, pages: 1 }
    };

    vi.spyOn(reconciliationService, "getRunResults").mockResolvedValue(mockResults);

    const res = await request(app).get("/api/reconciliation/runs/RUN-001/results?classification=MATCHED");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.results).toHaveLength(1);
  });

  it("GET /api/reconciliation/runs/:runId/metrics retrieves run metrics", async () => {
    const mockMetrics = { matchedCount: 80, exceptionCount: 40 };
    vi.spyOn(reconciliationService, "getRunMetrics").mockResolvedValue(mockMetrics);

    const res = await request(app).get("/api/reconciliation/runs/RUN-001/metrics");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.matchedCount).toBe(80);
  });

  it("GET /api/reconciliation/runs/:runId/evaluation retrieves GroundTruth evaluation report", async () => {
    const mockEvaluation = {
      runId: "RUN-001",
      classificationAccuracy: 1.0,
      exceptionDetection: { precision: 1.0, recall: 1.0, f1Score: 1.0 }
    };

    vi.spyOn(evaluationService, "evaluateReconciliationRun").mockResolvedValue(mockEvaluation);

    const res = await request(app).get("/api/reconciliation/runs/RUN-001/evaluation");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.classificationAccuracy).toBe(1.0);
  });
});
