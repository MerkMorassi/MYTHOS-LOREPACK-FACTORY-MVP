// SYS.AI.MAYA.SESAME - agent-to-agent demo over real packs (Maya, SYS.AI.MAYA agent 015 + Barbelo 01:20 export), in-process router.
//   node run-a2a.mjs <maya.gz> <barbelo.gz> <roster.json> <out.jsonl> [--key-file F]
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { geminiEmbedderFrom } from './embedder.mjs';
const require = createRequire(import.meta.url);
const LP = require('./lorepack-player.js');

const [mayaPath, barbeloPath, rosterPath, outPath] = process.argv.slice(2);
const kf = process.argv.indexOf('--key-file');
const embed = geminiEmbedderFrom(kf > 0 ? process.argv[kf + 1] : null);
const roster = JSON.parse(readFileSync(rosterPath, 'utf8')).agents;
const router = LP.createRouter(roster);

const READ_OPS = ['capabilities_get', 'pack_stats', 'sources_list', 'vectors_search', 'text_search', 'graph_traverse', 'record_get'];
const EXPOSURE = {
  MAYA: { default: 'deny', default_visibility: 'global', rules: [
    { callers: ['MERKOS'], ops: '*', visibility: ['self', 'global', 'public'] },
    { callers: ['roster'], ops: READ_OPS.concat(['peer_ask']), visibility: ['global', 'public'] } ] },
  BARBELO: { default: 'deny', default_visibility: 'self', rules: [
    { callers: ['MERKOS'], ops: '*', visibility: ['self', 'global', 'public'] },
    { callers: ['roster'], ops: READ_OPS.concat(['peer_ask']), visibility: ['global', 'public'] } ] },
  SOPHIA: { default: 'deny', default_visibility: 'global', rules: [ { callers: ['roster'], ops: ['capabilities_get', 'peer_ask'], visibility: ['global', 'public'] } ] },
  ERATO: { default: 'deny', rules: [] },
  MERKOS: { default: 'deny', rules: [] }
};

const sessions = {};
for (const id of ['MAYA', 'BARBELO', 'SOPHIA', 'ERATO', 'MERKOS']) sessions[id] = LP.createSession({ embed });
sessions.MAYA.addPack(await LP.loadPack(readFileSync(mayaPath), { tag: 'SYS.AI.MAYA.SESAME', ref: mayaPath.split('/').pop() }));
sessions.BARBELO.addPack(await LP.loadPack(readFileSync(barbeloPath), { tag: 'SYS.AI.BARBELO.FACTORY', ref: barbeloPath.split('/').pop() }));
const locus = { MAYA: 'SYS.AI.MAYA.SESAME', BARBELO: 'SYS.AI.BARBELO.FACTORY', SOPHIA: 'SYS.AI.SOPHIA.FACTORY', ERATO: 'SYS.AI.ERATO.FACTORY', MERKOS: 'SYS.AI.MERKOS.HITL' };
for (const id of Object.keys(sessions)) router.register(id, sessions[id], EXPOSURE[id], { locus: locus[id] });

const lines = [JSON.stringify({ kind: 'setup', roster_source: 'examples/roster.mythos.json', exposure: EXPOSURE, loci: locus })];
async function scenario(name, asker, req, expect) {
  const before = router.envelopes.length;
  const resp = await sessions[asker].run(req);
  lines.push(JSON.stringify({ kind: 'scenario', name, asker, expect, request: req, envelopes: router.envelopes.slice(before), response: resp }));
  const r = resp.result && resp.result.reply;
  console.log(name, resp.ok, r ? (r.ok ? 'reply ok' : r.error && r.error.code) : resp.error && resp.error.code, JSON.stringify(resp.provenance_chain || []).slice(0, 160));
}

await scenario('A1 Barbelo asks Maya (semantic search)', 'BARBELO', { id: 'a1', op: 'peer_ask', args: { to: 'MAYA', query: { op: 'vectors_search', args: { text: 'Barbelo as a sparring partner', k: 2, max_chars: 200 } } } }, 'ok, hits visible (Maya default_visibility global)');
await scenario('A2 Barbelo -> Sophia -> Maya (relay, provenance chain)', 'BARBELO', { id: 'a2', op: 'peer_ask', args: { to: 'SOPHIA', query: { op: 'peer_ask', args: { to: 'MAYA', query: { op: 'text_search', args: { query: 'ECHOS', k: 3 } } } } } }, 'ok, chain SOPHIA hop 1 > MAYA hop 2');
await scenario('A3 Barbelo -> Maya -> Barbelo (loop)', 'BARBELO', { id: 'a3', op: 'peer_ask', args: { to: 'MAYA', query: { op: 'peer_ask', args: { to: 'BARBELO', query: { op: 'pack_stats' } } } } }, 'E_LOOP inside Maya\'s reply');
await scenario('A4 Barbelo -> Sophia -> Maya with max_hops 1', 'BARBELO', { id: 'a4', op: 'peer_ask', args: { to: 'SOPHIA', max_hops: 1, query: { op: 'peer_ask', args: { to: 'MAYA', query: { op: 'pack_stats' } } } } }, 'E_HOP_LIMIT inside Sophia\'s reply');
await scenario('A5 Erato (lore_policy.read self) asks Maya', 'ERATO', { id: 'a5', op: 'peer_ask', args: { to: 'MAYA', query: { op: 'text_search', args: { query: 'Maya' } } } }, 'E_DENIED');
await scenario('A6 Maya asks Barbelo (owner keeps records self by default)', 'MAYA', { id: 'a6', op: 'peer_ask', args: { to: 'BARBELO', query: { op: 'text_search', args: { query: 'Juno', k: 5 } } } }, 'ok but every hit hidden_by_policy');
await scenario('A7 Merkos (HITL) asks Barbelo', 'MERKOS', { id: 'a7', op: 'peer_ask', args: { to: 'BARBELO', query: { op: 'text_search', args: { query: 'Juno', k: 3 } } } }, 'ok, full read');
await scenario('A8 Barbelo asks an agent with no player', 'BARBELO', { id: 'a8', op: 'peer_ask', args: { to: 'URANIA', query: { op: 'pack_stats' } } }, 'E_PEER_UNREACHABLE');
writeFileSync(outPath, lines.join('\n') + '\n');
