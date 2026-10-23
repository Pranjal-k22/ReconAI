import React, { useState } from "react";
import { useTheme } from "../../context/ThemeContext";
import { 
  History, 
  Copy, 
  Check, 
  Terminal, 
  AlertCircle 
} from "lucide-react";

export function AuditSection() {
  const { isNight } = useTheme();
  const [copied, setCopied] = useState(false);

  const auditEvents = [
    {
      step: "01",
      title: "Source Event Received & HMAC Verified",
      time: "2026-10-23T13:45:00.120Z",
      hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      detail: "Gateway webhook payment.captured ingested. Signature validated against tenant secret.",
      actor: "Gateway Webhook Listener",
    },
    {
      step: "02",
      title: "Evidence Dossier Assembled",
      time: "2026-10-23T13:45:01.450Z",
      hash: "8f434346648f6b96df89dda901c5176b10a6d83961dd3c1ac88b59b2dc327aa4",
      detail: "Correlated merchant OMS order #ORD-9821, HDFC bank debit SMS, and Razorpay transaction log.",
      actor: "Evidence Orchestrator",
    },
    {
      step: "03",
      title: "Four-Agent Cognitive Pipeline Completed",
      time: "2026-10-23T13:45:02.890Z",
      hash: "5e884898da28047151d0e56f8dc6292773603d0d6aabbdd62a11ef721d1542d8",
      detail: "Customer AI (0.94), Shop AI (0.95), Investigator AI (0.91), Planner AI (0.93) committed findings.",
      actor: "Agent Controller",
    },
    {
      step: "04",
      title: "Deterministic Policy Rule Evaluated",
      time: "2026-10-23T13:45:03.110Z",
      hash: "4b227777d4dd1fc61c6f884f48641d02b4d121d3fd328cb08b5531fcacdabf8a",
      detail: "Rule PR-04 (Indeterminate Gateway Guard) applied. Provider status uncertain; safe-hold assigned.",
      actor: "Server Policy Guard",
    },
    {
      step: "05",
      title: "Safe-Hold Quarantine & Read-Only Poll Queued",
      time: "2026-10-23T13:45:03.500Z",
      hash: "ef2d127de37b942baad06145e54b0c619a1f22327b2ebbcfbec78f5564afe39d",
      detail: "Mutations locked. Background worker scheduled read-only provider polling at T+300s.",
      actor: "Execution Worker",
    },
    {
      step: "06",
      title: "Decision Record Committed to Ledger",
      time: "2026-10-23T13:45:04.000Z",
      hash: "9b12e3a890f1d072bb45e99ca102ee8199201f849b29104dd281aa098192318a",
      detail: "Immutable audit event written to append-only MongoDB cluster with cryptographic hash pointer.",
      actor: "Audit Ledger Daemon",
    },
  ];

  const jsonSnippet = {
    case_id: "RC-84920",
    tenant_id: "TN-981",
    currency: "INR",
    discrepancy_amount: "50000.00",
    redacted_customer_ref: "CUST_****_9921",
    policy_version: "2026.10-STABLE",
    applied_rule_id: "PR-04_INDETERMINATE_GATEWAY_GUARD",
    outcome: "SAFE_HOLD",
    automated_refund_state: "BLOCKED_FAIL_CLOSED",
    next_step: "READ_ONLY_STATUS_POLL_SCHEDULED",
    merkle_root_hash: "sha256:9b12e3a890f1d072bb45e99ca102ee81",
    timestamp: "2026-10-23T13:45:04.000Z",
    cryptographic_integrity_verified: true,
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(jsonSnippet, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <section id="audit" className="py-24 relative overflow-hidden text-left border-t transition-colors duration-300"
      style={{
        backgroundColor: isNight ? "#080808" : "#FAFAF7",
        borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA",
      }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* Section Header */}
        <div className="max-w-3xl mb-16">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider mb-3 border"
            style={{
              backgroundColor: isNight ? "rgba(17,17,17,0.8)" : "rgba(255,255,255,0.9)",
              color: isNight ? "#FBBF24" : "#D97706",
              borderColor: isNight ? "rgba(245,158,11,0.3)" : "rgba(217,119,6,0.3)",
            }}
          >
            <History className="w-3.5 h-3.5" />
            <span>Cryptographic Traceability</span>
          </div>

          <h2
            className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight leading-tight"
            style={{ color: isNight ? "#FAFAF9" : "#181818" }}
          >
            Every critical decision{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600">
              should be explainable.
            </span>
          </h2>

          <p className="text-base sm:text-lg mt-4 leading-relaxed" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>
            No black-box decisions. Every webhook receipt, evidence query, agent reasoning trace, and deterministic policy rule evaluation is permanently recorded with cryptographic SHA-256 hashes.
          </p>
        </div>

        {/* 2-Column Grid: Timeline vs JSON Inspector */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          
          {/* Left Column: Visual Audit Timeline (Cols 1-7) */}
          <div className="lg:col-span-7 space-y-4">
            <div className="flex items-center justify-between pb-3 border-b text-xs font-mono text-neutral-400" style={{ borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA" }}>
              <span>CASE #RC-84920 LIFECYCLE AUDIT TRAIL</span>
              <span className="text-emerald-500 font-bold">ALL HASHES VERIFIED</span>
            </div>

            <div className="space-y-3">
              {auditEvents.map((item, idx) => (
                <div
                  key={idx}
                  className="p-4 rounded-xl border transition-all duration-200"
                  style={{
                    backgroundColor: isNight ? "#111111" : "#FFFFFF",
                    borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA",
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-500 font-mono text-[10px] font-bold">
                        {item.step}
                      </span>
                      <h4 className="text-xs sm:text-sm font-bold" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>
                        {item.title}
                      </h4>
                    </div>
                    <span className="text-[10px] font-mono text-neutral-400 flex-shrink-0">
                      {item.time.split("T")[1].replace("Z", "")}
                    </span>
                  </div>

                  <p className="text-xs mt-2 leading-relaxed" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>
                    {item.detail}
                  </p>

                  <div className="mt-2.5 pt-2 border-t border-neutral-700/20 flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono">
                    <span className="text-neutral-400">Actor: <span style={{ color: isNight ? "#FAFAF9" : "#181818" }}>{item.actor}</span></span>
                    <span className="text-amber-500 truncate max-w-[280px]">
                      hash: {item.hash.substring(0, 18)}...
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Right Column: Floating Glass JSON Inspection Panel (Cols 8-12) */}
          <div className="lg:col-span-5 sticky top-24">
            <div
              className="rounded-2xl border p-5 shadow-2xl space-y-4"
              style={{
                backgroundColor: isNight ? "rgba(17,17,17,0.9)" : "#FFFFFF",
                borderColor: "rgba(245,158,11,0.35)",
              }}
            >
              <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA" }}>
                <div className="flex items-center gap-2 text-xs font-mono text-amber-500 font-bold">
                  <Terminal className="w-4 h-4 text-amber-500" />
                  <span>AUDIT_RECORD_INSPECTION.JSON</span>
                </div>
                <button
                  onClick={handleCopy}
                  className="px-2.5 py-1 rounded-md border text-[11px] font-mono flex items-center gap-1.5 transition-colors cursor-pointer"
                  style={{
                    backgroundColor: isNight ? "#1C1C1C" : "#F4F1E9",
                    borderColor: isNight ? "rgba(255,255,255,0.1)" : "#E7E3DA",
                    color: isNight ? "#FAFAF9" : "#181818",
                  }}
                  title="Copy JSON Payload"
                >
                  {copied ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                  <span>{copied ? "Copied" : "Copy"}</span>
                </button>
              </div>

              {/* JSON code view */}
              <pre
                className="p-3.5 rounded-xl border font-mono text-[11px] overflow-x-auto leading-relaxed max-h-[380px]"
                style={{
                  backgroundColor: isNight ? "#0C0C0C" : "#FAFAF7",
                  borderColor: isNight ? "rgba(255,255,255,0.06)" : "#E7E3DA",
                  color: isNight ? "#FDE68A" : "#B45309",
                }}
              >
                {JSON.stringify(jsonSnippet, null, 2)}
              </pre>

              {/* Scope & Redaction Disclaimer */}
              <div
                className="p-3 rounded-xl border text-[11px] leading-snug flex items-start gap-2"
                style={{
                  backgroundColor: isNight ? "#141414" : "#F4F1E9",
                  borderColor: isNight ? "rgba(255,255,255,0.06)" : "#E7E3DA",
                  color: isNight ? "#A3A3A3" : "#66645F",
                }}
              >
                <AlertCircle className="w-4 h-4 text-neutral-400 flex-shrink-0 mt-0.5" />
                <span>
                  Personal information, API bearer keys, and bank account numbers are redacted at ingestion. Cryptographic hashes guarantee audit sequence integrity but do not independently verify external banking claims.
                </span>
              </div>
            </div>
          </div>

        </div>

      </div>
    </section>
  );
}
