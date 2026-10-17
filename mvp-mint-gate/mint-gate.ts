export const MINT_GATE_VERSION = "1.0.0";
export const PINNED_MODEL = "gemini-embedding-2";
export const PINNED_DIM = 768;
export const EMBED_BATCH = 10;
export const EMBED_PACE_MS = 1500;
export const EMBED_MAX_RETRIES = 6;

export class MintRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MintRefusedError";
  }
}

export class QuotaError extends MintRefusedError {
  readonly retryMs: number;
  constructor(message: string, retryMs = 0) {
    super(message);
    this.name = "QuotaError";
    this.retryMs = retryMs;
  }
}

export class AuthError extends MintRefusedError {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export type FetchImpl = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string }
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function parseRetryMs(message: string): number {
  const m = /retry in\s+([\d.]+)s/i.exec(message || "");
  return m ? Math.ceil(parseFloat(m[1]) * 1000) : 0;
}

function innerReason(message: string): string {
  const i = message.indexOf("CHECK KEY");
  return i >= 0 ? message.slice(0, i) : message;
}

export function isQuotaLike(status: number, message: string): boolean {
  if (status === 429 || status === 503 || status === 500) return true;
  return /\b429\b|quota|rate|overload|unavailable|exceeded|exhausted/i.test(innerReason(message));
}

export function isAuthLike(status: number, message: string): boolean {
  if (status === 400 || status === 401 || status === 403 || status === 404) return true;
  return /key not valid|invalid|permission|denied|not found|bad request/i.test(innerReason(message));
}

export function classifyEmbedFailure(status: number, message: string, id: string): MintRefusedError {
  const head = `MINT REFUSED :: ${id} :: HTTP ${status} :: ${message}`;
  if (isAuthLike(status, message)) {
    return new AuthError(`${head}. Keys live in the host keyring, never in code. NOTHING WAS PACKED.`);
  }
  return new QuotaError(
    `${head}. CHECK KEY AND QUOTA. Fallback vectors are never minted - re-run when the API answers. NOTHING WAS PACKED.`,
    parseRetryMs(message)
  );
}

export interface PinnedRequest {
  model: string;
  content: { parts: Array<{ text: string }> };
  outputDimensionality: number;
}

export function buildPinnedBatchBody(
  texts: string[],
  model: string = PINNED_MODEL,
  dim: number = PINNED_DIM
): { requests: PinnedRequest[] } {
  return {
    requests: texts.map((t) => ({
      model: `models/${model}`,
      content: { parts: [{ text: t }] },
      outputDimensionality: dim,
    })),
  };
}

export function embedUrl(model: string, key: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:batchEmbedContents?key=${encodeURIComponent(key)}`;
}

function isPinnedVec(v: unknown, dim: number): v is number[] {
  return (
    Array.isArray(v) &&
    v.length === dim &&
    v.every((n) => typeof n === "number" && Number.isFinite(n))
  );
}

export async function embedBatchPinned(
  fetchImpl: FetchImpl,
  key: string,
  texts: string[],
  ids: string[],
  model: string = PINNED_MODEL,
  dim: number = PINNED_DIM
): Promise<number[][]> {
  if (!key) throw new AuthError("MINT REFUSED :: no API key. NOTHING WAS EMBEDDED.");
  let res: { ok: boolean; status: number; json(): Promise<unknown> };
  try {
    res = await fetchImpl(embedUrl(model, key), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildPinnedBatchBody(texts, model, dim)),
    });
  } catch (e) {
    const why = e instanceof Error ? e.message : String(e);
    throw new QuotaError(
      `MINT REFUSED :: ${ids[0]} :: network :: ${why}. CHECK KEY AND QUOTA. NOTHING WAS PACKED.`
    );
  }
  let js: unknown = null;
  try {
    js = await res.json();
  } catch {
    js = null;
  }
  const arr = (js as { embeddings?: unknown } | null)?.embeddings;
  if (!res.ok || !Array.isArray(arr) || arr.length !== texts.length) {
    const msg =
      (js as { error?: { message?: string } } | null)?.error?.message || `HTTP ${res.status}`;
    throw classifyEmbedFailure(res.status, String(msg), ids[0]);
  }
  return arr.map((e, i) => {
    const v = (e as { values?: unknown })?.values;
    if (!isPinnedVec(v, dim)) {
      throw new MintRefusedError(
        `MINT REFUSED :: ${ids[i]} :: malformed vector (expected ${dim}-D finite numbers). NOTHING WAS PACKED.`
      );
    }
    return v;
  });
}

export interface ResumeHooks {
  load(): Promise<{ model: string; dim: number; items: Record<string, number[]> } | null>;
  save(cp: { model: string; dim: number; items: Record<string, number[]> }): Promise<void>;
  onEvent(message: string): void;
}

export async function embedAllResumable(
  records: Array<{ id: string; text: string }>,
  key: string,
  fetchImpl: FetchImpl,
  hooks: ResumeHooks,
  model: string = PINNED_MODEL,
  dim: number = PINNED_DIM,
  batchSize: number = EMBED_BATCH
): Promise<Map<string, number[]>> {
  const total = records.length;
  const done: Record<string, number[]> = {};
  const cp = await hooks.load();
  if (cp && cp.model === model && cp.dim === dim) {
    Object.assign(done, cp.items);
  } else if (cp) {
    hooks.onEvent("CHECKPOINT STALE :: model/dim moved, starting fresh");
  }
  const pending = records.filter((r) => !done[r.id]);
  if (pending.length < total) {
    hooks.onEvent(
      `RESUMING :: ${total - pending.length}/${total} already embedded, ${pending.length} to go`
    );
  }
  for (let i = 0; i < pending.length; i += batchSize) {
    const slice = pending.slice(i, i + batchSize);
    let attempt = 0;
    for (;;) {
      try {
        const vecs = await embedBatchPinned(
          fetchImpl,
          key,
          slice.map((r) => r.text),
          slice.map((r) => r.id),
          model,
          dim
        );
        slice.forEach((r, k) => {
          done[r.id] = vecs[k];
        });
        break;
      } catch (e) {
        if (e instanceof AuthError) {
          throw new MintRefusedError(
            `${e.message} RESUME :: checkpointed ${Object.keys(done).length}/${total} - re-run to resume. NOTHING WAS PACKED.`
          );
        }
        attempt++;
        if (attempt > EMBED_MAX_RETRIES) {
          const base = e instanceof Error ? e.message : String(e);
          throw new MintRefusedError(
            `${base} RESUME :: checkpointed ${Object.keys(done).length}/${total} - re-run to resume. NOTHING WAS PACKED.`
          );
        }
        const retryMs = e instanceof QuotaError ? e.retryMs : 0;
        const wait = retryMs + 2000 || Math.min(20000, 2000 * attempt);
        hooks.onEvent(
          `QUOTA WAIT :: ${slice[0].id} :: attempt ${attempt}/${EMBED_MAX_RETRIES} :: waiting ${(
            wait / 1000
          ).toFixed(1)}s`
        );
        await sleep(wait);
      }
    }
    await hooks.save({ model, dim, items: { ...done } });
    hooks.onEvent(`EMBEDDING :: ${Object.keys(done).length}/${total}`);
    if (i + batchSize < pending.length) await sleep(EMBED_PACE_MS);
  }
  const out = new Map<string, number[]>();
  for (const r of records) {
    const v = done[r.id];
    if (!v) {
      throw new MintRefusedError(
        `MINT REFUSED :: missing vector for ${r.id} after resume. NOTHING WAS PACKED.`
      );
    }
    out.set(r.id, v);
  }
  return out;
}

export interface GateVector {
  id: string;
  vec: number[];
  model: string;
}

export interface GateEdge {
  id: string;
  src: string;
}

export function assertSingleSpace(
  vectors: GateVector[],
  edges: GateEdge[] = [],
  dim: number = PINNED_DIM
): { dim: number; model: string; vectors: number; edges: number } {
  const seen = new Set<string>();
  const dims = new Set<number>();
  const models = new Set<string>();
  for (const r of vectors) {
    if (seen.has(r.id)) {
      throw new MintRefusedError(
        `MINT REFUSED :: duplicate vector id "${r.id}". NOTHING WAS PACKED.`
      );
    }
    seen.add(r.id);
    dims.add(r.vec.length);
    models.add(r.model);
  }
  if (dims.size > 1) {
    throw new MintRefusedError(
      `MINT REFUSED :: vectors mix embedding dimensions (${[...dims].join(
        ", "
      )}) - one pack, one space. NOTHING WAS PACKED.`
    );
  }
  if (vectors.length && ![...dims].includes(dim)) {
    throw new MintRefusedError(
      `MINT REFUSED :: vectors are ${[...dims][0]}-D, this mint is pinned ${dim}-D. NOTHING WAS PACKED.`
    );
  }
  if (models.size > 1) {
    throw new MintRefusedError(
      `MINT REFUSED :: vectors mix embedding models (${[...models].join(", ")}). NOTHING WAS PACKED.`
    );
  }
  for (const e of edges) {
    if (!e.id || !e.src) {
      throw new MintRefusedError(
        `MINT REFUSED :: edge malformed (id, src required). NOTHING WAS PACKED.`
      );
    }
    if (!seen.has(e.src)) {
      throw new MintRefusedError(
        `MINT REFUSED :: edge "${e.id}" points at vector "${e.src}" not in this pack. NOTHING WAS PACKED.`
      );
    }
  }
  return {
    dim,
    model: vectors.length ? [...models][0] : PINNED_MODEL,
    vectors: vectors.length,
    edges: edges.length,
  };
}
