const VECTOR_STORE = 'vectors';
const EDGE_STORE = 'edges';
export class IndexedDbLorepackStore {
    databaseName;
    databaseVersion;
    database = null;
    constructor(databaseName = 'mythos_lorepack', databaseVersion = 1) {
        this.databaseName = databaseName;
        this.databaseVersion = databaseVersion;
    }
    async addVectors(vectors) {
        await this.writeMany(VECTOR_STORE, vectors.filter((vector) => Array.isArray(vector.vector)));
    }
    async getVectorsByAgent(agentId) {
        return this.readByAgent(VECTOR_STORE, agentId);
    }
    async getAllVectors() {
        return this.readAll(VECTOR_STORE);
    }
    async addTripletEdges(edges) {
        await this.writeMany(EDGE_STORE, edges);
    }
    async getTripletEdgesByAgent(agentId) {
        return this.readByAgent(EDGE_STORE, agentId);
    }
    async getAllTripletEdges() {
        return this.readAll(EDGE_STORE);
    }
    async open() {
        if (this.database)
            return this.database;
        this.database = await new Promise((resolve, reject) => {
            const request = indexedDB.open(this.databaseName, this.databaseVersion);
            request.onupgradeneeded = () => {
                const database = request.result;
                for (const name of [VECTOR_STORE, EDGE_STORE]) {
                    const store = database.objectStoreNames.contains(name)
                        ? request.transaction.objectStore(name)
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
    async writeMany(storeName, records) {
        if (records.length === 0)
            return;
        const database = await this.open();
        await new Promise((resolve, reject) => {
            const transaction = database.transaction(storeName, 'readwrite');
            const store = transaction.objectStore(storeName);
            records.forEach((record) => store.put(record));
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        });
    }
    async readAll(storeName) {
        const database = await this.open();
        return new Promise((resolve, reject) => {
            const request = database.transaction(storeName, 'readonly').objectStore(storeName).getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
    async readByAgent(storeName, agentId) {
        const database = await this.open();
        return new Promise((resolve, reject) => {
            const request = database
                .transaction(storeName, 'readonly')
                .objectStore(storeName)
                .index('agentId')
                .getAll(agentId);
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    }
}
