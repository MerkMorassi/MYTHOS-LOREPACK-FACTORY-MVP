// MYTHOS LOREPACK-SYNC - move mint-wire rows between the kv shelf and the Studio roads.
//
// The factory side (MYTHOS-KINE repo: services/lorepack.ts + server.js) mints,
// embeds, and vaults. This chip is the honest courier between that world and
// this house: it reads rows someone else filed, pushes them to a Studio
// localhost vault, and pulls pack URLs back in for the host to file.
//
// Three roads, none owned here:
//   LOCAL     - readRows/writeRows seams (this house: the kv lorepack shelf).
//   LOCALHOST - POST {nodes} to <base>/api/sync (Studio server.js, port 4000
//               by default). Batches of 500, overwrite never set.
//   CLOUD     - GET a pack URL (JSONL, one v2 row per line, or a JSON array
//               of rows). Gzip refused loud unless DecompressionStream exists.
//
// The chip keeps no rows, files nothing, holds no keys, touches no DOM.
// Every failure is a loud receipt, never a throw, never silence.
//
// Standalone, zero dependencies. Loads via:
//   <script src="src/mythos-lorepack-sync-standalone.js"></script>
// Then: MythosLorepackSync.client({readRows, writeRows, fetch, say, base}).
window.MythosLorepackSync = (function () {
"use strict";
var TAG = "LOREPACK-SYNC";
var PUSH_BATCH = 500;
function str(v) { return String(v == null ? "" : v); }
function sayFn(opts) {
  if (opts && typeof opts.say === "function") return opts.say;
  return function () {};
}
function fetchFn(opts) {
  if (opts && typeof opts.fetch === "function") return opts.fetch;
  if (typeof fetch === "function") return fetch.bind(null);
  return null;
}
function refuse(msg) { return { ok: false, receipt: TAG + " :: REFUSED - " + msg }; }
function rowOk(r) {
  if (!r || typeof r !== "object") return false;
  return !!(str(r.t || r.text || "").trim());
}
function normRow(n) {
  var t = str(n.t || n.text || "");
  if (!t.trim()) return null;
  return { v: 2, type: str(n.type || "turn"), id: str(n.id || ""), a: str(n.a || ""), h: str(n.h || ""), t: t, vec: ("vec" in n ? n.vec : null), m: str(n.m || ""), d: n.d || null, src: str(n.src || n.source || ""), ts: Number(n.ts || n.timestamp || Date.now()) || Date.now() };
}
function client(rawOpts) {
  var opts = rawOpts || {};
  var say = sayFn(opts);
  var doFetch = fetchFn(opts);
  var base = str(opts.base || "http://localhost:4000").replace(/\/+$/, "");
  function readRows() {
    try {
      if (typeof opts.readRows === "function") return Promise.resolve(opts.readRows() || []);
    } catch (e) { return Promise.resolve([]); }
    return Promise.resolve([]);
  }
  function writeRows(rows) {
    try {
      if (typeof opts.writeRows === "function") return Promise.resolve(opts.writeRows(rows || []));
    } catch (e) { return Promise.resolve({ ok: false, receipt: TAG + " :: host writeRows refused." }); }
    return Promise.resolve({ ok: false, receipt: TAG + " :: no writeRows seam — pulled rows held, nothing filed." });
  }
  async function status() {
    var rows = [];
    try { rows = (await readRows()) || []; } catch (e) { rows = []; }
    return { ok: true, base: base, localRows: rows.length, fetchRoad: !!doFetch, receipt: TAG + " :: local " + rows.length + " row(s), localhost " + base + ", cloud by pack URL." };
  }
  async function push(baseOverride) {
    var b = str(baseOverride || base).replace(/\/+$/, "") || base;
    if (!doFetch) return refuse("no fetch road — host must supply one.");
    var rows = [];
    try { rows = (await readRows()) || []; } catch (e) { rows = []; }
    rows = rows.map(normRow).filter(Boolean);
    if (!rows.length) return refuse("no rows to push — stage something first (/capture keep).");
    var url = b + "/api/sync";
    var pushed = 0, vaultSize = null;
    for (var i = 0; i < rows.length; i += PUSH_BATCH) {
      var batch = rows.slice(i, i + PUSH_BATCH);
      var resp = null;
      try {
        resp = await doFetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nodes: batch }) });
      } catch (e) {
        return { ok: false, receipt: TAG + " :: PUSH DIED at batch " + (Math.floor(i / PUSH_BATCH) + 1) + " — " + str((e && e.message) || e).slice(0, 160) + " Is the Studio server up at " + b + "?" };
      }
      var body = "";
      try { body = await resp.text(); } catch (e) { body = ""; }
      if (!resp || !resp.ok) {
        return { ok: false, receipt: TAG + " :: PUSH REFUSED HTTP " + (resp ? resp.status : "no-response") + " — " + str(body).slice(0, 160) };
      }
      try { var j = JSON.parse(body); if (j && j.vaultSize != null) vaultSize = j.vaultSize; } catch (e) {}
      pushed += batch.length;
      try { say(TAG + " :: pushed " + pushed + "/" + rows.length); } catch (e) {}
    }
    return { ok: true, pushed: pushed, vaultSize: vaultSize, receipt: TAG + " :: PUSHED " + pushed + " row(s) to " + b + (vaultSize != null ? " (vault " + vaultSize + ")" : "") + "." };
  }
  async function pull(packUrl, fetchOverride) {
    var f = fetchOverride || doFetch;
    var url = str(packUrl || "").trim();
    if (!url) return refuse("no pack URL — /sync pull <url>.");
    if (!f) return refuse("no fetch road — host must supply one.");
    if (/\.gz(\?|$)/i.test(url) && typeof DecompressionStream === "undefined") {
      return refuse("pack is gzipped and this browser cannot gunzip — point at a plain .jsonl URL.");
    }
    var text = "";
    try {
      var resp = await f(url);
      if (!resp || !resp.ok) return { ok: false, receipt: TAG + " :: PULL REFUSED HTTP " + (resp ? resp.status : "no-response") + " — " + url.slice(0, 120) };
      if (/\.gz(\?|$)/i.test(url)) {
        var buf = await resp.arrayBuffer();
        var ds = new DecompressionStream("gzip");
        var stream = new Blob([buf]).stream().pipeThrough(ds);
        text = await new Response(stream).text();
      } else {
        text = await resp.text();
      }
    } catch (e) {
      return { ok: false, receipt: TAG + " :: PULL DIED — " + str((e && e.message) || e).slice(0, 160) };
    }
    var rows = [], skipped = 0;
    var trimmed = str(text).trim();
    if (!trimmed) return refuse("pack came back empty — " + url.slice(0, 120));
    try {
      if (trimmed[0] === "[") {
        var arr = JSON.parse(trimmed);
        (arr || []).forEach(function (n) { var r = normRow(n); if (r) rows.push(r); else skipped++; });
      } else {
        var lines = trimmed.split(/\r?\n/);
        for (var i = 0; i < lines.length; i++) {
          var ln = lines[i].trim();
          if (!ln) continue;
          try { var r = normRow(JSON.parse(ln)); if (r) rows.push(r); else skipped++; }
          catch (e) { skipped++; }
        }
      }
    } catch (e) {
      return { ok: false, receipt: TAG + " :: PACK UNREADABLE — " + str((e && e.message) || e).slice(0, 120) };
    }
    if (!rows.length) return refuse("no rows survived (" + skipped + " skipped) — " + url.slice(0, 120));
    var w = await writeRows(rows);
    var filed = w && w.key ? " filed as " + w.key : (w && w.ok === false ? " HELD, not filed (" + str(w.receipt || "").slice(0, 100) + ")" : " filed");
    return { ok: true, pulled: rows.length, skipped: skipped, receipt: TAG + " :: PULLED " + rows.length + " row(s)" + (skipped ? " (" + skipped + " skipped)" : "") + filed + "." };
  }
  function describe() {
    return "LOREPACK-SYNC - honest courier between the kv shelf and the Studio roads. push(base) POSTs staged mint-wire rows to <base>/api/sync in 500s, reporting the vault size; pull(url) GETs a JSONL pack and hands rows to the host writeRows seam for filing. status() reports local counts and roads. No storage, no keys, no DOM; every failure is a loud receipt.";
  }
  return { status: status, push: push, pull: pull, describe: describe };
}
function describe() { return client({}).describe(); }
var api = { client: client, describe: describe };
return api;
})();
