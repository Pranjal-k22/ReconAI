import { getEnv } from "../../config/env.js";
import { logger } from "../../config/logger.js";

export const RAZORPAY_BASE_URL = "https://api.razorpay.com";

export const RAZORPAY_ERROR_CODES = {
  NOT_CONFIGURED: "RAZORPAY_NOT_CONFIGURED",
  LIVE_KEY_BLOCKED: "RAZORPAY_LIVE_KEY_BLOCKED",
  AUTH_ERROR: "RAZORPAY_AUTH_ERROR",
  RATE_LIMIT: "RAZORPAY_RATE_LIMIT",
  TIMEOUT: "RAZORPAY_TIMEOUT",
  NETWORK_ERROR: "RAZORPAY_NETWORK_ERROR",
  INVALID_RESPONSE: "RAZORPAY_INVALID_RESPONSE",
  PROVIDER_ERROR: "RAZORPAY_PROVIDER_ERROR"
};

export class RazorpayProviderError extends Error {
  constructor(code, message, originalError = null) {
    super(message);
    this.name = "RazorpayProviderError";
    this.code = code;
    this.originalError = originalError;
  }
}

/**
 * Checks if Razorpay credentials are fully configured.
 */
export function isRazorpayConfigured() {
  const env = getEnv();
  const keyId = env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID;
  const keySecret = env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET;

  return (
    typeof keyId === "string" &&
    keyId.trim().length > 0 &&
    typeof keySecret === "string" &&
    keySecret.trim().length > 0
  );
}

/**
 * Validates that live credentials are not used when test mode is enforced.
 */
export function validateTestModeSafety() {
  const env = getEnv();
  const keyId = (env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID || "").trim();
  const mode = (env.RAZORPAY_MODE || process.env.RAZORPAY_MODE || "test").trim().toLowerCase();

  if (mode === "test" && keyId.startsWith("rzp_live_")) {
    throw new RazorpayProviderError(
      RAZORPAY_ERROR_CODES.LIVE_KEY_BLOCKED,
      "Live Razorpay Key ID detected while system is configured in TEST mode. Synchronization blocked for financial safety."
    );
  }
}

/**
 * Constructs HTTP Basic Auth header without logging secrets.
 */
export function getBasicAuthHeader() {
  const env = getEnv();
  const keyId = (env.RAZORPAY_KEY_ID || process.env.RAZORPAY_KEY_ID || "").trim();
  const keySecret = (env.RAZORPAY_KEY_SECRET || process.env.RAZORPAY_KEY_SECRET || "").trim();

  const token = Buffer.from(`${keyId}:${keySecret}`).toString("base64");
  return `Basic ${token}`;
}

/**
 * Centralized GET request execution wrapper for Razorpay REST API with timeout and error normalization.
 */
export async function fetchRazorpayApi(endpointPath, queryParams = {}, customFetch = null) {
  if (!isRazorpayConfigured() && !customFetch) {
    throw new RazorpayProviderError(
      RAZORPAY_ERROR_CODES.NOT_CONFIGURED,
      "Razorpay API credentials (RAZORPAY_KEY_ID & RAZORPAY_KEY_SECRET) are not configured."
    );
  }

  validateTestModeSafety();

  const env = getEnv();
  const timeoutMs = env.RAZORPAY_REQUEST_TIMEOUT_MS || 10000;
  const fetchImpl = customFetch || globalThis.fetch;

  if (typeof fetchImpl !== "function") {
    throw new RazorpayProviderError(
      RAZORPAY_ERROR_CODES.PROVIDER_ERROR,
      "Global fetch is not available in Node environment."
    );
  }

  // Construct URL with search parameters
  const url = new URL(endpointPath, RAZORPAY_BASE_URL);
  Object.entries(queryParams).forEach(([key, val]) => {
    if (val !== undefined && val !== null && val !== "") {
      url.searchParams.append(key, String(val));
    }
  });

  const authHeader = getBasicAuthHeader();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url.toString(), {
      method: "GET",
      headers: {
        Authorization: authHeader,
        Accept: "application/json"
      },
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (response && typeof response.status === "number") {
      if (response.status === 401 || response.status === 403) {
        throw new RazorpayProviderError(
          RAZORPAY_ERROR_CODES.AUTH_ERROR,
          "Razorpay API authentication failed. Please verify Key ID and Key Secret."
        );
      }
      if (response.status === 429) {
        throw new RazorpayProviderError(
          RAZORPAY_ERROR_CODES.RATE_LIMIT,
          "Razorpay API rate limit exceeded."
        );
      }
      if (response.ok === false || response.status >= 400) {
        const errText = typeof response.text === "function" ? await response.text().catch(() => "") : "";
        throw new RazorpayProviderError(
          RAZORPAY_ERROR_CODES.PROVIDER_ERROR,
          `Razorpay API returned status ${response.status}: ${errText}`
        );
      }
      if (typeof response.json === "function") {
        return await response.json().catch((err) => {
          throw new RazorpayProviderError(
            RAZORPAY_ERROR_CODES.INVALID_RESPONSE,
            "Failed to parse JSON response from Razorpay API.",
            err
          );
        });
      }
    }

    return response;
  } catch (err) {
    clearTimeout(timeoutId);

    if (err instanceof RazorpayProviderError) {
      throw err;
    }
    if (err.name === "AbortError") {
      throw new RazorpayProviderError(
        RAZORPAY_ERROR_CODES.TIMEOUT,
        `Razorpay API request timed out after ${timeoutMs}ms.`
      );
    }
    throw new RazorpayProviderError(
      RAZORPAY_ERROR_CODES.NETWORK_ERROR,
      `Network error connecting to Razorpay: ${err.message}`,
      err
    );
  }
}
