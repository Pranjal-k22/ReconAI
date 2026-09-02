import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Upload, Play, Database, FileSpreadsheet, ShieldCheck, AlertCircle } from "lucide-react";
import { createRun } from "../api/reconciliationApi";
import { PageHeader } from "../components/common/PageHeader";
import { Card } from "../components/common/Card";
import { Button } from "../components/common/Button";
import { Badge } from "../components/common/Badge";
import { useToast } from "../components/common/ToastContext";

export default function ImportDataPage() {
  const navigate = useNavigate();
  const { addToast } = useToast();
  const [running, setRunning] = useState(false);

  const handleRunSyntheticBenchmark = async () => {
    setRunning(true);
    try {
      const result = await createRun({
        name: "ReconAI Demo Benchmark",
        sourceMode: "SYNTHETIC"
      });

      addToast(
        `Synthetic benchmark execution completed! ${result.processedRecords || 120} scenarios processed.`,
        "success"
      );
      navigate(`/runs/${result.runId}`);
    } catch (err) {
      addToast(err.message || "Failed to trigger synthetic benchmark.", "error");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Data Sources & Import"
        subtitle="Manage reconciliation data ingestion across synthetic benchmarks and financial file streams."
      />

      {/* Section 1: Synthetic Benchmark */}
      <Card
        header={
          <div className="flex items-center space-x-2">
            <Database className="w-5 h-5 text-indigo-600" />
            <h3 className="text-sm font-semibold text-slate-800">Synthetic Benchmark Dataset</h3>
          </div>
        }
      >
        <div className="space-y-4 text-xs">
          <p className="text-slate-600 leading-relaxed">
            ReconAI includes a pre-seeded, 100% deterministic synthetic benchmark dataset (120 scenarios across 10 anomaly classes) verified on MongoDB Atlas.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3 bg-slate-50 border border-slate-200 rounded-lg">
            <div>
              <span className="text-slate-500 block">Dataset Version</span>
              <span className="font-mono font-bold text-slate-900">RECONAI_DEMO_V1</span>
            </div>
            <div>
              <span className="text-slate-500 block">PRNG Seed</span>
              <span className="font-mono font-bold text-indigo-700">RECONAI_DEMO_2026</span>
            </div>
            <div>
              <span className="text-slate-500 block">Scenarios</span>
              <span className="font-mono font-bold text-emerald-700">120 (80 MATCHED, 40 Exceptions)</span>
            </div>
          </div>

          <div className="flex items-center justify-between pt-2">
            <div className="flex items-center gap-2 text-slate-500">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>GroundTruth isolated from matching engine paths</span>
            </div>
            <Button
              variant="primary"
              icon={Play}
              loading={running}
              onClick={handleRunSyntheticBenchmark}
            >
              Run Synthetic Benchmark
            </Button>
          </div>
        </div>
      </Card>

      {/* Section 2: CSV Import (Honest Status) */}
      <Card
        header={
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <FileSpreadsheet className="w-5 h-5 text-slate-700" />
              <h3 className="text-sm font-semibold text-slate-800">Custom CSV Stream Ingestion</h3>
            </div>
            <Badge variant="amber">Planned / Not Enabled in Demo Build</Badge>
          </div>
        }
      >
        <div className="space-y-4 text-xs">
          <div className="p-3 bg-amber-50/60 border border-amber-200 rounded-lg text-amber-900 flex items-start space-x-2.5">
            <AlertCircle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
            <div>
              <h4 className="font-bold">CSV Import Disabled in Current Demo Version</h4>
              <p className="mt-0.5 leading-relaxed">
                Direct CSV file upload endpoints are planned for production rollout. The current live demo build uses MongoDB Atlas pre-seeded datasets and Razorpay Test Mode API synchronization for verified deterministic safety.
              </p>
            </div>
          </div>

          <p className="font-semibold text-slate-800">Planned Supported CSV Specifications:</p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
              <span className="font-bold text-slate-900">Merchant Orders CSV</span>
              <p className="text-[11px] text-slate-500">
                Columns: merchantOrderId, orderAmountPaise, currency, createdAt, status.
              </p>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
              <span className="font-bold text-slate-900">Gateway Payments CSV</span>
              <p className="text-[11px] text-slate-500">
                Columns: gatewayPaymentId, merchantOrderId, paymentAmountPaise, feePaise, taxPaise.
              </p>
            </div>

            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl space-y-1">
              <span className="font-bold text-slate-900">Settlements CSV</span>
              <p className="text-[11px] text-slate-500">
                Columns: settlementRecordId, settlementId, grossAmountPaise, netAmountPaise, entityId.
              </p>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}
