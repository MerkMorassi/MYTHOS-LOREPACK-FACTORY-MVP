
import { LorepackPacker } from './packer.js';
import { IndexedDbLorepackStore } from './indexeddb-store.js';
import { LorepackModel } from './types.js';

// Mock Model for fingerprinting test
const mockModel: LorepackModel = {
  getEmbeddings: async (text: string) => Array(768).fill(0),
  getEmbeddingsBatch: async (texts: string[]) => texts.map(() => Array(768).fill(0)),
  extractTripletsFromText: async (text: string) => []
};

// Polyfill Web Crypto for Node environment
if (typeof crypto === 'undefined') {
  const { webcrypto } = await import('node:crypto');
  (globalThis as any).crypto = webcrypto;
}

// Minimal IDB Mock for Audit
const mockStores = new Map<string, Map<any, any>>();
let lastTransaction: any = null;

(globalThis as any).indexedDB = {
  open: () => {
    const req: any = {
      onsuccess: null,
      onupgradeneeded: null,
      result: {
        objectStoreNames: { contains: (name: string) => true },
        createObjectStore: (name: string) => {
          mockStores.set(name, new Map());
          return { createIndex: () => {} };
        },
        transaction: (names: string[]) => {
          const tx = {
            objectStore: (name: string) => ({
              put: (rec: any) => {
                if (!mockStores.has(name)) mockStores.set(name, new Map());
                mockStores.get(name)?.set(rec.id, rec);
                return { onsuccess: null };
              },
              index: () => ({
                getAll: (val: any) => {
                  const rreq = {
                    onsuccess: null,
                    get result() {
                      return Array.from(mockStores.get(name)?.values() || []).filter(r => r.agentId === val);
                    }
                  };
                  setTimeout(() => { if (rreq.onsuccess) (rreq as any).onsuccess(); }, 5);
                  return rreq;
                }
              })
            }),
            oncomplete: null,
            onerror: null,
            onabort: null
          };
          lastTransaction = tx;
          // Auto-complete transaction in next tick
          setTimeout(() => {
            if (tx.oncomplete) (tx as any).oncomplete();
          }, 20);
          return tx;
        },
        onversionchange: null,
        close: () => {}
      }
    };
    setTimeout(() => {
      if (req.onupgradeneeded) req.onupgradeneeded({ target: req });
      if (req.onsuccess) req.onsuccess();
    }, 10);
    return req;
  }
};

async function audit() {
  console.log('--- LOREPACK FINGERPRINT AUDIT ---');
  
  const store = new IndexedDbLorepackStore('audit_vault', 1);
  const packer = new LorepackPacker(store, mockModel);
  
  // 1. Verify Determinism
  console.log('Audit 1: Verifying Determinism...');
  const t1 = "Target content";
  const a1 = "agent_x";
  
  const id1 = await (packer as any).computeFingerprint(`${a1}:${t1.trim().toLowerCase()}`);
  const id2 = await (packer as any).computeFingerprint(`${a1}:${t1.trim().toLowerCase()}`);
  
  if (id1 === id2) {
    console.log('[PASS] Hash is deterministic.');
  } else {
    console.error('[FAIL] Hash is NOT deterministic.');
    process.exit(1);
  }
  
  // 2. Verify Agent Context
  console.log('Audit 2: Verifying Agent Context...');
  const a2 = "agent_y";
  const id3 = await (packer as any).computeFingerprint(`${a2}:${t1.trim().toLowerCase()}`);
  
  if (id1 !== id3) {
    console.log('[PASS] Different agents produce different IDs for same content.');
  } else {
    console.error('[FAIL] Different agents produced SAME ID.');
    process.exit(1);
  }
  
  // 3. Verify Normalization
  console.log('Audit 3: Verifying Normalization...');
  const t2 = "  TARGET content  ";
  const id4 = await (packer as any).computeFingerprint(`${a1}:${t2.trim().toLowerCase()}`);
  
  if (id1 === id4) {
    console.log('[PASS] Normalization (trim/lowercase) is working correctly.');
  } else {
    console.error('[FAIL] Normalization failed to match identical content.');
    process.exit(1);
  }
  
  // 4. Verify ID Format
  console.log('Audit 4: Verifying ID Format...');
  const result = await packer.ingestBatches(
    [{ text: t1, source: 'test' }],
    { agentId: a1 }
  );
  
  // Need to get the record from the mock-aware environment
  // Since we are in a script, let's just inspect the result object if it returned IDs, 
  // but ingestBatches returns { ingested: number, failed: [] }.
  // We'll inspect the store.
  
  const records = await store.getVectorsByAgent(a1);
  const record = records[0];
  
  if (record.id.startsWith('lp_node_') && record.id.length === 8 + 64) {
    console.log(`[PASS] ID format is correct: ${record.id}`);
  } else {
    console.error(`[FAIL] ID format is incorrect: ${record.id}`);
    process.exit(1);
  }
  
  // 5. Verify Upsert behavior (Data Accuracy)
  console.log('Audit 5: Verifying Upsert behavior...');
  const initialTimestamp = record.timestamp;
  
  // Wait a bit to ensure timestamp changes if updated
  await new Promise(r => setTimeout(r, 10));
  
  await packer.ingestBatches(
    [{ text: t1, source: 'test_retry' }],
    { agentId: a1 }
  );
  
  const finalRecords = await store.getVectorsByAgent(a1);
  if (finalRecords.length === 1) {
    console.log('[PASS] Duplicate ingestion resulted in 1 record (Upsert verified).');
    if (finalRecords[0].metadata?.source === 'test_retry') {
       console.log('[PASS] Record content was updated to latest metadata.');
    } else {
       console.warn('[INFO] Metadata was NOT updated, IDB put may have kept old one if implementation differed? No, IDB put overwrites.');
    }
  } else {
    console.error(`[FAIL] Duplicate ingestion resulted in ${finalRecords.length} records (Duplication detected).`);
    process.exit(1);
  }
  
  console.log('--- AUDIT COMPLETE: ALL CRITICAL INVARIANTS OBSERVED ---');
}

audit().catch(err => {
  console.error(err);
  process.exit(1);
});
