export interface VectorRecord {
    id: string;
    agentId: string;
    agent?: string;
    agentHandle?: string;
    text: string;
    vector: number[];
    numMarkId?: string;
    source: string;
    timestamp: number;
    metadata?: Record<string, unknown>;
    permissions?: unknown;
}
export interface Triplet {
    s: string;
    r: string;
    o: string;
}
export interface TripletEdge {
    id: string;
    type: 'edge';
    agentId: string;
    sourceId: string;
    s: string;
    r: string;
    o: string;
    timestamp: string;
}
export interface LorepackModel {
    getEmbeddings(text: string): Promise<number[] | null | undefined>;
    extractTripletsFromText(text: string): Promise<Triplet[]>;
}
export interface LorepackStore {
    addVectors(vectors: VectorRecord[]): Promise<void>;
    getVectorsByAgent(agentId: string): Promise<VectorRecord[]>;
    getAllVectors(): Promise<VectorRecord[]>;
    addTripletEdges(edges: TripletEdge[]): Promise<void>;
    getTripletEdgesByAgent(agentId: string): Promise<TripletEdge[]>;
    getAllTripletEdges(): Promise<TripletEdge[]>;
}
export interface ImportProgress {
    processed: number;
    vectors: number;
    edges: number;
}
