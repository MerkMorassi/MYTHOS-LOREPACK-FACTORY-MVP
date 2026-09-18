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
  getEmbeddings(text: string, keys?: string[]): Promise<number[] | null | undefined>;
  getEmbeddingsBatch?(texts: string[], keys?: string[]): Promise<number[][]>;
  extractTripletsFromText(text: string, modelName?: string, keys?: string[]): Promise<Triplet[]>;
  generateText?(prompt: string, systemPrompt?: string, modelName?: string, keys?: string[]): Promise<string>;
  fetchModels?(): Promise<string[]>;
}

export interface LorepackStore {
  addVectors(vectors: VectorRecord[]): Promise<void>;
  getVectorsByAgent(agentId: string): Promise<VectorRecord[]>;
  getAllVectors(): Promise<VectorRecord[]>;
  addTripletEdges(edges: TripletEdge[]): Promise<void>;
  getTripletEdgesByAgent(agentId: string): Promise<TripletEdge[]>;
  getAllTripletEdges(): Promise<TripletEdge[]>;
  addRecordsAtomic(vectors: VectorRecord[], edges: TripletEdge[]): Promise<void>;
  clearAgent(agentId: string): Promise<{ vectors: number; edges: number }>;
  nukeStore(): Promise<void>;
}

export interface ImportProgress {
  processed: number;
  vectors: number;
  edges: number;
  rejected?: number;
}

