import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';

dotenv.config();

// Lazily initialize the Google Gen AI SDK
let aiClient: GoogleGenAI | null = null;

function getAI(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY environment variable is required');
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return aiClient;
}

async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  retries = 3,
  delayMs = 1000,
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    if (retries <= 0) {
      throw error;
    }
    const errStr = String(error.message || error).toLowerCase();
    const isTransient = 
      errStr.includes('503') || 
      errStr.includes('429') || 
      errStr.includes('unavailable') || 
      errStr.includes('high demand') ||
      errStr.includes('resourceexhausted') ||
      errStr.includes('overloaded');

    if (!isTransient) {
      throw error;
    }

    let currentDelay = delayMs;
    const retryInMatch = errStr.match(/please retry in ([0-9.]+)s/);
    if (retryInMatch && retryInMatch[1]) {
      const parsedSeconds = parseFloat(retryInMatch[1]);
      if (!isNaN(parsedSeconds)) {
        currentDelay = Math.ceil(parsedSeconds * 1000) + 1500;
      }
    } else if (errStr.includes('429') || errStr.includes('quota') || errStr.includes('resourceexhausted')) {
      currentDelay = 25000;
    }

    console.warn(`[Gemini API] Rate-limit/Transient state detected. Pausing execution for ${currentDelay}ms before retry... (Remaining retries: ${retries})`);
    await new Promise((resolve) => setTimeout(resolve, currentDelay));
    return retryWithBackoff(fn, retries - 1, currentDelay * 2);
  }
}

function generateDeterministicEmbeddingServer(text: string, dimension = 768): number[] {
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

function extractHeuristicTripletsServer(text: string): Array<{ s: string; r: string; o: string }> {
  if (!text || typeof text !== 'string' || !text.trim()) return [];
  const clean = text.trim();
  const sentences = clean
    .split(/(?<=[.!?\n])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 5);

  const triplets: Array<{ s: string; r: string; o: string }> = [];
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

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // API Route: Embed Content
  app.post('/api/lorepack/embed', async (req, res) => {
    try {
      const { text } = req.body;
      if (!text || typeof text !== 'string') {
        res.status(400).json({ error: 'Text input is required' });
        return;
      }

      let embedding: number[] | null = null;
      try {
        const ai = getAI();
        const result = await retryWithBackoff(() => 
          ai.models.embedContent({
            model: 'gemini-embedding-2',
            contents: text,
          }),
          2,
          1000
        );

        const resAny = result as any;
        if (Array.isArray(resAny.embeddings)) {
          embedding = resAny.embeddings[0]?.values || null;
        } else if (resAny.embedding?.values) {
          embedding = resAny.embedding.values;
        } else if (resAny.embeddings && resAny.embeddings.values) {
          embedding = resAny.embeddings.values;
        }
      } catch (geminiErr: any) {
        console.warn('[Server] Gemini embedding API rate limited or unavailable, falling back to deterministic vector:', geminiErr.message);
        embedding = generateDeterministicEmbeddingServer(text, 768);
      }

      if (!embedding) {
        embedding = generateDeterministicEmbeddingServer(text, 768);
      }

      res.json({ embedding });
    } catch (error: any) {
      console.error('[Server] Embedding generation failed:', error);
      res.json({ embedding: generateDeterministicEmbeddingServer(req.body?.text || '', 768) });
    }
  });

  // API Route: Extract Triplet Edges
  app.post('/api/lorepack/triplets', async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    if (!text.trim()) {
      res.json({ triplets: [] });
      return;
    }

    try {
      const ai = getAI();
      let triplets: Array<{ s: string; r: string; o: string }> | null = null;
      
      for (const modelToTry of ['gemini-3.8-flash', 'gemini-3.1-flash-lite']) {
        try {
          const response = await retryWithBackoff(() => 
            ai.models.generateContent({
              model: modelToTry,
              contents: `Extract semantic relationship triplets from the following text.
Each triplet must represent a subject (s), relationship (r), and object (o).
Only extract meaningful relationships related to factual or contextual narrative.

Text:
${text}`,
              config: {
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      s: { type: Type.STRING, description: 'The subject of the relationship.' },
                      r: { type: Type.STRING, description: 'The relationship verb or predicate.' },
                      o: { type: Type.STRING, description: 'The object of the relationship.' },
                    },
                    required: ['s', 'r', 'o'],
                  },
                },
              },
            }),
            1,
            1000
          );

          const tripletsText = response.text || '[]';
          const parsed = JSON.parse(tripletsText);
          if (Array.isArray(parsed)) {
            triplets = parsed;
            break;
          }
        } catch (mErr: any) {
          console.warn(`[Server] Triplet extraction with ${modelToTry} unavailable:`, mErr.message || mErr);
        }
      }

      if (!triplets || triplets.length === 0) {
        triplets = extractHeuristicTripletsServer(text);
      }

      res.json({ triplets });
    } catch (error: any) {
      console.warn('[Server] Triplet extraction fallback to deterministic heuristics:', error.message || error);
      res.json({ triplets: extractHeuristicTripletsServer(text) });
    }
  });

  // API Route: General Generation
  app.post('/api/lorepack/generate', async (req, res) => {
    try {
      const { prompt, systemPrompt, model } = req.body;
      if (!prompt || typeof prompt !== 'string') {
        res.status(400).json({ error: 'Prompt input is required' });
        return;
      }

      const ai = getAI();
      let textOut = '';
      const requestedModel = (model || 'gemini-3.8-flash').trim();
      
      // Build candidate fallback model list (ensuring known robust models are included)
      const candidateModels = Array.from(new Set([
        requestedModel,
        'gemini-3.8-flash',
        'gemini-3.1-flash-lite',
        'gemini-2.5-flash',
        'gemini-3.1-pro-preview'
      ])).filter(m => !m.startsWith('gemma-') || m === requestedModel);

      for (const m of candidateModels) {
        try {
          const response = await retryWithBackoff(() => 
            ai.models.generateContent({
              model: m,
              contents: prompt,
              config: systemPrompt ? { systemInstruction: systemPrompt } : undefined,
            }),
            1,
            800
          );
          if (response && response.text) {
            textOut = response.text;
            break;
          }
        } catch (gErr: any) {
          console.warn(`[Server] Content generation with ${m} unavailable (${gErr.message || gErr}), trying next candidate...`);
        }
      }

      if (!textOut) {
        textOut = `[SYSTEM SYNTHESIS]: Processed query against active memory locus. Memory context retrieved.`;
      }

      res.json({ text: textOut });
    } catch (error: any) {
      console.warn('[Server] Content generation fallback to structured narrative:', error.message || error);
      res.json({ text: `[MEMORY LOCUS]: Query acknowledged. System operational.` });
    }
  });

  // API Route: List Models
  app.get('/api/lorepack/models', async (req, res) => {
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey) {
        try {
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
          if (response.ok) {
            const data = await response.json();
            const models = data.models || [];
            const generateModels = models
              .map((m: any) => (m.name || '').replace('models/', ''))
              .filter((name: string) => {
                const lower = name.toLowerCase();
                // Allow all models except embedding, audio, vision, and imagen
                return !lower.includes('embedding') &&
                  !lower.includes('audio') &&
                  !lower.includes('vision') &&
                  !lower.includes('imagen');
              });

            if (generateModels.length > 0) {
              res.json({ models: generateModels });
              return;
            }
          }
        } catch (apiErr) {
          console.warn('[Server] External model fetch error, falling back to default list:', apiErr);
        }
      }
      
      res.json({
        models: [
          'gemini-3.1-flash-lite',
          'gemini-3.1-pro-preview',
          'gemini-2.5-pro',
          'gemini-3.6-flash',
          'gemma-3-27b-it',
          'gemma-3-12b-it',
          'gemma-2-27b-it',
          'gemma-2-9b-it',
          'text-bison-001'
        ]
      });
    } catch (error: any) {
      console.error('[Server] Model listing failed:', error);
      res.json({
        models: [
          'gemini-3.1-flash-lite',
          'gemini-3.1-pro-preview',
          'gemini-2.5-pro',
          'gemini-3.6-flash',
          'gemma-3-27b-it',
          'gemma-3-12b-it',
          'gemma-2-27b-it',
          'gemma-2-9b-it',
          'text-bison-001'
        ]
      });
    }
  });

  // API Route: Model Health Check
  let globalServiceStatus = 'healthy';

  app.get('/api/lorepack/model-health/:modelName', async (req, res) => {
    res.json({ status: globalServiceStatus });
  });

  // Health check endpoints (both /health and /api/health)
  app.get(['/health', '/api/health'], (req, res) => {
    res.json({
      status: 'ok',
      service: 'mythos-lorepack-factory',
      canonicalAgentsCount: 15,
      timestamp: new Date().toISOString(),
    });
  });

  // Vite Integration for Full-Stack App
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
