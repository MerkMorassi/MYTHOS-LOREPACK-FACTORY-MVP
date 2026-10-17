import React, { useState, useRef, useEffect } from 'react';
import {
  Files,
  UploadCloud,
  Play,
  Square,
  Trash2,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  FileText,
  RotateCcw,
  Sparkles,
  Layers,
  Database,
  ArrowRight,
  Check,
  AlertCircle,
  RefreshCw
} from 'lucide-react';
import type { LorepackFactory } from '../lorepack-factory.ts';
import type { LorepackStore } from '../types.ts';

export interface BulkDocument {
  id: string;
  name: string;
  size: number;
  content?: string;
  file?: File;
  status: 'pending' | 'reading' | 'ingesting' | 'completed' | 'error';
  progress: { processed: number; total: number };
  chunksCount?: number;
  vectorsCount?: number;
  error?: string;
  addedAt: number;
}

export interface BulkOperationViewProps {
  factory: LorepackFactory | null;
  store?: LorepackStore | null;
  agentId: string;
  chunkSize: number;
  queue: BulkDocument[];
  setQueue: React.Dispatch<React.SetStateAction<BulkDocument[]>>;
  isProcessing: boolean;
  setIsProcessing: React.Dispatch<React.SetStateAction<boolean>>;
  onIngestComplete: () => Promise<void>;
  log: (msg: string) => void;
}

export const BulkOperationView: React.FC<BulkOperationViewProps> = ({
  factory,
  agentId,
  chunkSize: defaultChunkSize,
  queue,
  setQueue,
  isProcessing,
  setIsProcessing,
  onIngestComplete,
  log,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [localChunkSize, setLocalChunkSize] = useState<number>(defaultChunkSize || 500);
  const [summaryFilter, setSummaryFilter] = useState<'all' | 'completed' | 'error' | 'pending'>('all');
  const [lastSavedTime, setLastSavedTime] = useState<number>(Date.now());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<boolean>(false);

  // Automatic saving of current bulk document queue to localStorage for session resumption
  useEffect(() => {
    try {
      const serializableQueue = queue.map(({ file, ...rest }) => rest);
      localStorage.setItem('mythos_bulk_queue', JSON.stringify(serializableQueue));
      setLastSavedTime(Date.now());
    } catch (err) {
      console.warn('Failed to auto-save bulk queue to localStorage:', err);
    }
  }, [queue]);

  // Derived metrics
  const totalCount = queue.length;
  const completedCount = queue.filter((d) => d.status === 'completed').length;
  const pendingCount = queue.filter((d) => d.status === 'pending').length;
  const errorCount = queue.filter((d) => d.status === 'error').length;
  const activeDoc = queue.find((d) => d.status === 'reading' || d.status === 'ingesting');

  // Combined progress calculation
  // Each file has equal weight towards the document count, plus proportional chunk progress for the active document
  let combinedPercent = 0;
  if (totalCount > 0) {
    let fileUnitsCompleted = completedCount;
    if (activeDoc && activeDoc.progress.total > 0) {
      fileUnitsCompleted += activeDoc.progress.processed / activeDoc.progress.total;
    }
    combinedPercent = Math.min(100, Math.round((fileUnitsCompleted / totalCount) * 100));
  }

  const totalVectorsCommitted = queue.reduce(
    (acc, d) => acc + (d.vectorsCount || 0),
    0
  );
  const totalChunksCreated = queue.reduce(
    (acc, d) => acc + (d.chunksCount || 0),
    0
  );

  // Filtered documents for summary table
  const filteredSummaryDocs = queue.filter((doc) => {
    if (summaryFilter === 'all') return true;
    if (summaryFilter === 'completed') return doc.status === 'completed';
    if (summaryFilter === 'error') return doc.status === 'error';
    if (summaryFilter === 'pending') {
      return doc.status === 'pending' || doc.status === 'reading' || doc.status === 'ingesting';
    }
    return true;
  });

  // Add files to queue with async content caching for reliable localStorage persistence
  const handleAddFiles = async (fileList: FileList | File[]) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    const newDocs: BulkDocument[] = await Promise.all(
      files.map(async (file, idx) => {
        let content = '';
        try {
          content = await file.text();
        } catch (err) {
          console.warn(`Could not pre-read text for "${file.name}":`, err);
        }
        return {
          id: `doc-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 7)}`,
          name: file.name,
          size: file.size,
          file,
          content,
          status: 'pending' as const,
          progress: { processed: 0, total: 0 },
          addedAt: Date.now(),
        };
      })
    );

    setQueue((prev) => [...prev, ...newDocs]);
    log(`[BULK]: Queued ${files.length} document(s) for serial ingestion (cached for persistence).`);
  };

  // Drag and Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleAddFiles(e.dataTransfer.files);
    }
  };

  // Add sample demo documents
  const handleAddSampleDocs = () => {
    const sampleDocs: BulkDocument[] = [
      {
        id: `sample-${Date.now()}-1`,
        name: 'mythos_chronicles_tome_i.txt',
        size: 2840,
        content: `[ZOE ARCHIVES] TOME I: THE SIGIL AWAKENING
In the first era of autonomous intelligence, Zoe Films chartered the MythOS protocol. 
Sixteen canonical agents were manifested across localized port channels to maintain cognitive integrity. 
Primary among these was Maya, the Chronologist, tasked with preserving temporal coherence across all lorepacks.
Every record committed to the store must bear a cryptographically verifiable sigil, certifying authenticity and single-space provenance.`,
        status: 'pending',
        progress: { processed: 0, total: 0 },
        addedAt: Date.now(),
      },
      {
        id: `sample-${Date.now()}-2`,
        name: 'archaeo_codex_fragments.txt',
        size: 3410,
        content: `[ARCHAEO CODEX] FRAGMENT 42: RELATIONAL TRIPLET DYNAMICS
Triplets form the connective tissue of the semantic memory web. Each vector node connects to related entities via directional predicates.
When an operative inspects a subject entity in the database explorer, all incoming and outgoing edges must illuminate instantaneously.
Failure to resolve relational triplet linkages degrades agent situational awareness and fragments semantic cohesion.`,
        status: 'pending',
        progress: { processed: 0, total: 0 },
        addedAt: Date.now() + 1,
      },
      {
        id: `sample-${Date.now()}-3`,
        name: 'quantum_vault_manifest.txt',
        size: 1980,
        content: `[SECURITY PROTOCOL] SECTION 9: LOREPACK TRANSPORT ARCHITECTURE
All lorepack archives exported for cold storage are serialized into chunked gzip compressed byte streams.
During memory migration, the gateway verifies single-space invariant constraints and guarantees zero cross-agent leakage.
Integrity checksums and deterministic hashes ensure unalterable state transfer across execution boundaries.`,
        status: 'pending',
        progress: { processed: 0, total: 0 },
        addedAt: Date.now() + 2,
      },
    ];

    setQueue((prev) => [...prev, ...sampleDocs]);
    log('[BULK]: Added 3 canonical sample documents to the serial ingestion queue.');
  };

  // Retry individual failed document
  const handleRetryFailedDoc = (docId: string, runImmediately: boolean = false) => {
    setQueue((prev) =>
      prev.map((d) =>
        d.id === docId
          ? {
              ...d,
              status: 'pending',
              error: undefined,
              progress: { processed: 0, total: 0 },
            }
          : d
      )
    );
    const doc = queue.find((d) => d.id === docId);
    log(`[BULK]: Queued "${doc?.name || docId}" for retry.`);

    if (runImmediately && !isProcessing) {
      setTimeout(() => {
        handleStartSerialIngest();
      }, 60);
    }
  };

  // Retry all failed documents
  const handleRetryAllFailed = () => {
    setQueue((prev) =>
      prev.map((d) =>
        d.status === 'error'
          ? {
              ...d,
              status: 'pending',
              error: undefined,
              progress: { processed: 0, total: 0 },
            }
          : d
      )
    );
    log(`[BULK]: Queued ${errorCount} failed document(s) for retry.`);
  };

  // Remove single document
  const handleRemoveDoc = (id: string) => {
    setQueue((prev) => prev.filter((d) => d.id !== id));
  };

  // Clear completed or all
  const handleClearCompleted = () => {
    setQueue((prev) => prev.filter((d) => d.status !== 'completed'));
  };

  const handleClearAll = () => {
    if (isProcessing) return;
    setQueue([]);
    try {
      localStorage.removeItem('mythos_bulk_queue');
    } catch (err) {
      console.warn('Failed to clear bulk queue from localStorage:', err);
    }
  };

  // Serial ingestion runner
  const handleStartSerialIngest = async () => {
    if (!factory) {
      log('[BULK_ERROR]: Lorepack factory is not initialized.');
      return;
    }

    if (queue.length === 0) {
      log('[BULK_WARNING]: No documents in queue to process.');
      return;
    }

    const pendingDocs = queue.filter((d) => d.status === 'pending');
    if (pendingDocs.length === 0) {
      log('[BULK_INFO]: No pending documents in queue.');
      return;
    }

    abortRef.current = false;
    setIsProcessing(true);
    log(`[BULK]: Starting serial ingestion pipeline for ${pendingDocs.length} pending document(s)...`);

    try {
      // Serial execution: process each pending item sequentially
      for (let i = 0; i < queue.length; i++) {
        if (abortRef.current) {
          log('[BULK]: Serial processing halted by user command.');
          break;
        }

        const currentDoc = queue[i];
        if (currentDoc.status !== 'pending') {
          continue;
        }

        const docId = currentDoc.id;

        // Step 1: Reading file text
        setQueue((prev) =>
          prev.map((d) => (d.id === docId ? { ...d, status: 'reading' } : d))
        );
        log(`[BULK]: [${i + 1}/${queue.length}] Reading payload: "${currentDoc.name}"...`);

        let text = '';
        try {
          if (currentDoc.content) {
            text = currentDoc.content;
          } else if (currentDoc.file) {
            text = await currentDoc.file.text();
          } else {
            throw new Error('No content or file data available');
          }
        } catch (readErr: any) {
          log(`[BULK_ERROR]: Failed to read file "${currentDoc.name}": ${readErr.message}`);
          setQueue((prev) =>
            prev.map((d) =>
              d.id === docId
                ? {
                    ...d,
                    status: 'error',
                    error: readErr.message || 'Failed to read file',
                  }
                : d
            )
          );
          continue;
        }

        // Step 2: Chunking document
        const chunks = factory.chunk(text, localChunkSize);
        if (chunks.length === 0) {
          log(`[BULK_WARNING]: Document "${currentDoc.name}" produced 0 chunks. Marking complete.`);
          setQueue((prev) =>
            prev.map((d) =>
              d.id === docId
                ? {
                    ...d,
                    status: 'completed',
                    chunksCount: 0,
                    vectorsCount: 0,
                  }
                : d
            )
          );
          continue;
        }

        log(`[BULK]: Sliced "${currentDoc.name}" into ${chunks.length} chunks. Dispatching to embeddings...`);

        // Step 3: Transition to ingesting status
        setQueue((prev) =>
          prev.map((d) =>
            d.id === docId
              ? {
                  ...d,
                  status: 'ingesting',
                  chunksCount: chunks.length,
                  progress: { processed: 0, total: chunks.length },
                }
              : d
          )
        );

        const batches = chunks.map((chunkText) => ({
          text: chunkText,
          source: currentDoc.name,
        }));

        // Step 4: Ingest batches serially through factory
        try {
          const result = await factory.ingestBatches(batches, {
            agentId,
            onProgress: (p) => {
              setQueue((prev) =>
                prev.map((d) =>
                  d.id === docId
                    ? {
                        ...d,
                        progress: { processed: p.processed, total: batches.length },
                      }
                    : d
                )
              );
            },
          });

          // Step 5: Mark document completed
          setQueue((prev) =>
            prev.map((d) =>
              d.id === docId
                ? {
                    ...d,
                    status: 'completed',
                    chunksCount: chunks.length,
                    vectorsCount: result.ingested,
                    progress: { processed: batches.length, total: batches.length },
                  }
                : d
            )
          );

          log(
            `[BULK]: Successfully ingested "${currentDoc.name}" (+${result.ingested} vectors).`
          );

          // Refresh database explorer and active stats
          await onIngestComplete();
        } catch (ingestErr: any) {
          log(`[BULK_ERROR]: Failed to ingest batches for "${currentDoc.name}": ${ingestErr.message}`);
          setQueue((prev) =>
            prev.map((d) =>
              d.id === docId
                ? {
                    ...d,
                    status: 'error',
                    error: ingestErr.message || 'Batch ingestion error',
                  }
                : d
            )
          );
        }
      }

      log('[BULK]: Serial batch processing cycle completed.');
    } catch (err: any) {
      log(`[BULK_CRITICAL]: Unexpected error in serial queue runner: ${err.message || err}`);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleStopSerialIngest = () => {
    abortRef.current = true;
    setIsProcessing(false);
    log('[BULK]: Abort signal dispatched to serial worker.');
  };

  return (
    <div className="flex flex-col gap-6 w-full">
      {/* 1. Header & Combined Progress Hero Indicator */}
      <section className="bg-neutral-900 border border-neutral-800 rounded-lg p-5 flex flex-col gap-5 shadow-lg">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-neutral-800 pb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 bg-sky-950/60 border border-sky-800/80 rounded text-sky-400">
              <Files className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-sm font-bold text-white uppercase tracking-wider">
                  Bulk Serial Ingestion Console
                </h1>
                <span
                  className={`text-[9px] px-2 py-0.5 rounded font-mono font-bold uppercase tracking-wider border ${
                    isProcessing
                      ? 'bg-sky-950/80 text-sky-300 border-sky-700 animate-pulse'
                      : completedCount === totalCount && totalCount > 0
                      ? 'bg-emerald-950 text-emerald-300 border-emerald-700'
                      : 'bg-neutral-800 text-neutral-400 border-neutral-700'
                  }`}
                >
                  {isProcessing
                    ? 'SERIAL_PROCESSING_ACTIVE'
                    : completedCount === totalCount && totalCount > 0
                    ? 'ALL_DOCUMENTS_COMMITTED'
                    : 'QUEUE_STANDBY'}
                </span>
              </div>
              <p className="text-[11px] text-neutral-400 font-mono mt-0.5">
                Target Workspace Agent: <span className="text-amber-400 font-bold uppercase">{agentId}</span>
              </p>
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 flex-wrap">
            {isProcessing ? (
              <button
                id="btn-stop-bulk-ingest"
                onClick={handleStopSerialIngest}
                className="px-3.5 py-2 bg-rose-950 border border-rose-800 text-rose-300 hover:bg-rose-900 hover:text-white rounded text-xs font-mono font-bold uppercase tracking-wider flex items-center gap-2 cursor-pointer transition-colors shadow-sm"
              >
                <Square className="w-3.5 h-3.5 fill-current" />
                Halt Queue
              </button>
            ) : (
              <button
                id="btn-start-bulk-ingest"
                onClick={handleStartSerialIngest}
                disabled={pendingCount === 0}
                className="px-4 py-2 bg-emerald-950 border border-emerald-700 text-emerald-300 hover:bg-emerald-900 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed rounded text-xs font-mono font-bold uppercase tracking-wider flex items-center gap-2 cursor-pointer transition-colors shadow-sm"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                Start Serial Ingest ({pendingCount})
              </button>
            )}

            <button
              onClick={handleAddSampleDocs}
              disabled={isProcessing}
              className="px-3 py-2 bg-neutral-950 border border-neutral-800 text-neutral-300 hover:text-amber-300 hover:border-amber-800/80 disabled:opacity-40 rounded text-xs font-mono flex items-center gap-1.5 cursor-pointer transition-colors"
              title="Add 3 demonstration files to queue"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span className="hidden md:inline">Queue Samples</span>
            </button>

            {completedCount > 0 && !isProcessing && (
              <button
                onClick={handleClearCompleted}
                className="px-3 py-2 bg-neutral-950 border border-neutral-800 text-neutral-400 hover:text-white rounded text-xs font-mono flex items-center gap-1 cursor-pointer transition-colors"
                title="Clear completed documents from queue"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden md:inline">Clear Done</span>
              </button>
            )}

            {queue.length > 0 && !isProcessing && (
              <button
                onClick={handleClearAll}
                className="px-2.5 py-2 bg-neutral-950 border border-neutral-800 text-neutral-500 hover:text-rose-400 hover:border-rose-900/60 rounded text-xs cursor-pointer transition-colors"
                title="Clear all queued items"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Combined Progress Bar & Stats Display */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between text-xs font-mono">
            <div className="flex items-center gap-2">
              <span className="text-neutral-400 uppercase font-semibold">Combined Queue Progress:</span>
              <span className="text-white font-bold text-sm">{combinedPercent}%</span>
              {activeDoc && (
                <span className="text-sky-400 text-[11px] truncate max-w-xs md:max-w-md">
                  &bull; Processing: <span className="font-bold">{activeDoc.name}</span> ({activeDoc.progress.processed}/{activeDoc.progress.total} chunks)
                </span>
              )}
            </div>
            <div className="text-neutral-500 text-[11px]">
              {completedCount} of {totalCount} Documents Complete
            </div>
          </div>

          {/* Master Progress Bar */}
          <div className="w-full bg-neutral-950 h-3 rounded-full border border-neutral-800 overflow-hidden relative">
            <div
              className={`h-full transition-all duration-300 rounded-full ${
                isProcessing
                  ? 'bg-gradient-to-r from-sky-600 via-emerald-500 to-sky-400'
                  : completedCount === totalCount && totalCount > 0
                  ? 'bg-emerald-500'
                  : 'bg-neutral-600'
              }`}
              style={{ width: `${combinedPercent}%` }}
            />
          </div>

          {/* Metrics Dashboard */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
            <div className="bg-neutral-950/70 border border-neutral-800/80 p-3 rounded">
              <p className="text-[10px] text-neutral-500 uppercase tracking-widest font-mono">Total Documents</p>
              <p className="text-base font-bold text-white mt-1 font-mono">{totalCount}</p>
            </div>
            <div className="bg-neutral-950/70 border border-neutral-800/80 p-3 rounded">
              <p className="text-[10px] text-neutral-500 uppercase tracking-widest font-mono">Pending in Queue</p>
              <p className="text-base font-bold text-amber-400 mt-1 font-mono">{pendingCount}</p>
            </div>
            <div className="bg-neutral-950/70 border border-neutral-800/80 p-3 rounded">
              <p className="text-[10px] text-neutral-500 uppercase tracking-widest font-mono">Chunks Serialized</p>
              <p className="text-base font-bold text-sky-400 mt-1 font-mono">{totalChunksCreated}</p>
            </div>
            <div className="bg-neutral-950/70 border border-neutral-800/80 p-3 rounded">
              <p className="text-[10px] text-neutral-500 uppercase tracking-widest font-mono">Committed Vectors</p>
              <p className="text-base font-bold text-emerald-400 mt-1 font-mono">+{totalVectorsCommitted}</p>
            </div>
          </div>
        </div>
      </section>

      {/* Session Resumption Alert Banner (if restored from localStorage with pending items) */}
      {pendingCount > 0 && completedCount > 0 && !isProcessing && (
        <div className="bg-sky-950/40 border border-sky-800/80 p-3.5 rounded-lg flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs font-mono text-sky-200">
          <div className="flex items-center gap-2.5">
            <RotateCcw className="w-4 h-4 text-sky-400 shrink-0" />
            <div>
              <p className="font-bold text-white">In-Progress Serial Queue Restored From Session Storage</p>
              <p className="text-[11px] text-sky-300">
                Found {completedCount} already completed and {pendingCount} pending document(s). You can resume execution directly.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleStartSerialIngest}
            className="px-3.5 py-1.5 bg-sky-900 hover:bg-sky-800 text-white font-bold rounded border border-sky-600 transition-colors flex items-center gap-1.5 cursor-pointer shadow-sm shrink-0"
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            Resume Serial Ingest ({pendingCount})
          </button>
        </div>
      )}

      {/* 2. Upload / Queue Drag & Drop Ingestion Zone */}
      <section
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`bg-neutral-900 border-2 border-dashed rounded-lg p-6 flex flex-col items-center justify-center text-center transition-colors ${
          isDragging
            ? 'border-sky-500 bg-sky-950/20'
            : 'border-neutral-800 hover:border-neutral-700 bg-neutral-900/50'
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".txt,.md,.json,.csv,.log,.text,text/*"
          onChange={(e) => {
            if (e.target.files) {
              handleAddFiles(e.target.files);
              e.target.value = '';
            }
          }}
          className="hidden"
          id="bulkFileInput"
        />

        <div className="w-12 h-12 rounded-full bg-neutral-950 border border-neutral-800 flex items-center justify-center text-sky-400 mb-3 shadow-inner">
          <UploadCloud className="w-6 h-6" />
        </div>

        <h3 className="text-sm font-bold text-white uppercase tracking-wider mb-1">
          Queue Documents for Serial Ingestion
        </h3>
        <p className="text-xs text-neutral-400 max-w-md font-mono mb-4">
          Drag and drop multiple text files here (.txt, .md, .json, .log), or select them from disk to append to the serial queue.
        </p>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={isProcessing}
            className="px-4 py-2 bg-sky-950 border border-sky-800 text-sky-300 hover:bg-sky-900 hover:text-white rounded text-xs font-mono font-bold uppercase tracking-wider flex items-center gap-2 cursor-pointer transition-colors shadow-sm disabled:opacity-50"
          >
            <Files className="w-3.5 h-3.5" />
            Select Files From Disk
          </button>

          <div className="flex items-center space-x-2 bg-neutral-950 border border-neutral-800 px-3 py-1.5 rounded">
            <span className="text-[10px] text-neutral-400 font-mono uppercase">Chunk Size:</span>
            <input
              type="number"
              min="50"
              max="4000"
              value={localChunkSize}
              onChange={(e) => setLocalChunkSize(Math.max(50, Number(e.target.value)))}
              disabled={isProcessing}
              className="w-16 bg-neutral-900 border border-neutral-700 text-white text-xs font-mono px-1.5 py-0.5 rounded text-center focus:outline-none focus:border-sky-500"
            />
            <span className="text-[10px] text-neutral-500 font-mono">chars</span>
          </div>
        </div>
      </section>

      {/* 3. Document Ingestion Summary Table */}
      <section className="bg-neutral-900 border border-neutral-800 rounded-lg flex flex-col overflow-hidden shadow-lg">
        {/* Table Header Bar */}
        <div className="border-b border-neutral-800 px-5 py-4 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-3 bg-neutral-900/95">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-neutral-800 border border-neutral-700 rounded text-neutral-300">
              <Database className="w-4 h-4 text-sky-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xs font-bold text-white uppercase tracking-wider">
                  Document Queue Summary Table
                </h2>
                <span className="text-[10px] text-neutral-500 font-mono">
                  ({queue.length} Total)
                </span>
              </div>
              <p className="text-[11px] text-neutral-400 font-mono mt-0.5">
                Overview of success/failure status, committed vectors, and retry actions across all documents.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Auto-Save Persistence Status Badge */}
            <div className="flex items-center gap-1.5 px-2.5 py-1 bg-neutral-950 border border-neutral-800 rounded text-[10px] font-mono text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>Auto-Saved to localStorage</span>
            </div>

            {/* Retry All Failed Button */}
            {errorCount > 0 && !isProcessing && (
              <button
                type="button"
                onClick={handleRetryAllFailed}
                className="px-3 py-1 bg-amber-950 border border-amber-700 hover:bg-amber-900 text-amber-200 hover:text-white rounded text-xs font-mono font-bold flex items-center gap-1.5 cursor-pointer transition-colors shadow-sm"
                title="Retry all failed documents in the queue"
              >
                <RotateCcw className="w-3.5 h-3.5 text-amber-400" />
                <span>Retry All Failed ({errorCount})</span>
              </button>
            )}

            {/* Filter Tabs */}
            <div className="flex items-center bg-neutral-950 border border-neutral-800 p-0.5 rounded text-[11px] font-mono">
              <button
                type="button"
                onClick={() => setSummaryFilter('all')}
                className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                  summaryFilter === 'all'
                    ? 'bg-neutral-800 text-white font-bold'
                    : 'text-neutral-400 hover:text-white'
                }`}
              >
                All ({totalCount})
              </button>
              <button
                type="button"
                onClick={() => setSummaryFilter('completed')}
                className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                  summaryFilter === 'completed'
                    ? 'bg-emerald-950 text-emerald-300 font-bold border border-emerald-800'
                    : 'text-neutral-400 hover:text-emerald-300'
                }`}
              >
                Success ({completedCount})
              </button>
              <button
                type="button"
                onClick={() => setSummaryFilter('error')}
                className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                  summaryFilter === 'error'
                    ? 'bg-rose-950 text-rose-300 font-bold border border-rose-800'
                    : 'text-neutral-400 hover:text-rose-300'
                }`}
              >
                Failed ({errorCount})
              </button>
              <button
                type="button"
                onClick={() => setSummaryFilter('pending')}
                className={`px-2.5 py-1 rounded transition-colors cursor-pointer ${
                  summaryFilter === 'pending'
                    ? 'bg-sky-950 text-sky-300 font-bold border border-sky-800'
                    : 'text-neutral-400 hover:text-sky-300'
                }`}
              >
                Pending ({pendingCount})
              </button>
            </div>
          </div>
        </div>

        {/* Summary Table Content */}
        {filteredSummaryDocs.length === 0 ? (
          <div className="p-8 text-center text-neutral-500 font-mono text-xs">
            No documents matching the active filter ({summaryFilter.toUpperCase()}).
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left font-mono text-xs border-collapse">
              <thead>
                <tr className="border-b border-neutral-800 bg-neutral-950/60 text-[10px] text-neutral-400 uppercase tracking-wider font-semibold">
                  <th className="py-2.5 px-4 w-12 text-center">#</th>
                  <th className="py-2.5 px-4 min-w-[200px]">Document Name</th>
                  <th className="py-2.5 px-4 w-28 text-center">Status</th>
                  <th className="py-2.5 px-4 w-36 text-right">Vectors / Chunks</th>
                  <th className="py-2.5 px-4 min-w-[240px]">Diagnostics / Details</th>
                  <th className="py-2.5 px-4 w-36 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-800/60">
                {filteredSummaryDocs.map((doc, idx) => {
                  const isFailed = doc.status === 'error';
                  const isCompleted = doc.status === 'completed';
                  const isInProgress = doc.status === 'reading' || doc.status === 'ingesting';

                  return (
                    <tr
                      key={doc.id}
                      className={`transition-colors ${
                        isFailed
                          ? 'bg-rose-950/10 hover:bg-rose-950/20'
                          : isCompleted
                          ? 'bg-emerald-950/5 hover:bg-emerald-950/15'
                          : isInProgress
                          ? 'bg-sky-950/15 hover:bg-sky-950/25'
                          : 'hover:bg-neutral-800/20'
                      }`}
                    >
                      <td className="py-3 px-4 text-center text-neutral-500">
                        {idx + 1}
                      </td>

                      <td className="py-3 px-4">
                        <div className="flex items-center gap-2">
                          <FileText
                            className={`w-4 h-4 shrink-0 ${
                              isFailed
                                ? 'text-rose-400'
                                : isCompleted
                                ? 'text-emerald-400'
                                : isInProgress
                                ? 'text-sky-400'
                                : 'text-neutral-400'
                            }`}
                          />
                          <div className="min-w-0">
                            <p className="font-medium text-white truncate max-w-xs sm:max-w-sm md:max-w-md">
                              {doc.name}
                            </p>
                            <p className="text-[10px] text-neutral-500">
                              {(doc.size / 1024).toFixed(1)} KB &bull; Queued {new Date(doc.addedAt).toLocaleTimeString()}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="py-3 px-4 text-center">
                        {isCompleted && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-300 bg-emerald-950/90 border border-emerald-700 px-2 py-0.5 rounded">
                            <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                            SUCCESS
                          </span>
                        )}
                        {isFailed && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-rose-300 bg-rose-950/90 border border-rose-700 px-2 py-0.5 rounded">
                            <AlertTriangle className="w-3 h-3 text-rose-400" />
                            FAILED
                          </span>
                        )}
                        {isInProgress && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-sky-300 bg-sky-950/90 border border-sky-700 px-2 py-0.5 rounded animate-pulse">
                            <Loader2 className="w-3 h-3 animate-spin text-sky-400" />
                            IN PROGRESS
                          </span>
                        )}
                        {doc.status === 'pending' && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-neutral-400 bg-neutral-950 border border-neutral-800 px-2 py-0.5 rounded">
                            <Clock className="w-3 h-3 text-neutral-500" />
                            PENDING
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-right">
                        {isCompleted ? (
                          <span className="text-emerald-400 font-bold">
                            +{doc.vectorsCount || 0} vectors
                            <span className="text-[10px] text-neutral-500 block font-normal">
                              {doc.chunksCount || 0} chunks
                            </span>
                          </span>
                        ) : isInProgress ? (
                          <span className="text-sky-400">
                            {doc.progress.processed}/{doc.progress.total} chunks
                          </span>
                        ) : (
                          <span className="text-neutral-500">--</span>
                        )}
                      </td>

                      <td className="py-3 px-4">
                        {isFailed ? (
                          <div className="flex items-start gap-1.5 text-rose-300 text-[11px] bg-rose-950/40 p-1.5 rounded border border-rose-900/60">
                            <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                            <span className="break-all leading-tight">
                              {doc.error || 'Ingestion failed during processing'}
                            </span>
                          </div>
                        ) : isCompleted ? (
                          <span className="text-neutral-400 text-[11px] flex items-center gap-1">
                            <Check className="w-3 h-3 text-emerald-400 shrink-0" />
                            Successfully indexed into agent workspace
                          </span>
                        ) : isInProgress ? (
                          <span className="text-sky-400 text-[11px]">
                            {doc.status === 'reading' ? 'Reading document payload...' : 'Embedding and committing vectors...'}
                          </span>
                        ) : (
                          <span className="text-neutral-500 text-[11px]">
                            Queued in FIFO order for ingestion
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-4 text-center">
                        {isFailed && (
                          <button
                            type="button"
                            onClick={() => handleRetryFailedDoc(doc.id)}
                            className="px-2.5 py-1 bg-amber-950/90 border border-amber-600 hover:bg-amber-900 text-amber-200 hover:text-white rounded text-[11px] font-bold inline-flex items-center gap-1.5 cursor-pointer transition-colors shadow-sm"
                            title="Retry this failed document"
                          >
                            <RotateCcw className="w-3 h-3 text-amber-400" />
                            <span>Retry Failed</span>
                          </button>
                        )}
                        {!isFailed && !isInProgress && !isProcessing && (
                          <button
                            type="button"
                            onClick={() => handleRemoveDoc(doc.id)}
                            className="p-1 text-neutral-500 hover:text-rose-400 transition-colors cursor-pointer"
                            title="Remove document from queue"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 4. Document Queue FIFO Cards */}
      <section className="bg-neutral-900 border border-neutral-800 rounded-lg flex flex-col overflow-hidden shadow-lg">
        <div className="border-b border-neutral-800 px-4 py-3 flex items-center justify-between bg-neutral-900/80">
          <div className="flex items-center space-x-2">
            <Layers className="h-4 w-4 text-sky-400" />
            <h2 className="text-xs font-bold text-white uppercase tracking-wider">
              Queued Document Cards ({queue.length})
            </h2>
          </div>
          <span className="text-[10px] text-neutral-500 font-mono">SERIAL_ORDER: FIFO</span>
        </div>

        {queue.length === 0 ? (
          <div className="p-12 text-center flex flex-col items-center justify-center text-neutral-600">
            <FileText className="w-10 h-10 mb-3 text-neutral-700 stroke-1" />
            <p className="text-xs font-mono uppercase tracking-wider text-neutral-400 font-semibold">
              Queue is Empty
            </p>
            <p className="text-[11px] font-mono text-neutral-500 mt-1 max-w-sm">
              Add multiple documents using the dropzone above or click "Queue Samples" to run a quick test.
            </p>
            <button
              onClick={handleAddSampleDocs}
              className="mt-4 px-3 py-1.5 bg-neutral-950 border border-neutral-800 hover:border-amber-600/60 text-amber-300 text-xs font-mono rounded flex items-center gap-1.5 cursor-pointer transition-colors"
            >
              <Sparkles className="w-3.5 h-3.5" />
              Load Demo Files
            </button>
          </div>
        ) : (
          <div className="divide-y divide-neutral-800/80 overflow-x-auto">
            {queue.map((doc, idx) => {
              const isDocActive = doc.status === 'reading' || doc.status === 'ingesting';
              const docPercent =
                doc.progress.total > 0
                  ? Math.round((doc.progress.processed / doc.progress.total) * 100)
                  : doc.status === 'completed'
                  ? 100
                  : 0;

              return (
                <div
                  key={doc.id}
                  className={`p-3.5 flex flex-col gap-2 transition-colors ${
                    isDocActive
                      ? 'bg-sky-950/20 border-l-2 border-sky-500'
                      : doc.status === 'completed'
                      ? 'bg-neutral-950/30 border-l-2 border-emerald-500/60'
                      : doc.status === 'error'
                      ? 'bg-rose-950/20 border-l-2 border-rose-500'
                      : 'hover:bg-neutral-800/30 border-l-2 border-transparent'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3">
                    {/* Index & Name */}
                    <div className="flex items-center space-x-3 min-w-0">
                      <span className="text-neutral-500 font-mono text-xs w-6 shrink-0">
                        #{idx + 1}
                      </span>
                      <FileText className="w-4 h-4 text-neutral-400 shrink-0" />
                      <div className="min-w-0">
                        <p className="text-xs font-mono font-medium text-white truncate max-w-xs sm:max-w-md md:max-w-xl">
                          {doc.name}
                        </p>
                        <p className="text-[10px] font-mono text-neutral-500">
                          {(doc.size / 1024).toFixed(1)} KB &bull; Queued {new Date(doc.addedAt).toLocaleTimeString()}
                        </p>
                      </div>
                    </div>

                    {/* Status Pill & Action */}
                    <div className="flex items-center space-x-3 shrink-0">
                      {doc.status === 'pending' && (
                        <span className="flex items-center gap-1 text-[10px] font-mono font-bold text-neutral-400 bg-neutral-950 border border-neutral-800 px-2 py-0.5 rounded">
                          <Clock className="w-3 h-3" />
                          PENDING
                        </span>
                      )}

                      {doc.status === 'reading' && (
                        <span className="flex items-center gap-1 text-[10px] font-mono font-bold text-sky-400 bg-sky-950/60 border border-sky-800 px-2 py-0.5 rounded animate-pulse">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          READING
                        </span>
                      )}

                      {doc.status === 'ingesting' && (
                        <span className="flex items-center gap-1 text-[10px] font-mono font-bold text-emerald-400 bg-emerald-950/60 border border-emerald-800 px-2 py-0.5 rounded">
                          <Loader2 className="w-3 h-3 animate-spin" />
                          INGESTING ({doc.progress.processed}/{doc.progress.total})
                        </span>
                      )}

                      {doc.status === 'completed' && (
                        <span className="flex items-center gap-1 text-[10px] font-mono font-bold text-emerald-300 bg-emerald-950/80 border border-emerald-700 px-2 py-0.5 rounded">
                          <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                          DONE (+{doc.vectorsCount || 0} vectors)
                        </span>
                      )}

                      {doc.status === 'error' && (
                        <span className="flex items-center gap-1 text-[10px] font-mono font-bold text-rose-300 bg-rose-950/80 border border-rose-800 px-2 py-0.5 rounded">
                          <AlertTriangle className="w-3 h-3 text-rose-400" />
                          ERROR
                        </span>
                      )}

                      {/* Retry Failed button on card */}
                      {doc.status === 'error' && (
                        <button
                          type="button"
                          onClick={() => handleRetryFailedDoc(doc.id)}
                          className="px-2 py-0.5 bg-amber-950 border border-amber-600 hover:bg-amber-900 text-amber-200 rounded text-[10px] font-mono font-bold flex items-center gap-1 cursor-pointer transition-colors shadow-sm"
                          title="Retry this failed document"
                        >
                          <RotateCcw className="w-3 h-3 text-amber-400" />
                          <span>Retry Failed</span>
                        </button>
                      )}

                      {/* Remove button for pending or error */}
                      {doc.status !== 'ingesting' && doc.status !== 'reading' && !isProcessing && (
                        <button
                          onClick={() => handleRemoveDoc(doc.id)}
                          className="p-1 text-neutral-500 hover:text-rose-400 transition-colors cursor-pointer"
                          title="Remove from queue"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Progress bar for active document */}
                  {isDocActive && (
                    <div className="w-full bg-neutral-950 h-1.5 rounded-full border border-neutral-800 overflow-hidden mt-1">
                      <div
                        className="h-full bg-emerald-400 transition-all duration-200"
                        style={{ width: `${docPercent}%` }}
                      />
                    </div>
                  )}

                  {/* Error description if failed */}
                  {doc.status === 'error' && doc.error && (
                    <div className="flex items-center justify-between gap-2 text-[10px] font-mono text-rose-400 bg-rose-950/30 p-2 rounded border border-rose-900/50 mt-1">
                      <span>{doc.error}</span>
                      <button
                        type="button"
                        onClick={() => handleRetryFailedDoc(doc.id)}
                        className="text-amber-300 hover:text-white underline font-bold shrink-0 cursor-pointer"
                      >
                        Retry Failed
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
};
