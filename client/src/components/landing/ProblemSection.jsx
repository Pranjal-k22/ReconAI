import React from "react";
import { useTheme } from "../../context/ThemeContext";
import { 
  AlertCircle, 
  Clock, 
  XCircle, 
  CheckCircle, 
  Split, 
  FileQuestion, 
  Repeat, 
  ShieldAlert
} from "lucide-react";

export function ProblemSection() {
  const { isNight } = useTheme();

  const problems = [
    {
      icon: FileQuestion,
      title: "Debit without Gateway Capture",
      desc: "Customer claims ₹8,990 was deducted from bank, but gateway marks the transaction failed. Support has no verified proof.",
      tag: "Customer Dispute",
    },
    {
      icon: Clock,
      title: "Gateway 504 Timeout",
      desc: "Synchronous API socket dies mid-flight. Upstream bank switch capture status is indeterminate.",
      tag: "Network Latency",
    },
    {
      icon: XCircle,
      title: "Late Capture on Expired Cart",
      desc: "Order was cancelled due to timeout, but user completed 3DS OTP 4 minutes later. Payment captured on zero inventory.",
      tag: "Race Condition",
    },
    {
      icon: Repeat,
      title: "Duplicate / Out-of-Order Webhooks",
      desc: "Network jitter triggers duplicate retry webhooks, risking double order fulfillment or duplicate ledger credits.",
      tag: "Idempotency Risk",
    },
    {
      icon: Split,
      title: "Payment & Order Amount Mismatch",
      desc: "Cart calculates ₹14,999, but gateway captures ₹12,999 due to an out-of-sync coupon code or currency rounding.",
      tag: "Variance Error",
    },
  ];

  return (
    <section id="problem" className="py-24 relative overflow-hidden text-left border-t transition-colors duration-300"
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
            <AlertCircle className="w-3.5 h-3.5" />
            <span>The Reconciliation Blindspot</span>
          </div>
          <h2
            className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight leading-tight"
            style={{ color: isNight ? "#FAFAF9" : "#181818" }}
          >
            One payment. Multiple systems.{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600">
              Conflicting answers.
            </span>
          </h2>
          <p
            className="text-base sm:text-lg mt-4 leading-relaxed"
            style={{ color: isNight ? "#A3A3A3" : "#66645F" }}
          >
            When payment gateways, merchant inventory databases, customer mobile banks, and webhook queues fall out of sync, traditional operations collapse into days of manual support tickets, dispute losses, and blind refund mistakes.
          </p>
        </div>

        {/* 5 Discrepancy Failure Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-16">
          {problems.map((prob, idx) => {
            const Icon = prob.icon;
            return (
              <div
                key={idx}
                className="group relative p-5 rounded-2xl border transition-all duration-300 hover:-translate-y-1 shadow-md flex flex-col justify-between"
                style={{
                  backgroundColor: isNight ? "#111111" : "#FFFFFF",
                  borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA",
                }}
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <div
                      className="w-9 h-9 rounded-xl border flex items-center justify-center transition-colors text-amber-500"
                      style={{
                        backgroundColor: isNight ? "#191919" : "#F4F1E9",
                        borderColor: isNight ? "rgba(255,255,255,0.1)" : "#E7E3DA",
                      }}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded text-neutral-400 border border-neutral-700/30">
                      #{idx + 1}
                    </span>
                  </div>
                  <h4 className="text-sm font-bold mb-2 leading-snug" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>
                    {prob.title}
                  </h4>
                  <p className="text-xs leading-relaxed" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>
                    {prob.desc}
                  </p>
                </div>
                <div className="mt-4 pt-3 border-t border-neutral-700/20">
                  <span className="text-[10px] font-semibold text-amber-500">
                    {prob.tag}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Comparative Architecture Contrast: Traditional vs ReconAI */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          
          {/* Traditional Workflow */}
          <div
            className="p-7 rounded-2xl border relative"
            style={{
              backgroundColor: isNight ? "rgba(17,17,17,0.7)" : "#FFFFFF",
              borderColor: isNight ? "rgba(239,68,68,0.25)" : "#FCA5A5",
            }}
          >
            <div className="flex items-center justify-between pb-4 border-b mb-6" style={{ borderColor: isNight ? "rgba(239,68,68,0.2)" : "#FEE2E2" }}>
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-rose-500 animate-ping" />
                <h3 className="text-lg font-bold text-rose-500">
                  Traditional Manual Handling
                </h3>
              </div>
              <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-rose-500/10 text-rose-500 border border-rose-500/20">
                3 to 7 Days Latency
              </span>
            </div>

            <div className="space-y-4">
              {[
                { step: "Siloed Disconnect", desc: "Customer calls helpdesk; agent checks static dashboard with no real-time bank switch visibility." },
                { step: "Blind Support Actions", desc: "Support rep triggers blind refund without verifying whether settlement already settled downstream." },
                { step: "Double Refund Leakage", desc: "Customer receives bank auto-reversal AND merchant manual refund, creating financial loss." },
                { step: "Manual Spreadsheets", desc: "Finance teams reconcile end-of-month CSV exports with high error rates and zero cryptographic auditability." },
              ].map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 p-3 rounded-xl border"
                  style={{
                    backgroundColor: isNight ? "#0D0D0D" : "#FEF2F2",
                    borderColor: isNight ? "rgba(239,68,68,0.15)" : "#FEE2E2",
                  }}
                >
                  <XCircle className="w-4 h-4 text-rose-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-semibold" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>{item.step}</div>
                    <div className="text-xs mt-0.5" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* ReconAI Autonomous Workflow */}
          <div
            className="p-7 rounded-2xl border shadow-xl relative"
            style={{
              backgroundColor: isNight ? "rgba(25,25,25,0.7)" : "#FFFFFF",
              borderColor: "rgba(245,158,11,0.35)",
            }}
          >
            <div className="flex items-center justify-between pb-4 border-b mb-6 border-amber-500/20">
              <div className="flex items-center gap-2">
                <span className="w-3 h-3 rounded-full bg-amber-500" />
                <h3 className="text-lg font-bold" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>
                  ReconAI Autonomous Workflow
                </h3>
              </div>
              <span className="text-xs font-mono font-semibold px-2 py-0.5 rounded bg-amber-500/15 text-amber-500 border border-amber-500/30">
                Sub-Second Resolution
              </span>
            </div>

            <div className="space-y-4">
              {[
                { step: "Multi-Source Evidence Assembly", desc: "Automated ingestion pulls gateway raw telemetry, customer claim OCR, merchant OMS orders, and verified webhooks." },
                { step: "Four-Perspective Agent Pipeline", desc: "Customer, Shop, Investigator, and Planner AI independently analyze telemetry without bias." },
                { step: "Deterministic Policy Firewall", desc: "Strict server-side rule engine blocks unauthorized writes and enforces fail-closed financial invariant checks." },
                { step: "Safe-Hold Quarantine & Cryptographic Audit", desc: "Uncertain cases are safely isolated for read-only polling; every action is hashed with SHA-256 for compliance." },
              ].map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-start gap-3 p-3 rounded-xl border border-amber-500/20"
                  style={{
                    backgroundColor: isNight ? "#141414" : "#FEF3C7/30",
                  }}
                >
                  <CheckCircle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-xs font-semibold text-amber-500">{item.step}</div>
                    <div className="text-xs mt-0.5" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>{item.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>

      </div>
    </section>
  );
}
