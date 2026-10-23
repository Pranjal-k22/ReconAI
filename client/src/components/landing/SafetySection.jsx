import React from "react";
import { useTheme } from "../../context/ThemeContext";
import { 
  ShieldAlert, 
  Lock, 
  Ban, 
  KeyRound, 
  Database, 
  PowerOff, 
  SearchCheck, 
  History, 
  AlertTriangle 
} from "lucide-react";

export function SafetySection() {
  const { isNight } = useTheme();

  const safetyPillars = [
    {
      icon: KeyRound,
      title: "HMAC Webhook Validation",
      desc: "All incoming gateway events are strictly verified against cryptographic SHA-256 signatures before entering the ingestion queue.",
    },
    {
      icon: Database,
      title: "Tenant Isolation & RBAC",
      desc: "Merchant datasets, ledger entries, and API tokens are cryptographically partitioned with role-based controller permissions.",
    },
    {
      icon: Lock,
      title: "Durable Idempotency",
      desc: "Distributed state locks ensure that network retries, double webhook deliveries, or duplicate clicks never cause multiple charges or refunds.",
    },
    {
      icon: SearchCheck,
      title: "Independent Provider Verification",
      desc: "When webhook payloads are ambiguous, the system polls upstream provider APIs in read-only mode to verify definitive finality.",
    },
    {
      icon: PowerOff,
      title: "Shared Worker Kill Switch",
      desc: "Autonomous reconciliation workers can be halted instantly via distributed kill-switch signals if anomaly thresholds are breached.",
    },
    {
      icon: History,
      title: "Auditable Decision History",
      desc: "Every agent reasoning trace, policy rule ID, and state transition is committed with immutable timestamps and verification hashes.",
    },
  ];

  return (
    <section id="safety" className="py-24 relative overflow-hidden text-left border-t transition-colors duration-300"
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
            <ShieldAlert className="w-3.5 h-3.5" />
            <span>Deterministic Financial Safeguards</span>
          </div>

          <h2
            className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight leading-tight"
            style={{ color: isNight ? "#FAFAF9" : "#181818" }}
          >
            Automation should know{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600">
              when to stop.
            </span>
          </h2>

          <p
            className="text-base sm:text-lg mt-4 leading-relaxed"
            style={{ color: isNight ? "#A3A3A3" : "#66645F" }}
          >
            Uncertainty is not permission. In high-value payment infrastructure, when evidence is missing, gateway states time out, or policy limits are absent, ReconAI rejects hazardous automated guesses and immediately triggers Safe-Hold.
          </p>
        </div>

        {/* Featured Showcase: Safe-Hold Case Panel */}
        <div
          className="rounded-2xl border p-6 sm:p-8 mb-16 shadow-xl relative"
          style={{
            backgroundColor: isNight ? "rgba(17,17,17,0.85)" : "#FFFFFF",
            borderColor: "rgba(245,158,11,0.35)",
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-4 pb-6 border-b" style={{ borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA" }}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-500">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-amber-500 font-bold">CASE STUDY: #RC-41092</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/40">
                    SAFE-HOLD ASSIGNED
                  </span>
                </div>
                <h3 className="text-lg font-bold mt-0.5" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>
                  Late Capture After Order Cancellation
                </h3>
              </div>
            </div>

            <div className="text-right">
              <span className="text-xs font-mono text-neutral-400">Case Valuation</span>
              <div className="text-xl font-bold font-mono text-amber-500">₹18,500.00 INR</div>
            </div>
          </div>

          {/* Safe-Hold Details Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 my-6">
            <div className="p-4 rounded-xl border" style={{ backgroundColor: isNight ? "#0C0C0C" : "#FAFAF7", borderColor: isNight ? "rgba(255,255,255,0.06)" : "#E7E3DA" }}>
              <span className="text-[10px] font-mono text-neutral-400 uppercase">Payment Status</span>
              <div className="text-base font-bold text-emerald-500 mt-1 flex items-center gap-1.5">
                <span>Captured</span>
                <span className="text-xs font-mono font-normal text-neutral-500">(Gateway)</span>
              </div>
              <p className="text-[11px] text-neutral-400 mt-1">₹18,500 debited via Razorpay</p>
            </div>

            <div className="p-4 rounded-xl border" style={{ backgroundColor: isNight ? "#0C0C0C" : "#FAFAF7", borderColor: isNight ? "rgba(255,255,255,0.06)" : "#E7E3DA" }}>
              <span className="text-[10px] font-mono text-neutral-400 uppercase">Order Status</span>
              <div className="text-base font-bold text-rose-500 mt-1 flex items-center gap-1.5">
                <span>Cancelled</span>
                <span className="text-xs font-mono font-normal text-neutral-500">(Merchant OMS)</span>
              </div>
              <p className="text-[11px] text-neutral-400 mt-1">Checkout cart expired at 14:00</p>
            </div>

            <div className="p-4 rounded-xl border" style={{ backgroundColor: isNight ? "#0C0C0C" : "#FAFAF7", borderColor: "rgba(245,158,11,0.25)" }}>
              <span className="text-[10px] font-mono text-amber-500 uppercase">Automated Actions</span>
              <div className="text-base font-bold text-amber-500 mt-1 flex items-center gap-1.5">
                <Ban className="w-4 h-4 text-amber-500" />
                <span>BLOCKED</span>
              </div>
              <p className="text-[11px] text-neutral-400 mt-1">Auto-refund & Reopening locked</p>
            </div>

            <div className="p-4 rounded-xl border" style={{ backgroundColor: isNight ? "#0C0C0C" : "#FAFAF7", borderColor: "rgba(245,158,11,0.25)" }}>
              <span className="text-[10px] font-mono text-amber-500 uppercase">Permitted Next Step</span>
              <div className="text-xs font-bold text-amber-500 mt-1 leading-snug">
                Read-Only Evidence Verification
              </div>
              <p className="text-[11px] text-neutral-400 mt-1">Authorized human controller sign-off</p>
            </div>
          </div>

          {/* Explanation Banner */}
          <div
            className="p-4 rounded-xl border text-xs leading-relaxed flex items-start gap-3"
            style={{
              backgroundColor: isNight ? "rgba(245,158,11,0.08)" : "#FEF3C7/50",
              borderColor: "rgba(245,158,11,0.25)",
              color: isNight ? "#D4D4D4" : "#404040",
            }}
          >
            <Lock className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <div>
              <span className="font-semibold text-amber-500">Why Safe-Hold intervened: </span>
              Order was cancelled prior to 3DS completion, and warehouse stock was reallocated. Reopening the order risks a physical fulfillment failure. Executing an autonomous refund without checking pending manual support requests risks a double disbursement. ReconAI halts all mutations and queues the case for authorized operator resolution.
            </div>
          </div>
        </div>

        {/* 6 Core Safety Pillars */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {safetyPillars.map((pillar, idx) => {
            const Icon = pillar.icon;
            return (
              <div
                key={idx}
                className="p-6 rounded-2xl border transition-all duration-300 shadow-md flex flex-col justify-between"
                style={{
                  backgroundColor: isNight ? "#111111" : "#FFFFFF",
                  borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA",
                }}
              >
                <div>
                  <div
                    className="w-10 h-10 rounded-xl border flex items-center justify-center text-amber-500 mb-4"
                    style={{
                      backgroundColor: isNight ? "#191919" : "#F4F1E9",
                      borderColor: isNight ? "rgba(255,255,255,0.1)" : "#E7E3DA",
                    }}
                  >
                    <Icon className="w-5 h-5" />
                  </div>
                  <h4 className="text-base font-bold mb-2" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>
                    {pillar.title}
                  </h4>
                  <p className="text-xs leading-relaxed" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>
                    {pillar.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

      </div>
    </section>
  );
}
