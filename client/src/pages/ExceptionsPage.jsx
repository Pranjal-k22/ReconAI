import React, { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { TriangleAlert, Eye, RefreshCw, Filter, Search } from "lucide-react";
import { getExceptions, getExceptionSummary } from "../api/exceptionApi";
import { PageHeader } from "../components/common/PageHeader";
import { Card } from "../components/common/Card";
import { Button } from "../components/common/Button";
import { MetricCard } from "../components/common/MetricCard";
import {
  ClassificationBadge,
  SeverityBadge,
  StatusBadge
} from "../components/common/Badge";
import { LoadingState } from "../components/common/LoadingState";
import { ErrorState } from "../components/common/ErrorState";
import { EmptyState } from "../components/common/EmptyState";
import { Pagination } from "../components/common/Pagination";
import { formatINRFromPaise, formatPercent } from "../utils/money";
import { formatDate } from "../utils/date";

export default function ExceptionsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [summary, setSummary] = useState(null);
  const [exceptions, setExceptions] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 10, totalRecords: 0, totalPages: 1 });

  // Filters from URL query params
  const statusFilter = searchParams.get("status") || "";
  const typeFilter = searchParams.get("type") || "";
  const severityFilter = searchParams.get("severity") || "";
  const merchantOrderIdFilter = searchParams.get("merchantOrderId") || "";
  const runIdFilter = searchParams.get("runId") || "";
  const currentPage = parseInt(searchParams.get("page") || "1", 10);

  const fetchExceptionsData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [sumData, excData] = await Promise.all([
        getExceptionSummary().catch(() => null),
        getExceptions({
          status: statusFilter,
          type: typeFilter,
          severity: severityFilter,
          merchantOrderId: merchantOrderIdFilter,
          runId: runIdFilter,
          page: currentPage,
          limit: 10
        })
      ]);

      setSummary(sumData);
      setExceptions(excData.exceptions || []);
      setPagination(excData.pagination || { page: 1, limit: 10, totalRecords: 0, totalPages: 1 });
    } catch (err) {
      setError(err.message || "Failed to load exception records.");
    } finally {
      setLoading(false);
    }
  }, [statusFilter, typeFilter, severityFilter, merchantOrderIdFilter, runIdFilter, currentPage]);

  useEffect(() => {
    fetchExceptionsData();
  }, [fetchExceptionsData]);

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

  return (
    <div className="space-y-6">
      <PageHeader
        title="Exceptions Queue"
        subtitle="Isolated queue of financial anomalies requiring AI investigation & human review."
        action={
          <Button variant="secondary" icon={RefreshCw} onClick={fetchExceptionsData}>
            Refresh
          </Button>
        }
      />

      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard
            title="Open Exceptions"
            value={summary.byStatus?.OPEN || 0}
            color="rose"
          />
          <MetricCard
            title="Under Review"
            value={summary.byStatus?.UNDER_REVIEW || 0}
            color="amber"
          />
          <MetricCard
            title="Resolved / Closed"
            value={summary.byStatus?.RESOLVED || 0}
            color="emerald"
          />
          <MetricCard
            title="Financial Exposure"
            value={formatINRFromPaise(summary.totalFinancialImpactPaise)}
            color="indigo"
          />
        </div>
      )}

      {/* Filter Bar */}
      <Card padding="p-4">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 text-slate-500 font-semibold uppercase">
            <Filter className="w-4 h-4" />
            <span>Filters:</span>
          </div>

          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => updateFilter("status", e.target.value)}
            className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
          >
            <option value="">All Statuses</option>
            <option value="OPEN">Open</option>
            <option value="UNDER_REVIEW">Under Review</option>
            <option value="RESOLVED">Resolved</option>
            <option value="DISMISSED">Dismissed</option>
          </select>

          {/* Type Filter */}
          <select
            value={typeFilter}
            onChange={(e) => updateFilter("type", e.target.value)}
            className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
          >
            <option value="">All Types</option>
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

          {/* Severity Filter */}
          <select
            value={severityFilter}
            onChange={(e) => updateFilter("severity", e.target.value)}
            className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
          >
            <option value="">All Severities</option>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="CRITICAL">Critical</option>
          </select>

          {/* Merchant Order Search */}
          <div className="relative flex-1 min-w-[180px] max-w-[240px]">
            <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
            <input
              type="text"
              placeholder="Search Order ID..."
              value={merchantOrderIdFilter}
              onChange={(e) => updateFilter("merchantOrderId", e.target.value)}
              className="w-full pl-8 pr-2.5 py-1.5 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
            />
          </div>

          {(statusFilter || typeFilter || severityFilter || merchantOrderIdFilter || runIdFilter) && (
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              Reset Filters
            </Button>
          )}
        </div>
      </Card>

      {/* Table */}
      <Card padding="p-0">
        {loading ? (
          <LoadingState message="Fetching exception queue..." />
        ) : error ? (
          <ErrorState message={error} onRetry={fetchExceptionsData} />
        ) : exceptions.length === 0 ? (
          <EmptyState
            title="No Exceptions Found"
            description="No anomaly cases match the selected filter criteria."
            icon={TriangleAlert}
          />
        ) : (
          <div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold">
                    <th className="px-4 py-3">Exception ID</th>
                    <th className="px-4 py-3">Order ID</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Severity</th>
                    <th className="px-4 py-3 text-center">Confidence</th>
                    <th className="px-4 py-3 text-right">Financial Impact</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Created At</th>
                    <th className="px-4 py-3 text-center">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {exceptions.map((exc) => (
                    <tr key={exc.exceptionId} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3 font-mono font-semibold text-slate-900">
                        {exc.exceptionId}
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-800">
                        {exc.merchantOrderId}
                      </td>
                      <td className="px-4 py-3">
                        <ClassificationBadge classification={exc.exceptionType} />
                      </td>
                      <td className="px-4 py-3">
                        <SeverityBadge severity={exc.severity} />
                      </td>
                      <td className="px-4 py-3 text-center font-medium font-mono text-slate-700">
                        {formatPercent(exc.evidenceConfidence)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-semibold text-slate-900">
                        {formatINRFromPaise(exc.financialImpactPaise)}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={exc.status} />
                      </td>
                      <td className="px-4 py-3 text-slate-600">{formatDate(exc.createdAt)}</td>
                      <td className="px-4 py-3 text-center">
                        <Button
                          size="sm"
                          variant="secondary"
                          icon={Eye}
                          onClick={() => navigate(`/exceptions/${exc.exceptionId}`)}
                        >
                          Review
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              pagination={pagination}
              onPageChange={(p) => updateFilter("page", p.toString())}
            />
          </div>
        )}
      </Card>
    </div>
  );
}
