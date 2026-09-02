import { describe, it, expect } from "vitest";
import { ReconciliationRun } from "../../src/models/ReconciliationRun.js";
import { ReconciliationResult } from "../../src/models/ReconciliationResult.js";

describe("ReconciliationRun & ReconciliationResult Models", () => {
  describe("ReconciliationRun", () => {
    it("should validate a valid reconciliation run", async () => {
      const run = new ReconciliationRun({
        runId: "RUN-2026-09-02-001",
        name: "Benchmark 120 Run",
        sourceMode: "SYNTHETIC",
        status: "RUNNING",
        totalRecords: 120
      });

      const err = await run.validate();
      expect(err).toBeUndefined();
    });

    it("should reject negative totalRecords or durationMs", async () => {
      const run = new ReconciliationRun({
        runId: "RUN-BAD",
        totalRecords: -10
      });

      await expect(run.validate()).rejects.toThrow();
    });

    it("should reject invalid sourceMode", async () => {
      const run = new ReconciliationRun({
        runId: "RUN-INVALID_MODE",
        sourceMode: "UNKNOWN_MODE"
      });

      await expect(run.validate()).rejects.toThrow();
    });
  });

  describe("ReconciliationResult", () => {
    it("should validate a clean MATCHED result", async () => {
      const result = new ReconciliationResult({
        resultId: "RES-00001",
        runId: "RUN-2026-09-02-001",
        merchantOrderId: "ORD-100001",
        gatewayPaymentIds: ["pay_ABC123"],
        settlementRecordIds: ["set_rec_001"],
        classification: "MATCHED",
        confidence: 1.0,
        expectedAmountPaise: 149900,
        actualAmountPaise: 149900,
        differencePaise: 0,
        resolutionStatus: "AUTO_RECONCILED"
      });

      const err = await result.validate();
      expect(err).toBeUndefined();
    });

    it("should reject confidence outside range [0, 1]", async () => {
      const lowResult = new ReconciliationResult({
        resultId: "RES-BAD-1",
        runId: "RUN-001",
        classification: "MATCHED",
        confidence: -0.1
      });

      const highResult = new ReconciliationResult({
        resultId: "RES-BAD-2",
        runId: "RUN-001",
        classification: "MATCHED",
        confidence: 1.5
      });

      await expect(lowResult.validate()).rejects.toThrow();
      await expect(highResult.validate()).rejects.toThrow();
    });

    it("should accept signed differencePaise following convention actual - expected", async () => {
      const mismatch = new ReconciliationResult({
        resultId: "RES-DIFF-1",
        runId: "RUN-001",
        classification: "AMOUNT_MISMATCH",
        confidence: 0.98,
        expectedAmountPaise: 149900,
        actualAmountPaise: 149000,
        differencePaise: -900,
        requiresReview: true
      });

      const err = await mismatch.validate();
      expect(err).toBeUndefined();
      expect(mismatch.differencePaise).toBe(-900);
    });

    it("should reject invalid classification", async () => {
      const result = new ReconciliationResult({
        resultId: "RES-INVALID_CLASS",
        runId: "RUN-001",
        classification: "SUPER_MATCH",
        confidence: 0.9
      });

      await expect(result.validate()).rejects.toThrow();
    });
  });
});
