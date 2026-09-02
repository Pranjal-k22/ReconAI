import React from "react";
import { Menu, ShieldCheck } from "lucide-react";
import { IntegrationStatus } from "./IntegrationStatus";

export function Topbar({ onMenuClick }) {
  return (
    <header className="bg-white border-b border-slate-200 h-16 px-4 lg:px-6 flex items-center justify-between sticky top-0 z-30 shadow-xs">
      <div className="flex items-center space-x-3">
        <button
          onClick={onMenuClick}
          className="p-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 lg:hidden"
          aria-label="Open Navigation"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="hidden sm:flex items-center space-x-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-semibold text-slate-700 tracking-wide">
            RECONAI CONSOLE
          </span>
        </div>
      </div>

      <div className="flex items-center space-x-4">
        <IntegrationStatus />
      </div>
    </header>
  );
}
