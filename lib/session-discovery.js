const fs = require('fs');
const path = require('path');

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_FILES = 20000;
const DEFAULT_MAX_ENTRIES = 100000;
const HEADER_BYTES = 16 * 1024;
const HEADER_CACHE_MAX = DEFAULT_MAX_FILES;
const headerCache = new Map(); // file -> { mtimeMs, size, header|null }
const SAFE_SESSION_ID = /^[A-Za-z0-9._:-]+$/;

function positiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function cacheHeader(filePath, stat, header) {
  if (headerCache.size >= HEADER_CACHE_MAX) headerCache.delete(headerCache.keys().next().value);
  headerCache.set(filePath, { mtimeMs: stat.mtimeMs, size: stat.size, header });
}

function readSessionHeader(filePath) {
  let fd;
  let stat;
  try {
    stat = fs.statSync(filePath);
    const cached = headerCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.header;
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(HEADER_BYTES);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const newline = buf.indexOf(10, 0);
    if (newline < 0 && n === buf.length) {
      cacheHeader(filePath, stat, null);
      return null;
    }
    const end = newline >= 0 ? newline : n;
    const header = JSON.parse(buf.toString('utf8', 0, end));
    if (!header || header.type !== 'session') {
      cacheHeader(filePath, stat, null);
      return null;
    }
    const value = {
      id: typeof header.id === 'string' ? header.id : null,
      cwd: typeof header.cwd === 'string' ? header.cwd : null,
      parentSession: typeof header.parentSession === 'string' && header.parentSession
        ? header.parentSession : null,
    };
    cacheHeader(filePath, stat, value);
    return value;
  } catch {
    if (stat) cacheHeader(filePath, stat, null);
    return null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
  }
}

function safeHeaderSessionId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && SAFE_SESSION_ID.test(value)
    ? value : null;
}

function candidateForFile(file, workspaceDirName, depth) {
  const basename = path.basename(file, '.jsonl');
  // Pi's traditional corpus has one named JSONL directly under the encoded
  // workspace directory. Recursive launcher directories often contain other
  // NDJSON artifacts (events.jsonl, logs.jsonl); only their conventional
  // session.jsonl is a session candidate.
  if (basename !== 'session') {
    return depth === 0
      ? { file, id: basename, dirName: workspaceDirName, depth, identitySource: 'basename' }
      : null;
  }
  const header = readSessionHeader(file);
  const id = safeHeaderSessionId(header?.id);
  return id ? { file, id, dirName: workspaceDirName, depth, identitySource: 'header' } : null;
}

/**
 * Discover Pi session JSONLs, including bounded nested layouts used by
 * external launchers. Normal files retain their basename identity; only a
 * generic session.jsonl uses Pi's validated header id, matching the bridge.
 */
function discoverSessionCandidates(rootDir, options = {}) {
  const maxDepth = positiveInt(options.maxDepth ?? process.env.PI_DISH_SESSION_DISCOVERY_DEPTH, DEFAULT_MAX_DEPTH);
  const maxFiles = positiveInt(options.maxFiles ?? process.env.PI_DISH_SESSION_DISCOVERY_MAX_FILES, DEFAULT_MAX_FILES);
  const maxEntries = positiveInt(options.maxEntries ?? process.env.PI_DISH_SESSION_DISCOVERY_MAX_ENTRIES, DEFAULT_MAX_ENTRIES);
  const excludeIds = options.excludeIds instanceof Set ? options.excludeIds : new Set(options.excludeIds || []);
  const candidates = [];
  const byId = new Map();
  const ambiguousHeaderIds = new Set();
  let truncated = false;
  let filesSeen = 0;
  let entriesSeen = 0;

  const add = (candidate) => {
    if (!candidate || excludeIds.has(candidate.id) || ambiguousHeaderIds.has(candidate.id)) return;
    const previous = byId.get(candidate.id);
    if (previous) {
      // Two generic files claiming one native header id are unsafe to route:
      // omit the identity rather than let read/mutation routes pick a copy.
      if (candidate.identitySource === 'header' && previous.identitySource === 'header') {
        const index = candidates.indexOf(previous);
        if (index >= 0) candidates.splice(index, 1);
        byId.delete(candidate.id);
        ambiguousHeaderIds.add(candidate.id);
        return;
      }
      // A traditional basename identity wins over a colliding generic hint.
      if (candidate.identitySource !== previous.identitySource) {
        if (candidate.identitySource === 'basename') {
          const index = candidates.indexOf(previous);
          if (index >= 0) candidates[index] = candidate;
          byId.set(candidate.id, candidate);
        }
        return;
      }
      // Preserve deterministic compatibility for traditional duplicate names.
      if (candidate.depth < previous.depth ||
          (candidate.depth === previous.depth && candidate.file.localeCompare(previous.file) < 0)) {
        const index = candidates.indexOf(previous);
        if (index >= 0) candidates[index] = candidate;
        byId.set(candidate.id, candidate);
      }
      return;
    }
    byId.set(candidate.id, candidate);
    candidates.push(candidate);
  };

  // Stream directory entries instead of materializing/sorting an unbounded
  // directory before applying maxEntries. Candidate output and duplicate
  // selection are sorted deterministically below; when traversal truncates,
  // the response explicitly reports that it is partial.
  const eachEntry = (dirPath, visit) => {
    let dir;
    try { dir = fs.opendirSync(dirPath); } catch { return; }
    try {
      let entry;
      while (!truncated && (entry = dir.readSync())) {
        if (entriesSeen >= maxEntries) { truncated = true; break; }
        entriesSeen += 1;
        visit(entry);
      }
    } finally {
      try { dir.closeSync(); } catch {}
    }
  };

  const walk = (dirPath, workspaceDirName, depth) => {
    if (truncated) return;
    eachEntry(dirPath, (entry) => {
      if (truncated) return;
      const full = path.join(dirPath, entry.name);
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        if (filesSeen >= maxFiles) { truncated = true; return; }
        filesSeen += 1;
        add(candidateForFile(full, workspaceDirName, depth));
      } else if (entry.isDirectory() && !entry.isSymbolicLink() && depth < maxDepth) {
        walk(full, workspaceDirName, depth + 1);
      }
    });
  };

  eachEntry(rootDir, (workspace) => {
    if (!workspace.isDirectory() || workspace.isSymbolicLink()) return;
    walk(path.join(rootDir, workspace.name), workspace.name, 0);
  });

  candidates.sort((a, b) => a.file.localeCompare(b.file));
  return { candidates, truncated };
}

function findSessionCandidate(rootDir, sessionId, options = {}) {
  const { candidates, truncated } = discoverSessionCandidates(rootDir, options);
  const exact = candidates.find((candidate) => candidate.id === sessionId);
  if (exact) return { candidate: exact, truncated };
  if (options.allowPartial === false) return { candidate: null, truncated };
  const partial = candidates.filter((candidate) => candidate.id.includes(sessionId));
  return { candidate: partial.length ? partial[0] : null, truncated };
}

module.exports = {
  discoverSessionCandidates,
  findSessionCandidate,
  readSessionHeader,
  safeHeaderSessionId,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_ENTRIES,
};
