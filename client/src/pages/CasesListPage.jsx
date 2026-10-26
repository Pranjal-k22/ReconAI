import React, { useState, useEffect, useCallback } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { fetchPaymentCases } from "../api/casesApi";
import { formatPaiseToInr } from "../utils/formatMoney";
import { RoleGuard } from "../components/common/RoleGuard";
import { ExpandableText } from "../components/common/ExpandableText";
import {
  ShieldAlert,
  Search,
  Filter,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Database,
  Lock,
  Clock
} from "lucide-react";

export function CasesListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const safeHoldParam = searchParams.get("safeHold") === "true";
  const statusParam = searchParams.get("status") || "";

  const [cases, setCases] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0, pages: 1 });
  const [statusFilter, setStatusFilter] = useState(statusParam);
  const [safeHoldOnly, setSafeHoldOnly] = useState(safeHoldParam);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Sync state from URL params
  useEffect(() => {
    setSafeHoldOnly(searchParams.get("safeHold") === "true");
    setStatusFilter(searchParams.get("status") || "");
  }, [searchParams]);

  const loadCases = useCallback(
    async (pageToLoad = 1) => {
      setLoading(true);
      setError(null);
      try {
        const queryParams = {
          page: pageToLoad,
          limit: 25
        };
        if (statusFilter) {
          queryParams.resolutionCaseStatus = statusFilter;
        }
        if (safeHoldOnly) {
          queryParams.isSafeHold = true;
        }

        const res = await fetchPaymentCases(queryParams);
        const data = res?.data || {};
        setCases(data.cases || []);
        if (data.pagination) {
          setPagination(data.pagination);
        }
      } catch (err) {
        setError(err);
      } finally {
        setLoading(false);
      }
    },
    [statusFilter, safeHoldOnly]
  );

  useEffect(() => {
    loadCases(1);
  }, [loadCases]);

  const handleFilterChange = (newStatus, newSafeHold) => {
    setStatusFilter(newStatus);
    setSafeHoldOnly(newSafeHold);

    const nextParams = {};
    if (newStatus) nextParams.status = newStatus;
    if (newSafeHold) nextParams.safeHold = "true";
    setSearchParams(nextParams);
  };

  const calculateAge = (dateString) => {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    if (diffMins < 60) return `${Math.max(1, diffMins)}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  return (
    <RoleGuard>
      <div className="space-y-6">
        {/* Workspace Header */}
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-4 border-b border-slate-200">
          <div>
            <div className="flex items-center space-x-3">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">
                {safeHoldOnly ? "Safe-Hold Review Queue" : "Payment Lifecycle Cases"}
              </h1>
              {/* Mandatory Live API Badge */}
              <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-100 text-emerald-800 border border-emerald-300">
                <Database className="w-3 h-3 mr-1" />
                Live API data
              </span>
            </div>
            <p className="text-sm text-slate-500 mt-1">
              Deterministic payment case investigation and safe-hold review workspace. Read-only token-scoped views.
            </p>
          </div>

          <div className="flex items-center space-x-2">
            <button
              type="button"
              onClick={() => loadCases(pagination.page)}
              disabled={loading}
              className="inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium bg-white text-slate-700 border border-slate-300 hover:bg-slate-50 focus:outline-hidden transition-colors"
            >
              <RefreshCw className={`w-3.5 h-3.5 mr-1.5 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center space-x-2">
              <Filter className="w-4 h-4 text-slate-400" />
              <span className="text-xs font-semibold text-slate-700 uppercase">Filters:</span>
            </div>

            {/* Status Dropdown */}
            <select
              value={statusFilter}
              onChange={(e) => handleFilterChange(e.target.value, safeHoldOnly)}
              className="text-xs bg-slate-50 border border-slate-300 rounded-lg px-3 py-1.5 text-slate-700 focus:outline-hidden focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">All Resolution States</option>
              <option value="CASE_DETECTED">CASE_DETECTED</option>
              <option value="CASE_INVESTIGATING">CASE_INVESTIGATING</option>
              <option value="CASE_PENDING_POLICY">CASE_PENDING_POLICY</option>
              <option value="CASE_ACTION_IN_PROGRESS">CASE_ACTION_IN_PROGRESS</option>
              <option value="CASE_VERIFYING_OUTCOME">CASE_VERIFYING_OUTCOME</option>
              <option value="CASE_RESOLVED">CASE_RESOLVED</option>
              <option value="CASE_SAFE_HOLD">CASE_SAFE_HOLD</option>
              <option value="CASE_EXTERNAL_ESCALATION">CASE_EXTERNAL_ESCALATION</option>
            </select>

            {/* Safe-Hold Only Toggle */}
            <label className="inline-flex items-center space-x-2 text-xs font-medium text-slate-700 cursor-pointer bg-slate-50 border border-slate-300 px-3 py-1.5 rounded-lg hover:bg-slate-100 transition-colors">
              <input
                type="checkbox"
                checked={safeHoldOnly}
                onChange={(e) => handleFilterChange(statusFilter, e.target.checked)}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 w-3.5 h-3.5"
              />
              <span className="flex items-center">
                <Lock className="w-3.5 h-3.5 mr-1 text-amber-600" />
                Safe-Hold Only
              </span>
            </label>
          </div>

          <div className="text-xs text-slate-500">
            Total Cases: <span className="font-semibold text-slate-800">{pagination.total}</span>
          </div>
        </div>

        {/* Error State */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-start space-x-3 text-red-700">
            <ShieldAlert className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="flex-1 text-xs">
              <p className="font-semibold">{error.message || "Failed to load payment cases"}</p>
              {error.retryable && (
                <button
                  type="button"
                  onClick={() => loadCases(pagination.page)}
                  className="mt-2 text-red-800 underline font-medium hover:text-red-900"
                >
                  Retry request
                </button>
              )}
            </div>
          </div>
        )}

        {/* Table View */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/80 border-b border-slate-200 text-slate-600 uppercase font-semibold tracking-wider text-[11px]">
                  <th className="py-3 px-4">Case ID</th>
                  <th className="py-3 px-4">Order / Payment ID</th>
                  <th className="py-3 px-4">Amount</th>
                  <th className="py-3 px-4">Resolution Status</th>
                  <th className="py-3 px-4">{safeHoldOnly ? "Safe-Hold Reason Code" : "Safe-Hold"}</th>
                  <th className="py-3 px-4">{safeHoldOnly ? "Age" : "Last Updated"}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-slate-400">
                      <div className="flex items-center justify-center space-x-2">
                        <RefreshCw className="w-4 h-4 animate-spin text-indigo-600" />
                        <span>Loading cases from live API...</span>
                      </div>
                    </td>
                  </tr>
                )}

                {!loading && cases.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-12 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center">
                        <Search className="w-8 h-8 text-slate-300 mb-2" />
                        <p className="font-medium text-slate-600">No payment cases found</p>
                        <p className="text-xs text-slate-400 mt-1">
                          {safeHoldOnly
                            ? "No cases currently require safe-hold review."
                            : "No cases match the selected filters."}
                        </p>
                      </div>
                    </td>
                  </tr>
                )}

                {!loading &&
                  cases.map((item) => (
                    <tr
                      key={item.caseId}
                      className="hover:bg-slate-50/70 transition-colors cursor-pointer"
                    >
                      <td className="py-3 px-4 font-mono font-semibold text-indigo-600 hover:text-indigo-800">
                        <Link to={`/cases/${encodeURIComponent(item.caseId)}`} className="underline">
                          {item.caseId}
                        </Link>
                      </td>
                      <td className="py-3 px-4 text-slate-700 font-mono text-[11px]">
                        <div>Ord: {item.merchantOrderId || "N/A"}</div>
                        <div className="text-slate-400">Pay: {item.gatewayPaymentId || "N/A"}</div>
                      </td>
                      <td className="py-3 px-4 font-semibold text-slate-900">
                        {formatPaiseToInr(item.amountPaise || item.orderAmountPaise || item.paymentAmountPaise || 0)}
                      </td>
                      <td className="py-3 px-4">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold ${
                            item.resolutionCaseStatus === "CASE_RESOLVED"
                              ? "bg-emerald-100 text-emerald-800"
                              : item.resolutionCaseStatus === "CASE_SAFE_HOLD" || item.isSafeHold
                              ? "bg-amber-100 text-amber-800 border border-amber-300"
                              : "bg-indigo-100 text-indigo-800"
                          }`}
                        >
                          {item.resolutionCaseStatus || "CASE_DETECTED"}
                        </span>
                      </td>
                      <td className="py-3 px-4">
                        {item.isSafeHold ? (
                          <div className="space-y-0.5">
                            <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-900 border border-amber-200">
                              <Lock className="w-2.5 h-2.5 mr-1" />
                              {item.safeHoldCode || "HELD"}
                            </span>
                            {item.safeHoldReason && (
                              <div className="text-[11px] text-slate-500 max-w-xs">
                                <ExpandableText text={item.safeHoldReason} maxChars={50} />
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-slate-400 italic text-[11px]">None</span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-slate-600 whitespace-nowrap">
                        <div className="flex items-center text-[11px]">
                          <Clock className="w-3 h-3 mr-1 text-slate-400" />
                          <span>{calculateAge(item.updatedAt || item.detectedAt)}</span>
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {item.updatedAt ? new Date(item.updatedAt).toLocaleTimeString() : ""}
                        </div>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          {/* Pagination Footer */}
          {!loading && pagination.pages > 1 && (
            <div className="py-3 px-4 bg-slate-50/60 border-t border-slate-200 flex items-center justify-between text-xs text-slate-600">
              <div>
                Page <span className="font-semibold text-slate-800">{pagination.page}</span> of{" "}
                <span className="font-semibold text-slate-800">{pagination.pages}</span>
              </div>
              <div className="flex items-center space-x-1">
                <button
                  type="button"
                  onClick={() => loadCases(pagination.page - 1)}
                  disabled={pagination.page <= 1}
                  className="px-2.5 py-1 rounded-md border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={() => loadCases(pagination.page + 1)}
                  disabled={pagination.page >= pagination.pages}
                  className="px-2.5 py-1 rounded-md border border-slate-300 bg-white hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </RoleGuard>
  );
}

export default CasesListPage;
