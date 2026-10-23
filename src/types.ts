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
  processing_status?: 'pending' | 'processing' | 'completed' | 'error';
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
  fetchEmbeddingModels?(): Promise<string[]>;
}

export interface LorepackStore {
  addVectors(vectors: VectorRecord[]): Promise<void>;
  getVectorsByAgent(agentId: string): Promise<VectorRecord[]>;
  getAllVectors(): Promise<VectorRecord[]>;
  getUnprocessedVectorsByAgent?(agentId: string): Promise<VectorRecord[]>;
  updateVectorProcessingStatus?(ids: string[], status: 'pending' | 'processing' | 'completed' | 'error'): Promise<void>;
  addTripletEdges(edges: TripletEdge[]): Promise<void>;
  getTripletEdgesByAgent(agentId: string): Promise<TripletEdge[]>;
  getAllTripletEdges(): Promise<TripletEdge[]>;
  addRecordsAtomic(vectors: VectorRecord[], edges: TripletEdge[]): Promise<void>;
  searchVectorsBySimilarity(queryVector: number[], limit: number): Promise<VectorRecord[]>;
  clearAgent(agentId: string): Promise<{ vectors: number; edges: number }>;
  nukeStore(): Promise<void>;
}

export interface ExportProgress {
  active?: boolean;
  serialized: number;
  total: number;
  percent: number;
  stage: 'initializing' | 'serializing' | 'compressing' | 'complete';
  chunkLabel?: string;
  filename?: string;
}

export interface ImportProgress {
  processed: number;
  vectors: number;
  edges: number;
  rejected?: number;
}

export type PipelineStepId = 'stage' | 'ingest' | 'graph' | 'test' | 'ship';
export type PipelineStepStatus = 'idle' | 'running' | 'completed' | 'error' | 'skipped';

export interface PipelineStepInfo {
  id: PipelineStepId;
  label: string;
  sublabel: string;
  status: PipelineStepStatus;
  progress: number; // 0 - 100
  detail?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface BatchFileStatus {
  name: string;
  progress: number; // 0-100
  status: 'pending' | 'processing' | 'completed' | 'error';
  error?: string;
  size?: number;
}

export interface PipelineState {
  agentId: string;
  active: boolean;
  paused: boolean;
  autoRetry: boolean;
  currentStepId: PipelineStepId | null;
  lastFailedStepId: PipelineStepId | null;
  lastCompletedStepId: PipelineStepId | null;
  overallProgress: number;
  steps: Record<PipelineStepId, PipelineStepInfo>;
  logs: Array<{ time: string; msg: string; type: 'info' | 'ok' | 'err' }>;
  batchFiles: BatchFileStatus[];
  exportedBlob?: Blob;
  exportedFilename?: string;
}




export interface OptimizationConfig {
  batchSize?: number;
  lanesPerKey?: number;
  chunkSize?: number;
  graphThreshold?: number;
}
