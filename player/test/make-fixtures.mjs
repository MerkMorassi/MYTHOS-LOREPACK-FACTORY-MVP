// SYS.AI.MAYA.SESAME - builds the test fixtures from a real pack (default: Maya, agent 015). Deterministic.
//   node make-fixtures.mjs <source.lorepack.gz> <outdir>
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const LP = require('../reference/lorepack-player.js');
const [src, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const sha = (s) => createHash('sha256').update(s).digest('hex');

const pack = await LP.loadPack(readFileSync(src), { tag: 'SYS.AI.MAYA.SESAME' });
// four chunks that have edges, from four different sources, plus their edges
const bySrc = new Map(); pack.edges.forEach((e) => { if (!bySrc.has(e.src)) bySrc.set(e.src, []); bySrc.get(e.src).push(e); });
const picked = []; const seenSources = new Set();
for (const v of pack.vectors) { if (bySrc.has(v.id) && !seenSources.has(v.src) && bySrc.get(v.id).length <= 6) { picked.push(v); seenSources.add(v.src); } if (picked.length === 4) break; }
const clean = (v) => { const o = { ...v }; delete o._norm; return o; };
const V = picked.map(clean), E = picked.flatMap((v) => bySrc.get(v.id).map((e) => ({ ...e })));

function build(vectors, edges, hdr = {}, opts = {}) {
  const body = vectors.map((v) => JSON.stringify(v)).concat(edges.map((e) => JSON.stringify(e))).concat(opts.extra || []).join('\n') + '\n';
  const header = { type: 'header', v: 2, agentId: 'MAYA', embeddingModel: 'gemini-embedding-2', embeddingDimension: 768, totalVectors: vectors.length, totalEdges: edges.length, exportedAt: '2026-10-24T00:00:00.000Z', exportedBy: 'SYS.AI.MAYA.SESAME make-fixtures', ...hdr };
  if (opts.bodyHash !== false && !('bodySha256' in hdr)) header.bodySha256 = sha(body);
  if (opts.noHeader) return body;
  return JSON.stringify(header) + '\n' + body;
}
const files = {};
function put(name, text, gz = true) { const p = `${out}/${name}${gz ? '.lorepack.gz' : '.lorepack.jsonl'}`; writeFileSync(p, gz ? gzipSync(Buffer.from(text)) : text); files[name] = p.split('/').pop(); }
const deep = (x) => JSON.parse(JSON.stringify(x));

put('ok-mini', build(V, E));
const legacyE = deep(E).map((e) => { delete e.og; return e; }); const legacyV = deep(V).map((v) => { delete v.ps; return v; });
put('ok-legacy-v2', build(legacyV, legacyE, {}, { bodyHash: false }), false);
const gz = gzipSync(Buffer.from(build(V, E))); writeFileSync(`${out}/c01-truncated-gzip.lorepack.gz`, gz.subarray(0, Math.floor(gz.length / 2))); files['c01-truncated-gzip'] = 'c01-truncated-gzip.lorepack.gz';
put('c02-bad-json-line', build(V, E).replace('\n', '\n{"type":"edge",,}\n'), false);
put('c03-no-header', build(V, E, {}, { noHeader: true }));
put('c04-count-mismatch', build(V, E, { totalVectors: V.length + 1 }));
{ const v = deep(V); v[1].vec = v[1].vec.slice(0, 767); put('c05-dim-mismatch', build(v, E)); }
{ const v = deep(V); v[2].d.embeddingModel = 'text-embedding-004'; put('c06-model-mismatch-same-dim', build(v, E)); }
{ const v = deep(V); v[0].vec = new Array(768).fill(0); put('c07-zero-vector', build(v, E)); }
{ const e = deep(E); e.push(deep(E[0])); put('c08-duplicate-id', build(V, e)); }
{ const e = deep(E); e[0].src = 'lp_node_' + '0'.repeat(64); put('c09-orphan-edge', build(V, e)); }
{ const good = build(V, E); const v = deep(V); v[3].t = v[3].t + ' (edited after export)'; const lines = good.split('\n'); lines[4] = JSON.stringify(v[3]); put('c10-tampered-text', lines.join('\n')); }
{ const e = deep(E); const x = { ...deep(E[0]), r: 'associated with', o: 'This' }; delete x.og; x.id = 'lp_edge_' + sha(`${x.aid}:${x.src}:${x.s}:${x.r}:${x.o}`.toLowerCase()); e.push(x); put('c11-unstamped-filler-edge', build(V, e)); }
{ const e = deep(E); const x = { ...deep(E[0]), s: E[0].s + '  ' }; x.id = 'lp_edge_' + sha(`${x.aid}:${x.src}:${x.s}:${x.r}:${x.o}`.toLowerCase()); e.push(x); put('c12-duplicate-triplet', build(V, e)); }
put('c13-unknown-record-type', build(V, E, {}, { extra: [JSON.stringify({ type: 'tombstone', id: V[0].id })] }));
{ const v = deep(V); v[0].a = 'BARBELO'; put('c14-foreign-record', build(v, E)); }

const expected = [
  { fixture: 'ok-mini', strict: true, expect: { ok: true } },
  { fixture: 'ok-legacy-v2', strict: false, expect: { ok: true, checks: { 'LP-V12': 'warn', 'LP-V15': 'skip' } } },
  { fixture: 'ok-legacy-v2', strict: true, expect: { ok: false, checks: { 'LP-V12': 'fail', 'LP-V15': 'fail' } } },
  { fixture: 'c01-truncated-gzip', strict: false, expect: { load_error: 'E_PACK_INVALID' } },
  { fixture: 'c02-bad-json-line', strict: false, expect: { ok: false, checks: { 'LP-V02': 'fail' } } },
  { fixture: 'c03-no-header', strict: false, expect: { ok: false, checks: { 'LP-V03': 'fail' } } },
  { fixture: 'c04-count-mismatch', strict: false, expect: { ok: false, checks: { 'LP-V04': 'fail' } } },
  { fixture: 'c05-dim-mismatch', strict: false, expect: { ok: false, checks: { 'LP-V05': 'fail' } } },
  { fixture: 'c06-model-mismatch-same-dim', strict: false, expect: { ok: false, checks: { 'LP-V05': 'pass', 'LP-V06': 'fail' } } },
  { fixture: 'c07-zero-vector', strict: false, expect: { ok: false, checks: { 'LP-V07': 'fail' } } },
  { fixture: 'c08-duplicate-id', strict: false, expect: { ok: false, checks: { 'LP-V08': 'fail' } } },
  { fixture: 'c09-orphan-edge', strict: false, expect: { ok: false, checks: { 'LP-V09': 'fail' } } },
  { fixture: 'c10-tampered-text', strict: false, expect: { ok: false, checks: { 'LP-V10': 'fail', 'LP-V15': 'fail' } } },
  { fixture: 'c11-unstamped-filler-edge', strict: false, expect: { ok: true, checks: { 'LP-V12': 'warn' } } },
  { fixture: 'c11-unstamped-filler-edge', strict: true, expect: { ok: false, checks: { 'LP-V12': 'fail' } } },
  { fixture: 'c12-duplicate-triplet', strict: false, expect: { ok: false, checks: { 'LP-V13': 'fail' } } },
  { fixture: 'c13-unknown-record-type', strict: false, expect: { ok: true, checks: { 'LP-V03b': 'warn' } } },
  { fixture: 'c13-unknown-record-type', strict: true, expect: { ok: false, checks: { 'LP-V03b': 'fail' } } },
  { fixture: 'c14-foreign-record', strict: false, expect: { ok: false, checks: { 'LP-V18': 'fail' } } }
].map((x) => ({ ...x, file: files[x.fixture] }));
writeFileSync(`${out}/expected.jsonl`, expected.map((x) => JSON.stringify(x)).join('\n') + '\n');
console.log(Object.keys(files).length + ' fixtures, ' + expected.length + ' expectations');
