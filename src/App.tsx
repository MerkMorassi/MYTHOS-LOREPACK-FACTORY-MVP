/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */
import React, { useEffect, useState, useRef } from 'react';
import { LorepackFactory } from './lorepack-factory.ts';
import { IndexedDbLorepackStore } from './indexeddb-store.ts';
import { GeminiProvider } from './providers/gemini-provider.ts';
import type { VectorRecord, TripletEdge } from './types.ts';
import { 
  Terminal, 
  Database, 
  Cpu, 
  Network, 
  Download, 
  Upload, 
  Play, 
  MessageSquare, 
  Layers, 
  FileText, 
  RefreshCw, 
  AlertTriangle, 
  CheckCircle,
  HelpCircle,
  FileDown
} from 'lucide-react';

export default function App() {
  // Core Engine References
  const [factory, setFactory] = useState<LorepackFactory | null>(null);
  const [store, setStore] = useState<IndexedDbLorepackStore | null>(null);

  // Connection & Core Telemetry States
  const [dbState, setDbState] = useState<'DISCONNECTED' | 'CONNECTED' | 'ERROR'>('DISCONNECTED');
  const [apiState, setApiState] = useState<'UNTESTED' | 'ONLINE' | 'ERROR'>('UNTESTED');
  const [systemLog, setSystemLog] = useState<string[]>(['[SYSTEM]: Booting MythOS memory system...']);
  
  // Selection
  const [agentId, setAgentId] = useState<string>('AGENT_SIGMA');
  const [agentHandle, setAgentHandle] = useState<string>('sigma');
  const [stats, setStats] = useState<{ totalNodes: number; totalEdges: number }>({ totalNodes: 0, totalEdges: 0 });

  // Single Text File Intake States
  const txtFileInputRef = useRef<HTMLInputElement>(null);
  const [loadedFileName, setLoadedFileName] = useState<string>('');
  const [loadedFileSize, setLoadedFileSize] = useState<number>(0);

  // Ingestion Panel States
  const [sourceText, setSourceText] = useState<string>(
    'The Galactic Council established a diplomatic outpost on Mars. Ambassador Lin secured a treaty for mining rights.'
  );
  const [sourceId, setSourceId] = useState<string>('manual-terminal-input');
  const [chunkSize, setChunkSize] = useState<number>(200);
  const [ingestProgress, setIngestProgress] = useState<{ processed: number; total: number; active: boolean }>({
    processed: 0,
    total: 0,
    active: false,
  });

  // Result Metrics for Single File Run
  const [lastRunResults, setLastRunResults] = useState<{
    sourceFilename: string;
    chunksCount: number;
    vectorsCount: number;
    vectorDimension: number;
    edgesCount: number;
    error: string | null;
  } | null>(null);

  // Import Verification Metrics Panel
  const [lastImportResults, setLastImportResults] = useState<{
    fileName: string;
    vectorsCount: number;
    vectorDimension: number;
    edgesCount: number;
    relationships: string[];
    metadata: string;
  } | null>(null);

  // Chat Log Panel States
  const [userChatText, setUserChatText] = useState<string>('What is the coordinates for sector 4?');
  const [modelChatText, setModelChatText] = useState<string>('Sector 4 coordinates are mapped to [45, -122].');
  const [chatLogging, setChatLogging] = useState<boolean>(false);

  // Graph Synthesizer States
  const [graphProgress, setGraphProgress] = useState<{
    current: number;
    total: number;
    created: number;
    active: boolean;
  }>({ current: 0, total: 0, created: 0, active: false });

  // File Import / Export States
  const [importProgress, setImportProgress] = useState<{
    processed: number;
    vectors: number;
    edges: number;
    active: boolean;
  }>({ processed: 0, vectors: 0, edges: 0, active: false });
  const [exporting, setExporting] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Database Explorer States
  const [exploreTab, setExploreTab] = useState<'NODES' | 'EDGES'>('NODES');
  const [nodesList, setNodesList] = useState<VectorRecord[]>([]);
  const [edgesList, setEdgesList] = useState<TripletEdge[]>([]);
  const [selectedRecord, setSelectedRecord] = useState<any | null>(null);

  // Setup logging helper
  const log = (msg: string) => {
    const timestamp = new Date().toLocaleTimeString();
    setSystemLog((prev) => [`[${timestamp}] ${msg}`, ...prev.slice(0, 49)]);
  };

  // 1. Initialize Engine on Mount
  useEffect(() => {
    async function bootEngine() {
      try {
        const localStore = new IndexedDbLorepackStore();
        setStore(localStore);
        setDbState('CONNECTED');
        log('[SYSTEM]: Local IndexedDB memory store successfully mapped.');

        const provider = new GeminiProvider();
        // Test API health immediately
        try {
          const healthRes = await fetch('/api/health');
          if (healthRes.ok) {
            setApiState('ONLINE');
            log('[SYSTEM]: Secure Gemini backend connection authenticated.');
          } else {
            setApiState('ERROR');
            log('[ERROR]: Gemini backend API is unresponsive.');
          }
        } catch {
          setApiState('ERROR');
          log('[ERROR]: Backend connection refused.');
        }

        const f = new LorepackFactory(localStore, provider);
        setFactory(f);
        
        // Load initial stats
        const currentStats = await f.getStats(agentId);
        setStats(currentStats);
        log(`[SYSTEM]: Memory engine initialized for workspace: ${agentId}`);
      } catch (err: any) {
        setDbState('ERROR');
        log(`[CRITICAL]: Failed to map memory layout: ${err.message || err}`);
      }
    }
    bootEngine();
  }, [agentId]);

  // 2. Fetch explorer views when agentId or tabs change
  const refreshExplorer = async () => {
    if (!store) return;
    try {
      const [v, e] = await Promise.all([
        store.getVectorsByAgent(agentId),
        store.getTripletEdgesByAgent(agentId.toUpperCase())
      ]);
      setNodesList(v);
      setEdgesList(e);
      if (factory) {
        const currentStats = await factory.getStats(agentId);
        setStats(currentStats);
      }
    } catch (err: any) {
      log(`[ERROR]: Explorer read failure: ${err.message}`);
    }
  };

  useEffect(() => {
    refreshExplorer();
  }, [agentId, exploreTab, store]);

  // Load single local txt document
  const handleTxtFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    setLoadedFileName(file.name);
    setLoadedFileSize(file.size);
    setSourceId(file.name);

    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setSourceText(text);
      log(`[FILE]: Uploaded ${file.name} successfully. Size: ${file.size} bytes.`);
    };
    reader.readAsText(file);
  };

  // 3. Handle Text Ingestion Flow
  const handleIngestText = async () => {
    if (!factory) return;
    setIngestProgress({ processed: 0, total: 0, active: true });
    log('[INGEST]: Slicing raw data payloads into localized memory blocks...');

    try {
      const chunks = factory.chunk(sourceText, chunkSize);
      log(`[INGEST]: Formed ${chunks.length} memory blocks. Connecting embeddings vector pipeline...`);

      const batches = chunks.map((chunkText) => ({
        text: chunkText,
        source: sourceId || 'UNKNOWN'
      }));

      setIngestProgress({ processed: 0, total: batches.length, active: true });

      const result = await factory.ingestBatches(batches, {
        agentId,
        onProgress: (p) => {
          setIngestProgress({ processed: p.processed, total: batches.length, active: true });
          log(`[INGEST]: Vector embeddings generated: ${p.processed}/${batches.length}`);
        }
      });

      // Query database to inspect vector dimension dynamically from the first record
      let dimension = 768; // Default fallback
      if (store) {
        const currentNodes = await store.getVectorsByAgent(agentId);
        const match = currentNodes.find(node => node.source === sourceId);
        if (match && Array.isArray(match.vector)) {
          dimension = match.vector.length;
        }
      }

      setLastRunResults({
        sourceFilename: sourceId || 'manual-terminal-input',
        chunksCount: chunks.length,
        vectorsCount: result.ingested,
        vectorDimension: dimension,
        edgesCount: 0,
        error: null,
      });

      log(`[INGEST]: Success. Saved ${result.ingested} node vectors to IndexedDB.`);
      await refreshExplorer();
    } catch (err: any) {
      log(`[INGEST_ERROR]: Processing halted: ${err.message || err}`);
      setLastRunResults((prev) => ({
        sourceFilename: sourceId || 'manual-terminal-input',
        chunksCount: 0,
        vectorsCount: 0,
        vectorDimension: 0,
        edgesCount: 0,
        error: err.message || String(err),
      }));
    } finally {
      setIngestProgress((prev) => ({ ...prev, active: false }));
    }
  };

  // 4. Handle Conversational Log Ingest
  const handleIngestChatTurn = async () => {
    if (!factory) return;
    setChatLogging(true);
    log('[CONVERSE]: Synthesizing turn logs into persistent conversation embedding...');
    try {
      await factory.ingestConversationalTurn(agentId, agentHandle, userChatText, modelChatText);
      log('[CONVERSE]: Saved conversational turn. Linked vectors saved to local storage.');
      setUserChatText('');
      setModelChatText('');
      await refreshExplorer();
    } catch (err: any) {
      log(`[CONVERSE_ERROR]: Turn logging failed: ${err.message || err}`);
    } finally {
      setChatLogging(false);
    }
  };

  // 5. Handle Graph Construction (Triplet Extraction)
  const handleBuildGraph = async () => {
    if (!factory) return;
    setGraphProgress({ current: 0, total: 0, created: 0, active: true });
    log('[GRAPH]: Extracting semantic edge matrices via structured language processing...');

    try {
      const nodes = await store?.getVectorsByAgent(agentId) || [];
      if (nodes.length === 0) {
        log('[GRAPH_ERROR]: Aborted. Active agent space has 0 nodes. Ingest text first.');
        setGraphProgress({ current: 0, total: 0, created: 0, active: false });
        return;
      }

      setGraphProgress({ current: 0, total: nodes.length, created: 0, active: true });

      const count = await factory.buildGraphLite(agentId, (current, total, created) => {
        setGraphProgress({ current, total, created, active: true });
        log(`[GRAPH]: Synthesis progress: ${current}/${total} nodes completed. Found ${created} edges.`);
      });

      setLastRunResults((prev) => {
        if (!prev) return null;
        return {
          ...prev,
          edgesCount: count,
        };
      });

      log(`[GRAPH]: Success. Integrated ${count} custom relationship edges into the agent's semantic graph.`);
      await refreshExplorer();
    } catch (err: any) {
      log(`[GRAPH_ERROR]: Triplets extraction terminated: ${err.message || err}`);
    } finally {
      setGraphProgress((prev) => ({ ...prev, active: false }));
    }
  };

  // 6. Handle Export Sequence
  const handleExportLorepack = async () => {
    if (!factory) return;
    setExporting(true);
    log('[EXPORT]: Compiling local database records to JSONL stream format...');
    try {
      let exportLines: string[] = [];
      const batchGenerator = factory.yieldExportBatches(agentId, 500);

      for await (const batch of batchGenerator) {
        for (const item of batch) {
          exportLines.push(JSON.stringify(item));
        }
      }

      if (exportLines.length === 0) {
        log('[EXPORT_ERROR]: Memory layout is empty. Nothing to extract.');
        setExporting(false);
        return;
      }

      const fileBlob = new Blob([exportLines.join('\n')], { type: 'application/x-jsonlines' });
      const url = URL.createObjectURL(fileBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${agentId.toLowerCase()}_lorepack_${Date.now()}.jsonl`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      log(`[EXPORT]: Success. Extracted ${exportLines.length} blocks to external Lorepack.`);
    } catch (err: any) {
      log(`[EXPORT_ERROR]: Stream compilation failed: ${err.message || err}`);
    } finally {
      setExporting(false);
    }
  };

  // 7. Handle Import Sequence
  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!factory || !e.target.files || e.target.files.length === 0) return;
    const file = e.target.files[0];
    setImportProgress({ processed: 0, vectors: 0, edges: 0, active: true });
    setLastImportResults(null);
    log(`[IMPORT]: Reading memory archive: ${file.name}...`);

    try {
      const result = await factory.importLorepack(file, agentId, (p) => {
        setImportProgress({
          processed: p.processed,
          vectors: p.vectors,
          edges: p.edges,
          active: true
        });
      });

      log(`[IMPORT]: Ported memory segment. ${result.importedVectors} vectors, ${result.importedEdges} edges compiled.`);
      await refreshExplorer();

      // Query database to extract and present imported stats and metadata specs directly
      if (store) {
        const currentNodes = await store.getVectorsByAgent(agentId);
        const currentEdges = await store.getTripletEdgesByAgent(agentId.toUpperCase());
        
        let dimension = 0;
        if (currentNodes.length > 0 && Array.isArray(currentNodes[0].vector)) {
          dimension = currentNodes[0].vector.length;
        }

        const relationships = currentEdges.map(edge => `${edge.s} --(${edge.r})--> ${edge.o}`);
        
        setLastImportResults({
          fileName: file.name,
          vectorsCount: currentNodes.length,
          vectorDimension: dimension,
          edgesCount: currentEdges.length,
          relationships: relationships.slice(0, 6),
          metadata: JSON.stringify(currentNodes[0]?.metadata || {}, null, 2),
        });
      }
    } catch (err: any) {
      log(`[IMPORT_ERROR]: Memory restoration halted: ${err.message || err}`);
    } finally {
      setImportProgress({ processed: 0, vectors: 0, edges: 0, active: false });
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Clean whole DB for testing/fresh setup
  const clearAgentMemory = async () => {
    if (!confirm('Are you sure you want to clear ALL local memory store data for the active agent?')) return;
    log(`[SYSTEM]: Wiping local workspace database for ${agentId}...`);
    try {
      if (store) {
        const dbRequest = indexedDB.open('mythos_lorepack', 1);
        dbRequest.onsuccess = () => {
          const db = dbRequest.result;
          const vTx = db.transaction('vectors', 'readwrite');
          const vStore = vTx.objectStore('vectors');
          const vRequest = vStore.index('agentId').openCursor(agentId);
          vRequest.onsuccess = (event: any) => {
            const cursor = event.target.result;
            if (cursor) {
              cursor.delete();
              cursor.continue();
            }
          };
          const eTx = db.transaction('edges', 'readwrite');
          const eStore = eTx.objectStore('edges');
          const eRequest = eStore.index('agentId').openCursor(agentId.toUpperCase());
          eRequest.onsuccess = (event: any) => {
            const cursor = event.target.result;
            if (cursor) {
              cursor.delete();
              cursor.continue();
            }
          };
          
          eTx.oncomplete = async () => {
            log('[SYSTEM]: Local agent memory space successfully cleared.');
            setSelectedRecord(null);
            setLastRunResults(null);
            setLastImportResults(null);
            await refreshExplorer();
          };
        };
      }
    } catch (err: any) {
      log(`[ERROR]: Wipe sequence failed: ${err.message}`);
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-200 font-mono flex flex-col antialiased">
      {/* 1. Terminal Top Banner */}
      <header className="border-b border-neutral-800 bg-neutral-900/95 px-6 py-4 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 sticky top-0 z-50 backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <Terminal className="h-6 w-6 text-emerald-500 animate-pulse" />
          <div>
            <h1 className="text-sm font-bold tracking-wider text-white uppercase flex items-center gap-2">
              MYTHOS LOREPACK ENGINE
              <span className="text-[10px] bg-neutral-800 border border-neutral-700 text-neutral-400 px-1.5 py-0.5 rounded uppercase tracking-widest">v2.1</span>
            </h1>
            <p className="text-[10px] text-neutral-500 mt-0.5 uppercase tracking-wide">
              Secure Local-First Cognitive Storage Terminal
            </p>
          </div>
        </div>

        {/* Global Hardware Status Bars */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Active Workspace Selector */}
          <div className="flex items-center space-x-2 bg-neutral-950 px-2 py-1 border border-neutral-800 rounded">
            <span className="text-[10px] text-neutral-500 font-semibold uppercase">Workspace:</span>
            <select 
              value={agentId} 
              onChange={(e) => {
                setAgentId(e.target.value);
                setAgentHandle(e.target.value.toLowerCase().replace('agent_', ''));
                setSelectedRecord(null);
                setLastRunResults(null);
                setLastImportResults(null);
              }}
              className="bg-transparent text-xs text-white border-none focus:outline-none focus:ring-0 uppercase font-mono cursor-pointer"
            >
              <option value="AGENT_SIGMA" className="bg-neutral-900">AGENT_SIGMA (sigma)</option>
              <option value="AGENT_OMEGA" className="bg-neutral-900">AGENT_OMEGA (omega)</option>
              <option value="AGENT_KRONOS" className="bg-neutral-900">AGENT_KRONOS (kronos)</option>
            </select>
          </div>

          <div className="flex items-center space-x-2 bg-neutral-950 px-3 py-1.5 border border-neutral-800 rounded text-xs">
            <Database className="h-3.5 w-3.5 text-neutral-500" />
            <span className="text-[10px] text-neutral-400">DATABASE:</span>
            <span className={`text-[10px] font-bold ${dbState === 'CONNECTED' ? 'text-emerald-500' : 'text-rose-500'}`}>
              {dbState}
            </span>
          </div>

          <div className="flex items-center space-x-2 bg-neutral-950 px-3 py-1.5 border border-neutral-800 rounded text-xs">
            <Cpu className="h-3.5 w-3.5 text-neutral-500" />
            <span className="text-[10px] text-neutral-400">GEMINI PROVIDER:</span>
            <span className={`text-[10px] font-bold ${apiState === 'ONLINE' ? 'text-emerald-500' : 'text-amber-500'}`}>
              {apiState}
            </span>
          </div>
        </div>
      </header>

      {/* Main Panel Content Grid */}
      <main className="flex-1 p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-7xl mx-auto w-full">
        {/* Left Column (8 cols): Storage, Ingest, Graph operations */}
        <div className="lg:col-span-8 flex flex-col gap-6">
          
          {/* Live Telemetry Overview */}
          <div className="bg-neutral-900 border border-neutral-800 p-4 rounded grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-[10px] text-neutral-500 uppercase tracking-widest">Active Workspace</p>
              <p className="text-sm font-bold text-white mt-1 uppercase tracking-wide">{agentId}</p>
            </div>
            <div>
              <p className="text-[10px] text-neutral-500 uppercase tracking-widest">Vector Nodes (DB)</p>
              <p className="text-sm font-bold text-emerald-500 mt-1">{stats.totalNodes}</p>
            </div>
            <div>
              <p className="text-[10px] text-neutral-500 uppercase tracking-widest">Semantic Edges (DB)</p>
              <p className="text-sm font-bold text-blue-400 mt-1">{stats.totalEdges}</p>
            </div>
            <div>
              <p className="text-[10px] text-neutral-500 uppercase tracking-widest">Operational State</p>
              <p className="text-sm font-bold text-white mt-1 uppercase tracking-wider flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping" />
                STANDBY
              </p>
            </div>
          </div>

          {/* Module A: Source Memory Ingestion Console */}
          <section className="bg-neutral-900 border border-neutral-800 rounded flex flex-col">
            <div className="border-b border-neutral-800 px-4 py-3 flex items-center justify-between bg-neutral-900/60">
              <div className="flex items-center space-x-2">
                <Layers className="h-4 w-4 text-emerald-400" />
                <h2 className="text-xs font-bold text-white uppercase tracking-wider">Memory Chunking & Vector Ingestion</h2>
              </div>
              <span className="text-[10px] text-neutral-500">STG_INBOUND</span>
            </div>

            <div className="p-4 flex flex-col gap-4">
              
              {/* File Intake Selector Block */}
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-neutral-950 border border-neutral-800 p-3.5 rounded">
                <div>
                  <span className="block text-[10px] text-neutral-400 font-bold uppercase tracking-wider mb-1">
                    Single File Source Intake (.txt)
                  </span>
                  {loadedFileName ? (
                    <p className="text-xs text-emerald-400 font-bold truncate">
                      Loaded Document: {loadedFileName} ({loadedFileSize} characters)
                    </p>
                  ) : (
                    <p className="text-xs text-neutral-500">
                      No document loaded. Load a local file or enter raw text.
                    </p>
                  )}
                </div>
                <div>
                  <input
                    type="file"
                    ref={txtFileInputRef}
                    onChange={handleTxtFileChange}
                    accept=".txt"
                    className="hidden"
                  />
                  <button
                    onClick={() => txtFileInputRef.current?.click()}
                    className="bg-neutral-900 border border-neutral-800 text-neutral-300 hover:border-neutral-700 hover:text-white px-3.5 py-1.5 rounded text-xs uppercase tracking-wider font-bold transition-all cursor-pointer"
                  >
                    Select Local Document
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[10px] text-neutral-400 uppercase tracking-wider mb-1.5 font-semibold">
                  Memory Source Payload (RAW TEXT DATA)
                </label>
                <textarea
                  className="w-full h-28 bg-neutral-950 text-neutral-200 border border-neutral-800 p-3 rounded font-mono text-xs focus:outline-none focus:border-neutral-700 resize-none leading-relaxed"
                  value={sourceText}
                  onChange={(e) => setSourceText(e.target.value)}
                  placeholder="Enter bulk factual narratives, articles, or records..."
                />
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-[10px] text-neutral-400 uppercase tracking-wider mb-1 font-semibold">
                    Source Anchor ID
                  </label>
                  <input
                    type="text"
                    value={sourceId}
                    onChange={(e) => setSourceId(e.target.value)}
                    className="w-full bg-neutral-950 text-neutral-200 border border-neutral-800 px-3 py-1.5 rounded font-mono text-xs focus:outline-none focus:border-neutral-700"
                    placeholder="Source Identifier"
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-neutral-400 uppercase tracking-wider mb-1 font-semibold">
                    Chunk Limit Size (chars)
                  </label>
                  <input
                    type="number"
                    value={chunkSize}
                    onChange={(e) => setChunkSize(Number(e.target.value))}
                    className="w-full bg-neutral-950 text-neutral-200 border border-neutral-800 px-3 py-1.5 rounded font-mono text-xs focus:outline-none focus:border-neutral-700"
                    min="50"
                    max="4000"
                  />
                </div>
                <div className="flex items-end">
                  <button
                    onClick={handleIngestText}
                    disabled={ingestProgress.active || !sourceText}
                    className="w-full bg-emerald-950 border border-emerald-800 text-emerald-300 font-bold px-4 py-2 rounded text-xs uppercase tracking-wider hover:bg-emerald-900 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <Play className="h-3 w-3" />
                    Commit Ingest Sequence
                  </button>
                </div>
              </div>

              {/* Ingest Progress bar */}
              {ingestProgress.active && (
                <div className="bg-neutral-950 border border-neutral-800 p-3 rounded">
                  <div className="flex justify-between text-[10px] text-neutral-400 mb-1">
                    <span>GENERATING EMBEDDINGS (GEMINI-EMBEDDING-2-PREVIEW)...</span>
                    <span>{ingestProgress.processed} / {ingestProgress.total}</span>
                  </div>
                  <div className="w-full bg-neutral-900 rounded h-1.5 overflow-hidden">
                    <div 
                      className="bg-emerald-500 h-1.5 transition-all duration-300"
                      style={{ width: `${(ingestProgress.processed / (ingestProgress.total || 1)) * 100}%` }}
                    />
                  </div>
                </div>
              )}

              {/* Ingestion & Synthesis Results Panel */}
              {lastRunResults && (
                <div className="bg-neutral-950 border border-neutral-800 p-4 rounded">
                  <span className="block text-[10px] text-emerald-400 font-bold uppercase tracking-widest mb-2 border-b border-neutral-800 pb-1">
                    &gt;&gt; Ingestion Operational Results Metrics
                  </span>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-4 text-xs">
                    <div>
                      <p className="text-[10px] text-neutral-500 uppercase tracking-wider">Source Identity</p>
                      <p className="font-bold text-white mt-0.5 truncate">{lastRunResults.sourceFilename}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-neutral-500 uppercase tracking-wider">Chunks Generated</p>
                      <p className="font-bold text-emerald-500 mt-0.5">{lastRunResults.chunksCount}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-neutral-500 uppercase tracking-wider">Vectors Stored</p>
                      <p className="font-bold text-emerald-500 mt-0.5">{lastRunResults.vectorsCount}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-neutral-500 uppercase tracking-wider">Vector Dimension</p>
                      <p className="font-bold text-emerald-500 mt-0.5">{lastRunResults.vectorDimension}</p>
                    </div>
                    <div>
                      <p className="text-[10px] text-neutral-500 uppercase tracking-wider">Graph Edges</p>
                      <p className="font-bold text-blue-400 mt-0.5">{lastRunResults.edgesCount}</p>
                    </div>
                  </div>
                  {lastRunResults.error && (
                    <p className="text-xs text-rose-400 mt-3 border-t border-neutral-900 pt-2 uppercase">
                      Error: {lastRunResults.error}
                    </p>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Module B: Conversational Turn Logging */}
          <section className="bg-neutral-900 border border-neutral-800 rounded flex flex-col">
            <div className="border-b border-neutral-800 px-4 py-3 flex items-center justify-between bg-neutral-900/60">
              <div className="flex items-center space-x-2">
                <MessageSquare className="h-4 w-4 text-emerald-400" />
                <h2 className="text-xs font-bold text-white uppercase tracking-wider">Live Conversational Turn Logger</h2>
              </div>
              <span className="text-[10px] text-neutral-500">STG_CHAT</span>
            </div>

            <div className="p-4 flex flex-col gap-3">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] text-neutral-400 uppercase tracking-wider mb-1 font-semibold">
                    User Text Statement
                  </label>
                  <textarea
                    value={userChatText}
                    onChange={(e) => setUserChatText(e.target.value)}
                    className="w-full h-16 bg-neutral-950 text-neutral-200 border border-neutral-800 p-2.5 rounded font-mono text-xs focus:outline-none focus:border-neutral-700 resize-none"
                    placeholder="Enter User Input..."
                  />
                </div>
                <div>
                  <label className="block text-[10px] text-neutral-400 uppercase tracking-wider mb-1 font-semibold">
                    Agent Model Output
                  </label>
                  <textarea
                    value={modelChatText}
                    onChange={(e) => setModelChatText(e.target.value)}
                    className="w-full h-16 bg-neutral-950 text-neutral-200 border border-neutral-800 p-2.5 rounded font-mono text-xs focus:outline-none focus:border-neutral-700 resize-none"
                    placeholder="Enter Agent Output..."
                  />
                </div>
              </div>

              <div className="flex justify-between items-center gap-4 mt-1">
                <p className="text-[9px] text-neutral-500 max-w-md uppercase leading-relaxed">
                  Concats turns as a single cognitive token blocks, embeds, and saves with local-first references.
                </p>
                <button
                  onClick={handleIngestChatTurn}
                  disabled={chatLogging || !userChatText || !modelChatText}
                  className="bg-neutral-950 border border-neutral-800 hover:border-neutral-600 text-neutral-300 font-bold px-4 py-1.5 rounded text-[11px] uppercase tracking-wider hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  {chatLogging ? 'Synthesizing...' : 'Log Chat Segment'}
                </button>
              </div>
            </div>
          </section>

          {/* Module C: Graph Synthesizer (Triple Edge Extraction) */}
          <section className="bg-neutral-900 border border-neutral-800 rounded flex flex-col">
            <div className="border-b border-neutral-800 px-4 py-3 flex items-center justify-between bg-neutral-900/60">
              <div className="flex items-center space-x-2">
                <Network className="h-4 w-4 text-emerald-400" />
                <h2 className="text-xs font-bold text-white uppercase tracking-wider">Semantic Relationship Graph Synthesizer</h2>
              </div>
              <span className="text-[10px] text-neutral-500">STG_SYNTH</span>
            </div>

            <div className="p-4 flex flex-col gap-4">
              <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <div className="max-w-xl">
                  <p className="text-xs text-neutral-300 leading-relaxed">
                    Evaluates all ingested vector nodes for the active workspace, triggers structured language relationship extraction (using <span className="text-blue-400 font-bold font-mono">gemini-3.8-flash</span>) for subjects, actions, and objects, and constructs a robust semantic relationship mesh.
                  </p>
                </div>
                <button
                  onClick={handleBuildGraph}
                  disabled={graphProgress.active}
                  className="w-full md:w-auto bg-blue-950 border border-blue-800 text-blue-300 font-bold px-5 py-2.5 rounded text-xs uppercase tracking-wider hover:bg-blue-900 hover:text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
                >
                  <RefreshCw className={`h-3 w-3 ${graphProgress.active ? 'animate-spin' : ''}`} />
                  Trigger Graph Synthesis
                </button>
              </div>

              {/* Progress Panel */}
              {graphProgress.active && (
                <div className="bg-neutral-950 border border-neutral-800 p-3 rounded">
                  <div className="flex justify-between text-[10px] text-neutral-400 mb-1.5 font-bold">
                    <span>EXTRACTING SEMANTIC TRIPLETS (GEMINI-3.8-FLASH)...</span>
                    <span>{graphProgress.current} / {graphProgress.total} NODES</span>
                  </div>
                  <div className="w-full bg-neutral-900 rounded h-1.5 overflow-hidden mb-2">
                    <div 
                      className="bg-blue-500 h-1.5 transition-all duration-300"
                      style={{ width: `${(graphProgress.current / (graphProgress.total || 1)) * 100}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-blue-400">
                    &gt; Successfully mapped {graphProgress.created} triplet edges thus far. Remaining sequence executing concurrently...
                  </p>
                </div>
              )}
            </div>
          </section>

          {/* Module D: Lorepack Database Explorer */}
          <section className="bg-neutral-900 border border-neutral-800 rounded flex flex-col min-h-[350px]">
            <div className="border-b border-neutral-800 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-neutral-900/60">
              <div className="flex items-center space-x-2">
                <Database className="h-4 w-4 text-emerald-400" />
                <h2 className="text-xs font-bold text-white uppercase tracking-wider">IndexedDB Memory Store Explorer</h2>
              </div>
              <div className="flex items-center space-x-1 border border-neutral-800 p-0.5 rounded bg-neutral-950">
                <button
                  onClick={() => setExploreTab('NODES')}
                  className={`px-3 py-1 rounded text-[10px] font-bold uppercase transition-colors cursor-pointer ${exploreTab === 'NODES' ? 'bg-neutral-800 text-white' : 'text-neutral-500 hover:text-neutral-300'}`}
                >
                  Nodes ({nodesList.length})
                </button>
                <button
                  onClick={() => setExploreTab('EDGES')}
                  className={`px-3 py-1 rounded text-[10px] font-bold uppercase transition-colors cursor-pointer ${exploreTab === 'EDGES' ? 'bg-neutral-800 text-white' : 'text-neutral-500 hover:text-neutral-300'}`}
                >
                  Triplet Edges ({edgesList.length})
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 flex-1 divide-y md:divide-y-0 md:divide-x divide-neutral-800">
              {/* Left Explorer: Lists */}
              <div className="p-4 max-h-[350px] overflow-y-auto">
                {exploreTab === 'NODES' ? (
                  nodesList.length === 0 ? (
                    <div className="h-full flex items-center justify-center py-10">
                      <p className="text-xs text-neutral-500 uppercase tracking-wider">No ingested memory nodes found</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {nodesList.map((node) => (
                        <div
                          key={node.id}
                          onClick={() => setSelectedRecord(node)}
                          className={`p-2.5 rounded border text-left cursor-pointer transition-colors ${selectedRecord?.id === node.id ? 'bg-neutral-950 border-emerald-500/50' : 'bg-neutral-950/40 border-neutral-800/80 hover:border-neutral-700'}`}
                        >
                          <div className="flex items-center justify-between text-[10px] mb-1 font-mono">
                            <span className="text-neutral-400 truncate max-w-[120px] font-bold uppercase">&gt; {node.source}</span>
                            <span className="text-neutral-500 font-mono text-[9px]">{new Date(node.timestamp).toLocaleTimeString()}</span>
                          </div>
                          <p className="text-xs text-neutral-300 line-clamp-2 leading-relaxed font-mono">{node.text}</p>
                        </div>
                      ))}
                    </div>
                  )
                ) : (
                  edgesList.length === 0 ? (
                    <div className="h-full flex items-center justify-center py-10">
                      <p className="text-xs text-neutral-500 uppercase tracking-wider">No compiled triplets found</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {edgesList.map((edge) => (
                        <div
                          key={edge.id}
                          onClick={() => setSelectedRecord(edge)}
                          className={`p-2 rounded border text-left cursor-pointer transition-colors ${selectedRecord?.id === edge.id ? 'bg-neutral-950 border-blue-500/50' : 'bg-neutral-950/40 border-neutral-800/80 hover:border-neutral-700'}`}
                        >
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-[10px] font-bold text-blue-400 font-mono truncate max-w-[100px]">{edge.s}</span>
                            <span className="text-neutral-500 text-[10px] font-semibold">--({edge.r})--&gt;</span>
                            <span className="text-[10px] font-bold text-emerald-400 font-mono truncate max-w-[100px]">{edge.o}</span>
                          </div>
                          <p className="text-[9px] text-neutral-500 font-mono uppercase mt-1">Source ID: {edge.sourceId.slice(0,8)}...</p>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>

              {/* Right Explorer: Item Detailed inspection panel */}
              <div className="p-4 flex flex-col justify-between max-h-[350px] overflow-y-auto bg-neutral-900/40">
                {selectedRecord ? (
                  <div className="flex flex-col h-full justify-between">
                    <div>
                      <div className="border-b border-neutral-800 pb-2 mb-3">
                        <span className="text-[10px] font-bold uppercase text-neutral-500">Record Specifications</span>
                        <h4 className="text-xs font-bold text-white uppercase mt-1 truncate">
                          ID: {selectedRecord.id}
                        </h4>
                      </div>
                      <div className="space-y-3">
                        {selectedRecord.text && (
                          <div>
                            <span className="text-[10px] text-neutral-500 uppercase block font-semibold mb-1">Payload Content</span>
                            <p className="text-xs text-neutral-300 font-mono leading-relaxed bg-neutral-950 border border-neutral-800 p-2.5 rounded max-h-[140px] overflow-y-auto">
                              {selectedRecord.text}
                            </p>
                          </div>
                        )}
                        {selectedRecord.vector && (
                          <div>
                            <span className="text-[10px] text-neutral-500 uppercase block font-semibold mb-1">
                              Embedding Vector (768 Float Grid Preview)
                            </span>
                            <p className="text-[10px] font-mono text-neutral-500 leading-relaxed bg-neutral-950 border border-neutral-800 p-2 rounded truncate">
                              [{selectedRecord.vector.slice(0,10).join(', ')} ... +{selectedRecord.vector.length - 10} dimensions]
                            </p>
                          </div>
                        )}
                        {selectedRecord.s && (
                          <div className="bg-neutral-950 border border-neutral-800 p-3 rounded">
                            <span className="text-[10px] text-neutral-500 uppercase block font-semibold mb-2">Subject Action Target Struct</span>
                            <div className="grid grid-cols-3 gap-2 text-center text-[10px] font-mono">
                              <div className="bg-neutral-900 p-1.5 rounded border border-neutral-800 text-blue-400">
                                <span className="block text-[8px] text-neutral-500 uppercase mb-0.5">Subject</span>
                                {selectedRecord.s}
                              </div>
                              <div className="bg-neutral-900 p-1.5 rounded border border-neutral-800 text-neutral-300">
                                <span className="block text-[8px] text-neutral-500 uppercase mb-0.5">Relation</span>
                                {selectedRecord.r}
                              </div>
                              <div className="bg-neutral-900 p-1.5 rounded border border-neutral-800 text-emerald-400">
                                <span className="block text-[8px] text-neutral-500 uppercase mb-0.5">Target</span>
                                {selectedRecord.o}
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-neutral-800 flex justify-between text-[10px] text-neutral-500">
                      <span>TIMESTAMP: {new Date(selectedRecord.timestamp || Date.now()).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center text-center py-20 text-neutral-600">
                    <HelpCircle className="h-8 w-8 text-neutral-700 mb-2" />
                    <p className="text-xs uppercase tracking-wider font-semibold">Select an item to inspect raw specifications</p>
                  </div>
                )}
              </div>
            </div>
          </section>

        </div>

        {/* Right Column (4 cols): System Log & Transport Archive operations */}
        <div className="lg:col-span-4 flex flex-col gap-6">

          {/* Module E: System Console Telemetry Logs */}
          <section className="bg-neutral-900 border border-neutral-800 rounded flex flex-col h-[320px]">
            <div className="border-b border-neutral-800 px-4 py-3 flex items-center justify-between bg-neutral-900/60">
              <div className="flex items-center space-x-2">
                <Terminal className="h-4 w-4 text-emerald-400" />
                <h2 className="text-xs font-bold text-white uppercase tracking-wider">Hardware Process Logs</h2>
              </div>
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            </div>

            <div className="p-3 bg-neutral-950 font-mono text-[10px] overflow-y-auto flex-1 flex flex-col-reverse divide-y divide-neutral-900/50">
              {systemLog.map((logStr, index) => {
                let colorClass = 'text-neutral-400';
                if (logStr.includes('[ERROR]')) colorClass = 'text-rose-400';
                if (logStr.includes('[CRITICAL]')) colorClass = 'text-red-500 font-bold';
                if (logStr.includes('[INGEST]')) colorClass = 'text-emerald-400';
                if (logStr.includes('[CONVERSE]')) colorClass = 'text-teal-400';
                if (logStr.includes('[GRAPH]')) colorClass = 'text-blue-400';
                if (logStr.includes('[EXPORT]') || logStr.includes('[IMPORT]')) colorClass = 'text-purple-400';

                return (
                  <div key={index} className={`py-1 ${colorClass}`}>
                    {logStr}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Module F: Lorepack Archive Transport (Import/Export) */}
          <section className="bg-neutral-900 border border-neutral-800 rounded flex flex-col">
            <div className="border-b border-neutral-800 px-4 py-3 flex items-center justify-between bg-neutral-900/60">
              <div className="flex items-center space-x-2">
                <FileText className="h-4 w-4 text-emerald-400" />
                <h2 className="text-xs font-bold text-white uppercase tracking-wider">Compiled Memory Transport</h2>
              </div>
              <span className="text-[10px] text-neutral-500">SYS_ARCHIVE</span>
            </div>

            <div className="p-4 flex flex-col gap-4">
              <p className="text-[11px] text-neutral-400 leading-relaxed font-mono">
                Port local mental representations between workspaces using standardized JSONL storage specifications.
              </p>

              {/* Direct Export Action */}
              <div>
                <button
                  onClick={handleExportLorepack}
                  disabled={exporting || stats.totalNodes === 0}
                  className="w-full bg-neutral-950 border border-neutral-800 hover:border-neutral-700 text-neutral-200 font-bold px-4 py-2 rounded text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" />
                  Export Compiled Archive (.JSONL)
                </button>
              </div>

              {/* Divider */}
              <div className="relative flex py-1 items-center">
                <div className="flex-grow border-t border-neutral-800"></div>
                <span className="flex-shrink mx-3 text-[9px] text-neutral-600 font-bold uppercase">OR</span>
                <div className="flex-grow border-t border-neutral-800"></div>
              </div>

              {/* Direct Import Action */}
              <div>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImportFile}
                  accept=".jsonl,.gz"
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={importProgress.active}
                  className="w-full bg-neutral-950 border border-neutral-800 hover:border-neutral-700 text-neutral-200 font-bold px-4 py-2 rounded text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Upload className="h-3.5 w-3.5" />
                  Import Archive Source (.JSONL)
                </button>
              </div>

              {/* Import Progress Bar info */}
              {importProgress.active && (
                <div className="bg-neutral-950 border border-neutral-800 p-3 rounded">
                  <span className="text-[9px] text-purple-400 block font-semibold mb-1 uppercase tracking-widest animate-pulse">
                    Parsing Mental Stream Arrays...
                  </span>
                  <p className="text-[10px] text-neutral-400">
                    &gt; Processed: {importProgress.processed} vectors &amp; edges.
                  </p>
                </div>
              )}

              {/* Verified Imported State Results Panel */}
              {lastImportResults && (
                <div className="bg-neutral-950 border border-neutral-800 p-3 rounded mt-2 text-xs space-y-2">
                  <span className="block text-[9px] text-purple-400 font-bold uppercase tracking-widest border-b border-neutral-800 pb-1 flex items-center gap-1">
                    <CheckCircle className="h-3 w-3 text-emerald-400" />
                    Verified Imported State Specifications
                  </span>
                  <div>
                    <span className="text-[9px] text-neutral-500 uppercase block">Source Archive Identity</span>
                    <p className="font-mono text-white font-bold truncate">{lastImportResults.fileName}</p>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <span className="text-[9px] text-neutral-500 uppercase block">Vectors</span>
                      <p className="font-mono font-bold text-white">{lastImportResults.vectorsCount}</p>
                    </div>
                    <div>
                      <span className="text-[9px] text-neutral-500 uppercase block">Dimension</span>
                      <p className="font-mono font-bold text-white">{lastImportResults.vectorDimension}</p>
                    </div>
                    <div>
                      <span className="text-[9px] text-neutral-500 uppercase block">Edges</span>
                      <p className="font-mono font-bold text-white">{lastImportResults.edgesCount}</p>
                    </div>
                  </div>
                  {lastImportResults.relationships.length > 0 && (
                    <div>
                      <span className="text-[9px] text-neutral-500 uppercase block mb-1">Restored Relationships</span>
                      <ul className="text-[10px] text-neutral-300 font-mono space-y-0.5 bg-neutral-900 border border-neutral-800 p-1.5 rounded max-h-[80px] overflow-y-auto">
                        {lastImportResults.relationships.map((rel, index) => (
                          <li key={index} className="truncate">&gt; {rel}</li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {lastImportResults.metadata && lastImportResults.metadata !== '{}' && (
                    <div>
                      <span className="text-[9px] text-neutral-500 uppercase block mb-1">Archive Metadata</span>
                      <pre className="text-[8px] text-neutral-400 bg-neutral-900 border border-neutral-800 p-1.5 rounded truncate">
                        {lastImportResults.metadata}
                      </pre>
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          {/* Clean Store / Workspace Reset Module */}
          <section className="bg-neutral-900 border border-neutral-800 rounded p-4 flex flex-col gap-3">
            <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2 text-rose-400">
              <AlertTriangle className="h-4 w-4" />
              Destructive System Actions
            </h3>
            <p className="text-[10px] text-neutral-500 uppercase leading-relaxed">
              Flush all IndexedDB nodes and relationship edge configurations for {agentId}. This action is irreversible.
            </p>
            <button
              onClick={clearAgentMemory}
              className="w-full bg-rose-950/40 border border-rose-900/60 hover:bg-rose-950 hover:text-white text-rose-300 font-bold px-4 py-2 rounded text-xs uppercase tracking-wider transition-colors cursor-pointer"
            >
              Wipe Agent Memory Space
            </button>
          </section>

        </div>
      </main>

      {/* Footer System Parameters */}
      <footer className="border-t border-neutral-800 bg-neutral-900/50 px-6 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-[10px] text-neutral-500">
        <p className="uppercase tracking-widest font-mono">
          SYSTEM ENVIRONMENT: PRODUCTION PREVIEW CONSOLE — ALL SYSTEMS OPERATIONAL
        </p>
        <p className="uppercase tracking-widest font-mono text-neutral-400">
          POWERED BY GEMINI-3.8-FLASH &amp; LOCAL INDEXEDDB
        </p>
      </footer>
    </div>
  );
}
