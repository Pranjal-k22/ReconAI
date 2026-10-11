import { PaymentCase } from "../../models/PaymentCase.js";
import { createAuditEvent } from "../audit/auditService.js";
import { AppError } from "../../utils/AppError.js";
import { logger } from "../../config/logger.js";
import {
  SUPPORTED_CURRENCIES,
  isValidCurrency,
  sanitizeMetadata
} from "../../models/helpers/validators.js";

/**
 * Generates a stable, unique Payment Case ID.
 * Example: CASE-20261011-8F3A1B
 */
export function generateCaseId() {
  const dateStr = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 8);
  const randStr = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `CASE-${dateStr}-${randStr}`;
}

/**
 * Validates and creates a new PaymentCase with tenant scoping and duplicate prevention.
 * Supports canonical 8 dimensions independently with backward-compatible aliases.
 */
export async function createPaymentCase({
  tenantId,
  customerId = null,
  merchantOrderId = null,
  gatewayPaymentId = null,
  discrepancyCategory,
  orderStatus,
  orderState,
  customerDebitStatus,
  customerDebitState,
  authorizationStatus,
  authorizationState,
  captureStatus,
  captureState,
  settlementStatus,
  settlementState,
  refundStatus,
  refundState,
  disputeStatus,
  disputeState,
  resolutionCaseStatus,
  resolutionCaseState,
  reversalStatus = null,
  reconStatus = null,
  investigationStatus = null,
  expectedAmountPaise = null,
  actualAmountPaise = null,
  currency = "INR",
  isSafeHold = false,
  safeHoldCode = "NONE",
  safeHoldReason = null,
  correlationKey = null,
  metadata = {},
  actorId = "system-case-manager"
} = {}) {
  if (!tenantId || typeof tenantId !== "string" || tenantId.trim().length === 0) {
    throw AppError.badRequest("tenantId is required and must be a non-empty string");
  }

  if (!discrepancyCategory) {
    throw AppError.badRequest("discrepancyCategory is required");
  }

  // Strict currency validation
  if (typeof currency !== "string" || !isValidCurrency(currency)) {
    throw AppError.badRequest(`Invalid or unsupported currency '${currency}'. Supported: ${SUPPORTED_CURRENCIES.join(", ")}`);
  }

  // Idempotent case creation check by correlationKey
  if (correlationKey) {
    const existing = await PaymentCase.findOne({ tenantId, correlationKey });
    if (existing) {
      logger.info({ tenantId, correlationKey, caseId: existing.caseId }, "Existing PaymentCase matched by correlationKey");
      return { isDuplicate: true, paymentCase: existing };
    }
  }

  const caseId = generateCaseId();

  // Resolve canonical 8 dimensions: all 7 financial/evidence dimensions default to UNKNOWN when unevidenced
  const resolvedOrderStatus = orderStatus || orderState || "UNKNOWN";
  const resolvedCustomerDebitStatus = customerDebitStatus || customerDebitState || "UNKNOWN";
  const resolvedAuthorizationStatus = authorizationStatus || authorizationState || "UNKNOWN";
  const resolvedCaptureStatus = captureStatus || captureState || "UNKNOWN";
  const resolvedSettlementStatus = settlementStatus || settlementState || "UNKNOWN";
  const resolvedRefundStatus = refundStatus || refundState || "UNKNOWN";
  const resolvedDisputeStatus = disputeStatus || disputeState || "UNKNOWN";
  const resolvedResolutionCaseStatus = resolutionCaseStatus || resolutionCaseState || "CASE_DETECTED";

  const sanitizedMeta = sanitizeMetadata(metadata);

  try {
    const paymentCase = await PaymentCase.create({
      caseId,
      tenantId: tenantId.trim(),
      customerId: customerId ? customerId.trim() : null,
      merchantOrderId: merchantOrderId ? merchantOrderId.trim() : null,
      gatewayPaymentId: gatewayPaymentId ? gatewayPaymentId.trim() : null,
      discrepancyCategory,
      orderStatus: resolvedOrderStatus,
      customerDebitStatus: resolvedCustomerDebitStatus,
      authorizationStatus: resolvedAuthorizationStatus,
      captureStatus: resolvedCaptureStatus,
      settlementStatus: resolvedSettlementStatus,
      refundStatus: resolvedRefundStatus,
      disputeStatus: resolvedDisputeStatus,
      resolutionCaseStatus: resolvedResolutionCaseStatus,
      reversalStatus,
      reconStatus,
      investigationStatus,
      expectedAmountPaise,
      actualAmountPaise,
      currency,
      isSafeHold,
      safeHoldCode,
      safeHoldReason: safeHoldReason ? safeHoldReason.slice(0, 256) : null,
      correlationKey: correlationKey ? correlationKey.trim() : null,
      metadata: sanitizedMeta,
      detectedAt: new Date()
    });

    // Record audit event
    await createAuditEvent({
      actorType: "SYSTEM",
      actorId,
      action: "CONTROLLER_RUN_STARTED",
      entityType: "PaymentCase",
      entityId: caseId,
      metadata: {
        tenantId,
        caseId,
        discrepancyCategory,
        resolutionCaseStatus: resolvedResolutionCaseStatus,
        isSafeHold
      }
    });

    return { isDuplicate: false, paymentCase };
  } catch (err) {
    // Handle duplicate key error from MongoDB unique index
    if (err.code === 11000) {
      if (correlationKey) {
        const existing = await PaymentCase.findOne({ tenantId, correlationKey });
        if (existing) {
          return { isDuplicate: true, paymentCase: existing };
        }
      }
      throw AppError.conflict(`Duplicate payment case detected for tenant '${tenantId}'`);
    }
    throw err;
  }
}

/**
 * Retrieves a PaymentCase by caseId, enforcing tenant boundary when tenantId is provided.
 */
export async function getPaymentCaseById(caseId, tenantId = null) {
  if (!caseId) {
    throw AppError.badRequest("caseId is required");
  }

  const query = { caseId };
  if (tenantId) {
    query.tenantId = tenantId;
  }

  const paymentCase = await PaymentCase.findOne(query);
  if (!paymentCase) {
    throw AppError.notFound(`PaymentCase not found for caseId '${caseId}'`);
  }

  return paymentCase;
}

/**
 * Updates a PaymentCase safe-hold status and reason.
 */
export async function updatePaymentCaseSafeHold({
  caseId,
  tenantId,
  isSafeHold,
  safeHoldCode = "ADMIN_HOLD",
  safeHoldReason,
  actorId = "system-safe-hold-service"
}) {
  const paymentCase = await getPaymentCaseById(caseId, tenantId);

  paymentCase.isSafeHold = Boolean(isSafeHold);
  paymentCase.safeHoldCode = isSafeHold ? safeHoldCode : "NONE";
  paymentCase.safeHoldReason = isSafeHold && safeHoldReason ? safeHoldReason.slice(0, 256) : null;

  if (isSafeHold) {
    paymentCase.resolutionCaseStatus = "CASE_SAFE_HOLD";
  }

  await paymentCase.save();

  await createAuditEvent({
    actorType: "SYSTEM",
    actorId,
    action: "CONTROLLER_SAFETY_GATE_EVALUATED",
    entityType: "PaymentCase",
    entityId: caseId,
    metadata: {
      tenantId,
      isSafeHold: paymentCase.isSafeHold,
      safeHoldCode: paymentCase.safeHoldCode,
      safeHoldReason: paymentCase.safeHoldReason
    }
  });

  return paymentCase;
}

/**
 * Lists PaymentCases with filtering and pagination.
 */
export async function listPaymentCases({
  tenantId,
  resolutionCaseStatus,
  resolutionCaseState,
  isSafeHold,
  page = 1,
  limit = 50
} = {}) {
  const filter = {};
  if (tenantId) filter.tenantId = tenantId;
  const statusFilter = resolutionCaseStatus || resolutionCaseState;
  if (statusFilter) filter.resolutionCaseStatus = statusFilter;
  if (typeof isSafeHold === "boolean") filter.isSafeHold = isSafeHold;

  const skip = (Math.max(1, page) - 1) * Math.max(1, limit);
  const [cases, total] = await Promise.all([
    PaymentCase.find(filter).sort({ detectedAt: -1 }).skip(skip).limit(limit).lean(),
    PaymentCase.countDocuments(filter)
  ]);

  return {
    cases,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit)
    }
  };
}
