import React, { useState } from "react";
import { useTheme } from "../../context/ThemeContext";
import { 
  LayoutDashboard, 
  Layers, 
  FileSearch, 
  ShieldCheck, 
  AlertOctagon, 
  History, 
  UserCheck, 
  Store,
  ChevronRight,
  TrendingUp,
  Search
} from "lucide-react";

export function ProductGallerySection() {
  const { isNight } = useTheme();
  const [activeTab, setActiveTab] = useState("ops_overview");

  const views = [
    {
      id: "ops_overview",
      name: "Operations Overview",
      category: "Verified Core UI",
      badge: "LIVE DEMO",
      badgeColor: "emerald",
      icon: LayoutDashboard,
      description: "High-level command center showing active reconciliation runs, 24h mismatch metrics, autonomous auto-match rate, and active Safe-Hold alerts.",
      previewType: "overview",
    },
    {
      id: "cases_table",
      name: "Payment Cases Queue",
      category: "Verified Core UI",
      badge: "LIVE DEMO",
      badgeColor: "emerald",
      icon: Layers,
      description: "Live queue of ingested transactions with automated discrepancy classification, tenant tags, and fail-closed status filtering.",
      previewType: "cases",
    },
    {
      id: "case_detail",
      name: "Forensic Case Detail",
      category: "Forensic Investigation",
      badge: "LIVE DEMO",
      badgeColor: "emerald",
      icon: FileSearch,
      description: "Deep-dive case breakdown showing side-by-side gateway, customer bank, and merchant OMS telemetry alongside agent confidence scores.",
      previewType: "case_detail",
    },
    {
      id: "policy_engine",
      name: "Deterministic Policy Rules",
      category: "Governance Firewall",
      badge: "Concept UI",
      badgeColor: "amber",
      icon: ShieldCheck,
      description: "Server-side governance matrix enforcing mathematical tolerances, refund ceilings, and fail-closed threshold triggers.",
      previewType: "policy",
    },
    {
      id: "safe_hold_queue",
      name: "Safe-Hold Quarantine",
      category: "Risk Mitigation",
      badge: "LIVE DEMO",
      badgeColor: "amber",
      icon: AlertOctagon,
      description: "Dedicated queue for high-risk, ambiguous, or expired transactions requiring read-only verification before any money movement.",
      previewType: "safe_hold",
    },
    {
      id: "audit_trail",
      name: "Cryptographic Audit Trail",
      category: "Compliance & Ledger",
      badge: "LIVE DEMO",
      badgeColor: "emerald",
      icon: History,
      description: "Immutable, append-only event ledger verifying every agent inference and deterministic rule evaluation with SHA-256 hashes.",
      previewType: "audit",
    },
    {
      id: "customer_portal",
      name: "Customer Dispute Portal",
      category: "Self-Service",
      badge: "Planned Interface",
      badgeColor: "neutral",
      icon: UserCheck,
      description: "Transparent self-serve interface allowing end-customers to monitor bank auto-reversal status with bank reference (RRN) tracking.",
      previewType: "customer",
    },
    {
      id: "merchant_portal",
      name: "Merchant Settlement Console",
      category: "Partner Ops",
      badge: "Planned Interface",
      badgeColor: "neutral",
      icon: Store,
      description: "Unified view for merchant finance teams to track fee discrepancies, gateway hold-backs, and reconciled settlement batches.",
      previewType: "merchant",
    },
  ];

  const currentView = views.find((v) => v.id === activeTab) || views[0];

  return (
    <section id="product-ui" className="py-24 relative overflow-hidden text-left border-t transition-colors duration-300"
      style={{
        backgroundColor: isNight ? "#080808" : "#FAFAF7",
        borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA",
      }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* Section Header */}
        <div className="max-w-3xl mb-12">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider mb-3 border"
            style={{
              backgroundColor: isNight ? "rgba(17,17,17,0.8)" : "rgba(255,255,255,0.9)",
              color: isNight ? "#FBBF24" : "#D97706",
              borderColor: isNight ? "rgba(245,158,11,0.3)" : "rgba(217,119,6,0.3)",
            }}
          >
            <LayoutDashboard className="w-3.5 h-3.5" />
            <span>Product Interface Gallery</span>
          </div>

          <h2
            className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight leading-tight"
            style={{ color: isNight ? "#FAFAF9" : "#181818" }}
          >
            Designed for enterprise{" "}
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600">
              financial operations.
            </span>
          </h2>

          <p className="text-base sm:text-lg mt-4 leading-relaxed" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>
            Explore authentic previews of ReconAI's modular controller interfaces—engineered for finance controllers, risk officers, and automated operations teams.
          </p>
        </div>

        {/* Tab Selector Strip */}
        <div className="flex items-center gap-2 overflow-x-auto pb-4 mb-8 no-scrollbar">
          {views.map((tab) => {
            const Icon = tab.icon;
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex-shrink-0 px-4 py-2.5 rounded-xl border text-xs font-semibold transition-all duration-200 flex items-center gap-2 cursor-pointer ${
                  isSelected
                    ? "border-amber-500 text-amber-500 shadow-[0_0_15px_rgba(245,158,11,0.25)]"
                    : "border-transparent"
                }`}
                style={{
                  backgroundColor: isSelected
                    ? isNight ? "#1C1C1C" : "#FFFFFF"
                    : isNight ? "#111111" : "#F4F1E9",
                  color: isSelected
                    ? isNight ? "#FAFAF9" : "#181818"
                    : isNight ? "#A3A3A3" : "#66645F",
                }}
              >
                <Icon className={`w-4 h-4 ${isSelected ? "text-amber-500" : ""}`} />
                <span>{tab.name}</span>
                <span
                  className={`text-[9px] font-mono px-1.5 py-0.2 rounded ${
                    tab.badgeColor === "emerald"
                      ? "bg-emerald-500/20 text-emerald-500"
                      : tab.badgeColor === "amber"
                      ? "bg-amber-500/20 text-amber-500"
                      : "bg-neutral-700/20 text-neutral-400"
                  }`}
                >
                  {tab.badge}
                </span>
              </button>
            );
          })}
        </div>

        {/* Main Product Preview Frame */}
        <div
          className="rounded-3xl border shadow-2xl overflow-hidden"
          style={{
            backgroundColor: isNight ? "rgba(17,17,17,0.85)" : "#FFFFFF",
            borderColor: isNight ? "rgba(255,255,255,0.1)" : "#E7E3DA",
          }}
        >
          {/* Top Bar */}
          <div
            className="px-5 py-3 border-b flex flex-wrap items-center justify-between gap-3 text-xs"
            style={{
              backgroundColor: isNight ? "#0C0C0C" : "#F4F1E9",
              borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA",
            }}
          >
            <div className="flex items-center gap-3">
              <div className="flex gap-1.5">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500/80" />
                <span className="w-2.5 h-2.5 rounded-full bg-green-500/80" />
              </div>
              <span className="font-mono text-neutral-400 text-[11px]">
                app.reconai.io/portal/{currentView.id}
              </span>
            </div>

            <div className="flex items-center gap-3">
              <span className="text-[10px] font-mono px-2 py-0.5 rounded border border-neutral-700/30 text-neutral-400">
                ORGANIZATION: ACME ENTERPRISE INDIA (TENANT #TN-981)
              </span>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/15 text-amber-500 border border-amber-500/30">
                SIMULATION DATA
              </span>
            </div>
          </div>

          {/* Description Strip */}
          <div
            className="px-6 py-3 border-b text-xs flex items-center justify-between"
            style={{
              backgroundColor: isNight ? "#141414" : "#FAFAF7",
              borderColor: isNight ? "rgba(255,255,255,0.06)" : "#E7E3DA",
              color: isNight ? "#D4D4D4" : "#404040",
            }}
          >
            <div>
              <span className="font-semibold text-amber-500">{currentView.name}: </span>
              <span>{currentView.description}</span>
            </div>
          </div>

          {/* Dynamic Mockup Body */}
          <div className="p-6 min-h-[360px]" style={{ backgroundColor: isNight ? "#080808" : "#FFFFFF" }}>
            
            {currentView.previewType === "overview" && (
              <div className="space-y-6">
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  <div className="p-4 rounded-xl border" style={{ backgroundColor: isNight ? "#111111" : "#FAFAF7", borderColor: isNight ? "rgba(255,255,255,0.06)" : "#E7E3DA" }}>
                    <div className="text-[10px] font-mono text-neutral-400">Total Ingested (24h)</div>
                    <div className="text-xl font-bold font-mono mt-1 text-amber-500">₹4,89,20,500</div>
                    <div className="text-[10px] text-emerald-500 mt-1 flex items-center gap-1">
                      <TrendingUp className="w-3 h-3" />
                      <span>+12.4% vs yesterday</span>
                    </div>
                  </div>
                  <div className="p-4 rounded-xl border" style={{ backgroundColor: isNight ? "#111111" : "#FAFAF7", borderColor: isNight ? "rgba(255,255,255,0.06)" : "#E7E3DA" }}>
                    <div className="text-[10px] font-mono text-neutral-400">Autonomous Match Rate</div>
                    <div className="text-xl font-bold font-mono mt-1 text-emerald-500">99.84%</div>
                    <div className="text-[10px] text-neutral-400 mt-1">12,410 batches balanced</div>
                  </div>
                  <div className="p-4 rounded-xl border" style={{ backgroundColor: isNight ? "#111111" : "#FAFAF7", borderColor: isNight ? "rgba(255,255,255,0.06)" : "#E7E3DA" }}>
                    <div className="text-[10px] font-mono text-neutral-400">Active Discrepancies</div>
                    <div className="text-xl font-bold font-mono mt-1 text-amber-500">7 Cases</div>
                    <div className="text-[10px] text-neutral-400 mt-1">Under agent analysis</div>
                  </div>
                  <div className="p-4 rounded-xl border" style={{ backgroundColor: isNight ? "#111111" : "#FEF3C7/40", borderColor: "rgba(245,158,11,0.3)" }}>
                    <div className="text-[10px] font-mono text-amber-500">Safe-Hold Quarantine</div>
                    <div className="text-xl font-bold font-mono mt-1 text-amber-500">3 Cases</div>
                    <div className="text-[10px] text-neutral-400 mt-1">Auto-refunds locked</div>
                  </div>
                </div>

                <div className="p-4 rounded-xl border" style={{ backgroundColor: isNight ? "#111111" : "#FAFAF7", borderColor: isNight ? "rgba(255,255,255,0.06)" : "#E7E3DA" }}>
                  <div className="flex items-center justify-between mb-3 text-xs font-semibold" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>
                    <span>Recent Autonomous Reconciliations</span>
                    <span className="text-[10px] font-mono text-amber-500">Real-time Stream</span>
                  </div>
                  <div className="space-y-2 text-xs font-mono">
                    {[
                      { id: "RC-89101", merchant: "UrbanTech Retailers", amount: "₹12,499.00", status: "Auto-Resolved", color: "text-emerald-500" },
                      { id: "RC-84920", merchant: "Apex Electronics", amount: "₹50,000.00", status: "Gateway 504 Timeout", color: "text-amber-500" },
                      { id: "RC-78119", merchant: "Zenith Apparel", amount: "₹3,499.00", status: "Duplicate Webhook Suppressed", color: "text-amber-400" },
                    ].map((row, i) => (
                      <div key={i} className="flex items-center justify-between p-2.5 rounded-lg border" style={{ backgroundColor: isNight ? "#161616" : "#FFFFFF", borderColor: isNight ? "rgba(255,255,255,0.04)" : "#E7E3DA" }}>
                        <span className="text-amber-500 font-bold">{row.id}</span>
                        <span style={{ color: isNight ? "#D4D4D4" : "#404040" }}>{row.merchant}</span>
                        <span className="font-bold" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>{row.amount}</span>
                        <span className={row.color}>{row.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {currentView.previewType === "cases" && (
              <div className="space-y-3 font-mono text-xs">
                <div className="flex items-center justify-between p-2 rounded-lg border" style={{ backgroundColor: isNight ? "#111111" : "#F4F1E9", borderColor: isNight ? "rgba(255,255,255,0.06)" : "#E7E3DA" }}>
                  <div className="flex items-center gap-2 text-neutral-400">
                    <Search className="w-3.5 h-3.5" />
                    <span className="text-[11px]">Filter by Case ID, Merchant, or Status...</span>
                  </div>
                  <div className="flex gap-2 text-[10px]">
                    <span className="px-2 py-0.5 rounded border border-neutral-700/30 text-neutral-400">All (28)</span>
                    <span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-500 font-bold">Safe-Hold (5)</span>
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-500 font-bold">Resolved (23)</span>
                  </div>
                </div>

                <div className="rounded-xl border overflow-hidden" style={{ borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA" }}>
                  <table className="w-full text-left text-[11px]">
                    <thead className="text-[9px] uppercase tracking-wider border-b" style={{ backgroundColor: isNight ? "#0C0C0C" : "#F4F1E9", borderColor: isNight ? "rgba(255,255,255,0.06)" : "#E7E3DA", color: isNight ? "#A3A3A3" : "#66645F" }}>
                      <tr>
                        <th className="p-3">Case ID</th>
                        <th className="p-3">Discrepancy Category</th>
                        <th className="p-3">Valuation</th>
                        <th className="p-3">Gateway Log</th>
                        <th className="p-3">Policy State</th>
                        <th className="p-3">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y" style={{ borderColor: isNight ? "rgba(255,255,255,0.04)" : "#E7E3DA" }}>
                      <tr>
                        <td className="p-3 font-bold text-amber-500">RC-84920</td>
                        <td className="p-3" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>Gateway Timeout (504)</td>
                        <td className="p-3 font-bold text-amber-500">₹50,000.00</td>
                        <td className="p-3 text-rose-500">Razorpay Timeout</td>
                        <td className="p-3"><span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-500 font-semibold">SAFE_HOLD</span></td>
                        <td className="p-3 text-amber-500 hover:underline cursor-pointer">Inspect Dossier →</td>
                      </tr>
                      <tr>
                        <td className="p-3 font-bold text-amber-500">RC-41092</td>
                        <td className="p-3" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>Late Capture on Expired Cart</td>
                        <td className="p-3 font-bold text-amber-500">₹18,500.00</td>
                        <td className="p-3 text-emerald-500">Captured (+240s)</td>
                        <td className="p-3"><span className="px-2 py-0.5 rounded bg-amber-500/20 text-amber-500 font-semibold">SAFE_HOLD</span></td>
                        <td className="p-3 text-amber-500 hover:underline cursor-pointer">Inspect Dossier →</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {currentView.previewType !== "overview" && currentView.previewType !== "cases" && (
              <div className="p-6 rounded-xl border space-y-4" style={{ backgroundColor: isNight ? "#0C0C0C" : "#FAFAF7", borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA" }}>
                <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA" }}>
                  <div className="flex items-center gap-2">
                    <currentView.icon className="w-5 h-5 text-amber-500" />
                    <span className="text-base font-bold" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>{currentView.name}</span>
                  </div>
                  <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-amber-500/10 text-amber-500 border border-amber-500/30">
                    {currentView.category}
                  </span>
                </div>

                <p className="text-xs leading-relaxed" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>
                  {currentView.description}
                </p>

                <div className="p-4 rounded-xl border font-mono text-xs space-y-2" style={{ backgroundColor: isNight ? "#141414" : "#FFFFFF", borderColor: isNight ? "rgba(255,255,255,0.04)" : "#E7E3DA", color: isNight ? "#D4D4D4" : "#404040" }}>
                  <div className="text-[10px] uppercase tracking-wider text-neutral-400">Simulated Telemetry Stream</div>
                  <div className="text-amber-500">{`// Configured policies for: ${currentView.id}`}</div>
                  <div>status: <span className="text-emerald-500">ACTIVE_HEALTHY</span></div>
                  <div>security_guard: <span className="text-amber-500">STRICT_IDEMPOTENCY_COMMITTED</span></div>
                  <div>read_only_provider_mode: <span className="text-amber-500">TRUE (ENFORCED)</span></div>
                </div>
              </div>
            )}

          </div>

          <div
            className="px-6 py-3 border-t flex items-center justify-between text-xs"
            style={{
              backgroundColor: isNight ? "#0C0C0C" : "#F4F1E9",
              borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA",
              color: isNight ? "#A3A3A3" : "#66645F",
            }}
          >
            <span>All mock interfaces represent functional frontend architecture components.</span>
            <a href="#demo" className="text-amber-500 hover:underline font-semibold flex items-center gap-1">
              <span>Test live simulator scenarios</span>
              <ChevronRight className="w-3.5 h-3.5" />
            </a>
          </div>

        </div>

      </div>
    </section>
  );
}
