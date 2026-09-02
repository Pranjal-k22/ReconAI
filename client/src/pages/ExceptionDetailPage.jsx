import React, { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Sparkles,
  ShieldAlert,
  ShieldCheck,
  CheckCircle2,
  AlertTriangle,
  Info,
  Clock,
  UserCheck,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import {
  getException,
  investigateException,
  submitHumanDecision
} from "../api/exceptionApi";
import { PageHeader } from "../components/common/PageHeader";
import { Card } from "../components/common/Card";
import { Button } from "../components/common/Button";
import {
  ClassificationBadge,
  SeverityBadge,
  StatusBadge,
  Badge
} from "../components/common/Badge";
import { LoadingState } from "../components/common/LoadingState";
import { ErrorState } from "../components/common/ErrorState";
import { formatINRFromPaise, formatPercent } from "../utils/money";
import { formatDate } from "../utils/date";
import { formatEnumLabel } from "../utils/enum";
import { DEFAULT_ACTOR_ID } from "../constants/app";
import { useToast } from "../components/common/ToastContext";

export default function ExceptionDetailPage() {
  const { exceptionId } = useParams();
  const navigate = useNavigate();
  const { addToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [exception, setException] = useState(null);
  const [result, setResult] = useState(null);

  // AI State
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState(null);

  // Decision Form State
  const [decision, setDecision] = useState("KEEP_EXCEPTION");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [decisionSubmitting, setDecisionSubmitting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // Raw JSON accordion
  const [showRawEvidence, setShowRawEvidence] = useState(false);

  const fetchDetail = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getException(exceptionId);
      setException(data);
      setResult(data.reconciliationResult || null);
      if (data.aiAnalysis) {
        setAiResult(data.aiAnalysis);
      }
    } catch (err) {
      setError(err.message || "Failed to load exception case details.");
    } finally {
      setLoading(false);
    }
  }, [exceptionId]);

  useEffect(() => {
    fetchDetail();
  }, [fetchDetail]);

  const handleInvestigateAI = async () => {
    setAiLoading(true);
    try {
      const investigationData = await investigateException(exceptionId, {
        actorId: DEFAULT_ACTOR_ID
      });
      setAiResult(investigationData);
      addToast(
        investigationData.source === "FALLBACK"
          ? "Deterministic fallback explanation generated."
          : "Gemini AI advisory investigation completed.",
        "success"
      );
    } catch (err) {
      addToast(err.message || "AI Investigation failed.", "error");
    } finally {
      setAiLoading(false);
    }
  };

  const handleExecuteDecision = async () => {
    if (!resolutionNotes.trim()) {
      addToast("Resolution notes are required before submitting a decision.", "warning");
      return;
    }

    setDecisionSubmitting(true);
    try {
      await submitHumanDecision(exceptionId, {
        decision,
        resolutionNotes: resolutionNotes.trim(),
        actorId: DEFAULT_ACTOR_ID
      });

      addToast("Human decision recorded successfully.", "success");
      setShowConfirmModal(false);
      await fetchDetail();
    } catch (err) {
      addToast(err.message || "Failed to record decision.", "error");
    } finally {
      setDecisionSubmitting(false);
    }
  };

  if (loading) {
    return <LoadingState message={`Loading exception case ${exceptionId}...`} />;
  }

  if (error || !exception) {
    return (
      <ErrorState
        title="Exception Case Not Found"
        message={error || "Could not retrieve exception case."}
        onRetry={fetchDetail}
      />
    );
  }

  const isAmbiguous = exception.exceptionType === "AMBIGUOUS";
  const candidatePayments = result?.ruleEvidence?.candidatePayments || [];

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Exception Review: ${exception.exceptionId}`}
        subtitle={`Merchant Order ID: ${exception.merchantOrderId}`}
        action={
          <Button variant="outline" icon={ArrowLeft} onClick={() => navigate("/exceptions")}>
            Back to Queue
          </Button>
        }
      />

      {/* AMBIGUOUS Safety Banner Showcase */}
      {isAmbiguous && (
        <div className="p-4 bg-violet-950/90 border border-violet-700/50 rounded-xl text-violet-100 flex items-start space-x-3 shadow-md">
          <ShieldAlert className="w-6 h-6 text-violet-300 flex-shrink-0 mt-0.5" />
          <div className="flex-1 text-xs">
            <h4 className="text-sm font-bold text-white uppercase tracking-wider">
              Automatic Reconciliation Blocked — Manual Review Required
            </h4>
            <p className="mt-1 text-violet-200 leading-relaxed">
              Multiple candidate gateway payments exhibit equivalent evidence for order{" "}
              <span className="font-mono font-semibold text-white">{exception.merchantOrderId}</span>.
              The deterministic safety gate blocked automatic selection to prevent financial mismatch.
            </p>
          </div>
        </div>
      )}

      {/* Exception Overview Header Card */}
      <Card padding="p-5">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 text-xs">
          <div>
            <span className="text-slate-500 block">Classification</span>
            <div className="mt-1">
              <ClassificationBadge classification={exception.exceptionType} />
            </div>
          </div>
          <div>
            <span className="text-slate-500 block">Severity</span>
            <div className="mt-1">
              <SeverityBadge severity={exception.severity} />
            </div>
          </div>
          <div>
            <span className="text-slate-500 block">Status</span>
            <div className="mt-1">
              <StatusBadge status={exception.status} />
            </div>
          </div>
          <div>
            <span className="text-slate-500 block">Evidence Confidence</span>
            <span className="font-mono font-bold text-slate-900 text-sm block mt-0.5">
              {formatPercent(exception.evidenceConfidence)}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">Financial Impact</span>
            <span className="font-mono font-bold text-rose-700 text-sm block mt-0.5">
              {formatINRFromPaise(exception.financialImpactPaise)}
            </span>
          </div>
          <div>
            <span className="text-slate-500 block">Created</span>
            <span className="font-medium text-slate-800 block mt-0.5">
              {formatDate(exception.createdAt)}
            </span>
          </div>
        </div>
      </Card>

      {/* Financial Comparison Card */}
      <Card header="Financial Amount Verification">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-center">
          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
            <span className="text-xs font-semibold uppercase text-slate-500">Expected Amount</span>
            <p className="text-xl font-bold text-slate-900 mt-1">
              {formatINRFromPaise(result?.expectedAmountPaise)}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">Merchant Order Total</p>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
            <span className="text-xs font-semibold uppercase text-slate-500">Actual Amount</span>
            <p className="text-xl font-bold text-slate-900 mt-1">
              {formatINRFromPaise(result?.actualAmountPaise)}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">Recorded Gateway Payment</p>
          </div>

          <div className="p-4 bg-slate-50 rounded-xl border border-slate-100">
            <span className="text-xs font-semibold uppercase text-slate-500">Difference</span>
            <p
              className={`text-xl font-bold mt-1 ${
                (result?.differencePaise || 0) !== 0 ? "text-rose-600" : "text-emerald-600"
              }`}
            >
              {formatINRFromPaise(result?.differencePaise)}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5">Actual - Expected</p>
          </div>
        </div>
      </Card>

      {/* Candidate Payments Card (for AMBIGUOUS) */}
      {candidatePayments.length > 0 && (
        <Card header="Candidate Payment Evidence">
          <p className="text-xs text-slate-600 mb-3">
            Multiple candidate payments matched reference parameters with equal evidence score:
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {candidatePayments.map((cand, idx) => (
              <div key={idx} className="p-3 bg-amber-50/50 border border-amber-200 rounded-lg text-xs">
                <div className="flex justify-between font-semibold text-slate-800">
                  <span>Candidate {idx + 1}</span>
                  <span className="font-mono text-amber-800">
                    ID: {cand.gatewayPaymentId || cand.id || "N/A"}
                  </span>
                </div>
                <div className="mt-1 flex justify-between text-slate-600 font-mono">
                  <span>Amount: {formatINRFromPaise(cand.amountPaise)}</span>
                  <span>Ref: {cand.paymentReference || "N/A"}</span>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Deterministic Explanation & Rule Evidence */}
      <Card header="Deterministic Engine Analysis">
        <div className="space-y-3 text-xs">
          <div>
            <h4 className="font-semibold text-slate-900 mb-1">Explanation Summary</h4>
            <p className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-700 leading-relaxed font-mono">
              {result?.deterministicExplanation || "No explanation recorded."}
            </p>
          </div>

          {result?.reasons && result.reasons.length > 0 && (
            <div>
              <h4 className="font-semibold text-slate-900 mb-1">Rule Triggers & Reasons</h4>
              <ul className="list-disc list-inside space-y-1 text-slate-700 bg-slate-50 p-3 rounded-lg border border-slate-200">
                {result.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Raw Evidence Collapsible */}
          <div className="pt-2">
            <button
              onClick={() => setShowRawEvidence(!showRawEvidence)}
              className="flex items-center gap-1.5 text-xs font-semibold text-indigo-600 hover:text-indigo-800"
            >
              <span>{showRawEvidence ? "Hide" : "View"} Raw Rule Evidence JSON</span>
              {showRawEvidence ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>

            {showRawEvidence && (
              <pre className="mt-2 p-3 bg-slate-950 text-slate-200 text-[11px] font-mono rounded-lg overflow-x-auto max-h-60">
                {JSON.stringify(result?.ruleEvidence || {}, null, 2)}
              </pre>
            )}
          </div>
        </div>
      </Card>

      {/* AI Advisory Panel */}
      <Card
        header={
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Sparkles className="w-5 h-5 text-indigo-600" />
              <h3 className="text-sm font-semibold text-slate-800">AI Advisory Investigation</h3>
            </div>

            {aiResult && (
              <Badge variant={aiResult.source === "FALLBACK" ? "amber" : "indigo"}>
                {aiResult.source === "FALLBACK" ? "Deterministic Fallback" : "Gemini"}
              </Badge>
            )}
          </div>
        }
      >
        <div className="space-y-4">
          <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg flex items-center justify-between text-xs">
            <p className="text-slate-600">
              Gemini provides root-cause advisory insights strictly on-demand. It cannot modify match classifications or move funds.
            </p>
            <Button
              size="sm"
              variant="primary"
              icon={Sparkles}
              loading={aiLoading}
              onClick={handleInvestigateAI}
            >
              Investigate with AI
            </Button>
          </div>

          {aiResult ? (
            <div className="space-y-3 text-xs border-t border-slate-100 pt-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <h4 className="font-semibold text-slate-900 mb-1">Executive Summary</h4>
                  <p className="text-slate-700 leading-relaxed">{aiResult.summary || "N/A"}</p>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <h4 className="font-semibold text-slate-900 mb-1">Likely Root Cause</h4>
                  <p className="text-slate-700 leading-relaxed">{aiResult.likelyCause || "N/A"}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <h4 className="font-semibold text-slate-900 mb-1">Recommended Next Step</h4>
                  <p className="text-indigo-700 font-semibold">{formatEnumLabel(aiResult.recommendedNextStep)}</p>
                </div>
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <h4 className="font-semibold text-slate-900 mb-1">AI Advisory Confidence</h4>
                  <p className="text-slate-700 font-mono">
                    {aiResult.aiConfidence !== null && aiResult.aiConfidence !== undefined
                      ? formatPercent(aiResult.aiConfidence)
                      : "Not applicable"}
                  </p>
                </div>
              </div>

              {aiResult.supportingEvidence && aiResult.supportingEvidence.length > 0 && (
                <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
                  <h4 className="font-semibold text-slate-900 mb-1">Supporting Evidence</h4>
                  <ul className="list-disc list-inside space-y-0.5 text-slate-700">
                    {aiResult.supportingEvidence.map((item, idx) => (
                      <li key={idx}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}

              {aiResult.riskNotes && (
                <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-amber-900">
                  <h4 className="font-semibold mb-0.5">Risk & Operational Notes</h4>
                  <p>{aiResult.riskNotes}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-4 text-xs text-slate-500">
              No AI investigation performed yet. Click &quot;Investigate with AI&quot; to generate advisory analysis.
            </div>
          )}

          <div className="p-2.5 bg-slate-100 rounded-lg text-[11px] text-slate-500 flex items-center gap-2">
            <Info className="w-4 h-4 text-slate-400 flex-shrink-0" />
            <span>Advisory only — AI cannot modify reconciliation or move funds.</span>
          </div>
        </div>
      </Card>

      {/* Human Review Panel */}
      <Card
        header={
          <div className="flex items-center space-x-2">
            <UserCheck className="w-5 h-5 text-slate-700" />
            <h3 className="text-sm font-semibold text-slate-800">Human Review & Decision</h3>
          </div>
        }
      >
        {exception.humanDecision ? (
          <div className="space-y-3 text-xs bg-emerald-50/50 p-4 border border-emerald-200 rounded-xl">
            <div className="flex items-center justify-between">
              <span className="font-bold text-emerald-900">Human Review Recorded</span>
              <StatusBadge status={exception.status} />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 border-t border-emerald-200/60">
              <div>
                <span className="text-slate-500 block">Decision</span>
                <span className="font-semibold text-slate-900">
                  {formatEnumLabel(exception.humanDecision.decision)}
                </span>
              </div>
              <div>
                <span className="text-slate-500 block">Reviewer</span>
                <span className="font-mono text-slate-800">
                  {exception.humanDecision.actorId}
                </span>
              </div>
              <div className="col-span-2">
                <span className="text-slate-500 block">Reviewed At</span>
                <span className="text-slate-800">{formatDate(exception.humanDecision.appliedAt)}</span>
              </div>
            </div>
            <div>
              <span className="text-slate-500 block font-semibold mb-0.5">Resolution Notes</span>
              <p className="p-2 bg-white rounded border border-emerald-200 text-slate-800">
                {exception.humanDecision.resolutionNotes}
              </p>
            </div>
            <p className="text-[11px] text-slate-500 italic">
              Note: The original deterministic classification ({exception.exceptionType}) remains preserved for auditability.
            </p>
          </div>
        ) : (
          <div className="space-y-4 text-xs">
            <div>
              <label className="block font-semibold text-slate-800 mb-2">
                Select Resolution Action
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label
                  className={`p-3 border rounded-xl cursor-pointer flex flex-col justify-between transition-colors ${
                    decision === "KEEP_EXCEPTION"
                      ? "border-indigo-600 bg-indigo-50/50 text-indigo-950 font-semibold"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="decision"
                    value="KEEP_EXCEPTION"
                    checked={decision === "KEEP_EXCEPTION"}
                    onChange={(e) => setDecision(e.target.value)}
                    className="sr-only"
                  />
                  <span>Keep Exception</span>
                  <span className="text-[10px] text-slate-500 font-normal mt-1">
                    Maintain anomaly status in queue for further investigation.
                  </span>
                </label>

                <label
                  className={`p-3 border rounded-xl cursor-pointer flex flex-col justify-between transition-colors ${
                    decision === "APPROVE_MATCH"
                      ? "border-emerald-600 bg-emerald-50/50 text-emerald-950 font-semibold"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="decision"
                    value="APPROVE_MATCH"
                    checked={decision === "APPROVE_MATCH"}
                    onChange={(e) => setDecision(e.target.value)}
                    className="sr-only"
                  />
                  <span>Approve Match</span>
                  <span className="text-[10px] text-slate-500 font-normal mt-1">
                    Override anomaly operational block with human approval.
                  </span>
                </label>

                <label
                  className={`p-3 border rounded-xl cursor-pointer flex flex-col justify-between transition-colors ${
                    decision === "MARK_RESOLVED"
                      ? "border-blue-600 bg-blue-50/50 text-blue-950 font-semibold"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  <input
                    type="radio"
                    name="decision"
                    value="MARK_RESOLVED"
                    checked={decision === "MARK_RESOLVED"}
                    onChange={(e) => setDecision(e.target.value)}
                    className="sr-only"
                  />
                  <span>Mark Resolved</span>
                  <span className="text-[10px] text-slate-500 font-normal mt-1">
                    Close exception case after external manual adjustment.
                  </span>
                </label>
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-800 mb-1">
                Resolution Notes <span className="text-rose-500">*</span>
              </label>
              <textarea
                rows={3}
                placeholder="Explain reason for human decision..."
                value={resolutionNotes}
                onChange={(e) => setResolutionNotes(e.target.value)}
                className="w-full p-2.5 border border-slate-300 rounded-lg text-xs focus:outline-none focus:ring-2 focus:ring-slate-900 bg-white"
              />
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100">
              <p className="text-[11px] text-slate-500">
                ReconAI does not automatically resolve financial anomalies. A human decision is required before workflow closure.
              </p>
              <Button
                variant="primary"
                onClick={() => setShowConfirmModal(true)}
                disabled={!resolutionNotes.trim()}
              >
                Submit Decision
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Confirmation Modal */}
      {showConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-md w-full shadow-2xl space-y-4 text-xs">
            <h3 className="text-base font-bold text-slate-900">Confirm Human Decision</h3>
            <p className="text-slate-600 leading-relaxed">
              You are applying decision:{" "}
              <strong className="text-slate-900">{formatEnumLabel(decision)}</strong> for order{" "}
              <strong className="font-mono text-slate-900">{exception.merchantOrderId}</strong>.
            </p>
            {decision === "APPROVE_MATCH" && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-900">
                <strong>Important Audit Notice:</strong> This records a human approval. The original
                deterministic classification ({exception.exceptionType}) will remain unchanged for auditability.
              </div>
            )}
            <div className="flex items-center justify-end gap-3 pt-2">
              <Button
                variant="outline"
                onClick={() => setShowConfirmModal(false)}
                disabled={decisionSubmitting}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={decisionSubmitting}
                onClick={handleExecuteDecision}
              >
                Confirm & Submit
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
