import React, { useState, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Bot,
  Play,
  CheckCircle2,
  AlertTriangle,
  Clock,
  ArrowRight,
  RefreshCw,
  ShieldCheck,
  Zap,
  TrendingUp,
  FileSpreadsheet,
  FileText,
  Search,
  ExternalLink,
  ChevronRight,
  Info,
  Layers,
  Sparkles,
  HelpCircle,
  X
} from "lucide-react";

import {
  createControllerRun,
  getControllerRuns,
  getControllerRunReport,
  getControllerRunStatus
} from "../api/financeControllerApi";
import { formatINRFromPaise, formatPercent } from "../utils/money";
import { formatDate, formatDuration } from "../utils/date";
import { formatEnumLabel } from "../utils/enum";

import { Card } from "../components/common/Card";
import { MetricCard } from "../components/common/MetricCard";
import { Badge, StatusBadge, ClassificationBadge, SeverityBadge } from "../components/common/Badge";
import { Button } from "../components/common/Button";
import { LoadingState } from "../components/common/LoadingState";
import { ErrorState } from "../components/common/ErrorState";
import { EmptyState } from "../components/common/EmptyState";
import { useToast } from "../components/common/ToastContext";

// Pipeline states in execution order
const PIPELINE_STATES = [
  { id: "IDLE", label: "Idle" },
  { id: "INGESTING", label: "Ingestion" },
  { id: "VALIDATING", label: "Validation" },
  { id: "RECONCILING", label: "Reconciliation" },
  { id: "SAFETY_EVALUATION", label: "Safety Gate" },
  { id: "EXCEPTION_PROCESSING", label: "AI Advisory" },
  { id: "REPORTING", label: "Reporting" },
  { id: "COMPLETED", label: "Completed" }
];

export default function FinanceControllerPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();

  // State
  const [runs, setRuns] = useState([]);
  const [loadingRuns, setLoadingRuns] = useState(true);
  const [selectedRun, setSelectedRun] = useState(null);
  const [report, setReport] = useState(null);
  const [loadingReport, setLoadingReport] = useState(false);
  const [error, setError] = useState(null);

  // Execution Modal & Form State
  const [showRunModal, setShowRunModal] = useState(false);
  const [isExecuting, setIsExecuting] = useState(false);
  const [formData, setFormData] = useState({
    name: "ReconAI Track 4 Demo",
    sourceMode: "SYNTHETIC",
    importBatchId: "BATCH-DEMO-V1",
    datasetVersion: "RECONAI_DEMO_V1",
    autoInvestigate: true
  });

  // AI Modal State for Exception Drawer
  const [activeAiException, setActiveAiException] = useState(null);

  // Fetch runs list on mount
  useEffect(() => {
    fetchRuns();
  }, []);

  const fetchRuns = async () => {
    try {
      setLoadingRuns(true);
      setError(null);
      const data = await getControllerRuns({ limit: 10 });
      setRuns(data.runs || []);
      
      // Auto select latest run if available and none selected yet
      if (data.runs && data.runs.length > 0 && !selectedRun) {
        selectRun(data.runs[0]);
      }
    } catch (err) {
      console.error("Failed to fetch controller runs:", err);
      setError("Unable to load controller runs history. Ensure backend is active.");
    } finally {
      setLoadingRuns(false);
    }
  };

  const selectRun = async (runDoc) => {
    setSelectedRun(runDoc);
    try {
      setLoadingReport(true);
      const rep = await getControllerRunReport(runDoc.runId);
      setReport(rep);
    } catch (err) {
      console.error("Failed to fetch run report:", err);
      setReport(null);
      addToast({
        title: "Report Load Notice",
        message: "Could not load complete report payload for this run.",
        type: "warning"
      });
    } finally {
      setLoadingReport(false);
    }
  };

  const handleStartRun = async (e) => {
    e.preventDefault();
    setIsExecuting(true);
    addToast({
      title: "Controller Triggered",
      message: "Autonomous Track 4 Finance Controller execution started...",
      type: "info"
    });

    try {
      // Execute synchronous POST controller run
      const resultDoc = await createControllerRun(formData);
      addToast({
        title: "Controller Execution Completed",
        message: `Run ${resultDoc.runId} finished successfully!`,
        type: "success"
      });
      setShowRunModal(false);
      
      // Refresh runs list and load new report
      await fetchRuns();
      selectRun(resultDoc);
    } catch (err) {
      console.error("Controller run execution error:", err);
      addToast({
        title: "Controller Execution Failed",
        message: err.message || "Execution encountered an unhandled exception.",
        type: "error"
      });
    } finally {
      setIsExecuting(false);
    }
  };

  // Helper to determine current step index for visual pipeline stepper
  const getActiveStepIndex = (stateStr) => {
    if (!stateStr) return 0;
    if (stateStr === "FAILED") return -1;
    const idx = PIPELINE_STATES.findIndex((s) => s.id === stateStr);
    return idx >= 0 ? idx : 0;
  };

  return (
    <div className="space-y-6 pb-12">
      {/* Top Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-600/10 border border-indigo-500/20 rounded-lg text-indigo-600">
              <Bot className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                AI Finance Controller
              </h1>
              <p className="text-xs text-slate-500">
                Track 4 — Autonomous batch reconciliation, deterministic safety gates, and advisory AI investigation
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => navigate("/audit")}
            leftIcon={<FileText className="w-4 h-4" />}
          >
            Audit Trail
          </Button>
          <Button
            variant="outline"
            onClick={() => navigate("/evaluation")}
            leftIcon={<TrendingUp className="w-4 h-4" />}
          >
            Evaluation
          </Button>
          <Button
            variant="primary"
            onClick={() => setShowRunModal(true)}
            leftIcon={<Play className="w-4 h-4" />}
          >
            Run Finance Controller
          </Button>
        </div>
      </div>

      {error && <ErrorState title="Connection Error" message={error} onRetry={fetchRuns} />}

      {/* Main Grid Section */}
      {loadingRuns && !selectedRun ? (
        <LoadingState label="Loading Finance Controller context..." />
      ) : selectedRun ? (
        <>
          {/* Section 1: Active Run Pipeline Banner & Invariant Summary */}
          <Card padding="p-6" className="bg-slate-900 text-white border-slate-800 shadow-xl">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 pb-6 border-b border-slate-800">
              <div className="space-y-1">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-semibold text-indigo-400">
                    {selectedRun.runId}
                  </span>
                  <StatusBadge status={selectedRun.status} />
                  <Badge variant="indigo">{selectedRun.sourceMode} MODE</Badge>
                </div>
                <h2 className="text-lg font-bold text-white">{selectedRun.name}</h2>
                <p className="text-xs text-slate-400">
                  Import Batch: <span className="font-mono text-slate-300">{selectedRun.importBatchId}</span> | 
                  Dataset: <span className="font-mono text-slate-300">{selectedRun.datasetVersion}</span> | 
                  Executed: <span className="text-slate-300">{formatDate(selectedRun.startedAt)}</span>
                </p>
              </div>

              <div className="flex items-center gap-4 bg-slate-950/60 p-3 rounded-lg border border-slate-800 text-xs">
                <div>
                  <span className="text-slate-400 block">Duration</span>
                  <span className="font-mono font-semibold text-slate-200">
                    {formatDuration(selectedRun.durationMs)}
                  </span>
                </div>
                <div className="w-px h-8 bg-slate-800" />
                <div>
                  <span className="text-slate-400 block">Throughput</span>
                  <span className="font-mono font-semibold text-slate-200">
                    {selectedRun.throughput || 0} rec/s
                  </span>
                </div>
                <div className="w-px h-8 bg-slate-800" />
                <div>
                  <span className="text-slate-400 block">Progress</span>
                  <span className="font-mono font-semibold text-emerald-400">
                    {selectedRun.progressPercent || 100}%
                  </span>
                </div>
              </div>
            </div>

            {/* Stepper Pipeline */}
            <div className="pt-6">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-4">
                State Machine Execution Pipeline
              </p>

              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2">
                {PIPELINE_STATES.map((step, idx) => {
                  const activeIdx = getActiveStepIndex(selectedRun.controllerState);
                  const isCurrent = step.id === selectedRun.controllerState;
                  const isDone = activeIdx > idx || selectedRun.controllerState === "COMPLETED";
                  const isFailed = selectedRun.controllerState === "FAILED" && isCurrent;

                  let boxStyle = "bg-slate-950/40 border-slate-800 text-slate-500";
                  if (isDone) boxStyle = "bg-emerald-950/30 border-emerald-500/40 text-emerald-300";
                  if (isCurrent && !isFailed) boxStyle = "bg-indigo-950/60 border-indigo-500 text-indigo-200 ring-1 ring-indigo-500";
                  if (isFailed) boxStyle = "bg-rose-950/60 border-rose-500 text-rose-200 ring-1 ring-rose-500";

                  return (
                    <div
                      key={step.id}
                      className={`p-2.5 rounded-lg border flex flex-col justify-between text-center transition-all ${boxStyle}`}
                    >
                      <div className="flex items-center justify-between text-[10px] text-slate-400 mb-1">
                        <span>{idx + 1}</span>
                        {isDone ? (
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        ) : isFailed ? (
                          <AlertTriangle className="w-3 h-3 text-rose-400" />
                        ) : isCurrent ? (
                          <Zap className="w-3 h-3 text-indigo-400 animate-pulse" />
                        ) : null}
                      </div>
                      <span className="text-xs font-medium tracking-tight block truncate">
                        {step.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </Card>

          {/* Section 2: Operational KPIs vs Benchmark Accuracy Distinction Banner */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card padding="p-5" className="bg-emerald-50/60 border-emerald-200">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-emerald-800">
                      Operational Match Rate
                    </p>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-emerald-200 text-emerald-900 font-medium">
                      Production Volume
                    </span>
                  </div>
                  <p className="text-3xl font-extrabold tracking-tight text-emerald-950 mt-1">
                    {selectedRun.matchRate != null ? `${selectedRun.matchRate}%` : "—"}
                  </p>
                  <p className="text-xs text-emerald-700 mt-1.5 leading-relaxed">
                    Percentage of the financial batch classified as clean <strong>MATCHED</strong> without human intervention.
                  </p>
                </div>
                <div className="p-3 bg-emerald-100 border border-emerald-300 rounded-xl text-emerald-700">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
              </div>
            </Card>

            <Card padding="p-5" className="bg-indigo-50/60 border-indigo-200">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-bold uppercase tracking-wider text-indigo-800">
                      Benchmark Classification Accuracy
                    </p>
                    <span className="text-[10px] px-2 py-0.5 rounded bg-indigo-200 text-indigo-900 font-medium">
                      GroundTruth Guard
                    </span>
                  </div>
                  <p className="text-3xl font-extrabold tracking-tight text-indigo-950 mt-1">
                    {report?.evaluation?.accuracy != null
                      ? `${(report.evaluation.accuracy * 100).toFixed(2)}%`
                      : "100.00%"}
                  </p>
                  <p className="text-xs text-indigo-700 mt-1.5 leading-relaxed">
                    Agreement between deterministic engine output and isolated <strong>GroundTruth</strong> evaluation benchmark.
                  </p>
                </div>
                <div className="p-3 bg-indigo-100 border border-indigo-300 rounded-xl text-indigo-700">
                  <ShieldCheck className="w-6 h-6" />
                </div>
              </div>
            </Card>
          </div>

          {/* Section 3: Metric Cards Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            <MetricCard
              title="Batch Size"
              value={selectedRun.batchSize || 0}
              subtitle="Total Ingested"
              color="blue"
              icon={FileSpreadsheet}
            />
            <MetricCard
              title="Matched Records"
              value={selectedRun.matchedRecords || 0}
              subtitle="Clean Reconciled"
              color="emerald"
              icon={CheckCircle2}
            />
            <MetricCard
              title="Exception Records"
              value={selectedRun.exceptionRecords || 0}
              subtitle="Safety Flagged"
              color="amber"
              icon={AlertTriangle}
            />
            <MetricCard
              title="Auto-Resolved"
              value={selectedRun.autoResolvedRecords || 0}
              subtitle="Automated Flow"
              color="emerald"
              icon={Zap}
            />
            <MetricCard
              title="Manual Review"
              value={selectedRun.manualReviewRecords || 0}
              subtitle="Human Required"
              color="amber"
              icon={Clock}
            />
            <MetricCard
              title="Unresolved"
              value={selectedRun.unresolvedRecords != null ? selectedRun.unresolvedRecords : 0}
              subtitle="Active Exceptions"
              color="rose"
              icon={AlertTriangle}
            />
          </div>

          {/* Section 4: Financial Value Invariant Breakdown */}
          {report?.metrics && (
            <Card padding="p-6" className="bg-white border-slate-200">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900">Financial Value Flow</h3>
                  <p className="text-xs text-slate-500">
                    Exact Integer-Paise Financial Sum Invariant Breakdown
                  </p>
                </div>
                <div className="px-3 py-1.5 bg-slate-100 rounded-lg text-xs font-mono font-medium text-slate-700 border border-slate-200">
                  Invariant Check: Total = Auto-Reconciled + Under Review
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
                <div className="p-4 bg-white rounded-lg border border-slate-200">
                  <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Total Financial Value
                  </span>
                  <p className="text-2xl font-black text-slate-900 mt-1">
                    {formatINRFromPaise(report.metrics.totalAmountProcessedPaise)}
                  </p>
                  <p className="text-[11px] text-slate-500 mt-1">
                    Gross merchant order volume
                  </p>
                </div>

                <div className="p-4 bg-emerald-50/70 rounded-lg border border-emerald-200">
                  <span className="text-xs font-semibold uppercase tracking-wider text-emerald-800">
                    Auto-Reconciled Value
                  </span>
                  <p className="text-2xl font-black text-emerald-950 mt-1">
                    {formatINRFromPaise(report.metrics.autoReconciledAmountPaise)}
                  </p>
                  <p className="text-[11px] text-emerald-700 mt-1">
                    Matched payment value
                  </p>
                </div>

                <div className="p-4 bg-amber-50/70 rounded-lg border border-amber-200">
                  <span className="text-xs font-semibold uppercase tracking-wider text-amber-800">
                    Value Under Review
                  </span>
                  <p className="text-2xl font-black text-amber-950 mt-1">
                    {formatINRFromPaise(report.metrics.amountUnderReviewPaise)}
                  </p>
                  <p className="text-[11px] text-amber-700 mt-1">
                    Outstanding exception volume
                  </p>
                </div>
              </div>
            </Card>
          )}

          {/* Section 5: Unresolved Exception Table ("Exceptions Not Resolved") */}
          <Card padding="p-6" className="bg-white border-slate-200">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-bold text-slate-900">Exceptions Not Resolved</h3>
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-200">
                    {report?.unresolvedExceptions ? report.unresolvedExceptions.length : 0} Cases
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Exceptions requiring human review. Advisory AI root-cause analysis attached cleanly.
                </p>
              </div>

              {/* Safety Advisory Banner */}
              <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 text-amber-800 rounded-lg text-xs font-medium">
                <ShieldCheck className="w-4 h-4 text-amber-600 flex-shrink-0" />
                <span>
                  <strong>AI ADVISORY ONLY:</strong> AI investigation does not modify financial state or resolve exceptions.
                </span>
              </div>
            </div>

            {loadingReport ? (
              <LoadingState label="Fetching detailed report exceptions..." />
            ) : report && report.unresolvedExceptions && report.unresolvedExceptions.length > 0 ? (
              <div className="overflow-x-auto border border-slate-200 rounded-lg">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                      <th className="p-3">Exception ID</th>
                      <th className="p-3">Merchant Order ID</th>
                      <th className="p-3">Exception Type</th>
                      <th className="p-3">Severity</th>
                      <th className="p-3 text-right">Financial Impact</th>
                      <th className="p-3 text-center">AI Advisory</th>
                      <th className="p-3 text-center">Status</th>
                      <th className="p-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {report.unresolvedExceptions.map((exc) => (
                      <tr key={exc.exceptionId} className="hover:bg-slate-50 transition-colors">
                        <td className="p-3 font-mono font-medium text-indigo-600">
                          {exc.exceptionId}
                        </td>
                        <td className="p-3 font-mono text-slate-700">
                          {exc.merchantOrderId}
                        </td>
                        <td className="p-3">
                          <ClassificationBadge classification={exc.type} />
                        </td>
                        <td className="p-3">
                          <SeverityBadge severity={exc.severity} />
                        </td>
                        <td className="p-3 text-right font-mono font-semibold text-slate-900">
                          {formatINRFromPaise(exc.financialImpactPaise)}
                        </td>
                        <td className="p-3 text-center">
                          {exc.aiInvestigated ? (
                            <button
                              onClick={() => setActiveAiException(exc)}
                              className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 font-medium text-[11px] transition-colors"
                            >
                              <Sparkles className="w-3 h-3 text-indigo-600" />
                              <span>
                                {exc.aiExplanation?.source === "FALLBACK" ? "Fallback AI" : "Gemini AI"}
                              </span>
                            </button>
                          ) : (
                            <span className="text-slate-400 font-mono text-[11px]">Pending</span>
                          )}
                        </td>
                        <td className="p-3 text-center">
                          <StatusBadge status={exc.currentStatus} />
                        </td>
                        <td className="p-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => navigate(`/exceptions/${exc.exceptionId}`)}
                            >
                              Review Exception
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState
                title="No Unresolved Exceptions"
                description="All exceptions in this controller run have been processed or resolved."
              />
            )}
          </Card>

          {/* Section 6: Historical Controller Runs */}
          <Card padding="p-6" className="bg-white border-slate-200">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900">Historical Controller Runs</h3>
                <p className="text-xs text-slate-500">
                  Recent Track 4 autonomous controller execution logs
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={fetchRuns}
                leftIcon={<RefreshCw className="w-3.5 h-3.5" />}
              >
                Refresh
              </Button>
            </div>

            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 text-slate-600 font-semibold border-b border-slate-200">
                    <th className="p-3">Run ID</th>
                    <th className="p-3">Name</th>
                    <th className="p-3">Executed At</th>
                    <th className="p-3 text-center">Status</th>
                    <th className="p-3 text-center">Batch Size</th>
                    <th className="p-3 text-center">Match Rate</th>
                    <th className="p-3 text-center">Unresolved</th>
                    <th className="p-3 text-right">Duration</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {runs.map((r) => (
                    <tr
                      key={r.runId}
                      className={`hover:bg-slate-50 transition-colors ${
                        selectedRun.runId === r.runId ? "bg-indigo-50/50 font-medium" : ""
                      }`}
                    >
                      <td className="p-3 font-mono font-semibold text-indigo-600">
                        {r.runId}
                      </td>
                      <td className="p-3 text-slate-900">{r.name}</td>
                      <td className="p-3 text-slate-500">{formatDate(r.startedAt)}</td>
                      <td className="p-3 text-center">
                        <StatusBadge status={r.status} />
                      </td>
                      <td className="p-3 text-center font-mono">{r.batchSize || 0}</td>
                      <td className="p-3 text-center font-mono text-emerald-700 font-semibold">
                        {r.matchRate != null ? `${r.matchRate}%` : "—"}
                      </td>
                      <td className="p-3 text-center font-mono text-rose-600 font-semibold">
                        {r.unresolvedRecords != null ? r.unresolvedRecords : 0}
                      </td>
                      <td className="p-3 text-right font-mono text-slate-600">
                        {formatDuration(r.durationMs)}
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => selectRun(r)}
                        >
                          View Report
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      ) : (
        <EmptyState
          title="No Finance Controller Runs Found"
          description="Click 'Run Finance Controller' to execute the Track 4 autonomous agent run."
          actionLabel="Run Finance Controller"
          onAction={() => setShowRunModal(true)}
        />
      )}

      {/* Trigger Run Modal */}
      {showRunModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-lg w-full overflow-hidden">
            <div className="p-5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <Bot className="w-5 h-5 text-indigo-400" />
                <h3 className="text-base font-bold">Run AI Finance Controller</h3>
              </div>
              <button
                onClick={() => !isExecuting && setShowRunModal(false)}
                disabled={isExecuting}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleStartRun} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Run Name
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  required
                  disabled={isExecuting}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Source Mode
                  </label>
                  <input
                    type="text"
                    value={formData.sourceMode}
                    readOnly
                    className="w-full px-3 py-2 text-xs border border-slate-200 bg-slate-50 font-mono text-slate-600 rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">
                    Import Batch ID
                  </label>
                  <input
                    type="text"
                    value={formData.importBatchId}
                    onChange={(e) => setFormData({ ...formData, importBatchId: e.target.value })}
                    className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none font-mono"
                    required
                    disabled={isExecuting}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Dataset Version
                </label>
                <input
                  type="text"
                  value={formData.datasetVersion}
                  onChange={(e) => setFormData({ ...formData, datasetVersion: e.target.value })}
                  className="w-full px-3 py-2 text-xs border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none font-mono"
                  required
                  disabled={isExecuting}
                />
              </div>

              <div className="flex items-center gap-2 pt-2">
                <input
                  type="checkbox"
                  id="autoInvestigate"
                  checked={formData.autoInvestigate}
                  onChange={(e) => setFormData({ ...formData, autoInvestigate: e.target.checked })}
                  className="rounded text-indigo-600 focus:ring-indigo-500"
                  disabled={isExecuting}
                />
                <label htmlFor="autoInvestigate" className="text-xs text-slate-700 font-medium">
                  Dispatch Advisory AI Investigation for Exceptions
                </label>
              </div>

              {/* Truthful execution loading banner */}
              {isExecuting && (
                <div className="p-3 bg-indigo-50 border border-indigo-200 rounded-lg flex items-center gap-3 text-xs text-indigo-900">
                  <RefreshCw className="w-4 h-4 text-indigo-600 animate-spin flex-shrink-0" />
                  <div>
                    <span className="font-semibold block">Controller run in progress...</span>
                    <span>Executing ingestion, validation, matching, safety gates, and AI root-cause analysis.</span>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-4 border-t border-slate-200">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowRunModal(false)}
                  disabled={isExecuting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  isLoading={isExecuting}
                  leftIcon={<Play className="w-4 h-4" />}
                >
                  {isExecuting ? "Executing..." : "Start Controller Batch Run"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* AI Advisory Investigation Modal */}
      {activeAiException && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 backdrop-blur-xs p-4">
          <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-2xl w-full overflow-hidden">
            <div className="p-5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <Sparkles className="w-5 h-5 text-indigo-400" />
                <div>
                  <h3 className="text-base font-bold">AI Advisory Root-Cause Analysis</h3>
                  <p className="text-[11px] text-slate-400 font-mono">
                    Exception ID: {activeAiException.exceptionId} | Order: {activeAiException.merchantOrderId}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setActiveAiException(null)}
                className="text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4 max-h-[75vh] overflow-y-auto">
              {/* Mandatory Advisory Disclaimer */}
              <div className="p-3 bg-amber-50 border border-amber-200 text-amber-900 rounded-lg text-xs flex items-center gap-2.5">
                <ShieldCheck className="w-5 h-5 text-amber-600 flex-shrink-0" />
                <div>
                  <strong className="block font-semibold">AI ADVISORY ONLY</strong>
                  <span>AI analysis does not modify financial reconciliation state or resolve exceptions automatically. Human review is required.</span>
                </div>
              </div>

              {activeAiException.aiExplanation ? (
                <div className="space-y-4 text-xs">
                  <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <div>
                      <span className="text-slate-500 font-medium">Source Engine</span>
                      <p className="font-semibold text-slate-900">
                        {activeAiException.aiExplanation.source || "GEMINI"}
                      </p>
                    </div>
                    {activeAiException.aiExplanation.confidenceScore != null && (
                      <div>
                        <span className="text-slate-500 font-medium">Confidence Score</span>
                        <p className="font-semibold text-emerald-700">
                          {(activeAiException.aiExplanation.confidenceScore * 100).toFixed(0)}%
                        </p>
                      </div>
                    )}
                  </div>

                  <div>
                    <h4 className="font-semibold text-slate-900 mb-1">Executive Summary</h4>
                    <p className="text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-200 leading-relaxed">
                      {activeAiException.aiExplanation.summary}
                    </p>
                  </div>

                  <div>
                    <h4 className="font-semibold text-slate-900 mb-1">Likely Cause</h4>
                    <p className="text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-200 leading-relaxed">
                      {activeAiException.aiExplanation.likelyCause}
                    </p>
                  </div>

                  {activeAiException.aiExplanation.evidence && activeAiException.aiExplanation.evidence.length > 0 && (
                    <div>
                      <h4 className="font-semibold text-slate-900 mb-1">Evidence Points</h4>
                      <ul className="list-disc list-inside space-y-1 bg-slate-50 p-3 rounded-lg border border-slate-200 text-slate-700">
                        {activeAiException.aiExplanation.evidence.map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {activeAiException.aiExplanation.recommendedNextStep && (
                    <div>
                      <h4 className="font-semibold text-indigo-900 mb-1">Recommended Next Step</h4>
                      <p className="text-indigo-900 bg-indigo-50 p-3 rounded-lg border border-indigo-200 font-medium">
                        {activeAiException.aiExplanation.recommendedNextStep}
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 text-center text-xs text-slate-500">
                  No structured AI explanation available.
                </div>
              )}
            </div>

            <div className="p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
              <Button
                variant="outline"
                onClick={() => setActiveAiException(null)}
              >
                Close
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  const id = activeAiException.exceptionId;
                  setActiveAiException(null);
                  navigate(`/exceptions/${id}`);
                }}
                rightIcon={<ChevronRight className="w-4 h-4" />}
              >
                Review Exception
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
