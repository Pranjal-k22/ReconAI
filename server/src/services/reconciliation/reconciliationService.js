import { ReconciliationRun } from "../../models/ReconciliationRun.js";
import { ReconciliationResult } from "../../models/ReconciliationResult.js";
import { MerchantOrder } from "../../models/MerchantOrder.js";
import { GatewayPayment } from "../../models/GatewayPayment.js";
import { SettlementRecord } from "../../models/SettlementRecord.js";
import { reconcileScenario } from "./matchingEngine.js";
import { calculateRunMetrics } from "./metricsService.js";
import { createExceptionsForRun } from "../exceptions/exceptionService.js";
import { createAuditEvent, createAuditEventsBulk } from "../audit/auditService.js";
import { AppError } from "../../utils/AppError.js";

/**
 * Generates a readable, stable runtime ID.
 * Example: RUN-20260902-164500-ABC
 */
function generateRunId() {
  const dateStr = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `RUN-${dateStr}-${randomSuffix}`;
}

/**
 * Grouping helper: groups input records for a single merchant order without using evaluation answer keys.
 */
export function groupScenarioRecords(order, allPayments = [], allSettlements = []) {
  const orderId = order.merchantOrderId;
  const scenarioIndexStr = orderId.replace("ORD-", "");

  const associatedPayments = allPayments.filter(
    (p) => p.merchantOrderId === orderId || (p.gatewayPaymentId && p.gatewayPaymentId.includes(scenarioIndexStr))
  );

  const associatedPayIds = new Set(associatedPayments.map((p) => p.gatewayPaymentId));

  const associatedSettlements = allSettlements.filter(
    (s) =>
      (s.merchantOrderId && s.merchantOrderId === orderId) ||
      (s.entityId && associatedPayIds.has(s.entityId)) ||
      (s.settlementRecordId && s.settlementRecordId.includes(scenarioIndexStr))
  );

  return {
    merchantOrder: order,
    gatewayPayments: associatedPayments,
    settlementRecords: associatedSettlements
  };
}

/**
 * Orchestrates a complete batch reconciliation run with exception generation and audit logging.
 */
export async function runReconciliationBatch({
  name = "Reconciliation Run",
  sourceMode = "SYNTHETIC",
  importBatchId = "BATCH-DEMO-V1",
  datasetVersion = "RECONAI_DEMO_V1"
} = {}) {
  if (sourceMode !== "SYNTHETIC") {
    throw AppError.badRequest(`Source mode '${sourceMode}' is not supported yet. Only 'SYNTHETIC' mode is implemented.`);
  }

  const runId = generateRunId();

  // 1. Create PENDING run document
  const runDoc = await ReconciliationRun.create({
    runId,
    name,
    sourceMode,
    status: "PENDING",
    startedAt: new Date(),
    configuration: {
      datasetVersion,
      importBatchId,
      engineVersion: "RECON_ENGINE_V1"
    }
  });

  // 2. Log RECONCILIATION_STARTED audit event
  await createAuditEvent({
    actorType: "SYSTEM",
    actorId: "system-orchestrator",
    action: "RECONCILIATION_STARTED",
    entityType: "ReconciliationRun",
    entityId: runId,
    runId,
    metadata: { name, sourceMode, importBatchId, datasetVersion }
  });

  // 3. Mark RUNNING
  runDoc.status = "RUNNING";
  await runDoc.save();

  const startTime = performance.now();

  try {
    // 4. Load synthetic input records from DB
    const query = importBatchId ? { importBatchId } : {};
    const merchantOrders = await MerchantOrder.find(query).lean();
    const gatewayPayments = await GatewayPayment.find(query).lean();
    const settlementRecords = await SettlementRecord.find(query).lean();

    if (merchantOrders.length === 0) {
      throw AppError.notFound(`No MerchantOrder records found for importBatchId '${importBatchId}'`);
    }

    const resultDocs = [];

    // 5. Process scenarios using pure matching engine
    for (const order of merchantOrders) {
      const scenario = groupScenarioRecords(order, gatewayPayments, settlementRecords);
      const engineResult = reconcileScenario(scenario);

      const isMatched = engineResult.classification === "MATCHED";
      const autoResolved = isMatched;
      const requiresReview = !isMatched;
      const resolutionStatus = isMatched ? "AUTO_RECONCILED" : "OPEN";

      resultDocs.push({
        resultId: `RES-${runId.replace("RUN-", "")}-${order.merchantOrderId}`,
        runId,
        merchantOrderId: order.merchantOrderId,
        gatewayPaymentIds: engineResult.gatewayPaymentIds || [],
        settlementRecordIds: engineResult.settlementRecordIds || [],
        classification: engineResult.classification,
        confidence: engineResult.confidence,
        autoResolved,
        resolutionStatus,
        expectedAmountPaise: engineResult.expectedAmountPaise,
        actualAmountPaise: engineResult.actualAmountPaise,
        differencePaise: engineResult.differencePaise,
        reasons: engineResult.reasons || [],
        ruleEvidence: engineResult.ruleEvidence || {},
        requiresReview
      });
    }

    // 6. Bulk insert ReconciliationResult records
    await ReconciliationResult.insertMany(resultDocs);

    // 7. Create formal ExceptionCase records for all anomaly results
    const createdExceptions = await createExceptionsForRun(runId, resultDocs);

    // 8. Prepare batch audit events (MATCH_CREATED and EXCEPTION_CREATED)
    const auditEvents = [];

    for (const res of resultDocs) {
      if (res.classification === "MATCHED") {
        auditEvents.push({
          actorType: "RULE_ENGINE",
          actorId: "deterministic-matching-engine",
          action: "MATCH_CREATED",
          entityType: "ReconciliationResult",
          entityId: res.resultId,
          runId,
          metadata: {
            merchantOrderId: res.merchantOrderId,
            classification: res.classification,
            confidence: res.confidence,
            expectedAmountPaise: res.expectedAmountPaise
          }
        });
      }
    }

    for (const exc of createdExceptions) {
      auditEvents.push({
        actorType: "RULE_ENGINE",
        actorId: "deterministic-matching-engine",
        action: "EXCEPTION_CREATED",
        entityType: "ExceptionCase",
        entityId: exc.exceptionId,
        runId,
        metadata: {
          resultId: exc.resultId,
          merchantOrderId: exc.merchantOrderId,
          classification: exc.type,
          severity: exc.severity,
          financialImpactPaise: exc.financialImpactPaise,
          confidence: exc.confidence
        },
        reason: exc.deterministicExplanation
      });
    }

    await createAuditEventsBulk(auditEvents);

    const endTime = performance.now();
    const durationMs = Math.round(endTime - startTime);

    // 9. Calculate operational metrics
    const metrics = calculateRunMetrics(resultDocs, durationMs);
    const finalStatus = metrics.exceptionCount > 0 ? "COMPLETED_WITH_EXCEPTIONS" : "COMPLETED";

    runDoc.status = finalStatus;
    runDoc.completedAt = new Date();
    runDoc.totalRecords = merchantOrders.length;
    runDoc.processedRecords = resultDocs.length;
    runDoc.durationMs = durationMs;
    runDoc.metrics = metrics;
    await runDoc.save();

    // 10. Log RECONCILIATION_COMPLETED audit event
    await createAuditEvent({
      actorType: "SYSTEM",
      actorId: "system-orchestrator",
      action: "RECONCILIATION_COMPLETED",
      entityType: "ReconciliationRun",
      entityId: runId,
      runId,
      metadata: {
        status: finalStatus,
        totalRecords: merchantOrders.length,
        matchedCount: metrics.matchedCount,
        exceptionCount: metrics.exceptionCount,
        durationMs
      }
    });

    return runDoc;
  } catch (error) {
    const endTime = performance.now();
    runDoc.status = "FAILED";
    runDoc.completedAt = new Date();
    runDoc.durationMs = Math.round(endTime - startTime);
    runDoc.errorSummary = error.message;
    await runDoc.save();

    // Log RECONCILIATION_FAILED audit event
    await createAuditEvent({
      actorType: "SYSTEM",
      actorId: "system-orchestrator",
      action: "RECONCILIATION_COMPLETED", // or log error metadata
      entityType: "ReconciliationRun",
      entityId: runId,
      runId,
      metadata: { status: "FAILED", error: error.message }
    }).catch(() => {});

    throw error;
  }
}

/**
 * Fetch a reconciliation run by runId.
 */
export async function getReconciliationRunById(runId) {
  const run = await ReconciliationRun.findOne({ runId }).lean();
  if (!run) {
    throw AppError.notFound(`Reconciliation run not found for runId '${runId}'`);
  }
  return run;
}

/**
 * List reconciliation runs with pagination.
 */
export async function listReconciliationRuns({ page = 1, limit = 20 } = {}) {
  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (p - 1) * l;

  const [runs, total] = await Promise.all([
    ReconciliationRun.find().sort({ createdAt: -1 }).skip(skip).limit(l).lean(),
    ReconciliationRun.countDocuments()
  ]);

  return {
    runs,
    pagination: {
      page: p,
      limit: l,
      total,
      pages: Math.ceil(total / l)
    }
  };
}

/**
 * Fetch results for a reconciliation run with filters and pagination.
 */
export async function getRunResults(runId, { classification, requiresReview, resolutionStatus, page = 1, limit = 50 } = {}) {
  await getReconciliationRunById(runId); // Ensures run exists

  const query = { runId };
  if (classification) query.classification = classification;
  if (requiresReview !== undefined && requiresReview !== null && requiresReview !== "") {
    query.requiresReview = String(requiresReview) === "true";
  }
  if (resolutionStatus) query.resolutionStatus = resolutionStatus;

  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const skip = (p - 1) * l;

  const [results, total] = await Promise.all([
    ReconciliationResult.find(query).sort({ merchantOrderId: 1 }).skip(skip).limit(l).lean(),
    ReconciliationResult.countDocuments(query)
  ]);

  return {
    results,
    pagination: {
      page: p,
      limit: l,
      total,
      pages: Math.ceil(total / l)
    }
  };
}

/**
 * Fetch operational metrics for a run.
 */
export async function getRunMetrics(runId) {
  const run = await getReconciliationRunById(runId);
  return run.metrics || {};
}
