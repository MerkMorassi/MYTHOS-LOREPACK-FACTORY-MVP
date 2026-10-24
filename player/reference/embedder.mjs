// SYS.AI.MAYA.SESAME - Gemini embedder for the reference player (query side). Same request shape as the factory mint gate.
// Key from env GEMINI_API_KEY or a key file. Returns null when no key: text search then answers E_NO_EMBEDDER.
import { readFileSync } from 'node:fs';
export function geminiEmbedder(key, model = 'gemini-embedding-2', dim = 768) {
  const fn = async (text, want) => {
    const m = (want && want.model) || model, d = (want && want.dim) || dim;
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:batchEmbedContents?key=${encodeURIComponent(key)}`;
    const body = { requests: [{ model: `models/${m}`, content: { parts: [{ text }] }, outputDimensionality: d }] };
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) { const e = new Error('embed HTTP ' + r.status); e.code = 'E_NO_EMBEDDER'; throw e; }
    const j = await r.json();
    return { model: m, dim: d, vector: j.embeddings[0].values };
  };
  fn.model = model; fn.dim = dim; return fn;
}
export function geminiEmbedderFrom(keyFile) {
  const key = process.env.GEMINI_API_KEY || (keyFile ? readFileSync(keyFile, 'utf8').trim() : '');
  return key ? geminiEmbedder(key) : null;
}
