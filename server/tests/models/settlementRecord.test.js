import { describe, it, expect } from "vitest";
import { SettlementRecord } from "../../src/models/SettlementRecord.js";

describe("SettlementRecord Model Schema & Validation", () => {
  it("should validate a valid payment settlement record", async () => {
    const settlement = new SettlementRecord({
      settlementRecordId: "set_rec_001",
      settlementId: "set_BATCH_999",
      entityId: "pay_ABC123",
      merchantOrderId: "ORD-100001",
      grossAmountPaise: 149900,
      feePaise: 2998,
      taxPaise: 540,
      netAmountPaise: 146362,
      utr: "UTR987654321",
      type: "PAYMENT",
      source: "RAZORPAY"
    });

    const err = await settlement.validate();
    expect(err).toBeUndefined();
  });

  it("should reject missing settlementRecordId or settlementId", async () => {
    const settlement = new SettlementRecord({
      grossAmountPaise: 1000,
      netAmountPaise: 1000
    });

    await expect(settlement.validate()).rejects.toThrow();
  });

  it("should accept signed netAmountPaise for adjustment/refund records", async () => {
    const adjustment = new SettlementRecord({
      settlementRecordId: "set_adj_002",
      settlementId: "set_BATCH_999",
      grossAmountPaise: 0,
      netAmountPaise: -5000,
      type: "ADJUSTMENT"
    });

    const err = await adjustment.validate();
    expect(err).toBeUndefined();
  });

  it("should reject non-integer grossAmountPaise or netAmountPaise", async () => {
    const settlement = new SettlementRecord({
      settlementRecordId: "set_rec_BAD",
      settlementId: "set_BATCH_999",
      grossAmountPaise: 100.55,
      netAmountPaise: 100
    });

    await expect(settlement.validate()).rejects.toThrow();
  });
});
