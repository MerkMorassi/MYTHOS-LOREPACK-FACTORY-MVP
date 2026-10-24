// SYS.AI.MAYA.SESAME - runs the example session against a real pack and writes {request,response} JSONL.
//   node run-session.mjs <maya.lorepack.gz> <out.jsonl> [--key-file F]
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { geminiEmbedderFrom } from './embedder.mjs';
const require = createRequire(import.meta.url);
const LP = require('./lorepack-player.js');

const [packPath, outPath] = process.argv.slice(2);
const kf = process.argv.indexOf('--key-file');
const embed = geminiEmbedderFrom(kf > 0 ? process.argv[kf + 1] : null);
const s = LP.createSession({ embed, adapter: { kind: 'fs', get: async (r) => { try { return readFileSync(r); } catch { return null; } } } });
const lines = [];
async function ask(req, note) {
  const resp = await s.run(req);
  lines.push(JSON.stringify({ note, request: req, response: resp }));
  return resp;
}

await ask({ id: 's01', op: 'pack_load', args: { ref: packPath, tag: 'SYS.AI.MAYA.SESAME', expect: { agent: 'MAYA', model: 'gemini-embedding-2', dim: 768 } } }, 'load with the space pinned');
await ask({ id: 's02', op: 'capabilities_get' }, 'what this player exposes');
await ask({ id: 's03', op: 'pack_verify', pack: 'SYS.AI.MAYA.SESAME' }, 'integrity checks LP-V01..18');
await ask({ id: 's04', op: 'pack_stats', args: { top: 8 } }, 'stats');
await ask({ id: 's05', op: 'sources_list' }, 'sources');
const sem = await ask({ id: 's06', op: 'vectors_search', args: { text: 'how should agents ask each other questions', k: 3, include: ['edges'], max_chars: 300 } }, 'semantic search by text (query embedded with gemini-embedding-2 at 768)');
await ask({ id: 's07', op: 'vectors_search', args: { text: 'What is Maya Lila?', k: 3, max_chars: 300 } }, 'semantic search by text');
const top = sem.ok && sem.result.hits[0];
if (top) await ask({ id: 's08', op: 'vectors_search', args: { like_id: top.id, k: 3, max_chars: 200 } }, 'more like this: no embedder needed');
await ask({ id: 's09', op: 'vectors_search', args: { vector: new Array(768).fill(0.01), model: 'text-embedding-004', k: 3 } }, 'refused: query vector from another model (identity check, not only dimension)');
await ask({ id: 's10', op: 'text_search', args: { query: 'lorepack', mode: 'any', k: 5 } }, 'keyword search');
const g = await ask({ id: 's11', op: 'graph_traverse', args: { start: ['VOXPACK'], hops: 2, max_edges: 25 } }, '2-hop graph walk');
const e = g.ok && g.result.edges[0];
if (e) await ask({ id: 's12', op: 'record_get', args: { id: e.id } }, 'edge with its source chunk');
await ask({ id: 's13', op: 'graph_traverse', args: { start: ['vox'] } }, 'not found: returns suggestions');
await ask({ id: 's14', op: 'chunks_delete', args: {} }, 'unknown op');
await ask({ id: 's15', op: 'vectors_search', args: { text: 'x', k: 500 } }, 'schema violation');
writeFileSync(outPath, lines.join('\n') + '\n');
console.log(lines.length + ' exchanges -> ' + outPath);
