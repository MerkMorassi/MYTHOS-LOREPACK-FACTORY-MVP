import { LoreEntry } from '../types.ts';
export declare const retrieveLivedExperience: (agentId: string, query: string) => Promise<{
    text: string;
    sources: string[];
} | null>;
export declare const initLocalRAG: () => Promise<void>;
export declare const addDocument: (projectId: string, entry: LoreEntry) => Promise<void>;
export declare const deleteDocumentsByLoreEntryId: (loreEntryId: string, projectId: string) => Promise<void>;
export declare const clearProjectDocuments: (projectId: string) => Promise<void>;
export declare const searchDocuments: (projectId: string, query: string, limit?: number) => Promise<LoreEntry[]>;
export declare const getAllDocuments: (projectId: string) => Promise<LoreEntry[]>;
export declare const clearAllLocalRAG: () => Promise<void>;
