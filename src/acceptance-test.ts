import * as fs from 'fs';
import * as path from 'path';
import { IndexedDbLorepackStore } from './indexeddb-store.ts';
import { GeminiProvider } from './providers/gemini-provider.ts';
import { LorepackFactory } from './lorepack-factory.ts';
import { runMvpTestMatrix, TestSuiteState } from './core-test-runner.ts';
import type { VectorRecord, TripletEdge } from './types.ts';

// ==========================================
// MOCK IMPLEMENTATIONS FOR THE NODE ENVIRONMENT
// ==========================================

class MockRequest {
  result: any;
  error: any = null;
  onupgradeneeded: ((ev: any) => void) | null = null;
  onsuccess: ((ev?: any) => void) | null = null;
  onerror: ((ev?: any) => void) | null = null;
  transaction: any = null;
}

class MockDB {
  constructor(
    public state: { version: number; stores: Map<string, Map<any, any>> },
    public openRequest: any
  ) {}

  get objectStoreNames() {
    return {
      contains: (name: string) => this.state.stores.has(name)
    };
  }

  createObjectStore(name: string, options?: any) {
    if (!this.state.stores.has(name)) {
      this.state.stores.set(name, new Map());
    }
    return new MockObjectStore(this.state.stores.get(name)!, options?.keyPath || 'id');
  }

  transaction(storeNames: string | string[], mode: string) {
    const transaction = new MockTransaction(
      this.state.stores,
      Array.isArray(storeNames) ? storeNames : [storeNames]
    );
    if (this.openRequest) {
      this.openRequest.transaction = transaction;
    }
    return transaction;
  }

  close() {}
}

class MockTransaction {
  error: any = null;
  oncomplete: (() => void) | null = null;
  onerror: ((err: any) => void) | null = null;
  onabort: (() => void) | null = null;
  private active = true;
  public pending = 0;

  constructor(
    private storesState: Map<string, Map<any, any>>,
    private storeNames: string[]
  ) {
    const checkDone = () => {
      if (!this.active) return;
      if (this.pending <= 0) {
        if (this.oncomplete) this.oncomplete();
      } else {
        setTimeout(checkDone, 2);
      }
    };
    setTimeout(checkDone, 5);
  }

  objectStore(name: string) {
    const rawMap = this.storesState.get(name);
    if (!rawMap) {
      throw new Error(`Store ${name} does not exist in mock DB.`);
    }
    return new MockObjectStore(rawMap, name === 'vectors' ? 'id' : 'id', this);
  }

  abort() {
    this.active = false;
    if (this.onabort) this.onabort();
  }
}

class MockObjectStore {
  constructor(
    public map: Map<any, any>,
    public keyPath: string,
    public transaction?: MockTransaction
  ) {}

  createIndex() {
    return {};
  }

  get indexNames() {
    return {
      contains: (name: string) => true
    };
  }

  put(record: any) {
    const key = record[this.keyPath];
    this.map.set(key, JSON.parse(JSON.stringify(record))); // Deep copy
    const req = new MockRequest();
    req.result = key;
    if (this.transaction) this.transaction.pending++;
    setTimeout(() => {
      if (this.transaction) this.transaction.pending--;
      if (req.onsuccess) req.onsuccess();
    }, 1);
    return req;
  }

  delete(key: any) {
    this.map.delete(key);
    const req = new MockRequest();
    if (this.transaction) this.transaction.pending++;
    setTimeout(() => {
      if (this.transaction) this.transaction.pending--;
      if (req.onsuccess) req.onsuccess();
    }, 1);
    return req;
  }

  getAll() {
    const req = new MockRequest();
    req.result = Array.from(this.map.values());
    if (this.transaction) this.transaction.pending++;
    setTimeout(() => {
      if (this.transaction) this.transaction.pending--;
      if (req.onsuccess) req.onsuccess();
    }, 1);
    return req;
  }

  index(indexName: string) {
    return {
      getAll: (val: any) => {
        const req = new MockRequest();
        const allRecs = Array.from(this.map.values());
        req.result = allRecs.filter((r) => {
          const recVal = r[indexName];
          if (typeof recVal === 'string' && typeof val === 'string') {
            return recVal.toUpperCase() === val.toUpperCase();
          }
          return recVal === val;
        });
        if (this.transaction) this.transaction.pending++;
        setTimeout(() => {
          if (this.transaction) this.transaction.pending--;
          if (req.onsuccess) req.onsuccess();
        }, 1);
        return req;
      },
      openCursor: (val: any) => {
        const req = new MockRequest();
        const allRecs = Array.from(this.map.values());
        const filtered = allRecs.filter((r) => {
          const recVal = r[indexName];
          if (typeof recVal === 'string' && typeof val === 'string') {
            return recVal.toUpperCase() === val.toUpperCase();
          }
          return recVal === val;
        });

        let idx = 0;
        if (this.transaction) this.transaction.pending++;
        const advance = () => {
          if (idx < filtered.length) {
            const currentRecord = filtered[idx];
            const cursor = {
              primaryKey: currentRecord[this.keyPath],
              value: currentRecord,
              delete: () => {
                this.map.delete(currentRecord[this.keyPath]);
                const delReq = new MockRequest();
                if (this.transaction) this.transaction.pending++;
                setTimeout(() => {
                  if (this.transaction) this.transaction.pending--;
                  if (delReq.onsuccess) delReq.onsuccess();
                }, 1);
                return delReq;
              },
              continue: () => {
                idx++;
                advance();
              }
            };
            req.result = cursor;
            if (req.onsuccess) req.onsuccess({ target: req });
          } else {
            if (this.transaction) this.transaction.pending--;
            req.result = null;
            if (req.onsuccess) req.onsuccess({ target: req });
          }
        };

        setTimeout(() => {
          advance();
        }, 1);

        return req;
      }
    };
  }
}

class MockIndexedDB {
  databases = new Map<string, { version: number; stores: Map<string, Map<any, any>> }>();

  open(name: string, version: number) {
    const request = new MockRequest();
    setTimeout(() => {
      let dbState = this.databases.get(name);
      if (!dbState) {
        dbState = { version: 0, stores: new Map() };
        this.databases.set(name, dbState);
      }

      const db = new MockDB(dbState, request);
      request.result = db;

      if (dbState.version !== version) {
        dbState.version = version;
        if (request.onupgradeneeded) {
          request.onupgradeneeded({ target: request });
        }
      }

      if (request.onsuccess) {
        request.onsuccess();
      }
    }, 1);
    return request;
  }

  deleteDatabase(name: string) {
    const request = new MockRequest();
    setTimeout(() => {
      this.databases.delete(name);
      if (request.onsuccess) {
        request.onsuccess();
      }
    }, 1);
    return request;
  }
}

// Instantiate Global Mock IndexedDB
const mockIndexedDBInstance = new MockIndexedDB();
(globalThis as any).indexedDB = mockIndexedDBInstance;

// Simple Node-friendly Polyfill for File & streams
class MockFile {
  name: string;
  constructor(private contents: string, name: string) {
    this.name = name;
  }
  stream() {
    const text = this.contents;
    return new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      }
    });
  }
}
(globalThis as any).File = MockFile;

// Global Mock Fetch Call Tracker
const fetchedUrls: string[] = [];
(globalThis as any).fetch = async (url: string, init?: any) => {
  fetchedUrls.push(url);

  // Health API
  if (url.includes('/api/health')) {
    return {
      ok: true,
      status: 200,
      json: async () => ({ status: 'ok', time: new Date().toISOString() })
    };
  }

  // Embed Request (Direct Google API or Fallback /api/lorepack/embed)
  if (url.includes('embedContent') || url.includes('/api/lorepack/embed')) {
    const isDirectGoogle = url.includes('embedContent');
    return {
      ok: true,
      status: 200,
      json: async () => ({
        embedding: isDirectGoogle 
          ? { values: Array(768).fill(0.123) } 
          : Array(768).fill(0.123)
      })
    };
  }

  // Batch Embed Request
  if (url.includes('/batchEmbedContents')) {
    const payload = JSON.parse(init.body);
    const length = payload.requests?.length || 1;
    return {
      ok: true,
      status: 200,
      json: async () => ({
        embeddings: Array(length).fill({ values: Array(768).fill(0.123) })
      })
    };
  }

  // Generate Triplet / Text Requests
  if (url.includes('/generateContent') || url.includes('/api/lorepack/triplets') || url.includes('/api/lorepack/generate')) {
    const textPrompt = init?.body ? String(init.body) : '';
    
    // Extract triplets requested
    if (textPrompt.includes('extract') || textPrompt.includes('Relation') || url.includes('/triplets')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          candidates: [{
            content: {
              parts: [{
                text: JSON.stringify([
                  { s: 'Merk', r: 'created', o: 'MythOS' },
                  { s: 'MythOS', r: 'uses', o: 'COREPACK' }
                ])
              }]
            }
          }],
          triplets: [
            { s: 'Merk', r: 'created', o: 'MythOS' },
            { s: 'MythOS', r: 'uses', o: 'COREPACK' }
          ]
        })
      };
    }

    // Default chat text generation
    return {
      ok: true,
      status: 200,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{ text: 'This is a mock response from Gemini.' }]
          }
        }],
        text: 'This is a mock response from Gemini.'
      })
    };
  }

  throw new Error(`Unhandled mock fetch for: ${url}`);
};

// Colors for beautiful terminal output
const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const RESET = '\x1b[0m';

// Helper to assert conditions
function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(msg);
  }
}

// ==========================================
// ACCEPTANCE TEST EXECUTION MATRIX
// ==========================================

async function main() {
  console.log(`${BLUE}================================================================${RESET}`);
  console.log(`${YELLOW}         MYTHOS VAULT LOREPACK FACTORY - ACCEPTANCE TEST        ${RESET}`);
  console.log(`${BLUE}================================================================${RESET}\n`);

  let passedAll = true;

  const scorecard: Record<string, 'PASS' | 'FAIL'> = {
    'PURGE AGENT': 'FAIL',
    'NUKE VAULT': 'FAIL',
    'AGENT ISOLATION': 'FAIL',
    'ATOMIC FAILURE': 'FAIL',
    'PERSISTENCE': 'FAIL',
    'CF-01': 'FAIL',
    'CF-02': 'FAIL',
    'CF-03': 'FAIL',
    'CF-04': 'FAIL',
    'CF-05': 'FAIL',
    'CF-06': 'FAIL',
    'CF-07': 'FAIL',
    'CF-08': 'FAIL',
    'CF-09': 'FAIL',
    'CF-10': 'FAIL',
  };

  // Initialize store, model, and factory
  const store = new IndexedDbLorepackStore();
  const provider = new GeminiProvider();
  const factory = new LorepackFactory(store, provider);

  // 1. VERIFY COMPLETE RUNTIME LIFECYCLE
  try {
    console.log(`${YELLOW}▶ RUNNING LIFECYCLE: Import -> Chunk -> Embed -> Persist -> Query -> Export${RESET}`);
    await store.nukeStore();

    // Intake/Chunk
    const mockText = 'Merk created MythOS. MythOS uses COREPACK for skills.';
    const chunks = factory.chunk(mockText, 45);
    assert(chunks.length === 2, `Expected 2 chunks, got ${chunks.length}`);

    // Ingest
    const ingestResult = await factory.ingestBatches(
      chunks.map((t) => ({ text: t, source: 'LIFECYCLE_SRC' })),
      { agentId: 'AGENT_LIFECYCLE' }
    );
    assert(ingestResult.ingested === 2, `Expected 2 ingested, got ${ingestResult.ingested}`);

    // Validate Store records
    const storedVectors = await store.getVectorsByAgent('AGENT_LIFECYCLE');
    assert(storedVectors.length === 2, `Stored vectors should be 2, got ${storedVectors.length}`);
    assert(storedVectors[0].vector.length === 768, `Embedding length should be 768`);

    // Graph compiler/Edges
    const compiledEdges = await factory.buildGraphLite('AGENT_LIFECYCLE');
    assert(compiledEdges > 0, `Expected semantic edges to be compiled, got ${compiledEdges}`);

    const storedEdges = await store.getTripletEdgesByAgent('AGENT_LIFECYCLE');
    assert(storedEdges.length === compiledEdges, 'Stored edges do not match compiled edges count');

    // Query/Search Chat
    const chatResult = await factory.chat('Who created MythOS?', 'AGENT_LIFECYCLE');
    assert(chatResult.response.length > 0, 'Expected non-empty response');
    assert(chatResult.derivation === 'COSINE_TOPK(6)', `Expected cosine retrieval, got ${chatResult.derivation}`);

    // Export Verification
    const exportGenerator = factory.yieldExportBatches('AGENT_LIFECYCLE');
    const exportedItems: any[] = [];
    for await (const batch of exportGenerator) {
      exportedItems.push(...batch);
    }
    // 2 vectors + compiled edges
    assert(exportedItems.length === 2 + compiledEdges, `Expected ${2 + compiledEdges} exported items`);

    // Reload / Re-import / Persistence Verify
    await store.clearAgent('AGENT_LIFECYCLE');
    const emptyCheck = await store.getVectorsByAgent('AGENT_LIFECYCLE');
    assert(emptyCheck.length === 0, 'Clean failed during reload prep');

    const jsonlString = exportedItems.map((item) => JSON.stringify(item)).join('\n');
    const mockImportFile = new MockFile(jsonlString, 'LIFECYCLE_RELOAD.jsonl') as any;

    await factory.importLorepack(mockImportFile, 'AGENT_LIFECYCLE');

    // Confirm stored again and queryable
    const finalVectors = await store.getVectorsByAgent('AGENT_LIFECYCLE');
    assert(finalVectors.length === 2, `Expected 2 restored vectors, got ${finalVectors.length}`);

    const postQuery = await factory.chat('Tell me about Corepack', 'AGENT_LIFECYCLE');
    assert(postQuery.response.includes('Gemini'), 'Query failed on restored data');

    console.log(`  ${GREEN}✔ COMPLETE LIFECYCLE: SUCCESS${RESET}\n`);
  } catch (error: any) {
    passedAll = false;
    console.error(`  ${RED}✘ COMPLETE LIFECYCLE: FAILED - ${error.message}${RESET}\n`);
  }

  // 2. EXPLICIT TEST 1: Atomic failure behavior
  try {
    console.log(`${YELLOW}▶ EXPLICIT TEST 1: Atomic Failure Behavior${RESET}`);
    await store.nukeStore();

    // Insert dummy vectors & edges
    const v1: VectorRecord = {
      id: 'v_atomic_1',
      agentId: 'AGENT_ATOMIC',
      text: 'Atomic test 1',
      vector: Array(768).fill(0.1),
      source: 'TEST',
      timestamp: Date.now()
    };
    const e1: TripletEdge = {
      id: 'e_atomic_1',
      type: 'edge',
      agentId: 'AGENT_ATOMIC',
      sourceId: 'v_atomic_1',
      s: 'A',
      r: 'B',
      o: 'C',
      timestamp: new Date().toISOString()
    };

    // We force transaction failure by temporarily mocking database transaction to abort or reject
    const originalOpen = (store as any).open;
    (store as any).open = async () => {
      const db = await originalOpen.call(store);
      return {
        ...db,
        transaction: () => {
          return {
            objectStore: () => {
              return {
                put: () => {
                  throw new Error('Simulation of unhandled filesystem/database failure');
                },
                delete: () => {
                  throw new Error('Simulation of unhandled delete failure');
                },
                index: () => ({
                  openCursor: () => {
                    const req = new MockRequest();
                    setTimeout(() => {
                      if (req.onerror) req.onerror(new Error('Simulation of index cursor failure'));
                    }, 1);
                    return req;
                  }
                })
              };
            },
            oncomplete: null,
            onerror: null,
            onabort: null,
            abort: () => {}
          };
        }
      };
    };

    let threwError = false;
    try {
      await store.addRecordsAtomic([v1], [e1]);
    } catch (err: any) {
      threwError = true;
      assert(err.message.includes('Simulation of'), `Expected simulated error, got: ${err.message}`);
    }

    assert(threwError, 'Atomic save failed to throw error under write failure');

    // Restore store's open method
    (store as any).open = originalOpen;

    // Verify database remains empty/untouched (no partial writes!)
    const vectors = await store.getVectorsByAgent('AGENT_ATOMIC');
    const edges = await store.getTripletEdgesByAgent('AGENT_ATOMIC');
    assert(vectors.length === 0, `Atomicity failed: Partial vector write stored ${vectors.length} records`);
    assert(edges.length === 0, `Atomicity failed: Partial edge write stored ${edges.length} records`);

    // Test clearAgent atomic failure handling
    await store.addRecordsAtomic([v1], [e1]);
    (store as any).open = async () => {
      const db = await originalOpen.call(store);
      return {
        ...db,
        transaction: () => {
          throw new Error('Simulation of transaction failure during clearAgent');
        }
      };
    };

    let clearFailed = false;
    try {
      await store.clearAgent('AGENT_ATOMIC');
    } catch (err: any) {
      clearFailed = true;
      assert(err.message.includes('Simulation of'), `Expected simulated error on clearAgent, got: ${err.message}`);
    }
    assert(clearFailed, 'clearAgent failed to throw on induced transaction failure');

    // Restore store's open method
    (store as any).open = originalOpen;

    // Verify existing records remain intact because failed transaction never completed
    const vecsAfterFailedClear = await store.getVectorsByAgent('AGENT_ATOMIC');
    const edgesAfterFailedClear = await store.getTripletEdgesByAgent('AGENT_ATOMIC');
    assert(vecsAfterFailedClear.length === 1, 'Data was destroyed despite failed clearAgent transaction');
    assert(edgesAfterFailedClear.length === 1, 'Edge data was destroyed despite failed clearAgent transaction');

    scorecard['ATOMIC FAILURE'] = 'PASS';
    console.log(`  ${GREEN}✔ EXPLICIT TEST 1 (Atomic failure): SUCCESS${RESET}\n`);
  } catch (error: any) {
    passedAll = false;
    console.error(`  ${RED}✘ EXPLICIT TEST 1 (Atomic failure): FAILED - ${error.message}${RESET}\n`);
  }

  // 3. EXPLICIT TEST 2: Deterministic AGENT_SIGMA Purge, AGENT_BETA Isolation & UI Verification
  try {
    console.log(`${YELLOW}▶ EXPLICIT TEST 2: Agent Isolation, Purge & Destructive UI Alignment${RESET}`);
    await store.nukeStore();

    // 1. AGENT_SIGMA has vectors + edges
    const vSigma: VectorRecord = {
      id: 'v_sigma',
      agentId: 'AGENT_SIGMA',
      text: 'Sigma intelligence matrix node',
      vector: Array(768).fill(0.1),
      source: 'SRC_SIGMA',
      timestamp: Date.now()
    };
    const eSigma: TripletEdge = {
      id: 'e_sigma',
      type: 'edge',
      agentId: 'AGENT_SIGMA',
      sourceId: 'v_sigma',
      s: 'Sigma',
      r: 'controls',
      o: 'Matrix',
      timestamp: new Date().toISOString()
    };

    // 2. AGENT_BETA has vectors + edges
    const vBeta: VectorRecord = {
      id: 'v_beta',
      agentId: 'AGENT_BETA',
      text: 'Beta logistics document',
      vector: Array(768).fill(0.2),
      source: 'SRC_BETA',
      timestamp: Date.now()
    };
    const eBeta: TripletEdge = {
      id: 'e_beta',
      type: 'edge',
      agentId: 'AGENT_BETA',
      sourceId: 'v_beta',
      s: 'Beta',
      r: 'supplies',
      o: 'Outpost',
      timestamp: new Date().toISOString()
    };

    await store.addRecordsAtomic([vSigma, vBeta], [eSigma, eBeta]);

    // Verify both are stored initially
    let sigmaVecs = await store.getVectorsByAgent('AGENT_SIGMA');
    let sigmaEdges = await store.getTripletEdgesByAgent('AGENT_SIGMA');
    let betaVecs = await store.getVectorsByAgent('AGENT_BETA');
    let betaEdges = await store.getTripletEdgesByAgent('AGENT_BETA');
    assert(sigmaVecs.length === 1 && sigmaEdges.length === 1, 'AGENT_SIGMA prep ingestion failed');
    assert(betaVecs.length === 1 && betaEdges.length === 1, 'AGENT_BETA prep ingestion failed');

    // 3. clearAgent('AGENT_SIGMA')
    const wipeResult = await store.clearAgent('AGENT_SIGMA');
    assert(wipeResult.vectors === 1, `Expected 1 vector wiped for SIGMA, got ${wipeResult.vectors}`);
    assert(wipeResult.edges === 1, `Expected 1 edge wiped for SIGMA, got ${wipeResult.edges}`);

    // 4. Verify SIGMA vectors = 0
    sigmaVecs = await store.getVectorsByAgent('AGENT_SIGMA');
    assert(sigmaVecs.length === 0, 'SIGMA vector data survived purge');

    // 5. Verify SIGMA edges = 0
    sigmaEdges = await store.getTripletEdgesByAgent('AGENT_SIGMA');
    assert(sigmaEdges.length === 0, 'SIGMA edge data survived purge');

    // 6. Verify BETA vectors and edges are unchanged
    betaVecs = await store.getVectorsByAgent('AGENT_BETA');
    betaEdges = await store.getTripletEdgesByAgent('AGENT_BETA');
    assert(betaVecs.length === 1, 'Beta vector compromised by SIGMA purge');
    assert(betaVecs[0].id === 'v_beta', 'Beta vector key mutated');
    assert(betaEdges.length === 1, 'Beta edge compromised by SIGMA purge');
    assert(betaEdges[0].id === 'e_beta', 'Beta edge key mutated');

    // 8. Verify whole-vault NUKE actually removes the database and can be reopened cleanly
    await store.addRecordsAtomic([vBeta], [eBeta]);
    await store.nukeStore();
    const freshStore = new IndexedDbLorepackStore();
    const vecsAfterNuke = await freshStore.getAllVectors();
    const edgesAfterNuke = await freshStore.getAllTripletEdges();
    assert(vecsAfterNuke.length === 0, 'Vectors survived whole-vault nukeStore');
    assert(edgesAfterNuke.length === 0, 'Edges survived whole-vault nukeStore');
    
    // Reopen and test fresh write
    await freshStore.addRecordsAtomic([vBeta], [eBeta]);
    const betaReopened = await freshStore.getVectorsByAgent('AGENT_BETA');
    assert(betaReopened.length === 1, 'Fresh reopened vault failed to store records after nuke');
    scorecard['NUKE VAULT'] = 'PASS';

    // 9. Verify UI destructive action calls the new persistence-layer operation rather than two independent deletes
    const appTsxContent = fs.readFileSync(path.join(process.cwd(), 'src', 'App.tsx'), 'utf-8');
    assert(!appTsxContent.includes('clearVectors('), 'UI still references legacy clearVectors()');
    assert(!appTsxContent.includes('deleteGraphForAgent('), 'UI still references legacy deleteGraphForAgent()');
    assert(appTsxContent.includes('store.clearAgent('), 'UI does not invoke single transactional store.clearAgent()');

    // Test exact UI scenario text that produced:
    // 'Destructive System Actions
    // Flush all IndexedDB nodes and relationship edge configurations for AGENT_SIGMA.
    // This action is irreversible.'
    assert(appTsxContent.includes('Destructive System Actions'), 'UI missing "Destructive System Actions"');
    assert(appTsxContent.includes('Flush all IndexedDB nodes and relationship edge configurations for'), 'UI missing exact irreversible description');

    scorecard['PURGE AGENT'] = 'PASS';
    scorecard['AGENT ISOLATION'] = 'PASS';
    console.log(`  ${GREEN}✔ EXPLICIT TEST 2 (Agent isolation/wipe & Destructive UI): SUCCESS${RESET}\n`);
  } catch (error: any) {
    passedAll = false;
    console.error(`  ${RED}✘ EXPLICIT TEST 2 (Agent isolation/wipe & Destructive UI): FAILED - ${error.message}${RESET}\n`);
  }

  // 4. EXPLICIT TEST 3: Embedding-dimension mismatch
  try {
    console.log(`${YELLOW}▶ EXPLICIT TEST 3: Embedding Dimension Mismatch Protection${RESET}`);
    await store.nukeStore();

    // Create a scenario where we already have a record with 768 dimensions
    const validRec: VectorRecord = {
      id: 'v_valid_dim',
      agentId: 'AGENT_DIM',
      text: 'Correct dimension',
      vector: Array(768).fill(0.5),
      source: 'SRC_D',
      timestamp: Date.now(),
      metadata: { embeddingDimension: 768 }
    };
    await store.addRecordsAtomic([validRec], []);

    // Create JSONL string with dimension mismatch (length 100)
    const invalidJsonlStr = JSON.stringify({
      v: 2,
      type: 'vector',
      id: 'v_invalid_dim',
      a: 'AGENT_DIM',
      t: 'Incompatible dimension',
      vec: Array(100).fill(0.9), // Mismatch vector!
      d: { embeddingDimension: 100, embeddingModel: 'gemini-embedding-2' }
    });

    const mockFile = new MockFile(invalidJsonlStr, 'mismatch.jsonl') as any;

    let threwError = false;
    try {
      await factory.importLorepack(mockFile, 'AGENT_DIM');
    } catch (err: any) {
      threwError = true;
      assert(err.message.includes('Dimension mismatch') || err.message.includes('dimensionality'), `Unexpected error: ${err.message}`);
    }

    assert(threwError, 'Factory allowed importing of an incompatible embedding dimensionality');

    // Verify it was never written to the store
    const vecs = await store.getVectorsByAgent('AGENT_DIM');
    assert(vecs.length === 1 && vecs[0].id === 'v_valid_dim', 'Incompatible vector was silently written to database');

    console.log(`  ${GREEN}✔ EXPLICIT TEST 3 (Dimension mismatch protection): SUCCESS${RESET}\n`);
  } catch (error: any) {
    passedAll = false;
    console.error(`  ${RED}✘ EXPLICIT TEST 3 (Dimension mismatch protection): FAILED - ${error.message}${RESET}\n`);
  }

  // 5. EXPLICIT TEST 4: Orphan-edge prevention
  try {
    console.log(`${YELLOW}▶ EXPLICIT TEST 4: Orphan-Edge Prevention${RESET}`);
    await store.nukeStore();

    // Create a vector node
    const v: VectorRecord = {
      id: 'v_edge_node',
      agentId: 'AGENT_ORPHAN',
      text: 'Existing node text',
      vector: Array(768).fill(0.123),
      source: 'SRC',
      timestamp: Date.now()
    };

    // Edge referencing a completely nonexistent node
    const eOrphan: TripletEdge = {
      id: 'e_orphan_rel',
      type: 'edge',
      agentId: 'AGENT_ORPHAN',
      sourceId: 'nonexistent_vector_id',
      s: 'Nonexistent',
      r: 'references',
      o: 'Something',
      timestamp: new Date().toISOString()
    };

    await store.addRecordsAtomic([v], [eOrphan]);

    // Attempting export must throw an explicit integrity failure error
    let threwError = false;
    try {
      const generator = factory.yieldExportBatches('AGENT_ORPHAN');
      for await (const batch of generator) {
        // execute iterator
      }
    } catch (err: any) {
      threwError = true;
      assert(err.message.includes('Export integrity failure'), `Unexpected error message: ${err.message}`);
    }

    assert(threwError, 'Exporter failed to reject orphan edge referring to nonexistent node');

    console.log(`  ${GREEN}✔ EXPLICIT TEST 4 (Orphan-edge prevention): SUCCESS${RESET}\n`);
  } catch (error: any) {
    passedAll = false;
    console.error(`  ${RED}✘ EXPLICIT TEST 4 (Orphan-edge prevention): FAILED - ${error.message}${RESET}\n`);
  }

  // 6. EXPLICIT TEST 5: Multi-lane API operation
  try {
    console.log(`${YELLOW}▶ EXPLICIT TEST 5: Multi-Lane Sequential Round-Robin Rotation${RESET}`);
    fetchedUrls.length = 0; // Clear fetched logs

    const keys = ['KEY_LANE_1', 'KEY_LANE_2', 'KEY_LANE_3'];
    provider.setApiKeys(keys);

    // Call embeddings 4 times
    await provider.getEmbeddings('T1');
    await provider.getEmbeddings('T2');
    await provider.getEmbeddings('T3');
    await provider.getEmbeddings('T4');

    assert(fetchedUrls.length === 4, `Expected 4 fetch calls, got ${fetchedUrls.length}`);
    assert(fetchedUrls[0].includes('key=KEY_LANE_1'), `Expected first key KEY_LANE_1, got ${fetchedUrls[0]}`);
    assert(fetchedUrls[1].includes('key=KEY_LANE_2'), `Expected second key KEY_LANE_2, got ${fetchedUrls[1]}`);
    assert(fetchedUrls[2].includes('key=KEY_LANE_3'), `Expected third key KEY_LANE_3, got ${fetchedUrls[2]}`);
    assert(fetchedUrls[3].includes('key=KEY_LANE_1'), `Expected fourth key to wrap around to KEY_LANE_1, got ${fetchedUrls[3]}`);

    console.log(`  ${GREEN}✔ EXPLICIT TEST 5 (Multi-lane operation): SUCCESS${RESET}\n`);
  } catch (error: any) {
    passedAll = false;
    console.error(`  ${RED}✘ EXPLICIT TEST 5 (Multi-lane operation): FAILED - ${error.message}${RESET}\n`);
  }

  // 7. EXPLICIT TEST 6: Proxy fallback
  try {
    console.log(`${YELLOW}▶ EXPLICIT TEST 6: Client-Side Keys Cleared Fallback to Server Proxy${RESET}`);
    fetchedUrls.length = 0;

    provider.setApiKeys([]); // Clear keys

    await provider.getEmbeddings('FallBackText');

    assert(fetchedUrls.length === 1, `Expected 1 fallback fetch, got ${fetchedUrls.length}`);
    assert(fetchedUrls[0] === '/api/lorepack/embed', `Expected call to backend proxy path '/api/lorepack/embed', got: ${fetchedUrls[0]}`);

    console.log(`  ${GREEN}✔ EXPLICIT TEST 6 (Proxy fallback): SUCCESS${RESET}\n`);
  } catch (error: any) {
    passedAll = false;
    console.error(`  ${RED}✘ EXPLICIT TEST 6 (Proxy fallback): FAILED - ${error.message}${RESET}\n`);
  }

  // 8. EXPLICIT TEST 7: Reload & Stored Data Queryability Persistence
  try {
    console.log(`${YELLOW}▶ EXPLICIT TEST 7: Reload & Persistence Continuity${RESET}`);
    await store.nukeStore();

    // Store data under StoreA
    const storeA = new IndexedDbLorepackStore();
    const vRec: VectorRecord = {
      id: 'v_persistence_test',
      agentId: 'AGENT_PERSIST',
      text: 'Persistence verification record',
      vector: Array(768).fill(0.222),
      source: 'SOURCE_PERSIST',
      timestamp: Date.now()
    };
    await storeA.addRecordsAtomic([vRec], []);

    // Create a new independent store instance pointing to the same name (simulates reloading the page/app)
    const storeB = new IndexedDbLorepackStore();
    const finalVecList = await storeB.getVectorsByAgent('AGENT_PERSIST');

    assert(finalVecList.length === 1, 'Stored record was lost between class instances');
    assert(finalVecList[0].text === 'Persistence verification record', 'Stored record text mutated');

    scorecard['PERSISTENCE'] = 'PASS';
    console.log(`  ${GREEN}✔ EXPLICIT TEST 7 (Persistence): SUCCESS${RESET}\n`);
  } catch (error: any) {
    passedAll = false;
    console.error(`  ${RED}✘ EXPLICIT TEST 7 (Persistence): FAILED - ${error.message}${RESET}\n`);
  }

  // 9. REGRESSION: Ensure the existing MVP Test Matrix remains green
  try {
    console.log(`${YELLOW}▶ EXPLICIT TEST 8: Existing MVP Regression Testing Suite${RESET}`);
    
    // Clear custom keys to fall back safely to our mock fetch handler
    provider.setApiKeys([]);

    let testSuiteState: TestSuiteState = { isRunning: true, results: [], logs: [] };
    const mockOnUpdate = (state: TestSuiteState) => {
      testSuiteState = state;
    };

    await runMvpTestMatrix(store, provider, mockOnUpdate);

    // Verify all results ended with 'PASSED'
    const failures = testSuiteState.results.filter((res) => res.status === 'FAILED');
    for (const res of testSuiteState.results) {
      console.log(`    [${res.id}] ${res.name}: ${res.status === 'PASSED' ? GREEN + 'PASSED' : RED + 'FAILED'} - ${res.message}${RESET}`);
      scorecard[res.id] = res.status === 'PASSED' ? 'PASS' : 'FAIL';
    }

    assert(failures.length === 0, `Regression Test Matrix encountered ${failures.length} failure(s)`);

    console.log(`  ${GREEN}✔ REGRESSION (Existing MVP test suite): SUCCESS${RESET}\n`);
  } catch (error: any) {
    passedAll = false;
    console.error(`  ${RED}✘ REGRESSION (Existing MVP test suite): FAILED - ${error.message}${RESET}\n`);
  }

  // Final reporting
  console.log(`${BLUE}================================================================${RESET}`);
  console.log(`${YELLOW}                   FINAL ACCEPTANCE SCORECARD                   ${RESET}`);
  console.log(`${BLUE}================================================================${RESET}`);
  for (const [key, val] of Object.entries(scorecard)) {
    const color = val === 'PASS' ? GREEN : RED;
    console.log(`  ${key.padEnd(20)} : ${color}${val}${RESET}`);
  }
  console.log(`${BLUE}================================================================${RESET}`);

  if (passedAll) {
    console.log(`${GREEN}     ALL TESTS PASSED: THE INTEGRATION IS 100% HEALTHY & ROBUST  ${RESET}`);
    console.log(`${BLUE}================================================================${RESET}\n`);
    process.exit(0);
  } else {
    console.log(`${RED}     ACCEPTANCE TESTS ENCOUNTERED BEHAVIORAL FAILURES            ${RESET}`);
    console.log(`${BLUE}================================================================${RESET}\n`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unhandled critical testing pipeline error:', err);
  process.exit(1);
});
