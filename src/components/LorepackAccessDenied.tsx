import React from 'react';
import { ShieldAlert, ChevronLeft, KeyRound, Sparkles, Cpu } from 'lucide-react';

interface LorepackAccessDeniedProps {
  onPresentSigil: () => void;
  onReturn: () => void;
}

export const LorepackAccessDenied: React.FC<LorepackAccessDeniedProps> = ({ onPresentSigil, onReturn }) => {
  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 flex flex-col items-center justify-center p-4 relative overflow-hidden font-mono selection:bg-rose-500/30 selection:text-rose-200">
      {/* Subtle background ambient mesh - matching the SigilAccessGate aesthetic */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-rose-950/10 via-neutral-950 to-neutral-950 pointer-events-none" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f293708_1px,transparent_1px),linear-gradient(to_bottom,#1f293708_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none opacity-40" />

      <div className="w-full max-w-md relative z-10 flex flex-col items-center">
        {/* Brand Header */}
        <div className="text-center mb-8 animate-in fade-in slide-in-from-top-4 duration-700">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full border border-rose-500/30 bg-rose-950/30 text-rose-400 text-xs tracking-widest uppercase mb-3 shadow-[0_0_15px_rgba(244,63,94,0.1)]">
            <Cpu className="w-3.5 h-3.5 text-rose-400 animate-pulse" />
            <span>LOREPACK</span>
          </div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-neutral-300 uppercase">
            Portable memory for intelligent agents.
          </h1>
        </div>

        {/* Main Content Card */}
        <div className="w-full bg-neutral-900/80 border border-neutral-800 rounded-2xl p-8 backdrop-blur-md shadow-2xl shadow-black/80 flex flex-col items-center text-center animate-in fade-in zoom-in-95 duration-500">
          <div className="w-16 h-16 rounded-full bg-rose-950/60 border border-rose-500/50 flex items-center justify-center text-rose-400 shadow-[0_0_30px_rgba(244,63,94,0.25)] mb-6">
            <ShieldAlert className="w-10 h-10" />
          </div>

          <div className="space-y-3 mb-8">
            <h2 className="text-2xl font-black tracking-[0.2em] text-rose-500 uppercase">
              ACCESS DENIED
            </h2>
            <p className="text-sm text-neutral-400 leading-relaxed max-w-[280px] mx-auto">
              A valid <span className="text-amber-500/90 font-bold italic">GateKeeper SIGIL</span> is required to enter this LOREPACK.
            </p>
          </div>

          {/* Primary Action */}
          <button
            onClick={onPresentSigil}
            className="w-full group relative inline-flex items-center justify-center gap-3 px-6 py-3.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-neutral-950 font-black text-sm tracking-[0.15em] uppercase shadow-[0_0_20px_rgba(245,158,11,0.2)] transition-all active:scale-[0.98] cursor-pointer overflow-hidden mb-4"
          >
            <div className="absolute inset-0 bg-white/10 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700" />
            <KeyRound className="w-4 h-4" />
            <span>PRESENT SIGIL / AUTHENTICATE</span>
          </button>

          {/* Secondary Action */}
          <button
            onClick={onReturn}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-bold text-neutral-500 hover:text-neutral-300 tracking-widest uppercase transition-colors cursor-pointer group"
          >
            <ChevronLeft className="w-3.5 h-3.5 group-hover:-translate-x-1 transition-transform" />
            <span>Return to Origin</span>
          </button>
        </div>

        {/* protocol footer */}
        <div className="mt-12 flex items-center gap-2 text-[10px] text-neutral-600 uppercase tracking-widest">
          <Sparkles className="w-3 h-3" />
          <span>Security Protocol 84.4 &bull; Archivax Integrated</span>
        </div>
      </div>
    </div>
  );
};
