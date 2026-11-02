import { describe, it, expect } from "vitest";
import { formatPaiseToInr, parseInrToPaise } from "../utils/formatMoney.js";

describe("Paise to INR Money Formatter Invariants", () => {
  it("formats zero paise as ₹0.00", () => {
    expect(formatPaiseToInr(0)).toBe("₹0.00");
  });

  it("formats single paise with leading zero", () => {
    expect(formatPaiseToInr(1)).toBe("₹0.01");
    expect(formatPaiseToInr(9)).toBe("₹0.09");
  });

  it("formats standard amounts accurately with integer arithmetic", () => {
    expect(formatPaiseToInr(100)).toBe("₹1.00");
    expect(formatPaiseToInr(5000)).toBe("₹50.00");
    expect(formatPaiseToInr(10000)).toBe("₹100.00");
    expect(formatPaiseToInr(9999)).toBe("₹99.99");
  });

  it("formats large amounts using Indian number grouping (lakhs/crores)", () => {
    expect(formatPaiseToInr(10000000)).toBe("₹1,00,000.00");
    expect(formatPaiseToInr(123456789)).toBe("₹12,34,567.89");
  });

  it("handles negative paise values safely", () => {
    expect(formatPaiseToInr(-5000)).toBe("-₹50.00");
    expect(formatPaiseToInr(-1)).toBe("-₹0.01");
  });

  it("handles invalid or non-numeric inputs safely", () => {
    expect(formatPaiseToInr(null)).toBe("₹0.00");
    expect(formatPaiseToInr(undefined)).toBe("₹0.00");
    expect(formatPaiseToInr(NaN)).toBe("₹0.00");
    expect(formatPaiseToInr("invalid")).toBe("₹0.00");
  });

  it("exhibits zero floating point representation artifacts", () => {
    // 0.1 + 0.2 in JS float is 0.30000000000000004; integer paise math must be exact
    expect(formatPaiseToInr(10001)).toBe("₹100.01");
    expect(formatPaiseToInr(10002)).toBe("₹100.02");
    expect(formatPaiseToInr(10003)).toBe("₹100.03");
  });

  describe("parseInrToPaise Invariants", () => {
    it("returns null for empty string, null, or undefined", () => {
      expect(parseInrToPaise("")).toBeNull();
      expect(parseInrToPaise(null)).toBeNull();
      expect(parseInrToPaise(undefined)).toBeNull();
    });

    it("parses integer INR to paise", () => {
      expect(parseInrToPaise("100")).toBe(10000);
      expect(parseInrToPaise(250)).toBe(25000);
      expect(parseInrToPaise("0")).toBe(0);
    });

    it("parses decimal INR to paise accurately", () => {
      expect(parseInrToPaise("100.50")).toBe(10050);
      expect(parseInrToPaise("100.5")).toBe(10050);
      expect(parseInrToPaise("0.05")).toBe(5);
      expect(parseInrToPaise("0.99")).toBe(99);
    });

    it("rejects negative numbers, non-numeric strings, and >10 decimal places", () => {
      expect(() => parseInrToPaise("-50")).toThrow();
      expect(() => parseInrToPaise("abc")).toThrow();
      expect(() => parseInrToPaise("10.12345678901")).toThrow("Amount cannot exceed 10 decimal places");
    });
  });
});
