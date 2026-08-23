/**
 * Hub-side map of public artifact tokens to the peer that owns them
 * (TASKS/multi-host.md block 7).
 *
 * Share exports and published pages are generated live from the *owning*
 * host's disk, but the hub is the fleet's public front door, so it keeps a
 * registry of which peer to stream a token from:
 *   { "<token>": { "host": "<remote name>", "kind": "share"|"page",
 *                  "createdAt": <ms> } }
 *
 * `host` is a remote *name* from `remotes` in ~/.pi/dish/settings.json — the
 * fleet map stays the only place a peer's address lives, so a re-addressed
 * peer needs no artifact rewrite and a peer dropped from the map simply
 * stops resolving.
 *
 * A mapping grants *reachability*, never authority: it says where to fetch a
 * token from, and the owner remains free to revoke the content out from
 * under it (the serving path prunes on the owner's 404).
 *
 * Persistence rules (HOME per call, re-read per call, temp-file + rename)
 * live in lib/dish-store.js, shared with shares.js and pages.js.
 */
const { readStore, writeStore } = require('./dish-store');
const { isValidRemoteName } = require('./remote-hosts');

const KINDS = new Set(['share', 'page']);
// Tokens are base64url minted by the owning host; a token becomes a path
// segment on both hosts, so anything else is refused rather than escaped.
const TOKEN_RE = /^[A-Za-z0-9_-]{1,128}$/;

function readArtifacts() {
  return readStore('fleet-artifacts.json');
}

function writeArtifacts(artifacts) {
  writeStore('fleet-artifacts.json', artifacts);
}

function isValidToken(token) {
  return typeof token === 'string' && TOKEN_RE.test(token);
}

function isValidKind(kind) {
  return KINDS.has(kind);
}

function normalize(entry) {
  if (!entry || typeof entry !== 'object') return null;
  if (!isValidRemoteName(entry.host) || !isValidKind(entry.kind)) return null;
  return {
    host: entry.host,
    kind: entry.kind,
    createdAt: Number.isFinite(entry.createdAt) ? entry.createdAt : null,
  };
}

/** { host, kind, createdAt } for a token, or null. */
function get(token) {
  if (!isValidToken(token)) return null;
  return normalize(readArtifacts()[token]);
}

/** Map a token to a peer. Returns the stored entry, or null when refused. */
function record(token, host, kind) {
  if (!isValidToken(token) || !isValidRemoteName(host) || !isValidKind(kind)) return null;
  const artifacts = readArtifacts();
  const existing = normalize(artifacts[token]);
  const entry = { host, kind, createdAt: existing?.createdAt ?? Date.now() };
  artifacts[token] = entry;
  writeArtifacts(artifacts);
  return entry;
}

/**
 * Drop a mapping. With `host` given the removal is scoped to that peer, so a
 * revoke on one host can never unmap another's token.
 */
function remove(token, host = null) {
  if (!isValidToken(token)) return false;
  const artifacts = readArtifacts();
  if (artifacts[token] === undefined) return false;
  const existing = normalize(artifacts[token]);
  if (host && existing && existing.host !== host) return false;
  delete artifacts[token];
  writeArtifacts(artifacts);
  return true;
}

/** { "<host>": [{ token, kind, createdAt }] } — newest first per host. */
function listByHost() {
  const out = {};
  for (const [token, raw] of Object.entries(readArtifacts())) {
    const entry = normalize(raw);
    if (!entry || !isValidToken(token)) continue;
    (out[entry.host] ||= []).push({ token, kind: entry.kind, createdAt: entry.createdAt });
  }
  for (const list of Object.values(out)) list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return out;
}

module.exports = { get, record, remove, listByHost, isValidToken, isValidKind };
