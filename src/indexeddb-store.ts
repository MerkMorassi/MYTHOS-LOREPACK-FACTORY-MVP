import type { LorepackStore, TripletEdge, VectorRecord } from './types.js';

const VECTOR_STORE = 'vectors';
const EDGE_STORE = 'edges';

export class IndexedDbLorepackStore implements LorepackStore {
  private database: IDBDatabase | null = null;

  constructor(
    private readonly databaseName = 'mythos_vault',
    private readonly databaseVersion = 10,
  ) {}

  async addVectors(vectors: VectorRecord[]): Promise<void> {
    await this.writeMany(VECTOR_STORE, vectors.filter((vector) => Array.isArray(vector.vector)));
  }

  async getVectorsByAgent(agentId: string): Promise<VectorRecord[]> {
    return this.readByAgent<VectorRecord>(VECTOR_STORE, agentId);
  }

  async getAllVectors(): Promise<VectorRecord[]> {
    return this.readAll<VectorRecord>(VECTOR_STORE);
  }

  async addTripletEdges(edges: TripletEdge[]): Promise<void> {
    await this.writeMany(EDGE_STORE, edges);
  }

  async getTripletEdgesByAgent(agentId: string): Promise<TripletEdge[]> {
    return this.readByAgent<TripletEdge>(EDGE_STORE, agentId.toUpperCase());
  }

  async getAllTripletEdges(): Promise<TripletEdge[]> {
    return this.readAll<TripletEdge>(EDGE_STORE);
  }

  private async open(): Promise<IDBDatabase> {
    if (this.database) return this.database;

    this.database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, this.databaseVersion);
      request.onupgradeneeded = (e: any) => {
        const database = request.result;
        const tx = request.transaction;

        if (!database.objectStoreNames.contains(VECTOR_STORE)) {
          const store = database.createObjectStore(VECTOR_STORE, { keyPath: 'id' });
          store.createIndex('agentId', 'agentId', { unique: false });
          store.createIndex('numMarkId', 'numMarkId', { unique: false });
        } else if (tx) {
          const store = tx.objectStore(VECTOR_STORE);
          if (!store.indexNames.contains('agentId')) {
            store.createIndex('agentId', 'agentId', { unique: false });
          }
          if (!store.indexNames.contains('numMarkId')) {
            store.createIndex('numMarkId', 'numMarkId', { unique: false });
          }
        }

        if (!database.objectStoreNames.contains(EDGE_STORE)) {
          const store = database.createObjectStore(EDGE_STORE, { keyPath: 'id' });
          store.createIndex('agentId', 'agentId', { unique: false });
          store.createIndex('sourceId', 'sourceId', { unique: false });
          store.createIndex('type', 'type', { unique: false });
        } else if (tx) {
          const store = tx.objectStore(EDGE_STORE);
          if (!store.indexNames.contains('agentId')) {
            store.createIndex('agentId', 'agentId', { unique: false });
          }
          if (!store.indexNames.contains('sourceId')) {
            store.createIndex('sourceId', 'sourceId', { unique: false });
          }
          if (!store.indexNames.contains('type')) {
            store.createIndex('type', 'type', { unique: false });
          }
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => {
          try {
            db.close();
          } catch (_) {}
          this.database = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error);
    });

    return this.database;
  }

  private async writeMany<T>(storeName: string, records: T[]): Promise<void> {
    if (records.length === 0) return;
    const database = await this.open();
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(storeName, 'readwrite');
      const store = transaction.objectStore(storeName);
      records.forEach((record) => store.put(record));
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  }

  private async readAll<T>(storeName: string): Promise<T[]> {
    const database = await this.open();
    return new Promise<T[]>((resolve, reject) => {
      const request = database.transaction(storeName, 'readonly').objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
  }

  private async readByAgent<T>(storeName: string, agentId: string): Promise<T[]> {
    const database = await this.open();
    return new Promise<T[]>((resolve, reject) => {
      const request = database
        .transaction(storeName, 'readonly')
        .objectStore(storeName)
        .index('agentId')
        .getAll(agentId);
      request.onsuccess = () => resolve(request.result as T[]);
      request.onerror = () => reject(request.error);
    });
  }

  async addRecordsAtomic(vectors: VectorRecord[], edges: TripletEdge[]): Promise<void> {
    const database = await this.open();
    return new Promise<void>((resolve, reject) => {
      const transaction = database.transaction([VECTOR_STORE, EDGE_STORE], 'readwrite');
      const vectorStore = transaction.objectStore(VECTOR_STORE);
      const edgeStore = transaction.objectStore(EDGE_STORE);

      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('Atomic IndexedDB write failed.'));
      transaction.onabort = () => reject(transaction.error || new Error('Atomic IndexedDB write aborted.'));

      for (const vector of vectors) {
        if (Array.isArray(vector.vector)) {
          vectorStore.put(vector);
        }
      }

      for (const edge of edges) {
        edgeStore.put(edge);
      }
    });
  }

  async clearAgent(agentId: string): Promise<{ vectors: number; edges: number }> {
    // 1. Normalize/validate the agent ID
    if (!agentId || typeof agentId !== 'string' || !agentId.trim()) {
      throw new Error('Invalid agent ID: agent ID must be a non-empty string.');
    }
    const normalizedAgentId = agentId.trim();
    const targetAgentIds = Array.from(new Set([
      normalizedAgentId,
      normalizedAgentId.toUpperCase(),
      normalizedAgentId.toLowerCase(),
    ]));

    // 2. Open mythos_vault using the current schema/version
    const database = await this.open();

    // 3. Start ONE readwrite transaction covering BOTH vectors and edges
    return new Promise<{ vectors: number; edges: number }>((resolve, reject) => {
      let transaction: IDBTransaction;
      try {
        transaction = database.transaction([VECTOR_STORE, EDGE_STORE], 'readwrite');
      } catch (err) {
        return reject(err);
      }

      const vectorStore = transaction.objectStore(VECTOR_STORE);
      const edgeStore = transaction.objectStore(EDGE_STORE);

      let deletedVectors = 0;
      let deletedEdges = 0;
      const seenVectorIds = new Set<string>();
      const seenEdgeIds = new Set<string>();

      // 6. Commit atomically & 8. Return useful summary
      transaction.oncomplete = () => {
        resolve({ vectors: deletedVectors, edges: deletedEdges });
      };

      // 7. Reject on transaction error/abort
      transaction.onerror = () => {
        reject(transaction.error || new Error('Clear agent transaction failed.'));
      };
      transaction.onabort = () => {
        reject(transaction.error || new Error('Clear agent transaction aborted.'));
      };

      // 4. Delete every vector belonging to that agent
      const vIndex = vectorStore.index('agentId');
      for (const target of targetAgentIds) {
        const vReq = vIndex.openCursor(target);
        vReq.onsuccess = (event: any) => {
          const cursor = event.target.result;
          if (cursor) {
            const val = cursor.value;
            const primaryKey = cursor.primaryKey || (val && val.id);
            if (primaryKey && !seenVectorIds.has(String(primaryKey))) {
              seenVectorIds.add(String(primaryKey));
              deletedVectors++;
              cursor.delete();
            }
            cursor.continue();
          }
        };
      }

      // 5. Delete every relationship edge belonging to that agent
      const eIndex = edgeStore.index('agentId');
      for (const target of targetAgentIds) {
        const eReq = eIndex.openCursor(target);
        eReq.onsuccess = (event: any) => {
          const cursor = event.target.result;
          if (cursor) {
            const val = cursor.value;
            const primaryKey = cursor.primaryKey || (val && val.id);
            if (primaryKey && !seenEdgeIds.has(String(primaryKey))) {
              seenEdgeIds.add(String(primaryKey));
              deletedEdges++;
              cursor.delete();
            }
            cursor.continue();
          }
        };
      }
    });
  }

  async nukeStore(): Promise<void> {
    // 1. Wipe stores directly if connection is open
    try {
      if (this.database) {
        const db = this.database;
        const storeNames = Array.from(db.objectStoreNames);
        if (storeNames.length > 0) {
          await new Promise<void>((res) => {
            try {
              const tx = db.transaction(storeNames, 'readwrite');
              storeNames.forEach((s) => {
                try {
                  tx.objectStore(s).clear();
                } catch (_) {}
              });
              tx.oncomplete = () => res();
              tx.onerror = () => res();
              tx.onabort = () => res();
            } catch (_) {
              res();
            }
          });
        }
      }
    } catch (_) {}

    // 2. Explicitly close active database connection
    if (this.database) {
      try {
        this.database.close();
      } catch (_) {}
      this.database = null;
    }

    // 3. Delete database file
    return new Promise<void>((resolve, reject) => {
      let resolved = false;
      const request = indexedDB.deleteDatabase(this.databaseName);
      
      request.onsuccess = () => {
        this.database = null;
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };
      
      request.onerror = () => {
        this.database = null;
        if (!resolved) {
          resolved = true;
          resolve();
        }
      };

      request.onblocked = () => {
        if (this.database) {
          try {
            this.database.close();
          } catch (_) {}
          this.database = null;
        }
        setTimeout(() => {
          if (!resolved) {
            resolved = true;
            resolve();
          }
        }, 100);
      };

      // Failsafe timeout
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.database = null;
          resolve();
        }
      }, 800);
    });
  }
}

