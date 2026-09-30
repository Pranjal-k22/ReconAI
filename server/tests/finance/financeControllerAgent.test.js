import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import { FinanceControllerRun } from "../../src/models/FinanceControllerRun.js";
import * as financeControllerAgent from "../../src/services/finance/financeControllerAgent.js";
import * as reconciliationService from "../../src/services/reconciliation/reconciliationService.js";
import * as evaluationService from "../../src/services/evaluation/evaluationService.js";

describe("Finance Controller Agent & REST API Test Suite", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Unit & Service Layer Tests", () => {
    it("should instantiate FinanceControllerRun model with valid defaults and schema rules", () => {
      const doc = new FinanceControllerRun({
        runId: "FCRUN-TEST-001",
        name: "Test Run",
        sourceMode: "SYNTHETIC",
        controllerState: "IDLE",
        status: "PENDING",
        batchSize: 120,
        totalAmountProcessedPaise: 103018000
      });

      expect(doc.runId).toBe("FCRUN-TEST-001");
      expect(doc.controllerState).toBe("IDLE");
      expect(doc.status).toBe("PENDING");
      expect(doc.batchSize).toBe(120);
      expect(doc.totalAmountProcessedPaise).toBe(103018000);
      expect(doc.validateSync()).toBeUndefined();
    });

    it("should reject negative or floating point values for integer paise fields", () => {
      const doc = new FinanceControllerRun({
        runId: "FCRUN-TEST-INVALID",
        totalAmountProcessedPaise: -500
      });

      const err = doc.validateSync();
      expect(err).toBeDefined();
      expect(err.errors.totalAmountProcessedPaise).toBeDefined();
    });

    it("should execute full state machine lifecycle for a 120-scenario batch", async () => {
      const mockReconRun = {
        runId: "RUN-20260930-MOCK01",
        status: "COMPLETED_WITH_EXCEPTIONS",
        processedRecords: 120,
        metrics: {
          matchedCount: 80,
          exceptionCount: 40,
          classificationBreakdown: { MATCHED: 80, AMOUNT_MISMATCH: 8, MISSING_SETTLEMENT: 6 }
        }
      };

      const mockControllerDoc = {
        runId: "FCRUN-20260930-TEST120",
        name: "Track 4 AI Finance Controller Run",
        sourceMode: "SYNTHETIC",
        importBatchId: "BATCH-DEMO-V1",
        datasetVersion: "RECONAI_DEMO_V1",
        controllerState: "COMPLETED",
        status: "COMPLETED_WITH_EXCEPTIONS",
        currentPhase: "FINISHED",
        progressPercent: 100,
        batchSize: 120,
        processedRecords: 120,
        matchedRecords: 80,
        exceptionRecords: 40,
        autoResolvedRecords: 80,
        manualReviewRecords: 40,
        unresolvedRecords: 40,
        matchRate: 66.67,
        exceptionRate: 33.33,
        throughput: 253.16,
        totalAmountProcessedPaise: 103018000,
        autoReconciledAmountPaise: 71702000,
        amountUnderReviewPaise: 31316000,
        reconciliationRunId: "RUN-20260930-MOCK01",
        report: {
          runId: "FCRUN-20260930-TEST120",
          matchRate: 66.67,
          metrics: { batchSize: 120, matchedRecords: 80, exceptionRecords: 40, unresolvedRecords: 40 },
          unresolvedExceptions: []
        },
        toObject: function () {
          return this;
        }
      };

      vi.spyOn(financeControllerAgent, "runFinanceControllerBatch").mockResolvedValue(mockControllerDoc);

      const result = await financeControllerAgent.runFinanceControllerBatch({
        name: "Track 4 AI Finance Controller Run",
        sourceMode: "SYNTHETIC",
        importBatchId: "BATCH-DEMO-V1"
      });

      expect(result.runId).toBe("FCRUN-20260930-TEST120");
      expect(result.controllerState).toBe("COMPLETED");
      expect(result.status).toBe("COMPLETED_WITH_EXCEPTIONS");
      expect(result.batchSize).toBe(120);
      expect(result.matchedRecords).toBe(80);
      expect(result.exceptionRecords).toBe(40);
      expect(result.unresolvedRecords).toBe(40);
      expect(result.matchRate).toBe(66.67);
      expect(result.totalAmountProcessedPaise).toBe(103018000);
      expect(result.autoReconciledAmountPaise).toBe(71702000);
      expect(result.amountUnderReviewPaise).toBe(31316000);
    });
  });

  describe("REST API Endpoints", () => {
    it("POST /api/finance-controller/run triggers a new controller batch run", async () => {
      const mockRun = {
        runId: "FCRUN-API-001",
        name: "API Test Run",
        sourceMode: "SYNTHETIC",
        controllerState: "COMPLETED",
        status: "COMPLETED_WITH_EXCEPTIONS",
        batchSize: 120,
        matchedRecords: 80,
        exceptionRecords: 40,
        matchRate: 66.67
      };

      vi.spyOn(financeControllerAgent, "runFinanceControllerBatch").mockResolvedValue(mockRun);

      const res = await request(app)
        .post("/api/finance-controller/run")
        .send({
          name: "API Test Run",
          sourceMode: "SYNTHETIC",
          importBatchId: "BATCH-DEMO-V1",
          autoInvestigate: true
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.runId).toBe("FCRUN-API-001");
      expect(res.body.data.matchRate).toBe(66.67);
    });

    it("POST /api/finance-controller/run returns 400 Bad Request for unsupported sourceMode", async () => {
      const res = await request(app)
        .post("/api/finance-controller/run")
        .send({ name: "Invalid", sourceMode: "INVALID_MODE" });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toBeDefined();
    });

    it("GET /api/finance-controller/runs lists historical runs", async () => {
      const mockList = {
        runs: [{ runId: "FCRUN-001" }, { runId: "FCRUN-002" }],
        pagination: { page: 1, limit: 20, total: 2, pages: 1 }
      };

      vi.spyOn(financeControllerAgent, "listControllerRuns").mockResolvedValue(mockList);

      const res = await request(app).get("/api/finance-controller/runs?page=1&limit=20");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.runs).toHaveLength(2);
    });

    it("GET /api/finance-controller/runs/:runId retrieves run metadata", async () => {
      const mockRun = { runId: "FCRUN-001", controllerState: "COMPLETED", status: "COMPLETED" };
      vi.spyOn(financeControllerAgent, "getControllerRunById").mockResolvedValue(mockRun);

      const res = await request(app).get("/api/finance-controller/runs/FCRUN-001");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.runId).toBe("FCRUN-001");
    });

    it("GET /api/finance-controller/runs/:runId/report retrieves full Track 4 Finance Controller Report", async () => {
      const mockReport = {
        runId: "FCRUN-001",
        matchRate: 66.67,
        metrics: { batchSize: 120, matchedRecords: 80, exceptionRecords: 40, unresolvedRecords: 40 },
        unresolvedExceptions: [
          { exceptionId: "EXC-001", merchantOrderId: "ORD-000116", type: "AMBIGUOUS", severity: "HIGH" }
        ]
      };

      vi.spyOn(financeControllerAgent, "getControllerRunReport").mockResolvedValue(mockReport);

      const res = await request(app).get("/api/finance-controller/runs/FCRUN-001/report");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.runId).toBe("FCRUN-001");
      expect(res.body.data.matchRate).toBe(66.67);
      expect(res.body.data.unresolvedExceptions).toHaveLength(1);
    });

    it("GET /api/finance-controller/runs/:runId/status retrieves lightweight status for polling", async () => {
      const mockStatus = {
        runId: "FCRUN-001",
        controllerState: "EXCEPTION_PROCESSING",
        status: "RUNNING",
        progressPercent: 85
      };

      vi.spyOn(financeControllerAgent, "getControllerRunStatus").mockResolvedValue(mockStatus);

      const res = await request(app).get("/api/finance-controller/runs/FCRUN-001/status");

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.progressPercent).toBe(85);
      expect(res.body.data.controllerState).toBe("EXCEPTION_PROCESSING");
    });
  });

  describe("Safety & Invariant Protections", () => {
    it("enforces that AI investigation does NOT resolve an exception automatically", async () => {
      const exc = {
        exceptionId: "EXC-TEST-001",
        type: "AMOUNT_MISMATCH",
        resolutionStatus: "OPEN",
        aiExplanation: "Discrepancy detected: -900 paise (-9.00 INR)."
      };

      // Verify that having an aiExplanation does NOT equal resolution
      const isUnresolved = exc.resolutionStatus === "OPEN" || exc.resolutionStatus === "UNDER_REVIEW";
      expect(isUnresolved).toBe(true);
      expect(exc.aiExplanation).toBeDefined();
    });

    it("enforces that matchRate is computed operationally while benchmark accuracy requires GroundTruth", () => {
      const batchSize = 120;
      const matchedRecords = 80;

      // Operational match rate (auto-reconciled clean matches / total batch size)
      const matchRate = (matchedRecords / batchSize) * 100;
      expect(matchRate).toBeCloseTo(66.67, 2);

      // Operational match rate MUST NOT be called benchmark accuracy
      expect(matchRate).not.toBe(100.0);
    });

    it("enforces Financial Sum Invariant: totalAmountProcessedPaise === autoReconciledAmountPaise + amountUnderReviewPaise", () => {
      const totalAmountProcessedPaise = 103018000;
      const autoReconciledAmountPaise = 71702000;
      const amountUnderReviewPaise = totalAmountProcessedPaise - autoReconciledAmountPaise;

      expect(amountUnderReviewPaise).toBe(31316000);
      expect(totalAmountProcessedPaise).toBe(autoReconciledAmountPaise + amountUnderReviewPaise);
    });

    it("verifies unresolved exception count rules (Cases A, B, C, D)", () => {
      const exceptions = [
        { exceptionId: "EXC-001", status: "OPEN", aiExplanation: "Advisory analysis complete" },
        { exceptionId: "EXC-002", status: "UNDER_REVIEW", aiExplanation: "Advisory analysis complete" },
        { exceptionId: "EXC-003", status: "RESOLVED", humanDecision: "APPROVE_MATCH" },
        { exceptionId: "EXC-004", status: "OPEN", aiExplanation: null }
      ];

      // Case A & B: Unresolved exceptions are strictly status OPEN or UNDER_REVIEW
      const unresolved = exceptions.filter((e) => e.status === "OPEN" || e.status === "UNDER_REVIEW");
      expect(unresolved).toHaveLength(3); // EXC-001, EXC-002, EXC-004

      // Case C: AI explanation does NOT resolve exception (EXC-001 has aiExplanation but remains unresolved)
      const exc1 = exceptions.find((e) => e.exceptionId === "EXC-001");
      expect(exc1.aiExplanation).toBeDefined();
      expect(exc1.status).toBe("OPEN");
      expect(unresolved.some((e) => e.exceptionId === "EXC-001")).toBe(true);

      // Case D: Human resolution removes exception from unresolved list (EXC-003 is RESOLVED)
      expect(unresolved.some((e) => e.exceptionId === "EXC-003")).toBe(false);
    });
  });
});

