import React, { useState } from "react";
import { ReconAILogo } from "./ReconLogo";

// Original vector visual for the Autonomous Payment Resolution Network
// Displays: Customer node, Merchant node, Gateway node, Central ReconAI engine, 
// 4 AI-agent satellites, Deterministic Policy Checkpoint, Safe-Hold and Verified pathways.
export function HeroNetworkGraphic({ className = "" }) {
  const [activePathway, setActivePathway] = useState("all");

  return (
    <div className={`relative w-full aspect-[16/11] max-w-2xl mx-auto flex items-center justify-center select-none ${className}`}>
      {/* Background ambient radial glow */}
      <div className="absolute inset-0 bg-gradient-to-tr from-blue-600/10 via-cyan-500/15 to-transparent rounded-3xl blur-2xl pointer-events-none" />

      {/* SVG Canvas for the Vector Payment Network */}
      <svg
        viewBox="0 0 800 550"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="w-full h-full relative z-10"
      >
        <defs>
          {/* Radial & linear gradients for nodes & paths */}
          <linearGradient id="netCyanBlue" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#3B82F6" stopOpacity="0.4" />
          </linearGradient>
          <linearGradient id="verifiedGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#22D3EE" />
            <stop offset="100%" stopColor="#10B981" />
          </linearGradient>
          <linearGradient id="safeHoldGrad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#F59E0B" />
            <stop offset="100%" stopColor="#EF4444" />
          </linearGradient>
          <radialGradient id="centralCoreGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#22D3EE" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#0B1220" stopOpacity="0" />
          </radialGradient>
          <filter id="neonGlow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        {/* Technical Coordinate Grid Lines */}
        <g opacity="0.12" stroke="#38BDF8" strokeWidth="0.8" strokeDasharray="3 6">
          <line x1="80" y1="0" x2="80" y2="550" />
          <line x1="240" y1="0" x2="240" y2="550" />
          <line x1="400" y1="0" x2="400" y2="550" />
          <line x1="560" y1="0" x2="560" y2="550" />
          <line x1="720" y1="0" x2="720" y2="550" />
          <line x1="0" y1="110" x2="800" y2="110" />
          <line x1="0" y1="275" x2="800" y2="275" />
          <line x1="0" y1="440" x2="800" y2="440" />
        </g>

        {/* Concentric Signal Rings around Central ReconAI Core */}
        <circle cx="400" cy="240" r="140" stroke="#38BDF8" strokeWidth="1" strokeDasharray="4 8" opacity="0.25" />
        <circle cx="400" cy="240" r="210" stroke="#3B82F6" strokeWidth="0.8" strokeDasharray="2 10" opacity="0.18" />
        <circle cx="400" cy="240" r="90" fill="url(#centralCoreGlow)" />

        {/* 1. Ingestion Vectors: Customer, Merchant, Gateway -> ReconAI Core */}
        {/* Customer Node (X:100, Y:130) -> ReconAI (400, 240) */}
        <path
          d="M 160 130 C 260 130, 310 210, 350 230"
          stroke="url(#netCyanBlue)"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
        {/* Animated pulse dot */}
        <circle r="3.5" fill="#38BDF8">
          <animateMotion path="M 160 130 C 260 130, 310 210, 350 230" dur="4s" repeatCount="indefinite" />
        </circle>

        {/* Payment Gateway Node (X:100, Y:275) -> ReconAI (400, 240) */}
        <path
          d="M 160 275 C 240 275, 290 260, 340 245"
          stroke="url(#netCyanBlue)"
          strokeWidth="1.75"
        />
        <circle r="3.5" fill="#22D3EE">
          <animateMotion path="M 160 275 C 240 275, 290 260, 340 245" dur="3s" repeatCount="indefinite" />
        </circle>

        {/* Merchant Node (X:100, Y:420) -> ReconAI (400, 240) */}
        <path
          d="M 160 420 C 260 420, 310 270, 350 250"
          stroke="url(#netCyanBlue)"
          strokeWidth="1.5"
          strokeDasharray="4 4"
        />
        <circle r="3.5" fill="#60A5FA">
          <animateMotion path="M 160 420 C 260 420, 310 270, 350 250" dur="4.5s" repeatCount="indefinite" />
        </circle>

        {/* 2. Four Agent Satellite Connections from Core */}
        {/* Agent 1: Customer AI (320, 90) */}
        <line x1="400" y1="200" x2="330" y2="120" stroke="#818CF8" strokeWidth="1.25" strokeDasharray="3 3" opacity="0.7" />
        {/* Agent 2: Shop AI (480, 90) */}
        <line x1="400" y1="200" x2="470" y2="120" stroke="#22D3EE" strokeWidth="1.25" strokeDasharray="3 3" opacity="0.7" />
        {/* Agent 3: Investigator AI (320, 390) */}
        <line x1="400" y1="280" x2="330" y2="370" stroke="#38BDF8" strokeWidth="1.25" strokeDasharray="3 3" opacity="0.7" />
        {/* Agent 4: Resolution Planner AI (480, 390) */}
        <line x1="400" y1="280" x2="470" y2="370" stroke="#A78BFA" strokeWidth="1.25" strokeDasharray="3 3" opacity="0.7" />

        {/* 3. Central Core -> Deterministic Policy Guard (560, 240) */}
        <path
          d="M 450 240 L 530 240"
          stroke="#60A5FA"
          strokeWidth="2.5"
          strokeLinecap="round"
        />
        <circle r="4" fill="#93C5FD" filter="url(#neonGlow)">
          <animateMotion path="M 450 240 L 530 240" dur="2s" repeatCount="indefinite" />
        </circle>

        {/* 4. Branching Pathways from Deterministic Policy */}
        {/* Upper branch: Verified Outcome Pathway (Green/Teal) */}
        <path
          d="M 590 220 C 630 180, 660 160, 710 160"
          stroke="url(#verifiedGrad)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle r="3.5" fill="#10B981" filter="url(#neonGlow)">
          <animateMotion path="M 590 220 C 630 180, 660 160, 710 160" dur="2.8s" repeatCount="indefinite" />
        </circle>

        {/* Lower branch: Safe-Hold Escalation Pathway (Amber/Red) */}
        <path
          d="M 590 260 C 630 300, 660 320, 710 320"
          stroke="url(#safeHoldGrad)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray="5 3"
        />
        <circle r="3.5" fill="#F59E0B" filter="url(#neonGlow)">
          <animateMotion path="M 590 260 C 630 300, 660 320, 710 320" dur="3.2s" repeatCount="indefinite" />
        </circle>

        {/* SOURCE NODES ON LEFT */}
        {/* Customer Node */}
        <g transform="translate(70, 105)">
          <rect width="90" height="50" rx="8" fill="#111827" stroke="rgba(56, 189, 248, 0.4)" strokeWidth="1" />
          <circle cx="20" cy="25" r="8" fill="#1E293B" stroke="#38BDF8" strokeWidth="1" />
          <path d="M 17 29 C 17 26, 23 26, 23 29" stroke="#38BDF8" strokeWidth="1.2" />
          <circle cx="20" cy="23" r="2.5" fill="#38BDF8" />
          <text x="35" y="24" fill="#E2E8F0" fontSize="10" fontWeight="600" fontFamily="sans-serif">Customer</text>
          <text x="35" y="36" fill="#94A3B8" fontSize="8" fontFamily="sans-serif">Bank Debit</text>
        </g>

        {/* Payment Gateway Node */}
        <g transform="translate(70, 250)">
          <rect width="90" height="50" rx="8" fill="#111827" stroke="rgba(34, 211, 238, 0.5)" strokeWidth="1.2" />
          <rect x="12" y="17" width="16" height="16" rx="3" fill="#0F172A" stroke="#22D3EE" strokeWidth="1" />
          <line x1="12" y1="23" x2="28" y2="23" stroke="#22D3EE" strokeWidth="1" />
          <text x="35" y="24" fill="#E2E8F0" fontSize="10" fontWeight="600" fontFamily="sans-serif">Gateway</text>
          <text x="35" y="36" fill="#22D3EE" fontSize="8" fontFamily="sans-serif">Razorpay API</text>
        </g>

        {/* Merchant Node */}
        <g transform="translate(70, 395)">
          <rect width="90" height="50" rx="8" fill="#111827" stroke="rgba(96, 165, 250, 0.4)" strokeWidth="1" />
          <path d="M 14 27 L 20 18 L 26 27 Z" fill="#1E293B" stroke="#60A5FA" strokeWidth="1" />
          <text x="35" y="24" fill="#E2E8F0" fontSize="10" fontWeight="600" fontFamily="sans-serif">Merchant</text>
          <text x="35" y="36" fill="#94A3B8" fontSize="8" fontFamily="sans-serif">Shopify / ERP</text>
        </g>

        {/* 4 AGENT SATELLITES */}
        {/* Customer AI */}
        <g transform="translate(270, 70)">
          <rect width="110" height="42" rx="7" fill="#0F172A" stroke="rgba(129, 140, 248, 0.4)" strokeWidth="1" />
          <circle cx="16" cy="21" r="7" fill="#1E1B4B" stroke="#818CF8" strokeWidth="1" />
          <circle cx="16" cy="21" r="2.5" fill="#818CF8" />
          <text x="30" y="19" fill="#E0E7FF" fontSize="10" fontWeight="600" fontFamily="sans-serif">Customer AI</text>
          <text x="30" y="31" fill="#818CF8" fontSize="8" fontFamily="sans-serif">Intent & Alerts</text>
        </g>

        {/* Shop AI */}
        <g transform="translate(420, 70)">
          <rect width="110" height="42" rx="7" fill="#0F172A" stroke="rgba(34, 211, 238, 0.4)" strokeWidth="1" />
          <circle cx="16" cy="21" r="7" fill="#083344" stroke="#22D3EE" strokeWidth="1" />
          <circle cx="16" cy="21" r="2.5" fill="#22D3EE" />
          <text x="30" y="19" fill="#CFFAFE" fontSize="10" fontWeight="600" fontFamily="sans-serif">Shop AI</text>
          <text x="30" y="31" fill="#22D3EE" fontSize="8" fontFamily="sans-serif">Order Inventory</text>
        </g>

        {/* Investigator AI */}
        <g transform="translate(270, 360)">
          <rect width="110" height="42" rx="7" fill="#0F172A" stroke="rgba(56, 189, 248, 0.4)" strokeWidth="1" />
          <circle cx="16" cy="21" r="7" fill="#0C4A6E" stroke="#38BDF8" strokeWidth="1" />
          <circle cx="16" cy="21" r="2.5" fill="#38BDF8" />
          <text x="30" y="19" fill="#E0F2FE" fontSize="10" fontWeight="600" fontFamily="sans-serif">Investigator AI</text>
          <text x="30" y="31" fill="#38BDF8" fontSize="8" fontFamily="sans-serif">Gateway Signals</text>
        </g>

        {/* Resolution Planner AI */}
        <g transform="translate(420, 360)">
          <rect width="110" height="42" rx="7" fill="#0F172A" stroke="rgba(167, 139, 250, 0.4)" strokeWidth="1" />
          <circle cx="16" cy="21" r="7" fill="#2E1065" stroke="#A78BFA" strokeWidth="1" />
          <circle cx="16" cy="21" r="2.5" fill="#A78BFA" />
          <text x="30" y="19" fill="#F3E8FF" fontSize="10" fontWeight="600" fontFamily="sans-serif">Planner AI</text>
          <text x="30" y="31" fill="#A78BFA" fontSize="8" fontFamily="sans-serif">Synthesizes Actions</text>
        </g>

        {/* CENTRAL RECONAI CORE */}
        <g transform="translate(355, 195)">
          <rect width="90" height="90" rx="16" fill="#0B1220" stroke="#38BDF8" strokeWidth="1.5" filter="url(#neonGlow)" />
          <circle cx="45" cy="45" r="30" fill="#0F172A" stroke="rgba(34, 211, 238, 0.4)" strokeWidth="1" strokeDasharray="3 3" />
          <g transform="translate(21, 21)">
            <ReconAILogo size={48} glowing={false} />
          </g>
          <text x="45" y="78" fill="#F8FAFC" fontSize="9" fontWeight="700" textAnchor="middle" fontFamily="sans-serif" letterSpacing="0.5">RECONAI ENGINE</text>
        </g>

        {/* DETERMINISTIC POLICY CHECKPOINT */}
        <g transform="translate(530, 205)">
          <polygon points="35,0 70,35 35,70 0,35" fill="#111827" stroke="#38BDF8" strokeWidth="1.5" />
          <circle cx="35" cy="35" r="16" fill="#0F172A" stroke="#60A5FA" strokeWidth="1" />
          <path d="M 31 35 L 34 38 L 40 32" stroke="#22D3EE" strokeWidth="1.8" fill="none" strokeLinecap="round" />
          <text x="35" y="86" fill="#93C5FD" fontSize="9" fontWeight="700" textAnchor="middle" fontFamily="sans-serif">POLICY GUARD</text>
          <text x="35" y="96" fill="#64748B" fontSize="7.5" textAnchor="middle" fontFamily="sans-serif">Fail-Closed Rules</text>
        </g>

        {/* OUTCOME DESTINATIONS ON RIGHT */}
        {/* Verified Outcome Card */}
        <g transform="translate(710, 135)">
          <rect width="80" height="48" rx="8" fill="#064E3B" fillOpacity="0.4" stroke="#10B981" strokeWidth="1.2" />
          <circle cx="16" cy="24" r="6" fill="#10B981" />
          <path d="M 13 24 L 15 26 L 19 22" stroke="#FFFFFF" strokeWidth="1.2" fill="none" strokeLinecap="round" />
          <text x="28" y="22" fill="#A7F3D0" fontSize="9" fontWeight="700" fontFamily="sans-serif">VERIFIED</text>
          <text x="28" y="34" fill="#6EE7B7" fontSize="7.5" fontFamily="sans-serif">Auto-Resolved</text>
        </g>

        {/* Safe-Hold Escalation Card */}
        <g transform="translate(710, 295)">
          <rect width="80" height="48" rx="8" fill="#451A03" fillOpacity="0.5" stroke="#F59E0B" strokeWidth="1.2" />
          <circle cx="16" cy="24" r="6" fill="#F59E0B" />
          <text x="16" y="27" fill="#0B1220" fontSize="9" fontWeight="900" textAnchor="middle" fontFamily="sans-serif">!</text>
          <text x="28" y="22" fill="#FDE68A" fontSize="9" fontWeight="700" fontFamily="sans-serif">SAFE-HOLD</text>
          <text x="28" y="34" fill="#FCD34D" fontSize="7.5" fontFamily="sans-serif">Locked Review</text>
        </g>
      </svg>
    </div>
  );
}
