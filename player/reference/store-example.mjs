import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
// node reference/store-example.mjs <maya.gz> <barbelo.gz>  -> examples/store/{catalog.json,<TAG>/pack.json}
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LP = createRequire(import.meta.url)(join(root, 'reference', 'lorepack-player.js'));
const roster = JSON.parse(readFileSync(join(root, 'examples', 'roster.mythos.json'),'utf8')).agents;
const [m,b] = process.argv.slice(2);
const out = join(root, 'examples', 'store');
const cat = { schema:'lorepack-store/catalog@0.1', updated:new Date().toISOString(), store_id:'home', packs:[] };
for (const [path, tag, num] of [[m,'SYS.AI.MAYA.SESAME','015'],[b,'SYS.AI.BARBELO.FACTORY',null]]) {
  const p = await LP.loadPack(readFileSync(path), { tag });
  const a = roster.find(x=>x.id===p.agentId);
  const file = `v/000001.${p.version.slice(0,16)}.lorepack.gz`;
  const d = { schema:'lorepack-store/pack@0.1', tag, agent:{ id:a.id, order:a.order, port:a.port, ...(num?{agent_number:num}:{}) }, space:{ model:p.model, dim:p.dim, epoch:(p.vectors[0].d||{}).embeddingEpoch||null }, writers:[a.id,'MERKOS'], head:p.version,
    versions:[{ seq:1, version:p.version, file, body_sha256:p.bodySha256, segment:'full', parents:[], counts:{vectors:p.vectors.length, edges:p.edges.length}, verified:`checks/000001.checks.jsonl`, minted_at:p.header.exportedAt, minted_by: tag==='SYS.AI.MAYA.SESAME'?'MAYA':'MERKOS', imported_from: path.split('/').pop() }],
    exposure: tag==='SYS.AI.MAYA.SESAME' ? { default:'deny', default_visibility:'global', rules:[{callers:['MERKOS'],ops:'*',visibility:['self','global','public']},{callers:['roster'],ops:['capabilities_get','pack_stats','sources_list','vectors_search','text_search','graph_traverse','record_get','peer_ask'],visibility:['global','public']}] }
      : { default:'deny', default_visibility:'self', rules:[{callers:['MERKOS'],ops:'*',visibility:['self','global','public']},{callers:['roster'],ops:['capabilities_get','pack_stats','sources_list'],visibility:['global','public']}] } };
  mkdirSync(`${out}/${tag}`, { recursive:true });
  writeFileSync(`${out}/${tag}/pack.json`, JSON.stringify(d,null,1));
  cat.packs.push({ tag, agent:a.id, head:p.version, seq:1 });
}
writeFileSync(`${out}/catalog.json`, JSON.stringify(cat,null,1));
