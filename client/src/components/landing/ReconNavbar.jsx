import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { useTheme } from "../../context/ThemeContext";
import { BrandHeader } from "./ReconLogo";
import { Menu, X, ArrowUpRight, Sun, Moon, Activity } from "lucide-react";

export function ReconNavbar() {
  const { theme, toggleTheme, isNight } = useTheme();
  const [scrolled, setScrolled] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("hero");

  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 30) {
        setScrolled(true);
      } else {
        setScrolled(false);
      }

      const sections = ["hero", "storyline", "problem", "agents", "safety", "demo", "product-ui", "architecture", "audit"];
      const scrollPos = window.scrollY + 120;
      for (const section of sections) {
        const el = document.getElementById(section);
        if (el) {
          const top = el.offsetTop;
          const height = el.offsetHeight;
          if (scrollPos >= top && scrollPos < top + height) {
            setActiveSection(section);
            break;
          }
        }
      }
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const navLinks = [
    { label: "Platform", href: "#problem", id: "problem" },
    { label: "Storyline", href: "#storyline", id: "storyline" },
    { label: "AI Investigation", href: "#agents", id: "agents" },
    { label: "Safety", href: "#safety", id: "safety" },
    { label: "Architecture", href: "#architecture", id: "architecture" },
    { label: "Simulator", href: "#demo", id: "demo" },
  ];

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? isNight
            ? "bg-[#080808]/85 backdrop-blur-xl border-b border-white/[0.08] shadow-[0_4px_30px_rgba(0,0,0,0.5)] py-3"
            : "bg-[#FAFAF7]/90 backdrop-blur-xl border-b border-[#E7E3DA] shadow-[0_4px_25px_rgba(0,0,0,0.06)] py-3"
          : "bg-transparent py-5"
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between">
          
          {/* Brand Mark & Title */}
          <a href="#hero" className="group flex items-center gap-2.5 outline-none">
            <BrandHeader size={30} />
          </a>

          {/* Desktop Nav Links */}
          <nav
            className="hidden lg:flex items-center gap-1 px-3 py-1.5 rounded-full border shadow-inner transition-colors"
            style={{
              backgroundColor: isNight ? "rgba(17,17,17,0.7)" : "rgba(255,255,255,0.85)",
              borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA",
              backdropFilter: "blur(16px)",
            }}
          >
            {navLinks.map((link) => {
              const isActive = activeSection === link.id;
              return (
                <a
                  key={link.id}
                  href={link.href}
                  className={`px-3.5 py-1.5 text-xs font-medium rounded-full transition-all duration-200 ${
                    isActive
                      ? "text-amber-500 bg-amber-500/10 shadow-[0_0_12px_rgba(245,158,11,0.2)] font-semibold"
                      : isNight
                      ? "text-neutral-400 hover:text-white hover:bg-white/[0.05]"
                      : "text-neutral-600 hover:text-black hover:bg-neutral-100"
                  }`}
                >
                  {link.label}
                </a>
              );
            })}
          </nav>

          {/* Right Action Cluster */}
          <div className="hidden md:flex items-center gap-3">
            
            {/* Theme Switcher Button */}
            <button
              id="theme-toggle-btn"
              onClick={toggleTheme}
              className="p-2 rounded-xl border transition-all duration-200 cursor-pointer flex items-center justify-center hover:scale-105"
              style={{
                backgroundColor: isNight ? "rgba(25,25,25,0.8)" : "rgba(255,255,255,0.9)",
                borderColor: isNight ? "rgba(245,158,11,0.3)" : "#E7E3DA",
                color: isNight ? "#FBBF24" : "#D97706",
              }}
              title={isNight ? "Switch to Day Mode (White + Amber)" : "Switch to Night Mode (Black + Amber)"}
              aria-label="Toggle Theme"
            >
              {isNight ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            {/* Demo Mode Badge */}
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-mono font-medium"
              style={{
                backgroundColor: isNight ? "rgba(17,17,17,0.8)" : "rgba(255,255,255,0.85)",
                borderColor: "rgba(245,158,11,0.3)",
                color: isNight ? "#FBBF24" : "#D97706",
              }}
            >
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
              <span>DEMO MODE</span>
            </div>

            {/* Link to Ops Portal */}
            <Link
              to="/app"
              className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors flex items-center gap-1"
              style={{
                color: isNight ? "#A3A3A3" : "#66645F",
              }}
              title="Open Internal Operations Portal"
            >
              <span>Ops Portal</span>
              <ArrowUpRight className="w-3.5 h-3.5 opacity-70" />
            </Link>

            {/* Primary CTA */}
            <a
              href="#demo"
              className="relative group overflow-hidden px-4 py-2 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-amber-500 via-amber-600 to-amber-700 hover:from-amber-400 hover:to-amber-600 shadow-[0_0_20px_rgba(245,158,11,0.3)] transition-all duration-200 flex items-center gap-1.5 border border-amber-300/30"
            >
              <span>Launch Demo</span>
              <Activity className="w-3.5 h-3.5 text-amber-200 group-hover:scale-110 transition-transform" />
            </a>
          </div>

          {/* Mobile Menu & Theme Controls */}
          <div className="flex items-center gap-2 lg:hidden">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg border text-amber-500"
              style={{
                backgroundColor: isNight ? "#191919" : "#FFFFFF",
                borderColor: isNight ? "rgba(255,255,255,0.1)" : "#E7E3DA",
              }}
              aria-label="Toggle Theme"
            >
              {isNight ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>

            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-lg border text-neutral-300 hover:text-white focus:outline-none"
              style={{
                backgroundColor: isNight ? "#191919" : "#FFFFFF",
                borderColor: isNight ? "rgba(255,255,255,0.1)" : "#E7E3DA",
              }}
              aria-label="Toggle navigation menu"
            >
              {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>

        </div>
      </div>

      {/* Mobile Menu Dropdown */}
      {mobileMenuOpen && (
        <div
          className="lg:hidden px-4 pt-3 pb-6 border-b shadow-2xl animate-in slide-in-from-top-2 duration-200"
          style={{
            backgroundColor: isNight ? "rgba(10,10,10,0.96)" : "rgba(250,250,247,0.98)",
            backdropFilter: "blur(24px)",
            borderColor: isNight ? "rgba(255,255,255,0.1)" : "#E7E3DA",
          }}
        >
          <div className="flex flex-col space-y-2">
            {navLinks.map((link) => (
              <a
                key={link.id}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                  activeSection === link.id
                    ? "text-amber-500 bg-amber-500/10 font-semibold"
                    : isNight
                    ? "text-neutral-300 hover:text-white"
                    : "text-neutral-700 hover:text-black"
                }`}
              >
                {link.label}
              </a>
            ))}
            <div className="pt-3 border-t flex flex-col gap-2" style={{ borderColor: isNight ? "rgba(255,255,255,0.08)" : "#E7E3DA" }}>
              <Link
                to="/app"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center justify-between px-3 py-2 rounded-lg text-sm"
                style={{ color: isNight ? "#A3A3A3" : "#66645F" }}
              >
                <span>Operations Controller Portal</span>
                <ArrowUpRight className="w-4 h-4 text-amber-500" />
              </Link>
              <a
                href="#demo"
                onClick={() => setMobileMenuOpen(false)}
                className="w-full text-center py-2.5 rounded-lg text-sm font-semibold text-white bg-gradient-to-r from-amber-500 to-amber-600 shadow-[0_0_15px_rgba(245,158,11,0.4)]"
              >
                Launch Interactive Demo
              </a>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
