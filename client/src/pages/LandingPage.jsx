import React, { useEffect } from "react";
import { useTheme } from "../context/ThemeContext";
import { ReconNavbar } from "../components/landing/ReconNavbar";
import { SpatialHeroSection } from "../components/landing/SpatialHeroSection";
import { ScrollNarrativeSection } from "../components/landing/ScrollNarrativeSection";
import { ProblemSection } from "../components/landing/ProblemSection";
import { AgentInvestigationSection } from "../components/landing/AgentInvestigationSection";
import { SafetySection } from "../components/landing/SafetySection";
import { PaymentSimulatorSection } from "../components/landing/PaymentSimulatorSection";
import { ProductGallerySection } from "../components/landing/ProductGallerySection";
import { ArchitectureSection } from "../components/landing/ArchitectureSection";
import { AuditSection } from "../components/landing/AuditSection";
import { FooterSection } from "../components/landing/FooterSection";

export default function LandingPage() {
  const { isNight } = useTheme();

  useEffect(() => {
    document.title = "ReconAI 2.0 — Spatial AI Payment Resolution Network";
  }, []);

  return (
    <div
      className={`min-h-screen font-sans selection:bg-amber-500 selection:text-white relative overflow-x-hidden antialiased transition-colors duration-300 ${
        isNight ? "bg-[#080808] text-[#FAFAF9]" : "bg-[#FAFAF7] text-[#181818]"
      }`}
    >
      {/* Global Navbar with Day/Night Toggle */}
      <ReconNavbar />

      {/* Main Content Experience */}
      <main>
        {/* 1. Spatial Hero Section with Audi-Configurator Composition & Animated AI Sphere */}
        <SpatialHeroSection />

        {/* 2. Scroll-Driven 6-Stage AI Resolution Narrative */}
        <ScrollNarrativeSection />

        {/* 3. Discrepancy Failure Modes & Comparison */}
        <ProblemSection />

        {/* 4. Four Specialized Perspectives & Deterministic Policy Guard */}
        <AgentInvestigationSection />

        {/* 5. Financial Safety & Safe-Hold Quarantine Showcase */}
        <SafetySection />

        {/* 6. Interactive Payment Resolution Simulator (Connected with Reactive Core) */}
        <PaymentSimulatorSection />

        {/* 7. Product Interface Gallery */}
        <ProductGallerySection />

        {/* 8. System Architecture Pipeline Topology */}
        <ArchitectureSection />

        {/* 9. Cryptographic Audit Trail & JSON Inspector */}
        <AuditSection />
      </main>

      {/* 10. Final Call to Action & Comprehensive Footer */}
      <FooterSection />
    </div>
  );
}
