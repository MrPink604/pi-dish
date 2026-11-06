/**
 * Persistent, incrementally-updated index of derived session data: the list
 * metadata `getSessionInfo` computes plus the lowercased search text behind
 * server-side list search. The in-memory caches in session-files.js are
 * LRU-capped, so a whole-corpus scan would evict every entry before the next
 * request revisits it; this index persists `(mtimeMs, size)`-validated
 * projections under ~/.pi/dish/session-index/ and re-parses only changed
 * files.
 *
 * `scanSessions` serves fresh entries, synchronously re-indexes at most
 * `PI_DISH_INDEX_SYNC_BUDGET` (default 20) stale files, and queues the rest
 * for a background build. A file that only grew is extended from the
 * appended byte range, so a sidebar poll or search keystroke never re-parses
 * a streaming multi-MB JSONL.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { SessionSource } from './session-source';
import { loadCacheRetentionConfig } from './cache-retention';
import type { CacheRetentionConfig } from './cache-retention';
import type { SessionInfo } from './session-metadata';
import { sessionInfoFromEntries, extendSessionInfoFromEntries, decodeSessionInfo } from './session-metadata';
import { isRecord } from './wire-protocol';
import { checkSearchLeaf, decodeUsage, decodeSkillRecords, decodeSkillState, finite } from './session-index-data';
import type { IndexedUsage, SkillActivation, SkillState } from './session-index-data';
import { encodeSessionKey, canonicalSessionId, resolveSessionRoute } from './session-key';

import {
  parseSessionEntries, readSessionFileEntries, buildSearchIndexFromEntries, extendSearchIndexFromEntries,
  buildIndexedUsageFromEntries, extendIndexedUsageFromEntries, SEARCH_TEXT_SESSION_CAP,
} from './session-files.js';
import { mineSkillsFromEntries } from './skill-mining.js';
import { createUsageCostEstimator, pricingRevision } from './harness-pricing.js';
import type { UsageCostEstimator } from './harness-pricing.js';
import {
  extendCacheLifetimeFromEntries, flushCacheLifetime, forgetCacheLifetimeFile, observeCacheLifetimeFromEntries,
} from './cache-lifetime.js';

export interface IndexedSessionInfo extends SessionInfo {
  sessionKey: SessionSource['sessionKey'];
  harnessId: SessionSource['harnessId'];
  nativeSessionId: SessionSource['nativeSessionId'];
  profileId: string;
  profileVersion: number;
  usage: IndexedUsage;
}
interface CacheStamp { mtimeMs: number; size: number; version: number; _bytes?: number }
/**
 * Freshness inputs resolved once per scan instead of once per file:
 * `pricingRevision` re-hashes the harness's whole override catalog on every
 * call, which dominated a warm scan. A queued backlog item resolves its own
 * context when drained.
 */
interface ScanContext {
  cacheConfig: CacheRetentionConfig;
  harnessRevision: (harnessId: SessionSource['harnessId']) => string;
  estimateCost: (harnessId: SessionSource['harnessId']) => UsageCostEstimator;
}
function scanContext(): ScanContext {
  const revisions = new Map<string, string>();
  const estimators = new Map<string, UsageCostEstimator>();
  return {
    cacheConfig: loadCacheRetentionConfig(),
    estimateCost(harnessId) {
      let estimate = estimators.get(harnessId);
      if (!estimate) { estimate = createUsageCostEstimator(harnessId); estimators.set(harnessId, estimate); }
      return estimate;
    },
    harnessRevision(harnessId) {
      let revision = revisions.get(harnessId);
      if (revision === undefined) { revision = pricingRevision(harnessId); revisions.set(harnessId, revision); }
      return revision;
    },
  };
}
interface MetaEntry extends CacheStamp {
  info: IndexedSessionInfo; profileId: string; profileVersion: number; pricingRevision: string; cacheRetentionRevision: string;
  ctimeMs?: number; dev?: number; ino?: number;
}
interface TextEntry extends CacheStamp { text: string; endsNl: boolean; tree: boolean; leafId: string | null }
interface SkillsEntry extends CacheStamp { records: SkillActivation[]; state: SkillState | null }
interface IndexState {
  metaLog: NdjsonLog; textLog: NdjsonLog; skillsLog: NdjsonLog;
  meta: Map<string, MetaEntry>; text: Map<string, TextEntry>; skills: Map<string, SkillsEntry>;
  backlog: Map<string, SessionSource>;
  building: boolean;
}
type LogRow = Record<string, unknown> & { f: string; _bytes: number };
type Encoder<T> = (file: string, entry: T) => unknown;
function persistedFlag(value: unknown): boolean {
  return value === undefined || value === 0 || value === 1 || value === false || value === true;
}

const SYNC_BUDGET_DEFAULT = 20;
const FLUSH_MS = 500;
const COMPACT_MIN_DEAD_BYTES = 1_000_000;
// Each projection carries a schema version; bumping it re-indexes stale
// entries through the bounded backlog. v13 is the current meta projection.
const META_SCHEMA_VERSION = 13;
const TEXT_SCHEMA_VERSION = 3;
const SKILLS_SCHEMA_VERSION = 1;

// Known skill directories (dir -> SKILL.md path) for attributing a read of
// `references/foo.md` to its skill. A roots change deliberately does not
// re-mine indexed files; attribution catches up when a file next changes.
let skillCtx = { roots: new Map<string, string>() };

export function setSkillRoots(skillFilePaths: readonly string[] | null | undefined): void {
  const roots = new Map<string, string>();
  for (const p of skillFilePaths || []) {
    if (typeof p === 'string' && p) roots.set(path.dirname(p), p);
  }
  skillCtx = { roots };
}

/** One append-only NDJSON file: load-latest-wins, buffered appends, compaction. */
class NdjsonLog {
  filePath: string;
  buffer: string[];
  flushTimer: NodeJS.Timeout | null;
  liveBytes: number;
  deadBytes: number;
  constructor(filePath: string) {
    this.filePath = filePath;
    this.buffer = [];
    this.flushTimer = null;
    this.liveBytes = 0;
    this.deadBytes = 0;
  }

  /** Latest line per file wins; an unparseable (torn) line is counted dead and re-indexed by the scan. */
  load() {
    const entries = new Map<string, LogRow>();
    let raw;
    try { raw = fs.readFileSync(this.filePath, 'utf-8'); } catch { return entries; }
    this.liveBytes = 0; this.deadBytes = 0;
    for (const line of raw.split('\n')) {
      if (!line) continue;
      let obj: unknown;
      try { obj = JSON.parse(line); } catch { this.deadBytes += line.length; continue; }
      if (!isRecord(obj) || typeof obj.f !== 'string') { this.deadBytes += line.length; continue; }
      const prev = entries.get(obj.f);
      if (prev) this.deadBytes += prev._bytes;
      if (obj.del) {
        entries.delete(obj.f);
        this.deadBytes += line.length;
      } else {
        entries.set(obj.f, { ...obj, f: obj.f, _bytes: line.length });
      }
    }
    for (const e of entries.values()) this.liveBytes += e._bytes;
    return entries;
  }

  append(obj: unknown): number {
    const line = JSON.stringify(obj);
    this.buffer.push(line);
    this.liveBytes += line.length;
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), FLUSH_MS);
      this.flushTimer.unref?.();
    }
    return line.length;
  }

  flush() {
    if (this.flushTimer) { clearTimeout(this.flushTimer); this.flushTimer = null; }
    if (!this.buffer.length) return;
    const chunk = this.buffer.join('\n') + '\n';
    this.buffer = [];
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.appendFileSync(this.filePath, chunk);
    } catch (e) {
      console.error(`session-index: append to ${this.filePath} failed:`, e instanceof Error ? e.message : String(e));
    }
  }

  /** Rewrite the log to only the given entries (temp-file + rename). */
  compact<T>(entries: Map<string, T>, encode: Encoder<T>): void {
    this.flush();
    const lines = [];
    let bytes = 0;
    for (const [file, entry] of entries) {
      const line = JSON.stringify(encode(file, entry));
      bytes += line.length;
      lines.push(line);
    }
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = this.filePath + '.tmp';
      fs.writeFileSync(tmp, lines.length ? lines.join('\n') + '\n' : '');
      fs.renameSync(tmp, this.filePath);
      this.liveBytes = bytes;
      this.deadBytes = 0;
    } catch (e) {
      console.error(`session-index: compact of ${this.filePath} failed:`, e instanceof Error ? e.message : String(e));
    }
  }

  markDead(bytes: number): void {
    this.deadBytes += bytes;
    this.liveBytes = Math.max(0, this.liveBytes - bytes);
  }

  needsCompaction() {
    return this.deadBytes > COMPACT_MIN_DEAD_BYTES && this.deadBytes > this.liveBytes;
  }
}

// dir -> state; the dir comes from os.homedir() per call (tests swap HOME).
const states = new Map<string, IndexState>();

function getState(): IndexState {
  const dir = path.join(os.homedir(), '.pi', 'dish', 'session-index');
  let st = states.get(dir);
  if (!st) {
    st = {
      metaLog: new NdjsonLog(path.join(dir, 'meta.ndjson')),
      textLog: new NdjsonLog(path.join(dir, 'text.ndjson')),
      skillsLog: new NdjsonLog(path.join(dir, 'skills.ndjson')),
      meta: new Map(), // file -> { mtimeMs, size, info }
      text: new Map(), // file -> { mtimeMs, size, text, indexedAt }
      skills: new Map(), // file -> { mtimeMs, size, records, salt }
      backlog: new Map(), // file -> candidate (pending background indexing)
      building: false,
    };
    for (const [f, e] of st.metaLog.load()) {
      const info = decodeIndexedInfo(e.v);
      if (!info || !finite(e.m) || !finite(e.s) ||
          !(e.p === undefined || typeof e.p === 'string') ||
          !(e.pv === undefined || finite(e.pv)) ||
          !(e.pr === undefined || typeof e.pr === 'string') ||
          !(e.cr === undefined || typeof e.cr === 'string')) { st.metaLog.markDead(e._bytes); continue; }
      st.meta.set(f, {
        mtimeMs: e.m, size: e.s, info,
        ctimeMs: finite(e.c) ? e.c : undefined, dev: finite(e.d) ? e.d : undefined, ino: finite(e.i) ? e.i : undefined,
        version: finite(e.ver) ? e.ver : 0,
        profileId: typeof e.p === 'string' ? e.p : 'pi-v3', profileVersion: finite(e.pv) ? e.pv : 1,
        pricingRevision: typeof e.pr === 'string' ? e.pr : 'native',
        cacheRetentionRevision: typeof e.cr === 'string' ? e.cr : '', _bytes: e._bytes,
      });
    }
    for (const [f, e] of st.textLog.load()) {
      if (!finite(e.m) || !finite(e.s) || typeof e.t !== 'string' ||
          !persistedFlag(e.nl) ||
          !persistedFlag(e.tr) ||
          !(e.l === undefined || e.l === null || typeof e.l === 'string')) { st.textLog.markDead(e._bytes); continue; }
      st.text.set(f, {
        mtimeMs: e.m, size: e.s, text: e.t, endsNl: !!e.nl,
        version: finite(e.ver) ? e.ver : 0, tree: !!e.tr,
        leafId: typeof e.l === 'string' ? e.l : null, _bytes: e._bytes,
      });
    }
    for (const [f, e] of st.skillsLog.load()) {
      const records = decodeSkillRecords(e.r);
      const state = e.st == null ? null : decodeSkillState(e.st);
      if (!finite(e.m) || !finite(e.s) || !records || (e.st != null && !state)) { st.skillsLog.markDead(e._bytes); continue; }
      st.skills.set(f, {
        mtimeMs: e.m, size: e.s, records, state,
        version: finite(e.ver) ? e.ver : 0, _bytes: e._bytes,
      });
    }
    if (st.metaLog.needsCompaction()) compactMeta(st);
    if (st.textLog.needsCompaction()) compactText(st);
    if (st.skillsLog.needsCompaction()) compactSkills(st);
    states.set(dir, st);
  }
  return st;
}

const encodeMeta = (f: string, e: MetaEntry) => ({ f, m: e.mtimeMs, s: e.size, c: e.ctimeMs, d: e.dev, i: e.ino, ver: META_SCHEMA_VERSION, p: e.profileId, pv: e.profileVersion, pr: e.pricingRevision, cr: e.cacheRetentionRevision, v: e.info });
const encodeText = (f: string, e: TextEntry) => ({
  f, m: e.mtimeMs, s: e.size, ver: TEXT_SCHEMA_VERSION,
  nl: e.endsNl ? 1 : 0, tr: e.tree ? 1 : 0, l: e.leafId || undefined, t: e.text,
});
const encodeSkills = (f: string, e: SkillsEntry) => ({ f, m: e.mtimeMs, s: e.size, ver: SKILLS_SCHEMA_VERSION, st: e.state || undefined, r: e.records });

function compactMeta(st: IndexState) { st.metaLog.compact(st.meta, encodeMeta); }
function compactText(st: IndexState) { st.textLog.compact(st.text, encodeText); }
function compactSkills(st: IndexState) { st.skillsLog.compact(st.skills, encodeSkills); }

/**
 * Route -> validated identity tuple. The route functions are pure string
 * transforms and normalize() runs once per session per list search; the
 * harness registry is static, so a resolved route never becomes invalid and
 * a throwing one is never cached.
 */
interface RouteIdentity {
  harnessId: SessionSource['harnessId'];
  nativeSessionId: SessionSource['nativeSessionId'];
  sessionKey: SessionSource['sessionKey'];
  canonical: boolean;
}
const routeIdentities = new Map<string, RouteIdentity>();
const ROUTE_IDENTITY_CACHE_MAX = 4096;
function routeIdentity(routeId: string): RouteIdentity {
  let entry = routeIdentities.get(routeId);
  if (!entry) {
    const identity = resolveSessionRoute(routeId);
    entry = {
      harnessId: identity.harnessId, nativeSessionId: identity.nativeSessionId,
      sessionKey: encodeSessionKey(identity.harnessId, identity.nativeSessionId),
      canonical: canonicalSessionId(routeId) === routeId,
    };
    if (routeIdentities.size >= ROUTE_IDENTITY_CACHE_MAX) routeIdentities.clear();
    routeIdentities.set(routeId, entry);
  }
  return entry;
}

/** Validate explicit source identity; a path alone cannot establish a profile. */
function normalize(input: SessionSource): SessionSource {
  if (!isRecord(input) || typeof input.file !== 'string' || !input.file ||
      typeof input.profileId !== 'string' || !finite(input.profileVersion) ||
      !(input.parentSession === null || typeof input.parentSession === 'string')) throw new TypeError('Expected explicit SessionSource');
  const identity = routeIdentity(input.routeId);
  if (identity.harnessId !== input.harnessId || identity.nativeSessionId !== input.nativeSessionId ||
      identity.sessionKey !== input.sessionKey || !identity.canonical) throw new TypeError('Invalid SessionSource identity');
  return input;
}
function decodeIndexedInfo(value: unknown): IndexedSessionInfo | null {
  const info = decodeSessionInfo(value);
  if (!info || !isRecord(value) || typeof value.profileId !== 'string' || !finite(value.profileVersion)) return null;
  const usage = decodeUsage(value.usage);
  if (!usage) return null;
  try {
    const identity = resolveSessionRoute(value.sessionKey);
    if (identity.harnessId !== value.harnessId || identity.nativeSessionId !== value.nativeSessionId) return null;
    return { ...info, ...identity, sessionKey: encodeSessionKey(identity.harnessId, identity.nativeSessionId),
      profileId: value.profileId, profileVersion: value.profileVersion, usage };
  } catch { return null; }
}

/** Parse one file once and update all index tables + their logs. */
function indexFile(st: IndexState, candidate: SessionSource, stats: fs.Stats,
  ctx: ScanContext): IndexedSessionInfo {
  const file = candidate.file;
  // Reuse the last raw parse if another reader just opened this file.
  const { entries, endsNl } = readSessionFileEntries(file, stats);
  observeCacheLifetimeFromEntries(entries, file, candidate.profileId);
  const { nativeSessionId, sessionKey } = candidate;
  const info: IndexedSessionInfo = {
    ...sessionInfoFromEntries(entries, stats.mtime, candidate, ctx.cacheConfig),
    sessionKey, harnessId: candidate.harnessId, nativeSessionId,
    profileId: candidate.profileId, profileVersion: candidate.profileVersion,
    usage: buildIndexedUsageFromEntries(entries, candidate, ctx.estimateCost(candidate.harnessId)),
  };
  const search = buildSearchIndexFromEntries(entries);
  checkSearchLeaf(search);
  setEntry(st.meta, st.metaLog, file,
    { mtimeMs: stats.mtimeMs, size: stats.size, ctimeMs: stats.ctimeMs, dev: stats.dev, ino: stats.ino, version: META_SCHEMA_VERSION, profileId: candidate.profileId, profileVersion: candidate.profileVersion, pricingRevision: ctx.harnessRevision(candidate.harnessId), cacheRetentionRevision: ctx.cacheConfig.revision, info }, encodeMeta);
  setEntry(st.text, st.textLog, file,
    {
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      version: TEXT_SCHEMA_VERSION,
      text: search.text,
      tree: search.tree,
      leafId: search.leafId,
      endsNl,
    }, encodeText);
  const mined = mineSkillsFromEntries(entries, {
    // Public Pi routes stay raw ids; alternate harnesses need the encoded tuple to avoid cross-corpus clashes.
    sessionId: candidate.harnessId === 'pi' ? nativeSessionId : sessionKey,
    skillCtx,
  });
  setEntry(st.skills, st.skillsLog, file,
    { mtimeMs: stats.mtimeMs, size: stats.size, version: SKILLS_SCHEMA_VERSION, records: mined.records, state: mined.state }, encodeSkills);
  return info;
}

/** The all-tables freshness test scanSessions and getSessionInfo share. */
function isEntryFresh(st: IndexState, file: string, candidate: SessionSource, stats: fs.Stats,
  ctx: ScanContext): boolean {
  const cached = st.meta.get(file);
  const cachedText = st.text.get(file);
  const cachedSkills = st.skills.get(file);
  // The skills table participates in staleness; without it a pre-skills index
  // would report zero skill usage for the whole historical corpus.
  return !!(cached && cached.version === META_SCHEMA_VERSION &&
    cached.info.sessionKey === candidate.sessionKey && cached.info.nativeSessionId === candidate.nativeSessionId &&
    cached.profileId === candidate.profileId && cached.profileVersion === candidate.profileVersion &&
    cached.pricingRevision === ctx.harnessRevision(candidate.harnessId) &&
    cached.cacheRetentionRevision === ctx.cacheConfig.revision &&
    cachedText && cachedText.version === TEXT_SCHEMA_VERSION &&
    cachedSkills && cachedSkills.version === SKILLS_SCHEMA_VERSION &&
    cached.mtimeMs === stats.mtimeMs && cached.size === stats.size &&
    cached.ctimeMs === stats.ctimeMs && cached.dev === stats.dev && cached.ino === stats.ino &&
    cachedText.mtimeMs === stats.mtimeMs && cachedText.size === stats.size &&
    cachedSkills.mtimeMs === stats.mtimeMs && cachedSkills.size === stats.size);
}

/**
 * O(delta) refresh for a session file that only grew. Extends all three
 * tables in memory when the appended range is a plain chain from the indexed
 * leaf; anything else (tree jump, shrink/rewrite, schema or pricing mismatch,
 * missing continuity state) returns null so the caller re-indexes fully.
 * Extensions are not logged: hot files churn too fast to persist per delta.
 */
function tryExtendIndexEntry(st: IndexState, candidate: SessionSource, stats: fs.Stats,
  ctx: ScanContext): IndexedSessionInfo | null {
  const file = candidate.file;
  const meta = st.meta.get(file), text = st.text.get(file), skills = st.skills.get(file);
  if (!meta || !text || !skills) return null;
  if (meta.version !== META_SCHEMA_VERSION || text.version !== TEXT_SCHEMA_VERSION ||
      skills.version !== SKILLS_SCHEMA_VERSION) return null;
  if (meta.info.sessionKey !== candidate.sessionKey || meta.info.nativeSessionId !== candidate.nativeSessionId) return null;
  if (meta.profileId !== candidate.profileId || meta.profileVersion !== candidate.profileVersion) return null;
  if (meta.pricingRevision !== ctx.harnessRevision(candidate.harnessId)) return null;
  if (meta.cacheRetentionRevision !== ctx.cacheConfig.revision) return null;
  // The three tables are written together; extend only from a coherent base.
  if (meta.mtimeMs !== text.mtimeMs || meta.size !== text.size ||
      meta.mtimeMs !== skills.mtimeMs || meta.size !== skills.size) return null;
  if (!(stats.size > meta.size) || !text.endsNl) return null;
  if (meta.dev !== stats.dev || meta.ino !== stats.ino) return null; // replaced, not appended
  // Continuity state (running provider/model/cwd) is required to accumulate
  // a delta; entries persisted before it existed re-index fully once.
  if (!meta.info?.usage?.state || !skills.state) return null;
  let delta, entries, extension;
  try {
    delta = readByteRange(file, meta.size, stats.size);
    entries = parseSessionEntries(delta);
    extension = extendSearchIndexFromEntries(entries, text.tree, text.leafId);
    if (extension) checkSearchLeaf(extension);
  } catch { return null; }
  if (!extension) return null;
  try {
    extendSessionInfoFromEntries(meta.info, entries, stats.mtime, candidate, ctx.cacheConfig);
    extendCacheLifetimeFromEntries(entries, file, candidate.profileId);
    extendIndexedUsageFromEntries(meta.info.usage, entries, candidate, ctx.estimateCost(candidate.harnessId));
    const mined = mineSkillsFromEntries(entries, {
      sessionId: candidate.harnessId === 'pi' ? meta.info.nativeSessionId : meta.info.sessionKey,
      skillCtx,
      initialState: skills.state,
    });
    if (mined.records.length) skills.records = skills.records.concat(mined.records);
    skills.state = mined.state;
  } catch {
    // A half-applied extension must not survive; drop the entry so the next
    // scan rebuilds it from the file.
    dropEntry(st, file);
    return null;
  }
  // Honor the same total-text bound as a full build, evicting oldest text first.
  if (extension.text) {
    const next = text.text ? text.text + ' ' + extension.text : extension.text;
    text.text = next.length > SEARCH_TEXT_SESSION_CAP
      ? next.slice(next.length - SEARCH_TEXT_SESSION_CAP) : next;
  }
  text.endsNl = delta.endsWith('\n');
  text.tree = extension.tree;
  text.leafId = extension.leafId;
  meta.ctimeMs = stats.ctimeMs;
  for (const entry of [meta, text, skills]) {
    entry.mtimeMs = stats.mtimeMs;
    entry.size = stats.size;
  }
  return meta.info;
}

function setEntry<T extends CacheStamp>(map: Map<string, T>, log: NdjsonLog, file: string, entry: T, encode: Encoder<T>): void {
  const prev = map.get(file);
  if (prev) log.markDead(prev._bytes || 0);
  entry._bytes = log.append(encode(file, entry));
  map.set(file, entry);
  if (log.needsCompaction()) log.compact(map, encode);
}

function dropEntry(st: IndexState, file: string): void {
  for (const [map, log] of [[st.meta, st.metaLog], [st.text, st.textLog], [st.skills, st.skillsLog]] as const) {
    const prev = map.get(file);
    if (!prev) continue;
    map.delete(file);
    log.markDead(prev._bytes || 0);
    log.append({ f: file, del: 1 });
  }
  st.backlog.delete(file);
  forgetCacheLifetimeFile(file);
}

function syncBudget() {
  const n = parseInt(process.env.PI_DISH_INDEX_SYNC_BUDGET || '', 10);
  return Number.isFinite(n) ? n : SYNC_BUDGET_DEFAULT;
}

/** Drain the backlog one file per tick so requests interleave freely. */
function kickBuilder(st: IndexState) {
  if (st.building || !st.backlog.size) return;
  st.building = true;
  const step = () => {
    const next = st.backlog.entries().next();
    if (next.done) { st.building = false; flushCacheLifetime(); return; }
    const [file, candidate] = next.value;
    st.backlog.delete(file);
    try {
      const stats = fs.statSync(file);
      const ctx = scanContext();
      if (!isEntryFresh(st, file, candidate, stats, ctx) &&
          !tryExtendIndexEntry(st, candidate, stats, ctx)) indexFile(st, candidate, stats, ctx);
    } catch {} // vanished/unreadable: skip
    setImmediate(step);
  };
  setImmediate(step);
}

/**
 * The scan behind the historical session list. A file missing from `infos`
 * is queued for background indexing, so `indexing` is exactly "a backlog
 * remains". Entries for files gone from disk are tombstoned.
 */
export function scanSessions(files: readonly SessionSource[]): { infos: ReadonlyMap<string, Readonly<IndexedSessionInfo>>; indexing: boolean } {
  const st = getState();
  const infos = new Map<string, IndexedSessionInfo>();
  const seen = new Set<string>();
  let budget = syncBudget();
  const ctx = scanContext();

  for (const input of files) {
    const candidate = normalize(input);
    const file = candidate.file;
    seen.add(file);
    let stats;
    try { stats = fs.statSync(file); } catch { dropEntry(st, file); continue; }
    if (isEntryFresh(st, file, candidate, stats, ctx)) {
      st.backlog.delete(file); // a stale queue entry for a file we just served
      infos.set(file, st.meta.get(file)!.info);
      continue;
    }
    // An append-only growth extends in O(delta) instead of consuming sync budget.
    const extended = tryExtendIndexEntry(st, candidate, stats, ctx);
    if (extended) {
      st.backlog.delete(file);
      infos.set(file, extended);
      continue;
    }
    if (budget > 0) {
      budget--;
      st.backlog.delete(file);
      try { infos.set(file, indexFile(st, candidate, stats, ctx)); } catch {}
    } else {
      st.backlog.set(file, candidate);
    }
  }

  // Sessions deleted on disk: drop their index entries. (Absent-from-`files`
  // but still existing is fine — e.g. an active session the caller excluded.)
  for (const file of [...st.meta.keys()]) {
    if (!seen.has(file) && !fs.existsSync(file)) dropEntry(st, file);
  }

  kickBuilder(st);
  flushCacheLifetime();
  return { infos, indexing: st.backlog.size > 0 };
}

/**
 * Search text for one session file: fresh from the index, extended in
 * O(delta) when the file only grew, fully re-indexed otherwise. '' when the
 * file is unreadable.
 */
export function getSearchText(input: SessionSource): string {
  const candidate = normalize(input);
  const file = candidate.file;
  const st = getState();
  const cached = st.text.get(file);
  const meta = st.meta.get(file);
  let stats;
  st.backlog.delete(file); // this demand read owns the refresh
  try { stats = fs.statSync(file); } catch { return ''; }
  if (cached && cached.version === TEXT_SCHEMA_VERSION && meta &&
      meta.info.sessionKey === candidate.sessionKey && meta.info.nativeSessionId === candidate.nativeSessionId &&
      meta.profileId === candidate.profileId && meta.profileVersion === candidate.profileVersion &&
      meta.ctimeMs === stats.ctimeMs && meta.dev === stats.dev && meta.ino === stats.ino &&
      cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    return cached.text;
  }
  // Freshness inputs are loaded only by the rebuild paths below: a fresh entry
  // would otherwise stat settings.json and re-hash the pricing catalog.
  const ctx = scanContext();
  if (tryExtendIndexEntry(st, candidate, stats, ctx)) return st.text.get(file)!.text;
  try { indexFile(st, candidate, stats, ctx); } catch { return ''; }
  return st.text.get(file)!.text;
}

/**
 * Index-backed single-file session info with session-files' shape. Serves
 * fresh entries, extends append-only growth in O(delta), fully re-indexes
 * anything else, and throws when the file is unreadable.
 */
export function getSessionInfo(input: SessionSource): SessionInfo {
  const candidate = normalize(input);
  const st = getState();
  const ctx = scanContext();
  const stats = fs.statSync(candidate.file);
  let info;
  if (isEntryFresh(st, candidate.file, candidate, stats, ctx)) {
    info = st.meta.get(candidate.file)!.info;
  } else {
    info = tryExtendIndexEntry(st, candidate, stats, ctx) || indexFile(st, candidate, stats, ctx);
  }
  st.backlog.delete(candidate.file); // just indexed/served; a queued rebuild is stale
  // Strip index-internal fields so callers (and responses spreading info) see
  // the plain session-files shape.
  const { usage, sessionKey, harnessId, nativeSessionId, profileId, profileVersion, ...pub } = info;
  return pub;
}

function readByteRange(file: string, start: number, end: number): string {
  const fd = fs.openSync(file, 'r');
  try {
    const buf = Buffer.alloc(end - start);
    const n = fs.readSync(fd, buf, 0, buf.length, start);
    return buf.toString('utf-8', 0, n);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * Mined skill-activation records across every indexed session, filtered by
 * absolute SKILL.md path, kind, cwd or time. Reads only the in-memory index;
 * files still in the backlog are simply absent.
 */
export function getSkillActivations(filter: { skill?: string; sinceMs?: number; cwd?: string; kind?: string } = {}): SkillActivation[] {
  const st = getState();
  const { skill, sinceMs, cwd, kind } = filter;
  const out: SkillActivation[] = [];
  for (const entry of st.skills.values()) {
    for (const r of entry.records) {
      if (skill && r.skill !== skill) continue;
      if (kind && r.kind !== kind) continue;
      if (cwd && r.cwd !== cwd) continue;
      if (sinceMs != null && !(finite(r.ts) && r.ts >= sinceMs)) continue;
      out.push(r);
    }
  }
  return out;
}

/** Test hook: flush pending appends and forget in-memory state. */
export function resetForTests(): void {
  for (const st of states.values()) {
    st.backlog.clear();
    st.metaLog.flush(); st.textLog.flush(); st.skillsLog.flush();
  }
  states.clear();
}
