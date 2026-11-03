import { casesAxiosInstance, mapApiError } from "./casesApi.js";

/**
 * Customer Claim API Client (Stage 7b / Stage 8b isolation)
 *
 * Dedicated to customer claims intake. Completely isolated from casesApi
 * so that casesApi exports strictly two POST functions (classifyCase, investigateCase).
 */

export async function submitCustomerClaim(payload, idempotencyKey) {
  try {
    const headers = {};
    if (idempotencyKey) {
      headers["Idempotency-Key"] = idempotencyKey;
    }
    const response = await casesAxiosInstance.post("/claims", payload, { headers });
    return response.data;
  } catch (err) {
    throw mapApiError(err);
  }
}

export async function fetchMyClaims() {
  try {
    const response = await casesAxiosInstance.get("/claims");
    return response.data;
  } catch (err) {
    throw mapApiError(err);
  }
}

