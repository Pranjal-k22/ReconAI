import React from "react";
import { useTheme } from "../../context/ThemeContext";
import { 
  Network, 
  Server, 
  Database, 
  Layers, 
  Cpu, 
  ShieldCheck, 
  GitBranch, 
  History, 
  Lock, 
  PowerOff, 
  AlertTriangle 
} from "lucide-react";

export function ArchitectureSection() {
  const { isNight } = useTheme();

  const pipelineNodes = [
    {
      step: "01",
      title: "Gateway & Webhook Ingestion",
      sub: "Razorpay / Stripe / Callbacks",
      desc: "HMAC SHA-256 signature verification and payload buffering before any database mutation.",
      icon: Network,
      tag: "Verified Ingress",
    },
    {
      step: "02",
      title: "Express API & Tenant Auth",
      sub: "RBAC & Multi-Tenant Isolation",
      desc: "Authenticated controller layer enforcing tenant data boundaries and JWT session integrity.",
      icon: Server,
      tag: "Tenant Guard",
    },
    {
      step: "03",
      title: "MongoDB Event Sourcing",
      sub: "Payment Cases & Lifecycle Events",
      desc: "Append-only storage for immutable transaction state transitions and dispute references.",
      icon: Database,
      tag: "Data Core",
    },
    {
      step: "04",
      title: "Evidence Assembly Controller",
      sub: "OMS + Telemetry + Claims",
      desc: "Secure orchestrator querying merchant order DB, customer claim OCR, and provider logs.",
      icon: Layers,
      tag: "Dossier Engine",
    },
    {
      step: "05",
      title: "Four-Agent AI Pipeline",
      sub: "Customer, Shop, Investigator, Planner",
      desc: "Domain-isolated agents performing cognitive analysis in a sequential, controller-mediated pipeline.",
      icon: Cpu,
      tag: "Cognitive Inference",
    },
    {
      step: "06",
      title: "Deterministic Policy Engine",
      sub: "Server-Side Financial Rules",
      desc: "Strict mathematical invariants, fail-closed thresholds, approved refund limits, and idempotency locks.",
      icon: ShieldCheck,
      tag: "Governance Firewall",
    },
    {
      step: "07",
      title: "Execution & Safe-Hold Routing",
      sub: "Read-Only Polling / Quarantine",
      desc: "Dispatches safe ledger entries, triggers read-only provider status polling, or locks into Safe-Hold.",
      icon: GitBranch,
      tag: "Safe Execution",
    },
    {
      step: "08",
      title: "Audit Ledger & Dashboards",
      sub: "Cryptographic SHA-256 Chain",
      desc: "Committed decision record pushed to internal controller dashboards and client webhooks.",
      icon: History,
      tag: "Immutable Ledger",
    },
  ];

  return (
    <section id="architecture" className="py-24 relative overflow-hidden text-left border-t transition-colors duration-300"
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
            <Server className="w-3.5 h-3.5" />
            <span>End-to-End System Topology</span>
          </div>

          <h2
            className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight leading-tight"
            style={{ color: isNight ? "#FAFAF9" : "#181818" }}
          >
            Engineered for resilience,{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600">
              isolation, and auditability.
            </span>
          </h2>

          <p className="text-base sm:text-lg mt-4 leading-relaxed" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>
            ReconAI operates as a controller-mediated pipeline. AI models never talk directly to external payment gateways or mutative bank APIs. All transactions flow through deterministic server-side guards.
          </p>
        </div>

        {/* 8-Stage Sequential Architecture Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-16">
          {pipelineNodes.map((node, idx) => {
            const Icon = node.icon;
            return (
              <div
                key={idx}
                className="p-5 rounded-2xl border transition-all duration-300 flex flex-col justify-between shadow-md group"
                style={{
                  backgroundColor: isNight ? "#111111" : "#FFFFFF",
                  borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA",
                }}
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-xs font-mono font-bold text-amber-500">
                      STAGE {node.step}
                    </span>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-neutral-700/30 text-neutral-400">
                      {node.tag}
                    </span>
                  </div>

                  <div
                    className="w-10 h-10 rounded-xl border flex items-center justify-center text-amber-500 mb-3"
                    style={{
                      backgroundColor: isNight ? "#191919" : "#F4F1E9",
                      borderColor: isNight ? "rgba(255,255,255,0.1)" : "#E7E3DA",
                    }}
                  >
                    <Icon className="w-5 h-5" />
                  </div>

                  <h4 className="text-sm font-bold mb-1 leading-snug" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>
                    {node.title}
                  </h4>
                  <div className="text-[11px] font-mono text-amber-500 mb-2">
                    {node.sub}
                  </div>
                  <p className="text-xs leading-relaxed" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>
                    {node.desc}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* Technical Boundary Callout Panel */}
        <div
          className="p-6 rounded-2xl border shadow-xl"
          style={{
            backgroundColor: isNight ? "rgba(20,20,20,0.85)" : "#FFFFFF",
            borderColor: "rgba(245,158,11,0.35)",
          }}
        >
          <div className="flex flex-wrap items-center justify-between gap-4 pb-4 border-b mb-4" style={{ borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA" }}>
            <div className="flex items-center gap-2 text-amber-500 font-bold text-sm">
              <ShieldCheck className="w-5 h-5" />
              <span>Architectural Boundaries & Scope Clarification</span>
            </div>
            <span className="text-xs font-mono text-neutral-400">
              STRICT SCOPE COMPLIANCE
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 text-xs leading-relaxed" style={{ color: isNight ? "#D4D4D4" : "#404040" }}>
            <div className="space-y-1.5">
              <span className="font-semibold flex items-center gap-1.5" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>
                <Lock className="w-4 h-4 text-amber-500" />
                <span>Read-Only Provider Polling</span>
              </span>
              <p className="text-neutral-400">
                Outbound gateway API connections operate in read-only mode (GET /v1/payments/:id). Mutative financial writes are blocked by default unless authorized by an authenticated human controller.
              </p>
            </div>

            <div className="space-y-1.5">
              <span className="font-semibold flex items-center gap-1.5" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>
                <PowerOff className="w-4 h-4 text-amber-500" />
                <span>Worker Kill-Switch & Isolation</span>
              </span>
              <p className="text-neutral-400">
                Autonomous background workers are decoupled from web servers. If dispute ratios exceed approved bounds, distributed signals immediately freeze autonomous workers into Safe-Hold.
              </p>
            </div>

            <div className="space-y-1.5">
              <span className="font-semibold flex items-center gap-1.5" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>
                <AlertTriangle className="w-4 h-4 text-rose-500" />
                <span>No Direct Core Banking / NPCI Integrations</span>
              </span>
              <p className="text-neutral-400">
                ReconAI interfaces with merchant order management systems and certified payment gateway webhooks. Core banking switches (NPCI, Fedwire, SWIFT) remain outside the current demonstration scope.
              </p>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}
