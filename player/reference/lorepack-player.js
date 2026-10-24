/* SYS.AI.MAYA.SESAME - lorepack-player.js
 * Reference reader + query engine for Lorepack v2 packs. Plain JS, no dependencies, no build step.
 * Runs as: <script src> (window.LorepackPlayer), require() in Node, or inlined into one HTML file.
 * Needs only: TextDecoder, DecompressionStream (gzip), crypto.subtle. All present in Node 18+ and modern browsers.
 * Contract: docs in SPEC.md. Every op is JSON in / JSON out and listed in OPS (one registry, every surface).
 */
(function (root) {
  'use strict';

  var PLAYER = { name: 'lorepack-player-ref', version: '0.1.0', author: 'SYS.AI.MAYA.SESAME' };
  var SUPPORTED_PACK_V = [2];
  var A2A_VERSION = 'lorepack-a2a/0.1';
  var LIMITS = { max_k: 50, max_hops: 3, max_edges: 500, max_chars: 4000, a2a_max_hops: 3, a2a_hard_ceiling: 4, a2a_max_fanout: 2 };
  var VAGUE_PREDICATES = ['associated with', 'references'];

  // ---------------------------------------------------------------- utils
  function nowIso() { return new Date().toISOString(); }
  function normText(t) { return String(t == null ? '' : t).normalize('NFC').replace(/\s+/g, ' ').trim().toLowerCase(); }
  function hex(buf) { var b = new Uint8Array(buf), s = ''; for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? '0' : '') + b[i].toString(16); return s; }
  async function sha256Hex(strOrBytes) {
    var bytes = typeof strOrBytes === 'string' ? new TextEncoder().encode(strOrBytes) : strOrBytes;
    return hex(await root.crypto.subtle.digest('SHA-256', bytes));
  }
  function err(code, message, detail) { var e = new Error(message); e.code = code; e.detail = detail; return e; }
  function clampInt(v, lo, hi, dflt) { v = (v == null) ? dflt : Math.floor(Number(v)); if (!isFinite(v)) v = dflt; return Math.max(lo, Math.min(hi, v)); }
  function snippet(text, needle, width) {
    width = width || 80; var low = text.toLowerCase(); var i = needle ? low.indexOf(needle) : -1;
    if (i < 0) return text.slice(0, width * 2);
    var a = Math.max(0, i - width), b = Math.min(text.length, i + needle.length + width);
    return (a > 0 ? '…' : '') + text.slice(a, b) + (b < text.length ? '…' : '');
  }

  // ---------------------------------------------------------------- decode
  async function decodeBytes(bytes) {
    var u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u8.length >= 2 && u8[0] === 0x1f && u8[1] === 0x8b) {
      var ds = new root.DecompressionStream('gzip');
      var stream = new root.Blob([u8]).stream().pipeThrough(ds);
      var buf = await new root.Response(stream).arrayBuffer();
      return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), compression: 'gzip' };
    }
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(u8), compression: 'none' };
  }

  // ---------------------------------------------------------------- load
  // Returns a pack object. Never throws on bad records: problems land in pack.diagnostics for pack_verify.
  async function loadPack(bytesOrText, opts) {
    opts = opts || {};
    var decoded;
    if (typeof bytesOrText === 'string') decoded = { text: bytesOrText, compression: 'none' };
    else {
      try { decoded = await decodeBytes(bytesOrText); }
      catch (e) { throw err('E_PACK_INVALID', 'pack could not be decoded: ' + (e && e.message), { stage: 'decode' }); }
    }
    var lines = decoded.text.split('\n');
    if (lines.length && lines[lines.length - 1] === '') lines.pop();
    var pack = {
      tag: opts.tag || null, ref: opts.ref || null, compression: decoded.compression,
      header: null, headerLine: -1, vectors: [], edges: [], byId: new Map(),
      diagnostics: { parseErrors: [], unknownTypes: [], duplicateIds: [], lineCount: lines.length },
      bodyText: '', _index: null
    };
    var bodyLines = [];
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i]; if (!line.trim()) continue;
      var r;
      try { r = JSON.parse(line); } catch (e) { pack.diagnostics.parseErrors.push({ line: i + 1, error: String(e.message).slice(0, 120) }); continue; }
      if (r && r.type === 'header') { if (!pack.header) { pack.header = r; pack.headerLine = i + 1; continue; } }
      bodyLines.push(line);
      if (!r || typeof r !== 'object') { pack.diagnostics.parseErrors.push({ line: i + 1, error: 'not an object' }); continue; }
      if (r.type === 'vector') pack.vectors.push(r);
      else if (r.type === 'edge') pack.edges.push(r);
      else if (r.type === 'manifest') { /* ignored, same as the factory reader */ }
      else { pack.diagnostics.unknownTypes.push({ line: i + 1, type: r.type }); continue; }
      if (r.id) {
        if (pack.byId.has(r.id)) pack.diagnostics.duplicateIds.push({ line: i + 1, id: r.id });
        else pack.byId.set(r.id, r);
      }
    }
    pack.bodyText = bodyLines.length ? bodyLines.join('\n') + '\n' : '';
    var h = pack.header || {};
    pack.agentId = String(h.agentId || (pack.vectors[0] && pack.vectors[0].a) || 'UNKNOWN').toUpperCase();
    pack.model = h.embeddingModel || (pack.vectors[0] && pack.vectors[0].d && pack.vectors[0].d.embeddingModel) || null;
    pack.dim = h.embeddingDimension || (pack.vectors[0] && pack.vectors[0].vec && pack.vectors[0].vec.length) || null;
    if (!pack.tag) pack.tag = 'SYS.AI.' + pack.agentId + '.' + (opts.locus || 'UNKNOWN');
    pack.bodySha256 = await sha256Hex(pack.bodyText);
    var ids = Array.from(pack.byId.keys()).sort();
    pack.version = await sha256Hex(ids.join('\n'));
    // norms once, for cosine
    for (var j = 0; j < pack.vectors.length; j++) {
      var v = pack.vectors[j].vec, n = 0;
      if (Array.isArray(v)) for (var k = 0; k < v.length; k++) n += v[k] * v[k];
      pack.vectors[j]._norm = Math.sqrt(n);
    }
    return pack;
  }

  function packRef(pack) {
    return { tag: pack.tag, version: pack.version, agent: pack.agentId, model: pack.model, dim: pack.dim };
  }

  // ---------------------------------------------------------------- indexes (lazy)
  function index(pack) {
    if (pack._index) return pack._index;
    var out = new Map(), inn = new Map(), bySrc = new Map(), entities = new Map();
    function push(m, k, v) { var a = m.get(k); if (!a) m.set(k, a = []); a.push(v); }
    pack.edges.forEach(function (e, i) {
      var s = normText(e.s), o = normText(e.o);
      push(out, s, i); push(inn, o, i); push(bySrc, e.src, i);
      if (!entities.has(s)) entities.set(s, e.s); if (!entities.has(o)) entities.set(o, e.o);
    });
    pack._index = { out: out, inn: inn, bySrc: bySrc, entities: entities };
    return pack._index;
  }

  function edgeOrigin(e) { return e.og ? (e.og === 'heuristic' ? 'heuristic' : 'model:' + e.og) : 'unknown'; }

  function provVector(pack, v, extra) {
    var p = { pack: pack.tag, version: pack.version, agent: pack.agentId, record: v.id, type: 'vector', source: v.src, chunk: v.id };
    if (extra) for (var k in extra) p[k] = extra[k];
    return p;
  }
  function provEdge(pack, e, extra) {
    var p = { pack: pack.tag, version: pack.version, agent: pack.agentId, record: e.id, type: 'edge', source: (pack.byId.get(e.src) || {}).src || null, chunk: e.src, origin: edgeOrigin(e) };
    if (extra) for (var k in extra) p[k] = extra[k];
    return p;
  }
  function publicVector(v, include, maxChars) {
    var o = { id: v.id, src: v.src, chunk_index: v.d && v.d.chunk_index, ps: v.ps || null };
    if (include.indexOf('text') >= 0) o.text = v.t; else o.text = String(v.t || '').slice(0, maxChars);
    if (include.indexOf('meta') >= 0) o.d = v.d || {};
    if (include.indexOf('vec') >= 0) o.vec = v.vec;
    return o;
  }
  function publicEdge(e) { return { id: e.id, s: e.s, r: e.r, o: e.o, src: e.src, origin: edgeOrigin(e) }; }

  // ---------------------------------------------------------------- verify (each check = one JSONL line)
  async function verifyPack(pack, opts) {
    opts = opts || {};
    var strict = !!opts.strict, pin = opts.pin || null, out = [];
    var base = { suite: 'lorepack-verify', pack: pack.tag, version: pack.version };
    function add(check, name, status, detail, extra) {
      var o = Object.assign({}, base, { check: check, name: name, status: status, detail: detail || '' }, extra || {});
      o.ts = nowIso(); out.push(o);
    }
    var h = pack.header, d = pack.diagnostics;
    add('LP-V01', 'decodes (gzip or plain UTF-8)', 'pass', pack.compression);
    add('LP-V02', 'every line is JSON', d.parseErrors.length ? 'fail' : 'pass', d.parseErrors.length ? d.parseErrors.length + ' bad line(s)' : d.lineCount + ' lines', { actual: d.parseErrors.slice(0, 10) });
    if (!h) add('LP-V03', 'header first and supported', 'fail', 'no header record');
    else if (SUPPORTED_PACK_V.indexOf(h.v) < 0) add('LP-V03', 'header first and supported', 'fail', 'pack v=' + h.v + ' not supported', { expected: SUPPORTED_PACK_V, actual: h.v });
    else add('LP-V03', 'header first and supported', pack.headerLine === 1 ? 'pass' : 'warn', 'v=' + h.v + ' at line ' + pack.headerLine);
    if (d.unknownTypes.length) add('LP-V03b', 'no unknown record types', strict ? 'fail' : 'warn', d.unknownTypes.length + ' unknown', { actual: d.unknownTypes.slice(0, 10) });
    var hv = h && h.totalVectors, he = h && h.totalEdges;
    var cOk = h && hv === pack.vectors.length && he === pack.edges.length;
    add('LP-V04', 'header counts match body', cOk ? 'pass' : 'fail', '', { expected: { vectors: hv, edges: he }, actual: { vectors: pack.vectors.length, edges: pack.edges.length } });
    var dims = {}; pack.vectors.forEach(function (v) { var n = Array.isArray(v.vec) ? v.vec.length : -1; dims[n] = (dims[n] || 0) + 1; });
    var dimKeys = Object.keys(dims);
    var wantDim = (pin && pin.dim) || (h && h.embeddingDimension);
    add('LP-V05', 'one embedding dimension, equal to header and pin', (dimKeys.length === 1 && Number(dimKeys[0]) === wantDim) ? 'pass' : 'fail', '', { expected: wantDim, actual: dims });
    var models = {}; pack.vectors.forEach(function (v) { var m = (v.d && v.d.embeddingModel) || '(none)'; models[m] = (models[m] || 0) + 1; });
    var wantModel = (pin && pin.model) || (h && h.embeddingModel);
    var mKeys = Object.keys(models);
    var modelOk = mKeys.length === 1 && mKeys[0] === wantModel && (!pin || !h || h.embeddingModel === pin.model);
    add('LP-V06', 'one embedding model (identity, not only dimension)', modelOk ? 'pass' : 'fail', '', { expected: wantModel, actual: models });
    var bad = []; pack.vectors.forEach(function (v) { if (!Array.isArray(v.vec) || !(v._norm > 0) || v.vec.some(function (x) { return typeof x !== 'number' || !isFinite(x); })) bad.push(v.id); });
    add('LP-V07', 'vectors finite and non-zero', bad.length ? 'fail' : 'pass', bad.length + ' bad', { actual: bad.slice(0, 10) });
    add('LP-V08', 'record ids unique', d.duplicateIds.length ? 'fail' : 'pass', d.duplicateIds.length + ' duplicate(s)', { actual: d.duplicateIds.slice(0, 10) });
    var orphans = pack.edges.filter(function (e) { var t = pack.byId.get(e.src); return !t || t.type !== 'vector'; }).map(function (e) { return e.id; });
    add('LP-V09', 'no orphan edges (edge.src is a vector in this pack)', orphans.length ? 'fail' : 'pass', orphans.length + ' orphan(s)', { actual: orphans.slice(0, 10) });
    // content-addressed ids: node-v2 = sha256(AGENT:src:norm(text)); node-v1 (stock) = sha256(AGENT:trim(lower(text)))
    var v1 = 0, v2 = 0, neither = [];
    for (var i = 0; i < pack.vectors.length; i++) {
      var v = pack.vectors[i], a = String(v.a || pack.agentId).toUpperCase();
      var id2 = 'lp_node_' + await sha256Hex(a + ':' + v.src + ':' + normText(v.t));
      if (id2 === v.id) { v2++; continue; }
      var h1 = await sha256Hex(a + ':' + String(v.t || '').trim().toLowerCase());
      if ('lp_node_' + h1 === v.id || 'lp_chat_' + h1 === v.id) { v1++; continue; }  // node-v1 and the live chat-ingest id (packer.ts ingestChat)
      neither.push(v.id);
    }
    var scheme = v2 && !v1 ? 'node-v2' : (v1 && !v2 ? 'node-v1' : (v1 || v2 ? 'mixed' : 'unknown'));
    pack.idScheme = scheme;
    add('LP-V10', 'vector ids are content hashes', neither.length ? 'fail' : (scheme === 'mixed' ? 'warn' : 'pass'), 'scheme ' + scheme + (scheme === 'node-v1' ? ' (stock: same text in two sources collides)' : ''), { actual: { node_v2: v2, node_v1: v1, mismatched: neither.length, sample: neither.slice(0, 5) } });
    var badE = [];
    for (var j = 0; j < pack.edges.length; j++) {
      var e = pack.edges[j];
      var eid = 'lp_edge_' + await sha256Hex((e.aid + ':' + e.src + ':' + e.s + ':' + e.r + ':' + e.o).toLowerCase());
      if (eid !== e.id) badE.push(e.id);
    }
    add('LP-V11', 'edge ids are content hashes', badE.length ? 'fail' : 'pass', badE.length + ' mismatched', { actual: badE.slice(0, 5) });
    var og = { model: 0, heuristic: 0, unknown: 0 };
    pack.edges.forEach(function (e) { og[edgeOrigin(e).split(':')[0]]++; });
    var unst = og.unknown;
    add('LP-V12', 'origin stamped on every edge', unst ? (strict ? 'fail' : 'warn') : (og.heuristic ? 'warn' : 'pass'), unst ? unst + ' edge(s) without og (legacy pack: filler cannot be told from model output)' : (og.heuristic ? og.heuristic + ' heuristic edge(s)' : 'all edges model-made'), { actual: og });
    var seen = new Map(), dup = 0;
    pack.edges.forEach(function (e) { var k = e.src + '|' + normText(e.s) + '|' + normText(e.r) + '|' + normText(e.o); if (seen.has(k)) dup++; else seen.set(k, 1); });
    add('LP-V13', 'no duplicate triplets within a chunk', dup ? 'fail' : 'pass', dup + ' duplicate(s) (rebuild without clearing old edges?)', { actual: dup });
    var ps = {}, idx = index(pack), zero = 0;
    pack.vectors.forEach(function (v) { var s = v.ps || '(absent)'; ps[s] = (ps[s] || 0) + 1; if (!idx.bySrc.has(v.id)) zero++; });
    var notDone = pack.vectors.length - (ps.completed || 0) - (ps['(absent)'] || 0);
    add('LP-V14', 'chunk processing status', notDone ? 'warn' : 'pass', zero + ' chunk(s) with 0 edges' + (ps.completed ? ' (completed with [] is a valid answer)' : ''), { actual: { ps: ps, chunks_without_edges: zero } });
    if (h && h.bodySha256) add('LP-V15', 'body hash matches header', h.bodySha256 === pack.bodySha256 ? 'pass' : 'fail', '', { expected: h.bodySha256, actual: pack.bodySha256 });
    else add('LP-V15', 'body hash matches header', strict ? 'fail' : 'skip', 'header has no bodySha256 (v2 legacy)', { actual: pack.bodySha256 });
    var rt = serializePack(pack, { keepHeader: true });
    var re = await loadPack(rt, { tag: pack.tag });
    var rtOk = re.version === pack.version && re.vectors.length === pack.vectors.length && re.edges.length === pack.edges.length && re.diagnostics.parseErrors.length === 0;
    add('LP-V16', 'round trip (serialize, re-read, same record set)', rtOk ? 'pass' : 'fail', '', { expected: pack.version, actual: re.version });
    var empty = pack.vectors.filter(function (v) { return !String(v.t || '').trim(); }).map(function (v) { return v.id; });
    add('LP-V17', 'chunk text present', empty.length ? 'fail' : 'pass', empty.length + ' empty', { actual: empty.slice(0, 5) });
    var foreign = pack.vectors.filter(function (v) { return String(v.a || '').toUpperCase() !== pack.agentId; }).length + pack.edges.filter(function (e) { return String(e.aid || '').toUpperCase() !== pack.agentId; }).length;
    add('LP-V18', 'one owner agent per pack', foreign ? 'fail' : 'pass', foreign + ' foreign record(s)', { expected: pack.agentId });
    return out;
  }

  async function detectIdScheme(pack) {
    var v1 = 0, v2 = 0, n = Math.min(20, pack.vectors.length);
    for (var i = 0; i < n; i++) {
      var v = pack.vectors[i], a = String(v.a || pack.agentId).toUpperCase();
      if ('lp_node_' + await sha256Hex(a + ':' + v.src + ':' + normText(v.t)) === v.id) v2++;
      else if ('lp_node_' + await sha256Hex(a + ':' + String(v.t || '').trim().toLowerCase()) === v.id) v1++;
    }
    return v2 === n && n ? 'node-v2' : (v1 === n && n ? 'node-v1' : (v1 || v2 ? 'mixed' : 'unknown'));
  }

  function serializePack(pack, opts) {
    var lines = [];
    if (opts && opts.keepHeader && pack.header) lines.push(JSON.stringify(pack.header));
    pack.vectors.forEach(function (v) { lines.push(JSON.stringify(v, function (k, val) { return k === '_norm' ? undefined : val; })); });
    pack.edges.forEach(function (e) { lines.push(JSON.stringify(e)); });
    return lines.join('\n') + '\n';
  }

  // ---------------------------------------------------------------- stats
  function packStats(pack, args) {
    var top = clampInt(args && args.top, 1, 100, 10), idx = index(pack);
    var preds = new Map(), og = {};
    pack.edges.forEach(function (e) { var r = normText(e.r); preds.set(r, (preds.get(r) || 0) + 1); var o = edgeOrigin(e); og[o] = (og[o] || 0) + 1; });
    var predList = Array.from(preds.entries()).sort(function (a, b) { return b[1] - a[1] || (a[0] < b[0] ? -1 : 1); }).slice(0, top).map(function (p) { return { predicate: p[0], edges: p[1], share: pack.edges.length ? +(p[1] / pack.edges.length).toFixed(4) : 0 }; });
    // disconnected entity groups (union-find over subject/object names). Not "semantic clusters".
    var parent = new Map();
    function find(x) { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; }
    function uni(a, b) { if (!parent.has(a)) parent.set(a, a); if (!parent.has(b)) parent.set(b, b); var ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb); }
    pack.edges.forEach(function (e) { uni(normText(e.s), normText(e.o)); });
    var groups = new Map(); parent.forEach(function (_, k) { var r = find(k); groups.set(r, (groups.get(r) || 0) + 1); });
    var sizes = Array.from(groups.values()).sort(function (a, b) { return b - a; });
    var gdup = new Map(), gd = 0; pack.edges.forEach(function (e) { var k = normText(e.s) + '|' + normText(e.r) + '|' + normText(e.o); if (gdup.has(k)) gd++; else gdup.set(k, 1); });
    var vague = pack.edges.filter(function (e) { return VAGUE_PREDICATES.indexOf(normText(e.r)) >= 0; }).length;
    var sources = new Set(pack.vectors.map(function (v) { return v.src; }));
    var ps = {}; var zero = 0; pack.vectors.forEach(function (v) { var s = v.ps || '(absent)'; ps[s] = (ps[s] || 0) + 1; if (!idx.bySrc.has(v.id)) zero++; });
    return {
      pack: packRef(pack), id_scheme: pack.idScheme || null,
      counts: { vectors: pack.vectors.length, edges: pack.edges.length, sources: sources.size, entities: idx.entities.size, chunks_without_edges: zero },
      processing_status: ps, edge_origin: og, top_predicates: predList,
      duplicate_triplets_across_chunks: gd,
      vague_predicate_share: pack.edges.length ? +(vague / pack.edges.length).toFixed(4) : 0,
      entity_groups: { count: sizes.length, largest: sizes[0] || 0, singletons_of_two: sizes.filter(function (s) { return s === 2; }).length, note: 'disconnected groups of subject/object names, not semantic clusters' },
      header: pack.header ? { v: pack.header.v, exportedAt: pack.header.exportedAt, bodySha256: pack.header.bodySha256 || null } : null,
      body_sha256: pack.bodySha256
    };
  }

  function sourcesList(pack) {
    var idx = index(pack), m = new Map();
    pack.vectors.forEach(function (v) {
      var s = m.get(v.src); if (!s) m.set(v.src, s = { source: v.src, chunks: 0, edges: 0, chunks_without_edges: 0, first_ts: null, last_ts: null });
      s.chunks++; var n = (idx.bySrc.get(v.id) || []).length; s.edges += n; if (!n) s.chunks_without_edges++;
      var ts = v.d && v.d.timestamp; if (ts) { if (!s.first_ts || ts < s.first_ts) s.first_ts = ts; if (!s.last_ts || ts > s.last_ts) s.last_ts = ts; }
    });
    return Array.from(m.values()).sort(function (a, b) { return a.source < b.source ? -1 : 1; });
  }

  // ---------------------------------------------------------------- search
  function cosine(q, qn, v) { var dot = 0; for (var i = 0; i < q.length; i++) dot += q[i] * v.vec[i]; return v._norm > 0 && qn > 0 ? dot / (qn * v._norm) : 0; }

  async function vectorsSearch(pack, args, ctx) {
    var k = clampInt(args.k, 1, LIMITS.max_k, 5), minScore = args.min_score == null ? -1 : Number(args.min_score);
    var include = args.include || [], maxChars = clampInt(args.max_chars, 0, LIMITS.max_chars, 400);
    var q, qModel, how;
    if (args.like_id) {
      var rec = pack.byId.get(args.like_id); if (!rec || rec.type !== 'vector') throw err('E_NOT_FOUND', 'like_id is not a vector in this pack', { like_id: args.like_id });
      q = rec.vec; qModel = pack.model; how = 'like_id';
    } else if (args.vector) {
      if (!args.model) throw err('E_BAD_REQUEST', 'vector queries must name the model that made the vector');
      q = args.vector; qModel = args.model; how = 'vector';
    } else if (args.text != null) {
      if (!ctx || typeof ctx.embed !== 'function') throw err('E_NO_EMBEDDER', 'text search needs an embedder for ' + pack.model + '; no silent keyword fallback. Use text_search, like_id, or a vector.');
      var em = await ctx.embed(String(args.text), { model: pack.model, dim: pack.dim });
      q = em.vector; qModel = em.model; how = 'text';
    } else throw err('E_BAD_REQUEST', 'one of text, vector, like_id is required');
    if (qModel !== pack.model) throw err('E_SPACE_MISMATCH', 'query vector model ' + qModel + ' is not the pack model ' + pack.model, { query_model: qModel, pack_model: pack.model });
    if (!Array.isArray(q) || q.length !== pack.dim) throw err('E_SPACE_MISMATCH', 'query dimension ' + (q && q.length) + ' is not ' + pack.dim);
    var qn = 0; for (var i = 0; i < q.length; i++) qn += q[i] * q[i]; qn = Math.sqrt(qn);
    var srcFilter = args.sources ? new Set(args.sources) : null;
    var scored = [];
    pack.vectors.forEach(function (v) {
      if (srcFilter && !srcFilter.has(v.src)) return;
      if (args.like_id && args.exclude_self !== false && v.id === args.like_id) return;
      if (!Array.isArray(v.vec) || v.vec.length !== q.length) return;
      var s = cosine(q, qn, v); if (s >= minScore) scored.push([s, v]);
    });
    scored.sort(function (a, b) { return b[0] - a[0] || (a[1].id < b[1].id ? -1 : 1); });
    var idx = index(pack);
    var hits = scored.slice(0, k).map(function (p, rank) {
      var h = publicVector(p[1], include, maxChars); h.score = +p[0].toFixed(6); h.rank = rank + 1;
      if (include.indexOf('edges') >= 0) h.edges = (idx.bySrc.get(p[1].id) || []).map(function (i) { return publicEdge(pack.edges[i]); });
      return h;
    });
    return {
      result: { query: { mode: how, model: qModel, dim: q.length }, scanned: scored.length === 0 ? pack.vectors.length : pack.vectors.length, hits: hits },
      provenance: hits.map(function (h) { return provVector(pack, pack.byId.get(h.id), { score: h.score }); })
    };
  }

  function textSearch(pack, args) {
    var q = normText(args.query || ''); if (!q) throw err('E_BAD_REQUEST', 'query is required');
    var mode = args.mode || 'all', k = clampInt(args.k, 1, LIMITS.max_k, 10), maxChars = clampInt(args.max_chars, 0, LIMITS.max_chars, 240);
    var terms = mode === 'phrase' ? [q] : q.split(' ').filter(Boolean);
    var scope = args.scope || ['chunks', 'edges'];
    function count(hay, t) { var n = 0, i = 0; while ((i = hay.indexOf(t, i)) >= 0) { n++; i += t.length; } return n; }
    function score(hay) {
      var total = 0, hitTerms = 0;
      terms.forEach(function (t) { var c = count(hay, t); total += c; if (c) hitTerms++; });
      if (mode === 'all' && hitTerms < terms.length) return 0; return total;
    }
    var hits = [];
    if (scope.indexOf('chunks') >= 0) pack.vectors.forEach(function (v) { var s = score(normText(v.t)); if (s) hits.push({ kind: 'chunk', id: v.id, src: v.src, matches: s, snippet: snippet(String(v.t).replace(/\s+/g, ' '), terms[0], Math.floor(maxChars / 2)) }); });
    if (scope.indexOf('edges') >= 0) pack.edges.forEach(function (e) { var s = score(normText(e.s + ' ' + e.r + ' ' + e.o)); if (s) { var h = publicEdge(e); h.kind = 'edge'; h.matches = s; hits.push(h); } });
    hits.sort(function (a, b) { return b.matches - a.matches || (a.id < b.id ? -1 : 1); });
    var total = hits.length; hits = hits.slice(0, k);
    return {
      result: { query: { terms: terms, mode: mode, scope: scope }, total_matches: total, hits: hits },
      provenance: hits.map(function (h) { var r = pack.byId.get(h.id); return h.kind === 'edge' ? provEdge(pack, r, { matches: h.matches }) : provVector(pack, r, { matches: h.matches }); })
    };
  }

  // ---------------------------------------------------------------- graph
  function graphTraverse(pack, args) {
    var idx = index(pack), hops = clampInt(args.hops, 1, LIMITS.max_hops, 1), maxEdges = clampInt(args.max_edges, 1, LIMITS.max_edges, 100);
    var dir = args.direction || 'both', inclH = !!args.include_heuristic;
    var exclP = new Set((args.exclude_predicates || []).map(normText)), onlyP = args.predicates ? new Set(args.predicates.map(normText)) : null;
    var starts = [];
    if (args.chunk_id) {
      var es = idx.bySrc.get(args.chunk_id); if (!pack.byId.has(args.chunk_id)) throw err('E_NOT_FOUND', 'chunk not in pack', { chunk_id: args.chunk_id });
      (es || []).forEach(function (i) { starts.push(normText(pack.edges[i].s)); });
    }
    (args.start || []).forEach(function (s) { starts.push(normText(s)); });
    starts = Array.from(new Set(starts));
    var missing = starts.filter(function (s) { return !idx.entities.has(s); });
    if (!starts.length || missing.length === starts.length) {
      var probe = normText((args.start || [])[0] || '');
      var sugg = probe ? Array.from(idx.entities.keys()).filter(function (k) { return k.indexOf(probe) >= 0; }).slice(0, 10) : [];
      throw err('E_NOT_FOUND', 'no start entity found in the graph', { start: args.start || [], suggestions: sugg });
    }
    var depth = new Map(); starts.forEach(function (s) { if (idx.entities.has(s)) depth.set(s, 0); });
    var frontier = Array.from(depth.keys()), taken = new Map(), truncated = false;
    function ok(e) { if (!inclH && e.og === 'heuristic') return false; var r = normText(e.r); if (exclP.has(r)) return false; if (onlyP && !onlyP.has(r)) return false; return true; }
    for (var h = 1; h <= hops && frontier.length && !truncated; h++) {
      var next = [];
      for (var f = 0; f < frontier.length && !truncated; f++) {
        var ent = frontier[f], cand = [];
        if (dir !== 'in') (idx.out.get(ent) || []).forEach(function (i) { cand.push([i, normText(pack.edges[i].o)]); });
        if (dir !== 'out') (idx.inn.get(ent) || []).forEach(function (i) { cand.push([i, normText(pack.edges[i].s)]); });
        for (var c = 0; c < cand.length; c++) {
          var e = pack.edges[cand[c][0]]; if (taken.has(e.id) || !ok(e)) continue;
          if (taken.size >= maxEdges) { truncated = true; break; }
          taken.set(e.id, h);
          var other = cand[c][1]; if (!depth.has(other)) { depth.set(other, h); next.push(other); }
        }
      }
      frontier = next;
    }
    var edges = Array.from(taken.entries()).map(function (p) { var e = pack.byId.get(p[0]); var o = publicEdge(e); o.hop = p[1]; return o; });
    var nodes = Array.from(depth.entries()).map(function (p) { return { entity: idx.entities.get(p[0]), key: p[0], hop: p[1], degree: (idx.out.get(p[0]) || []).length + (idx.inn.get(p[0]) || []).length }; });
    nodes.sort(function (a, b) { return a.hop - b.hop || b.degree - a.degree || (a.key < b.key ? -1 : 1); });
    return {
      result: { start: starts, hops: hops, direction: dir, include_heuristic: inclH, truncated: truncated, nodes: nodes, edges: edges, missing_start: missing },
      provenance: edges.map(function (e) { return provEdge(pack, pack.byId.get(e.id), { hop: e.hop }); })
    };
  }

  function recordGet(pack, args) {
    var r = pack.byId.get(args.id); if (!r) throw err('E_NOT_FOUND', 'no record with that id', { id: args.id });
    var include = args.include || ['text', 'meta', 'edges'];
    if (r.type === 'vector') {
      var o = publicVector(r, include, LIMITS.max_chars);
      var es = (index(pack).bySrc.get(r.id) || []).map(function (i) { return publicEdge(pack.edges[i]); });
      if (include.indexOf('edges') >= 0) o.edges = es;
      return { result: { type: 'vector', record: o }, provenance: [provVector(pack, r)] };
    }
    var e = publicEdge(r); var src = pack.byId.get(r.src);
    e.chunk = src ? { id: src.id, src: src.src, text: String(src.t).slice(0, 400) } : null;
    return { result: { type: 'edge', record: e }, provenance: [provEdge(pack, r)].concat(src ? [provVector(pack, src)] : []) };
  }

  // ---------------------------------------------------------------- tiny JSON Schema subset validator (type, required, enum, min/max, items, additionalProperties:false)
  function validate(schema, val, path) {
    path = path || '$'; var errs = [];
    if (!schema) return errs;
    var t = schema.type;
    function typeOf(v) { return Array.isArray(v) ? 'array' : (v === null ? 'null' : (typeof v === 'number' && Number.isInteger(v) ? 'integer' : typeof v)); }
    if (t) { var vt = typeOf(val), ts = [].concat(t); if (!(ts.indexOf(vt) >= 0 || (vt === 'integer' && ts.indexOf('number') >= 0))) { errs.push(path + ' must be ' + ts.join('|')); return errs; } }
    if (schema.enum && schema.enum.indexOf(val) < 0) errs.push(path + ' must be one of ' + schema.enum.join(', '));
    if (typeof val === 'number') { if (schema.minimum != null && val < schema.minimum) errs.push(path + ' < ' + schema.minimum); if (schema.maximum != null && val > schema.maximum) errs.push(path + ' > ' + schema.maximum); }
    if (typeof val === 'string' && schema.minLength && val.length < schema.minLength) errs.push(path + ' too short');
    if (Array.isArray(val)) { if (schema.maxItems != null && val.length > schema.maxItems) errs.push(path + ' has more than ' + schema.maxItems + ' items'); if (schema.items) val.forEach(function (x, i) { errs = errs.concat(validate(schema.items, x, path + '[' + i + ']')); }); }
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      (schema.required || []).forEach(function (k) { if (!(k in val)) errs.push(path + '.' + k + ' is required'); });
      var props = schema.properties || {};
      Object.keys(val).forEach(function (k) { if (props[k]) errs = errs.concat(validate(props[k], val[k], path + '.' + k)); else if (schema.additionalProperties === false) errs.push(path + '.' + k + ' is not allowed'); });
    }
    return errs;
  }

  // ---------------------------------------------------------------- the op registry (one registry -> JS API, JSONL stdio, HTTP, MCP tools, DOM forms)
  var S = { str: { type: 'string', minLength: 1 }, strs: { type: 'array', items: { type: 'string' }, maxItems: 50 }, include: { type: 'array', items: { type: 'string', enum: ['text', 'meta', 'vec', 'edges'] } } };
  var OPS = [
    { name: 'capabilities_get', title: 'Describe this player', readOnly: true, packArg: false, description: 'Capability manifest: ops with input schemas, loaded packs, limits, embedder, a2a settings.', input: { type: 'object', additionalProperties: false, properties: {} } },
    { name: 'pack_load', title: 'Load a pack', readOnly: true, packArg: false, description: 'Load a pack from a store key, path or URL through the host adapter. Optional expect{} pins agent, model, dim or version and refuses on mismatch.', input: { type: 'object', additionalProperties: false, required: ['ref'], properties: { ref: S.str, tag: S.str, expect: { type: 'object', additionalProperties: false, properties: { agent: S.str, model: S.str, dim: { type: 'integer' }, version: S.str } } } } },
    { name: 'pack_verify', title: 'Verify a pack', readOnly: true, description: 'Run the integrity checks LP-V01..LP-V18. Returns one check object per line-able entry.', input: { type: 'object', additionalProperties: false, properties: { pack: S.str, strict: { type: 'boolean' }, pin: { type: 'object', properties: { model: S.str, dim: { type: 'integer' } } } } } },
    { name: 'pack_stats', title: 'Pack statistics', readOnly: true, description: 'Counts, processing status, edge origin mix, top predicates, disconnected entity groups.', input: { type: 'object', additionalProperties: false, properties: { pack: S.str, top: { type: 'integer', minimum: 1, maximum: 100 } } } },
    { name: 'sources_list', title: 'List sources', readOnly: true, description: 'One row per source file: chunks, edges, chunks without edges, first and last ingest time.', input: { type: 'object', additionalProperties: false, properties: { pack: S.str } } },
    { name: 'vectors_search', title: 'Semantic search', readOnly: true, description: 'Cosine top-k over the pack vectors. Query by text (needs an embedder in the pack model), by a vector with its model, or like_id. Never falls back to keywords.', input: { type: 'object', additionalProperties: false, properties: { pack: S.str, text: { type: 'string' }, vector: { type: 'array', items: { type: 'number' } }, model: S.str, like_id: S.str, exclude_self: { type: 'boolean' }, k: { type: 'integer', minimum: 1, maximum: 50 }, min_score: { type: 'number', minimum: -1, maximum: 1 }, sources: S.strs, include: S.include, max_chars: { type: 'integer', minimum: 0, maximum: 4000 } } } },
    { name: 'text_search', title: 'Keyword search', readOnly: true, description: 'Case-insensitive substring search over chunk text and edge s/r/o. Modes all, any, phrase. Deterministic.', input: { type: 'object', additionalProperties: false, required: ['query'], properties: { pack: S.str, query: S.str, mode: { type: 'string', enum: ['all', 'any', 'phrase'] }, scope: { type: 'array', items: { type: 'string', enum: ['chunks', 'edges'] } }, k: { type: 'integer', minimum: 1, maximum: 50 }, max_chars: { type: 'integer', minimum: 0, maximum: 4000 } } } },
    { name: 'graph_traverse', title: 'Graph walk', readOnly: true, description: 'k-hop walk (max 3) over the entity graph from start entities or a chunk. Heuristic edges excluded unless asked.', input: { type: 'object', additionalProperties: false, properties: { pack: S.str, start: S.strs, chunk_id: S.str, hops: { type: 'integer', minimum: 1, maximum: 3 }, direction: { type: 'string', enum: ['out', 'in', 'both'] }, predicates: S.strs, exclude_predicates: S.strs, include_heuristic: { type: 'boolean' }, max_edges: { type: 'integer', minimum: 1, maximum: 500 } } } },
    { name: 'record_get', title: 'Get a record', readOnly: true, description: 'One record by id. Vectors come with their edges; edges come with their source chunk.', input: { type: 'object', additionalProperties: false, required: ['id'], properties: { pack: S.str, id: S.str, include: S.include } } },
    { name: 'peer_ask', title: 'Ask another agent', readOnly: true, packArg: false, description: 'Send a query to another agent\'s player in an a2a envelope. Subject to the target\'s exposure policy, loop and hop limits.', input: { type: 'object', additionalProperties: false, required: ['to', 'query'], properties: { to: S.str, query: { type: 'object' }, max_hops: { type: 'integer', minimum: 1, maximum: 4 } } } }
  ];
  var OPS_BY_NAME = {}; OPS.forEach(function (o) { OPS_BY_NAME[o.name] = o; });

  // ---------------------------------------------------------------- session: holds loaded packs, runs requests
  function createSession(opts) {
    opts = opts || {};
    var packs = new Map(), lastVerify = new Map();
    var s = {
      packs: packs, embed: opts.embed || null, adapter: opts.adapter || null, peer: null,
      addPack: function (pack) { packs.set(pack.tag, pack); return packRef(pack); },
      resolve: function (name) {
        if (!name) { if (packs.size === 1) return packs.values().next().value; throw err('E_BAD_REQUEST', packs.size ? 'several packs loaded: name one in "pack"' : 'no pack loaded'); }
        var tag = name.split('@')[0], ver = name.split('@')[1]; var p = packs.get(tag);
        if (!p) throw err('E_NOT_FOUND', 'pack not loaded: ' + tag, { loaded: Array.from(packs.keys()) });
        if (ver && p.version.indexOf(ver) !== 0) throw err('E_VERSION', 'loaded version ' + p.version.slice(0, 16) + ' is not ' + ver);
        return p;
      },
      capabilities: function () { return capabilities(s); },
      run: function (req, extraCtx) { return runRequest(s, req, extraCtx); }
    };
    return s;
  }

  function capabilities(session) {
    return {
      schema: 'lorepack-player/capabilities@0.1', afc: 'AFC-0.1',
      player: Object.assign({ runtime: (typeof window !== 'undefined' ? 'browser' : 'node') }, PLAYER),
      pack_format: { v: SUPPORTED_PACK_V, encodings: ['jsonl', 'jsonl+gzip'], id_schemes: ['node-v1', 'node-v2', 'edge-v1'] },
      packs: Array.from(session.packs.values()).map(function (p) { return Object.assign(packRef(p), { counts: { vectors: p.vectors.length, edges: p.edges.length }, body_sha256: p.bodySha256 }); }),
      ops: OPS.map(function (o) { return { name: o.name, title: o.title, description: o.description, readOnly: o.readOnly, destructive: false, input: o.input }; }),
      limits: LIMITS,
      embedder: session.embed ? { available: true, model: session.embed.model || null, dim: session.embed.dim || null } : { available: false },
      a2a: { envelope: A2A_VERSION, agent: session.peer ? session.peer.agent : null, max_hops: LIMITS.a2a_max_hops, hard_ceiling: LIMITS.a2a_hard_ceiling, max_fanout: LIMITS.a2a_max_fanout },
      errors: ['E_BAD_REQUEST', 'E_UNKNOWN_OP', 'E_NOT_FOUND', 'E_NO_EMBEDDER', 'E_SPACE_MISMATCH', 'E_PACK_INVALID', 'E_VERSION', 'E_LIMIT', 'E_DENIED', 'E_LOOP', 'E_HOP_LIMIT', 'E_DEADLINE', 'E_PEER_UNREACHABLE', 'E_INTERNAL']
    };
  }

  async function runRequest(session, req, extraCtx) {
    var t0 = Date.now();
    var resp = { id: req && req.id != null ? req.id : null, op: req && req.op, ok: false };
    try {
      if (!req || typeof req !== 'object' || !req.op) throw err('E_BAD_REQUEST', 'request needs op');
      var def = OPS_BY_NAME[req.op]; if (!def) throw err('E_UNKNOWN_OP', 'unknown op ' + req.op, { ops: OPS.map(function (o) { return o.name; }) });
      var args = Object.assign({}, req.args || {}); if (req.pack && args.pack == null && def.packArg !== false) args.pack = req.pack;
      var v = validate(def.input, args); if (v.length) throw err('E_BAD_REQUEST', 'args do not match the input schema', { errors: v });
      var ctx = Object.assign({ embed: session.embed }, extraCtx || {});
      var out;
      if (def.name === 'capabilities_get') out = { result: capabilities(session), provenance: [] };
      else if (def.name === 'pack_load') {
        if (!session.adapter) throw err('E_BAD_REQUEST', 'this host has no storage adapter; load packs through the host');
        var bytes = await session.adapter.get(args.ref); if (!bytes) throw err('E_NOT_FOUND', 'nothing at ref', { ref: args.ref });
        var pk = await loadPack(bytes, { tag: args.tag, ref: args.ref });
        var ex = args.expect || {};
        if (ex.agent && ex.agent.toUpperCase() !== pk.agentId) throw err('E_PACK_INVALID', 'agent is ' + pk.agentId, { expected: ex.agent });
        if (ex.model && ex.model !== pk.model) throw err('E_SPACE_MISMATCH', 'model is ' + pk.model, { expected: ex.model });
        if (ex.dim && ex.dim !== pk.dim) throw err('E_SPACE_MISMATCH', 'dim is ' + pk.dim, { expected: ex.dim });
        if (ex.version && pk.version.indexOf(ex.version) !== 0) throw err('E_VERSION', 'version is ' + pk.version, { expected: ex.version });
        session.addPack(pk);
        out = { result: { loaded: Object.assign(packRef(pk), { counts: { vectors: pk.vectors.length, edges: pk.edges.length }, body_sha256: pk.bodySha256, header_v: pk.header && pk.header.v }) }, provenance: [{ pack: pk.tag, version: pk.version, agent: pk.agentId, record: null, type: 'pack', source: args.ref }] };
      }
      else if (def.name === 'peer_ask') {
        if (!session.peer) throw err('E_BAD_REQUEST', 'this session is not wired as an a2a peer');
        out = await session.peer.ask(args.to, args.query, Object.assign({ max_hops: args.max_hops }, ctx.envelope ? { parent: ctx.envelope } : {}));
      }
      else {
        var pack = session.resolve(args.pack);
        if (ctx.policyFilter) ctx.policyFilter(def.name, pack);
        if (def.name === 'pack_verify') { var checks = await verifyPack(pack, { strict: args.strict, pin: args.pin }); out = { result: { summary: summarize(checks), checks: checks }, provenance: [{ pack: pack.tag, version: pack.version, agent: pack.agentId, record: null, type: 'pack', source: pack.ref }] }; }
        else if (def.name === 'pack_stats') { if (!pack.idScheme) pack.idScheme = await detectIdScheme(pack); out = { result: packStats(pack, args), provenance: [{ pack: pack.tag, version: pack.version, agent: pack.agentId, record: null, type: 'pack', source: pack.ref }] }; }
        else if (def.name === 'sources_list') { var srcs = sourcesList(pack); out = { result: { sources: srcs }, provenance: [{ pack: pack.tag, version: pack.version, agent: pack.agentId, record: null, type: 'pack', source: pack.ref }] }; }
        else if (def.name === 'vectors_search') out = await vectorsSearch(pack, args, ctx);
        else if (def.name === 'text_search') out = textSearch(pack, args);
        else if (def.name === 'graph_traverse') out = graphTraverse(pack, args);
        else if (def.name === 'record_get') out = recordGet(pack, args);
        if (ctx.recordFilter) out = ctx.recordFilter(out, pack);
        resp.pack = packRef(pack);
      }
      resp.ok = true; resp.result = out.result; resp.provenance = out.provenance || [];
      if (out.provenance_chain) resp.provenance_chain = out.provenance_chain;
      // a peer_ask is ok only if the remote answer is ok; the failure keeps the agent and hop where it happened
      var rp = def.name === 'peer_ask' && out.result && out.result.reply;
      if (rp && !rp.ok) {
        var inner = rp.error || {}; resp.ok = false;
        resp.error = { code: inner.code || 'E_INTERNAL', message: inner.message || 'peer failed', detail: Object.assign({ at_agent: (inner.detail && inner.detail.at_agent) || rp.from.agent, hop: (inner.detail && inner.detail.hop) || rp.hop }, inner.detail || {}) };
      }
    } catch (e) {
      resp.ok = false; resp.error = { code: e.code || 'E_INTERNAL', message: String(e.message || e) }; if (e.detail) resp.error.detail = e.detail;
      resp.provenance = [];
    }
    resp.meta = { player: PLAYER.name + '@' + PLAYER.version, elapsed_ms: Date.now() - t0, ts: nowIso() };
    return resp;
  }

  function summarize(checks) { var s = { pass: 0, fail: 0, warn: 0, skip: 0 }; checks.forEach(function (c) { s[c.status] = (s[c.status] || 0) + 1; }); s.ok = s.fail === 0; return s; }

  // ---------------------------------------------------------------- agent-to-agent (in-process router; same envelopes go over HTTP/WS)
  // roster: [{id, order, port, lore_policy:{read,write}}]. exposure: per pack owner (see SPEC 5.4).
  function createRouter(roster) {
    var peers = new Map(), byId = new Map(); (roster || []).forEach(function (a) { byId.set(a.id, a); });
    var router = {
      roster: byId, peers: peers, log: [], envelopes: [],
      register: function (agentId, session, exposure, opts) {
        var p = createPeer(router, agentId, session, exposure || { default: 'deny', rules: [] }, opts || {});
        peers.set(agentId, p); session.peer = p; return p;
      },
      // identity comes from the connection (the peer object), never from the envelope body
      deliver: async function (fromPeer, env) {
        env.from = { agent: fromPeer.agent, order: (byId.get(fromPeer.agent) || {}).order, locus: fromPeer.locus };
        router.log.push({ ts: nowIso(), id: env.id, from: env.from.agent, to: env.to.agent, hop: env.hop, path: env.path.slice() });
        router.envelopes.push(JSON.parse(JSON.stringify(env)));
        var target = peers.get(env.to.agent);
        if (!target) return reply(env, null, err('E_PEER_UNREACHABLE', 'no player registered for ' + env.to.agent));
        return target.handle(env);
      }
    };
    return router;
  }

  function newId() { var a = new Uint8Array(8); root.crypto.getRandomValues(a); return 'a2a_' + hex(a); }

  function reply(env, resp, e, by) {
    var r = { a2a: A2A_VERSION, id: newId(), in_reply_to: env.id, trace: env.trace, from: { agent: by || env.to.agent }, to: { agent: env.from.agent }, hop: env.hop, ok: !e && !!(resp && resp.ok) };
    if (e) { r.error = { code: e.code || 'E_INTERNAL', message: e.message }; if (e.detail) r.error.detail = e.detail; r.provenance_chain = []; }
    else { r.response = resp; r.provenance_chain = (resp && resp.provenance_chain) || []; if (!resp.ok) r.error = resp.error; }
    r.ts = nowIso(); return r;
  }

  function policyAllows(router, exposure, ownerId, callerId, op) {
    if (callerId === ownerId) return { allow: true, visibility: ['self', 'global', 'public'] };
    var caller = router.roster.get(callerId) || {};
    var read = [].concat((caller.lore_policy && caller.lore_policy.read) || []);
    if (read.indexOf('self') >= 0 && read.length === 1) return { allow: false, why: callerId + ' lore_policy.read is self only' };
    var rules = exposure.rules || [];
    for (var i = 0; i < rules.length; i++) {
      var r = rules[i], who = [].concat(r.callers);
      var match = who.indexOf('*') >= 0 || who.indexOf(callerId) >= 0 || (who.indexOf('roster') >= 0 && router.roster.has(callerId));
      if (!match) continue;
      var ops = [].concat(r.ops); if (ops.indexOf('*') < 0 && ops.indexOf(op) < 0) continue;
      if (r.effect === 'deny') return { allow: false, why: 'denied by exposure rule ' + i };
      var vis = r.visibility || ['public'];
      if (read.indexOf('all') < 0) vis = vis.filter(function (x) { return x !== 'self'; });
      return { allow: true, visibility: vis, rule: i };
    }
    return { allow: exposure.default === 'allow', visibility: ['public'], why: 'no exposure rule for ' + callerId + ' / ' + op };
  }

  function createPeer(router, agentId, session, exposure, opts) {
    var peer = {
      agent: agentId, locus: opts.locus || ('SYS.AI.' + agentId), exposure: exposure,
      ask: async function (to, query, o) {
        o = o || {};
        var parent = o.parent || null;
        var maxH = Math.min(LIMITS.a2a_hard_ceiling, (parent && parent.max_hops) || o.max_hops || LIMITS.a2a_max_hops);
        var env = { a2a: A2A_VERSION, id: newId(), trace: parent ? parent.trace : null, to: { agent: String(to).toUpperCase() }, hop: parent ? parent.hop + 1 : 1, max_hops: maxH, path: parent ? parent.path.concat([agentId]) : [agentId], deadline: parent ? parent.deadline : new Date(Date.now() + (o.timeout_ms || 15000)).toISOString(), query: query, ts: nowIso() };
        if (!env.trace) env.trace = env.id;
        if (parent && parent.on_behalf_of) env.on_behalf_of = parent.on_behalf_of;
        var r;
        if (env.path.indexOf(env.to.agent) >= 0) r = reply(Object.assign({ from: { agent: agentId } }, env), null, err('E_LOOP', env.to.agent + ' is already on the path ' + env.path.join(' > ')), agentId);
        else if (env.hop > env.max_hops) r = reply(Object.assign({ from: { agent: agentId } }, env), null, err('E_HOP_LIMIT', 'hop ' + env.hop + ' exceeds max_hops ' + env.max_hops), agentId);
        else r = await router.deliver(peer, env);
        // the asking agent's view: the remote response, plus a chain entry for this hop
        return { result: { envelope_out: { id: env.id, to: env.to.agent, hop: env.hop, path: env.path }, reply: r }, provenance: [], provenance_chain: (r.provenance_chain || []) };
      },
      handle: async function (env) {
        if (Date.parse(env.deadline) < Date.now()) return reply(env, null, err('E_DEADLINE', 'deadline passed'));
        if (env.path.indexOf(agentId) >= 0) return reply(env, null, err('E_LOOP', agentId + ' already on path'));
        if (env.hop > Math.min(env.max_hops, LIMITS.a2a_hard_ceiling)) return reply(env, null, err('E_HOP_LIMIT', 'hop limit'));
        var q = env.query || {}; var op = q.op;
        // no laundering through relays: every agent on the path must be allowed; visibility is the intersection
        var pol = { allow: true, visibility: ['self', 'global', 'public'] };
        for (var pi = 0; pi < env.path.length; pi++) {
          var pp = policyAllows(router, exposure, agentId, env.path[pi], op);
          if (!pp.allow) { pol = { allow: false, why: env.path[pi] + ': ' + pp.why }; break; }
          pol.visibility = pol.visibility.filter(function (x) { return pp.visibility.indexOf(x) >= 0; });
        }
        if (op !== 'capabilities_get' && !pol.allow) return reply(env, null, err('E_DENIED', 'exposure policy of ' + agentId + ' refuses ' + op + ' for path ' + env.path.join(' > '), { why: pol.why }));
        var ctx = { envelope: { trace: env.trace, hop: env.hop, max_hops: env.max_hops, path: env.path, deadline: env.deadline, on_behalf_of: env.on_behalf_of } };
        if (op === 'peer_ask') {
          var fan = (q.args && q.args.to) ? 1 : 0; if (fan > LIMITS.a2a_max_fanout) return reply(env, null, err('E_LIMIT', 'fan-out'));
        } else {
          ctx.recordFilter = function (out, pack) { return filterByVisibility(out, pack, pol.visibility, exposure); };
        }
        var resp = await session.run(q, ctx);
        var chain = (resp.provenance_chain || []).slice();
        chain.unshift({ hop: env.hop, agent: agentId, asked_by: env.from.agent, op: op, pack: resp.pack ? resp.pack.tag : null, version: resp.pack ? resp.pack.version : null, records: (resp.provenance || []).map(function (p) { return p.record; }).filter(Boolean), ok: resp.ok });
        resp.provenance_chain = chain;
        return reply(env, resp);
      }
    };
    return peer;
  }

  // records carry optional p (visibility: self|global|public). Absent p -> exposure.default_visibility (default 'self').
  function filterByVisibility(out, pack, allowed, exposure) {
    var dflt = exposure.default_visibility || 'self', hidden = 0;
    function vis(id) { var r = pack.byId.get(id); return (r && r.p) || dflt; }
    function okId(id) { return allowed.indexOf(vis(id)) >= 0; }
    var res = out.result;
    if (res && res.hits) { var before = res.hits.length; res.hits = res.hits.filter(function (h) { return okId(h.id); }); hidden += before - res.hits.length; }
    if (res && res.edges) { var b2 = res.edges.length; res.edges = res.edges.filter(function (e) { return okId(e.id) && okId(e.src); }); hidden += b2 - res.edges.length; }
    if (res && res.record && !okId(res.record.id)) throw err('E_DENIED', 'record not exposed to caller');
    out.provenance = (out.provenance || []).filter(function (p) { return !p.record || okId(p.record); });
    if (res) { if (exposure.reveal_hidden_count === false) delete res.total_matches; else res.hidden_by_policy = hidden; }
    return out;
  }

  var api = {
    PLAYER: PLAYER, LIMITS: LIMITS, OPS: OPS, A2A_VERSION: A2A_VERSION, VAGUE_PREDICATES: VAGUE_PREDICATES,
    decodeBytes: decodeBytes, loadPack: loadPack, verifyPack: verifyPack, serializePack: serializePack,
    packStats: packStats, sourcesList: sourcesList, validate: validate, summarize: summarize,
    createSession: createSession, capabilities: capabilities, runRequest: runRequest,
    createRouter: createRouter, sha256Hex: sha256Hex, normText: normText
  };
  root.LorepackPlayer = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
