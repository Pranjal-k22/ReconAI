import crypto from "crypto";
import { EvidenceRecord } from "../../models/EvidenceRecord.js";
import { PaymentCase } from "../../models/PaymentCase.js";
import { buildClassifierContext, isClassificationStale } from "./classifierContextBuilder.js";
import { classifyPaymentScenario } from "./evidenceClassifier.js";
import { createAuditEvent } from "../audit/auditService.js";
import { sanitizeMetadata } from "../../models/helpers/validators.js";
import { AppError } from "../../utils/AppError.js";
import { logger } from "../../config/logger.js";

/**
 * Strips raw secrets, unredacted credentials, and internal fields from EvidenceRecord output.
 */
export function redactClassificationResponse(record) {
  if (!record) return null;
  const raw = typeof record.toObject === "function" ? record.toObject() : { ...record };

  const doc = {};
  for (const [k, v] of Object.entries(raw)) {
    if (k === "__v") continue;
    if (/secret|apiKey|authKey|internalToken|password|credential/i.test(k)) {
      continue;
    }
    doc[k] = v;
  }

  if (doc.redactedMetadata) {
    doc.redactedMetadata = sanitizeMetadata(doc.redactedMetadata);
  }

  return doc;
}

/**
 * Executes authoritative, database-driven evidence classification for a payment case.
 *
 * Rules:
 * 1. Derives all evidence strictly from database records (B1 builder). No caller evidence.
 * 2. Runs deterministic pure classification.
 * 3. Persists EvidenceRecord with evaluationKey incorporating inputHash.
 * 4. Writes append-only audit event. Fails closed (503 and deletes uncommitted record) if audit fails.
 *
 * @param {Object} params
 * @param {string} params.tenantId - Scoped tenant ID from authenticated principal
 * @param {string} params.caseId - Canonical case identifier
 * @param {Object} params.actor - Authenticated actor performing classification
 * @returns {Promise<{ finding: Object, evidenceRecord: Object, provenance: Object, inputHash: string, isReplay: boolean }>}
 */
export async function classifyCase({ tenantId, caseId, actor }) {
  if (!tenantId || typeof tenantId !== "string" || !tenantId.trim()) {
    throw AppError.badRequest("tenantId is required from authenticated principal");
  }
  if (!caseId || typeof caseId !== "string" || !caseId.trim()) {
    throw AppError.badRequest("caseId is required");
  }

  const cleanTenantId = tenantId.trim();
  const cleanCaseId = caseId.trim();

  // 1. Build authoritative context package from datastores only
  const { context, provenance, inputHash, recordHash, outcome } = await buildClassifierContext({
    tenantId: cleanTenantId,
    caseId: cleanCaseId
  });

  // 2. Deterministic Edge-Case Classification
  const finding = classifyPaymentScenario({
    gatewayPayment: context.gatewayPayment,
    merchantOrder: context.merchantOrder,
    paymentCase: context.paymentCase,
    lifecycleEvents: context.lifecycleEvents,
    settlementRecords: context.settlementRecords,
    customerClaims: context.customerClaims,
    context: context.context
  });

  // 3. Persist EvidenceRecord idempotently with evaluationKey including inputHash
  const evaluationKey = `${cleanCaseId}:${inputHash}`;

  const existingRecord = await EvidenceRecord.findOne({
    tenantId: cleanTenantId,
    caseId: cleanCaseId
  }).sort({ evaluatedAt: -1, createdAt: -1 }).lean();

  let evidenceRecord = null;
  let isReplay = false;

  if (existingRecord) {
    const isStale = isClassificationStale({
      storedRecordHash: existingRecord.recordHash || (existingRecord.evaluationKey ? existingRecord.evaluationKey.split(":")[1] : null),
      storedOutcome: {
        scenarioId: existingRecord.scenarioId,
        safeHoldCode: existingRecord.safeHoldCode,
        reasonCode: existingRecord.reasonCode
      },
      currentRecordHash: recordHash,
      currentOutcome: outcome
    });

    if (!isStale) {
      isReplay = true;
      evidenceRecord = existingRecord;
      logger.info(
        { tenantId: cleanTenantId, caseId: cleanCaseId, evaluationKey, recordId: existingRecord.recordId },
        "Idempotent replay: EvidenceRecord already exists for current inputHash"
      );
    }
  }

  if (!isReplay) {
    const recordId = `EVID-${Date.now()}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    const newRecord = new EvidenceRecord({
      recordId,
      tenantId: cleanTenantId,
      caseId: cleanCaseId,
      merchantOrderId: context.merchantOrder?.merchantOrderId || context.paymentCase?.merchantOrderId || null,
      gatewayPaymentId: context.gatewayPayment?.gatewayPaymentId || context.paymentCase?.gatewayPaymentId || null,
      scenarioId: finding.scenarioId,
      category: finding.category,
      reasonCode: finding.reasonCode,
      ruleId: finding.ruleId,
      confidence: finding.confidence,
      facts: finding.facts,
      claims: finding.claims,
      contradictions: finding.contradictions,
      missingEvidence: finding.missingEvidence,
      safeHold: finding.safeHold,
      safeHoldCode: finding.safeHoldCode,
      safeHoldReason: finding.safeHoldReason,
      recommendation: finding.recommendation,
      suggestedNextStep: finding.suggestedNextStep || "ADVISORY_HOLD_FOR_REVIEW",
      evaluationKey,
      inputHash,
      recordHash,
      provenance,
      supportingEvidence: finding.supportingEvidence,
      explanation: finding.explanation,
      redactedMetadata: finding.redactedMetadata || {},
      evaluatedAt: new Date()
    });

    await newRecord.save();
    evidenceRecord = newRecord.toObject();
  }

  // 4. Fail-Closed Audit Logging: On failure, 503 is returned and uncommitted EvidenceRecord is cleaned up
  try {
    await createAuditEvent({
      tenantId: cleanTenantId,
      action: "EVIDENCE_CLASSIFIED",
      entityType: "PaymentCase",
      entityId: cleanCaseId,
      actorId: actor?.id || actor?.userId || actor?.actorId || "SYSTEM",
      actorType: actor?.role === "ADMIN" ? "HUMAN" : "SYSTEM",
      metadata: {
        recordId: evidenceRecord.recordId,
        scenarioId: evidenceRecord.scenarioId,
        safeHold: evidenceRecord.safeHold,
        safeHoldCode: evidenceRecord.safeHoldCode,
        inputHash,
        isReplay
      }
    });
  } catch (auditErr) {
    logger.error(
      { err: auditErr.message, tenantId: cleanTenantId, caseId: cleanCaseId },
      "Audit logging failed during evidence classification; enforcing fail-closed rollback"
    );

    if (!isReplay && evidenceRecord?._id) {
      try {
        await EvidenceRecord.deleteOne({ _id: evidenceRecord._id });
      } catch (delErr) {
        logger.error({ err: delErr.message }, "Failed to delete orphaned EvidenceRecord after audit failure");
      }
    }

    throw new AppError(
      "Audit ledger write failed during evidence classification; classification aborted",
      503,
      "AUDIT_FAILURE"
    );
  }

  return {
    finding,
    evidenceRecord,
    provenance,
    inputHash,
    isReplay
  };
}

/**
 * Retrieves the latest authoritative classification for a case within tenant boundaries.
 */
export async function getCaseClassification({ tenantId, caseId }) {
  if (!tenantId || !caseId) {
    throw AppError.badRequest("tenantId and caseId are required");
  }

  const cleanTenantId = tenantId.trim();
  const cleanCaseId = caseId.trim();

  // Validate case exists in tenant
  const caseDoc = await PaymentCase.findOne({
    tenantId: cleanTenantId,
    caseId: cleanCaseId
  }).lean();

  if (!caseDoc) {
    throw AppError.notFound(`PaymentCase '${cleanCaseId}' not found in tenant '${cleanTenantId}'`);
  }

  const record = await EvidenceRecord.findOne({
    tenantId: cleanTenantId,
    caseId: cleanCaseId
  })
    .sort({ evaluatedAt: -1 })
    .lean();

  if (!record) {
    throw AppError.notFound(`No classification record found for PaymentCase '${cleanCaseId}'`);
  }

  return record;
}
