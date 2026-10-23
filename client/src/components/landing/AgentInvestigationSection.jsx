import React from "react";
import { useTheme } from "../../context/ThemeContext";
import { 
  UserCheck, 
  Store, 
  Search, 
  Compass, 
  Lock, 
  CheckCircle2, 
  Cpu, 
  Terminal, 
  ArrowDown 
} from "lucide-react";

export function AgentInvestigationSection() {
  const { isNight } = useTheme();

  const agents = [
    {
      id: "customer",
      role: "Customer AI",
      tagline: "Claims & Intent Verification",
      icon: UserCheck,
      examines: [
        "Customer grievance ticket & OCR bank statement",
        "Bank debit SMS timestamps and delivery alerts",
        "User app checkout retry & session abandonment logs",
      ],
      contributes: "Determines whether buyer acted in good faith and whether debit is backed by plausible bank transaction records.",
      structuredOutput: {
        agent: "CustomerAI",
        claim_type: "DEBIT_NO_ORDER",
        apparent_debit_verified: true,
        user_intent: "CHECKOUT_COMPLETED",
        confidence: 0.94,
      },
    },
    {
      id: "shop",
      role: "Shop AI",
      tagline: "Inventory & ERP Lifecycle",
      icon: Store,
      examines: [
        "Merchant OMS cart hold timer & expiration rules",
        "Warehouse inventory allocation & dispatch status",
        "Catalog pricing, discount coupons & gross totals",
      ],
      contributes: "Verifies whether goods were physically fulfilled, reserved, or safely returned to available stock pools.",
      structuredOutput: {
        agent: "ShopAI",
        order_status: "CANCELLED_TIMEOUT",
        inventory_allocated: false,
        goods_dispatched: false,
        confidence: 0.99,
      },
    },
    {
      id: "investigator",
      role: "Investigator AI",
      tagline: "Gateway & Switch Telemetry",
      icon: Search,
      examines: [
        "Raw Razorpay / Stripe webhook payloads & HMAC signatures",
        "Gateway REST API logs, HTTP latency & 504 timeouts",
        "Banking switch reversal codes & idempotency keys",
      ],
      contributes: "Correlates low-level protocol events to detect late captures, clock skew, network drops, or duplicate retry attempts.",
      structuredOutput: {
        agent: "InvestigatorAI",
        gateway_state: "CAPTURED_POST_EXPIRY",
        time_skew_seconds: +240,
        duplicate_webhook: false,
        confidence: 0.98,
      },
    },
    {
      id: "planner",
      role: "Resolution Planner AI",
      tagline: "Candidate Action Synthesis",
      icon: Compass,
      examines: [
        "Synthesized findings from Customer, Shop & Investigator AIs",
        "Discrepancy classification taxonomy",
        "Remediation playbook options & blast radius",
      ],
      contributes: "Synthesizes multi-agent signals into a candidate action proposal, subject to deterministic server-side policy clearance.",
      structuredOutput: {
        agent: "PlannerAI",
        proposed_action: "INITIATE_REFUND_FAIL_CLOSED",
        safe_hold_required: true,
        risk_level: "LOW_VALUE_RESTRICTED",
        confidence: 0.96,
      },
    },
  ];

  return (
    <section id="agents" className="py-24 relative overflow-hidden text-left border-t transition-colors duration-300"
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
            <Cpu className="w-3.5 h-3.5" />
            <span>Isolated Agent Mandates</span>
          </div>

          <h2
            className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight leading-tight"
            style={{ color: isNight ? "#FAFAF9" : "#181818" }}
          >
            Four specialized perspectives.{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600">
              One controlled decision process.
            </span>
          </h2>

          <p
            className="text-base sm:text-lg mt-4 leading-relaxed"
            style={{ color: isNight ? "#A3A3A3" : "#66645F" }}
          >
            Rather than relying on an unconstrained single LLM, ReconAI coordinates four specialized agents in a controller-mediated sequential pipeline. Each agent is strictly confined to its domain evidence before submitting recommendations to the governance engine.
          </p>
        </div>

        {/* 4 Agent Glass Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
          {agents.map((agent) => {
            const Icon = agent.icon;
            return (
              <div
                key={agent.id}
                className="rounded-2xl border p-6 flex flex-col justify-between transition-all duration-300 hover:-translate-y-1 shadow-lg group"
                style={{
                  backgroundColor: isNight ? "#111111" : "#FFFFFF",
                  borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA",
                }}
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div
                      className="w-11 h-11 rounded-xl flex items-center justify-center border text-amber-500"
                      style={{
                        backgroundColor: isNight ? "#191919" : "#FEF3C7",
                        borderColor: "rgba(245,158,11,0.3)",
                      }}
                    >
                      <Icon className="w-5 h-5" />
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded text-neutral-400 border border-neutral-700/30">
                      CONF: {agent.structuredOutput.confidence * 100}%
                    </span>
                  </div>

                  <h3 className="text-lg font-bold transition-colors group-hover:text-amber-500" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>
                    {agent.role}
                  </h3>
                  <div className="text-xs font-medium font-mono mb-4 text-amber-500">
                    {agent.tagline}
                  </div>

                  <div className="space-y-3 mb-4">
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-neutral-400">
                      Evidence Examined:
                    </div>
                    <ul className="space-y-1.5 text-xs" style={{ color: isNight ? "#D4D4D4" : "#525252" }}>
                      {agent.examines.map((item, idx) => (
                        <li key={idx} className="flex items-start gap-1.5">
                          <span className="text-amber-500 font-bold leading-none mt-0.5">•</span>
                          <span>{item}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div
                    className="p-3 rounded-lg border text-xs leading-relaxed mb-4"
                    style={{
                      backgroundColor: isNight ? "#161616" : "#F4F1E9",
                      borderColor: isNight ? "rgba(255,255,255,0.04)" : "#E7E3DA",
                      color: isNight ? "#A3A3A3" : "#66645F",
                    }}
                  >
                    <span className="font-semibold text-amber-500">Contribution: </span>
                    {agent.contributes}
                  </div>
                </div>

                {/* Structured Output Preview */}
                <div
                  className="rounded-lg border p-2.5 font-mono text-[10px]"
                  style={{
                    backgroundColor: isNight ? "#0C0C0C" : "#FAFAF7",
                    borderColor: isNight ? "rgba(255,255,255,0.06)" : "#E7E3DA",
                  }}
                >
                  <div className="flex items-center justify-between text-neutral-500 text-[9px] mb-1.5 pb-1 border-b border-neutral-800">
                    <span className="flex items-center gap-1">
                      <Terminal className="w-3 h-3 text-amber-500" />
                      <span>structured_inference.json</span>
                    </span>
                    <span className="text-emerald-500">PASSED</span>
                  </div>
                  <pre className="text-amber-500/90 overflow-x-auto leading-tight">
                    {JSON.stringify(agent.structuredOutput, null, 2)}
                  </pre>
                </div>
              </div>
            );
          })}
        </div>

        {/* Sequential Visual Flow Indicator */}
        <div className="flex flex-col items-center justify-center mb-8">
          <div
            className="flex items-center gap-3 px-4 py-2 rounded-full border text-xs font-mono shadow-sm"
            style={{
              backgroundColor: isNight ? "#111111" : "#FFFFFF",
              borderColor: isNight ? "rgba(255,255,255,0.1)" : "#E7E3DA",
              color: isNight ? "#D4D4D4" : "#525252",
            }}
          >
            <span className="text-amber-500 font-semibold">AI Recommendations</span>
            <span className="text-neutral-500">→</span>
            <span style={{ color: isNight ? "#FAFAF9" : "#181818" }}>Verified Evidence</span>
            <span className="text-neutral-500">→</span>
            <span className="text-amber-500 font-semibold">Deterministic Policy</span>
            <span className="text-neutral-500">→</span>
            <span className="text-emerald-500 font-semibold">Permitted Next Step</span>
          </div>
          <ArrowDown className="w-5 h-5 text-amber-500 mt-2 animate-bounce" />
        </div>

        {/* Stronger Governance Control Layer: Deterministic Policy Engine */}
        <div
          className="rounded-2xl border p-6 sm:p-8 shadow-2xl relative"
          style={{
            backgroundColor: isNight ? "rgba(20,20,20,0.85)" : "#FFFFFF",
            borderColor: "rgba(245,158,11,0.35)",
          }}
        >
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            
            <div className="lg:col-span-8 space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-amber-500/15 border border-amber-500/30 text-amber-500 text-xs font-bold uppercase tracking-wider">
                <Lock className="w-3.5 h-3.5" />
                <span>Deterministic Governance Firewall</span>
              </div>

              <h3
                className="text-2xl sm:text-3xl font-extrabold"
                style={{ color: isNight ? "#FAFAF9" : "#181818" }}
              >
                "AI agents investigate and recommend. Deterministic server-side policies govern financial eligibility."
              </h3>

              <p className="text-sm sm:text-base leading-relaxed" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>
                ReconAI strictly separates cognitive inference from transactional authority. No AI model possesses API credentials to execute refunds or mutate ledgers. All actions must satisfy zero-tolerance mathematical rules, approved policy limits, durable idempotency locks, and fail-closed state checks.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 text-xs">
                <div className="flex items-center gap-2 p-2.5 rounded-lg border" style={{ backgroundColor: isNight ? "#141414" : "#F4F1E9", borderColor: isNight ? "rgba(255,255,255,0.06)" : "#E7E3DA" }}>
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  <span style={{ color: isNight ? "#D4D4D4" : "#404040" }}>Fail-closed when provider status is uncertain</span>
                </div>
                <div className="flex items-center gap-2 p-2.5 rounded-lg border" style={{ backgroundColor: isNight ? "#141414" : "#F4F1E9", borderColor: isNight ? "rgba(255,255,255,0.06)" : "#E7E3DA" }}>
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  <span style={{ color: isNight ? "#D4D4D4" : "#404040" }}>Durable idempotency keys block duplicate actions</span>
                </div>
                <div className="flex items-center gap-2 p-2.5 rounded-lg border" style={{ backgroundColor: isNight ? "#141414" : "#F4F1E9", borderColor: isNight ? "rgba(255,255,255,0.06)" : "#E7E3DA" }}>
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  <span style={{ color: isNight ? "#D4D4D4" : "#404040" }}>Zero unauthorized provider writes</span>
                </div>
                <div className="flex items-center gap-2 p-2.5 rounded-lg border" style={{ backgroundColor: isNight ? "#141414" : "#F4F1E9", borderColor: isNight ? "rgba(255,255,255,0.06)" : "#E7E3DA" }}>
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />
                  <span style={{ color: isNight ? "#D4D4D4" : "#404040" }}>Controller-mediated sequential pipeline</span>
                </div>
              </div>
            </div>

            {/* Right: Policy Rule Check Display */}
            <div
              className="lg:col-span-4 rounded-xl border p-5 font-mono text-xs shadow-inner space-y-3"
              style={{
                backgroundColor: isNight ? "#0C0C0C" : "#FAFAF7",
                borderColor: "rgba(245,158,11,0.3)",
              }}
            >
              <div className="flex items-center justify-between text-amber-500 border-b pb-2" style={{ borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA" }}>
                <span className="font-bold">SERVER_POLICY_EVAL</span>
                <span className="text-emerald-500 font-bold">ENFORCED</span>
              </div>
              <div className="space-y-2 text-[11px]" style={{ color: isNight ? "#D4D4D4" : "#404040" }}>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Policy Version:</span>
                  <span style={{ color: isNight ? "#FAFAF9" : "#181818" }}>2026.10-STABLE</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Refund Limit Check:</span>
                  <span className="text-emerald-500 font-semibold">STRICT_CAP_OK</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Idempotency Lock:</span>
                  <span className="text-amber-500 font-semibold">COMMITTED</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-neutral-500">Provider Mutation:</span>
                  <span className="text-amber-500 font-semibold">READ_ONLY_GUARD</span>
                </div>
              </div>
              <div className="pt-2 border-t text-center text-[10px] text-neutral-500" style={{ borderColor: isNight ? "rgba(255,255,255,0.06)" : "#E7E3DA" }}>
                Rule engine executes in Node.js server sandbox.
              </div>
            </div>

          </div>
        </div>

      </div>
    </section>
  );
}
