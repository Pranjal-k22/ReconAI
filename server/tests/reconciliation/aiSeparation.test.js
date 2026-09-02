import { describe, it, expect, vi } from "vitest";
import * as geminiService from "../../src/services/ai/geminiService.js";
import { reconcileScenario } from "../../src/services/reconciliation/matchingEngine.js";

describe("AI & Deterministic Separation Architecture Invariant", () => {
  it("reconcileScenario matching engine MUST NEVER invoke Gemini API or AI services", () => {
    const spy = vi.spyOn(geminiService, "executeGeminiInvestigation");

    const scenario = {
      order: {
        merchantOrderId: "ORD-SEP-001",
        amountPaise: 100000,
        currency: "INR",
        status: "PAID",
        createdAt: new Date()
      },
      payments: [
        {
          gatewayPaymentId: "pay_SEP_001",
          merchantOrderId: "ORD-SEP-001",
          amountPaise: 100000,
          status: "CAPTURED",
          createdAt: new Date()
        }
      ],
      settlementLines: []
    };

    const result = reconcileScenario(scenario);

    expect(result).toBeDefined();
    expect(spy).not.toHaveBeenCalled();

    spy.mockRestore();
  });
});
