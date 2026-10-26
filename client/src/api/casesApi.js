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
 * ONLY GET functions are exported from this module.
 * No POST, PUT, PATCH, or DELETE operations exist or are allowed.
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
