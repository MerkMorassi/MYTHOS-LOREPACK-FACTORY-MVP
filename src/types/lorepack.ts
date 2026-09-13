
export type RAGProvider = 'cloud' | 'localhost' | 'browser';
export type ModelEngine = 'gemini' | 'dolphin';
export type ActiveView = 'dashboard' | 'projects' | 'team' | 'core' | 'ideation' | 'scripting' | 'design' | 'art' | 'director' | 'mythos-cinematic-engine' | 'one-shot-cinematic' | 'image-generator' | 'generative-video' | 'transition-studio' | 'camera-movement' | 'camera-moves' | 'blender' | 'scene-compositor' | 'composite' | 'face-swap' | 'face-repair' | 'photorealism' | 'resize' | 'green-screen' | 'background-removal' | 'qwen-image-edit' | 'topaz' | 'grid' | 'story' | 'inspiration' | 'scripts-bin' | 'script-writer' | 'agents' | 'studio-players' | 'characters' | 'lore' | 'prompt-library' | 'dynamic-prompts' | 'agent-chat' | 'knowledge' | 'automation' | 'agent-workspace' | 'voice-lab' | 'model-settings' | 'wanimate-studio' | 'dubbing-studio' | 'ltx-studio' | 'live-studio';

export type GridOverlayType = 'none' | 'basic' | 'triadic' | 'golden-basic' | 'golden-triadic';

export interface ChatMessage {
  role: 'user' | 'model' | 'tool_code';
  text: string;
}

export interface ImageState {
  id: string;
  type: 'image' | 'video';
  base64?: string;
  url?: string;
  mimeType?: string;
  isUpscaling?: boolean;
  agentId?: string;
  metadata?: any;
}

export interface Character {
  id: string;
  name: string;
  archetype: string;
  description: string;
  avatar?: string;
}

export interface LoreEntry {
  id: string;
  projectId: string;
  title: string;
  content: string;
  ragDocumentId?: string;
}

export interface ScriptFile {
  id: string;
  title: string;
  content: string;
  date: string;
  type: 'screenplay' | 'script';
}

export interface StoryboardFrame {
  id: string;
  base64Image: string;
  notes: string;
  prompt?: string;
}

export interface InspirationImage {
  id: string;
  base64Image: string;
}

export interface BlenderImage {
  id: string;
  base64: string;
}

export interface PromptTemplate {
  id: string;
  name: string;
  positivePrompt: string;
  negativePrompt: string;
  isDefault?: boolean;
}

export interface DynamicPromptList {
  id: string;
  name: string;
  items: string[];
}

export interface GenerationOptions {
  prompt: string;
  negativePrompt: string;
  numImages: number;
  aspectRatio: '16:9' | '9:16' | '1:1' | '2.39:1';
  guidanceScale: number;
  seed: string;
  cameraAngle: string;
  addLetterbox: boolean;
  geminiModel: 'gemini-2.5-flash-image' | 'imagen-4.0-generate-001';
  deliveryMethod: 'internal' | 'external';
  engine: 'mythos_sdxl' | 'gemini';
  base64Image?: string;
  mimeType?: string;
  strength?: number;
  maskBase64?: string;
}

export interface AutomationConfig {
  ragEnabled: boolean;
  ragProvider: RAGProvider;
  ragApiKey: string;
  ragBaseUrl: string;
  ragKnowledgeBoxId: string;
  ragLocalhostUrl: string;
  webhookUrls: string[];
}

export interface WanimateState {
  inputImage: { base64: string; mimeType: string } | null;
  lastImage: { base64: string; mimeType: string } | null;
  prompt: string;
  steps: number;
  negativePrompt: string;
  durationSeconds: number;
  guidanceScale: number;
  guidanceScale2: number;
  seed: number;
  randomizeSeed: boolean;
  quality: number;
  scheduler: 'UniPCMultistep' | 'DPM++ 2M SDE Karras' | 'DPM++ 2M Karras' | 'Euler a';
  flowShift: number;
  frameMultiplier: '16' | '24' | '30';
  resultUrl: string | null;
}

export interface DubbingState {
  sourceVideo: { base64: string; mimeType: string } | null;
  sourceAudio: { base64: string; mimeType: string } | null;
  resultUrl: string | null;
}

export interface LTXStudioState {
  prompt: string;
  image: { base64: string; mimeType: string } | null;
  resultUrl: string | null;
  duration: number;
  seed: number;
  randomizeSeed: boolean;
  width: number;
  height: number;
  enhancePrompt: boolean;
}

export interface Project {
  id: string;
  name: string;
  tagline?: string;
  brief?: string;
  progress?: number;
  thumbnail?: string;
  data: {
    images: ImageState[];
    storyboard: StoryboardFrame[];
    scriptText: string;
    scriptsBin: ScriptFile[];
    inspirationImages: InspirationImage[];
    blenderImages: BlenderImage[];
    blenderResult: string | null;
    sceneCompositorState: SceneCompositorState;
    compositeState: CompositeState;
    faceSwapState: FaceSwapState;
    faceRepairState: FaceRepairState;
    photorealismState: PhotorealismState;
    resizeState: ResizeState;
    greenScreenState: GreenScreenState;
    backgroundRemovalState: BackgroundRemovalState;
    qwenImageEditState: QwenImageEditState;
    generativeVideoState: GenerativeVideoState;
    cameraMovementState: CameraMovementState;
    cameraMovesState: CameraMovesState;
    transitionState: TransitionState;
    topazState: TopazState;
    directorState: any;
    agents: Agent[];
    studioPlayers: Agent[];
    characters: Character[];
    lore: LoreEntry[];
    dynamicPromptLists: DynamicPromptList[];
    promptTemplates: PromptTemplate[];
    automationConfig: AutomationConfig;
    wanimateState: WanimateState;
    dubbingState: DubbingState;
    ltxStudioState: LTXStudioState;
    mythosPrompt?: string;
  };
}

export interface SceneCompositorState {
  background: { base64: string; mimeType: string } | null;
  character: { base64: string; mimeType: string } | null;
  result: string | null;
}

export interface CompositeState {
  refImage1: { base64: string; mimeType: string } | null;
  refImage2: { base64: string; mimeType: string } | null;
  task1: string;
  task2: string;
  prompt: string;
  negativePrompt: string;
  width: number;
  height: number;
  seed: number;
  randomizeSeed: boolean;
  resultImage: { base64: string; mimeType: string } | null;
  resultVideoUrl: string | null;
}

export interface FaceSwapState {
  source: { base64: string; mimeType: string } | null;
  face: { base64: string; mimeType: string } | null;
  result: string | null;
}

export interface FaceRepairState {
  source: { base64: string; mimeType: string } | null;
  result: string | null;
}

export interface PhotorealismState {
  source: { base64: string; mimeType: string } | null;
  result: string | null;
  prompt: string;
  negativePrompt: string;
}

export interface ResizeState {
  source: { base64: string; mimeType: string } | null;
  result: { base64: string; mimeType: string } | null;
  width: number;
  height: number;
  prompt: string;
  alignment: 'Middle' | 'Left' | 'Right' | 'Top' | 'Bottom';
  overlap: number;
  steps: number;
  directions: { left: boolean; right: boolean; top: boolean; bottom: boolean };
}

export interface GreenScreenState {
  source: { base64: string; mimeType: string } | null;
  resultUrl: string | null;
}

export interface BackgroundRemovalState {
  source: { base64: string; mimeType: string } | null;
  result: { base64: string; mimeType: string } | null;
}

export interface QwenImageEditState {
  images: ({ base64: string; mimeType: string } | null)[];
  result: { base64: string; mimeType: string } | null;
  prompt: string;
  negativePrompt: string;
  cfgScale: number;
  seed: number;
  randomizeSeed: boolean;
  width: number;
  height: number;
  steps: number;
}

export interface GenerativeVideoState {
  image: { base64: string; mimeType: string } | null;
  resultUrl: string | null;
  seed: number;
  randomizeSeed: boolean;
  motionBucketId: number;
  cfgScale: number;
  steps: number;
}

export interface CameraMovementState {
  source: { base64: string; mimeType: string } | null;
  prompt: string;
  negativePrompt: string;
  movementType: string;
  steps: number;
  guidanceScale: number;
  seed: number;
  randomizeSeed: boolean;
  resultUrl: string | null;
}

export interface CameraMovesState {
  sourceVideo: { base64: string; mimeType: string } | null;
  prompt: string;
  cameraType: string;
  steps: number;
  resultUrl: string | null;
}

export interface TransitionState {
  startImage: { base64: string; mimeType: string } | null;
  endImage: { base64: string; mimeType: string } | null;
  prompt: string;
  negativePrompt: string;
  duration: number;
  steps: number;
  guidanceScale: number;
  guidanceScale2: number;
  seed: number;
  randomizeSeed: boolean;
  resultUrl: string | null;
  strengthStart?: number;
  strengthEnd?: number;
  enhancePrompt?: boolean;
  width?: number;
  height?: number;
}

export interface TopazState {
  activeMediaType: 'image' | 'video';
  source: { base64: string; mimeType: string } | null;
  result: { base64: string; mimeType: string } | null;
  resultUrl: string | null;
  operation: 'enhance' | 'sharpen' | 'denoise' | 'restore' | 'lighting';
  parameters: { scale: number; strength: number };
  faceRecovery: boolean;
}

export interface FunctionCall {
  name: string;
  args: any;
  id: string;
}

export interface ToolCode {
  code: string;
}

// --- NEW RAG & LOREPACK TYPES ---

export interface VectorRecord {
  id: string;
  text: string;
  vector: number[];
  source: string;
  agent?: string; 
  timestamp: number;
  permissions?: string; 
  agentId?: string;
  agentHandle?: string;
  numMarkId?: string;
  metadata?: any;
}
export type LorePackExport = VectorRecord[];

export enum ConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  ERROR = 'ERROR',
}

export interface VisionEvent {
    id: string;
    timestamp: number;
    type: 'SCREENING_ROOM_SNAPSHOT';
    description: string;
    assetUrl: string;
    witnessedBy: string[];
}

export interface LogMessage {
  id: string;
  type: 'user' | 'model' | 'system' | 'tool';
  text: string;
  timestamp: number;
  sender?: string;
  isStreaming?: boolean;
  feedback?: 'up' | 'down';
  attachment?: string;
  attachmentType?: 'image' | 'video' | 'text' | 'audio' | 'pdf';
  visionEvent?: VisionEvent;
}

export interface ChatSession {
  id: string;
  title: string;
  timestamp: number;
  logs: LogMessage[];
  agentId: string;
}

export interface ModelConfig {
  temperature: number;
  topP: number;
  topK: number;
}

export const DEFAULT_MODEL_CONFIG: ModelConfig = {
  temperature: 0.7,
  topP: 0.95,
  topK: 40,
};

export interface SovereignConfig {
  mode: 'PRESET' | 'CUSTOM' | 'SILENT';
  preset: string;
  customGreeting: string;
}

export const DEFAULT_SOVEREIGN_CONFIG: SovereignConfig = {
  mode: 'PRESET',
  preset: 'Nexus Prime',
  customGreeting: ''
};

export interface AgentConfig {
  agentId: string;
  systemInstruction: string;
  modelConfig: ModelConfig;
  voiceName?: string;
  voiceReference?: string;
  voiceSpeed?: number;
  voicePitch?: number;
  accessLevel?: string;
  bio?: string;
  seedImages?: { base64: string; mimeType: string }[];
}

export interface CloudFile {
  name: string;
  displayName: string;
  mimeType: string;
  sizeBytes: string;
  createTime: string;
  state: 'STATE_UNSPECIFIED' | 'PROCESSING' | 'ACTIVE' | 'FAILED';
  uri: string;
}

export interface GraphNode {
  id: string;
  name: string;
  label: string; 
  description: string;
  agentId: string;
}

export interface GraphEdge {
  source: string; 
  target: string; 
  label: string;
  agentId: string;
}

export interface TripletEdge {
    id: string;
    type: 'edge';
    agentId: string;
    sourceId: string; // ID of the vector this triplet was extracted from
    s: string; // subject
    r: string; // relation
    o: string; // object
    timestamp: string;
}


export type PermMemory = 'READ_LORE' | 'WRITE_LORE' | 'MODIFY_LORE' | 'MANAGE_MEMORY';
export type PermTools = 'EXECUTE_CODE' | 'ROUTE_EXTERNAL' | 'GENERATE_MEDIA' | 'COLLABORATE';
export type PermSystem = 'ADMIN_OVERRIDE' | 'BROADCAST_COUNCIL' | 'SELF_UPDATE' | 'PUBLISH_CANON' | 'WRITE_CANON';
export type SomaPermission = PermMemory | PermTools | PermSystem;

export enum SomaActionType {
    QUERY_DB = 'QUERY_DB',
    INGEST_DATA = 'INGEST_DATA',
    DELETE_DATA = 'DELETE_DATA',
    EXEC_CODE = 'EXEC_CODE',
    ROUTE_REQUEST = 'ROUTE_REQUEST',
    CREATE_IMAGE = 'CREATE_IMAGE',
    SYSTEM_ADMIN = 'SYSTEM_ADMIN',
    BROADCAST = 'BROADCAST',
    PUBLISH_CANON = 'PUBLISH_CANON',
    DELEGATE_TASK = 'DELEGATE_TASK',
    COLLABORATE = 'COLLABORATE'
}

export type AgentClass = 'PARTNER' | 'EXECUTIVE' | 'TALENT' | 'STAFF';
export type AgentDepartment = 'ADMINISTRATION' | 'CREATIVE' | 'PRODUCTION' | 'TECHNICAL';

export interface StudioConfig {
    preferredTools: string[];
    color: string;
}

export interface ActorProfile {
    canAct: boolean;
    currentRole?: string;
    voiceCloneId?: string;
}

// HYBRID AGENT INTERFACE - SUPPORTS BOTH LEGACY AND NEW RAG FIELDS
export interface Agent {
  // Common
  id: string;
  name: string;
  
  // Legacy fields (Active App Use)
  lore?: string;
  chatHistory?: ChatMessage[];
  systemPrompt: string; // Used by existing components
  voice: string;
  avatar?: string;
  tags?: string[];
  speakingRate?: number;
  autoPlayAudio?: boolean;
  knowledgeBaseUrl?: string;
  enableLocalRag?: boolean;
  protectedWords?: string;
  bio?: string;
  narrativeRole?: string;
  actorName?: string;
  actorContact?: string;
  preferredEngine?: ModelEngine;
  agentClass?: AgentClass;
  department?: AgentDepartment;
  media?: ImageState[];

  // New RAG/Soma fields (Optional for now)
  handle?: string;
  system_instruction?: string; // New RAG uses this
  pronouns?: string;
  accessLevel?: string;
  permissions?: SomaPermission[]; 
  voiceReference?: string;
  studioConfig?: StudioConfig;
  actorProfile?: ActorProfile;
  file_ids?: string[];
  seedImages?: { base64: string; mimeType: string }[];
}

export interface LorePackHeader {
  schema: "MYTHOS.LOREPACK.v1";
  id: string;
  agentId: string;
  handle: string;
  version: number;
  timestamp: number;
  description?: string;
  name?: string;
}

export interface LorePack {
  id: string;
  header: LorePackHeader;
  sacred_archive: VectorRecord[];
}

export interface MediaAsset {
    id: string;
    type: 'image' | 'video' | 'audio' | 'text' | 'pdf';
    data: string;
    prompt: string;
    agentId: string;
    timestamp: number;
    tags?: string[];
    cloudUri?: string;
}

export interface CanvasSection {
    id: string;
    title: string;
    content: string;
    lastEditor: string;
    timestamp: number;
}

export interface WorkingMemory {
    id: string; 
    title: string;
    sections: CanvasSection[];
    lastModified: number;
}

export interface MultiAgentMessage {
    id: string;
    senderId: string; 
    senderName: string;
    text: string;
    timestamp: number;
    targets?: string[]; 
    msgType?: 'utterance' | 'action' | 'thought' | 'system';
    isThinking?: boolean;
    attachment?: string;
    meta?: Record<string, any>; 
    model?: string;
}

export enum ProductionStage {
    IDEATION = 'IDEATION',
    SCRIPT = 'SCRIPT',
    DESIGN = 'DESIGN',
    ART = 'ART'
}

export enum ApprovalStatus {
    DRAFT = 'DRAFT',
    PENDING = 'PENDING',
    APPROVED = 'APPROVED',
    REJECTED = 'REJECTED'
}

export interface CanonBlock {
    id: string;
    parentId?: string;
    stage: ProductionStage;
    title: string;
    content: string;
    mediaRef?: string;
    agentId: string;
    timestamp: number;
    status: ApprovalStatus;
    version: number;
    feedback?: string;
}

export interface GemmaConfig {
  modelName: string;
  apiKey: string;
  parameters: {
    temperature: number;
    top_p: number;
    top_k: number;
    num_predict: number;
  };
  tools: {
    allowedTools: string[];
  };
}

export interface Message {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content?: string;
  images?: string[]; // base64
  toolCalls?: { name: string; args: any; }[];
  name?: string; // for tool role
}

export type StreamChunk = 
  | { type: 'text'; content: string }
  | { type: 'tool_call'; toolCall: { id: string; name: string; args: any; } };
  
declare global {
    interface AIStudio {
        hasSelectedApiKey: () => Promise<boolean>;
        openSelectKey: () => Promise<void>;
    }
    interface Window {
        aistudio?: AIStudio;
    }
}
