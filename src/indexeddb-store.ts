import type { LorepackStore, TripletEdge, VectorRecord } from './types.ts';

const VECTOR_STORE = 'vectors';
const EDGE_STORE = 'edges';

export class IndexedDbLorepackStore implements LorepackStore {
  private database: IDBDatabase | null = null;

  constructor(
    private readonly databaseName = 'mythos_lorepack',
    private readonly databaseVersion = 1,
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
    return this.readByAgent<TripletEdge>(EDGE_STORE, agentId);
  }

  async getAllTripletEdges(): Promise<TripletEdge[]> {
    return this.readAll<TripletEdge>(EDGE_STORE);
  }

  private async open(): Promise<IDBDatabase> {
    if (this.database) return this.database;

    this.database = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(this.databaseName, this.databaseVersion);
      request.onupgradeneeded = () => {
        const database = request.result;
        for (const name of [VECTOR_STORE, EDGE_STORE]) {
          const store = database.objectStoreNames.contains(name)
            ? request.transaction!.objectStore(name)
            : database.createObjectStore(name, { keyPath: 'id' });
          if (!store.indexNames.contains('agentId')) {
            store.createIndex('agentId', 'agentId', { unique: false });
          }
        }
      };
      request.onsuccess = () => resolve(request.result);
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
}
