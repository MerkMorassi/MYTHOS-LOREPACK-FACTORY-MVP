import type { LorepackStore, TripletEdge, VectorRecord } from './types.js';
export declare class IndexedDbLorepackStore implements LorepackStore {
    private readonly databaseName;
    private readonly databaseVersion;
    private database;
    constructor(databaseName?: string, databaseVersion?: number);
    addVectors(vectors: VectorRecord[]): Promise<void>;
    getVectorsByAgent(agentId: string): Promise<VectorRecord[]>;
    getAllVectors(): Promise<VectorRecord[]>;
    addTripletEdges(edges: TripletEdge[]): Promise<void>;
    getTripletEdgesByAgent(agentId: string): Promise<TripletEdge[]>;
    getAllTripletEdges(): Promise<TripletEdge[]>;
    private open;
    private writeMany;
    private readAll;
    private readByAgent;
}
