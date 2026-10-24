#!/usr/bin/env node
// SYS.AI.MAYA.SESAME - lorepack player CLI (Node 18+). No dependencies.
//   node cli.mjs verify <pack> [--strict] [--tag T]           -> one JSONL check per line on stdout
//   node cli.mjs serve <pack>... [--tag T]... [--embed gemini] -> JSONL requests on stdin, JSONL responses on stdout
//   node cli.mjs caps <pack>...                                 -> capability manifest JSON
// Gemini embedder key: env GEMINI_API_KEY or --key-file <path>. The key is never written anywhere.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createInterface } from 'node:readline';
import { geminiEmbedder } from './embedder.mjs';
const require = createRequire(import.meta.url);
const LP = require('./lorepack-player.js');

const argv = process.argv.slice(2);
const cmd = argv.shift();
const files = [], tags = []; let strict = false, embedName = null, keyFile = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--strict') strict = true;
  else if (a === '--tag') tags.push(argv[++i]);
  else if (a === '--embed') embedName = argv[++i];
  else if (a === '--key-file') keyFile = argv[++i];
  else files.push(a);
}

async function loadAll(session) {
  for (let i = 0; i < files.length; i++) {
    const pack = await LP.loadPack(readFileSync(files[i]), { tag: tags[i], ref: files[i].split('/').pop() });
    session.addPack(pack);
  }
}

const fsAdapter = { kind: 'fs', get: async (ref) => { try { return readFileSync(ref); } catch { return null; } } };

if (cmd === 'verify') {
  const s = LP.createSession(); await loadAll(s);
  for (const p of s.packs.values()) for (const c of await LP.verifyPack(p, { strict })) process.stdout.write(JSON.stringify(c) + '\n');
} else if (cmd === 'caps') {
  const s = LP.createSession(); await loadAll(s); process.stdout.write(JSON.stringify(s.capabilities(), null, 1) + '\n');
} else if (cmd === 'serve') {
  let embed = null;
  if (embedName === 'gemini') {
    const key = process.env.GEMINI_API_KEY || (keyFile && readFileSync(keyFile, 'utf8').trim());
    if (key) embed = geminiEmbedder(key);
  }
  const s = LP.createSession({ embed, adapter: fsAdapter }); await loadAll(s);
  const rl = createInterface({ input: process.stdin });
  for await (const line of rl) {
    if (!line.trim()) continue;
    let req; try { req = JSON.parse(line); } catch { process.stdout.write(JSON.stringify({ ok: false, error: { code: 'E_BAD_REQUEST', message: 'not JSON' } }) + '\n'); continue; }
    process.stdout.write(JSON.stringify(await s.run(req)) + '\n');
  }
} else {
  process.stderr.write('usage: cli.mjs verify|serve|caps <pack>... [--tag T] [--strict] [--embed gemini --key-file F]\n'); process.exit(2);
}
