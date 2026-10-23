import React, { useState } from "react";
import { useTheme } from "../../context/ThemeContext";
import { ReconSphere } from "./ReconSphere";
import { 
  ShieldCheck, 
  ArrowRight, 
  Activity, 
  Lock, 
  UserCheck, 
  Store, 
  Search, 
  CheckCircle2, 
  AlertTriangle, 
  Clock, 
  Layers, 
  Compass, 
  FileCheck2,
  ChevronRight,
  Sparkles
} from "lucide-react";

export function SpatialHeroSection() {
  const { isNight } = useTheme();
  // Configurator mode / stage selector
  const [activeStage, setActiveStage] = useState("detect"); // 'detect' | 'collect' | 'investigate' | 'policy' | 'safe_hold' | 'verified'

  const stages = [
    { id: "detect", label: "01 Detect", sub: "Ingress Signal" },
    { id: "collect", label: "02 Collect", sub: "Multi-Source" },
    { id: "investigate", label: "03 Investigate", sub: "Four Agents" },
    { id: "policy", label: "04 Policy", sub: "Rule Invariants" },
    { id: "safe_hold", label: "05 Safe-Hold", sub: "Quarantine" },
    { id: "verified", label: "06 Verified", sub: "Audit Record" },
  ];

  return (
    <section id="hero" className="relative min-h-[100vh] pt-28 pb-20 overflow-hidden flex flex-col justify-between">
      {/* Dynamic Background Atmosphere */}
      <div
        className="absolute inset-0 pointer-events-none transition-colors duration-500"
        style={{
          backgroundColor: isNight ? "#080808" : "#FAFAF7",
        }}
      />

      {/* Subtle fine technical grid */}
      <div
        className="absolute inset-0 pointer-events-none opacity-[0.04]"
        style={{
          backgroundImage: isNight
            ? "linear-gradient(#F59E0B 1px, transparent 1px), linear-gradient(90deg, #F59E0B 1px, transparent 1px)"
            : "linear-gradient(#D97706 1px, transparent 1px), linear-gradient(90deg, #D97706 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* Warm Ambient Radial Glows */}
      <div
        className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full blur-[160px] pointer-events-none transition-all duration-700"
        style={{
          background: isNight
            ? "radial-gradient(circle, rgba(245,158,11,0.18) 0%, rgba(217,119,6,0.06) 55%, transparent 75%)"
            : "radial-gradient(circle, rgba(254,243,199,0.95) 0%, rgba(251,191,36,0.22) 50%, transparent 75%)",
        }}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 w-full relative z-10">
        
        {/* Top Eyebrow & Brand Tagline */}
        <div className="text-center max-w-3xl mx-auto mb-8 space-y-3">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-mono font-semibold uppercase tracking-wider transition-all duration-300 shadow-sm border"
            style={{
              backgroundColor: isNight ? "rgba(17,17,17,0.85)" : "rgba(255,255,255,0.9)",
              color: isNight ? "#FBBF24" : "#D97706",
              borderColor: isNight ? "rgba(245,158,11,0.3)" : "rgba(217,119,6,0.3)",
            }}
          >
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <span>Autonomous AI Payment Resolution Network</span>
          </div>

          <h1
            className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight leading-[1.1] transition-colors"
            style={{ color: isNight ? "#FAFAF9" : "#181818" }}
          >
            Intelligence at the core{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600 drop-shadow-[0_0_25px_rgba(245,158,11,0.25)]">
              of every payment.
            </span>
          </h1>

          <p
            className="text-base sm:text-lg max-w-2xl mx-auto leading-relaxed transition-colors"
            style={{ color: isNight ? "#A3A3A3" : "#66645F" }}
          >
            ReconAI investigates payment discrepancies, connects evidence, coordinates specialized AI agents, and applies deterministic financial policies to guide safe resolution.
          </p>

          <p className="text-xs sm:text-sm font-semibold tracking-wide uppercase text-amber-500/90 font-mono">
            Every payment reconciled. Every decision accountable.
          </p>

          {/* Action CTAs */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <a
              href="#storyline"
              className="px-6 py-3 rounded-xl text-xs sm:text-sm font-semibold text-white bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 hover:from-amber-400 hover:to-amber-600 shadow-[0_0_25px_rgba(245,158,11,0.35)] transition-all duration-200 flex items-center gap-2 border border-amber-300/30"
            >
              <span>Explore the System</span>
              <ArrowRight className="w-4 h-4 text-amber-200" />
            </a>

            <a
              href="#demo"
              className="px-5 py-3 rounded-xl text-xs sm:text-sm font-semibold transition-all duration-200 border flex items-center gap-2"
              style={{
                backgroundColor: isNight ? "rgba(25,25,25,0.7)" : "rgba(255,255,255,0.85)",
                color: isNight ? "#FAFAF9" : "#181818",
                borderColor: isNight ? "rgba(255,255,255,0.12)" : "#E7E3DA",
              }}
            >
              <Activity className="w-4 h-4 text-amber-500" />
              <span>Launch Interactive Demo</span>
            </a>
          </div>
        </div>

        {/* ======================================================== */}
        {/* AUDI CONFIGURATOR SPATIAL COMPOSITION                    */}
        {/* Center: Large Animated AI Core                           */}
        {/* Left Side: Floating Customer AI & Evidence Cards         */}
        {/* Right Side: Floating Shop AI & Policy Result Cards       */}
        {/* ======================================================== */}
        <div className="relative mt-4 mb-8">
          
          {/* Spatial Grid Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
            
            {/* LEFT WING: Floating Customer AI & Evidence Cards (Cols 1-3) */}
            <div className="lg:col-span-3 space-y-4 order-2 lg:order-1 text-left">
              {/* Card 1: Customer AI Inference */}
              <div
                className="p-4 rounded-2xl border transition-all duration-300 shadow-lg relative group hover:-translate-y-1"
                style={{
                  backgroundColor: isNight ? "rgba(17,17,17,0.75)" : "rgba(255,255,255,0.85)",
                  backdropFilter: "blur(20px)",
                  borderColor: isNight ? "rgba(255,255,255,0.10)" : "#E7E3DA",
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-500">
                      <UserCheck className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>
                      Customer AI
                    </span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-500 font-semibold">
                    CONF: 94%
                  </span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>
                  Verified SMS debit confirmation of ₹50,000 from HDFC Bank. Plausible buyer claim.
                </p>
                <div className="mt-2.5 pt-2 border-t border-white/[0.06] flex items-center justify-between text-[10px] font-mono text-amber-500/90">
                  <span>Intent: Retry Checkout</span>
                  <span>Advisory</span>
                </div>
              </div>

              {/* Card 2: Multi-Source Evidence Ingestion */}
              <div
                className="p-4 rounded-2xl border transition-all duration-300 shadow-lg relative group hover:-translate-y-1"
                style={{
                  backgroundColor: isNight ? "rgba(17,17,17,0.75)" : "rgba(255,255,255,0.85)",
                  backdropFilter: "blur(20px)",
                  borderColor: isNight ? "rgba(255,255,255,0.10)" : "#E7E3DA",
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-500">
                      <FileCheck2 className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>
                      Evidence Assembly
                    </span>
                  </div>
                  <span className="text-[10px] font-mono text-emerald-500 font-semibold">
                    3 Sources
                  </span>
                </div>
                <div className="space-y-1.5 text-[11px] font-mono">
                  <div className="flex justify-between p-1.5 rounded" style={{ backgroundColor: isNight ? "rgba(0,0,0,0.3)" : "#F4F1E9" }}>
                    <span style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>Gateway 504:</span>
                    <span className="text-amber-500 font-semibold">Indeterminate</span>
                  </div>
                  <div className="flex justify-between p-1.5 rounded" style={{ backgroundColor: isNight ? "rgba(0,0,0,0.3)" : "#F4F1E9" }}>
                    <span style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>Merchant OMS:</span>
                    <span className="text-rose-500 font-semibold">Unfulfilled</span>
                  </div>
                </div>
              </div>
            </div>

            {/* CENTER: The Animated AI Sphere Core (Cols 4-9) */}
            <div className="lg:col-span-6 flex flex-col items-center justify-center relative order-1 lg:order-2 py-4">
              {/* Background ambient ring shadow */}
              <div className="relative">
                <ReconSphere
                  size={420}
                  stage={activeStage}
                  stageLabel={`STAGE: ${activeStage.toUpperCase()}`}
                  interactive={true}
                />
              </div>

              {/* Spatial Configurator Stage Selector Pill Strip */}
              <div
                className="mt-6 p-1.5 rounded-full border shadow-lg flex items-center gap-1 overflow-x-auto max-w-full z-20"
                style={{
                  backgroundColor: isNight ? "rgba(17,17,17,0.9)" : "rgba(255,255,255,0.95)",
                  borderColor: isNight ? "rgba(245,158,11,0.25)" : "#E7E3DA",
                  backdropFilter: "blur(16px)",
                }}
              >
                {stages.map((stg) => {
                  const isSelected = activeStage === stg.id;
                  return (
                    <button
                      key={stg.id}
                      onClick={() => setActiveStage(stg.id)}
                      className={`px-3 py-1.5 rounded-full text-xs font-mono font-semibold transition-all duration-200 cursor-pointer flex-shrink-0 ${
                        isSelected
                          ? "bg-amber-500 text-white shadow-[0_0_15px_rgba(245,158,11,0.4)]"
                          : isNight
                          ? "text-neutral-400 hover:text-white hover:bg-white/[0.05]"
                          : "text-neutral-600 hover:text-black hover:bg-neutral-100"
                      }`}
                    >
                      {stg.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* RIGHT WING: Floating Shop AI & Deterministic Policy Cards (Cols 10-12) */}
            <div className="lg:col-span-3 space-y-4 order-3 text-left">
              {/* Card 3: Shop AI Findings */}
              <div
                className="p-4 rounded-2xl border transition-all duration-300 shadow-lg relative group hover:-translate-y-1"
                style={{
                  backgroundColor: isNight ? "rgba(17,17,17,0.75)" : "rgba(255,255,255,0.85)",
                  backdropFilter: "blur(20px)",
                  borderColor: isNight ? "rgba(255,255,255,0.10)" : "#E7E3DA",
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-amber-500/15 border border-amber-500/30 flex items-center justify-center text-amber-500">
                      <Store className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>
                      Shop AI
                    </span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-500 font-semibold">
                    CONF: 98%
                  </span>
                </div>
                <p className="text-xs leading-relaxed" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>
                  Cart hold lock timed out at 15m. Warehouse stock retained in Bangalore depot.
                </p>
                <div className="mt-2.5 pt-2 border-t border-white/[0.06] flex items-center justify-between text-[10px] font-mono text-amber-500/90">
                  <span>Goods: Not Dispatched</span>
                  <span>Advisory</span>
                </div>
              </div>

              {/* Card 4: Deterministic Policy Result */}
              <div
                className="p-4 rounded-2xl border transition-all duration-300 shadow-lg relative group hover:-translate-y-1"
                style={{
                  backgroundColor: isNight ? "rgba(245,158,11,0.08)" : "rgba(254,243,199,0.7)",
                  backdropFilter: "blur(20px)",
                  borderColor: isNight ? "rgba(245,158,11,0.35)" : "rgba(217,119,6,0.35)",
                }}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-amber-500/20 border border-amber-500/40 flex items-center justify-center text-amber-500">
                      <Lock className="w-4 h-4" />
                    </div>
                    <span className="text-xs font-bold" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>
                      Policy Decision
                    </span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/20 text-amber-600 dark:text-amber-300 font-bold">
                    SAFE_HOLD
                  </span>
                </div>
                <p className="text-xs font-semibold text-amber-600 dark:text-amber-400">
                  PR-04: Indeterminate Gateway Guard
                </p>
                <p className="text-[11px] mt-1 leading-snug" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>
                  Provider returned HTTP 504. Blind refund BLOCKED. Read-only verification scheduled.
                </p>
              </div>
            </div>

          </div>

          {/* LOWER STRIP: Live Telemetry & Monitoring Waveform */}
          <div
            className="mt-6 p-4 rounded-2xl border shadow-lg flex flex-wrap items-center justify-between gap-4 text-xs font-mono"
            style={{
              backgroundColor: isNight ? "rgba(17,17,17,0.75)" : "rgba(255,255,255,0.9)",
              backdropFilter: "blur(16px)",
              borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA",
            }}
          >
            <div className="flex items-center gap-3">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-ping" />
              <span style={{ color: isNight ? "#FAFAF9" : "#181818" }} className="font-semibold">
                SYSTEM TELEMETRY: CASE #RC-84920
              </span>
              <span className="text-amber-500 font-bold hidden sm:inline">
                [SIMULATED DISCREPANCY: ₹50,000.00]
              </span>
            </div>

            <div className="flex items-center gap-4 text-[11px]" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>
              <span>Gateway: <strong className="text-amber-500">Razorpay UPI</strong></span>
              <span>OMS: <strong style={{ color: isNight ? "#FAFAF9" : "#181818" }}>Shopify ERP</strong></span>
              <span>Execution: <strong className="text-emerald-500">1.2s Analysis</strong></span>
            </div>
          </div>

        </div>

      </div>
    </section>
  );
}
