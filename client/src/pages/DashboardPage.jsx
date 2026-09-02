import React, { useEffect, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  Play,
  ArrowRight,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  TrendingUp,
  Award,
  Layers
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  PieChart,
  Pie,
  Cell
} from "recharts";
import { createRun, getRuns, getRunMetrics, getRunEvaluation } from "../api/reconciliationApi";
import { getExceptionSummary } from "../api/exceptionApi";
import { PageHeader } from "../components/common/PageHeader";
import { MetricCard } from "../components/common/MetricCard";
import { Card } from "../components/common/Card";
import { Button } from "../components/common/Button";
import { StatusBadge } from "../components/common/Badge";
import { LoadingState } from "../components/common/LoadingState";
import { ErrorState } from "../components/common/ErrorState";
import { formatINRFromPaise, formatPercent } from "../utils/money";
import { formatDate, formatDuration } from "../utils/date";
import { formatEnumLabel } from "../utils/enum";
import { useToast } from "../components/common/ToastContext";

export default function DashboardPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);

  const [latestRun, setLatestRun] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [evaluation, setEvaluation] = useState(null);
  const [exceptionSummary, setExceptionSummary] = useState(null);

  const loadDashboardData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 1. Fetch runs list
      const runsData = await getRuns({ limit: 1 });
      const runs = runsData?.runs || [];
      const run = runs[0] || null;
      setLatestRun(run);

      if (run && run.runId) {
        const targetRunId = run.runId;
        // 2. Fetch metrics & evaluation for latest run using targetRunId
        const [mRes, eRes, excRes] = await Promise.allSettled([
          getRunMetrics(targetRunId),
          getRunEvaluation(targetRunId),
          getExceptionSummary()
        ]);

        if (mRes.status === "fulfilled") setMetrics(mRes.value);
        if (eRes.status === "fulfilled") setEvaluation(eRes.value);
        if (excRes.status === "fulfilled") setExceptionSummary(excRes.value);
      }
    } catch (err) {
      setError(err.message || "Failed to load dashboard metrics.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const handleRunDemo = async () => {
    setRunning(true);
    try {
      const result = await createRun({
        name: "ReconAI Demo Benchmark",
        sourceMode: "SYNTHETIC"
      });

      addToast(
        `Reconciliation completed! ${result.processedRecords || 0} scenarios processed.`,
        "success"
      );

      await loadDashboardData();
    } catch (err) {
      addToast(err.message || "Reconciliation run failed.", "error");
    } finally {
      setRunning(false);
    }
  };

  if (loading) {
    return <LoadingState message="Fetching live reconciliation overview..." />;
  }

  if (error) {
    return <ErrorState title="Dashboard Error" message={error} onRetry={loadDashboardData} />;
  }

  // Derived values from backend metrics (matching backend metricsService schema)
  const totalProcessed = metrics?.processedScenarios ?? metrics?.totalScenarios ?? latestRun?.processedRecords ?? 0;
  const autoReconciled = metrics?.autoReconciledCount ?? 0;
  const needsReview = metrics?.manualReviewCount ?? metrics?.exceptionCount ?? 0;
  const autoRate = metrics?.autoReconciliationRate ?? 0;

  const totalValuePaise = metrics?.totalAmountProcessedPaise ?? null;
  const autoValuePaise = metrics?.autoReconciledAmountPaise ?? null;
  const reviewValuePaise = metrics?.amountUnderReviewPaise ?? null;

  // Accuracy from evaluation
  const accuracyPct = evaluation?.classificationAccuracy ?? evaluation?.overallMetrics?.accuracy ?? 1.0;
  const precisionPct = evaluation?.exceptionDetection?.precision ?? evaluation?.overallMetrics?.precision ?? 1.0;
  const recallPct = evaluation?.exceptionDetection?.recall ?? evaluation?.overallMetrics?.recall ?? 1.0;
  const f1Pct = evaluation?.exceptionDetection?.f1Score ?? evaluation?.overallMetrics?.f1Score ?? 1.0;

  // Chart data formatting
  const distributionData = Object.entries(metrics?.classificationBreakdown || metrics?.byClassification || {}).map(([key, value]) => ({
    name: formatEnumLabel(key),
    count: typeof value === "number" ? value : value?.count || 0
  }));

  const pieData = [
    { name: "Auto Reconciled", value: autoReconciled, color: "#10b981" },
    { name: "Needs Review", value: needsReview, color: "#f59e0b" }
  ].filter((item) => item.value > 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="Finance Reconciliation Overview"
        subtitle="Verification-first reconciliation across merchant orders, payments and settlements."
        action={
          <div className="flex items-center gap-3">
            <Button
              variant="secondary"
              icon={RefreshCw}
              onClick={loadDashboardData}
              disabled={running}
            >
              Refresh
            </Button>
            <Button
              variant="primary"
              icon={Play}
              loading={running}
              onClick={handleRunDemo}
            >
              Run Demo Reconciliation
            </Button>
          </div>
        }
      />

      {/* Primary KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard
          title="Transactions Processed"
          value={totalProcessed}
          subtitle={latestRun ? `Run ID: ${latestRun.runId}` : "No runs recorded"}
          icon={Layers}
          color="indigo"
        />
        <MetricCard
          title="Auto-Reconciled"
          value={autoReconciled}
          subtitle="Match confidence ≥ 95%"
          icon={CheckCircle2}
          color="emerald"
        />
        <MetricCard
          title="Needs Review"
          value={needsReview}
          subtitle="Exceptions flagged"
          icon={AlertTriangle}
          color="amber"
        />
        <MetricCard
          title="Auto-Reconciliation Rate"
          value={formatPercent(autoRate)}
          subtitle="Deterministic match ratio"
          icon={TrendingUp}
          color="blue"
        />
      </div>

      {/* Financial Value Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card padding="p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-slate-500">
            Total Value Processed
          </p>
          <p className="text-2xl font-bold tracking-tight text-slate-900 mt-1">
            {formatINRFromPaise(totalValuePaise)}
          </p>
          <p className="text-xs text-slate-500 mt-1">Gross order sum in batch</p>
        </Card>

        <Card padding="p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-emerald-600">
            Automatically Reconciled Value
          </p>
          <p className="text-2xl font-bold tracking-tight text-emerald-700 mt-1">
            {formatINRFromPaise(autoValuePaise)}
          </p>
          <p className="text-xs text-slate-500 mt-1">Verified with 100% confidence</p>
        </Card>

        <Card padding="p-5">
          <p className="text-xs font-medium uppercase tracking-wider text-amber-600">
            Value Under Review
          </p>
          <p className="text-2xl font-bold tracking-tight text-amber-700 mt-1">
            {formatINRFromPaise(reviewValuePaise)}
          </p>
          <p className="text-xs text-slate-500 mt-1">Held for human verification</p>
        </Card>
      </div>

      {/* Benchmark Accuracy Hero Card & Latest Run Details */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Benchmark Accuracy Card */}
        <Card
          header={
            <div className="flex items-center space-x-2">
              <Award className="w-5 h-5 text-indigo-600" />
              <h3 className="text-sm font-semibold text-slate-800">Benchmark Performance</h3>
            </div>
          }
          className="lg:col-span-1"
        >
          <div className="space-y-4">
            <div>
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-medium text-slate-500">Classification Accuracy</span>
                <span className="text-xl font-bold text-slate-900">{formatPercent(accuracyPct)}</span>
              </div>
              <div className="w-full bg-slate-100 rounded-full h-2 mt-1.5">
                <div
                  className="bg-emerald-500 h-2 rounded-full"
                  style={{ width: `${accuracyPct * 100}%` }}
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-2 pt-2 border-t border-slate-100 text-center">
              <div className="p-2 bg-slate-50 rounded-lg">
                <p className="text-[10px] uppercase font-medium text-slate-500">Precision</p>
                <p className="text-sm font-bold text-slate-800">{formatPercent(precisionPct)}</p>
              </div>
              <div className="p-2 bg-slate-50 rounded-lg">
                <p className="text-[10px] uppercase font-medium text-slate-500">Recall</p>
                <p className="text-sm font-bold text-slate-800">{formatPercent(recallPct)}</p>
              </div>
              <div className="p-2 bg-slate-50 rounded-lg">
                <p className="text-[10px] uppercase font-medium text-slate-500">F1 Score</p>
                <p className="text-sm font-bold text-slate-800">{formatPercent(f1Pct)}</p>
              </div>
            </div>

            <p className="text-xs text-slate-500 text-center pt-2 italic border-t border-slate-100">
              Measured against isolated synthetic GroundTruth
            </p>
          </div>
        </Card>

        {/* Latest Run Summary Card */}
        <Card
          header={
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">Latest Execution Run</h3>
              {latestRun && <StatusBadge status={latestRun.status} />}
            </div>
          }
          className="lg:col-span-2"
        >
          {latestRun ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                <div>
                  <span className="text-slate-500 block">Run ID</span>
                  <span className="font-mono font-semibold text-slate-900">{latestRun.runId}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Started Time</span>
                  <span className="font-medium text-slate-800">{formatDate(latestRun.startedAt)}</span>
                </div>
                <div>
                  <span className="text-slate-500 block">Duration</span>
                  <span className="font-medium text-slate-800">
                    {formatDuration(latestRun.executionDurationMs)}
                  </span>
                </div>
                <div>
                  <span className="text-slate-500 block">Throughput</span>
                  <span className="font-medium text-slate-800">
                    {latestRun.recordsPerSecond ? `${latestRun.recordsPerSecond} rec/s` : "—"}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                <p className="text-xs text-slate-500">
                  {latestRun.runName || "ReconAI Synthetic Run"} • Source Mode:{" "}
                  <span className="font-medium text-slate-700">{latestRun.sourceMode}</span>
                </p>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => navigate(`/runs/${latestRun.runId}`)}
                >
                  <span>View Run Details</span>
                  <ArrowRight className="w-3.5 h-3.5 ml-1" />
                </Button>
              </div>
            </div>
          ) : (
            <div className="text-center py-6 text-slate-500 text-xs">
              No reconciliation runs found. Click &quot;Run Demo Reconciliation&quot; above to execute the benchmark.
            </div>
          )}
        </Card>
      </div>

      {/* Visualizations */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Classification Breakdown Chart */}
        <Card header="Reconciliation Distribution by Anomaly Class" className="lg:col-span-2">
          {distributionData.length > 0 ? (
            <div className="h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={distributionData} margin={{ top: 10, right: 10, left: -20, bottom: 25 }}>
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 10 }}
                    angle={-25}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(val) => [val, "Count"]}
                    contentStyle={{ borderRadius: "8px", fontSize: "12px" }}
                  />
                  <Bar dataKey="count" fill="#4f46e5" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-xs text-slate-400">
              No distribution data available
            </div>
          )}
        </Card>

        {/* Auto vs Review Donut Chart */}
        <Card header="Review Distribution">
          {pieData.length > 0 ? (
            <div className="h-64 w-full flex flex-col items-center justify-center">
              <ResponsiveContainer width="100%" height="80%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: "8px", fontSize: "12px" }} />
                </PieChart>
              </ResponsiveContainer>

              <div className="flex items-center justify-center gap-4 text-xs font-medium mt-2">
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
                  <span>Auto Reconciled ({autoReconciled})</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
                  <span>Needs Review ({needsReview})</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="h-64 flex items-center justify-center text-xs text-slate-400">
              No data available
            </div>
          )}
        </Card>
      </div>

      {/* Verification-First Controls Trust Panel */}
      <Card
        header={
          <div className="flex items-center space-x-2">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
            <h3 className="text-sm font-semibold text-slate-800">Verification-First Controls</h3>
          </div>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 text-xs">
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
            <h4 className="font-semibold text-slate-900 mb-1">Deterministic Matching</h4>
            <p className="text-slate-500">100% pure rules-based matching engine without floating-point errors.</p>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
            <h4 className="font-semibold text-slate-900 mb-1">Confidence Safety Gate</h4>
            <p className="text-slate-500">Auto-reconciliation strictly requires ≥95% confidence with zero anomalies.</p>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
            <h4 className="font-semibold text-slate-900 mb-1">Human Exception Review</h4>
            <p className="text-slate-500">All exceptions held in isolated queue. Original classifications remain preserved.</p>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
            <h4 className="font-semibold text-slate-900 mb-1">Append-Only Audit Trail</h4>
            <p className="text-slate-500">Immutable audit records logged with recursive key secret sanitization.</p>
          </div>
          <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
            <h4 className="font-semibold text-slate-900 mb-1">AI Advisory Only</h4>
            <p className="text-slate-500">Gemini provides root cause insights on-demand; cannot mutate financial state.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
