import crypto from "crypto";
import { PaymentCase } from "../../models/PaymentCase.js";
import { GatewayPayment } from "../../models/GatewayPayment.js";
import { MerchantOrder } from "../../models/MerchantOrder.js";
import { ProviderOperation } from "../../models/ProviderOperation.js";
import { SettlementRecord } from "../../models/SettlementRecord.js";
import { PaymentLifecycleEvent } from "../../models/PaymentLifecycleEvent.js";
import { PaymentMonitoringTask } from "../../models/PaymentMonitoringTask.js";
import { OrchestrationTask } from "../../models/OrchestrationTask.js";
import { sanitizeClaimText } from "./evidenceClassifier.js";
import { AppError } from "../../utils/AppError.js";

/**
 * Recursively sort object keys to produce a deterministic canonical JSON structure.
 * Normalizes Dates to ISO strings, strips Mongoose internal fields (__v, _id if object).
 */
export function canonicalizeContext(val) {
  if (val === null || val === undefined) {
    return null;
  }
  if (val instanceof Date) {
    return val.toISOString();
  }
  if (typeof val !== "object") {
    return val;
  }
  if (Array.isArray(val)) {
    return val.map(canonicalizeContext);
  }
  const sorted = {};
  for (const key of Object.keys(val).sort()) {
    // Omit internal mongoose version keys
    if (key === "__v") continue;
    sorted[key] = canonicalizeContext(val[key]);
  }
  return sorted;
}

/**
 * Computes deterministic SHA-256 hash over canonical context.
 */
export function computeClassifierInputHash(context) {
  const canonical = canonicalizeContext(context);
  return crypto.createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/**
 * Builds deterministic, database-driven classification context strictly within tenant boundaries.
 *
 * Rules:
 * 1. tenantId is derived solely from the authenticated principal.
 * 2. No caller-supplied request-body evidence is accepted.
 * 3. Free text (order notes, descriptions, customer comments) is stored ONLY in an inert claims list;
 *    never copied into decision flags or boolean predicates.
 * 4. Missing records remain undefined/null; never defaulted to values that select a scenario.
 * 5. Returns { context, provenance, inputHash }.
 *
 * @param {Object} params
 * @param {string} params.tenantId - Scoped tenant ID from authenticated principal
 * @param {string} params.caseId - Case ID to build context for
 * @returns {Promise<{ context: Object, provenance: Object, inputHash: string }>}
 */
export async function buildClassifierContext({ tenantId, caseId }) {
  if (!tenantId || typeof tenantId !== "string" || !tenantId.trim()) {
    throw AppError.badRequest("Authoritative tenantId is required to build classifier context");
  }
  if (!caseId || typeof caseId !== "string" || !caseId.trim()) {
    throw AppError.badRequest("caseId is required to build classifier context");
  }

  const cleanTenantId = tenantId.trim();
  const cleanCaseId = caseId.trim();

  // 1. Load Authoritative PaymentCase
  const caseDoc = await PaymentCase.findOne({
    tenantId: cleanTenantId,
    caseId: cleanCaseId
  }).lean();

  if (!caseDoc) {
    throw AppError.notFound(`PaymentCase '${cleanCaseId}' not found in tenant '${cleanTenantId}'`);
  }

  // 2. Load Related Entities Tenant-Scoped in Parallel
  const paymentQuery = caseDoc.gatewayPaymentId
    ? GatewayPayment.findOne({ tenantId: cleanTenantId, gatewayPaymentId: caseDoc.gatewayPaymentId }).lean()
    : null;

  const orderQuery = caseDoc.merchantOrderId
    ? MerchantOrder.findOne({ tenantId: cleanTenantId, merchantOrderId: caseDoc.merchantOrderId }).lean()
    : null;

  const duplicatePaymentsQuery = caseDoc.merchantOrderId
    ? GatewayPayment.find({ tenantId: cleanTenantId, merchantOrderId: caseDoc.merchantOrderId }).lean()
    : [];

  const refundRecordsQuery = caseDoc.gatewayPaymentId
    ? ProviderOperation.find({
        tenantId: cleanTenantId,
        gatewayPaymentId: caseDoc.gatewayPaymentId,
        operationType: "REFUND"
      }).lean()
    : [];

  const settlementRecordsQuery = SettlementRecord.find({
    tenantId: cleanTenantId,
    $or: [
      ...(caseDoc.gatewayPaymentId ? [{ gatewayPaymentId: caseDoc.gatewayPaymentId }] : []),
      ...(caseDoc.merchantOrderId ? [{ merchantOrderId: caseDoc.merchantOrderId }] : [])
    ]
  }).lean();

  const lifecycleEventsQuery = PaymentLifecycleEvent.find({
    tenantId: cleanTenantId,
    $or: [
      { caseId: cleanCaseId },
      ...(caseDoc.gatewayPaymentId ? [{ gatewayPaymentId: caseDoc.gatewayPaymentId }] : []),
      ...(caseDoc.merchantOrderId ? [{ merchantOrderId: caseDoc.merchantOrderId }] : [])
    ]
  }).sort({ occurredAt: 1 }).lean();

  const monitoringTasksQuery = PaymentMonitoringTask.find({
    tenantId: cleanTenantId,
    caseId: cleanCaseId
  }).lean();

  const orchestrationTasksQuery = OrchestrationTask.find({
    tenantId: cleanTenantId,
    caseId: cleanCaseId
  }).lean();

  const [
    gatewayPayment,
    merchantOrder,
    duplicatePayments,
    refundRecords,
    settlementRecords,
    lifecycleEvents,
    monitoringTasks,
    orchestrationTasks
  ] = await Promise.all([
    paymentQuery,
    orderQuery,
    duplicatePaymentsQuery,
    refundRecordsQuery,
    settlementRecordsQuery,
    lifecycleEventsQuery,
    monitoringTasksQuery,
    orchestrationTasksQuery
  ]);

  // 3. Inert Claims Extraction: Free text is strictly treated as inert claims, NEVER decision flags
  const inertClaims = [];
  const customerClaims = [];

  const rawOrderNotes = merchantOrder?.notes || merchantOrder?.metadata?.notes;
  if (rawOrderNotes) {
    inertClaims.push({
      claimType: "MERCHANT_ORDER_NOTE",
      statement: sanitizeClaimText(typeof rawOrderNotes === "string" ? rawOrderNotes : JSON.stringify(rawOrderNotes)),
      source: "MERCHANT_ORDER",
      authority: "SHOP_STATEMENT",
      verified: false
    });
  }

  const rawPaymentNotes = gatewayPayment?.notes || gatewayPayment?.rawData?.notes;
  if (rawPaymentNotes) {
    const notesStr = typeof rawPaymentNotes === "string"
      ? rawPaymentNotes
      : JSON.stringify(rawPaymentNotes);
    inertClaims.push({
      claimType: "GATEWAY_PAYMENT_NOTE",
      statement: sanitizeClaimText(notesStr),
      source: "GATEWAY_PAYMENT",
      authority: "CUSTOMER_CLAIM",
      verified: false
    });
  }

  if (
    caseDoc.customerDebitStatus === "DEBIT_REPORTED" ||
    caseDoc.customerDebitStatus === "DEBIT_VERIFIED" ||
    caseDoc.customerDebitStatus === "DEBIT_FAILED"
  ) {
    customerClaims.push({
      claimId: `CLM-${caseDoc.caseId}`,
      claimType: caseDoc.customerDebitStatus === "DEBIT_FAILED" ? "CUSTOMER_DEBIT_FAILED" : "CUSTOMER_DEBIT_CLAIM",
      statement: sanitizeClaimText(caseDoc.safeHoldReason || "Customer debit claim recorded"),
      source: "CUSTOMER_PORTAL",
      authority: "CUSTOMER_CLAIM",
      receivedAt: caseDoc.createdAt || new Date(),
      verified: false
    });
  }

  // 4. Safe Derived Operational Flags (computed purely from verified database fields)
  const capturedPayments = (duplicatePayments || []).filter((p) => p.status === "CAPTURED");
  const hasDuplicateAttempts = duplicatePayments && duplicatePayments.length > 1;
  const amountsDiffer = hasDuplicateAttempts && duplicatePayments.some(
    (p) => typeof p.amountPaise === "number" && p.amountPaise !== duplicatePayments[0].amountPaise
  );

  let elapsedHoursSincePayment = 0;
  if (gatewayPayment?.createdAt) {
    elapsedHoursSincePayment = Math.max(
      0,
      Math.floor((Date.now() - new Date(gatewayPayment.createdAt).getTime()) / (1000 * 60 * 60))
    );
  }

  const isCaptured = gatewayPayment?.status === "CAPTURED";
  const missingSettlementOverdue = isCaptured &&
    (!settlementRecords || settlementRecords.length === 0) &&
    elapsedHoursSincePayment > 120;

  const delayedSettlement = isCaptured &&
    (!settlementRecords || settlementRecords.length === 0 || settlementRecords[0].status === "PENDING") &&
    elapsedHoursSincePayment <= 72;

  const duplicateSettlement = Boolean(
    settlementRecords &&
    settlementRecords.length > 1 &&
    settlementRecords[0].settlementId &&
    settlementRecords[0].settlementId === settlementRecords[1].settlementId
  );

  const refundPending = (refundRecords || []).some((r) => r.operationStatus === "REQUESTED") ||
    gatewayPayment?.refundStatus === "PENDING";

  const refundFailed = (refundRecords || []).some((r) => r.operationStatus === "FAILED" || r.operationStatus === "VERIFIED_FAILED") ||
    gatewayPayment?.refundStatus === "FAILED";

  const refundAmt = gatewayPayment?.amountRefundedPaise || gatewayPayment?.refundAmountPaise || 0;
  const partialRefund = Boolean(refundAmt > 0);

  const authorizedAmt = gatewayPayment?.amountAuthorizedPaise ?? gatewayPayment?.amountPaise;
  const capturedAmt = gatewayPayment?.amountCapturedPaise ?? gatewayPayment?.capturedAmountPaise;
  const partialCapture = Boolean(
    gatewayPayment?.status === "PARTIALLY_CAPTURED" ||
    (typeof authorizedAmt === "number" &&
      typeof capturedAmt === "number" &&
      capturedAmt < authorizedAmt)
  );

  const isPollEvent = (lifecycleEvents || []).some(
    (e) => e.sourceSystem === "GATEWAY_API_POLL" || e.normalizedEventType === "GATEWAY_API_POLL"
  );

  const isLeaseExpired =
    caseDoc.resolutionCaseStatus === "CASE_ACTION_IN_PROGRESS" &&
    caseDoc.actionLeaseExpiresAt &&
    new Date(caseDoc.actionLeaseExpiresAt) < new Date();

  const leaseRenewalCount = caseDoc.metadata?.leaseRenewalCount || 0;

  const formalDispute =
    caseDoc.disputeStatus === "DISPUTE_FORMAL_CHARGEBACK" ||
    Boolean(gatewayPayment?.dispute);

  // Runtime context containing ONLY derived facts from backend datastores
  const runtimeContext = {
    tenantId: cleanTenantId,
    actorTenantId: cleanTenantId,
    duplicatePaymentAttempts: hasDuplicateAttempts,
    capturedPayments,
    amountsDiffer,
    elapsedHoursSincePayment,
    missingSettlementOverdue,
    delayedSettlement,
    duplicateSettlement,
    refundPending,
    refundFailed,
    refundStatus: gatewayPayment?.refundStatus || null,
    partialRefund,
    partialCapture,
    pollResult: isPollEvent,
    source: isPollEvent ? "GATEWAY_API_POLL" : null,
    workerCrashedLeaseExpired: isLeaseExpired,
    leaseRenewalCount,
    formalDispute
  };

  // 5. Build Provenance Record Mapping
  const provenance = {
    paymentCase: { collection: "paymentcases", documentId: String(caseDoc._id) },
    gatewayPayment: gatewayPayment ? { collection: "gatewaypayments", documentId: String(gatewayPayment._id) } : null,
    merchantOrder: merchantOrder ? { collection: "merchantorders", documentId: String(merchantOrder._id) } : null,
    duplicatePayments: (duplicatePayments || []).map((p) => ({ collection: "gatewaypayments", documentId: String(p._id) })),
    refundRecords: (refundRecords || []).map((r) => ({ collection: "provideroperations", documentId: String(r._id) })),
    settlementRecords: (settlementRecords || []).map((s) => ({ collection: "settlementrecords", documentId: String(s._id) })),
    lifecycleEvents: (lifecycleEvents || []).map((e) => ({ collection: "paymentlifecycleevents", documentId: String(e._id) })),
    monitoringTasks: (monitoringTasks || []).map((t) => ({ collection: "paymentmonitoringtasks", documentId: String(t._id) })),
    orchestrationTasks: (orchestrationTasks || []).map((t) => ({ collection: "orchestrationtasks", documentId: String(t._id) }))
  };

  // 6. Assemble Full Classification Context Package
  const contextPackage = {
    gatewayPayment,
    merchantOrder,
    paymentCase: caseDoc,
    lifecycleEvents: lifecycleEvents || [],
    settlementRecords: settlementRecords || [],
    customerClaims,
    claims: inertClaims,
    inertClaims,
    context: runtimeContext
  };

  // 7. Compute Canonical Input Hash
  const inputHash = computeClassifierInputHash(contextPackage);

  return {
    context: contextPackage,
    provenance,
    inputHash
  };
}
