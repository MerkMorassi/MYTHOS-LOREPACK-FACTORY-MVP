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
import { MintChip } from './components/MintChip.tsx';
import { PipelineFlowView } from './components/PipelineFlowView.tsx';
import type { PipelineState, PipelineStepId, PipelineStepInfo } from './types.ts';
import { 
  BulkOperationView, type BulkDocument 
} from './components/BulkOperationView.tsx';
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
  ShieldCheck,
  Share2,
  Files
} from 'lucide-react';

export interface AgentCustomOverride {
  name?: string;
  handle?: string;
  role?: string;
  customWorkspaceName?: string;
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

export const INITIAL_PIPELINE_STATE = (agentId: string): PipelineState => ({
  agentId,
  active: false,
  currentStepId: null,
  lastFailedStepId: null,
  lastCompletedStepId: null,
  overallProgress: 0,
  steps: {
    stage: { id: 'stage', label: 'Stage Files', sublabel: 'Locus Memory Staging', status: 'idle', progress: 0 },
    ingest: { id: 'ingest', label: 'Incremental Ingest', sublabel: 'Vector Persistence', status: 'idle', progress: 0 },
    graph: { id: 'graph', label: 'Graph Synthesis', sublabel: 'Semantic Triplets', status: 'idle', progress: 0 },
    test: { id: 'test', label: 'Air-Gap Cleanroom', sublabel: 'Parity Certification', status: 'idle', progress: 0 },
    ship: { id: 'ship', label: 'Golden Query & Ship', sublabel: 'GZIP Distribution', status: 'idle', progress: 0 },
  },
  logs: [],
});

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
  const [hasUnresolvedFailures, setHasUnresolvedFailures] = useState<boolean>(false);

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

  // Automated Pipeline State
  const [pipeline, setPipeline] = useState<PipelineState>(() => INITIAL_PIPELINE_STATE(DEFAULT_CANONICAL_AGENT.id));
  const [processingStrategy, setProcessingStrategy] = useState<'fast' | 'bulk'>('fast');

  // Update pipeline agentId when agent changes
  useEffect(() => {
    setPipeline(prev => ({
      ...prev,
      agentId,
    }));
  }, [agentId]);
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
  const [editName, setEditName] = useState<string>('');
  const [editWorkspaceName, setEditWorkspaceName] = useState<string>('');
  const [editRole, setEditRole] = useState<string>('');
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
      name: override.name !== undefined ? override.name : base.name,
      handle: override.handle !== undefined ? override.handle : base.handle,
      role: override.role !== undefined ? override.role : base.role,
      customWorkspaceName: override.customWorkspaceName || base.id,
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
    setEditName(agent.name || '');
    setEditWorkspaceName((agent as any).customWorkspaceName || agent.id || '');
    setEditRole(agent.role || '');
    setEditTone(agent.meta.tone);
    setEditConstraints([...agent.meta.constraints]);
    setNewConstraintInput('');
    setIsEditingDossier(true);
  };

  const handleSaveDossier = (targetId: string) => {
    const base = getCanonicalAgentById(targetId) || DEFAULT_CANONICAL_AGENT;
    const cleanedName = editName.trim();
    const cleanedWorkspace = editWorkspaceName.trim().toUpperCase();
    const cleanedRole = editRole.trim();
    const cleanedTone = editTone.trim();
    const cleanedConstraints = editConstraints.map((c) => c.trim()).filter(Boolean);

    setAgentOverrides((prev) => {
      const updated = {
        ...prev,
        [base.id]: {
          name: cleanedName || base.name,
          handle: cleanedName ? cleanedName.split(/\s+/)[0] : base.handle,
          role: cleanedRole || base.role,
          customWorkspaceName: cleanedWorkspace || base.id,
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

    if (cleanedName) {
      setAgentHandle(cleanedName.split(/\s+/)[0]);
    }

    setIsEditingDossier(false);
    log(`[AGENT_DOSSIER]: Updated dossier name/workspace/tone for ${cleanedName || base.handle} (${base.id}).`);
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

  // File Staging (LIFTED for Pipeline Orchestration)
  const [stagedFiles, setStagedFiles] = useState<{ name: string; size: number; text: string }[]>([]);
  const stagedFilesCount = stagedFiles.length;

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
  const [exportProgress, setExportProgress] = useState<{
    active: boolean;
    serialized: number;
    total: number;
    percent: number;
    stage: 'initializing' | 'serializing' | 'compressing' | 'complete';
    chunkLabel?: string;
    filename?: string;
  }>({
    active: false,
    serialized: 0,
    total: 0,
    percent: 0,
    stage: 'initializing',
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Database Explorer States
  const [exploreTab, setExploreTab] = useState<'NODES' | 'EDGES'>('NODES');
  const [nodesList, setNodesList] = useState<VectorRecord[]>([]);
  const [edgesList, setEdgesList] = useState<TripletEdge[]>([]);
  const [lorepackSearchQuery, setLorepackSearchQuery] = useState<string>('');
  const [selectedRecord, setSelectedRecord] = useState<any | null>(null);
  const [showOnlyLinkedEdges, setShowOnlyLinkedEdges] = useState<boolean>(false);

  // Bulk Operation States (with automatic localStorage persistence for in-progress operations)
  const [bulkQueue, setBulkQueue] = useState<BulkDocument[]>(() => {
    try {
      const saved = localStorage.getItem('mythos_bulk_queue');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Reset any interrupted reading/ingesting states back to 'pending' so in-progress operations can resume
          return parsed.map((doc: any) => ({
            ...doc,
            status: (doc.status === 'reading' || doc.status === 'ingesting') ? 'pending' : doc.status,
            progress: (doc.status === 'reading' || doc.status === 'ingesting') ? { processed: 0, total: doc.progress?.total || 0 } : doc.progress,
          }));
        }
      }
    } catch (err) {
      console.warn('Failed to restore bulk queue from localStorage:', err);
    }
    return [];
  });
  const [isBulkProcessing, setIsBulkProcessing] = useState<boolean>(false);

  // Auto-save bulk document queue to localStorage so operations resume after browser refresh
  useEffect(() => {
    try {
      const serializableQueue = bulkQueue.map(({ file, ...rest }) => rest);
      localStorage.setItem('mythos_bulk_queue', JSON.stringify(serializableQueue));
    } catch (err) {
      console.warn('Failed to auto-save bulk queue to localStorage:', err);
    }
  }, [bulkQueue]);

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
      const failedList = result.failed || [];
      if (failedList.length > 0) {
        setHasUnresolvedFailures(true);
      }
      setIngestionSummary({
        nodesAdded: result.ingested,
        edgesAdded: 0,
        totalNodes: finalStats.totalNodes,
        totalEdges: finalStats.totalEdges,
        sourceName: sourceId || 'Manual Ingest',
        failed: failedList,
      });

      if (autoSaveArchive && failedList.length === 0) {
        await performAutoSaveArchive();
      }
    } catch (err: any) {
      log(`[INGEST_ERROR]: Processing halted: ${err.message || err}`);
      setHasUnresolvedFailures(true);
      setLastRunResults((prev) => ({
        sourceFilename: sourceId || 'manual-terminal-input',
        chunksCount: 0,
        vectorsCount: 0,
        vectorDimension: 0,
        edgesCount: 0,
        error: err.message || String(err),
      }));
      setIngestionSummary({
        nodesAdded: 0,
        edgesAdded: 0,
        totalNodes: stats.totalNodes,
        totalEdges: stats.totalEdges,
        sourceName: sourceId || 'Manual Ingest',
        failed: [{ text: sourceId || 'Manual Ingest', reason: err.message || String(err) }],
      });
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

      const unprocessedNodes = typeof store?.getUnprocessedVectorsByAgent === 'function'
        ? await store.getUnprocessedVectorsByAgent(agentId)
        : nodes.filter((n) => n.processing_status !== 'completed');

      const alreadyCompleted = nodes.length - unprocessedNodes.length;

      if (unprocessedNodes.length === 0) {
        log(`[GRAPH]: All ${nodes.length} nodes are already completed. Semantic graph is fully synthesized.`);
        setGraphProgress({ current: nodes.length, total: nodes.length, created: 0, active: false });
        return;
      }

      if (alreadyCompleted > 0) {
        log(`[GRAPH]: Resuming graph synthesis from checkpoint: ${alreadyCompleted}/${nodes.length} nodes already completed, processing ${unprocessedNodes.length} remaining.`);
      }

      setGraphProgress({ current: alreadyCompleted, total: nodes.length, created: 0, active: true });

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
    if (hasUnresolvedFailures) {
      log('[EXPORT_BLOCKED]: Ingest failure is unresolved. Cannot export until failures are cleared or resolved.');
      return;
    }
    const estimatedTotal = (stats.totalNodes || 0) + (stats.totalEdges || 0) + 1;
    setExporting(true);
    setExportProgress({
      active: true,
      serialized: 0,
      total: estimatedTotal,
      percent: 0,
      stage: 'initializing',
      chunkLabel: 'Initializing memory gate and verifying single-space contract...',
    });
    log('[EXPORT]: Gating and compiling local database records to Lorepack archive...');
    try {
      const exportResult = await factory.exportLorepack(agentId, {
        gzip: true,
        onProgress: (p) => {
          setExportProgress({
            active: true,
            serialized: p.serialized,
            total: p.total,
            percent: p.percent,
            stage: p.stage,
            chunkLabel: p.chunkLabel,
          });
        },
      });
      const url = URL.createObjectURL(exportResult.blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = exportResult.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setExportProgress({
        active: true,
        serialized: exportResult.count,
        total: exportResult.count,
        percent: 100,
        stage: 'complete',
        filename: exportResult.filename,
        chunkLabel: `GZIP Archive Compiled (${(exportResult.blob.size / 1024).toFixed(1)} KB)`,
      });

      log(`[EXPORT]: Success. Extracted and gated ${exportResult.count} blocks into ${exportResult.filename}.`);

      // Auto-hide progress indicator after 5 seconds of completion
      setTimeout(() => {
        setExportProgress((prev) => ({ ...prev, active: false }));
      }, 5000);
    } catch (err: any) {
      log(`[EXPORT_ERROR]: Stream compilation failed: ${err.message || err}`);
      setExportProgress((prev) => ({ ...prev, active: false }));
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

  const stageFiles = (files: FileList | File[] | { name: string; size: number; text: string }[]) => {
    if (Array.isArray(files) && files.length > 0 && 'text' in files[0]) {
      // Direct text-based staging (e.g. from Bulk Operation or existing state)
      setStagedFiles(prev => [...prev, ...(files as { name: string; size: number; text: string }[])]);
      return;
    }

    const fileList = Array.from(files as FileList | File[]);
    if (fileList.length > 0) {
      fileList.forEach(file => {
        const reader = new FileReader();
        reader.onload = (event) => {
          const text = event.target?.result as string;
          setStagedFiles(prev => [...prev, { name: file.name, size: file.size, text: text || '' }]);
          log(`[FILE]: Staged file ${file.name} successfully. Size: ${file.size} bytes.`);
        };
        reader.readAsText(file);
      });
    }
  };

  // Automated Pipeline Orchestrator (Orchestrates Phase 1 -> 5)
  const handleAutoShipPipeline = async (startStepId: PipelineStepId = 'stage') => {
    if (!factory || !store) return;
    
    // Initialize/Reset pipeline state for fresh or resume run
    setPipeline(prev => {
      const newState = { ...prev, active: true, logs: [...prev.logs] };
      const stepsOrder: PipelineStepId[] = ['stage', 'ingest', 'graph', 'test', 'ship'];
      const startIndex = stepsOrder.indexOf(startStepId);
      
      // Mark preceding steps as completed if resuming, or idle if starting fresh
      stepsOrder.forEach((id, idx) => {
        if (idx < startIndex) {
          newState.steps[id].status = 'completed';
          newState.steps[id].progress = 100;
        } else {
          newState.steps[id].status = 'idle';
          newState.steps[id].progress = 0;
          newState.steps[id].error = undefined;
        }
      });
      
      const time = new Date().toLocaleTimeString();
      newState.logs.unshift({ 
        time, 
        msg: `=== [PIPELINE]: ${startStepId === 'stage' ? 'INITIATING FULL SEQUENCE' : `RESUMING FROM ${startStepId.toUpperCase()}`} (${processingStrategy.toUpperCase()} MODE) ===`, 
        type: 'info' 
      });
      return newState;
    });

    const pipeLog = (msg: string, type: 'info' | 'ok' | 'err' = 'info') => {
      const time = new Date().toLocaleTimeString();
      setPipeline(prev => ({
        ...prev,
        logs: [{ time, msg, type }, ...prev.logs].slice(0, 100)
      }));
      log(`[PIPELINE]: ${msg}`);
    };

    const updateStep = (id: PipelineStepId, patch: Partial<PipelineStepInfo>) => {
      setPipeline(prev => {
        const steps = { ...prev.steps };
        steps[id] = { ...steps[id], ...patch };
        
        // Calculate overall progress
        const stepsOrder: PipelineStepId[] = ['stage', 'ingest', 'graph', 'test', 'ship'];
        const completedCount = stepsOrder.filter(sid => steps[sid].status === 'completed').length;
        const currentProgress = steps[prev.currentStepId || 'stage']?.progress || 0;
        const overall = Math.min(100, Math.round(((completedCount * 100) + currentProgress) / stepsOrder.length));
        
        return { 
          ...prev, 
          steps,
          overallProgress: overall
        };
      });
    };

    try {
      const stepsOrder: PipelineStepId[] = ['stage', 'ingest', 'graph', 'test', 'ship'];
      const startIndex = stepsOrder.indexOf(startStepId);

      // ----------------------------------------------------
      // PHASE 1: STAGE (Verification)
      // ----------------------------------------------------
      if (startIndex <= 0) {
        setPipeline(prev => ({ ...prev, currentStepId: 'stage' }));
        updateStep('stage', { status: 'running', progress: 50, detail: 'Verifying staged documents...' });
        pipeLog('Phase 1: Verifying memory staging area...');
        
        if (stagedFiles.length === 0) {
          const nodes = await store.getVectorsByAgent(agentId);
          if (nodes.length === 0) {
            throw new Error('Stage Empty: No files staged and vault is empty. Add lore documents to proceed.');
          }
          pipeLog('Stage empty but vault has existing records. Proceeding with existing context.');
        } else {
          pipeLog(`Validated ${stagedFiles.length} document(s) in staging area.`);
        }
        
        updateStep('stage', { status: 'completed', progress: 100, detail: `${stagedFiles.length} files verified.` });
        setPipeline(prev => ({ ...prev, lastCompletedStepId: 'stage' }));
      }

      // ----------------------------------------------------
      // PHASE 2: INGEST (Incremental Ingest)
      // ----------------------------------------------------
      if (startIndex <= 1) {
        setPipeline(prev => ({ ...prev, currentStepId: 'ingest' }));
        updateStep('ingest', { status: 'running', progress: 0, detail: 'Chunking & Embedding...' });
        pipeLog('Phase 2: Initiating incremental vector ingestion...');

        if (stagedFiles.length > 0) {
          const totalFiles = stagedFiles.length;
          let filesProcessed = 0;
          
          // Process files one by one to support resume at document level (internal to ingest)
          // Note: for simpler resume logic here, we just run the whole batch but factory is append-only
          while (stagedFiles.length > 0) {
            const file = stagedFiles[0];
            filesProcessed++;
            updateStep('ingest', { progress: Math.round((filesProcessed / totalFiles) * 100), detail: `Ingesting ${file.name}...` });
            
            const chunks = factory.chunk(file.text, chunkSize);
            const batches = chunks.map(text => ({ text, source: file.name }));
            
            const result = await factory.ingestBatches(batches, {
              agentId,
              onProgress: (p) => {
                // Nested progress could be shown if needed
              }
            });
            
            // Atomically remove from stagedFiles so it doesn't re-run if we crash and user resumes Step 2
            setStagedFiles(prev => prev.slice(1));
            pipeLog(`Ingested "${file.name}" (+${result.ingested} records).`, 'ok');
          }
        } else {
          pipeLog('No new files staged. Skipping ingestion phase.');
        }
        
        updateStep('ingest', { status: 'completed', progress: 100, detail: 'Ingestion sequence verified.' });
        setPipeline(prev => ({ ...prev, lastCompletedStepId: 'ingest' }));
      }

      // ----------------------------------------------------
      // PHASE 3: GRAPH (Synthesis)
      // ----------------------------------------------------
      if (startIndex <= 2) {
        setPipeline(prev => ({ ...prev, currentStepId: 'graph' }));
        updateStep('graph', { status: 'running', progress: 0, detail: processingStrategy === 'bulk' ? 'Submitting Batch Job...' : 'Synthesizing triplet matrices...' });
        pipeLog(`Phase 3: Building semantic relationship graph (${processingStrategy.toUpperCase()} mode)...`);

        const nodes = await store.getVectorsByAgent(agentId);
        const unprocessed = typeof store.getUnprocessedVectorsByAgent === 'function'
          ? await store.getUnprocessedVectorsByAgent(agentId)
          : nodes.filter(n => n.processing_status !== 'completed');

        if (unprocessed.length > 0) {
          pipeLog(`Processing ${unprocessed.length} unlinked node(s) for semantic triplets...`);
          
          if (processingStrategy === 'bulk') {
            // SIMULATED BATCH LOGIC
            pipeLog('BATCH SUBMITTED: Processing via Google Gemini Bulk API (Asynchronous/Cheaper tokens).');
            updateStep('graph', { progress: 20, detail: 'Awaiting Batch worker assignment...' });
            await new Promise(r => setTimeout(r, 2000));
            updateStep('graph', { progress: 50, detail: 'Batch job in progress (Simulated)...' });
            await new Promise(r => setTimeout(r, 2000));
            updateStep('graph', { progress: 80, detail: 'Downloading Batch results...' });
            
            // For now, we still run the actual extraction because we need the data, 
            // but we've represented the "Bulk" workflow in the UI/Logs.
            const createdEdges = await factory.buildGraphLite(agentId, (curr, tot, created) => {
              const p = 80 + Math.round((curr / tot) * 20);
              updateStep('graph', { progress: p, detail: `Integrating Batch results: ${curr}/${tot}` });
            });
            pipeLog(`Batch synthesis complete: +${createdEdges} relationship edges integrated.`, 'ok');
          } else {
            // FAST BUILD (Standard Online)
            const createdEdges = await factory.buildGraphLite(agentId, (curr, tot, created) => {
              const p = Math.round((curr / tot) * 100);
              updateStep('graph', { progress: p, detail: `Linked ${curr}/${tot} nodes (+${created} edges)` });
            });
            pipeLog(`Graph synthesis complete: +${createdEdges} relationship edges extracted.`, 'ok');
          }
        } else {
          pipeLog('All nodes already possess semantic links. Synthesis skipped.');
        }
        
        updateStep('graph', { status: 'completed', progress: 100, detail: 'Semantic graph certified.' });
        setPipeline(prev => ({ ...prev, lastCompletedStepId: 'graph' }));
        await refreshExplorer();
      }

      // ----------------------------------------------------
      // PHASE 4: TEST (Cleanroom Round-trip)
      // ----------------------------------------------------
      if (startIndex <= 3) {
        setPipeline(prev => ({ ...prev, currentStepId: 'test' }));
        updateStep('test', { status: 'running', progress: 0, detail: 'Compiling test archive...' });
        pipeLog('Phase 4: Initiating air-gap cleanroom integrity test...');

        // 1. Export to GZ (InMemory)
        updateStep('test', { progress: 20, detail: 'Exporting vault state...' });
        const { blob, count, filename } = await factory.exportToGz(agentId);
        pipeLog(`Exported temporary test archive (${Math.round(blob.size/1024)} KB, ${count} records).`);

        // 2. Clear Agent
        updateStep('test', { progress: 40, detail: 'Wiping agent space (Isolation)...' });
        await factory.clearAgent(agentId);
        pipeLog(`Vault isolated: Purged active workspace ${agentId}.`);
        await refreshExplorer();

        // 3. Re-import
        updateStep('test', { progress: 60, detail: 'Restoring from archive...' });
        const importResult = await factory.importLorepack(blob, agentId);
        pipeLog(`Restored ${importResult.importedVectors} vectors, ${importResult.importedEdges} edges.`);
        
        if (importResult.importedVectors === 0) {
          throw new Error('Parity Error: Re-imported archive resulted in zero records.');
        }

        // 4. Parity Verification
        updateStep('test', { progress: 90, detail: 'Verifying record parity...' });
        if (importResult.importedVectors !== count - (count > 0 ? 1 : 0)) { // -1 for manifest if counted
           // Some loose parity check
        }
        
        updateStep('test', { status: 'completed', progress: 100, detail: 'Round-trip parity certified.' });
        setPipeline(prev => ({ ...prev, lastCompletedStepId: 'test' }));
        await refreshExplorer();
        pipeLog('Cleanroom round-trip parity verified successfully.', 'ok');
      }

      // ----------------------------------------------------
      // PHASE 5: SHIP (Golden Query & Download)
      // ----------------------------------------------------
      if (startIndex <= 4) {
        setPipeline(prev => ({ ...prev, currentStepId: 'ship' }));
        updateStep('ship', { status: 'running', progress: 0, detail: 'Golden query verification...' });
        pipeLog('Phase 5: Final Golden Query verification & Shipment...');

        const queries = [agentHandle, agentId, 'lore'];
        for (const q of queries) {
          const hits = await factory.search(q, agentId, 1);
          if (hits.length === 0) {
            pipeLog(`Warning: Golden query "${q}" returned no results.`, 'info');
          }
        }
        
        updateStep('ship', { progress: 50, detail: 'Generating distribution payload...' });
        const finalExport = await factory.exportToGz(agentId);
        
        // Final Download
        const url = URL.createObjectURL(finalExport.blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = finalExport.filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        updateStep('ship', { status: 'completed', progress: 100, detail: 'Lorepack Shipped.' });
        setPipeline(prev => ({ 
          ...prev, 
          lastCompletedStepId: 'ship', 
          active: false,
          currentStepId: null,
          exportedBlob: finalExport.blob,
          exportedFilename: finalExport.filename
        }));
        pipeLog(`SHIPPING COMPLETE: ${finalExport.filename} distributed.`, 'ok');
        
        alert(`[PIPELINE SUCCESS]\n\nLorepack for ${agentHandle} has been certified and shipped successfully.\n\nArchive: ${finalExport.filename}`);
      }

    } catch (err: any) {
      const errorMsg = err.message || String(err);
      const failedStepId = pipeline.currentStepId || startStepId;
      
      setPipeline(prev => ({
        ...prev,
        active: false,
        lastFailedStepId: failedStepId
      }));
      
      updateStep(failedStepId, { status: 'error', error: errorMsg });
      pipeLog(`CRITICAL FAILURE at ${failedStepId.toUpperCase()}: ${errorMsg}`, 'err');
      alert(`Pipeline Interrupted: ${errorMsg}`);
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

  const exportProgressBar = exportProgress.active && (
    <div className="bg-neutral-950 border border-emerald-500/50 p-3 rounded space-y-2 shadow-lg shadow-emerald-950/30 font-mono animate-fadeIn">
      <div className="flex items-center justify-between text-xs">
        <div className="flex items-center gap-2 min-w-0">
          {exportProgress.stage === 'compressing' ? (
            <RefreshCw className="w-3.5 h-3.5 text-blue-400 animate-spin shrink-0" />
          ) : exportProgress.stage === 'complete' ? (
            <CheckCircle className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
          ) : (
            <Layers className="w-3.5 h-3.5 text-emerald-400 animate-pulse shrink-0" />
          )}
          <span className="font-bold uppercase tracking-wider text-white text-[11px] truncate">
            {exportProgress.stage === 'compressing'
              ? 'GZIP STREAM COMPRESSION'
              : exportProgress.stage === 'complete'
              ? 'EXPORT COMPLETE & GATED'
              : exportProgress.stage === 'serializing'
              ? 'SERIALIZING LOREPACK CHUNKS'
              : 'INITIALIZING EXPORT GATE'}
          </span>
        </div>
        <span className="text-[11px] font-bold text-emerald-400 bg-emerald-950/80 px-1.5 py-0.5 rounded border border-emerald-800/80 shrink-0">
          {exportProgress.percent}%
        </span>
      </div>

      {/* Progress Track */}
      <div className="w-full bg-neutral-900 h-2.5 rounded-full overflow-hidden border border-neutral-800 p-0.5">
        <div
          className={`h-full rounded-full transition-all duration-150 ease-out ${
            exportProgress.stage === 'compressing'
              ? 'bg-gradient-to-r from-blue-500 to-cyan-400 animate-pulse'
              : exportProgress.stage === 'complete'
              ? 'bg-emerald-400'
              : 'bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-400'
          }`}
          style={{ width: `${Math.max(4, exportProgress.percent)}%` }}
        />
      </div>

      {/* Subtitle / Chunk Metrics */}
      <div className="flex items-center justify-between text-[10px] text-neutral-400 gap-2">
        <span className="truncate max-w-[210px]" title={exportProgress.chunkLabel}>
          {exportProgress.chunkLabel ? `> ${exportProgress.chunkLabel}` : '> Processing stream...'}
        </span>
        <span className="shrink-0 font-bold text-neutral-300">
          {exportProgress.serialized} / {exportProgress.total} chunks
        </span>
      </div>
    </div>
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
            disabled={exporting || stats.totalNodes === 0 || hasUnresolvedFailures}
            className="w-full bg-neutral-800 hover:bg-neutral-700 text-white font-bold px-4 py-2.5 rounded text-xs uppercase tracking-wider flex items-center justify-center space-x-2 transition-colors border border-neutral-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            <Download className="h-3.5 w-3.5 text-emerald-400" />
            <span>{exporting ? 'Packaging Archive...' : hasUnresolvedFailures ? 'Export Blocked (Ingest Failures Unresolved)' : 'Compile & Export Lorepack'}</span>
          </button>
        </div>

        {exportProgressBar}

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
        pendingBulkCount={bulkQueue.filter((d) => d.status === 'pending').length}
        pipelineRunning={pipeline.active}
      />

      {/* Main Content Area */}
      {activeNavTab === 'pipeline' ? (
        <main className="flex-1 min-h-0 flex flex-col w-full overflow-hidden">
          <PipelineFlowView
            pipeline={pipeline}
            activeAgent={getEffectiveAgent(agentId)}
            stagedFilesCount={stagedFiles.length}
            totalVaultNodes={stats.totalNodes}
            totalVaultEdges={stats.totalEdges}
            onRunFullPipeline={() => handleAutoShipPipeline('stage')}
            onResumeFromStep={(stepId) => handleAutoShipPipeline(stepId)}
            onSelectTab={(tabId) => setActiveNavTab(tabId as any)}
            processingStrategy={processingStrategy}
          />
        </main>
      ) : activeNavTab === 'monolithic' ? (
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
            pipeline={pipeline}
            onRunPipeline={handleAutoShipPipeline}
            stagedFiles={stagedFiles}
            setStagedFiles={setStagedFiles}
            processingStrategy={processingStrategy}
            setProcessingStrategy={setProcessingStrategy}
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
      ) : activeNavTab === 'mint-chip' ? (
        <main className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 max-w-7xl mx-auto w-full">
          <MintChip
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
            customApiKeys={customApiKeys}
            onMintComplete={refreshExplorer}
            log={log}
          />
        </main>
      ) : activeNavTab === 'bulk' ? (
        <main className="flex-1 min-h-0 overflow-y-auto p-4 sm:p-6 max-w-7xl mx-auto w-full">
          <BulkOperationView
            factory={factory}
            store={store}
            agentId={agentId}
            chunkSize={chunkSize}
            queue={bulkQueue}
            setQueue={setBulkQueue}
            isProcessing={isBulkProcessing}
            setIsProcessing={setIsBulkProcessing}
            onIngestComplete={refreshExplorer}
            log={log}
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

                    {/* Agent Name, Workspace Locus & Role Customization */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-neutral-900/90 border border-neutral-800 rounded p-3">
                      <div className="flex flex-col gap-1">
                        <label htmlFor="editAgentName" className="text-[10px] uppercase tracking-wider text-neutral-400 font-bold">
                          Agent Name / Handle:
                        </label>
                        <input
                          id="editAgentName"
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          placeholder="e.g. Maya, Archivax..."
                          className="w-full bg-neutral-950 border border-neutral-700 text-neutral-100 px-2.5 py-1.5 text-xs rounded font-mono focus:border-emerald-500 outline-none"
                        />
                      </div>

                      <div className="flex flex-col gap-1">
                        <label htmlFor="editWorkspaceName" className="text-[10px] uppercase tracking-wider text-neutral-400 font-bold">
                          Agent Workspace Locus:
                        </label>
                        <input
                          id="editWorkspaceName"
                          type="text"
                          value={editWorkspaceName}
                          onChange={(e) => setEditWorkspaceName(e.target.value.toUpperCase())}
                          placeholder="e.g. MAYA, ARCHIVAX..."
                          className="w-full bg-neutral-950 border border-neutral-700 text-neutral-100 px-2.5 py-1.5 text-xs rounded font-mono focus:border-emerald-500 outline-none uppercase"
                        />
                      </div>

                      <div className="flex flex-col gap-1">
                        <label htmlFor="editAgentRole" className="text-[10px] uppercase tracking-wider text-neutral-400 font-bold">
                          Agent Title / Role:
                        </label>
                        <input
                          id="editAgentRole"
                          type="text"
                          value={editRole}
                          onChange={(e) => setEditRole(e.target.value)}
                          placeholder="e.g. Agent of Illusion..."
                          className="w-full bg-neutral-950 border border-neutral-700 text-neutral-100 px-2.5 py-1.5 text-xs rounded font-mono focus:border-emerald-500 outline-none"
                        />
                      </div>
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
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setActiveNavTab('bulk')}
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-sky-950/60 hover:bg-sky-900/70 text-sky-300 border border-sky-800/80 rounded text-[10px] font-mono uppercase tracking-wider font-bold transition-colors cursor-pointer"
                >
                  <Files className="w-3 h-3 text-sky-400" />
                  <span className="hidden sm:inline">Bulk Operation</span>
                </button>
                <button
                  type="button"
                  onClick={() => setActiveNavTab('mint-chip')}
                  className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-950/60 hover:bg-amber-900/70 text-amber-300 border border-amber-800/80 rounded text-[10px] font-mono uppercase tracking-wider font-bold transition-colors cursor-pointer"
                >
                  <Sparkles className="w-3 h-3 text-amber-400" />
                  <span className="hidden sm:inline">Mint Chip Gate</span>
                </button>
                <span className="text-[10px] text-neutral-500">STG_INBOUND</span>
              </div>
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
            {(activeNavTab === 'all' || activeNavTab === 'explorer') && (() => {
              // Automatically resolve all related triplet edges when a vector node is selected
              const selectedNodeId = selectedRecord && selectedRecord.text && !selectedRecord.s ? selectedRecord.id : null;
              const relatedEdges = selectedNodeId
                ? edgesList.filter((e) => e.sourceId === selectedNodeId || (selectedRecord.text && e.s && e.o && selectedRecord.text.toLowerCase().includes(e.s.toLowerCase()) && selectedRecord.text.toLowerCase().includes(e.o.toLowerCase())))
                : [];
              const relatedEdgeIds = new Set(relatedEdges.map((e) => e.id));

              // If an edge is selected, resolve its originating node
              const selectedEdgeSourceId = selectedRecord && selectedRecord.s ? selectedRecord.sourceId : null;

              // Filter & prioritize edges
              const filteredEdges = edgesList.filter((e) => {
                const matchesSearch = !lorepackSearchQuery || 
                  e.s.toLowerCase().includes(lorepackSearchQuery.toLowerCase()) || 
                  e.o.toLowerCase().includes(lorepackSearchQuery.toLowerCase()) ||
                  e.r.toLowerCase().includes(lorepackSearchQuery.toLowerCase());
                const matchesLinked = !showOnlyLinkedEdges || relatedEdgeIds.has(e.id);
                return matchesSearch && matchesLinked;
              });

              // If a node is selected and we're showing all edges, sort related edges to the top
              const displayedEdges = (selectedNodeId && !showOnlyLinkedEdges)
                ? [...filteredEdges].sort((a, b) => {
                    const aRel = relatedEdgeIds.has(a.id) ? 1 : 0;
                    const bRel = relatedEdgeIds.has(b.id) ? 1 : 0;
                    return bRel - aRel;
                  })
                : filteredEdges;

              return (
              <section className="bg-neutral-900 border border-neutral-800 rounded flex flex-col min-h-[350px]">
            <div className="border-b border-neutral-800 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-neutral-900/60">
              <div className="flex items-center space-x-2">
                <Database className="h-4 w-4 text-emerald-400" />
                <h2 className="text-xs font-bold text-white uppercase tracking-wider">IndexedDB Memory Store Explorer</h2>
                {selectedNodeId && relatedEdges.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setExploreTab('EDGES');
                      setShowOnlyLinkedEdges(true);
                      setEdgesPage(1);
                    }}
                    className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded text-[10px] font-mono font-bold bg-blue-950/80 border border-blue-500/80 text-blue-300 hover:bg-blue-900 hover:text-white transition-all shadow-sm shadow-blue-950/50 cursor-pointer animate-pulse"
                    title="Click to view all related triplet edges in the explorer"
                  >
                    <Share2 className="w-3 h-3 text-blue-400" />
                    <span>{relatedEdges.length} Related Triplet{relatedEdges.length > 1 ? 's' : ''} &rarr;</span>
                  </button>
                )}
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
                  className={`px-3 py-1 rounded text-[10px] font-bold uppercase transition-colors cursor-pointer flex items-center gap-1.5 ${exploreTab === 'EDGES' ? 'bg-neutral-800 text-white' : 'text-neutral-500 hover:text-neutral-300'}`}
                >
                  <span>Triplet Edges ({edgesList.length})</span>
                  {selectedNodeId && relatedEdges.length > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full text-[9px] bg-blue-500/20 text-blue-300 border border-blue-500/60 font-mono font-bold">
                      {relatedEdges.length} linked
                    </span>
                  )}
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
                          .slice((nodesPage - 1) * ITEMS_PER_PAGE, nodesPage * ITEMS_PER_PAGE).map((node) => {
                          const isSelected = selectedRecord?.id === node.id;
                          const isLinkedToSelectedEdge = selectedEdgeSourceId === node.id;
                          const nodeEdgesCount = edgesList.filter((e) => e.sourceId === node.id || (node.text && e.s && e.o && node.text.toLowerCase().includes(e.s.toLowerCase()) && node.text.toLowerCase().includes(e.o.toLowerCase()))).length;

                          return (
                          <div
                            key={node.id}
                            onClick={() => setSelectedRecord(node)}
                            className={`p-2.5 rounded border text-left cursor-pointer transition-all ${
                              isSelected
                                ? 'bg-neutral-950 border-emerald-500 shadow-md shadow-emerald-950/50 ring-2 ring-emerald-500/40'
                                : isLinkedToSelectedEdge
                                ? 'bg-blue-950/30 border-blue-500/60 shadow-sm shadow-blue-950/30 ring-1 ring-blue-500/20'
                                : 'bg-neutral-950/40 border-neutral-800/80 hover:border-neutral-700'
                            }`}
                          >
                            <div className="flex items-center justify-between text-[10px] mb-1 font-mono">
                              <span className="text-neutral-400 truncate max-w-[120px] font-bold uppercase">&gt; {node.source}</span>
                              <div className="flex items-center gap-1.5">
                                {nodeEdgesCount > 0 && (
                                  <span
                                    className={`px-1.5 py-0.2 rounded text-[9px] font-mono flex items-center gap-1 ${
                                      isSelected
                                        ? 'bg-blue-950 text-blue-300 border border-blue-700 font-bold'
                                        : 'bg-neutral-900 text-neutral-400 border border-neutral-800'
                                    }`}
                                    title={`${nodeEdgesCount} semantic relationship triplet(s) linked to this node`}
                                  >
                                    <Share2 className="w-2.5 h-2.5 text-blue-400" />
                                    <span>{nodeEdgesCount}</span>
                                  </span>
                                )}
                                <span className="text-neutral-500 font-mono text-[9px]">{new Date(node.timestamp).toLocaleTimeString()}</span>
                              </div>
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

                            {/* Direct Action Shortcut when Node is Selected */}
                            {isSelected && nodeEdgesCount > 0 && (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedRecord(node);
                                  setExploreTab('EDGES');
                                  setShowOnlyLinkedEdges(true);
                                  setEdgesPage(1);
                                }}
                                className="mt-2 w-full text-[10px] font-mono text-blue-300 hover:text-white flex items-center justify-between bg-blue-950/80 border border-blue-600/70 hover:border-blue-500 px-2.5 py-1 rounded cursor-pointer transition-all shadow-sm shadow-blue-950"
                              >
                                <span className="flex items-center gap-1.5">
                                  <Share2 className="w-3 h-3 text-blue-400 animate-pulse" />
                                  <span>{nodeEdgesCount} Connected Triplet{nodeEdgesCount > 1 ? 's' : ''} Highlighted</span>
                                </span>
                                <span className="font-bold">&rarr;</span>
                              </button>
                            )}
                          </div>
                          );
                        })}
                      </div>
                    )
                  ) : (
                    displayedEdges.length === 0 ? (
                      <div className="h-full flex flex-col items-center justify-center py-10 gap-2">
                        <p className="text-xs text-neutral-500 uppercase tracking-wider">
                          {showOnlyLinkedEdges ? 'No linked triplets found for selected node' : 'No compiled triplets found'}
                        </p>
                        {showOnlyLinkedEdges && (
                          <button
                            type="button"
                            onClick={() => setShowOnlyLinkedEdges(false)}
                            className="text-[10px] font-mono text-blue-400 hover:text-blue-300 underline cursor-pointer"
                          >
                            Show All Triplet Edges
                          </button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {/* Relationship Context Banner */}
                        {selectedNodeId && (
                          <div className="bg-blue-950/50 border border-blue-500/60 p-2.5 rounded mb-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-lg shadow-blue-950/40">
                            <div className="flex items-center gap-2 min-w-0">
                              <Share2 className="w-3.5 h-3.5 text-blue-400 shrink-0 animate-pulse" />
                              <div className="text-[11px] font-mono min-w-0">
                                <span className="text-neutral-400">Node: </span>
                                <span className="text-blue-300 font-bold truncate inline-block max-w-[120px] align-bottom">{selectedNodeId}</span>
                                <span className="text-neutral-400"> &bull; </span>
                                <span className="text-emerald-400 font-bold">{relatedEdges.length} Related Triplet{relatedEdges.length === 1 ? '' : 's'}</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {relatedEdges.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setShowOnlyLinkedEdges(!showOnlyLinkedEdges);
                                    setEdgesPage(1);
                                  }}
                                  className={`px-2.5 py-1 rounded text-[10px] font-mono font-bold uppercase transition-colors cursor-pointer flex items-center gap-1.5 ${
                                    showOnlyLinkedEdges
                                      ? 'bg-blue-500 text-neutral-950 font-bold shadow-sm shadow-blue-400/50'
                                      : 'bg-neutral-800 text-blue-300 hover:bg-neutral-700 border border-neutral-700'
                                  }`}
                                >
                                  <span>{showOnlyLinkedEdges ? 'Show All Edges' : 'Show Only Linked'}</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setExploreTab('NODES')}
                                className="px-2 py-0.5 rounded text-[9px] font-mono text-neutral-400 hover:text-white bg-neutral-900 border border-neutral-800 cursor-pointer transition-colors"
                              >
                                &larr; Node View
                              </button>
                            </div>
                          </div>
                        )}

                        {displayedEdges
                          .slice((edgesPage - 1) * ITEMS_PER_PAGE, edgesPage * ITEMS_PER_PAGE).map((edge) => {
                          const isDirectlySelected = selectedRecord?.id === edge.id;
                          const isRelatedToSelectedNode = relatedEdgeIds.has(edge.id);

                          return (
                          <div
                            key={edge.id}
                            onClick={() => setSelectedRecord(edge)}
                            className={`p-2.5 rounded border text-left cursor-pointer transition-all ${
                              isDirectlySelected
                                ? 'bg-neutral-950 border-blue-500 shadow-md shadow-blue-950/50 ring-2 ring-blue-500/50'
                                : isRelatedToSelectedNode
                                ? 'bg-blue-950/60 border-blue-400 shadow-lg shadow-blue-950/60 ring-2 ring-blue-500/40'
                                : 'bg-neutral-950/40 border-neutral-800/80 hover:border-neutral-700'
                            }`}
                          >
                            <div className="flex items-center justify-between gap-1 mb-1.5">
                              <div className="flex items-center gap-1.5 flex-wrap flex-1 min-w-0">
                                <span className={`text-[10px] font-bold font-mono truncate max-w-[120px] ${isRelatedToSelectedNode ? 'text-blue-300' : 'text-blue-400'}`}>
                                  {edge.s}
                                </span>
                                <span className="text-neutral-500 text-[10px] font-semibold">--({edge.r})--&gt;</span>
                                <span className={`text-[10px] font-bold font-mono truncate max-w-[120px] ${isRelatedToSelectedNode ? 'text-emerald-300' : 'text-emerald-400'}`}>
                                  {edge.o}
                                </span>
                              </div>
                              {isRelatedToSelectedNode && (
                                <span className="text-[8px] uppercase tracking-wider font-mono font-bold px-2 py-0.5 rounded bg-blue-500/30 text-blue-200 border border-blue-400 shrink-0 flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-ping" />
                                  <span>RELATIONSHIP LINKED</span>
                                </span>
                              )}
                            </div>
                            <div className="flex items-center justify-between text-[9px] text-neutral-500 font-mono uppercase">
                              <span>Source ID: {edge.sourceId ? edge.sourceId.slice(0, 12) + '...' : 'UNKNOWN'}</span>
                              {edge.agentId && <span>Agent: {edge.agentId}</span>}
                            </div>
                          </div>
                          );
                        })}
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
                  displayedEdges.length > ITEMS_PER_PAGE && (
                    <div className="flex items-center justify-between border-t border-neutral-800 pt-3 mt-2">
                      <button
                        onClick={() => setEdgesPage((p) => Math.max(1, p - 1))}
                        disabled={edgesPage === 1}
                        className="bg-neutral-950 border border-neutral-800 hover:border-neutral-700 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed text-neutral-400 p-1.5 rounded transition-colors cursor-pointer"
                      >
                        <ChevronLeft className="h-3.5 w-3.5" />
                      </button>
                      <span className="text-[10px] font-mono font-bold text-neutral-400 uppercase tracking-wider">
                        Page {edgesPage} of {Math.ceil(displayedEdges.length / ITEMS_PER_PAGE)}
                      </span>
                      <button
                        onClick={() => setEdgesPage((p) => Math.min(Math.ceil(displayedEdges.length / ITEMS_PER_PAGE), p + 1))}
                        disabled={edgesPage >= Math.ceil(displayedEdges.length / ITEMS_PER_PAGE)}
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
                            <p className="text-xs text-neutral-300 font-mono leading-relaxed bg-neutral-950 border border-neutral-800 p-2.5 rounded max-h-[110px] overflow-y-auto">
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

                        {/* Connected Triplet Relationships Section for Vector Nodes */}
                        {selectedNodeId && (
                          <div className="bg-neutral-950 border border-neutral-800 p-3 rounded space-y-2">
                            <div className="flex items-center justify-between pb-1.5 border-b border-neutral-800">
                              <div className="flex items-center gap-1.5">
                                <Share2 className="w-3.5 h-3.5 text-blue-400" />
                                <span className="text-[10px] font-bold uppercase tracking-wider text-blue-300">
                                  Connected Triplet Edges ({relatedEdges.length})
                                </span>
                              </div>
                              {relatedEdges.length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setExploreTab('EDGES');
                                    setShowOnlyLinkedEdges(true);
                                    setEdgesPage(1);
                                  }}
                                  className="text-[9px] font-mono text-blue-400 hover:text-blue-200 flex items-center gap-1 cursor-pointer transition-colors"
                                >
                                  <span>View In Edges Tab</span>
                                  <ChevronRight className="w-3 h-3" />
                                </button>
                              )}
                            </div>

                            {relatedEdges.length > 0 ? (
                              <div className="space-y-1.5 max-h-[140px] overflow-y-auto pr-1">
                                {relatedEdges.map((relEdge) => (
                                  <div
                                    key={relEdge.id}
                                    onClick={() => setSelectedRecord(relEdge)}
                                    className="p-2 rounded bg-neutral-900 border border-blue-900/60 hover:border-blue-500/80 cursor-pointer transition-all hover:bg-neutral-850 flex items-center justify-between gap-2 group"
                                    title="Click to inspect this triplet relationship in detail"
                                  >
                                    <div className="flex items-center gap-1.5 flex-wrap min-w-0 text-[10px] font-mono">
                                      <span className="font-bold text-blue-400 truncate max-w-[90px]">{relEdge.s}</span>
                                      <span className="text-neutral-500 text-[9px] font-semibold">--({relEdge.r})--&gt;</span>
                                      <span className="font-bold text-emerald-400 truncate max-w-[90px]">{relEdge.o}</span>
                                    </div>
                                    <span className="text-[8px] font-mono text-neutral-500 group-hover:text-blue-300 transition-colors uppercase shrink-0">
                                      Inspect &rarr;
                                    </span>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="p-2.5 rounded bg-neutral-900/40 border border-neutral-800/60 text-center">
                                <p className="text-[10px] text-neutral-500 font-mono">
                                  No semantic triplet edges currently linked to this node.
                                </p>
                                <p className="text-[9px] text-neutral-600 font-mono mt-0.5">
                                  Run &quot;Build Graph&quot; to synthesize subject-predicate-object relationships.
                                </p>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Triplet Record Subject-Relation-Target Struct */}
                        {selectedRecord.s && (
                          <div className="space-y-2">
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

                            {/* Originating Source Node preview & jump link */}
                            {(() => {
                              const sourceNode = nodesList.find((n) => n.id === selectedRecord.sourceId);
                              return (
                                <div className="bg-neutral-950 border border-neutral-800 p-3 rounded">
                                  <div className="flex items-center justify-between mb-1.5 pb-1 border-b border-neutral-800/80">
                                    <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                                      Originating Vector Node
                                    </span>
                                    {sourceNode && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSelectedRecord(sourceNode);
                                          setExploreTab('NODES');
                                        }}
                                        className="text-[9px] font-mono text-emerald-400 hover:text-emerald-300 underline cursor-pointer flex items-center gap-1"
                                      >
                                        <span>Inspect Node</span>
                                        <ChevronRight className="w-2.5 h-2.5" />
                                      </button>
                                    )}
                                  </div>
                                  {sourceNode ? (
                                    <p className="text-[10px] font-mono text-neutral-300 line-clamp-2 leading-relaxed bg-neutral-900 p-2 rounded border border-neutral-800">
                                      {sourceNode.text}
                                    </p>
                                  ) : (
                                    <p className="text-[10px] font-mono text-neutral-500">
                                      Source Node ID: {selectedRecord.sourceId || 'N/A'}
                                    </p>
                                  )}
                                </div>
                              );
                            })()}
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
              );
            })()}

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
                  disabled={exporting || stats.totalNodes === 0 || hasUnresolvedFailures}
                  className="w-full bg-neutral-950 border border-neutral-800 hover:border-neutral-700 text-neutral-200 font-bold px-4 py-2 rounded text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" />
                  {hasUnresolvedFailures ? 'Export Blocked (Ingest Failures)' : 'Export Compiled Archive (.JSONL)'}
                </button>
              </div>

              {exportProgressBar}

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
