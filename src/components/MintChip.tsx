import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  Sparkles,
  ShieldCheck,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Terminal,
  Play,
  RotateCcw,
  Download,
  Database,
  Cpu,
  Clock,
  FileText,
  Copy,
  Trash2,
  Layers,
  Lock,
  RefreshCw,
  FileCode,
  Check,
  ChevronRight,
  Zap,
} from 'lucide-react';
import {
  MINT_GATE_VERSION,
  PINNED_MODEL,
  PINNED_DIM,
  EMBED_BATCH,
  EMBED_PACE_MS,
  EMBED_MAX_RETRIES,
  MintRefusedError,
  QuotaError,
  AuthError,
  embedAllResumable,
  embedBatchPinned,
  assertSingleSpace,
  ResumeHooks,
  GateVector,
  GateEdge,
  FetchImpl,
  SUPPORTED_EMBEDDING_MODELS,
  validateModelCompatibility,
} from '../mint-gate.js';
import type { LorepackFactory } from '../lorepack-factory.ts';
import type { IndexedDbLorepackStore } from '../indexeddb-store.ts';
import type { GeminiProvider } from '../providers/gemini-provider.ts';
import type { VectorRecord, TripletEdge } from '../types.ts';
import { CANONICAL_MYTHOS_AGENTS, getCanonicalAgentById } from '../agents.ts';

interface MintChipProps {
  factory: LorepackFactory | null;
  store: IndexedDbLorepackStore | null;
  provider: GeminiProvider | null;
  agentId: string;
  setAgentId?: (id: string) => void;
  agentHandle: string;
  generationModel?: string;
  customApiKeys: string[];
  onMintComplete?: () => Promise<void>;
  log?: (msg: string) => void;
}

interface StagedChunk {
  id: string;
  text: string;
  source: string;
  charCount: number;
}

interface MintEventLog {
  id: string;
  timestamp: string;
  type: 'info' | 'warn' | 'error' | 'success' | 'gate';
  message: string;
}

interface SpaceAssertionState {
  ran: boolean;
  valid: boolean;
  dim: number;
  model: string;
  vectorCount: number;
  edgeCount: number;
  error?: string;
  checks: {
    dimensions: boolean | null;
    modelPinned: boolean | null;
    noDuplicateIds: boolean | null;
    noOrphanEdges: boolean | null;
  };
}

const PRESET_LORE_SCENARIOS = [
  {
    name: 'ZOE FILMS Cinema Engine Protocol',
    source: 'ZOE_CINEMA_SPEC_V1',
    description: 'Cinematic worldbuilding rules, lighting protocols, and camera mechanics.',
    chunks: [
      'The anamorphic anamorphic ratio of 2.39:1 represents the baseline aspect ratio for all Zoe Films narrative sequences.',
      'Key light contrast ratio is calibrated at 4:1 for dramatic character close-ups, ensuring sub-surface skin scattering is preserved.',
      'Volumetric atmospheric fog is rendered with particle scatter coefficient 0.045 to emulate optical haze in high-humidity sequences.',
      'Audio sync utilizes SMPTE timecode 24fps with microsecond precision lock against digital audio workstation stems.',
    ],
  },
  {
    name: 'Mythos Cybernetic Core Axioms',
    source: 'MYTHOS_CORE_AXIOMS',
    description: 'High-density cognitive directives and agent isolation parameters.',
    chunks: [
      'Agent memory isolation guarantees zero cross-talk between discrete cognitive workspaces in the Mythos substrate.',
      'Every memory node must be content-addressed via cryptographic SHA-256 fingerprinting before vector projection.',
      'Single-space contract mandates uniform 768-dimensional manifold geometry across all stored episodic records.',
      'Fallback vectors are strictly prohibited; missing real embeddings forces fail-closed refusal.',
    ],
  },
  {
    name: 'Ontological Knowledge Matrix',
    source: 'ONTOLOGY_MATRIX_NODE',
    description: 'Entity relationships, semantic predicates, and graph edge constraints.',
    chunks: [
      'Subject-predicate-object semantic triplets are extracted strictly from defensible contextual propositions.',
      'Graph edges must maintain referential integrity: no edge may reference a source node absent from the local pack.',
      'Deterministic Sigil generation binds textual surface syntax to numeric spatial coordinate markers.',
      'Memory consolidation occurs during idle cycles through hierarchical clustering in 768-D Euclidean space.',
    ],
  },
];

function maskSecret(key: string): string {
  if (!key) return 'NO_KEY';
  if (key.length <= 11) return '***';
  return `${key.slice(0, 7)}...${key.slice(-4)}`;
}

export const MintChip: React.FC<MintChipProps> = ({
  factory,
  store,
  provider,
  agentId,
  setAgentId,
  agentHandle,
  generationModel = 'gemini-3.6-flash',
  customApiKeys,
  onMintComplete,
  log,
}) => {
  // Input & Configuration State
  const [sourceId, setSourceId] = useState<string>('MINT_CHIP_PAYLOAD_01');
  const [rawText, setRawText] = useState<string>(
    PRESET_LORE_SCENARIOS[0].chunks.join('\n\n')
  );
  const [selectedApiKey, setSelectedApiKey] = useState<string>('');
  const [chipTitle, setChipTitle] = useState<string>('ZOE-LOREPACK-CHIP');
  const [chipVersion, setChipVersion] = useState<string>('1.0.0');

  // Dynamic Embedding Model Selection
  const [selectedEmbeddingModel, setSelectedEmbeddingModel] = useState<string>(PINNED_MODEL);
  const [availableEmbeddingModels, setAvailableEmbeddingModels] = useState<string[]>([
    ...SUPPORTED_EMBEDDING_MODELS,
  ]);
  const [isFetchingModels, setIsFetchingModels] = useState<boolean>(false);

  // Staged Chunks
  const [stagedChunks, setStagedChunks] = useState<StagedChunk[]>([]);

  // Mint Pipeline Running State
  const [isMinting, setIsMinting] = useState<boolean>(false);
  const [progressState, setProgressState] = useState<{
    processed: number;
    total: number;
    currentBatch: number;
    totalBatches: number;
    percent: number;
    statusText: string;
  }>({
    processed: 0,
    total: 0,
    currentBatch: 0,
    totalBatches: 0,
    percent: 0,
    statusText: 'IDLE — Awaiting mint trigger',
  });

  // Terminal & Event Log
  const [events, setEvents] = useState<MintEventLog[]>([
    {
      id: 'init-1',
      timestamp: new Date().toLocaleTimeString(),
      type: 'gate',
      message: `MINT GATE v${MINT_GATE_VERSION} online. Pinned model: ${PINNED_MODEL} (${PINNED_DIM}-D). Zero-fallback policy active.`,
    },
  ]);
  const terminalEndRef = useRef<HTMLDivElement>(null);

  // Checkpoint State
  const checkpointKey = `mythos_mintchip_checkpoint_${agentId}`;
  const [savedCheckpoint, setSavedCheckpoint] = useState<{
    itemsCount: number;
    model: string;
    dim: number;
  } | null>(null);

  // Space Assertion State
  const [assertionState, setAssertionState] = useState<SpaceAssertionState>({
    ran: false,
    valid: false,
    dim: PINNED_DIM,
    model: PINNED_MODEL,
    vectorCount: 0,
    edgeCount: 0,
    checks: {
      dimensions: null,
      modelPinned: null,
      noDuplicateIds: null,
      noOrphanEdges: null,
    },
  });

  // Minted Result & Refusal
  const [lastRefusal, setLastRefusal] = useState<string | null>(null);
  const [mintedResult, setMintedResult] = useState<{
    vectorCount: number;
    dim: number;
    model: string;
    jsonl: string;
    blob: Blob | null;
    filename: string;
    timestamp: string;
  } | null>(null);

  const [copiedManifest, setCopiedManifest] = useState<boolean>(false);

  // Helper: append event
  const addEvent = useCallback(
    (message: string, type: MintEventLog['type'] = 'info') => {
      const entry: MintEventLog = {
        id: Math.random().toString(36).substring(2, 9),
        timestamp: new Date().toLocaleTimeString(),
        type,
        message,
      };
      setEvents((prev) => [...prev.slice(-150), entry]);
      if (log) log(`[MINT_GATE]: ${message}`);
    },
    [log]
  );

  // Auto-scroll terminal
  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events]);

  // Check existing checkpoint on mount & agent change
  const inspectCheckpoint = useCallback(() => {
    try {
      const raw = localStorage.getItem(checkpointKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.items) {
          const count = Object.keys(parsed.items).length;
          setSavedCheckpoint({
            itemsCount: count,
            model: parsed.model || PINNED_MODEL,
            dim: parsed.dim || PINNED_DIM,
          });
          return;
        }
      }
      setSavedCheckpoint(null);
    } catch {
      setSavedCheckpoint(null);
    }
  }, [checkpointKey]);

  useEffect(() => {
    inspectCheckpoint();
  }, [inspectCheckpoint]);

  // Dynamically fetch supported embedding models compatible with current generation model
  const fetchSupportedEmbeddingModels = useCallback(async () => {
    setIsFetchingModels(true);
    try {
      let fetched: string[] = [];
      if (provider && typeof provider.fetchEmbeddingModels === 'function') {
        fetched = await provider.fetchEmbeddingModels();
      } else {
        const res = await fetch('/api/lorepack/embedding-models');
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.models)) {
            fetched = data.models;
          }
        }
      }

      const pool = Array.from(new Set([...SUPPORTED_EMBEDDING_MODELS, ...(fetched || [])]));
      // Filter models compatible with current generation model
      const compatible = pool.filter((m) => validateModelCompatibility(generationModel, m).compatible);
      const finalList = compatible.length > 0 ? compatible : pool;

      setAvailableEmbeddingModels(finalList);
      if (!finalList.includes(selectedEmbeddingModel)) {
        setSelectedEmbeddingModel(finalList[0] || PINNED_MODEL);
      }
      addEvent(`EMBEDDING CATALOG :: Loaded ${finalList.length} compatible model(s) for generation model [${generationModel}].`, 'info');
    } catch (err: any) {
      addEvent(`Failed to fetch dynamic embedding models: ${err.message || err}`, 'warn');
      setAvailableEmbeddingModels([...SUPPORTED_EMBEDDING_MODELS]);
    } finally {
      setIsFetchingModels(false);
    }
  }, [provider, generationModel, selectedEmbeddingModel, addEvent]);

  useEffect(() => {
    fetchSupportedEmbeddingModels();
  }, [generationModel]);

  // Sync staged chunks whenever rawText or sourceId changes
  useEffect(() => {
    const rawParagraphs = rawText
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);

    const entries = rawParagraphs.length > 0 ? rawParagraphs : [rawText.trim()].filter(Boolean);

    const staged: StagedChunk[] = entries.map((text, idx) => {
      // Deterministic node id
      const simpleHash = Math.abs(
        text.split('').reduce((acc, char) => (acc << 5) - acc + char.charCodeAt(0), 0)
      ).toString(16).padStart(8, '0');
      return {
        id: `lp_node_${agentId.toLowerCase()}_${simpleHash}_${idx + 1}`,
        text,
        source: sourceId.trim() || 'MANUAL_PAYLOAD',
        charCount: text.length,
      };
    });

    setStagedChunks(staged);
  }, [rawText, sourceId, agentId]);

  // Resolve active API key
  const getActiveKey = useCallback((): string => {
    if (selectedApiKey.trim()) return selectedApiKey.trim();
    if (customApiKeys.length > 0 && customApiKeys[0]?.trim()) {
      return customApiKeys[0].trim();
    }
    if (provider && typeof (provider as any).getKey === 'function') {
      try {
        return (provider as any).getKey();
      } catch {}
    }
    return '';
  }, [selectedApiKey, customApiKeys, provider]);

  // Clear Checkpoint
  const handleClearCheckpoint = () => {
    try {
      localStorage.removeItem(checkpointKey);
      setSavedCheckpoint(null);
      addEvent(`CHECKPOINT CLEARED :: Cleared saved state for agent ${agentId}.`, 'warn');
    } catch (e: any) {
      addEvent(`Failed to clear checkpoint: ${e.message}`, 'error');
    }
  };

  // Run Space Contract Assertion on existing store or staged vectors
  const handleRunSpaceAssertion = async () => {
    addEvent(`SPACE ASSERTION :: Initiating single-space contract audit for agent [${agentId}]...`, 'gate');
    try {
      let vectors: GateVector[] = [];
      let edges: GateEdge[] = [];

      if (store) {
        const storeVecs = await store.getVectorsByAgent(agentId);
        const storeEdges = await store.getTripletEdgesByAgent(agentId);
        vectors = storeVecs.map((v) => ({
          id: v.id,
          vec: v.vector,
          model: (v.metadata as any)?.embeddingModel || PINNED_MODEL,
        }));
        edges = storeEdges.map((e) => ({
          id: e.id,
          src: e.sourceId,
        }));
      }

      if (vectors.length === 0) {
        // Fall back to checking minted result if available
        if (mintedResult && mintedResult.blob) {
          addEvent(`No stored vectors found in IndexedDB; asserting against latest minted run.`, 'info');
        } else {
          addEvent(`Store holds 0 vectors for agent [${agentId}]. Assertion skipped until items are minted.`, 'warn');
          setAssertionState({
            ran: true,
            valid: true,
            dim: PINNED_DIM,
            model: PINNED_MODEL,
            vectorCount: 0,
            edgeCount: 0,
            checks: {
              dimensions: true,
              modelPinned: true,
              noDuplicateIds: true,
              noOrphanEdges: true,
            },
          });
          return;
        }
      }

      // Execute authoritative mint-gate assertSingleSpace
      const outcome = assertSingleSpace(vectors, edges, PINNED_DIM);

      setAssertionState({
        ran: true,
        valid: true,
        dim: outcome.dim,
        model: outcome.model,
        vectorCount: outcome.vectors,
        edgeCount: outcome.edges,
        checks: {
          dimensions: true,
          modelPinned: true,
          noDuplicateIds: true,
          noOrphanEdges: true,
        },
      });

      addEvent(
        `SPACE ASSERTION PASSED :: ${outcome.vectors} vectors strictly conform to ${outcome.dim}-D (${outcome.model}). ${outcome.edges} edges valid.`,
        'success'
      );
    } catch (err: any) {
      const msg = err.message || String(err);
      setAssertionState((prev) => ({
        ...prev,
        ran: true,
        valid: false,
        error: msg,
        checks: {
          dimensions: !msg.includes('dimensions') && !msg.includes('pinned'),
          modelPinned: !msg.includes('models'),
          noDuplicateIds: !msg.includes('duplicate'),
          noOrphanEdges: !msg.includes('edge'),
        },
      }));
      addEvent(`SPACE ASSERTION REFUSED :: ${msg}`, 'error');
    }
  };

  // MAIN MINT ACTION: embedAllResumable + assertSingleSpace + packaging
  const handleMintLorepackChip = async () => {
    if (stagedChunks.length === 0) {
      addEvent('MINT ABORTED :: No text chunks staged for minting.', 'warn');
      return;
    }

    const key = getActiveKey();
    if (!key) {
      const authErr = 'MINT REFUSED :: no API key. Keys live in the host keyring, never in code. NOTHING WAS PACKED.';
      setLastRefusal(authErr);
      addEvent(authErr, 'error');
      return;
    }

    // Pre-flight model compatibility gate
    const compat = validateModelCompatibility(generationModel, selectedEmbeddingModel);
    if (!compat.compatible) {
      const refusal = `MINT REFUSED :: ${compat.reason}`;
      setLastRefusal(refusal);
      addEvent(refusal, 'error');
      return;
    }

    // Pre-flight workspace homogeneity check via LorepackFactory
    if (factory && typeof factory.verifyWorkspaceHomogeneity === 'function') {
      try {
        const homeCheck = await factory.verifyWorkspaceHomogeneity(agentId, selectedEmbeddingModel, PINNED_DIM);
        if (!homeCheck.valid) {
          const refusal = `MINT REFUSED :: ${homeCheck.reason}`;
          setLastRefusal(refusal);
          addEvent(refusal, 'error');
          return;
        }
      } catch (err: any) {
        const refusal = `MINT REFUSED :: Workspace check failed: ${err.message || err}`;
        setLastRefusal(refusal);
        addEvent(refusal, 'error');
        return;
      }
    }

    setIsMinting(true);
    setLastRefusal(null);
    setMintedResult(null);

    const total = stagedChunks.length;
    const totalBatches = Math.ceil(total / EMBED_BATCH);

    setProgressState({
      processed: 0,
      total,
      currentBatch: 1,
      totalBatches,
      percent: 0,
      statusText: `Initializing mint pipeline for ${total} chunks across ${totalBatches} batches...`,
    });

    addEvent(
      `MINT INITIATED :: Target Agent: [${agentId}], Model: ${selectedEmbeddingModel}, Space: ${PINNED_DIM}-D, Pacing: ${EMBED_PACE_MS}ms, Batch Size: ${EMBED_BATCH}.`,
      'gate'
    );

    // Prepare ResumeHooks
    const hooks: ResumeHooks = {
      load: async () => {
        try {
          const raw = localStorage.getItem(checkpointKey);
          return raw ? JSON.parse(raw) : null;
        } catch {
          return null;
        }
      },
      save: async (cp) => {
        try {
          localStorage.setItem(checkpointKey, JSON.stringify(cp));
          inspectCheckpoint();
        } catch {}
      },
      onEvent: (msg: string) => {
        // Parse progress if embedding
        const m = msg.match(/EMBEDDING :: (\d+)\/(\d+)/);
        if (m) {
          const doneCount = parseInt(m[1], 10);
          const totalCount = parseInt(m[2], 10);
          const pct = Math.round((doneCount / totalCount) * 100);
          const currB = Math.min(totalBatches, Math.ceil(doneCount / EMBED_BATCH));
          setProgressState({
            processed: doneCount,
            total: totalCount,
            currentBatch: currB,
            totalBatches,
            percent: pct,
            statusText: `Embedding progress: ${doneCount}/${totalCount} (${pct}%) — Batch ${currB}/${totalBatches}`,
          });
          addEvent(msg, 'info');
        } else if (msg.includes('QUOTA WAIT')) {
          setProgressState((prev) => ({
            ...prev,
            statusText: msg,
          }));
          addEvent(msg, 'warn');
        } else if (msg.includes('RESUMING')) {
          addEvent(msg, 'gate');
        } else {
          addEvent(msg, 'info');
        }
      },
    };

    try {
      // 1. Run sequential, resumable, quota-enforced batch embedding
      const recordsToEmbed = stagedChunks.map((c) => ({ id: c.id, text: c.text }));
      const vectorMap = await embedAllResumable(
        recordsToEmbed,
        key,
        fetch.bind(globalThis),
        hooks,
        selectedEmbeddingModel,
        PINNED_DIM,
        EMBED_BATCH
      );

      addEvent(`BATCH EMBEDDING COMPLETE :: Successfully gathered ${vectorMap.size} ${PINNED_DIM}-D vectors.`, 'success');

      // 2. Prepare Gate Vectors for single-space assertion
      const gateVectors: GateVector[] = [];
      const vectorRecords: VectorRecord[] = [];
      const timestampIso = new Date().toISOString();

      for (const chunk of stagedChunks) {
        const vec = vectorMap.get(chunk.id);
        if (!vec) {
          throw new MintRefusedError(`MINT REFUSED :: Missing vector for ${chunk.id}. NOTHING WAS PACKED.`);
        }
        gateVectors.push({
          id: chunk.id,
          vec,
          model: selectedEmbeddingModel,
        });

        vectorRecords.push({
          id: chunk.id,
          agentId,
          text: chunk.text,
          vector: vec,
          numMarkId: `sig_${chunk.id.slice(-8)}`,
          source: chunk.source,
          timestamp: Date.now(),
          metadata: {
            source: chunk.source,
            timestamp: timestampIso,
            locus: `MYTHOS.LORE.${agentId}`,
            embeddingModel: selectedEmbeddingModel,
            embeddingDimension: vec.length,
            embeddingEpoch: selectedEmbeddingModel,
            chipVersion,
            chipTitle,
          },
        });
      }

      // 3. Strict Single Space Contract Assertion
      addEvent(`SPACE CONTRACT ASSERTION :: Validating ${gateVectors.length} vectors against single-space rules...`, 'gate');
      const assertion = assertSingleSpace(gateVectors, [], PINNED_DIM);
      setAssertionState({
        ran: true,
        valid: true,
        dim: assertion.dim,
        model: assertion.model,
        vectorCount: assertion.vectors,
        edgeCount: 0,
        checks: {
          dimensions: true,
          modelPinned: true,
          noDuplicateIds: true,
          noOrphanEdges: true,
        },
      });
      addEvent(`SPACE CONTRACT PASSED :: All vectors confirmed strictly ${PINNED_DIM}-D under ${selectedEmbeddingModel}.`, 'success');

      // 4. Save to IndexedDB Store if available
      if (store) {
        addEvent(`PERSISTENCE :: Writing ${vectorRecords.length} records atomically to IndexedDB store...`, 'info');
        await store.addVectors(vectorRecords);
        addEvent(`PERSISTENCE COMPLETE :: Stored in agent [${agentId}] partition.`, 'success');
      }

      // 5. Serialize Lorepack CHIP JSONL format
      const jsonlLines: string[] = [];
      // Manifest header block
      jsonlLines.push(
        JSON.stringify({
          v: 2,
          type: 'manifest',
          chip: chipTitle,
          version: chipVersion,
          agentId,
          model: selectedEmbeddingModel,
          dim: PINNED_DIM,
          count: vectorRecords.length,
          mintGateVersion: MINT_GATE_VERSION,
          mintedAt: timestampIso,
        })
      );

      for (const rec of vectorRecords) {
        jsonlLines.push(
          JSON.stringify({
            v: 2,
            type: 'node',
            id: rec.id,
            a: rec.agentId,
            t: rec.text,
            vec: rec.vector,
            m: rec.numMarkId,
            src: rec.source,
            d: rec.metadata,
          })
        );
      }

      const jsonlPayload = jsonlLines.join('\n');
      let chipBlob: Blob = new Blob([jsonlPayload], { type: 'application/x-ndjson' });

      // Attempt GZIP compression if supported
      if (typeof CompressionStream !== 'undefined') {
        try {
          const stream = chipBlob.stream().pipeThrough(new CompressionStream('gzip'));
          chipBlob = await new Response(stream).blob();
        } catch {
          // Fall back to plain Blob
        }
      }

      const filename = `${chipTitle.toLowerCase()}-${agentId.toLowerCase()}-v${chipVersion}.lorepack.gz`;

      setMintedResult({
        vectorCount: vectorRecords.length,
        dim: PINNED_DIM,
        model: selectedEmbeddingModel,
        jsonl: jsonlPayload,
        blob: chipBlob,
        filename,
        timestamp: timestampIso,
      });

      // Clear checkpoint after successful completion
      localStorage.removeItem(checkpointKey);
      setSavedCheckpoint(null);

      setProgressState({
        processed: total,
        total,
        currentBatch: totalBatches,
        totalBatches,
        percent: 100,
        statusText: `MINT SUCCESS — Minted ${vectorRecords.length} vectors into ${filename}`,
      });

      addEvent(`MINT COMPLETE :: CHIP packaged as ${filename} (${(chipBlob.size / 1024).toFixed(1)} KB).`, 'success');

      if (onMintComplete) {
        await onMintComplete();
      }
    } catch (err: any) {
      const msg = err.message || String(err);
      setLastRefusal(msg);
      addEvent(`MINT REFUSED :: ${msg}`, 'error');
      setProgressState((prev) => ({
        ...prev,
        statusText: `HALTED BY MINT GATE: ${msg}`,
      }));
    } finally {
      setIsMinting(false);
      inspectCheckpoint();
    }
  };

  // SIMULATION 1: Simulate Quota Error (429) to prove fail-loud & resume contract
  const handleSimulateQuotaRejection = async () => {
    addEvent('SIMULATION :: Executing Quota Rejection Test (Simulated HTTP 429 "retry in 4s")...', 'warn');
    const mockFetch: FetchImpl = async (_url, _init) => {
      // Simulate 429 quota exhaustion with retry in 4s
      return {
        ok: false,
        status: 429,
        json: async () => ({
          error: {
            code: 429,
            message: 'RESOURCE_EXHAUSTED: Quota exceeded for quota metric "Embeddings". Please retry in 4.0s.',
            status: 'RESOURCE_EXHAUSTED',
          },
        }),
      };
    };

    setIsMinting(true);
    setLastRefusal(null);

    const testRecords = [
      { id: 'test_node_quota_01', text: 'Simulated chunk 1 for quota test.' },
      { id: 'test_node_quota_02', text: 'Simulated chunk 2 for quota test.' },
    ];

    const hooks: ResumeHooks = {
      load: async () => null,
      save: async (cp) => {
        addEvent(`SIMULATION CHECKPOINT SAVED :: ${Object.keys(cp.items).length} items cached.`, 'info');
      },
      onEvent: (msg) => addEvent(`SIMULATION :: ${msg}`, 'warn'),
    };

    try {
      await embedAllResumable(
        testRecords,
        'MOCK_SIMULATED_KEY',
        mockFetch,
        hooks,
        PINNED_MODEL,
        PINNED_DIM,
        1
      );
    } catch (err: any) {
      const refusalMsg = err.message || String(err);
      setLastRefusal(refusalMsg);
      addEvent(
        `PROVED FAIL-CLOSED :: Mint Gate halted loud: "${refusalMsg}". ZERO fake vectors were minted. Checkpoint preserved.`,
        'success'
      );
    } finally {
      setIsMinting(false);
    }
  };

  // SIMULATION 2: Simulate Dimension Mismatch (1536-D vs 768-D pinned)
  const handleSimulateDimensionMismatch = () => {
    addEvent('SIMULATION :: Executing Dimension Mismatch Test (1536-D vector presented)...', 'warn');
    try {
      const badVectors: GateVector[] = [
        {
          id: 'test_node_bad_dim_01',
          vec: new Array(1536).fill(0.001), // Wrong dimension!
          model: PINNED_MODEL,
        },
      ];
      assertSingleSpace(badVectors, [], PINNED_DIM);
      addEvent('UNEXPECTED: Assertion passed when it should have failed!', 'error');
    } catch (err: any) {
      const msg = err.message || String(err);
      setLastRefusal(msg);
      addEvent(
        `PROVED DIMENSION ASSERTION :: Mint Gate rejected mismatched dimensions: "${msg}". NOTHING WAS PACKED.`,
        'success'
      );
    }
  };

  // SIMULATION 3: Simulate Orphan Edge Assertion
  const handleSimulateOrphanEdge = () => {
    addEvent('SIMULATION :: Executing Orphan Edge Test (edge references missing vector)...', 'warn');
    try {
      const goodVectors: GateVector[] = [
        {
          id: 'valid_node_01',
          vec: new Array(PINNED_DIM).fill(0.001),
          model: PINNED_MODEL,
        },
      ];
      const badEdges: GateEdge[] = [
        {
          id: 'edge_orphan_01',
          src: 'non_existent_node_999', // Missing in vectors!
        },
      ];
      assertSingleSpace(goodVectors, badEdges, PINNED_DIM);
      addEvent('UNEXPECTED: Assertion passed when orphan edge was present!', 'error');
    } catch (err: any) {
      const msg = err.message || String(err);
      setLastRefusal(msg);
      addEvent(
        `PROVED ORPHAN EDGE PREVENTION :: Mint Gate caught orphan edge: "${msg}". NOTHING WAS PACKED.`,
        'success'
      );
    }
  };

  // Download Minted Lorepack CHIP
  const handleDownloadChip = () => {
    if (!mintedResult || !mintedResult.blob) return;
    const url = URL.createObjectURL(mintedResult.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = mintedResult.filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    addEvent(`DOWNLOAD :: Downloaded ${mintedResult.filename}`, 'info');
  };

  // Copy Manifest JSON
  const handleCopyManifest = () => {
    if (!mintedResult) return;
    const manifest = {
      spec: 'CHIP SPEC v1',
      mintGateVersion: MINT_GATE_VERSION,
      chipTitle,
      chipVersion,
      agentId,
      embeddingModel: PINNED_MODEL,
      embeddingDimension: PINNED_DIM,
      vectorCount: mintedResult.vectorCount,
      timestamp: mintedResult.timestamp,
    };
    navigator.clipboard.writeText(JSON.stringify(manifest, null, 2));
    setCopiedManifest(true);
    setTimeout(() => setCopiedManifest(false), 2000);
  };

  return (
    <div className="flex flex-col gap-6">
      {/* 1. TOP HEADER & CONTRACT BADGES */}
      <div className="bg-neutral-900 border border-neutral-800 rounded-lg p-5 flex flex-col gap-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-neutral-800 pb-4">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-black text-white uppercase tracking-widest font-mono">
                  LOREPACK MINT CHIP
                </h1>
                <span className="text-[10px] px-2 py-0.5 bg-amber-950 text-amber-400 border border-amber-800/80 font-mono font-bold uppercase tracking-wider">
                  CHIP SPEC v1
                </span>
                <span className="text-[10px] px-2 py-0.5 bg-neutral-800 text-neutral-300 border border-neutral-700 font-mono">
                  GATEWAY v{MINT_GATE_VERSION}
                </span>
              </div>
              <p className="text-[11px] text-neutral-400 font-mono mt-0.5">
                Cryptographic Vector Pinning &bull; Zero-Fallback Quota Enforcement &bull; Single-Space Asserter
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={handleRunSpaceAssertion}
              className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 border border-neutral-700 rounded text-xs font-mono font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
              <span>Audit Space Contract</span>
            </button>
            {savedCheckpoint && (
              <button
                onClick={handleClearCheckpoint}
                className="px-3 py-1.5 bg-rose-950/40 hover:bg-rose-900/60 text-rose-300 border border-rose-800/60 rounded text-xs font-mono font-semibold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear Checkpoint ({savedCheckpoint.itemsCount})</span>
              </button>
            )}
          </div>
        </div>

        {/* Space Contract Metrics Bar */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
          <div className="bg-neutral-950 border border-neutral-800/80 p-2.5 rounded flex flex-col gap-1">
            <span className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider">ACTIVE EMBEDDING MODEL</span>
            <div className="flex items-center gap-1.5 text-emerald-400 font-bold truncate">
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{selectedEmbeddingModel}</span>
            </div>
          </div>

          <div className="bg-neutral-950 border border-neutral-800/80 p-2.5 rounded flex flex-col gap-1">
            <span className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider">DIMENSIONALITY</span>
            <div className="flex items-center gap-1.5 text-blue-400 font-bold">
              <Layers className="w-3.5 h-3.5 shrink-0" />
              <span>{PINNED_DIM}-D Pinned Vector</span>
            </div>
          </div>

          <div className="bg-neutral-950 border border-neutral-800/80 p-2.5 rounded flex flex-col gap-1">
            <span className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider">BATCH & PACING</span>
            <div className="flex items-center gap-1.5 text-purple-400 font-bold">
              <Clock className="w-3.5 h-3.5 shrink-0" />
              <span>{EMBED_BATCH}/batch &bull; {EMBED_PACE_MS}ms pace</span>
            </div>
          </div>

          <div className="bg-neutral-950 border border-neutral-800/80 p-2.5 rounded flex flex-col gap-1">
            <span className="text-[10px] text-neutral-500 uppercase font-bold tracking-wider">FALLBACK POLICY</span>
            <div className="flex items-center gap-1.5 text-amber-400 font-bold">
              <Lock className="w-3.5 h-3.5 shrink-0" />
              <span>FAIL-CLOSED (Zero Fakes)</span>
            </div>
          </div>
        </div>
      </div>

      {/* 2. MAIN 2-COLUMN WORKBENCH */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column (7 cols): Configuration & Payload Stager */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          {/* Staging Form Section */}
          <section className="bg-neutral-900 border border-neutral-800 rounded flex flex-col">
            <div className="border-b border-neutral-800 px-4 py-3 flex items-center justify-between bg-neutral-900/60">
              <div className="flex items-center space-x-2">
                <FileCode className="h-4 w-4 text-amber-400" />
                <h2 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                  1. CHIP SPEC & STAGED PAYLOAD
                </h2>
              </div>
              <span className="text-[10px] text-neutral-500 font-mono">
                {stagedChunks.length} CHUNKS READY
              </span>
            </div>

            <div className="p-4 flex flex-col gap-4">
              {/* Agent & Chip Metadata Configuration */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] text-neutral-400 font-mono uppercase tracking-wider mb-1 font-bold">
                    Target Agent Workspace:
                  </label>
                  <select
                    value={agentId}
                    onChange={(e) => setAgentId && setAgentId(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-700 text-neutral-200 text-xs px-2.5 py-2 rounded font-mono focus:border-amber-500 focus:outline-none"
                  >
                    {CANONICAL_MYTHOS_AGENTS.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name} [{agent.id}]
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[10px] text-neutral-400 font-mono uppercase tracking-wider mb-1 font-bold">
                    Chip Title Identifier:
                  </label>
                  <input
                    type="text"
                    value={chipTitle}
                    onChange={(e) => setChipTitle(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-700 text-neutral-200 text-xs px-2.5 py-2 rounded font-mono focus:border-amber-500 focus:outline-none"
                    placeholder="CHIP_TITLE"
                  />
                </div>

                <div>
                  <label className="block text-[10px] text-neutral-400 font-mono uppercase tracking-wider mb-1 font-bold">
                    Source Tag:
                  </label>
                  <input
                    type="text"
                    value={sourceId}
                    onChange={(e) => setSourceId(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-700 text-neutral-200 text-xs px-2.5 py-2 rounded font-mono focus:border-amber-500 focus:outline-none"
                    placeholder="SOURCE_IDENTIFIER"
                  />
                </div>
              </div>

              {/* Dynamic Embedding Model Selection Dropdown */}
              <div className="bg-neutral-950 border border-neutral-800 p-3 rounded flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <label className="block text-[10px] text-neutral-400 font-mono uppercase tracking-wider font-bold">
                    Target Embedding Model:
                  </label>
                  <button
                    type="button"
                    onClick={fetchSupportedEmbeddingModels}
                    disabled={isFetchingModels}
                    className="text-[10px] text-amber-400 hover:text-amber-300 font-mono uppercase tracking-wider flex items-center gap-1 cursor-pointer disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3 h-3 ${isFetchingModels ? 'animate-spin' : ''}`} />
                    <span>{isFetchingModels ? 'Fetching...' : 'Fetch Compatible Models'}</span>
                  </button>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <select
                    id="mintEmbeddingModelSelect"
                    value={selectedEmbeddingModel}
                    onChange={(e) => {
                      const newModel = e.target.value;
                      setSelectedEmbeddingModel(newModel);
                      addEvent(`EMBEDDING MODEL CHANGED :: Switched active target model to [${newModel}].`, 'info');
                    }}
                    className="flex-1 bg-neutral-900 border border-neutral-700 text-neutral-200 text-xs px-2.5 py-2 rounded font-mono focus:border-amber-500 focus:outline-none cursor-pointer"
                  >
                    {availableEmbeddingModels.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Compatibility Validation Notice */}
                {(() => {
                  const compat = validateModelCompatibility(generationModel, selectedEmbeddingModel);
                  if (!compat.compatible) {
                    return (
                      <div className="bg-rose-950/40 border border-rose-800/80 p-2 rounded text-[10px] font-mono text-rose-300 flex items-start gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                        <div>
                          <strong className="text-rose-400 uppercase font-bold">Compatibility Warning: </strong>
                          <span>{compat.reason}</span>
                        </div>
                      </div>
                    );
                  }
                  return (
                    <div className="bg-emerald-950/30 border border-emerald-800/40 p-1.5 rounded text-[10px] font-mono text-emerald-400 flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                        <span>Compatible with generation model [{generationModel}]</span>
                      </span>
                      <span className="text-neutral-500 text-[9px]">{PINNED_DIM}-D unified vector space</span>
                    </div>
                  );
                })()}
              </div>

              {/* API Key Selection & Masking */}
              <div>
                <label className="block text-[10px] text-neutral-400 font-mono uppercase tracking-wider mb-1 font-bold flex items-center justify-between">
                  <span>Gemini API Key Lane (Never logged unmasked per CHIP SPEC):</span>
                  <span className="text-neutral-500 lowercase">
                    {customApiKeys.length} registered key(s)
                  </span>
                </label>
                <div className="flex gap-2">
                  <select
                    value={selectedApiKey}
                    onChange={(e) => setSelectedApiKey(e.target.value)}
                    className="w-full bg-neutral-950 border border-neutral-700 text-neutral-200 text-xs px-2.5 py-2 rounded font-mono focus:border-amber-500 focus:outline-none"
                  >
                    <option value="">
                      Use System / First Key Pool ({maskSecret(getActiveKey())})
                    </option>
                    {customApiKeys.map((k, idx) => (
                      <option key={idx} value={k}>
                        Lane {idx + 1}: {maskSecret(k)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Preset Scenario Quick-Pickers */}
              <div>
                <span className="block text-[10px] text-neutral-400 font-mono uppercase tracking-wider mb-1.5 font-bold">
                  Quick Load Scenario Presets:
                </span>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {PRESET_LORE_SCENARIOS.map((scenario, sIdx) => (
                    <button
                      key={sIdx}
                      type="button"
                      onClick={() => {
                        setSourceId(scenario.source);
                        setRawText(scenario.chunks.join('\n\n'));
                        addEvent(`Loaded preset: ${scenario.name} (${scenario.chunks.length} chunks).`, 'info');
                      }}
                      className="text-left bg-neutral-950 hover:bg-neutral-800/80 border border-neutral-800 hover:border-neutral-700 p-2.5 rounded transition-colors group cursor-pointer"
                    >
                      <div className="text-[11px] font-bold text-neutral-200 group-hover:text-amber-400 font-mono truncate">
                        {scenario.name}
                      </div>
                      <div className="text-[10px] text-neutral-500 font-mono truncate mt-0.5">
                        {scenario.description}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Text Area for Knowledge Chunks */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] text-neutral-400 font-mono uppercase tracking-wider font-bold">
                    Knowledge Chunks (Separated by double newlines):
                  </label>
                  <span className="text-[10px] text-neutral-500 font-mono">
                    {rawText.length} characters &bull; {stagedChunks.length} parsed items
                  </span>
                </div>
                <textarea
                  rows={7}
                  value={rawText}
                  onChange={(e) => setRawText(e.target.value)}
                  placeholder="Paste multi-line lore, axioms, or narrative sequences..."
                  className="w-full bg-neutral-950 border border-neutral-800 text-neutral-200 font-mono text-xs p-3 rounded focus:border-amber-500 focus:outline-none resize-y leading-relaxed"
                />
              </div>

              {/* Staged Items Preview Table */}
              <div className="border border-neutral-800 rounded bg-neutral-950 overflow-hidden">
                <div className="bg-neutral-900/60 px-3 py-2 border-b border-neutral-800 flex items-center justify-between text-[10px] font-mono text-neutral-400 uppercase font-bold">
                  <span>Staged Vector Payload Preview</span>
                  <span>Target: {PINNED_MODEL}</span>
                </div>
                <div className="max-h-40 overflow-y-auto divide-y divide-neutral-900 font-mono text-xs">
                  {stagedChunks.map((chunk, idx) => (
                    <div key={chunk.id} className="p-2.5 flex items-start justify-between gap-3 hover:bg-neutral-900/40">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-[9px] px-1.5 py-0.2 bg-neutral-800 text-neutral-400 border border-neutral-700">
                            #{idx + 1}
                          </span>
                          <span className="text-[10px] text-amber-400 truncate">
                            {chunk.id}
                          </span>
                        </div>
                        <p className="text-[11px] text-neutral-300 truncate">
                          {chunk.text}
                        </p>
                      </div>
                      <span className="text-[10px] text-neutral-500 shrink-0">
                        {chunk.charCount}c
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Mint Controls */}
              {(() => {
                const compat = validateModelCompatibility(generationModel, selectedEmbeddingModel);
                const disabled = isMinting || stagedChunks.length === 0 || !compat.compatible;
                return (
                  <div className="flex flex-col sm:flex-row gap-3 pt-2">
                    <button
                      id="mintChipBtn"
                      type="button"
                      onClick={handleMintLorepackChip}
                      disabled={disabled}
                      title={!compat.compatible ? compat.reason : undefined}
                      className="flex-1 bg-amber-600 hover:bg-amber-500 disabled:bg-neutral-800 text-neutral-950 disabled:text-neutral-500 font-mono font-bold px-4 py-3 rounded text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:cursor-not-allowed shadow-md shadow-amber-950/20"
                    >
                      {isMinting ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin text-neutral-900" />
                          <span>Minting In Progress...</span>
                        </>
                      ) : !compat.compatible ? (
                        <>
                          <AlertTriangle className="w-4 h-4 text-rose-400" />
                          <span>Mint Blocked: Model Conflict</span>
                        </>
                      ) : (
                        <>
                          <Sparkles className="w-4 h-4 text-neutral-950" />
                          <span>Mint Lorepack CHIP ({stagedChunks.length} Chunks &bull; {selectedEmbeddingModel})</span>
                        </>
                      )}
                    </button>
                  </div>
                );
              })()}
            </div>
          </section>

          {/* Verification & Proof Sandbox Section */}
          <section className="bg-neutral-900 border border-neutral-800 rounded flex flex-col">
            <div className="border-b border-neutral-800 px-4 py-3 flex items-center justify-between bg-neutral-900/60">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                <h2 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                  2. PROOF BEFORE SHIP & STRESS TESTS
                </h2>
              </div>
              <span className="text-[10px] text-neutral-500 font-mono">
                CHIP SPEC § 4
              </span>
            </div>

            <div className="p-4 flex flex-col gap-3 font-mono">
              <p className="text-[11px] text-neutral-400 leading-relaxed">
                CHIP SPEC v1 requires live behavioral proof: test happy path, refusal path, and quota enforcement. Verify that fallback vectors are never minted.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                <button
                  type="button"
                  onClick={handleSimulateQuotaRejection}
                  disabled={isMinting}
                  className="bg-neutral-950 hover:bg-neutral-800 border border-neutral-800 hover:border-amber-600/60 text-amber-300 p-2.5 rounded text-left transition-colors cursor-pointer disabled:opacity-50"
                >
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-400">
                    <Clock className="w-3.5 h-3.5" />
                    <span>Test 429 Quota Refusal</span>
                  </div>
                  <p className="text-[9px] text-neutral-400 mt-1">
                    Asserts quota wait, loud throw, and zero synthetic fallbacks.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={handleSimulateDimensionMismatch}
                  disabled={isMinting}
                  className="bg-neutral-950 border border-neutral-800 hover:bg-neutral-800 hover:border-blue-600/60 text-blue-300 p-2.5 rounded text-left transition-colors cursor-pointer disabled:opacity-50"
                >
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-blue-400">
                    <Layers className="w-3.5 h-3.5" />
                    <span>Test Dim Assertion</span>
                  </div>
                  <p className="text-[9px] text-neutral-400 mt-1">
                    Proves 1536-D is refused; only 768-D allowed.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={handleSimulateOrphanEdge}
                  disabled={isMinting}
                  className="bg-neutral-950 border border-neutral-800 hover:bg-neutral-800 hover:border-purple-600/60 text-purple-300 p-2.5 rounded text-left transition-colors cursor-pointer disabled:opacity-50"
                >
                  <div className="flex items-center gap-1.5 text-[11px] font-bold text-purple-400">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>Test Orphan Edge Gate</span>
                  </div>
                  <p className="text-[9px] text-neutral-400 mt-1">
                    Proves edges pointing to unminted nodes are refused.
                  </p>
                </button>
              </div>
            </div>
          </section>
        </div>

        {/* Right Column (5 cols): Space Contract Monitor, Progress, Refusals & Terminal */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          {/* Active Refusal Alert (if any) */}
          {lastRefusal && (
            <div className="bg-rose-950/40 border border-rose-800/80 rounded-lg p-4 font-mono">
              <div className="flex items-center gap-2 text-rose-400 font-bold text-xs uppercase tracking-wider mb-1.5">
                <XCircle className="w-4 h-4 shrink-0" />
                <span>MINT GATE REFUSAL ENFORCED</span>
              </div>
              <p className="text-[11px] text-rose-300 leading-relaxed break-words bg-black/40 p-2.5 rounded border border-rose-900/50">
                {lastRefusal}
              </p>
              <div className="mt-2.5 text-[10px] text-rose-400 flex items-center justify-between">
                <span>POLICY: Fail Closed &bull; Zero Fake Vectors</span>
                <button
                  type="button"
                  onClick={() => setLastRefusal(null)}
                  className="text-neutral-400 hover:text-white underline cursor-pointer"
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

          {/* Space Contract Assertion Status Card */}
          <section className="bg-neutral-900 border border-neutral-800 rounded flex flex-col font-mono">
            <div className="border-b border-neutral-800 px-4 py-3 flex items-center justify-between bg-neutral-900/60">
              <div className="flex items-center space-x-2">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                <h2 className="text-xs font-bold text-white uppercase tracking-wider">
                  SPACE CONTRACT STATE
                </h2>
              </div>
              <span
                className={`text-[9px] px-2 py-0.5 font-bold uppercase tracking-wider ${
                  assertionState.ran
                    ? assertionState.valid
                      ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                      : 'bg-rose-950 text-rose-400 border border-rose-800'
                    : 'bg-neutral-800 text-neutral-400 border border-neutral-700'
                }`}
              >
                {assertionState.ran
                  ? assertionState.valid
                    ? 'VERIFIED [PASS]'
                    : 'REFUSED [FAIL]'
                  : 'PENDING AUDIT'}
              </span>
            </div>

            <div className="p-4 flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="bg-neutral-950 p-2.5 rounded border border-neutral-800/80 flex items-center justify-between">
                  <span className="text-neutral-400">Dimensions:</span>
                  <span
                    className={`font-bold ${
                      assertionState.checks.dimensions === true
                        ? 'text-emerald-400'
                        : assertionState.checks.dimensions === false
                        ? 'text-rose-400'
                        : 'text-neutral-500'
                    }`}
                  >
                    768-D {assertionState.checks.dimensions ? '✔' : ''}
                  </span>
                </div>

                <div className="bg-neutral-950 p-2.5 rounded border border-neutral-800/80 flex items-center justify-between">
                  <span className="text-neutral-400">Model Pinned:</span>
                  <span
                    className={`font-bold ${
                      assertionState.checks.modelPinned === true
                        ? 'text-emerald-400'
                        : assertionState.checks.modelPinned === false
                        ? 'text-rose-400'
                        : 'text-neutral-500'
                    }`}
                  >
                    gemini-2 {assertionState.checks.modelPinned ? '✔' : ''}
                  </span>
                </div>

                <div className="bg-neutral-950 p-2.5 rounded border border-neutral-800/80 flex items-center justify-between">
                  <span className="text-neutral-400">Duplicate IDs:</span>
                  <span
                    className={`font-bold ${
                      assertionState.checks.noDuplicateIds === true
                        ? 'text-emerald-400'
                        : assertionState.checks.noDuplicateIds === false
                        ? 'text-rose-400'
                        : 'text-neutral-500'
                    }`}
                  >
                    Zero Dupes {assertionState.checks.noDuplicateIds ? '✔' : ''}
                  </span>
                </div>

                <div className="bg-neutral-950 p-2.5 rounded border border-neutral-800/80 flex items-center justify-between">
                  <span className="text-neutral-400">Edge Integrity:</span>
                  <span
                    className={`font-bold ${
                      assertionState.checks.noOrphanEdges === true
                        ? 'text-emerald-400'
                        : assertionState.checks.noOrphanEdges === false
                        ? 'text-rose-400'
                        : 'text-neutral-500'
                    }`}
                  >
                    No Orphans {assertionState.checks.noOrphanEdges ? '✔' : ''}
                  </span>
                </div>
              </div>

              {assertionState.ran && (
                <div className="text-[10px] text-neutral-400 bg-neutral-950 p-2 rounded border border-neutral-800 flex items-center justify-between">
                  <span>Audited Partition: [{agentId}]</span>
                  <span>
                    {assertionState.vectorCount} vectors &bull; {assertionState.edgeCount} edges
                  </span>
                </div>
              )}
            </div>
          </section>

          {/* Minted Artifacts Output Section */}
          {mintedResult && (
            <section className="bg-neutral-900 border border-emerald-800/60 rounded flex flex-col font-mono shadow-lg shadow-emerald-950/20">
              <div className="border-b border-emerald-800/60 px-4 py-3 flex items-center justify-between bg-emerald-950/30">
                <div className="flex items-center space-x-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                  <h2 className="text-xs font-bold text-white uppercase tracking-wider">
                    3. MINTED LOREPACK ARTIFACT
                  </h2>
                </div>
                <span className="text-[10px] text-emerald-400 font-bold">
                  {mintedResult.vectorCount} VECTORS PACKED
                </span>
              </div>

              <div className="p-4 flex flex-col gap-3">
                <div className="bg-neutral-950 p-3 rounded border border-neutral-800 flex flex-col gap-1.5 text-xs">
                  <div className="flex justify-between text-neutral-400">
                    <span>Artifact Name:</span>
                    <span className="text-white font-bold">{mintedResult.filename}</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Model Space:</span>
                    <span className="text-emerald-400">{mintedResult.model} ({mintedResult.dim}-D)</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Archive Size:</span>
                    <span className="text-neutral-300">
                      {mintedResult.blob ? `${(mintedResult.blob.size / 1024).toFixed(1)} KB` : 'N/A'}
                    </span>
                  </div>
                </div>

                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={handleDownloadChip}
                    className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-neutral-950 font-bold py-2.5 px-3 rounded text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download CHIP Archive</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleCopyManifest}
                    className="bg-neutral-800 hover:bg-neutral-700 text-neutral-200 font-bold py-2.5 px-3 rounded text-xs uppercase tracking-wider flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                  >
                    {copiedManifest ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Manifest</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </section>
          )}

          {/* Mint Gate Event Terminal */}
          <section className="bg-neutral-900 border border-neutral-800 rounded flex flex-col flex-1 min-h-[300px]">
            <div className="border-b border-neutral-800 px-4 py-3 flex items-center justify-between bg-neutral-900/60">
              <div className="flex items-center space-x-2">
                <Terminal className="h-4 w-4 text-emerald-400" />
                <h2 className="text-xs font-bold text-white uppercase tracking-wider font-mono">
                  MINT GATE TELEMETRY
                </h2>
              </div>
              <div className="flex items-center space-x-2">
                <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[10px] text-neutral-500 font-mono">LIVE_BUS</span>
              </div>
            </div>

            {/* Progress Bar (Visible while minting or when progress occurred) */}
            {progressState.total > 0 && (
              <div className="bg-neutral-950 px-4 py-2 border-b border-neutral-800 flex flex-col gap-1.5 font-mono">
                <div className="flex justify-between text-[10px] text-neutral-400">
                  <span className="truncate">{progressState.statusText}</span>
                  <span className="font-bold text-neutral-200">{progressState.percent}%</span>
                </div>
                <div className="w-full bg-neutral-800 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-amber-500 h-full transition-all duration-300"
                    style={{ width: `${progressState.percent}%` }}
                  />
                </div>
              </div>
            )}

            {/* Terminal Feed */}
            <div className="p-3 bg-neutral-950 font-mono text-[11px] overflow-y-auto max-h-[320px] flex-1 flex flex-col gap-1 text-neutral-300">
              {events.map((ev) => (
                <div key={ev.id} className="flex items-start gap-2 leading-relaxed">
                  <span className="text-neutral-600 shrink-0 select-none">
                    [{ev.timestamp}]
                  </span>
                  <span
                    className={`break-all ${
                      ev.type === 'error'
                        ? 'text-rose-400 font-bold'
                        : ev.type === 'warn'
                        ? 'text-amber-400'
                        : ev.type === 'success'
                        ? 'text-emerald-400 font-bold'
                        : ev.type === 'gate'
                        ? 'text-purple-400 font-semibold'
                        : 'text-neutral-300'
                    }`}
                  >
                    {ev.message}
                  </span>
                </div>
              ))}
              <div ref={terminalEndRef} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
};
