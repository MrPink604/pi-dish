/**
 * Fuzzy file/directory search for the web UI.
 *
 * Backed by fff (@ff-labs/fff-node) — a Rust fuzzy finder that keeps an
 * in-memory index per project, so repeated searches from the @-mention
 * autocomplete stay fast. The package is ESM-only and ships a native
 * binary, so it's loaded lazily via dynamic import and everything degrades
 * to a plain recursive walk + the shared fuzzy scorer when it's missing
 * (unsupported platform, stripped install).
 *
 * Two entry points:
 *   searchFiles(basePath, query, limit) — files under a project dir
 *   searchHomeDirs(query, limit)        — directories under $HOME for the
 *     new-session cwd picker (fff refuses to index $HOME by design, so this
 *     is always the walker + scorer)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fuzzyMatch, fuzzyScore } = require('../public/helpers.js');

// --- fff finder pool ---------------------------------------------------------

const MAX_FINDERS = 4;
const finders = new Map(); // basePath -> { promise: Promise<finder|null>, lastUsed }

let fffModulePromise = null;
function loadFff() {
  if (!fffModulePromise) {
    fffModulePromise = import('@ff-labs/fff-node').catch((e) => {
      console.warn('fff unavailable, falling back to walker:', e.message);
      return null;
    });
  }
  return fffModulePromise;
}

async function createFinder(basePath) {
  const mod = await loadFff();
  if (!mod) return null;
  const created = mod.FileFinder.create({ basePath });
  if (!created.ok) {
    console.warn(`fff index failed for ${basePath}: ${created.error}`);
    return null;
  }
  const finder = created.value;
  await finder.waitForScan(10000).catch(() => {}); // partial index still usable
  return finder;
}

async function getFinder(basePath) {
  const entry = finders.get(basePath);
  if (entry) {
    entry.lastUsed = Date.now();
    return entry.promise;
  }

  if (finders.size >= MAX_FINDERS) {
    const oldest = [...finders.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed)[0];
    finders.delete(oldest[0]);
    oldest[1].promise.then((f) => { try { f?.destroy(); } catch {} });
  }

  const promise = createFinder(basePath).catch(() => null);
  finders.set(basePath, { promise, lastUsed: Date.now() });
  return promise;
}

/**
 * Fuzzy-search files under basePath. Returns [{ path, gitStatus }] with
 * paths relative to basePath. Empty query returns the index's
 * frecency/recency ordering — a useful "recent files" list.
 */
async function searchFiles(basePath, query, limit = 20) {
  if (!basePath || !fs.existsSync(basePath)) return [];
  const finder = await getFinder(basePath);
  if (finder) {
    // try/catch, not just result.ok: under LRU pressure a concurrent
    // getFinder can destroy this finder before we call it, and the native
    // call then throws — degrade to the walker like every other fff failure.
    try {
      const result = finder.fileSearch(query || '', { pageSize: limit });
      if (result.ok) {
        return result.value.items.map(i => ({ path: i.relativePath, gitStatus: i.gitStatus }));
      }
      console.warn(`fff fileSearch failed for ${basePath}: ${result.error}`);
    } catch (e) {
      console.warn(`fff fileSearch threw for ${basePath}: ${e.message}`);
    }
  }
  return walkerSearch(basePath, query, limit);
}

// --- $HOME directory search (walker only) -------------------------------------

const SKIP_DIRS = new Set(['node_modules', 'target', 'dist', 'build', '__pycache__', 'venv']);
const DIR_CACHE_MS = 60_000;
const MAX_WALK = 20_000; // hard stop for huge trees
let homeDirCache = null; // { at, dirs: [absolute paths] }

/** The one recursive walk both searches share: absolute dirs or files. */
function walk(root, { maxDepth, collect }) {
  const out = [];
  const stack = [[root, 0]];
  while (stack.length && out.length < MAX_WALK) {
    const [dir, depth] = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (collect === 'dirs') out.push(full);
        if (depth + 1 < maxDepth) stack.push([full, depth + 1]);
      } else if (collect === 'files') {
        out.push(full);
      }
    }
  }
  return out;
}

/**
 * Fuzzy-search directories under $HOME for the new-session cwd picker.
 * Returns [{ path, short }] best-first; `short` is the ~-relative form the
 * match was scored against.
 */
function searchHomeDirs(query, limit = 15) {
  const home = os.homedir();
  if (!homeDirCache || Date.now() - homeDirCache.at > DIR_CACHE_MS) {
    homeDirCache = { at: Date.now(), dirs: walk(home, { maxDepth: 4, collect: 'dirs' }) };
  }

  const candidates = homeDirCache.dirs.map(p => ({
    path: p,
    short: '~/' + path.relative(home, p),
  }));

  if (!query) {
    return candidates.slice(0, limit);
  }

  return candidates
    .map(c => ({ ...c, score: fuzzyScore(fuzzyMatch(query, c.short), c.short) }))
    .filter(c => c.score > -Infinity)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

// --- walker fallback for file search ------------------------------------------

function walkerSearch(basePath, query, limit) {
  const out = walk(basePath, { maxDepth: 6, collect: 'files' })
    .map(f => path.relative(basePath, f));
  if (!query) return out.slice(0, limit).map(p => ({ path: p, gitStatus: null }));
  return out
    .map(p => ({ path: p, score: fuzzyScore(fuzzyMatch(query, p), p) }))
    .filter(c => c.score > -Infinity)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(c => ({ path: c.path, gitStatus: null }));
}

/** Test hook: drop caches so temp-HOME fixtures are re-read. */
function resetCaches() {
  homeDirCache = null;
  for (const [, entry] of finders) entry.promise.then((f) => { try { f?.destroy(); } catch {} });
  finders.clear();
}

module.exports = { searchFiles, searchHomeDirs, resetCaches };
