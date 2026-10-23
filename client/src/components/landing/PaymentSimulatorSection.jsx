import React, { useState } from "react";
import { useTheme } from "../../context/ThemeContext";
import { SIMULATOR_SCENARIOS } from "./simulatorData";
import { ReconSphere } from "./ReconSphere";
import { 
  RotateCcw, 
  Code, 
  ShieldCheck, 
  ShieldAlert, 
  User, 
  Store, 
  Search, 
  Compass, 
  ArrowRight,
  Terminal,
  Activity,
  Layers
} from "lucide-react";
import { EvidenceIcon } from "./ReconLogo";

export function PaymentSimulatorSection() {
  const { isNight } = useTheme();
  const [selectedScenarioIndex, setSelectedScenarioIndex] = useState(1); // Default to Payment Timeout
  const [isSimulating, setIsSimulating] = useState(false);
  const [activeTab, setActiveTab] = useState("overview"); // overview | evidence | audit
  const [showJsonModal, setShowJsonModal] = useState(false);

  const scenario = SIMULATOR_SCENARIOS[selectedScenarioIndex];

  // Derive sphere state based on scenario outcome
  const getSphereState = () => {
    if (isSimulating) return "investigate";
    if (scenario.id === "successful_payment") return "verified";
    if (scenario.safeHold) return "safe_hold";
    return "policy";
  };

  const handleSelectScenario = (index) => {
    setSelectedScenarioIndex(index);
    setIsSimulating(true);
    setTimeout(() => {
      setIsSimulating(false);
    }, 500);
  };

  const handleReRunInvestigation = () => {
    setIsSimulating(true);
    setTimeout(() => {
      setIsSimulating(false);
    }, 600);
  };

  return (
    <section id="demo" className="py-24 relative overflow-hidden text-left border-t transition-colors duration-300"
      style={{
        backgroundColor: isNight ? "#080808" : "#FAFAF7",
        borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA",
      }}
    >
      {/* Background radial lighting */}
      <div
        className="absolute top-1/4 left-1/2 -translate-x-1/2 w-[800px] h-[400px] rounded-full blur-[160px] pointer-events-none"
        style={{
          background: isNight
            ? "radial-gradient(circle, rgba(245,158,11,0.15) 0%, transparent 70%)"
            : "radial-gradient(circle, rgba(254,243,199,0.9) 0%, rgba(245,158,11,0.2) 50%, transparent 70%)",
        }}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-semibold uppercase tracking-wider mb-3 border"
            style={{
              backgroundColor: isNight ? "rgba(17,17,17,0.8)" : "rgba(255,255,255,0.9)",
              color: isNight ? "#FBBF24" : "#D97706",
              borderColor: isNight ? "rgba(245,158,11,0.3)" : "rgba(217,119,6,0.3)",
            }}
          >
            <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
            <span>Interactive Payment Demo</span>
          </div>

          <h2
            className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight leading-tight"
            style={{ color: isNight ? "#FAFAF9" : "#181818" }}
          >
            Autonomous resolution{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600">
              in action.
            </span>
          </h2>

          <div className="inline-block mt-3 px-3 py-1 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-300 text-xs font-mono font-bold shadow-sm">
            INTERACTIVE SIMULATION — NO REAL MONEY MOVES
          </div>

          <p
            className="text-sm sm:text-base mt-3 leading-relaxed"
            style={{ color: isNight ? "#A3A3A3" : "#66645F" }}
          >
            Select any of the 7 real-world discrepancy scenarios below to watch the ReconAI Core synthesize evidence, execute the four-agent pipeline, and enforce deterministic server policies.
          </p>
        </div>

        {/* Master Simulator Container */}
        <div
          className="rounded-3xl border shadow-2xl overflow-hidden transition-all duration-300"
          style={{
            backgroundColor: isNight ? "rgba(17,17,17,0.85)" : "rgba(255,255,255,0.9)",
            backdropFilter: "blur(24px)",
            borderColor: isNight ? "rgba(245,158,11,0.25)" : "#E7E3DA",
          }}
        >
          {/* Top Control Bar */}
          <div
            className="px-6 py-4 border-b flex flex-wrap items-center justify-between gap-4 text-xs font-mono"
            style={{
              backgroundColor: isNight ? "#0C0C0C" : "#F4F1E9",
              borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA",
            }}
          >
            <div className="flex items-center gap-3">
              <span className="flex h-3 w-3 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
              </span>
              <div>
                <span className="font-bold text-amber-500 uppercase">
                  SIMULATION ACTIVE: {scenario.caseId}
                </span>
                <span className="ml-2 hidden sm:inline" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>
                  ({scenario.discrepancyType})
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={handleReRunInvestigation}
                disabled={isSimulating}
                className="px-3 py-1.5 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/30 text-amber-600 dark:text-amber-300 font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className={`w-3.5 h-3.5 ${isSimulating ? "animate-spin" : ""}`} />
                <span>Re-run Pipeline</span>
              </button>

              <button
                onClick={() => setShowJsonModal(!showJsonModal)}
                className="px-3 py-1.5 rounded-lg border font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
                style={{
                  backgroundColor: isNight ? "rgba(255,255,255,0.05)" : "#FFFFFF",
                  borderColor: isNight ? "rgba(255,255,255,0.1)" : "#E7E3DA",
                  color: isNight ? "#FAFAF9" : "#181818",
                }}
              >
                <Code className="w-3.5 h-3.5 text-amber-500" />
                <span>{showJsonModal ? "Hide JSON" : "Inspect JSON"}</span>
              </button>
            </div>
          </div>

          {/* Main 3-Column Simulator Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x" style={{ borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA" }}>
            
            {/* Column 1: Scenario Selector (Cols 1-3) */}
            <div
              className="lg:col-span-3 p-4 sm:p-5 space-y-2"
              style={{ backgroundColor: isNight ? "rgba(10,10,10,0.6)" : "rgba(250,250,247,0.7)" }}
            >
              <div className="text-[11px] font-mono font-bold uppercase tracking-wider text-neutral-400 px-2 mb-2">
                Select Scenario (7 Cases)
              </div>

              <div className="space-y-1.5">
                {SIMULATOR_SCENARIOS.map((sc, idx) => {
                  const isSelected = selectedScenarioIndex === idx;
                  return (
                    <button
                      key={sc.id}
                      onClick={() => handleSelectScenario(idx)}
                      className={`w-full text-left p-3 rounded-xl transition-all duration-200 border flex flex-col justify-between cursor-pointer ${
                        isSelected
                          ? "border-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.25)]"
                          : "border-transparent hover:border-neutral-700"
                      }`}
                      style={{
                        backgroundColor: isSelected
                          ? isNight ? "#1C1C1C" : "#FFFFFF"
                          : isNight ? "rgba(25,25,25,0.4)" : "rgba(244,241,233,0.5)",
                      }}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>
                          {sc.title}
                        </span>
                        <span
                          className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded ${
                            sc.safeHold
                              ? "bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/30"
                              : "bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/30"
                          }`}
                        >
                          {sc.tag}
                        </span>
                      </div>
                      <div className="text-[10px] mt-1 line-clamp-1 font-mono" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>
                        {sc.amount} • {sc.merchant}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Column 2: Center Case Details + Reactive Sphere (Cols 4-8) */}
            <div className="lg:col-span-5 p-5 sm:p-6 space-y-5">
              
              {/* Tab Switcher */}
              <div
                className="flex items-center gap-1 p-1 rounded-xl border text-xs"
                style={{
                  backgroundColor: isNight ? "#0C0C0C" : "#F4F1E9",
                  borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA",
                }}
              >
                {[
                  { id: "overview", label: "Case Overview" },
                  { id: "evidence", label: "Evidence Dossier" },
                  { id: "audit", label: "Audit Timeline" },
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`flex-1 py-1.5 rounded-lg font-medium transition-colors cursor-pointer ${
                      activeTab === tab.id
                        ? "bg-amber-500 text-white font-semibold shadow-sm"
                        : isNight ? "text-neutral-400 hover:text-white" : "text-neutral-600 hover:text-black"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Reactive Sphere Mini-Display */}
              <div className="flex items-center justify-center py-2">
                <ReconSphere
                  size={240}
                  stage={getSphereState()}
                  stageLabel={scenario.safeHold ? "SAFE-HOLD LOCKED" : "RECONAI CORE"}
                  interactive={false}
                />
              </div>

              {/* TAB 1: OVERVIEW */}
              {activeTab === "overview" && (
                <div className="space-y-4">
                  <div
                    className="p-4 rounded-xl border space-y-3"
                    style={{
                      backgroundColor: isNight ? "#0C0C0C" : "#FAFAF7",
                      borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA",
                    }}
                  >
                    <div className="flex items-start justify-between">
                      <div>
                        <span className="text-[10px] font-mono text-amber-500 font-bold">
                          CASE ID: {scenario.caseId}
                        </span>
                        <h4 className="text-base font-bold mt-0.5" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>
                          {scenario.title.replace(/^[0-9]\.\s*/, "")}
                        </h4>
                        <div className="text-xs font-mono" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>
                          Customer: <span style={{ color: isNight ? "#FAFAF9" : "#181818" }}>{scenario.customer}</span> • Merchant: <span style={{ color: isNight ? "#FAFAF9" : "#181818" }}>{scenario.merchant}</span>
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-[10px] font-mono text-neutral-400">Total Value</div>
                        <div className="text-lg font-extrabold font-mono text-amber-500">
                          {scenario.amount}
                        </div>
                      </div>
                    </div>

                    <div
                      className="p-3 rounded-lg border text-xs leading-relaxed"
                      style={{
                        backgroundColor: isNight ? "rgba(0,0,0,0.3)" : "#FFFFFF",
                        borderColor: isNight ? "rgba(255,255,255,0.06)" : "#E7E3DA",
                        color: isNight ? "#D4D4D4" : "#404040",
                      }}
                    >
                      {scenario.description}
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                      <div className="p-2 rounded border" style={{ backgroundColor: isNight ? "#141414" : "#F4F1E9", borderColor: isNight ? "rgba(255,255,255,0.04)" : "#E7E3DA" }}>
                        <span className="text-neutral-500">Gateway Status:</span>
                        <div className="font-semibold capitalize text-amber-500">{scenario.gatewayStatus}</div>
                      </div>
                      <div className="p-2 rounded border" style={{ backgroundColor: isNight ? "#141414" : "#F4F1E9", borderColor: isNight ? "rgba(255,255,255,0.04)" : "#E7E3DA" }}>
                        <span className="text-neutral-500">Order OMS Status:</span>
                        <div className="font-semibold capitalize" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>{scenario.orderStatus}</div>
                      </div>
                    </div>
                  </div>

                  {/* 4 Agent Findings Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="p-3 rounded-xl border text-xs" style={{ backgroundColor: isNight ? "#111111" : "#FFFFFF", borderColor: isNight ? "rgba(245,158,11,0.2)" : "#E7E3DA" }}>
                      <div className="flex items-center justify-between font-semibold text-amber-500 mb-1">
                        <span className="flex items-center gap-1.5">
                          <User className="w-3.5 h-3.5" />
                          <span>Customer AI</span>
                        </span>
                        <span className="text-[10px] font-mono">{scenario.agents.customerAi.confidence * 100}%</span>
                      </div>
                      <p className="text-[11px] leading-snug" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>
                        {scenario.agents.customerAi.finding}
                      </p>
                    </div>

                    <div className="p-3 rounded-xl border text-xs" style={{ backgroundColor: isNight ? "#111111" : "#FFFFFF", borderColor: isNight ? "rgba(245,158,11,0.2)" : "#E7E3DA" }}>
                      <div className="flex items-center justify-between font-semibold text-amber-500 mb-1">
                        <span className="flex items-center gap-1.5">
                          <Store className="w-3.5 h-3.5" />
                          <span>Shop AI</span>
                        </span>
                        <span className="text-[10px] font-mono">{scenario.agents.shopAi.confidence * 100}%</span>
                      </div>
                      <p className="text-[11px] leading-snug" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>
                        {scenario.agents.shopAi.finding}
                      </p>
                    </div>

                    <div className="p-3 rounded-xl border text-xs" style={{ backgroundColor: isNight ? "#111111" : "#FFFFFF", borderColor: isNight ? "rgba(245,158,11,0.2)" : "#E7E3DA" }}>
                      <div className="flex items-center justify-between font-semibold text-amber-500 mb-1">
                        <span className="flex items-center gap-1.5">
                          <Search className="w-3.5 h-3.5" />
                          <span>Investigator AI</span>
                        </span>
                        <span className="text-[10px] font-mono">{scenario.agents.investigatorAi.confidence * 100}%</span>
                      </div>
                      <p className="text-[11px] leading-snug" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>
                        {scenario.agents.investigatorAi.finding}
                      </p>
                    </div>

                    <div className="p-3 rounded-xl border text-xs" style={{ backgroundColor: isNight ? "#111111" : "#FFFFFF", borderColor: isNight ? "rgba(245,158,11,0.2)" : "#E7E3DA" }}>
                      <div className="flex items-center justify-between font-semibold text-amber-500 mb-1">
                        <span className="flex items-center gap-1.5">
                          <Compass className="w-3.5 h-3.5" />
                          <span>Planner AI</span>
                        </span>
                        <span className="text-[10px] font-mono">{scenario.agents.plannerAi.confidence * 100}%</span>
                      </div>
                      <p className="text-[11px] leading-snug" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>
                        {scenario.agents.plannerAi.finding}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: EVIDENCE DOSSIER */}
              {activeTab === "evidence" && (
                <div className="space-y-3 font-mono text-xs">
                  <div className="p-3 rounded-xl border" style={{ backgroundColor: isNight ? "#0C0C0C" : "#FAFAF7", borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA" }}>
                    <div className="text-amber-500 font-bold mb-1 flex items-center gap-1.5">
                      <EvidenceIcon type="gateway" size={14} />
                      <span>GATEWAY TELEMETRY</span>
                    </div>
                    <pre className="overflow-x-auto text-[11px] leading-relaxed" style={{ color: isNight ? "#D4D4D4" : "#404040" }}>
                      {JSON.stringify(scenario.evidence.gateway, null, 2)}
                    </pre>
                  </div>

                  <div className="p-3 rounded-xl border" style={{ backgroundColor: isNight ? "#0C0C0C" : "#FAFAF7", borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA" }}>
                    <div className="text-amber-500 font-bold mb-1 flex items-center gap-1.5">
                      <EvidenceIcon type="merchant" size={14} />
                      <span>MERCHANT OMS STATE</span>
                    </div>
                    <pre className="overflow-x-auto text-[11px] leading-relaxed" style={{ color: isNight ? "#D4D4D4" : "#404040" }}>
                      {JSON.stringify(scenario.evidence.merchant, null, 2)}
                    </pre>
                  </div>
                </div>
              )}

              {/* TAB 3: AUDIT TIMELINE */}
              {activeTab === "audit" && (
                <div className="space-y-2">
                  {scenario.auditTrail.map((ev, idx) => (
                    <div
                      key={idx}
                      className="p-3 rounded-xl border flex items-start gap-3"
                      style={{
                        backgroundColor: isNight ? "#0C0C0C" : "#FAFAF7",
                        borderColor: isNight ? "rgba(255,255,255,0.06)" : "#E7E3DA",
                      }}
                    >
                      <span className="px-2 py-0.5 rounded bg-amber-500/10 border border-amber-500/30 text-amber-500 font-mono text-[10px] font-bold">
                        {ev.step}
                      </span>
                      <div className="flex-1">
                        <div className="flex items-center justify-between text-xs font-bold" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>
                          <span>{ev.event}</span>
                          <span className="text-[10px] font-mono text-neutral-400">{ev.time}</span>
                        </div>
                        <div className="text-xs mt-0.5" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>{ev.detail}</div>
                        <div className="text-[10px] font-mono text-amber-500/80 mt-1">
                          hash: sha256:{ev.hash}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

            </div>

            {/* Column 3: Policy Decision Panel (Cols 9-12) */}
            <div
              className="lg:col-span-4 p-5 sm:p-6 flex flex-col justify-between space-y-6"
              style={{ backgroundColor: isNight ? "#0C0C0C" : "#FAFAF7" }}
            >
              <div className="space-y-5">
                <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA" }}>
                  <span className="text-xs font-mono uppercase tracking-wider text-neutral-400 font-semibold">
                    Policy Decision Panel
                  </span>
                  <span className="text-[10px] font-mono text-amber-500 font-bold">
                    FAIL-CLOSED ENGINE
                  </span>
                </div>

                {/* Primary Verdict Box */}
                <div
                  className="p-5 rounded-2xl border text-left space-y-3"
                  style={{
                    backgroundColor: scenario.safeHold
                      ? isNight ? "rgba(245,158,11,0.08)" : "rgba(254,243,199,0.7)"
                      : isNight ? "rgba(16,185,129,0.08)" : "rgba(209,250,229,0.7)",
                    borderColor: scenario.safeHold
                      ? "rgba(245,158,11,0.4)"
                      : "rgba(16,185,129,0.4)",
                  }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-mono font-bold tracking-wider uppercase text-neutral-400">
                      Policy Outcome
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold ${
                        scenario.safeHold
                          ? "bg-amber-500/20 text-amber-600 dark:text-amber-300 border border-amber-500/40"
                          : "bg-emerald-500/20 text-emerald-600 dark:text-emerald-300 border border-emerald-500/40"
                      }`}
                    >
                      {scenario.policyOutcome}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {scenario.safeHold ? (
                      <ShieldAlert className="w-6 h-6 text-amber-500 flex-shrink-0" />
                    ) : (
                      <ShieldCheck className="w-6 h-6 text-emerald-500 flex-shrink-0" />
                    )}
                    <div>
                      <div className="text-sm font-extrabold font-mono" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>
                        {scenario.policyRule}
                      </div>
                      <div className="text-[11px] font-mono text-amber-500">
                        {scenario.safeHold ? "SAFE-HOLD QUARANTINE" : "CLEARANCE GRANTED"}
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 border-t text-xs leading-relaxed" style={{ borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA", color: isNight ? "#A3A3A3" : "#66645F" }}>
                    {scenario.guardExplanation}
                  </div>
                </div>

                {/* Permitted Next Step */}
                <div
                  className="p-4 rounded-xl border space-y-2"
                  style={{
                    backgroundColor: isNight ? "#141414" : "#FFFFFF",
                    borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA",
                  }}
                >
                  <span className="text-[10px] font-mono text-amber-500 uppercase tracking-wider font-semibold">
                    Permitted Autonomous Next Step
                  </span>
                  <div className="text-xs font-semibold flex items-start gap-2" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>
                    <ArrowRight className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                    <span>{scenario.recommendedAction}</span>
                  </div>
                </div>
              </div>

              {/* Bottom Quick-Action */}
              <div className="pt-4 border-t" style={{ borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA" }}>
                <a
                  href="#architecture"
                  className="w-full text-center py-2.5 rounded-xl text-xs font-semibold border transition-colors block"
                  style={{
                    backgroundColor: isNight ? "#191919" : "#FFFFFF",
                    borderColor: isNight ? "rgba(255,255,255,0.1)" : "#E7E3DA",
                    color: isNight ? "#FAFAF9" : "#181818",
                  }}
                >
                  View Deterministic Architecture →
                </a>
              </div>
            </div>

          </div>

          {/* Inline Raw JSON Payload Modal / Inspector */}
          {showJsonModal && (
            <div
              className="p-6 border-t animate-in fade-in duration-200"
              style={{
                backgroundColor: isNight ? "#060606" : "#F4F1E9",
                borderColor: isNight ? "rgba(245,158,11,0.3)" : "#E7E3DA",
              }}
            >
              <div className="flex items-center justify-between mb-3 text-xs font-mono text-amber-500">
                <span className="flex items-center gap-2">
                  <Terminal className="w-4 h-4" />
                  <span>COMPLETE SIMULATION TELEMETRY PAYLOAD ({scenario.caseId})</span>
                </span>
                <span className="text-neutral-400 text-[11px]">MOCK DATA PAYLOAD</span>
              </div>
              <pre
                className="p-4 rounded-xl border font-mono text-xs overflow-x-auto max-h-96 leading-relaxed"
                style={{
                  backgroundColor: isNight ? "#0D0D0D" : "#FFFFFF",
                  borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA",
                  color: isNight ? "#FDE68A" : "#B45309",
                }}
              >
                {JSON.stringify(scenario, null, 2)}
              </pre>
            </div>
          )}

        </div>

      </div>
    </section>
  );
}
