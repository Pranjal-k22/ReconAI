import React, { useState } from "react";
import { 
  Radar, 
  FileStack, 
  Cpu, 
  ShieldCheck, 
  GitBranch, 
  Hash, 
  ChevronRight, 
  Check, 
  Activity,
  ArrowRight
} from "lucide-react";

export function HowItWorksSection() {
  const [activeStep, setActiveStep] = useState(0);

  const steps = [
    {
      num: "01",
      title: "Detect Event",
      subtitle: "Webhook & API Ingestion",
      icon: Radar,
      summary: "Ingest real-time webhooks, gateway signals, or customer dispute tickets.",
      details: "ReconAI securely listens to payment gateway webhooks (e.g., Razorpay, Stripe) with HMAC SHA-256 signature verification. Out-of-band timeout events and customer claim webhooks are captured simultaneously.",
      dataSample: {
        event: "payment.captured",
        source: "Razorpay Gateway",
        signature_verified: true,
        latency_ms: 180,
      },
    },
    {
      num: "02",
      title: "Collect Evidence",
      subtitle: "Multi-Source Assembly",
      icon: FileStack,
      summary: "Query merchant inventory, gateway status, and banking logs.",
      details: "The ingestion controller orchestrates authorized read-only queries across merchant order management (OMS), gateway settlement logs, and customer bank upload tickets. Zero reliance on isolated claims.",
      dataSample: {
        gateway_status: "captured",
        order_erp_status: "unfulfilled",
        inventory_lock: true,
        customer_debit_ref: "RRN-99210",
      },
    },
    {
      num: "03",
      title: "AI Investigation",
      subtitle: "Four Specialized Agents",
      icon: Cpu,
      summary: "Dispatch 4 domain-isolated agents to analyze discrepancies.",
      details: "Customer AI evaluates buyer intent and bank alerts. Shop AI inspects cart life cycles and stock holds. Investigator AI parses raw network logs. Planner AI synthesizes candidate resolutions.",
      dataSample: {
        customer_agent: "debit_sms_plausible (0.94)",
        shop_agent: "cart_expired_at_14_00",
        investigator: "late_capture_verified (+240s)",
        candidate_resolution: "PROPOSE_REFUND_FAIL_CLOSED",
      },
    },
    {
      num: "04",
      title: "Policy Engine",
      subtitle: "Deterministic Server Guard",
      icon: ShieldCheck,
      summary: "Enforce strict financial rules and fail-closed security.",
      details: "Crucial boundary: AI agents only recommend. The deterministic server-side policy engine validates financial invariants, idempotency locks, approved refund caps, and anti-tamper rules.",
      dataSample: {
        rule_applied: "PR-07: Late Capture Guard",
        refund_limit_check: "PASS (under ₹20,000 threshold)",
        idempotency_state: "LOCKED_VALID",
        verdict: "PERMITTED_SAFE_HOLD_OR_REFUND",
      },
    },
    {
      num: "05",
      title: "Resolve / Escalate",
      subtitle: "Safe-Hold & Autonomous Action",
      icon: GitBranch,
      summary: "Execute verified resolution or quarantine in Safe-Hold.",
      details: "If fully matched and policy verified, the system approves settlement booking. If any parameter is indeterminate or contradictory, it locks the transaction into Safe-Hold with read-only polling.",
      dataSample: {
        execution_path: "SAFE_HOLD_READ_ONLY_POLL",
        auto_refund: "BLOCKED_PENDING_POLL",
        operator_alert: "DISPATCHED",
      },
    },
    {
      num: "06",
      title: "Audit & Record",
      subtitle: "Cryptographic Provenance",
      icon: Hash,
      summary: "Generate tamper-evident decision logs and SHA-256 hashes.",
      details: "Every evidence payload, agent finding, policy evaluation, and worker action is committed to an immutable append-only event ledger with cryptographic hashes for complete compliance.",
      dataSample: {
        case_id: "RC-84920",
        hash: "9b12e3a890f1d072bb45e99ca102",
        immutable_timestamp: "2026-10-23T13:45:04.000Z",
        audit_state: "VERIFIED",
      },
    },
  ];

  return (
    <section id="how-it-works" className="py-24 relative overflow-hidden bg-[#0B1220] text-left border-t border-white/[0.06]">
      {/* Background Lighting */}
      <div className="absolute top-1/4 right-1/4 w-[500px] h-[500px] bg-blue-600/10 rounded-full blur-[140px] pointer-events-none" />
      <div className="absolute bottom-1/4 left-1/4 w-[500px] h-[500px] bg-teal-500/10 rounded-full blur-[150px] pointer-events-none" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* Section Title */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 text-xs font-semibold uppercase tracking-wider mb-3">
            <Activity className="w-3.5 h-3.5" />
            <span>Deterministic Lifecycle Pipeline</span>
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white tracking-tight">
            Evidence-first resolution in{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-cyan-300 to-teal-300">
              six disciplined steps.
            </span>
          </h2>
          <p className="text-base sm:text-lg text-slate-300 mt-4 leading-relaxed">
            ReconAI replaces chaotic ad-hoc support with an automated, sequential investigation and governance assembly. Click any step to inspect the underlying mechanics.
          </p>
        </div>

        {/* Step Navigation Bar / Progress Nodes */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-10">
          {steps.map((step, idx) => {
            const Icon = step.icon;
            const isSelected = activeStep === idx;
            return (
              <button
                key={idx}
                onClick={() => setActiveStep(idx)}
                className={`p-4 rounded-xl text-left transition-all duration-300 relative border flex flex-col justify-between group cursor-pointer ${
                  isSelected
                    ? "bg-[#162238] border-cyan-400 shadow-[0_0_20px_rgba(34,211,238,0.25)] scale-[1.02]"
                    : "bg-[#0F172A]/70 border-white/[0.08] hover:border-white/20 hover:bg-[#111827]"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className={`text-xs font-mono font-bold ${isSelected ? "text-cyan-300" : "text-slate-400"}`}>
                      {step.num}
                    </span>
                    <Icon className={`w-4 h-4 ${isSelected ? "text-cyan-300" : "text-slate-400 group-hover:text-slate-200"}`} />
                  </div>
                  <div className={`text-sm font-bold leading-tight ${isSelected ? "text-white" : "text-slate-300"}`}>
                    {step.title}
                  </div>
                </div>
                <div className="text-[10px] text-slate-400 mt-2 truncate">
                  {step.subtitle}
                </div>
                {isSelected && (
                  <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-8 h-1 rounded-full bg-cyan-400" />
                )}
              </button>
            );
          })}
        </div>

        {/* Selected Step Detailed Deep Dive Card */}
        <div className="rounded-2xl bg-[#0F172A]/90 backdrop-blur-2xl border border-white/[0.12] p-6 sm:p-8 shadow-[0_20px_50px_rgba(0,0,0,0.5)]">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            
            {/* Step Explanation */}
            <div className="lg:col-span-7 space-y-4">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-md text-xs font-mono font-bold bg-cyan-500/20 text-cyan-300 border border-cyan-500/40">
                  STEP {steps[activeStep].num}
                </span>
                <span className="text-xs font-mono text-slate-400 uppercase tracking-wider">
                  {steps[activeStep].subtitle}
                </span>
              </div>

              <h3 className="text-2xl sm:text-3xl font-extrabold text-white">
                {steps[activeStep].title}
              </h3>

              <p className="text-slate-300 text-sm sm:text-base leading-relaxed">
                {steps[activeStep].details}
              </p>

              <div className="pt-2 flex flex-wrap items-center gap-3">
                <button
                  onClick={() => setActiveStep((prev) => (prev + 1) % steps.length)}
                  className="px-4 py-2 rounded-lg bg-cyan-500/10 hover:bg-cyan-500/20 border border-cyan-500/30 text-xs font-semibold text-cyan-300 flex items-center gap-1.5 transition-colors"
                >
                  <span>Next Step: {steps[(activeStep + 1) % steps.length].title}</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
                <a
                  href="#demo"
                  className="text-xs text-slate-400 hover:text-white transition-colors underline underline-offset-4"
                >
                  Test this step in Simulator
                </a>
              </div>
            </div>

            {/* Step Data Payload Sample (Glass Code Block) */}
            <div className="lg:col-span-5">
              <div className="rounded-xl bg-[#0B1220] border border-white/10 p-4 font-mono text-xs shadow-inner">
                <div className="flex items-center justify-between pb-3 border-b border-white/[0.08] mb-3 text-[11px] text-slate-400">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-cyan-400" />
                    <span>system_pipeline_event.json</span>
                  </div>
                  <span className="text-[10px] text-cyan-400">VERIFIED STAMP</span>
                </div>
                <pre className="text-slate-300 overflow-x-auto text-[11px] leading-relaxed">
                  {JSON.stringify(steps[activeStep].dataSample, null, 2)}
                </pre>
              </div>
            </div>

          </div>
        </div>

      </div>
    </section>
  );
}
