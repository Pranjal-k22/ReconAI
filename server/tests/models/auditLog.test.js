import { describe, it, expect } from "vitest";
import { AuditLog } from "../../src/models/AuditLog.js";

describe("AuditLog Model Schema & Validation", () => {
  it("should validate a valid audit log event", async () => {
    const audit = new AuditLog({
      eventId: "AUD-00001",
      timestamp: new Date(),
      actorType: "RULE_ENGINE",
      actorId: "deterministic-matcher-v1",
      action: "RECONCILIATION_COMPLETED",
      entityType: "ReconciliationRun",
      entityId: "RUN-001",
      runId: "RUN-001",
      metadata: { totalRecords: 120, matched: 80 }
    });

    const err = await audit.validate();
    expect(err).toBeUndefined();
  });

  it("should reject missing eventId, actorType, action, entityType, or entityId", async () => {
    const audit = new AuditLog({
      metadata: { test: true }
    });

    await expect(audit.validate()).rejects.toThrow();
  });

  it("should reject invalid actorType", async () => {
    const audit = new AuditLog({
      eventId: "AUD-BAD-ACTOR",
      actorType: "UNKNOWN_ROBOT",
      action: "DATA_IMPORTED",
      entityType: "Batch",
      entityId: "123"
    });

    await expect(audit.validate()).rejects.toThrow();
  });

  it("should default timestamp to current Date", () => {
    const audit = new AuditLog({
      eventId: "AUD-TIME-001",
      actorType: "SYSTEM",
      action: "DATA_IMPORTED",
      entityType: "File",
      entityId: "file_001"
    });

    expect(audit.timestamp).toBeInstanceOf(Date);
  });
});
