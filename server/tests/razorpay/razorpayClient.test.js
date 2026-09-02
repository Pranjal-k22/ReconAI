import { describe, it, expect, afterEach } from "vitest";
import {
  isRazorpayConfigured,
  validateTestModeSafety,
  getBasicAuthHeader,
  fetchRazorpayApi,
  RAZORPAY_ERROR_CODES,
  RazorpayProviderError
} from "../../src/services/razorpay/razorpayClient.js";

describe("Razorpay Provider Client & Safety Guard", () => {
  const origKeyId = process.env.RAZORPAY_KEY_ID;
  const origKeySecret = process.env.RAZORPAY_KEY_SECRET;
  const origMode = process.env.RAZORPAY_MODE;

  afterEach(() => {
    if (origKeyId !== undefined) process.env.RAZORPAY_KEY_ID = origKeyId;
    else delete process.env.RAZORPAY_KEY_ID;

    if (origKeySecret !== undefined) process.env.RAZORPAY_KEY_SECRET = origKeySecret;
    else delete process.env.RAZORPAY_KEY_SECRET;

    if (origMode !== undefined) process.env.RAZORPAY_MODE = origMode;
    else delete process.env.RAZORPAY_MODE;
  });

  it("should report configured status based on RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET", () => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    expect(isRazorpayConfigured()).toBe(false);

    process.env.RAZORPAY_KEY_ID = "rzp_test_123456";
    process.env.RAZORPAY_KEY_SECRET = "";
    expect(isRazorpayConfigured()).toBe(false);

    process.env.RAZORPAY_KEY_SECRET = "secret123456";
    expect(isRazorpayConfigured()).toBe(true);
  });

  it("TEST MODE SAFETY GUARD: should block synchronization if rzp_live_ key is used when RAZORPAY_MODE=test", () => {
    process.env.RAZORPAY_KEY_ID = "rzp_live_abc123456";
    process.env.RAZORPAY_KEY_SECRET = "livesecret123";
    process.env.RAZORPAY_MODE = "test";

    expect(() => validateTestModeSafety()).toThrow(RazorpayProviderError);
    expect(() => validateTestModeSafety()).toThrow(/Live Razorpay Key ID detected/);
  });

  it("TEST MODE SAFETY GUARD: should allow rzp_test_ key in test mode", () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_abc123456";
    process.env.RAZORPAY_KEY_SECRET = "testsecret123";
    process.env.RAZORPAY_MODE = "test";

    expect(() => validateTestModeSafety()).not.toThrow();
  });

  it("should generate valid Basic Auth header without exposing plain credentials in errors", () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_KEY123";
    process.env.RAZORPAY_KEY_SECRET = "SECRET456";

    const header = getBasicAuthHeader();
    expect(header).toMatch(/^Basic [A-Za-z0-9+/=]+$/);

    const decoded = Buffer.from(header.replace("Basic ", ""), "base64").toString("utf-8");
    expect(decoded).toBe("rzp_test_KEY123:SECRET456");
  });

  it("should throw NOT_CONFIGURED error when fetch is called without credentials", async () => {
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;

    await expect(fetchRazorpayApi("/v1/payments")).rejects.toThrow(RazorpayProviderError);
  });

  it("should execute GET request with mock fetch and handle 401 Auth error", async () => {
    process.env.RAZORPAY_KEY_ID = "rzp_test_123";
    process.env.RAZORPAY_KEY_SECRET = "secret";

    const mockFetch = async () => ({
      ok: false,
      status: 401,
      text: async () => "Unauthorized"
    });

    await expect(fetchRazorpayApi("/v1/payments", {}, mockFetch)).rejects.toThrow(/authentication failed/);
  });
});
