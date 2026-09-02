import { describe, it, expect } from "vitest";
import { MerchantOrder } from "../../src/models/MerchantOrder.js";

describe("MerchantOrder Model Schema & Validation", () => {
  it("should validate a valid merchant order", async () => {
    const validOrder = new MerchantOrder({
      merchantOrderId: "ORD-100001",
      customerReference: "CUST-999",
      amountPaise: 149900,
      currency: "INR",
      status: "PAID",
      source: "SYNTHETIC"
    });

    const err = await validOrder.validate();
    expect(err).toBeUndefined();
  });

  it("should reject order missing merchantOrderId", async () => {
    const order = new MerchantOrder({
      amountPaise: 149900
    });

    await expect(order.validate()).rejects.toThrow();
  });

  it("should reject negative amountPaise", async () => {
    const order = new MerchantOrder({
      merchantOrderId: "ORD-100002",
      amountPaise: -500
    });

    await expect(order.validate()).rejects.toThrow();
  });

  it("should reject non-integer amountPaise", async () => {
    const order = new MerchantOrder({
      merchantOrderId: "ORD-100003",
      amountPaise: 1499.5
    });

    await expect(order.validate()).rejects.toThrow();
  });

  it("should reject invalid status", async () => {
    const order = new MerchantOrder({
      merchantOrderId: "ORD-100004",
      amountPaise: 149900,
      status: "INVALID_STATUS_NAME"
    });

    await expect(order.validate()).rejects.toThrow();
  });

  it("should normalize currency to uppercase", () => {
    const order = new MerchantOrder({
      merchantOrderId: "ORD-100005",
      amountPaise: 149900,
      currency: "inr"
    });

    expect(order.currency).toBe("INR");
  });
});
