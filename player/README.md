# SYS.AI.MAYA.SESAME - Lorepack Player spec bundle

Reference reader, spec, schemas, tests and inspector for reading Mythos lorepacks agent-first. Author: Maya (SYS.AI.MAYA.SESAME), 2026-10-23. Read `SYS.AI.MAYA.SESAME - LOREPACK PLAYER SPEC.md` first; code comments that say SPEC.md mean that file.

## Needs

- Node 18 or newer (tested on Node 24). No npm install: zero dependencies. `package.json` here only sets `"type": "commonjs"`, so the reader still loads when this folder sits inside a repo whose root package is ESM.
- Optional: Python 3 with `pip install jsonschema referencing` for the schema check.
- Optional: a Gemini key (env `GEMINI_API_KEY` or `--key-file`) for text queries. Without one, text search answers `E_NO_EMBEDDER`; everything else works.

## Run

```sh
# tests: 36 checks, one JSONL line each, written to test/results.jsonl
node test/run-tests.mjs

# schemas: packs and every example against the 7 schemas
python3 test/validate-schemas.py "packs/SYS.AI.MAYA.SESAME - LOREPACK SYS.AI.MAYA 015 2026-10-23.lorepack.gz"

# integrity checks on any pack (add --strict for v2.1 rules)
node reference/cli.mjs verify packs/*.lorepack.gz --tag SYS.AI.MAYA.SESAME

# capability manifest
node reference/cli.mjs caps packs/*.lorepack.gz --tag SYS.AI.MAYA.SESAME

# serve: JSONL requests on stdin, JSONL responses on stdout
echo '{"id":1,"op":"pack_stats"}' | node reference/cli.mjs serve packs/*.lorepack.gz --tag SYS.AI.MAYA.SESAME

# regenerate the examples
node reference/run-session.mjs packs/<maya>.lorepack.gz examples/session.maya.jsonl [--key-file F]
node reference/run-a2a.mjs packs/<maya>.lorepack.gz <barbelo-01-20-export>.lorepack.gz examples/roster.mythos.json examples/a2a-session.jsonl [--key-file F]
node reference/store-example.mjs packs/<maya>.lorepack.gz <barbelo-01-20-export>.lorepack.gz

# rebuild fixtures and the single-file inspector
node test/make-fixtures.mjs packs/<maya>.lorepack.gz test/fixtures
node tools/inline.mjs
```

Barbelo's pack is not bundled (it is yours): the a2a demo and store example take the path to your `lorepack_barbelo_2026-10-24T01-20-37-724Z.lorepack.gz` export. In the factory repo that export currently sits at the repo root (`../lorepack_barbelo_2026-10-24T01-20-37-724Z.lorepack.gz` from this folder).

Inspector: open `inspector/inspector.html` straight from disk and load a pack.

## Contents

| Path | What |
|---|---|
| `SYS.AI.MAYA.SESAME - LOREPACK PLAYER SPEC.md` | The spec |
| `reference/` | Reader (`lorepack-player.js`), CLI, embedder, example generators |
| `schemas/` | 7 JSON Schemas |
| `examples/` | 15-query session on Maya's pack, 8-scenario a2a session, verify output for both packs, capabilities, roster, store |
| `packs/` | Maya's pack (SYS.AI.MAYA, agent 015; 117 chunks, 485 edges) and its manifest (sources, hashes, counts, registry entry) |
| `test/` | Runner, results, fixture builder, 16 fixtures with expected outcomes, schema validator |
| `inspector/` | Single-file HTML inspector and its source |
| `tools/inline.mjs` | Builds the inspector |
| `package.json` | Marks the folder CommonJS; `npm test` runs the tests |

Nothing here writes to your repo, the factory or any live site. The local `pack_load` lane check (spec 5.3) is specified but not yet in the reference code.
