import { describe, it, expect, beforeEach, vi } from "vitest";
import { GatewayPayment } from "../../src/models/GatewayPayment.js";
import * as auditService from "../../src/services/audit/auditService.js";
import * as razorpayClient from "../../src/services/razorpay/razorpayClient.js";
import { syncRazorpayPayments } from "../../src/services/razorpay/paymentSyncService.js";

describe("Payment Synchronization Service (paymentSyncService)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should perform paginated payment sync, upsert records, and log audit events", async () => {
    const page1Items = Array.from({ length: 100 }, (_, i) => ({
      id: `pay_P1_${i}`,
      amount: 100000,
      currency: "INR",
      status: "captured",
      method: "card",
      created_at: 1785542400
    }));

    const page2Items = Array.from({ length: 20 }, (_, i) => ({
      id: `pay_P2_${i}`,
      amount: 50000,
      currency: "INR",
      status: "captured",
      method: "upi",
      created_at: 1785542400
    }));

    const mockFetchApi = vi
      .fn()
      .mockResolvedValueOnce({ items: page1Items })
      .mockResolvedValueOnce({ items: page2Items });

    vi.spyOn(razorpayClient, "isRazorpayConfigured").mockReturnValue(true);
    vi.spyOn(razorpayClient, "validateTestModeSafety").mockImplementation(() => {});
    vi.spyOn(auditService, "createAuditEvent").mockResolvedValue(true);
    vi.spyOn(GatewayPayment, "bulkWrite").mockResolvedValue({
      upsertedCount: 120,
      modifiedCount: 0,
      matchedCount: 120
    });

    const summary = await syncRazorpayPayments({
      from: 1785542400,
      to: 1788134400,
      actorId: "test-sync-actor",
      _customFetch: mockFetchApi
    });

    expect(summary.fetched).toBe(120);
    expect(summary.inserted).toBe(120);
    expect(summary.invalid).toBe(0);
    expect(summary.mode).toBe("test");

    // Verify pagination calls
    expect(mockFetchApi).toHaveBeenCalledTimes(2);
    expect(mockFetchApi).toHaveBeenNthCalledWith(1, expect.stringContaining("/v1/payments"), expect.anything());
    expect(mockFetchApi).toHaveBeenNthCalledWith(2, expect.stringContaining("/v1/payments"), expect.anything());

    // Verify Audit Events: STARTED and COMPLETED
    expect(auditService.createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "RAZORPAY_SYNC_STARTED" })
    );
    expect(auditService.createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "RAZORPAY_SYNC_COMPLETED" })
    );
  });

  it("should handle empty payment list gracefully (0 payments fetched)", async () => {
    const mockFetchApi = vi.fn().mockResolvedValueOnce({ items: [] });

    vi.spyOn(razorpayClient, "isRazorpayConfigured").mockReturnValue(true);
    vi.spyOn(razorpayClient, "validateTestModeSafety").mockImplementation(() => {});
    vi.spyOn(auditService, "createAuditEvent").mockResolvedValue(true);
    vi.spyOn(GatewayPayment, "bulkWrite").mockResolvedValue({ upsertedCount: 0, modifiedCount: 0 });

    const summary = await syncRazorpayPayments({
      _customFetch: mockFetchApi
    });

    expect(summary.fetched).toBe(0);
    expect(summary.inserted).toBe(0);
    expect(auditService.createAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "RAZORPAY_SYNC_COMPLETED" })
    );
  });
});
