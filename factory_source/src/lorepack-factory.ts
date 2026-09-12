import type {
  ImportProgress,
  LorepackModel,
  LorepackStore,
  TripletEdge,
  VectorRecord,
} from './types.js';

const LAST_SYNC_KEY = 'mythos_lorepack_last_sync';

export class LorepackFactory {
  constructor(
    private readonly store: LorepackStore,
    private readonly model: LorepackModel,
  ) {}

  genSigil(text: string): string {
    return (text || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 50);
  }

  chunk(text: string, maxChars = 2000): string[] {
    const sentences = (text || '')
      .replace(/\r/g, '')
      .replace(/([.?!])\s+(?=[A-Z0-9@])/g, '$1|')
      .split('|')
      .map((sentence) => sentence.trim())
      .filter(Boolean);

    const chunks: string[] = [];
    let buffer = '';
    for (const sentence of sentences) {
      if (!buffer) {
        buffer = sentence;
      } else if (buffer.length + sentence.length + 1 > maxChars) {
        chunks.push(buffer);
        buffer = sentence;
      } else {
        buffer += ` ${sentence}`;
      }
    }
    if (buffer) chunks.push(buffer);
    return chunks;
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
    },
  ): Promise<{ ingested: number }> {
    const batchSize = 40;
    const concurrency = 5;
    let processed = 0;
    let written = 0;
    const groups = Array.from({ length: Math.ceil(batches.length / batchSize) }, (_, index) =>
      batches.slice(index * batchSize, (index + 1) * batchSize),
    );

    const runGroup = async (group: Array<{ text: string; source: string }>) => {
      if (options.signal?.aborted) throw new Error('Aborted');
      const embeddings = await Promise.all(group.map((entry) => this.model.getEmbeddings(entry.text)));
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
          metadata: { timestamp },
        });
      }
      await this.store.addVectors(records);
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
    await this.store.addVectors([{
      id: crypto.randomUUID(),
      agentId,
      agent: agentHandle,
      text,
      vector,
      source: `chat-log-${new Date().toISOString()}`,
      timestamp: Date.now(),
    }]);
  }

  async buildGraphLite(
    agentId: string,
    onProgress?: (current: number, total: number, created: number) => void,
  ): Promise<number> {
    const nodes = await this.store.getVectorsByAgent(agentId);
    const batchSize = 5;
    let created = 0;
    for (let offset = 0; offset < nodes.length; offset += batchSize) {
      const batch = nodes.slice(offset, offset + batchSize);
      const counts = await Promise.all(batch.map(async (node) => {
        const triplets = await this.model.extractTripletsFromText(node.text);
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
        await this.store.addTripletEdges(edges);
        return edges.length;
      }));
      created += counts.reduce((total, count) => total + count, 0);
      onProgress?.(Math.min(offset + batch.length, nodes.length), nodes.length, created);
    }
    return created;
  }

  async *yieldExportBatches(agentId: string, batchSize = 1000): AsyncGenerator<object[]> {
    const vectors = await this.store.getVectorsByAgent(agentId);
    for (let index = 0; index < vectors.length; index += batchSize) {
      yield vectors.slice(index, index + batchSize).map((vector) => ({
        v: 2, type: 'vector', id: vector.id, a: vector.agentId, h: vector.agentHandle || '',
        t: vector.text, vec: vector.vector, m: vector.numMarkId, d: vector.metadata || {},
        src: vector.source, ts: vector.timestamp, p: vector.permissions,
      }));
    }
    const edges = await this.store.getTripletEdgesByAgent(agentId);
    for (let index = 0; index < edges.length; index += batchSize) {
      yield edges.slice(index, index + batchSize).map((edge) => ({
        v: 2, type: 'edge', id: edge.id, aid: edge.agentId, src: edge.sourceId,
        s: edge.s, r: edge.r, o: edge.o, ts: edge.timestamp,
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

    const flush = async () => {
      if (vectors.length) await this.store.addVectors(vectors);
      if (edges.length) await this.store.addTripletEdges(edges);
      totalVectors += vectors.length;
      totalEdges += edges.length;
      vectors = [];
      edges = [];
      onProgress?.({ processed: totalVectors + totalEdges, vectors: totalVectors, edges: totalEdges });
    };

    const consume = async (line: string) => {
      if (!line.trim()) return;
      try {
        const entry = JSON.parse(line) as Record<string, any>;
        if (entry.type === 'edge') {
          edges.push({
            id: entry.id || crypto.randomUUID(), type: 'edge', agentId,
            sourceId: entry.src, s: entry.s, r: entry.r, o: entry.o,
            timestamp: entry.ts || new Date().toISOString(),
          });
        } else if (entry.t && Array.isArray(entry.vec)) {
          vectors.push({
            id: entry.id || crypto.randomUUID(), agentId, text: entry.t,
            vector: entry.vec, source: entry.src || file.name || 'Imported',
            timestamp: typeof entry.ts === 'number' ? entry.ts : Date.now(),
            metadata: entry.d || {}, numMarkId: entry.m, agentHandle: entry.h || '',
            permissions: entry.p,
          });
        }
      } catch {
        // A malformed JSONL line is skipped to preserve a recoverable import.
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
}
