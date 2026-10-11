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

  // Test 3: Uncertain-state defaults: customerDebitStatus defaults to UNKNOWN when unevidenced
  it("3. Uncertain-state defaults: customerDebitStatus strictly defaults to UNKNOWN", async () => {
    const defaultCase = new PaymentCase({
      caseId: "CASE-DEF-001",
      tenantId: "sh_merchant_alpha",
      discrepancyCategory: "GENERAL_EXCEPTION"
    });

    // customerDebitStatus MUST NOT default to DEBIT_NONE; it must be UNKNOWN
    expect(defaultCase.customerDebitStatus).toBe("UNKNOWN");
    expect(defaultCase.customerDebitState).toBe("UNKNOWN");
    expect(defaultCase.orderStatus).toBe("UNKNOWN");
    expect(defaultCase.resolutionCaseStatus).toBe("CASE_DETECTED");
  });

  // Test 4: Strict independence of the eight canonical lifecycle dimensions
  it("4. Strict independence of the eight canonical lifecycle dimensions", async () => {
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

  // Test 5: Dimension boundary checks - gateway failure != absence of customer debit
  it("5. Dimension boundary: gateway failure does NOT imply absence of customer debit", async () => {
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

  // Test 6: Authorization != Capture, and Capture != Settlement
  it("6. Dimension boundary: auth != capture and capture != settlement", async () => {
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

  // Test 7: Refund initiated != confirmed refund
  it("7. Dimension boundary: refund request != confirmed refund", async () => {
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

  // Test 8: Case resolved does not imply verified provider outcome
  it("8. Dimension boundary: closed case does NOT prove verified provider outcome", async () => {
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

  // Test 9: Auxiliary dimensions are preserved separately
  it("9. Auxiliary dimensions (reversal, recon, investigation) do not substitute canonical 8", async () => {
    const caseDoc = new PaymentCase({
      caseId: "CASE-AUX-01",
      tenantId: "sh_merchant_alpha",
      discrepancyCategory: "STATUS_MISMATCH",
      orderStatus: "ORDER_PENDING",
      customerDebitStatus: "UNKNOWN",
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
    expect(caseDoc.customerDebitStatus).toBe("UNKNOWN");
    expect(caseDoc.reversalStatus).toBe("PENDING_REVERSAL_SYNC");
    expect(caseDoc.reconStatus).toBe("UNMATCHED");
    expect(caseDoc.investigationStatus).toBe("AGENT_ANALYSIS_REQUIRED");
  });

  // Test 10: Currency validation rejects malformed, lowercase, non-string, and unsupported codes
  it("10. Currency validation rejects malformed, lowercase, non-string, and unsupported currencies", async () => {
    // Valid INR
    const validCase = new PaymentCase({
      caseId: "CASE-CURR-INR",
      tenantId: "sh_merchant_alpha",
      discrepancyCategory: "STATUS_MISMATCH",
      currency: "INR"
    });
    await expect(validCase.validate()).resolves.toBeUndefined();

    // Malformed lowercase 'inr' rejected
    const lowercaseCase = new PaymentCase({
      caseId: "CASE-CURR-LOWER",
      tenantId: "sh_merchant_alpha",
      discrepancyCategory: "STATUS_MISMATCH",
      currency: "inr"
    });
    await expect(lowercaseCase.validate()).rejects.toThrow(/currency/i);

    // Unsupported foreign currency 'USD' rejected
    const usdCase = new PaymentCase({
      caseId: "CASE-CURR-USD",
      tenantId: "sh_merchant_alpha",
      discrepancyCategory: "STATUS_MISMATCH",
      currency: "USD"
    });
    await expect(usdCase.validate()).rejects.toThrow(/currency/i);

    // Service layer rejection
    await expect(
      paymentCaseService.createPaymentCase({
        tenantId: "sh_merchant_alpha",
        discrepancyCategory: "STATUS_MISMATCH",
        currency: "EUR"
      })
    ).rejects.toThrow(/Invalid or unsupported currency/i);
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

  // Test 12: Metadata minimization on PaymentCase
  it("12. Metadata minimization: strips customer PII and nested structures from PaymentCase.metadata", async () => {
    const caseDoc = new PaymentCase({
      caseId: "CASE-META-001",
      tenantId: "sh_merchant_alpha",
      discrepancyCategory: "STATUS_MISMATCH",
      metadata: {
        safeFlag: true,
        retryCount: 2,
        internalCode: "CODE_X",
        // PII and unapproved keys
        customerName: "Sneha Patel",
        email: "sneha@example.com",
        billingAddress: { city: "Mumbai" },
        cardToken: "tok_12345"
      }
    });

    expect(caseDoc.metadata.safeFlag).toBe(true);
    expect(caseDoc.metadata.retryCount).toBe(2);
    expect(caseDoc.metadata.internalCode).toBe("CODE_X");
    expect(caseDoc.metadata.customerName).toBeUndefined();
    expect(caseDoc.metadata.email).toBeUndefined();
    expect(caseDoc.metadata.billingAddress).toBeUndefined();
    expect(caseDoc.metadata.cardToken).toBeUndefined();
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
