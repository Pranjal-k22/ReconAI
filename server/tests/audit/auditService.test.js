import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createAuditEvent,
  createAuditEventsBulk,
  sanitizeAuditData,
  queryAuditLogs,
  getAuditEventById
} from "../../src/services/audit/auditService.js";
import { AuditLog } from "../../src/models/AuditLog.js";

describe("auditService & Secret Sanitization", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("RECURSIVE SANITIZATION TEST: redacts secret and sensitive keys recursively", () => {
    const rawData = {
      user: "admin",
      GEMINI_API_KEY: "AIzaSySecretKey",
      authorization: "Bearer secret-token-xyz",
      nested: {
        RAZORPAY_KEY_SECRET: "rzp_secret_12345",
        MONGODB_URI: "mongodb+srv://user:pass@cluster.mongodb.net",
        normalField: 12345
      }
    };

    const sanitized = sanitizeAuditData(rawData);

    expect(sanitized.user).toBe("admin");
    expect(sanitized.GEMINI_API_KEY).toBe("[REDACTED]");
    expect(sanitized.authorization).toBe("[REDACTED]");
    expect(sanitized.nested.RAZORPAY_KEY_SECRET).toBe("[REDACTED]");
    expect(sanitized.nested.MONGODB_URI).toBe("[REDACTED]");
    expect(sanitized.nested.normalField).toBe(12345);
  });

  it("creates a single audit event with sanitized data", async () => {
    vi.spyOn(AuditLog, "create").mockImplementation(async (doc) => ({
      ...doc,
      _id: "mongo-id-123"
    }));

    const event = await createAuditEvent({
      actorType: "RULE_ENGINE",
      actorId: "deterministic-engine",
      action: "MATCH_CREATED",
      entityType: "ReconciliationResult",
      entityId: "RES-001",
      runId: "RUN-001",
      metadata: { secretToken: "Bearer 12345", orderId: "ORD-001" }
    });

    expect(event.eventId).toMatch(/^AUD-/);
    expect(event.action).toBe("MATCH_CREATED");
    expect(event.metadata.secretToken).toBe("[REDACTED]");
    expect(event.metadata.orderId).toBe("ORD-001");
  });

  it("bulk creates audit events cleanly", async () => {
    vi.spyOn(AuditLog, "insertMany").mockImplementation(async (docs) => docs);

    const events = [
      { action: "MATCH_CREATED", entityType: "Result", entityId: "RES-001" },
      { action: "EXCEPTION_CREATED", entityType: "ExceptionCase", entityId: "EXC-001" }
    ];

    const res = await createAuditEventsBulk(events);
    expect(res).toHaveLength(2);
    expect(res[0].eventId).toMatch(/^AUD-/);
    expect(res[1].eventId).toMatch(/^AUD-/);
  });
});
