import React, { useState, useEffect, useRef } from "react";
import { useTheme } from "../../context/ThemeContext";
import { ReconSphere } from "./ReconSphere";
import { 
  Radar, 
  FileStack, 
  Cpu, 
  ShieldCheck, 
  AlertTriangle, 
  Hash, 
  CheckCircle2, 
  Lock, 
  ArrowRight, 
  UserCheck, 
  Store, 
  Search, 
  Compass,
  FileText,
  Clock,
  Sparkles,
  ChevronRight
} from "lucide-react";

export function ScrollNarrativeSection() {
  const { isNight } = useTheme();
  const [currentStage, setCurrentStage] = useState(1);
  const containerRef = useRef(null);

  const narrativeStages = [
    {
      stage: 1,
      title: "Stage 1 — Detect",
      tag: "INGRESS SIGNAL",
      headline: "A payment event is detected in the stream.",
      sphereState: "detect",
      sphereLabel: "STAGE 1: SIGNAL DETECTED",
      card: {
        title: "PAYMENT EVENT DETECTED",
        badge: "WEBHOOK INGESTED",
        ref: "pay_RAZ_timeout_9918",
        time: "13:45:00.010Z",
        status: "504 Gateway Timeout",
        source: "Razorpay UPI Webhook Listener",
        detail: "Ingestion controller captures raw HTTP payload and validates SHA-256 HMAC signature against tenant secret.",
      },
    },
    {
      stage: 2,
      title: "Stage 2 — Collect Evidence",
      tag: "MULTI-SOURCE ASSEMBLY",
      headline: "Evidence is queried across 3 independent systems.",
      sphereState: "collect",
      sphereLabel: "STAGE 2: EVIDENCE LINKED",
      card: {
        title: "EVIDENCE DOSSIER ASSEMBLED",
        badge: "3 VERIFIED RECORDS",
        ref: "dossier_RC84920_v1",
        time: "13:45:01.450Z",
        items: [
          { name: "Customer Bank Claim", status: "SMS debit verified (₹50,000)", verified: true },
          { name: "Merchant OMS DB", status: "Cart timeout, unfulfilled", verified: true },
          { name: "Gateway Telemetry", status: "HTTP 504, switch uncertain", verified: false },
        ],
        detail: "Read-only orchestrator queries internal databases without granting write access to external APIs.",
      },
    },
    {
      stage: 3,
      title: "Stage 3 — Investigate",
      tag: "FOUR SPECIALIZED PERSPECTIVES",
      headline: "Four AI agents analyze domain-isolated evidence.",
      sphereState: "investigate",
      sphereLabel: "STAGE 3: AGENTS INVESTIGATING",
      card: {
        title: "COGNITIVE PIPELINE EXECUTION",
        badge: "ADVISORY RECOMMENDATIONS",
        ref: "agents_eval_seq_04",
        time: "13:45:02.890Z",
        agents: [
          { name: "Customer AI", conf: "94%", finding: "Plausible bank account charge" },
          { name: "Shop AI", conf: "98%", finding: "Order unfulfilled in warehouse" },
          { name: "Investigator AI", conf: "91%", finding: "Upstream switch state unknown" },
          { name: "Planner AI", conf: "93%", finding: "Recommend Safe-Hold re-poll" },
        ],
        detail: "Controller-mediated sequential pipeline. Agents formulate recommendations but possess zero execution credentials.",
      },
    },
    {
      stage: 4,
      title: "Stage 4 — Policy Evaluation",
      tag: "DETERMINISTIC FIREWALL",
      headline: "Server policy rules enforce mathematical invariants.",
      sphereState: "policy",
      sphereLabel: "STAGE 4: POLICY GUARD",
      card: {
        title: "DETERMINISTIC SERVER POLICY",
        badge: "FAIL-CLOSED RULE",
        ref: "PR-04_INDETERMINATE_GUARD",
        time: "13:45:03.110Z",
        checks: [
          { rule: "Idempotency Lock", result: "COMMITTED" },
          { rule: "Provider Certainty", result: "UNCERTAIN (504)" },
          { rule: "Approved Limit Check", result: "CAP VALID" },
          { rule: "Permitted Next Step", result: "SAFE_HOLD" },
        ],
        detail: "Deterministic rules override all agent suggestions. Ambiguity defaults to lock down.",
      },
    },
    {
      stage: 5,
      title: "Stage 5 — Resolve or Safe-Hold",
      tag: "SAFE EXECUTION FORK",
      headline: "Uncertainty halts mutation. Safe-Hold quarantine assigned.",
      sphereState: "safe_hold",
      sphereLabel: "STAGE 5: SAFE-HOLD LOCKED",
      card: {
        title: "SAFE-HOLD QUARANTINE ACTIVATED",
        badge: "MUTATIONS BLOCKED",
        ref: "hold_RC84920_lock",
        time: "13:45:03.500Z",
        safeHoldReasons: [
          "Automatic refund: BLOCKED (Prevents double refund risk)",
          "Order reopening: BLOCKED (Warehouse inventory protected)",
          "Next Action: Read-only provider verification at T+300s",
        ],
        detail: "Autonomous workers cannot refund without definitive gateway finality. Case 22 remains safely held.",
      },
    },
    {
      stage: 6,
      title: "Stage 6 — Audit",
      tag: "CRYPTOGRAPHIC LEDGER",
      headline: "Every decision has evidence. Every outcome has a record.",
      sphereState: "verified",
      sphereLabel: "STAGE 6: AUDIT COMMITTED",
      card: {
        title: "CRYPTOGRAPHIC AUDIT SEAL",
        badge: "IMMUTABLE SHA-256",
        ref: "sha256:9b12e3a890f1d072",
        time: "13:45:04.000Z",
        auditStats: [
          { label: "Pipeline Duration", val: "1.24s" },
          { label: "Policy Version", val: "2026.10-STABLE" },
          { label: "Merkle Hash", val: "9b12..cc33" },
          { label: "Operator Alert", val: "QUEUED" },
        ],
        detail: "Tamper-evident record committed to append-only database cluster for complete regulatory traceability.",
      },
    },
  ];

  const activeNarrative = narrativeStages[currentStage - 1];

  return (
    <section id="storyline" className="py-24 relative overflow-hidden text-left border-t"
      style={{
        backgroundColor: isNight ? "#090909" : "#F4F1E9",
        borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA",
      }}
    >
      {/* Ambient background light */}
      <div
        className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[700px] h-[700px] rounded-full blur-[170px] pointer-events-none"
        style={{
          background: isNight
            ? "radial-gradient(circle, rgba(245,158,11,0.14) 0%, transparent 70%)"
            : "radial-gradient(circle, rgba(254,243,199,0.9) 0%, rgba(245,158,11,0.2) 50%, transparent 70%)",
        }}
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10" ref={containerRef}>
        
        {/* Section Header */}
        <div className="max-w-3xl mb-12">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono font-semibold uppercase tracking-wider mb-3 border"
            style={{
              backgroundColor: isNight ? "rgba(17,17,17,0.8)" : "rgba(255,255,255,0.9)",
              color: isNight ? "#FBBF24" : "#D97706",
              borderColor: isNight ? "rgba(245,158,11,0.3)" : "rgba(217,119,6,0.3)",
            }}
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-500" />
            <span>Interactive Storyline</span>
          </div>

          <h2
            className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight leading-tight"
            style={{ color: isNight ? "#FAFAF9" : "#181818" }}
          >
            Scroll-driven AI resolution{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600">
              narrative.
            </span>
          </h2>

          <p
            className="text-base sm:text-lg mt-3 leading-relaxed"
            style={{ color: isNight ? "#A3A3A3" : "#66645F" }}
          >
            Watch the central ReconAI Core evolve through the six disciplined stages of a payment investigation. Select any stage or navigate step-by-step.
          </p>
        </div>

        {/* Stage Timeline Navigation Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 mb-12">
          {narrativeStages.map((stg) => {
            const isSelected = currentStage === stg.stage;
            return (
              <button
                key={stg.stage}
                onClick={() => setCurrentStage(stg.stage)}
                className={`p-3.5 rounded-xl border text-left transition-all duration-300 relative cursor-pointer flex flex-col justify-between ${
                  isSelected
                    ? "border-amber-500 shadow-[0_0_20px_rgba(245,158,11,0.25)] scale-[1.02]"
                    : "border-transparent hover:border-amber-500/30"
                }`}
                style={{
                  backgroundColor: isSelected
                    ? isNight ? "#191919" : "#FFFFFF"
                    : isNight ? "rgba(17,17,17,0.5)" : "rgba(255,255,255,0.5)",
                }}
              >
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className={`text-[10px] font-mono font-bold ${isSelected ? "text-amber-500" : isNight ? "text-neutral-500" : "text-neutral-400"}`}>
                      0{stg.stage}
                    </span>
                    <span className={`w-1.5 h-1.5 rounded-full ${isSelected ? "bg-amber-500" : "bg-neutral-600"}`} />
                  </div>
                  <div className="text-xs font-bold leading-snug" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>
                    {stg.title.split("— ")[1]}
                  </div>
                </div>
                {isSelected && (
                  <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-8 h-1 rounded-full bg-amber-500" />
                )}
              </button>
            );
          })}
        </div>

        {/* Spatial Stage Viewer: Left (Narrative Details) | Center (ReconSphere) | Right (Active Card) */}
        <div
          className="rounded-3xl border p-6 sm:p-10 shadow-2xl relative overflow-hidden transition-all duration-500"
          style={{
            backgroundColor: isNight ? "rgba(17,17,17,0.85)" : "rgba(255,255,255,0.9)",
            backdropFilter: "blur(24px)",
            borderColor: isNight ? "rgba(245,158,11,0.25)" : "#E7E3DA",
          }}
        >
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            
            {/* Left Narrative Text (Cols 1-4) */}
            <div className="lg:col-span-4 space-y-4">
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded text-xs font-mono font-bold bg-amber-500/15 text-amber-500 border border-amber-500/30">
                  {activeNarrative.title}
                </span>
                <span className="text-[11px] font-mono tracking-wider uppercase text-neutral-400">
                  {activeNarrative.tag}
                </span>
              </div>

              <h3
                className="text-2xl sm:text-3xl font-extrabold leading-tight"
                style={{ color: isNight ? "#FAFAF9" : "#181818" }}
              >
                {activeNarrative.headline}
              </h3>

              <p className="text-sm leading-relaxed" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>
                {activeNarrative.card.detail}
              </p>

              {/* Step Navigation Controls */}
              <div className="pt-4 flex items-center gap-3">
                <button
                  onClick={() => setCurrentStage((prev) => (prev > 1 ? prev - 1 : 6))}
                  className="px-3.5 py-2 rounded-lg text-xs font-semibold border cursor-pointer transition-colors"
                  style={{
                    backgroundColor: isNight ? "#191919" : "#F4F1E9",
                    color: isNight ? "#FAFAF9" : "#181818",
                    borderColor: isNight ? "rgba(255,255,255,0.1)" : "#E7E3DA",
                  }}
                >
                  ← Previous
                </button>

                <button
                  onClick={() => setCurrentStage((prev) => (prev < 6 ? prev + 1 : 1))}
                  className="px-4 py-2 rounded-lg text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 shadow-[0_0_15px_rgba(245,158,11,0.3)] cursor-pointer flex items-center gap-1.5 transition-colors"
                >
                  <span>Next: {narrativeStages[currentStage % 6].title.split("— ")[1]}</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* Center Dynamic Sphere (Cols 5-8) */}
            <div className="lg:col-span-4 flex items-center justify-center py-4">
              <ReconSphere
                size={340}
                stage={activeNarrative.sphereState}
                stageLabel={activeNarrative.sphereLabel}
                interactive={true}
              />
            </div>

            {/* Right Storyline Telemetry Card (Cols 9-12) */}
            <div className="lg:col-span-4">
              <div
                className="p-5 rounded-2xl border shadow-inner text-left font-mono space-y-3"
                style={{
                  backgroundColor: isNight ? "#0C0C0C" : "#FAFAF7",
                  borderColor: isNight ? "rgba(245,158,11,0.2)" : "#E7E3DA",
                }}
              >
                <div className="flex items-center justify-between border-b pb-2" style={{ borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA" }}>
                  <span className="text-xs font-bold text-amber-500">
                    {activeNarrative.card.title}
                  </span>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/10 text-amber-500 font-semibold">
                    {activeNarrative.card.badge}
                  </span>
                </div>

                <div className="text-[11px] space-y-1.5" style={{ color: isNight ? "#D4D4D4" : "#404040" }}>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Ref:</span>
                    <span className="text-amber-500 font-semibold">{activeNarrative.card.ref}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-neutral-500">Time:</span>
                    <span>{activeNarrative.card.time}</span>
                  </div>

                  {/* Stage-specific items */}
                  {activeNarrative.card.items && (
                    <div className="pt-2 border-t border-white/[0.05] space-y-1">
                      {activeNarrative.card.items.map((it, idx) => (
                        <div key={idx} className="flex justify-between text-[10px]">
                          <span>{it.name}:</span>
                          <span className={it.verified ? "text-emerald-500" : "text-amber-500"}>{it.status}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {activeNarrative.card.agents && (
                    <div className="pt-2 border-t border-white/[0.05] space-y-1">
                      {activeNarrative.card.agents.map((ag, idx) => (
                        <div key={idx} className="flex justify-between text-[10px]">
                          <span>{ag.name} ({ag.conf}):</span>
                          <span className="text-amber-500 truncate max-w-[150px]">{ag.finding}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {activeNarrative.card.checks && (
                    <div className="pt-2 border-t border-white/[0.05] space-y-1">
                      {activeNarrative.card.checks.map((chk, idx) => (
                        <div key={idx} className="flex justify-between text-[10px]">
                          <span>{chk.rule}:</span>
                          <span className={chk.result === "COMMITTED" ? "text-emerald-500" : "text-amber-500"}>{chk.result}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  {activeNarrative.card.safeHoldReasons && (
                    <div className="pt-2 border-t border-white/[0.05] space-y-1 text-amber-500 text-[10px]">
                      {activeNarrative.card.safeHoldReasons.map((rsn, idx) => (
                        <div key={idx}>• {rsn}</div>
                      ))}
                    </div>
                  )}

                  {activeNarrative.card.auditStats && (
                    <div className="pt-2 border-t border-white/[0.05] space-y-1">
                      {activeNarrative.card.auditStats.map((st, idx) => (
                        <div key={idx} className="flex justify-between text-[10px]">
                          <span>{st.label}:</span>
                          <span className="text-emerald-500 font-bold">{st.val}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="pt-2 border-t text-[10px] text-neutral-500 italic text-center" style={{ borderColor: isNight ? "rgba(255,255,255,0.06)" : "#E7E3DA" }}>
                  "Every decision has evidence. Every outcome has a record."
                </div>
              </div>
            </div>

          </div>
        </div>

      </div>
    </section>
  );
}
