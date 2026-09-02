import { describe, it, expect } from "vitest";
import { GatewayPayment } from "../../src/models/GatewayPayment.js";

describe("GatewayPayment Model Schema & Validation", () => {
  it("should validate a valid captured payment", async () => {
    const payment = new GatewayPayment({
      gatewayPaymentId: "pay_ABC123",
      merchantOrderId: "ORD-100001",
      amountPaise: 149900,
      feePaise: 2998,
      taxPaise: 540,
      status: "CAPTURED",
      method: "UPI",
      source: "RAZORPAY"
    });

    const err = await payment.validate();
    expect(err).toBeUndefined();
  });

  it("should reject missing gatewayPaymentId", async () => {
    const payment = new GatewayPayment({
      amountPaise: 149900
    });

    await expect(payment.validate()).rejects.toThrow();
  });

  it("should allow payment missing merchantOrderId for unlinked records", async () => {
    const payment = new GatewayPayment({
      gatewayPaymentId: "pay_UNLINKED_001",
      amountPaise: 50000
    });

    const err = await payment.validate();
    expect(err).toBeUndefined();
    expect(payment.merchantOrderId).toBeNull();
  });

  it("should reject negative feePaise or taxPaise", async () => {
    const payment = new GatewayPayment({
      gatewayPaymentId: "pay_NEG_FEE",
      amountPaise: 1000,
      feePaise: -10
    });

    await expect(payment.validate()).rejects.toThrow();
  });

  it("should reject invalid payment method", async () => {
    const payment = new GatewayPayment({
      gatewayPaymentId: "pay_INVALID_METHOD",
      amountPaise: 1000,
      method: "CRYPTO_TOKEN"
    });

    await expect(payment.validate()).rejects.toThrow();
  });
});
