import React from 'react';
import { CheckCircle, Database, Network, X, ArrowRight, Zap, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export interface IngestionSummaryData {
  nodesAdded: number;
  edgesAdded: number;
  totalNodes: number;
  totalEdges: number;
  sourceName?: string;
  durationMs?: number;
}

interface BatchIngestionSummaryProps {
  data: IngestionSummaryData | null;
  onClose: () => void;
}

export const BatchIngestionSummary: React.FC<BatchIngestionSummaryProps> = ({ data, onClose }) => {
  if (!data) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="w-full max-w-lg bg-neutral-900 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="relative border-b border-neutral-800 bg-neutral-900/50 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <CheckCircle className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-sm font-black text-white uppercase tracking-widest">Ingestion Complete</h2>
                <p className="text-[10px] text-neutral-500 uppercase tracking-tight font-mono">
                  {data.sourceName || 'Batch Process'} &bull; Protocol V4.2
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 text-neutral-500 hover:text-white transition-colors rounded-lg hover:bg-neutral-800"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Stats Grid */}
          <div className="p-6 grid grid-cols-2 gap-4">
            {/* Nodes Block */}
            <div className="bg-neutral-950 border border-neutral-800/50 rounded-xl p-4 flex flex-col gap-3 group hover:border-emerald-500/30 transition-colors">
              <div className="flex items-center justify-between">
                <Database className="w-4 h-4 text-emerald-400" />
                <span className="text-[10px] font-bold text-emerald-500/50 uppercase tracking-tighter">Nodes</span>
              </div>
              <div>
                <div className="text-3xl font-black text-white leading-none">+{data.nodesAdded}</div>
                <div className="text-[10px] text-neutral-500 uppercase mt-1 flex items-center gap-1">
                  <span>Total Payload:</span>
                  <span className="text-neutral-300">{data.totalNodes}</span>
                </div>
              </div>
            </div>

            {/* Edges Block */}
            <div className="bg-neutral-950 border border-neutral-800/50 rounded-xl p-4 flex flex-col gap-3 group hover:border-blue-500/30 transition-colors">
              <div className="flex items-center justify-between">
                <Network className="w-4 h-4 text-blue-400" />
                <span className="text-[10px] font-bold text-blue-500/50 uppercase tracking-tighter">Edges</span>
              </div>
              <div>
                <div className="text-3xl font-black text-white leading-none">+{data.edgesAdded}</div>
                <div className="text-[10px] text-neutral-500 uppercase mt-1 flex items-center gap-1">
                  <span>Graph Density:</span>
                  <span className="text-neutral-300">{data.totalEdges}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Details / Footer */}
          <div className="px-6 pb-6 space-y-4">
            <div className="bg-neutral-950/50 border border-neutral-800/30 rounded-lg p-3 flex items-start gap-3">
              <Zap className="w-4 h-4 text-amber-500 mt-0.5" />
              <div className="flex-1">
                <p className="text-[11px] text-neutral-300 leading-relaxed font-mono">
                  Memory architecture successfully mapped. Semantic triplets extracted and indexed into the persistence layer.
                </p>
              </div>
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-neutral-800/50">
              <div className="flex items-center gap-2 text-[9px] text-neutral-500 uppercase tracking-widest font-bold">
                <Info className="w-3 h-3" />
                <span>Sync status: Authorized</span>
              </div>
              <button
                onClick={onClose}
                className="inline-flex items-center gap-2 px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-white text-[10px] font-black uppercase tracking-[0.2em] rounded-lg transition-all active:scale-95 group"
              >
                <span>Acknowledge</span>
                <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform" />
              </button>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
