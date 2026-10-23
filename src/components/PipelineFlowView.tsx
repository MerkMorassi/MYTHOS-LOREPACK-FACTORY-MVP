import React from 'react';
import {
  Workflow,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  FileText,
  Layers,
  Share2,
  Check,
  Package,
  Terminal,
  ArrowRight,
  ShieldCheck,
  Database,
  Sparkles,
  Search,
  ExternalLink,
  ChevronRight,
  Pause,
  CirclePause,
  CirclePlay,
  FileSearch,
  Activity
} from 'lucide-react';
import type { PipelineState, PipelineStepId } from '../types.ts';
import type { CanonicalAgent } from '../agents.ts';

interface PipelineFlowViewProps {
  pipeline: PipelineState;
  activeAgent: CanonicalAgent;
  stagedFilesCount: number;
  totalVaultNodes: number;
  totalVaultEdges: number;
  onRunFullPipeline: () => void;
  onResumeFromStep: (stepId: PipelineStepId) => void;
  onTogglePause: () => void;
  onToggleAutoRetry: () => void;
  onSelectTab: (tabId: any) => void;
  processingStrategy: 'fast' | 'bulk';
}

export const PipelineFlowView: React.FC<PipelineFlowViewProps> = ({
  pipeline,
  activeAgent,
  stagedFilesCount,
  totalVaultNodes,
  totalVaultEdges,
  onRunFullPipeline,
  onResumeFromStep,
  onTogglePause,
  onToggleAutoRetry,
  onSelectTab,
  processingStrategy,
}) => {
  const [batchFilter, setBatchFilter] = React.useState<'all' | 'success' | 'error'>('all');
  const stepsOrder: PipelineStepId[] = ['stage', 'ingest', 'graph', 'test', 'ship'];

  const stepMeta: Record<
    PipelineStepId,
    {
      title: string;
      desc: string;
      icon: React.ReactNode;
      phaseNumber: number;
    }
  > = {
    stage: {
      title: 'Stage Files',
      desc: 'Candidate lore documents staged in memory',
      icon: <FileText className="w-4 h-4" />,
      phaseNumber: 1,
    },
    ingest: {
      title: 'Incremental Ingest',
      desc: 'Chunking, embedding & atomic persistence to vault',
      icon: <Layers className="w-4 h-4" />,
      phaseNumber: 2,
    },
    graph: {
      title: 'Graph Synthesis',
      desc: 'Extracting semantic triplet edges for unlinked nodes',
      icon: <Share2 className="w-4 h-4" />,
      phaseNumber: 3,
    },
    test: {
      title: 'Air-Gap Cleanroom',
      desc: 'Full Nuke -> Re-import parity & schema certification',
      icon: <ShieldCheck className="w-4 h-4" />,
      phaseNumber: 4,
    },
    ship: {
      title: 'Golden Query & Ship',
      desc: 'Self-query verification & canonical .jsonl.gz distribution',
      icon: <Package className="w-4 h-4" />,
      phaseNumber: 5,
    },
  };

  const getStepStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono font-bold bg-[#00ff41]/10 text-[#00ff41] border border-[#00ff41]/30">
            <CheckCircle2 className="w-3 h-3 text-[#00ff41]" />
            COMPLETED
          </span>
        );
      case 'running':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono font-bold bg-[#ffaa00]/10 text-[#ffaa00] border border-[#ffaa00]/30 animate-pulse">
            <Loader2 className="w-3 h-3 text-[#ffaa00] animate-spin" />
            IN PROGRESS
          </span>
        );
      case 'error':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono font-bold bg-[#ff3300]/10 text-[#ff3300] border border-[#ff3300]/30">
            <AlertTriangle className="w-3 h-3 text-[#ff3300]" />
            INTERRUPTED
          </span>
        );
      case 'skipped':
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono font-bold bg-neutral-800 text-neutral-400 border border-neutral-700">
            SKIPPED
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] font-mono font-bold bg-neutral-900 text-neutral-500 border border-neutral-800">
            IDLE / READY
          </span>
        );
    }
  };

  const lastFailedStep = pipeline.lastFailedStepId;

  return (
    <div className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 max-w-7xl mx-auto w-full flex flex-col gap-6 text-[#e6e6e6]">
      {/* Top Banner / Pipeline Control Center */}
      <div className="bg-[#141414] border border-[#2a2a2a] p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-1.5 py-0.5 bg-[#00ff41]/20 border border-[#00ff41]/40 text-[#00ff41] font-mono text-[10px] font-bold uppercase tracking-wider">
              REAL-TIME ORCHESTRATOR
            </span>
            <span className="text-xs text-neutral-400 font-mono">
              TARGET: <span className="text-white font-bold">{activeAgent.name}</span> ({activeAgent.id})
            </span>
            <span className={`px-1.5 py-0.5 border font-mono text-[10px] font-bold uppercase tracking-wider rounded ${
              processingStrategy === 'fast' ? 'bg-[#ffaa00]/20 border-[#ffaa00]/40 text-[#ffaa00]' : 'bg-sky-500/20 border-sky-500/40 text-sky-400'
            }`}>
              MODE: {processingStrategy === 'fast' ? 'Fast Build' : 'Bulk Batch'}
            </span>
            <button
              onClick={onToggleAutoRetry}
              className={`px-1.5 py-0.5 border font-mono text-[10px] font-bold uppercase tracking-wider rounded cursor-pointer transition-colors ${
                pipeline.autoRetry 
                ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-400' 
                : 'bg-neutral-800 border-neutral-700 text-neutral-500'
              }`}
            >
              AUTO-RETRY: {pipeline.autoRetry ? 'ON' : 'OFF'}
            </button>
          </div>
          <h1 className="text-lg sm:text-xl font-black uppercase tracking-wider text-white flex items-center gap-2">
            <Workflow className="w-5 h-5 text-[#00ff41]" />
            <span>Lorepack Autonomous Pipeline</span>
          </h1>
          <p className="text-xs text-neutral-400 mt-1 max-w-2xl">
            Deterministic sequence (Stage &rarr; Ingest &rarr; Graph &rarr; Cleanroom Test &rarr; Ship). 
            If interrupted, you can resume seamlessly from any individual phase without repeating prior work.
          </p>
        </div>

        {/* Action Controls */}
        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          {lastFailedStep && !pipeline.active && (
            <button
              type="button"
              onClick={() => onResumeFromStep(lastFailedStep)}
              className="flex-1 md:flex-initial inline-flex items-center justify-center gap-2 px-3 py-2 bg-[#ff3300]/10 hover:bg-[#ff3300]/20 border border-[#ff3300] text-[#ff3300] font-mono text-xs font-bold uppercase tracking-wider cursor-pointer transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Resume from {stepMeta[lastFailedStep].title}</span>
            </button>
          )}

          {pipeline.active && (
            <button
              type="button"
              onClick={onTogglePause}
              className={`flex-1 md:flex-initial inline-flex items-center justify-center gap-2 px-4 py-2 border font-mono text-xs font-bold uppercase tracking-wider cursor-pointer transition-colors ${
                pipeline.paused 
                ? 'bg-amber-500 hover:bg-amber-600 border-amber-600 text-black shadow-[0_0_15px_rgba(245,158,11,0.25)]' 
                : 'bg-neutral-800 hover:bg-neutral-700 border-neutral-600 text-white'
              }`}
            >
              {pipeline.paused ? (
                <>
                  <CirclePlay className="w-3.5 h-3.5" />
                  <span>Resume</span>
                </>
              ) : (
                <>
                  <Pause className="w-3.5 h-3.5" />
                  <span>Global Pause</span>
                </>
              )}
            </button>
          )}

          <button
            type="button"
            disabled={pipeline.active && !pipeline.paused}
            onClick={onRunFullPipeline}
            className="flex-1 md:flex-initial inline-flex items-center justify-center gap-2 px-4 py-2 bg-[#00ff41] hover:bg-[#00ff66] disabled:opacity-40 text-black font-mono text-xs font-black uppercase tracking-wider cursor-pointer transition-colors shadow-[0_0_15px_rgba(0,255,65,0.25)]"
          >
            {pipeline.active ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>{pipeline.paused ? 'Pipeline Paused' : `Running Pipeline (${pipeline.overallProgress}%)`}</span>
              </>
            ) : (
              <>
                <Play className="w-3.5 h-3.5 fill-black" />
                <span>Run Full Auto-Ship Pipeline</span>
              </>
            )}
          </button>
        </div>
      </div>

      {/* Global Progress Bar */}
      <div className="bg-[#111] border border-[#222] p-4 flex flex-col gap-2">
        <div className="flex justify-between items-center text-xs font-mono">
          <span className="text-neutral-400">
            PIPELINE OVERALL STATUS: <strong className={pipeline.active ? 'text-[#00ff41]' : 'text-white'}>
              {pipeline.active
                ? `ACTIVE (${pipeline.currentStepId ? stepMeta[pipeline.currentStepId]?.title.toUpperCase() : 'INITIALIZING'})`
                : pipeline.lastFailedStepId
                ? `INTERRUPTED AT ${stepMeta[pipeline.lastFailedStepId]?.title.toUpperCase()}`
                : pipeline.overallProgress === 100
                ? 'RELEASE READY / CERTIFIED'
                : 'IDLE'}
            </strong>
          </span>
          <span className="font-bold text-[#00ff41]">{pipeline.overallProgress}%</span>
        </div>
        <div className="w-full bg-[#1c1c1c] h-2 overflow-hidden">
          <div
            className={`h-full transition-all duration-300 ${
              pipeline.lastFailedStepId && !pipeline.active ? 'bg-[#ff3300]' : 'bg-[#00ff41]'
            }`}
            style={{ width: `${pipeline.overallProgress}%` }}
          />
        </div>
      </div>

      {/* Real-time Stepper Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {stepsOrder.map((stepId, index) => {
          const info = pipeline.steps[stepId];
          const meta = stepMeta[stepId];
          const isCurrent = pipeline.currentStepId === stepId;
          const isError = info.status === 'error';
          const isDone = info.status === 'completed';

          return (
            <div
              key={stepId}
              className={`relative bg-[#141414] border p-4 flex flex-col justify-between transition-all ${
                isCurrent
                  ? 'border-[#00ff41] shadow-[0_0_15px_rgba(0,255,65,0.12)]'
                  : isError
                  ? 'border-[#ff3300] bg-[#1a0f0f]'
                  : isDone
                  ? 'border-[#2e3b2e]'
                  : 'border-[#222]'
              }`}
            >
              <div>
                {/* Header with step number & icon */}
                <div className="flex justify-between items-center mb-2.5">
                  <div className="flex items-center gap-1.5 font-mono text-[10px] text-neutral-400">
                    <span className="w-4 h-4 rounded-full bg-[#222] flex items-center justify-center font-bold text-white text-[9px]">
                      {meta.phaseNumber}
                    </span>
                    <span className="uppercase tracking-wider">PHASE {meta.phaseNumber}</span>
                  </div>
                  <div className={isDone ? 'text-[#00ff41]' : isCurrent ? 'text-amber-400' : 'text-neutral-500'}>
                    {meta.icon}
                  </div>
                </div>

                <h3 className="text-sm font-bold uppercase tracking-wide text-white mb-1">
                  {meta.title}
                </h3>
                <p className="text-[11px] text-neutral-400 leading-snug mb-3">
                  {meta.desc}
                </p>
              </div>

              <div>
                {/* Progress Mini Bar */}
                <div className="w-full bg-[#222] h-1 mb-2">
                  <div
                    className={`h-full transition-all duration-300 ${
                      isError ? 'bg-[#ff3300]' : isDone ? 'bg-[#00ff41]' : 'bg-amber-400'
                    }`}
                    style={{ width: `${info.progress}%` }}
                  />
                </div>

                {/* Status Badge */}
                <div className="flex justify-between items-center mt-2">
                  {getStepStatusBadge(info.status)}

                  {/* Resume / Execute individual step button */}
                  {!pipeline.active && (
                    <button
                      type="button"
                      onClick={() => onResumeFromStep(stepId)}
                      title={`Execute or resume specifically from ${meta.title}`}
                      className="text-[10px] font-mono text-neutral-400 hover:text-white underline cursor-pointer"
                    >
                      {isError ? 'Retry' : 'Run'}
                    </button>
                  )}
                </div>

                {/* Detail or error message */}
                {info.detail && (
                  <p className="mt-2 text-[10px] font-mono text-neutral-400 truncate" title={info.detail}>
                    {info.detail}
                  </p>
                )}
                {info.error && (
                  <p className="mt-2 text-[10px] font-mono text-[#ff3300] line-clamp-2" title={info.error}>
                    ERR: {info.error}
                  </p>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Batch Monitor UI section */}
      <div className="bg-[#121212] border border-[#242424] p-4 flex flex-col gap-3 mb-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-[#222] pb-3 gap-4">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-sky-400" />
            <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-white">
              Batch Monitor: Document Status
            </h2>
          </div>
          
          <div className="flex items-center gap-2 self-end md:self-auto">
            <div className="flex bg-neutral-900 border border-neutral-800 p-0.5 rounded shadow-inner">
              {(['all', 'success', 'error'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setBatchFilter(f)}
                  className={`px-3 py-1 text-[9px] font-mono font-bold uppercase tracking-widest transition-all cursor-pointer rounded ${
                    batchFilter === f 
                    ? 'bg-neutral-800 text-white shadow-sm' 
                    : 'text-neutral-500 hover:text-neutral-300'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2 text-[10px] font-mono text-neutral-500 uppercase">
            <span>Pool: {pipeline.batchFiles.length}</span>
            <span className="text-[#222]">|</span>
            <span>OK: {pipeline.batchFiles.filter(f => f.status === 'completed').length}</span>
            <span className="text-[#222]">|</span>
            <span>ERR: {pipeline.batchFiles.filter(f => f.status === 'error').length}</span>
          </div>
        </div>

        <div className="grid grid-cols-1 divide-y divide-[#1c1c1c] max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
          {pipeline.batchFiles.length === 0 ? (
            <div className="py-8 text-center flex flex-col items-center gap-2 text-neutral-600">
              <FileSearch className="w-8 h-8 opacity-20" />
              <span className="text-[11px] uppercase tracking-widest font-mono">No documents in active pipeline pool</span>
            </div>
          ) : pipeline.batchFiles.filter(f => {
            if (batchFilter === 'all') return true;
            if (batchFilter === 'success') return f.status === 'completed';
            if (batchFilter === 'error') return f.status === 'error';
            return true;
          }).length === 0 ? (
            <div className="py-8 text-center flex flex-col items-center gap-2 text-neutral-700 font-mono text-[10px] uppercase tracking-wider">
              No documents matching "{batchFilter}" filter
            </div>
          ) : (
            pipeline.batchFiles
              .filter(f => {
                if (batchFilter === 'all') return true;
                if (batchFilter === 'success') return f.status === 'completed';
                if (batchFilter === 'error') return f.status === 'error';
                return true;
              })
              .map((file, idx) => (
              <div key={idx} className="py-2.5 flex items-center justify-between group">
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className={`w-1.5 h-1.5 rounded-full ${
                    file.status === 'completed' ? 'bg-[#00ff41]' : 
                    file.status === 'processing' ? 'bg-amber-500 animate-pulse' : 
                    file.status === 'error' ? 'bg-[#ff3300]' : 'bg-neutral-800'
                  }`} />
                  <div className="flex flex-col min-w-0">
                    <span className="text-[11px] font-bold text-neutral-300 truncate font-mono uppercase tracking-tight">
                      {file.name}
                    </span>
                    <span className="text-[9px] text-neutral-600 font-mono">
                      {(file.size ? (file.size / 1024).toFixed(1) : 0)} KB
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-4 shrink-0">
                  <div className="flex flex-col items-end gap-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-[10px] font-mono font-bold ${
                        file.status === 'completed' ? 'text-[#00ff41]' : 
                        file.status === 'processing' ? 'text-amber-500' : 
                        file.status === 'error' ? 'text-[#ff3300]' : 'text-neutral-600'
                      }`}>
                        {file.status.toUpperCase()}
                      </span>
                      <span className="text-[10px] font-mono text-neutral-400 w-8 text-right">
                        {file.progress}%
                      </span>
                    </div>
                    <div className="w-24 bg-[#1c1c1c] h-1 rounded-full overflow-hidden">
                      <div 
                        className={`h-full transition-all duration-300 ${
                          file.status === 'completed' ? 'bg-[#00ff41]' : 
                          file.status === 'processing' ? 'bg-amber-500' : 
                          file.status === 'error' ? 'bg-[#ff3300]' : 'bg-neutral-800'
                        }`}
                        style={{ width: `${file.progress}%` }}
                      />
                    </div>
                  </div>
                  {file.status === 'completed' && <Check className="w-3.5 h-3.5 text-[#00ff41]" />}
                  {file.status === 'error' && <AlertTriangle className="w-3.5 h-3.5 text-[#ff3300]" />}
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Execution Diagnostics & Log Console */}
      <div className="bg-[#121212] border border-[#242424] p-4 flex flex-col gap-3">
        <div className="flex justify-between items-center border-b border-[#222] pb-2">
          <div className="flex items-center gap-2">
            <Terminal className="w-4 h-4 text-[#00ff41]" />
            <h2 className="text-xs font-mono font-bold uppercase tracking-wider text-white">
              Pipeline Execution Log
            </h2>
          </div>
          <div className="flex items-center gap-3 text-[11px] font-mono text-neutral-400">
            <span>Staged: <strong className="text-white">{stagedFilesCount}</strong></span>
            <span>Vault Nodes: <strong className="text-[#00ff41]">{totalVaultNodes}</strong></span>
            <span>Vault Edges: <strong className="text-purple-400">{totalVaultEdges}</strong></span>
          </div>
        </div>

        <div className="bg-black border border-[#1e1e1e] p-3 font-mono text-xs h-56 overflow-y-auto flex flex-col gap-1.5 select-text">
          {pipeline.logs.length === 0 ? (
            <span className="text-neutral-600">No active pipeline logs. Click "Run Full Auto-Ship Pipeline" to start.</span>
          ) : (
            pipeline.logs.map((log, i) => (
              <div key={i} className="flex items-start gap-2 leading-relaxed">
                <span className="text-neutral-600 shrink-0 text-[10px] pt-0.5">[{log.time}]</span>
                <span
                  className={
                    log.type === 'ok'
                      ? 'text-[#00ff41]'
                      : log.type === 'err'
                      ? 'text-[#ff3300] font-bold'
                      : 'text-neutral-300'
                  }
                >
                  {log.msg}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
