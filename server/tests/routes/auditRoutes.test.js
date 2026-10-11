import { describe, it, expect, vi, beforeEach } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import * as auditService from "../../src/services/audit/auditService.js";
import { signUserToken, ROLES } from "../../src/services/auth/tokenService.js";

describe("Audit REST API Routes & Append-Only Guarantees", () => {
  const auditorToken = signUserToken({
    userId: "usr_auditor_test",
    role: ROLES.AUDITOR
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("REJECTS unauthenticated access to /api/audit (401)", async () => {
    const res = await request(app).get("/api/audit");
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });

  it("GET /api/audit lists paginated audit events with valid token", async () => {
    const mockList = {
      logs: [{ eventId: "AUD-001", action: "MATCH_CREATED" }],
      pagination: { page: 1, limit: 50, total: 1, pages: 1 }
    };

    vi.spyOn(auditService, "queryAuditLogs").mockResolvedValue(mockList);

    const res = await request(app)
      .get("/api/audit")
      .set("Authorization", `Bearer ${auditorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.logs).toHaveLength(1);
  });

  it("GET /api/audit/:eventId retrieves a single audit event with valid token", async () => {
    const mockLog = { eventId: "AUD-001", action: "MATCH_CREATED" };
    vi.spyOn(auditService, "getAuditEventById").mockResolvedValue(mockLog);

    const res = await request(app)
      .get("/api/audit/AUD-001")
      .set("Authorization", `Bearer ${auditorToken}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.eventId).toBe("AUD-001");
  });

  it("APPEND-ONLY INVARIANT: PATCH, PUT, DELETE endpoints return 404 Not Found", async () => {
    const patchRes = await request(app)
      .patch("/api/audit/AUD-001")
      .set("Authorization", `Bearer ${auditorToken}`)
      .send({ action: "MODIFIED" });
    expect(patchRes.status).toBe(404);

    const putRes = await request(app)
      .put("/api/audit/AUD-001")
      .set("Authorization", `Bearer ${auditorToken}`)
      .send({ action: "MODIFIED" });
    expect(putRes.status).toBe(404);

    const deleteRes = await request(app)
      .delete("/api/audit/AUD-001")
      .set("Authorization", `Bearer ${auditorToken}`);
    expect(deleteRes.status).toBe(404);
  });
});
