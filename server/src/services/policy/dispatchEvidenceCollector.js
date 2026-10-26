import { PaymentCase } from "../../models/PaymentCase.js";
import { GatewayPayment } from "../../models/GatewayPayment.js";
import { MerchantOrder } from "../../models/MerchantOrder.js";
import { EvidenceRecord } from "../../models/EvidenceRecord.js";
import { PaymentAction } from "../../models/PaymentAction.js";
import { ProviderOperation } from "../../models/ProviderOperation.js";
import { AppError } from "../../utils/AppError.js";

/**
 * ReconAI 2.0 - Server-Side Dispatch Evidence Collector
 *
 * Strictly loads and derives authoritative financial evidence by tenantId and caseId
 * from authenticated principal and backend datastores. Never relies on client-supplied data.
 *
 * @param {Object} params
 * @param {string} params.tenantId - Scoped tenant identifier from authenticated principal
 * @param {string} params.caseId - Canonical case identifier from path parameter
 * @returns {Promise<Object>} Authoritative dispatch evidence package
 */
export async function collectDispatchEvidence({ tenantId, caseId }) {
  if (!tenantId || typeof tenantId !== "string" || !tenantId.trim()) {
    throw AppError.badRequest("Authoritative tenantId is required to collect dispatch evidence");
  }
  if (!caseId || typeof caseId !== "string" || !caseId.trim()) {
    throw AppError.badRequest("Canonical caseId is required to collect dispatch evidence");
  }

  const cleanTenantId = tenantId.trim();
  const cleanCaseId = caseId.trim();

  // 1. Authoritative PaymentCase
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

  // 2. Load GatewayPayment, MerchantOrder, EvidenceRecord (Classification finding), in-flight actions, and refund records in parallel
  const [gatewayPayment, merchantOrder, evidenceRecord, inFlightActions, refundOperations] = await Promise.all([
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
    }).sort({ evaluatedAt: -1 }).lean(),
    PaymentAction.find({
      tenantId: cleanTenantId,
      caseId: cleanCaseId,
      actionType: { $in: ["REQUEST_REFUND", "SIMULATE_REFUND_CUSTOMER"] },
      actionStatus: { $in: ["PROPOSED", "IN_FLIGHT"] }
    }).lean(),
    ProviderOperation.find({
      tenantId: cleanTenantId,
      gatewayPaymentId: caseDoc.gatewayPaymentId,
      operationType: "REFUND",
      operationStatus: { $in: ["VERIFIED_SUCCEEDED", "OUTCOME_UNKNOWN", "REQUESTED"] }
    }).lean()
  ]);

  if (!gatewayPayment) {
    throw AppError.notFound(
      `GatewayPayment '${caseDoc.gatewayPaymentId}' not found for tenant '${cleanTenantId}'`
    );
  }

  // Calculate in-flight commitments in paise
  const actionCommitmentsPaise = (inFlightActions || []).reduce((sum, a) => sum + (a.amountPaise || 0), 0);
  const reservedRefundPaise = gatewayPayment.reservedRefundPaise || 0;
  const inFlightCommitmentsPaise = Math.max(actionCommitmentsPaise, reservedRefundPaise);

  return {
    paymentCase: caseDoc,
    gatewayPayment,
    merchantOrder,
    evidenceRecord,
    classificationFinding: evidenceRecord,
    refundRecords: refundOperations || [],
    inFlightActions: inFlightActions || [],
    inFlightCommitmentsPaise,
    settlementRecord: null,
    disputeRecord: null,
    duplicatePayments: []
  };
}
