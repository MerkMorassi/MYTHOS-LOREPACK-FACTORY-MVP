// SYS.AI.MAYA.SESAME - test runner. Output: one JSONL line per check (stdout and test/results.jsonl).
//   node run-tests.mjs            (no network; semantic search is tested with like_id and vectors)
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const require = createRequire(import.meta.url);
const LP = require('../reference/lorepack-player.js');
const here = dirname(fileURLToPath(import.meta.url));
const FX = join(here, 'fixtures');
const RUN = 'run_' + new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14);
const out = [];
function line(check, name, status, extra = {}) { const o = { suite: 'lorepack-player-tests', run: RUN, check, name, status, ...extra, ts: new Date().toISOString() }; out.push(o); process.stdout.write(JSON.stringify(o) + '\n'); }
async function timed(check, name, fn) {
  const t0 = Date.now();
  try { const r = await fn(); line(check, name, r.pass ? 'pass' : 'fail', { expected: r.expected, actual: r.actual, ms: Date.now() - t0 }); }
  catch (e) { line(check, name, 'fail', { actual: String(e && e.message), ms: Date.now() - t0 }); }
}

// 1. fixtures: each corruption trips exactly the check it is built for
const expected = readFileSync(join(FX, 'expected.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
let n = 0;
for (const x of expected) {
  n++;
  await timed('LP-T' + String(n).padStart(2, '0'), `fixture ${x.fixture}${x.strict ? ' (strict)' : ''}`, async () => {
    let pack;
    try { pack = await LP.loadPack(readFileSync(join(FX, x.file)), { tag: 'SYS.AI.MAYA.SESAME' }); }
    catch (e) { return { pass: x.expect.load_error === e.code, expected: x.expect, actual: { load_error: e.code } }; }
    if (x.expect.load_error) return { pass: false, expected: x.expect, actual: 'loaded' };
    const checks = await LP.verifyPack(pack, { strict: x.strict });
    const sum = LP.summarize(checks); const got = {};
    for (const k of Object.keys(x.expect.checks || {})) got[k] = (checks.find((c) => c.check === k) || {}).status || 'absent';
    const pass = sum.ok === x.expect.ok && Object.keys(got).every((k) => got[k] === x.expect.checks[k]);
    return { pass, expected: x.expect, actual: { ok: sum.ok, checks: got, failed: checks.filter((c) => c.status === 'fail').map((c) => c.check) } };
  });
}

// 2. query contract over the clean fixture
const s = LP.createSession();
const mini = await LP.loadPack(readFileSync(join(FX, 'ok-mini.lorepack.gz')), { tag: 'SYS.AI.MAYA.SESAME' });
s.addPack(mini);
const v0 = mini.vectors[0];
const q = (req) => s.run(req);
await timed('LP-Q01', 'like_id search: k respected, self excluded, sorted, provenance per hit', async () => {
  const r = await q({ id: 1, op: 'vectors_search', args: { like_id: v0.id, k: 2 } });
  const h = r.result.hits; const sorted = h.every((x, i) => i === 0 || h[i - 1].score >= x.score);
  return { pass: r.ok && h.length === 2 && !h.some((x) => x.id === v0.id) && sorted && r.provenance.length === 2 && r.provenance.every((p) => p.pack && p.version && p.record && p.source), actual: { n: h.length, prov: r.provenance.length } };
});
await timed('LP-Q02', 'same request twice gives the same result (determinism)', async () => {
  const a = await q({ id: 2, op: 'text_search', args: { query: 'maya', mode: 'any' } }), b = await q({ id: 2, op: 'text_search', args: { query: 'maya', mode: 'any' } });
  return { pass: JSON.stringify(a.result) === JSON.stringify(b.result), actual: a.result.total_matches };
});
await timed('LP-Q03', 'text query without embedder: E_NO_EMBEDDER, no keyword fallback', async () => {
  const r = await q({ id: 3, op: 'vectors_search', args: { text: 'anything' } }); return { pass: !r.ok && r.error.code === 'E_NO_EMBEDDER', actual: r.error };
});
await timed('LP-Q04', 'vector from another model refused even at the same dimension', async () => {
  const r = await q({ id: 4, op: 'vectors_search', args: { vector: v0.vec, model: 'text-embedding-004' } }); return { pass: !r.ok && r.error.code === 'E_SPACE_MISMATCH', actual: r.error };
});
await timed('LP-Q05', 'vector with the pack model accepted; top hit is itself at score 1', async () => {
  const r = await q({ id: 5, op: 'vectors_search', args: { vector: v0.vec, model: 'gemini-embedding-2', k: 1 } }); return { pass: r.ok && r.result.hits[0].id === v0.id && Math.abs(r.result.hits[0].score - 1) < 1e-6, actual: r.result && r.result.hits[0] && r.result.hits[0].score };
});
await timed('LP-Q06', 'unknown op: E_UNKNOWN_OP with the op list', async () => {
  const r = await q({ id: 6, op: 'chunks_delete' }); return { pass: !r.ok && r.error.code === 'E_UNKNOWN_OP' && r.error.detail.ops.length === LP.OPS.length, actual: r.error.code };
});
await timed('LP-Q07', 'args outside the input schema: E_BAD_REQUEST before anything runs', async () => {
  const r = await q({ id: 7, op: 'graph_traverse', args: { start: ['x'], hops: 9, color: 'red' } }); return { pass: !r.ok && r.error.code === 'E_BAD_REQUEST' && r.error.detail.errors.length === 2, actual: r.error.detail };
});
await timed('LP-Q08', 'graph walk: every edge carries provenance with origin; hop <= hops', async () => {
  const r = await q({ id: 8, op: 'graph_traverse', args: { chunk_id: v0.id, hops: 2 } });
  return { pass: r.ok && r.result.edges.length > 0 && r.result.edges.every((e) => e.hop <= 2) && r.provenance.length === r.result.edges.length && r.provenance.every((p) => p.origin && p.origin !== 'unknown'), actual: { edges: r.result && r.result.edges.length } };
});
await timed('LP-Q09', 'record_get on an edge returns its source chunk', async () => {
  const e = mini.edges[0]; const r = await q({ id: 9, op: 'record_get', args: { id: e.id } }); return { pass: r.ok && r.result.record.chunk.id === e.src && r.provenance.length === 2, actual: r.result && r.result.record.chunk && r.result.record.chunk.id };
});
await timed('LP-Q10', 'capabilities_get lists every op with an input schema', async () => {
  const r = await q({ id: 10, op: 'capabilities_get' }); return { pass: r.ok && r.result.ops.length === LP.OPS.length && r.result.ops.every((o) => o.input && o.input.type === 'object'), actual: r.result.ops.map((o) => o.name) };
});
await timed('LP-Q11', 'pinned load refuses another space', async () => {
  const s2 = LP.createSession({ adapter: { get: async (p) => readFileSync(p) } });
  const r = await s2.run({ id: 11, op: 'pack_load', args: { ref: join(FX, 'ok-mini.lorepack.gz'), expect: { model: 'text-embedding-004' } } });
  return { pass: !r.ok && r.error.code === 'E_SPACE_MISMATCH', actual: r.error };
});

// 3. agent-to-agent over the mini pack
const roster = JSON.parse(readFileSync(join(here, '..', 'examples', 'roster.mythos.json'), 'utf8')).agents;
const router = LP.createRouter(roster);
const mk = () => LP.createSession();
const S = { MAYA: mk(), BARBELO: mk(), SOPHIA: mk(), ERATO: mk(), URANIA: mk() };
S.MAYA.addPack(mini);
const readOps = ['pack_stats', 'text_search', 'vectors_search', 'graph_traverse', 'record_get', 'sources_list', 'peer_ask'];
router.register('MAYA', S.MAYA, { default: 'deny', default_visibility: 'global', rules: [{ callers: ['URANIA'], ops: '*', effect: 'deny' }, { callers: ['roster'], ops: readOps, visibility: ['global', 'public'] }] });
router.register('SOPHIA', S.SOPHIA, { default: 'deny', rules: [{ callers: ['roster'], ops: ['peer_ask'] }] });
router.register('BARBELO', S.BARBELO, { default: 'deny', rules: [{ callers: ['roster'], ops: ['peer_ask'] }] });
router.register('ERATO', S.ERATO, { default: 'deny', rules: [] });
router.register('URANIA', S.URANIA, { default: 'deny', rules: [] });
await timed('LP-A01', 'relay Barbelo > Sophia > Maya: ok, provenance chain has both hops', async () => {
  const r = await S.BARBELO.run({ op: 'peer_ask', args: { to: 'SOPHIA', query: { op: 'peer_ask', args: { to: 'MAYA', query: { op: 'text_search', args: { query: 'maya', mode: 'any' } } } } } });
  const c = r.provenance_chain || []; return { pass: r.ok && c.length === 2 && c[0].agent === 'SOPHIA' && c[1].agent === 'MAYA' && c[1].records.length > 0, actual: c.map((x) => x.agent + '@' + x.hop) };
});
await timed('LP-A02', 'loop Barbelo > Maya > Barbelo: E_LOOP', async () => {
  const r = await S.BARBELO.run({ op: 'peer_ask', args: { to: 'MAYA', query: { op: 'peer_ask', args: { to: 'BARBELO', query: { op: 'pack_stats' } } } } }); return { pass: !r.ok && r.error.code === 'E_LOOP', actual: r.error };
});
await timed('LP-A03', 'hop limit: E_HOP_LIMIT', async () => {
  const r = await S.BARBELO.run({ op: 'peer_ask', args: { to: 'SOPHIA', max_hops: 1, query: { op: 'peer_ask', args: { to: 'MAYA', query: { op: 'pack_stats' } } } } }); return { pass: !r.ok && r.error.code === 'E_HOP_LIMIT', actual: r.error };
});
await timed('LP-A04', 'caller with lore_policy.read self: E_DENIED', async () => {
  const r = await S.ERATO.run({ op: 'peer_ask', args: { to: 'MAYA', query: { op: 'pack_stats' } } }); return { pass: !r.ok && r.error.code === 'E_DENIED', actual: r.error };
});
await timed('LP-A05', 'no laundering: Urania (denied by Maya) via Sophia is still denied by Maya', async () => {
  const r = await S.URANIA.run({ op: 'peer_ask', args: { to: 'SOPHIA', query: { op: 'peer_ask', args: { to: 'MAYA', query: { op: 'pack_stats' } } } } }); return { pass: !r.ok && r.error.code === 'E_DENIED' && r.error.detail.at_agent === 'MAYA', actual: r.error };
});
await timed('LP-A06', 'identity from the connection: a forged from field is overwritten', async () => {
  const env = { a2a: LP.A2A_VERSION, id: 'x', trace: 'x', from: { agent: 'MERKOS' }, to: { agent: 'MAYA' }, hop: 1, max_hops: 3, path: ['ERATO'], deadline: new Date(Date.now() + 5000).toISOString(), query: { op: 'pack_stats' } };
  const r = await router.deliver(router.peers.get('ERATO'), env); return { pass: !r.ok && r.error.code === 'E_DENIED' && env.from.agent === 'ERATO', actual: { from: env.from.agent, code: r.error && r.error.code } };
});

const sum = out.reduce((a, c) => { a[c.status] = (a[c.status] || 0) + 1; return a; }, {});
const summary = { suite: 'lorepack-player-tests', run: RUN, check: 'SUMMARY', name: 'totals', status: sum.fail ? 'fail' : 'pass', actual: sum, ts: new Date().toISOString() };
out.push(summary); process.stdout.write(JSON.stringify(summary) + '\n');
writeFileSync(join(here, 'results.jsonl'), out.map((o) => JSON.stringify(o)).join('\n') + '\n');
process.exit(sum.fail ? 1 : 0);
