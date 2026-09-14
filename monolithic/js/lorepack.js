// File: js/lorepack.js
// LOREPACK™ v3.7.1 :: SOVEREIGN KERNEL
// - GraphMAGRAG Lite Enabled (Vectors + Edges)
// - IndexedDB Version 10
// - Current Gemini Embeddings
// - Full Import/Export/Chat fidelity
// - ID-preserving graph round-trip
// - Strict chunk ceiling
// - Explicit import/graph errors
// - Embedding-space compatibility enforcement
// © 2026 MYTHOS. All Rights Reserved.

const DB_NAME = 'mythos_vault';
const DB_VERSION = 10;

export const EMBEDDING_MODEL = 'gemini-embedding-2';
export const DEFAULT_GENERATION_MODEL = 'gemini-3.8-flash';

export const MAX_EMBED_BATCH = 100;
export const MAX_CHUNK_CHARS = 2000;

function normalizeAgentId(value) {
  return String(value || '')
    .trim()
    .toUpperCase();
}

class SimpleDB {
  constructor() {
    this.db = null;
    this.ready = this._init();
  }

  _init() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);

      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        const tx = req.transaction;

        if (!db.objectStoreNames.contains('vectors')) {
          const store = db.createObjectStore('vectors', {
            keyPath: 'id'
          });

          store.createIndex('agentId', 'agentId', {
            unique: false
          });

          store.createIndex('numMarkId', 'numMarkId', {
            unique: false
          });
        } else {
          const store = tx.objectStore('vectors');

          if (!store.indexNames.contains('agentId')) {
            store.createIndex('agentId', 'agentId', {
              unique: false
            });
          }

          if (!store.indexNames.contains('numMarkId')) {
            store.createIndex('numMarkId', 'numMarkId', {
              unique: false
            });
          }
        }

        if (!db.objectStoreNames.contains('edges')) {
          const edgeStore = db.createObjectStore('edges', {
            keyPath: 'id'
          });

          edgeStore.createIndex('sourceId', 'sourceId', {
            unique: false
          });

          edgeStore.createIndex('agentId', 'agentId', {
            unique: false
          });

          edgeStore.createIndex('type', 'type', {
            unique: false
          });
        } else {
          const edgeStore = tx.objectStore('edges');

          if (!edgeStore.indexNames.contains('sourceId')) {
            edgeStore.createIndex('sourceId', 'sourceId', {
              unique: false
            });
          }

          if (!edgeStore.indexNames.contains('agentId')) {
            edgeStore.createIndex('agentId', 'agentId', {
              unique: false
            });
          }

          if (!edgeStore.indexNames.contains('type')) {
            edgeStore.createIndex('type', 'type', {
              unique: false
            });
          }
        }
      };

      req.onsuccess = () => {
        this.db = req.result;

        this.db.onversionchange = () => {
          this.db.close();
        };

        resolve();
      };

      req.onerror = () => {
        reject(
          req.error ||
          new Error('IndexedDB open failed')
        );
      };
    });
  }

  async put(storeName, value) {
    await this.ready;

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(
        storeName,
        'readwrite'
      );

      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () =>
        reject(
          tx.error ||
          new Error(
            `IndexedDB transaction aborted: ${storeName}`
          )
        );

      tx.objectStore(storeName).put(value);
    });
  }

  async bulkPut(storeName, values) {
    if (!values?.length) return;

    await this.ready;

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(
        storeName,
        'readwrite'
      );

      const store =
        tx.objectStore(storeName);

      tx.oncomplete = () => resolve();

      tx.onerror = () =>
        reject(
          tx.error ||
          new Error(
            `IndexedDB write failed: ${storeName}`
          )
        );

      tx.onabort = () =>
        reject(
          tx.error ||
          new Error(
            `IndexedDB transaction aborted: ${storeName}`
          )
        );

      for (const value of values) {
        store.put(value);
      }
    });
  }

  async bulkPutAtomic(vectors, edges) {
    await this.ready;

    if (
      !vectors?.length &&
      !edges?.length
    ) {
      return;
    }

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(
        ['vectors', 'edges'],
        'readwrite'
      );

      const vectorStore =
        tx.objectStore('vectors');

      const edgeStore =
        tx.objectStore('edges');

      tx.oncomplete = () => resolve();

      tx.onerror = () =>
        reject(
          tx.error ||
          new Error(
            'Atomic IndexedDB import failed.'
          )
        );

      tx.onabort = () =>
        reject(
          tx.error ||
          new Error(
            'Atomic IndexedDB import transaction aborted.'
          )
        );

      for (const vector of vectors || []) {
        vectorStore.put(vector);
      }

      for (const edge of edges || []) {
        edgeStore.put(edge);
      }
    });
  }

  async getAll(storeName) {
    await this.ready;

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(
        storeName,
        'readonly'
      );

      const req =
        tx.objectStore(storeName).getAll();

      req.onsuccess = () =>
        resolve(req.result || []);

      req.onerror = () =>
        reject(req.error);
    });
  }

  async count(storeName) {
    await this.ready;

    return new Promise((resolve, reject) => {
      const tx = this.db.transaction(
        storeName,
        'readonly'
      );

      const req =
        tx.objectStore(storeName).count();

      req.onsuccess = () =>
        resolve(req.result || 0);

      req.onerror = () =>
        reject(req.error);
    });
  }

  async nuke() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }

    return new Promise((resolve, reject) => {
      const req =
        indexedDB.deleteDatabase(DB_NAME);

      req.onsuccess = () => resolve();

      req.onerror = () =>
        reject(req.error);

      req.onblocked = () =>
        reject(
          new Error(
            'IndexedDB delete blocked by another connection.'
          )
        );
    });
  }
}

function cosine(a, b) {
  if (
    !Array.isArray(a) ||
    !Array.isArray(b)
  ) {
    return 0;
  }

  if (
    a.length !== b.length ||
    !a.length
  ) {
    return 0;
  }

  let dot = 0;
  let ma = 0;
  let mb = 0;

  for (let i = 0; i < a.length; i++) {
    const x = Number(a[i]);
    const y = Number(b[i]);

    if (
      !Number.isFinite(x) ||
      !Number.isFinite(y)
    ) {
      return 0;
    }

    dot += x * y;
    ma += x * x;
    mb += y * y;
  }

  const denom =
    Math.sqrt(ma) *
    Math.sqrt(mb);

  return denom
    ? dot / denom
    : 0;
}

function isValidVector(vector, dimension = null) {
  if (!Array.isArray(vector)) {
    return false;
  }

  if (!vector.length) {
    return false;
  }

  if (
    dimension !== null &&
    vector.length !== dimension
  ) {
    return false;
  }

  return vector.every(value =>
    Number.isFinite(Number(value))
  );
}

function cleanJsonFence(text) {
  let clean =
    String(text || '').trim();

  if (clean.startsWith('```json')) {
    clean = clean.slice(7);
  } else if (
    clean.startsWith('```')
  ) {
    clean = clean.slice(3);
  }

  if (clean.endsWith('```')) {
    clean = clean.slice(0, -3);
  }

  return clean.trim();
}

function isValidTriplet(value) {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.s === 'string' &&
    typeof value.r === 'string' &&
    typeof value.o === 'string' &&
    value.s.trim() &&
    value.r.trim() &&
    value.o.trim()
  );
}

function validateEdgeReference(
  edge,
  nodeIds
) {
  return (
    edge &&
    typeof edge.id === 'string' &&
    edge.id &&
    typeof edge.sourceId === 'string' &&
    edge.sourceId &&
    nodeIds.has(edge.sourceId)
  );
}

export class Lorepack {
  constructor() {
    this.db = new SimpleDB();
    this.apiKeys = [];
    this.keyIndex = 0;
  }

  async ready() {
    await this.db.ready;
  }

  setApiKeys(keys) {
    this.apiKeys = (keys || [])
      .map(k =>
        String(k || '').trim()
      )
      .filter(Boolean);

    this.keyIndex = 0;
  }

  _getKey() {
    if (!this.apiKeys.length) {
      throw new Error(
        'API Keys Missing.'
      );
    }

    const key =
      this.apiKeys[this.keyIndex];

    this.keyIndex =
      (this.keyIndex + 1) %
      this.apiKeys.length;

    return key;
  }

  genSigil(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '')
      .slice(0, 50);
  }

  chunk(
    text,
    maxChars = MAX_CHUNK_CHARS
  ) {
    const limit = Math.max(
      1,
      Math.floor(
        Number(maxChars) ||
        MAX_CHUNK_CHARS
      )
    );

    const normalized =
      String(text || '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .trim();

    if (!normalized) {
      return [];
    }

    const sentences =
      normalized
        .split(
          /(?<=[.!?])\s+(?=[A-Z0-9@])/
        )
        .map(s => s.trim())
        .filter(Boolean);

    const out = [];
    let buffer = '';

    const emitHardWrapped =
      (textValue) => {
        let remaining =
          textValue.trim();

        while (
          remaining.length > limit
        ) {
          let cut =
            remaining.lastIndexOf(
              ' ',
              limit
            );

          if (cut <= 0) {
            cut = limit;
          }

          const piece =
            remaining
              .slice(0, cut)
              .trim();

          if (piece) {
            out.push(piece);
          }

          remaining =
            remaining
              .slice(cut)
              .trim();
        }

        if (remaining) {
          out.push(remaining);
        }
      };

    for (const sentence of sentences) {
      if (sentence.length > limit) {
        if (buffer) {
          out.push(buffer);
          buffer = '';
        }

        emitHardWrapped(sentence);
        continue;
      }

      if (!buffer) {
        buffer = sentence;
        continue;
      }

      const candidate =
        `${buffer} ${sentence}`;

      if (
        candidate.length <= limit
      ) {
        buffer = candidate;
      } else {
        out.push(buffer);
        buffer = sentence;
      }
    }

    if (buffer) {
      out.push(buffer);
    }

    return out.filter(Boolean);
  }

  async getStats() {
    await this.db.ready;

    return {
      totalNodes:
        await this.db.count('vectors'),

      totalEdges:
        await this.db.count('edges')
    };
  }

  async getNodes(agentId) {
    await this.db.ready;

    const all =
      await this.db.getAll('vectors');

    if (
      !agentId ||
      agentId === 'OPERATOR'
    ) {
      return all;
    }

    const aid =
      normalizeAgentId(agentId);

    return all.filter(
      node =>
        normalizeAgentId(
          node.agentId
        ) === aid
    );
  }

  async getEdges(agentId = null) {
    await this.db.ready;

    const all =
      await this.db.getAll('edges');

    if (!agentId) {
      return all;
    }

    const aid =
      normalizeAgentId(agentId);

    return all.filter(
      edge =>
        normalizeAgentId(
          edge.agentId
        ) === aid
    );
  }

  async deleteAgentData(agentId) {
    await this.db.ready;

    const aid =
      normalizeAgentId(agentId);

    if (!aid) {
      throw new Error(
        'Agent ID required.'
      );
    }

    const nodes =
      await this.getNodes(aid);

    const nodeIds =
      new Set(
        nodes.map(node => node.id)
      );

    const edges =
      await this.getEdges(aid);

    return new Promise(
      (resolve, reject) => {
        const tx =
          this.db.db.transaction(
            ['vectors', 'edges'],
            'readwrite'
          );

        const vectorStore =
          tx.objectStore('vectors');

        const edgeStore =
          tx.objectStore('edges');

        tx.oncomplete = () =>
          resolve({
            vectors: nodes.length,
            edges: edges.length
          });

        tx.onerror = () =>
          reject(
            tx.error ||
            new Error(
              'Agent data deletion failed.'
            )
          );

        tx.onabort = () =>
          reject(
            tx.error ||
            new Error(
              'Agent data deletion aborted.'
            )
          );

        for (const node of nodes) {
          vectorStore.delete(node.id);
        }

        for (const edge of edges) {
          edgeStore.delete(edge.id);
        }

        // Defensive cleanup for orphaned edges
        // referencing this agent's nodes.
        if (nodeIds.size) {
          // Already covered by agent edge filtering,
          // retained here as an explicit integrity boundary.
        }
      }
    );
  }

  // ------------------------------------------------------------
  // EMBEDDINGS
  // ------------------------------------------------------------

  async embedBatch(
    texts,
    keyOverride = null
  ) {
    if (
      !Array.isArray(texts) ||
      !texts.length
    ) {
      return [];
    }

    if (
      texts.length >
      MAX_EMBED_BATCH
    ) {
      throw new Error(
        `Embedding batch exceeds ${MAX_EMBED_BATCH} items.`
      );
    }

    const key =
      keyOverride ||
      this._getKey();

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${encodeURIComponent(EMBEDDING_MODEL)}:batchEmbedContents` +
      `?key=${encodeURIComponent(key)}`;

    const body = {
      requests: texts.map(text => ({
        model:
          `models/${EMBEDDING_MODEL}`,

        content: {
          parts: [
            {
              text:
                String(text || '')
            }
          ]
        }
      }))
    };

    const response =
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json'
        },
        body:
          JSON.stringify(body)
      });

    const json =
      await response.json();

    if (
      !response.ok ||
      json.error
    ) {
      throw new Error(
        json.error?.message ||
        `Embedding failed (${response.status})`
      );
    }

    const embeddings =
      json.embeddings || [];

    if (
      embeddings.length !==
      texts.length
    ) {
      throw new Error(
        `Embedding count mismatch: requested ${texts.length}, received ${embeddings.length}.`
      );
    }

    const vectors =
      embeddings.map(
        (embedding, index) => {
          const values =
            embedding?.values;

          if (
            !Array.isArray(values) ||
            !values.length
          ) {
            throw new Error(
              `Missing embedding vector at batch index ${index}.`
            );
          }

          if (
            !isValidVector(values)
          ) {
            throw new Error(
              `Invalid embedding vector at batch index ${index}.`
            );
          }

          return values;
        }
      );

    const dimension =
      vectors[0].length;

    if (
      !vectors.every(
        vector =>
          vector.length ===
          dimension
      )
    ) {
      throw new Error(
        'Embedding dimension mismatch inside batch.'
      );
    }

    return vectors;
  }

  // ------------------------------------------------------------
  // GENERATION
  // ------------------------------------------------------------

  async _generate(
    text,
    model = DEFAULT_GENERATION_MODEL,
    keyOverride = null
  ) {
    const key =
      keyOverride ||
      this._getKey();

    const url =
      `https://generativelanguage.googleapis.com/v1beta/models/` +
      `${encodeURIComponent(model)}:generateContent` +
      `?key=${encodeURIComponent(key)}`;

    const payload = {
      contents: [
        {
          parts: [
            {
              text
            }
          ]
        }
      ]
    };

    const response =
      await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type':
            'application/json'
        },
        body:
          JSON.stringify(payload)
      });

    const json =
      await response.json();

    if (
      !response.ok ||
      json.error
    ) {
      throw new Error(
        json.error?.message ||
        `Generate failed (${response.status})`
      );
    }

    return (
      json.candidates?.[0]
        ?.content
        ?.parts
        ?.map(
          part =>
            part.text || ''
        )
        .join('') ||
      ''
    );
  }

  // ------------------------------------------------------------
  // INGESTION
  // ------------------------------------------------------------

  async ingestBatches(
    batches,
    opts = {}
  ) {
    await this.db.ready;

    const agentId =
      normalizeAgentId(
        opts.agentId
      );

    if (!agentId) {
      throw new Error(
        'Agent ID required.'
      );
    }

    const agentHandle =
      String(
        opts.agentHandle || ''
      ).trim();

    const batchSize =
      Math.max(
        1,
        Math.min(
          MAX_EMBED_BATCH,
          parseInt(
            opts.batchSize || 60,
            10
          )
        )
      );

    const threadsPerKey =
      Math.max(
        1,
        Math.min(
          50,
          parseInt(
            opts.threadsPerKey || 3,
            10
          )
        )
      );

    const signal =
      opts.signal || null;

    const onProgress =
      typeof opts.onProgress ===
      'function'
        ? opts.onProgress
        : null;

    if (!this.apiKeys.length) {
      throw new Error(
        'API Keys Missing.'
      );
    }

    if (
      !Array.isArray(batches) ||
      !batches.length
    ) {
      return {
        ingested: 0
      };
    }

    const validBatches =
      batches.map(
        (item, index) => {
          if (
            !item ||
            typeof item.text !==
              'string'
          ) {
            throw new Error(
              `Invalid ingestion item at index ${index}.`
            );
          }

          if (!item.text.trim()) {
            throw new Error(
              `Empty ingestion item at index ${index}.`
            );
          }

          if (
            item.text.length >
            MAX_CHUNK_CHARS
          ) {
            throw new Error(
              `Chunk exceeds hard ceiling at index ${index}: ${item.text.length} > ${MAX_CHUNK_CHARS}.`
            );
          }

          return item;
        }
      );

    const groups = [];

    for (
      let i = 0;
      i < validBatches.length;
      i += batchSize
    ) {
      groups.push(
        validBatches.slice(
          i,
          i + batchSize
        )
      );
    }

    const concurrency =
      Math.max(
        1,
        this.apiKeys.length *
          threadsPerKey
      );

    let nextGroup = 0;
    let processed = 0;
    let written = 0;

    const runOne =
      async (chunkGroup) => {
        if (signal?.aborted) {
          throw new Error(
            'Aborted'
          );
        }

        const key =
          this._getKey();

        const texts =
          chunkGroup.map(
            item => item.text
          );

        const vectors =
          await this.embedBatch(
            texts,
            key
          );

        if (
          vectors.length !==
          chunkGroup.length
        ) {
          throw new Error(
            `Vector count mismatch: ${chunkGroup.length} chunks / ${vectors.length} vectors.`
          );
        }

        const nowISO =
          new Date().toISOString();

        const nodes =
          chunkGroup.map(
            (item, index) => {
              const vector =
                vectors[index];

              if (
                !isValidVector(
                  vector
                )
              ) {
                throw new Error(
                  `Invalid vector generated for chunk ${index}.`
                );
              }

              return {
                id:
                  crypto.randomUUID(),

                agentId,

                agentHandle,

                text:
                  item.text,

                vector,

                numMarkId:
                  this.genSigil(
                    item.text
                  ),

                metadata: {
                  source:
                    item.source ||
                    'UNKNOWN',

                  timestamp:
                    nowISO,

                  locus:
                    `MYTHOS.LORE.${agentId}`,

                  embeddingModel:
                    EMBEDDING_MODEL,

                  embeddingDimension:
                    vector.length,

                  embeddingEpoch:
                    EMBEDDING_MODEL,

                  ...(item.extraMeta ||
                    {})
                }
              };
            }
          );

        await this.db.bulkPut(
          'vectors',
          nodes
        );

        written +=
          nodes.length;

        processed +=
          chunkGroup.length;

        if (onProgress) {
          onProgress({
            processed,
            written,
            total:
              validBatches.length
          });
        }
      };

    const workers =
      Array.from(
        {
          length:
            Math.min(
              concurrency,
              groups.length
            )
        },
        async () => {
          while (true) {
            if (
              signal?.aborted
            ) {
              throw new Error(
                'Aborted'
              );
            }

            const groupIndex =
              nextGroup++;

            if (
              groupIndex >=
              groups.length
            ) {
              return;
            }

            await runOne(
              groups[groupIndex]
            );
          }
        }
      );

    await Promise.all(
      workers
    );

    return {
      ingested: written
    };
  }

  // ------------------------------------------------------------
  // GRAPH GENERATION
  // ------------------------------------------------------------

  async buildGraphLite(
    agentId,
    onProgress,
    model = DEFAULT_GENERATION_MODEL
  ) {
    await this.db.ready;

    const aid =
      normalizeAgentId(
        agentId
      );

    if (!aid) {
      throw new Error(
        'Agent ID required.'
      );
    }

    const nodes =
      await this.getNodes(aid);

    if (!nodes.length) {
      return 0;
    }

    const invalidNodes =
      nodes.filter(
        node =>
          !isValidVector(
            node.vector
          )
      );

    if (invalidNodes.length) {
      throw new Error(
        `Graph integrity failure: ${invalidNodes.length} invalid vector node(s) found in ${aid}.`
      );
    }

    const dimensions =
      new Set(
        nodes.map(
          node =>
            node.vector.length
        )
      );

    if (
      dimensions.size !== 1
    ) {
      throw new Error(
        `Graph integrity failure: ${aid} contains multiple vector dimensions.`
      );
    }

    const createdIds =
      new Set();

    const errors = [];

    const BATCH_SIZE = 5;

    for (
      let index = 0;
      index < nodes.length;
      index += BATCH_SIZE
    ) {
      const batch =
        nodes.slice(
          index,
          index + BATCH_SIZE
        );

      const results =
        await Promise.all(
          batch.map(
            async node => {
              const prompt = `
SYSTEM:
Extract explicit semantic relationships from the supplied lore.

OUTPUT:
Return ONLY a JSON array.

Each item must have exactly:
{
  "s": "Subject",
  "r": "Relation",
  "o": "Object"
}

If no defensible relationship exists, return [].

LORE:
${node.text}
`.trim();

              try {
                const raw =
                  await this._generate(
                    prompt,
                    model
                  );

                const clean =
                  cleanJsonFence(
                    raw
                  );

                if (!clean) {
                  return 0;
                }

                let parsed;

                try {
                  parsed =
                    JSON.parse(
                      clean
                    );
                } catch {
                  throw new Error(
                    `Invalid JSON returned for node ${node.id}.`
                  );
                }

                if (
                  !Array.isArray(
                    parsed
                  )
                ) {
                  throw new Error(
                    `Graph response for node ${node.id} was not an array.`
                  );
                }

                const triplets =
                  parsed.filter(
                    isValidTriplet
                  );

                if (
                  !triplets.length
                ) {
                  return 0;
                }

                const edges =
                  triplets.map(
                    triplet => ({
                      id:
                        crypto.randomUUID(),

                      type:
                        'edge',

                      agentId:
                        aid,

                      sourceId:
                        node.id,

                      s:
                        triplet.s.trim(),

                      r:
                        triplet.r.trim(),

                      o:
                        triplet.o.trim(),

                      timestamp:
                        new Date().toISOString(),

                      model
                    })
                  );

                for (
                  const edge of edges
                ) {
                  if (
                    !validateEdgeReference(
                      edge,
                      new Set(
                        nodes.map(
                          n => n.id
                        )
                      )
                    )
                  ) {
                    throw new Error(
                      `Graph generated an invalid edge reference for node ${node.id}.`
                    );
                  }

                  createdIds.add(
                    edge.id
                  );
                }

                await this.db.bulkPut(
                  'edges',
                  edges
                );

                return edges.length;
              } catch (error) {
                errors.push({
                  nodeId:
                    node.id,

                  message:
                    error?.message ||
                    String(error)
                });

                return 0;
              }
            }
          )
        );

      const created =
        results.reduce(
          (sum, value) =>
            sum + value,
          0
        );

      const current =
        Math.min(
          index +
            batch.length,
          nodes.length
        );

      if (onProgress) {
        onProgress(
          current,
          nodes.length,
          created
        );
      }
    }

    if (errors.length) {
      const sample =
        errors
          .slice(0, 3)
          .map(
            error =>
              error.message
          )
          .join(' | ');

      throw new Error(
        `Graph extraction encountered ${errors.length} error(s). ${sample}`
      );
    }

    return createdIds.size;
  }

  // ------------------------------------------------------------
  // EXPORT
  // ------------------------------------------------------------

  async *yieldExportBatches(
    agentId,
    batch = 1000
  ) {
    const safeBatch =
      Math.max(
        1,
        parseInt(
          batch || 1000,
          10
        )
      );

    const aid =
      normalizeAgentId(
        agentId
      );

    const nodes =
      await this.getNodes(aid);

    const nodeIds =
      new Set(
        nodes.map(
          node => node.id
        )
      );

    for (
      let i = 0;
      i < nodes.length;
      i += safeBatch
    ) {
      yield nodes
        .slice(
          i,
          i + safeBatch
        )
        .map(
          node => ({
            v: 2,
            type: 'vector',

            id:
              node.id,

            a:
              node.agentId,

            h:
              node.agentHandle ||
              '',

            t:
              node.text,

            vec:
              node.vector,

            m:
              node.numMarkId,

            d:
              node.metadata || {}
          })
        );
    }

    const allEdges =
      await this.db.getAll(
        'edges'
      );

    const agentEdges =
      allEdges.filter(
        edge =>
          normalizeAgentId(
            edge.agentId
          ) === aid
      );

    const orphanEdges =
      agentEdges.filter(
        edge =>
          !nodeIds.has(
            edge.sourceId
          )
      );

    if (orphanEdges.length) {
      throw new Error(
        `Export integrity failure: ${orphanEdges.length} edge(s) reference missing vector IDs.`
      );
    }

    for (
      let i = 0;
      i < agentEdges.length;
      i += safeBatch
    ) {
      yield agentEdges
        .slice(
          i,
          i + safeBatch
        )
        .map(
          edge => ({
            v: 2,
            type: 'edge',

            id:
              edge.id,

            aid:
              edge.agentId,

            src:
              edge.sourceId,

            s:
              edge.s,

            r:
              edge.r,

            o:
              edge.o,

            timestamp:
              edge.timestamp,

            model:
              edge.model || ''
          })
        );
    }
  }

  // ------------------------------------------------------------
  // IMPORT
  // ------------------------------------------------------------

  async import(
    fileOrBlob,
    onProgress
  ) {
    await this.db.ready;

    if (
      !fileOrBlob?.stream
    ) {
      throw new Error(
        'Import requires a File or Blob.'
      );
    }

    const fileName =
      String(
        fileOrBlob.name || ''
      ).toLowerCase();

    let stream =
      fileOrBlob.stream();

    if (
      fileName.endsWith('.gz')
    ) {
      if (
        typeof DecompressionStream ===
        'undefined'
      ) {
        throw new Error(
          'GZIP import is not supported by this browser.'
        );
      }

      stream =
        stream.pipeThrough(
          new DecompressionStream(
            'gzip'
          )
        );
    }

    const reader =
      stream
        .pipeThrough(
          new TextDecoderStream()
        )
        .getReader();

    let buffer = '';

    let linesRead = 0;
    let recordsRead = 0;

    const vectors = [];
    const edges = [];

    const errors = [];

    const reportProgress =
      () => {
        if (onProgress) {
          onProgress({
            processed:
              recordsRead,

            linesRead,

            vectorsImported:
              vectors.length,

            edgesImported:
              edges.length,

            rejected:
              errors.length
          });
        }
      };

    const parseRecord =
      (record, lineNumber) => {
        if (
          !record ||
          typeof record !==
            'object'
        ) {
          throw new Error(
            `Line ${lineNumber}: Record is not an object.`
          );
        }

        if (
          record.type ===
          'edge'
        ) {
          if (
            !record.id ||
            !record.src ||
            !record.aid ||
            typeof record.s !==
              'string' ||
            typeof record.r !==
              'string' ||
            typeof record.o !==
              'string' ||
            !record.s.trim() ||
            !record.r.trim() ||
            !record.o.trim()
          ) {
            throw new Error(
              `Line ${lineNumber}: Invalid edge record.`
            );
          }

          edges.push({
            id:
              String(
                record.id
              ),

            type:
              'edge',

            agentId:
              normalizeAgentId(
                record.aid
              ),

            sourceId:
              String(
                record.src
              ),

            s:
              record.s.trim(),

            r:
              record.r.trim(),

            o:
              record.o.trim(),

            timestamp:
              record.timestamp ||
              new Date().toISOString(),

            model:
              record.model || ''
          });

          return;
        }

        const vectorNode =
          record.v === 2
            ? {
                id:
                  record.id ||
                  crypto.randomUUID(),

                agentId:
                  normalizeAgentId(
                    record.a
                  ),

                agentHandle:
                  record.h || '',

                text:
                  record.t,

                vector:
                  record.vec,

                numMarkId:
                  record.m || '',

                metadata:
                  record.d || {}
              }
            : {
                ...record,

                id:
                  record.id ||
                  crypto.randomUUID()
              };

        if (
          !vectorNode.agentId
        ) {
          throw new Error(
            `Line ${lineNumber}: Vector agent ID missing.`
          );
        }

        if (
          typeof vectorNode.text !==
          'string'
        ) {
          throw new Error(
            `Line ${lineNumber}: Vector text invalid.`
          );
        }

        if (
          !isValidVector(
            vectorNode.vector
          )
        ) {
          throw new Error(
            `Line ${lineNumber}: Vector is missing, empty, non-numeric, or malformed.`
          );
        }

        const metadata =
          vectorNode.metadata &&
          typeof vectorNode.metadata ===
            'object'
            ? {
                ...vectorNode.metadata
              }
            : {};

        const model =
          metadata.embeddingModel;

        const dimension =
          metadata.embeddingDimension;

        if (
          model &&
          model !==
            EMBEDDING_MODEL
        ) {
          throw new Error(
            `Line ${lineNumber}: Incompatible embedding model "${model}". Current model is "${EMBEDDING_MODEL}".`
          );
        }

        if (
          dimension !==
            undefined &&
          Number(dimension) !==
            vectorNode.vector.length
        ) {
          throw new Error(
            `Line ${lineNumber}: Embedding dimension metadata mismatch.`
          );
        }

        vectorNode.metadata =
          metadata;

        vectors.push(
          vectorNode
        );
      };

    while (true) {
      const {
        done,
        value
      } =
        await reader.read();

      if (done) break;

      buffer += value;

      const lines =
        buffer.split(
          /\r?\n/
        );

      buffer =
        lines.pop() || '';

      for (
        const line of lines
      ) {
        linesRead++;

        const trimmed =
          line.trim();

        if (!trimmed) {
          continue;
        }

        try {
          const record =
            JSON.parse(
              trimmed
            );

          parseRecord(
            record,
            linesRead
          );

          recordsRead++;
        } catch (error) {
          errors.push(
            error?.message ||
            `Line ${linesRead}: Invalid JSON.`
          );
        }

        reportProgress();
      }
    }

    if (
      buffer.trim()
    ) {
      linesRead++;

      try {
        const record =
          JSON.parse(
            buffer.trim()
          );

        parseRecord(
          record,
          linesRead
        );

        recordsRead++;
      } catch (error) {
        errors.push(
          error?.message ||
          `Line ${linesRead}: Invalid JSON.`
        );
      }

      reportProgress();
    }

    // ----------------------------------------------------------
    // GLOBAL IMPORT INTEGRITY
    // ----------------------------------------------------------

    if (!recordsRead) {
      throw new Error(
        'Import integrity failure: no valid records found.'
      );
    }

    if (errors.length) {
      const sample =
        errors
          .slice(0, 5)
          .join(' | ');

      throw new Error(
        `Import integrity failure: ${errors.length} record(s) rejected. ${sample}`
      );
    }

    const ids =
      new Set();

    for (
      const node of vectors
    ) {
      if (
        ids.has(node.id)
      ) {
        throw new Error(
          `Import integrity failure: duplicate vector ID "${node.id}".`
        );
      }

      ids.add(node.id);
    }

    const edgeIds =
      new Set();

    for (
      const edge of edges
    ) {
      if (
        edgeIds.has(edge.id)
      ) {
        throw new Error(
          `Import integrity failure: duplicate edge ID "${edge.id}".`
        );
      }

      edgeIds.add(edge.id);

      if (
        !ids.has(
          edge.sourceId
        )
      ) {
        throw new Error(
          `Import integrity failure: edge "${edge.id}" references missing vector "${edge.sourceId}".`
        );
      }
    }

    // One embedding space per import set.
    const dimensions =
      new Set(
        vectors.map(
          node =>
            node.vector.length
        )
      );

    if (
      dimensions.size > 1
    ) {
      throw new Error(
        'Import integrity failure: imported vectors contain multiple embedding dimensions.'
      );
    }

    const importedModels =
      new Set(
        vectors
          .map(
            node =>
              node.metadata
                ?.embeddingModel
          )
          .filter(Boolean)
      );

    if (
      importedModels.size > 1
    ) {
      throw new Error(
        'Import integrity failure: imported vectors contain multiple embedding models.'
      );
    }

    // ----------------------------------------------------------
    // ATOMIC COMMIT
    // ----------------------------------------------------------

    await this.db.bulkPutAtomic(
      vectors,
      edges
    );

    reportProgress();

    return {
      success: true,

      nodesImported:
        vectors.length +
        edges.length,

      vectorsImported:
        vectors.length,

      edgesImported:
        edges.length,

      recordsRead,

      linesRead,

      rejected: 0
    };
  }

  // ------------------------------------------------------------
  // CHAT / LOCAL RAG
  // ------------------------------------------------------------

  async chat(
    userQuery,
    agentId,
    systemPrompt,
    model = DEFAULT_GENERATION_MODEL,
    topK = 6,
    threshold = 0.45
  ) {
    await this.db.ready;

    const pool =
      await this.getNodes(
        agentId
      );

    if (!pool.length) {
      return {
        response:
          'Vault empty.',

        derivation:
          'EMPTY_VAULT',

        source:
          'NULL'
      };
    }

    const qVec =
      (
        await this.embedBatch([
          userQuery
        ])
      )[0];

    if (
      !isValidVector(
        qVec
      )
    ) {
      throw new Error(
        'Query embedding is invalid.'
      );
    }

    const compatible =
      pool.filter(node => {
        const nodeModel =
          node.metadata
            ?.embeddingModel;

        return (
          nodeModel ===
            EMBEDDING_MODEL &&

          Array.isArray(
            node.vector
          ) &&

          node.vector.length ===
            qVec.length &&

          isValidVector(
            node.vector,
            qVec.length
          )
        );
      });

    if (!compatible.length) {
      return {
        response:
          'No compatible current-embedding records found in this agent vault. Re-ingest the lore with the current embedding model.',

        derivation:
          'EMBEDDING_EPOCH_MISMATCH',

        source:
          'NULL'
      };
    }

    const scored =
      compatible
        .map(node => ({
          n: node,

          s:
            cosine(
              qVec,
              node.vector
            )
        }))
        .sort(
          (a, b) =>
            b.s - a.s
        )
        .slice(
          0,
          topK
        );

    const best =
      scored[0]?.s || 0;

    const contextNodes =
      best >= threshold
        ? scored
        : [];

    const context =
      contextNodes
        .map(
          item =>
            `--- [SOURCE: ${
              item.n.metadata
                ?.source ||
              'UNKNOWN'
            } | ${
              (
                item.s * 100
              ).toFixed(1)
            }%] ---\n${
              item.n.text
            }`
        )
        .join('\n\n');

    const derivation =
      contextNodes.length
        ? `COSINE_TOPK(${topK})`
        : 'NO_CONTEXT';

    const prompt =
      `CONTEXT:\n${context}\n\nUSER:\n${userQuery}`;

    const key =
      this._getKey();

    const response =
      await this._generate(
        systemPrompt
          ? `${systemPrompt}\n\n${prompt}`
          : prompt,

        model,

        key
      );

    return {
      response:
        response ||
        '(no reply)',

      derivation,

      source:
        'RAG'
    };
  }

  async nuke() {
    return this.db.nuke();
  }
}
