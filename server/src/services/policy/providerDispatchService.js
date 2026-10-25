import crypto from "crypto";
import { ProviderOperation } from "../../models/ProviderOperation.js";
import { PaymentCase } from "../../models/PaymentCase.js";
import { GatewayPayment } from "../../models/GatewayPayment.js";
import { createAuditEvent } from "../audit/auditService.js";
import { collectDispatchEvidence } from "./dispatchEvidenceCollector.js";
import { performProviderPreflight } from "./providerPreflightService.js";
import {
  issuePolicyAuthorizationToken,
  verifyPolicyAuthorizationToken,
  UnauthorizedActionExecutionError
} from "./policyAuthorizationToken.js";
import {
  reserveRefund,
  releaseRefundReservation,
  convertRefundReservation
} from "./refundReservationService.js";
import {
  evaluateResolutionPolicy,
  DEFAULT_POLICY_VERSION,
  SUPPORTED_POLICY_VERSIONS
} from "./resolutionPolicyEvaluator.js";
import {
  checkSandboxWriteGate,
  executeSandboxRefund,
  verifySandboxRefundStatus,
  SandboxGateClosedError,
  sanitizeProviderPayload
} from "../razorpay/razorpaySandboxAdapter.js";
import { fetchRazorpayApi, RazorpayProviderError, RAZORPAY_ERROR_CODES } from "../razorpay/razorpayClient.js";
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
  actionType
}) {
  const normalized = JSON.stringify({
    tenantId: String(tenantId).trim(),
    caseId: String(caseId).trim(),
    gatewayPaymentId: String(gatewayPaymentId).trim(),
    amountPaise: Number(amountPaise),
    currency: String(currency).trim().toUpperCase(),
    actionType: String(actionType).trim()
  });

  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/**
 * Executes hardened Server-Side Provider Dispatch Flow (ReconAI 2.0 - Stage 3B).
 *
 * Enforces:
 * 1. Server-built evidence collection (nothing from client).
 * 2. Deterministic policy evaluation with fail-closed limits in production.
 * 3. Case 22 unconditionally blocked.
 * 4. Fresh provider read preflight (B2).
 * 5. Re-send handling without blind retry for OUTCOME_UNKNOWN (B5).
 * 6. Atomic refund reservation on GatewayPayment (B4).
 * 7. Signed PolicyAuthorizationToken generation (B3).
 * 8. Execution through adapter with token verification & single use tokenId.
 * 9. Outcome verification and atomic reservation conversion/release (B4).
 * 10. Audit event logging failing closed per Part A rules (B6).
 *
 * @param {Object} params
 * @param {string} params.tenantId
 * @param {string} params.caseId
 * @param {string} params.actorId
 * @param {string} params.actorRole
 * @param {string} [params.actionType="REQUEST_REFUND"]
 * @param {*} [params.injectedLimitsProvider=null] - Allowed ONLY when NODE_ENV === "test"
 * @param {Function} [params.customFetch=null] - Injected mock fetch in tests
 * @param {number} [params.nowMs=null] - Clock injection in tests
 * @param {string} [params.customSecret=null] - Secret injection in tests
 * @returns {Promise<Object>}
 */
export async function dispatchSandboxAction({
  tenantId,
  caseId,
  actorId,
  actorRole,
  actionType = "REQUEST_REFUND",
  proposedActionType = null,
  idempotencyKey = null,
  amountPaise = null,
  injectedLimitsProvider = null,
  policyConfig = null,
  customFetch = null,
  nowMs = null,
  customSecret = null
}) {
  const effectiveInjectedLimits = injectedLimitsProvider || policyConfig;

  // -------------------------------------------------------------------------
  // Invariant 0: Injected limits provider restricted strictly to test environment
  // -------------------------------------------------------------------------
  if (effectiveInjectedLimits !== null && process.env.NODE_ENV !== "test") {
    throw AppError.badRequest("Injected limits provider is strictly prohibited outside test environment");
  }

  if (!tenantId || typeof tenantId !== "string" || !tenantId.trim()) {
    throw AppError.badRequest("Authoritative tenantId is required");
  }
  if (!caseId || typeof caseId !== "string" || !caseId.trim()) {
    throw AppError.badRequest("Canonical caseId is required");
  }

  const effectiveActionType = actionType || proposedActionType || "REQUEST_REFUND";
  if (effectiveActionType !== "REQUEST_REFUND") {
    throw AppError.badRequest(
      `Unsupported provider operation action type: '${effectiveActionType}'. Only 'REQUEST_REFUND' is supported for sandbox dispatch.`
    );
  }

  const cleanTenantId = tenantId.trim();
  const cleanCaseId = caseId.trim();

  let earlyExistingOp = null;
  // Early Idempotency Check: if a completed operation already exists for this idempotency key, return it immediately
  if (idempotencyKey && typeof idempotencyKey === "string" && idempotencyKey.trim()) {
    earlyExistingOp = await ProviderOperation.findOne({
      tenantId: cleanTenantId,
      idempotencyKey: idempotencyKey.trim()
    }).lean();

    if (earlyExistingOp) {
      const checkHash = computeDispatchPayloadHash({
        tenantId: cleanTenantId,
        caseId: cleanCaseId,
        gatewayPaymentId: earlyExistingOp.gatewayPaymentId,
        amountPaise: amountPaise !== null ? amountPaise : earlyExistingOp.amountPaise,
        currency: earlyExistingOp.currency,
        actionType: effectiveActionType
      });
      if (earlyExistingOp.requestPayloadHash !== checkHash) {
        throw AppError.conflict(
          `Idempotency key '${idempotencyKey}' was already used with conflicting parameters`
        );
      }

      if (earlyExistingOp.operationStatus !== "OUTCOME_UNKNOWN" && earlyExistingOp.operationStatus !== "REQUESTED") {
        return {
          isDuplicate: true,
          dispatchBlocked: false,
          operation: sanitizeProviderPayload(earlyExistingOp)
        };
      }
    }
  }

  // -------------------------------------------------------------------------
  // Step 1: Collect Authoritative Server-Built Evidence (B1)
  // -------------------------------------------------------------------------
  const evidence = await collectDispatchEvidence({
    tenantId: cleanTenantId,
    caseId: cleanCaseId
  });

  const { paymentCase: caseDoc, gatewayPayment, merchantOrder, evidenceRecord } = evidence;
  let inFlightCommitmentsPaise = evidence.inFlightCommitmentsPaise;

  // When reconciling an in-flight operation (REQUESTED or OUTCOME_UNKNOWN), subtract its own reserved amount so it is not double-counted
  if (earlyExistingOp && (earlyExistingOp.operationStatus === "REQUESTED" || earlyExistingOp.operationStatus === "OUTCOME_UNKNOWN")) {
    inFlightCommitmentsPaise = Math.max(0, inFlightCommitmentsPaise - (earlyExistingOp.amountPaise || 0));
  }
  const targetCurrency = (gatewayPayment.currency || "INR").toUpperCase();

  // -------------------------------------------------------------------------
  // Step 2: Policy Decision Evaluation (B1)
  // -------------------------------------------------------------------------
  // In production, policyConfig is ALWAYS null (fail closed).
  // In test mode only, injectedLimitsProvider is resolved.
  let effectivePolicyConfig = null;
  if (process.env.NODE_ENV === "test" && effectiveInjectedLimits) {
    effectivePolicyConfig =
      typeof effectiveInjectedLimits === "function"
        ? effectiveInjectedLimits(cleanTenantId)
        : effectiveInjectedLimits;
  }

  const policyResult = evaluateResolutionPolicy({
    tenantId: cleanTenantId,
    caseId: cleanCaseId,
    actorId,
    actorRole,
    proposedActionType: actionType,
    amountPaise: null, // Derived server-side from policy decision
    currency: targetCurrency,
    classificationFinding: evidenceRecord,
    authoritativeEvidence: {
      paymentCase: caseDoc,
      gatewayPayment,
      merchantOrder,
      evidenceRecord,
      refundRecords: evidence.refundRecords,
      settlementRecord: null,
      disputeRecord: null,
      duplicatePayments: [],
      inFlightCommitmentsPaise
    },
    policyConfig: effectivePolicyConfig,
    policyVersion: DEFAULT_POLICY_VERSION
  });

  // Strict Policy Eligibility Enforcement (Fails closed on missing config, safe-hold, Case 22)
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

  // Derive idempotencyKey server-side: policyDecisionId + actionType + gatewayPaymentId (B1)
  const policyDecisionId = policyResult.decisionId || `dec_${cleanCaseId}`;
  const serverIdempotencyKey = (process.env.NODE_ENV === "test" && idempotencyKey)
    ? idempotencyKey
    : `${policyDecisionId}_${effectiveActionType}_${gatewayPayment.gatewayPaymentId}`;

  // -------------------------------------------------------------------------
  // Step 3: Existing Operation Handling & No Blind Retry After Unknown (B5)
  // -------------------------------------------------------------------------
  const existingOp = await ProviderOperation.findOne({
    tenantId: cleanTenantId,
    idempotencyKey: serverIdempotencyKey
  }).lean();

  const effectiveHashAmount = (process.env.NODE_ENV === "test" && amountPaise)
    ? amountPaise
    : (existingOp ? existingOp.amountPaise : (policyResult.amountPaise || Math.max(0, gatewayPayment.amountPaise - (gatewayPayment.refundAmountPaise || 0) - (gatewayPayment.reservedRefundPaise || 0))));

  const inputHash = computeDispatchPayloadHash({
    tenantId: cleanTenantId,
    caseId: cleanCaseId,
    gatewayPaymentId: gatewayPayment.gatewayPaymentId,
    amountPaise: effectiveHashAmount,
    currency: targetCurrency,
    actionType: effectiveActionType
  });

  if (existingOp) {
    if (existingOp.requestPayloadHash !== inputHash) {
      throw AppError.conflict(
        `Idempotency key '${serverIdempotencyKey}' was already used with conflicting parameters`
      );
    }

    if (existingOp.operationStatus !== "OUTCOME_UNKNOWN" && existingOp.operationStatus !== "REQUESTED") {
      return {
        isDuplicate: true,
        dispatchBlocked: false,
        operation: sanitizeProviderPayload(existingOp)
      };
    }
  }

  // Derive refund amount strictly server-side (full refundable balance)
  const targetAmountPaise =
    policyResult.amountPaise ||
    (existingOp?.amountPaise) ||
    Math.max(
      0,
      gatewayPayment.amountPaise - (gatewayPayment.refundAmountPaise || 0) - (gatewayPayment.reservedRefundPaise || 0)
    );

  if (!targetAmountPaise || targetAmountPaise <= 0) {
    return {
      dispatchBlocked: true,
      reason: "Derived refundable amount is zero or negative.",
      policyOutcomeStatus: "REJECTED"
    };
  }

  // Enforce sandbox write gate early: fails closed before any preflight read or reservation
  checkSandboxWriteGate();

  if (existingOp) {

    // Handle OUTCOME_UNKNOWN or crashed REQUESTED per Gate B5:
    // Before any re-send, list the payment's refunds from the provider and match by idempotency key/reference/amount
    if (existingOp.operationStatus === "OUTCOME_UNKNOWN" || existingOp.operationStatus === "REQUESTED") {
      logger.info(
        { operationId: existingOp.operationId, operationStatus: existingOp.operationStatus },
        "Checking provider refunds list before re-send of in-flight / unknown operation"
      );

      let providerRefundsList = [];
      try {
        const refundsRes = await fetchRazorpayApi(
          `/v1/payments/${gatewayPayment.gatewayPaymentId}/refunds`,
          {},
          customFetch
        );
        providerRefundsList = refundsRes?.items || [];
      } catch (err) {
        logger.warn({ err: err.message }, "Failed to fetch provider refunds list during OUTCOME_UNKNOWN check");
      }

      // Check for match by idempotency key (or receipt / notes) and exact amount
      const matchingRefund = providerRefundsList.find((r) => {
        const matchesKey =
          r.notes?.operationId === existingOp.operationId ||
          r.receipt === `RCP-${existingOp.operationId}` ||
          r.id === existingOp.providerOperationId;
        const matchesAmount = r.amount === existingOp.amountPaise;
        return matchesKey && matchesAmount;
      });

      if (matchingRefund) {
        // Adopt provider refund ID and verify
        logger.info(
          { adoptedRefundId: matchingRefund.id, operationId: existingOp.operationId },
          "Adopted existing refund from provider refunds list; verifying status"
        );

        const verifyResult = await verifySandboxRefundStatus({
          gatewayPaymentId: gatewayPayment.gatewayPaymentId,
          refundId: matchingRefund.id,
          expectedAmountPaise: existingOp.amountPaise,
          expectedCurrency: existingOp.currency,
          customFetch
        });

        if (verifyResult.outcome === "VERIFIED_SUCCEEDED") {
          await convertRefundReservation({
            tenantId: cleanTenantId,
            gatewayPaymentId: gatewayPayment.gatewayPaymentId,
            idempotencyKey: serverIdempotencyKey
          });

          const updatedOp = await ProviderOperation.findByIdAndUpdate(
            existingOp._id,
            {
              operationStatus: "VERIFIED_SUCCEEDED",
              providerOperationId: matchingRefund.id,
              verificationEvidence: verifyResult.rawResponse,
              verificationStatus: verifyResult.status,
              verifiedAt: new Date()
            },
            { new: true }
          ).lean();

          await createAuditEvent({
            actorType: "SYSTEM",
            actorId: "provider-dispatch-service",
            action: "PROVIDER_OUTCOME_RECORDED",
            tenantId: cleanTenantId,
            entityType: "ProviderOperation",
            entityId: updatedOp.operationId,
            metadata: {
              operationId: updatedOp.operationId,
              outcome: "VERIFIED_SUCCEEDED",
              adoptedRefundId: matchingRefund.id
            }
          });

          return {
            isDuplicate: true,
            dispatchBlocked: false,
            operation: sanitizeProviderPayload(updatedOp)
          };
        } else if (verifyResult.outcome === "VERIFIED_FAILED") {
          await releaseRefundReservation({
            tenantId: cleanTenantId,
            gatewayPaymentId: gatewayPayment.gatewayPaymentId,
            idempotencyKey: serverIdempotencyKey,
            reason: "VERIFIED_FAILED"
          });

          const updatedOp = await ProviderOperation.findByIdAndUpdate(
            existingOp._id,
            {
              operationStatus: "VERIFIED_FAILED",
              providerOperationId: matchingRefund.id,
              failureReason: verifyResult.failureReason || "Provider reported failure",
              verificationStatus: verifyResult.status,
              verifiedAt: new Date()
            },
            { new: true }
          ).lean();

          await createAuditEvent({
            actorType: "SYSTEM",
            actorId: "provider-dispatch-service",
            action: "PROVIDER_OUTCOME_RECORDED",
            tenantId: cleanTenantId,
            entityType: "ProviderOperation",
            entityId: updatedOp.operationId,
            metadata: {
              operationId: updatedOp.operationId,
              outcome: "VERIFIED_FAILED"
            }
          });

          return {
            isDuplicate: true,
            dispatchBlocked: false,
            operation: sanitizeProviderPayload(updatedOp)
          };
        }
      }

      // No match found in provider refunds list:
      // Keep the same idempotency key on the retry and proceed to dispatch below!
    } else {
      // Terminal states return existing record
      return {
        isDuplicate: true,
        dispatchBlocked: false,
        operation: sanitizeProviderPayload(existingOp)
      };
    }
  }

  // -------------------------------------------------------------------------
  // Step 4: Fresh Provider Read Preflight (B2)
  // -------------------------------------------------------------------------
  const preflight = await performProviderPreflight({
    tenantId: cleanTenantId,
    caseId: cleanCaseId,
    gatewayPaymentId: gatewayPayment.gatewayPaymentId,
    localAmountPaise: gatewayPayment.amountPaise,
    localCurrency: targetCurrency,
    localOrderId: caseDoc.merchantOrderId,
    localRefundedAmountPaise: gatewayPayment.refundAmountPaise || 0,
    reservedRefundPaise: gatewayPayment.reservedRefundPaise || 0,
    customFetch
  });

  if (!preflight.ok) {
    logger.warn(
      { preflightStatus: preflight.status, reason: preflight.reason },
      "Provider preflight check refused operation dispatch"
    );
    return {
      dispatchBlocked: true,
      status: preflight.status,
      reason: preflight.reason,
      details: preflight.details || null
    };
  }

  // -------------------------------------------------------------------------
  // Step 5: Atomic Refund Reservation (B4)
  // -------------------------------------------------------------------------
  const reservationResult = await reserveRefund({
    tenantId: cleanTenantId,
    gatewayPaymentId: gatewayPayment.gatewayPaymentId,
    amountPaise: targetAmountPaise,
    idempotencyKey: serverIdempotencyKey
  });

  if (!reservationResult.success) {
    return {
      dispatchBlocked: true,
      status: "RESERVATION_FAILED",
      reason: reservationResult.reason || "Failed to atomically reserve refund balance"
    };
  }

  // -------------------------------------------------------------------------
  // Step 6: Verify Sandbox Write Gate & Issue PolicyAuthorizationToken (B3)
  // -------------------------------------------------------------------------
  // Throws SandboxGateClosedError if sandbox writes disabled or live mode
  try {
    checkSandboxWriteGate();
  } catch (err) {
    await releaseRefundReservation({
      tenantId: cleanTenantId,
      gatewayPaymentId: gatewayPayment.gatewayPaymentId,
      idempotencyKey: serverIdempotencyKey,
      reason: "SANDBOX_WRITE_GATE_CLOSED"
    });
    throw err;
  }

  // Issue signed PolicyAuthorizationToken
  const { token: authorizationToken, tokenId } = await issuePolicyAuthorizationToken({
    tenantId: cleanTenantId,
    caseId: cleanCaseId,
    policyDecisionId,
    actionType,
    gatewayPaymentId: gatewayPayment.gatewayPaymentId,
    amountPaise: targetAmountPaise,
    currency: targetCurrency,
    idempotencyKey: serverIdempotencyKey,
    policyVersion: policyResult.policyVersion || DEFAULT_POLICY_VERSION,
    ttlSeconds: 120,
    nowMs,
    customSecret
  });

  // -------------------------------------------------------------------------
  // Step 7: Verify PolicyAuthorizationToken Cryptographically (Gate 3)
  // -------------------------------------------------------------------------
  try {
    await verifyPolicyAuthorizationToken({
      token: authorizationToken,
      expectedTenantId: cleanTenantId,
      expectedCaseId: cleanCaseId,
      expectedPaymentId: gatewayPayment.gatewayPaymentId,
      expectedActionType: actionType,
      expectedAmountPaise: targetAmountPaise,
      expectedCurrency: targetCurrency,
      expectedIdempotencyKey: serverIdempotencyKey,
      nowMs,
      customSecret
    });
  } catch (tokenErr) {
    await releaseRefundReservation({
      tenantId: cleanTenantId,
      gatewayPaymentId: gatewayPayment.gatewayPaymentId,
      idempotencyKey: serverIdempotencyKey,
      reason: "TOKEN_VERIFICATION_FAILED"
    });
    throw tokenErr;
  }

  // -------------------------------------------------------------------------
  // Step 8: Persist ProviderOperation (REQUESTED, tokenId Unique: Consumes Token)
  // -------------------------------------------------------------------------
  const operationId = existingOp ? existingOp.operationId : generateOperationId();
  let providerOp;
  if (existingOp) {
    providerOp = await ProviderOperation.findByIdAndUpdate(
      existingOp._id,
      {
        tokenId,
        operationStatus: "REQUESTED",
        requestedAt: new Date()
      },
      { new: true }
    );
  } else {
    try {
      providerOp = await ProviderOperation.create({
        operationId,
        tenantId: cleanTenantId,
        caseId: cleanCaseId,
        tokenId,
        idempotencyKey: serverIdempotencyKey,
        providerIdempotencyKey: serverIdempotencyKey,
        operationType: "REFUND",
        operationStatus: "REQUESTED",
        gatewayPaymentId: gatewayPayment.gatewayPaymentId,
        merchantOrderId: caseDoc.merchantOrderId || null,
        amountPaise: targetAmountPaise,
        currency: targetCurrency,
        provider: "RAZORPAY",
        requestPayloadHash: inputHash,
        policyVersion: policyResult.policyVersion || DEFAULT_POLICY_VERSION,
        requestedAt: new Date()
      });
    } catch (err) {
      if (err.code === 11000) {
        // Collided on concurrent send
        const racedOp = await ProviderOperation.findOne({
          tenantId: cleanTenantId,
          idempotencyKey: serverIdempotencyKey
        }).lean();
        return {
          isDuplicate: true,
          dispatchBlocked: false,
          operation: sanitizeProviderPayload(racedOp)
        };
      }
      await releaseRefundReservation({
        tenantId: cleanTenantId,
        gatewayPaymentId: gatewayPayment.gatewayPaymentId,
        idempotencyKey: serverIdempotencyKey,
        reason: "PROVIDER_OPERATION_INSERT_FAILED"
      });
      throw err;
    }
  }

  // Emit audit log: PROVIDER_DISPATCH_REQUESTED (Fail closed per Part A rules)
  await createAuditEvent({
    actorType: "SYSTEM",
    actorId: "provider-dispatch-service",
    action: "PROVIDER_DISPATCH_REQUESTED",
    tenantId: cleanTenantId,
    entityType: "ProviderOperation",
    entityId: operationId,
    metadata: {
      operationId,
      tokenId,
      gatewayPaymentId: gatewayPayment.gatewayPaymentId,
      amountPaise: targetAmountPaise,
      currency: targetCurrency,
      idempotencyKey: serverIdempotencyKey
    }
  });

  // -------------------------------------------------------------------------
  // Step 9: POST Send (Dispatch Sandbox Operation via Adapter with Token)
  // -------------------------------------------------------------------------
  let dispatchResponse = null;
  let dispatchError = null;

  try {
    dispatchResponse = await executeSandboxRefund({
      authorizationToken,
      tenantId: cleanTenantId,
      caseId: cleanCaseId,
      gatewayPaymentId: gatewayPayment.gatewayPaymentId,
      amountPaise: targetAmountPaise,
      currency: targetCurrency,
      idempotencyKey: serverIdempotencyKey,
      providerIdempotencyKey: serverIdempotencyKey,
      notes: {
        reconaiCaseId: cleanCaseId,
        tenantId: cleanTenantId,
        operationId
      },
      receipt: `RCP-${operationId}`,
      customFetch,
      nowMs,
      customSecret,
      operationId
    });

    await ProviderOperation.findByIdAndUpdate(providerOp._id, {
      dispatchedAt: new Date(),
      providerResponseRaw: dispatchResponse?.rawResponse || null
    });
  } catch (err) {
    dispatchError = err;
    logger.warn({ err: err.message, operationId }, "Error during sandbox provider refund dispatch");
  }

  // If token was rejected by adapter (Gate 3), refuse with typed error
  if (dispatchError && dispatchError instanceof UnauthorizedActionExecutionError) {
    await releaseRefundReservation({
      tenantId: cleanTenantId,
      gatewayPaymentId: gatewayPayment.gatewayPaymentId,
      idempotencyKey: serverIdempotencyKey,
      reason: "UNAUTHORIZED_ACTION_EXECUTION"
    });
    throw dispatchError;
  }

  // -------------------------------------------------------------------------
  // Step 9 & 10: Verify Outcome & Finalize Atomic Reservation (B4 & B6)
  // -------------------------------------------------------------------------
  if (dispatchError) {
    const isTimeoutOrNetworkOrConflict =
      dispatchError instanceof RazorpayProviderError &&
      (dispatchError.code === RAZORPAY_ERROR_CODES.TIMEOUT ||
        dispatchError.code === RAZORPAY_ERROR_CODES.NETWORK_ERROR ||
        dispatchError.code === RAZORPAY_ERROR_CODES.CONFLICT);

    const statusOnDispatchFail = isTimeoutOrNetworkOrConflict ? "OUTCOME_UNKNOWN" : "VERIFIED_FAILED";

    if (statusOnDispatchFail === "VERIFIED_FAILED") {
      await releaseRefundReservation({
        tenantId: cleanTenantId,
        gatewayPaymentId: gatewayPayment.gatewayPaymentId,
        idempotencyKey: serverIdempotencyKey,
        reason: "DISPATCH_FAILED"
      });
    }
    // Note: OUTCOME_UNKNOWN keeps the reservation until resolved!

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

    await createAuditEvent({
      actorType: "SYSTEM",
      actorId: "provider-dispatch-service",
      action: "PROVIDER_OUTCOME_RECORDED",
      tenantId: cleanTenantId,
      entityType: "ProviderOperation",
      entityId: operationId,
      metadata: {
        operationId,
        tokenId,
        outcome: statusOnDispatchFail,
        error: dispatchError.message
      }
    });

    return {
      isDuplicate: false,
      dispatchBlocked: false,
      operation: sanitizeProviderPayload(updatedOp)
    };
  }

  // Independent outcome verification via GET read
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
    await convertRefundReservation({
      tenantId: cleanTenantId,
      gatewayPaymentId: gatewayPayment.gatewayPaymentId,
      idempotencyKey: serverIdempotencyKey
    });
  } else if (verifyResult.outcome === "VERIFIED_FAILED") {
    finalOperationStatus = "VERIFIED_FAILED";
    failureReason = verifyResult.failureReason || "Provider reported refund failed during verification";
    await releaseRefundReservation({
      tenantId: cleanTenantId,
      gatewayPaymentId: gatewayPayment.gatewayPaymentId,
      idempotencyKey: serverIdempotencyKey,
      reason: failureReason
    });
  } else if (verifyResult.outcome === "SAFE_HOLD") {
    finalOperationStatus = "SAFE_HOLD";
    safeHoldReason = verifyResult.safeHoldReason || "Authoritative provider evidence conflicts";
    // Reservation kept in SAFE_HOLD until operator review
  } else {
    finalOperationStatus = "OUTCOME_UNKNOWN";
    // Reservation kept in OUTCOME_UNKNOWN until resolved
  }

  const finalOp = await ProviderOperation.findByIdAndUpdate(
    providerOp._id,
    {
      operationStatus: finalOperationStatus,
      providerOperationId: providerRefundId,
      providerResponseRaw: sanitizeProviderPayload(dispatchResponse.rawResponse),
      verificationEvidence: sanitizeProviderPayload(verifyResult.rawResponse),
      verificationStatus: verifyResult.status,
      safeHoldReason,
      failureReason,
      verifiedAt: new Date()
    },
    { new: true }
  ).lean();

  await createAuditEvent({
    actorType: "SYSTEM",
    actorId: "provider-dispatch-service",
    action: "PROVIDER_OUTCOME_RECORDED",
    tenantId: cleanTenantId,
    entityType: "ProviderOperation",
    entityId: operationId,
    metadata: {
      operationId,
      tokenId,
      outcome: finalOperationStatus,
      providerRefundId
    }
  });

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
