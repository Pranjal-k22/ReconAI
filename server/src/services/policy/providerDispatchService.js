import crypto from "crypto";
import { ProviderOperation } from "../../models/ProviderOperation.js";
import { PaymentCase } from "../../models/PaymentCase.js";
import { GatewayPayment } from "../../models/GatewayPayment.js";
import { MerchantOrder } from "../../models/MerchantOrder.js";
import { EvidenceRecord } from "../../models/EvidenceRecord.js";
import { PaymentAction } from "../../models/PaymentAction.js";
import { PolicyDecision } from "../../models/PolicyDecision.js";
import { createAuditEvent } from "../audit/auditService.js";
import {
  evaluateResolutionPolicy,
  DEFAULT_POLICY_VERSION,
  SUPPORTED_POLICY_VERSIONS
} from "./resolutionPolicyEvaluator.js";
import {
  checkSandboxWriteGate,
  executeSandboxRefund,
  verifySandboxRefundStatus,
  verifyPaymentStatus,
  SandboxGateClosedError,
  sanitizeProviderPayload
} from "../razorpay/razorpaySandboxAdapter.js";
import { RazorpayProviderError, RAZORPAY_ERROR_CODES } from "../razorpay/razorpayClient.js";
import { AppError } from "../../utils/AppError.js";
import { logger } from "../../config/logger.js";

/**
 * Generates a stable unique Provider Operation ID.
 * Example: OP-20261012-A1B2C3D4
 */
export function generateOperationId() {
  const dateStr = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 8);
  const randStr = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `OP-${dateStr}-${randStr}`;
}

/**
 * Computes deterministic SHA-256 hash of operation dispatch parameters.
 */
export function computeDispatchPayloadHash({
  tenantId,
  caseId,
  gatewayPaymentId,
  amountPaise,
  currency,
  proposedActionType
}) {
  const normalized = JSON.stringify({
    tenantId: String(tenantId).trim(),
    caseId: String(caseId).trim(),
    gatewayPaymentId: String(gatewayPaymentId).trim(),
    amountPaise: Number(amountPaise),
    currency: String(currency).trim().toUpperCase(),
    proposedActionType: String(proposedActionType).trim()
  });

  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/**
 * Executes the strict 9-step Sandbox Provider Dispatch flow.
 *
 * PRESERVES ORDERING:
 * 1. Authenticate & authorize actor (performed at route / caller layer).
 * 2. Validate tenant, case, order, and payment ownership.
 * 3. Obtain authoritative evidence and policy decision.
 * 4. Confirm requested action is eligible under trusted server-side policy config.
 * 5. Verify provider mode and explicit sandbox-write gate.
 * 6. Persist operation identity and initial state (REQUESTED).
 * 7. Dispatch only permitted sandbox operation.
 * 8. Verify outcome independently (authoritative read).
 * 9. Persist verified outcome or retain unknown/safe-held state.
 */
export async function dispatchSandboxAction({
  tenantId,
  caseId,
  actorId,
  actorRole,
  proposedActionType,
  amountPaise = null,
  currency = "INR",
  idempotencyKey,
  policyConfig = null,
  policyVersion = DEFAULT_POLICY_VERSION,
  customFetch = null
}) {
  // -------------------------------------------------------------------------
  // Step 1: Invariant & Identity Checks
  // -------------------------------------------------------------------------
  if (!tenantId || typeof tenantId !== "string" || !tenantId.trim()) {
    throw AppError.badRequest("tenantId is required");
  }
  if (!caseId || typeof caseId !== "string" || !caseId.trim()) {
    throw AppError.badRequest("caseId is required");
  }
  if (!idempotencyKey || typeof idempotencyKey !== "string" || !idempotencyKey.trim()) {
    throw AppError.badRequest("idempotencyKey is required");
  }
  if (proposedActionType !== "REQUEST_REFUND") {
    throw AppError.badRequest(
      `Unsupported provider operation action type: '${proposedActionType}'. Only 'REQUEST_REFUND' is supported for sandbox dispatch.`
    );
  }

  const cleanTenantId = tenantId.trim();
  const cleanCaseId = caseId.trim();
  const cleanIdempotencyKey = idempotencyKey.trim();
  const effectivePolicyVersion = policyVersion || DEFAULT_POLICY_VERSION;

  if (!SUPPORTED_POLICY_VERSIONS.includes(effectivePolicyVersion)) {
    throw AppError.badRequest(`Unsupported policy version '${effectivePolicyVersion}'`);
  }

  // -------------------------------------------------------------------------
  // Step 2: Validate Tenant, Case, Order, and Payment Ownership
  // -------------------------------------------------------------------------
  const caseDoc = await PaymentCase.findOne({
    caseId: cleanCaseId,
    tenantId: cleanTenantId
  }).lean();

  if (!caseDoc) {
    throw AppError.notFound(`PaymentCase '${cleanCaseId}' not found for tenant '${cleanTenantId}'`);
  }

  if (!caseDoc.gatewayPaymentId) {
    throw AppError.badRequest(`PaymentCase '${cleanCaseId}' has no associated gatewayPaymentId`);
  }

  const [gatewayPayment, merchantOrder, evidenceRecord, inFlightActions] = await Promise.all([
    GatewayPayment.findOne({
      tenantId: cleanTenantId,
      gatewayPaymentId: caseDoc.gatewayPaymentId
    }).lean(),
    caseDoc.merchantOrderId
      ? MerchantOrder.findOne({
          tenantId: cleanTenantId,
          merchantOrderId: caseDoc.merchantOrderId
        }).lean()
      : null,
    EvidenceRecord.findOne({
      tenantId: cleanTenantId,
      caseId: cleanCaseId
    }).lean(),
    PaymentAction.find({
      tenantId: cleanTenantId,
      caseId: cleanCaseId,
      actionType: { $in: ["REQUEST_REFUND", "SIMULATE_REFUND_CUSTOMER"] },
      actionStatus: { $in: ["SIMULATED", "PROPOSED"] }
    }).lean()
  ]);

  if (!gatewayPayment) {
    throw AppError.badRequest(
      `GatewayPayment '${caseDoc.gatewayPaymentId}' not found for tenant '${cleanTenantId}'`
    );
  }

  // Confirm currency binding
  const targetCurrency = (currency || gatewayPayment.currency || "INR").toUpperCase();
  if (gatewayPayment.currency && gatewayPayment.currency !== targetCurrency) {
    throw AppError.badRequest(
      `Currency mismatch: payment currency '${gatewayPayment.currency}' does not match target '${targetCurrency}'`
    );
  }

  // -------------------------------------------------------------------------
  // Step 3 & 4: Obtain Policy Decision and Confirm Eligibility
  // -------------------------------------------------------------------------
  const inFlightCommitmentsPaise = (inFlightActions || []).reduce((sum, a) => sum + (a.amountPaise || 0), 0);

  const authoritativeEvidence = {
    paymentCase: caseDoc,
    gatewayPayment,
    merchantOrder,
    evidenceRecord,
    refundRecords: [],
    settlementRecord: null,
    disputeRecord: null,
    duplicatePayments: [],
    inFlightCommitmentsPaise
  };

  const policyResult = evaluateResolutionPolicy({
    tenantId: cleanTenantId,
    caseId: cleanCaseId,
    actorId,
    actorRole,
    proposedActionType,
    amountPaise,
    currency: targetCurrency,
    classificationFinding: evidenceRecord,
    authoritativeEvidence,
    policyConfig, // Enforced null unless approved server-side config exists
    policyVersion: effectivePolicyVersion
  });

  // Strict Policy Eligibility Enforcement:
  // Fails closed if policy config is missing or Case 22 or safe hold
  if (policyResult.outcomeStatus !== "ELIGIBLE_FOR_SIMULATION") {
    logger.warn(
      {
        outcomeStatus: policyResult.outcomeStatus,
        appliedRuleIds: policyResult.appliedRuleIds,
        denyReasons: policyResult.denyReasons
      },
      "Provider sandbox dispatch blocked by deterministic policy engine"
    );

    return {
      dispatchBlocked: true,
      reason: "Action is not eligible for provider dispatch under approved policy.",
      policyOutcomeStatus: policyResult.outcomeStatus,
      appliedRuleIds: policyResult.appliedRuleIds,
      denyReasons: policyResult.denyReasons,
      missingEvidence: policyResult.missingEvidence,
      conflicts: policyResult.conflicts
    };
  }

  const targetAmountPaise = policyResult.amountPaise || amountPaise || gatewayPayment.amountPaise;

  // -------------------------------------------------------------------------
  // Step 5: Verify Provider Mode and Explicit Sandbox-Write Gate
  // -------------------------------------------------------------------------
  // Throws SandboxGateClosedError if mode is live, writes disabled, or key invalid
  checkSandboxWriteGate();

  // -------------------------------------------------------------------------
  // Step 6: Idempotency Check & Persist Initial State (REQUESTED)
  // -------------------------------------------------------------------------
  const inputHash = computeDispatchPayloadHash({
    tenantId: cleanTenantId,
    caseId: cleanCaseId,
    gatewayPaymentId: gatewayPayment.gatewayPaymentId,
    amountPaise: targetAmountPaise,
    currency: targetCurrency,
    proposedActionType
  });

  const existingOp = await ProviderOperation.findOne({
    tenantId: cleanTenantId,
    idempotencyKey: cleanIdempotencyKey
  }).lean();

  if (existingOp) {
    if (existingOp.requestPayloadHash !== inputHash) {
      throw AppError.conflict(
        `Idempotency key '${cleanIdempotencyKey}' was already used with conflicting parameters`
      );
    }

    // Conservative idempotent handling:
    // If previous outcome was unknown, do NOT blindly issue a new mutation!
    if (existingOp.operationStatus === "OUTCOME_UNKNOWN") {
      logger.info(
        { operationId: existingOp.operationId },
        "Replaying operation in OUTCOME_UNKNOWN state: checking status instead of issuing new refund"
      );

      // Attempt read verification if providerOperationId exists
      if (existingOp.providerOperationId) {
        const verifyResult = await verifySandboxRefundStatus({
          gatewayPaymentId: gatewayPayment.gatewayPaymentId,
          refundId: existingOp.providerOperationId,
          expectedAmountPaise: existingOp.amountPaise,
          expectedCurrency: existingOp.currency,
          customFetch
        });

        if (
          verifyResult.outcome === "VERIFIED_SUCCEEDED" ||
          verifyResult.outcome === "VERIFIED_FAILED" ||
          verifyResult.outcome === "SAFE_HOLD"
        ) {
          const updatedOp = await ProviderOperation.findByIdAndUpdate(
            existingOp._id,
            {
              operationStatus: verifyResult.outcome,
              safeHoldReason: verifyResult.safeHoldReason || null,
              failureReason: verifyResult.failureReason || null,
              verificationEvidence: verifyResult.rawResponse,
              verificationStatus: verifyResult.status,
              verifiedAt: new Date()
            },
            { new: true }
          ).lean();

          return {
            isDuplicate: true,
            dispatchBlocked: false,
            operation: sanitizeProviderPayload(updatedOp)
          };
        }
      }

      return {
        isDuplicate: true,
        dispatchBlocked: false,
        operation: sanitizeProviderPayload(existingOp),
        note: "Previous operation outcome remains unknown. Safe hold preserved without duplicate refund."
      };
    }

    // Terminal states return existing verified record
    return {
      isDuplicate: true,
      dispatchBlocked: false,
      operation: sanitizeProviderPayload(existingOp)
    };
  }

  // Durably record before network dispatch
  const operationId = generateOperationId();
  const providerIdempotencyKey = operationId;
  let providerOp;

  try {
    providerOp = await ProviderOperation.create({
      operationId,
      tenantId: cleanTenantId,
      caseId: cleanCaseId,
      idempotencyKey: cleanIdempotencyKey,
      providerIdempotencyKey,
      operationType: "REFUND",
      operationStatus: "REQUESTED",
      gatewayPaymentId: gatewayPayment.gatewayPaymentId,
      merchantOrderId: caseDoc.merchantOrderId || null,
      amountPaise: targetAmountPaise,
      currency: targetCurrency,
      provider: "RAZORPAY",
      requestPayloadHash: inputHash,
      policyVersion: effectivePolicyVersion,
      requestedAt: new Date()
    });
  } catch (err) {
    if (err.code === 11000) {
      // Concurrent race condition
      const racedOp = await ProviderOperation.findOne({
        tenantId: cleanTenantId,
        idempotencyKey: cleanIdempotencyKey
      }).lean();
      return {
        isDuplicate: true,
        dispatchBlocked: false,
        operation: sanitizeProviderPayload(racedOp)
      };
    }
    throw err;
  }

  // -------------------------------------------------------------------------
  // Step 7: Dispatch Sandbox Operation
  // -------------------------------------------------------------------------
  let dispatchResponse = null;
  let dispatchError = null;

  try {
    await ProviderOperation.findByIdAndUpdate(providerOp._id, { dispatchedAt: new Date() });

    dispatchResponse = await executeSandboxRefund({
      gatewayPaymentId: gatewayPayment.gatewayPaymentId,
      amountPaise: targetAmountPaise,
      providerIdempotencyKey: providerOp.providerIdempotencyKey || providerOp.operationId,
      notes: {
        reconaiCaseId: cleanCaseId,
        tenantId: cleanTenantId,
        operationId
      },
      receipt: `RCP-${operationId}`,
      customFetch
    });
  } catch (err) {
    dispatchError = err;
    logger.warn({ err: err.message, operationId }, "Error during sandbox provider dispatch");
  }

  // -------------------------------------------------------------------------
  // Step 8 & 9: Verify Outcome Independently & Persist Verified State
  // -------------------------------------------------------------------------
  // Case A: Dispatch failed or timed out during POST
  if (dispatchError) {
    const isTimeoutOrNetworkOrConflict =
      dispatchError instanceof RazorpayProviderError &&
      (dispatchError.code === RAZORPAY_ERROR_CODES.TIMEOUT ||
        dispatchError.code === RAZORPAY_ERROR_CODES.NETWORK_ERROR ||
        dispatchError.code === RAZORPAY_ERROR_CODES.CONFLICT);

    // Timeout, network loss, or 409 conflict is strictly OUTCOME_UNKNOWN (not failure!)
    const statusOnDispatchFail = isTimeoutOrNetworkOrConflict ? "OUTCOME_UNKNOWN" : "VERIFIED_FAILED";

    const updatedOp = await ProviderOperation.findByIdAndUpdate(
      providerOp._id,
      {
        operationStatus: statusOnDispatchFail,
        failureReason: dispatchError.message.slice(0, 256),
        verificationStatus:
          dispatchError.code === RAZORPAY_ERROR_CODES.CONFLICT
            ? "DISPATCH_CONFLICT_UNKNOWN"
            : isTimeoutOrNetworkOrConflict
            ? "DISPATCH_TIMEOUT_UNKNOWN"
            : "DISPATCH_FAILED"
      },
      { new: true }
    ).lean();

    return {
      isDuplicate: false,
      dispatchBlocked: false,
      operation: sanitizeProviderPayload(updatedOp)
    };
  }

  // Case B: POST succeeded with accepted response (id: rfnd_xxx)
  // An accepted HTTP 200 response is NOT proof of completion! We must independently verify.
  const providerRefundId = dispatchResponse.providerRefundId;

  const verifyResult = await verifySandboxRefundStatus({
    gatewayPaymentId: gatewayPayment.gatewayPaymentId,
    refundId: providerRefundId,
    expectedAmountPaise: targetAmountPaise,
    expectedCurrency: targetCurrency,
    customFetch
  });

  let finalOperationStatus = "OUTCOME_UNKNOWN";
  let safeHoldReason = null;
  let failureReason = null;

  if (verifyResult.outcome === "VERIFIED_SUCCEEDED") {
    finalOperationStatus = "VERIFIED_SUCCEEDED";
  } else if (verifyResult.outcome === "VERIFIED_FAILED") {
    finalOperationStatus = "VERIFIED_FAILED";
    failureReason = verifyResult.failureReason || "Provider reported refund failed during verification";
  } else if (verifyResult.outcome === "SAFE_HOLD") {
    finalOperationStatus = "SAFE_HOLD";
    safeHoldReason = verifyResult.safeHoldReason || "Authoritative provider evidence conflicts or identity mismatch detected";
  } else {
    // Pending, timeout, or ambiguous read
    finalOperationStatus = "OUTCOME_UNKNOWN";
  }

  const finalOp = await ProviderOperation.findByIdAndUpdate(
    providerOp._id,
    {
      operationStatus: finalOperationStatus,
      providerOperationId: providerRefundId,
      providerResponseRaw: sanitizeProviderPayload(dispatchResponse.rawResponse),
      verificationEvidence: sanitizeProviderPayload(verifyResult.rawResponse),
      verificationStatus: verifyResult.status,
      verifiedAt: new Date(),
      safeHoldReason,
      failureReason
    },
    { new: true }
  ).lean();

  // Audit trail
  await createAuditEvent({
    actorType: "SYSTEM",
    actorId: actorId || "provider-dispatch-service",
    action: "CONTROLLER_SAFETY_GATE_EVALUATED",
    entityType: "ProviderOperation",
    entityId: operationId,
    metadata: {
      tenantId: cleanTenantId,
      caseId: cleanCaseId,
      operationId,
      operationStatus: finalOperationStatus,
      gatewayPaymentId: gatewayPayment.gatewayPaymentId,
      amountPaise: targetAmountPaise,
      providerRefundId
    }
  }).catch(() => {});

  return {
    isDuplicate: false,
    dispatchBlocked: false,
    operation: sanitizeProviderPayload(finalOp)
  };
}

/**
 * Re-checks an existing ProviderOperation via read-only authoritative verification.
 */
export async function recheckProviderOperationStatus({
  tenantId,
  operationId,
  customFetch = null
}) {
  if (!tenantId || !operationId) {
    throw AppError.badRequest("tenantId and operationId are required");
  }

  const op = await ProviderOperation.findOne({
    tenantId: tenantId.trim(),
    operationId: operationId.trim()
  });

  if (!op) {
    throw AppError.notFound(`ProviderOperation '${operationId}' not found for tenant '${tenantId}'`);
  }

  if (!op.providerOperationId) {
    return {
      operation: sanitizeProviderPayload(op.toObject()),
      message: "Operation has no providerOperationId to verify"
    };
  }

  const verifyResult = await verifySandboxRefundStatus({
    gatewayPaymentId: op.gatewayPaymentId,
    refundId: op.providerOperationId,
    expectedAmountPaise: op.amountPaise,
    expectedCurrency: op.currency,
    customFetch
  });

  if (
    verifyResult.outcome === "VERIFIED_SUCCEEDED" ||
    verifyResult.outcome === "VERIFIED_FAILED" ||
    verifyResult.outcome === "SAFE_HOLD"
  ) {
    op.operationStatus = verifyResult.outcome;
    op.safeHoldReason = verifyResult.safeHoldReason || null;
    op.failureReason = verifyResult.failureReason || null;
    op.verificationEvidence = sanitizeProviderPayload(verifyResult.rawResponse);
    op.verificationStatus = verifyResult.status;
    op.verifiedAt = new Date();
    await op.save();
  }

  return {
    operation: sanitizeProviderPayload(op.toObject()),
    verificationResult: verifyResult
  };
}

/**
 * Lists provider operations for a case within tenant.
 */
export async function getProviderOperationsByCaseId(caseId, tenantId) {
  if (!caseId || !tenantId) {
    throw AppError.badRequest("caseId and tenantId are required");
  }

  const ops = await ProviderOperation.find({
    caseId: caseId.trim(),
    tenantId: tenantId.trim()
  })
    .sort({ createdAt: -1 })
    .lean();

  return ops.map(sanitizeProviderPayload);
}
