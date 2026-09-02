import { isGeminiConfigured } from "../ai/geminiService.js";
import { isRazorpayConfigured } from "./razorpayClient.js";
import { getEnv } from "../../config/env.js";

/**
 * Returns safe system integration capability status.
 * NEVER exposes secrets or authorization keys.
 */
export function getIntegrationStatus() {
  const env = getEnv();
  const razorpayMode = (env.RAZORPAY_MODE || process.env.RAZORPAY_MODE || "test").trim().toLowerCase();

  return {
    gemini: {
      configured: isGeminiConfigured()
    },
    razorpay: {
      configured: isRazorpayConfigured(),
      mode: razorpayMode
    }
  };
}
