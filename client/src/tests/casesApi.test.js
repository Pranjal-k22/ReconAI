import { describe, it, expect, vi, beforeEach } from "vitest";
import * as casesApi from "../api/casesApi.js";
import { casesAxiosInstance, mapApiError, classifyCase, investigateCase } from "../api/casesApi.js";

describe("Cases API Invariants (Stage 8b - Read & Controlled Admin Actions)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("exports strictly GET fetchers and exactly two controlled POST functions (classifyCase, investigateCase)", () => {
    const exportedKeys = Object.keys(casesApi);
    const nonFunctionKeys = ["casesAxiosInstance"];
    const functions = exportedKeys.filter(
      (k) => typeof casesApi[k] === "function" && !nonFunctionKeys.includes(k)
    );

    // Controlled admin POST actions: exactly classifyCase and investigateCase
    const postActions = ["classifyCase", "investigateCase"];
    for (const postFn of postActions) {
      expect(functions).toContain(postFn);
    }

    // All other functions must be read fetchers (start with 'fetch') or mapApiError
    for (const fnName of functions) {
      if (postActions.includes(fnName) || fnName === "mapApiError") {
        continue;
      }
      expect(fnName.startsWith("fetch"), `Export '${fnName}' is not a fetcher or approved action`).toBe(true);
    }

    // Prohibited mutation terms must NEVER appear in export names
    const prohibitedTerms = [
      "dispatch",
      "release",
      "refund",
      "edit",
      "delete",
      "put",
      "patch",
      "mutate",
      "remove",
      "reopen"
    ];
    for (const key of exportedKeys) {
      const lower = key.toLowerCase();
      for (const term of prohibitedTerms) {
        expect(lower.includes(term), `Export '${key}' contains prohibited term '${term}'`).toBe(false);
      }
    }
  });

  it("classifyCase sends strict empty body ({}), no tenant header, and only path caseId", async () => {
    const postSpy = vi.spyOn(casesAxiosInstance, "post").mockResolvedValue({
      data: { success: true, data: { recordId: "EVID-001" } }
    });

    const res = await classifyCase("CASE-ALPHA-01");

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith("/payment-cases/CASE-ALPHA-01/classify", {});
    expect(res).toEqual({ success: true, data: { recordId: "EVID-001" } });

    // URL-encode path check
    await classifyCase("CASE with/special");
    expect(postSpy).toHaveBeenLastCalledWith("/payment-cases/CASE%20with%2Fspecial/classify", {});
  });

  it("investigateCase sends strict empty body ({}), no tenant header, and only path caseId", async () => {
    const postSpy = vi.spyOn(casesAxiosInstance, "post").mockResolvedValue({
      data: { success: true, data: { investigationId: "INV-001" } }
    });

    const res = await investigateCase("CASE-ALPHA-02");

    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).toHaveBeenCalledWith("/payment-cases/CASE-ALPHA-02/investigate", {});
    expect(res).toEqual({ success: true, data: { investigationId: "INV-001" } });

    // URL-encode path check
    await investigateCase("CASE special#1");
    expect(postSpy).toHaveBeenLastCalledWith("/payment-cases/CASE%20special%231/investigate", {});
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

  it("maps 429 error to rate limit message", () => {
    const error = {
      response: {
        status: 429,
        data: { message: "Investigation cost guard exceeded: Admin hourly limit reached." }
      }
    };
    const mapped = mapApiError(error);
    expect(mapped.status).toBe(429);
    expect(mapped.type).toBe("RATE_LIMITED");
    expect(mapped.message).toContain("Investigation cost guard exceeded");
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
