import { describe, it, expect } from "vitest";
import {
  canTransitionGatewayStatus,
  canTransitionOrderStatus,
  mapProviderPaymentStatus,
  evaluateCanonicalTransition
} from "../../src/services/stateMachine/paymentStateMachine.js";

describe("Payment State Machine - Deterministic Canonical Transitions", () => {
  describe("canTransitionGatewayStatus", () => {
    it("allows standard forward transitions", () => {
      expect(canTransitionGatewayStatus("CREATED", "AUTHORIZED")).toBe(true);
      expect(canTransitionGatewayStatus("CREATED", "CAPTURED")).toBe(true);
      expect(canTransitionGatewayStatus("AUTHORIZED", "CAPTURED")).toBe(true);
      expect(canTransitionGatewayStatus("AUTHORIZED", "FAILED")).toBe(true);
      expect(canTransitionGatewayStatus("CAPTURED", "REFUNDED")).toBe(true);
      expect(canTransitionGatewayStatus("CAPTURED", "PARTIALLY_REFUNDED")).toBe(true);
      expect(canTransitionGatewayStatus("PARTIALLY_REFUNDED", "REFUNDED")).toBe(true);
    });

    it("allows idempotent same-status transitions", () => {
      expect(canTransitionGatewayStatus("CAPTURED", "CAPTURED")).toBe(true);
      expect(canTransitionGatewayStatus("FAILED", "FAILED")).toBe(true);
      expect(canTransitionGatewayStatus("AUTHORIZED", "AUTHORIZED")).toBe(true);
    });

    it("allows late capture after failure", () => {
      expect(canTransitionGatewayStatus("FAILED", "CAPTURED")).toBe(true);
    });

    it("strictly blocks regressions from CAPTURED", () => {
      expect(canTransitionGatewayStatus("CAPTURED", "FAILED")).toBe(false);
      expect(canTransitionGatewayStatus("CAPTURED", "AUTHORIZED")).toBe(false);
      expect(canTransitionGatewayStatus("CAPTURED", "PENDING")).toBe(false);
      expect(canTransitionGatewayStatus("CAPTURED", "CREATED")).toBe(false);
    });

    it("strictly blocks transitions from terminal REFUNDED status", () => {
      expect(canTransitionGatewayStatus("REFUNDED", "CAPTURED")).toBe(false);
      expect(canTransitionGatewayStatus("REFUNDED", "FAILED")).toBe(false);
      expect(canTransitionGatewayStatus("REFUNDED", "PENDING")).toBe(false);
    });
  });

  describe("canTransitionOrderStatus", () => {
    it("allows standard order progressions", () => {
      expect(canTransitionOrderStatus("CREATED", "PAID")).toBe(true);
      expect(canTransitionOrderStatus("PAID", "FULFILLED")).toBe(true);
      expect(canTransitionOrderStatus("PAID", "CANCELLED")).toBe(true);
      expect(canTransitionOrderStatus("PAID", "REFUNDED")).toBe(true);
    });

    it("strictly prevents reopening CANCELLED orders", () => {
      expect(canTransitionOrderStatus("CANCELLED", "PAID")).toBe(false);
      expect(canTransitionOrderStatus("CANCELLED", "CREATED")).toBe(false);
      expect(canTransitionOrderStatus("CANCELLED", "FULFILLED")).toBe(false);
    });
  });

  describe("mapProviderPaymentStatus", () => {
    it("maps recognized razorpay statuses to canonical values", () => {
      expect(mapProviderPaymentStatus("captured")).toBe("CAPTURED");
      expect(mapProviderPaymentStatus("authorized")).toBe("AUTHORIZED");
      expect(mapProviderPaymentStatus("failed")).toBe("FAILED");
      expect(mapProviderPaymentStatus("refunded")).toBe("REFUNDED");
      expect(mapProviderPaymentStatus("created")).toBe("CREATED");
    });

    it("maps unrecognized or invalid statuses to UNKNOWN", () => {
      expect(mapProviderPaymentStatus("weird_status")).toBe("UNKNOWN");
      expect(mapProviderPaymentStatus(null)).toBe("UNKNOWN");
      expect(mapProviderPaymentStatus(undefined)).toBe("UNKNOWN");
    });
  });

  describe("evaluateCanonicalTransition", () => {
    it("applies standard verified capture transition", () => {
      const evaluation = evaluateCanonicalTransition({
        existingGateway: { status: "CREATED" },
        existingOrder: { status: "CREATED", amountPaise: 50000, currency: "INR" },
        newPaymentStatus: "CAPTURED",
        capturedAmountPaise: 50000,
        currency: "INR",
        tenantId: "tenant_1"
      });

      expect(evaluation.allowed).toBe(true);
      expect(evaluation.conflictFlag).toBeNull();
      expect(evaluation.gatewayUpdates).toEqual({ status: "CAPTURED" });
      expect(evaluation.orderUpdates).toEqual({ status: "PAID" });
      expect(evaluation.caseUpdates.captureStatus).toBe("CAPTURE_CAPTURED");
      expect(evaluation.caseUpdates.orderStatus).toBe("ORDER_PAID");
    });

    it("rejects delayed failure after capture without regressing state", () => {
      const evaluation = evaluateCanonicalTransition({
        existingGateway: { status: "CAPTURED" },
        existingOrder: { status: "PAID" },
        newPaymentStatus: "FAILED",
        tenantId: "tenant_1"
      });

      expect(evaluation.allowed).toBe(false);
      expect(evaluation.conflictFlag).toBe("STALE_REGRESSION_BLOCKED");
      expect(evaluation.gatewayUpdates).toBeNull();
      expect(evaluation.orderUpdates).toBeNull();
    });

    it("safely handles late capture after reported failure under safe-hold", () => {
      const evaluation = evaluateCanonicalTransition({
        existingGateway: { status: "FAILED" },
        existingOrder: { status: "CREATED", amountPaise: 50000, currency: "INR" },
        newPaymentStatus: "CAPTURED",
        capturedAmountPaise: 50000,
        currency: "INR",
        tenantId: "tenant_1"
      });

      expect(evaluation.allowed).toBe(true);
      expect(evaluation.conflictFlag).toBe("LATE_CAPTURE_AFTER_FAILURE");
      expect(evaluation.gatewayUpdates.status).toBe("CAPTURED");
      expect(evaluation.gatewayUpdates.isLateCapture).toBe(true);
      expect(evaluation.caseUpdates.resolutionCaseStatus).toBe("CASE_SAFE_HOLD");
      expect(evaluation.caseUpdates.safeHoldCode).toBe("LATE_CAPTURE_AFTER_FAILURE");
      expect(evaluation.caseUpdates.isSafeHold).toBe(true);
    });

    it("preserves cancelled order status upon late capture under safe-hold", () => {
      const evaluation = evaluateCanonicalTransition({
        existingGateway: { status: "CREATED" },
        existingOrder: { status: "CANCELLED" },
        newPaymentStatus: "CAPTURED",
        tenantId: "tenant_1"
      });

      expect(evaluation.allowed).toBe(true);
      expect(evaluation.conflictFlag).toBe("CANCELLED_ORDER_CAPTURED");
      expect(evaluation.gatewayUpdates.status).toBe("CAPTURED");
      expect(evaluation.gatewayUpdates.isLateCapture).toBe(true);
      // Order status MUST remain CANCELLED, never changed to PAID!
      expect(evaluation.orderUpdates.status).toBe("CANCELLED");
      expect(evaluation.caseUpdates.orderStatus).toBe("ORDER_CANCELLED");
      expect(evaluation.caseUpdates.resolutionCaseStatus).toBe("CASE_SAFE_HOLD");
      expect(evaluation.caseUpdates.safeHoldCode).toBe("LATE_CAPTURE_CANCELLED_ORDER");
      expect(evaluation.caseUpdates.isSafeHold).toBe(true);
    });

    it("rejects cross-tenant mismatches deterministically", () => {
      const evaluation = evaluateCanonicalTransition({
        existingGateway: { status: "CREATED" },
        existingOrder: { status: "CREATED", tenantId: "tenant_A" },
        newPaymentStatus: "CAPTURED",
        tenantId: "tenant_A",
        claimedTenantId: "tenant_B"
      });

      expect(evaluation.allowed).toBe(false);
      expect(evaluation.conflictFlag).toBe("CROSS_TENANT_MISMATCH");
      expect(evaluation.gatewayUpdates).toBeNull();
    });

    it("keeps multiple payment attempts for same order isolated", () => {
      const attempt1 = evaluateCanonicalTransition({
        existingGateway: { status: "FAILED" },
        existingOrder: { status: "CREATED", amountPaise: 50000, currency: "INR" },
        newPaymentStatus: "FAILED",
        tenantId: "tenant_1"
      });

      const attempt2 = evaluateCanonicalTransition({
        existingGateway: { status: "CREATED" },
        existingOrder: { status: "CREATED", amountPaise: 50000, currency: "INR" },
        newPaymentStatus: "CAPTURED",
        capturedAmountPaise: 50000,
        currency: "INR",
        tenantId: "tenant_1"
      });

      expect(attempt1.allowed).toBe(true);
      expect(attempt1.gatewayUpdates.status).toBe("FAILED");
      expect(attempt1.orderUpdates).toBeNull();

      expect(attempt2.allowed).toBe(true);
      expect(attempt2.gatewayUpdates.status).toBe("CAPTURED");
      expect(attempt2.orderUpdates.status).toBe("PAID");
    });

    describe("ITEM g — PAID Only After Amount and Currency Match", () => {
      it("exact match: marks order PAID when captured amount and currency match exactly", () => {
        const evaluation = evaluateCanonicalTransition({
          existingGateway: { status: "CREATED" },
          existingOrder: { status: "CREATED", amountPaise: 10000, currency: "INR" },
          newPaymentStatus: "CAPTURED",
          capturedAmountPaise: 10000,
          currency: "INR",
          tenantId: "tenant_1"
        });

        expect(evaluation.allowed).toBe(true);
        expect(evaluation.orderUpdates).toEqual({ status: "PAID" });
        expect(evaluation.caseUpdates.orderStatus).toBe("ORDER_PAID");
        expect(evaluation.caseUpdates.isSafeHold).toBeFalsy();
      });

      it("1 paise off: does NOT mutate order, safe-holds case with AMOUNT_CURRENCY_MISMATCH", () => {
        const evaluation = evaluateCanonicalTransition({
          existingGateway: { status: "CREATED" },
          existingOrder: { status: "CREATED", amountPaise: 10000, currency: "INR" },
          newPaymentStatus: "CAPTURED",
          capturedAmountPaise: 10001,
          currency: "INR",
          tenantId: "tenant_1"
        });

        expect(evaluation.allowed).toBe(true);
        expect(evaluation.orderUpdates).toBeNull();
        expect(evaluation.caseUpdates.resolutionCaseStatus).toBe("CASE_SAFE_HOLD");
        expect(evaluation.caseUpdates.safeHoldCode).toBe("AMOUNT_CURRENCY_MISMATCH");
        expect(evaluation.caseUpdates.isSafeHold).toBe(true);
      });

      it("currency mismatch: does NOT mutate order, safe-holds case with AMOUNT_CURRENCY_MISMATCH", () => {
        const evaluation = evaluateCanonicalTransition({
          existingGateway: { status: "CREATED" },
          existingOrder: { status: "CREATED", amountPaise: 10000, currency: "INR" },
          newPaymentStatus: "CAPTURED",
          capturedAmountPaise: 10000,
          currency: "USD",
          tenantId: "tenant_1"
        });

        expect(evaluation.allowed).toBe(true);
        expect(evaluation.orderUpdates).toBeNull();
        expect(evaluation.caseUpdates.resolutionCaseStatus).toBe("CASE_SAFE_HOLD");
        expect(evaluation.caseUpdates.safeHoldCode).toBe("AMOUNT_CURRENCY_MISMATCH");
        expect(evaluation.caseUpdates.isSafeHold).toBe(true);
      });

      it("missing captured amount: does NOT mutate order, safe-holds with INSUFFICIENT_EVIDENCE", () => {
        const evaluation = evaluateCanonicalTransition({
          existingGateway: { status: "CREATED" },
          existingOrder: { status: "CREATED", amountPaise: 10000, currency: "INR" },
          newPaymentStatus: "CAPTURED",
          capturedAmountPaise: null,
          currency: "INR",
          tenantId: "tenant_1"
        });

        expect(evaluation.allowed).toBe(true);
        expect(evaluation.orderUpdates).toBeNull();
        expect(evaluation.caseUpdates.resolutionCaseStatus).toBe("CASE_SAFE_HOLD");
        expect(evaluation.caseUpdates.safeHoldCode).toBe("INSUFFICIENT_EVIDENCE");
        expect(evaluation.caseUpdates.isSafeHold).toBe(true);
      });

      it("partial capture: does NOT mutate order, safe-holds case with AMOUNT_CURRENCY_MISMATCH", () => {
        const evaluation = evaluateCanonicalTransition({
          existingGateway: { status: "CREATED" },
          existingOrder: { status: "CREATED", amountPaise: 10000, currency: "INR" },
          newPaymentStatus: "CAPTURED",
          capturedAmountPaise: 6000,
          currency: "INR",
          tenantId: "tenant_1"
        });

        expect(evaluation.allowed).toBe(true);
        expect(evaluation.orderUpdates).toBeNull();
        expect(evaluation.caseUpdates.resolutionCaseStatus).toBe("CASE_SAFE_HOLD");
        expect(evaluation.caseUpdates.safeHoldCode).toBe("AMOUNT_CURRENCY_MISMATCH");
        expect(evaluation.caseUpdates.isSafeHold).toBe(true);
      });
    });
  });
});
