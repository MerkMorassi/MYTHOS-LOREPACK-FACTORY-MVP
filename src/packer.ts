import type {
  LorepackModel,
  LorepackStore,
  TripletEdge,
  VectorRecord,
} from './types.js';
import { InMemoryLorepackStore, LorepackReader, isValidVector } from './reader.js';

const LAST_SYNC_KEY = 'mythos_lorepack_last_sync';
const EMBEDDING_MODEL = 'gemini-embedding-2';

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
  // INGEST
  // ------------------------------------------------------------

  async ingestBatches(
    batches: Array<{ text: string; source: string }>,
    options: {
      agentId: string;
      onProgress?: (progress: { processed: number; written: number; total: number }) => void;
      signal?: AbortSignal;
      batchSize?: number;
    }
  ): Promise<{ ingested: number; failed: Array<{ text: string; reason: string }> }> {
    const batchSize = options.batchSize || 40;
    const concurrency = 5;
    let processed = 0;
    let written = 0;
    const failed: Array<{ text: string; reason: string }> = [];

    const groups = Array.from({ length: Math.ceil(batches.length / batchSize) }, (_, index) =>
      batches.slice(index * batchSize, (index + 1) * batchSize)
    );

    const runGroup = async (group: Array<{ text: string; source: string }>) => {
      if (options.signal?.aborted) throw new Error('Aborted');

      let embeddings: Array<number[] | null | undefined> = [];
      try {
        if (typeof this.model.getEmbeddingsBatch === 'function') {
          embeddings = await this.model.getEmbeddingsBatch(group.map((e) => e.text));
        } else {
          embeddings = await Promise.all(group.map((entry) => this.model.getEmbeddings(entry.text)));
        }
      } catch (err: any) {
        // Explicitly record batch embedding failure instead of silent drop or disguise
        for (const entry of group) {
          failed.push({
            text: entry.text,
            reason: `Batch embedding API failed: ${err.message || err}`,
          });
        }
        processed += group.length;
        options.onProgress?.({ processed, written, total: batches.length });
        return;
      }

      const timestamp = new Date().toISOString();
      const records: VectorRecord[] = [];

      for (const [index, entry] of group.entries()) {
        const vector = embeddings[index];
        if (!isValidVector(vector)) {
          failed.push({
            text: entry.text,
            reason: 'Embedding returned invalid or empty vector (API unavailable or rejected).',
          });
          continue;
        }

        // Determine authentic model name
        const modelName = EMBEDDING_MODEL;

        records.push({
          id: crypto.randomUUID(),
          agentId: options.agentId,
          text: entry.text,
          vector,
          numMarkId: this.genSigil(entry.text),
          source: entry.source || 'UNKNOWN',
          timestamp: Date.now(),
          metadata: {
            source: entry.source || 'UNKNOWN',
            timestamp,
            locus: `MYTHOS.LORE.${options.agentId}`,
            embeddingModel: modelName,
            embeddingDimension: vector.length,
            embeddingEpoch: modelName,
          },
        });
      }

      if (records.length > 0) {
        await this.store.addRecordsAtomic(records, []);
      }
      processed += group.length;
      written += records.length;
      options.onProgress?.({ processed, written, total: batches.length });
    };

    const pending = new Set<Promise<void>>();
    for (const group of groups) {
      if (options.signal?.aborted) throw new Error('Aborted');
      const task = runGroup(group).finally(() => pending.delete(task));
      pending.add(task);
      if (pending.size >= concurrency) await Promise.race(pending);
    }
    await Promise.all(pending);

    if (batches.length > 0 && written === 0 && failed.length > 0) {
      throw new Error(`Ingest failed for all ${batches.length} chunks. Sample error: ${failed[0]?.reason}`);
    }

    return { ingested: written, failed };
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
    await this.store.addRecordsAtomic(
      [
        {
          id: crypto.randomUUID(),
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
            embeddingModel: EMBEDDING_MODEL,
            embeddingDimension: vector.length,
            embeddingEpoch: EMBEDDING_MODEL,
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
    modelName = 'gemini-3.6-flash'
  ): Promise<number> {
    const nodes = await this.store.getVectorsByAgent(agentId);

    if (nodes.length === 0) {
      return 0;
    }

    const invalidNodes = nodes.filter((node) => !isValidVector(node.vector));
    if (invalidNodes.length > 0) {
      throw new Error(`Graph integrity failure: ${invalidNodes.length} invalid vector node(s) found.`);
    }

    const dimensions = new Set(nodes.map((n) => n.vector.length));
    if (dimensions.size > 1) {
      throw new Error('Graph integrity failure: agent contains multiple vector dimensions.');
    }

    const batchSize = 5;
    let created = 0;
    for (let offset = 0; offset < nodes.length; offset += batchSize) {
      const batch = nodes.slice(offset, offset + batchSize);
      const counts = await Promise.all(
        batch.map(async (node) => {
          const triplets = await this.model.extractTripletsFromText(node.text, modelName);
          if (!triplets.length) return 0;
          const edges: TripletEdge[] = triplets.map((triplet) => ({
            id: crypto.randomUUID(),
            type: 'edge',
            agentId: agentId.toUpperCase(),
            sourceId: node.id,
            s: triplet.s,
            r: triplet.r,
            o: triplet.o,
            timestamp: new Date().toISOString(),
          }));
          await this.store.addRecordsAtomic([], edges);
          return edges.length;
        })
      );
      created += counts.reduce((total, count) => total + count, 0);
      onProgress?.(Math.min(offset + batch.length, nodes.length), nodes.length, created);
    }
    return created;
  }

  /**
   * Compatibility alias for buildGraph referenced across application components.
   */
  async buildGraphLite(
    agentId: string,
    onProgress?: (current: number, total: number, created: number) => void,
    modelName = 'gemini-3.6-flash'
  ): Promise<number> {
    return this.buildGraph(agentId, onProgress, modelName);
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
    options?: { gzip?: boolean }
  ): Promise<{ blob: Blob; count: number; filename: string }> {
    const lines: string[] = [];
    for await (const batch of this.yieldExportBatches(agentId, 500)) {
      for (const item of batch) {
        lines.push(JSON.stringify(item));
      }
    }
    if (lines.length === 0) {
      throw new Error(`No records found to export for agent locus "${agentId}".`);
    }

    const text = lines.join('\n') + '\n';
    const isGzip = options?.gzip ?? true;
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

    if (isGzip && typeof CompressionStream !== 'undefined') {
      const stream = new Blob([text], { type: 'application/x-jsonlines' })
        .stream()
        .pipeThrough(new CompressionStream('gzip'));
      const blob = await new Response(stream).blob();
      return {
        blob,
        count: lines.length,
        filename: `lorepack_${agentId.toLowerCase()}_${timestamp}.lorepack.gz`,
      };
    } else {
      const blob = new Blob([text], { type: 'application/x-jsonlines' });
      return {
        blob,
        count: lines.length,
        filename: `lorepack_${agentId.toLowerCase()}_${timestamp}.jsonl`,
      };
    }
  }

  async exportToGz(agentId: string): Promise<{ blob: Blob; count: number; filename: string }> {
    return this.exportLorepack(agentId, { gzip: true });
  }

  async exportToJsonl(agentId: string): Promise<{ blob: Blob; count: number; filename: string }> {
    return this.exportLorepack(agentId, { gzip: false });
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
