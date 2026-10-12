import crypto from "crypto";
import { PolicyDecision } from "../../models/PolicyDecision.js";
import { PaymentCase } from "../../models/PaymentCase.js";
import { GatewayPayment } from "../../models/GatewayPayment.js";
import { MerchantOrder } from "../../models/MerchantOrder.js";
import { EvidenceRecord } from "../../models/EvidenceRecord.js";
import { PaymentLifecycleEvent } from "../../models/PaymentLifecycleEvent.js";
import { PaymentAction } from "../../models/PaymentAction.js";
import { recordProposedAction } from "../ledger/paymentActionService.js";
import { createAuditEvent } from "../audit/auditService.js";
import { evaluateResolutionPolicy, DEFAULT_POLICY_VERSION } from "./resolutionPolicyEvaluator.js";
import { AppError } from "../../utils/AppError.js";
import { logger } from "../../config/logger.js";

/**
 * Generates a stable unique Decision ID.
 * Example: DEC-20261012-A1B2C3D4
 */
export function generateDecisionId() {
  const dateStr = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 8);
  const randStr = crypto.randomBytes(4).toString("hex").toUpperCase();
  return `DEC-${dateStr}-${randStr}`;
}

/**
 * Computes a deterministic SHA-256 hash of the normalized request parameters.
 * Used for strict idempotency checking: identical hash => replay, different hash => conflict.
 */
export function computeInputHash({
  tenantId,
  caseId,
  proposedActionType,
  amountPaise = null,
  currency = "INR",
  policyVersion = DEFAULT_POLICY_VERSION
}) {
  const normalized = JSON.stringify({
    tenantId: String(tenantId).trim(),
    caseId: String(caseId).trim(),
    proposedActionType: String(proposedActionType).trim(),
    amountPaise: amountPaise !== null ? Number(amountPaise) : null,
    currency: String(currency).trim().toUpperCase(),
    policyVersion: String(policyVersion).trim()
  });

  return crypto.createHash("sha256").update(normalized).digest("hex");
}

/**
 * Generates structured dry-run simulation semantics for approved action types.
 * Strictly non-executable: zero mutations on provider or canonical financial records.
 */
export function generateDryRunSimulation({ actionType, policyResult, caseDoc }) {
  const base = {
    actionType,
    simulatedAt: new Date().toISOString(),
    isExecutable: false,
    providerWriteExecuted: false,
    canonicalFinancialMutationExecuted: false,
    dryRun: true
  };

  switch (actionType) {
    case "WAIT_AND_MONITOR":
      return {
        ...base,
        simulatedStep: "MONITORING_WINDOW_SCHEDULED",
        pollingIntervalsSeconds: [60, 300, 900, 1800],
        maxMonitoringWindowMinutes: 60,
        expectedTerminalStates: ["ORDER_PAID", "ORDER_CANCELLED", "PAYMENT_FAILED"]
      };

    case "RECHECK_PROVIDER_STATUS":
    case "POLL_PROVIDER_STATUS":
      return {
        ...base,
        simulatedStep: "PROVIDER_GET_RECHECK_PLANNED",
        readEndpoint: "/v1/payments/:id",
        providerMethod: "GET",
        safetyGuarantee: "READ_ONLY_NO_WRITE"
      };

    case "UPDATE_MERCHANT_LOCAL_LEDGER":
      return {
        ...base,
        simulatedStep: "MERCHANT_ORDER_REPAIR_SIMULATED",
        simulatedNewOrderStatus: "ORDER_PAID",
        currentOrderStatus: caseDoc?.orderStatus || "ORDER_PENDING",
        canonicalMutationsExecuted: 0
      };

    case "REQUEST_REFUND":
    case "SIMULATE_REFUND_CUSTOMER":
      return {
        ...base,
        simulatedStep: "REFUND_DISPATCH_SIMULATED",
        simulatedRefundPaise: policyResult.amountPaise,
        simulatedCurrency: policyResult.currency,
        simulatedOutcome: "REFUND_PROPOSAL_RECORDED",
        providerWriteExecuted: false
      };

    case "SAFE_HOLD":
    case "LOCK_SAFE_HOLD":
      return {
        ...base,
        simulatedStep: "SAFE_HOLD_LOCK_SIMULATED",
        safeHoldCode: "MANUAL_REVIEW_QUARANTINE",
        quarantineScope: "AUTOMATION_FROZEN"
      };

    case "NOTIFY_PARTIES":
      return {
        ...base,
        simulatedStep: "NOTIFICATION_SIMULATED",
        recipients: ["CUSTOMER", "MERCHANT_OPS"],
        notificationChannels: ["EMAIL_SIMULATED", "IN_APP_ALERT_SIMULATED"],
        externalMessagesSent: 0
      };

    case "EXTERNAL_ESCALATION_REQUIRED":
    case "ESCALATE_EXTERNAL_DISPUTE":
      return {
        ...base,
        simulatedStep: "EXTERNAL_ESCALATION_RECORDED",
        targetQueue: "BANK_DISPUTE_AND_REPRESENTMENT_DESK",
        externalPartiesContacted: 0
      };

    default:
      return {
        ...base,
        simulatedStep: "GENERIC_SIMULATION_RECORDED"
      };
  }
}

/**
 * Maps policy evaluation outcome to canonical non-executing PaymentAction status.
 */
function mapOutcomeToPaymentActionStatus(outcomeStatus) {
  switch (outcomeStatus) {
    case "ELIGIBLE_FOR_SIMULATION":
      return "SIMULATED";
    case "SAFE_HOLD":
      return "HELD_IN_SAFE_HOLD";
    case "REJECTED_BY_POLICY":
    case "INSUFFICIENT_EVIDENCE":
      return "REJECTED_BY_POLICY";
    case "PROPOSAL_ONLY":
    default:
      return "PROPOSED";
  }
}

/**
 * Evaluates a proposed resolution action against authoritative server evidence,
 * records the decision, and performs an idempotent local dry-run simulation.
 */
export async function evaluateAndSimulateResolution({
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
  advisoryAiSuggestion = null,
  providedEvidence = null
}) {
  if (!tenantId || typeof tenantId !== "string") {
    throw AppError.badRequest("tenantId is required");
  }
  if (!caseId || typeof caseId !== "string") {
    throw AppError.badRequest("caseId is required");
  }
  if (!proposedActionType || typeof proposedActionType !== "string") {
    throw AppError.badRequest("proposedActionType is required");
  }
  if (!idempotencyKey || typeof idempotencyKey !== "string") {
    throw AppError.badRequest("idempotencyKey is required");
  }

  const inputHash = computeInputHash({
    tenantId,
    caseId,
    proposedActionType,
    amountPaise,
    currency,
    policyVersion
  });

  // 1. Durable Idempotency Verification
  const existingDecision = await PolicyDecision.findOne({
    tenantId: tenantId.trim(),
    idempotencyKey: idempotencyKey.trim()
  }).lean();

  if (existingDecision) {
    if (existingDecision.inputHash === inputHash) {
      logger.info(
        { tenantId, caseId, idempotencyKey, decisionId: existingDecision.decisionId },
        "Idempotent PolicyDecision replay returned without duplicate execution"
      );
      return {
        isDuplicate: true,
        decision: existingDecision
      };
    } else {
      throw AppError.conflict(
        `Idempotency key '${idempotencyKey}' was already used with materially different parameters in tenant '${tenantId}'`
      );
    }
  }

  // 2. Authoritative Evidence Loading
  let authoritativeEvidence = providedEvidence || {};

  const caseDoc = await PaymentCase.findOne({ caseId: caseId.trim(), tenantId: tenantId.trim() }).lean();
  if (!caseDoc && !providedEvidence?.paymentCase) {
    throw AppError.notFound(`PaymentCase '${caseId}' not found in tenant '${tenantId}'`);
  }

  const effectiveCaseDoc = caseDoc || providedEvidence.paymentCase;

  if (!providedEvidence) {
    const [gatewayPayment, merchantOrder, evidenceRecord, inFlightActions, duplicatePayments] = await Promise.all([
      effectiveCaseDoc.gatewayPaymentId
        ? GatewayPayment.findOne({ gatewayPaymentId: effectiveCaseDoc.gatewayPaymentId, tenantId: tenantId.trim() }).lean()
        : null,
      effectiveCaseDoc.merchantOrderId
        ? MerchantOrder.findOne({ merchantOrderId: effectiveCaseDoc.merchantOrderId, tenantId: tenantId.trim() }).lean()
        : null,
      EvidenceRecord.findOne({ tenantId: tenantId.trim(), caseId: caseId.trim() }).sort({ evaluatedAt: -1 }).lean(),
      PaymentAction.find({
        tenantId: tenantId.trim(),
        caseId: caseId.trim(),
        actionType: { $in: ["REQUEST_REFUND", "SIMULATE_REFUND_CUSTOMER"] },
        actionStatus: { $in: ["SIMULATED", "PROPOSED"] }
      }).lean(),
      effectiveCaseDoc.merchantOrderId
        ? GatewayPayment.find({
            tenantId: tenantId.trim(),
            merchantOrderId: effectiveCaseDoc.merchantOrderId
          }).lean()
        : []
    ]);

    const inFlightCommitmentsPaise = (inFlightActions || []).reduce((sum, a) => sum + (a.amountPaise || 0), 0);

    authoritativeEvidence = {
      paymentCase: effectiveCaseDoc,
      gatewayPayment,
      merchantOrder,
      evidenceRecord,
      refundRecords: [],
      settlementRecord: null,
      disputeRecord: null,
      duplicatePayments: duplicatePayments || [],
      inFlightCommitmentsPaise
    };
  }

  // 3. Deterministic Policy Evaluation (Pure Logic)
  const policyResult = evaluateResolutionPolicy({
    tenantId: tenantId.trim(),
    caseId: caseId.trim(),
    actorId,
    actorRole,
    proposedActionType,
    amountPaise,
    currency,
    classificationFinding: authoritativeEvidence.evidenceRecord || null,
    authoritativeEvidence,
    advisoryAiSuggestion,
    policyConfig,
    policyVersion
  });

  // 4. Generate Local Dry-Run Simulation Semantics
  const simulationResult = generateDryRunSimulation({
    actionType: proposedActionType,
    policyResult,
    caseDoc: effectiveCaseDoc
  });

  const decisionId = generateDecisionId();
  const actionStatus = mapOutcomeToPaymentActionStatus(policyResult.outcomeStatus);

  // 5. Record Non-Executing Action Ledger Entry (PaymentAction)
  let recordedAction = null;
  try {
    const actionRecordRes = await recordProposedAction({
      tenantId: tenantId.trim(),
      caseId: caseId.trim(),
      actionType: proposedActionType,
      actionStatus,
      idempotencyKey: idempotencyKey.trim(),
      amountPaise: policyResult.amountPaise,
      currency: policyResult.currency,
      initiatedByActorType: "POLICY_ENGINE",
      initiatedByActorId: actorId || "reconai-policy-engine",
      reasonCode: policyResult.appliedRuleIds[0] || "POLICY_DECISION",
      evidenceReferences: policyResult.approvedEvidenceReferences,
      policyEvaluationResult: {
        decisionId,
        outcomeStatus: policyResult.outcomeStatus,
        appliedRuleIds: policyResult.appliedRuleIds
      },
      metadata: {
        simulationResult
      }
    });

    recordedAction = actionRecordRes.action;
  } catch (err) {
    logger.warn({ err: err.message }, "Error recording PaymentAction ledger entry for simulation");
  }

  // 6. Persist PolicyDecision Document
  let decisionDoc;
  try {
    decisionDoc = await PolicyDecision.create({
      decisionId,
      tenantId: tenantId.trim(),
      caseId: caseId.trim(),
      gatewayPaymentId: effectiveCaseDoc?.gatewayPaymentId || null,
      merchantOrderId: effectiveCaseDoc?.merchantOrderId || null,
      idempotencyKey: idempotencyKey.trim(),
      inputHash,
      policyVersion,
      proposedActionType,
      outcomeStatus: policyResult.outcomeStatus,
      appliedRuleIds: policyResult.appliedRuleIds,
      decisionReasons: policyResult.decisionReasons,
      allowReasons: policyResult.allowReasons,
      denyReasons: policyResult.denyReasons,
      missingEvidence: policyResult.missingEvidence,
      conflicts: policyResult.conflicts,
      approvedEvidenceReferences: policyResult.approvedEvidenceReferences,
      amountPaise: policyResult.amountPaise,
      currency: policyResult.currency,
      actionId: recordedAction ? recordedAction.actionId : null,
      simulationResult,
      checksPerformed: policyResult.checksPerformed,
      isExecutable: false,
      authoritative: false,
      executionState: "NON_EXECUTABLE_SIMULATION"
    });
  } catch (err) {
    if (err.code === 11000) {
      const raceExisting = await PolicyDecision.findOne({
        tenantId: tenantId.trim(),
        idempotencyKey: idempotencyKey.trim()
      }).lean();
      if (raceExisting) {
        if (raceExisting.inputHash === inputHash) {
          return { isDuplicate: true, decision: raceExisting };
        }
        throw AppError.conflict(
          `Idempotency key '${idempotencyKey}' was already used with materially different parameters in tenant '${tenantId}'`
        );
      }
    }
    throw err;
  }

  // 7. Append-Only Audit Trail Logging
  await createAuditEvent({
    actorType: "SYSTEM",
    actorId: actorId || "policy-evaluator",
    action: "CONTROLLER_SAFETY_GATE_EVALUATED",
    entityType: "PolicyDecision",
    entityId: decisionId,
    metadata: {
      tenantId,
      caseId,
      decisionId,
      proposedActionType,
      outcomeStatus: policyResult.outcomeStatus,
      appliedRuleIds: policyResult.appliedRuleIds,
      idempotencyKey
    }
  }).catch(() => {});

  return {
    isDuplicate: false,
    decision: decisionDoc.toObject ? decisionDoc.toObject() : decisionDoc
  };
}

/**
 * Retrieves historical policy decisions for a case, scoped to tenant.
 */
export async function getDecisionsByCaseId(caseId, tenantId) {
  if (!caseId || !tenantId) {
    throw AppError.badRequest("caseId and tenantId are required");
  }
  return await PolicyDecision.find({
    caseId: caseId.trim(),
    tenantId: tenantId.trim()
  })
    .sort({ createdAt: -1 })
    .lean();
}
