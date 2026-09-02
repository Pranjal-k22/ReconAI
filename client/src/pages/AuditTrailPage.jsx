import React, { useEffect, useState, useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { ScrollText, Filter, Eye, RefreshCw, Lock, X } from "lucide-react";
import { getAuditEvents, getAuditEvent } from "../api/auditApi";
import { PageHeader } from "../components/common/PageHeader";
import { Card } from "../components/common/Card";
import { Button } from "../components/common/Button";
import { Badge } from "../components/common/Badge";
import { LoadingState } from "../components/common/LoadingState";
import { ErrorState } from "../components/common/ErrorState";
import { EmptyState } from "../components/common/EmptyState";
import { Pagination } from "../components/common/Pagination";
import { formatDate } from "../utils/date";
import { formatEnumLabel } from "../utils/enum";

export default function AuditTrailPage() {
  const [searchParams, setSearchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const [events, setEvents] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 15, totalRecords: 0, totalPages: 1 });

  // Event Inspect Modal
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [modalLoading, setModalLoading] = useState(false);

  // Filters from URL
  const runIdFilter = searchParams.get("runId") || "";
  const actionFilter = searchParams.get("action") || "";
  const entityTypeFilter = searchParams.get("entityType") || "";
  const actorTypeFilter = searchParams.get("actorType") || "";
  const currentPage = parseInt(searchParams.get("page") || "1", 10);

  const fetchAuditLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAuditEvents({
        runId: runIdFilter,
        action: actionFilter,
        entityType: entityTypeFilter,
        actorType: actorTypeFilter,
        page: currentPage,
        limit: 15
      });

      setEvents(data.events || []);
      setPagination(data.pagination || { page: 1, limit: 15, totalRecords: 0, totalPages: 1 });
    } catch (err) {
      setError(err.message || "Failed to query audit trail.");
    } finally {
      setLoading(false);
    }
  }, [runIdFilter, actionFilter, entityTypeFilter, actorTypeFilter, currentPage]);

  useEffect(() => {
    fetchAuditLogs();
  }, [fetchAuditLogs]);

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

  const handleInspectEvent = async (eventId) => {
    setModalLoading(true);
    try {
      const fullEvent = await getAuditEvent(eventId);
      setSelectedEvent(fullEvent);
    } catch (err) {
      // Fallback to item in array if fetch single fails
      const found = events.find((e) => e.eventId === eventId);
      setSelectedEvent(found || null);
    } finally {
      setModalLoading(false);
    }
  };

  const getActionBadgeVariant = (action) => {
    if (action?.includes("COMPLETED") || action === "MATCH_CREATED") return "emerald";
    if (action?.includes("HUMAN")) return "indigo";
    if (action?.includes("AI")) return "violet";
    if (action?.includes("EXCEPTION")) return "amber";
    if (action?.includes("FAILED")) return "rose";
    return "default";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Audit Trail"
        subtitle="Immutable append-only record of system operations, human reviews, and AI investigations."
        action={
          <Button variant="secondary" icon={RefreshCw} onClick={fetchAuditLogs}>
            Refresh
          </Button>
        }
      />

      {/* Immutability Banner */}
      <div className="p-3 bg-slate-900 text-slate-200 border border-slate-800 rounded-xl flex items-center justify-between text-xs">
        <div className="flex items-center space-x-2">
          <Lock className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span>Audit events are append-only and cannot be edited or deleted from ReconAI.</span>
        </div>
        <span className="text-[10px] text-slate-400 font-mono">RECONAI_AUDIT_V1</span>
      </div>

      {/* Filter Bar */}
      <Card padding="p-4">
        <div className="flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5 text-slate-500 font-semibold uppercase">
            <Filter className="w-4 h-4" />
            <span>Filters:</span>
          </div>

          {/* Action Filter */}
          <select
            value={actionFilter}
            onChange={(e) => updateFilter("action", e.target.value)}
            className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
          >
            <option value="">All Actions</option>
            <option value="RECONCILIATION_STARTED">Reconciliation Started</option>
            <option value="MATCH_CREATED">Match Created</option>
            <option value="EXCEPTION_CREATED">Exception Created</option>
            <option value="RECONCILIATION_COMPLETED">Reconciliation Completed</option>
            <option value="AI_INVESTIGATION_REQUESTED">AI Investigation Requested</option>
            <option value="AI_INVESTIGATION_COMPLETED">AI Investigation Completed</option>
            <option value="AI_INVESTIGATION_FAILED">AI Investigation Failed</option>
            <option value="HUMAN_DECISION">Human Decision</option>
            <option value="RAZORPAY_SYNC_STARTED">Razorpay Sync Started</option>
            <option value="RAZORPAY_SYNC_COMPLETED">Razorpay Sync Completed</option>
          </select>

          {/* Entity Type Filter */}
          <select
            value={entityTypeFilter}
            onChange={(e) => updateFilter("entityType", e.target.value)}
            className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
          >
            <option value="">All Entities</option>
            <option value="ReconciliationRun">ReconciliationRun</option>
            <option value="ReconciliationResult">ReconciliationResult</option>
            <option value="ExceptionCase">ExceptionCase</option>
            <option value="RazorpaySyncBatch">RazorpaySyncBatch</option>
          </select>

          {/* Actor Type Filter */}
          <select
            value={actorTypeFilter}
            onChange={(e) => updateFilter("actorType", e.target.value)}
            className="border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900"
          >
            <option value="">All Actors</option>
            <option value="SYSTEM">System</option>
            <option value="HUMAN">Human</option>
            <option value="AI">AI</option>
          </select>

          {(actionFilter || entityTypeFilter || actorTypeFilter || runIdFilter) && (
            <Button size="sm" variant="ghost" onClick={clearFilters}>
              Reset Filters
            </Button>
          )}
        </div>
      </Card>

      {/* Audit Log Table */}
      <Card padding="p-0">
        {loading ? (
          <LoadingState message="Querying append-only audit trail..." />
        ) : error ? (
          <ErrorState message={error} onRetry={fetchAuditLogs} />
        ) : events.length === 0 ? (
          <EmptyState
            title="No Audit Log Events Found"
            description="No audit events match the selected criteria."
            icon={ScrollText}
          />
        ) : (
          <div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase tracking-wider font-semibold">
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3">Actor</th>
                    <th className="px-4 py-3">Action</th>
                    <th className="px-4 py-3">Entity</th>
                    <th className="px-4 py-3">Run ID</th>
                    <th className="px-4 py-3">Reason / Details</th>
                    <th className="px-4 py-3 text-center">Inspect</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {events.map((evt) => (
                    <tr key={evt.eventId} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-4 py-3 font-mono text-slate-600 whitespace-nowrap">
                        {formatDate(evt.timestamp)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-slate-800">{evt.actorId}</div>
                        <div className="text-[10px] text-slate-500">{evt.actorType}</div>
                      </td>
                      <td className="px-4 py-3">
                        <Badge variant={getActionBadgeVariant(evt.action)}>
                          {formatEnumLabel(evt.action)}
                        </Badge>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-mono text-slate-800">{evt.entityId || "—"}</div>
                        <div className="text-[10px] text-slate-500">{evt.entityType}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-slate-600">
                        {evt.runId || "—"}
                      </td>
                      <td className="px-4 py-3 text-slate-700 max-w-xs truncate">
                        {evt.reason || evt.metadata?.summary || "—"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={Eye}
                          onClick={() => handleInspectEvent(evt.eventId)}
                        >
                          Payload
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

      {/* Inspect Event Modal */}
      {selectedEvent && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
          <div className="bg-white border border-slate-200 rounded-2xl p-6 max-w-2xl w-full shadow-2xl space-y-4 text-xs max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Audit Event Payload: {selectedEvent.eventId}
                </h3>
                <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                  Action: {selectedEvent.action} • Timestamp: {formatDate(selectedEvent.timestamp)}
                </p>
              </div>
              <button
                onClick={() => setSelectedEvent(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-900 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 font-mono text-[11px]">
              {selectedEvent.reason && (
                <div>
                  <span className="font-sans font-semibold text-slate-700 block mb-1">Reason:</span>
                  <div className="p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-slate-800">
                    {selectedEvent.reason}
                  </div>
                </div>
              )}

              {selectedEvent.metadata && (
                <div>
                  <span className="font-sans font-semibold text-slate-700 block mb-1">Metadata Payload:</span>
                  <pre className="p-3 bg-slate-950 text-slate-200 rounded-lg overflow-x-auto">
                    {JSON.stringify(selectedEvent.metadata, null, 2)}
                  </pre>
                </div>
              )}

              {selectedEvent.before && (
                <div>
                  <span className="font-sans font-semibold text-slate-700 block mb-1">Before State:</span>
                  <pre className="p-3 bg-slate-900 text-amber-200 rounded-lg overflow-x-auto">
                    {JSON.stringify(selectedEvent.before, null, 2)}
                  </pre>
                </div>
              )}

              {selectedEvent.after && (
                <div>
                  <span className="font-sans font-semibold text-slate-700 block mb-1">After State:</span>
                  <pre className="p-3 bg-slate-900 text-emerald-200 rounded-lg overflow-x-auto">
                    {JSON.stringify(selectedEvent.after, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 flex justify-end">
              <Button size="sm" variant="secondary" onClick={() => setSelectedEvent(null)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
