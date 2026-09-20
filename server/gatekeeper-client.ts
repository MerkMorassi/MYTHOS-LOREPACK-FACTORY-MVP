import crypto from 'crypto';

export interface GateKeeperPass {
  token: string;
  orderId?: string;
  providerId?: string;
  status: 'active' | 'redeemed' | 'revoked' | 'expired' | string;
  createdAt?: string;
  expiresAt?: string;
  isTrial?: boolean;
  serviceName?: string;
  facetimeDeliveryInstruction?: string;
}

export interface SigilValidationResult {
  valid: boolean;
  reason?: string;
  pass?: GateKeeperPass;
}

// In-memory registry for mock / development / testing GateKeeper passes
const MOCK_GATEKEEPER_PASSES = new Map<string, GateKeeperPass>();

// Seed default dev / operator passes
const DEFAULT_OPERATOR_PASS: GateKeeperPass = {
  token: 'gk_sigil_operator_2026_authorized',
  orderId: 'gk_ord_operator_master',
  providerId: 'mythos_archivax_core',
  status: 'active',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
  serviceName: 'Lorepack Builder Operator Access',
};

const DEFAULT_DEMO_PASS: GateKeeperPass = {
  token: 'gk_sigil_demo_pass',
  orderId: 'gk_ord_demo_test',
  providerId: 'mythos_archivax_core',
  status: 'active',
  createdAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  serviceName: 'Lorepack Builder Demo Pass',
};

MOCK_GATEKEEPER_PASSES.set(DEFAULT_OPERATOR_PASS.token, DEFAULT_OPERATOR_PASS);
MOCK_GATEKEEPER_PASSES.set(DEFAULT_DEMO_PASS.token, DEFAULT_DEMO_PASS);

/**
 * Register a mock pass (used by acceptance test suite).
 */
export function registerMockGateKeeperPass(pass: GateKeeperPass): void {
  MOCK_GATEKEEPER_PASSES.set(pass.token, { ...pass });
}

/**
 * Clear or reset mock passes (used by test suites).
 */
export function resetMockGateKeeperPasses(): void {
  MOCK_GATEKEEPER_PASSES.clear();
  MOCK_GATEKEEPER_PASSES.set(DEFAULT_OPERATOR_PASS.token, DEFAULT_OPERATOR_PASS);
  MOCK_GATEKEEPER_PASSES.set(DEFAULT_DEMO_PASS.token, DEFAULT_DEMO_PASS);
}

/**
 * Extract raw token from QR payload or raw input string.
 * Handles formats:
 * - URL containing '#access=...' or '?access=...'
 * - JSON string { "token": "..." }
 * - Direct token string (e.g., 'gk_tok_...', 'gk_sigil_...')
 */
export function extractTokenFromSigilPayload(payload: string): string {
  if (!payload || typeof payload !== 'string') {
    return '';
  }

  const trimmed = payload.trim();

  // Check JSON format
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed.token === 'string' && parsed.token.trim()) {
        return parsed.token.trim();
      }
    } catch {
      // Ignore JSON parse failure and continue
    }
  }

  // Check URL fragment or query parameter #access= or ?access=
  const accessFragmentMatch = trimmed.match(/[#&?]access=([^&#\s]+)/i);
  if (accessFragmentMatch && accessFragmentMatch[1]) {
    return decodeURIComponent(accessFragmentMatch[1]).trim();
  }

  // Check token in path /passes/gk_tok_...
  const passUrlMatch = trimmed.match(/\/passes\/([^/?#\s]+)/i);
  if (passUrlMatch && passUrlMatch[1]) {
    return decodeURIComponent(passUrlMatch[1]).trim();
  }

  return trimmed;
}

/**
 * Mask a token for safe logging (e.g., 'gk_tok_...3f2a').
 * Never prints the complete secret to logs.
 */
export function maskToken(token: string): string {
  if (!token) return '[empty]';
  const clean = token.trim();
  if (clean.length <= 8) {
    return '***' + clean.slice(-2);
  }
  const prefix = clean.slice(0, 7);
  const suffix = clean.slice(-4);
  return `${prefix}...${suffix}`;
}

/**
 * Validates a GateKeeper SIGIL token with the GateKeeper Authority.
 * 
 * IMPORTANT: Strictly uses read-only inspection (GET /v1/passes/:token).
 * Never consumes or redeems the pass.
 */
export async function validateGateKeeperSigil(
  rawPayload: string,
  options?: {
    apiBaseUrl?: string;
    apiKey?: string;
    forceUnavailable?: boolean;
  }
): Promise<SigilValidationResult> {
  const token = extractTokenFromSigilPayload(rawPayload);

  if (!token) {
    return {
      valid: false,
      reason: 'Empty or malformed SIGIL payload',
    };
  }

  if (options?.forceUnavailable) {
    return {
      valid: false,
      reason: 'GateKeeper Authority is unavailable',
    };
  }

  const baseUrl = (options?.apiBaseUrl || process.env.GATEKEEPER_API_BASE_URL || '').replace(/\/$/, '');
  const apiKey = options?.apiKey || process.env.GATEKEEPER_API_KEY || '';

  // If a live GateKeeper base URL is configured, query the read-only endpoint
  if (baseUrl) {
    try {
      // Ensure we don't duplicate /v1 if it's already in the baseUrl
      const passPath = baseUrl.toLowerCase().endsWith('/v1') ? '/passes/' : '/v1/passes/';
      const inspectUrl = `${baseUrl}${passPath}${encodeURIComponent(token)}`;
      const headers: Record<string, string> = {
        'Accept': 'application/json',
      };
      if (apiKey) {
        headers['X-API-Key'] = apiKey;
      }

      const response = await fetch(inspectUrl, {
        method: 'GET',
        headers,
      });

      if (response.status === 404) {
        return {
          valid: false,
          reason: 'SIGIL entitlement not found in GateKeeper registry',
        };
      }

      if (!response.ok) {
        return {
          valid: false,
          reason: `GateKeeper inspection returned status ${response.status}`,
        };
      }

      const data: any = await response.json();
      const pass: GateKeeperPass = data.pass || data;

      if (!pass || typeof pass !== 'object') {
        return {
          valid: false,
          reason: 'Invalid response payload from GateKeeper Authority',
        };
      }

      // Check status
      if (pass.status !== 'active') {
        return {
          valid: false,
          reason: `Entitlement is ${pass.status || 'inactive'}`,
          pass,
        };
      }

      // Check expiration
      if (pass.expiresAt) {
        const exp = new Date(pass.expiresAt);
        if (!isNaN(exp.getTime()) && exp.getTime() <= Date.now()) {
          return {
            valid: false,
            reason: 'Entitlement has expired',
            pass,
          };
        }
      }

      return {
        valid: true,
        pass,
      };
    } catch (err: any) {
      console.error('[GateKeeper Authority] Network error verifying SIGIL:', err?.message || err);
      return {
        valid: false,
        reason: 'GateKeeper Authority unreachable or request timed out',
      };
    }
  }

  // Fallback: Local / Dev Mock Authority
  const mockPass = MOCK_GATEKEEPER_PASSES.get(token);
  if (!mockPass) {
    return {
      valid: false,
      reason: 'SIGIL token not recognized by GateKeeper Authority',
    };
  }

  if (mockPass.status !== 'active') {
    return {
      valid: false,
      reason: `SIGIL entitlement is ${mockPass.status}`,
      pass: mockPass,
    };
  }

  if (mockPass.expiresAt) {
    const exp = new Date(mockPass.expiresAt);
    if (!isNaN(exp.getTime()) && exp.getTime() <= Date.now()) {
      return {
        valid: false,
        reason: 'SIGIL entitlement has expired',
        pass: mockPass,
      };
    }
  }

  return {
    valid: true,
    pass: mockPass,
  };
}
