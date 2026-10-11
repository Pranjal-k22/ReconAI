import { describe, it, expect, vi } from "vitest";
import {
  PaymentCase,
  ORDER_STATUSES,
  CUSTOMER_DEBIT_STATUSES,
  AUTHORIZATION_STATUSES,
  CAPTURE_STATUSES,
  SETTLEMENT_STATUSES,
  REFUND_STATUSES,
  DISPUTE_STATUSES,
  RESOLUTION_CASE_STATUSES,
  DISCREPANCY_CATEGORIES
} from "../../src/models/PaymentCase.js";
import * as paymentCaseService from "../../src/services/ledger/paymentCaseService.js";

describe("Phase 2 — PaymentCase Domain Model & Canonical 8-Dimension Tests", () => {
  // Test 1: Valid PaymentCase creation and required-field validation
  it("1. Valid PaymentCase creation and required-field validation", async () => {
    const validCase = new PaymentCase({
      caseId: "CASE-20261011-T1001",
      tenantId: "sh_merchant_alpha",
      customerId: "cust_4421",
      merchantOrderId: "ORD-9871",
      gatewayPaymentId: "pay_ABC123",
      discrepancyCategory: "FRONTEND_DROPPED_AFTER_SUCCESS",
      orderStatus: "ORDER_PENDING",
      customerDebitStatus: "DEBIT_VERIFIED",
      authorizationStatus: "AUTH_AUTHORIZED",
      captureStatus: "CAPTURE_CAPTURED",
      settlementStatus: "SETTLEMENT_PENDING",
      refundStatus: "REFUND_NONE",
      disputeStatus: "DISPUTE_NONE",
      resolutionCaseStatus: "CASE_DETECTED",
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
    const missingTenant = new PaymentCase({
      caseId: "CASE-NO-TENANT",
      discrepancyCategory: "STATUS_MISMATCH"
    });
    await expect(missingTenant.validate()).rejects.toThrow(/tenantId is required/);

    const badCategory = new PaymentCase({
      caseId: "CASE-BAD-CAT",
      tenantId: "sh_merchant_alpha",
      discrepancyCategory: "TOTALLY_INVALID_CATEGORY"
    });
    await expect(badCategory.validate()).rejects.toThrow();

    const badState = new PaymentCase({
      caseId: "CASE-BAD-STATE",
      tenantId: "sh_merchant_alpha",
      discrepancyCategory: "STATUS_MISMATCH",
      resolutionCaseStatus: "INVALID_STATE_XYZ"
    });
    await expect(badState.validate()).rejects.toThrow();
  });

  // Test 3: Strict independence of the eight canonical lifecycle dimensions
  it("3. Strict independence of the eight canonical lifecycle dimensions", async () => {
    const multiDimCase = new PaymentCase({
      caseId: "CASE-DIM-001",
      tenantId: "sh_merchant_alpha",
      discrepancyCategory: "DELAYED_SETTLEMENT",
      orderStatus: "ORDER_PAID",
      customerDebitStatus: "DEBIT_VERIFIED",
      authorizationStatus: "AUTH_AUTHORIZED",
      captureStatus: "CAPTURE_CAPTURED",
      settlementStatus: "SETTLEMENT_PENDING",
      refundStatus: "REFUND_NONE",
      disputeStatus: "DISPUTE_NONE",
      resolutionCaseStatus: "CASE_INVESTIGATING"
    });

    // Verify all 8 dimensions remain independently populated
    expect(multiDimCase.orderStatus).toBe("ORDER_PAID");
    expect(multiDimCase.customerDebitStatus).toBe("DEBIT_VERIFIED");
    expect(multiDimCase.authorizationStatus).toBe("AUTH_AUTHORIZED");
    expect(multiDimCase.captureStatus).toBe("CAPTURE_CAPTURED");
    expect(multiDimCase.settlementStatus).toBe("SETTLEMENT_PENDING");
    expect(multiDimCase.refundStatus).toBe("REFUND_NONE");
    expect(multiDimCase.disputeStatus).toBe("DISPUTE_NONE");
    expect(multiDimCase.resolutionCaseStatus).toBe("CASE_INVESTIGATING");

    // Mutating refundStatus does not alter captureStatus, settlementStatus, or orderStatus
    multiDimCase.refundStatus = "REFUND_ELIGIBLE";
    expect(multiDimCase.refundStatus).toBe("REFUND_ELIGIBLE");
    expect(multiDimCase.captureStatus).toBe("CAPTURE_CAPTURED");
    expect(multiDimCase.settlementStatus).toBe("SETTLEMENT_PENDING");
    expect(multiDimCase.orderStatus).toBe("ORDER_PAID");

    // Aliases remain in sync
    expect(multiDimCase.orderState).toBe("ORDER_PAID");
    expect(multiDimCase.customerDebitState).toBe("DEBIT_VERIFIED");
    expect(multiDimCase.refundState).toBe("REFUND_ELIGIBLE");
  });

  // Test 4: Dimension boundary checks - gateway failure != absence of customer debit
  it("4. Dimension boundary: gateway failure is NOT equated with absence of customer debit", async () => {
    const caseDoc = new PaymentCase({
      caseId: "CASE-DEBIT-01",
      tenantId: "sh_merchant_alpha",
      discrepancyCategory: "CUSTOMER_DEBIT_ON_GATEWAY_FAILURE",
      orderStatus: "ORDER_PENDING",
      customerDebitStatus: "DEBIT_VERIFIED",
      authorizationStatus: "AUTH_NONE",
      captureStatus: "CAPTURE_FAILED",
      settlementStatus: "SETTLEMENT_NONE",
      refundStatus: "REFUND_NONE",
      disputeStatus: "DISPUTE_NONE",
      resolutionCaseStatus: "CASE_DETECTED"
    });

    expect(caseDoc.captureStatus).toBe("CAPTURE_FAILED");
    expect(caseDoc.customerDebitStatus).toBe("DEBIT_VERIFIED");
    await expect(caseDoc.validate()).resolves.toBeUndefined();
  });

  // Test 5: Authorization != Capture, and Capture != Settlement
  it("5. Dimension boundary: auth != capture and capture != settlement", async () => {
    const caseDoc = new PaymentCase({
      caseId: "CASE-AUTH-CAP-01",
      tenantId: "sh_merchant_alpha",
      discrepancyCategory: "LATE_AUTHORIZATION",
      orderStatus: "ORDER_CREATED",
      customerDebitStatus: "DEBIT_REPORTED",
      authorizationStatus: "AUTH_AUTHORIZED",
      captureStatus: "CAPTURE_NONE",
      settlementStatus: "SETTLEMENT_NONE",
      refundStatus: "REFUND_NONE",
      disputeStatus: "DISPUTE_NONE",
      resolutionCaseStatus: "CASE_INVESTIGATING"
    });

    expect(caseDoc.authorizationStatus).toBe("AUTH_AUTHORIZED");
    expect(caseDoc.captureStatus).toBe("CAPTURE_NONE");
    expect(caseDoc.settlementStatus).toBe("SETTLEMENT_NONE");
    await expect(caseDoc.validate()).resolves.toBeUndefined();
  });

  // Test 6: Refund initiated != confirmed refund
  it("6. Dimension boundary: refund request != confirmed refund", async () => {
    const caseDoc = new PaymentCase({
      caseId: "CASE-REFUND-01",
      tenantId: "sh_merchant_alpha",
      discrepancyCategory: "REFUND_PENDING_TIMEOUT",
      orderStatus: "ORDER_PAID",
      customerDebitStatus: "DEBIT_VERIFIED",
      authorizationStatus: "AUTH_AUTHORIZED",
      captureStatus: "CAPTURE_CAPTURED",
      settlementStatus: "SETTLEMENT_SETTLED",
      refundStatus: "REFUND_INITIATED",
      disputeStatus: "DISPUTE_NONE",
      resolutionCaseStatus: "CASE_ACTION_IN_PROGRESS"
    });

    expect(caseDoc.refundStatus).toBe("REFUND_INITIATED");
    expect(caseDoc.refundStatus).not.toBe("REFUND_CONFIRMED");
    await expect(caseDoc.validate()).resolves.toBeUndefined();
  });

  // Test 7: Case resolved does not imply verified provider outcome
  it("7. Dimension boundary: closed case does NOT prove verified provider outcome", async () => {
    const caseDoc = new PaymentCase({
      caseId: "CASE-CLOSED-01",
      tenantId: "sh_merchant_alpha",
      discrepancyCategory: "FRAUD_CLAIM",
      orderStatus: "ORDER_CANCELLED",
      customerDebitStatus: "UNKNOWN",
      authorizationStatus: "AUTH_EXPIRED",
      captureStatus: "CAPTURE_FAILED",
      settlementStatus: "SETTLEMENT_NONE",
      refundStatus: "REFUND_NONE",
      disputeStatus: "DISPUTE_LOST",
      resolutionCaseStatus: "CASE_RESOLVED"
    });

    expect(caseDoc.resolutionCaseStatus).toBe("CASE_RESOLVED");
    expect(caseDoc.refundStatus).toBe("REFUND_NONE");
    expect(caseDoc.customerDebitStatus).toBe("UNKNOWN");
    await expect(caseDoc.validate()).resolves.toBeUndefined();
  });

  // Test 8: Auxiliary dimensions are preserved separately
  it("8. Auxiliary dimensions (reversal, recon, investigation) do not substitute canonical 8", async () => {
    const caseDoc = new PaymentCase({
      caseId: "CASE-AUX-01",
      tenantId: "sh_merchant_alpha",
      discrepancyCategory: "STATUS_MISMATCH",
      orderStatus: "ORDER_PENDING",
      customerDebitStatus: "DEBIT_NONE",
      authorizationStatus: "AUTH_NONE",
      captureStatus: "CAPTURE_NONE",
      settlementStatus: "SETTLEMENT_NONE",
      refundStatus: "REFUND_NONE",
      disputeStatus: "DISPUTE_NONE",
      resolutionCaseStatus: "CASE_DETECTED",
      reversalStatus: "PENDING_REVERSAL_SYNC",
      reconStatus: "UNMATCHED",
      investigationStatus: "AGENT_ANALYSIS_REQUIRED"
    });

    expect(caseDoc.orderStatus).toBe("ORDER_PENDING");
    expect(caseDoc.reversalStatus).toBe("PENDING_REVERSAL_SYNC");
    expect(caseDoc.reconStatus).toBe("UNMATCHED");
    expect(caseDoc.investigationStatus).toBe("AGENT_ANALYSIS_REQUIRED");
  });

  // Test 11: Integer-paise validation
  it("11. Integer-paise validation: rejects negative and floating-point paise", async () => {
    const negativePaiseCase = new PaymentCase({
      caseId: "CASE-NEG-001",
      tenantId: "sh_merchant_alpha",
      discrepancyCategory: "STATUS_MISMATCH",
      expectedAmountPaise: -500
    });
    await expect(negativePaiseCase.validate()).rejects.toThrow(/expectedAmountPaise/);

    const floatPaiseCase = new PaymentCase({
      caseId: "CASE-FLOAT-001",
      tenantId: "sh_merchant_alpha",
      discrepancyCategory: "STATUS_MISMATCH",
      actualAmountPaise: 1500.75
    });
    await expect(floatPaiseCase.validate()).rejects.toThrow(/actualAmountPaise/);
  });

  // Test 12: Currency uppercase validation
  it("12. Currency validation enforces standard uppercase code", async () => {
    const caseDoc = new PaymentCase({
      caseId: "CASE-CURR-001",
      tenantId: "sh_merchant_alpha",
      discrepancyCategory: "STATUS_MISMATCH",
      expectedAmountPaise: 50000,
      currency: "inr"
    });

    expect(caseDoc.currency).toBe("INR");
  });

  // Service test: Idempotent case creation
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
