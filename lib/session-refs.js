/**
 * `#ref` prompt expansion — turning the session handles a user typed into the
 * `<session-refs>` block appended to the message the model actually sees.
 *
 * The grammar and the block format are in public/helpers.js (shared with the
 * browser, which writes the tokens and hides the block again on render). What
 * lives here is the resolution policy, which is the part with a fleet in it:
 *
 *   - A bare ref, `self/<ref>`, or this host's own uuid means a local session.
 *     The local catalog is authoritative and is the only thing consulted.
 *   - Any other host part names a peer. This server never aggregates peer
 *     corpora — the browser is the fleet aggregator — so a peer session's
 *     metadata arrives as a client hint, and the host part is accepted only
 *     when the fleet names it or a hint claims it.
 *   - Everything else contributes nothing. A `#ref` that resolves to no
 *     session leaves no trace: `#include` in prose has to stay prose.
 *
 * Resolution is lazy in the caller's catalog: a prompt with no tokens never
 * touches it.
 */
const {
  parseSessionRefTokens, parseSessionRefParts, appendSessionRefContext,
} = require('../public/helpers');

/** A hint is unverifiable metadata about someone else's session, so it is
 *  clamped to the shape the block can hold and nothing else is read off it. */
function sanitizeRefHint(hint) {
  if (!hint || typeof hint !== 'object' || typeof hint.ref !== 'string') return null;
  return {
    ref: hint.ref,
    name: typeof hint.name === 'string' ? hint.name : '',
    host: typeof hint.host === 'string' ? hint.host : '',
    cwd: typeof hint.cwd === 'string' ? hint.cwd : '',
    isActive: hint.isActive == null ? null : !!hint.isActive,
  };
}

/**
 * @param {string} message      prompt text as the client sent it
 * @param {unknown} hints       client-supplied `refs` payload, untrusted
 * @param {object} deps
 * @param {string} deps.selfHostId          this host's uuid
 * @param {(id: string, exactOnly: boolean) => object|null} deps.resolveLocal
 * @param {() => string[]} deps.fleetNames  names this server's fleet map knows
 */
function expandSessionRefs(message, hints, deps) {
  const text = typeof message === 'string' ? message : '';
  const tokens = parseSessionRefTokens(text);
  if (!tokens.length) return text;

  const byRef = new Map();
  for (const raw of Array.isArray(hints) ? hints : []) {
    const hint = sanitizeRefHint(raw);
    if (hint) byRef.set(hint.ref, hint);
  }
  let fleet = null;
  const entries = [];

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

module.exports = { expandSessionRefs, sanitizeRefHint };
