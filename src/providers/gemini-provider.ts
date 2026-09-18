import type { LorepackModel, Triplet } from '../types.ts';

const EMBEDDING_MODEL = 'gemini-embedding-2';
const GENERATION_MODEL = 'gemini-3.6-flash';

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
        const key = this._getKey();
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          EMBEDDING_MODEL
        )}:embedContent?key=${encodeURIComponent(key)}`;

        const payload = {
          model: `models/${EMBEDDING_MODEL}`,
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
        if (!response.ok || json.error) {
          throw new Error(json.error?.message || `Embedding failed (${response.status})`);
        }

        return json.embedding?.values || null;
      }

      // Fallback to server proxy
      const response = await fetch('/api/lorepack/embed', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Embedding request failed: ${response.status} - ${errorText}`);
      }

      const contentType = response.headers?.get ? response.headers.get('Content-Type') || '' : 'application/json';
      if (contentType && !contentType.includes('application/json')) {
        const textBody = await response.text();
        if (textBody.trim().startsWith('<')) {
          throw new Error(`Embedding server returned HTML (status: ${response.status}) instead of JSON. This often indicates a gateway timeout, missing route, or SPA fallback. Content preview: ${textBody.slice(0, 150)}`);
        }
      }

      const data = await response.json();
      return data.embedding;
    } catch (error) {
      console.error('[GeminiProvider] Embedding generation error:', error);
      throw error;
    }
  }

  async getEmbeddingsBatch(texts: string[]): Promise<number[][]> {
    if (!texts.length) return [];
    try {
      if (this.apiKeys.length > 0) {
        const key = this._getKey();
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          EMBEDDING_MODEL
        )}:batchEmbedContents?key=${encodeURIComponent(key)}`;

        const payload = {
          requests: texts.map((text) => ({
            model: `models/${EMBEDDING_MODEL}`,
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
        if (!response.ok || json.error) {
          throw new Error(json.error?.message || `Batch embedding failed (${response.status})`);
        }

        const embeddings = json.embeddings || [];
        return embeddings.map((e: any) => e?.values || []);
      }

      // Sequential fallback on backend (usually fast enough, but we batch if needed)
      const results: number[][] = [];
      for (const t of texts) {
        const res = await this.getEmbeddings(t);
        if (res) results.push(res);
      }
      return results;
    } catch (error) {
      console.error('[GeminiProvider] Batch embedding error:', error);
      throw error;
    }
  }

  async extractTripletsFromText(text: string, modelName = GENERATION_MODEL): Promise<Triplet[]> {
    if (!text || !text.trim()) {
      return [];
    }

    try {
      if (this.apiKeys.length > 0) {
        const key = this._getKey();
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          modelName
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
        if (!response.ok || json.error) {
          throw new Error(json.error?.message || `Triplet extraction failed (${response.status})`);
        }

        const rawText =
          json.candidates?.[0]?.content?.parts
            ?.map((part: any) => part.text || '')
            .join('') || '[]';

        const clean = cleanJsonFence(rawText);
        return JSON.parse(clean);
      }

      // Fallback to server proxy
      const response = await fetch('/api/lorepack/triplets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Triplet extraction request failed: ${response.status} - ${errorText}`);
      }

      const contentType = response.headers?.get ? response.headers.get('Content-Type') || '' : 'application/json';
      if (contentType && !contentType.includes('application/json')) {
        const textBody = await response.text();
        if (textBody.trim().startsWith('<')) {
          throw new Error(`Triplet extraction server returned HTML (status: ${response.status}) instead of JSON. This often indicates a gateway timeout, missing route, or SPA fallback. Content preview: ${textBody.slice(0, 150)}`);
        }
      }

      const data = await response.json();
      return data.triplets || [];
    } catch (error) {
      console.error('[GeminiProvider] Triplet extraction error:', error);
      throw error;
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
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
          modelName
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
        if (!response.ok || json.error) {
          throw new Error(json.error?.message || `Generation failed (${response.status})`);
        }

        return (
          json.candidates?.[0]?.content?.parts
            ?.map((part: any) => part.text || '')
            .join('') || ''
        );
      }

      // Fallback to server proxy
      const response = await fetch('/api/lorepack/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, systemPrompt, model: modelName }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Generate request failed: ${response.status} - ${errorText}`);
      }

      const contentType = response.headers?.get ? response.headers.get('Content-Type') || '' : 'application/json';
      if (contentType && !contentType.includes('application/json')) {
        const textBody = await response.text();
        if (textBody.trim().startsWith('<')) {
          throw new Error(`Generate server returned HTML (status: ${response.status}) instead of JSON. This often indicates a gateway timeout, missing route, or SPA fallback. Content preview: ${textBody.slice(0, 150)}`);
        }
      }

      const data = await response.json();
      return data.text || '';
    } catch (error) {
      console.error('[GeminiProvider] Content generation error:', error);
      throw error;
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
            if (models.length > 0) {
              return models.map((m: any) => m.name.replace('models/', ''));
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
        'gemini-3.6-flash',
        'gemini-3.8-flash',
        'gemini-3-flash-preview',
        'gemini-3.1-pro-preview',
        'gemini-2.5-pro',
        'gemini-1.5-flash',
        'gemini-1.5-pro'
      ];
    } catch (error) {
      console.error('[GeminiProvider] Fetch models error:', error);
      return [
        'gemini-3.6-flash',
        'gemini-3.8-flash',
        'gemini-3-flash-preview',
        'gemini-3.1-pro-preview',
        'gemini-2.5-pro',
        'gemini-1.5-flash',
        'gemini-1.5-pro'
      ];
    }
  }
}
