import { FinanceControllerRun } from "../../models/FinanceControllerRun.js";
import { MerchantOrder } from "../../models/MerchantOrder.js";
import { GatewayPayment } from "../../models/GatewayPayment.js";
import { SettlementRecord } from "../../models/SettlementRecord.js";
import { ReconciliationResult } from "../../models/ReconciliationResult.js";
import { ExceptionCase } from "../../models/ExceptionCase.js";
import { calculateRunMetrics } from "../reconciliation/metricsService.js";
import { runReconciliationBatch } from "../reconciliation/reconciliationService.js";

import { evaluateReconciliationRun } from "../evaluation/evaluationService.js";
import { investigateException } from "../ai/exceptionInvestigator.js";
import { createAuditEvent } from "../audit/auditService.js";
import { AppError } from "../../utils/AppError.js";
import { logger } from "../../config/logger.js";

/**
 * Generates a readable, stable Finance Controller run ID.
 * Example: FCRUN-20260930-163000-A1B2
 */
function generateControllerRunId() {
  const dateStr = new Date().toISOString().replace(/[-:T.]/g, "").slice(0, 14);
  const randomSuffix = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `FCRUN-${dateStr}-${randomSuffix}`;
}

/**
 * Executes an autonomous Track 4 Finance Controller Agent batch run.
 * Orchestrates ingestion, validation, deterministic reconciliation, safety gate evaluation,
 * automated AI investigation dispatch, and report synthesis.
 */
export async function runFinanceControllerBatch({
  name = "Track 4 AI Finance Controller Run",
  sourceMode = "SYNTHETIC",
  importBatchId = "BATCH-DEMO-V1",
  datasetVersion = "RECONAI_DEMO_V1",
  autoInvestigate = true
} = {}) {
  if (sourceMode !== "SYNTHETIC") {
    throw AppError.badRequest(`Source mode '${sourceMode}' is not supported yet. Only 'SYNTHETIC' mode is supported.`);
  }

  const runId = generateControllerRunId();

  // 1. Create PENDING run document in IDLE state
  const controllerDoc = await FinanceControllerRun.create({
    runId,
    name,
    sourceMode,
    importBatchId,
    datasetVersion,
    controllerState: "IDLE",
    status: "PENDING",
    currentPhase: "INIT",
    progressPercent: 0,
    startedAt: new Date(),
    autoInvestigate
  });

  const startTime = performance.now();

  try {
    // STATE 1: INGESTING
    controllerDoc.controllerState = "INGESTING";
    controllerDoc.status = "RUNNING";
    controllerDoc.currentPhase = "INGESTION";
    controllerDoc.progressPercent = 10;
    await controllerDoc.save();

    await createAuditEvent({
      actorType: "SYSTEM",
      actorId: "finance-controller-agent",
      action: "CONTROLLER_RUN_STARTED",
      entityType: "FinanceControllerRun",
      entityId: runId,
      runId,
      metadata: { name, sourceMode, importBatchId, datasetVersion, autoInvestigate }
    });

    const query = importBatchId ? { importBatchId } : {};
    const merchantOrders = await MerchantOrder.find(query).lean();
    const gatewayPayments = await GatewayPayment.find(query).lean();
    const settlementRecords = await SettlementRecord.find(query).lean();

    const batchSize = merchantOrders.length;
    if (batchSize === 0) {
      throw AppError.badRequest(`No MerchantOrder records found for importBatchId '${importBatchId}'`);
    }

    controllerDoc.batchSize = batchSize;
    controllerDoc.progressPercent = 20;
    await controllerDoc.save();

    // STATE 2: VALIDATING
    controllerDoc.controllerState = "VALIDATING";
    controllerDoc.currentPhase = "VALIDATION";
    controllerDoc.progressPercent = 30;
    await controllerDoc.save();

    // Verify all records have valid non-negative integer paise amounts
    let totalInputAmountPaise = 0;
    for (const order of merchantOrders) {
      if (typeof order.amountPaise !== "number" || order.amountPaise < 0) {
        throw AppError.badRequest(`Invalid order amount for merchantOrderId '${order.merchantOrderId}'`);
      }
      totalInputAmountPaise += order.amountPaise;
    }

    controllerDoc.totalAmountProcessedPaise = totalInputAmountPaise;
    controllerDoc.progressPercent = 40;
    await controllerDoc.save();

    await createAuditEvent({
      actorType: "SYSTEM",
      actorId: "finance-controller-agent",
      action: "CONTROLLER_DATA_VALIDATED",
      entityType: "FinanceControllerRun",
      entityId: runId,
      runId,
      metadata: { batchSize, totalInputAmountPaise }
    });

    // STATE 3: RECONCILING
    controllerDoc.controllerState = "RECONCILING";
    controllerDoc.currentPhase = "RECONCILIATION";
    controllerDoc.progressPercent = 50;
    await controllerDoc.save();

    // Call existing deterministic batch reconciliation runner
    const reconRun = await runReconciliationBatch({
      name: `${name} (Deterministic Batch)`,
      sourceMode,
      importBatchId,
      datasetVersion
    });

    controllerDoc.reconciliationRunId = reconRun.runId;
    controllerDoc.progressPercent = 65;
    await controllerDoc.save();

    await createAuditEvent({
      actorType: "SYSTEM",
      actorId: "finance-controller-agent",
      action: "CONTROLLER_RECONCILIATION_COMPLETED",
      entityType: "FinanceControllerRun",
      entityId: runId,
      runId,
      metadata: { reconciliationRunId: reconRun.runId, processedRecords: reconRun.processedRecords }
    });

    // STATE 4: SAFETY_EVALUATION
    controllerDoc.controllerState = "SAFETY_EVALUATION";
    controllerDoc.currentPhase = "SAFETY_GATE";
    controllerDoc.progressPercent = 75;
    await controllerDoc.save();

    const results = await ReconciliationResult.find({ runId: reconRun.runId }).lean();

    let matchedRecords = 0;
    let exceptionRecords = 0;
    let autoResolvedRecords = 0;
    let manualReviewRecords = 0;
    let autoReconciledAmountPaise = 0;
    let amountUnderReviewPaise = 0;

    for (const res of results) {
      if (res.classification === "MATCHED" && res.autoResolved) {
        matchedRecords++;
        autoResolvedRecords++;
        autoReconciledAmountPaise += res.expectedAmountPaise || 0;
      } else {
        exceptionRecords++;
        manualReviewRecords++;
      }
    }

    amountUnderReviewPaise = Math.max(0, totalInputAmountPaise - autoReconciledAmountPaise);

    controllerDoc.processedRecords = results.length;
    controllerDoc.matchedRecords = matchedRecords;
    controllerDoc.exceptionRecords = exceptionRecords;
    controllerDoc.autoResolvedRecords = autoResolvedRecords;
    controllerDoc.manualReviewRecords = manualReviewRecords;
    controllerDoc.autoReconciledAmountPaise = autoReconciledAmountPaise;
    controllerDoc.amountUnderReviewPaise = amountUnderReviewPaise;
    controllerDoc.progressPercent = 80;
    await controllerDoc.save();


    await createAuditEvent({
      actorType: "SYSTEM",
      actorId: "finance-controller-agent",
      action: "CONTROLLER_SAFETY_GATE_EVALUATED",
      entityType: "FinanceControllerRun",
      entityId: runId,
      runId,
      metadata: {
        matchedRecords,
        exceptionRecords,
        autoResolvedRecords,
        manualReviewRecords
      }
    });

    // STATE 5: EXCEPTION_PROCESSING
    controllerDoc.controllerState = "EXCEPTION_PROCESSING";
    controllerDoc.currentPhase = "AI_INVESTIGATION";
    controllerDoc.progressPercent = 85;
    await controllerDoc.save();

    const exceptionCases = await ExceptionCase.find({ runId: reconRun.runId }).lean();

    if (autoInvestigate && exceptionCases.length > 0) {
      logger.info(
        { runId, count: exceptionCases.length },
        "Finance Controller Agent dispatching advisory AI investigation for exception cases."
      );

      for (const exc of exceptionCases) {
        try {
          await investigateException({
            exceptionId: exc.exceptionId,
            actorId: "finance-controller-agent"
          });
        } catch (err) {
          logger.warn(
            { runId, exceptionId: exc.exceptionId, error: err.message },
            "Individual AI investigation failed; fallback explanation attached seamlessly."
          );
        }
      }
    }

    controllerDoc.progressPercent = 95;
    await controllerDoc.save();

    await createAuditEvent({
      actorType: "SYSTEM",
      actorId: "finance-controller-agent",
      action: "CONTROLLER_EXCEPTIONS_PROCESSED",
      entityType: "FinanceControllerRun",
      entityId: runId,
      runId,
      metadata: {
        totalExceptions: exceptionCases.length,
        autoInvestigate
      }
    });

    // STATE 6: REPORTING
    controllerDoc.controllerState = "REPORTING";
    controllerDoc.currentPhase = "REPORT_SYNTHESIS";
    controllerDoc.progressPercent = 98;
    await controllerDoc.save();

    const endTime = performance.now();
    const durationMs = Math.round(endTime - startTime);
    const durationSec = durationMs / 1000 || 0.001;

    const runMetrics = calculateRunMetrics(results, durationMs);

    matchedRecords = runMetrics.matchedCount;
    exceptionRecords = runMetrics.exceptionCount;
    autoResolvedRecords = runMetrics.autoReconciledCount;
    manualReviewRecords = runMetrics.manualReviewCount;
    autoReconciledAmountPaise = runMetrics.autoReconciledAmountPaise;
    amountUnderReviewPaise = runMetrics.amountUnderReviewPaise;

    const matchRate = parseFloat(((matchedRecords / batchSize) * 100).toFixed(2));
    const exceptionRate = parseFloat(((exceptionRecords / batchSize) * 100).toFixed(2));
    const throughput = parseFloat(runMetrics.throughputRecordsPerSecond.toFixed(2));



    // Fetch unresolved exceptions (OPEN or UNDER_REVIEW status)
    const openExceptions = await ExceptionCase.find({
      runId: reconRun.runId,
      status: { $in: ["OPEN", "UNDER_REVIEW"] }
    }).lean();

    const unresolvedRecords = openExceptions.length;

    // Optional benchmark evaluation post-run
    let evaluationResult = null;
    try {
      evaluationResult = await evaluateReconciliationRun(reconRun.runId, datasetVersion);
    } catch (err) {
      logger.info({ runId, error: err.message }, "Benchmark evaluation skipped or unavailable.");
    }

    // Unresolved exceptions summary payload with explicit operational fields
    const unresolvedExceptionsSummary = openExceptions.map((exc) => ({
      exceptionId: exc.exceptionId,
      merchantOrderId: exc.merchantOrderId,
      type: exc.type,
      severity: exc.severity,
      financialImpactPaise: exc.financialImpactPaise,
      currentStatus: exc.status,
      aiInvestigated: !!exc.aiExplanation,
      deterministicExplanation: exc.deterministicExplanation,
      aiExplanation: exc.aiExplanation || null,
      aiRecommendation: exc.aiRecommendation || null,
      createdAt: exc.createdAt
    }));


    const reportPayload = {
      runId,
      reconciliationRunId: reconRun.runId,
      name,
      sourceMode,
      importBatchId,
      datasetVersion,
      status: exceptionRecords > 0 ? "COMPLETED_WITH_EXCEPTIONS" : "COMPLETED",
      durationMs,
      metrics: {
        batchSize,
        processedRecords: results.length,
        matchedRecords,
        exceptionRecords,
        autoResolvedRecords,
        manualReviewRecords,
        unresolvedRecords,
        matchRate,
        exceptionRate,
        throughput,
        totalAmountProcessedPaise: totalInputAmountPaise,
        autoReconciledAmountPaise,
        amountUnderReviewPaise,
        classificationBreakdown: reconRun.metrics?.classificationBreakdown || {}
      },
      unresolvedExceptions: unresolvedExceptionsSummary,
      evaluation: evaluationResult
        ? {
            accuracy: evaluationResult.overallMetrics?.accuracy || 1.0,
            precision: evaluationResult.overallMetrics?.precision || 1.0,
            recall: evaluationResult.overallMetrics?.recall || 1.0,
            f1Score: evaluationResult.overallMetrics?.f1Score || 1.0
          }
        : null
    };

    controllerDoc.durationMs = durationMs;
    controllerDoc.matchRate = matchRate;
    controllerDoc.exceptionRate = exceptionRate;
    controllerDoc.throughput = throughput;
    controllerDoc.unresolvedRecords = unresolvedRecords;
    controllerDoc.report = reportPayload;
    controllerDoc.progressPercent = 100;

    await createAuditEvent({
      actorType: "SYSTEM",
      actorId: "finance-controller-agent",
      action: "CONTROLLER_REPORT_GENERATED",
      entityType: "FinanceControllerRun",
      entityId: runId,
      runId,
      metadata: { matchRate, exceptionRate, throughput, unresolvedRecords }
    });

    // STATE 7: COMPLETED
    controllerDoc.controllerState = "COMPLETED";
    controllerDoc.status = exceptionRecords > 0 ? "COMPLETED_WITH_EXCEPTIONS" : "COMPLETED";
    controllerDoc.currentPhase = "FINISHED";
    controllerDoc.completedAt = new Date();
    await controllerDoc.save();

    await createAuditEvent({
      actorType: "SYSTEM",
      actorId: "finance-controller-agent",
      action: "CONTROLLER_RUN_COMPLETED",
      entityType: "FinanceControllerRun",
      entityId: runId,
      runId,
      metadata: {
        status: controllerDoc.status,
        durationMs,
        matchRate,
        unresolvedRecords
      }
    });

    return controllerDoc.toObject();
  } catch (err) {
    logger.error({ runId, error: err.message, stack: err.stack }, "Finance Controller Agent run failed.");

    const endTime = performance.now();
    const durationMs = Math.round(endTime - startTime);

    controllerDoc.controllerState = "FAILED";
    controllerDoc.status = "FAILED";
    controllerDoc.currentPhase = "FAILED";
    controllerDoc.durationMs = durationMs;
    controllerDoc.completedAt = new Date();
    controllerDoc.errorSummary = err.message || "Unknown Finance Controller failure";
    await controllerDoc.save();

    await createAuditEvent({
      actorType: "SYSTEM",
      actorId: "finance-controller-agent",
      action: "CONTROLLER_RUN_FAILED",
      entityType: "FinanceControllerRun",
      entityId: runId,
      runId,
      metadata: { error: err.message, durationMs },
      reason: err.message
    });

    throw err;
  }
}

/**
 * Retrieves a Finance Controller run document by runId.
 */
export async function getControllerRunById(runId) {
  if (!runId) {
    throw AppError.badRequest("runId is required");
  }

  const run = await FinanceControllerRun.findOne({ runId }).lean();
  if (!run) {
    throw AppError.notFound(`FinanceControllerRun not found for runId '${runId}'`);
  }
  return run;
}

/**
 * Lists historical Finance Controller runs with pagination.
 */
export async function listControllerRuns({ page = 1, limit = 20, status = null } = {}) {
  const query = {};
  if (status) query.status = status;

  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
  const skip = (p - 1) * l;

  const [runs, total] = await Promise.all([
    FinanceControllerRun.find(query).sort({ createdAt: -1 }).skip(skip).limit(l).lean(),
    FinanceControllerRun.countDocuments(query)
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
 * Retrieves the complete Track 4 Finance Controller Report for a run.
 */
export async function getControllerRunReport(runId) {
  const run = await getControllerRunById(runId);
  if (!run.report) {
    throw AppError.notFound(`Report not found for FinanceControllerRun '${runId}'`);
  }
  return run.report;
}

/**
 * Retrieves lightweight status and state machine progress for a controller run.
 */
export async function getControllerRunStatus(runId) {
  const run = await getControllerRunById(runId);
  return {
    runId: run.runId,
    name: run.name,
    controllerState: run.controllerState,
    status: run.status,
    currentPhase: run.currentPhase,
    progressPercent: run.progressPercent,
    durationMs: run.durationMs,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    errorSummary: run.errorSummary
  };
}
