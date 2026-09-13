import type { ImportProgress, LorepackModel, LorepackStore } from './types.js';
export declare class LorepackFactory {
    private readonly store;
    private readonly model;
    constructor(store: LorepackStore, model: LorepackModel);
    genSigil(text: string): string;
    chunk(text: string, maxChars?: number): string[];
    getStats(agentId: string): Promise<{
        totalNodes: number;
        totalEdges: number;
    }>;
    ingestBatches(batches: Array<{
        text: string;
        source: string;
    }>, options: {
        agentId: string;
        onProgress?: (progress: {
            processed: number;
            written: number;
            total: number;
        }) => void;
        signal?: AbortSignal;
    }): Promise<{
        ingested: number;
    }>;
    ingestConversationalTurn(agentId: string, agentHandle: string, userText: string, modelText: string): Promise<void>;
    buildGraphLite(agentId: string, onProgress?: (current: number, total: number, created: number) => void): Promise<number>;
    yieldExportBatches(agentId: string, batchSize?: number): AsyncGenerator<object[]>;
    importLorepack(file: File, agentId: string, onProgress?: (progress: ImportProgress) => void): Promise<{
        success: true;
        importedVectors: number;
        importedEdges: number;
    }>;
    syncToEndpoint(endpoint: string, cursor: Storage): Promise<{
        synced: number;
    }>;
}
