import React, { useState, useEffect, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  fetchPaymentCaseById,
  fetchCaseClassification,
  fetchCaseLifecycleEvents,
  fetchCaseInvestigations,
  fetchCasePolicyDecisions,
  fetchCaseProviderOperations
} from "../api/casesApi";
import { formatPaiseToInr } from "../utils/formatMoney";
import { RoleGuard } from "../components/common/RoleGuard";
import { ExpandableText } from "../components/common/ExpandableText";
import {
  ShieldAlert,
  ArrowLeft,
  RefreshCw,
  Database,
  Lock,
  Clock,
  Layers,
  Scale,
  Bot,
  Activity,
  FileText,
  AlertTriangle,
  CheckCircle2,
  HelpCircle
} from "lucide-react";

export function CaseDetailPage() {
  const { caseId } = useParams();

  const [caseData, setCaseData] = useState(null);
  const [classification, setClassification] = useState(null);
  const [events, setEvents] = useState([]);
  const [investigations, setInvestigations] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [operations, setOperations] = useState([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const loadCaseDetails = useCallback(async () => {
    if (!caseId) return;
    setLoading(true);
    setError(null);
    try {
      const [caseRes, classRes, eventsRes, invRes, decRes, opsRes] = await Promise.allSettled([
        fetchPaymentCaseById(caseId),
        fetchCaseClassification(caseId),
        fetchCaseLifecycleEvents(caseId),
        fetchCaseInvestigations(caseId),
        fetchCasePolicyDecisions(caseId),
        fetchCaseProviderOperations(caseId)
      ]);

      if (caseRes.status === "fulfilled") {
        setCaseData(caseRes.value?.data || null);
      } else {
        throw caseRes.reason;
      }

      if (classRes.status === "fulfilled") {
        setClassification(classRes.value?.data || null);
      }

      if (eventsRes.status === "fulfilled") {
        setEvents(Array.isArray(eventsRes.value?.data) ? eventsRes.value.data : []);
      }

      if (invRes.status === "fulfilled") {
        setInvestigations(Array.isArray(invRes.value?.data) ? invRes.value.data : []);
      }

      if (decRes.status === "fulfilled") {
        setDecisions(Array.isArray(decRes.value?.data) ? decRes.value.data : []);
      }

      if (opsRes.status === "fulfilled") {
        setOperations(Array.isArray(opsRes.value?.data) ? opsRes.value.data : []);
      }
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    loadCaseDetails();
  }, [loadCaseDetails]);

  if (loading) {
    return (
      <RoleGuard>
        <div className="flex flex-col items-center justify-center min-h-[500px]">
          <RefreshCw className="w-8 h-8 animate-spin text-indigo-600 mb-3" />
          <p className="text-sm font-medium text-slate-600">Loading case details from live API...</p>
        </div>
      </RoleGuard>
    );
  }

  if (error) {
    return (
      <RoleGuard>
        <div className="max-w-4xl mx-auto space-y-4 pt-6">
          <Link
            to="/cases"
            className="inline-flex items-center text-xs font-semibold text-indigo-600 hover:text-indigo-800"
          >
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Cases
          </Link>
          <div className="bg-red-50 border border-red-200 rounded-xl p-6 text-red-700 space-y-2">
            <div className="flex items-center space-x-2">
              <ShieldAlert className="w-6 h-6 text-red-600" />
              <h2 className="text-base font-bold">Error Loading Case {caseId}</h2>
            </div>
            <p className="text-sm">{error.message || "Case not found or access denied."}</p>
            {error.retryable && (
              <button
                type="button"
                onClick={loadCaseDetails}
                className="mt-3 px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-800 rounded-lg text-xs font-semibold transition-colors"
              >
                Retry Loading
              </button>
            )}
          </div>
        </div>
      </RoleGuard>
    );
  }

  if (!caseData) {
    return (
      <RoleGuard>
        <div className="max-w-4xl mx-auto pt-6 text-center">
          <p className="text-sm text-slate-500">Case not found.</p>
          <Link to="/cases" className="text-xs text-indigo-600 hover:underline mt-2 inline-block">
            Return to list
          </Link>
        </div>
      </RoleGuard>
    );
  }

  const isCase22 =
    caseData.discrepancyCategory === "CANCELLED_ORDER_CAPTURED" ||
    classification?.scenarioId === "CASE_22_PAYMENT_CAPTURED_ORDER_CANCELLED" ||
    caseData.safeHoldCode === "LATE_CAPTURE_CANCELLED_ORDER";

  const latestInv = investigations[0] || null;

  return (
    <RoleGuard>
      <div className="space-y-6 pb-12 max-w-7xl mx-auto">
        {/* Navigation & Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <div className="flex items-center space-x-2 text-xs text-slate-500 mb-1">
              <Link to="/cases" className="hover:text-indigo-600 hover:underline flex items-center">
                <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Cases
              </Link>
              <span>/</span>
              <span className="font-mono text-slate-700">{caseData.caseId}</span>
            </div>
            <div className="flex items-center space-x-3">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-mono">
                {caseData.caseId}
              </h1>
              {/* Mandatory Live API Badge */}
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                <Database className="w-3 h-3 mr-1" />
                Live API data
              </span>
              {caseData.isSafeHold && (
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-900 border border-amber-300">
                  <Lock className="w-3 h-3 mr-1" />
                  SAFE-HOLD
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Deterministic investigation detail. Read-only operator audit view.
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={loadCaseDetails}
              className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
              Refresh
            </button>
          </div>
        </div>

        {/* SECTION 8: SAFE-HOLD BANNER (Rendered prominently at top when held) */}
        {caseData.isSafeHold && (
          <div
            data-testid="safe-hold-section"
            className="bg-amber-50 border-2 border-amber-400 rounded-xl p-5 shadow-xs"
          >
            <div className="flex items-start space-x-3">
              <div className="p-2 bg-amber-200 text-amber-900 rounded-lg flex-shrink-0 mt-0.5">
                <Lock className="w-5 h-5" />
              </div>
              <div className="flex-1 space-y-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-bold text-amber-950 uppercase tracking-wide">
                    Safe-Hold Policy Active: {caseData.safeHoldCode || classification?.safeHoldCode || "HELD"}
                  </h2>
                  <span className="text-[11px] font-semibold text-amber-800 bg-amber-200/80 px-2.5 py-0.5 rounded-full">
                    Fail-Closed Safety
                  </span>
                </div>

                <p className="text-xs text-amber-900 font-medium">
                  {caseData.safeHoldReason || classification?.safeHoldReason || "Case requires manual operator review before release."}
                </p>

                {/* Case 22 Specific Invariant Text */}
                {isCase22 && (
                  <div
                    data-testid="case-22-banner"
                    className="p-3 bg-amber-100/90 border border-amber-300 rounded-lg text-xs text-amber-950 font-semibold"
                  >
                    late capture on a cancelled order: held, no automatic refund or reopen
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* SECTION 1: 8-DIMENSION STATE GRID */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5">
          <div className="flex items-center space-x-2 pb-3 mb-4 border-b border-slate-100">
            <Layers className="w-4 h-4 text-indigo-600" />
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
              8-Dimension State Grid
            </h2>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
            {/* Dimension 1: Order State */}
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
              <div className="text-[10px] uppercase font-bold text-slate-400">1. Order State</div>
              <div className="font-mono font-semibold text-slate-900 mt-1">
                {caseData.orderStatus || "UNKNOWN"}
              </div>
            </div>

            {/* Dimension 2: Debit State */}
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
              <div className="text-[10px] uppercase font-bold text-slate-400">2. Customer Debit</div>
              <div className="font-mono font-semibold text-slate-900 mt-1">
                {caseData.customerDebitStatus || "DEBIT_NONE"}
              </div>
            </div>

            {/* Dimension 3: Auth State */}
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
              <div className="text-[10px] uppercase font-bold text-slate-400">3. Authorization</div>
              <div className="font-mono font-semibold text-slate-900 mt-1">
                {caseData.authorizationStatus || "AUTH_NONE"}
              </div>
            </div>

            {/* Dimension 4: Capture State */}
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
              <div className="text-[10px] uppercase font-bold text-slate-400">4. Capture State</div>
              <div className="font-mono font-semibold text-slate-900 mt-1">
                {caseData.captureStatus || "CAPTURE_NONE"}
              </div>
            </div>

            {/* Dimension 5: Settlement State */}
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
              <div className="text-[10px] uppercase font-bold text-slate-400">5. Settlement</div>
              <div className="font-mono font-semibold text-slate-900 mt-1">
                {caseData.settlementStatus || "SETTLEMENT_NONE"}
              </div>
            </div>

            {/* Dimension 6: Refund State */}
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
              <div className="text-[10px] uppercase font-bold text-slate-400">6. Refund State</div>
              <div className="font-mono font-semibold text-slate-900 mt-1">
                {caseData.refundStatus || "REFUND_NONE"}
              </div>
            </div>

            {/* Dimension 7: Dispute State */}
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
              <div className="text-[10px] uppercase font-bold text-slate-400">7. Dispute State</div>
              <div className="font-mono font-semibold text-slate-900 mt-1">
                {caseData.disputeStatus || "DISPUTE_NONE"}
              </div>
            </div>

            {/* Dimension 8: Case State */}
            <div className="p-3 bg-indigo-50/70 rounded-lg border border-indigo-100">
              <div className="text-[10px] uppercase font-bold text-indigo-500">8. Resolution State</div>
              <div className="font-mono font-bold text-indigo-900 mt-1">
                {caseData.resolutionCaseStatus || "CASE_DETECTED"}
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 2: AMOUNTS AND MISMATCH DISPLAY */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5">
          <div className="flex items-center space-x-2 pb-3 mb-4 border-b border-slate-100">
            <Scale className="w-4 h-4 text-indigo-600" />
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
              Amounts & Discrepancy Analysis
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
              <div className="text-slate-500 font-medium">Gateway Payment Amount</div>
              <div className="text-lg font-bold text-slate-900 mt-1">
                {formatPaiseToInr(caseData.paymentAmountPaise || 0)}
              </div>
              <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                Ref: {caseData.gatewayPaymentId || "None"}
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
              <div className="text-slate-500 font-medium">Merchant Order Amount</div>
              <div className="text-lg font-bold text-slate-900 mt-1">
                {formatPaiseToInr(caseData.orderAmountPaise || 0)}
              </div>
              <div className="text-[10px] font-mono text-slate-400 mt-0.5">
                Ref: {caseData.merchantOrderId || "None"}
              </div>
            </div>

            <div className="p-3 bg-slate-50 rounded-lg border border-slate-100">
              <div className="text-slate-500 font-medium">Discrepancy Category</div>
              <div className="text-sm font-bold text-amber-700 mt-1">
                {caseData.discrepancyCategory || "NONE"}
              </div>
              <div className="text-[10px] text-slate-400 mt-0.5">
                Detected: {caseData.detectedAt ? new Date(caseData.detectedAt).toLocaleString() : "N/A"}
              </div>
            </div>
          </div>
        </div>

        {/* SECTION 3: CLASSIFICATION PANEL (Facts vs Claims) */}
        {classification && (
          <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center space-x-2">
                <FileText className="w-4 h-4 text-indigo-600" />
                <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
                  Deterministic Classification Panel
                </h2>
              </div>

              {/* Staleness badge displayed strictly as returned by API */}
              <div className="flex items-center space-x-2">
                <span className="text-[11px] text-slate-500">Record Hash:</span>
                <span className="font-mono text-[10px] bg-slate-100 px-2 py-0.5 rounded-md text-slate-700">
                  {classification.recordHash?.slice(0, 16)}...
                </span>
                <span
                  className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                    classification.isStale
                      ? "bg-red-100 text-red-800 border border-red-300"
                      : "bg-emerald-100 text-emerald-800 border border-emerald-300"
                  }`}
                >
                  {classification.isStale ? "STALE" : "VERIFIED CURRENT"}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
              <div className="p-2.5 bg-slate-50 rounded-md">
                <span className="text-slate-500 block text-[10px] uppercase font-semibold">Scenario ID</span>
                <span className="font-mono font-bold text-slate-900">{classification.scenarioId}</span>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-md">
                <span className="text-slate-500 block text-[10px] uppercase font-semibold">Reason Code</span>
                <span className="font-mono font-bold text-slate-900">{classification.reasonCode}</span>
              </div>
              <div className="p-2.5 bg-slate-50 rounded-md">
                <span className="text-slate-500 block text-[10px] uppercase font-semibold">Advisory Next Step</span>
                <span className="font-bold text-indigo-700">{classification.suggestedNextStep || "HOLD"}</span>
              </div>
            </div>

            {/* Facts vs Claims Separation */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              {/* Authoritative Provider Facts */}
              <div className="border border-slate-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700 uppercase">
                  <span className="flex items-center">
                    <CheckCircle2 className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                    Authoritative Facts ({classification.facts?.length || 0})
                  </span>
                  <span className="text-[10px] text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md font-semibold">
                    Provider Verified
                  </span>
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {classification.facts?.length > 0 ? (
                    classification.facts.map((fact, idx) => (
                      <div key={idx} className="p-2 bg-slate-50 rounded text-xs border border-slate-100">
                        <div className="font-mono font-semibold text-slate-800 text-[11px]">{fact.dimension}</div>
                        <div className="text-slate-600 text-[11px]">
                          Value: <span className="font-mono font-bold text-slate-900">{fact.value}</span>
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">
                          Source: {fact.source} | Authority: {fact.authority}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-slate-400 italic">No facts recorded</div>
                  )}
                </div>
              </div>

              {/* Unverified Claims */}
              <div className="border border-slate-200 rounded-lg p-3 space-y-2">
                <div className="flex items-center justify-between text-xs font-bold text-slate-700 uppercase">
                  <span className="flex items-center">
                    <HelpCircle className="w-3.5 h-3.5 mr-1 text-amber-600" />
                    Claims ({classification.claims?.length || 0})
                  </span>
                  <span className="text-[10px] text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md font-semibold">
                    claim, unverified
                  </span>
                </div>
                <div className="space-y-1.5 max-h-48 overflow-y-auto">
                  {classification.claims?.length > 0 ? (
                    classification.claims.map((claim, idx) => (
                      <div key={idx} className="p-2 bg-amber-50/50 rounded text-xs border border-amber-200">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-semibold text-slate-800 text-[11px]">
                            {claim.claimType}
                          </span>
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-100 text-amber-900 border border-amber-300">
                            claim, unverified
                          </span>
                        </div>
                        <div className="text-slate-700 text-[11px] mt-1">
                          <ExpandableText text={claim.statement || JSON.stringify(claim.claimedValue)} />
                        </div>
                        <div className="text-[10px] text-slate-400 mt-0.5">Source: {claim.source}</div>
                      </div>
                    ))
                  ) : (
                    <div className="text-xs text-slate-400 italic">No customer claims submitted</div>
                  )}
                </div>
              </div>
            </div>

            {/* Missing Evidence List */}
            {classification.missingEvidence?.length > 0 && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs">
                <span className="font-bold text-slate-700 block mb-1">Missing Evidence Items:</span>
                <ul className="list-disc list-inside space-y-0.5 text-slate-600 font-mono text-[11px]">
                  {classification.missingEvidence.map((item, idx) => (
                    <li key={idx}>
                      <ExpandableText text={item} />
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}

        {/* SECTION 4: LIFECYCLE EVENTS TIMELINE */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5">
          <div className="flex items-center space-x-2 pb-3 mb-4 border-b border-slate-100">
            <Activity className="w-4 h-4 text-indigo-600" />
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
              Append-Only Lifecycle Timeline ({events.length})
            </h2>
          </div>

          <div className="space-y-3">
            {events.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No lifecycle events recorded for this case.</p>
            ) : (
              events.map((evt, idx) => (
                <div
                  key={evt.eventId || idx}
                  className="flex items-start space-x-3 text-xs border-l-2 border-indigo-500 pl-3 py-1"
                >
                  <div className="flex-1 space-y-0.5">
                    <div className="flex items-center space-x-2">
                      <span className="font-mono font-bold text-slate-900">{evt.normalizedEventType}</span>
                      <span className="text-[10px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-medium">
                        {evt.sourceSystem}
                      </span>
                      {evt.amountPaise !== null && evt.amountPaise !== undefined && (
                        <span className="font-bold text-slate-700">{formatPaiseToInr(evt.amountPaise)}</span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400 font-mono">
                      Event ID: {evt.eventId} | Ingested: {evt.ingestedAt ? new Date(evt.ingestedAt).toLocaleString() : "N/A"}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* SECTION 5: INVESTIGATIONS (4 Agent Cards Labeled 'Advisory only') */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div className="flex items-center space-x-2">
              <Bot className="w-4 h-4 text-indigo-600" />
              <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
                Multi-Agent Investigation Run
              </h2>
            </div>
            {latestInv && (
              <div className="flex items-center space-x-2 text-xs">
                <span className="text-slate-500">Model:</span>
                <span className="font-mono text-[11px] bg-slate-100 px-2 py-0.5 rounded font-bold text-slate-800">
                  {latestInv.modelUsed}
                </span>
                <span className="text-[10px] text-slate-400">({latestInv.durationMs || 0}ms)</span>
              </div>
            )}
          </div>

          {!latestInv ? (
            <p className="text-xs text-slate-400 italic">No AI investigation runs recorded.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Card 1: Customer Perspective */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-900">1. Customer Perspective</h3>
                  <span className="text-[10px] uppercase font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full border border-amber-300">
                    Advisory only
                  </span>
                </div>
                <div className="text-xs text-slate-700">
                  <ExpandableText
                    text={
                      latestInv.customerPerspective?.perspective ||
                      latestInv.customerPerspective?.findings ||
                      "No customer perspective findings recorded."
                    }
                  />
                </div>
              </div>

              {/* Card 2: Shop Perspective */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-900">2. Shop Perspective</h3>
                  <span className="text-[10px] uppercase font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full border border-amber-300">
                    Advisory only
                  </span>
                </div>
                <div className="text-xs text-slate-700">
                  <ExpandableText
                    text={
                      latestInv.shopPerspective?.perspective ||
                      latestInv.shopPerspective?.findings ||
                      "No shop perspective findings recorded."
                    }
                  />
                </div>
              </div>

              {/* Card 3: Forensic Investigator */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-900">3. Forensic Investigator</h3>
                  <span className="text-[10px] uppercase font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full border border-amber-300">
                    Advisory only
                  </span>
                </div>
                <div className="text-xs text-slate-700">
                  <ExpandableText
                    text={
                      latestInv.investigatorFindings?.perspective ||
                      latestInv.investigatorFindings?.findings ||
                      "No investigator findings recorded."
                    }
                  />
                </div>
              </div>

              {/* Card 4: Resolution Proposal */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-lg space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-bold text-slate-900">4. Resolution Proposal</h3>
                  <span className="text-[10px] uppercase font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full border border-amber-300">
                    Advisory only
                  </span>
                </div>
                <div className="text-xs text-slate-700">
                  <ExpandableText
                    text={
                      latestInv.resolutionProposal?.suggestedAction ||
                      latestInv.resolutionProposal?.proposal ||
                      "Advisory hold recommended."
                    }
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* SECTION 6: POLICY DECISIONS LIST */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5">
          <div className="flex items-center space-x-2 pb-3 mb-4 border-b border-slate-100">
            <Scale className="w-4 h-4 text-indigo-600" />
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
              Policy Decisions ({decisions.length})
            </h2>
          </div>

          <div className="space-y-3">
            {decisions.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No policy decisions evaluated yet.</p>
            ) : (
              decisions.map((dec) => (
                <div
                  key={dec.decisionId}
                  className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-2"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-slate-800">{dec.decisionId}</span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                        dec.outcomeStatus === "SAFE_HOLD"
                          ? "bg-amber-100 text-amber-900 border border-amber-300"
                          : "bg-indigo-100 text-indigo-900"
                      }`}
                    >
                      {dec.outcomeStatus}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-slate-600">
                    <div>Action: <span className="font-semibold text-slate-800">{dec.proposedActionType}</span></div>
                    <div>Amount: <span className="font-semibold text-slate-800">{formatPaiseToInr(dec.amountPaise || 0)}</span></div>
                    <div>Config Ver: <span className="font-semibold text-slate-800">{dec.policyConfigVersion || 1}</span></div>
                    <div>Policy: <span className="font-semibold text-slate-800">{dec.policyVersion || "v1"}</span></div>
                  </div>
                  {dec.decisionReasons?.length > 0 && (
                    <div className="text-[11px] text-slate-600">
                      Reasons:{" "}
                      <span className="font-medium text-slate-800">
                        {dec.decisionReasons.join("; ")}
                      </span>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* SECTION 7: PROVIDER OPERATIONS LIST (Strictly read-only, no re-check button) */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs p-5">
          <div className="flex items-center space-x-2 pb-3 mb-4 border-b border-slate-100">
            <Activity className="w-4 h-4 text-indigo-600" />
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">
              Provider Operations ({operations.length}) — Read-Only Audit
            </h2>
          </div>

          <div className="space-y-3">
            {operations.length === 0 ? (
              <p className="text-xs text-slate-400 italic">No external provider operations dispatched.</p>
            ) : (
              operations.map((op) => (
                <div
                  key={op.operationId}
                  className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-xs space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-bold text-slate-800">{op.operationId}</span>
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-200 text-slate-800">
                      {op.operationStatus || "UNKNOWN"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-slate-600">
                    <div>Provider: <span className="font-semibold text-slate-800">{op.provider}</span></div>
                    <div>Type: <span className="font-semibold text-slate-800">{op.operationType}</span></div>
                    <div>Amount: <span className="font-semibold text-slate-800">{formatPaiseToInr(op.amountPaise || 0)}</span></div>
                    <div>Idempotency: <span className="font-mono text-[10px]">{op.idempotencyKey?.slice(0, 12)}...</span></div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </RoleGuard>
  );
}

export default CaseDetailPage;
