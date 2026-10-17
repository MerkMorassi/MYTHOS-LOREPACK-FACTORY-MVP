import {
  PINNED_MODEL,
  PINNED_DIM,
  EMBED_BATCH,
  EMBED_PACE_MS,
  MintRefusedError,
  QuotaError,
  AuthError,
  assertSingleSpace,
  embedBatchPinned,
  embedAllResumable,
  classifyEmbedFailure,
  parseRetryMs,
  type GateVector,
  type GateEdge,
  type ResumeHooks
} from '../src/mint-gate.js';

async function main() {
  console.log('--- RUNNING MINT CHIP & MINT GATE TEST SUITE ---');

  // 1. Check constants
  if (PINNED_MODEL !== 'gemini-embedding-2') throw new Error('Bad model: ' + PINNED_MODEL);
  if (PINNED_DIM !== 768) throw new Error('Bad dim: ' + PINNED_DIM);
  if (EMBED_BATCH !== 10) throw new Error('Bad batch: ' + EMBED_BATCH);
  if (EMBED_PACE_MS !== 1500) throw new Error('Bad pace: ' + EMBED_PACE_MS);
  console.log('✔ Pinned Constants Verified: gemini-embedding-2, 768-D, 10/batch, 1500ms pacing');

  // 2. assertSingleSpace happy path
  const validVecs: GateVector[] = [
    { id: 'v1', vec: new Array(768).fill(0.1), model: 'gemini-embedding-2' },
    { id: 'v2', vec: new Array(768).fill(0.2), model: 'gemini-embedding-2' }
  ];
  const validEdges: GateEdge[] = [
    { id: 'e1', src: 'v1' },
    { id: 'e2', src: 'v2' }
  ];
  const spaceRes = assertSingleSpace(validVecs, validEdges, 768);
  if (spaceRes.vectors !== 2 || spaceRes.edges !== 2 || spaceRes.dim !== 768) {
    throw new Error('assertSingleSpace failed on valid vectors');
  }
  console.log('✔ assertSingleSpace happy path: 2 vectors, 2 edges conforming to 768-D');

  // 3. assertSingleSpace duplicate IDs
  try {
    assertSingleSpace([
      { id: 'dup', vec: new Array(768).fill(0.1), model: 'gemini-embedding-2' },
      { id: 'dup', vec: new Array(768).fill(0.2), model: 'gemini-embedding-2' }
    ], [], 768);
    throw new Error('Should have failed on duplicate IDs');
  } catch (e: any) {
    if (!(e instanceof MintRefusedError) || !e.message.includes('duplicate vector id')) {
      throw new Error('Wrong error on duplicate id: ' + e);
    }
  }
  console.log('✔ assertSingleSpace duplicate ID rejection verified');

  // 4. assertSingleSpace wrong dimension
  try {
    assertSingleSpace([
      { id: 'v1', vec: new Array(1536).fill(0.1), model: 'gemini-embedding-2' }
    ], [], 768);
    throw new Error('Should have failed on wrong dimension');
  } catch (e: any) {
    if (!(e instanceof MintRefusedError) || !e.message.includes('this mint is pinned 768-D')) {
      throw new Error('Wrong error on dim: ' + e);
    }
  }
  console.log('✔ assertSingleSpace dimension mismatch rejection verified (1536-D rejected)');

  // 5. assertSingleSpace mixed dimensions
  try {
    assertSingleSpace([
      { id: 'v1', vec: new Array(768).fill(0.1), model: 'gemini-embedding-2' },
      { id: 'v2', vec: new Array(384).fill(0.1), model: 'gemini-embedding-2' }
    ], [], 768);
    throw new Error('Should have failed on mixed dimensions');
  } catch (e: any) {
    if (!(e instanceof MintRefusedError) || !e.message.includes('mix embedding dimensions')) {
      throw new Error('Wrong error on mixed dimensions: ' + e);
    }
  }
  console.log('✔ assertSingleSpace mixed dimensions rejection verified (768-D + 384-D rejected)');

  // 6. assertSingleSpace mixed models
  try {
    assertSingleSpace([
      { id: 'v1', vec: new Array(768).fill(0.1), model: 'gemini-embedding-2' },
      { id: 'v2', vec: new Array(768).fill(0.1), model: 'text-embedding-004' }
    ], [], 768);
    throw new Error('Should have failed on mixed models');
  } catch (e: any) {
    if (!(e instanceof MintRefusedError) || !e.message.includes('mix embedding models')) {
      throw new Error('Wrong error on mixed models: ' + e);
    }
  }
  console.log('✔ assertSingleSpace mixed models rejection verified');

  // 7. assertSingleSpace orphan edge
  try {
    assertSingleSpace(validVecs, [{ id: 'e_bad', src: 'missing_node' }], 768);
    throw new Error('Should have failed on orphan edge');
  } catch (e: any) {
    if (!(e instanceof MintRefusedError) || !e.message.includes('not in this pack')) {
      throw new Error('Wrong error on orphan edge: ' + e);
    }
  }
  console.log('✔ assertSingleSpace orphan edge rejection verified');

  // 8. Quota parsing & classification
  const quotaErr = classifyEmbedFailure(429, 'RESOURCE_EXHAUSTED: retry in 3.5s', 'test_1');
  if (!(quotaErr instanceof QuotaError)) throw new Error('Expected QuotaError');
  if (quotaErr.retryMs !== 3500) throw new Error('Expected 3500ms parsed retry, got: ' + quotaErr.retryMs);
  console.log('✔ Quota parsing & classification verified (parsed retryMs: ' + quotaErr.retryMs + ')');

  // 9. AuthError on missing key
  try {
    await embedBatchPinned(async () => ({} as any), '', ['hello'], ['id1']);
    throw new Error('Should have failed on empty key');
  } catch (e: any) {
    if (!(e instanceof AuthError) || !e.message.includes('no API key')) {
      throw new Error('Wrong error on empty key: ' + e);
    }
  }
  console.log('✔ AuthError on empty API key verified: "MINT REFUSED :: no API key"');

  // 10. Resumable embed checkpoint test
  let savedCp: any = null;
  const mockHooks: ResumeHooks = {
    load: async () => savedCp,
    save: async (cp) => { savedCp = cp; },
    onEvent: (msg) => console.log('   [event]:', msg)
  };
  const mockFetch = async () => ({
    ok: true,
    status: 200,
    json: async () => ({
      embeddings: [{ values: new Array(768).fill(0.05) }]
    })
  });
  const outMap = await embedAllResumable(
    [{ id: 'item1', text: 'hello' }],
    'MOCK_KEY',
    mockFetch as any,
    mockHooks,
    PINNED_MODEL,
    PINNED_DIM,
    1
  );
  if (!outMap.has('item1') || outMap.get('item1')?.length !== 768) {
    throw new Error('Failed to get vector from embedAllResumable');
  }
  if (!savedCp?.items?.item1) {
    throw new Error('Failed to save checkpoint in embedAllResumable');
  }
  console.log('✔ embedAllResumable and checkpointing verified (checkpoint saved, 768-D output mapped)');

  console.log('--- ALL 10 MINT CHIP & MINT GATE INTEGRATION TESTS PASSED ---');
}

main().catch((err) => {
  console.error('TEST ERROR:', err);
  process.exit(1);
});
