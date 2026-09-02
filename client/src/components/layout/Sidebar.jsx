import React from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutDashboard,
  GitCompareArrows,
  TriangleAlert,
  ScrollText,
  Upload,
  CreditCard,
  BarChart3,
  ShieldCheck
} from "lucide-react";

export const navItems = [
  { name: "Dashboard", path: "/", icon: LayoutDashboard },
  { name: "Reconciliation Runs", path: "/runs", icon: GitCompareArrows },
  { name: "Exceptions", path: "/exceptions", icon: TriangleAlert },
  { name: "Audit Trail", path: "/audit", icon: ScrollText },
  { name: "Data Import", path: "/import", icon: Upload },
  { name: "Razorpay Sync", path: "/razorpay", icon: CreditCard },
  { name: "Evaluation", path: "/evaluation", icon: BarChart3 }
];

export function Sidebar() {
  return (
    <aside className="w-64 bg-slate-950 text-slate-300 border-r border-slate-800 flex flex-col flex-shrink-0 min-h-screen">
      {/* Brand Header */}
      <div className="p-5 border-b border-slate-800/80 flex items-center space-x-3">
        <div className="p-2 bg-indigo-600/20 border border-indigo-500/30 rounded-lg text-indigo-400">
          <ShieldCheck className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-lg font-bold tracking-tight text-white leading-tight">ReconAI</h1>
          <p className="text-[11px] font-medium text-slate-400">Finance Controller</p>
        </div>
      </div>

      {/* Navigation Links */}
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        <div className="px-3 py-2 text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
          Navigation
        </div>
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.path === "/"}
              className={({ isActive }) =>
                `flex items-center space-x-3 px-3 py-2.5 rounded-lg text-xs font-medium transition-colors ${
                  isActive
                    ? "bg-slate-800 text-white font-semibold shadow-xs"
                    : "text-slate-400 hover:text-slate-200 hover:bg-slate-900"
                }`
              }
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span>{item.name}</span>
            </NavLink>
          );
        })}
      </nav>

      {/* Sidebar Footer */}
      <div className="p-4 border-t border-slate-800/80 bg-slate-950 text-[11px] text-slate-500">
        <div className="flex items-center justify-between mb-1">
          <span>Engine Version</span>
          <span className="font-mono text-slate-400">V1.0</span>
        </div>
        <div className="flex items-center justify-between">
          <span>Dataset</span>
          <span className="font-mono text-slate-400">DEMO_V1</span>
        </div>
      </div>
    </aside>
  );
}
