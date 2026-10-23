import React from "react";
import { useTheme } from "../../context/ThemeContext";

// Original geometric brand symbol for ReconAI 2.0 (Amber/Gold Theme)
// Represents: Interconnected evidence sources, reconciliation pathways, payment nodes, central verified checkpoint
export function ReconAILogo({ size = 32, className = "", glowing = true }) {
  const { isNight } = useTheme();

  return (
    <div className={`relative inline-flex items-center justify-center ${className}`}>
      {glowing && (
        <div
          className="absolute inset-0 rounded-xl bg-gradient-to-r from-amber-500/30 via-amber-400/30 to-amber-600/20 blur-md pointer-events-none"
          style={{ transform: "scale(1.2)" }}
        />
      )}
      <svg
        width={size}
        height={size}
        viewBox="0 0 48 48"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className="relative z-10 drop-shadow-[0_0_12px_rgba(245,158,11,0.45)]"
      >
        <defs>
          <linearGradient id="reconAmberGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#F59E0B" />
            <stop offset="50%" stopColor="#FBBF24" />
            <stop offset="100%" stopColor="#D97706" />
          </linearGradient>
          <linearGradient id="reconAmberCore" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#FDE68A" />
            <stop offset="100%" stopColor="#F59E0B" />
          </linearGradient>
          <radialGradient id="reconAmberGlow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FBBF24" stopOpacity="0.8" />
            <stop offset="100%" stopColor="#080808" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* Outer hexagonal boundary - payment pathways */}
        <path
          d="M24 4L41.32 14V34L24 44L6.68 34V14L24 4Z"
          stroke="url(#reconAmberGrad)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeOpacity="0.85"
        />

        {/* Inner reconciliation network diamond */}
        <path
          d="M24 11L35 24L24 37L13 24L24 11Z"
          stroke="#F59E0B"
          strokeWidth="1.5"
          strokeDasharray="2 2"
          strokeOpacity="0.9"
        />

        {/* Diagonal interconnected evidence vectors */}
        <line x1="6.68" y1="14" x2="24" y2="24" stroke="#FBBF24" strokeWidth="1.25" strokeOpacity="0.6" />
        <line x1="41.32" y1="14" x2="24" y2="24" stroke="#FBBF24" strokeWidth="1.25" strokeOpacity="0.6" />
        <line x1="24" y1="44" x2="24" y2="24" stroke="#D97706" strokeWidth="1.25" strokeOpacity="0.6" />

        {/* Four satellite evidence nodes */}
        <circle cx="24" cy="11" r="2.5" fill="#F59E0B" stroke="#FEF3C7" strokeWidth="1" />
        <circle cx="35" cy="24" r="2.5" fill="#FBBF24" stroke="#FEF3C7" strokeWidth="1" />
        <circle cx="24" cy="37" r="2.5" fill="#D97706" stroke="#FEF3C7" strokeWidth="1" />
        <circle cx="13" cy="24" r="2.5" fill="#B45309" stroke="#FEF3C7" strokeWidth="1" />

        {/* Central Verified Resolution Checkpoint Core */}
        <circle cx="24" cy="24" r="6" fill={isNight ? "#111111" : "#FFFFFF"} stroke="url(#reconAmberCore)" strokeWidth="1.8" />
        <path
          d="M21.5 24L23.2 25.8L26.8 22.2"
          stroke="#F59E0B"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

// Brand wordmark with 2.0 badge
export function BrandHeader({ size = 30, showBadge = true, className = "" }) {
  const { isNight } = useTheme();

  return (
    <div className={`flex items-center gap-2.5 ${className}`}>
      <ReconAILogo size={size} />
      <div className="flex items-center gap-1.5">
        <span
          className="text-xl font-bold tracking-tight font-sans transition-colors"
          style={{ color: isNight ? "#FAFAF9" : "#181818" }}
        >
          Recon<span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600">AI</span>
        </span>
        {showBadge && (
          <span className="px-1.5 py-0.5 text-[10px] font-semibold tracking-wider uppercase rounded-md bg-amber-500/15 border border-amber-500/40 text-amber-500 shadow-[0_0_10px_rgba(245,158,11,0.2)]">
            2.0
          </span>
        )}
      </div>
    </div>
  );
}

// Original vector icon family for evidence sources and verification
export function EvidenceIcon({ type, size = 18, className = "" }) {
  switch (type) {
    case "gateway":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
          <rect x="2" y="5" width="20" height="14" rx="2" />
          <line x1="2" y1="10" x2="22" y2="10" />
          <circle cx="7" cy="15" r="1" fill="currentColor" />
          <circle cx="11" cy="15" r="1" fill="currentColor" />
        </svg>
      );
    case "merchant":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          <polyline points="9 22 9 12 15 12 15 22" />
        </svg>
      );
    case "customer":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      );
    case "webhook":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
          <circle cx="18" cy="5" r="2" fill="currentColor" />
        </svg>
      );
    case "settlement":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
          <line x1="12" y1="1" x2="12" y2="23" />
          <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        </svg>
      );
    case "evidence":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
          <line x1="16" y1="13" x2="8" y2="13" />
          <line x1="16" y1="17" x2="8" y2="17" />
          <polyline points="10 9 9 9 8 9" />
        </svg>
      );
    case "policy":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          <path d="m9 12 2 2 4-4" />
        </svg>
      );
    case "verification":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
      );
    case "audit":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
          <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
        </svg>
      );
    case "monitoring":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
          <path d="M2 12h5l3 8 4-16 3 8h5" />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
        </svg>
      );
    default:
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" className={className}>
          <circle cx="12" cy="12" r="10" />
        </svg>
      );
  }
}
