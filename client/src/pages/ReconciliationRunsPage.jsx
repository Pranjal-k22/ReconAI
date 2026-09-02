import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { GitCompareArrows, Eye, RefreshCw, Play } from "lucide-react";
import { getRuns, createRun } from "../api/reconciliationApi";
import { PageHeader } from "../components/common/PageHeader";
import { Card } from "../components/common/Card";
import { Button } from "../components/common/Button";
import { StatusBadge } from "../components/common/Badge";
import { LoadingState } from "../components/common/LoadingState";
import { ErrorState } from "../components/common/ErrorState";
import { EmptyState } from "../components/common/EmptyState";
import { Pagination } from "../components/common/Pagination";
import { formatDate, formatDuration } from "../utils/date";
import { useToast } from "../components/common/ToastContext";

export default function ReconciliationRunsPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  const [runs, setRuns] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, totalRecords: 0, totalPages: 1 });

  const fetchRuns = useCallback(async (page = 1) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getRuns({ page, limit: 10 });
      setRuns(data.runs || []);
      setPagination(data.pagination || { page: 1, limit: 10, totalRecords: 0, totalPages: 1 });
    } catch (err) {
      setError(err.message || "Failed to load reconciliation runs.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchRuns(1);
  }, [fetchRuns]);

  const handleRunDemo = async () => {
    setRunning(true);
    try {
      const result = await createRun({
        name: "ReconAI Demo Benchmark",
        sourceMode: "SYNTHETIC"
      });
      addToast(`Reconciliation run created! ID: ${result.runId}`, "success");
      await fetchRuns(1);
    } catch (err) {
      addToast(err.message || "Failed to launch run.", "error");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reconciliation Runs"
        subtitle="Batch execution history of rules engine reconciliation runs."
        action={
          <div className="flex items-center gap-3">
            <Button variant="secondary" icon={RefreshCw} onClick={() => fetchRuns(pagination.page)}>
              Refresh
            </Button>
            <Button variant="primary" icon={Play} loading={running} onClick={handleRunDemo}>
              New Reconciliation Run
            </Button>
          </div>
        }
      />

      <Card padding="p-0">
        {loading ? (
          <LoadingState message="Fetching reconciliation runs..." />
        ) : error ? (
          <ErrorState message={error} onRetry={() => fetchRuns(pagination.page)} />
        ) : runs.length === 0 ? (
          <EmptyState
            title="No Reconciliation Runs Found"
            description="No batch runs have been recorded in MongoDB yet."
            icon={GitCompareArrows}
            actionLabel="Run Demo Reconciliation"
            onAction={handleRunDemo}
          />
        ) : (
          <div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold">
                    <th className="px-4 py-3">Run ID</th>
                    <th className="px-4 py-3">Name / Source</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Processed</th>
                    <th className="px-4 py-3 text-right">Auto-Reconciled</th>
                    <th className="px-4 py-3 text-right">Exceptions</th>
                    <th className="px-4 py-3 text-right">Duration</th>
                    <th className="px-4 py-3">Created At</th>
                    <th className="px-4 py-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {runs.map((run) => (
                    <tr key={run.runId} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3 font-mono font-semibold text-slate-900">
                        {run.runId}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{run.runName || "Recon Run"}</div>
                        <div className="text-[10px] text-slate-500">{run.sourceMode}</div>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={run.status} />
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-800">
                        {run.processedRecords}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-emerald-600">
                        {run.autoReconciledCount}
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-amber-600">
                        {run.needsHumanReviewCount}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600 font-mono">
                        {formatDuration(run.executionDurationMs)}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{formatDate(run.startedAt)}</td>
                      <td className="px-4 py-3 text-center">
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Eye}
                          onClick={() => navigate(`/runs/${run.runId}`)}
                        >
                          Details
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination pagination={pagination} onPageChange={(p) => fetchRuns(p)} />
          </div>
        )}
      </Card>
    </div>
  );
}
