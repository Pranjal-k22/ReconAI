import axios from "axios";

const baseURL = import.meta.env?.VITE_API_BASE_URL || "/api";

export const casesAxiosInstance = axios.create({
  baseURL,
  timeout: 30000,
  headers: {
    Accept: "application/json"
  }
});

// Request interceptor: attach bearer token only, strictly NO tenant headers or query overrides
casesAxiosInstance.interceptors.request.use((config) => {
  try {
    const token = typeof localStorage !== "undefined" ? localStorage.getItem("reconai_token") : null;
    if (token) {
      config.headers = config.headers || {};
      config.headers.Authorization = `Bearer ${token}`;
    }
    // Hard architectural invariant: client workspace NEVER asserts or transmits x-tenant-id
    if (config.headers) {
      delete config.headers["x-tenant-id"];
      delete config.headers["X-Tenant-Id"];
      delete config.headers["X-TENANT-ID"];
    }
    // Strip any tenantId query params if inadvertently passed
    if (config.params && config.params.tenantId !== undefined) {
      delete config.params.tenantId;
    }
  } catch {
    // Ignore storage errors in restricted contexts
  }
  return config;
});

/**
 * Standardized error representation for workspace components
 */
export function mapApiError(err) {
  const status = err.response?.status;
  if (status === 401) {
    return {
      type: "UNAUTHORIZED",
      message: "Session expired or authentication invalid. Please sign in again.",
      status: 401,
      retryable: false
    };
  }
  if (status === 403) {
    return {
      type: "FORBIDDEN",
      message: "not permitted",
      status: 403,
      retryable: false
    };
  }
  if (status === 404) {
    return {
      type: "NOT_FOUND",
      message: "not found",
      status: 404,
      retryable: false
    };
  }
  if (status === 409) {
    return {
      type: "CONFLICT",
      message: err.response?.data?.message || err.response?.data?.error?.message || "Conflict: idempotency key has already been used.",
      status: 409,
      retryable: false
    };
  }
  if (status === 429) {
    return {
      type: "RATE_LIMITED",
      message: err.response?.data?.message || err.response?.data?.error?.message || "Rate limit reached. Please wait before submitting another claim.",
      status: 429,
      retryable: false
    };
  }
  if (status === 400) {
    return {
      type: "BAD_REQUEST",
      message: err.response?.data?.message || err.response?.data?.error?.message || "Invalid claim request payload.",
      status: 400,
      retryable: false
    };
  }
  if (status === 503 || !err.response || err.code === "ECONNABORTED" || err.message?.includes("Network Error")) {
    return {
      type: "RETRYABLE",
      message: "Service temporarily unavailable or network unreachable. Please retry.",
      status: status || 503,
      retryable: true
    };
  }
  return {
    type: "ERROR",
    message: err.response?.data?.error?.message || err.message || "An unexpected error occurred.",
    status: status || 500,
    retryable: false
  };
}

/**
 * Bounded retry GET execution (max 2 retries on 503 or network failure)
 */
async function getWithBoundedRetry(url, config = {}, maxRetries = 2) {
  let attempt = 0;
  while (true) {
    try {
      const response = await casesAxiosInstance.get(url, config);
      return response.data;
    } catch (err) {
      attempt++;
      const isRetryable =
        !err.response ||
        err.response.status === 503 ||
        err.response.status === 502 ||
        err.code === "ECONNABORTED" ||
        err.message?.includes("Network Error");

      if (attempt <= maxRetries && isRetryable) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 150));
        continue;
      }
      throw mapApiError(err);
    }
  }
}

/**
 * Workspace API Client (Stage 8b - Controlled Actions & Read Contract)
 *
 * Exports strictly GET read functions and exactly two controlled ADMIN POST
 * functions: classifyCase and investigateCase. Both transmit strict empty bodies ({}).
 * NO dispatch, release, edit, or refund controls exist anywhere.
 */

export async function fetchPaymentCases({ page = 1, limit = 50, resolutionCaseStatus, isSafeHold } = {}) {
  const params = { page, limit };
  if (resolutionCaseStatus) params.resolutionCaseStatus = resolutionCaseStatus;
  if (isSafeHold !== undefined && isSafeHold !== null) params.isSafeHold = isSafeHold;
  return getWithBoundedRetry("/payment-cases", { params });
}

export async function fetchPaymentCaseById(caseId) {
  if (!caseId) throw new Error("caseId is required");
  return getWithBoundedRetry(`/payment-cases/${encodeURIComponent(caseId)}`);
}

export async function fetchCaseClassification(caseId) {
  if (!caseId) throw new Error("caseId is required");
  return getWithBoundedRetry(`/payment-cases/${encodeURIComponent(caseId)}/classification`);
}

export async function fetchCaseLifecycleEvents(caseId) {
  if (!caseId) throw new Error("caseId is required");
  return getWithBoundedRetry(`/payment-events/case/${encodeURIComponent(caseId)}`);
}

export async function fetchCaseInvestigations(caseId) {
  if (!caseId) throw new Error("caseId is required");
  return getWithBoundedRetry(`/payment-cases/${encodeURIComponent(caseId)}/investigations`);
}

export async function fetchCaseEvidence(caseId) {
  if (!caseId) throw new Error("caseId is required");
  return getWithBoundedRetry(`/payment-cases/${encodeURIComponent(caseId)}/evidence`);
}

export async function fetchCasePolicyDecisions(caseId) {
  if (!caseId) throw new Error("caseId is required");
  return getWithBoundedRetry(`/payment-cases/${encodeURIComponent(caseId)}/policy/decisions`);
}

export async function fetchCaseProviderOperations(caseId) {
  if (!caseId) throw new Error("caseId is required");
  return getWithBoundedRetry(`/payment-cases/${encodeURIComponent(caseId)}/provider/operations`);
}

export async function fetchCaseClaims(caseId) {
  if (!caseId) throw new Error("caseId is required");
  return getWithBoundedRetry(`/payment-cases/${encodeURIComponent(caseId)}/claims`);
}

/**
 * Controlled Admin Actions (Stage 8b)
 *
 * Exactly two POST functions are exported: classifyCase and investigateCase.
 * Strict invariants:
 * - Empty body ({}) transmitted
 * - No tenant header
 * - No identifier except path caseId
 * - Handled server-side with fail-closed audit and rate limit guards
 */

export async function classifyCase(caseId) {
  if (!caseId) throw new Error("caseId is required");
  try {
    const response = await casesAxiosInstance.post(
      `/payment-cases/${encodeURIComponent(caseId)}/classify`,
      {}
    );
    return response.data;
  } catch (err) {
    throw mapApiError(err);
  }
}

export async function investigateCase(caseId) {
  if (!caseId) throw new Error("caseId is required");
  try {
    const response = await casesAxiosInstance.post(
      `/payment-cases/${encodeURIComponent(caseId)}/investigate`,
      {}
    );
    return response.data;
  } catch (err) {
    throw mapApiError(err);
  }
}
