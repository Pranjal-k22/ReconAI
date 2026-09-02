import React, { useEffect, useState, useCallback } from "react";
import { CreditCard, ShieldCheck, AlertCircle, RefreshCw, Layers } from "lucide-react";
import { getIntegrationStatus } from "../api/integrationApi";
import { syncPayments, syncSettlements } from "../api/razorpayApi";
import { PageHeader } from "../components/common/PageHeader";
import { Card } from "../components/common/Card";
import { Button } from "../components/common/Button";
import { Badge } from "../components/common/Badge";
import { LoadingState } from "../components/common/LoadingState";
import { DEFAULT_ACTOR_ID } from "../constants/app";
import { useToast } from "../components/common/ToastContext";

export default function RazorpaySyncPage() {
  const { addToast } = useToast();

  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState(null);

  // Sync Form States
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [paymentSyncing, setPaymentSyncing] = useState(false);
  const [paymentSummary, setPaymentSummary] = useState(null);

  const [settlementYear, setSettlementYear] = useState(new Date().getFullYear());
  const [settlementMonth, setSettlementMonth] = useState(new Date().getMonth() + 1);
  const [settlementDay, setSettlementDay] = useState("");
  const [settlementSyncing, setSettlementSyncing] = useState(false);
  const [settlementSummary, setSettlementSummary] = useState(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getIntegrationStatus();
      setStatus(data);
    } catch (err) {
      // Safe fallback
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  const isConfigured = status?.razorpay?.configured ?? false;

  const handleSyncPayments = async () => {
    setPaymentSyncing(true);
    setPaymentSummary(null);
    try {
      const fromTimestamp = fromDate ? Math.floor(new Date(fromDate).getTime() / 1000) : undefined;
      const toTimestamp = toDate ? Math.floor(new Date(toDate).getTime() / 1000) : undefined;

      const summary = await syncPayments({
        from: fromTimestamp,
        to: toTimestamp,
        actorId: DEFAULT_ACTOR_ID
      });

      setPaymentSummary(summary);
      if (summary.totalFetched === 0) {
        addToast("Sync completed successfully. No Test Mode payments were returned.", "info");
      } else {
        addToast(
          `Payments synced! Fetched: ${summary.totalFetched}, Inserted: ${summary.insertedCount}`,
          "success"
        );
      }
    } catch (err) {
      addToast(err.message || "Payment synchronization failed.", "error");
    } finally {
      setPaymentSyncing(false);
    }
  };

  const handleSyncSettlements = async () => {
    setSettlementSyncing(true);
    setSettlementSummary(null);
    try {
      const summary = await syncSettlements({
        year: parseInt(settlementYear, 10),
        month: parseInt(settlementMonth, 10),
        day: settlementDay ? parseInt(settlementDay, 10) : undefined,
        actorId: DEFAULT_ACTOR_ID
      });

      setSettlementSummary(summary);
      if (summary.totalFetched === 0) {
        addToast("Sync completed successfully. No Test Mode settlements were returned.", "info");
      } else {
        addToast(
          `Settlements synced! Fetched: ${summary.totalFetched}, Inserted: ${summary.insertedCount}`,
          "success"
        );
      }
    } catch (err) {
      addToast(err.message || "Settlement synchronization failed.", "error");
    } finally {
      setSettlementSyncing(false);
    }
  };

  if (loading) {
    return <LoadingState message="Checking Razorpay Test Mode configuration status..." />;
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Razorpay Test Mode Sync"
        subtitle="Read-only provider synchronization for live gateway payment & settlement records."
      />

      {/* Safety Banner */}
      <div className="p-4 bg-indigo-950/90 border border-indigo-700/50 rounded-xl text-indigo-100 flex items-start space-x-3 shadow-md">
        <ShieldCheck className="w-6 h-6 text-indigo-300 flex-shrink-0 mt-0.5" />
        <div className="text-xs">
          <h4 className="text-sm font-bold text-white uppercase tracking-wider">
            Razorpay Test Mode — Read-Only Guard Active
          </h4>
          <p className="mt-1 text-indigo-200 leading-relaxed">
            Read-only synchronization. No capture, refund, payout or transfer operations are performed. Customer PII (email, contact, VPA) is automatically stripped before saving to database.
          </p>
        </div>
      </div>

      {/* Configuration State Card */}
      {!isConfigured ? (
        <Card padding="p-5">
          <div className="flex items-start space-x-3">
            <AlertCircle className="w-6 h-6 text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="text-xs space-y-1">
              <h4 className="font-bold text-slate-900 text-sm">
                Razorpay Test Mode is not configured
              </h4>
              <p className="text-slate-600 leading-relaxed">
                Add server-side <code className="font-mono text-slate-900 bg-slate-100 px-1 py-0.5 rounded">RAZORPAY_KEY_ID</code> and <code className="font-mono text-slate-900 bg-slate-100 px-1 py-0.5 rounded">RAZORPAY_KEY_SECRET</code> to your server environment (<code className="font-mono text-slate-900">server/.env</code>) to enable live Test Mode synchronization.
              </p>
              <p className="text-slate-500 pt-1 italic">
                Credentials are never entered or exposed in the browser client.
              </p>
            </div>
          </div>
        </Card>
      ) : (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 font-medium flex items-center justify-between">
          <span>Razorpay Test Mode API key detected on backend. Ready for synchronization.</span>
          <Badge variant="emerald">Configured</Badge>
        </div>
      )}

      {/* Sync Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Payment Sync Card */}
        <Card
          header={
            <div className="flex items-center space-x-2">
              <CreditCard className="w-5 h-5 text-indigo-600" />
              <h3 className="text-sm font-semibold text-slate-800">Sync Gateway Payments</h3>
            </div>
          }
        >
          <div className="space-y-4 text-xs">
            <p className="text-slate-600">
              Fetch payments from Razorpay <code className="font-mono bg-slate-100 px-1 rounded">/v1/payments</code> endpoint with count/skip pagination.
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-slate-600 font-medium mb-1">From Date</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => setFromDate(e.target.value)}
                  disabled={!isConfigured || paymentSyncing}
                  className="w-full p-2 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-50"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">To Date</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => setToDate(e.target.value)}
                  disabled={!isConfigured || paymentSyncing}
                  className="w-full p-2 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-50"
                />
              </div>
            </div>

            <Button
              variant="primary"
              icon={RefreshCw}
              loading={paymentSyncing}
              disabled={!isConfigured}
              onClick={handleSyncPayments}
              className="w-full"
            >
              Sync Payments
            </Button>

            {paymentSummary && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5 font-mono text-[11px]">
                <div className="flex justify-between font-bold text-slate-900 border-b border-slate-200 pb-1">
                  <span>Batch ID</span>
                  <span>{paymentSummary.batchId}</span>
                </div>
                <div className="flex justify-between text-slate-700">
                  <span>Total Fetched</span>
                  <span>{paymentSummary.totalFetched}</span>
                </div>
                <div className="flex justify-between text-emerald-700 font-semibold">
                  <span>Inserted</span>
                  <span>{paymentSummary.insertedCount}</span>
                </div>
                <div className="flex justify-between text-blue-700">
                  <span>Updated</span>
                  <span>{paymentSummary.updatedCount}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>Duration</span>
                  <span>{paymentSummary.durationMs}ms</span>
                </div>
              </div>
            )}
          </div>
        </Card>

        {/* Settlement Sync Card */}
        <Card
          header={
            <div className="flex items-center space-x-2">
              <Layers className="w-5 h-5 text-indigo-600" />
              <h3 className="text-sm font-semibold text-slate-800">Sync Settlement Reconciliation</h3>
            </div>
          }
        >
          <div className="space-y-4 text-xs">
            <p className="text-slate-600">
              Fetch settlement breakdown from <code className="font-mono bg-slate-100 px-1 rounded">/v1/settlements/recon/combined</code>.
            </p>

            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-slate-600 font-medium mb-1">Year</label>
                <input
                  type="number"
                  value={settlementYear}
                  onChange={(e) => setSettlementYear(e.target.value)}
                  disabled={!isConfigured || settlementSyncing}
                  className="w-full p-2 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-50 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">Month</label>
                <input
                  type="number"
                  min="1"
                  max="12"
                  value={settlementMonth}
                  onChange={(e) => setSettlementMonth(e.target.value)}
                  disabled={!isConfigured || settlementSyncing}
                  className="w-full p-2 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-50 font-mono"
                />
              </div>

              <div>
                <label className="block text-slate-600 font-medium mb-1">Day (Optional)</label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  placeholder="All"
                  value={settlementDay}
                  onChange={(e) => setSettlementDay(e.target.value)}
                  disabled={!isConfigured || settlementSyncing}
                  className="w-full p-2 border border-slate-300 rounded-lg text-xs bg-white focus:outline-none focus:ring-2 focus:ring-slate-900 disabled:opacity-50 font-mono"
                />
              </div>
            </div>

            <Button
              variant="primary"
              icon={RefreshCw}
              loading={settlementSyncing}
              disabled={!isConfigured}
              onClick={handleSyncSettlements}
              className="w-full"
            >
              Sync Settlements
            </Button>

            {settlementSummary && (
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg space-y-1.5 font-mono text-[11px]">
                <div className="flex justify-between font-bold text-slate-900 border-b border-slate-200 pb-1">
                  <span>Batch ID</span>
                  <span>{settlementSummary.batchId}</span>
                </div>
                <div className="flex justify-between text-slate-700">
                  <span>Total Fetched</span>
                  <span>{settlementSummary.totalFetched}</span>
                </div>
                <div className="flex justify-between text-emerald-700 font-semibold">
                  <span>Inserted</span>
                  <span>{settlementSummary.insertedCount}</span>
                </div>
                <div className="flex justify-between text-blue-700">
                  <span>Updated</span>
                  <span>{settlementSummary.updatedCount}</span>
                </div>
                <div className="flex justify-between text-slate-500">
                  <span>Duration</span>
                  <span>{settlementSummary.durationMs}ms</span>
                </div>
              </div>
            )}
          </div>
        </Card>
      </div>

      {/* Sync vs Reconciliation Safety Warning */}
      <Card padding="p-4">
        <div className="flex items-start space-x-3 text-xs text-slate-600">
          <AlertCircle className="w-5 h-5 text-indigo-600 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="font-bold text-slate-800">Sync vs Reconciliation Safety Guard</h4>
            <p className="mt-0.5 leading-relaxed">
              Razorpay sync stores provider records in MongoDB but does not automatically start reconciliation execution. ReconAI requires explicit merchant-order mapping before Razorpay records can be reconciled safely.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
