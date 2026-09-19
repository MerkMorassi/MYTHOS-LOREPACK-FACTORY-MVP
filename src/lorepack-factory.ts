import type {
  ImportProgress,
  LorepackModel,
  LorepackStore,
  TripletEdge,
  VectorRecord,
} from './types.js';
import { LorepackPacker, type PackageTestResult } from './packer.js';
import {
  LorepackReader,
  InMemoryLorepackStore,
  isValidVector,
  looksLikeText,
  type VerificationResult,
  type ScoredNode,
  type ImportResult,
} from './reader.js';

export {
  LorepackPacker,
  LorepackReader,
  InMemoryLorepackStore,
  isValidVector,
  looksLikeText,
  type PackageTestResult,
  type VerificationResult,
  type ScoredNode,
  type ImportResult,
};

/**
 * LorepackFactory: Unified facade maintaining complete backward compatibility.
 * Composes LorepackPacker (for build/ingest/export/graph operations) and
 * LorepackReader (for import/search/RAG/inspection operations).
 *
 * Core Principle: PACKER BUILDS. READER READS.
 */
export class LorepackFactory {
  public readonly packer: LorepackPacker;
  public readonly reader: LorepackReader;

  constructor(
    private readonly store: LorepackStore,
    private readonly model: LorepackModel
  ) {
    this.packer = new LorepackPacker(this.store, this.model);
    this.reader = new LorepackReader(this.store, this.model);
  }

  setApiKeys(keys: string[]): void {
    this.packer.setApiKeys(keys);
  }

  // ------------------------------------------------------------
  // PACKER DELEGATION
  // ------------------------------------------------------------

  genSigil(text: string): string {
    return this.packer.genSigil(text);
  }

  stage(
    batches: Array<{ text: string; source: string }>,
    existingNodes?: VectorRecord[]
  ): Array<{ text: string; source: string; numMarkId: string }> {
    return this.packer.stage(batches, existingNodes);
  }

  chunk(text: string, maxChars = 2000): string[] {
    return this.packer.chunk(text, maxChars);
  }

  async ingestBatches(
    batches: Array<{ text: string; source: string }>,
    options: {
      agentId: string;
      onProgress?: (progress: { processed: number; written: number; total: number }) => void;
      signal?: AbortSignal;
      batchSize?: number;
    }
  ): Promise<{ ingested: number; failed: Array<{ text: string; reason: string }> }> {
    return this.packer.ingestBatches(batches, options);
  }

  async ingestConversationalTurn(
    agentId: string,
    agentHandle: string,
    userText: string,
    modelText: string
  ): Promise<void> {
    return this.packer.ingestConversationalTurn(agentId, agentHandle, userText, modelText);
  }

  async buildGraph(
    agentId: string,
    onProgress?: (current: number, total: number, created: number) => void,
    modelName?: string
  ): Promise<number> {
    return this.packer.buildGraph(agentId, onProgress, modelName);
  }

  async buildGraphLite(
    agentId: string,
    onProgress?: (current: number, total: number, created: number) => void,
    modelName?: string
  ): Promise<number> {
    return this.packer.buildGraphLite(agentId, onProgress, modelName);
  }

  yieldExportBatches(agentId: string, batchSize = 1000): AsyncGenerator<object[]> {
    return this.packer.yieldExportBatches(agentId, batchSize);
  }

  async exportLorepack(
    agentId: string,
    options?: { gzip?: boolean }
  ): Promise<{ blob: Blob; count: number; filename: string }> {
    return this.packer.exportLorepack(agentId, options);
  }

  async exportToGz(agentId: string): Promise<{ blob: Blob; count: number; filename: string }> {
    return this.packer.exportToGz(agentId);
  }

  async exportToJsonl(agentId: string): Promise<{ blob: Blob; count: number; filename: string }> {
    return this.packer.exportToJsonl(agentId);
  }

  async testPackage(
    fileOrBlob: Blob | File,
    expectedAgentId?: string
  ): Promise<PackageTestResult> {
    return this.packer.testPackage(fileOrBlob, expectedAgentId);
  }

  async verifyPackage(
    fileOrBlob: Blob | File,
    expectedAgentId?: string
  ): Promise<VerificationResult> {
    return this.packer.verifyPackage(fileOrBlob, expectedAgentId);
  }

  async syncToEndpoint(
    endpoint: string,
    agentId: string,
    apiKey?: string
  ): Promise<{ success: boolean; synced: number }> {
    return this.packer.syncToEndpoint(endpoint, agentId, apiKey);
  }

  async clearAgent(agentId: string): Promise<{ vectors: number; edges: number }> {
    return this.packer.clearAgent(agentId);
  }

  async nuke(): Promise<void> {
    return this.packer.nuke();
  }

  // ------------------------------------------------------------
  // READER DELEGATION
  // ------------------------------------------------------------

  async importLorepack(
    fileOrBlob: Blob | File | Uint8Array,
    agentId?: string,
    onProgress?: (progress: ImportProgress) => void
  ): Promise<ImportResult> {
    return this.reader.importLorepack(fileOrBlob, agentId, onProgress);
  }

  async search(
    query: string,
    agentId?: string,
    topK?: number,
    threshold?: number
  ): Promise<ScoredNode[]> {
    return this.reader.search(query, agentId, topK, threshold);
  }

  async chat(
    userQuery: string,
    agentId: string,
    systemPrompt?: string,
    modelName?: string,
    topK?: number,
    threshold?: number
  ): Promise<{
    response: string;
    derivation: string;
    source: string;
    nodes: VectorRecord[];
  }> {
    return this.reader.chat(userQuery, agentId, systemPrompt, modelName, topK, threshold);
  }

  cosine(a: number[], b: number[]): number {
    return this.reader.cosine(a, b);
  }

  async getStats(agentId?: string): Promise<{ totalNodes: number; totalEdges: number }> {
    return this.reader.getStats(agentId);
  }

  async getVectors(agentId?: string): Promise<VectorRecord[]> {
    return this.reader.getVectors(agentId);
  }

  async getNodes(agentId?: string): Promise<VectorRecord[]> {
    return this.reader.getVectors(agentId);
  }

  async getEdges(agentId?: string): Promise<TripletEdge[]> {
    return this.reader.getEdges(agentId);
  }
}
