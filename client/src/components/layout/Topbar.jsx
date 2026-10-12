import React, { useState } from "react";
import { Menu, ShieldCheck, User, KeyRound, LogOut, ChevronDown } from "lucide-react";
import { IntegrationStatus } from "./IntegrationStatus";
import { useAuth, DEMO_CREDENTIALS } from "../../context/AuthContext";
import { Badge } from "../common/Badge";

export function Topbar({ onMenuClick }) {
  const { user, isAuthenticated, logout, openLoginModal, login } = useAuth();
  const [dropdownOpen, setDropdownOpen] = useState(false);

  async function handleSwitch(cred) {
    setDropdownOpen(false);
    await login(cred.email, cred.password);
    window.location.reload();
  }

  function handleLogout() {
    setDropdownOpen(false);
    logout();
    window.location.reload();
  }

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

      <div className="flex items-center space-x-3">
        <IntegrationStatus />

        {/* User Profile / Session Menu */}
        <div className="relative">
          {isAuthenticated && user ? (
            <div className="relative">
              <button
                onClick={() => setDropdownOpen((prev) => !prev)}
                className="flex items-center space-x-2 px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors text-left"
              >
                <div className="w-6 h-6 rounded-full bg-slate-800 text-white flex items-center justify-center text-xs font-semibold">
                  {user.role ? user.role[0] : "U"}
                </div>
                <div className="hidden md:block">
                  <div className="text-xs font-medium text-slate-900 leading-tight">
                    {user.email || user.userId}
                  </div>
                  <div className="text-[10px] text-slate-500 leading-tight">
                    {user.role} {user.tenantId ? `• ${user.tenantId}` : ""}
                  </div>
                </div>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>

              {dropdownOpen && (
                <div className="absolute right-0 mt-2 w-56 bg-white border border-slate-200 rounded-xl shadow-lg py-2 z-50 text-xs animate-in fade-in zoom-in-95 duration-100">
                  <div className="px-3 py-1.5 border-b border-slate-100 text-slate-500 font-medium">
                    Switch Demo Role:
                  </div>
                  {DEMO_CREDENTIALS.map((cred) => (
                    <button
                      key={cred.role}
                      onClick={() => handleSwitch(cred)}
                      className={`w-full text-left px-3 py-2 flex items-center justify-between hover:bg-slate-50 transition-colors ${
                        user.role === cred.role ? "font-semibold text-indigo-600 bg-indigo-50/50" : "text-slate-700"
                      }`}
                    >
                      <span>{cred.label}</span>
                      <Badge variant={cred.badgeColor} size="xs">
                        {cred.role}
                      </Badge>
                    </button>
                  ))}
                  <div className="border-t border-slate-100 my-1" />
                  <button
                    onClick={handleLogout}
                    className="w-full text-left px-3 py-2 text-rose-600 hover:bg-rose-50 flex items-center space-x-2 transition-colors"
                  >
                    <LogOut className="w-3.5 h-3.5" />
                    <span>Sign Out</span>
                  </button>
                </div>
              )}
            </div>
          ) : (
            <button
              onClick={openLoginModal}
              className="flex items-center space-x-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-medium transition-colors shadow-xs"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Sign In</span>
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
