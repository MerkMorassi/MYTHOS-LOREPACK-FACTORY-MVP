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

      const ai = getAI();
      const result = await retryWithBackoff(() => 
        ai.models.embedContent({
          model: 'gemini-embedding-2',
          contents: text,
        })
      );

      const resAny = result as any;
      let embedding: number[] | null = null;
      if (Array.isArray(resAny.embeddings)) {
        embedding = resAny.embeddings[0]?.values || null;
      } else if (resAny.embedding?.values) {
        embedding = resAny.embedding.values;
      } else if (resAny.embeddings && resAny.embeddings.values) {
        embedding = resAny.embeddings.values;
      }

      if (!embedding) {
        throw new Error('Failed to extract embedding from response');
      }

      res.json({ embedding });
    } catch (error: any) {
      console.error('[Server] Embedding generation failed:', error);
      res.status(500).json({ error: error.message || 'Failed to generate embedding' });
    }
  });

  // API Route: Extract Triplet Edges
  app.post('/api/lorepack/triplets', async (req, res) => {
    try {
      const { text } = req.body;
      if (typeof text !== 'string') {
        res.status(400).json({ error: 'Text input must be a string' });
        return;
      }
      if (!text.trim()) {
        res.json({ triplets: [] });
        return;
      }

      const ai = getAI();
      const response = await retryWithBackoff(() => 
        ai.models.generateContent({
          model: 'gemini-3.6-flash',
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
        })
      );

      const tripletsText = response.text || '[]';
      const triplets = JSON.parse(tripletsText);
      res.json({ triplets });
    } catch (error: any) {
      console.error('[Server] Triplet extraction failed:', error);
      res.status(500).json({ error: error.message || 'Failed to extract triplets' });
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
      const response = await retryWithBackoff(() => 
        ai.models.generateContent({
          model: model || 'gemini-3.6-flash',
          contents: prompt,
          config: systemPrompt ? { systemInstruction: systemPrompt } : undefined,
        })
      );

      res.json({ text: response.text || '' });
    } catch (error: any) {
      console.error('[Server] Content generation failed:', error);
      res.status(500).json({ error: error.message || 'Failed to generate content' });
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
            const generateModels = models.map((m: any) => m.name.replace('models/', ''));
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
          'gemini-3.6-flash',
          'gemini-3.8-flash',
          'gemini-3-flash-preview',
          'gemini-3.1-pro-preview',
          'gemini-2.5-pro',
          'gemini-1.5-flash',
          'gemini-1.5-pro'
        ]
      });
    } catch (error: any) {
      console.error('[Server] Model listing failed:', error);
      res.json({
        models: [
          'gemini-3.6-flash',
          'gemini-3.8-flash',
          'gemini-3-flash-preview',
          'gemini-3.1-pro-preview',
          'gemini-2.5-pro',
          'gemini-1.5-flash',
          'gemini-1.5-pro'
        ]
      });
    }
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
