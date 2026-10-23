import React from "react";
import { 
  ShieldCheck, 
  ArrowRight, 
  AlertTriangle, 
  CheckCircle2, 
  Search, 
  Layers, 
  Lock, 
  Cpu, 
  RefreshCw,
  FileCheck,
  TrendingUp,
  Activity
} from "lucide-react";
import { ReconAILogo } from "./ReconLogo";

export function HeroSection() {
  return (
    <section id="hero" className="relative min-h-[92vh] pt-32 pb-20 overflow-hidden flex items-center">
      {/* Background ambient lighting and technical grid */}
      <div className="absolute inset-0 bg-[#0B1220] -z-20" />
      
      {/* Radial glow meshes */}
      <div className="absolute top-1/4 left-1/4 w-[500px] h-[500px] bg-blue-600/15 rounded-full blur-[140px] pointer-events-none -z-10" />
      <div className="absolute top-1/3 right-1/4 w-[550px] h-[550px] bg-cyan-500/15 rounded-full blur-[160px] pointer-events-none -z-10" />
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 w-[700px] h-[250px] bg-indigo-600/10 rounded-full blur-[150px] pointer-events-none -z-10" />

      {/* Technical fine grid overlay */}
      <div 
        className="absolute inset-0 opacity-[0.035] pointer-events-none -z-10"
        style={{
          backgroundImage: `linear-gradient(#38BDF8 1px, transparent 1px), linear-gradient(90deg, #38BDF8 1px, transparent 1px)`,
          backgroundSize: "32px 32px"
        }}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full relative z-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-8 items-center">
          
          {/* Left Column: Copy, Badges & CTAs */}
          <div className="lg:col-span-6 space-y-6 text-left">
            {/* Eyebrow Pill */}
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-900/80 border border-cyan-500/30 text-cyan-300 text-xs font-medium shadow-[0_0_15px_rgba(34,211,238,0.15)]">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-cyan-400"></span>
              </span>
              <span className="tracking-wide uppercase font-semibold text-[11px]">
                Autonomous AI Payment Resolution Network
              </span>
            </div>

            {/* Headline */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold text-white tracking-tight leading-[1.12]">
              Resolve payment discrepancies with{" "}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-cyan-300 to-teal-300 drop-shadow-[0_0_25px_rgba(56,189,248,0.3)]">
                evidence-driven AI.
              </span>
            </h1>

            {/* Supporting Copy */}
            <p className="text-base sm:text-lg text-slate-300 font-normal leading-relaxed max-w-xl">
              ReconAI investigates payment mismatches, coordinates customer and merchant evidence, applies deterministic financial rules, and tracks unresolved cases through a safe, auditable workflow.
            </p>

            {/* Primary & Secondary Action CTAs */}
            <div className="flex flex-wrap items-center gap-4 pt-2">
              <a
                href="#demo"
                className="group relative px-6 py-3.5 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-blue-600 via-cyan-600 to-teal-600 hover:from-blue-500 hover:to-teal-500 shadow-[0_0_30px_rgba(59,130,246,0.4)] transition-all duration-300 flex items-center gap-2 border border-cyan-300/30 hover:scale-[1.02]"
              >
                <span>Explore Interactive Demo</span>
                <ArrowRight className="w-4 h-4 text-cyan-200 group-hover:translate-x-1 transition-transform" />
              </a>

              <a
                href="#how-it-works"
                className="px-5 py-3.5 rounded-xl font-medium text-sm text-slate-200 bg-slate-900/60 hover:bg-slate-800/80 border border-white/10 hover:border-cyan-500/40 transition-all duration-200 backdrop-blur-md flex items-center gap-2 hover:text-white"
              >
                <span>See How It Works</span>
              </a>
            </div>

            {/* Trust Badges */}
            <div className="pt-6 border-t border-white/[0.08]">
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">
                Core Architectural Guarantees
              </p>
              <div className="flex flex-wrap gap-2 sm:gap-2.5">
                {[
                  "Evidence-Driven Investigation",
                  "Deterministic Policy Guard",
                  "Idempotent Operations",
                  "Safe-Hold Escalation",
                  "Auditable Decisions",
                ].map((badge, idx) => (
                  <span
                    key={idx}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/[0.03] border border-white/[0.07] text-[11px] font-medium text-slate-300 hover:border-cyan-500/30 transition-colors"
                  >
                    <CheckCircle2 className="w-3 h-3 text-cyan-400 flex-shrink-0" />
                    <span>{badge}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Right Column: Layered Glass Product Dashboard Mockup (Original Asset 3) */}
          <div className="lg:col-span-6 relative">
            <div className="relative mx-auto max-w-lg lg:max-w-none">
              
              {/* Outer Glow Halo behind mockup */}
              <div className="absolute -inset-1 bg-gradient-to-r from-blue-600/30 to-cyan-500/30 rounded-2xl blur-xl opacity-70 pointer-events-none" />

              {/* Main Primary Glass Dashboard Window */}
              <div className="relative rounded-2xl bg-[#0F172A]/85 backdrop-blur-2xl border border-white/[0.12] shadow-[0_20px_50px_rgba(0,0,0,0.6)] overflow-hidden text-left">
                
                {/* Window Header Bar */}
                <div className="px-4 py-3 bg-[#0B1220]/90 border-b border-white/[0.08] flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                      <span className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
                    </div>
                    <span className="text-xs font-mono text-slate-400 pl-2">
                      reconai://cases/RC-84920
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-amber-500/15 border border-amber-500/30 text-amber-300">
                      SIMULATION
                    </span>
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono text-cyan-300 bg-cyan-950/60 border border-cyan-800/40">
                      LIVE STREAM
                    </span>
                  </div>
                </div>

                {/* Dashboard Body */}
                <div className="p-5 space-y-4">
                  {/* Case Title & Financial Metric */}
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-cyan-400 font-semibold">CASE #RC-84920</span>
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                          SAFE-HOLD ACTIVE
                        </span>
                      </div>
                      <h3 className="text-lg font-bold text-white mt-1">
                        Razorpay Gateway Timeout Discrepancy
                      </h3>
                      <p className="text-xs text-slate-400 font-mono mt-0.5">
                        Merchant: Apex Electronics • Order: ORD-9821
                      </p>
                    </div>

                    <div className="text-right">
                      <div className="text-xs text-slate-400 font-mono">Discrepancy Amount</div>
                      <div className="text-2xl font-extrabold text-white font-mono tracking-tight">
                        ₹50,000.00
                      </div>
                      <div className="text-[10px] text-amber-400 font-medium">Auto-Refund Blocked</div>
                    </div>
                  </div>

                  {/* Multi-Source Evidence Correlation Bar */}
                  <div className="p-3 rounded-xl bg-slate-900/70 border border-white/[0.06] space-y-2">
                    <div className="flex items-center justify-between text-xs font-medium text-slate-300">
                      <span className="flex items-center gap-1.5">
                        <FileCheck className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Evidence Provenance</span>
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">3 Verified Sources</span>
                    </div>

                    <div className="grid grid-cols-3 gap-2 text-[11px]">
                      <div className="p-2 rounded-lg bg-black/30 border border-white/[0.04]">
                        <div className="text-slate-400 text-[10px]">Gateway Log</div>
                        <div className="font-semibold text-rose-400">504 Timeout</div>
                      </div>
                      <div className="p-2 rounded-lg bg-black/30 border border-white/[0.04]">
                        <div className="text-slate-400 text-[10px]">Merchant OMS</div>
                        <div className="font-semibold text-amber-400">Unfulfilled</div>
                      </div>
                      <div className="p-2 rounded-lg bg-black/30 border border-white/[0.04]">
                        <div className="text-slate-400 text-[10px]">Customer Bank</div>
                        <div className="font-semibold text-cyan-400">SMS Debit Lien</div>
                      </div>
                    </div>
                  </div>

                  {/* 4 Agent Synthesis Strip */}
                  <div className="p-3 rounded-xl bg-slate-900/80 border border-white/[0.06]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                        <Cpu className="w-3.5 h-3.5 text-cyan-400" />
                        <span>Four-Agent Investigation Pipeline</span>
                      </span>
                      <span className="text-[10px] text-emerald-400 font-mono">Consensus 94%</span>
                    </div>

                    <div className="space-y-1.5 text-xs">
                      <div className="flex items-center justify-between text-[11px] p-1.5 rounded bg-white/[0.02]">
                        <span className="text-slate-300">Investigator AI:</span>
                        <span className="text-amber-300 font-mono text-[10px]">Upstream switch state uncertain</span>
                      </div>
                      <div className="flex items-center justify-between text-[11px] p-1.5 rounded bg-white/[0.02]">
                        <span className="text-slate-300">Resolution Planner:</span>
                        <span className="text-cyan-300 font-mono text-[10px]">Schedule T+300s Read-Only Re-poll</span>
                      </div>
                    </div>
                  </div>

                  {/* Deterministic Policy Guard Banner */}
                  <div className="p-3 rounded-xl bg-gradient-to-r from-amber-500/10 via-amber-900/20 to-red-500/10 border border-amber-500/30 flex items-start gap-2.5">
                    <ShieldCheck className="w-5 h-5 text-amber-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                        <span>POLICY GUARD: PR-04 INDETERMINATE STATE</span>
                        <span className="px-1.5 py-0.2 rounded text-[9px] bg-amber-400/20 text-amber-200">FAIL-CLOSED</span>
                      </div>
                      <p className="text-[11px] text-slate-300 mt-0.5 leading-snug">
                        AI recommends caution. Deterministic server policy mandates Safe-Hold. Unauthorized provider writes are completely locked down.
                      </p>
                    </div>
                  </div>

                </div>

                {/* Dashboard Bottom Status Bar */}
                <div className="px-4 py-2.5 bg-[#0B1220]/95 border-t border-white/[0.06] flex items-center justify-between text-[11px] font-mono text-slate-400">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-400" />
                    <span>Audit Hash: <span className="text-slate-300">9b12..cc33</span></span>
                  </div>
                  <div className="text-cyan-400">
                    Execution: 1.2s
                  </div>
                </div>
              </div>

              {/* Floating Glass Accent Pill 1: Resolution Metric */}
              <div className="hidden sm:flex absolute -top-5 -right-5 p-3 rounded-xl bg-[#111827]/90 backdrop-blur-xl border border-white/10 shadow-[0_10px_25px_rgba(0,0,0,0.5)] items-center gap-3 animate-bounce [animation-duration:6s]">
                <div className="w-9 h-9 rounded-lg bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
                  <TrendingUp className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-[10px] text-slate-400 font-mono">Reconciliation Accuracy</div>
                  <div className="text-sm font-bold text-white font-mono">99.98% Guaranteed</div>
                </div>
              </div>

              {/* Floating Glass Accent Pill 2: Safe-Hold Alert */}
              <div className="hidden sm:flex absolute -bottom-5 -left-5 p-3 rounded-xl bg-[#111827]/90 backdrop-blur-xl border border-amber-500/30 shadow-[0_10px_25px_rgba(0,0,0,0.5)] items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-400">
                  <Lock className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-[10px] text-amber-300 font-mono font-semibold">Zero Blind Refunds</div>
                  <div className="text-xs font-medium text-slate-300">Fail-Closed Guard Rails</div>
                </div>
              </div>

            </div>
          </div>

        </div>
      </div>
    </section>
  );
}
