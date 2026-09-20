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
  CANONICAL_MYTHOS_AGENTS, 
  DEFAULT_CANONICAL_AGENT, 
  getCanonicalAgentById 
} from './agents.ts';
import { runMvpTestMatrix } from './core-test-runner.ts';
import type { TestSuiteState } from './core-test-runner.ts';
import { NavBar, AppSectionTab } from './components/NavBar.tsx';
import { MonolithicView } from './components/MonolithicView.tsx';
import { NetworkGraphView } from './components/NetworkGraphView.tsx';
import { SigilAccessGate, type SigilSession } from './components/SigilAccessGate.tsx';
import { LorepackAccessDenied } from './components/LorepackAccessDenied.tsx';
import { BatchIngestionSummary, type IngestionSummaryData } from './components/BatchIngestionSummary.tsx';
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
  FileDown,
  ChevronLeft,
  ChevronRight,
  X,
  Trash2,
  Settings,
  Edit3,
  Save,
  RotateCcw,
  Plus,
  Sparkles,
  Bookmark,
  BookmarkPlus,
  Check,
  Lock,
  LogOut,
  ShieldCheck
} from 'lucide-react';

export interface AgentCustomOverride {
  tone?: string;
  constraints?: string[];
  description?: string;
}

export interface PersonaPreset {
  id: string;
  name: string;
  tone: string;
  constraints: string[];
  builtIn?: boolean;
  createdAt?: number;
}

export const DEFAULT_PERSONA_PRESETS: PersonaPreset[] = [
  {
    id: 'preset-chronologist',
    name: 'Strict Chronologist',
    tone: 'formal, chronological, neutral',
    constraints: [
      'Strictly verify timeline timestamps',
      'Do not speculate beyond lore records',
      'Maintain neutral third-person perspective',
    ],
    builtIn: true,
  },
  {
    id: 'preset-systems-architect',
    name: 'Systems Architect',
    tone: 'concise, analytical, terse',
    constraints: [
      'Strictly output valid JSON format',
      'No pleasantries or conversational filler',
      'Enforce deterministic schemas across payloads',
    ],
    builtIn: true,
  },
  {
    id: 'preset-lorekeeper',
    name: 'Mythos Lorekeeper',
    tone: 'mythological, narrative, expansive',
    constraints: [
      'Preserve mythological framing and titles',
      'Synthesize multi-agent lore relationships',
      'Maintain canonical entity consistency',
    ],
    builtIn: true,
  },
  {
    id: 'preset-security-sentinel',
    name: 'Security Sentinel',
    tone: 'strict, defensive, audit-focused',
    constraints: [
      'Enforce access-control policy boundaries',
      'Reject unverified provenance claims',
      'Flag contradictory memory assertions',
    ],
    builtIn: true,
  },
  {
    id: 'preset-diplomatic-liaison',
    name: 'Diplomatic Liaison',
    tone: 'tactful, formal, conciliatory',
    constraints: [
      'Highlight treaty clauses and mutual concessions',
      'Maintain diplomatic neutrality between factions',
      'Attribute all statements to authorized delegates',
    ],
    builtIn: true,
  },
];

export default function App() {
  // GateKeeper Sigil Authentication & Session States
  const [authStatus, setAuthStatus] = useState<'checking' | 'authenticated' | 'unauthenticated'>('checking');
  const [activeSession, setActiveSession] = useState<SigilSession | null>(null);

  // Heuristic routing for Lorepack-specific denial branding
  const [isLorepackRoute, setIsLorepackRoute] = useState<boolean>(() => {
    const path = window.location.pathname.toLowerCase();
    return path.includes('/lorepack') || path.includes('/factory') || path.includes('/models');
  });
  const [forceSigilGate, setForceSigilGate] = useState<boolean>(false);
  
  // Batch Ingestion Summary Modal
  const [ingestionSummary, setIngestionSummary] = useState<IngestionSummaryData | null>(null);

  // Check active Builder session on initial mount
  useEffect(() => {
    const checkSession = async () => {
      try {
        const res = await fetch('/api/auth/session', {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.authenticated && data.session) {
            setActiveSession(data.session);
            setAuthStatus('authenticated');
            return;
          }
        }
      } catch (err) {
        console.warn('Session verification check failed:', err);
      }
      setAuthStatus('unauthenticated');
    };
    checkSession();
  }, []);

  const handleLogout = async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { 'Accept': 'application/json' },
      });
    } catch (err) {
      console.warn('Logout request failed:', err);
    }
    setActiveSession(null);
    setAuthStatus('unauthenticated');
  };

  // Core Engine References
  const [factory, setFactory] = useState<LorepackFactory | null>(null);
  const [store, setStore] = useState<IndexedDbLorepackStore | null>(null);
  const [provider, setProvider] = useState<GeminiProvider | null>(null);

  // Connection & Core Telemetry States
  const [dbState, setDbState] = useState<'DISCONNECTED' | 'CONNECTED' | 'ERROR'>('DISCONNECTED');
  const [apiState, setApiState] = useState<'UNTESTED' | 'ONLINE' | 'ERROR'>('UNTESTED');
  const [systemLog, setSystemLog] = useState<string[]>(['[SYSTEM]: Booting MythOS memory system...']);
  
  // Custom Multi-Key Rotation Pool States
  const [customApiKeys, setCustomApiKeys] = useState<string[]>([]);
  const [newKeyInput, setNewKeyInput] = useState<string>('');
  const [showSettingsModal, setShowSettingsModal] = useState<boolean>(false);
  const [autoSaveArchive, setAutoSaveArchive] = useState<boolean>(() => {
    return localStorage.getItem('mythos_autosave_archive') === 'true';
  });

  useEffect(() => {
    localStorage.setItem('mythos_autosave_archive', String(autoSaveArchive));
  }, [autoSaveArchive]);

  const performAutoSaveArchive = async () => {
    if (!factory) return;
    try {
      let exportLines: string[] = [];
      const batchGenerator = factory.yieldExportBatches(agentId, 500);
      for await (const batch of batchGenerator) {
        for (const item of batch) {
          exportLines.push(JSON.stringify(item));
        }
      }
      if (exportLines.length > 0) {
        const payload = exportLines.join('\n');
        localStorage.setItem(`mythos_lorepack_archive_${agentId}`, payload);
        localStorage.setItem('mythos_lorepack_archive_latest', payload);
        log(`[AUTOSAVE]: Lorepack archive auto-saved to local storage (${exportLines.length} blocks).`);
      }
    } catch (err: any) {
      log(`[AUTOSAVE_ERROR]: Failed to auto-save archive: ${err.message || err}`);
    }
  };

  // Navigation Section Tab State (Defaults to Monolithic Style)
  const [activeNavTab, setActiveNavTab] = useState<AppSectionTab>('monolithic');

  // Selection (Canonical 16 MythOS Agent Roster)
  const [agentId, setAgentId] = useState<string>(DEFAULT_CANONICAL_AGENT.id);
  const [agentHandle, setAgentHandle] = useState<string>(DEFAULT_CANONICAL_AGENT.handle);
  const [showAgentDetails, setShowAgentDetails] = useState<boolean>(false);
  const [stats, setStats] = useState<{ totalNodes: number; totalEdges: number }>({ totalNodes: 0, totalEdges: 0 });

  // Custom Agent Overrides (Inline Edit for Persona Tone & Architectural Constraints)
  const [agentOverrides, setAgentOverrides] = useState<Record<string, AgentCustomOverride>>(() => {
    try {
      const saved = localStorage.getItem('mythos_agent_overrides');
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const [isEditingDossier, setIsEditingDossier] = useState<boolean>(false);
  const [editTone, setEditTone] = useState<string>('');
  const [editConstraints, setEditConstraints] = useState<string[]>([]);
  const [newConstraintInput, setNewConstraintInput] = useState<string>('');

  // Persona Presets State & Handlers
  const [personaPresets, setPersonaPresets] = useState<PersonaPreset[]>(() => {
    try {
      const saved = localStorage.getItem('mythos_persona_presets');
      const custom: PersonaPreset[] = saved ? JSON.parse(saved) : [];
      return [...DEFAULT_PERSONA_PRESETS, ...custom];
    } catch {
      return [...DEFAULT_PERSONA_PRESETS];
    }
  });
  const [isCreatingPreset, setIsCreatingPreset] = useState<boolean>(false);
  const [newPresetName, setNewPresetName] = useState<string>('');
  const [selectedPresetId, setSelectedPresetId] = useState<string>('');
  const [showPresetManager, setShowPresetManager] = useState<boolean>(false);

  const handleApplyPreset = (preset: PersonaPreset) => {
    setEditTone(preset.tone);
    setEditConstraints([...preset.constraints]);
    setSelectedPresetId(preset.id);
    log(`[PERSONA_PRESET]: Applied preset "${preset.name}" (${preset.constraints.length} constraints).`);
  };

  const handleSaveCurrentAsPreset = () => {
    const trimmed = newPresetName.trim();
    if (!trimmed) return;

    const newPreset: PersonaPreset = {
      id: `preset-custom-${Date.now()}`,
      name: trimmed,
      tone: editTone.trim(),
      constraints: editConstraints.map((c) => c.trim()).filter(Boolean),
      builtIn: false,
      createdAt: Date.now(),
    };

    setPersonaPresets((prev) => {
      const customOnly = prev.filter((p) => !p.builtIn);
      const updatedCustom = [...customOnly, newPreset];
      try {
        localStorage.setItem('mythos_persona_presets', JSON.stringify(updatedCustom));
      } catch (err) {
        console.error('Failed to persist custom persona presets', err);
      }
      return [...DEFAULT_PERSONA_PRESETS, ...updatedCustom];
    });

    setSelectedPresetId(newPreset.id);
    setNewPresetName('');
    setIsCreatingPreset(false);
    log(`[PERSONA_PRESET]: Created and saved custom preset "${trimmed}".`);
  };

  const handleDeleteCustomPreset = (presetId: string) => {
    setPersonaPresets((prev) => {
      const filtered = prev.filter((p) => p.id !== presetId);
      const customOnly = filtered.filter((p) => !p.builtIn);
      try {
        localStorage.setItem('mythos_persona_presets', JSON.stringify(customOnly));
      } catch (err) {
        console.error('Failed to update custom persona presets', err);
      }
      return filtered;
    });
    if (selectedPresetId === presetId) {
      setSelectedPresetId('');
    }
    log(`[PERSONA_PRESET]: Removed custom preset.`);
  };

  const getEffectiveAgent = (id: string) => {
    const base = getCanonicalAgentById(id) || DEFAULT_CANONICAL_AGENT;
    const override = agentOverrides[base.id] || agentOverrides[id];
    if (!override) return base;
    return {
      ...base,
      meta: {
        ...base.meta,
        tone: override.tone !== undefined ? override.tone : base.meta.tone,
        constraints: override.constraints !== undefined ? override.constraints : base.meta.constraints,
        description: override.description !== undefined ? override.description : base.meta.description,
      },
    };
  };

  const startEditingDossier = (targetId: string) => {
    const agent = getEffectiveAgent(targetId);
    setEditTone(agent.meta.tone);
    setEditConstraints([...agent.meta.constraints]);
    setNewConstraintInput('');
    setIsEditingDossier(true);
  };

  const handleSaveDossier = (targetId: string) => {
    const base = getCanonicalAgentById(targetId) || DEFAULT_CANONICAL_AGENT;
    const cleanedTone = editTone.trim();
    const cleanedConstraints = editConstraints.map((c) => c.trim()).filter(Boolean);

    setAgentOverrides((prev) => {
      const updated = {
        ...prev,
        [base.id]: {
          tone: cleanedTone || base.meta.tone,
          constraints: cleanedConstraints,
        },
      };
      try {
        localStorage.setItem('mythos_agent_overrides', JSON.stringify(updated));
      } catch (err) {
        console.error('Failed to save agent overrides', err);
      }
      return updated;
    });

    setIsEditingDossier(false);
    log(`[AGENT_DOSSIER]: Updated persona tone and constraints for ${base.handle} (${base.id}).`);
  };

  const handleResetDossier = (targetId: string) => {
    const base = getCanonicalAgentById(targetId) || DEFAULT_CANONICAL_AGENT;
    setAgentOverrides((prev) => {
      const updated = { ...prev };
      delete updated[base.id];
      delete updated[targetId];
      try {
        localStorage.setItem('mythos_agent_overrides', JSON.stringify(updated));
      } catch (err) {
        console.error('Failed to clear agent overrides', err);
      }
      return updated;
    });

    setEditTone(base.meta.tone);
    setEditConstraints([...base.meta.constraints]);
    setIsEditingDossier(false);
    log(`[AGENT_DOSSIER]: Reverted ${base.handle} (${base.id}) to canonical defaults.`);
  };

  const handleAddConstraint = () => {
    if (!newConstraintInput.trim()) return;
    setEditConstraints((prev) => [...prev, newConstraintInput.trim()]);
    setNewConstraintInput('');
  };

  const handleRemoveConstraint = (indexToRemove: number) => {
    setEditConstraints((prev) => prev.filter((_, i) => i !== indexToRemove));
  };

  const handleUpdateConstraint = (index: number, value: string) => {
    setEditConstraints((prev) => {
      const updated = [...prev];
      updated[index] = value;
      return updated;
    });
  };

  // Core Test Suite State
  const [testState, setTestState] = useState<TestSuiteState>({
    isRunning: false,
    results: [],
    logs: [],
  });

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
  const [lorepackSearchQuery, setLorepackSearchQuery] = useState<string>(''); // Add this state
  const [selectedRecord, setSelectedRecord] = useState<any | null>(null);

  // Pagination states
  const [nodesPage, setNodesPage] = useState<number>(1);
  const [edgesPage, setEdgesPage] = useState<number>(1);
  const ITEMS_PER_PAGE = 5;

  // Destructive Action Telemetry & Visual Feedback
  const [isPurging, setIsPurging] = useState<boolean>(false);
  const [isNuking, setIsNuking] = useState<boolean>(false);
  const [destructiveFeedback, setDestructiveFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    action: 'purge' | 'nuke';
    title: string;
    message: string;
    timestamp: string;
  } | null>(null);

  // Auto-dismiss destructive feedback notification after 8 seconds
  useEffect(() => {
    if (destructiveFeedback && destructiveFeedback.type !== 'info') {
      const timer = setTimeout(() => {
        setDestructiveFeedback(null);
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, [destructiveFeedback]);

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

        const prov = new GeminiProvider();
        setProvider(prov);
        
        // Restore custom API keys from localStorage and register them immediately
        const savedKeysStr = localStorage.getItem('mythos_api_keys');
        let initialKeys: string[] = [];
        if (savedKeysStr) {
          try {
            const parsed = JSON.parse(savedKeysStr);
            if (Array.isArray(parsed) && parsed.length > 0) {
              initialKeys = parsed;
              setCustomApiKeys(parsed);
              prov.setApiKeys(parsed);
            }
          } catch (err) {
            console.error('Failed to parse saved API keys:', err);
          }
        }

        // Test API health immediately
        try {
          const healthRes = await fetch('/api/health');
          if (healthRes.ok) {
            setApiState(initialKeys.length > 0 ? 'ONLINE' : 'ONLINE');
            log(`[SYSTEM]: Secure Gemini backend connection authenticated.${initialKeys.length > 0 ? ' Client-side multilane rotation pool enabled.' : ''}`);
          } else {
            setApiState('ERROR');
            log('[ERROR]: Gemini backend API is unresponsive.');
          }
        } catch {
          setApiState('ERROR');
          log('[ERROR]: Backend connection refused.');
        }

        const f = new LorepackFactory(localStore, prov);
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

  // Handle addition and removal of API Keys
  const addApiKey = (key: string) => {
    const trimmed = key.trim();
    if (!trimmed) return;
    if (customApiKeys.includes(trimmed)) {
      log('[SYSTEM]: API Key already registered in pool.');
      return;
    }
    const updated = [...customApiKeys, trimmed];
    setCustomApiKeys(updated);
    localStorage.setItem('mythos_api_keys', JSON.stringify(updated));
    if (factory) {
      factory.setApiKeys(updated);
    }
    setNewKeyInput('');
    log(`[SYSTEM]: Registered API Key in load-balanced multilane pool. Active lanes: ${updated.length}`);
  };

  const removeApiKey = (index: number) => {
    const updated = customApiKeys.filter((_, i) => i !== index);
    setCustomApiKeys(updated);
    localStorage.setItem('mythos_api_keys', JSON.stringify(updated));
    if (factory) {
      factory.setApiKeys(updated);
    }
    log(`[SYSTEM]: Revoked API Key from pool. Active lanes: ${updated.length}`);
  };

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
    setNodesPage(1);
    setEdgesPage(1);
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
    setIngestionSummary(null);
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

      // Get updated stats for summary
      const finalStats = await factory.getStats(agentId);
      setIngestionSummary({
        nodesAdded: result.ingested,
        edgesAdded: 0,
        totalNodes: finalStats.totalNodes,
        totalEdges: finalStats.totalEdges,
        sourceName: sourceId || 'Manual Ingest'
      });

      if (autoSaveArchive) {
        await performAutoSaveArchive();
      }
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
    setIngestionSummary(null);
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

      // Get updated stats for summary
      const finalStats = await factory.getStats(agentId);
      setIngestionSummary({
        nodesAdded: 0,
        edgesAdded: count,
        totalNodes: finalStats.totalNodes,
        totalEdges: finalStats.totalEdges,
        sourceName: 'Graph Synthesizer'
      });
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
    setIngestionSummary(null);
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

      // Get updated stats for summary
      const finalStats = await factory.getStats(agentId);
      setIngestionSummary({
        nodesAdded: result.importedVectors,
        edgesAdded: result.importedEdges,
        totalNodes: finalStats.totalNodes,
        totalEdges: finalStats.totalEdges,
        sourceName: file.name
      });

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

  // Run Core Validation Matrix
  const handleRunTestSuite = async () => {
    if (!store) {
      log('[ERROR]: Cannot run test matrix. Database is disconnected.');
      return;
    }
    const provider = new GeminiProvider();
    log('[SYSTEM]: Triggering automated MVP Core Validation Matrix v0.1...');
    try {
      setTestState((prev) => ({ ...prev, isRunning: true }));
      await runMvpTestMatrix(store, provider, (updated) => {
        setTestState(updated);
        // Pipe test runner logs directly into the system log as well so they are visible in Hardware Process Logs!
        if (updated.logs.length > 0) {
          const latestLog = updated.logs[updated.logs.length - 1];
          setSystemLog((prev) => {
            if (prev[0] && prev[0].includes(latestLog)) return prev;
            return [`[TEST]: ${latestLog}`, ...prev.slice(0, 49)];
          });
        }
      });
      log('[SYSTEM]: MVP Core Validation Matrix execution finished.');
      await refreshExplorer();
    } catch (err: any) {
      log(`[ERROR]: Test matrix execution encountered fatal error: ${err.message || err}`);
    }
  };

  // Destructive Action A: Purge Single Agent Memory
  const clearAgentMemory = async () => {
    setIsPurging(true);
    setDestructiveFeedback({
      type: 'info',
      action: 'purge',
      title: `Purging ${agentId}...`,
      message: `Executing transactional deletion of all vector nodes and relationship edges for ${agentId}.`,
      timestamp: new Date().toLocaleTimeString(),
    });
    log(`[SYSTEM]: Wiping local workspace memory for ${agentId}...`);
    try {
      if (store) {
        // Single transactional call at persistence layer
        const result = await store.clearAgent(agentId);
        log(`[SYSTEM]: Successfully purged ${result.vectors} vector node(s) and ${result.edges} relation edge(s) for ${agentId}.`);
        
        // Refresh UI state ONLY after the transaction succeeds
        setNodesList([]);
        setEdgesList([]);
        setSelectedRecord(null);
        setLastRunResults(null);
        setLastImportResults(null);
        setLoadedFileName('');
        setLoadedFileSize(0);
        setSourceText('');
        setSourceId('manual-terminal-input');
        if (txtFileInputRef.current) {
          txtFileInputRef.current.value = '';
        }

        if (factory) {
          const freshStats = await factory.getStats(agentId);
          setStats(freshStats);
        } else {
          setStats({ totalNodes: 0, totalEdges: 0 });
        }

        // Await explorer refresh immediately after the transaction success is confirmed
        await refreshExplorer();

        setDestructiveFeedback({
          type: 'success',
          action: 'purge',
          title: `Agent Memory Purged: ${agentId}`,
          message: `Flushed ${result.vectors} vector node(s) and ${result.edges} relationship edge(s). Workspace memory is clean.`,
          timestamp: new Date().toLocaleTimeString(),
        });
      }
    } catch (err: any) {
      const errMsg = err.message || err;
      log(`[ERROR]: Agent purge transaction failed: ${errMsg}`);
      setDestructiveFeedback({
        type: 'error',
        action: 'purge',
        title: `Purge Failed: ${agentId}`,
        message: `Transaction encountered an error: ${errMsg}`,
        timestamp: new Date().toLocaleTimeString(),
      });
    } finally {
      setIsPurging(false);
    }
  };

  // Destructive Action B: Whole-Vault Nuke
  const nukeWholeVault = async () => {
    setIsNuking(true);
    setDestructiveFeedback({
      type: 'info',
      action: 'nuke',
      title: 'Executing Whole-Vault Destruction...',
      message: 'Closing database connections and permanently removing mythos_vault across all agents...',
      timestamp: new Date().toLocaleTimeString(),
    });
    log('[SYSTEM]: Executing whole-vault destruction (NUKE)...');
    try {
      const activeStore = store || new IndexedDbLorepackStore();
      await activeStore.nukeStore();
      log('[SYSTEM]: Vault deleted cleanly. Reinitializing empty vault database...');

      const newStore = new IndexedDbLorepackStore();
      setStore(newStore);
      const provInstance = provider || new GeminiProvider();
      const newFactory = new LorepackFactory(newStore, provInstance);
      setFactory(newFactory);

      setNodesList([]);
      setEdgesList([]);
      setSelectedRecord(null);
      setLastRunResults(null);
      setLastImportResults(null);
      setLoadedFileName('');
      setLoadedFileSize(0);
      setSourceText('');
      setSourceId('manual-terminal-input');
      if (txtFileInputRef.current) {
        txtFileInputRef.current.value = '';
      }

      const freshStats = await newFactory.getStats(agentId);
      setStats(freshStats);
      await refreshExplorer();
      log('[SYSTEM]: Fresh vault reinitialized successfully. All stores clean.');

      setDestructiveFeedback({
        type: 'success',
        action: 'nuke',
        title: 'Whole-Vault Successfully Nuked',
        message: 'The entire mythos_vault database was deleted and reinitialized with zero records across all agents.',
        timestamp: new Date().toLocaleTimeString(),
      });
    } catch (err: any) {
      const errMsg = err.message || err;
      log(`[ERROR]: Whole-vault NUKE failed: ${errMsg}`);
      setDestructiveFeedback({
        type: 'error',
        action: 'nuke',
        title: 'Vault Destruction Failed',
        message: `Whole-vault nuke operation failed: ${errMsg}`,
        timestamp: new Date().toLocaleTimeString(),
      });
    } finally {
      setIsNuking(false);
    }
  };

  // Sacred Architectural Anchors & Compatibility Bindings
  const runExport = handleExportLorepack;
  const runImport = () => { fileInputRef.current?.click(); };
  const runIngest = handleIngestText;
  const runChat = handleIngestChatTurn;
  const handleExportGzip = handleExportLorepack;
  const handleImportGzip = handleImportFile;
  const isExporting = exporting;
  const isImporting = importProgress.active;
  const stageFiles = (files: FileList | File[]) => {
    const fileList = Array.from(files);
    if (fileList.length > 0) {
      const file = fileList[0];
      setLoadedFileName(file.name);
      setLoadedFileSize(file.size);
      setSourceId(file.name);
      const reader = new FileReader();
      reader.onload = (event) => {
        const text = event.target?.result as string;
        setSourceText(text);
        log(`[FILE]: Staged file ${file.name} successfully. Size: ${file.size} bytes.`);
      };
      reader.readAsText(file);
    }
  };
  const saveParams = (params: Record<string, any>) => {
    try {
      localStorage.setItem('mythos_saved_params', JSON.stringify(params));
    } catch (e) {
      console.error(e);
    }
  };
  const loadSavedParams = () => {
    try {
      const p = localStorage.getItem('mythos_saved_params');
      return p ? JSON.parse(p) : {};
    } catch {
      return {};
    }
  };

  // Reusable sub-module blocks for dynamic multi-section navigation
  const processLogsModule = (
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
  );

  const apiKeysModule = (
    <section className="bg-neutral-900 border border-neutral-800 rounded flex flex-col">
      <div className="border-b border-neutral-800 px-4 py-3 flex items-center justify-between bg-neutral-900/60">
        <div className="flex items-center space-x-2">
          <Cpu className="h-4 w-4 text-emerald-400" />
          <h2 className="text-xs font-bold text-white uppercase tracking-wider">Multi-Lane API Load Balancer</h2>
        </div>
        <span className="text-[10px] text-neutral-500">SYS_LANES</span>
      </div>

      <div className="p-4 flex flex-col gap-3">
        <p className="text-[11px] text-neutral-400 leading-relaxed font-mono">
          Register multiple Gemini API Keys. The engine automatically rotates requests sequentially across active lanes to bypass quota boundaries.
        </p>

        <div className="flex gap-2">
          <input
            type="password"
            value={newKeyInput}
            onChange={(e) => setNewKeyInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                addApiKey(newKeyInput);
              }
            }}
            className="flex-1 bg-neutral-950 text-neutral-200 border border-neutral-800 px-3 py-1.5 rounded font-mono text-xs focus:outline-none focus:border-neutral-700"
            placeholder="AIzaSy..."
          />
          <button
            onClick={() => addApiKey(newKeyInput)}
            className="bg-neutral-800 hover:bg-neutral-700 text-white px-3 py-1.5 rounded text-xs font-bold uppercase tracking-wider cursor-pointer"
          >
            Add Key
          </button>
        </div>

        {customApiKeys.length > 0 ? (
          <div className="space-y-1.5 border border-neutral-800 rounded p-2 bg-neutral-950 max-h-[140px] overflow-y-auto">
            {customApiKeys.map((k, i) => (
              <div key={i} className="flex items-center justify-between text-xs font-mono py-1 px-2 bg-neutral-900 rounded border border-neutral-800">
                <span className="text-neutral-300">Lane #{i + 1}: ••••••••{k.slice(-4)}</span>
                <button
                  onClick={() => removeApiKey(i)}
                  className="text-rose-400 hover:text-rose-300 text-[10px] uppercase font-bold cursor-pointer"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-[10px] text-neutral-500 italic uppercase">
            No custom API keys registered. Falling back to secure server-side proxy lanes.
          </p>
        )}

        <div className="mt-4 pt-3 border-t border-neutral-800 flex items-center justify-between">
          <div>
            <span className="block text-xs font-bold text-white uppercase tracking-wider">Auto-Save Archive After Ingestion</span>
            <span className="text-[10px] text-neutral-400">Automatically export &amp; store Lorepack archive in browser localStorage after every ingestion process</span>
          </div>
          <button
            type="button"
            onClick={() => setAutoSaveArchive(!autoSaveArchive)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors cursor-pointer ${
              autoSaveArchive ? 'bg-emerald-600' : 'bg-neutral-800'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                autoSaveArchive ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </div>
    </section>
  );

  const transportModule = (
    <section className="bg-neutral-900 border border-neutral-800 rounded flex flex-col">
      <div className="border-b border-neutral-800 px-4 py-3 flex items-center justify-between bg-neutral-900/60">
        <div className="flex items-center space-x-2">
          <FileText className="h-4 w-4 text-emerald-400" />
          <h2 className="text-xs font-bold text-white uppercase tracking-wider">Compiled Memory Transport</h2>
        </div>
        <span className="text-[10px] text-neutral-500">GZIP_COMPRESSED</span>
      </div>

      <div className="p-4 flex flex-col gap-4">
        <div>
          <button
            id="exportBtn"
            onClick={handleExportLorepack}
            disabled={exporting || stats.totalNodes === 0}
            className="w-full bg-neutral-800 hover:bg-neutral-700 text-white font-bold px-4 py-2.5 rounded text-xs uppercase tracking-wider flex items-center justify-center space-x-2 transition-colors border border-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <Download className="h-3.5 w-3.5 text-emerald-400" />
            <span>{exporting ? 'Packaging Archive...' : 'Compile & Export Lorepack'}</span>
          </button>
        </div>

        <div className="border-t border-neutral-800 pt-3">
          <span className="block text-[10px] text-neutral-400 font-bold uppercase tracking-wider mb-2">
            Import Lorepack Archive (.lorepack.gz)
          </span>
          <label 
            htmlFor="archiveUploadInput"
            className="block border border-dashed border-neutral-700 hover:border-neutral-500 bg-neutral-950 p-4 rounded text-center cursor-pointer transition-colors"
          >
            <Upload className="h-5 w-5 text-neutral-500 mx-auto mb-1" />
            <span className="text-xs text-neutral-300 block font-bold">Select Archive File</span>
            <span className="text-[9px] text-neutral-500 block mt-0.5 font-mono">Format: [agent]-[source].lorepack.gz</span>
            <input 
              id="archiveUploadInput"
              type="file" 
              accept=".gz,.lorepack.gz,.jsonl,application/gzip" 
              onChange={handleImportFile} 
              disabled={importProgress.active}
              className="hidden" 
            />
          </label>
        </div>

        {lastImportResults && (
          <div className="border border-neutral-800 rounded bg-neutral-950 p-3 text-xs space-y-2">
            <span className="text-[10px] text-emerald-400 uppercase font-bold tracking-wider block">
              Archive Ingestion Report
            </span>
            <div className="grid grid-cols-2 gap-2 text-[11px]">
              <div>
                <span className="text-neutral-500">Ingested Nodes:</span>
                <span className="text-white font-bold ml-1">{lastImportResults.vectorsCount}</span>
              </div>
              <div>
                <span className="text-neutral-500">Ingested Edges:</span>
                <span className="text-white font-bold ml-1">{lastImportResults.edgesCount}</span>
              </div>
            </div>
            {lastImportResults.metadata && (
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
  );

  const testMatrixModule = (
    <section className="bg-neutral-900 border border-neutral-800 rounded flex flex-col">
      <div className="border-b border-neutral-800 px-4 py-3 flex items-center justify-between bg-neutral-900/60">
        <div className="flex items-center space-x-2">
          <Layers className="h-4 w-4 text-purple-400" />
          <h2 className="text-xs font-bold text-white uppercase tracking-wider">MVP Core Test Matrix v0.1</h2>
        </div>
        <span className="text-[10px] text-neutral-500">SYS_TEST</span>
      </div>

      <div className="p-4 flex flex-col gap-3">
        <p className="text-[11px] text-neutral-400 leading-relaxed font-mono">
          Verify the integrity of the Lorepack compilation, database, and export/import round-trip pipeline under isolated workspaces.
        </p>

        <div>
          <button
            id="testMatrixBtn"
            onClick={handleRunTestSuite}
            disabled={testState.isRunning}
            className="w-full bg-purple-950/40 border border-purple-800 text-purple-300 font-bold px-4 py-2 rounded text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-colors hover:bg-purple-900 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${testState.isRunning ? 'animate-spin' : ''}`} />
            {testState.isRunning ? 'Running Verification Pipeline...' : 'Run Core Validation Matrix'}
          </button>
        </div>

        {testState.results.length > 0 && (
          <div className="border border-neutral-800 rounded bg-neutral-950 p-2 text-xs space-y-1.5 max-h-[220px] overflow-y-auto">
            {testState.results.map((res) => {
              let badgeColor = 'text-neutral-500 border-neutral-800 bg-neutral-950/40';
              if (res.status === 'RUNNING') badgeColor = 'text-amber-500 border-amber-800 bg-amber-950/30 animate-pulse';
              if (res.status === 'PASSED') badgeColor = 'text-emerald-400 border-emerald-800 bg-emerald-950/40';
              if (res.status === 'FAILED') badgeColor = 'text-rose-400 border-rose-800 bg-rose-950/40';

              return (
                <div key={res.id} className="flex items-start justify-between gap-2 py-1 border-b border-neutral-900 last:border-0 text-[11px]">
                  <div className="flex-1 min-w-0 text-left">
                    <span className="font-bold text-neutral-400 mr-2">{res.id}</span>
                    <span className="font-bold text-white">{res.name}</span>
                    <p className="text-[10px] text-neutral-400 mt-0.5 font-mono leading-tight">{res.message}</p>
                    {res.details && (
                      <span className="inline-block mt-0.5 text-[9px] text-neutral-500 font-mono italic">Details: {res.details}</span>
                    )}
                  </div>
                  <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border shrink-0 ${badgeColor}`}>
                    {res.status}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );

  const destructiveModule = (
    <section className="bg-neutral-900 border border-neutral-800 rounded p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2 text-rose-400">
          <AlertTriangle className="h-4 w-4" />
          Destructive System Actions
        </h3>
        {(isPurging || isNuking) && (
          <span className="flex items-center gap-1.5 text-[9px] text-amber-400 bg-amber-950/40 border border-amber-800/60 px-2 py-0.5 rounded font-mono uppercase tracking-wider">
            <RefreshCw className="h-3 w-3 animate-spin" />
            Executing
          </span>
        )}
      </div>

      <div className="bg-neutral-950 border border-neutral-800/80 rounded p-3 text-xs space-y-2 font-mono">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-neutral-400">Action: Purge Agent Memory</span>
            <span className="text-[9px] text-amber-500/80 uppercase">Target: {agentId}</span>
          </div>
          <p className="text-[10px] text-neutral-500 leading-relaxed">
            Deletes all vector nodes and relationship edges strictly for active workspace <span className="text-neutral-300 font-bold">{agentId}</span>. Other agents remain unaffected.
          </p>
        </div>
        <button
          onClick={clearAgentMemory}
          disabled={isPurging || isNuking}
          className="w-full bg-amber-950/30 hover:bg-amber-900/60 text-amber-400 hover:text-amber-200 border border-amber-800/60 px-3 py-1.5 rounded font-mono text-[11px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
        >
          {isPurging ? (
            <>
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-amber-200" />
              <span>Purging Agent Memory...</span>
            </>
          ) : (
            <>
              <Trash2 className="h-3.5 w-3.5 text-amber-400" />
              <span>Purge Agent Memory ({agentId})</span>
            </>
          )}
        </button>
      </div>

      <div className="bg-rose-950/20 border border-rose-900/50 rounded p-3 text-xs space-y-2 font-mono">
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold text-rose-400">Action: Whole-Vault Nuke</span>
            <span className="text-[9px] text-rose-500 uppercase font-bold">ALL AGENTS</span>
          </div>
          <p className="text-[10px] text-neutral-400 leading-relaxed">
            Permanently destroys and drops the entire <span className="text-rose-300 font-semibold">mythos_vault</span> database across all workspaces, resets all tables, and reboots an empty store.
          </p>
        </div>
        <button
          id="nukeTrigger"
          onClick={nukeWholeVault}
          disabled={isPurging || isNuking}
          className="w-full bg-rose-950/40 hover:bg-rose-900/80 text-rose-300 hover:text-white border border-rose-800 px-3 py-1.5 rounded font-mono text-[11px] font-bold uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
        >
          {isNuking ? (
            <>
              <RefreshCw className="h-3.5 w-3.5 animate-spin text-red-200" />
              <span>Nuking Vault Database...</span>
            </>
          ) : (
            <>
              <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
              <span>Nuke Vault</span>
            </>
          )}
        </button>
      </div>
    </section>
  );

  if (authStatus === 'checking') {
    return (
      <div className="h-screen w-screen bg-neutral-950 flex flex-col items-center justify-center font-mono text-neutral-400 gap-3">
        <RefreshCw className="w-8 h-8 text-amber-500 animate-spin" />
        <span className="text-xs uppercase tracking-widest text-neutral-500">
          Checking GateKeeper Session...
        </span>
      </div>
    );
  }

  if (authStatus === 'unauthenticated') {
    // Show specialized Lorepack denial page if user hit a Lorepack-related "route"
    if (isLorepackRoute && !forceSigilGate) {
      return (
        <LorepackAccessDenied
          onPresentSigil={() => setForceSigilGate(true)}
          onReturn={() => {
            // Reset to clean origin
            window.history.pushState({}, '', '/');
            setIsLorepackRoute(false);
          }}
        />
      );
    }

    return (
      <SigilAccessGate
        onAuthenticated={(session) => {
          setActiveSession(session);
          setAuthStatus('authenticated');
        }}
      />
    );
  }

  return (
    <div className="h-screen max-h-screen bg-neutral-950 text-neutral-200 font-mono flex flex-col antialiased overflow-hidden">
      {/* 1. Terminal Top Banner */}
      <header className="border-b border-neutral-800 bg-neutral-900/95 px-4 py-2 flex flex-col md:flex-row items-start md:items-center justify-between gap-2 shrink-0 z-50 backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <Terminal className="h-5 w-5 text-emerald-500 animate-pulse" />
          <div>
            <h1 className="text-xs font-bold tracking-wider text-white uppercase flex items-center gap-2">
              MYTHOS LOREPACK ENGINE
              <span className="text-[9px] bg-neutral-800 border border-neutral-700 text-neutral-400 px-1 py-0.5 rounded uppercase tracking-widest">v2.1</span>
            </h1>
            <p className="text-[9px] text-neutral-500 uppercase tracking-wide">
              Secure Local-First Cognitive Storage Terminal
            </p>
          </div>
        </div>

        {/* Global Hardware Status Bars */}
        <div className="flex flex-wrap items-center gap-2">
          {/* GateKeeper Session Indicator */}
          {activeSession && (
            <div className="flex items-center space-x-1.5 bg-neutral-950 px-2.5 py-1 border border-amber-500/30 rounded text-xs">
              <ShieldCheck className="h-3 w-3 text-amber-400" />
              <span className="text-[9px] text-neutral-400">SIGIL:</span>
              <span className="text-[9px] font-bold text-amber-400 font-mono" title={`Session ${activeSession.id}`}>
                {activeSession.sigilMask}
              </span>
            </div>
          )}

          <div className="flex items-center space-x-1.5 bg-neutral-950 px-2.5 py-1 border border-neutral-800 rounded text-xs">
            <Database className="h-3 w-3 text-neutral-500" />
            <span className="text-[9px] text-neutral-400">DATABASE:</span>
            <span className={`text-[9px] font-bold ${dbState === 'CONNECTED' ? 'text-emerald-500' : 'text-rose-500'}`}>
              {dbState}
            </span>
          </div>

          <div className="flex items-center space-x-1.5 bg-neutral-950 px-2.5 py-1 border border-neutral-800 rounded text-xs">
            <Cpu className="h-3 w-3 text-neutral-500" />
            <span className="text-[9px] text-neutral-400">GEMINI PROVIDER:</span>
            <span className={`text-[9px] font-bold ${apiState === 'ONLINE' ? 'text-emerald-500' : 'text-amber-500'}`}>
              {apiState}
            </span>
          </div>
          <button
            onClick={() => setShowSettingsModal(true)}
            className="flex items-center justify-center bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 p-1.5 rounded text-neutral-400 hover:text-white transition-colors cursor-pointer"
            title="API Settings"
          >
            <Settings className="h-3.5 w-3.5" />
          </button>
          <button
            id="btn-lock-session"
            onClick={handleLogout}
            className="flex items-center justify-center bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 hover:border-rose-900/60 p-1.5 rounded text-neutral-400 hover:text-rose-400 transition-colors cursor-pointer"
            title="Lock Factory / Terminate SIGIL Session"
          >
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
      </header>

      {/* 2. Navigation Bar */}
      <NavBar
        activeTab={activeNavTab}
        onSelectTab={setActiveNavTab}
        stats={stats}
        activeAgentId={agentId}
      />

      {/* Main Content Area */}
      {activeNavTab === 'monolithic' ? (
        <main className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
          <MonolithicView
            factory={factory}
            store={store}
            provider={provider}
            agentId={agentId}
            setAgentId={(newId) => {
              const selected = getCanonicalAgentById(newId);
              const nextId = selected ? selected.id : newId;
              const nextHandle = selected ? selected.handle : newId.replace(/^agent-/, '');
              setAgentId(nextId);
              setAgentHandle(nextHandle);
              setSelectedRecord(null);
              setLastRunResults(null);
              setLastImportResults(null);
              refreshExplorer();
            }}
            agentHandle={agentHandle}
            setAgentHandle={setAgentHandle}
            stats={stats}
            refreshStats={refreshExplorer}
            onRunTestMatrix={() => {
              setActiveNavTab('test-matrix');
              handleRunTestSuite();
            }}
            onPurgeAgent={clearAgentMemory}
            onNukeVault={nukeWholeVault}
            customApiKeys={customApiKeys}
            setCustomApiKeys={setCustomApiKeys}
          />
        </main>
      ) : activeNavTab === 'graph-view' ? (
        <main className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
          <NetworkGraphView
            agents={CANONICAL_MYTHOS_AGENTS}
            activeAgentId={agentId}
            store={store}
            factory={factory}
          />
        </main>
      ) : (
        <main className="flex-1 min-h-0 overflow-y-auto p-6 grid grid-cols-1 lg:grid-cols-12 gap-6 max-w-7xl mx-auto w-full">
          {/* Left Column (8 cols): Storage, Ingest, Graph operations */}
          <div className="lg:col-span-8 flex flex-col gap-6">
            
            {/* Live Telemetry Overview & Canonical Dossier */}
            {(activeNavTab === 'all' || activeNavTab === 'workspace') && (
              <>
                {/* Active Workspace Selector */}
                <div className="bg-neutral-900 border border-neutral-800 p-4 rounded flex items-center justify-between">
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] text-neutral-500 font-semibold uppercase tracking-widest">Workspace & Agent:</span>
                    <select 
                      id="workspaceAgentSelector"
                      value={agentId} 
                      onChange={(e) => {
                        const selected = getCanonicalAgentById(e.target.value);
                        const nextId = selected ? selected.id : e.target.value;
                        const nextHandle = selected ? selected.handle : e.target.value.replace(/^agent-/, '');
                        setAgentId(nextId);
                        setAgentHandle(nextHandle);
                        setSelectedRecord(null);
                        setLastRunResults(null);
                        setLastImportResults(null);
                      }}
                      className="bg-neutral-950 px-3 py-1.5 border border-neutral-800 rounded text-xs text-white uppercase font-mono cursor-pointer outline-none focus:border-emerald-500/50"
                    >
                      {CANONICAL_MYTHOS_AGENTS.map((agent) => (
                        <option key={agent.id} value={agent.id} className="bg-neutral-900 text-neutral-200">
                          [{agent.port}] {agent.id} — {agent.handle} ({agent.role.split(':')[0]})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

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

          {/* Canonical Agent Specification Dossier */}
          {(() => {
            const activeAgent = getEffectiveAgent(agentId);
            const isCustomized = !!agentOverrides[activeAgent.id];

            return (
              <div className={`bg-neutral-900 border rounded p-4 flex flex-col gap-3 transition-colors ${
                isEditingDossier ? 'border-emerald-500/60 shadow-lg shadow-emerald-950/30' : 'border-neutral-800'
              }`}>
                {/* Dossier Header Bar */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-neutral-800 pb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="px-2 py-0.5 rounded bg-emerald-950/80 border border-emerald-800 text-[11px] font-mono font-bold text-emerald-400">
                      PORT {activeAgent.port}
                    </span>
                    <span className="text-sm font-bold text-white tracking-wide">
                      {activeAgent.handle} ({activeAgent.id})
                    </span>
                    <span className="text-xs text-neutral-400">
                      — {activeAgent.role}
                    </span>
                    {isCustomized && (
                      <span className="px-2 py-0.5 bg-amber-950/70 border border-amber-700 text-[9px] font-mono font-bold text-amber-400 uppercase tracking-wider rounded">
                        CUSTOMIZED
                      </span>
                    )}
                  </div>
                  
                  <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
                    <span className="text-[10px] font-mono text-neutral-500 bg-neutral-950 px-2 py-0.5 border border-neutral-800 rounded">
                      rev: {activeAgent.revision}
                    </span>
                    
                    {!isEditingDossier ? (
                      <button
                        type="button"
                        id="editDossierBtn"
                        onClick={() => startEditingDossier(activeAgent.id)}
                        className="text-[10px] uppercase font-bold tracking-wider px-2.5 py-1 bg-emerald-950/80 hover:bg-emerald-900 border border-emerald-700/80 text-emerald-300 rounded transition-colors flex items-center gap-1.5 cursor-pointer"
                        title="Inline Edit Active Agent Persona Tone & Constraints"
                      >
                        <Edit3 className="w-3 h-3" />
                        <span>Edit Dossier</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        id="cancelDossierEditBtn"
                        onClick={() => setIsEditingDossier(false)}
                        className="text-[10px] uppercase font-bold tracking-wider px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded transition-colors flex items-center gap-1 cursor-pointer"
                      >
                        <X className="w-3 h-3" />
                        <span>Cancel</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => setShowAgentDetails(!showAgentDetails)}
                      className="text-[10px] uppercase font-bold tracking-wider px-2.5 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded transition-colors"
                    >
                      {showAgentDetails ? 'Hide Instructions' : 'View Instructions'}
                    </button>
                  </div>
                </div>

                {/* Inline Edit Form */}
                {isEditingDossier ? (
                  <div className="bg-neutral-950 p-3.5 rounded border border-emerald-800/60 flex flex-col gap-4">
                    <div className="flex items-center justify-between border-b border-neutral-800 pb-2">
                      <div className="flex items-center gap-2">
                        <Sparkles className="w-3.5 h-3.5 text-emerald-400" />
                        <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                          INLINE DOSSIER EDITOR — {activeAgent.handle}
                        </span>
                      </div>
                      <span className="text-[10px] text-neutral-500">Changes apply immediately to this workspace</span>
                    </div>

                    {/* Persona Presets Section */}
                    <div className="bg-neutral-900/90 border border-neutral-800 rounded p-3 flex flex-col gap-2.5">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <Bookmark className="w-3.5 h-3.5 text-blue-400" />
                          <span className="text-[11px] font-bold text-white uppercase tracking-wider">
                            Persona Presets
                          </span>
                          <span className="text-[10px] text-neutral-400">
                            ({personaPresets.length} available)
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            id="saveCurrentAsPresetBtn"
                            onClick={() => setIsCreatingPreset(!isCreatingPreset)}
                            className="text-[10px] uppercase font-bold tracking-wider px-2.5 py-1 bg-blue-950/70 hover:bg-blue-900/90 border border-blue-800/80 text-blue-300 rounded flex items-center gap-1 transition-colors cursor-pointer"
                            title="Save current tone and constraints as a reusable preset"
                          >
                            <BookmarkPlus className="w-3 h-3" />
                            <span>{isCreatingPreset ? 'Cancel Save' : 'Save As Preset'}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => setShowPresetManager(!showPresetManager)}
                            className="text-[10px] uppercase font-bold tracking-wider px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 rounded transition-colors cursor-pointer"
                          >
                            {showPresetManager ? 'Hide List' : 'Manage'}
                          </button>
                        </div>
                      </div>

                      {/* Presets Pills Selector */}
                      <div className="flex flex-wrap items-center gap-1.5">
                        {personaPresets.map((preset) => {
                          const isSelected = selectedPresetId === preset.id;
                          return (
                            <button
                              key={preset.id}
                              type="button"
                              onClick={() => handleApplyPreset(preset)}
                              className={`text-[10px] px-2.5 py-1 rounded font-mono transition-all flex items-center gap-1.5 cursor-pointer border ${
                                isSelected
                                  ? 'bg-blue-600 border-blue-400 text-white font-bold shadow-sm'
                                  : 'bg-neutral-950 hover:bg-neutral-800 text-neutral-300 border-neutral-800 hover:border-neutral-700'
                              }`}
                              title={`Tone: "${preset.tone}" (${preset.constraints.length} constraints)`}
                            >
                              {isSelected && <Check className="w-3 h-3 text-white" />}
                              <span>{preset.name}</span>
                              {!preset.builtIn && (
                                <span className="text-[8px] uppercase tracking-wider text-amber-400 bg-amber-950/60 px-1 rounded border border-amber-800/60">
                                  custom
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>

                      {/* Create New Preset Sub-form */}
                      {isCreatingPreset && (
                        <div className="mt-1 bg-neutral-950 p-2.5 rounded border border-blue-900/60 flex flex-col gap-2 animate-fadeIn">
                          <div className="flex items-center justify-between">
                            <span className="text-[10px] uppercase tracking-wider text-blue-400 font-bold">
                              Save Current Persona Setup as Named Preset
                            </span>
                            <span className="text-[9px] text-neutral-500">
                              {editConstraints.length} rules staged
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <input
                              type="text"
                              value={newPresetName}
                              onChange={(e) => setNewPresetName(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault();
                                  handleSaveCurrentAsPreset();
                                }
                              }}
                              placeholder="e.g., Forensic Incident Analyst, Creative Lore Sculptor..."
                              className="flex-1 bg-neutral-900 border border-neutral-700 text-neutral-100 px-2.5 py-1.5 text-xs rounded font-mono focus:border-blue-500 outline-none"
                              autoFocus
                            />
                            <button
                              type="button"
                              onClick={handleSaveCurrentAsPreset}
                              disabled={!newPresetName.trim()}
                              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-bold rounded flex items-center gap-1 transition-colors cursor-pointer"
                            >
                              <Save className="w-3 h-3" />
                              <span>Save Preset</span>
                            </button>
                          </div>
                          <div className="text-[10px] text-neutral-400 font-mono truncate">
                            <span className="text-neutral-500">Tone preview:</span> &ldquo;{editTone || 'Default'}&rdquo;
                          </div>
                        </div>
                      )}

                      {/* Manage Presets Expanded Drawer */}
                      {showPresetManager && (
                        <div className="mt-1 bg-neutral-950 p-2.5 rounded border border-neutral-800 flex flex-col gap-2 max-h-56 overflow-y-auto">
                          <span className="text-[10px] uppercase tracking-wider text-neutral-400 font-bold">
                            Preset Registry & Management
                          </span>
                          <div className="space-y-1.5">
                            {personaPresets.map((preset) => (
                              <div
                                key={preset.id}
                                className="bg-neutral-900 p-2 rounded border border-neutral-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
                              >
                                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-bold text-white font-mono">{preset.name}</span>
                                    {preset.builtIn ? (
                                      <span className="text-[8px] uppercase tracking-wider text-neutral-500 bg-neutral-800 px-1 py-0.5 rounded">
                                        built-in
                                      </span>
                                    ) : (
                                      <span className="text-[8px] uppercase tracking-wider text-amber-400 bg-amber-950 px-1 py-0.5 rounded border border-amber-800">
                                        custom
                                      </span>
                                    )}
                                  </div>
                                  <p className="text-[10px] text-neutral-400 italic truncate">&ldquo;{preset.tone}&rdquo;</p>
                                  <p className="text-[9px] text-neutral-500 font-mono">
                                    {preset.constraints.length} constraint{preset.constraints.length === 1 ? '' : 's'}: {preset.constraints.join(' • ')}
                                  </p>
                                </div>
                                <div className="flex items-center gap-1.5 shrink-0">
                                  <button
                                    type="button"
                                    onClick={() => handleApplyPreset(preset)}
                                    className="px-2 py-1 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-[10px] font-bold rounded transition-colors cursor-pointer"
                                  >
                                    Load
                                  </button>
                                  {!preset.builtIn && (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteCustomPreset(preset.id)}
                                      className="p-1 text-neutral-500 hover:text-rose-400 transition-colors cursor-pointer"
                                      title="Delete custom preset"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Persona Tone Editor */}
                    <div className="flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <label htmlFor="editPersonaTone" className="text-[10px] uppercase tracking-wider text-neutral-400 font-bold">
                          Persona Tone & Mannerism:
                        </label>
                        <span className="text-[9px] text-neutral-500">{editTone.length} chars</span>
                      </div>
                      <input
                        id="editPersonaTone"
                        type="text"
                        value={editTone}
                        onChange={(e) => setEditTone(e.target.value)}
                        placeholder="e.g. formal, chronological, neutral, highly analytical..."
                        className="w-full bg-neutral-900 border border-neutral-700 text-neutral-100 px-3 py-2 text-xs rounded font-mono focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 outline-none"
                      />
                      {/* Tone presets */}
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <span className="text-[9px] text-neutral-500 mr-1">PRESETS:</span>
                        {[
                          'formal, chronological, neutral',
                          'concise, analytical, terse',
                          'creative, philosophical, expansive',
                          'strict, security-minded, defensive',
                          'conversational, empathetic, helpful'
                        ].map((preset) => (
                          <button
                            key={preset}
                            type="button"
                            onClick={() => setEditTone(preset)}
                            className="text-[9px] px-2 py-0.5 bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-neutral-200 border border-neutral-800 rounded transition-colors cursor-pointer"
                          >
                            {preset.split(',')[0]}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Architectural Constraints Editor */}
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] uppercase tracking-wider text-neutral-400 font-bold">
                          Architectural Constraints ({editConstraints.length}):
                        </label>
                        <span className="text-[9px] text-neutral-500">Rules strictly enforced on agent output</span>
                      </div>

                      {/* Constraint Items List */}
                      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                        {editConstraints.length === 0 ? (
                          <div className="text-[11px] text-neutral-500 italic p-2 bg-neutral-900/50 rounded border border-dashed border-neutral-800 text-center">
                            No active constraints. Add one below to guide agent boundaries.
                          </div>
                        ) : (
                          editConstraints.map((constraint, idx) => (
                            <div key={idx} className="flex items-center gap-2 bg-neutral-900 p-1.5 rounded border border-neutral-800">
                              <span className="text-[10px] text-neutral-500 font-mono w-4 text-center">{idx + 1}.</span>
                              <input
                                type="text"
                                value={constraint}
                                onChange={(e) => handleUpdateConstraint(idx, e.target.value)}
                                className="flex-1 bg-transparent text-neutral-200 text-xs font-mono outline-none border-b border-transparent focus:border-emerald-500/60 px-1"
                              />
                              <button
                                type="button"
                                onClick={() => handleRemoveConstraint(idx)}
                                className="text-neutral-500 hover:text-rose-400 p-1 rounded transition-colors cursor-pointer"
                                title="Remove constraint"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))
                        )}
                      </div>

                      {/* Add New Constraint Input */}
                      <div className="flex items-center gap-2 mt-1">
                        <input
                          id="newConstraintInput"
                          type="text"
                          value={newConstraintInput}
                          onChange={(e) => setNewConstraintInput(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleAddConstraint();
                            }
                          }}
                          placeholder="Add new architectural constraint (press Enter)..."
                          className="flex-1 bg-neutral-900 border border-neutral-700 text-neutral-100 px-3 py-1.5 text-xs rounded font-mono focus:border-emerald-500 outline-none"
                        />
                        <button
                          type="button"
                          id="addConstraintBtn"
                          onClick={handleAddConstraint}
                          disabled={!newConstraintInput.trim()}
                          className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-neutral-200 text-xs font-bold rounded flex items-center gap-1 transition-colors cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                          <span>Add</span>
                        </button>
                      </div>

                      {/* Suggested quick constraints */}
                      <div className="flex flex-wrap items-center gap-1.5 mt-1">
                        <span className="text-[9px] text-neutral-500 mr-1">SUGGESTIONS:</span>
                        {[
                          'Cannot generate ungrounded claims',
                          'Strictly output valid JSON format',
                          'Do not speculate beyond lore records',
                          'Maintain neutral third-person perspective',
                          'Include timestamps for all state transitions'
                        ].map((sugg) => (
                          <button
                            key={sugg}
                            type="button"
                            onClick={() => {
                              if (!editConstraints.includes(sugg)) {
                                setEditConstraints((prev) => [...prev, sugg]);
                              }
                            }}
                            className="text-[9px] px-2 py-0.5 bg-neutral-900/80 hover:bg-neutral-800 text-neutral-400 hover:text-emerald-300 border border-neutral-800 rounded transition-colors cursor-pointer"
                          >
                            + {sugg}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Actions Bar */}
                    <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2 pt-2 border-t border-neutral-800">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          id="saveDossierBtn"
                          onClick={() => handleSaveDossier(activeAgent.id)}
                          className="px-4 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow"
                        >
                          <Save className="w-3.5 h-3.5" />
                          <span>Save Dossier Changes</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsEditingDossier(false)}
                          className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 text-xs rounded transition-colors cursor-pointer"
                        >
                          Cancel
                        </button>
                      </div>

                      {isCustomized && (
                        <button
                          type="button"
                          id="resetDossierBtn"
                          onClick={() => handleResetDossier(activeAgent.id)}
                          className="px-3 py-1.5 bg-amber-950/40 hover:bg-amber-900/60 border border-amber-800/80 text-amber-400 text-xs font-bold rounded flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                          title="Restore factory default tone and constraints from canonical roster"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Reset to Canonical Defaults</span>
                        </button>
                      )}
                    </div>
                  </div>
                ) : (
                  /* Standard Read-Only Dossier Grid */
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                    <div 
                      onClick={() => startEditingDossier(activeAgent.id)}
                      className="bg-neutral-950 p-2.5 rounded border border-neutral-800/80 hover:border-neutral-700 transition-colors cursor-pointer group"
                      title="Click to edit persona tone"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] uppercase tracking-wider text-neutral-500 block font-semibold">
                          Persona Tone
                        </span>
                        <Edit3 className="w-2.5 h-2.5 text-neutral-600 group-hover:text-emerald-400 transition-colors" />
                      </div>
                      <p className="text-neutral-300 italic text-[11px] leading-relaxed">
                        &ldquo;{activeAgent.meta.tone}&rdquo;
                      </p>
                    </div>

                    <div className="bg-neutral-950 p-2.5 rounded border border-neutral-800/80">
                      <span className="text-[10px] uppercase tracking-wider text-neutral-500 block font-semibold mb-1">
                        Lore Policy
                      </span>
                      <div className="text-neutral-300 font-mono text-[11px] space-y-0.5">
                        <div><span className="text-emerald-400 font-semibold">READ:</span> [{activeAgent.lore_policy.read.join(', ')}]</div>
                        <div><span className="text-blue-400 font-semibold">WRITE:</span> [{activeAgent.lore_policy.write.join(', ')}]</div>
                      </div>
                    </div>

                    <div 
                      onClick={() => startEditingDossier(activeAgent.id)}
                      className="bg-neutral-950 p-2.5 rounded border border-neutral-800/80 hover:border-neutral-700 transition-colors cursor-pointer group"
                      title="Click to add or edit constraints"
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] uppercase tracking-wider text-neutral-500 block font-semibold">
                          Architectural Constraints ({activeAgent.meta.constraints.length})
                        </span>
                        <Edit3 className="w-2.5 h-2.5 text-neutral-600 group-hover:text-emerald-400 transition-colors" />
                      </div>
                      <ul className="text-[11px] text-neutral-300 list-disc list-inside space-y-0.5">
                        {activeAgent.meta.constraints.map((c, i) => (
                          <li key={i} className="truncate" title={c}>{c}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

                {showAgentDetails && (
                  <div className="bg-neutral-950 p-3.5 rounded border border-neutral-800 text-xs flex flex-col gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-neutral-400 font-bold">
                      System Instruction Prompt
                    </span>
                    <pre className="text-[11px] text-neutral-300 whitespace-pre-wrap font-mono bg-neutral-900 p-3 rounded border border-neutral-800 leading-relaxed">
                      {activeAgent.system_instruction}
                    </pre>
                    <p className="text-[10px] text-neutral-500 italic">
                      {activeAgent.meta.description}
                    </p>
                  </div>
                )}
              </div>
            );
          })()}
              </>
            )}

            {/* Ingestion & Graph Operations */}
            {(activeNavTab === 'all' || activeNavTab === 'ingest') && (
              <>
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
                    Evaluates all ingested vector nodes for the active workspace, triggers structured language relationship extraction (using <span className="text-blue-400 font-bold font-mono">gemini-3.6-flash</span>) for subjects, actions, and objects, and constructs a robust semantic relationship mesh.
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
              </>
            )}

            {/* Module D: Lorepack Database Explorer */}
            {(activeNavTab === 'all' || activeNavTab === 'explorer') && (
              <section className="bg-neutral-900 border border-neutral-800 rounded flex flex-col min-h-[350px]">
            <div className="border-b border-neutral-800 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-neutral-900/60">
              <div className="flex items-center space-x-2">
                <Database className="h-4 w-4 text-emerald-400" />
                <h2 className="text-xs font-bold text-white uppercase tracking-wider">IndexedDB Memory Store Explorer</h2>
              </div>
              <input
                type="text"
                placeholder="Search nodes or triplets..."
                value={lorepackSearchQuery}
                onChange={(e) => setLorepackSearchQuery(e.target.value)}
                className="bg-neutral-950 text-neutral-200 border border-neutral-800 px-3 py-1 rounded font-mono text-xs focus:outline-none w-full sm:w-64"
              />
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
              <div className="p-4 max-h-[350px] flex flex-col justify-between overflow-hidden">
                <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                  {exploreTab === 'NODES' ? (
                    nodesList.length === 0 ? (
                      <div className="h-full flex items-center justify-center py-10">
                        <p className="text-xs text-neutral-500 uppercase tracking-wider">No ingested memory nodes found</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {nodesList
                          .filter(n => n.text.toLowerCase().includes(lorepackSearchQuery.toLowerCase()))
                          .slice((nodesPage - 1) * ITEMS_PER_PAGE, nodesPage * ITEMS_PER_PAGE).map((node) => (
                          <div
                            key={node.id}
                            onClick={() => setSelectedRecord(node)}
                            className={`p-2.5 rounded border text-left cursor-pointer transition-colors ${selectedRecord?.id === node.id ? 'bg-neutral-950 border-emerald-500/50' : 'bg-neutral-950/40 border-neutral-800/80 hover:border-neutral-700'}`}
                          >
                            <div className="flex items-center justify-between text-[10px] mb-1 font-mono">
                              <span className="text-neutral-400 truncate max-w-[120px] font-bold uppercase">&gt; {node.source}</span>
                              <span className="text-neutral-500 font-mono text-[9px]">{new Date(node.timestamp).toLocaleTimeString()}</span>
                            </div>
                            <p className="text-xs text-neutral-300 line-clamp-2 leading-relaxed font-mono">
                              {lorepackSearchQuery 
                                ? node.text.split(new RegExp(`(${lorepackSearchQuery})`, 'gi')).map((part, i) => 
                                    part.toLowerCase() === lorepackSearchQuery.toLowerCase() ? 
                                      <span key={i} className="bg-emerald-900 text-emerald-100">{part}</span> : part
                                  )
                                : node.text
                              }
                            </p>
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
                        {edgesList
                          .filter(e => e.s.toLowerCase().includes(lorepackSearchQuery.toLowerCase()) || e.o.toLowerCase().includes(lorepackSearchQuery.toLowerCase()))
                          .slice((edgesPage - 1) * ITEMS_PER_PAGE, edgesPage * ITEMS_PER_PAGE).map((edge) => (
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

                {/* Pagination Controls */}
                {exploreTab === 'NODES' ? (
                  nodesList.length > ITEMS_PER_PAGE && (
                    <div className="flex items-center justify-between border-t border-neutral-800 pt-3 mt-2">
                      <button
                        onClick={() => setNodesPage((p) => Math.max(1, p - 1))}
                        disabled={nodesPage === 1}
                        className="bg-neutral-950 border border-neutral-800 hover:border-neutral-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed text-neutral-400 p-1.5 rounded transition-colors cursor-pointer"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <span className="text-[10px] font-mono font-bold text-neutral-400 uppercase tracking-wider">
                        Page {nodesPage} of {Math.ceil(nodesList.length / ITEMS_PER_PAGE)}
                      </span>
                      <button
                        onClick={() => setNodesPage((p) => Math.min(Math.ceil(nodesList.length / ITEMS_PER_PAGE), p + 1))}
                        disabled={nodesPage >= Math.ceil(nodesList.length / ITEMS_PER_PAGE)}
                        className="bg-neutral-950 border border-neutral-800 hover:border-neutral-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed text-neutral-400 p-1.5 rounded transition-colors cursor-pointer"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  )
                ) : (
                  edgesList.length > ITEMS_PER_PAGE && (
                    <div className="flex items-center justify-between border-t border-neutral-800 pt-3 mt-2">
                      <button
                        onClick={() => setEdgesPage((p) => Math.max(1, p - 1))}
                        disabled={edgesPage === 1}
                        className="bg-neutral-950 border border-neutral-800 hover:border-neutral-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed text-neutral-400 p-1.5 rounded transition-colors cursor-pointer"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <span className="text-[10px] font-mono font-bold text-neutral-400 uppercase tracking-wider">
                        Page {edgesPage} of {Math.ceil(edgesList.length / ITEMS_PER_PAGE)}
                      </span>
                      <button
                        onClick={() => setEdgesPage((p) => Math.min(Math.ceil(edgesList.length / ITEMS_PER_PAGE), p + 1))}
                        disabled={edgesPage >= Math.ceil(edgesList.length / ITEMS_PER_PAGE)}
                        className="bg-neutral-950 border border-neutral-800 hover:border-neutral-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed text-neutral-400 p-1.5 rounded transition-colors cursor-pointer"
                      >
                        <ChevronRight className="h-3.5 w-3.5" />
                      </button>
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
            )}

            {/* Module F & G: Transport & Keys (when in transport tab) */}
            {activeNavTab === 'transport' && (
              <>
                {transportModule}
                {apiKeysModule}
              </>
            )}

            {/* MVP Core Function Test Matrix (when in test-matrix tab) */}
            {activeNavTab === 'test-matrix' && testMatrixModule}

          </div>

        {/* Right Column (4 cols): System Log & Transport Archive operations */}
        <div className="lg:col-span-4 flex flex-col gap-6">

          {/* Module E: System Console Telemetry Logs */}
          {processLogsModule}

          {/* Module G: API Key Load Balancer Pool Manager */}
          {activeNavTab === 'all' && (
          <section className="bg-neutral-900 border border-neutral-800 rounded flex flex-col">
            <div className="border-b border-neutral-800 px-4 py-3 flex items-center justify-between bg-neutral-900/60">
              <div className="flex items-center space-x-2">
                <Cpu className="h-4 w-4 text-emerald-400" />
                <h2 className="text-xs font-bold text-white uppercase tracking-wider">Multi-Lane API Load Balancer</h2>
              </div>
              <span className="text-[10px] text-neutral-500">SYS_LANES</span>
            </div>

            <div className="p-4 flex flex-col gap-3">
              <p className="text-[11px] text-neutral-400 leading-relaxed font-mono">
                Register multiple Gemini API Keys. The engine automatically rotates requests sequentially across active lanes to bypass quota boundaries.
              </p>

              <div className="flex gap-2">
                <input
                  type="password"
                  value={newKeyInput}
                  onChange={(e) => setNewKeyInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      addApiKey(newKeyInput);
                    }
                  }}
                  className="flex-1 bg-neutral-950 text-neutral-200 border border-neutral-800 px-3 py-1.5 rounded font-mono text-xs focus:outline-none focus:border-neutral-700"
                  placeholder="AIzaSy..."
                />
                <button
                  onClick={() => addApiKey(newKeyInput)}
                  disabled={!newKeyInput.trim()}
                  className="bg-emerald-950 border border-emerald-800 text-emerald-300 hover:bg-emerald-900 hover:text-white font-bold px-3 py-1.5 rounded text-xs uppercase tracking-wider transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  Register Lane
                </button>
              </div>

              {customApiKeys.length > 0 ? (
                <div className="space-y-1.5 max-h-[110px] overflow-y-auto border border-neutral-800 rounded bg-neutral-950 p-2">
                  {customApiKeys.map((key, index) => (
                    <div key={index} className="flex items-center justify-between text-xs font-mono">
                      <span className="text-emerald-400 font-bold">
                        [LANE {index + 1}] ••••{key.slice(-6)}
                      </span>
                      <button
                        onClick={() => removeApiKey(index)}
                        className="text-[10px] text-rose-400 hover:text-rose-300 uppercase font-bold px-1 py-0.5 cursor-pointer"
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[10px] text-neutral-500 italic uppercase">
                  No custom API keys registered. Falling back to secure server-side proxy lanes.
                </p>
              )}
            </div>
          </section>
          )}

          {/* Module F: Lorepack Archive Transport (Import/Export) */}
          {activeNavTab === 'all' && (
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
          )}

          {/* MVP Core Function Test Matrix Module */}
          {activeNavTab === 'all' && (
          <section className="bg-neutral-900 border border-neutral-800 rounded flex flex-col">
            <div className="border-b border-neutral-800 px-4 py-3 flex items-center justify-between bg-neutral-900/60">
              <div className="flex items-center space-x-2">
                <Layers className="h-4 w-4 text-purple-400" />
                <h2 className="text-xs font-bold text-white uppercase tracking-wider">MVP Core Test Matrix v0.1</h2>
              </div>
              <span className="text-[10px] text-neutral-500">SYS_TEST</span>
            </div>

            <div className="p-4 flex flex-col gap-3">
              <p className="text-[11px] text-neutral-400 leading-relaxed font-mono">
                Verify the integrity of the Lorepack compilation, database, and export/import round-trip pipeline under isolated workspaces.
              </p>

              <div>
                <button
                  onClick={handleRunTestSuite}
                  disabled={testState.isRunning}
                  className="w-full bg-purple-950/40 border border-purple-800 text-purple-300 font-bold px-4 py-2 rounded text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-colors hover:bg-purple-900 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${testState.isRunning ? 'animate-spin' : ''}`} />
                  {testState.isRunning ? 'Running Verification Pipeline...' : 'Run Core Validation Matrix'}
                </button>
              </div>

              {testState.results.length > 0 && (
                <div className="border border-neutral-800 rounded bg-neutral-950 p-2 text-xs space-y-1.5 max-h-[220px] overflow-y-auto">
                  {testState.results.map((res) => {
                    let badgeColor = 'text-neutral-500 border-neutral-800 bg-neutral-950/40';
                    if (res.status === 'RUNNING') badgeColor = 'text-amber-500 border-amber-800 bg-amber-950/30 animate-pulse';
                    if (res.status === 'PASSED') badgeColor = 'text-emerald-400 border-emerald-800 bg-emerald-950/40';
                    if (res.status === 'FAILED') badgeColor = 'text-rose-400 border-rose-800 bg-rose-950/40';

                    return (
                      <div key={res.id} className="flex items-start justify-between gap-2 py-1 border-b border-neutral-900 last:border-0 text-[11px]">
                        <div className="flex-1 min-w-0 text-left">
                          <span className="font-bold text-neutral-400 mr-2">{res.id}</span>
                          <span className="font-bold text-white">{res.name}</span>
                          <p className="text-[10px] text-neutral-400 mt-0.5 font-mono leading-tight">{res.message}</p>
                          {res.details && (
                            <span className="inline-block mt-0.5 text-[9px] text-neutral-500 font-mono italic">Details: {res.details}</span>
                          )}
                        </div>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider border shrink-0 ${badgeColor}`}>
                          {res.status}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
          )}

          {/* Clean Store / Workspace Reset Module */}
          {(activeNavTab === 'all' || activeNavTab === 'transport') && (
          <section className="bg-neutral-900 border border-neutral-800 rounded p-4 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-2 text-rose-400">
                <AlertTriangle className="h-4 w-4" />
                Destructive System Actions
              </h3>
              {(isPurging || isNuking) && (
                <span className="flex items-center gap-1.5 text-[9px] text-amber-400 bg-amber-950/40 border border-amber-800/60 px-2 py-0.5 rounded font-mono uppercase tracking-wider">
                  <RefreshCw className="h-3 w-3 animate-spin" />
                  Processing...
                </span>
              )}
            </div>

            {/* In-Card Destructive Action Feedback Alert */}
            {destructiveFeedback && (
              <div
                id="destructiveFeedbackBanner"
                className={`p-3 rounded border text-xs font-mono transition-all animate-fadeIn ${
                  destructiveFeedback.type === 'success'
                    ? 'bg-emerald-950/60 border-emerald-500/60 text-emerald-200 shadow-sm shadow-emerald-950/40'
                    : destructiveFeedback.type === 'info'
                    ? 'bg-amber-950/60 border-amber-500/60 text-amber-200 shadow-sm shadow-amber-950/40'
                    : 'bg-red-950/60 border-red-500/60 text-red-200 shadow-sm shadow-red-950/40'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 font-bold uppercase tracking-wider text-[11px]">
                    {destructiveFeedback.type === 'success' && <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />}
                    {destructiveFeedback.type === 'info' && <RefreshCw className="h-4 w-4 text-amber-400 animate-spin shrink-0" />}
                    {destructiveFeedback.type === 'error' && <AlertTriangle className="h-4 w-4 text-red-400 shrink-0" />}
                    <span>{destructiveFeedback.title}</span>
                  </div>
                  <button
                    onClick={() => setDestructiveFeedback(null)}
                    className="text-neutral-400 hover:text-white cursor-pointer p-0.5 rounded hover:bg-white/10"
                    title="Dismiss"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <p className="mt-1.5 text-[10px] leading-relaxed text-neutral-300">
                  {destructiveFeedback.message}
                </p>
                <div className="mt-2 flex items-center justify-between text-[9px] text-neutral-400 border-t border-neutral-800/80 pt-1.5 uppercase">
                  <span>ACTION: {destructiveFeedback.action}</span>
                  <span>{destructiveFeedback.timestamp}</span>
                </div>
              </div>
            )}
            
            <div className="space-y-1">
              <div className="text-[10px] text-neutral-300 font-bold uppercase tracking-wider">
                Operation A: Purge Agent ({agentId})
              </div>
              <p className="text-[10px] text-neutral-500 uppercase leading-relaxed">
                Flush all IndexedDB nodes and relationship edge configurations for {agentId}. This action is irreversible.
              </p>
              <button
                id="purgeAgentBtn"
                disabled={isPurging || isNuking}
                onClick={clearAgentMemory}
                className="w-full mt-1 bg-rose-950/40 border border-rose-900/60 hover:bg-rose-950 hover:text-white text-rose-300 font-bold px-4 py-2 rounded text-xs uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isPurging ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-rose-300" />
                    <span>Wiping Memory ({agentId})...</span>
                  </>
                ) : (
                  <>
                    <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                    <span>Wipe Agent Memory Space</span>
                  </>
                )}
              </button>
            </div>

            <div className="border-t border-neutral-800 pt-3 space-y-1">
              <div className="text-[10px] text-red-400 font-bold uppercase tracking-wider">
                Operation B: Whole-Vault Nuke
              </div>
              <p className="text-[10px] text-neutral-500 uppercase leading-relaxed">
                Destroy the entire mythos_vault database across all agents. Closes connection, deletes the database, and reinitializes cleanly.
              </p>
              <button
                id="nukeVaultBtn"
                data-action="nukeTrigger"
                disabled={isPurging || isNuking}
                onClick={nukeWholeVault}
                className="w-full mt-1 bg-red-950/60 border border-red-800 hover:bg-red-900 hover:text-white text-red-200 font-bold px-4 py-2 rounded text-xs uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
              >
                {isNuking ? (
                  <>
                    <RefreshCw className="h-3.5 w-3.5 animate-spin text-red-200" />
                    <span>Nuking Vault Database...</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                    <span>Nuke Vault</span>
                  </>
                )}
              </button>
            </div>
          </section>
          )}

          {/* Monolithic Compatibility Elements */}
          <div id="nukeModal" style={{ display: 'none' }}>
            <button id="nukeConfirmBtn" onClick={nukeWholeVault}>CONFIRM</button>
            <button id="nukeCancelBtn" onClick={() => {}}>CANCEL</button>
          </div>

        </div>
      </main>
      )}

      {/* Floating Global Feedback Notification Toast for High-Visibility System Feedback */}
      {destructiveFeedback && (
        <div
          id="globalDestructiveToast"
          className={`fixed bottom-8 right-8 z-50 max-w-md w-full p-4 rounded-lg shadow-2xl border backdrop-blur-md transition-all duration-300 ${
            destructiveFeedback.type === 'success'
              ? 'bg-neutral-900/95 border-emerald-500/80 text-emerald-200 shadow-emerald-950/40 ring-1 ring-emerald-500/30'
              : destructiveFeedback.type === 'info'
              ? 'bg-neutral-900/95 border-amber-500/80 text-amber-200 shadow-amber-950/40 ring-1 ring-amber-500/30'
              : 'bg-neutral-900/95 border-rose-500/80 text-rose-200 shadow-rose-950/40 ring-1 ring-rose-500/30'
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2.5 font-bold uppercase tracking-wider text-xs">
              {destructiveFeedback.type === 'success' && <CheckCircle className="h-4 w-4 text-emerald-400 shrink-0" />}
              {destructiveFeedback.type === 'info' && <RefreshCw className="h-4 w-4 text-amber-400 animate-spin shrink-0" />}
              {destructiveFeedback.type === 'error' && <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />}
              <span>{destructiveFeedback.title}</span>
            </div>
            <button
              onClick={() => setDestructiveFeedback(null)}
              className="text-neutral-400 hover:text-white cursor-pointer p-1 rounded hover:bg-white/10"
              title="Close Notification"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <p className="mt-2 text-[11px] text-neutral-300 leading-relaxed font-mono">
            {destructiveFeedback.message}
          </p>
          <div className="mt-2.5 pt-2 border-t border-neutral-800 flex items-center justify-between text-[9px] text-neutral-400 uppercase tracking-wider">
            <span className="font-semibold text-neutral-400">SYSTEM FEEDBACK • {destructiveFeedback.action}</span>
            <span>{destructiveFeedback.timestamp}</span>
          </div>
        </div>
      )}

      {/* Batch Ingestion Summary Modal */}
      <BatchIngestionSummary 
        data={ingestionSummary} 
        onClose={() => setIngestionSummary(null)} 
      />

      {/* Settings Modal Overlay */}
      {showSettingsModal && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg shadow-2xl relative">
            <button
              onClick={() => setShowSettingsModal(false)}
              className="absolute -top-3 -right-3 bg-neutral-800 hover:bg-neutral-700 text-neutral-300 hover:text-white border border-neutral-700 p-1.5 rounded-full z-10 transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
            {apiKeysModule}
          </div>
        </div>
      )}

      {/* Footer System Parameters */}
      <footer id="appFooter" className="border-t border-neutral-800 bg-neutral-900/50 px-4 py-2 flex flex-col md:flex-row items-center justify-between gap-2 text-[10px] text-neutral-500 shrink-0 font-mono">
        <p className="uppercase tracking-widest text-[9px] text-center md:text-left">
          SYSTEM ENVIRONMENT: PRODUCTION PREVIEW CONSOLE — ALL SYSTEMS OPERATIONAL
        </p>
        <p className="text-neutral-300 font-semibold uppercase tracking-wider text-center">
          &copy; 2026 MERK MORASSI
        </p>
        <p className="uppercase tracking-widest text-[9px] text-neutral-400 text-center md:text-right">
          POWERED BY GEMINI-3.8-FLASH &amp; LOCAL INDEXEDDB
        </p>
      </footer>
    </div>
  );
}
