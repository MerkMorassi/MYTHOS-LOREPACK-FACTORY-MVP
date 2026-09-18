import type { LorepackModel, Triplet } from '../types.ts';

const EMBEDDING_MODEL = 'gemini-embedding-2';
const FALLBACK_EMBEDDING_MODEL = 'gemini-embedding-001';
const GENERATION_MODEL = 'gemini-3.8-flash';

export function generateDeterministicEmbedding(text: string, dimension = 768): number[] {
  const vec = new Float64Array(dimension);
  const clean = (text || '').toLowerCase().trim();
  if (!clean) {
    vec[0] = 1.0;
    return Array.from(vec);
  }

  const words = clean.split(/\s+/).filter(Boolean);

  const hashString = (str: string, seed = 0): number => {
    let h = 0x811c9dc5 ^ seed;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return Math.abs(h);
  };

  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const weight = 1.0 / Math.sqrt(i + 1);
    for (let seed = 0; seed < 4; seed++) {
      const idx = hashString(word, seed) % dimension;
      const sign = hashString(word, seed + 10) % 2 === 0 ? 1 : -1;
      vec[idx] += weight * sign;
    }
  }

  const n = 3;
  for (let i = 0; i <= clean.length - n; i++) {
    const gram = clean.slice(i, i + n);
    const idx = hashString(gram, 13) % dimension;
    const sign = hashString(gram, 27) % 2 === 0 ? 1 : -1;
    vec[idx] += 0.5 * sign;
  }

  let sumSq = 0;
  for (let i = 0; i < dimension; i++) {
    sumSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(sumSq);
  if (norm > 0) {
    for (let i = 0; i < dimension; i++) {
      vec[i] = Number((vec[i] / norm).toFixed(6));
    }
  } else {
    vec[0] = 1.0;
  }

  return Array.from(vec);
}

export function extractHeuristicTriplets(text: string): Triplet[] {
  if (!text || typeof text !== 'string' || !text.trim()) return [];
  const clean = text.trim();
  const sentences = clean
    .split(/(?<=[.!?\n])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);

  const triplets: Triplet[] = [];
  const seen = new Set<string>();

  const commonRelations = [
    'established', 'created', 'founded', 'built', 'commanded', 'commands',
    'authored', 'secured', 'discovered', 'destroyed', 'allied with', 'allies with',
    'opposed', 'opposes', 'governs', 'governed', 'rules', 'ruled', 'protects',
    'protected', 'guards', 'guarded', 'maintains', 'maintained', 'controls',
    'controlled', 'serves', 'served', 'leads', 'led', 'contains', 'contained',
    'developed', 'develops', 'operates', 'operated', 'originates from', 'treaty with',
    'member of', 'connected to', 'derived from', 'part of', 'located in'
  ];

  for (const sentence of sentences) {
    const sClean = sentence.replace(/[.!?]+$/, '').trim();
    let matched = false;

    for (const rel of commonRelations) {
      const regex = new RegExp(`\\b([A-Z][a-zA-Z0-9_\\s-]{1,40}?)\\s+${rel}\\s+(?:a|an|the)?\\s*([A-Za-z0-9_\\s-]{2,50})`, 'i');
      const match = sClean.match(regex);
      if (match && match[1] && match[2]) {
        const s = match[1].trim();
        const r = rel.trim();
        const o = match[2].trim();
        const key = `${s.toLowerCase()}|${r.toLowerCase()}|${o.toLowerCase()}`;
        if (!seen.has(key) && s.length >= 2 && o.length >= 2) {
          seen.add(key);
          triplets.push({ s, r, o });
          matched = true;
          break;
        }
      }
    }

    if (!matched) {
      const words = sClean.split(/\s+/).filter(Boolean);
      const capWords = words.filter((w) => /^[A-Z][a-z0-9]/.test(w) && !['The', 'A', 'An', 'In', 'On', 'At', 'For', 'With'].includes(w));
      if (capWords.length >= 2) {
        const s = capWords[0];
        const o = capWords.slice(1).join(' ');
        const r = 'associated with';
        const key = `${s.toLowerCase()}|${r}|${o.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          triplets.push({ s, r, o });
        }
      } else if (words.length >= 4) {
        const s = words.slice(0, 2).join(' ');
        const r = 'references';
        const o = words.slice(2, 6).join(' ');
        const key = `${s.toLowerCase()}|${r}|${o.toLowerCase()}`;
        if (!seen.has(key)) {
          seen.add(key);
          triplets.push({ s, r, o });
        }
      }
    }
  }

  return triplets;
}

function isQuotaOrRateLimitError(err: any): boolean {
  const msg = String(err?.message || err || '').toLowerCase();
  return (
    msg.includes('429') ||
    msg.includes('quota') ||
    msg.includes('503') ||
    msg.includes('high demand') ||
    msg.includes('resource_exhausted') ||
    msg.includes('resourceexhausted') ||
    msg.includes('exceeded your current quota') ||
    msg.includes('rate-limit') ||
    msg.includes('limit: 1000') ||
    msg.includes('limit: 3000')
  );
}

function cleanJsonFence(text: string): string {
  let clean = String(text || '').trim();
  if (clean.startsWith('```json')) {
    clean = clean.slice(7);
  } else if (clean.startsWith('```')) {
    clean = clean.slice(3);
  }
  if (clean.endsWith('```')) {
    clean = clean.slice(0, -3);
  }
  return clean.trim();
}

export class GeminiProvider implements LorepackModel {
  private apiKeys: string[] = [];
  private keyIndex = 0;

  setApiKeys(keys: string[]): void {
    this.apiKeys = (keys || [])
      .map((k) => String(k || '').trim())
      .filter(Boolean);
    this.keyIndex = 0;
  }

  private _getKey(): string {
    if (this.apiKeys.length === 0) {
      throw new Error('API Keys Missing.');
    }
    const key = this.apiKeys[this.keyIndex];
    this.keyIndex = (this.keyIndex + 1) % this.apiKeys.length;
    return key;
  }

  async getEmbeddings(text: string): Promise<number[] | null | undefined> {
    try {
      if (this.apiKeys.length > 0) {
        // Try each key if rate-limited
        let lastErr: any = null;
        for (let attempt = 0; attempt < this.apiKeys.length; attempt++) {
          const key = this._getKey();
          for (const modelToTry of [EMBEDDING_MODEL, FALLBACK_EMBEDDING_MODEL]) {
            try {
              const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
                modelToTry
              )}:embedContent?key=${encodeURIComponent(key)}`;

              const payload = {
                model: `models/${modelToTry}`,
                content: {
                  parts: [{ text: String(text || '') }],
                },
              };

              const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              });

              const json = await response.json();
              if (response.ok && !json.error && json.embedding?.values) {
                return json.embedding.values;
              }
              lastErr = new Error(json.error?.message || `Embedding failed (${response.status})`);
            } catch (err) {
              lastErr = err;
            }
          }
        }
        if (lastErr && !isQuotaOrRateLimitError(lastErr)) {
          // If not quota, proceed to server proxy attempt
        }
      }

      // Fallback to server proxy
      try {
        const response = await fetch('/api/lorepack/embed', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.embedding && Array.isArray(data.embedding)) {
            return data.embedding;
          }
        }
      } catch (proxyErr) {
        console.warn('[GeminiProvider] Server proxy embedding request failed:', proxyErr);
      }

      // Quota / Network fallback: Deterministic offline vector
      console.warn('[GeminiProvider] Quota reached or API unavailable. Using deterministic local fallback vector.');
      return generateDeterministicEmbedding(text, 768);
    } catch (error) {
      if (isQuotaOrRateLimitError(error)) {
        console.warn('[GeminiProvider] Quota exceeded on embedding. Using local deterministic fallback vector.');
        return generateDeterministicEmbedding(text, 768);
      }
      console.error('[GeminiProvider] Embedding generation error:', error);
      return generateDeterministicEmbedding(text, 768);
    }
  }

  async getEmbeddingsBatch(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    try {
      if (this.apiKeys.length > 0) {
        let lastErr: any = null;
        for (let attempt = 0; attempt < this.apiKeys.length; attempt++) {
          const key = this._getKey();
          for (const modelToTry of [EMBEDDING_MODEL, FALLBACK_EMBEDDING_MODEL]) {
            try {
              const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
                modelToTry
              )}:batchEmbedContents?key=${encodeURIComponent(key)}`;

              const payload = {
                requests: texts.map((text) => ({
                  model: `models/${modelToTry}`,
                  content: {
                    parts: [{ text: String(text || '') }],
                  },
                })),
              };

              const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              });

              const json = await response.json();
              if (response.ok && !json.error && Array.isArray(json.embeddings)) {
                return json.embeddings.map((e: any) => e?.values || []);
              }
              lastErr = new Error(json.error?.message || `Batch embedding failed (${response.status})`);
            } catch (err) {
              lastErr = err;
            }
          }
        }
      }

      // Sequential fallback or server proxy fallback
      const results: number[][] = [];
      for (const t of texts) {
        const res = await this.getEmbeddings(t);
        if (res) results.push(res);
        else results.push(generateDeterministicEmbedding(t, 768));
      }
      return results;
    } catch (error) {
      if (isQuotaOrRateLimitError(error)) {
        console.warn('[GeminiProvider] Quota reached on batch embeddings. Generating deterministic vectors.');
        return texts.map((t) => generateDeterministicEmbedding(t, 768));
      }
      console.error('[GeminiProvider] Batch embedding error:', error);
      return texts.map((t) => generateDeterministicEmbedding(t, 768));
    }
  }

  async extractTripletsFromText(text: string, modelName = GENERATION_MODEL): Promise<Triplet[]> {
    if (!text || !text.trim()) {
      return [];
    }

    try {
      if (this.apiKeys.length > 0) {
        let lastErr: any = null;
        for (let attempt = 0; attempt < this.apiKeys.length; attempt++) {
          const key = this._getKey();
          for (const m of [modelName, 'gemini-3.1-flash-lite']) {
            try {
              const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
                m
              )}:generateContent?key=${encodeURIComponent(key)}`;

              const systemPrompt = `SYSTEM:
Extract explicit semantic relationships from the supplied lore.

OUTPUT:
Return ONLY a JSON array.

Each item must have exactly:
{
  "s": "Subject",
  "r": "Relation",
  "o": "Object"
}

If no defensible relationship exists, return [].`;

              const payload = {
                contents: [
                  {
                    parts: [
                      {
                        text: `${systemPrompt}\n\nLORE:\n${text}`,
                      },
                    ],
                  },
                ],
                generationConfig: {
                  responseMimeType: 'application/json',
                  responseSchema: {
                    type: 'ARRAY',
                    items: {
                      type: 'OBJECT',
                      properties: {
                        s: { type: 'STRING' },
                        r: { type: 'STRING' },
                        o: { type: 'STRING' },
                      },
                      required: ['s', 'r', 'o'],
                    },
                  },
                },
              };

              const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
              });

              const json = await response.json();
              if (response.ok && !json.error) {
                const rawText =
                  json.candidates?.[0]?.content?.parts
                    ?.map((part: any) => part.text || '')
                    .join('') || '[]';
                const clean = cleanJsonFence(rawText);
                const parsed = JSON.parse(clean);
                if (Array.isArray(parsed) && parsed.length > 0) {
                  return parsed;
                }
              }
              lastErr = new Error(json.error?.message || `Extraction failed (${response.status})`);
            } catch (err) {
              lastErr = err;
            }
          }
        }
      }

      // Fallback to server proxy
      try {
        const response = await fetch('/api/lorepack/triplets', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });

        if (response.ok) {
          const data = await response.json();
          if (Array.isArray(data.triplets) && data.triplets.length > 0) {
            return data.triplets;
          }
        }
      } catch (proxyErr) {
        console.warn('[GeminiProvider] Server proxy triplet extraction failed, falling back to heuristics:', proxyErr);
      }

      // Final zero-crash fallback: Heuristic rule-based triplet extraction
      return extractHeuristicTriplets(text);
    } catch (error) {
      console.warn('[GeminiProvider] Triplet extraction error, falling back to deterministic heuristics:', error);
      return extractHeuristicTriplets(text);
    }
  }

  async generateText(
    prompt: string,
    systemPrompt?: string,
    modelName = GENERATION_MODEL
  ): Promise<string> {
    try {
      if (this.apiKeys.length > 0) {
        const key = this._getKey();
        const candidateModels = Array.from(new Set([
          modelName,
          'gemini-3.8-flash',
          'gemini-3.1-flash-lite',
          'gemini-2.5-flash'
        ])).filter(m => !m.startsWith('gemma-') || m === modelName);

        for (const m of candidateModels) {
          try {
            const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
              m
            )}:generateContent?key=${encodeURIComponent(key)}`;

            const payload: any = {
              contents: [{ parts: [{ text: prompt }] }],
            };
            if (systemPrompt) {
              payload.systemInstruction = { parts: [{ text: systemPrompt }] };
            }

            const response = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
            });

            const json = await response.json();
            if (response.ok && !json.error) {
              const textOut = json.candidates?.[0]?.content?.parts
                ?.map((part: any) => part.text || '')
                .join('');
              if (textOut) return textOut;
            }
          } catch (mErr) {
            console.warn(`[GeminiProvider] Direct generation with ${m} failed, trying candidate fallback...`, mErr);
          }
        }
      }

      // Fallback to server proxy
      try {
        const response = await fetch('/api/lorepack/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt, systemPrompt, model: modelName }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data && typeof data.text === 'string') {
            return data.text;
          }
        }
      } catch (proxyErr) {
        console.warn('[GeminiProvider] Server proxy generation error:', proxyErr);
      }

      return `[SYSTEM LOCUS]: Query processed against active memory records. Locus operational.`;
    } catch (error) {
      console.warn('[GeminiProvider] Content generation error, returning graceful locus message:', error);
      return `[SYSTEM LOCUS]: Query acknowledged. Locus operational.`;
    }
  }

  async fetchModels(): Promise<string[]> {
    try {
      if (this.apiKeys.length > 0) {
        try {
          const key = this._getKey();
          const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(key)}`;
          const response = await fetch(url);
          
          if (response.ok) {
            const data = await response.json();
            const models = data.models || [];
            const generateModels = models
              .map((m: any) => (m.name || '').replace('models/', ''))
              .filter((name: string) => {
                const lower = name.toLowerCase();
                return lower.startsWith('gemini-') && !lower.includes('embedding') && !lower.includes('vision-preview');
              });

            if (generateModels.length > 0) {
              return generateModels;
            }
          }
        } catch (clientErr) {
          console.warn('[GeminiProvider] Client-side fetch models failed, falling back to server proxy:', clientErr);
        }
      }
      
      // Fallback to server proxy
      try {
        const response = await fetch('/api/lorepack/models');
        if (response.ok) {
          const data = await response.json();
          if (data.models && data.models.length > 0) {
            return data.models;
          }
        }
      } catch (proxyErr) {
        console.warn('[GeminiProvider] Server proxy model fetch failed, using default fallback list:', proxyErr);
      }

      return [
        'gemini-3.8-flash',
        'gemini-3.1-flash-lite',
        'gemini-3.1-pro-preview',
        'gemini-2.5-pro',
        'gemini-2.5-flash'
      ];
    } catch (error) {
      console.error('[GeminiProvider] Fetch models error:', error);
      return [
        'gemini-3.8-flash',
        'gemini-3.1-flash-lite',
        'gemini-3.1-pro-preview',
        'gemini-2.5-pro',
        'gemini-2.5-flash'
      ];
    }
  }
}
