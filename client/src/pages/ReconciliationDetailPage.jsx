import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, RefreshCw, Filter, ShieldCheck, AlertTriangle } from "lucide-react";
import { getRun, getRunResults, getRunMetrics, getRunEvaluation } from "../api/reconciliationApi";
import { getExceptions } from "../api/exceptionApi";
import { PageHeader } from "../components/common/PageHeader";
import { Card } from "../components/common/Card";
import { Button } from "../components/common/Button";
import { MetricCard } from "../components/common/MetricCard";
import { ClassificationBadge, StatusBadge } from "../components/common/Badge";
import { LoadingState } from "../components/common/LoadingState";
import { ErrorState } from "../components/common/ErrorState";
import { Pagination } from "../components/common/Pagination";
import { formatINRFromPaise, formatPercent } from "../utils/money";
import { formatDate, formatDuration } from "../utils/date";

export default function ReconciliationDetailPage() {
  const { runId } = useParams();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [run, setRun] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [evaluation, setEvaluation] = useState(null);

  const [results, setResults] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, totalRecords: 0, totalPages: 1 });
  const [exceptionMap, setExceptionMap] = useState({});

  // Filter states
  const classificationFilter = searchParams.get("classification") || "";
  const requiresReviewFilter = searchParams.get("requiresReview") || "";
  const resolutionStatusFilter = searchParams.get("resolutionStatus") || "";
  const currentPage = parseInt(searchParams.get("page") || "1", 10);

  const fetchRunDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch metadata, metrics, evaluation in parallel
      const [runRes, metricsRes, evalRes] = await Promise.all([
        getRun(runId),
        getRunMetrics(runId),
        getRunEvaluation(runId).catch(() => null)
      ]);

      setRun(runRes);
      setMetrics(metricsRes);
      setEvaluation(evalRes);

      // 2. Fetch paginated results
      const params = { page: currentPage, limit: 10 };
      if (classificationFilter) params.classification = classificationFilter;
      if (requiresReviewFilter) params.requiresReview = requiresReviewFilter;
      if (resolutionStatusFilter) params.resolutionStatus = resolutionStatusFilter;

      const resultsData = await getRunResults(runId, params);
      setResults(resultsData.results || []);
      setPagination(resultsData.pagination || { page: 1, limit: 10, totalRecords: 0, totalPages: 1 });

      // 3. Fetch associated exception IDs for links
      const excData = await getExceptions({ runId, limit: 100 });
      const excs = excData.exceptions || [];
      const map = {};
      excs.forEach((e) => {
        if (e.merchantOrderId) map[e.merchantOrderId] = e.exceptionId;
      });
      setExceptionMap(map);
    } catch (err) {
      setError(err.message || "Failed to load run details.");
    } finally {
      setLoading(false);
    }
  }, [runId, currentPage, classificationFilter, requiresReviewFilter, resolutionStatusFilter]);

  useEffect(() => {
    fetchRunDetail();
  }, [fetchRunDetail]);

  const updateFilter = (key, value) => {
    const next = new URLSearchParams(searchParams);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    next.set("page", "1");
    setSearchParams(next);
  };

  const clearFilters = () => {
    setSearchParams({});
  };

  if (loading && !run) {
    return <LoadingState message={`Fetching details for run ${runId}...`} />;
  }

  if (error && !run) {
    return <ErrorState message={error} onRetry={fetchRunDetail} />;
  }

  const totalValue = metrics?.totalAmountProcessedPaise ?? null;
  const reviewValue = metrics?.amountUnderReviewPaise ?? null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Run Details: ${runId}`}
        subtitle={run?.runName || "Batch Reconciliation Results"}
        action={
          <div className="flex items-center gap-3">
            <Button variant="outline" icon={ArrowLeft} onClick={() => navigate("/runs")}>
              Back to Runs
            </Button>
            <Button variant="secondary" icon={RefreshCw} onClick={fetchRunDetail}>
              Refresh
            </Button>
          </div>
        }
      />

      {/* Metadata Card */}
      {run && (
        <Card padding="p-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-xs">
            <div>
              <span className="text-slate-500 block">Status</span>
              <div className="mt-1">
                <StatusBadge status={run.status} />
              </div>
            </div>
            <div>
              <span className="text-slate-500 block">Source Mode</span>
              <span className="font-semibold text-slate-800">{run.sourceMode}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Engine Version</span>
              <span className="font-mono text-slate-700">{run.engineVersion || "RECON_ENGINE_V1"}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Dataset Version</span>
              <span className="font-mono text-slate-700">{run.datasetVersion || "RECONAI_DEMO_V1"}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Started</span>
              <span className="font-medium text-slate-800">{formatDate(run.startedAt)}</span>
            </div>
            <div>
              <span className="text-slate-500 block">Duration</span>
              <span className="font-medium text-slate-800">
                {formatDuration(run.executionDurationMs)}
              </span>
            </div>
          </div>
        </Card>
      )}

      {/* Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Processed Records"
          value={metrics?.processedScenarios ?? metrics?.totalScenarios ?? run?.processedRecords ?? 0}
          color="indigo"
        />
        <MetricCard
          title="Auto-Reconciled"
          value={metrics?.autoReconciledCount ?? run?.autoReconciledCount ?? 0}
          color="emerald"
        />
        <MetricCard
          title="Needs Review"
          value={metrics?.manualReviewCount ?? metrics?.exceptionCount ?? run?.needsHumanReviewCount ?? 0}
          color="amber"
        />
        <MetricCard
          title="Auto-Reconciliation Rate"
          value={formatPercent(metrics?.autoReconciliationRate ?? 0)}
          color="blue"
        />
      </div>

      {/* Financial Value Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card padding="p-4">
          <span className="text-xs font-medium uppercase text-slate-500">Value Processed</span>
          <p className="text-xl font-bold text-slate-900 mt-1">{formatINRFromPaise(totalValue)}</p>
        </Card>
        <Card padding="p-4">
          <span className="text-xs font-medium uppercase text-amber-600">Value Under Review</span>
          <p className="text-xl font-bold text-amber-700 mt-1">{formatINRFromPaise(reviewValue)}</p>
        </Card>
      </div>

      {/* Filter Bar */}
      <Card padding="p-4">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 text-slate-500 font-semibold uppercase">
            <Filter className="w-4 h-4" />
            <span>Filters:</span>
          </div>

          {/* Classification Filter */}
          <select
            value={classificationFilter}
            onChange={(e) => updateFilter("classification", e.target.value)}
            className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
          >
            <option value="">All Classifications</option>
            <option value="MATCHED">Matched</option>
            <option value="AMOUNT_MISMATCH">Amount Mismatch</option>
            <option value="MISSING_SETTLEMENT">Missing Settlement</option>
            <option value="DUPLICATE_PAYMENT">Duplicate Payment</option>
            <option value="FEE_MISMATCH">Fee Mismatch</option>
            <option value="REFUND_MISMATCH">Refund Mismatch</option>
            <option value="MISSING_PAYMENT">Missing Payment</option>
            <option value="REFERENCE_MISMATCH">Reference Mismatch</option>
            <option value="AMBIGUOUS">Ambiguous Match</option>
            <option value="INVALID_DATA">Invalid Data</option>
          </select>

          {/* Requires Review Filter */}
          <select
            value={requiresReviewFilter}
            onChange={(e) => updateFilter("requiresReview", e.target.value)}
            className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
          >
            <option value="">All Review States</option>
            <option value="true">Needs Review</option>
            <option value="false">Auto-Reconciled</option>
          </select>

          {/* Resolution Status Filter */}
          <select
            value={resolutionStatusFilter}
            onChange={(e) => updateFilter("resolutionStatus", e.target.value)}
            className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
          >
            <option value="">All Resolution Statuses</option>
            <option value="AUTO_RECONCILED">Auto Reconciled</option>
            <option value="NEEDS_HUMAN_REVIEW">Needs Human Review</option>
            <option value="APPROVED">Approved</option>
            <option value="RESOLVED">Resolved</option>
          </select>

          {(classificationFilter || requiresReviewFilter || resolutionStatusFilter) && (
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              Reset Filters
            </Button>
          )}
        </div>
      </Card>

      {/* Results Table */}
      <Card padding="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold">
                <th className="px-4 py-3">Order ID</th>
                <th className="px-4 py-3">Classification</th>
                <th className="px-4 py-3 text-center">Evidence Confidence</th>
                <th className="px-4 py-3 text-right">Expected Amount</th>
                <th className="px-4 py-3 text-right">Actual Amount</th>
                <th className="px-4 py-3 text-right">Difference</th>
                <th className="px-4 py-3">Resolution</th>
                <th className="px-4 py-3 text-center">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {results.map((res) => {
                const exceptionId = exceptionMap[res.merchantOrderId];
                return (
                  <tr key={res.resultId} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-4 py-3 font-mono font-semibold text-slate-900">
                      {res.merchantOrderId}
                    </td>
                    <td className="px-4 py-3">
                      <ClassificationBadge classification={res.classification} />
                    </td>
                    <td className="px-4 py-3 text-center font-medium">
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-mono font-semibold ${
                          res.confidence >= 0.95
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {formatPercent(res.confidence)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-800">
                      {formatINRFromPaise(res.expectedAmountPaise)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-800">
                      {formatINRFromPaise(res.actualAmountPaise)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-slate-800">
                      {formatINRFromPaise(res.differencePaise)}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={res.resolutionStatus} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      {exceptionId ? (
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={AlertTriangle}
                          onClick={() => navigate(`/exceptions/${exceptionId}`)}
                        >
                          Review
                        </Button>
                      ) : (
                        <span className="text-slate-400 text-[10px] italic">No Exception</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <Pagination
          pagination={pagination}
          onPageChange={(p) => updateFilter("page", p.toString())}
        />
      </Card>
    </div>
  );
}
