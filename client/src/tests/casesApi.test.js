import { describe, it, expect, vi, beforeEach } from "vitest";
import * as casesApi from "../api/casesApi.js";
import { casesAxiosInstance, mapApiError } from "../api/casesApi.js";

describe("Cases API Read-Only by Construction Invariants", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("exports strictly GET-oriented functions and zero mutation functions", () => {
    const exportedKeys = Object.keys(casesApi);
    const mutationTerms = ["post", "put", "patch", "delete", "create", "update", "remove", "mutate", "dispatch", "release"];

    for (const key of exportedKeys) {
      const lower = key.toLowerCase();
      for (const term of mutationTerms) {
        expect(lower.startsWith(term), `Export '${key}' appears to be a mutation function`).toBe(false);
      }
    }

    // Verify all exported data fetchers start with 'fetch'
    const fetchers = exportedKeys.filter(
      (k) => typeof casesApi[k] === "function" && k !== "mapApiError" && k !== "casesAxiosInstance"
    );
    expect(fetchers.length).toBeGreaterThanOrEqual(8);
    for (const fnName of fetchers) {
      expect(fnName.startsWith("fetch")).toBe(true);
    }
  });

  it("interceptor strictly strips x-tenant-id header and prevents tenant spoofing", async () => {
    const testConfig = {
      headers: {
        "x-tenant-id": "malicious_tenant_spoof",
        "X-Tenant-Id": "spoof_variant",
        "X-TENANT-ID": "upper_spoof"
      },
      params: {
        tenantId: "inadvertent_tenant_param"
      }
    };

    // Run request interceptor handlers
    let transformedConfig = testConfig;
    for (const handler of casesAxiosInstance.interceptors.request.handlers) {
      if (typeof handler.fulfilled === "function") {
        transformedConfig = handler.fulfilled(transformedConfig);
      }
    }

    expect(transformedConfig.headers["x-tenant-id"]).toBeUndefined();
    expect(transformedConfig.headers["X-Tenant-Id"]).toBeUndefined();
    expect(transformedConfig.headers["X-TENANT-ID"]).toBeUndefined();
    expect(transformedConfig.params.tenantId).toBeUndefined();
  });

  it("maps 401 error to session expiration message", () => {
    const error = { response: { status: 401 } };
    const mapped = mapApiError(error);
    expect(mapped.status).toBe(401);
    expect(mapped.type).toBe("UNAUTHORIZED");
    expect(mapped.retryable).toBe(false);
  });

  it("maps 403 error to 'not permitted'", () => {
    const error = { response: { status: 403 } };
    const mapped = mapApiError(error);
    expect(mapped.status).toBe(403);
    expect(mapped.message).toBe("not permitted");
    expect(mapped.type).toBe("FORBIDDEN");
  });

  it("maps 404 error to 'not found'", () => {
    const error = { response: { status: 404 } };
    const mapped = mapApiError(error);
    expect(mapped.status).toBe(404);
    expect(mapped.message).toBe("not found");
    expect(mapped.type).toBe("NOT_FOUND");
  });

  it("maps 503 and network errors to retryable error", () => {
    const error503 = { response: { status: 503 } };
    const mapped503 = mapApiError(error503);
    expect(mapped503.status).toBe(503);
    expect(mapped503.retryable).toBe(true);

    const netErr = { message: "Network Error" };
    const mappedNet = mapApiError(netErr);
    expect(mappedNet.retryable).toBe(true);
  });

  it("performs bounded retries (up to 2) on 503 before failing", async () => {
    let callCount = 0;
    vi.spyOn(casesAxiosInstance, "get").mockImplementation(() => {
      callCount++;
      const err = new Error("Service Unavailable");
      err.response = { status: 503 };
      return Promise.reject(err);
    });

    await expect(casesApi.fetchPaymentCases()).rejects.toMatchObject({
      status: 503,
      retryable: true
    });

    // 1 initial attempt + 2 retries = 3 calls
    expect(callCount).toBe(3);
  });
});
