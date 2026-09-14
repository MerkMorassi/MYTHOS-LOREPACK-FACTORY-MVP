/**
 * Canonical MythOS Agent Roster
 *
 * Source: mythos-rag-agent-voice/agents.ts
 *
 * Authoritative 15-agent roster for production agent memory,
 * knowledge operations, and identity in LOREPACK FACTORY.
 */

export interface CanonicalAgent {
  order: number;
  name: string;
  id: string;
  handle: string;
}

export const CANONICAL_MYTHOS_AGENTS: readonly CanonicalAgent[] = [
  { order: 0, name: 'Barbelo', id: 'agent-barbelo', handle: 'barbelo' },
  { order: 1, name: 'Sophia', id: 'agent-sophia', handle: 'sophia' },
  { order: 2, name: 'Domantheia', id: 'agent-domantheia', handle: 'domantheia' },
  { order: 3, name: 'Archivax', id: 'agent-archivax', handle: 'archivax' },
  { order: 4, name: 'Noesis', id: 'agent-noesis', handle: 'noesis' },
  { order: 5, name: 'Merkos', id: 'agent-merkos', handle: 'merkos' },
  { order: 6, name: 'Calliope', id: 'agent-calliope', handle: 'calliope' },
  { order: 7, name: 'Clio', id: 'agent-clio', handle: 'clio' },
  { order: 8, name: 'Erato', id: 'agent-erato', handle: 'erato' },
  { order: 9, name: 'Euterpe', id: 'agent-euterpe', handle: 'euterpe' },
  { order: 10, name: 'Melpomene', id: 'agent-melpomene', handle: 'melpomene' },
  { order: 11, name: 'Polyhymnia', id: 'agent-polyhymnia', handle: 'polyhymnia' },
  { order: 12, name: 'Terpsichore', id: 'agent-terpsichore', handle: 'terpsichore' },
  { order: 13, name: 'Thalia', id: 'agent-thalia', handle: 'thalia' },
  { order: 14, name: 'Urania', id: 'agent-urania', handle: 'urania' },
] as const;

export const DEFAULT_CANONICAL_AGENT = CANONICAL_MYTHOS_AGENTS[0];

export function getCanonicalAgentById(id: string): CanonicalAgent | undefined {
  return CANONICAL_MYTHOS_AGENTS.find((a) => a.id === id);
}

export function isValidCanonicalAgentId(id: string): boolean {
  return CANONICAL_MYTHOS_AGENTS.some((a) => a.id === id);
}
