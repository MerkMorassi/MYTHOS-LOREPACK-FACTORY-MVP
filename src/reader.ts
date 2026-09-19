import type {
  ImportProgress,
  LorepackModel,
  LorepackStore,
  TripletEdge,
  VectorRecord,
} from './types.js';

export function isValidVector(vector: unknown): vector is number[] {
  if (!Array.isArray(vector)) return false;
  if (vector.length === 0) return false;
  return vector.every((val) => typeof val === 'number' && Number.isFinite(val));
}

export function looksLikeText(bytes: Uint8Array): boolean {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    text = new TextDecoder('utf-8').decode(bytes);
  }

  const t = text.replace(/^\uFEFF/, '').trimStart();

  if (t.startsWith('{') || t.startsWith('[')) return true;
  if (!text.length) return true;

  let printable = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.codePointAt(i);
    if (c !== undefined && (c === 9 || c === 10 || c === 13 || (c >= 32 && c !== 127 && c !== 0xfffd))) {
      printable++;
    }
  }

  return printable / (text.length || 1) >= 0.95;
}

export async function decompressLorepackBytes(bytes: Uint8Array): Promise<string> {
  if (!bytes || bytes.length === 0) return '';
  const head = bytes.slice(0, 16);
  let decompressionFormat: 'gzip' | 'deflate' | 'deflate-raw' | null = null;
  let isPlain = false;

  if (head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b) {
    decompressionFormat = 'gzip';
  } else if (head.length >= 2 && head[0] === 0x78 && ((head[0] << 8) | head[1]) % 31 === 0) {
    decompressionFormat = 'deflate';
  } else if (looksLikeText(head)) {
    isPlain = true;
  } else {
    decompressionFormat = 'deflate-raw';
  }

  if (isPlain) {
    return new TextDecoder('utf-8').decode(bytes);
  }

  if (typeof DecompressionStream !== 'undefined' && decompressionFormat) {
    try {
      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream(decompressionFormat));
      const textStream = stream.pipeThrough(new TextDecoderStream());
      const reader = textStream.getReader();
      let result = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        result += value;
      }
      return result;
    } catch {
      // Fallback
    }
  }

  try {
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    throw new Error('Decompression failed: unsupported or corrupted binary payload.');
  }
}

export class InMemoryLorepackStore implements LorepackStore {
  private vectors: Map<string, VectorRecord> = new Map();
  private edges: Map<string, TripletEdge> = new Map();

  async addVectors(vectors: VectorRecord[]): Promise<void> {
    for (const v of vectors) {
      if (Array.isArray(v.vector)) {
        this.vectors.set(v.id, v);
      }
    }
  }

  async getVectorsByAgent(agentId: string): Promise<VectorRecord[]> {
    const target = agentId.toLowerCase();
    const result: VectorRecord[] = [];
    for (const v of this.vectors.values()) {
      if ((v.agentId || '').toLowerCase() === target) {
        result.push(v);
      }
    }
    return result;
  }

  async getAllVectors(): Promise<VectorRecord[]> {
    return Array.from(this.vectors.values());
  }

  async addTripletEdges(edges: TripletEdge[]): Promise<void> {
    for (const e of edges) {
      this.edges.set(e.id, e);
    }
  }

  async getTripletEdgesByAgent(agentId: string): Promise<TripletEdge[]> {
    const target = agentId.toLowerCase();
    const result: TripletEdge[] = [];
    for (const e of this.edges.values()) {
      if ((e.agentId || '').toLowerCase() === target) {
        result.push(e);
      }
    }
    return result;
  }

  async getAllTripletEdges(): Promise<TripletEdge[]> {
    return Array.from(this.edges.values());
  }

  async addRecordsAtomic(vectors: VectorRecord[], edges: TripletEdge[]): Promise<void> {
    await this.addVectors(vectors);
    await this.addTripletEdges(edges);
  }

  async clearAgent(agentId: string): Promise<{ vectors: number; edges: number }> {
    const target = agentId.toLowerCase();
    let vCount = 0;
    let eCount = 0;
    for (const [id, v] of this.vectors.entries()) {
      if ((v.agentId || '').toLowerCase() === target) {
        this.vectors.delete(id);
        vCount++;
      }
    }
    for (const [id, e] of this.edges.entries()) {
      if ((e.agentId || '').toLowerCase() === target) {
        this.edges.delete(id);
        eCount++;
      }
    }
    return { vectors: vCount, edges: eCount };
  }

  async nukeStore(): Promise<void> {
    this.vectors.clear();
    this.edges.clear();
  }
}

export interface ImportResult {
  success: boolean;
  importedRecords: number;
  importedVectors: number;
  importedEdges: number;
  recordsRead: number;
  linesRead: number;
  rejectedRecords: number;
  rejected: number;
  diagnostics: string[];
}

export interface VerificationResult {
  valid: boolean;
  reason?: string;
  stats?: {
    vectors: number;
    edges: number;
    dimension?: number;
    model?: string;
    probeScore?: number;
  };
}

export interface ScoredNode {
  node: VectorRecord;
  score: number;
}

export class LorepackReader {
  private readonly store: LorepackStore;
  private readonly model?: LorepackModel;

  constructor(store?: LorepackStore, model?: LorepackModel) {
    this.store = store || new InMemoryLorepackStore();
    this.model = model;
  }

  getStore(): LorepackStore {
    return this.store;
  }

  getModel(): LorepackModel | undefined {
    return this.model;
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

  async importLorepack(
    fileOrBlob: Blob | File | Uint8Array,
    agentIdOrOptions?: string | { filename?: string; agentId?: string; onProgress?: (progress: ImportProgress) => void },
    onProgress?: (progress: ImportProgress) => void
  ): Promise<{
    success: boolean;
    importedRecords: number;
    importedVectors: number;
    importedEdges: number;
    recordsRead: number;
    linesRead: number;
    rejectedRecords: number;
    rejected: number;
    diagnostics: string[];
  }> {
    let targetAgentId = 'GLOBAL';
    let optProgress = onProgress;
    let fileName = 'Imported';

    if (typeof agentIdOrOptions === 'string') {
      targetAgentId = agentIdOrOptions.trim() || 'GLOBAL';
    } else if (agentIdOrOptions && typeof agentIdOrOptions === 'object') {
      if (agentIdOrOptions.agentId) targetAgentId = agentIdOrOptions.agentId.trim();
      if (agentIdOrOptions.filename) fileName = agentIdOrOptions.filename;
      if (agentIdOrOptions.onProgress) optProgress = agentIdOrOptions.onProgress;
    }

    if (typeof File !== 'undefined' && fileOrBlob instanceof File && fileOrBlob.name) {
      fileName = fileOrBlob.name;
    }

    let head: Uint8Array;
    let stream: ReadableStream<Uint8Array>;

    if (fileOrBlob instanceof Uint8Array) {
      head = fileOrBlob.slice(0, 16);
      stream = new Blob([fileOrBlob]).stream();
    } else {
      const headerBuffer = await fileOrBlob.slice(0, 16).arrayBuffer();
      head = new Uint8Array(headerBuffer);
      stream = fileOrBlob.stream();
    }

    let decompressionFormat: 'gzip' | 'deflate' | 'deflate-raw' | null = null;
    let isPlain = false;

    if (head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b) {
      decompressionFormat = 'gzip';
    } else if (head.length >= 2 && head[0] === 0x78 && ((head[0] << 8) | head[1]) % 31 === 0) {
      decompressionFormat = 'deflate';
    } else if (looksLikeText(head)) {
      isPlain = true;
    } else {
      decompressionFormat = 'deflate-raw';
    }

    let textStream: ReadableStream<string>;

    try {
      if (decompressionFormat) {
        if (typeof DecompressionStream === 'undefined') {
          throw new Error(`Compressed import (${decompressionFormat}) is not supported in this runtime environment.`);
        }
        const decompressed = stream.pipeThrough(new DecompressionStream(decompressionFormat));
        textStream = decompressed.pipeThrough(new TextDecoderStream());
      } else if (isPlain) {
        textStream = stream.pipeThrough(new TextDecoderStream());
      } else {
        throw new Error('Explicit unsupported or invalid compression format.');
      }
    } catch (e: any) {
      return {
        success: false,
        importedRecords: 0,
        importedVectors: 0,
        importedEdges: 0,
        recordsRead: 0,
        linesRead: 0,
        rejectedRecords: 1,
        rejected: 1,
        diagnostics: [`Decompression failed (${decompressionFormat || 'unknown'}): ${e.message || e}`],
      };
    }

    const reader = textStream.getReader();
    let buffer = '';
    const parsedVectors: VectorRecord[] = [];
    const parsedEdges: TripletEdge[] = [];
    let linesRead = 0;
    let recordsRead = 0;
    const errors: string[] = [];

    const parseLine = (line: string, lineNum: number) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      recordsRead++;
      let entry: Record<string, any>;
      try {
        entry = JSON.parse(trimmed);
      } catch (err: any) {
        throw new Error(`Line ${lineNum}: Invalid JSON record (${err.message || err})`);
      }

      if (entry.type === 'edge') {
        if (
          !entry.id &&
          (!entry.source || !entry.predicate || !entry.target) &&
          (!entry.src || !entry.s || !entry.r || !entry.o)
        ) {
          throw new Error(`Line ${lineNum}: Invalid edge record format in stream.`);
        }
        parsedEdges.push({
          id: String(entry.id || crypto.randomUUID()),
          type: 'edge',
          agentId: (entry.aid || entry.agentId || targetAgentId).toUpperCase(),
          sourceId: String(entry.src || entry.source || entry.sourceId || 'root'),
          s: String(entry.s || entry.source || '').trim(),
          r: String(entry.r || entry.predicate || '').trim(),
          o: String(entry.o || entry.target || '').trim(),
          timestamp: entry.timestamp || new Date().toISOString(),
        });
      } else {
        const isV2 = entry.v === 2;
        const vectorField = isV2 ? (entry.vec || entry.vector) : entry.vector;
        const textField = isV2 ? (entry.t || entry.text) : entry.text;
        const sourceField = isV2 ? (entry.src || entry.source) : entry.source;
        const timestampField = isV2 ? (entry.ts || entry.timestamp) : entry.timestamp;
        const metaField = isV2 ? (entry.d || entry.meta || entry.metadata) : (entry.meta || entry.metadata);
        const markField = isV2 ? (entry.m || entry.numMarkId) : entry.numMarkId;
        const handleField = isV2 ? (entry.h || entry.agentHandle) : entry.agentHandle;

        if (!isValidVector(vectorField)) {
          throw new Error(`Line ${lineNum}: Vector field is missing, empty, non-numeric, or malformed.`);
        }

        if (typeof textField !== 'string' || !textField.trim()) {
          throw new Error(`Line ${lineNum}: Vector text is invalid or empty.`);
        }

        const model = metaField?.embeddingModel || entry.model || 'gemini-embedding-2';
        const dimension = metaField?.embeddingDimension || vectorField.length;

        if (dimension !== undefined && Number(dimension) !== vectorField.length) {
          throw new Error(`Line ${lineNum}: Dimension mismatch: metadata specifies ${dimension} but array has ${vectorField.length}`);
        }

        parsedVectors.push({
          id: entry.id || crypto.randomUUID(),
          agentId: entry.a || entry.agentId || targetAgentId,
          text: textField.trim(),
          vector: vectorField,
          source: sourceField || fileName,
          timestamp: typeof timestampField === 'number' ? timestampField : Date.now(),
          metadata: metaField || {
            source: sourceField || fileName,
            timestamp: new Date().toISOString(),
            locus: `MYTHOS.LORE.${targetAgentId}`,
            embeddingModel: model,
            embeddingDimension: vectorField.length,
          },
          numMarkId: markField || '',
          agentHandle: handleField || '',
          permissions: entry.p,
        });
      }

      optProgress?.({
        processed: recordsRead,
        vectors: parsedVectors.length,
        edges: parsedEdges.length,
        rejected: errors.length,
      });
    };

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += value;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() || '';
        for (const line of lines) {
          linesRead++;
          parseLine(line, linesRead);
        }
      }
      if (buffer.trim()) {
        linesRead++;
        parseLine(buffer, linesRead);
      }
    } catch (err: any) {
      errors.push(err.message || String(err));
      return {
        success: false,
        importedRecords: 0,
        importedVectors: 0,
        importedEdges: 0,
        recordsRead,
        linesRead,
        rejectedRecords: recordsRead,
        rejected: recordsRead,
        diagnostics: [`Import failed: ${err.message || err}`],
      };
    }

    if (recordsRead === 0) {
      return {
        success: false,
        importedRecords: 0,
        importedVectors: 0,
        importedEdges: 0,
        recordsRead: 0,
        linesRead: 0,
        rejectedRecords: 0,
        rejected: 0,
        diagnostics: ['Import integrity failure: no valid records found in archive.'],
      };
    }

    // Pack Internal Integrity Check
    const vectorIdSet = new Set<string>();
    for (const node of parsedVectors) {
      if (vectorIdSet.has(node.id)) {
        return {
          success: false,
          importedRecords: 0,
          importedVectors: 0,
          importedEdges: 0,
          recordsRead,
          linesRead,
          rejectedRecords: recordsRead,
          rejected: recordsRead,
          diagnostics: [`INTERNAL PACK CONFLICT: duplicate vector ID "${node.id}".`],
        };
      }
      vectorIdSet.add(node.id);
    }

    const edgeIdSet = new Set<string>();
    for (const edge of parsedEdges) {
      if (edgeIdSet.has(edge.id)) {
        return {
          success: false,
          importedRecords: 0,
          importedVectors: 0,
          importedEdges: 0,
          recordsRead,
          linesRead,
          rejectedRecords: recordsRead,
          rejected: recordsRead,
          diagnostics: [`INTERNAL PACK CONFLICT: duplicate edge ID "${edge.id}".`],
        };
      }
      edgeIdSet.add(edge.id);
    }

    const dimensions = new Set(parsedVectors.map((v) => v.vector.length));
    if (dimensions.size > 1) {
      return {
        success: false,
        importedRecords: 0,
        importedVectors: 0,
        importedEdges: 0,
        recordsRead,
        linesRead,
        rejectedRecords: recordsRead,
        rejected: recordsRead,
        diagnostics: [
          `INTERNAL PACK CONFLICT: imported vectors contain multiple embedding dimensions: ${Array.from(dimensions).join(', ')}.`,
        ],
      };
    }

    const importedModels = new Set(
      parsedVectors.map((v) => (v.metadata?.embeddingModel as string) || '').filter(Boolean)
    );
    if (importedModels.size > 1) {
      return {
        success: false,
        importedRecords: 0,
        importedVectors: 0,
        importedEdges: 0,
        recordsRead,
        linesRead,
        rejectedRecords: recordsRead,
        rejected: recordsRead,
        diagnostics: [
          `INTERNAL PACK CONFLICT: imported vectors contain multiple embedding models: ${Array.from(importedModels).join(', ')}.`,
        ],
      };
    }

    const packDimension = parsedVectors[0]?.vector?.length;
    const packModel = parsedVectors[0]?.metadata?.embeddingModel as string | undefined;

    // Existing Vault Conflict Check (Do not blame the incoming pack)
    const existing = await this.store.getVectorsByAgent(targetAgentId);
    if (existing.length > 0 && packDimension !== undefined) {
      const existingDim = existing[0].vector.length;
      if (existingDim !== packDimension) {
        return {
          success: false,
          importedRecords: 0,
          importedVectors: 0,
          importedEdges: 0,
          recordsRead,
          linesRead,
          rejectedRecords: recordsRead,
          rejected: recordsRead,
          diagnostics: [
            `VAULT CONFLICT: existing vault has dimension ${existingDim}, which conflicts with incoming pack dimension ${packDimension}.`,
          ],
        };
      }

      const existingModel = existing[0].metadata?.embeddingModel as string | undefined;
      if (existingModel && packModel && existingModel !== packModel) {
        return {
          success: false,
          importedRecords: 0,
          importedVectors: 0,
          importedEdges: 0,
          recordsRead,
          linesRead,
          rejectedRecords: recordsRead,
          rejected: recordsRead,
          diagnostics: [
            `VAULT CONFLICT: existing vault uses model ${existingModel}, which conflicts with incoming pack model ${packModel}.`,
          ],
        };
      }
    }

    // Atomic commit to store (0 commits on any previous failure)
    await this.store.addRecordsAtomic(parsedVectors, parsedEdges);

    return {
      success: true,
      importedRecords: parsedVectors.length + parsedEdges.length,
      importedVectors: parsedVectors.length,
      importedEdges: parsedEdges.length,
      recordsRead,
      linesRead,
      rejectedRecords: 0,
      rejected: 0,
      diagnostics: [],
    };
  }

  async search(
    query: string,
    agentId?: string,
    topK = 5,
    threshold = 0.4
  ): Promise<ScoredNode[]> {
    const vectors = agentId
      ? await this.store.getVectorsByAgent(agentId)
      : await this.store.getAllVectors();

    if (!vectors.length) return [];

    let qVec: number[] | null | undefined;
    if (this.model) {
      try {
        qVec = await this.model.getEmbeddings(query);
      } catch (err) {
        console.warn('[LorepackReader] Query embedding failed:', err);
      }
    }

    if (!isValidVector(qVec)) {
      // Fallback: token-overlap matching if query embeddings fail or model not provided
      const queryTokens = query.toLowerCase().split(/\s+/).filter((t) => t.length > 2);
      return vectors
        .map((node) => {
          const content = (node.text || '').toLowerCase();
          let count = 0;
          for (const t of queryTokens) {
            if (content.includes(t)) count++;
          }
          return { node, score: count / Math.max(1, queryTokens.length) };
        })
        .filter((r) => r.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);
    }

    const queryDimension = qVec.length;
    const scored = vectors
      .filter((node) => isValidVector(node.vector) && node.vector.length === queryDimension)
      .map((node) => ({
        node,
        score: this.cosine(qVec!, node.vector),
      }))
      .filter((r) => r.score >= threshold)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored;
  }

  async chat(
    userQuery: string,
    agentId: string,
    systemPrompt?: string,
    modelName = 'gemini-3.8-flash',
    topK = 6,
    threshold = 0.4
  ): Promise<{
    response: string;
    derivation: string;
    source: string;
    nodes: VectorRecord[];
  }> {
    const hits = await this.search(userQuery, agentId, topK, threshold);
    const nodes = hits.map((h) => h.node);

    if (!nodes.length) {
      return {
        response: 'No relevant contextual memories found in agent vault.',
        derivation: 'ZERO_MATCH',
        source: 'NONE',
        nodes: [],
      };
    }

    const contextText = nodes.map((n, i) => `[MEMORY_${i + 1} (${n.source})]: ${n.text}`).join('\n\n');
    const prompt = `Context memories:\n${contextText}\n\nUser Question: ${userQuery}\n\nAnswer using the context memories above.`;

    let response = '';
    if (this.model && typeof this.model.generateText === 'function') {
      try {
        response = await this.model.generateText(prompt, systemPrompt, modelName);
      } catch (err: any) {
        response = `[RAG Retrieval Success]: Retrieved ${nodes.length} memory blocks, but LLM generation encountered an error: ${err.message || err}`;
      }
    } else {
      response = `[RAG Context Summary]: Retrieved ${nodes.length} relevant memories from vault.\n\n${nodes.map((n) => `• ${n.text}`).join('\n')}`;
    }

    const sources = Array.from(new Set(nodes.map((n) => n.source))).join(', ');
    return {
      response,
      derivation: 'RAG_EMBEDDING_SEARCH',
      source: sources || 'VAULT',
      nodes,
    };
  }

  async getStats(agentId?: string): Promise<{ totalNodes: number; totalEdges: number }> {
    if (agentId) {
      const [vectors, edges] = await Promise.all([
        this.store.getVectorsByAgent(agentId),
        this.store.getTripletEdgesByAgent(agentId),
      ]);
      return { totalNodes: vectors.length, totalEdges: edges.length };
    }
    const [vectors, edges] = await Promise.all([
      this.store.getAllVectors(),
      this.store.getAllTripletEdges(),
    ]);
    return { totalNodes: vectors.length, totalEdges: edges.length };
  }

  async getVectors(agentId?: string): Promise<VectorRecord[]> {
    return agentId ? this.store.getVectorsByAgent(agentId) : this.store.getAllVectors();
  }

  async getEdges(agentId?: string): Promise<TripletEdge[]> {
    return agentId ? this.store.getTripletEdgesByAgent(agentId) : this.store.getAllTripletEdges();
  }

  async verifyPackage(
    fileOrBlob: Blob | File,
    expectedAgentId?: string
  ): Promise<VerificationResult> {
    const tempStore = new InMemoryLorepackStore();
    const tempReader = new LorepackReader(tempStore, this.model);

    try {
      const result = await tempReader.importLorepack(fileOrBlob, expectedAgentId);
      if (result.importedVectors === 0 && result.importedEdges === 0) {
        return {
          valid: false,
          reason: 'Package is empty (0 vectors and 0 edges).',
        };
      }

      const allVectors = await tempStore.getAllVectors();
      const allEdges = await tempStore.getAllTripletEdges();

      const dimensions = new Set(allVectors.map((v) => v.vector.length));
      if (dimensions.size > 1) {
        return {
          valid: false,
          reason: `Mixed embedding dimensions detected: ${Array.from(dimensions).join(', ')}`,
        };
      }

      const models = new Set(allVectors.map((v) => (v.metadata?.embeddingModel as string) || 'unknown'));
      if (models.size > 1) {
        return {
          valid: false,
          reason: `Multiple embedding models detected in package: ${Array.from(models).join(', ')}`,
        };
      }

      const vectorIdSet = new Set(allVectors.map((v) => v.id));
      const unresolvable = allEdges.filter((e) => !vectorIdSet.has(e.sourceId));
      if (unresolvable.length > 0) {
        return {
          valid: false,
          reason: `${unresolvable.length} edge(s) reference non-existent vector IDs in this package.`,
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
        valid: true,
        stats: {
          vectors: allVectors.length,
          edges: allEdges.length,
          dimension: allVectors[0]?.vector?.length,
          model: (allVectors[0]?.metadata?.embeddingModel as string) || 'gemini-embedding-2',
          probeScore,
        },
      };
    } catch (err: any) {
      return {
        valid: false,
        reason: `Package verification failed: ${err.message}`,
      };
    }
  }
}
