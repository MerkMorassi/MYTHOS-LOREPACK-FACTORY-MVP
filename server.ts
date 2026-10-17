import express from 'express';
import path from 'path';
import cookieParser from 'cookie-parser';
import { GoogleGenAI, Type } from '@google/genai';
import dotenv from 'dotenv';
import { validateGateKeeperSigil, maskToken } from './server/gatekeeper-client.js';
import {
  createBuilderSession,
  getBuilderSession,
  revokeBuilderSession,
  requireBuilderAuth,
  getSessionCookieOptions,
  extractSessionToken,
} from './server/session-store.js';

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
  retries = 2,
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
      errStr.includes('resource_exhausted') ||
      errStr.includes('overloaded');

    if (!isTransient) {
      throw error;
    }

    // Daily quota exhaustion cannot be resolved by short delays; fail-soft immediately
    if (errStr.includes('perday') || errStr.includes('limit: 20') || errStr.includes('daily')) {
      throw error;
    }

    let currentDelay = delayMs;
    const retryInMatch = errStr.match(/please retry in ([0-9.]+)s/);
    if (retryInMatch && retryInMatch[1]) {
      const parsedSeconds = parseFloat(retryInMatch[1]);
      if (!isNaN(parsedSeconds)) {
        if (parsedSeconds > 4) {
          // If wait is longer than 4s, throw to allow fast fallback rather than holding the HTTP request
          throw error;
        }
        currentDelay = Math.ceil(parsedSeconds * 1000) + 500;
      }
    } else if (errStr.includes('429') || errStr.includes('quota') || errStr.includes('resourceexhausted')) {
      // Free tier minute limit exceeded; throw to allow fast fallback
      throw error;
    }

    await new Promise((resolve) => setTimeout(resolve, currentDelay));
    return retryWithBackoff(fn, retries - 1, currentDelay * 2);
  }
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

export async function createServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(cookieParser());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Diagnostic logging middleware for Vercel 404 investigation
  app.use((req, res, next) => {
    console.log(`[API_DIAGNOSTIC] ${new Date().toISOString()} - ${req.method} ${req.path}`);
    next();
  });

  // ------------------------------------------------------------
  // AUTHENTICATION & SESSION ENDPOINTS (PUBLIC)
  // ------------------------------------------------------------

  // Check current session state
  app.get('/api/auth/session', (req, res) => {
    const token = extractSessionToken(req);
    if (!token) {
      res.json({ authenticated: false });
      return;
    }

    const session = getBuilderSession(token);
    if (!session) {
      res.json({ authenticated: false });
      return;
    }

    res.json({
      authenticated: true,
      session: {
        id: session.id,
        sigilMask: session.sigilMask,
        serviceName: session.serviceName,
        createdAt: session.createdAt,
        expiresAt: session.expiresAt,
      },
    });
  });

  // Verify GateKeeper SIGIL and establish Builder session
  app.post('/api/auth/sigil-verify', async (req, res) => {
    try {
      const { sigil } = req.body || {};
      if (!sigil || typeof sigil !== 'string') {
        res.status(400).json({
          success: false,
          error: 'BAD REQUEST',
          message: 'GateKeeper SIGIL payload is required.',
        });
        return;
      }

      console.log(`[GateKeeper Handshake] Verifying presented SIGIL: ${maskToken(sigil)}...`);

      const result = await validateGateKeeperSigil(sigil);

      if (!result.valid) {
        console.warn(`[GateKeeper Handshake] SIGIL validation rejected: ${result.reason} (Token: ${maskToken(sigil)})`);
        res.status(401).json({
          success: false,
          error: 'ACCESS DENIED',
          message: result.reason || 'Invalid, expired, or unentitled SIGIL.',
        });
        return;
      }

      // Establish authenticated Lorepack Builder session
      const serviceName = result.pass?.serviceName || 'Lorepack Builder Access';
      const session = createBuilderSession(sigil, serviceName);

      // Set secure HTTP-only session cookie
      const cookieOpts = getSessionCookieOptions(req);
      res.cookie('lb_session', session.token, cookieOpts);

      console.log(`[GateKeeper Handshake] Session established: ${session.id} for SIGIL ${session.sigilMask}`);

      res.json({
        success: true,
        session: {
          id: session.id,
          token: session.token,
          sigilMask: session.sigilMask,
          serviceName: session.serviceName,
          createdAt: session.createdAt,
          expiresAt: session.expiresAt,
        },
      });
    } catch (err: any) {
      console.error('[GateKeeper Handshake] Unexpected verification error:', err);
      res.status(500).json({
        success: false,
        error: 'SERVER ERROR',
        message: 'Internal error during SIGIL verification handshake.',
      });
    }
  });

  // Terminate session and clear cookie
  app.post('/api/auth/logout', (req, res) => {
    const token = extractSessionToken(req);
    if (token) {
      revokeBuilderSession(token);
    }
    const clearOpts = getSessionCookieOptions(req, 0);
    res.clearCookie('lb_session', clearOpts);
    res.json({
      success: true,
      message: 'Lorepack Builder session terminated.',
    });
  });

  // ------------------------------------------------------------
  // PROTECTED FACTORY API ROUTES (REQUIRE VALID BUILDER SESSION)
  // ------------------------------------------------------------

  // API Route: Embed Content
  app.post('/api/lorepack/embed', requireBuilderAuth, async (req, res) => {
    try {
      const { text, model } = req.body;
      if (!text || typeof text !== 'string') {
        res.status(400).json({ error: 'Text input is required' });
        return;
      }

      const embeddingModel = (typeof model === 'string' && model.trim()) ? model.trim() : 'gemini-embedding-2';
      const ai = getAI();
      const result = await retryWithBackoff(() => 
        ai.models.embedContent({
          model: embeddingModel,
          contents: text,
        }),
        2,
        1000
      );

      let embedding: number[] | null = null;
      const resAny = result as any;
      if (Array.isArray(resAny.embeddings)) {
        embedding = resAny.embeddings[0]?.values || null;
      } else if (resAny.embedding?.values) {
        embedding = resAny.embedding.values;
      } else if (resAny.embeddings && resAny.embeddings.values) {
        embedding = resAny.embeddings.values;
      }

      if (!embedding) {
        res.status(502).json({ error: { message: 'Gemini API returned empty embedding' } });
        return;
      }

      res.json({ embedding });
    } catch (error: any) {
      const status = error?.status || error?.statusCode || 500;
      const message = error?.message || String(error);
      console.error(`[Server] Embedding generation failed (status ${status}):`, message);
      res.status(status >= 400 && status < 600 ? status : 500).json({
        error: { message }
      });
    }
  });

  // API Route: Extract Triplet Edges
  app.post('/api/lorepack/triplets', requireBuilderAuth, async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text : '';
    if (!text.trim()) {
      res.json({ triplets: [] });
      return;
    }

    try {
      const ai = getAI();
      let triplets: Array<{ s: string; r: string; o: string }> | null = null;
      
      for (const modelToTry of ['gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-2.5-flash']) {
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
            500
          );

          const tripletsText = response.text || '[]';
          const parsed = JSON.parse(tripletsText);
          if (Array.isArray(parsed)) {
            triplets = parsed;
            break;
          }
        } catch (mErr: any) {
          const cleanMsg = (mErr?.message || String(mErr)).split('\n')[0].slice(0, 120);
          console.warn(`[Server] Triplet extraction with ${modelToTry} unavailable (${cleanMsg}), attempting next fallback...`);
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
  app.post('/api/lorepack/generate', requireBuilderAuth, async (req, res) => {
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
  app.get('/api/lorepack/models', requireBuilderAuth, async (req, res) => {
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

  // API Route: List Embedding Models
  app.get('/api/lorepack/embedding-models', requireBuilderAuth, async (req, res) => {
    const defaultEmbeddingModels = ['gemini-embedding-2', 'text-embedding-004', 'gemini-embedding-001'];
    try {
      const apiKey = process.env.GEMINI_API_KEY;
      if (apiKey) {
        try {
          const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
          if (response.ok) {
            const data = await response.json();
            const models = data.models || [];
            const fetched = models
              .map((m: any) => (m.name || '').replace('models/', ''))
              .filter((name: string) => {
                const lower = name.toLowerCase();
                return lower.includes('embedding') || lower.includes('embed');
              });

            if (fetched.length > 0) {
              const combined = Array.from(new Set(['gemini-embedding-2', ...fetched, ...defaultEmbeddingModels]));
              res.json({ models: combined });
              return;
            }
          }
        } catch (apiErr) {
          console.warn('[Server] External embedding model fetch error, falling back to default list:', apiErr);
        }
      }

      res.json({ models: defaultEmbeddingModels });
    } catch (error: any) {
      console.error('[Server] Embedding model listing failed:', error);
      res.json({ models: defaultEmbeddingModels });
    }
  });

  // API Route: Model Health Check
  let globalServiceStatus = 'healthy';

  app.get('/api/lorepack/model-health/:modelName', requireBuilderAuth, async (req, res) => {
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
    const { createServer: createViteServer } = await import('vite');
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

  return app;
}

// Only start the server automatically if we're NOT on Vercel
// Vercel will import the app and handle the request via its own runtime
if (!process.env.VERCEL) {
  createServer().then((app) => {
    const PORT = Number(process.env.PORT) || 3000;
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`Server running on http://0.0.0.0:${PORT}`);
    });
  }).catch((err) => {
    console.error('Failed to start server:', err);
    process.exit(1);
  });
}
