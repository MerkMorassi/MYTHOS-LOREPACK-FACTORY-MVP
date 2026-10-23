import type {
  LorepackModel,
  LorepackStore,
  TripletEdge,
  VectorRecord,
  ExportProgress,
  OptimizationConfig,
} from './types.js';
import { InMemoryLorepackStore, LorepackReader, isValidVector } from './reader.js';
import {
  assertSingleSpace,
  embedAllResumable,
  PINNED_MODEL,
  PINNED_DIM,
  validateModelCompatibility,
  MintRefusedError,
} from './mint-gate.js';

const LAST_SYNC_KEY = 'mythos_lorepack_last_sync';

export interface PackageTestResult {
  ok: boolean;
  reason: string;
  vectors: number;
  edges: number;
  rejected: number;
  embeddingModels: string[];
  embeddingDimensions: number[];
  resolvableEdges: number;
  probeScore?: number;
}

export class LorepackPacker {
  constructor(
    private readonly store: LorepackStore,
    private readonly model: LorepackModel
  ) {}

  setApiKeys(keys: string[]): void {
    if (this.model && typeof (this.model as any).setApiKeys === 'function') {
      (this.model as any).setApiKeys(keys);
    }
  }

  // ------------------------------------------------------------
  // STAGE
  // ------------------------------------------------------------

  genSigil(text: string): string {
    return (text || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 50);
  }

  /**
   * Generates a deterministic SHA-256 fingerprint for a given content string.
   * Utilizes Web Crypto API (SubtleCrypto) for environment-agnostic hashing.
   */
  private async computeFingerprint(input: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(input);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Pure staging function: assigns deterministic sigil (numMarkId) and dedupes
   * against supplied existing records. Zero internal accumulation state.
   */
  stage(
    batches: Array<{ text: string; source: string }>,
    existingNodes?: VectorRecord[]
  ): Array<{ text: string; source: string; numMarkId: string }> {
    const existingSigils = new Set(
      (existingNodes || []).map((n) => n.numMarkId || this.genSigil(n.text))
    );
    const existingTexts = new Set(
      (existingNodes || []).map((n) => n.text.trim().toLowerCase())
    );

    const staged: Array<{ text: string; source: string; numMarkId: string }> = [];
    const seenInBatch = new Set<string>();

    for (const item of batches) {
      const trimmed = (item.text || '').trim();
      if (!trimmed) continue;
      const sigil = this.genSigil(trimmed);
      const textKey = trimmed.toLowerCase();

      if (existingSigils.has(sigil) || existingTexts.has(textKey) || seenInBatch.has(sigil)) {
        continue;
      }

      seenInBatch.add(sigil);
      staged.push({
        text: trimmed,
        source: item.source || 'UNKNOWN',
        numMarkId: sigil,
      });
    }

    return staged;
  }

  chunk(text: string, maxChars = 2000): string[] {
    const limit = Math.max(1, Math.floor(maxChars || 2000));
    const normalized = (text || '')
      .replace(/\r\n/g, '\n')
      .replace(/\r/g, '\n')
      .trim();

    if (!normalized) return [];

    const sentences = normalized
      .split(/(?<=[.!?])\s+(?=[A-Z0-9@])/)
      .map((s) => s.trim())
      .filter(Boolean);

    const out: string[] = [];
    let buffer = '';

    const emitHardWrapped = (textValue: string) => {
      let remaining = textValue.trim();
      while (remaining.length > limit) {
        let cut = remaining.lastIndexOf(' ', limit);
        if (cut <= 0) {
          cut = limit;
        }
        const piece = remaining.slice(0, cut).trim();
        if (piece) out.push(piece);
        remaining = remaining.slice(cut).trim();
      }
      if (remaining) out.push(remaining);
    };

    for (const sentence of sentences) {
      if (sentence.length > limit) {
        if (buffer) {
          out.push(buffer);
          buffer = '';
        }
        emitHardWrapped(sentence);
        continue;
      }

      if (!buffer) {
        buffer = sentence;
        continue;
      }

      const candidate = `${buffer} ${sentence}`;
      if (candidate.length <= limit) {
        buffer = candidate;
      } else {
        out.push(buffer);
        buffer = sentence;
      }
    }

    if (buffer) out.push(buffer);
    return out.filter(Boolean);
  }

  // ------------------------------------------------------------
  // PRE-MINTING INTEGRITY & HOMOGENEITY CHECKS
  // ------------------------------------------------------------

  async verifyWorkspaceHomogeneity(
    agentId: string,
    targetModel: string = PINNED_MODEL,
    targetDim: number = PINNED_DIM
  ): Promise<{
    valid: boolean;
    totalNodes: number;
    existingModel?: string;
    existingDim?: number;
    reason?: string;
  }> {
    const nodes = await this.store.getVectorsByAgent(agentId);
    if (nodes.length === 0) {
      return { valid: true, totalNodes: 0 };
    }

    const dims = new Set(nodes.map((n) => n.vector.length));
    const models = new Set(
      nodes.map((n) => ((n.metadata as any)?.embeddingModel as string) || '').filter(Boolean)
    );

    if (dims.size > 1) {
      return {
        valid: false,
        totalNodes: nodes.length,
        reason: `Workspace contains mixed vector dimensions (${Array.from(dims).join(', ')}). Purge agent records before re-minting.`,
      };
    }

    if (models.size > 1) {
      return {
        valid: false,
        totalNodes: nodes.length,
        reason: `Workspace contains mixed embedding models (${Array.from(models).join(', ')}). Purge agent records before re-minting.`,
      };
    }

    const currentDim = nodes[0].vector.length;
    const currentModel = (nodes[0].metadata as any)?.embeddingModel || '';

    if (targetDim && currentDim !== targetDim) {
      return {
        valid: false,
        totalNodes: nodes.length,
        existingDim: currentDim,
        existingModel: currentModel,
        reason: `Dimension mismatch: Existing workspace uses ${currentDim}-D vectors, but target minting model requires ${targetDim}-D. Purge agent memory or select a matching ${currentDim}-D model.`,
      };
    }

    if (targetModel && currentModel && currentModel !== targetModel) {
      return {
        valid: false,
        totalNodes: nodes.length,
        existingDim: currentDim,
        existingModel: currentModel,
        reason: `Model mismatch: Existing workspace is indexed with "${currentModel}", but "${targetModel}" was selected. One agent locus cannot mix models. Purge agent records to re-index.`,
      };
    }

    return {
      valid: true,
      totalNodes: nodes.length,
      existingDim: currentDim,
      existingModel: currentModel,
    };
  }

  // ------------------------------------------------------------
  // INGEST
  // ------------------------------------------------------------

  async ingestBatches(
    batches: Array<{ text: string; source: string }>,
    options: {
      agentId: string;
      onProgress?: (progress: { processed: number; written: number; total: number }) => void;
      signal?: AbortSignal;
      batchSize?: number;
      embeddingModel?: string;
      config?: OptimizationConfig;
    }
  ): Promise<{ ingested: number; failed: Array<{ text: string; reason: string }> }> {
    const failed: Array<{ text: string; reason: string }> = [];
    if (batches.length === 0) {
      return { ingested: 0, failed };
    }

    const activeModel = options.embeddingModel || PINNED_MODEL;

    // 0. Pre-minting workspace homogeneity verification
    const preCheck = await this.verifyWorkspaceHomogeneity(options.agentId, activeModel, PINNED_DIM);
    if (!preCheck.valid) {
      const err = new MintRefusedError(`PRE-MINT REFUSED :: ${preCheck.reason}`);
      for (const entry of batches) {
        failed.push({
          text: entry.text.slice(0, 80),
          reason: preCheck.reason || 'Workspace homogeneity failure',
        });
      }
      throw err;
    }

    // 1. Stage records deterministically with content-addressable ID
    const stagedEntries = await Promise.all(
      batches.map(async (entry) => {
        const fingerprint = await this.computeFingerprint(`${options.agentId}:${entry.text.trim().toLowerCase()}`);
        return {
          id: `lp_node_${fingerprint}`,
          text: entry.text,
          source: entry.source || 'UNKNOWN',
          fingerprint,
        };
      })
    );

    // 2. Prepare checkpoint hooks backed by localStorage
    const cpKey = `mythos_checkpoint_${options.agentId}`;
    const hooks = {
      load: async () => {
        try {
          const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(cpKey) : null;
          return raw ? JSON.parse(raw) : null;
        } catch {
          return null;
        }
      },
      save: async (cp: { model: string; dim: number; items: Record<string, number[]> }) => {
        try {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(cpKey, JSON.stringify(cp));
          }
        } catch {}
      },
      onEvent: (msg: string) => {
        const m = msg.match(/EMBEDDING :: (\d+)\/(\d+)/);
        if (m) {
          const processed = parseInt(m[1], 10);
          options.onProgress?.({ processed, written: processed, total: batches.length });
        }
      },
    };

    // 3. Resolve API key
    let key = '';
    if (this.model && typeof (this.model as any).getKey === 'function') {
      try {
        key = (this.model as any).getKey();
      } catch {}
    } else if (this.model && typeof (this.model as any)._getKey === 'function') {
      try {
        key = (this.model as any)._getKey();
      } catch {}
    }

    // 4. Sequential embedAllResumable execution
    let vectorMap: Map<string, number[]>;
    try {
      vectorMap = await embedAllResumable(
        stagedEntries.map((e) => ({ id: e.id, text: e.text })),
        key,
        fetch.bind(globalThis),
        hooks,
        activeModel,
        PINNED_DIM,
        options.batchSize || 10,
        options.signal
      );
    } catch (err: any) {
      // Record failed[] with IDs and surface the refusal verbatim
      for (const entry of stagedEntries) {
        failed.push({
          text: entry.id,
          reason: err.message || String(err),
        });
      }
      throw err;
    }

    // 5. Build records stamped with activeModel and actual vector.length
    const timestamp = new Date().toISOString();
    const records: VectorRecord[] = [];

    for (const entry of stagedEntries) {
      const vector = vectorMap.get(entry.id);
      if (!vector || !isValidVector(vector)) {
        failed.push({
          text: entry.id,
          reason: `Missing or invalid vector for ${entry.id}`,
        });
        continue;
      }

      records.push({
        id: entry.id,
        agentId: options.agentId,
        text: entry.text,
        vector,
        numMarkId: this.genSigil(entry.text),
        source: entry.source,
        timestamp: Date.now(),
        metadata: {
          source: entry.source,
          timestamp,
          locus: `MYTHOS.LORE.${options.agentId}`,
          embeddingModel: activeModel,
          embeddingDimension: vector.length,
          embeddingEpoch: activeModel,
          fingerprint: entry.fingerprint,
        },
      });
    }

    // 6. Atomically persist all successfully embedded records
    if (records.length > 0) {
      await this.store.addRecordsAtomic(records, []);
    }

    // Clean up completed checkpoint
    try {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(cpKey);
      }
    } catch {}

    options.onProgress?.({ processed: batches.length, written: records.length, total: batches.length });
    return { ingested: records.length, failed };
  }

  async ingestConversationalTurn(
    agentId: string,
    agentHandle: string,
    userText: string,
    modelText: string
  ): Promise<void> {
    const text = `[USER]: ${userText}\n\n[${agentHandle.toUpperCase()}]: ${modelText}`;
    if (text.length < 50) return;
    const vector = await this.model.getEmbeddings(text);
    if (!isValidVector(vector)) {
      throw new Error('Conversational turn embedding generation failed.');
    }
    
    const fingerprint = await this.computeFingerprint(`${agentId}:${text.trim().toLowerCase()}`);
    
    const activeModel = typeof (this.model as any).getEmbeddingModel === 'function'
      ? (this.model as any).getEmbeddingModel()
      : PINNED_MODEL;

    await this.store.addRecordsAtomic(
      [
        {
          id: `lp_chat_${fingerprint}`,
          agentId,
          agent: agentHandle,
          text,
          vector,
          source: `chat-log-${new Date().toISOString()}`,
          timestamp: Date.now(),
          metadata: {
            source: `chat-log-${new Date().toISOString()}`,
            timestamp: new Date().toISOString(),
            locus: `MYTHOS.LORE.${agentId}`,
            embeddingModel: activeModel,
            embeddingDimension: vector.length,
            embeddingEpoch: activeModel,
            fingerprint,
          },
        },
      ],
      []
    );
  }

  // ------------------------------------------------------------
  // GRAPH
  // ------------------------------------------------------------

  async buildGraph(
    agentId: string,
    onProgress?: (current: number, total: number, created: number) => void,
    modelName = 'gemini-3.6-flash',
    config?: OptimizationConfig,
    signal?: AbortSignal
  ): Promise<number> {
    const allNodes = await this.store.getVectorsByAgent(agentId);

    if (allNodes.length === 0) {
      return 0;
    }

    const invalidNodes = allNodes.filter((node) => !isValidVector(node.vector));
    if (invalidNodes.length > 0) {
      throw new Error(`Graph integrity failure: ${invalidNodes.length} invalid vector node(s) found.`);
    }

    const dimCounts = new Map<number, number>();
    for (const n of allNodes) {
      const d = n.vector.length;
      dimCounts.set(d, (dimCounts.get(d) || 0) + 1);
    }
    if (dimCounts.size > 1) {
      const breakdown = Array.from(dimCounts.entries())
        .map(([dim, count]) => `${count} node(s) @ ${dim}-D`)
        .join(', ');
      throw new Error(`Graph integrity failure: agent contains multiple vector dimensions (${breakdown}). Purge agent records or re-index to homogenize vector space.`);
    }

    // Query un-processed nodes to resume exactly where it failed without re-scanning completed nodes
    const uncompletedNodes = typeof this.store.getUnprocessedVectorsByAgent === 'function'
      ? await this.store.getUnprocessedVectorsByAgent(agentId)
      : allNodes.filter((n) => n.processing_status !== 'completed');

    if (uncompletedNodes.length === 0) {
      onProgress?.(allNodes.length, allNodes.length, 0);
      return 0;
    }

    // Calculate concurrency: numKeys * lanesPerKey
    let numKeys = 1;
    if (this.model && (this.model as any).apiKeys) {
      numKeys = Math.max(1, (this.model as any).apiKeys.length);
    }
    const lanes = (config as any)?.lanesPerKey || 1;
    const batchSize = numKeys * lanes;

    let created = 0;
    let completedCount = allNodes.length - uncompletedNodes.length;

    for (let offset = 0; offset < uncompletedNodes.length; offset += batchSize) {
      if (signal?.aborted) {
        throw new Error('GRAPH SYNTHESIS ABORTED :: user requested halt');
      }
      const batch = uncompletedNodes.slice(offset, offset + batchSize);
      
      // Mark current batch as processing
      if (typeof this.store.updateVectorProcessingStatus === 'function') {
        await this.store.updateVectorProcessingStatus(batch.map(n => n.id), 'processing');
      }

      try {
        const counts = await Promise.all(
          batch.map(async (node) => {
            const triplets = await this.model.extractTripletsFromText(node.text, modelName);
            if (!triplets.length) {
              if (typeof this.store.updateVectorProcessingStatus === 'function') {
                await this.store.updateVectorProcessingStatus([node.id], 'completed');
              }
              return 0;
            }
            
            const edges: TripletEdge[] = await Promise.all(triplets.map(async (triplet) => {
              const edgeFingerprint = await this.computeFingerprint(
                `${agentId}:${node.id}:${triplet.s}:${triplet.r}:${triplet.o}`.toLowerCase()
              );
              
              return {
                id: `lp_edge_${edgeFingerprint}`,
                type: 'edge',
                agentId: agentId.toUpperCase(),
                sourceId: node.id,
                s: triplet.s,
                r: triplet.r,
                o: triplet.o,
                timestamp: new Date().toISOString(),
              };
            }));
            
            await this.store.addRecordsAtomic([], edges);
            if (typeof this.store.updateVectorProcessingStatus === 'function') {
              await this.store.updateVectorProcessingStatus([node.id], 'completed');
            }
            return edges.length;
          })
        );
        created += counts.reduce((total, count) => total + count, 0);
        completedCount += batch.length;
        onProgress?.(completedCount, allNodes.length, created);
      } catch (batchErr) {
        // Flag failed batch as error
        if (typeof this.store.updateVectorProcessingStatus === 'function') {
          await this.store.updateVectorProcessingStatus(batch.map(n => n.id), 'error');
        }
        throw batchErr;
      }
    }
    return created;
  }

  /**
   * Compatibility alias for buildGraph referenced across application components.
   */
  async buildGraphLite(
    agentId: string,
    onProgress?: (current: number, total: number, created: number) => void,
    modelName = 'gemini-3.6-flash',
    config?: OptimizationConfig,
    signal?: AbortSignal
  ): Promise<number> {
    return this.buildGraph(agentId, onProgress, modelName, config, signal);
  }

  // ------------------------------------------------------------
  // PACKAGE & EXPORT
  // ------------------------------------------------------------

  async *yieldExportBatches(agentId: string, batchSize = 1000): AsyncGenerator<object[]> {
    const vectors = await this.store.getVectorsByAgent(agentId);
    const vectorIds = new Set(vectors.map((v) => v.id));

    const edges = await this.store.getTripletEdgesByAgent(agentId);
    const orphanEdges = edges.filter((edge) => !vectorIds.has(edge.sourceId));

    if (orphanEdges.length > 0) {
      throw new Error(`Export integrity failure: ${orphanEdges.length} edge(s) reference missing vector IDs.`);
    }

    for (let index = 0; index < vectors.length; index += batchSize) {
      yield vectors.slice(index, index + batchSize).map((vector) => ({
        v: 2,
        type: 'vector',
        id: vector.id,
        a: vector.agentId,
        h: vector.agentHandle || '',
        t: vector.text,
        vec: vector.vector,
        m: vector.numMarkId || '',
        src: vector.source || '',
        d: vector.metadata || {},
      }));
    }

    for (let index = 0; index < edges.length; index += batchSize) {
      yield edges.slice(index, index + batchSize).map((edge) => ({
        v: 2,
        type: 'edge',
        id: edge.id,
        aid: edge.agentId,
        src: edge.sourceId,
        s: edge.s,
        r: edge.r,
        o: edge.o,
        timestamp: edge.timestamp,
      }));
    }
  }

  async exportLorepack(
    agentId: string,
    options?: {
      gzip?: boolean;
      onProgress?: (progress: ExportProgress) => void;
    }
  ): Promise<{ blob: Blob; count: number; filename: string }> {
    const vectors = await this.store.getVectorsByAgent(agentId);
    const edges = await this.store.getTripletEdgesByAgent(agentId);
    const spaceContract = assertSingleSpace(
      vectors.map((v) => ({ id: v.id, vec: v.vector, model: (v.metadata as any)?.embeddingModel })),
      edges.map((e) => ({ id: e.id, src: e.sourceId }))
    );

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const headerRecord = {
      v: 2,
      type: 'header',
      agentId: agentId.toUpperCase(),
      embeddingModel: spaceContract.model,
      embeddingDimension: spaceContract.dim,
      totalVectors: spaceContract.vectors,
      totalEdges: spaceContract.edges,
      exportedAt: new Date().toISOString(),
    };

    const totalRecords = vectors.length + edges.length + 1;
    options?.onProgress?.({
      serialized: 1,
      total: totalRecords,
      stage: 'serializing',
      percent: Math.min(10, Math.round((1 / Math.max(1, totalRecords)) * 85)),
      chunkLabel: 'Archive Header Record',
    });

    const lines: string[] = [JSON.stringify(headerRecord)];
    for await (const batch of this.yieldExportBatches(agentId, 25)) {
      for (const item of batch) {
        lines.push(JSON.stringify(item));
        const currentCount = lines.length;
        const percent = Math.min(85, Math.max(5, Math.round((currentCount / Math.max(1, totalRecords)) * 85)));
        const chunkLabel = (item as any).id || (item as any).src || `${(item as any).type} record`;
        options?.onProgress?.({
          serialized: currentCount,
          total: totalRecords,
          stage: 'serializing',
          percent,
          chunkLabel,
        });
      }
      // Microtask tick to permit smooth UI progress rendering
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (lines.length <= 1) {
      throw new Error(`No records found to export for agent locus "${agentId}".`);
    }

    const text = lines.join('\n') + '\n';
    const isGzip = options?.gzip ?? true;

    if (isGzip && typeof CompressionStream !== 'undefined') {
      options?.onProgress?.({
        serialized: lines.length,
        total: totalRecords,
        stage: 'compressing',
        percent: 92,
        chunkLabel: 'Streaming to GZIP Compression Stream...',
      });
      const stream = new Blob([text], { type: 'application/x-jsonlines' })
        .stream()
        .pipeThrough(new CompressionStream('gzip'));
      const blob = await new Response(stream).blob();
      options?.onProgress?.({
        serialized: lines.length,
        total: totalRecords,
        stage: 'complete',
        percent: 100,
        chunkLabel: `GZIP Archive Compiled (${(blob.size / 1024).toFixed(1)} KB)`,
      });
      return {
        blob,
        count: lines.length,
        filename: `lorepack_${agentId.toLowerCase()}_${timestamp}.lorepack.gz`,
      };
    } else {
      const blob = new Blob([text], { type: 'application/x-jsonlines' });
      options?.onProgress?.({
        serialized: lines.length,
        total: totalRecords,
        stage: 'complete',
        percent: 100,
        chunkLabel: `JSONL Archive Compiled (${(blob.size / 1024).toFixed(1)} KB)`,
      });
      return {
        blob,
        count: lines.length,
        filename: `lorepack_${agentId.toLowerCase()}_${timestamp}.jsonl`,
      };
    }
  }

  async exportToGz(
    agentId: string,
    onProgress?: (progress: ExportProgress) => void
  ): Promise<{ blob: Blob; count: number; filename: string }> {
    return this.exportLorepack(agentId, { gzip: true, onProgress });
  }

  async exportToJsonl(
    agentId: string,
    onProgress?: (progress: ExportProgress) => void
  ): Promise<{ blob: Blob; count: number; filename: string }> {
    return this.exportLorepack(agentId, { gzip: false, onProgress });
  }

  // ------------------------------------------------------------
  // TEST & ROUND-TRIP VERIFICATION
  // ------------------------------------------------------------

  async testPackage(
    fileOrBlob: Blob | File,
    expectedAgentId?: string
  ): Promise<PackageTestResult> {
    const tempStore = new InMemoryLorepackStore();
    const tempReader = new LorepackReader(tempStore, this.model);

    try {
      const importResult = await tempReader.importLorepack(fileOrBlob, expectedAgentId);
      if (importResult.importedVectors === 0 && importResult.importedEdges === 0) {
        return {
          ok: false,
          reason: 'Package is empty (0 vectors and 0 edges).',
          vectors: 0,
          edges: 0,
          rejected: 0,
          embeddingModels: [],
          embeddingDimensions: [],
          resolvableEdges: 0,
        };
      }

      const allVectors = await tempStore.getAllVectors();
      const allEdges = await tempStore.getAllTripletEdges();

      const dimensionSet = new Set(allVectors.map((v) => v.vector.length));
      const modelSet = new Set(
        allVectors.map((v) => (v.metadata?.embeddingModel as string) || 'unknown')
      );

      if (dimensionSet.size > 1) {
        return {
          ok: false,
          reason: `Mixed embedding dimensions detected: ${Array.from(dimensionSet).join(', ')}`,
          vectors: allVectors.length,
          edges: allEdges.length,
          rejected: 0,
          embeddingModels: Array.from(modelSet),
          embeddingDimensions: Array.from(dimensionSet),
          resolvableEdges: 0,
        };
      }

      if (modelSet.size > 1) {
        return {
          ok: false,
          reason: `Multiple embedding models detected in package: ${Array.from(modelSet).join(', ')}`,
          vectors: allVectors.length,
          edges: allEdges.length,
          rejected: 0,
          embeddingModels: Array.from(modelSet),
          embeddingDimensions: Array.from(dimensionSet),
          resolvableEdges: 0,
        };
      }

      const vectorIdSet = new Set(allVectors.map((v) => v.id));
      const unresolvable = allEdges.filter((e) => !vectorIdSet.has(e.sourceId));
      if (unresolvable.length > 0) {
        return {
          ok: false,
          reason: `${unresolvable.length} edge(s) reference non-existent vector IDs in this package.`,
          vectors: allVectors.length,
          edges: allEdges.length,
          rejected: 0,
          embeddingModels: Array.from(modelSet),
          embeddingDimensions: Array.from(dimensionSet),
          resolvableEdges: allEdges.length - unresolvable.length,
        };
      }

      let probeScore: number | undefined;
      if (allVectors.length > 0) {
        const sample = allVectors[0];
        const hits = await tempReader.search(sample.text.slice(0, 100), expectedAgentId, 1);
        if (hits.length > 0) {
          probeScore = hits[0].score;
        }
      }

      return {
        ok: true,
        reason: 'Package passed all structural, cryptographic, dimension, model, and edge integrity checks.',
        vectors: allVectors.length,
        edges: allEdges.length,
        rejected: 0,
        embeddingModels: Array.from(modelSet),
        embeddingDimensions: Array.from(dimensionSet),
        resolvableEdges: allEdges.length,
        probeScore,
      };
    } catch (err: any) {
      return {
        ok: false,
        reason: `Package round-trip import failed: ${err.message || err}`,
        vectors: 0,
        edges: 0,
        rejected: 1,
        embeddingModels: [],
        embeddingDimensions: [],
        resolvableEdges: 0,
      };
    }
  }

  async verifyPackage(
    fileOrBlob: Blob | File,
    expectedAgentId?: string
  ): Promise<{ valid: boolean; reason?: string; stats?: any }> {
    const result = await this.testPackage(fileOrBlob, expectedAgentId);
    return {
      valid: result.ok,
      reason: result.ok ? undefined : result.reason,
      stats: result.ok
        ? {
            vectors: result.vectors,
            edges: result.edges,
            dimension: result.embeddingDimensions[0],
            model: result.embeddingModels[0],
            probeScore: result.probeScore,
          }
        : undefined,
    };
  }

  // ------------------------------------------------------------
  // SHIP & CLEANUP
  // ------------------------------------------------------------

  async syncToEndpoint(
    endpoint: string,
    agentId: string,
    apiKey?: string
  ): Promise<{ success: boolean; synced: number }> {
    const exportResult = await this.exportLorepack(agentId, { gzip: true });
    const formData = new FormData();
    formData.append('lorepack', exportResult.blob, exportResult.filename);
    formData.append('agentId', agentId);

    const headers: Record<string, string> = {};
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: formData,
    });

    if (!res.ok) {
      throw new Error(`Sync endpoint failed with status ${res.status}: ${await res.text()}`);
    }

    try {
      localStorage.setItem(
        `${LAST_SYNC_KEY}_${agentId.toLowerCase()}`,
        new Date().toISOString()
      );
    } catch {
      // ignore localStorage limits
    }

    return { success: true, synced: exportResult.count };
  }

  async clearAgent(agentId: string): Promise<{ vectors: number; edges: number }> {
    return this.store.clearAgent(agentId);
  }

  async nuke(): Promise<void> {
    return this.store.nukeStore();
  }
}
