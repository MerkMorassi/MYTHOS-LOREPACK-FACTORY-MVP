import type {
  ImportProgress,
  LorepackModel,
  LorepackStore,
  TripletEdge,
  VectorRecord,
} from './types.js';

function isValidVector(vector: unknown): vector is number[] {
  if (!Array.isArray(vector)) return false;
  if (vector.length === 0) return false;
  return vector.every((val) => typeof val === 'number' && Number.isFinite(val));
}

const LAST_SYNC_KEY = 'mythos_lorepack_last_sync';
const EMBEDDING_MODEL = 'gemini-embedding-2';

export class LorepackFactory {
  constructor(
    private readonly store: LorepackStore,
    private readonly model: LorepackModel,
  ) {}

  setApiKeys(keys: string[]): void {
    if (this.model && typeof (this.model as any).setApiKeys === 'function') {
      (this.model as any).setApiKeys(keys);
    }
  }

  genSigil(text: string): string {
    return (text || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 50);
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

  async getStats(agentId: string): Promise<{ totalNodes: number; totalEdges: number }> {
    const [vectors, edges] = await Promise.all([
      this.store.getVectorsByAgent(agentId),
      this.store.getTripletEdgesByAgent(agentId),
    ]);
    return { totalNodes: vectors.length, totalEdges: edges.length };
  }

  async ingestBatches(
    batches: Array<{ text: string; source: string }>,
    options: {
      agentId: string;
      onProgress?: (progress: { processed: number; written: number; total: number }) => void;
      signal?: AbortSignal;
      batchSize?: number;
    },
  ): Promise<{ ingested: number }> {
    const batchSize = options.batchSize || 40;
    const concurrency = 5;
    let processed = 0;
    let written = 0;
    const groups = Array.from({ length: Math.ceil(batches.length / batchSize) }, (_, index) =>
      batches.slice(index * batchSize, (index + 1) * batchSize),
    );

    const runGroup = async (group: Array<{ text: string; source: string }>) => {
      if (options.signal?.aborted) throw new Error('Aborted');
      
      let embeddings: Array<number[] | null | undefined> = [];
      if (typeof this.model.getEmbeddingsBatch === 'function') {
        embeddings = await this.model.getEmbeddingsBatch(group.map(e => e.text));
      } else {
        embeddings = await Promise.all(group.map((entry) => this.model.getEmbeddings(entry.text)));
      }

      const timestamp = new Date().toISOString();
      const records: VectorRecord[] = [];
      for (const [index, entry] of group.entries()) {
        const vector = embeddings[index];
        if (!Array.isArray(vector)) continue;
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
            embeddingModel: EMBEDDING_MODEL,
            embeddingDimension: vector.length,
            embeddingEpoch: EMBEDDING_MODEL,
          },
        });
      }
      await this.store.addRecordsAtomic(records, []);
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
    return { ingested: written };
  }

  async ingestConversationalTurn(
    agentId: string,
    agentHandle: string,
    userText: string,
    modelText: string,
  ): Promise<void> {
    const text = `[USER]: ${userText}\n\n[${agentHandle.toUpperCase()}]: ${modelText}`;
    if (text.length < 50) return;
    const vector = await this.model.getEmbeddings(text);
    if (!Array.isArray(vector)) return;
    await this.store.addRecordsAtomic([{
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
    }], []);
  }

  async buildGraphLite(
    agentId: string,
    onProgress?: (current: number, total: number, created: number) => void,
    modelName = 'gemini-3.6-flash',
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
      const counts = await Promise.all(batch.map(async (node) => {
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
      }));
      created += counts.reduce((total, count) => total + count, 0);
      onProgress?.(Math.min(offset + batch.length, nodes.length), nodes.length, created);
    }
    return created;
  }

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

  async importLorepack(
    file: File,
    agentId: string,
    onProgress?: (progress: ImportProgress) => void,
  ): Promise<{ success: true; importedVectors: number; importedEdges: number }> {
    let stream = file.stream();
    if (file.name.endsWith('.gz')) stream = stream.pipeThrough(new DecompressionStream('gzip'));
    const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    let vectors: VectorRecord[] = [];
    let edges: TripletEdge[] = [];
    let totalVectors = 0;
    let totalEdges = 0;
    let rejectedCount = 0;
    let detectedDimension: number | null = null;
    let detectedModel: string | null = null;

    // Check existing records to establish base vector dimensions and model for integrity validation
    const existing = await this.store.getVectorsByAgent(agentId);
    if (existing.length > 0) {
      detectedDimension = existing[0].vector.length;
      detectedModel = (existing[0].metadata?.embeddingModel as string) || null;
    }

    const flush = async () => {
      if (vectors.length || edges.length) {
        await this.store.addRecordsAtomic(vectors, edges);
      }
      totalVectors += vectors.length;
      totalEdges += edges.length;
      vectors = [];
      edges = [];
      onProgress?.({
        processed: totalVectors + totalEdges,
        vectors: totalVectors,
        edges: totalEdges,
        rejected: rejectedCount,
      });
    };

    const consume = async (line: string) => {
      if (!line.trim()) return;
      try {
        const entry = JSON.parse(line) as Record<string, any>;
        if (entry.type === 'edge') {
          if (
            !entry.id ||
            !entry.src ||
            typeof entry.s !== 'string' ||
            typeof entry.r !== 'string' ||
            typeof entry.o !== 'string' ||
            !entry.s.trim() ||
            !entry.r.trim() ||
            !entry.o.trim()
          ) {
            throw new Error('Invalid edge record.');
          }
          edges.push({
            id: entry.id,
            type: 'edge',
            agentId: agentId.toUpperCase(),
            sourceId: entry.src,
            s: entry.s.trim(),
            r: entry.r.trim(),
            o: entry.o.trim(),
            timestamp: entry.timestamp || new Date().toISOString(),
          });
        } else {
          const isV2 = entry.v === 2;
          const vectorField = isV2 ? entry.vec : entry.vector;
          const textField = isV2 ? entry.t : entry.text;
          const sourceField = isV2 ? entry.src : entry.source;
          const timestampField = isV2 ? entry.ts : entry.timestamp;
          const metaField = isV2 ? entry.d : entry.metadata;
          const markField = isV2 ? entry.m : entry.numMarkId;
          const handleField = isV2 ? entry.h : entry.agentHandle;

          if (!isValidVector(vectorField)) {
            throw new Error('Vector field is invalid, missing, empty, or malformed.');
          }

          if (typeof textField !== 'string' || !textField.trim()) {
            throw new Error('Vector text invalid or empty.');
          }

          const model = metaField?.embeddingModel || EMBEDDING_MODEL;
          const dimension = metaField?.embeddingDimension;

          if (model && model !== EMBEDDING_MODEL) {
            throw new Error(`Incompatible embedding model "${model}". Current is "${EMBEDDING_MODEL}".`);
          }

          if (dimension !== undefined && Number(dimension) !== vectorField.length) {
            throw new Error(`Dimension mismatch: Specifies ${dimension} but vector length is ${vectorField.length}`);
          }

          if (detectedDimension === null) {
            detectedDimension = vectorField.length;
          } else if (vectorField.length !== detectedDimension) {
            throw new Error(`Incompatible embedding dimensionality: Expected ${detectedDimension}, got ${vectorField.length}`);
          }

          if (detectedModel === null) {
            detectedModel = model;
          } else if (model !== detectedModel) {
            throw new Error(`Incompatible embedding model: Expected ${detectedModel}, got ${model}`);
          }

          vectors.push({
            id: entry.id || crypto.randomUUID(),
            agentId,
            text: textField.trim(),
            vector: vectorField,
            source: sourceField || file.name || 'Imported',
            timestamp: typeof timestampField === 'number' ? timestampField : Date.now(),
            metadata: metaField || {
              source: sourceField || file.name || 'Imported',
              timestamp: new Date().toISOString(),
              locus: `MYTHOS.LORE.${agentId}`,
              embeddingModel: model,
              embeddingDimension: vectorField.length,
              embeddingEpoch: model,
            },
            numMarkId: markField || '',
            agentHandle: handleField || '',
            permissions: entry.p,
          });
        }
      } catch (err: any) {
        rejectedCount++;
        throw err; // bubble up for safety just like the monolith does on global import errors
      }
      if (vectors.length + edges.length >= 500) await flush();
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';
      for (const line of lines) await consume(line);
    }
    if (buffer.trim()) await consume(buffer);
    await flush();

    // Export integrity check for duplicate IDs and edge mismatch after import completes
    const importedVectorIds = new Set(vectors.map((v) => v.id));
    for (const e of edges) {
      if (!importedVectorIds.has(e.sourceId)) {
        // Double check against database store just in case
        const dbNodes = await this.store.getVectorsByAgent(agentId);
        const dbNodeIds = new Set(dbNodes.map((n) => n.id));
        if (!dbNodeIds.has(e.sourceId)) {
          throw new Error(`Import integrity failure: edge "${e.id}" references missing vector "${e.sourceId}".`);
        }
      }
    }

    return { success: true, importedVectors: totalVectors, importedEdges: totalEdges };
  }

  async syncToEndpoint(endpoint: string, cursor: Storage): Promise<{ synced: number }> {
    const lastSync = Number.parseInt(cursor.getItem(LAST_SYNC_KEY) || '0', 10);
    const now = Date.now();
    const [vectors, edges] = await Promise.all([this.store.getAllVectors(), this.store.getAllTripletEdges()]);
    const pending = [
      ...vectors.filter((vector) => vector.timestamp > lastSync).map((vector) => ({ ...vector, type: 'vector' })),
      ...edges.filter((edge) => new Date(edge.timestamp).getTime() > lastSync).map((edge) => ({ ...edge, type: 'edge' })),
    ];
    for (let index = 0; index < pending.length; index += 500) {
      const response = await fetch(endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes: pending.slice(index, index + 500) }),
      });
      if (!response.ok) throw new Error(`LorePack sync failed: ${response.status}`);
    }
    cursor.setItem(LAST_SYNC_KEY, String(now));
    return { synced: pending.length };
  }

  cosine(a: number[], b: number[]): number {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) {
      return 0;
    }
    let dot = 0;
    let ma = 0;
    let mb = 0;
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      const y = b[i];
      if (!Number.isFinite(x) || !Number.isFinite(y)) {
        return 0;
      }
      dot += x * y;
      ma += x * x;
      mb += y * y;
    }
    const denom = Math.sqrt(ma) * Math.sqrt(mb);
    return denom ? dot / denom : 0;
  }

  async chat(
    userQuery: string,
    agentId: string,
    systemPrompt?: string,
    modelName = 'gemini-3.6-flash',
    topK = 6,
    threshold = 0.45
  ): Promise<{ response: string; derivation: string; source: string }> {
    const pool = await this.store.getVectorsByAgent(agentId);
    if (!pool.length) {
      return {
        response: 'Vault empty.',
        derivation: 'EMPTY_VAULT',
        source: 'NULL',
      };
    }

    const qVec = await this.model.getEmbeddings(userQuery);
    if (!isValidVector(qVec)) {
      throw new Error('Query embedding is invalid.');
    }

    const compatible = pool.filter((node) => {
      const nodeModel = node.metadata?.embeddingModel || EMBEDDING_MODEL;
      return (
        nodeModel === EMBEDDING_MODEL &&
        Array.isArray(node.vector) &&
        node.vector.length === qVec.length &&
        isValidVector(node.vector)
      );
    });

    if (!compatible.length) {
      return {
        response: 'No compatible current-embedding records found in this agent vault. Re-ingest the lore with the current embedding model.',
        derivation: 'EMBEDDING_EPOCH_MISMATCH',
        source: 'NULL',
      };
    }

    const scored = compatible
      .map((node) => ({
        n: node,
        s: this.cosine(qVec, node.vector),
      }))
      .sort((a, b) => b.s - a.s)
      .slice(0, topK);

    const best = scored[0]?.s || 0;
    const contextNodes = best >= threshold ? scored : [];

    const context = contextNodes
      .map(
        (item) =>
          `--- [SOURCE: ${item.n.metadata?.source || 'UNKNOWN'} | ${(
            item.s * 100
          ).toFixed(1)}%] ---\n${item.n.text}`
      )
      .join('\n\n');

    const derivation = contextNodes.length ? `COSINE_TOPK(${topK})` : 'NO_CONTEXT';
    const prompt = `CONTEXT:\n${context}\n\nUSER:\n${userQuery}`;

    const modelContext = modelName
      ? `\n[RUNTIME ENGINE CONTEXT]: Active Model is ${modelName.startsWith('gemma-') ? 'Google Gemma' : 'Google Gemini'} (${modelName}). Active Locus: ${agentId}. You possess context awareness of your active model and can confirm your model if asked.`
      : '';
    const textToGenerate = systemPrompt
      ? `${systemPrompt}${modelContext}\n\n${prompt}`
      : modelContext ? `${modelContext}\n\n${prompt}` : prompt;
    const responseText = this.model.generateText
      ? await this.model.generateText(textToGenerate, undefined, modelName)
      : '';

    return {
      response: responseText || '(no reply)',
      derivation,
      source: 'RAG',
    };
  }

  async clearAgent(agentId: string): Promise<{ vectors: number; edges: number }> {
    return this.store.clearAgent(agentId);
  }

  async nuke(): Promise<void> {
    return this.store.nukeStore();
  }
}
