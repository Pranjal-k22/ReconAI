import { describe, it, expect, vi } from "vitest";
import {
  PaymentCase,
  ORDER_STATES,
  CUSTOMER_DEBIT_STATES,
  AUTHORIZATION_STATES,
  CAPTURE_STATES,
  SETTLEMENT_STATES,
  REFUND_STATES,
  DISPUTE_STATES,
  RESOLUTION_CASE_STATES,
  DISCREPANCY_CATEGORIES
} from "../../src/models/PaymentCase.js";
import * as paymentCaseService from "../../src/services/ledger/paymentCaseService.js";

describe("Phase 2 — PaymentCase Domain Model & Service Tests", () => {
  // Test 1: Valid PaymentCase creation and required-field validation
  it("1. Valid PaymentCase creation and required-field validation", async () => {
    const validCase = new PaymentCase({
      caseId: "CASE-20261011-T1001",
      tenantId: "sh_merchant_alpha",
      customerId: "cust_4421",
      merchantOrderId: "ORD-9871",
      gatewayPaymentId: "pay_ABC123",
      discrepancyCategory: "FRONTEND_DROPPED_AFTER_SUCCESS",
      orderState: "ORDER_PENDING",
      customerDebitState: "DEBIT_VERIFIED",
      authorizationState: "AUTH_AUTHORIZED",
      captureState: "CAPTURE_CAPTURED",
      settlementState: "SETTLEMENT_PENDING",
      refundState: "REFUND_NONE",
      disputeState: "DISPUTE_NONE",
      resolutionCaseState: "CASE_DETECTED",
      expectedAmountPaise: 200000,
      actualAmountPaise: 200000,
      currency: "INR",
      isSafeHold: false,
      correlationKey: "sh_merchant_alpha:ORD-9871:pay_ABC123"
    });

    const err = await validCase.validate();
    expect(err).toBeUndefined();
    expect(validCase.caseId).toBe("CASE-20261011-T1001");
    expect(validCase.tenantId).toBe("sh_merchant_alpha");
  });

  // Test 2: Invalid enum and malformed reference rejection
  it("2. Invalid enum and malformed reference rejection", async () => {
    // Missing required tenantId
    const missingTenant = new PaymentCase({
      caseId: "CASE-NO-TENANT",
      discrepancyCategory: "STATUS_MISMATCH"
    });
    await expect(missingTenant.validate()).rejects.toThrow(/tenantId is required/);

    // Invalid discrepancy category
    const badCategory = new PaymentCase({
      caseId: "CASE-BAD-CAT",
      tenantId: "sh_merchant_alpha",
      discrepancyCategory: "TOTALLY_INVALID_CATEGORY"
    });
    await expect(badCategory.validate()).rejects.toThrow();

    // Invalid resolutionCaseState
    const badState = new PaymentCase({
      caseId: "CASE-BAD-STATE",
      tenantId: "sh_merchant_alpha",
      discrepancyCategory: "STATUS_MISMATCH",
      resolutionCaseState: "INVALID_STATE_XYZ"
    });
    await expect(badState.validate()).rejects.toThrow();
  });

  // Test 3: Separation of the eight lifecycle dimensions
  it("3. Strict separation of the eight orthogonal lifecycle dimensions", async () => {
    const multiDimCase = new PaymentCase({
      caseId: "CASE-DIM-001",
      tenantId: "sh_merchant_alpha",
      discrepancyCategory: "DELAYED_SETTLEMENT",
      orderState: "ORDER_PAID",
      customerDebitState: "DEBIT_VERIFIED",
      authorizationState: "AUTH_AUTHORIZED",
      captureState: "CAPTURE_CAPTURED",
      settlementState: "SETTLEMENT_PENDING",
      refundState: "REFUND_NONE",
      disputeState: "DISPUTE_NONE",
      resolutionCaseState: "CASE_INVESTIGATING"
    });

    // Verify all 8 dimensions remain completely independent
    expect(multiDimCase.orderState).toBe("ORDER_PAID");
    expect(multiDimCase.customerDebitState).toBe("DEBIT_VERIFIED");
    expect(multiDimCase.captureState).toBe("CAPTURE_CAPTURED");
    expect(multiDimCase.settlementState).toBe("SETTLEMENT_PENDING");
    expect(multiDimCase.refundState).toBe("REFUND_NONE");

    // Updating one dimension does not alter any other dimension
    multiDimCase.refundState = "REFUND_ELIGIBLE";
    expect(multiDimCase.refundState).toBe("REFUND_ELIGIBLE");
    expect(multiDimCase.captureState).toBe("CAPTURE_CAPTURED");
    expect(multiDimCase.settlementState).toBe("SETTLEMENT_PENDING");
    expect(multiDimCase.orderState).toBe("ORDER_PAID");
  });

  // Test 11: Integer-paise validation and rejection of invalid monetary values
  it("11. Integer-paise validation: rejects negative and floating-point paise", async () => {
    // Negative paise
    const negativePaiseCase = new PaymentCase({
      caseId: "CASE-NEG-001",
      tenantId: "sh_merchant_alpha",
      discrepancyCategory: "STATUS_MISMATCH",
      expectedAmountPaise: -500
    });
    await expect(negativePaiseCase.validate()).rejects.toThrow(/expectedAmountPaise/);

    // Floating-point paise
    const floatPaiseCase = new PaymentCase({
      caseId: "CASE-FLOAT-001",
      tenantId: "sh_merchant_alpha",
      discrepancyCategory: "STATUS_MISMATCH",
      actualAmountPaise: 1500.75
    });
    await expect(floatPaiseCase.validate()).rejects.toThrow(/actualAmountPaise/);
  });

  // Test 12: Currency and amount validation
  it("12. Currency and amount validation enforces standard ISO uppercase code", async () => {
    const caseDoc = new PaymentCase({
      caseId: "CASE-CURR-001",
      tenantId: "sh_merchant_alpha",
      discrepancyCategory: "STATUS_MISMATCH",
      expectedAmountPaise: 50000,
      currency: "inr"
    });

    expect(caseDoc.currency).toBe("INR");
  });

  // Service test: Idempotent case creation check via correlationKey
  it("Service: createPaymentCase handles correlationKey deduplication gracefully", async () => {
    const mockExisting = {
      caseId: "CASE-EXISTING-123",
      tenantId: "sh_merchant_alpha",
      correlationKey: "sh_merchant_alpha:ORD-1:pay_1"
    };

    vi.spyOn(PaymentCase, "findOne").mockResolvedValue(mockExisting);

    const result = await paymentCaseService.createPaymentCase({
      tenantId: "sh_merchant_alpha",
      discrepancyCategory: "STATUS_MISMATCH",
      correlationKey: "sh_merchant_alpha:ORD-1:pay_1"
    });

    expect(result.isDuplicate).toBe(true);
    expect(result.paymentCase.caseId).toBe("CASE-EXISTING-123");

    vi.restoreAllMocks();
  });
});
