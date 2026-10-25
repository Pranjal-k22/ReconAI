import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { performProviderPreflight } from "../../src/services/policy/providerPreflightService.js";

describe("Provider Preflight Read Service (Gate B2)", () => {
  const originalEnv = { ...process.env };
  let fetchSpy;

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...originalEnv };
    process.env.RAZORPAY_KEY_ID = "rzp_test_mockKeyId12345";
    process.env.RAZORPAY_KEY_SECRET = "mockKeySecret67890";
    process.env.RAZORPAY_MODE = "test";
    process.env.POLICY_TOKEN_SECRET = "test-policy-token-secret-at-least-32-chars-long";

    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    expect(fetchSpy).not.toHaveBeenCalled();
    process.env = { ...originalEnv };
  });

  function makeMockFetch({
    paymentStatus = "captured",
    paymentCurrency = "INR",
    paymentAmount = 50000,
    paymentAmountCaptured = 50000,
    paymentAmountRefunded = 0,
    paymentOrderId = "order_rzp_001",
    refunds = []
  } = {}) {
    return vi.fn().mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/refunds")) {
        return {
          status: 200,
          ok: true,
          json: async () => ({
            entity: "collection",
            count: refunds.length,
            items: refunds
          })
        };
      }
      return {
        status: 200,
        ok: true,
        json: async () => ({
          id: "pay_test_001",
          entity: "payment",
          amount: paymentAmount,
          amount_captured: paymentAmountCaptured,
          amount_refunded: paymentAmountRefunded,
          currency: paymentCurrency,
          status: paymentStatus,
          order_id: paymentOrderId
        })
      };
    });
  }

  it("returns OK with calculated refundableAmountPaise when all preflight checks pass", async () => {
    const customFetch = makeMockFetch({
      paymentAmountCaptured: 50000,
      paymentAmountRefunded: 10000,
      refunds: [{ id: "rfnd_1", amount: 10000, status: "processed" }]
    });

    const result = await performProviderPreflight({
      tenantId: "tenant_1",
      caseId: "case_1",
      gatewayPaymentId: "pay_test_001",
      localAmountPaise: 50000,
      localCurrency: "INR",
      localOrderId: "order_rzp_001",
      localRefundedAmountPaise: 10000,
      reservedRefundPaise: 5000,
      customFetch
    });

    expect(result.ok).toBe(true);
    expect(result.status).toBe("OK");
    // 50000 - 10000 - 5000 = 35000
    expect(result.refundableAmountPaise).toBe(35000);
    expect(result.providerCapturedPaise).toBe(50000);
    expect(result.providerRefundedPaise).toBe(10000);
  });

  it("returns SAFE_HOLD when payment status is not 'captured' (e.g. authorized, failed)", async () => {
    const customFetch = makeMockFetch({ paymentStatus: "authorized" });

    const result = await performProviderPreflight({
      tenantId: "tenant_1",
      caseId: "case_1",
      gatewayPaymentId: "pay_test_001",
      localAmountPaise: 50000,
      localCurrency: "INR",
      customFetch
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("SAFE_HOLD");
    expect(result.reason).toContain("expected 'captured'");
  });

  it("returns SAFE_HOLD when currency does not match local recorded currency", async () => {
    const customFetch = makeMockFetch({ paymentCurrency: "USD" });

    const result = await performProviderPreflight({
      tenantId: "tenant_1",
      caseId: "case_1",
      gatewayPaymentId: "pay_test_001",
      localAmountPaise: 50000,
      localCurrency: "INR",
      customFetch
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("SAFE_HOLD");
    expect(result.reason).toContain("Provider currency 'USD' does not match");
  });

  it("returns SAFE_HOLD when captured amount does not match local amount", async () => {
    const customFetch = makeMockFetch({ paymentAmountCaptured: 40000 });

    const result = await performProviderPreflight({
      tenantId: "tenant_1",
      caseId: "case_1",
      gatewayPaymentId: "pay_test_001",
      localAmountPaise: 50000,
      localCurrency: "INR",
      customFetch
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("SAFE_HOLD");
    expect(result.reason).toContain("Provider captured amount (40000) does not match local recorded amount (50000)");
  });

  it("returns SAFE_HOLD when order ID does not match local order ID", async () => {
    const customFetch = makeMockFetch({ paymentOrderId: "order_rzp_MISMATCH" });

    const result = await performProviderPreflight({
      tenantId: "tenant_1",
      caseId: "case_1",
      gatewayPaymentId: "pay_test_001",
      localAmountPaise: 50000,
      localCurrency: "INR",
      localOrderId: "order_rzp_EXPECTED",
      customFetch
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("SAFE_HOLD");
    expect(result.reason).toContain("Provider order_id 'order_rzp_MISMATCH' does not match");
  });

  it("returns SAFE_HOLD when provider refunded amount is less than local recorded refunded amount", async () => {
    const customFetch = makeMockFetch({ paymentAmountRefunded: 0, refunds: [] });

    const result = await performProviderPreflight({
      tenantId: "tenant_1",
      caseId: "case_1",
      gatewayPaymentId: "pay_test_001",
      localAmountPaise: 50000,
      localCurrency: "INR",
      localRefundedAmountPaise: 25000, // local record says 25000 refunded, but provider says 0
      customFetch
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("SAFE_HOLD");
    expect(result.reason).toContain("is less than local recorded refunded amount");
  });

  it("returns SAFE_HOLD when no refundable balance remains (fully refunded or reserved)", async () => {
    const customFetch = makeMockFetch({
      paymentAmountCaptured: 50000,
      paymentAmountRefunded: 40000,
      refunds: [{ id: "rfnd_1", amount: 40000, status: "processed" }]
    });

    const result = await performProviderPreflight({
      tenantId: "tenant_1",
      caseId: "case_1",
      gatewayPaymentId: "pay_test_001",
      localAmountPaise: 50000,
      localCurrency: "INR",
      localRefundedAmountPaise: 40000,
      reservedRefundPaise: 10000, // 50000 - 40000 - 10000 = 0 balance
      customFetch
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("SAFE_HOLD");
    expect(result.reason).toContain("No refundable balance remaining");
  });

  it("returns INSUFFICIENT_EVIDENCE when provider GET read throws network error or timeout", async () => {
    const customFetch = vi.fn().mockRejectedValue(new Error("ETIMEDOUT connecting to api.razorpay.com"));

    const result = await performProviderPreflight({
      tenantId: "tenant_1",
      caseId: "case_1",
      gatewayPaymentId: "pay_test_001",
      localAmountPaise: 50000,
      localCurrency: "INR",
      customFetch
    });

    expect(result.ok).toBe(false);
    expect(result.status).toBe("INSUFFICIENT_EVIDENCE");
    expect(result.reason).toContain("ETIMEDOUT connecting to api.razorpay.com");
  });
});
