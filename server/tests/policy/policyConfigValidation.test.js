import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  validateLimits,
  sanitizeReason,
  isKnownTenant,
  computePolicyConfigHash
} from "../../src/services/policy/policyConfigService.js";
import { PolicyConfigVersion } from "../../src/models/PolicyConfigVersion.js";
import { UserAccount } from "../../src/models/UserAccount.js";
import { ServicePrincipal } from "../../src/models/ServicePrincipal.js";
import { GatewayPayment } from "../../src/models/GatewayPayment.js";
import { MerchantOrder } from "../../src/models/MerchantOrder.js";

describe("PolicyConfigValidation - Unit Validation Table & Immutability Guards", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("1. Limits Validation Table (Strict integer paise, INR, single <= cumulative)", () => {
    it("accepts valid limits with positive integers and INR", () => {
      const valid = {
        currency: "INR",
        maxSingleRefundPaise: 50000,
        maxCumulativeRefundPaise: 200000
      };
      const result = validateLimits(valid);
      expect(result.currency).toBe("INR");
      expect(result.maxSingleRefundPaise).toBe(50000);
      expect(result.maxCumulativeRefundPaise).toBe(200000);
    });

    it("rejects negative single refund limit", () => {
      expect(() =>
        validateLimits({
          currency: "INR",
          maxSingleRefundPaise: -100,
          maxCumulativeRefundPaise: 50000
        })
      ).toThrow(/maxSingleRefundPaise must be a strictly positive integer/);
    });

    it("rejects negative cumulative refund limit", () => {
      expect(() =>
        validateLimits({
          currency: "INR",
          maxSingleRefundPaise: 1000,
          maxCumulativeRefundPaise: -5000
        })
      ).toThrow(/maxCumulativeRefundPaise must be a strictly positive integer/);
    });

    it("rejects zero single refund limit", () => {
      expect(() =>
        validateLimits({
          currency: "INR",
          maxSingleRefundPaise: 0,
          maxCumulativeRefundPaise: 50000
        })
      ).toThrow(/maxSingleRefundPaise must be a strictly positive integer/);
    });

    it("rejects zero cumulative refund limit", () => {
      expect(() =>
        validateLimits({
          currency: "INR",
          maxSingleRefundPaise: 1000,
          maxCumulativeRefundPaise: 0
        })
      ).toThrow(/maxCumulativeRefundPaise must be a strictly positive integer/);
    });

    it("rejects float single refund limit", () => {
      expect(() =>
        validateLimits({
          currency: "INR",
          maxSingleRefundPaise: 100.5,
          maxCumulativeRefundPaise: 50000
        })
      ).toThrow(/maxSingleRefundPaise must be a strictly positive integer/);
    });

    it("rejects float cumulative refund limit", () => {
      expect(() =>
        validateLimits({
          currency: "INR",
          maxSingleRefundPaise: 1000,
          maxCumulativeRefundPaise: 5000.75
        })
      ).toThrow(/maxCumulativeRefundPaise must be a strictly positive integer/);
    });

    it("rejects string single refund limit", () => {
      expect(() =>
        validateLimits({
          currency: "INR",
          maxSingleRefundPaise: "50000",
          maxCumulativeRefundPaise: 100000
        })
      ).toThrow(/maxSingleRefundPaise must be a strictly positive integer/);
    });

    it("rejects string cumulative refund limit", () => {
      expect(() =>
        validateLimits({
          currency: "INR",
          maxSingleRefundPaise: 50000,
          maxCumulativeRefundPaise: "100000"
        })
      ).toThrow(/maxCumulativeRefundPaise must be a strictly positive integer/);
    });

    it("rejects NaN values", () => {
      expect(() =>
        validateLimits({
          currency: "INR",
          maxSingleRefundPaise: NaN,
          maxCumulativeRefundPaise: 100000
        })
      ).toThrow(/maxSingleRefundPaise must be a strictly positive integer/);

      expect(() =>
        validateLimits({
          currency: "INR",
          maxSingleRefundPaise: 50000,
          maxCumulativeRefundPaise: NaN
        })
      ).toThrow(/maxCumulativeRefundPaise must be a strictly positive integer/);
    });

    it("rejects values above MAX_SAFE_INTEGER", () => {
      expect(() =>
        validateLimits({
          currency: "INR",
          maxSingleRefundPaise: Number.MAX_SAFE_INTEGER + 10,
          maxCumulativeRefundPaise: Number.MAX_SAFE_INTEGER + 20
        })
      ).toThrow(/maxSingleRefundPaise must be a strictly positive integer safe paise value/);
    });

    it("rejects when single limit exceeds cumulative limit", () => {
      expect(() =>
        validateLimits({
          currency: "INR",
          maxSingleRefundPaise: 200000,
          maxCumulativeRefundPaise: 100000
        })
      ).toThrow(/maxSingleRefundPaise \(200000\) cannot exceed maxCumulativeRefundPaise \(100000\)/);
    });

    it("rejects wrong currency", () => {
      expect(() =>
        validateLimits({
          currency: "USD",
          maxSingleRefundPaise: 50000,
          maxCumulativeRefundPaise: 100000
        })
      ).toThrow(/Unsupported currency 'USD'/);
    });

    it("rejects missing fields", () => {
      expect(() =>
        validateLimits({
          currency: "INR",
          maxCumulativeRefundPaise: 100000
        })
      ).toThrow(/limits must contain maxSingleRefundPaise and maxCumulativeRefundPaise/);

      expect(() =>
        validateLimits({
          currency: "INR",
          maxSingleRefundPaise: 50000
        })
      ).toThrow(/limits must contain maxSingleRefundPaise and maxCumulativeRefundPaise/);
    });

    it("rejects extra/unknown fields", () => {
      expect(() =>
        validateLimits({
          currency: "INR",
          maxSingleRefundPaise: 50000,
          maxCumulativeRefundPaise: 100000,
          dailyVelocityCap: 500000
        })
      ).toThrow(/Unknown field 'dailyVelocityCap' in policy limits/);
    });
  });

  describe("2. Reason Sanitization", () => {
    it("accepts clean string between 10 and 500 chars", () => {
      const clean = sanitizeReason("Valid business reason for limits update");
      expect(clean).toBe("Valid business reason for limits update");
    });

    it("strips control characters", () => {
      const dirty = "Valid reason with null\x00 and bell\x07 control chars";
      const clean = sanitizeReason(dirty);
      expect(clean).toBe("Valid reason with null and bell control chars");
    });

    it("rejects reason shorter than 10 characters", () => {
      expect(() => sanitizeReason("too short")).toThrow(/must be between 10 and 500 characters/);
    });

    it("rejects reason exceeding 500 characters", () => {
      const longReason = "a".repeat(501);
      expect(() => sanitizeReason(longReason)).toThrow(/must be between 10 and 500 characters/);
    });
  });

  describe("3. Tenant Validation & Sentinel Rejection", () => {
    it("unconditionally rejects the quarantine sentinel tenant", async () => {
      const isKnown = await isKnownTenant("unassigned_provider_quarantine");
      expect(isKnown).toBe(false);
    });

    it("rejects empty, null, or undefined tenantId", async () => {
      expect(await isKnownTenant(null)).toBe(false);
      expect(await isKnownTenant("")).toBe(false);
      expect(await isKnownTenant("   ")).toBe(false);
    });

    it("returns false for unknown tenant not present in any authoritative collections", async () => {
      vi.spyOn(UserAccount, "exists").mockResolvedValue(null);
      vi.spyOn(ServicePrincipal, "exists").mockResolvedValue(null);
      vi.spyOn(GatewayPayment, "exists").mockResolvedValue(null);
      vi.spyOn(MerchantOrder, "exists").mockResolvedValue(null);

      const isKnown = await isKnownTenant("completely_unknown_tenant");
      expect(isKnown).toBe(false);
    });

    it("returns true when tenant exists in UserAccount", async () => {
      vi.spyOn(UserAccount, "exists").mockResolvedValue({ _id: "u1" });
      vi.spyOn(ServicePrincipal, "exists").mockResolvedValue(null);
      vi.spyOn(GatewayPayment, "exists").mockResolvedValue(null);
      vi.spyOn(MerchantOrder, "exists").mockResolvedValue(null);

      const isKnown = await isKnownTenant("tenant_in_user_account");
      expect(isKnown).toBe(true);
    });

    it("returns true when tenant exists in ServicePrincipal", async () => {
      vi.spyOn(UserAccount, "exists").mockResolvedValue(null);
      vi.spyOn(ServicePrincipal, "exists").mockResolvedValue({ _id: "s1" });
      vi.spyOn(GatewayPayment, "exists").mockResolvedValue(null);
      vi.spyOn(MerchantOrder, "exists").mockResolvedValue(null);

      const isKnown = await isKnownTenant("tenant_in_service_principal");
      expect(isKnown).toBe(true);
    });

    it("returns true when tenant exists in GatewayPayment", async () => {
      vi.spyOn(UserAccount, "exists").mockResolvedValue(null);
      vi.spyOn(ServicePrincipal, "exists").mockResolvedValue(null);
      vi.spyOn(GatewayPayment, "exists").mockResolvedValue({ _id: "g1" });
      vi.spyOn(MerchantOrder, "exists").mockResolvedValue(null);

      const isKnown = await isKnownTenant("tenant_in_gateway_payment");
      expect(isKnown).toBe(true);
    });

    it("returns true when tenant exists in MerchantOrder", async () => {
      vi.spyOn(UserAccount, "exists").mockResolvedValue(null);
      vi.spyOn(ServicePrincipal, "exists").mockResolvedValue(null);
      vi.spyOn(GatewayPayment, "exists").mockResolvedValue(null);
      vi.spyOn(MerchantOrder, "exists").mockResolvedValue({ _id: "m1" });

      const isKnown = await isKnownTenant("tenant_in_merchant_order");
      expect(isKnown).toBe(true);
    });
  });

  describe("4. Canonical ContentHash Determinism", () => {
    it("produces identical SHA-256 hash regardless of object key order", () => {
      const limits1 = {
        currency: "INR",
        maxSingleRefundPaise: 50000,
        maxCumulativeRefundPaise: 200000
      };
      const limits2 = {
        maxCumulativeRefundPaise: 200000,
        maxSingleRefundPaise: 50000,
        currency: "INR"
      };

      const hash1 = computePolicyConfigHash(limits1);
      const hash2 = computePolicyConfigHash(limits2);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    it("produces different hash for different limit values", () => {
      const hash1 = computePolicyConfigHash({
        currency: "INR",
        maxSingleRefundPaise: 50000,
        maxCumulativeRefundPaise: 200000
      });
      const hash2 = computePolicyConfigHash({
        currency: "INR",
        maxSingleRefundPaise: 60000,
        maxCumulativeRefundPaise: 200000
      });

      expect(hash1).not.toBe(hash2);
    });
  });

  describe("5. Schema Immutability Guards", () => {
    it("schema rejects quarantine sentinel on tenantId validator", () => {
      const doc = new PolicyConfigVersion({
        tenantId: "unassigned_provider_quarantine",
        configVersion: 1,
        limits: { currency: "INR", maxSingleRefundPaise: 1000, maxCumulativeRefundPaise: 2000 },
        contentHash: "dummy",
        proposedBy: "admin-1",
        proposalReason: "Some reason 12345"
      });

      const err = doc.validateSync();
      expect(err).toBeDefined();
      expect(err.errors["tenantId"]).toBeDefined();
    });

    it("schema rejects negative/zero limits on validator", () => {
      const doc = new PolicyConfigVersion({
        tenantId: "tenant_valid",
        configVersion: 1,
        limits: { currency: "INR", maxSingleRefundPaise: -50, maxCumulativeRefundPaise: 0 },
        contentHash: "dummy",
        proposedBy: "admin-1",
        proposalReason: "Some reason 12345"
      });

      const err = doc.validateSync();
      expect(err).toBeDefined();
      expect(err.errors["limits.maxSingleRefundPaise"]).toBeDefined();
      expect(err.errors["limits.maxCumulativeRefundPaise"]).toBeDefined();
    });
  });
});
