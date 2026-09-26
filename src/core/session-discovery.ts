import fs = require('fs');
import path = require('path');
import { encodeSessionKey, canonicalSessionId, validSessionId } from './session-key';
import { getHarness, listHarnesses } from './harnesses';
import { isRecord } from './wire-protocol';
import type { HarnessDescriptor, HarnessId, NativeSessionId } from './contracts';
import type { DiscoveryCandidate, DiscoveryOptions } from './session-source-contracts';
import { readSessionTailEntry } from './session-files';

interface SessionHeader { id: string | null; cwd: string | null; parentSession: string | null; }
type Candidate = DiscoveryCandidate;
interface CandidateHint {
  file: string; id: string; dirName: string; depth: number;
  identitySource: 'basename' | 'header'; parentSession?: string;
}
interface Result { candidates: Candidate[]; truncated: boolean; skipped: number; }
interface HarnessDiscoveryOptions extends DiscoveryOptions { roots?: Partial<Record<HarnessId, string>>; }
interface FindOptions extends DiscoveryOptions { allowPartial?: boolean; }


const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_FILES = 20000;
const DEFAULT_MAX_ENTRIES = 100000;
// One live session's own subagent subtree — small by nature (a fan-out is
// dozens of agents, not thousands) and read per request. Depth stays the
// corpus walk's DEFAULT_MAX_DEPTH so both reach the same files.
const DEFAULT_SUBSESSION_FILES = 200;
// Prime-style RLM subagents recurse one `session-artifacts/<id>/sub-*` level
// per generation (grandchildren interleave another `session-artifacts/<id>`
// segment), so the artifacts walk gets its own depth budget well past any
// sane fan-out; the shared file/entry budgets remain the real bound.
const DEFAULT_ARTIFACTS_DEPTH = 16;

const HEADER_BYTES = 16 * 1024;
const HEADER_CACHE_MAX = DEFAULT_MAX_FILES;
const headerCache = new Map<string, { stat: fs.Stats; header: SessionHeader | null }>();
const warnedInvalidCandidates = new Set<string>();

function positiveInt(value: unknown, fallback: number) {
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function cacheHeader(filePath: string, stat: fs.Stats, header: SessionHeader | null, profileId = 'pi-v3') {
  if (headerCache.size >= HEADER_CACHE_MAX) headerCache.delete(headerCache.keys().next().value!);
  headerCache.set(`${profileId}\0${filePath}`, { stat, header });
}

function readSessionHeader(filePath: string, profileId = 'pi-v3'): SessionHeader | null {
  let fd: number | undefined;
  let stat: fs.Stats | undefined;
  try {
    stat = fs.statSync(filePath);
    const cached = headerCache.get(`${profileId}\0${filePath}`);
    if (cached && cached.stat.mtimeMs === stat.mtimeMs && cached.stat.size === stat.size &&
        cached.stat.ctimeMs === stat.ctimeMs && cached.stat.dev === stat.dev && cached.stat.ino === stat.ino) return cached.header;
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.allocUnsafe(HEADER_BYTES);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const bytes = buf.subarray(0, n);
    const newline = bytes.indexOf(10, 0);
    if (newline < 0 && n === buf.length) {
      cacheHeader(filePath, stat, null, profileId);
      return null;
    }
    let header: Record<string, unknown> | null = null;
    // Decode only through the header, not the following 16KB of transcript.
    for (let start = 0; start < n;) {
      const newlineAt = bytes.indexOf(10, start);
      const end = newlineAt < 0 ? n : newlineAt;
      const line = bytes.toString('utf8', start, end);
      start = end + 1;
      let entry: unknown; try { entry = JSON.parse(line); } catch { continue; }
      if (isRecord(entry) && entry.type === 'session') { header = entry; break; }
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

/** A fan-out shares parent headers only within this synchronous discovery. */
function scopedHeaders(): typeof readSessionHeader {
  const headers = new Map<string, SessionHeader | null>();
  return (file, profileId = 'pi-v3') => {
    const key = `${profileId}\0${file}`;
    if (headers.has(key)) return headers.get(key)!;
    const header = readSessionHeader(file, profileId);
    headers.set(key, header);
    return header;
  };
}

function safeHeaderSessionId(value: unknown): NativeSessionId | null {
  return validSessionId(value) ? value : null;
}

/** The harness/profile identity every discovered candidate carries. */
function decorateCandidate(candidate: CandidateHint, descriptor: HarnessDescriptor, options: DiscoveryOptions = {}): Candidate {
  if (!validSessionId(candidate.id)) throw new TypeError('Invalid session identity');
  const sessionKey = encodeSessionKey(descriptor.id, candidate.id);
  return {
    file: candidate.file,
    dirName: candidate.dirName,
    depth: candidate.depth,
    identitySource: candidate.identitySource,
    nativeSessionId: candidate.id,
    harnessId: descriptor.id,
    profileId: options.profileId || descriptor.profileId,
    profileVersion: options.profileVersion ?? descriptor.profileVersion,
    sessionKey,
    routeId: canonicalSessionId(sessionKey),
    parentSession: candidate.parentSession ?? null,
  };
}

function candidateForFile(file: string, workspaceDirName: string, depth: number, descriptor: HarnessDescriptor, readHeader = readSessionHeader): CandidateHint | null {
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
    if (!readHeader(parentSession, descriptor.profileId)) return null;
    const header = readHeader(file, descriptor.profileId);
    const id = safeHeaderSessionId(header?.id);
    return id
      ? { file, id, dirName: workspaceDirName, depth, identitySource: 'header', parentSession }
      : null;
  }
  const header = readHeader(file, descriptor.profileId);
  const id = safeHeaderSessionId(header?.id);
  return id ? { file, id, dirName: workspaceDirName, depth, identitySource: 'header' } : null;
}

/**
 * Header-identity candidate for a session-artifacts JSONL (Prime RLM). The
 * child header carries the `parentSession` edge; `parentFallback` covers
 * pre-header releases only when the path shape names the parent directly
 * (`session-artifacts/<id>/sub-*` one generation down). Non-session JSONLs
 * (semantic-edges.jsonl, registries) have no session header and drop out.
 */
function artifactCandidateForFile(file: string, dirName: string, depth: number, descriptor: HarnessDescriptor, parentFallback: string | null, readHeader = readSessionHeader): CandidateHint | null {
  const header = readHeader(file, descriptor.profileId);
  const id = safeHeaderSessionId(header?.id);
  if (!id) return null;
  const parentSession = header?.parentSession || parentFallback || undefined;
  return { file, id, dirName, depth, identitySource: 'header', ...(parentSession ? { parentSession } : {}) };
}

/** Fallback parent for a file exactly one `sub-*` generation below the walk
 * root (`<root>/sub-x` probing one session, `<root>/<topId>/sub-x` scanning
 * the corpus). Deeper nesting relies on the child header's parentSession. */
function artifactParentFallback(walkRoot: string, dirPath: string, rootParent: (topId: string | null) => string | null): string | null {
  const segments = path.relative(walkRoot, dirPath).split(path.sep);
  if (!segments[segments.length - 1]?.startsWith('sub-')) return null;
  if (segments.length === 1) return rootParent(null);
  if (segments.length === 2) return rootParent(segments[0]);
  return null;
}

/**
 * Discover harness session JSONLs, including bounded nested layouts used by
 * external launchers and OMP subagents. Normal files retain their basename
 * identity; generic/nested session files use validated header ids.
 */
function discoverSessionCandidates(rootDir: string, options: DiscoveryOptions = {}): Result {
  const descriptor = options.descriptor || getHarness(options.harnessId || 'pi');
  if (!descriptor) throw new TypeError('Unknown harness descriptor');
  const maxDepth = positiveInt(options.maxDepth ?? process.env.PI_DISH_SESSION_DISCOVERY_DEPTH, DEFAULT_MAX_DEPTH);
  const maxFiles = positiveInt(options.maxFiles ?? process.env.PI_DISH_SESSION_DISCOVERY_MAX_FILES, DEFAULT_MAX_FILES);
  const maxEntries = positiveInt(options.maxEntries ?? process.env.PI_DISH_SESSION_DISCOVERY_MAX_ENTRIES, DEFAULT_MAX_ENTRIES);
  const excludeIds = options.excludeIds instanceof Set ? options.excludeIds : new Set(options.excludeIds || []);
  const candidates: Candidate[] = [];
  const byId = new Map<string, Candidate>();
  const ambiguousHeaderIds = new Set<string>();
  let truncated = false;
  let skipped = 0;
  let filesSeen = 0;
  let entriesSeen = 0;
  const readHeader = scopedHeaders();

  const add = (hint: CandidateHint | null) => {
    if (!hint) return;
    if (!validSessionId(hint.id)) {
      skipped += 1;
      const warningKey = `${descriptor.id}\0${hint.file}`;
      if (!warnedInvalidCandidates.has(warningKey)) {
        if (warnedInvalidCandidates.size >= HEADER_CACHE_MAX) {
          warnedInvalidCandidates.delete(warnedInvalidCandidates.keys().next().value!);
        }
        warnedInvalidCandidates.add(warningKey);
        console.warn(`session discovery: skipping invalid ${descriptor.id} identity ${JSON.stringify(hint.id)} from ${JSON.stringify(hint.file)}`);
      }
      return;
    }
    const candidate = decorateCandidate(hint, descriptor, options);
    if (excludeIds.has(candidate.nativeSessionId) || ambiguousHeaderIds.has(candidate.nativeSessionId)) return;
    const previous = byId.get(candidate.nativeSessionId);
    if (previous) {
      // Two generic files claiming one native header id are unsafe to route:
      // omit the identity rather than let read/mutation routes pick a copy.
      if (candidate.identitySource === 'header' && previous.identitySource === 'header') {
        const index = candidates.indexOf(previous);
        if (index >= 0) candidates.splice(index, 1);
        byId.delete(candidate.nativeSessionId);
        ambiguousHeaderIds.add(candidate.nativeSessionId);
        return;
      }
      // A traditional basename identity wins over a colliding generic hint.
      if (candidate.identitySource !== previous.identitySource) {
        if (candidate.identitySource === 'basename') {
          const index = candidates.indexOf(previous);
          if (index >= 0) candidates[index] = candidate;
          byId.set(candidate.nativeSessionId, candidate);
        }
        return;
      }
      // Preserve deterministic compatibility for traditional duplicate names.
      if (candidate.depth < previous.depth ||
          (candidate.depth === previous.depth && candidate.file.localeCompare(previous.file) < 0)) {
        const index = candidates.indexOf(previous);
        if (index >= 0) candidates[index] = candidate;
        byId.set(candidate.nativeSessionId, candidate);
      }
      return;
    }
    byId.set(candidate.nativeSessionId, candidate);
    candidates.push(candidate);
  };

  // Stream directory entries instead of materializing/sorting an unbounded
  // directory before applying maxEntries. Candidate output and duplicate
  // selection are sorted deterministically below; when traversal truncates,
  // the response explicitly reports that it is partial.
  const eachEntry = (dirPath: string, visit: (entry: fs.Dirent) => void) => {
    let dir: fs.Dir;
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

  const walk = (dirPath: string, workspaceDirName: string, depth: number): void => {
    if (truncated) return;
    eachEntry(dirPath, (entry) => {
      if (truncated) return;
      const full = path.join(dirPath, entry.name);
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        if (filesSeen >= maxFiles) { truncated = true; return; }
        filesSeen += 1;
        add(candidateForFile(full, workspaceDirName, depth, descriptor, readHeader));
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
      add(candidateForFile(path.join(rootDir, entry.name), path.basename(rootDir), 0, descriptor, readHeader));
    });
  } else eachEntry(rootDir, (workspace) => {
    if (!workspace.isDirectory() || workspace.isSymbolicLink()) return;
    walk(path.join(rootDir, workspace.name), workspace.name, 0);
  });

  // Prime-style RLM subagents live outside the sessions root, under
  // <agent>/session-artifacts/<parentId>/sub-<id8>/<session>.jsonl. The walk
  // shares the corpus file/entry budgets but gets its own depth budget: each
  // subagent generation costs two directory levels (sub-* plus the
  // interleaved session-artifacts segment).
  if (descriptor.subagentArtifacts) {
    const artifactsRoot = path.join(path.dirname(rootDir), 'session-artifacts');
    const dirName = path.basename(rootDir);
    const walkArtifacts = (dirPath: string, depth: number): void => {
      if (truncated || depth > DEFAULT_ARTIFACTS_DEPTH) return;
      eachEntry(dirPath, (entry) => {
        if (truncated) return;
        const full = path.join(dirPath, entry.name);
        if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          if (filesSeen >= maxFiles) { truncated = true; return; }
          filesSeen += 1;
          add(artifactCandidateForFile(full, dirName, depth, descriptor,
            artifactParentFallback(artifactsRoot, dirPath, (topId) => {
              if (topId === null) return null;
              const parentFile = path.join(rootDir, `${topId}.jsonl`);
              return readHeader(parentFile, descriptor.profileId) ? parentFile : null;
            }), readHeader));
        } else if (entry.isDirectory() && !entry.isSymbolicLink()) {
          walkArtifacts(full, depth + 1);
        }
      });
    };
    walkArtifacts(artifactsRoot, 1);
  }

  candidates.sort((a, b) => a.file.localeCompare(b.file));
  return { candidates, truncated, skipped };
}

/** Discover configured harness roots while retaining per-harness identity. */
function discoverHarnessSessions(descriptors: readonly HarnessDescriptor[] = listHarnesses(), options: HarnessDiscoveryOptions = {}): Result {
  const candidates: Candidate[] = [];
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

function findSessionCandidate(rootDir: string, sessionId: string, options: FindOptions = {}): { candidate: Candidate | null; truncated: boolean; skipped: number } {
  const { candidates, truncated, skipped } = discoverSessionCandidates(rootDir, options);
  const exact = candidates.find((candidate) => candidate.nativeSessionId === sessionId);
  if (exact) return { candidate: exact, truncated, skipped };
  if (options.allowPartial === false) return { candidate: null, truncated, skipped };
  const partial = candidates.filter((candidate) => candidate.nativeSessionId.includes(sessionId));
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
function discoverSubsessionCandidates(parentFile: string, options: DiscoveryOptions = {}): Candidate[] {
  const descriptor = options.descriptor || getHarness(options.harnessId || 'pi');
  if (!descriptor) throw new TypeError('Unknown harness descriptor');
  if (typeof parentFile !== 'string' || !parentFile.endsWith('.jsonl')) return [];
  if (descriptor.subagentArtifacts) return discoverArtifactSubsessions(parentFile, descriptor, options);
  if (!descriptor.nestedSubsessions) return [];
  const maxDepth = positiveInt(options.maxDepth, DEFAULT_MAX_DEPTH);
  const maxFiles = positiveInt(options.maxFiles, DEFAULT_SUBSESSION_FILES);
  const workspaceDirName = path.basename(path.dirname(parentFile));
  const byId = new Map<string, Candidate>();
  const ambiguous = new Set<string>();
  let files = 0;
  const readHeader = scopedHeaders();
  const walk = (dirPath: string, depth: number): void => {
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
      const candidate = candidateForFile(file, workspaceDirName, depth, descriptor, readHeader);
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

/**
 * Prime-RLM analogue of the OMP walk above: children of `parentFile` persist
 * under `dirname(dirname(parentFile))/session-artifacts/<parentId>/sub-*`,
 * recursively — the same derivation Prime's own session manager applies to
 * find a session's artifact dir. Grandchildren interleave another
 * `session-artifacts/<childId>` segment inside this tree, so one recursive
 * walk reaches the whole descendant fan-out.
 */
function discoverArtifactSubsessions(parentFile: string, descriptor: HarnessDescriptor, options: DiscoveryOptions): Candidate[] {
  const maxFiles = positiveInt(options.maxFiles, DEFAULT_SUBSESSION_FILES);
  const parentId = path.basename(parentFile, '.jsonl');
  const artifactsDir = path.join(path.dirname(path.dirname(parentFile)), 'session-artifacts', parentId);
  const dirName = path.basename(path.dirname(parentFile));
  const byId = new Map<string, Candidate>();
  const ambiguous = new Set<string>();
  let files = 0;
  const walk = (dirPath: string, depth: number): void => {
    if (depth > DEFAULT_ARTIFACTS_DEPTH || files >= maxFiles) return;
    try { if (!fs.lstatSync(dirPath).isDirectory()) return; } catch { return; }
    let entries;
    try { entries = fs.readdirSync(dirPath, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (files >= maxFiles) return;
      const full = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        if (!entry.isSymbolicLink()) walk(full, depth + 1);
        continue;
      }
      if (!entry.isFile() || !entry.name.endsWith('.jsonl')) continue;
      files += 1;
      const candidate = artifactCandidateForFile(full, dirName, depth, descriptor,
        artifactParentFallback(artifactsDir, dirPath, (topId) => topId === null ? parentFile : null));
      if (!candidate) continue;
      // Same ambiguity rule as the OMP walk: two files claiming one header id
      // are both omitted rather than letting a route pick a copy.
      if (byId.has(candidate.id)) { byId.delete(candidate.id); ambiguous.add(candidate.id); }
      if (!ambiguous.has(candidate.id)) byId.set(candidate.id, decorateCandidate(candidate, descriptor, options));
    }
  };
  walk(artifactsDir, 1);
  return [...byId.values()].sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Lifecycle proof, deliberately stricter than sidebar discovery. Every JSONL
 * and directory in the parent's subtree must be inspectable; no lossy
 * candidate filtering, symlinks, ambiguous headers, or depth caps count as
 * evidence that all descendants exited.
 */
function inspectSubsessionExits(parentFile: unknown, options: DiscoveryOptions = {}): { complete: boolean; blockers: string[] } {
  const descriptor = options.descriptor || getHarness(options.harnessId || 'omp');
  const blockers: string[] = [];
  let complete = true;
  const unknown = (reason: string) => { complete = false; blockers.push(reason); };
  if (!descriptor?.nestedSubsessions || !descriptor.sessionExitCustomType
      || typeof parentFile !== 'string' || !parentFile.endsWith('.jsonl')) {
    return { complete: false, blockers: ['Cannot determine the parent session subtree or exit marker.'] };
  }
  const maxDepth = positiveInt(options.maxDepth, DEFAULT_MAX_DEPTH);
  const maxFiles = positiveInt(options.maxFiles, DEFAULT_SUBSESSION_FILES);
  const maxEntries = positiveInt(options.maxEntries, DEFAULT_MAX_ENTRIES);
  const ids = new Set<NativeSessionId>();
  let files = 0, entries = 0, capped = false;
  const validFile = (file: string) => {
    try {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('not a regular file');
      const header = readSessionHeader(file, descriptor.profileId);
      const id = safeHeaderSessionId(header?.id);
      if (!id) throw new Error('missing valid session header');
      if (ids.has(id)) throw new Error('ambiguous session header');
      ids.add(id);
      return true;
    } catch (error) {
      unknown(`Cannot inspect ${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  };
  if (!validFile(parentFile)) return { complete, blockers };
  const walk = (dirPath: string, depth: number, optional = false): void => {
    if (capped) return;
    let dir;
    try {
      let stat;
      try { stat = fs.lstatSync(dirPath); } catch (error) {
        if (optional && isRecord(error) && error.code === 'ENOENT') return;
        throw error;
      }
      if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('not a regular directory');
      if (depth > maxDepth) { capped = true; throw new Error('descendant depth limit reached'); }
      dir = fs.opendirSync(dirPath);
      let entry;
      while (!capped && (entry = dir.readSync())) {
        if (++entries > maxEntries) { capped = true; throw new Error('descendant entry limit reached'); }
        const file = path.join(dirPath, entry.name);
        if (entry.isSymbolicLink()) { unknown(`Cannot inspect symbolic link ${entry.name}.`); continue; }
        if (entry.isDirectory()) {
          walk(file, depth + 1);
        } else if (entry.name.endsWith('.jsonl')) {
          if (++files > maxFiles) { capped = true; throw new Error('descendant file limit reached'); }
          // Ordinary artifact directories are not sessions. Only a discovered
          // transcript requires the paired parent-file lineage proof.
          if (!readSessionHeader(`${dirPath}.jsonl`, descriptor.profileId)) {
            unknown(`Missing parent transcript for ${entry.name}.`);
          }
          if (!validFile(file)) continue;
          let tail;
          try { tail = readSessionTailEntry({ file, profileId: descriptor.profileId }); } catch {}
          if (!tail) unknown(`Cannot determine exit state of ${entry.name}.`);
          else if (!isRecord(tail) || tail.type !== 'custom' || tail.customType !== descriptor.sessionExitCustomType) {
            blockers.push(`Waiting for ${entry.name} to exit (idle children still count).`);
          }
        }
      }
    } catch (error) {
      unknown(`Cannot completely inspect descendants: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (dir) try { dir.closeSync(); } catch { unknown('Cannot finish descendant directory inspection.'); }
    }
  };
  walk(parentFile.slice(0, -6), 1, true);
  return { complete, blockers };
}

/** Retire all parser-profile observations of a replaced file. */
function invalidateSessionHeader(file: string): void {
  for (const key of headerCache.keys()) {
    if (key.slice(key.indexOf('\0') + 1) === file) headerCache.delete(key);
  }
}
function clearSessionHeaders(): void { headerCache.clear(); }

export = {
  invalidateSessionHeader,
  clearSessionHeaders,
  discoverSessionCandidates,
  discoverHarnessSessions,
  findSessionCandidate,
  discoverSubsessionCandidates,
  inspectSubsessionExits,
  readSessionHeader,
  safeHeaderSessionId,
  DEFAULT_MAX_DEPTH,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_ENTRIES,
};
