import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  isGeminiConfigured,
  getGeminiModel,
  normalizeGeminiError,
  executeGeminiInvestigation,
  GEMINI_ERROR_CODES,
  GeminiProviderError
} from "../../src/services/ai/geminiService.js";

describe("Gemini Service Infrastructure", () => {
  const originalEnvKey = process.env.GEMINI_API_KEY;

  afterEach(() => {
    if (originalEnvKey !== undefined) {
      process.env.GEMINI_API_KEY = originalEnvKey;
    } else {
      delete process.env.GEMINI_API_KEY;
    }
  });

  it("should correctly report configuration status based on GEMINI_API_KEY", () => {
    delete process.env.GEMINI_API_KEY;
    expect(isGeminiConfigured()).toBe(false);

    process.env.GEMINI_API_KEY = "   ";
    expect(isGeminiConfigured()).toBe(false);

    process.env.GEMINI_API_KEY = "test-fake-key-123";
    expect(isGeminiConfigured()).toBe(true);
  });

  it("should return configured Gemini model or default", () => {
    const model = getGeminiModel();
    expect(typeof model).toBe("string");
    expect(model.length).toBeGreaterThan(0);
  });

  it("should normalize API authentication, quota, timeout, and network errors", () => {
    const authErr = normalizeGeminiError(new Error("API key invalid 401 Unauthorized"));
    expect(authErr.code).toBe(GEMINI_ERROR_CODES.AUTH_ERROR);

    const quotaErr = normalizeGeminiError(new Error("429 RESOURCE_EXHAUSTED rate limit exceeded"));
    expect(quotaErr.code).toBe(GEMINI_ERROR_CODES.QUOTA_ERROR);

    const timeoutErr = normalizeGeminiError(new Error("Request timeout"));
    expect(timeoutErr.code).toBe(GEMINI_ERROR_CODES.TIMEOUT);

    const networkErr = normalizeGeminiError(new Error("fetch failed ECONNRESET"));
    expect(networkErr.code).toBe(GEMINI_ERROR_CODES.NETWORK_ERROR);
  });

  it("should throw NOT_CONFIGURED when GEMINI_API_KEY is absent and no mock client is supplied", async () => {
    delete process.env.GEMINI_API_KEY;

    await expect(
      executeGeminiInvestigation({
        systemInstruction: "test",
        promptText: "test"
      })
    ).rejects.toThrow(GeminiProviderError);
  });

  it("should execute successfully with mocked AI client", async () => {
    const mockOutput = {
      summary: "Mock analysis summary",
      likelyCause: "Mock cause",
      evidence: ["Evidence 1"],
      recommendedNextStep: "CHECK_PAYMENT",
      riskNotes: [],
      aiConfidence: 0.9
    };

    const mockAiClient = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: JSON.stringify(mockOutput)
        })
      }
    };

    const result = await executeGeminiInvestigation({
      systemInstruction: "test system prompt",
      promptText: "test prompt",
      _aiClient: mockAiClient
    });

    expect(result.rawOutput).toEqual(mockOutput);
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(mockAiClient.models.generateContent).toHaveBeenCalledTimes(1);
  });

  it("should throw INVALID_RESPONSE when Gemini returns non-JSON text", async () => {
    const mockAiClient = {
      models: {
        generateContent: vi.fn().mockResolvedValue({
          text: "Not a JSON response string"
        })
      }
    };

    await expect(
      executeGeminiInvestigation({
        systemInstruction: "test",
        promptText: "test",
        _aiClient: mockAiClient
      })
    ).rejects.toThrow(/invalid non-JSON/);
  });
});
