import React, { useState } from "react";
import { X, Shield, Lock, User, KeyRound, CheckCircle2, ArrowRight } from "lucide-react";
import { useAuth, DEMO_CREDENTIALS } from "../../context/AuthContext";
import { Button } from "./Button";
import { Badge } from "./Badge";

export function LoginModal({ isOpen, onClose }) {
  const { login } = useAuth();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  if (!isOpen) return null;

  async function handleManualSubmit(e) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const res = await login(identifier, password);
    setSubmitting(false);
    if (!res.success) {
      setError(res.error);
    } else {
      window.location.reload();
    }
  }

  async function handleDemoLogin(cred) {
    setError(null);
    setSubmitting(true);
    const res = await login(cred.email, cred.password);
    setSubmitting(false);
    if (!res.success) {
      setError(res.error);
    } else {
      window.location.reload();
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-white rounded-2xl shadow-2xl border border-slate-100 overflow-hidden">
        {/* Modal Header */}
        <div className="bg-slate-900 px-6 py-5 text-white flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-indigo-600 rounded-xl text-white">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold">ReconAI 2.0 Authentication</h3>
              <p className="text-xs text-slate-400">Select a demo role or sign in with credentials</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {error && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
              {error}
            </div>
          )}

          {/* Quick 1-Click Demo Profiles */}
          <div>
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block mb-2">
              1-Click Demo Profiles
            </span>
            <div className="grid grid-cols-1 gap-2">
              {DEMO_CREDENTIALS.map((cred) => (
                <button
                  key={cred.role}
                  type="button"
                  disabled={submitting}
                  onClick={() => handleDemoLogin(cred)}
                  className="flex items-center justify-between p-3 rounded-xl border border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/40 transition-all text-left group"
                >
                  <div className="flex items-center space-x-3">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center text-slate-700 group-hover:bg-indigo-600 group-hover:text-white transition-colors">
                      <User className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-slate-900">{cred.label}</div>
                      <div className="text-xs text-slate-500">{cred.email}</div>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <Badge variant={cred.badgeColor}>{cred.role}</Badge>
                    <ArrowRight className="w-4 h-4 text-slate-400 group-hover:text-indigo-600 group-hover:translate-x-0.5 transition-all" />
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="relative flex items-center justify-center">
            <div className="border-t border-slate-200 w-full" />
            <span className="bg-white px-3 text-xs text-slate-400 uppercase tracking-wider">
              Or Manual Sign-In
            </span>
          </div>

          {/* Manual Credentials Form */}
          <form onSubmit={handleManualSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Email or User ID
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <User className="w-4 h-4" />
                </div>
                <input
                  type="text"
                  required
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder="admin@reconai.com"
                  className="block w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-700 mb-1">
                Password
              </label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <Lock className="w-4 h-4" />
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••••••"
                  className="block w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
            </div>

            <Button
              type="submit"
              variant="primary"
              className="w-full"
              loading={submitting}
              icon={KeyRound}
            >
              Sign In
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
