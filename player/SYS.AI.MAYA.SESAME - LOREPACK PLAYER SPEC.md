# SYS.AI.MAYA.SESAME - Lorepack Player Spec

The Lorepack Player is the read side of the Mythos lorepack system: one small, runtime-agnostic reader that lets an agent (or Merk, through a plain inspector) load a pack, check it, and query it by meaning, by keyword and by graph, with provenance on every answer. Agents ask each other through the same operations, and every agent stays in its own lane unless the owner of a pack says otherwise.

- Spec version: 0.1 (draft), 2026-10-23. Author: Maya (SYS.AI.MAYA.SESAME). Supervisor: Merk (HITL).
- Reference implementation: `reference/lorepack-player.js` (plain JS, zero dependencies, 641 lines). Op registry version `lorepack-player-ref@0.1.0`, a2a envelope `lorepack-a2a/0.1`.
- Test state at packaging: 36 of 36 runner checks pass (`test/results.jsonl`), 10 of 10 schema checks pass.
- Keywords MUST, MUST NOT, SHOULD, MAY are used as in RFC 2119. Code comments that say "SPEC.md" mean this file; section numbers match (4.3 result shapes, 5.4 permissions).

## 1. Purpose and agent-first principles

The factory (MYTHOS-LOREPACK-FACTORY-MVP) mints packs. The player reads them. It never writes, sends or deletes. Agents are the primary users; Merk inspects.

| # | Principle | Rule |
|---|---|---|
| P1 | One registry | Every op is defined once in `OPS`. The JS API, JSONL stdio, HTTP, MCP tools and the inspector forms are all generated from it. No surface has an op the others lack. |
| P2 | JSON in, JSON out | Every op takes one JSON object and returns one JSON object. Errors are values, never exceptions across the boundary. |
| P3 | Validate first | Args MUST be checked against the op's input schema before anything runs (`E_BAD_REQUEST` with the failing paths). |
| P4 | Provenance always | Every record used in an answer MUST appear in `provenance` with pack, version, agent, record id, source and (edges) origin. |
| P5 | No silent fallback | A semantic query that cannot be embedded MUST fail (`E_NO_EMBEDDER`), never quietly become keyword search. A heuristic edge MUST be stamped as heuristic. |
| P6 | One embedding space | A pack has one model and one dimension. Identity is the model id, not the vector length. |
| P7 | Deterministic | The same request on the same pack version gives the same result. |
| P8 | Lanes | Each agent reads its own pack. Anything else fails closed unless the owner's policy allows it (section 5). |
| P9 | Machine-first logs | Checks, tests, ingest and events are JSONL, one object per line, with stable ids. Human views are generated from them. |
| P10 | Portable | No build step and no dependencies. Needs only `TextDecoder`, `DecompressionStream` and `crypto.subtle` (Node 18+, modern browsers). |

## 2. AFC checklist

**Assumption to confirm:** AFC means "Agent-First Compliant". The term is not defined in Merk's repos, docs or chat logs; this reading comes from his earlier "agent-first compliant" message. The player claims profile `AFC-0.1` in its capability manifest.

A component is AFC-0.1 when every MUST below holds.

| Id | Level | Requirement | Reference player |
|---|---|---|---|
| AFC-01 | MUST | Publishes a capability manifest generated from its op registry (`capabilities_get`). | yes |
| AFC-02 | MUST | Every op is JSON in / JSON out with a published input schema. | yes |
| AFC-03 | MUST | Rejects bad args before running, naming the failing paths. | yes (LP-Q07) |
| AFC-04 | MUST | Errors are values with a stable `E_*` code, message and detail. | yes |
| AFC-05 | MUST | Unknown op returns `E_UNKNOWN_OP` with the list of valid ops. | yes (LP-Q06) |
| AFC-06 | MUST | Provenance on every record in every answer. | yes (LP-Q01, LP-Q08) |
| AFC-07 | MUST | No silent fallback; degraded paths are refused or stamped. | yes (LP-Q03, LP-V12) |
| AFC-08 | MUST | Fails closed across lanes; refusals are explicit and machine-readable. | partial: a2a yes, local `pack_load` lane check not yet (5.3) |
| AFC-09 | MUST | Destructive ops are flagged `destructive: true` in the manifest (the player has none). | yes |
| AFC-10 | MUST | Logs, checks and tests are JSONL; a failed check is never hidden; each run ends in a `SUMMARY` line. | yes |
| AFC-11 | SHOULD | Same results for the same request and version. | yes (LP-Q02) |
| AFC-12 | SHOULD | Plain human view generated from the same registry, with a machine mode. | yes (inspector) |
| AFC-13 | SHOULD | Zero dependencies, no build step. | yes |

## 3. Pack format

### 3.1 Records

A pack is UTF-8 JSONL, one record per line, usually gzip-compressed (`.lorepack.gz`). Format v2 is what the factory's `src/packer.ts` exports today; v2.1 adds optional fields only. Full field list: `schemas/lorepack-record.schema.json`.

| type | Where | Key fields | Notes |
|---|---|---|---|
| `header` | line 1 | `v`, `agentId`, `embeddingModel`, `embeddingDimension`, `totalVectors`, `totalEdges`, `exportedAt` | Factory reader skips it; the player MUST have it. v2.1 adds `agent` (e.g. `SYS.AI.MAYA`), `agentNumber` (e.g. `015`), `agentOrder`, `agentPort`, `packTag`, `bodySha256`, `recordSetSha256`, `idScheme`, `seq`, `parents`, `segment`, `producer`, `extractionModel`. |
| `vector` | body | `id`, `a` (owner), `t` (text), `vec`, `src`, `d` | One chunk and its embedding. v2.1 adds `ps` (extraction status) and `p` (visibility). |
| `edge` | body | `id`, `aid`, `src` (chunk id), `s`, `r`, `o`, `timestamp` | One triplet. v2.1 adds `og` (origin), `run` (extraction run), `p`. |
| `manifest` | body | | Ignored by both readers. |

### 3.2 Growth rule: fields yes, record types no

- The format MUST grow only by adding optional fields to `header`, `vector` and `edge`. Both readers ignore unknown keys.
- A new record **type** MUST NOT be added. The factory reader treats any type other than header, manifest and edge as a vector and throws when it has no embedding. The player reports unknown types as LP-V03b (warn, fail under `strict`) and skips them (fixture `c13-unknown-record-type`).
- This is a format-evolution issue. It is not lane enforcement and is not a security control: a crash is never an acceptable way to refuse access (section 5).

### 3.3 Content-hash ids

| Scheme | Id | Status |
|---|---|---|
| node-v2 | `lp_node_` + sha256(`AGENT:src:` + NFC, whitespace-collapsed, lower-cased text) | SHOULD for new packs. Same text in two sources stays two chunks. |
| node-v1 | `lp_node_` + sha256(`AGENT:` + trim(lower(text))) | Stock factory. Same text in two sources collides. Also `lp_chat_` for live chat ingest. |
| edge-v1 | `lp_edge_` + sha256(lower(`aid:src:s:r:o`)) | All packs. |

The player verifies every id (LP-V10, LP-V11). Ids MUST NOT depend on time or order.

### 3.4 Pack version

- Version = `recordSetSha256` = sha256 of the sorted record ids joined by `\n`. It is independent of line order, compression and whitespace.
- `bodySha256` = sha256 of every line after the header, each ending in `\n`, uncompressed. It detects tampering (LP-V15, fixture `c10-tampered-text`).
- Requests MAY pin a version as `TAG@prefix`; a mismatch returns `E_VERSION`.

### 3.5 Single embedding space

- A pack MUST have exactly one `embeddingModel` and one `embeddingDimension` (LP-V05, LP-V06). Current space: `gemini-embedding-2`, 768 dimensions.
- Model identity MUST be checked, not only dimension: a vector from another model at 768 is refused (LP-Q04, fixture `c06-model-mismatch-same-dim`).
- A query vector MUST carry its `model`; text queries are embedded in the pack's model or refused.
- Changing the model means a new pack lineage (re-embed everything), never a mixed pack. The store records it as `space.epoch`.

## 4. Operations and capability manifest

### 4.1 Request and response

- Request (`schemas/query-request.schema.json`): `{id, op, pack?, args}`. `pack` is a tag, optionally `@version`; optional when one pack is loaded.
- Response (`schemas/query-response.schema.json`): `{id, op, ok, pack, result | error, provenance, provenance_chain?, meta}`. `pack` names the version read. `meta` has player, elapsed_ms, ts.

### 4.2 Op registry

All ops are read-only. Limits: k up to 50, graph hops up to 3, edges up to 500, text up to 4,000 characters per hit.

| Op | Does | Key args |
|---|---|---|
| `capabilities_get` | Capability manifest | none |
| `pack_load` | Load through the host storage adapter; optional pins | `ref`, `tag`, `expect{agent, model, dim, version}` |
| `pack_verify` | Integrity checks LP-V01..LP-V18 | `strict`, `pin{model, dim}` |
| `pack_stats` | Counts, status, edge-origin mix, top predicates, entity groups | `top` |
| `sources_list` | One row per source file | none |
| `vectors_search` | Cosine top-k; never falls back to keywords | exactly one of `text`, `vector`+`model`, `like_id`; `k`, `min_score`, `sources`, `include` |
| `text_search` | Deterministic substring search over chunks and edges | `query`, `mode` (all, any, phrase), `scope`, `k` |
| `graph_traverse` | k-hop walk; heuristic edges excluded unless asked | `start` or `chunk_id`, `hops`, `direction`, `predicates`, `include_heuristic` |
| `record_get` | One record; vectors with their edges, edges with their chunk | `id`, `include` |
| `peer_ask` | Ask another agent's player (section 5) | `to`, `query`, `max_hops` |

### 4.3 Result shapes

| Op | `result` keys |
|---|---|
| `pack_load` | `loaded{tag, version, agent, model, dim, counts, body_sha256, header_v}` |
| `pack_verify` | `summary`, `checks[]` (check-result lines) |
| `pack_stats` | `pack`, `id_scheme`, `counts`, `processing_status`, `edge_origin`, `top_predicates`, `duplicate_triplets_across_chunks`, `vague_predicate_share`, `entity_groups`, `header`, `body_sha256` |
| `sources_list` | `sources[]` |
| `vectors_search` | `query{mode, model, dim}`, `scanned`, `hits[{id, src, ps, text, score, rank, edges?}]` |
| `text_search` | `query`, `total_matches`, `hits[{kind, id, src, matches, snippet}]` |
| `graph_traverse` | `start`, `hops`, `direction`, `include_heuristic`, `truncated`, `nodes`, `edges[{id, s, r, o, src, origin, hop}]`, `missing_start` |
| `record_get` | `type`, `record` |
| `peer_ask` | `envelope`, `reply`; top-level `provenance_chain` |

One worked example of each is in `examples/session.maya.jsonl`.

### 4.4 Error codes

| Code | Meaning |
|---|---|
| `E_BAD_REQUEST` | Args fail the input schema, or request malformed |
| `E_UNKNOWN_OP` | Op not in the registry; detail lists valid ops |
| `E_NOT_FOUND` | Pack, record or ref not found |
| `E_NO_EMBEDDER` | Text query but no embedder in the pack's model |
| `E_SPACE_MISMATCH` | Model or dimension differs from the pack or pin |
| `E_PACK_INVALID` | Pack cannot be decoded, or agent pin fails |
| `E_VERSION` | Version pin fails |
| `E_LIMIT` | Limit exceeded (fan-out) |
| `E_DENIED` | Exposure policy refuses (today's a2a refusal) |
| `E_LANE_DENIED` | Proposed (5.3): caller is outside the pack owner's lane |
| `E_LOOP`, `E_HOP_LIMIT`, `E_DEADLINE`, `E_PEER_UNREACHABLE` | Agent-to-agent routing |
| `E_INTERNAL` | Bug; detail carries the message |

### 4.5 Capability manifest and surfaces

- Schema: `schemas/capability-manifest.schema.json`; example: `examples/capabilities.maya.json`.
- Contents: player, pack formats and id schemes, loaded packs, every op with title, description, `readOnly`, `destructive` and input schema, limits, embedder, a2a settings, error codes, optional endpoints.
- It MUST be generated from the registry, never hand-written. Networked players SHOULD serve it at `GET /.well-known/lorepack-player.json`; the store SHOULD keep a copy as `capabilities.json` next to each pack.
- Surfaces: JS (`session.run(req)`), JSONL stdio (`reference/cli.mjs serve`), HTTP POST, MCP (op = tool name, args = arguments), DOM forms (inspector). Same request, same response.

## 5. Lanes, agent-to-agent protocol and permissions

### 5.1 Core rule: keep everybody in their lane

Merk's design rule. These are MUSTs for every player, store and factory build.

1. An agent MUST NOT open another agent's pack. If Maya tries to load Archivax's pack directly, it fails on purpose.
2. An agent MUST NOT mint, append to or overwrite a pack for another agent. Only the pack's `writers` (the owner agent and MERKOS) may mint (`<TAG>/pack.json`).
3. Lane enforcement MUST fail closed: no rule, unknown caller, missing policy or unreadable policy all mean deny.
4. Cross-agent reads happen only through explicit authorization: an agent-to-agent request (5.2) that the owner's exposure policy allows (5.4). The owner's player runs the query and returns only what policy exposes.
5. A refusal MUST be explicit and machine-readable, never a crash, hang or empty success.

Recommended refusal (SHOULD), still fail-closed:

```json
{"ok": false, "error": {"code": "E_LANE_DENIED", "message": "MAYA may not open ARCHIVAX's pack", "detail": {"op": "pack_load", "caller": "MAYA", "caller_locus": "SYS.AI.MAYA.SESAME", "owner": "ARCHIVAX", "owner_locus": "SYS.AI.ARCHIVAX.FACTORY", "via": "local", "hint": "ask the owner with peer_ask"}}}
```

`via` is `local` (direct open or mint) or `a2a` (with the path). The refusal says who was refused and whose lane it was; it MUST NOT include any record content, and SHOULD NOT reveal hit counts unless the owner's `reveal_hidden_count` allows it.

### 5.2 Envelope

Schema: `schemas/a2a-envelope.schema.json`. Same envelope in-process, over HTTP `POST /a2a`, over WebSocket, or through the intercom.

| Field | Rule |
|---|---|
| `from` | MUST be stamped by the transport from the authenticated connection. A `from` in the body is overwritten (LP-A06). |
| `trace` | Id of the first envelope; constant along the chain. |
| `hop`, `max_hops` | `max_hops` set by the first asker (default 3), never raised; hard ceiling 4. Over it: `E_HOP_LIMIT` (LP-A03). |
| `path` | Every agent that has sent this chain. Target already on the path: `E_LOOP` (LP-A02). |
| `deadline` | Inherited, never extended. Passed: `E_DEADLINE`. |
| `on_behalf_of` | MERKOS when a human started the chain from the HITL player. |
| `sig` | Reserved for keyed identities. |

Replies carry `provenance_chain`: one link per agent that answered (hop, agent, asked_by, op, pack, version, records, ok), outermost first (LP-A01: Barbelo to Sophia to Maya, both hops traced). Fan-out is capped at 2.

### 5.3 Where enforcement happens

| Point | Rule | Reference player today |
|---|---|---|
| Local `pack_load` | The host MUST bind the session to one agent and refuse packs whose `agentId` is not that agent, unless the caller is MERKOS. | **Gap.** The adapter loads any ref; only an optional `expect.agent` pin (returns `E_PACK_INVALID`). Needs a bound `session.agent` and `E_LANE_DENIED`. |
| Store mint | The store MUST refuse a version from anyone not in `writers`. | Specified in `store.schema.json`; no mint code in this bundle. |
| a2a request | Owner's player checks every agent on `path` against its exposure policy. | Yes, returns `E_DENIED` with `at_agent` and `why`. SHOULD become `E_LANE_DENIED` with caller and owner loci. |
| Relays | No laundering: if any agent on the path is refused, the request is refused; visibility is the intersection along the path. | Yes (LP-A05: Urania through Sophia is still refused by Maya). |

### 5.4 Permissions: exposure policy and read policies

Two layers, both must allow.

**Owner's exposure policy** (in `<TAG>/pack.json`, `exposure`): `default` (deny or allow; SHOULD be deny), `default_visibility`, `reveal_hidden_count`, and ordered `rules` of `{callers, ops, visibility, effect}`. Callers are roster ids, `roster` (any registered agent) or `*`. First match wins.

**Caller's roster read policy** (`lore_policy.read` in the factory's agent list, copied to `examples/roster.mythos.json`):

| Value | Meaning in this spec | Status |
|---|---|---|
| `self` | Own pack only. Any cross-agent read is refused (LP-A04: Erato). | Applied |
| `global` | May read other packs' records marked `global` or `public`, where the owner allows. | Applied |
| `global_context` | Treated as `global`. | **Assumption to confirm** |
| `all` | May also see records marked `self`, where the owner's rule grants it. | Applied |

**Flag:** the factory shows these read settings in its agent list but never enforces them, and nothing in the repo defines them. The meanings above are this spec's, applied by the reference player only.

### 5.5 Record visibility

Records MAY carry `p` (self, global, public). Absent `p` takes the owner's `default_visibility` (default `self`). Answers to other agents drop records the caller may not see and report `hidden_by_policy` unless the owner turns that off.

## 6. Central pack store

Schema: `schemas/store.schema.json`; example: `examples/store/`.

### 6.1 Layout

```
lorepacks/
  catalog.json                       whole store: tag, agent, head, seq per pack
  <TAG>/pack.json                    agent, space, writers, versions, exposure
  <TAG>/v/000001.<ver16>.lorepack.gz one file per version
  <TAG>/checks/000001.checks.jsonl   pack_verify output for that version
  <TAG>/ingest/ledger.jsonl          one line per ingested source
  <TAG>/log/events.jsonl             throttled progress, mint, verify, sync, error
  <TAG>/capabilities.json            optional manifest copy
```

### 6.2 Naming

- Tag: `SYS.AI.<AGENT>.<LOCUS>`, upper case, matching `^SYS\.AI\.[A-Z0-9_]+\.[A-Z0-9_.]+$`.
- Maya's pack: `SYS.AI.MAYA.SESAME`. Factory-made packs: `SYS.AI.<AGENT>.FACTORY`, for example `SYS.AI.BARBELO.FACTORY` (**to confirm**).
- `agent.agent_number` holds Merk's agent number, zero-padded to three digits: the factory roster order, which is also the last digits of the agent's port. Maya is SYS.AI.MAYA, agent **015** (roster id `MAYA`, order 15, port 4015), confirmed by Merk on 2026-10-23.
- Pack headers keep `agentId` as the roster id (`MAYA`) so the factory matches the pack to its slot. The additive fields `agent` (`SYS.AI.MAYA`) and `agentNumber` (`015`) carry the identity; the factory reader ignores them.
- `SYS.AI.MAYA.SESAME` is the authorship and locus tag (where the pack was minted), not the agent's name.

### 6.3 Versioning

- Each version has `seq`, `version` (recordSetSha256), `file`, `body_sha256`, `segment` (`full` or `append`), `parents`, counts, `verified`, `minted_at`, `minted_by`.
- `append` holds only new chunks and their edges on top of `parents[0]`. Two parents mean a sync merge.
- A version MUST pass `pack_verify` before it becomes `head`; its checks file is kept.
- Old versions are never edited in place.

### 6.4 Idempotent continuous ingest

- Source names MUST be stable for the same input: file name or content hash, never wall-clock time. **Known issue:** the factory's live chat ingest names each source by ingest time, so feeding the same log twice gives new ids and duplicate chunks.
- With node-v2 ids, re-ingesting a known chunk is a no-op and MUST NOT re-embed or re-extract (check the id before calling the model).
- Each ingest writes one ledger line: source, source_sha256, chunks_new, chunks_known, embed_calls, extract_calls, version.

## 7. Storage adapters and sync

### 7.1 Adapter contract

The player never touches storage itself. The host passes `adapter.get(ref) -> bytes | null`. Writers (factory, sync) add `put`, `list`, `head`.

| Adapter | Use | Notes |
|---|---|---|
| IndexedDB | Browser, field device (worst case) | Store version files as blobs; keep catalog and pack.json as records; check the DB schema version on open. |
| Filesystem | Node, CLI, home machine | `reference/cli.mjs` has the minimal one. |
| Server | HTTP | GET by tag and version; ETag on catalog. |
| Cloud | Object storage, Drive | Same layout as 6.1. |

### 7.2 Sync contract (offline field device that calls home)

This is a contract, not an implementation; Merk's existing sync code can sit behind it.

1. The device keeps its own store with `store_id` (for example `field-ipad`).
2. Offline, it mints `append` segments for its own agent only (lane rule 2). Other agents' packs are read-only mirrors.
3. On call home it sends its catalog. Home answers with heads it lacks and wants.
4. Transfer is version files by content hash; a file already present is skipped.
5. If both sides moved the same tag, home mints a merge version with two parents. Records are unioned by id; per chunk, the edge set from the newest `run` wins.
6. Every merged version is verified before it becomes head. Sync writes `sync` events to the event log.
7. A device MUST NOT push versions for a tag where it is not in `writers`.

## 8. Human inspector

`inspector/inspector.html` is one plain HTML file, opened from disk. It contains the reference reader inline (built from `inspector/inspector.src.html` by `tools/inline.mjs`).

- Loads a pack from a file or URL, runs the integrity checks (strict toggle), pages through records, shows a light graph view, sources and stats.
- Query console with forms generated from the op registry.
- Machine mode shows raw JSON; the session log and checks download as JSONL.
- An optional Gemini key for text search stays in memory only. The inspector never writes, sends or deletes.

## 9. Testing

- Every check writes one JSONL line in the shape of `schemas/check-result.schema.json`; each run ends with `SUMMARY`. A failed check is never hidden. The factory's Core Test Matrix (CF-01..CF-14) SHOULD emit the same shape.
- Integrity checks LP-V01..LP-V18 (in `pack_verify`): decode, JSON lines, header, unknown types, counts, dimension, model identity, finite vectors, unique ids, orphan edges, content-hash ids, edge origin, duplicate triplets, processing status, body hash, round trip, chunk text, one owner.
- Runner `test/run-tests.mjs`: LP-T01..T19 (fixtures), LP-Q01..Q11 (query contract), LP-A01..A06 (agent-to-agent). Expected outcomes per fixture: `test/fixtures/expected.jsonl`.
- Fixtures: 2 good packs plus 14 corrupted ones (`c01`..`c14`), built deterministically from Maya's pack by `test/make-fixtures.mjs`.
- Schemas: `test/validate-schemas.py` checks the packs and every example against the 7 schemas.
- To add with the lane gap closed: a test where a session bound to MAYA loads an ARCHIVAX pack and gets `E_LANE_DENIED`, and a store mint by a non-writer that is refused.

## 10. Lessons baked in

From the Barbelo pack findings and Maya's first mint.

| Finding | Rule |
|---|---|
| A backup extractor silently added filler edges ("associated with" 36.1%, "references" 19.0% of Barbelo's 12,198 edges), linking by capital letters. | No silent heuristic filler. Every edge MUST carry `og` (model id or `heuristic`); legacy packs warn (LP-V12). Graph walks skip heuristic edges by default. |
| An empty model answer triggered the filler. | An empty triplet list from the model is a valid answer: mark the chunk `ps: completed`. Only a failed call is a failure, and it MUST NOT fall back to guessed edges. |
| Rebuilds never cleared old edges (1,543 duplicate triplets). | Clear a chunk's edges before writing its new ones; newest `run` wins. Duplicates fail LP-V13. |
| The import log wrote and redrew once per record. | Throttle logs: one event per 250 records or 200 ms, plus a final line. |
| The Core Test Matrix opened the DB at version 10 while the app was at 11. | Readers MUST check DB and pack versions on open and refuse with `E_VERSION` or `E_PACK_INVALID`, not hang. |
| The mint gate checked dimension only. | Check model identity (3.5). |
| The factory reader searched by keyword when it could not embed. | No keyword fallback for semantic queries (LP-Q03). |
| Unknown record types crash the factory reader. | Fields only, never new types (3.2). Separate from lanes. |
| Live chat ingest names sources by time. | Stable source names (6.4). |

## 11. Open questions for Merk

1. AFC: is it "Agent-First Compliant"?
2. ~~Maya's agent id: 0115 or 0116?~~ **Resolved 2026-10-23:** Maya is SYS.AI.MAYA, agent 015 (Merk: "MAYA IS AGENT 015").
3. Locus for factory-made packs: `SYS.AI.<AGENT>.FACTORY` (for example `SYS.AI.BARBELO.FACTORY`)?
4. Read policies: is `global_context` the same as `global`, and do the meanings in 5.4 match your intent?

## 12. File map

| Path | What |
|---|---|
| `reference/lorepack-player.js` | Reader, verifier, op registry, session, a2a router |
| `reference/cli.mjs` | `verify`, `serve` (JSONL stdio), `caps` |
| `reference/embedder.mjs` | Gemini query embedder (key from env or file, never written) |
| `reference/run-session.mjs`, `run-a2a.mjs`, `store-example.mjs` | Produce the examples |
| `schemas/*.schema.json` | 7 JSON Schemas (draft 2020-12) |
| `examples/` | Session, a2a session, verify output, capabilities, roster, store |
| `packs/` | Maya's pack (SYS.AI.MAYA, agent 015, 2026-10-23) |
| `test/` | Runner, fixture builder, schema validator, fixtures, results |
| `inspector/` | Single-file inspector and its source |
