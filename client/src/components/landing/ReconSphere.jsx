import React, { useRef, useEffect, useState } from "react";
import { useTheme } from "../../context/ThemeContext";

// Signature Animated Spherical AI Core
// Features: 3D latitude/longitude particle mesh, rotating orbital rings,
// dynamic stage-responsive core, satellite agent nodes, amber energy pulses.
export function ReconSphere({ 
  size = 460, 
  stage = "normal", // 'normal' | 'detect' | 'collect' | 'investigate' | 'policy' | 'safe_hold' | 'verified'
  stageLabel = "RECONAI CORE",
  interactive = true,
  className = "" 
}) {
  const canvasRef = useRef(null);
  const { isNight } = useTheme();
  const [mouseOffset, setMouseOffset] = useState({ x: 0, y: 0 });

  // Canvas particle sphere animation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animationFrameId;
    let rotationAngle = 0;

    // Retina DPI scaling
    const dpr = window.devicePixelRatio || 1;
    const width = size;
    const height = size;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    ctx.scale(dpr, dpr);

    // Detect reduced motion and mobile viewport for performance
    const prefersReducedMotion = typeof window !== "undefined" && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

    // Generate 3D sphere points (Fibonacci sphere distribution)
    const numPoints = prefersReducedMotion || isMobile ? 70 : 140;
    const points = [];
    const radius = size * 0.32;

    for (let i = 0; i < numPoints; i++) {
      const phi = Math.acos(-1 + (2 * i) / numPoints);
      const theta = Math.sqrt(numPoints * Math.PI) * phi;
      points.push({
        x: radius * Math.cos(theta) * Math.sin(phi),
        y: radius * Math.sin(theta) * Math.sin(phi),
        z: radius * Math.cos(phi),
        baseSize: 1.2 + (i % 3) * 0.8,
        pulseSpeed: 0.02 + (i % 5) * 0.01,
        phase: i * 0.2,
      });
    }

    const render = (time) => {
      ctx.clearRect(0, 0, width, height);

      const centerX = width / 2;
      const centerY = height / 2;

      // Color scheme based on theme & stage
      let coreAmber = isNight ? "#F59E0B" : "#D97706";
      let coreBright = isNight ? "#FBBF24" : "#F59E0B";
      let nodeColor = isNight ? "rgba(251, 191, 36, " : "rgba(217, 119, 6, ";
      let lineColor = isNight ? "rgba(245, 158, 11, 0.12)" : "rgba(217, 119, 6, 0.14)";

      if (stage === "safe_hold") {
        coreAmber = "#F59E0B";
        coreBright = "#EF4444";
        nodeColor = "rgba(245, 158, 11, ";
        lineColor = "rgba(239, 68, 68, 0.16)";
      } else if (stage === "verified") {
        coreAmber = "#10B981";
        coreBright = "#34D399";
        nodeColor = "rgba(16, 185, 129, ";
        lineColor = "rgba(16, 185, 129, 0.16)";
      }

      // Rotate around Y and X axes (halted if reduced motion requested)
      if (!prefersReducedMotion) {
        rotationAngle += 0.005;
      }
      const cosY = Math.cos(rotationAngle + mouseOffset.x * 0.001);
      const sinY = Math.sin(rotationAngle + mouseOffset.x * 0.001);
      const cosX = Math.cos(0.35 + mouseOffset.y * 0.001);
      const sinX = Math.sin(0.35 + mouseOffset.y * 0.001);

      // Inner Core radial glow
      const pulse = Math.sin(time * 0.002) * 0.1 + 0.9;
      const innerCoreGrad = ctx.createRadialGradient(
        centerX,
        centerY,
        radius * 0.1,
        centerX,
        centerY,
        radius * 0.95 * pulse
      );

      if (isNight) {
        innerCoreGrad.addColorStop(0, "rgba(251, 191, 36, 0.28)");
        innerCoreGrad.addColorStop(0.5, "rgba(245, 158, 11, 0.12)");
        innerCoreGrad.addColorStop(1, "rgba(8, 8, 8, 0)");
      } else {
        innerCoreGrad.addColorStop(0, "rgba(254, 243, 199, 0.95)");
        innerCoreGrad.addColorStop(0.5, "rgba(251, 191, 36, 0.22)");
        innerCoreGrad.addColorStop(1, "rgba(250, 250, 247, 0)");
      }

      ctx.fillStyle = innerCoreGrad;
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius * 0.95 * pulse, 0, Math.PI * 2);
      ctx.fill();

      // Transform and project points
      const projected = points.map((p) => {
        // Rotate around Y
        const x1 = p.x * cosY - p.z * sinY;
        const z1 = p.z * cosY + p.x * sinY;
        // Rotate around X
        const y2 = p.y * cosX - z1 * sinX;
        const z2 = z1 * cosX + p.y * sinX;

        // Perspective depth scale
        const fov = 400;
        const scale = fov / (fov + z2);
        return {
          x: centerX + x1 * scale,
          y: centerY + y2 * scale,
          z: z2,
          scale,
          alpha: Math.max(0.15, (z2 + radius) / (2 * radius)),
        };
      });

      // Sort points back-to-front for proper depth layering
      projected.sort((a, b) => a.z - b.z);

      // Draw faint interconnected lattice lines between nearby points
      ctx.strokeStyle = lineColor;
      ctx.lineWidth = 0.75;
      for (let i = 0; i < projected.length; i += 2) {
        for (let j = i + 1; j < Math.min(i + 4, projected.length); j++) {
          const dx = projected[i].x - projected[j].x;
          const dy = projected[i].y - projected[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 46) {
            ctx.beginPath();
            ctx.moveTo(projected[i].x, projected[i].y);
            ctx.lineTo(projected[j].x, projected[j].y);
            ctx.stroke();
          }
        }
      }

      // Draw particle nodes
      projected.forEach((p, idx) => {
        const dotSize = Math.max(1, p.scale * (idx % 4 === 0 ? 3.2 : 1.8));
        ctx.fillStyle = `${nodeColor}${p.alpha.toFixed(2)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, dotSize, 0, Math.PI * 2);
        ctx.fill();

        // Subtle glow for front-most nodes
        if (p.z > radius * 0.4 && idx % 3 === 0) {
          ctx.fillStyle = coreBright;
          ctx.beginPath();
          ctx.arc(p.x, p.y, dotSize * 0.5, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [size, isNight, stage, mouseOffset]);

  const handleMouseMove = (e) => {
    if (!interactive) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - (rect.left + rect.width / 2);
    const y = e.clientY - (rect.top + rect.height / 2);
    setMouseOffset({ x, y });
  };

  const handleMouseLeave = () => {
    setMouseOffset({ x: 0, y: 0 });
  };

  return (
    <div
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className={`relative inline-flex items-center justify-center select-none ${className}`}
      style={{ width: size, height: size }}
    >
      {/* 1. Atmospheric Ambient Halo */}
      <div
        className="absolute inset-0 rounded-full blur-3xl pointer-events-none transition-all duration-700"
        style={{
          background: isNight
            ? stage === "safe_hold"
              ? "radial-gradient(circle, rgba(245,158,11,0.28) 0%, rgba(239,68,68,0.12) 50%, transparent 70%)"
              : stage === "verified"
              ? "radial-gradient(circle, rgba(16,185,129,0.25) 0%, rgba(245,158,11,0.08) 50%, transparent 70%)"
              : "radial-gradient(circle, rgba(245,158,11,0.22) 0%, rgba(217,119,6,0.08) 50%, transparent 70%)"
            : stage === "safe_hold"
            ? "radial-gradient(circle, rgba(254,243,199,0.85) 0%, rgba(245,158,11,0.25) 45%, transparent 70%)"
            : "radial-gradient(circle, rgba(254,243,199,0.9) 0%, rgba(251,191,36,0.25) 45%, transparent 70%)",
          transform: "scale(1.28)",
        }}
      />

      {/* 2. Outer Rotating Orbital Rings (Layered SVG with 3D tilts) */}
      <svg
        className="absolute inset-0 w-full h-full pointer-events-none"
        viewBox="0 0 500 500"
        fill="none"
      >
        <defs>
          <linearGradient id="amberRingGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.85" />
            <stop offset="50%" stopColor="#FBBF24" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#D97706" stopOpacity="0.9" />
          </linearGradient>
          <linearGradient id="amberRingGrad2" x1="100%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor="#FBBF24" stopOpacity="0.7" />
            <stop offset="70%" stopColor="#F59E0B" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#92400E" stopOpacity="0.6" />
          </linearGradient>
        </defs>

        {/* Primary Inclined Orbital Ring */}
        <g style={{ transformOrigin: "250px 250px" }} className="animate-spin-slow">
          <ellipse
            cx="250"
            cy="250"
            rx="210"
            ry="78"
            stroke="url(#amberRingGrad1)"
            strokeWidth={isNight ? "1.5" : "1.8"}
            strokeDasharray="6 4 12 4"
            fill="none"
            transform="rotate(-28 250 250)"
          />
          {/* Satellite Node: Customer AI */}
          <circle cx="68" cy="190" r="4.5" fill="#F59E0B" stroke="#FEF3C7" strokeWidth="1.5" />
          {/* Satellite Node: Shop AI */}
          <circle cx="432" cy="310" r="4.5" fill="#FBBF24" stroke="#FEF3C7" strokeWidth="1.5" />
        </g>

        {/* Counter-Rotating Equatorial Ring */}
        <g style={{ transformOrigin: "250px 250px" }} className="animate-spin-slow-reverse">
          <ellipse
            cx="250"
            cy="250"
            rx="185"
            ry="95"
            stroke="url(#amberRingGrad2)"
            strokeWidth="1.2"
            strokeDasharray="3 8"
            fill="none"
            transform="rotate(34 250 250)"
          />
          {/* Satellite Node: Investigator AI */}
          <circle cx="120" cy="330" r="4" fill="#D97706" stroke="#FEF3C7" strokeWidth="1.5" />
          {/* Satellite Node: Resolution Planner AI */}
          <circle cx="380" cy="170" r="4" fill="#F59E0B" stroke="#FEF3C7" strokeWidth="1.5" />
        </g>

        {/* Fine Polar Ring */}
        <ellipse
          cx="250"
          cy="250"
          rx="145"
          ry="145"
          stroke={isNight ? "rgba(245, 158, 11, 0.15)" : "rgba(217, 119, 6, 0.18)"}
          strokeWidth="1"
          strokeDasharray="2 6"
          fill="none"
        />
      </svg>

      {/* 3. Central Canvas Sphere (Particles + Depth Mesh) */}
      <canvas
        ref={canvasRef}
        style={{ width: size, height: size }}
        className="relative z-10 pointer-events-none"
      />

      {/* 4. Core Glass Cap / Pearl Spherical Highlight Overlay */}
      <div
        className="absolute z-20 pointer-events-none rounded-full"
        style={{
          width: size * 0.64,
          height: size * 0.64,
          background: isNight
            ? "radial-gradient(circle at 35% 35%, rgba(251, 191, 36, 0.15), rgba(8, 8, 8, 0.65) 75%)"
            : "radial-gradient(circle at 32% 30%, rgba(255, 255, 255, 0.85), rgba(254, 243, 199, 0.35) 45%, rgba(217, 119, 6, 0.15) 85%)",
          boxShadow: isNight
            ? "inset 0 0 25px rgba(245, 158, 11, 0.25), 0 0 45px rgba(245, 158, 11, 0.15)"
            : "inset 0 0 25px rgba(245, 158, 11, 0.35), 0 10px 30px rgba(217, 119, 6, 0.12)",
          border: isNight
            ? "1px solid rgba(245, 158, 11, 0.3)"
            : "1.5px solid rgba(245, 158, 11, 0.45)",
        }}
      />

      {/* 5. Central Badge / Core Identifier Pill */}
      <div className="absolute z-30 bottom-8 flex flex-col items-center pointer-events-auto">
        <div
          className={`px-3 py-1 rounded-full text-[10px] font-mono font-bold tracking-widest uppercase flex items-center gap-1.5 transition-all duration-300 shadow-md ${
            isNight
              ? "bg-[#111111]/90 text-amber-300 border border-amber-500/40 shadow-[0_0_15px_rgba(245,158,11,0.25)]"
              : "bg-white/95 text-amber-800 border border-amber-400/60 shadow-[0_4px_12px_rgba(217,119,6,0.15)]"
          }`}
        >
          <span
            className={`w-1.5 h-1.5 rounded-full ${
              stage === "safe_hold"
                ? "bg-amber-500 animate-ping"
                : stage === "verified"
                ? "bg-emerald-400"
                : "bg-amber-400 animate-pulse"
            }`}
          />
          <span>{stageLabel}</span>
        </div>
      </div>
    </div>
  );
}
