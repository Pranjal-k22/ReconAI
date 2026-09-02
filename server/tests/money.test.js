import { describe, it, expect } from "vitest";
import {
  rupeesToPaise,
  paiseToRupees,
  formatINR,
  isValidPaise,
  safeAddPaise,
  safeSubtractPaise
} from "../src/utils/money.js";
import { AppError } from "../src/utils/AppError.js";

describe("Financial Money Utilities (Integer Paise)", () => {
  describe("rupeesToPaise", () => {
    it("should convert integer rupees to paise correctly", () => {
      expect(rupeesToPaise(0)).toBe(0);
      expect(rupeesToPaise(1)).toBe(100);
      expect(rupeesToPaise(1499)).toBe(149900);
    });

    it("should convert decimal rupees to paise correctly", () => {
      expect(rupeesToPaise(1499.5)).toBe(149950);
      expect(rupeesToPaise(1499.50)).toBe(149950);
      expect(rupeesToPaise(0.99)).toBe(99);
    });

    it("should convert numeric string rupees to paise correctly", () => {
      expect(rupeesToPaise("1499")).toBe(149900);
      expect(rupeesToPaise("1499.50")).toBe(149950);
      expect(rupeesToPaise("0.05")).toBe(5);
    });

    it("should reject invalid decimal places (more than 2)", () => {
      expect(() => rupeesToPaise("1499.555")).toThrow(AppError);
    });

    it("should reject empty, null, or undefined inputs", () => {
      expect(() => rupeesToPaise("")).toThrow(AppError);
      expect(() => rupeesToPaise(null)).toThrow(AppError);
      expect(() => rupeesToPaise(undefined)).toThrow(AppError);
    });

    it("should reject non-numeric inputs, NaN, and Infinity", () => {
      expect(() => rupeesToPaise("invalid_string")).toThrow(AppError);
      expect(() => rupeesToPaise(NaN)).toThrow(AppError);
      expect(() => rupeesToPaise(Infinity)).toThrow(AppError);
      expect(() => rupeesToPaise({})).toThrow(AppError);
      expect(() => rupeesToPaise([])).toThrow(AppError);
    });

    it("should reject negative inputs by default", () => {
      expect(() => rupeesToPaise(-100)).toThrow(AppError);
      expect(() => rupeesToPaise("-50.00")).toThrow(AppError);
    });

    it("should allow negative inputs when allowNegative option is enabled", () => {
      expect(rupeesToPaise(-100, { allowNegative: true })).toBe(-10000);
      expect(rupeesToPaise("-50.50", { allowNegative: true })).toBe(-5050);
    });
  });

  describe("paiseToRupees", () => {
    it("should convert integer paise to floating rupees", () => {
      expect(paiseToRupees(0)).toBe(0);
      expect(paiseToRupees(100)).toBe(1);
      expect(paiseToRupees(149900)).toBe(1499);
      expect(paiseToRupees(149950)).toBe(1499.5);
    });

    it("should reject non-integer paise inputs", () => {
      expect(() => paiseToRupees(100.5)).toThrow(AppError);
      expect(() => paiseToRupees("1000")).toThrow(AppError);
    });
  });

  describe("isValidPaise", () => {
    it("should validate non-negative safe integers", () => {
      expect(isValidPaise(0)).toBe(true);
      expect(isValidPaise(149900)).toBe(true);
      expect(isValidPaise(Number.MAX_SAFE_INTEGER)).toBe(true);
    });

    it("should reject invalid paise values", () => {
      expect(isValidPaise(-1)).toBe(false);
      expect(isValidPaise(10.5)).toBe(false);
      expect(isValidPaise("100")).toBe(false);
      expect(isValidPaise(null)).toBe(false);
      expect(isValidPaise(NaN)).toBe(false);
    });

    it("should support negative paise if allowNegative is true", () => {
      expect(isValidPaise(-1000, true)).toBe(true);
    });
  });

  describe("safeAddPaise & safeSubtractPaise", () => {
    it("should perform safe addition of paise amounts", () => {
      expect(safeAddPaise(149900, 5000)).toBe(154900);
      expect(safeAddPaise(0, 100)).toBe(100);
    });

    it("should perform safe subtraction of paise amounts", () => {
      expect(safeSubtractPaise(154900, 5000)).toBe(149900);
      expect(safeSubtractPaise(100, 100)).toBe(0);
    });

    it("should reject unsafe numbers or non-integers in arithmetic", () => {
      expect(() => safeAddPaise(10.5, 100)).toThrow(AppError);
      expect(() => safeSubtractPaise(100, "50")).toThrow(AppError);
    });
  });

  describe("formatINR", () => {
    it("should format integer paise into Indian currency string", () => {
      const formatted = formatINR(149900);
      // Verify format contains ₹ and 1,499.00
      expect(formatted).toContain("1,499.00");
    });

    it("should handle 0 paise formatting", () => {
      const formatted = formatINR(0);
      expect(formatted).toContain("0.00");
    });
  });
});
