import { describe, it, expect, beforeEach, vi } from "vitest";
import { SettlementRecord } from "../../src/models/SettlementRecord.js";
import * as auditService from "../../src/services/audit/auditService.js";
import * as razorpayClient from "../../src/services/razorpay/razorpayClient.js";
import { syncRazorpaySettlements } from "../../src/services/razorpay/settlementSyncService.js";

describe("Settlement Synchronization Service (settlementSyncService)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should validate input year and month, rejecting invalid dates early", async () => {
    vi.spyOn(razorpayClient, "isRazorpayConfigured").mockReturnValue(true);

    await expect(
      syncRazorpaySettlements({ year: 1990, month: 9 })
    ).rejects.toThrow("Invalid year");

    await expect(
      syncRazorpaySettlements({ year: 2026, month: 13 })
    ).rejects.toThrow("Invalid month");
  });

  it("should fetch settlement recon records, normalize, upsert, and audit results", async () => {
    const mockSettlementItems = [
      {
        settlement_id: "set_DEMO_01",
        entity_id: "pay_DEMO_01",
        type: "payment",
        amount: 250000,
        fee: 5000,
        tax: 900,
        credit: 244100,
        debit: 0,
        settlement_utr: "UTR999111",
        settled_at: 1785542400
      },
      {
        settlement_id: "set_DEMO_01",
        entity_id: "rfnd_DEMO_02",
        payment_id: "pay_DEMO_02",
        type: "refund",
        amount: 50000,
        fee: 0,
        tax: 0,
        credit: 0,
        debit: 50000,
        settlement_utr: "UTR999111",
        settled_at: 1785542400
      }
    ];

    const mockFetchApi = vi.fn().mockResolvedValueOnce(mockSettlementItems);

    vi.spyOn(razorpayClient, "isRazorpayConfigured").mockReturnValue(true);
    vi.spyOn(razorpayClient, "validateTestModeSafety").mockImplementation(() => {});
    vi.spyOn(auditService, "createAuditEvent").mockResolvedValue(true);
    vi.spyOn(SettlementRecord, "bulkWrite").mockResolvedValue({
      upsertedCount: 2,
      modifiedCount: 0,
      matchedCount: 2
    });

    const summary = await syncRazorpaySettlements({
      year: 2026,
      month: 9,
      day: 2,
      actorId: "test-settlement-actor",
      _customFetch: mockFetchApi
    });

    expect(summary.fetched).toBe(2);
    expect(summary.inserted).toBe(2);
    expect(summary.year).toBe(2026);
    expect(summary.month).toBe(9);
    expect(summary.day).toBe(2);

    expect(mockFetchApi).toHaveBeenCalledWith(
      expect.stringContaining("/v1/settlements/recon/combined"),
      expect.anything()
    );

    expect(auditService.createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "RAZORPAY_SYNC_STARTED" })
    );
    expect(auditService.createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "RAZORPAY_SYNC_COMPLETED" })
    );
  });
});
