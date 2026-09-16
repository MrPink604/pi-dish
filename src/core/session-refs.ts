/**
 * Resolve prompt #refs without treating peer hints as session authority.
 * Token-free prompts never consult the local catalog or fleet.
 */
import { parseSessionRefTokens, parseSessionRefParts, appendSessionRefContext } from './helper-refs';
import type { RefContextEntry } from './helper-types';

export interface SessionRefSummary {
  readonly name?: string | null;
  readonly cwd?: string | null;
  readonly isActive?: boolean;
}

export interface SessionRefDependencies {
  readonly selfHostId: string;
  resolveLocal(id: string, exactOnly: boolean): Readonly<SessionRefSummary> | null;
  fleetNames(): readonly string[];
}

export interface SessionRefHint {
  ref: string;
  name: string;
  host: string;
  cwd: string;
  isActive: boolean | null;
}

/** Hints are untrusted metadata, clamped to the fields the context block uses. */
export function sanitizeRefHint(hint: unknown): SessionRefHint | null {
  if (!hint || typeof hint !== 'object' || !('ref' in hint) || typeof hint.ref !== 'string') return null;
  return {
    ref: hint.ref,
    name: 'name' in hint && typeof hint.name === 'string' ? hint.name : '',
    host: 'host' in hint && typeof hint.host === 'string' ? hint.host : '',
    cwd: 'cwd' in hint && typeof hint.cwd === 'string' ? hint.cwd : '',
    isActive: !('isActive' in hint) || hint.isActive == null ? null : !!hint.isActive,
  };
}

export function expandSessionRefs(message: unknown, hints: unknown, deps: SessionRefDependencies): string {
  const text = typeof message === 'string' ? message : '';
  const tokens = parseSessionRefTokens(text);
  if (!tokens.length) return text;

  const byRef = new Map<string, SessionRefHint>();
  for (const raw of Array.isArray(hints) ? hints : []) {
    const hint = sanitizeRefHint(raw);
    if (hint) byRef.set(hint.ref, hint);
  }
  let fleet: Set<string> | null = null;
  const entries: RefContextEntry[] = [];

  for (const { ref } of tokens) {
    const parts = parseSessionRefParts(ref);
    if (!parts) continue;
    const hint = byRef.get(ref) || null;
    const isLocal = !parts.hostPart
      || parts.hostPart.toLowerCase() === 'self'
      || parts.hostPart === deps.selfHostId;

    if (isLocal) {
      const session = deps.resolveLocal(parts.id, parts.hostIdForm);
      if (!session) continue;
      entries.push({
        ref,
        name: session.name || '',
        cwd: session.cwd || '',
        isActive: !!session.isActive,
      });
      continue;
    }

    if (!fleet) {
      fleet = new Set((deps.fleetNames() || []).map((name) => String(name || '').toLowerCase()));
    }
    if (!hint && !fleet.has(parts.hostPart.toLowerCase())) continue;
    entries.push({
      ref,
      name: hint ? hint.name : '',
      host: (hint && hint.host) || parts.hostPart,
      cwd: hint ? hint.cwd : '',
      isActive: hint ? hint.isActive : null,
    });
  }
  return appendSessionRefContext(text, entries);
}
