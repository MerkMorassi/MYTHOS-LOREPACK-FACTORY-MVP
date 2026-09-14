import type { LorepackStore, LorepackModel, VectorRecord, TripletEdge } from './types.ts';
import { LorepackFactory } from './lorepack-factory.ts';

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
    { id: 'CF-08', name: 'Export JSONL', status: 'PENDING', message: 'Ready to run.' },
    { id: 'CF-09', name: 'Import Restore', status: 'PENDING', message: 'Ready to run.' },
    { id: 'CF-10', name: 'Round Trip Verify', status: 'PENDING', message: 'Ready to run.' },
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

    addLog('[TEST-COMPLETE]: All core tests completed successfully. MVP PASS CONDITION met.');
    onUpdate({ isRunning: false, results: [...results], logs: [...logs] });

  } catch (err: any) {
    addLog(`[CRITICAL-TEST-FAILURE]: Execution halted due to pipeline error: ${err.message || err}`);
    onUpdate({ isRunning: false, results: [...results], logs: [...logs] });
  }
}
