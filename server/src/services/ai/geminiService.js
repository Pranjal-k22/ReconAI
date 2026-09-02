import { GoogleGenAI } from "@google/genai";
import { getEnv } from "../../config/env.js";
import { logger } from "../../config/logger.js";

export const DEFAULT_TIMEOUT_MS = 15000;

export const GEMINI_ERROR_CODES = {
  NOT_CONFIGURED: "GEMINI_NOT_CONFIGURED",
  TIMEOUT: "GEMINI_TIMEOUT",
  AUTH_ERROR: "GEMINI_AUTH_ERROR",
  QUOTA_ERROR: "GEMINI_QUOTA_ERROR",
  NETWORK_ERROR: "GEMINI_NETWORK_ERROR",
  INVALID_RESPONSE: "GEMINI_INVALID_RESPONSE",
  PROVIDER_ERROR: "GEMINI_PROVIDER_ERROR"
};

export class GeminiProviderError extends Error {
  constructor(code, message, originalError = null) {
    super(message);
    this.name = "GeminiProviderError";
    this.code = code;
    this.originalError = originalError;
  }
}

/**
 * Checks if Gemini API key is configured.
 */
export function isGeminiConfigured() {
  const env = getEnv();
  const apiKey = env.GEMINI_API_KEY || process.env.GEMINI_API_KEY;
  return typeof apiKey === "string" && apiKey.trim().length > 0;
}

/**
 * Gets configured Gemini model name.
 */
export function getGeminiModel() {
  const env = getEnv();
  return env.GEMINI_MODEL || process.env.GEMINI_MODEL || "gemini-2.5-flash";
}

/**
 * Normalizes underlying API / network errors into standardized internal error codes.
 */
export function normalizeGeminiError(error) {
  if (error instanceof GeminiProviderError) return error;

  const msg = error?.message || String(error);
  const lowerMsg = msg.toLowerCase();

  if (lowerMsg.includes("api key") || lowerMsg.includes("unauthorized") || lowerMsg.includes("401") || lowerMsg.includes("403")) {
    return new GeminiProviderError(GEMINI_ERROR_CODES.AUTH_ERROR, "Gemini authentication failed. Please verify GEMINI_API_KEY.", error);
  }
  if (lowerMsg.includes("quota") || lowerMsg.includes("rate limit") || lowerMsg.includes("429") || lowerMsg.includes("resource_exhausted")) {
    return new GeminiProviderError(GEMINI_ERROR_CODES.QUOTA_ERROR, "Gemini API quota or rate limit exceeded.", error);
  }
  if (lowerMsg.includes("timeout") || error?.name === "AbortError") {
    return new GeminiProviderError(GEMINI_ERROR_CODES.TIMEOUT, `Gemini API request timed out after ${DEFAULT_TIMEOUT_MS}ms.`, error);
  }
  if (lowerMsg.includes("econnreset") || lowerMsg.includes("etimedout") || lowerMsg.includes("fetch failed") || lowerMsg.includes("network")) {
    return new GeminiProviderError(GEMINI_ERROR_CODES.NETWORK_ERROR, "Network error while connecting to Gemini API.", error);
  }

  return new GeminiProviderError(GEMINI_ERROR_CODES.PROVIDER_ERROR, `Gemini provider error: ${msg}`, error);
}

/**
 * Calls Gemini API with structured response output and 15s timeout.
 */
export async function executeGeminiInvestigation({
  systemInstruction,
  promptText,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  _aiClient = null // optional injected client for testing/mocking
}) {
  if (!isGeminiConfigured() && !_aiClient) {
    throw new GeminiProviderError(
      GEMINI_ERROR_CODES.NOT_CONFIGURED,
      "GEMINI_API_KEY is not configured."
    );
  }

  const modelName = getGeminiModel();
  const startTime = Date.now();

  const jsonSchemaConfig = {
    type: "OBJECT",
    properties: {
      summary: { type: "STRING" },
      likelyCause: { type: "STRING" },
      evidence: { type: "ARRAY", items: { type: "STRING" } },
      recommendedNextStep: {
        type: "STRING",
        enum: [
          "VERIFY_SOURCE_RECORD",
          "CHECK_SETTLEMENT",
          "CHECK_PAYMENT",
          "CHECK_REFUND",
          "CHECK_FEE",
          "CONTACT_FINANCE_TEAM",
          "MANUAL_REVIEW",
          "NO_ACTION"
        ]
      },
      riskNotes: { type: "ARRAY", items: { type: "STRING" } },
      aiConfidence: { type: "NUMBER" }
    },
    required: ["summary", "likelyCause", "evidence", "recommendedNextStep", "riskNotes"]
  };

  const executeAttempt = async () => {
    let aiClient = _aiClient;
    if (!aiClient) {
      const apiKey = getEnv().GEMINI_API_KEY || process.env.GEMINI_API_KEY;
      aiClient = new GoogleGenAI({ apiKey });
    }

    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new GeminiProviderError(GEMINI_ERROR_CODES.TIMEOUT, `Gemini call timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    });

    try {
      const apiPromise = aiClient.models.generateContent({
        model: modelName,
        contents: promptText,
        config: {
          systemInstruction,
          responseMimeType: "application/json",
          responseSchema: jsonSchemaConfig
        }
      });

      const response = await Promise.race([apiPromise, timeoutPromise]);
      return response;
    } finally {
      clearTimeout(timeoutId);
    }
  };

  let rawResponse;
  let attempts = 0;
  const maxAttempts = 2; // Initial attempt + at most 1 retry for transient network issues

  while (attempts < maxAttempts) {
    attempts++;
    try {
      rawResponse = await executeAttempt();
      break;
    } catch (err) {
      const normalized = normalizeGeminiError(err);

      // Retry at most once for transient network errors only
      const isTransient =
        normalized.code === GEMINI_ERROR_CODES.NETWORK_ERROR ||
        (normalized.code === GEMINI_ERROR_CODES.PROVIDER_ERROR && attempts < maxAttempts);

      if (isTransient && attempts < maxAttempts) {
        logger.warn(
          { attempt: attempts, error: normalized.message },
          "Retrying Gemini API call due to transient network error..."
        );
        await new Promise((res) => setTimeout(res, 500));
        continue;
      }
      throw normalized;
    }
  }

  const durationMs = Date.now() - startTime;

  // Extract raw text payload
  let responseText = "";
  if (typeof rawResponse?.text === "string") {
    responseText = rawResponse.text;
  } else if (typeof rawResponse?.text === "function") {
    responseText = rawResponse.text();
  } else if (rawResponse?.candidates?.[0]?.content?.parts?.[0]?.text) {
    responseText = rawResponse.candidates[0].content.parts[0].text;
  } else if (typeof rawResponse === "string") {
    responseText = rawResponse;
  } else {
    responseText = JSON.stringify(rawResponse);
  }

  let parsedJson;
  try {
    parsedJson = JSON.parse(responseText);
  } catch (parseErr) {
    throw new GeminiProviderError(
      GEMINI_ERROR_CODES.INVALID_RESPONSE,
      "Gemini returned invalid non-JSON output.",
      parseErr
    );
  }

  return {
    rawOutput: parsedJson,
    durationMs,
    model: modelName
  };
}
