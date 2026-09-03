const fs = require('fs');
const path = require('path');
const { encodeSessionKey, validSessionId } = require('./session-key');
const { getHarness, listHarnesses } = require('./harnesses');

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_FILES = 20000;
const DEFAULT_MAX_ENTRIES = 100000;
// One live session's own subagent subtree — small by nature (a fan-out is
// dozens of agents, not thousands) and read per request. Depth stays the
// corpus walk's DEFAULT_MAX_DEPTH so both reach the same files.
const DEFAULT_SUBSESSION_FILES = 200;
const HEADER_BYTES = 16 * 1024;
const HEADER_CACHE_MAX = DEFAULT_MAX_FILES;
const headerCache = new Map(); // file -> { mtimeMs, size, header|null }
const warnedInvalidCandidates = new Set();
const SAFE_SESSION_ID = /^[A-Za-z0-9._:-]+$/;

function positiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function cacheHeader(filePath, stat, header, profileId = 'pi-v3') {
  if (headerCache.size >= HEADER_CACHE_MAX) headerCache.delete(headerCache.keys().next().value);
  headerCache.set(`${profileId}\0${filePath}`, { mtimeMs: stat.mtimeMs, size: stat.size, header });
}

function readSessionHeader(filePath, profileId = 'pi-v3') {
  let fd;
  let stat;
  try {
    stat = fs.statSync(filePath);
    const cached = headerCache.get(`${profileId}\0${filePath}`);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached.header;
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(HEADER_BYTES);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const newline = buf.indexOf(10, 0);
    if (newline < 0 && n === buf.length) {
      cacheHeader(filePath, stat, null, profileId);
      return null;
    }
    const text = buf.toString('utf8', 0, n);
    let header = null;
    for (const line of text.split('\n')) {
      let entry; try { entry = JSON.parse(line); } catch { continue; }
      if (entry?.type === 'session') { header = entry; break; }
      if (profileId !== 'omp-v1') break;
    }
    if (!header || header.type !== 'session') {
      cacheHeader(filePath, stat, null, profileId);
      return null;
    }
    const value = {
      id: typeof header.id === 'string' ? header.id : null,
      cwd: typeof header.cwd === 'string' ? header.cwd : null,
      parentSession: typeof header.parentSession === 'string' && header.parentSession
        ? header.parentSession : null,
    };
    cacheHeader(filePath, stat, value, profileId);
    return value;
  } catch {
    if (stat) cacheHeader(filePath, stat, null, profileId);
    return null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
  }
}

function safeHeaderSessionId(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 200 && SAFE_SESSION_ID.test(value)
    ? value : null;
}

/** The harness/profile identity every discovered candidate carries. */
function decorateCandidate(candidate, descriptor, options = {}) {
  candidate.nativeSessionId = candidate.id;
  candidate.harnessId = descriptor.id;
  candidate.profileId = options.profileId || descriptor.profileId;
  candidate.profileVersion = options.profileVersion ?? descriptor.profileVersion;
  candidate.sessionKey = encodeSessionKey(candidate.harnessId, candidate.nativeSessionId);
  return candidate;
}

function candidateForFile(file, workspaceDirName, depth, descriptor) {
  const basename = path.basename(file, '.jsonl');
  if (descriptor.layout === 'flat') {
    return { file, id: basename, dirName: workspaceDirName, depth, identitySource: 'basename' };
  }
  // Pi's traditional corpus has one named JSONL directly under the encoded
  // workspace directory. Recursive launcher directories often contain other
  // NDJSON artifacts (events.jsonl, logs.jsonl); only their conventional
  // session.jsonl is a session candidate.
  if (basename !== 'session') {
    if (depth === 0) {
      return { file, id: basename, dirName: workspaceDirName, depth, identitySource: 'basename' };
    }
    // OMP persists a subagent beside its parent's artifact directory:
    // `<parent>.jsonl` -> `<parent>/<agent>.jsonl`, recursively. Its native
    // exporter applies the same valid-header check to every nested *.jsonl.
    // Keep this descriptor-owned so Pi launcher artifacts remain excluded.
    if (!descriptor.nestedSubsessions) return null;
    const parentSession = `${path.dirname(file)}.jsonl`;
    if (!fs.existsSync(parentSession) || !readSessionHeader(parentSession, descriptor.profileId)) return null;
    const header = readSessionHeader(file, descriptor.profileId);
    const id = safeHeaderSessionId(header?.id);
    return id
      ? { file, id, dirName: workspaceDirName, depth, identitySource: 'header', parentSession }
      : null;
  }
  const header = readSessionHeader(file, descriptor.profileId);
  const id = safeHeaderSessionId(header?.id);
  return id ? { file, id, dirName: workspaceDirName, depth, identitySource: 'header' } : null;
}

/**
 * Discover harness session JSONLs, including bounded nested layouts used by
 * external launchers and OMP subagents. Normal files retain their basename
 * identity; generic/nested session files use validated header ids.
 */
function discoverSessionCandidates(rootDir, options = {}) {
  const descriptor = options.descriptor || getHarness(options.harnessId || 'pi');
  if (!descriptor) throw new TypeError('Unknown harness descriptor');
  const maxDepth = positiveInt(options.maxDepth ?? process.env.PI_DISH_SESSION_DISCOVERY_DEPTH, DEFAULT_MAX_DEPTH);
  const maxFiles = positiveInt(options.maxFiles ?? process.env.PI_DISH_SESSION_DISCOVERY_MAX_FILES, DEFAULT_MAX_FILES);
  const maxEntries = positiveInt(options.maxEntries ?? process.env.PI_DISH_SESSION_DISCOVERY_MAX_ENTRIES, DEFAULT_MAX_ENTRIES);
  const excludeIds = options.excludeIds instanceof Set ? options.excludeIds : new Set(options.excludeIds || []);
  const candidates = [];
  const byId = new Map();
  const ambiguousHeaderIds = new Set();
  let truncated = false;
  let skipped = 0;
  let filesSeen = 0;
  let entriesSeen = 0;

  const add = (candidate) => {
    if (!candidate) return;
    if (!validSessionId(candidate.id)) {
      skipped += 1;
      const warningKey = `${descriptor.id}\0${candidate.file}`;
      if (!warnedInvalidCandidates.has(warningKey)) {
        if (warnedInvalidCandidates.size >= HEADER_CACHE_MAX) {
          warnedInvalidCandidates.delete(warnedInvalidCandidates.keys().next().value);
        }
        warnedInvalidCandidates.add(warningKey);
        console.warn(`session discovery: skipping invalid ${descriptor.id} identity ${JSON.stringify(candidate.id)} from ${JSON.stringify(candidate.file)}`);
      }
      return;
    }
    decorateCandidate(candidate, descriptor, options);
    if (excludeIds.has(candidate.id) || ambiguousHeaderIds.has(candidate.id)) return;
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
        add(candidateForFile(full, workspaceDirName, depth, descriptor));
      } else if (entry.isDirectory() && !entry.isSymbolicLink() && depth < maxDepth) {
        walk(full, workspaceDirName, depth + 1);
      }
    });
  };

  if (descriptor.layout === 'flat') {
    eachEntry(rootDir, (entry) => {
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) return;
      if (filesSeen >= maxFiles) { truncated = true; return; }
      filesSeen += 1;
      add(candidateForFile(path.join(rootDir, entry.name), path.basename(rootDir), 0, descriptor));
    });
  } else eachEntry(rootDir, (workspace) => {
    if (!workspace.isDirectory() || workspace.isSymbolicLink()) return;
    walk(path.join(rootDir, workspace.name), workspace.name, 0);
  });

  candidates.sort((a, b) => a.file.localeCompare(b.file));
  return { candidates, truncated, skipped };
}

/** Discover configured harness roots while retaining per-harness identity. */
function discoverHarnessSessions(descriptors = listHarnesses(), options = {}) {
  const candidates = [];
  let truncated = false;
  let skipped = 0;
  for (const descriptor of descriptors) {
    const root = options.roots?.[descriptor.id] || descriptor.rootPath();
    const result = discoverSessionCandidates(root, { ...options, descriptor });
    candidates.push(...result.candidates);
    truncated ||= result.truncated;
    skipped += result.skipped;
  }
  candidates.sort((a, b) => a.sessionKey.localeCompare(b.sessionKey));
  return { candidates, truncated, skipped };
}

function findSessionCandidate(rootDir, sessionId, options = {}) {
  const { candidates, truncated, skipped } = discoverSessionCandidates(rootDir, options);
  const exact = candidates.find((candidate) => candidate.id === sessionId);
  if (exact) return { candidate: exact, truncated, skipped };
  if (options.allowPartial === false) return { candidate: null, truncated, skipped };
  const partial = candidates.filter((candidate) => candidate.id.includes(sessionId));
  return { candidate: partial.length ? partial[0] : null, truncated, skipped };
}

/**
 * The nested subsession files under one session's own artifact directory
 * (`<parent>.jsonl` → `<parent>/<agent>.jsonl`, recursively). Bounded to that
 * subtree: callers resolve the subagents of a handful of *live* sessions per
 * request and must not pay the corpus-wide walk `discoverSessionCandidates`
 * performs.
 *
 * Identity derivation, the symlink refusal, the depth reach and the
 * two-header-ids-one-file ambiguity rule are the corpus walk's own — a
 * candidate found here is one that walk would also emit. What it cannot see
 * is a *corpus-wide* collision (a header id that some other workspace's file
 * claims by basename), so route lookup stays with the full walk, which is
 * authoritative: a row whose id it later refuses simply 404s on click rather
 * than opening a stranger's transcript.
 */
function discoverSubsessionCandidates(parentFile, options = {}) {
  const descriptor = options.descriptor || getHarness(options.harnessId || 'pi');
  if (!descriptor) throw new TypeError('Unknown harness descriptor');
  if (!descriptor.nestedSubsessions || typeof parentFile !== 'string' || !parentFile.endsWith('.jsonl')) return [];
  const maxDepth = positiveInt(options.maxDepth, DEFAULT_MAX_DEPTH);
  const maxFiles = positiveInt(options.maxFiles, DEFAULT_SUBSESSION_FILES);
  const workspaceDirName = path.basename(path.dirname(parentFile));
  const byId = new Map();
  const ambiguous = new Set();
  let files = 0;
  const walk = (dirPath, depth) => {
    if (depth > maxDepth || files >= maxFiles) return;
    // Same refusal as the corpus walk: a symlinked agent directory would
    // enumerate files outside the harness root, which route lookup then
    // cannot confirm.
    try { if (!fs.lstatSync(dirPath).isDirectory()) return; } catch { return; }
    let entries;
    try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files >= maxFiles) return;
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      files += 1;
      const file = path.join(dirPath, entry.name);
      const candidate = candidateForFile(file, workspaceDirName, depth, descriptor);
      if (!candidate || !validSessionId(candidate.id)) continue;
      // A copied/restored session tree yields two files claiming one header
      // id; neither is safe to route, so the identity is omitted entirely.
      if (byId.has(candidate.id)) { byId.delete(candidate.id); ambiguous.add(candidate.id); }
      if (!ambiguous.has(candidate.id)) byId.set(candidate.id, decorateCandidate(candidate, descriptor, options));
      walk(file.slice(0, -6), depth + 1); // its own subagents, one level down
    }
  };
  walk(parentFile.slice(0, -6), 1);
  return [...byId.values()].sort((a, b) => a.file.localeCompare(b.file));
}

module.exports = {
  discoverSessionCandidates,
  discoverHarnessSessions,
  findSessionCandidate,
  discoverSubsessionCandidates,
  readSessionHeader,
  safeHeaderSessionId,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_ENTRIES,
};
