import React from 'react';
import { ShieldCheck, Cpu, Database, CheckCircle2 } from 'lucide-react';

export default function App() {
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6">
      <div className="max-w-xl w-full bg-slate-900/80 border border-slate-800 rounded-2xl p-8 shadow-2xl backdrop-blur-md">
        <div className="flex items-center space-x-3 mb-4">
          <div className="p-3 bg-indigo-600/20 border border-indigo-500/30 rounded-xl text-indigo-400">
            <ShieldCheck className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight text-white">ReconAI</h1>
            <p className="text-sm font-medium text-indigo-400">Verification-First Finance Controller</p>
          </div>
        </div>

        <div className="mt-6 p-4 bg-emerald-950/40 border border-emerald-500/30 rounded-xl flex items-center space-x-3 text-emerald-300">
          <CheckCircle2 className="w-5 h-5 flex-shrink-0" />
          <p className="text-sm font-semibold">
            Project foundation initialized successfully.
          </p>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 text-xs text-slate-400">
          <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-lg flex items-center space-x-2">
            <Cpu className="w-4 h-4 text-indigo-400" />
            <span>React + Vite Client</span>
          </div>
          <div className="p-3 bg-slate-950/60 border border-slate-800 rounded-lg flex items-center space-x-2">
            <Database className="w-4 h-4 text-indigo-400" />
            <span>Node.js + Express API</span>
          </div>
        </div>
      </div>
    </div>
  );
}
