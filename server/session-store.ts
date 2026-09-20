import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { maskToken } from './gatekeeper-client.js';

export { maskToken };

export interface BuilderSession {
  id: string;
  token: string;
  sigilMask: string;
  serviceName?: string;
  createdAt: string;
  expiresAt: string;
}

// In-memory server-authoritative session store
const SESSIONS = new Map<string, BuilderSession>();

// Default session lifespan: 8 hours (in milliseconds)
export const DEFAULT_SESSION_LIFESPAN_MS = 8 * 60 * 60 * 1000;

export function generateSessionId(): string {
  return `lb_sess_${crypto.randomBytes(24).toString('hex')}`;
}

export function createBuilderSession(
  sigilToken: string,
  serviceName?: string,
  lifespanMs: number = DEFAULT_SESSION_LIFESPAN_MS
): BuilderSession {
  const sessionId = generateSessionId();
  const now = Date.now();
  const createdAt = new Date(now).toISOString();
  const expiresAt = new Date(now + lifespanMs).toISOString();

  const session: BuilderSession = {
    id: sessionId,
    token: sessionId,
    sigilMask: maskToken(sigilToken),
    serviceName: serviceName || 'Lorepack Builder',
    createdAt,
    expiresAt,
  };

  SESSIONS.set(sessionId, session);
  return session;
}

export function getBuilderSession(tokenOrId: string): BuilderSession | null {
  if (!tokenOrId || typeof tokenOrId !== 'string') {
    return null;
  }
  const session = SESSIONS.get(tokenOrId.trim());
  if (!session) {
    return null;
  }

  // Check expiration
  const exp = new Date(session.expiresAt).getTime();
  if (exp <= Date.now()) {
    SESSIONS.delete(tokenOrId);
    return null;
  }

  return session;
}

export function revokeBuilderSession(tokenOrId: string): boolean {
  if (!tokenOrId || typeof tokenOrId !== 'string') {
    return false;
  }
  return SESSIONS.delete(tokenOrId.trim());
}

export function clearAllBuilderSessions(): void {
  SESSIONS.clear();
}

/**
 * Helper to extract session token from incoming HTTP request.
 * Inspects:
 * 1. `req.cookies.lb_session`
 * 2. `req.headers.authorization` ("Bearer <token>")
 * 3. `req.headers['x-lb-session']`
 */
export function extractSessionToken(req: Request): string {
  // Cookie extraction
  const cookieVal = req.cookies?.lb_session;
  if (typeof cookieVal === 'string' && cookieVal.trim()) {
    return cookieVal.trim();
  }

  // Header extraction
  const authHeader = req.headers['authorization'];
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }

  const customHeader = req.headers['x-lb-session'];
  if (typeof customHeader === 'string' && customHeader.trim()) {
    return customHeader.trim();
  }

  return '';
}

/**
 * Returns standard cookie configuration options for the session cookie.
 */
export function getSessionCookieOptions(req: Request, maxAgeMs: number = DEFAULT_SESSION_LIFESPAN_MS) {
  const isHttps = req.secure || req.headers['x-forwarded-proto'] === 'https';
  return {
    httpOnly: true,
    secure: isHttps || process.env.NODE_ENV === 'production',
    sameSite: 'lax' as const,
    maxAge: maxAgeMs,
    path: '/',
  };
}

/**
 * Express Middleware: Enforce active Builder session on protected endpoints.
 */
export function requireBuilderAuth(req: Request, res: Response, next: NextFunction): void {
  const token = extractSessionToken(req);
  if (!token) {
    res.status(401).json({
      success: false,
      error: 'ACCESS DENIED',
      message: 'Authentication required. Please present a valid GateKeeper SIGIL.',
    });
    return;
  }

  const session = getBuilderSession(token);
  if (!session) {
    res.status(401).json({
      success: false,
      error: 'ACCESS DENIED',
      message: 'Session expired or invalidated. Please present your GateKeeper SIGIL.',
    });
    return;
  }

  (req as any).builderSession = session;
  next();
}
