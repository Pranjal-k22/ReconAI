import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import app from "../../src/app.js";
import * as paymentSyncService from "../../src/services/razorpay/paymentSyncService.js";
import * as settlementSyncService from "../../src/services/razorpay/settlementSyncService.js";
import * as razorpayStatusService from "../../src/services/razorpay/razorpayStatusService.js";

describe("Razorpay REST APIs & Integration Status Endpoint", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("POST /api/razorpay/sync/payments should trigger payment sync and return summary", async () => {
    const mockSummary = {
      batchId: "RZP-PAY-TEST-001",
      mode: "test",
      fetched: 10,
      inserted: 10,
      updated: 0,
      skipped: 0,
      invalid: 0,
      durationMs: 150
    };

    vi.spyOn(paymentSyncService, "syncRazorpayPayments").mockResolvedValue(mockSummary);

    const res = await request(app)
      .post("/api/razorpay/sync/payments")
      .send({ from: 1785542400, to: 1788134400 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.batchId).toBe("RZP-PAY-TEST-001");
    expect(res.body.data.fetched).toBe(10);
  });

  it("POST /api/razorpay/sync/settlements should trigger settlement sync and return summary", async () => {
    const mockSummary = {
      batchId: "RZP-SET-TEST-001",
      mode: "test",
      year: 2026,
      month: 9,
      fetched: 5,
      inserted: 5,
      updated: 0,
      invalid: 0,
      durationMs: 200
    };

    vi.spyOn(settlementSyncService, "syncRazorpaySettlements").mockResolvedValue(mockSummary);

    const res = await request(app)
      .post("/api/razorpay/sync/settlements")
      .send({ year: 2026, month: 9 });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.batchId).toBe("RZP-SET-TEST-001");
    expect(res.body.data.year).toBe(2026);
  });

  it("GET /api/integrations/status should return Gemini and Razorpay capability status", async () => {
    const mockStatus = {
      gemini: { configured: false },
      razorpay: { configured: true, mode: "test" }
    };

    vi.spyOn(razorpayStatusService, "getIntegrationStatus").mockReturnValue(mockStatus);

    const res = await request(app).get("/api/integrations/status");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.razorpay.configured).toBe(true);
    expect(res.body.data.razorpay.mode).toBe("test");
    expect(res.body.data.gemini.configured).toBe(false);
  });
});
