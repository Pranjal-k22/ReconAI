import React from "react";
import { Link } from "react-router-dom";
import { useTheme } from "../../context/ThemeContext";
import { BrandHeader, ReconAILogo } from "./ReconLogo";
import { ArrowRight, Activity } from "lucide-react";

export function FooterSection() {
  const { isNight } = useTheme();

  return (
    <footer
      className="relative overflow-hidden text-left border-t pt-20 pb-12 transition-colors duration-300"
      style={{
        backgroundColor: isNight ? "#060606" : "#F4F1E9",
        borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA",
      }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
        
        {/* Final CTA Card */}
        <div
          className="rounded-3xl border p-8 sm:p-12 mb-20 shadow-2xl relative overflow-hidden"
          style={{
            backgroundColor: isNight ? "rgba(17,17,17,0.85)" : "#FFFFFF",
            borderColor: "rgba(245,158,11,0.35)",
          }}
        >
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-8 space-y-4">
              <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider border border-amber-500/30 text-amber-500 bg-amber-500/10">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />
                <span>Next Generation Financial Reconciliation</span>
              </div>

              <h2
                className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight leading-tight"
                style={{ color: isNight ? "#FAFAF9" : "#181818" }}
              >
                Build trust into{" "}
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600">
                  every payment decision.
                </span>
              </h2>

              <p className="text-base sm:text-lg max-w-2xl leading-relaxed" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>
                Explore an evidence-driven approach to payment reconciliation, AI-assisted investigation, deterministic policy decisions, and auditable safe resolution.
              </p>

              <div className="flex flex-wrap items-center gap-4 pt-4">
                <a
                  href="#demo"
                  className="px-6 py-3.5 rounded-xl font-semibold text-sm text-white bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 hover:from-amber-400 hover:to-amber-600 shadow-[0_0_25px_rgba(245,158,11,0.35)] transition-all duration-200 flex items-center gap-2 border border-amber-300/30"
                >
                  <span>Launch the Demo</span>
                  <Activity className="w-4 h-4 text-amber-200" />
                </a>

                <a
                  href="#architecture"
                  className="px-5 py-3.5 rounded-xl font-medium text-sm border transition-all duration-200"
                  style={{
                    backgroundColor: isNight ? "#191919" : "#FAFAF7",
                    borderColor: isNight ? "rgba(255,255,255,0.1)" : "#E7E3DA",
                    color: isNight ? "#FAFAF9" : "#181818",
                  }}
                >
                  <span>View the Architecture</span>
                </a>

                <Link
                  to="/app"
                  className="px-4 py-3.5 rounded-xl font-medium text-sm text-amber-500 hover:underline transition-colors flex items-center gap-1.5"
                >
                  <span>Operations Portal</span>
                  <ArrowRight className="w-4 h-4" />
                </Link>
              </div>
            </div>

            {/* Geometric Brand Emblem Watermark on Right */}
            <div className="lg:col-span-4 flex items-center justify-center opacity-85">
              <ReconAILogo size={140} />
            </div>
          </div>
        </div>

        {/* Footer Navigation Columns */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 pb-12 border-b text-xs" style={{ borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA" }}>
          
          {/* Brand Info Column */}
          <div className="col-span-2 space-y-4">
            <BrandHeader size={28} />
            <p className="leading-relaxed max-w-sm" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>
              ReconAI 2.0 is an autonomous AI payment resolution network built to detect discrepancies, assemble multi-source evidence, and enforce deterministic financial policies.
            </p>
            <div className="flex items-center gap-2 font-mono text-[11px]" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>
              <span className="w-2 h-2 rounded-full bg-amber-500" />
              <span>Simulated Sandbox Environment • Version 2.0.4-rc</span>
            </div>
          </div>

          {/* Column: Platform */}
          <div className="space-y-3">
            <h4 className="font-semibold uppercase tracking-wider text-[11px]" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>
              Platform
            </h4>
            <ul className="space-y-2" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>
              <li><a href="#problem" className="hover:text-amber-500 transition-colors">Discrepancy Ingestion</a></li>
              <li><a href="#storyline" className="hover:text-amber-500 transition-colors">Scroll Storyline</a></li>
              <li><a href="#agents" className="hover:text-amber-500 transition-colors">Four-Agent Pipeline</a></li>
              <li><a href="#demo" className="hover:text-amber-500 transition-colors">Interactive Simulator</a></li>
              <li><a href="#product-ui" className="hover:text-amber-500 transition-colors">Product UI Gallery</a></li>
            </ul>
          </div>

          {/* Column: Governance & Safety */}
          <div className="space-y-3">
            <h4 className="font-semibold uppercase tracking-wider text-[11px]" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>
              Safety & Policy
            </h4>
            <ul className="space-y-2" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>
              <li><a href="#safety" className="hover:text-amber-500 transition-colors">Safe-Hold Protocol</a></li>
              <li><a href="#safety" className="hover:text-amber-500 transition-colors">Durable Idempotency</a></li>
              <li><a href="#safety" className="hover:text-amber-500 transition-colors">Read-Only Provider Polling</a></li>
              <li><a href="#architecture" className="hover:text-amber-500 transition-colors">Tenant Isolation</a></li>
              <li><a href="#audit" className="hover:text-amber-500 transition-colors">Cryptographic Audit</a></li>
            </ul>
          </div>

          {/* Column: Project & Resources */}
          <div className="space-y-3">
            <h4 className="font-semibold uppercase tracking-wider text-[11px]" style={{ color: isNight ? "#FAFAF9" : "#181818" }}>
              Resources
            </h4>
            <ul className="space-y-2" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>
              <li><a href="#architecture" className="hover:text-amber-500 transition-colors">System Architecture</a></li>
              <li><a href="#audit" className="hover:text-amber-500 transition-colors">JSON Telemetry Schema</a></li>
              <li><Link to="/app" className="hover:text-amber-500 transition-colors">Internal Ops Portal</Link></li>
              <li><Link to="/finance-controller" className="hover:text-amber-500 transition-colors">Finance Controller</Link></li>
              <li><a href="#hero" className="hover:text-amber-500 transition-colors">Back to Top</a></li>
            </ul>
          </div>

        </div>

        {/* Bottom Disclaimers */}
        <div className="pt-8 flex flex-col md:flex-row items-center justify-between gap-4 text-[11px] font-mono" style={{ color: isNight ? "#A3A3A3" : "#66645F" }}>
          <div>
            © 2026 ReconAI Network Architecture. All rights reserved.
          </div>

          <div className="text-center md:text-right max-w-xl text-[10px] leading-normal">
            IMPORTANT NOTICE: ReconAI 2.0 is an interactive architectural demonstration. All transactions, INR currency figures, customer names, and bank settlement scenarios are synthetic simulations. No real money moves and no production banking credentials are used.
          </div>
        </div>

      </div>
    </footer>
  );
}
