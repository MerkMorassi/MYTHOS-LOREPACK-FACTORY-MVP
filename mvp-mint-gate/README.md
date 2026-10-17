# MVP-MINT-GATE — space-contract patch chip for MYTHOS-LOREPACK-FACTORY-MVP

Drop-in: copy `mint-gate.ts` into the MVP repo's `src/` (zero deps, no imports
from the repo). Then wire it with the five edits below. Nothing here invents
vectors, nothing ships partial packs.

What it holds: `PINNED_MODEL`/`PINNED_DIM` (768-D `gemini-embedding-2`),
typed refusals (`MintRefusedError`, `QuotaError` with server `retry in Ns`,
`AuthError`), `embedBatchPinned` (pinned body, throws, validates every vector
is 768-D finite — no fallback branch exists), `embedAllResumable` (batches of
10, 1.5s pacing, quota wait, per-batch checkpoint, order-preserving resume),
`assertSingleSpace` (one dim, one model, no dup ids, no orphan edges).

## Edit 1 — `src/providers/gemini-provider.ts`: pin + throw

Route both embed paths through the chip. `getEmbeddingsBatch` becomes:

```ts
import { embedBatchPinned } from './mint-gate.js';
async getEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  if (!texts.length) return [];
  const key = this._getKey();
  return embedBatchPinned(fetch.bind(globalThis), key, texts, texts.map((_, i) => `batch:t${i + 1}`));
}
```

Delete the `[EMBEDDING_MODEL, FALLBACK_EMBEDDING_MODEL]` loop, the server-proxy
embed fallback, and every `return generateDeterministicEmbedding(...)` in the
embed paths. Keep the function itself only if an explicit offline mode stamps
`deterministic-fallback` and is quarantined from export — otherwise delete it.
`getEmbeddings` (single) delegates to the batch path with one text.

## Edit 2 — `src/packer.ts` `ingestBatches`: fail loud, go slow

Replace the concurrent groups (`batchSize 40`, `concurrency 5`) with one
sequential `embedAllResumable` call over the staged records, checkpoint hooks
backed by the existing store (or a `embed_<agent>_<stamp>` row). Stamp every
record with the model that actually ran (`PINNED_MODEL`) and
`embeddingDimension: vector.length`. On throw: record `failed[]` with ids,
write nothing further, surface the refusal verbatim — never synthesize a
vector to fill the gap.

## Edit 3 — `src/packer.ts` `exportLorepack`: gate before bytes

First lines of `exportLorepack`, before any line is serialized:

```ts
import { assertSingleSpace } from './mint-gate.js';
const vectors = await this.store.getVectorsByAgent(agentId);
const edges = await this.store.getTripletEdgesByAgent(agentId);
assertSingleSpace(
  vectors.map(v => ({ id: v.id, vec: v.vector, model: v.metadata?.embeddingModel })),
  edges.map(e => ({ id: e.id, src: e.sourceId }))
);
```

A mixed store now refuses at export instead of shipping.

## Edit 4 — `src/App.tsx` `handleExportLorepack`: use the gated path

Replace the hand-rolled `yieldExportBatches` → Blob → download block with
`factory.exportLorepack(agentId, { gzip: true })` (which now gates per Edit 3),
and render `result.failed` with ids/reasons in the ingest summary. Block the
export button while any ingest failure is unresolved.

## Edit 5 — `server.ts`: stop serving fakes

Delete the `generateDeterministicEmbeddingServer` responses on the embed
routes. Proxy real API errors to the client so the chip's classifier sees
them; never return a synthesized vector stamped as a real model.

## Deliberately left out

Graph synthesis, triplet heuristics, the reader import gate (already sound),
UI styling. This chip fixes the mint path only. Prove it the same way: stub
a mid-run quota failure and assert the run throws, the store holds zero
fallback vectors, and export refuses.
