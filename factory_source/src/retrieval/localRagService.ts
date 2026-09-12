
import { LoreEntry, VectorRecord } from '../types.ts';
import { getEmbeddings } from './geminiService'; // Use centralized service
import { vectorDb } from './vectorDbService';

// MYTHOS Local RAG Implementation
// Uses IndexedDB for storage and Gemini text-embedding-004 for vectors.

const DB_NAME = 'mythos_vectordb';
const DB_VERSION = 1; 
const STORE_NAME = 'vectors';
const SETTINGS_STORE_NAME = 'settings'; 

interface VectorDocument {
    id: string; // Unique ID for the chunk
    loreEntryId: string; // The ID of the original LoreEntry
    projectId: string;
    title: string;
    content: string; // The chunked text
    embedding: number[];
    timestamp: number;
}

// --- IndexedDB Helpers ---

class SimpleDB {
    private db: IDBDatabase | null = null;
    private dbName: string;
    private dbVersion: number;

    constructor(dbName: string, dbVersion: number) {
        this.dbName = dbName;
        this.dbVersion = dbVersion;
    }

    async open(): Promise<IDBDatabase> {
        if (this.db) return this.db;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onupgradeneeded = (event) => {
                const db = (event.target as IDBOpenDBRequest).result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                    store.createIndex('projectId', 'projectId', { unique: false });
                    store.createIndex('loreEntryId', 'loreEntryId', { unique: false });
                }
                if (!db.objectStoreNames.contains(SETTINGS_STORE_NAME)) {
                    db.createObjectStore(SETTINGS_STORE_NAME, { keyPath: 'key' });
                }
            };

            request.onsuccess = () => {
                this.db = request.result;
                resolve(this.db);
            };

            request.onerror = () => reject(request.error);
        });
    }

    async close(): Promise<void> {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }

    async tx<T>(storeName: string, mode: IDBTransactionMode, callback: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
        await this.open();
        return new Promise((resolve, reject) => {
            if (!this.db) {
                return reject(new Error('IndexedDB not open.'));
            }
            const tx = this.db.transaction(storeName, mode);
            const store = tx.objectStore(storeName);
            const request = callback(store);

            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(new Error('Transaction aborted.'));
        });
    }

    async addBulk(storeName: string, items: any[]): Promise<void> {
        await this.open();
        return new Promise((resolve, reject) => {
            if (!this.db) {
                return reject(new Error('IndexedDB not open.'));
            }
            const tx = this.db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            
            for (const item of items) {
                store.put(item);
            }

            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(new Error('Transaction aborted.'));
        });
    }

    async delete(storeName: string, id: IDBValidKey): Promise<void> {
        await this.tx(storeName, 'readwrite', store => store.delete(id));
    }

    async clear(storeName: string): Promise<void> {
        await this.tx(storeName, 'readwrite', store => store.clear());
    }

    async getAll<T>(storeName: string, indexName?: string, query?: IDBValidKey | IDBKeyRange): Promise<T[]> {
        return await this.tx(storeName, 'readonly', store => {
            if (indexName && query) {
                return store.index(indexName).getAll(query);
            }
            return store.getAll();
        });
    }
}

const db = new SimpleDB(DB_NAME, DB_VERSION);

// --- Embedding Logic Replaced by geminiService ---

const getEmbedding = async (text: string): Promise<number[]> => {
    // Ensure text is not too long for embedding model
    const MAX_EMBEDDING_TEXT_LENGTH = 10000;
    const trimmedText = text.length > MAX_EMBEDDING_TEXT_LENGTH ? text.substring(0, MAX_EMBEDDING_TEXT_LENGTH) : text;

    const values = await getEmbeddings(trimmedText);
    if (!values) {
        throw new Error("Failed to generate embedding (service returned null).");
    }
    return values;
};

// --- Vector Math ---

const cosineSimilarity = (vecA: number[], vecB: number[]): number => {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    if (!vecA || !vecB || vecA.length === 0 || vecB.length === 0 || vecA.length !== vecB.length) {
        return 0;
    }

    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
};

// --- Semantic Chunking ---
function chunkText(text: string, targetSize = 600, overlap = 50): string[] {
    const chunks: string[] = [];
    let index = 0;
    text = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    while (index < text.length) {
        let currentChunkEnd = Math.min(index + targetSize, text.length);
        if (currentChunkEnd >= text.length) {
            chunks.push(text.slice(index).trim());
            break;
        }

        let splitIndex = -1;
        const searchStart = Math.max(index, currentChunkEnd - overlap);

        splitIndex = text.lastIndexOf('\n', currentChunkEnd);
        if (splitIndex !== -1 && splitIndex > searchStart) {
            if (splitIndex - index > targetSize / 2 || currentChunkEnd === text.length) {
                const chunk = text.slice(index, splitIndex).trim();
                if (chunk.length > 0) chunks.push(chunk);
                index = splitIndex + 1;
                continue;
            }
        }
        
        splitIndex = -1;
        const sentenceBreaks = text.slice(searchStart, currentChunkEnd).matchAll(/[.!?](?=\s|$)/g);
        let bestSentenceBreak = -1;
        for (const match of sentenceBreaks) {
            if (match.index !== undefined) {
                const absoluteIndex = searchStart + match.index + 1;
                if (absoluteIndex > index + (targetSize / 2) && absoluteIndex <= currentChunkEnd) {
                    bestSentenceBreak = absoluteIndex;
                }
            }
        }
        if (bestSentenceBreak !== -1) {
            splitIndex = bestSentenceBreak;
            const chunk = text.slice(index, splitIndex).trim();
            if (chunk.length > 0) chunks.push(chunk);
            index = splitIndex;
            continue;
        }

        splitIndex = text.lastIndexOf(' ', currentChunkEnd);
        if (splitIndex !== -1 && splitIndex > searchStart) {
            const chunk = text.slice(index, currentChunkEnd).trim();
            if (chunk.length > 0) chunks.push(chunk);
            index = splitIndex + 1;
            continue;
        }

        const chunk = text.slice(index, currentChunkEnd).trim();
        if (chunk.length > 0) chunks.push(chunk);
        index = currentChunkEnd;
    }
    
    return chunks.filter(chunk => chunk.length > 0);
}

export const retrieveLivedExperience = async (agentId: string, query: string): Promise<{ text: string, sources: string[] } | null> => {
    try {
        const allVectors: VectorRecord[] = await vectorDb.getVectorsByAgent(agentId);
        if (allVectors.length === 0) return null;

        let contextText = "";
        const sources = new Set<string>();

        const queryVector = await getEmbedding(query);
        if (!queryVector) return null;

        const scored = allVectors.map(v => ({
            ...v,
            score: cosineSimilarity(queryVector, v.vector)
        }));
        
        const relevant = scored.sort((a, b) => b.score - a.score).slice(0, 5).filter(v => v.score > 0.55);
        if (relevant.length > 0) {
            contextText += relevant.map(v => `[EXPERIENCE NODE: ${v.source}]\n${v.text}`).join('\n\n') + "\n\n";
            relevant.forEach(v => sources.add(v.source));
        }

        if (!contextText.trim()) return null;
        
        return { text: contextText, sources: Array.from(sources) };
    } catch (e) {
        console.error("[LOREPACK] Retrieval Fault", e);
        return null;
    }
};

// --- Public API ---

export const initLocalRAG = async (): Promise<void> => {
    try {
        await db.open();
        console.log("MYTHOS Local VectorDB Initialized (IndexedDB)");
    } catch (e) {
        console.error("Failed to init IndexedDB", e);
        throw new Error("Failed to initialize local RAG database.");
    }
};

// Removed apiKey from params as it's handled by centralized service
export const addDocument = async (projectId: string, entry: LoreEntry): Promise<void> => {
    const chunks = chunkText(entry.content);
    const documentsToAdd: VectorDocument[] = [];

    for (const chunk of chunks) {
        const embedding = await getEmbedding(chunk);
        documentsToAdd.push({
            id: crypto.randomUUID(), 
            loreEntryId: entry.id,
            projectId,
            title: entry.title,
            content: chunk,
            embedding,
            timestamp: Date.now()
        });
    }

    if (documentsToAdd.length > 0) {
        await db.addBulk(STORE_NAME, documentsToAdd);
    }
};

export const deleteDocumentsByLoreEntryId = async (loreEntryId: string, projectId: string): Promise<void> => {
    const allDocsInProject = await db.getAll<VectorDocument>(STORE_NAME, 'projectId', projectId);
    const docsToDelete = allDocsInProject.filter(doc => doc.loreEntryId === loreEntryId);
    
    for (const doc of docsToDelete) {
        await db.delete(STORE_NAME, doc.id);
    }
};

export const clearProjectDocuments = async (projectId: string): Promise<void> => {
    const allDocsInProject = await db.getAll<VectorDocument>(STORE_NAME, 'projectId', projectId);
    for (const doc of allDocsInProject) {
        await db.delete(STORE_NAME, doc.id);
    }
};

// Removed apiKey from params
export const searchDocuments = async (projectId: string, query: string, limit: number = 5): Promise<LoreEntry[]> => {
    const queryEmbedding = await getEmbedding(query);
    const allDocsInProject = await db.getAll<VectorDocument>(STORE_NAME, 'projectId', projectId);

    const scoredDocs = allDocsInProject.map(doc => ({
        ...doc,
        score: cosineSimilarity(queryEmbedding, doc.embedding)
    }));

    const RELEVANCE_THRESHOLD = 0.6;
    const filteredAndSortedDocs = scoredDocs
        .filter(doc => doc.score > RELEVANCE_THRESHOLD)
        .sort((a, b) => b.score - a.score);

    const uniqueTitles = new Set<string>();
    const results: LoreEntry[] = [];
    for (const doc of filteredAndSortedDocs) {
        if (!uniqueTitles.has(doc.title)) {
            results.push({
                id: doc.loreEntryId, 
                projectId: doc.projectId, 
                title: doc.title,
                content: doc.content,
                ragDocumentId: doc.id 
            });
            uniqueTitles.add(doc.title);
            if (results.length >= limit) break;
        }
    }
    
    return results;
};

export const getAllDocuments = async (projectId: string): Promise<LoreEntry[]> => {
    const allDocs = await db.getAll<VectorDocument>(STORE_NAME, 'projectId', projectId);
    
    const loreMap = new Map<string, { id: string, projectId: string, title: string, contentChunks: string[], ragDocumentIds: string[] }>();

    for (const doc of allDocs) {
        const originalLoreId = doc.loreEntryId;
        if (!loreMap.has(originalLoreId)) {
            loreMap.set(originalLoreId, { 
                id: originalLoreId,
                projectId: doc.projectId, 
                title: doc.title, 
                contentChunks: [], 
                ragDocumentIds: [] 
            });
        }
        loreMap.get(originalLoreId)?.contentChunks.push(doc.content);
        loreMap.get(originalLoreId)?.ragDocumentIds.push(doc.id);
    }

    return Array.from(loreMap.values()).map(entry => ({
        id: entry.id, 
        projectId: entry.projectId, 
        title: entry.title,
        content: entry.contentChunks.join('\n\n'), 
        ragDocumentId: entry.ragDocumentIds.join(',') 
    }));
};

export const clearAllLocalRAG = async (): Promise<void> => {
    if (confirm("Are you sure you want to completely purge the local RAG knowledge base across all projects? This cannot be undone.")) {
        await db.clear(STORE_NAME);
        console.log("Local RAG Knowledge Base Purged.");
    }
};
