import { ExceptionCase } from "../../models/ExceptionCase.js";
import { ReconciliationResult } from "../../models/ReconciliationResult.js";
import { calculateFinancialImpact, calculateSeverity } from "./severityService.js";
import { AppError } from "../../utils/AppError.js";

/**
 * Creates formal ExceptionCase documents for all results requiring review in a run.
 */
export async function createExceptionsForRun(runId, results = []) {
  if (!runId || !Array.isArray(results)) return [];

  const reviewResults = results.filter((r) => r.requiresReview || r.classification !== "MATCHED");
  if (reviewResults.length === 0) return [];

  const exceptionDocs = reviewResults.map((res) => {
    const financialImpactPaise = calculateFinancialImpact(res);
    const severity = calculateSeverity(res.classification, financialImpactPaise);

    const firstReason = (res.reasons && res.reasons.length > 0)
      ? res.reasons[0]
      : `Discrepancy detected during reconciliation matching for ${res.merchantOrderId}.`;

    return {
      exceptionId: `EXC-${runId.replace("RUN-", "")}-${res.merchantOrderId}`,
      runId,
      resultId: res.resultId,
      merchantOrderId: res.merchantOrderId,
      type: res.classification,
      severity,
      confidence: res.confidence,
      financialImpactPaise,
      title: `Exception: ${res.classification} on ${res.merchantOrderId}`,
      deterministicExplanation: firstReason,
      aiExplanation: null,
      aiRecommendation: null,
      aiConfidence: null,
      status: "OPEN",
      humanDecision: "NONE"
    };
  });

  return await ExceptionCase.insertMany(exceptionDocs);
}

/**
 * Retrieves an ExceptionCase by exceptionId along with its associated ReconciliationResult.
 */
export async function getExceptionById(exceptionId) {
  const exc = await ExceptionCase.findOne({ exceptionId }).lean();
  if (!exc) {
    throw AppError.notFound(`ExceptionCase not found for exceptionId '${exceptionId}'`);
  }

  const result = await ReconciliationResult.findOne({ resultId: exc.resultId }).lean();

  return {
    ...exc,
    reconciliationResult: result || null
  };
}

/**
 * Lists ExceptionCase records with filtering and pagination.
 */
export async function listExceptions({
  status,
  type,
  severity,
  runId,
  merchantOrderId,
  page = 1,
  limit = 50
} = {}) {
  const query = {};

  if (status) query.status = status;
  if (type) query.type = type;
  if (severity) query.severity = severity;
  if (runId) query.runId = runId;
  if (merchantOrderId) query.merchantOrderId = merchantOrderId;

  const p = Math.max(1, parseInt(page, 10) || 1);
  const l = Math.min(100, Math.max(1, parseInt(limit, 10) || 50));
  const skip = (p - 1) * l;

  const [exceptions, total] = await Promise.all([
    ExceptionCase.find(query).sort({ createdAt: -1 }).skip(skip).limit(l).lean(),
    ExceptionCase.countDocuments(query)
  ]);

  return {
    exceptions,
    pagination: {
      page: p,
      limit: l,
      total,
      pages: Math.ceil(total / l)
    }
  };
}

/**
 * Computes high-level summary stats for all exceptions.
 */
export async function getExceptionsSummary() {
  const exceptions = await ExceptionCase.find().lean();

  let totalOpen = 0;
  let underReview = 0;
  let resolved = 0;
  let dismissed = 0;
  let openFinancialImpactPaise = 0;

  const bySeverity = { LOW: 0, MEDIUM: 0, HIGH: 0, CRITICAL: 0 };
  const byType = {};

  for (const exc of exceptions) {
    const st = exc.status;
    if (st === "OPEN") totalOpen++;
    else if (st === "UNDER_REVIEW") underReview++;
    else if (st === "RESOLVED") resolved++;
    else if (st === "DISMISSED") dismissed++;

    if (st === "OPEN" || st === "UNDER_REVIEW") {
      openFinancialImpactPaise += (exc.financialImpactPaise || 0);
    }

    if (exc.severity && bySeverity[exc.severity] !== undefined) {
      bySeverity[exc.severity]++;
    }

    if (exc.type) {
      byType[exc.type] = (byType[exc.type] || 0) + 1;
    }
  }

  return {
    totalCount: exceptions.length,
    totalOpen,
    underReview,
    resolved,
    dismissed,
    openFinancialImpactPaise,
    bySeverity,
    byType
  };
}
