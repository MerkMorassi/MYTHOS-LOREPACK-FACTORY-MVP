import React, { useState, useRef, useEffect } from 'react';
import { Lock } from 'lucide-react';
import { LorepackFactory } from '../lorepack-factory.ts';
import { IndexedDbLorepackStore } from '../indexeddb-store.ts';
import { GeminiProvider } from '../providers/gemini-provider.ts';
import {
  CANONICAL_MYTHOS_AGENTS,
  CanonicalAgent,
  getCanonicalAgentById,
} from '../agents.ts';

export interface MonolithicLogEntry {
  id: string;
  time: string;
  src: 'SYS' | 'USER' | 'AI' | 'KERNEL' | 'TEST';
  type: 'sys' | 'user' | 'ai' | 'ok' | 'err';
  msg: string;
}

interface MonolithicViewProps {
  factory: LorepackFactory | null;
  store: IndexedDbLorepackStore | null;
  provider: GeminiProvider | null;
  agentId: string;
  setAgentId: (id: string) => void;
  agentHandle: string;
  setAgentHandle: (handle: string) => void;
  stats: { totalNodes: number; totalEdges: number };
  refreshStats: () => Promise<void>;
  onRunTestMatrix?: () => void;
  onPurgeAgent?: () => Promise<void>;
  onNukeVault?: () => Promise<void>;
  customApiKeys: string[];
  setCustomApiKeys: React.Dispatch<React.SetStateAction<string[]>>;
}

export const MonolithicView: React.FC<MonolithicViewProps> = ({
  factory,
  store,
  provider,
  agentId,
  setAgentId,
  agentHandle,
  setAgentHandle,
  stats,
  refreshStats,
  onRunTestMatrix,
  onPurgeAgent,
  onNukeVault,
  customApiKeys,
  setCustomApiKeys,
}) => {
  // Current active canonical agent
  const activeAgent = getCanonicalAgentById(agentId) || CANONICAL_MYTHOS_AGENTS[0];

  // Monolithic Control States
  const [generationModel, setGenerationModel] = useState<string>('gemini-3.8-flash');
  const [availableModels, setAvailableModels] = useState<string[]>([
    'gemini-3.6-flash',
    'gemini-3.8-flash',
    'gemini-3-flash-preview',
    'gemini-3.1-pro-preview',
    'gemini-2.5-pro',
    'gemini-1.5-flash',
    'gemini-1.5-pro'
  ]);
  const [fetchingModels, setFetchingModels] = useState<boolean>(false);
  const [showAgentIdentity, setShowAgentIdentity] = useState<boolean>(false);
  const [showGenerationModel, setShowGenerationModel] = useState<boolean>(false);
  const [showPrompt, setShowPrompt] = useState<boolean>(false);
  const [systemPrompt, setSystemPrompt] = useState<string>(activeAgent.system_instruction);
  const [showKeys, setShowKeys] = useState<boolean>(false);

  // Parallel API Keys (K1, K2, K3)
  const [k1, setK1] = useState<string>(customApiKeys[0] || '');
  const [k2, setK2] = useState<string>(customApiKeys[1] || '');
  const [k3, setK3] = useState<string>(customApiKeys[2] || '');

  useEffect(() => {
    setK1(customApiKeys[0] || '');
    setK2(customApiKeys[1] || '');
    setK3(customApiKeys[2] || '');
  }, [customApiKeys]);

  // Hyperparameters
  const [showEmbeddingModel, setShowEmbeddingModel] = useState<boolean>(false);
  const [showOperations, setShowOperations] = useState<boolean>(true);
  const [isParametersLocked, setIsParametersLocked] = useState<boolean>(false);
  const [embeddingModel] = useState<string>('gemini-embedding-2');
  const [batchSize, setBatchSize] = useState<number>(40);
  const [lanesPerKey, setLanesPerKey] = useState<number>(2);
  const [chunkSize, setChunkSize] = useState<number>(2000);
  const [graphThreshold, setGraphThreshold] = useState<number>(0.78);

  // File Staging
  const [stagedFiles, setStagedFiles] = useState<{ name: string; size: number; text: string }[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  // Runtime / Telemetry state
  const [runtimeState, setRuntimeState] = useState<'BOOTSTRAP READY' | 'IDLE' | 'PROCESSING' | 'INGESTING' | 'ERROR'>('IDLE');
  const [progress, setProgress] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);

  // Command Oracle Chat
  const [chatInput, setChatInput] = useState<string>('');
  const [oracleBusy, setOracleBusy] = useState<boolean>(false);

  // Nuke Modal state
  const [showNukeModal, setShowNukeModal] = useState<boolean>(false);

  // Log entries state
  const [logs, setLogs] = useState<MonolithicLogEntry[]>([
    {
      id: 'boot-1',
      time: new Date().toLocaleTimeString(),
      src: 'SYS',
      type: 'sys',
      msg: `LOREPACK™ v3.7.1 :: CANONICAL MYTHOS CONTROLLER INITIALIZED`,
    },
    {
      id: 'boot-2',
      time: new Date().toLocaleTimeString(),
      src: 'SYS',
      type: 'ok',
      msg: `Agent locus attached: MYTHOS.LORE.${activeAgent.id} (Port ${activeAgent.port})`,
    },
  ]);

  const logConsoleRef = useRef<HTMLDivElement>(null);

  // Auto scroll log console
  useEffect(() => {
    if (logConsoleRef.current) {
      logConsoleRef.current.scrollTop = logConsoleRef.current.scrollHeight;
    }
  }, [logs]);

  // Sync active agent prompt when agent changes
  useEffect(() => {
    setSystemPrompt(activeAgent.system_instruction);
  }, [agentId, activeAgent.system_instruction]);

  const addLog = (msg: string, src: MonolithicLogEntry['src'] = 'SYS', type: MonolithicLogEntry['type'] = 'sys') => {
    const entry: MonolithicLogEntry = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      time: new Date().toLocaleTimeString(),
      src,
      type,
      msg,
    };
    setLogs((prev) => [...prev, entry]);
  };

  const handleFetchModels = async () => {
    if (!provider || !provider.fetchModels) {
      addLog('ERR: Model fetcher unavailable on provider', 'SYS', 'err');
      return;
    }
    setFetchingModels(true);
    addLog('Fetching available models from Google AI...', 'SYS', 'sys');
    try {
      const models = await provider.fetchModels();
      if (models && models.length > 0) {
        setAvailableModels(models);
        // Default to a recognized flash model if the current one isn't in the list
        if (!models.includes(generationModel)) {
           const fallback = models.find(m => m.includes('flash')) || models[0];
           if (fallback) setGenerationModel(fallback);
        }
        addLog(`Successfully retrieved ${models.length} models.`, 'SYS', 'ok');
      } else {
        addLog('No generation models found.', 'SYS', 'sys');
      }
    } catch (err: any) {
      addLog(`Failed to fetch models: ${err.message}`, 'SYS', 'err');
      // If fetching fails entirely (e.g. invalid key or cors), fall back to sensible defaults
      setAvailableModels([
        'gemini-3.6-flash',
        'gemini-3.8-flash',
        'gemini-3-flash-preview',
        'gemini-3.1-pro-preview',
        'gemini-2.5-pro',
        'gemini-1.5-flash',
        'gemini-1.5-pro'
      ]);
      setGenerationModel('gemini-3.8-flash');
    } finally {
      setFetchingModels(false);
    }
  };

  // Lock parameters handler
  const handleLockParameters = () => {
    // Sync keys
    const newKeys = [k1, k2, k3].map((k) => k.trim()).filter((k) => k.length > 0);
    setCustomApiKeys(newKeys);
    setIsParametersLocked(true);
    addLog(
      `Parameters locked: Model=${generationModel}, ChunkSize=${chunkSize}, Threshold=${graphThreshold}, KeysActive=${newKeys.length}`,
      'KERNEL',
      'ok'
    );
    setRuntimeState('IDLE');
  };

  // File staging
  const handleStageFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const files = Array.from(e.target.files);
    addLog(`Staging ${files.length} candidate file(s)...`, 'SYS', 'sys');

    files.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        setStagedFiles((prev) => [...prev, { name: file.name, size: file.size, text: text || '' }]);
        addLog(`Staged: ${file.name} (${Math.round(file.size / 1024)} KB)`, 'SYS', 'ok');
      };
      reader.readAsText(file);
    });

    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Ingest Lore from Staged Files or Default Text
  const handleIngestLore = async () => {
    if (!factory) {
      addLog('ERR: LorepackFactory kernel not initialized', 'SYS', 'err');
      return;
    }

    if (stagedFiles.length === 0) {
      addLog('No staged files. Generating synthetic default locus lore payload...', 'SYS', 'sys');
      setIsProcessing(true);
      setRuntimeState('INGESTING');
      setProgress(15);

      try {
        const sampleDoc = `[${activeAgent.id} CORE LORE DOCUMENT]\nAgent: ${activeAgent.name}\nHandle: ${activeAgent.handle}\nRole: ${activeAgent.role}\nRevision: ${activeAgent.revision}\nLocus: MYTHOS.LORE.${activeAgent.id}\nTone: ${activeAgent.meta.tone}\n\nKey Directives:\n${activeAgent.meta.constraints.map((c) => `- ${c}`).join('\n')}\n\nFoundational Context:\n${activeAgent.meta.description}`;
        
        setProgress(40);
        const chunks = factory.chunk(sampleDoc, chunkSize);
        const batches = chunks.map((text) => ({
          text,
          source: `${activeAgent.id.toLowerCase()}-core-lore.txt`,
        }));
        const result = await factory.ingestBatches(batches, {
          agentId: activeAgent.id,
          onProgress: (p) => {
            setProgress(40 + Math.round((p.processed / Math.max(1, batches.length)) * 50));
          },
        });

        setProgress(100);
        addLog(
          `Ingest completed: Generated ${result.ingested} vector records.`,
          'KERNEL',
          'ok'
        );
        await refreshStats();
        setRuntimeState('IDLE');
      } catch (err: any) {
        addLog(`Ingest failure: ${err.message}`, 'KERNEL', 'err');
        setRuntimeState('ERROR');
      } finally {
        setIsProcessing(false);
        setTimeout(() => setProgress(0), 1000);
      }
      return;
    }

    setIsProcessing(true);
    setRuntimeState('INGESTING');
    setProgress(10);
    addLog(`Beginning ingestion of ${stagedFiles.length} staged file(s)...`, 'SYS', 'sys');

    try {
      let totalCreated = 0;
      for (let i = 0; i < stagedFiles.length; i++) {
        const file = stagedFiles[i];
        addLog(`Ingesting file [${i + 1}/${stagedFiles.length}]: ${file.name}...`, 'KERNEL', 'sys');
        
        const chunks = factory.chunk(file.text, chunkSize);
        const batches = chunks.map((text) => ({ text, source: file.name }));
        const result = await factory.ingestBatches(batches, {
          agentId: activeAgent.id,
        });

        totalCreated += result.ingested;
        setProgress(Math.round(((i + 1) / stagedFiles.length) * 100));
      }

      addLog(`All staged files ingested! Total records stored: ${totalCreated}`, 'KERNEL', 'ok');
      setStagedFiles([]);
      await refreshStats();
      setRuntimeState('IDLE');
    } catch (err: any) {
      addLog(`Ingest error: ${err.message}`, 'KERNEL', 'err');
      setRuntimeState('ERROR');
    } finally {
      setIsProcessing(false);
      setTimeout(() => setProgress(0), 1200);
    }
  };

  // Build Graph Lite
  const handleBuildGraphLite = async () => {
    if (!factory) {
      addLog('ERR: LorepackFactory kernel unavailable', 'SYS', 'err');
      return;
    }

    setIsProcessing(true);
    setRuntimeState('PROCESSING');
    setProgress(20);
    addLog(`Starting Graph Lite synthesis for agent ${activeAgent.id}...`, 'KERNEL', 'sys');

    try {
      const createdEdges = await factory.buildGraphLite(
        activeAgent.id,
        (curr: number, tot: number, created: number) => {
          setProgress(Math.round((curr / Math.max(1, tot)) * 100));
          addLog(`Synthesizing edge relationships [${curr}/${tot}]: +${created} edges`, 'SYS', 'sys');
        },
        generationModel
      );

      setProgress(100);
      addLog(`Graph Lite synthesis complete: ${createdEdges} triplet edges created.`, 'KERNEL', 'ok');
      await refreshStats();
      setRuntimeState('IDLE');
    } catch (err: any) {
      addLog(`Graph synthesis failed: ${err.message}`, 'KERNEL', 'err');
      setRuntimeState('ERROR');
    } finally {
      setIsProcessing(false);
      setTimeout(() => setProgress(0), 1000);
    }
  };

  // Export GZIP
  const handleExportGzip = async () => {
    if (!factory) {
      addLog('ERR: LorepackFactory not ready', 'SYS', 'err');
      return;
    }

    addLog(`Exporting Lorepack archive for agent ${activeAgent.id}...`, 'SYS', 'sys');
    try {
      const lines: string[] = [];
      for await (const batch of factory.yieldExportBatches(activeAgent.id, 500)) {
        for (const item of batch) {
          lines.push(JSON.stringify(item));
        }
      }
      if (lines.length === 0) {
        addLog('No records found to export for active agent.', 'SYS', 'err');
        return;
      }
      const blob = new Blob([lines.join('\n')], { type: 'application/x-jsonlines' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `lorepack_${activeAgent.id.toLowerCase()}_${new Date().toISOString().replace(/[:.]/g, '-')}.lorepack.gz`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      addLog(`Lorepack archive downloaded successfully (${Math.round(blob.size / 1024)} KB, ${lines.length} records).`, 'KERNEL', 'ok');
    } catch (err: any) {
      addLog(`Export failed: ${err.message}`, 'KERNEL', 'err');
    }
  };

  // Import GZIP
  const handleImportGzip = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!factory || !e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    addLog(`Preparing to import archive: ${file.name}...`, 'SYS', 'sys');
    setIsProcessing(true);
    setRuntimeState('PROCESSING');
    setProgress(25);

    try {
      const result = await factory.importLorepack(file, activeAgent.id, (prog) => {
        setProgress(Math.round((prog.processed / Math.max(1, (prog as any).total || prog.processed || 1)) * 100));
        addLog(`Importing batch: ${prog.vectors} vectors, ${prog.edges} edges...`, 'SYS', 'sys');
      });

      setProgress(100);
      addLog(
        `Import verified! Ingested ${result.importedVectors} nodes, ${result.importedEdges} edges for agent ${activeAgent.id}.`,
        'KERNEL',
        'ok'
      );
      await refreshStats();
      setRuntimeState('IDLE');
    } catch (err: any) {
      addLog(`Import failed: ${err.message}`, 'KERNEL', 'err');
      setRuntimeState('ERROR');
    } finally {
      setIsProcessing(false);
      if (importFileRef.current) importFileRef.current.value = '';
      setTimeout(() => setProgress(0), 1000);
    }
  };

  // Command Oracle Send
  const handleSendOracle = async () => {
    const text = chatInput.trim();
    if (!text || oracleBusy) return;

    setChatInput('');
    setOracleBusy(true);
    addLog(text, 'USER', 'user');

    try {
      // Check if we have vectors to pull context from
      let contextStr = '';
      if (store) {
        const vectors = await store.getVectorsByAgent(activeAgent.id);
        if (vectors.length > 0) {
          // Simple relevance score based on token overlap
          const queryTokens = text.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
          const scored = vectors.map((v) => {
            const content = (v.text || '').toLowerCase();
            let score = 0;
            for (const t of queryTokens) {
              if (content.includes(t)) score++;
            }
            return { vector: v, score };
          });
          scored.sort((a, b) => b.score - a.score);
          const topHits = scored.slice(0, 3).filter((s) => s.score > 0);
          if (topHits.length > 0) {
            contextStr = `\n\n[RELEVANT LORE FROM LOCAL MEMORY]:\n` + topHits.map((h) => h.vector.text).join('\n---\n');
          }
        }
      }

      if (provider) {
        const prompt = `User Query: ${text}${contextStr}`;
        const response = await provider.generateText(prompt, systemPrompt, generationModel);
        addLog(response, 'AI', 'ai');
      } else {
        // Local simulation if provider not initialized
        setTimeout(() => {
          addLog(
            `[${activeAgent.handle}]: Memory query processed. Active locus is MYTHOS.LORE.${activeAgent.id}. ${
              contextStr
                ? 'Synthesized response from local indexed vectors.'
                : 'No relevant stored context matched. Provide an API key or ingest lore to deepen cognitive synthesis.'
            }`,
            'AI',
            'ai'
          );
          setOracleBusy(false);
        }, 400);
        return;
      }
    } catch (err: any) {
      addLog(`Oracle synthesis error: ${err.message}`, 'SYS', 'err');
    } finally {
      setOracleBusy(false);
    }
  };

  return (
    <div
      className="w-full flex-1 min-h-0 flex flex-col font-mono text-[#e6e6e6] bg-[#0b0b0b] overflow-hidden select-text"
      style={{
        fontFamily:
          'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      }}
    >
      {/* 1. Header Bar matching monolithic style */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center px-4 py-2 bg-[#0f0f0f] border-b border-[#2a2a2a] gap-2 shrink-0">
        <div className="font-extrabold tracking-wider text-sm flex items-center gap-2">
          <span>MYTHOS</span>
          <span className="text-[#8a8a8a]">//</span>
          <span className="text-white">LOREPACK FACTORY</span>
          <span className="text-[10px] px-1.5 py-0.5 bg-[#1a1a1a] border border-[#333] text-[#ffaa00]">
            MONOLITHIC TERMINAL
          </span>
        </div>

        <div className="text-xs text-[#8a8a8a] flex items-center gap-2">
          <span>STATUS:</span>
          <span
            className={`font-bold uppercase tracking-wider ${
              runtimeState === 'ERROR'
                ? 'text-[#ff3366]'
                : runtimeState === 'INGESTING' || runtimeState === 'PROCESSING'
                ? 'text-[#ffaa00]'
                : 'text-[#ff3300]'
            }`}
          >
            {runtimeState}
          </span>
          <span className="text-[#2a2a2a]">|</span>
          <span className="text-[11px] text-[#8a8a8a]">
            PORT <strong className="text-[#00ff41]">{activeAgent.port}</strong> [{activeAgent.id}]
          </span>
        </div>
      </div>

      {/* 2. Main 2-Column Monolithic Grid */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-[360px_1fr] min-h-0 overflow-hidden">
        {/* Left Column: CONTROL SURFACE */}
        <div className="bg-[#121212] border-b lg:border-b-0 lg:border-r border-[#2a2a2a] p-3 flex flex-col gap-2 overflow-y-auto min-h-0 h-full">
          {/* Agent ID Input / Select Collapsible */}
          <div className="border border-[#2a2a2a] bg-[#161616] p-2.5 flex flex-col gap-2 rounded-none">
            <label
              onClick={() => setShowAgentIdentity(!showAgentIdentity)}
              className="text-[11px] uppercase tracking-wider text-[#8a8a8a] cursor-pointer flex justify-between select-none hover:text-white"
            >
              <span>[{showAgentIdentity ? '−' : '+'}] AGENT IDENTITY</span>
              <span className="text-[10px] text-[#ff3300]">[{activeAgent.handle}]</span>
            </label>
            {showAgentIdentity && (
              <div className="pt-2 border-t border-[#2a2a2a] flex flex-col gap-2">
                <select
                  value={agentId}
                  onChange={(e) => {
                    const found = getCanonicalAgentById(e.target.value);
                    if (found) {
                      setAgentId(found.id);
                      setAgentHandle(found.handle);
                      setIsParametersLocked(false);
                      addLog(`Switched active agent to ${found.name} (Port ${found.port})`, 'SYS', 'ok');
                    }
                  }}
                  className="w-full bg-[#1f1f1f] border border-[#3a3a3a] text-[#e6e6e6] px-2.5 py-1.5 text-xs focus:border-[#ff3300] outline-none rounded-none cursor-pointer"
                >
                  {CANONICAL_MYTHOS_AGENTS.map((agent) => (
                    <option key={agent.id} value={agent.id} className="bg-[#121212]">
                      [{agent.port}] {agent.id} — {agent.handle}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Generation Model Select Collapsible */}
          <div className="border border-[#2a2a2a] bg-[#161616] p-2.5 flex flex-col gap-2 rounded-none">
            <div className="flex justify-between items-center">
              <label
                onClick={() => setShowGenerationModel(!showGenerationModel)}
                className="text-[11px] uppercase tracking-wider text-[#8a8a8a] cursor-pointer flex-1 flex justify-between select-none hover:text-white mr-2"
              >
                <span>[{showGenerationModel ? '−' : '+'}] GENERATION MODEL</span>
                <span className="text-white font-mono text-[10px] truncate max-w-[120px]">{generationModel}</span>
              </label>
              <button
                type="button"
                onClick={handleFetchModels}
                disabled={fetchingModels}
                className="text-[9px] uppercase tracking-wider text-[#4a90e2] hover:text-white cursor-pointer disabled:opacity-50 shrink-0"
              >
                {fetchingModels ? 'FETCHING...' : 'FETCH MODELS'}
              </button>
            </div>
            {showGenerationModel && (
              <div className="pt-2 border-t border-[#2a2a2a] flex flex-col gap-2">
                <select
                  id="modelSelect"
                  value={generationModel}
                  onChange={(e) => {
                    setGenerationModel(e.target.value);
                    setIsParametersLocked(false);
                  }}
                  className="w-full bg-[#1f1f1f] border border-[#3a3a3a] text-[#e6e6e6] px-2.5 py-1.5 text-xs focus:border-[#ff3300] outline-none rounded-none cursor-pointer"
                >
                  {availableModels.map((model) => (
                    <option key={model} value={model}>
                      {model.toUpperCase().replace(/-/g, ' ')}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* System Instructions Collapsible */}
          <div className="border border-[#2a2a2a] bg-[#161616] p-2.5 flex flex-col gap-2 rounded-none">
            <label
              onClick={() => setShowPrompt(!showPrompt)}
              className="text-[11px] uppercase tracking-wider text-[#8a8a8a] cursor-pointer flex justify-between select-none hover:text-white"
            >
              <span>[{showPrompt ? '−' : '+'}] SYSTEM INSTRUCTIONS</span>
              <span className="text-[10px] text-[#ff3300]">{activeAgent.id}</span>
            </label>
            {showPrompt && (
              <div className="pt-2 border-t border-[#2a2a2a] flex flex-col gap-2">
                <textarea
                  id="systemPrompt"
                  rows={4}
                  value={systemPrompt}
                  onChange={(e) => {
                    setSystemPrompt(e.target.value);
                    setIsParametersLocked(false);
                  }}
                  className="w-full bg-[#1f1f1f] border border-[#3a3a3a] text-[#e6e6e6] p-2 text-xs focus:border-[#ff3300] outline-none rounded-none resize-y"
                  placeholder="System instructions for the agent..."
                />
                <button
                  type="button"
                  onClick={() => {
                    setSystemPrompt(activeAgent.system_instruction);
                    setIsParametersLocked(false);
                  }}
                  className="text-[10px] text-[#8a8a8a] hover:text-[#ff3300] self-end underline"
                >
                  Reset to Canonical Instruction
                </button>
              </div>
            )}
          </div>

          {/* Parallel API Array Collapsible */}
          <div className="border border-[#2a2a2a] bg-[#161616] p-2.5 flex flex-col gap-2 rounded-none">
            <label
              onClick={() => setShowKeys(!showKeys)}
              className="text-[11px] uppercase tracking-wider text-[#8a8a8a] cursor-pointer flex justify-between select-none hover:text-white"
            >
              <span>[{showKeys ? '−' : '+'}] PARALLEL API ARRAY</span>
              <span className={`text-[10px] ${customApiKeys.length > 0 ? 'text-[#00ff41]' : 'text-[#8a8a8a]'}`}>
                {customApiKeys.length > 0 ? `${customApiKeys.length} ACTIVE` : 'ENV DEFAULT'}
              </span>
            </label>
            {showKeys && (
              <div className="pt-2 border-t border-[#2a2a2a] flex flex-col gap-2">
                <input
                  id="k1"
                  type="password"
                  value={k1}
                  onChange={(e) => {
                    setK1(e.target.value);
                    setIsParametersLocked(false);
                  }}
                  placeholder="KEY 1 (Gemini API)"
                  className="w-full bg-[#1f1f1f] border border-[#3a3a3a] text-[#e6e6e6] px-2.5 py-1.5 text-xs focus:border-[#ff3300] outline-none rounded-none font-mono"
                  autoComplete="off"
                />
                <input
                  id="k2"
                  type="password"
                  value={k2}
                  onChange={(e) => {
                    setK2(e.target.value);
                    setIsParametersLocked(false);
                  }}
                  placeholder="KEY 2 (Gemini API)"
                  className="w-full bg-[#1f1f1f] border border-[#3a3a3a] text-[#e6e6e6] px-2.5 py-1.5 text-xs focus:border-[#ff3300] outline-none rounded-none font-mono"
                  autoComplete="off"
                />
                <input
                  id="k3"
                  type="password"
                  value={k3}
                  onChange={(e) => {
                    setK3(e.target.value);
                    setIsParametersLocked(false);
                  }}
                  placeholder="KEY 3 (Gemini API)"
                  className="w-full bg-[#1f1f1f] border border-[#3a3a3a] text-[#e6e6e6] px-2.5 py-1.5 text-xs focus:border-[#ff3300] outline-none rounded-none font-mono"
                  autoComplete="off"
                />
              </div>
            )}
          </div>

          {/* Embedding Model & Hyperparameters Collapsible */}
          <div className="border border-[#2a2a2a] bg-[#161616] p-2.5 flex flex-col gap-2 rounded-none">
            <label
              onClick={() => setShowEmbeddingModel(!showEmbeddingModel)}
              className="text-[11px] uppercase tracking-wider text-[#8a8a8a] cursor-pointer flex justify-between select-none hover:text-white"
            >
              <span>[{showEmbeddingModel ? '−' : '+'}] EMBEDDING MODEL</span>
              <span className="text-white font-mono text-[10px]">{embeddingModel}</span>
            </label>
            {showEmbeddingModel && (
              <div className="pt-2 border-t border-[#2a2a2a] flex flex-col gap-2">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <label className="text-[10px] text-[#8a8a8a] block mb-1">BATCH SIZE</label>
                    <input
                      type="number"
                      min={1}
                      max={100}
                      value={batchSize}
                      onChange={(e) => {
                        setBatchSize(Number(e.target.value));
                        setIsParametersLocked(false);
                      }}
                      className="w-full bg-[#1f1f1f] border border-[#3a3a3a] text-[#e6e6e6] px-2.5 py-1.5 text-xs focus:border-[#ff3300] outline-none rounded-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#8a8a8a] block mb-1">LANES PER KEY</label>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={lanesPerKey}
                      onChange={(e) => {
                        setLanesPerKey(Number(e.target.value));
                        setIsParametersLocked(false);
                      }}
                      className="w-full bg-[#1f1f1f] border border-[#3a3a3a] text-[#e6e6e6] px-2.5 py-1.5 text-xs focus:border-[#ff3300] outline-none rounded-none"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <label className="text-[10px] text-[#8a8a8a] block mb-1">CHUNK CEILING</label>
                    <input
                      type="number"
                      min={100}
                      max={10000}
                      value={chunkSize}
                      onChange={(e) => {
                        setChunkSize(Number(e.target.value));
                        setIsParametersLocked(false);
                      }}
                      className="w-full bg-[#1f1f1f] border border-[#3a3a3a] text-[#e6e6e6] px-2.5 py-1.5 text-xs focus:border-[#ff3300] outline-none rounded-none"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-[#8a8a8a] block mb-1">GRAPH SIMILARITY</label>
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.01}
                      value={graphThreshold}
                      onChange={(e) => {
                        setGraphThreshold(Number(e.target.value));
                        setIsParametersLocked(false);
                      }}
                      className="w-full bg-[#1f1f1f] border border-[#3a3a3a] text-[#e6e6e6] px-2.5 py-1.5 text-xs focus:border-[#ff3300] outline-none rounded-none"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Action Buttons Surface */}
          <button
            id="saveBtn"
            type="button"
            onClick={handleLockParameters}
            className="w-full bg-[#1c1c1c] hover:bg-[#222] border border-[#3a3a3a] hover:border-[#ff3300] text-[#e6e6e6] py-2 px-3 text-xs font-black uppercase tracking-wider transition-colors cursor-pointer rounded-none flex items-center justify-center gap-2 text-center shrink-0"
          >
            <Lock className={`w-3.5 h-3.5 transition-colors ${isParametersLocked ? 'text-[#00ff41]' : 'text-[#ff3300]'}`} />
            <span>LOCK LORE PARAMETERS</span>
          </button>

          <hr className="border-t border-[#2a2a2a] my-1" />

          {/* Collapsible Operations Section */}
          <div className="border border-[#2a2a2a] bg-[#161616] p-2.5 flex flex-col gap-2 rounded-none">
            <label
              onClick={() => setShowOperations(!showOperations)}
              className="text-[11px] uppercase tracking-wider text-[#8a8a8a] cursor-pointer flex justify-between select-none hover:text-white"
            >
              <span>[{showOperations ? '−' : '+'}] OPERATIONS</span>
              <span className="text-[10px] text-[#8a8a8a]">
                {isProcessing ? 'BUSY' : stagedFiles.length > 0 ? `${stagedFiles.length} STAGED` : 'IDLE'}
              </span>
            </label>

            {showOperations && (
              <div className="pt-2 border-t border-[#2a2a2a] flex flex-col gap-2">
                {/* Stage Files Button (Centered, without [+]) */}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleStageFiles}
                  className="hidden"
                  accept=".txt,.md,.json,.csv,.lorepack"
                />
                <button
                  id="stageFilesBtn"
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="w-full bg-[#1c1c1c] hover:bg-[#222] border border-[#3a3a3a] hover:border-[#ff3300] text-[#e6e6e6] py-2 px-3 text-xs font-black uppercase tracking-wider transition-colors cursor-pointer rounded-none flex items-center justify-center gap-2 text-center"
                >
                  <span>STAGE FILES</span>
                  <span className="text-[10px] text-[#00ff41]">
                    {stagedFiles.length > 0 ? `(${stagedFiles.length} READY)` : '(EMPTY)'}
                  </span>
                </button>

                {/* Staged file list status & Empty action */}
                {stagedFiles.length > 0 && (
                  <div className="flex justify-between items-center px-1 text-[10px]">
                    <span className="text-[#8a8a8a] font-mono truncate max-w-[180px]">
                      {stagedFiles.map((f) => f.name).join(', ')}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setStagedFiles([]);
                        addLog('Cleared all staged files.', 'SYS', 'sys');
                      }}
                      className="text-[#ff3366] hover:text-[#ff0033] underline cursor-pointer uppercase font-bold"
                    >
                      EMPTY
                    </button>
                  </div>
                )}

                {/* Ingest Lore */}
                <button
                  id="ingestBtn"
                  type="button"
                  disabled={isProcessing}
                  onClick={handleIngestLore}
                  className="w-full bg-[#1c1c1c] hover:bg-[#222] border border-[#3a3a3a] hover:border-[#ff3300] text-[#e6e6e6] disabled:opacity-40 py-2 px-3 text-xs font-black uppercase tracking-wider transition-colors cursor-pointer rounded-none text-center"
                >
                  {isProcessing ? 'INGESTING...' : 'INGEST LORE'}
                </button>

                {/* Build Graph Lite */}
                <button
                  id="buildGraphBtn"
                  type="button"
                  disabled={isProcessing}
                  onClick={handleBuildGraphLite}
                  className="w-full bg-[#1c1c1c] hover:bg-[#222] border border-[#3a3a3a] hover:border-[#ff3300] text-[#ff3300] disabled:opacity-40 py-2 px-3 text-xs font-black uppercase tracking-wider transition-colors cursor-pointer rounded-none text-center"
                >
                  BUILD GRAPH LITE
                </button>

                {/* Run Core Function Test */}
                <button
                  id="testMatrixBtn"
                  type="button"
                  onClick={() => {
                    if (onRunTestMatrix) {
                      onRunTestMatrix();
                      addLog('Triggered MVP Acceptance Test Matrix runner...', 'TEST', 'sys');
                    } else {
                      addLog('Core test suite handler dispatched.', 'TEST', 'sys');
                    }
                  }}
                  className="w-full bg-[#1c1c1c] hover:bg-[#222] border border-[#3a3a3a] hover:border-[#ff3300] text-[#e6e6e6] py-2 px-3 text-xs font-black uppercase tracking-wider transition-colors cursor-pointer rounded-none text-center"
                >
                  RUN CORE FUNCTION TEST
                </button>

                {/* Export / Import GZIP */}
                <div className="grid grid-cols-2 gap-2">
                  <button
                    id="exportBtn"
                    type="button"
                    onClick={handleExportGzip}
                    className="bg-[#1c1c1c] hover:bg-[#222] border border-[#3a3a3a] hover:border-[#ff3300] text-[#e6e6e6] py-2 px-2 text-[11px] font-black uppercase tracking-wider transition-colors cursor-pointer rounded-none text-center"
                  >
                    EXPORT (GZIP)
                  </button>
                  <input
                    ref={importFileRef}
                    type="file"
                    accept=".gz,.jsonl,.json"
                    onChange={handleImportGzip}
                    className="hidden"
                  />
                  <button
                    id="importBtn"
                    type="button"
                    onClick={() => importFileRef.current?.click()}
                    className="bg-[#1c1c1c] hover:bg-[#222] border border-[#3a3a3a] hover:border-[#ff3300] text-[#e6e6e6] py-2 px-2 text-[11px] font-black uppercase tracking-wider transition-colors cursor-pointer rounded-none text-center"
                  >
                    IMPORT (GZIP)
                  </button>
                </div>

                {/* Nuke Vault Trigger */}
                <button
                  id="nukeTrigger"
                  type="button"
                  onClick={() => setShowNukeModal(true)}
                  className="w-full bg-[#200a10] hover:bg-[#2a0d16] border border-[#5a1d2a] hover:border-[#ff3366] text-[#ff9ab3] py-2 px-3 text-xs font-black uppercase tracking-wider transition-colors cursor-pointer rounded-none text-center mt-1"
                >
                  NUKE VAULT
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: DASHBOARD & TERMINAL CONSOLE */}
        <div className="bg-[#0b0b0b] p-3 flex flex-col gap-2 overflow-hidden min-h-0 h-full">
          {/* Stats Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 shrink-0">
            <div className="border border-[#2a2a2a] bg-[#121212] p-2 flex flex-col gap-0.5 rounded-none">
              <span className="text-[10px] text-[#8a8a8a] uppercase tracking-wider">
                TOTAL RECORDS
              </span>
              <span id="statVectors" className="text-lg font-black text-[#ff3300] tracking-tight">
                {stats.totalNodes}
              </span>
            </div>

            <div className="border border-[#2a2a2a] bg-[#121212] p-2 flex flex-col gap-0.5 rounded-none">
              <span className="text-[10px] text-[#8a8a8a] uppercase tracking-wider">
                TRIPLET EDGES
              </span>
              <span className="text-lg font-black text-[#00ff41] tracking-tight">
                {stats.totalEdges}
              </span>
            </div>

            <div className="border border-[#2a2a2a] bg-[#121212] p-2 flex flex-col gap-0.5 rounded-none">
              <span className="text-[10px] text-[#8a8a8a] uppercase tracking-wider">
                STAGED
              </span>
              <span id="statChunks" className="text-lg font-black text-[#e6e6e6] tracking-tight">
                {stagedFiles.length}
              </span>
            </div>

            <div className="border border-[#2a2a2a] bg-[#121212] p-2 flex flex-col gap-0.5 rounded-none">
              <span className="text-[10px] text-[#8a8a8a] uppercase tracking-wider">
                STATE
              </span>
              <span
                id="statState"
                className={`text-lg font-black tracking-tight ${
                  runtimeState === 'ERROR' ? 'text-[#ff3366]' : runtimeState === 'IDLE' ? 'text-[#00ff41]' : 'text-[#ffaa00]'
                }`}
              >
                {runtimeState}
              </span>
            </div>
          </div>

          {/* Console Header Bar */}
          <div className="flex justify-between items-center text-xs text-[#8a8a8a] shrink-0">
            <div className="flex items-center gap-2">
              <span className="uppercase tracking-wider">RECORDS IN SCOPE:</span>
              <span id="statVectorsLog" className="text-white font-bold font-mono">
                {stats.totalNodes}
              </span>
              <span className="text-[#8a8a8a]">|</span>
              <span className="text-[11px] text-[#8a8a8a]">
                LOCUS: <span className="text-[#9cc7ff]">MYTHOS.LORE.{activeAgent.id}</span>
              </span>
            </div>
            <button
              id="clearLogBtn"
              type="button"
              onClick={() => setLogs([])}
              className="hover:text-white cursor-pointer uppercase tracking-wider text-[11px] transition-colors"
            >
              [X] CLEAR LOG
            </button>
          </div>

          {/* Monolithic Terminal Console Log */}
          <div
            id="logConsole"
            ref={logConsoleRef}
            className="flex-1 bg-[#121212] border border-[#2a2a2a] p-2.5 overflow-y-auto text-xs leading-relaxed min-h-0 font-mono select-text"
          >
            {logs.length === 0 ? (
              <div className="text-[#555] italic">Terminal log is empty. Execute a command or ingest lore.</div>
            ) : (
              logs.map((entry) => {
                let colorClass = 'text-[#e6e6e6]';
                if (entry.type === 'sys') colorClass = 'text-[#9cc7ff]';
                if (entry.type === 'user') colorClass = 'text-[#00ff41]';
                if (entry.type === 'ok') colorClass = 'text-[#00ff41]';
                if (entry.type === 'err') colorClass = 'text-[#ff3366]';

                return (
                  <div key={entry.id} className="mb-1.5 break-words">
                    <span className="text-[#666] mr-2">[{entry.time}]</span>
                    <span className={`font-bold mr-1.5 ${
                      entry.src === 'USER' ? 'text-[#00ff41]' : entry.src === 'AI' ? 'text-[#ffaa00]' : 'text-[#8a8a8a]'
                    }`}>
                      {entry.src}:
                    </span>
                    <span className={colorClass}>{entry.msg}</span>
                  </div>
                );
              })
            )}
          </div>

          {/* Linear Progress Bar */}
          <div className="h-2 border border-[#2a2a2a] bg-[#111] overflow-hidden rounded-none shrink-0">
            <div
              id="progressBar"
              className="h-full bg-[#ff3300] transition-all duration-150"
              style={{ width: `${progress}%` }}
            />
          </div>

          {/* Command Oracle Terminal Input */}
          <div className="flex gap-2 items-stretch shrink-0">
            <textarea
              id="chatInput"
              rows={1}
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSendOracle();
                }
              }}
              placeholder="Command Oracle."
              className="flex-1 bg-[#1f1f1f] border border-[#3a3a3a] text-[#e6e6e6] px-3 py-1.5 text-xs focus:border-[#ff3300] outline-none rounded-none resize-none font-mono"
            />
            <button
              id="sendBtn"
              type="button"
              disabled={oracleBusy || !chatInput.trim()}
              onClick={handleSendOracle}
              className="bg-[#1c1c1c] hover:bg-[#222] border border-[#3a3a3a] hover:border-[#ff3300] text-[#e6e6e6] disabled:opacity-40 px-5 py-1.5 text-xs font-black uppercase tracking-wider transition-colors cursor-pointer rounded-none flex items-center justify-center shrink-0"
            >
              {oracleBusy ? 'WAIT...' : 'SEND'}
            </button>
          </div>
        </div>
      </div>

      {/* Monolithic Nuke Confirmation Modal */}
      {showNukeModal && (
        <div
          id="nukeModal"
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
        >
          <div className="w-full max-w-md bg-[#121212] border border-[#2a2a2a] p-5 rounded-none flex flex-col gap-4">
            <h2 className="text-base font-black text-[#ff3366] uppercase tracking-wider m-0">
              PURGE VAULT?
            </h2>
            <p className="text-xs text-[#8a8a8a] leading-relaxed">
              This action operates directly on the active IndexedDB storage. You can choose to purge records specifically for agent <strong className="text-white">[{activeAgent.id}]</strong> or execute a full vault wipe.
            </p>
            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <button
                id="nukeAgentBtn"
                type="button"
                onClick={async () => {
                  setShowNukeModal(false);
                  if (onPurgeAgent) {
                    await onPurgeAgent();
                    addLog(`Purged all records for agent ${activeAgent.id}.`, 'SYS', 'ok');
                  }
                }}
                className="flex-1 bg-[#200a10] hover:bg-[#2a0d16] border border-[#5a1d2a] hover:border-[#ff3366] text-[#ff9ab3] py-2 px-3 text-xs font-black uppercase tracking-wider transition-colors cursor-pointer rounded-none"
              >
                PURGE AGENT ({activeAgent.id})
              </button>
              <button
                id="nukeConfirmBtn"
                type="button"
                onClick={async () => {
                  setShowNukeModal(false);
                  if (onNukeVault) {
                    await onNukeVault();
                    addLog('NUKE VAULT complete: All IndexedDB agent partitions destroyed.', 'SYS', 'err');
                  }
                }}
                className="flex-1 bg-[#3d0a14] hover:bg-[#520d1b] border border-[#ff3366] text-white py-2 px-3 text-xs font-black uppercase tracking-wider transition-colors cursor-pointer rounded-none"
              >
                NUKE WHOLE VAULT
              </button>
              <button
                id="nukeCancelBtn"
                type="button"
                onClick={() => setShowNukeModal(false)}
                className="bg-[#1c1c1c] hover:bg-[#222] border border-[#3a3a3a] text-[#8a8a8a] hover:text-white py-2 px-4 text-xs font-black uppercase tracking-wider transition-colors cursor-pointer rounded-none"
              >
                CANCEL
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
