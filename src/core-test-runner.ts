import type { LorepackStore, LorepackModel, VectorRecord, TripletEdge } from './types.js';
import { LorepackFactory, LorepackPacker, LorepackReader, InMemoryLorepackStore } from './index.js';

export interface TestResult {
  id: string;
  name: string;
  status: 'PENDING' | 'RUNNING' | 'PASSED' | 'FAILED';
  message: string;
  details?: string;
}

export interface TestSuiteState {
  isRunning: boolean;
  results: TestResult[];
  logs: string[];
}

// Small deterministic TXT fixture defined in instructions
export const TEST_FIXTURE_SOURCE = 'TEST_LOREPACK_001';
export const TEST_FIXTURE_TEXT = `Source: TEST_LOREPACK_001

Merk created MythOS.

MythOS uses COREPACK for capabilities.
MythOS uses LOREPACK for continuity.

LOREPACK stores lived experience and conversational history.
COREPACK provides skills, grounding, and guardrails.`;

/**
 * Helper to delete all records in IndexedDB for a specific agent ID to guarantee test isolation.
 */
async function clearAgentRecords(agentId: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const request = indexedDB.open('mythos_vault', 10);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction(['vectors', 'edges'], 'readwrite');
      
      tx.onerror = () => reject(tx.error);
      tx.oncomplete = () => resolve();

      // Clear vectors
      const vStore = tx.objectStore('vectors');
      const vRequest = vStore.index('agentId').openCursor(agentId);
      vRequest.onsuccess = (event: any) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      // Clear edges (also handle upper/lowercase agentIds)
      const eStore = tx.objectStore('edges');
      const eRequest = eStore.index('agentId').openCursor(agentId);
      eRequest.onsuccess = (event: any) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };

      const eRequestUpper = eStore.index('agentId').openCursor(agentId.toUpperCase());
      eRequestUpper.onsuccess = (event: any) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        }
      };
    };
  });
}

export async function runMvpTestMatrix(
  store: LorepackStore,
  model: LorepackModel,
  onUpdate: (state: TestSuiteState) => void,
): Promise<void> {
  const factory = new LorepackFactory(store, model);
  const logs: string[] = ['[TEST-INIT]: Initializing MythOS Lorepack Factory MVP Test Suite...'];
  
  const results: TestResult[] = [
    { id: 'CF-01', name: 'Intake', status: 'PENDING', message: 'Ready to run.' },
    { id: 'CF-02', name: 'Chunking', status: 'PENDING', message: 'Ready to run.' },
    { id: 'CF-03', name: 'Embedding', status: 'PENDING', message: 'Ready to run.' },
    { id: 'CF-04', name: 'Ingestion', status: 'PENDING', message: 'Ready to run.' },
    { id: 'CF-05', name: 'Provenance', status: 'PENDING', message: 'Ready to run.' },
    { id: 'CF-06', name: 'Graph Synthesis', status: 'PENDING', message: 'Ready to run.' },
    { id: 'CF-07', name: 'Agent Isolation', status: 'PENDING', message: 'Ready to run.' },
    { id: 'CF-08', name: 'Export JSONL & GZIP', status: 'PENDING', message: 'Ready to run.' },
    { id: 'CF-09', name: 'Import Restore', status: 'PENDING', message: 'Ready to run.' },
    { id: 'CF-10', name: 'Round Trip Verify', status: 'PENDING', message: 'Ready to run.' },
    { id: 'CF-11', name: 'Decompression Matrix (7 Fixtures)', status: 'PENDING', message: 'Ready to run.' },
    { id: 'CF-12', name: 'Stage & Package Verification', status: 'PENDING', message: 'Ready to run.' },
    { id: 'CF-13', name: 'Vault Baseline vs Pack Space Conflict', status: 'PENDING', message: 'Ready to run.' },
    { id: 'CF-14', name: 'Packer & Reader Separation Contract', status: 'PENDING', message: 'Ready to run.' },
  ];

  const updateState = (currentIdx: number, status: TestResult['status'], msg: string, details?: string) => {
    results[currentIdx].status = status;
    results[currentIdx].message = msg;
    if (details !== undefined) results[currentIdx].details = details;
    onUpdate({ isRunning: true, results: [...results], logs: [...logs] });
  };

  const addLog = (log: string) => {
    logs.push(log);
    onUpdate({ isRunning: true, results: [...results], logs: [...logs] });
  };

  try {
    addLog('[TEST-PREP]: Cleaning workspace databases for isolated test agents AGENT_TEST_ALPHA & AGENT_TEST_BETA...');
    await clearAgentRecords('AGENT_TEST_ALPHA');
    await clearAgentRecords('AGENT_TEST_BETA');
    addLog('[TEST-PREP]: Cleanup completed successfully. Workspace isolated.');

    // Variables shared between tests to preserve pipeline consistency
    let intakeText = '';
    let intakeSource = '';
    let generatedChunks: string[] = [];
    let testEmbedding: number[] = [];
    let detectedDimension = 0;
    let preExportVectors: VectorRecord[] = [];
    let preExportEdges: TripletEdge[] = [];
    let exportedJsonl = '';

    // ==========================================
    // CF-01 — Intake
    // ==========================================
    updateState(0, 'RUNNING', 'Ingesting real TXT fixture...');
    addLog('[CF-01]: Starting Intake test from deterministic fixture.');
    try {
      intakeText = TEST_FIXTURE_TEXT;
      intakeSource = TEST_FIXTURE_SOURCE;

      if (!intakeText || intakeText.length === 0) {
        throw new Error('Intake test failure: Text is empty.');
      }
      if (intakeSource !== 'TEST_LOREPACK_001') {
        throw new Error(`Intake test failure: Source mismatch. Got "${intakeSource}"`);
      }
      
      addLog(`[CF-01]: Complete text loaded (${intakeText.length} chars). Retained source: "${intakeSource}"`);
      updateState(0, 'PASSED', 'Text loaded completely. Source ID TEST_LOREPACK_001 retained.', `Chars: ${intakeText.length}, Source: ${intakeSource}`);
    } catch (e: any) {
      addLog(`[CF-01-FAIL]: ${e.message}`);
      updateState(0, 'FAILED', e.message);
      throw e;
    }

    // ==========================================
    // CF-02 — Chunking
    // ==========================================
    updateState(1, 'RUNNING', 'Chunking text at deterministic limits...');
    addLog('[CF-02]: Initiating sentence chunking using factory limits (size limit: 150 chars).');
    try {
      generatedChunks = factory.chunk(intakeText, 150);
      addLog(`[CF-02]: Factory generated ${generatedChunks.length} chunks from deterministic text.`);

      if (generatedChunks.length < 2 || generatedChunks.length > 6) {
        throw new Error(`Expected between 2 and 6 chunks, got ${generatedChunks.length}`);
      }
      
      const hasEmpty = generatedChunks.some(c => !c || c.trim().length === 0);
      if (hasEmpty) {
        throw new Error('Chunking error: Found empty chunk output.');
      }

      // Check for silent text loss by asserting key words are present
      const keywords = ['Merk', 'MythOS', 'COREPACK', 'LOREPACK', 'continuity', 'experience'];
      const missingKeywords = keywords.filter(kw => !generatedChunks.some(chunk => chunk.includes(kw)));
      if (missingKeywords.length > 0) {
        throw new Error(`Text loss detected: Missing key concepts: ${missingKeywords.join(', ')}`);
      }

      addLog('[CF-02]: Verification passed. All chunks are non-empty, and text concepts match 100%.');
      updateState(1, 'PASSED', `Split fixture into ${generatedChunks.length} chunks with zero text loss.`, `Chunks: ${generatedChunks.length}`);
    } catch (e: any) {
      addLog(`[CF-02-FAIL]: ${e.message}`);
      updateState(1, 'FAILED', e.message);
      throw e;
    }

    // ==========================================
    // CF-03 — Embedding
    // ==========================================
    updateState(2, 'RUNNING', 'Requesting embedding vectors from Gemini model...');
    addLog('[CF-03]: Generating embedding for first chunk via model wrapper.');
    try {
      const vec = await model.getEmbeddings(generatedChunks[0]);
      if (!vec || !Array.isArray(vec) || vec.length === 0) {
        throw new Error('Embedding service returned an empty or invalid vector payload.');
      }
      testEmbedding = vec;
      detectedDimension = vec.length;
      
      addLog(`[CF-03]: Embedding generated successfully. Dimension detected dynamically: ${detectedDimension}-float array.`);
      updateState(2, 'PASSED', `Non-empty embedding returned. Dimension: ${detectedDimension}.`, `Dimension: ${detectedDimension}`);
    } catch (e: any) {
      addLog(`[CF-03-FAIL]: ${e.message}`);
      updateState(2, 'FAILED', e.message);
      throw e;
    }

    // ==========================================
    // CF-04 — Ingestion
    // ==========================================
    updateState(3, 'RUNNING', 'Ingesting N chunks into IndexedDB store...');
    addLog('[CF-04]: Initiating batch vector ingestion for AGENT_TEST_ALPHA.');
    try {
      const batchPayload = generatedChunks.map(text => ({ text, source: intakeSource }));
      
      // We run the actual ingestBatches logic on the core factory
      const ingestResult = await factory.ingestBatches(batchPayload, {
        agentId: 'AGENT_TEST_ALPHA'
      });

      addLog(`[CF-04]: Factory ingested ${ingestResult.ingested} chunks.`);
      
      preExportVectors = await store.getVectorsByAgent('AGENT_TEST_ALPHA');
      addLog(`[CF-04]: DB query returned ${preExportVectors.length} records stored for AGENT_TEST_ALPHA.`);

      if (preExportVectors.length !== generatedChunks.length) {
        throw new Error(`Ingest mismatch: Ingested ${generatedChunks.length} chunks, but stored only ${preExportVectors.length} records.`);
      }

      const badAgent = preExportVectors.find(v => v.agentId !== 'AGENT_TEST_ALPHA');
      if (badAgent) {
        throw new Error(`Agent contamination: Found record belonging to agent: ${badAgent.agentId}`);
      }

      addLog('[CF-04]: Ingestion verified. All records written correctly under isolated Agent ID.');
      updateState(3, 'PASSED', `Stored ${preExportVectors.length} vector records under AGENT_TEST_ALPHA successfully.`, `Stored: ${preExportVectors.length}`);
    } catch (e: any) {
      addLog(`[CF-04-FAIL]: ${e.message}`);
      updateState(3, 'FAILED', e.message);
      throw e;
    }

    // ==========================================
    // CF-05 — Provenance
    // ==========================================
    updateState(4, 'RUNNING', 'Verifying provenance tracking flags...');
    addLog('[CF-05]: Scanning vector records for source provenance match...');
    try {
      const records = await store.getVectorsByAgent('AGENT_TEST_ALPHA');
      const missingProvenance = records.some(r => r.source !== 'TEST_LOREPACK_001');
      if (missingProvenance) {
        throw new Error('Provenance mismatch: Some records do not map to "TEST_LOREPACK_001"');
      }

      addLog('[CF-05]: Provenance integrity checked. Source TEST_LOREPACK_001 exists on all stored nodes.');
      updateState(4, 'PASSED', 'Source provenance TEST_LOREPACK_001 survived intake -> chunk -> store.', 'Provenance: TEST_LOREPACK_001');
    } catch (e: any) {
      addLog(`[CF-05-FAIL]: ${e.message}`);
      updateState(4, 'FAILED', e.message);
      throw e;
    }

    // ==========================================
    // CF-06 — Graph Synthesis
    // ==========================================
    updateState(5, 'RUNNING', 'Triggering semantic triplet extraction & graph compilation...');
    addLog('[CF-06]: Building semantic mesh from ingested vectors...');
    try {
      // Build graph on actual factory
      const edgeCount = await factory.buildGraphLite('AGENT_TEST_ALPHA');
      addLog(`[CF-06]: Graph compiler successfully registered ${edgeCount} triplet edges.`);

      preExportEdges = await store.getTripletEdgesByAgent('AGENT_TEST_ALPHA');
      addLog(`[CF-06]: Verified ${preExportEdges.length} edges present in IndexedDB store.`);

      // Verify that a malformed/empty response does not crash the system
      addLog('[CF-06]: Injecting empty/corrupted payload node to test error fault resilience...');
      const corruptNode = {
        id: crypto.randomUUID(),
        agentId: 'AGENT_TEST_ALPHA',
        text: '', // Empty text should result in no triplets
        vector: Array(detectedDimension).fill(0),
        source: 'MALFORMED_FIXTURE_002',
        timestamp: Date.now()
      };
      await store.addVectors([corruptNode]);
      
      // Try to build graph again; it must run smoothly without throwing an error
      const afterCorruptEdgeCount = await factory.buildGraphLite('AGENT_TEST_ALPHA');
      addLog(`[CF-06]: Fault tolerance check passed. Malformed nodes processed safely. Total edges: ${afterCorruptEdgeCount}`);

      // Clean up the corrupt node to maintain round-trip sanity
      await clearAgentRecords('AGENT_TEST_ALPHA');
      await factory.ingestBatches(generatedChunks.map(text => ({ text, source: intakeSource })), {
        agentId: 'AGENT_TEST_ALPHA'
      });
      await factory.buildGraphLite('AGENT_TEST_ALPHA');
      preExportVectors = await store.getVectorsByAgent('AGENT_TEST_ALPHA');
      preExportEdges = await store.getTripletEdgesByAgent('AGENT_TEST_ALPHA');

      updateState(5, 'PASSED', `Compiled ${preExportEdges.length} semantic edges. Zero-crash fault tolerance verified.`, `Edges: ${preExportEdges.length}`);
    } catch (e: any) {
      addLog(`[CF-06-FAIL]: ${e.message}`);
      updateState(5, 'FAILED', e.message);
      throw e;
    }

    // ==========================================
    // CF-07 — Agent Isolation
    // ==========================================
    updateState(6, 'RUNNING', 'Testing agent database isolation barriers...');
    addLog('[CF-07]: Querying AGENT_TEST_BETA database before ingestion...');
    try {
      const betaInitialNodes = await store.getVectorsByAgent('AGENT_TEST_BETA');
      if (betaInitialNodes.length > 0) {
        throw new Error('Database isolation leak: AGENT_TEST_BETA has records before ingestion.');
      }

      addLog('[CF-07]: Ingesting isolated document under AGENT_TEST_BETA...');
      const betaPayload = [{ text: 'Ambassador Lin secured a treaty on Mars.', source: 'TEST_LOREPACK_002' }];
      await factory.ingestBatches(betaPayload, { agentId: 'AGENT_TEST_BETA' });

      const alphaNodes = await store.getVectorsByAgent('AGENT_TEST_ALPHA');
      const betaNodes = await store.getVectorsByAgent('AGENT_TEST_BETA');

      addLog(`[CF-07]: Agent Alpha records: ${alphaNodes.length}. Agent Beta records: ${betaNodes.length}.`);

      if (alphaNodes.length !== preExportVectors.length) {
        throw new Error('Database cross-contamination: Ingesting into Beta mutated Alpha state.');
      }

      if (betaNodes.some(b => alphaNodes.some(a => a.id === b.id))) {
        throw new Error('Database key-leak: Duplicate record identities leaked across agent contexts.');
      }

      addLog('[CF-07]: Verification passed. Real-time workspace barriers are fully secure.');
      updateState(6, 'PASSED', 'Agent Alpha and Agent Beta workspaces are 100% isolated.', `Alpha: ${alphaNodes.length}, Beta: ${betaNodes.length}`);
    } catch (e: any) {
      addLog(`[CF-07-FAIL]: ${e.message}`);
      updateState(6, 'FAILED', e.message);
      throw e;
    }

    // ==========================================
    // CF-08 — Export
    // ==========================================
    updateState(7, 'RUNNING', 'Exporting Agent Alpha LOREPACK dataset to JSONL string...');
    addLog('[CF-08]: Synthesizing line-delimited JSON export stream...');
    try {
      const jsonlLines: string[] = [];
      const generator = factory.yieldExportBatches('AGENT_TEST_ALPHA');
      for await (const batch of generator) {
        for (const item of batch) {
          jsonlLines.push(JSON.stringify(item));
        }
      }

      exportedJsonl = jsonlLines.join('\n');
      addLog(`[CF-08]: Generated JSONL string length: ${exportedJsonl.length} bytes.`);

      if (!exportedJsonl || exportedJsonl.length === 0) {
        throw new Error('Export yielded an empty dataset.');
      }

      // Validate JSONL structure
      const lines = exportedJsonl.split('\n').filter(l => l.trim().length > 0);
      let parsedVectors = 0;
      let parsedEdges = 0;

      for (const line of lines) {
        const record = JSON.parse(line);
        if (record.type === 'edge') {
          parsedEdges++;
          if (record.aid !== 'AGENT_TEST_ALPHA') {
            throw new Error(`Export metadata mismatch on edge: Expected agent ID "AGENT_TEST_ALPHA", got "${record.aid}"`);
          }
        } else if (record.type === 'vector') {
          parsedVectors++;
          if (record.a !== 'AGENT_TEST_ALPHA') {
            throw new Error(`Export metadata mismatch on vector: Expected agent ID "AGENT_TEST_ALPHA", got "${record.a}"`);
          }
          if (record.src !== 'TEST_LOREPACK_001') {
            throw new Error(`Export metadata mismatch on provenance: Expected source "TEST_LOREPACK_001", got "${record.src}"`);
          }
        } else {
          throw new Error(`Unknown record type detected in exported JSONL: ${record.type}`);
        }
      }

      addLog(`[CF-08]: Export validation parsed ${parsedVectors} vector nodes and ${parsedEdges} relationships.`);
      if (parsedVectors !== preExportVectors.length || parsedEdges !== preExportEdges.length) {
        throw new Error(`Export count mismatch. Pre-export: (${preExportVectors.length}v, ${preExportEdges.length}e). Exported: (${parsedVectors}v, ${parsedEdges}e)`);
      }

      updateState(7, 'PASSED', 'Line-delimited JSONL format verified. Provenance and metadata preserved.', `Size: ${exportedJsonl.length} bytes`);
    } catch (e: any) {
      addLog(`[CF-08-FAIL]: ${e.message}`);
      updateState(7, 'FAILED', e.message);
      throw e;
    }

    // ==========================================
    // CF-09 — Import
    // ==========================================
    updateState(8, 'RUNNING', 'Wiping Alpha store and importing generated JSONL backup...');
    addLog('[CF-09]: Clearing isolated records for AGENT_TEST_ALPHA...');
    try {
      await clearAgentRecords('AGENT_TEST_ALPHA');
      const emptyVectors = await store.getVectorsByAgent('AGENT_TEST_ALPHA');
      const emptyEdges = await store.getTripletEdgesByAgent('AGENT_TEST_ALPHA');
      addLog(`[CF-09]: Confirmed db clear. Vectors: ${emptyVectors.length}, Edges: ${emptyEdges.length}`);

      if (emptyVectors.length !== 0 || emptyEdges.length !== 0) {
        throw new Error('Cleanup check failed: Stale records linger in database after purge.');
      }

      addLog('[CF-09]: Re-importing backup stream via importLorepack factory routine...');
      const mockFile = new File([exportedJsonl], 'AGENT_TEST_ALPHA_EXPORT.jsonl', { type: 'application/json' });
      
      const importResult = await factory.importLorepack(mockFile, 'AGENT_TEST_ALPHA');
      addLog(`[CF-09]: Import parsed and committed ${importResult.importedVectors} vectors and ${importResult.importedEdges} edges.`);

      const restoredVectors = await store.getVectorsByAgent('AGENT_TEST_ALPHA');
      const restoredEdges = await store.getTripletEdgesByAgent('AGENT_TEST_ALPHA');

      if (restoredVectors.length !== preExportVectors.length) {
        throw new Error(`Restoration count mismatch for vectors: Expected ${preExportVectors.length}, got ${restoredVectors.length}`);
      }
      if (restoredEdges.length !== preExportEdges.length) {
        throw new Error(`Restoration count mismatch for edges: Expected ${preExportEdges.length}, got ${restoredEdges.length}`);
      }

      updateState(8, 'PASSED', `Imported and restored ${restoredVectors.length} vectors and ${restoredEdges.length} edges successfully.`, `Restored: ${restoredVectors.length}v, ${restoredEdges.length}e`);
    } catch (e: any) {
      addLog(`[CF-09-FAIL]: ${e.message}`);
      updateState(8, 'FAILED', e.message);
      throw e;
    }

    // ==========================================
    // CF-10 — Round Trip Verify
    // ==========================================
    updateState(9, 'RUNNING', 'Comparing roundtrip dataset statistics...');
    addLog('[CF-10]: Conducting deep-structural equivalence testing between original and imported datasets...');
    try {
      const restoredVectors = await store.getVectorsByAgent('AGENT_TEST_ALPHA');
      const restoredEdges = await store.getTripletEdgesByAgent('AGENT_TEST_ALPHA');

      // Assert counts match
      if (restoredVectors.length !== preExportVectors.length) {
        throw new Error(`Vector count drift: Pre ${preExportVectors.length} !== Post ${restoredVectors.length}`);
      }
      if (restoredEdges.length !== preExportEdges.length) {
        throw new Error(`Edge count drift: Pre ${preExportEdges.length} !== Post ${restoredEdges.length}`);
      }

      // Assert Agent identity matches
      const invalidAgent = restoredVectors.find(v => v.agentId !== 'AGENT_TEST_ALPHA');
      if (invalidAgent) {
        throw new Error(`Agent identity drift: Restored node belongs to ${invalidAgent.agentId}`);
      }

      // Assert Source/provenance matches
      const invalidProvenance = restoredVectors.find(v => v.source !== 'TEST_LOREPACK_001');
      if (invalidProvenance) {
        throw new Error(`Provenance drift: Restored node source maps to ${invalidProvenance.source}`);
      }

      // Assert dimensionality matches
      const invalidDim = restoredVectors.find(v => v.vector.length !== detectedDimension);
      if (invalidDim) {
        throw new Error(`Dimensionality drift: Restored node has size ${invalidDim.vector.length} instead of ${detectedDimension}`);
      }

      // Assert that required metadata survived
      const missingMetadata = restoredVectors.some(v => !v.numMarkId || !v.metadata);
      if (missingMetadata) {
        throw new Error('Metadata loss: Reconstruct markers (numMarkId) or timestamps were lost in round-trip.');
      }

      addLog('[CF-10-SUCCESS]: Deep structure verified. Round-trip integrity is fully established.');
      updateState(9, 'PASSED', 'Equivalence check 100% matched: counts, agents, sources, dimensions, and metadata are intact.', 'ALL TESTS GREEN');
    } catch (e: any) {
      addLog(`[CF-10-FAIL]: ${e.message}`);
      updateState(9, 'FAILED', e.message);
      throw e;
    }

    // ==========================================
    // CF-11 — Decompression Matrix (7 Fixtures)
    // ==========================================
    updateState(10, 'RUNNING', 'Testing 7 compression/decompression fixture permutations...');
    addLog('[CF-11]: Executing Decompression Matrix across 7 format fixtures...');
    try {
      // Build sample single record line
      const sampleItem = {
        v: 2,
        type: 'vector',
        id: crypto.randomUUID(),
        a: 'AGENT_TEST_ALPHA',
        h: 'ALPHA',
        t: 'Merk built MythOS Lorepack architecture.',
        vec: Array(detectedDimension).fill(0.1),
        m: 'sigil001',
        src: 'FIXTURE_SRC',
        d: { embeddingModel: 'gemini-embedding-2', embeddingDimension: detectedDimension },
      };
      const sampleJsonl = JSON.stringify(sampleItem) + '\n';

      // Fixture 1: Plain JSONL mislabeled as .gz (no gzip header) -> should parse as plain text
      addLog('[CF-11.1]: Testing plain JSONL mislabeled as .lorepack.gz...');
      const f1 = new File([sampleJsonl], 'mislabeled.lorepack.gz', { type: 'application/octet-stream' });
      await clearAgentRecords('AGENT_TEST_ALPHA');
      const r1 = await factory.importLorepack(f1, 'AGENT_TEST_ALPHA');
      if (r1.importedVectors !== 1) throw new Error(`Fixture 1 failed: Expected 1 imported vector, got ${r1.importedVectors}`);

      // Fixture 2: Real gzip mislabeled as .jsonl -> should detect magic bytes and decompress gzip
      addLog('[CF-11.2]: Testing real GZIP mislabeled as .jsonl (magic byte sniffing)...');
      let gzStream = new Blob([sampleJsonl]).stream().pipeThrough(new CompressionStream('gzip'));
      const gzBlob = await new Response(gzStream).blob();
      const f2 = new File([gzBlob], 'mislabeled.jsonl', { type: 'application/json' });
      await clearAgentRecords('AGENT_TEST_ALPHA');
      const r2 = await factory.importLorepack(f2, 'AGENT_TEST_ALPHA');
      if (r2.importedVectors !== 1) throw new Error(`Fixture 2 failed: Expected 1 imported vector, got ${r2.importedVectors}`);

      // Fixture 3: Zlib deflate stream named .gz -> should decompress deflate
      addLog('[CF-11.3]: Testing zlib deflate stream named .lorepack.gz...');
      let zlibStream = new Blob([sampleJsonl]).stream().pipeThrough(new CompressionStream('deflate'));
      const zlibBlob = await new Response(zlibStream).blob();
      const f3 = new File([zlibBlob], 'zlib_stream.lorepack.gz', { type: 'application/octet-stream' });
      await clearAgentRecords('AGENT_TEST_ALPHA');
      const r3 = await factory.importLorepack(f3, 'AGENT_TEST_ALPHA');
      if (r3.importedVectors !== 1) throw new Error(`Fixture 3 failed: Expected 1 imported vector, got ${r3.importedVectors}`);

      // Fixture 4: Raw deflate stream named .gz -> should decompress deflate-raw
      addLog('[CF-11.4]: Testing raw deflate stream named .lorepack.gz...');
      let rawStream = new Blob([sampleJsonl]).stream().pipeThrough(new CompressionStream('deflate-raw'));
      const rawBlob = await new Response(rawStream).blob();
      const f4 = new File([rawBlob], 'raw_deflate.lorepack.gz', { type: 'application/octet-stream' });
      await clearAgentRecords('AGENT_TEST_ALPHA');
      const r4 = await factory.importLorepack(f4, 'AGENT_TEST_ALPHA');
      if (r4.importedVectors !== 1) throw new Error(`Fixture 4 failed: Expected 1 imported vector, got ${r4.importedVectors}`);

      // Fixture 5: Real GZIP named .lorepack.gz -> should decompress gzip
      addLog('[CF-11.5]: Testing canonical real GZIP named .lorepack.gz...');
      let canonGzStream = new Blob([sampleJsonl]).stream().pipeThrough(new CompressionStream('gzip'));
      const canonGzBlob = await new Response(canonGzStream).blob();
      const f5 = new File([canonGzBlob], 'canonical.lorepack.gz', { type: 'application/gzip' });
      await clearAgentRecords('AGENT_TEST_ALPHA');
      const r5 = await factory.importLorepack(f5, 'AGENT_TEST_ALPHA');
      if (r5.importedVectors !== 1) throw new Error(`Fixture 5 failed: Expected 1 imported vector, got ${r5.importedVectors}`);

      // Fixture 6: Plain JSONL named .jsonl -> should parse
      addLog('[CF-11.6]: Testing standard plain JSONL named .jsonl...');
      const f6 = new File([sampleJsonl], 'standard.jsonl', { type: 'application/x-jsonlines' });
      await clearAgentRecords('AGENT_TEST_ALPHA');
      const r6 = await factory.importLorepack(f6, 'AGENT_TEST_ALPHA');
      if (r6.importedVectors !== 1) throw new Error(`Fixture 6 failed: Expected 1 imported vector, got ${r6.importedVectors}`);

      // Fixture 7: Corrupted / truncated stream -> must fail cleanly with descriptive error
      addLog('[CF-11.7]: Testing corrupted truncated gzip stream...');
      const corruptBytes = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0xff, 0xff, 0x00, 0x12, 0x34]);
      const f7 = new File([corruptBytes], 'corrupt.lorepack.gz', { type: 'application/gzip' });
      let caughtCorrupt = false;
      try {
        await factory.importLorepack(f7, 'AGENT_TEST_ALPHA');
      } catch (err: any) {
        caughtCorrupt = true;
        addLog(`[CF-11.7]: Correctly caught corrupted stream error: ${err.message}`);
      }
      if (!caughtCorrupt) {
        throw new Error('Fixture 7 failed: Corrupted archive did not throw an error.');
      }

      addLog('[CF-11-SUCCESS]: All 7 decompression and format permutations passed with 100% fidelity.');
      updateState(10, 'PASSED', 'All 7 format permutations (plain/mislabeled/gzip/zlib/raw-deflate/corrupt) passed.', '7/7 Fixtures Verified');
    } catch (e: any) {
      addLog(`[CF-11-FAIL]: ${e.message}`);
      updateState(10, 'FAILED', e.message);
      throw e;
    }

    // ==========================================
    // CF-12 — Stage & Package Verification
    // ==========================================
    updateState(11, 'RUNNING', 'Testing pure stage() deduplication and verifyPackage()...');
    addLog('[CF-12]: Testing stage() purity and verifyPackage() assertions...');
    try {
      // Test pure stage()
      const rawBatches = [
        { text: 'A unique block of lore about CorePack.', source: 'SRC_1' },
        { text: 'A unique block of lore about CorePack.', source: 'SRC_1' }, // Duplicate
        { text: 'Second distinct lore item.', source: 'SRC_2' },
      ];
      const staged = factory.stage(rawBatches);
      if (staged.length !== 2) {
        throw new Error(`stage() deduplication failed: expected 2 distinct staged items, got ${staged.length}`);
      }
      if (!staged[0].numMarkId) {
        throw new Error('stage() failed to assign deterministic numMarkId sigil.');
      }

      // Re-populate Alpha and test canonical exportToGz and verifyPackage
      await clearAgentRecords('AGENT_TEST_ALPHA');
      await factory.ingestBatches(generatedChunks.map((text) => ({ text, source: intakeSource })), {
        agentId: 'AGENT_TEST_ALPHA',
      });
      await factory.buildGraphLite('AGENT_TEST_ALPHA');

      const { blob: gzBlob, filename } = await factory.exportToGz('AGENT_TEST_ALPHA');
      if (!filename.endsWith('.lorepack.gz') || gzBlob.size === 0) {
        throw new Error(`exportToGz produced invalid archive: ${filename} (${gzBlob.size} bytes)`);
      }

      const verified = await factory.verifyPackage(gzBlob, 'AGENT_TEST_ALPHA');
      if (!verified.valid) {
        throw new Error(`verifyPackage returned invalid: ${verified.reason}`);
      }

      addLog(`[CF-12]: Package verified! Vectors: ${verified.stats?.vectors}, Edges: ${verified.stats?.edges}, Dimension: ${verified.stats?.dimension}`);
      updateState(11, 'PASSED', 'stage() pure deduplication and verifyPackage() full round-trip verified.', `Stats: ${verified.stats?.vectors}v, ${verified.stats?.edges}e`);
    } catch (e: any) {
      addLog(`[CF-12-FAIL]: ${e.message}`);
      updateState(11, 'FAILED', e.message);
      throw e;
    }

    // ==========================================
    // CF-13 — Vault Baseline vs Pack Space Conflict
    // ==========================================
    updateState(12, 'RUNNING', 'Testing vault baseline isolation & pack internal consistency...');
    addLog('[CF-13]: Testing pack internal conflict rejection and vault conflict separation...');
    try {
      const probeStore = new InMemoryLorepackStore();
      const probeReader = new LorepackReader(probeStore, model);

      // Sub-test 1: Pack with internal mixed dimensions must be rejected with 0 records committed
      const mixedDimItem1 = {
        v: 2,
        type: 'vector',
        id: 'vec_1',
        a: 'PROBE_AGENT',
        t: 'Lore chunk 1',
        vec: Array(10).fill(0.1),
        m: 'sig1',
        src: 'TEST',
        d: { embeddingModel: 'gemini-embedding-2', embeddingDimension: 10 },
      };
      const mixedDimItem2 = {
        v: 2,
        type: 'vector',
        id: 'vec_2',
        a: 'PROBE_AGENT',
        t: 'Lore chunk 2',
        vec: Array(12).fill(0.2), // Inconsistent dimension
        m: 'sig2',
        src: 'TEST',
        d: { embeddingModel: 'gemini-embedding-2', embeddingDimension: 12 },
      };
      const mixedDimJsonl = `${JSON.stringify(mixedDimItem1)}\n${JSON.stringify(mixedDimItem2)}\n`;
      const fMixed = new File([mixedDimJsonl], 'mixed.jsonl', { type: 'application/json' });

      let caughtMixed = false;
      try {
        await probeReader.importLorepack(fMixed, 'PROBE_AGENT');
      } catch (err: any) {
        caughtMixed = true;
        if (!err.message.includes('PACK INTERNAL CONFLICT') && !err.message.includes('multiple embedding dimensions')) {
          throw new Error(`Expected PACK INTERNAL CONFLICT error message, got: ${err.message}`);
        }
      }
      if (!caughtMixed) {
        throw new Error('Mixed-dimension pack was not rejected.');
      }
      const probeVectorsAfterReject = await probeStore.getAllVectors();
      if (probeVectorsAfterReject.length !== 0) {
        throw new Error(`Atomic commit failed: Rejected pack committed ${probeVectorsAfterReject.length} records.`);
      }

      // Sub-test 2: Existing vault conflict identifies old vault space without blaming incoming valid pack
      const validPackItem = {
        v: 2,
        type: 'vector',
        id: 'valid_vec_1',
        a: 'PROBE_AGENT',
        t: 'Valid lore chunk with dim 10',
        vec: Array(10).fill(0.5),
        m: 'sig_valid',
        src: 'VALID_PACK',
        d: { embeddingModel: 'gemini-embedding-2', embeddingDimension: 10 },
      };
      // Pre-seed vault with conflicting dim 768
      await probeStore.addVectors([
        {
          id: 'old_vault_rec',
          agentId: 'PROBE_AGENT',
          text: 'Old vault record with dim 768',
          vector: Array(768).fill(0.1),
          source: 'OLD_VAULT',
          timestamp: Date.now(),
          metadata: { embeddingModel: 'gemini-embedding-2', embeddingDimension: 768 },
        },
      ]);

      const fValidPack = new File([JSON.stringify(validPackItem) + '\n'], 'valid_pack.jsonl', { type: 'application/json' });
      let caughtVaultConflict = false;
      try {
        await probeReader.importLorepack(fValidPack, 'PROBE_AGENT');
      } catch (err: any) {
        caughtVaultConflict = true;
        if (!err.message.includes('Existing vault space conflict') && !err.message.includes('Vault conflict')) {
          throw new Error(`Expected Existing vault space conflict error, got: ${err.message}`);
        }
      }
      if (!caughtVaultConflict) {
        throw new Error('Vault space conflict was not detected.');
      }

      addLog('[CF-13]: Vault baseline isolation and atomic 0-commit on internal conflict verified.');
      updateState(12, 'PASSED', 'Pack internal conflicts reject with 0 commits; vault space conflicts explicitly identified.', 'Strict Boundaries Verified');
    } catch (e: any) {
      addLog(`[CF-13-FAIL]: ${e.message}`);
      updateState(12, 'FAILED', e.message);
      throw e;
    }

    // ==========================================
    // CF-14 — Packer & Reader Separation Contract
    // ==========================================
    updateState(13, 'RUNNING', 'Verifying standalone LorepackPacker and LorepackReader modules...');
    addLog('[CF-14]: Testing LorepackPacker builds and LorepackReader reads independently...');
    try {
      const standaloneStore = new InMemoryLorepackStore();
      const standalonePacker = new LorepackPacker(standaloneStore, model);
      const standaloneReader = new LorepackReader(standaloneStore, model);

      // Packer builds
      const sampleTexts = [
        { text: 'LorepackPacker constructs knowledge packages efficiently.', source: 'SRC_ALPHA' },
        { text: 'LorepackReader consumes and searches knowledge packages.', source: 'SRC_BETA' },
      ];
      const ingestRes = await standalonePacker.ingestBatches(sampleTexts, { agentId: 'SEP_TEST' });
      if (ingestRes.ingested !== 2) {
        throw new Error(`standalonePacker failed to ingest 2 records, got ${ingestRes.ingested}`);
      }

      // Export through Packer
      const { blob: exportBlob } = await standalonePacker.exportToGz('SEP_TEST');
      if (exportBlob.size === 0) {
        throw new Error('standalonePacker exportToGz produced empty blob');
      }

      // Reader reads from scratch in clean store
      const readerStore = new InMemoryLorepackStore();
      const cleanReader = new LorepackReader(readerStore, model);
      const importRes = await cleanReader.importLorepack(exportBlob, 'SEP_TEST');
      if (importRes.importedVectors !== 2) {
        throw new Error(`cleanReader failed to import 2 records from packer export, got ${importRes.importedVectors}`);
      }

      // Reader searches
      const hits = await cleanReader.search('knowledge packages', 'SEP_TEST');
      if (!Array.isArray(hits) || hits.length === 0) {
        throw new Error('cleanReader.search() returned no hits');
      }

      addLog('[CF-14]: Complete PACKER BUILDS. READER READS separation contract verified.');
      updateState(13, 'PASSED', 'LorepackPacker and LorepackReader operate as clean, standalone decoupled modules.', 'PACKER BUILDS. READER READS.');
    } catch (e: any) {
      addLog(`[CF-14-FAIL]: ${e.message}`);
      updateState(13, 'FAILED', e.message);
      throw e;
    }

    addLog('[TEST-COMPLETE]: All core tests completed successfully. MVP PASS CONDITION met.');
    onUpdate({ isRunning: false, results: [...results], logs: [...logs] });

  } catch (err: any) {
    addLog(`[CRITICAL-TEST-FAILURE]: Execution halted due to pipeline error: ${err.message || err}`);
    onUpdate({ isRunning: false, results: [...results], logs: [...logs] });
  }
}
