(function () {
  "use strict";
  var TAG = "LOREPACK-PLAYER";
  var STOP = "a,an,and,are,as,at,be,but,by,for,from,had,has,have,her,hers,his,how,if,in,into,is,it,its,just,like,me,my,not,now,of,off,on,or,our,out,said,say,says,shall,she,so,such,that,the,their,them,then,there,these,they,this,to,too,under,up,was,we,were,what,when,where,which,who,will,with,you,your,does,did,can,keep,hold,find,type,hey,let".split(",");
  function str(v) { return String(v == null ? "" : v); }
  function refuse(msg) { return { ok: false, receipt: TAG + " :: REFUSED - " + msg }; }
  function words(s) {
    var seen = {}, out = [];
    str(s).toLowerCase().split(/[^a-z0-9]+/).forEach(function (w) {
      if (!w || w.length < 3 || STOP.indexOf(w) >= 0 || seen[w]) return;
      seen[w] = 1;
      out.push(w);
    });
    return out;
  }
  function client(rawOpts) {
    var opts = rawOpts || {};
    function readRows() {
      try {
        if (typeof opts.readRows === "function") return Promise.resolve(opts.readRows() || []);
      } catch (e) { return Promise.resolve([]); }
      return Promise.resolve([]);
    }
    function say(t) { try { if (typeof opts.say === "function") opts.say(t); } catch (e) {} }
    async function recall(query, k) {
      k = Math.max(1, Math.min(5, Number(k) || 3));
      var qw = words(query);
      if (!qw.length) return [];
      var rows = await readRows();
      var need = qw.length <= 2 ? 1 : 2;
      var out = [];
      for (var i = 0; i < rows.length; i++) {
        var r = rows[i] || {};
        var text = str(r.t || "");
        if (!text) continue;
        var mark = {};
        words(text).forEach(function (w) { mark[w] = 1; });
        var n = 0;
        qw.forEach(function (w) { if (mark[w]) n++; });
        if (n >= need) out.push({ id: str(r.id || ""), text: text, score: n });
      }
      out.sort(function (a, b) { return b.score - a.score; });
      return out.slice(0, k);
    }
    async function block(query, k) {
      var hits = await recall(query, k);
      if (!hits.length) return "";
      var lines = hits.map(function (h) { return "- " + h.text.slice(0, 200) + " (" + h.id.slice(-14) + ")"; });
      say(TAG + " :: RECALL " + hits.length + " ROWS");
      return "[LOREPACK RECALL (" + hits.length + ")]\n" + lines.join("\n");
    }
    function describe() {
      return "LOREPACK-PLAYER - local keyword recall over lorepack rows. recall(query,k) scores rows by shared words (stopwords out, 1 hit for short queries, 2 for longer, top-k max 5); block(query,k) formats the winners as a prompt block, empty when nothing is relevant. Rows arrive through the readRows seam, so the chip owns no storage.";
    }
    return { recall: recall, block: block, describe: describe };
  }
  function describe() { return client({}).describe(); }
  var api = { client: client, describe: describe };
  if (typeof window !== "undefined") window.MythosLorepackPlayer = api;
  return api;
})();
