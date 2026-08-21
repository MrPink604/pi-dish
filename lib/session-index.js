/**
 * Persistent, incrementally-updated index of derived session data: the list
 * metadata `getSessionInfo` computes, plus the lowercased search text behind
 * server-side list search.
 *
 * Why it exists: the in-memory (mtimeMs, size) caches in session-files.js are
 * LRU-capped, and the historical scan iterates *every* session file — once
 * the file count exceeds a cap, a sequential scan evicts each entry before
 * the next request revisits it (0% hit rate) and every request re-parses the
 * whole corpus. At thousands of sessions that is seconds of synchronous
 * re-reads per sidebar poll or search keystroke. This module keeps the same
 * (mtimeMs, size) revalidation key but persists entries on disk, so a restart
 * re-parses nothing and steady state re-parses only files that changed.
 *
 * Storage: `~/.pi/dish/session-index/{meta,text}.ndjson` — append-only NDJSON
 * (one line per (re)indexed file, later lines win, `{"f":…,"del":1}` is a
 * tombstone), compacted via temp-file+rename when dead lines outweigh live
 * ones. Appends are buffered ~500ms; a torn final line is skipped on load and
 * simply re-indexed. No native modules, no node:sqlite — this must run on a
 * hand-built Node on old glibc.
 *
 * Scan contract (`scanSessions`): stat everything, serve fresh entries from
 * the index, synchronously re-index at most `PI_DISH_INDEX_SYNC_BUDGET`
 * (default 20) stale files, and queue the rest for a background build that
 * yields between files (setImmediate) so it never blocks the event loop.
 * `indexing: true` in the result means a backlog remains and the caller is
 * seeing a partial list. Search text for a file mid-churn (a streaming active
 * session) is extended from the appended byte range only — a search keystroke
 * never re-extracts a multi-MB JSONL because one line was appended to it.
 *
 * Like shares.js, the storage dir is resolved from os.homedir() per call so
 * tests' temp HOMEs work; state is kept per resolved dir.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  parseSessionEntries,
  sessionInfoFromEntries,
  extendSessionInfoFromEntries,
  buildSearchIndexFromEntries,
  extendSearchIndexFromEntries,
  buildIndexedUsageFromEntries,
  extendIndexedUsageFromEntries,
  SEARCH_TEXT_SESSION_CAP,
} = require('./session-files.js');
const { mineSkillsFromEntries } = require('./skill-mining.js');
const { encodeSessionKey } = require('./session-key.js');
const { pricingRevision } = require('./harness-pricing.js');

const SYNC_BUDGET_DEFAULT = 20;
const FLUSH_MS = 500;
const COMPACT_MIN_DEAD_BYTES = 1_000_000;
// v7 adds the harness-catalog revision to OMP pricing entries. Older entries
// need their source JSONL reread, so the normal bounded backlog rebuilds them
// like prior upgrades.
const META_SCHEMA_VERSION = 7;
// v2 indexed tool-call names/args (file paths, bash commands); v3 raises the
// per-message prose cap to 100K and the session cap to 4M with keep-newest
// overflow (corpus-measured: the old caps trimmed real pasted logs and the
// tails of long sessions). Older entries reread via the normal bounded backlog.
const TEXT_SCHEMA_VERSION = 3;
// Skill-activation records mined during the same parse pass, persisted to a
// third stream (skills.ndjson) under the same append/tombstone/compaction
// rules as meta/text. Version bumps re-mine on the normal bounded backlog.
const SKILLS_SCHEMA_VERSION = 1;

// The set of known skill directories (dir -> SKILL.md path), pushed in from
// the inventory scan so the miner can attribute a read of `references/foo.md`
// to its skill. Empty is fine — SKILL.md reads and explicit /skill: blocks are
// still detected without it (see lib/skill-mining.js). Deliberate limitation:
// a roots change does NOT re-mine already-indexed files (that would reparse
// the whole corpus every time a skill is added); bundled-file attribution in
// an old entry catches up when its session file next changes.
let skillCtx = { roots: new Map() };

function setSkillRoots(skillFilePaths) {
  const roots = new Map();
  for (const p of skillFilePaths || []) {
    if (typeof p === 'string' && p) roots.set(path.dirname(p), p);
  }
  skillCtx = { roots };
}

/** One append-only NDJSON file: load-latest-wins, buffered appends, compaction. */
class NdjsonLog {
  constructor(filePath) {
    this.filePath = filePath;
    this.buffer = [];
    this.flushTimer = null;
    this.liveBytes = 0;
    this.deadBytes = 0;
  }

  /**
   * Read the log into a Map(file -> entry). Unparseable lines (torn final
   * append after a crash) are counted dead and skipped — the scan re-indexes
   * whatever they held.
   */
  load() {
    const entries = new Map();
    let raw;
    try { raw = fs.readFileSync(this.filePath, 'utf-8'); } catch { return entries; }
    this.liveBytes = 0; this.deadBytes = 0;
    for (const line of raw.split('\n')) {
      if (!line) continue;
      let obj;
      try { obj = JSON.parse(line); } catch { this.deadBytes += line.length; continue; }
      if (!obj || typeof obj.f !== 'string') { this.deadBytes += line.length; continue; }
      const prev = entries.get(obj.f);
      if (prev) this.deadBytes += prev._bytes;
      if (obj.del) {
        entries.delete(obj.f);
        this.deadBytes += line.length;
      } else {
        obj._bytes = line.length;
        entries.set(obj.f, obj);
      }
    }
    for (const e of entries.values()) this.liveBytes += e._bytes;
    return entries;
  }

  append(obj) {
    const line = JSON.stringify(obj);
    this.buffer.push(line);
    this.liveBytes += line.length;
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), FLUSH_MS);
      this.flushTimer.unref?.();
    }
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
      console.error(`session-index: append to ${this.filePath} failed:`, e.message);
    }
  }

  /** Rewrite the log to only the given entries (temp-file + rename). */
  compact(entries, encode) {
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
      console.error(`session-index: compact of ${this.filePath} failed:`, e.message);
    }
  }

  markDead(bytes) {
    this.deadBytes += bytes;
    this.liveBytes = Math.max(0, this.liveBytes - bytes);
  }

  needsCompaction() {
    return this.deadBytes > COMPACT_MIN_DEAD_BYTES && this.deadBytes > this.liveBytes;
  }
}

// dir -> state; the dir comes from os.homedir() per call (tests swap HOME).
const states = new Map();

function getState() {
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
      backlog: new Map(), // file -> { candidate, stats } (pending background indexing)
      building: false,
    };
    for (const [f, e] of st.metaLog.load()) {
      const info = e.v || {};
      st.meta.set(f, {
        mtimeMs: e.m, size: e.s,
        info: { ...info, lastActivity: new Date(info.lastActivity || 0) },
        version: e.ver || 0,
        profileId: e.p || 'pi-v3', profileVersion: e.pv ?? 1,
        pricingRevision: e.pr || 'native',
        _bytes: e._bytes,
      });
    }
    for (const [f, e] of st.textLog.load()) {
      st.text.set(f, {
        mtimeMs: e.m,
        size: e.s,
        text: e.t || '',
        endsNl: !!e.nl,
        version: e.ver || 0,
        tree: !!e.tr,
        leafId: typeof e.l === 'string' ? e.l : null,
        _bytes: e._bytes,
      });
    }
    for (const [f, e] of st.skillsLog.load()) {
      st.skills.set(f, {
        mtimeMs: e.m,
        size: e.s,
        records: Array.isArray(e.r) ? e.r : [],
        state: e.st || null,
        version: e.ver || 0,
        _bytes: e._bytes,
      });
    }
    if (st.metaLog.needsCompaction()) compactMeta(st);
    if (st.textLog.needsCompaction()) compactText(st);
    if (st.skillsLog.needsCompaction()) compactSkills(st);
    states.set(dir, st);
  }
  return st;
}

const encodeMeta = (f, e) => ({ f, m: e.mtimeMs, s: e.size, ver: META_SCHEMA_VERSION, p: e.profileId, pv: e.profileVersion, pr: e.pricingRevision, v: e.info });
const encodeText = (f, e) => ({
  f, m: e.mtimeMs, s: e.size, ver: TEXT_SCHEMA_VERSION,
  nl: e.endsNl ? 1 : 0, tr: e.tree ? 1 : 0, l: e.leafId || undefined, t: e.text,
});
const encodeSkills = (f, e) => ({ f, m: e.mtimeMs, s: e.size, ver: SKILLS_SCHEMA_VERSION, st: e.state || undefined, r: e.records });

function compactMeta(st) { st.metaLog.compact(st.meta, encodeMeta); }
function compactText(st) { st.textLog.compact(st.text, encodeText); }
function compactSkills(st) { st.skillsLog.compact(st.skills, encodeSkills); }

/** Parse one file once and update both index tables + their logs. */
function normalize(input) {
  if (typeof input === 'string') {
    const nativeSessionId = path.basename(input, '.jsonl');
    return {
      file: input, harnessId: 'pi', nativeSessionId,
      sessionKey: encodeSessionKey('pi', nativeSessionId),
      profileId: 'pi-v3', profileVersion: 1, legacyPathInput: true,
    };
  }
  return input;
}

function indexFile(st, candidate, stats) {
  const file = candidate.file;
  const content = fs.readFileSync(file, 'utf-8');
  // One JSON pass feeds all four derivations (metadata, usage, search text,
  // skills) — this used to be four separate full parses of the same file,
  // which dominated the cost of re-indexing a large changed session.
  const entries = parseSessionEntries(content);
  const info = sessionInfoFromEntries(entries, stats.mtime, candidate);
  // Preserve scanSessions([path]) compatibility for generic nested Pi
  // session.jsonl files: before candidates existed, their header id was the
  // authoritative route/skill identity rather than the generic basename.
  const nativeSessionId = candidate.legacyPathInput && candidate.nativeSessionId === 'session' && info.sessionId
    ? info.sessionId : candidate.nativeSessionId;
  const sessionKey = nativeSessionId === candidate.nativeSessionId
    ? candidate.sessionKey : encodeSessionKey(candidate.harnessId, nativeSessionId);
  info.sessionKey = sessionKey;
  info.harnessId = candidate.harnessId;
  info.nativeSessionId = nativeSessionId;
  info.profileId = candidate.profileId;
  info.profileVersion = candidate.profileVersion;
  info.usage = buildIndexedUsageFromEntries(entries, candidate);
  const search = buildSearchIndexFromEntries(entries);
  setEntry(st.meta, st.metaLog, file,
    { mtimeMs: stats.mtimeMs, size: stats.size, version: META_SCHEMA_VERSION, profileId: candidate.profileId, profileVersion: candidate.profileVersion, pricingRevision: pricingRevision(candidate.harnessId), info }, encodeMeta);
  setEntry(st.text, st.textLog, file,
    {
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      version: TEXT_SCHEMA_VERSION,
      text: search.text,
      tree: search.tree,
      leafId: search.leafId,
      endsNl: content.endsWith('\n'),
    }, encodeText);
  const mined = mineSkillsFromEntries(entries, {
    // Generic nested session.jsonl children carry their authoritative identity
    // in the Pi header; traditional session files retain the basename identity.
    // Public Pi routes and existing persisted associations remain raw IDs;
    // alternate harnesses need the encoded tuple to avoid cross-corpus clashes.
    sessionId: candidate.harnessId === 'pi' ? nativeSessionId : sessionKey,
    skillCtx,
  });
  setEntry(st.skills, st.skillsLog, file,
    { mtimeMs: stats.mtimeMs, size: stats.size, version: SKILLS_SCHEMA_VERSION, records: mined.records, state: mined.state }, encodeSkills);
  return info;
}

/** The all-tables freshness test scanSessions and getSessionInfo share. */
function isEntryFresh(st, file, candidate, stats) {
  const cached = st.meta.get(file);
  const cachedText = st.text.get(file);
  const cachedSkills = st.skills.get(file);
  // The skills entry participates in staleness: an index populated by a
  // pre-skills build (or an older SKILLS_SCHEMA_VERSION) must re-mine its
  // files through the normal bounded backlog, or a machine with an existing
  // index would report zero skill usage for its whole historical corpus.
  return !!(cached && cached.version === META_SCHEMA_VERSION &&
    cached.profileId === candidate.profileId && cached.profileVersion === candidate.profileVersion &&
    cached.pricingRevision === pricingRevision(candidate.harnessId) &&
    cachedText && cachedText.version === TEXT_SCHEMA_VERSION &&
    cachedSkills && cachedSkills.version === SKILLS_SCHEMA_VERSION &&
    cached.mtimeMs === stats.mtimeMs && cached.size === stats.size &&
    cachedText.mtimeMs === stats.mtimeMs && cachedText.size === stats.size &&
    cachedSkills.mtimeMs === stats.mtimeMs && cachedSkills.size === stats.size);
}

/**
 * O(delta) refresh for a session file that only grew — the streaming active
 * session, re-stated by every sidebar poll and usage request, whose full
 * re-index used to cost a whole-file parse (plus a full-text log append)
 * every ten seconds. When the appended byte range is a plain chain from the
 * indexed leaf, all three tables are extended in memory and the refreshed
 * info is returned; anything else (tree jump, shrink/rewrite, schema or
 * pricing mismatch, missing continuity state) returns null so the caller
 * falls back to a full re-index. Extensions are deliberately not logged —
 * hot files churn far too fast to persist per delta; a restart re-parses
 * them once (the same contract getSearchText has always had).
 */
function tryExtendIndexEntry(st, candidate, stats) {
  const file = candidate.file;
  const meta = st.meta.get(file), text = st.text.get(file), skills = st.skills.get(file);
  if (!meta || !text || !skills) return null;
  if (meta.version !== META_SCHEMA_VERSION || text.version !== TEXT_SCHEMA_VERSION ||
      skills.version !== SKILLS_SCHEMA_VERSION) return null;
  if (meta.profileId !== candidate.profileId || meta.profileVersion !== candidate.profileVersion) return null;
  if (meta.pricingRevision !== pricingRevision(candidate.harnessId)) return null;
  // The three tables are written together; extend only from a coherent base.
  if (meta.mtimeMs !== text.mtimeMs || meta.size !== text.size ||
      meta.mtimeMs !== skills.mtimeMs || meta.size !== skills.size) return null;
  if (!(stats.size > meta.size) || !text.endsNl) return null;
  // Continuity state (running provider/model/cwd) is required to accumulate
  // a delta; entries persisted before it existed re-index fully once.
  if (!meta.info?.usage?.state || !skills.state) return null;
  let delta, entries, extension;
  try {
    delta = readByteRange(file, meta.size, stats.size);
    entries = parseSessionEntries(delta);
    extension = extendSearchIndexFromEntries(entries, text.tree, text.leafId);
  } catch { return null; }
  if (!extension) return null;
  try {
    extendSessionInfoFromEntries(meta.info, entries, stats.mtime, candidate);
    extendIndexedUsageFromEntries(meta.info.usage, entries, candidate);
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
  // The extend path must honor the same total-text bound as a full build, or
  // a long-running streaming session would grow past it one delta at a time.
  // Like the build, overflow evicts the *oldest* text — the delta being
  // appended is the newest turn, exactly what recall wants kept.
  if (extension.text) {
    const next = text.text ? text.text + ' ' + extension.text : extension.text;
    text.text = next.length > SEARCH_TEXT_SESSION_CAP
      ? next.slice(next.length - SEARCH_TEXT_SESSION_CAP) : next;
  }
  text.endsNl = delta.endsWith('\n');
  text.tree = extension.tree;
  text.leafId = extension.leafId;
  for (const entry of [meta, text, skills]) {
    entry.mtimeMs = stats.mtimeMs;
    entry.size = stats.size;
  }
  return meta.info;
}

function setEntry(map, log, file, entry, encode) {
  const prev = map.get(file);
  if (prev) log.markDead(prev._bytes || 0);
  entry._bytes = JSON.stringify(encode(file, entry)).length;
  map.set(file, entry);
  log.append(encode(file, entry));
  if (log.needsCompaction()) log.compact(map, encode);
}

function dropEntry(st, file) {
  for (const [map, log] of [[st.meta, st.metaLog], [st.text, st.textLog], [st.skills, st.skillsLog]]) {
    const prev = map.get(file);
    if (!prev) continue;
    map.delete(file);
    log.markDead(prev._bytes || 0);
    log.append({ f: file, del: 1 });
  }
  st.backlog.delete(file);
}

function syncBudget() {
  const n = parseInt(process.env.PI_DISH_INDEX_SYNC_BUDGET, 10);
  return Number.isFinite(n) ? n : SYNC_BUDGET_DEFAULT;
}

/** Drain the backlog one file per tick so requests interleave freely. */
function kickBuilder(st) {
  if (st.building || !st.backlog.size) return;
  st.building = true;
  const step = () => {
    const next = st.backlog.entries().next();
    if (next.done) { st.building = false; return; }
    const [file, work] = next.value;
    st.backlog.delete(file);
    try { indexFile(st, work.candidate, work.stats); } catch {} // vanished/unreadable: skip
    setImmediate(step);
  };
  setImmediate(step);
}

/**
 * The scan behind the historical session list. `files` is the full
 * enumeration of session JSONLs to serve; returns
 * `{ infos: Map(file -> info), indexing }` where a file missing from `infos`
 * is still queued for background indexing (indexing === true exactly when
 * that backlog is non-empty). Index entries for files no longer in `files`
 * and gone from disk are tombstoned.
 */
function scanSessions(files) {
  const st = getState();
  const infos = new Map();
  const seen = new Set();
  let budget = syncBudget();

  for (const input of files) {
    const candidate = normalize(input);
    const file = candidate.file;
    seen.add(file);
    let stats;
    try { stats = fs.statSync(file); } catch { dropEntry(st, file); continue; }
    if (isEntryFresh(st, file, candidate, stats)) {
      st.backlog.delete(file); // a stale queue entry for a file we just served
      infos.set(file, st.meta.get(file).info);
      continue;
    }
    // A file that merely grew (the streaming active session) extends in
    // O(delta) instead of consuming sync budget on a whole-file re-parse.
    const extended = tryExtendIndexEntry(st, candidate, stats);
    if (extended) {
      st.backlog.delete(file);
      infos.set(file, extended);
      continue;
    }
    if (budget > 0) {
      budget--;
      try { infos.set(file, indexFile(st, candidate, stats)); } catch {}
    } else {
      st.backlog.set(file, { candidate, stats });
    }
  }

  // Sessions deleted on disk: drop their index entries. (Absent-from-`files`
  // but still existing is fine — e.g. an active session the caller excluded.)
  for (const file of [...st.meta.keys()]) {
    if (!seen.has(file) && !fs.existsSync(file)) dropEntry(st, file);
  }

  kickBuilder(st);
  return { infos, indexing: st.backlog.size > 0 };
}

/**
 * Search text for one session file. Fresh from the index when possible. A
 * file that only *grew* (a streaming session appends a line every delta) is
 * extended by extracting just the appended byte range — a search keystroke
 * against an active session must not re-read its whole multi-MB JSONL. The
 * extension stays in memory only (not logged): active files churn far too
 * fast to persist per delta, and a restart simply re-parses them once.
 * Anything else (shrunk, rewritten, never seen) is fully re-indexed.
 * '' when the file is unreadable.
 */
function getSearchText(input) {
  const candidate = normalize(input);
  const file = candidate.file;
  const st = getState();
  const cached = st.text.get(file);
  let stats;
  try { stats = fs.statSync(file); } catch { return ''; }
  if (cached && cached.version === TEXT_SCHEMA_VERSION &&
      cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    return cached.text;
  }
  // The shared O(delta) extension keeps all three tables coherent — a
  // text-only extension here used to leave meta/skills behind, which would
  // now force the scan's extension path into a full re-index.
  if (tryExtendIndexEntry(st, candidate, stats)) return st.text.get(file).text;
  try { indexFile(st, candidate, stats); } catch { return cached ? cached.text : ''; }
  return st.text.get(file).text;
}

/**
 * Index-backed single-file session info, returning exactly the shape
 * session-files' getSessionInfo returns. Serves fresh entries from memory,
 * extends append-only growth in O(delta), and fully (re-)indexes anything
 * else — so the per-poll metadata reads for an active session stop
 * re-parsing its whole streaming JSONL on every append. Throws when the
 * file is unreadable, like session-files.getSessionInfo.
 */
function getSessionInfo(input) {
  const candidate = normalize(input);
  const st = getState();
  const stats = fs.statSync(candidate.file);
  let info;
  if (isEntryFresh(st, candidate.file, candidate, stats)) {
    info = st.meta.get(candidate.file).info;
  } else {
    info = tryExtendIndexEntry(st, candidate, stats) || indexFile(st, candidate, stats);
  }
  st.backlog.delete(candidate.file); // just indexed/served; a queued rebuild is stale
  // Strip index-internal fields (identity resolution, usage with its
  // continuity state) so callers see the plain session-files info shape and
  // API responses that spread info cannot leak them.
  const { usage, sessionKey, harnessId, nativeSessionId, profileId, profileVersion, ...pub } = info;
  return pub;
}

function readByteRange(file, start, end) {
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
 * All mined skill-activation records across every indexed session, flattened
 * and filtered. Reads only the in-memory index (loaded from skills.ndjson) —
 * never re-parses the JSONL corpus. `filter` accepts:
 *   { skill, sinceMs, cwd, kind } — skill is the absolute SKILL.md path.
 * Records for files not yet indexed (backlog) are simply absent; callers that
 * care report the index's `indexing` flag from scanSessions.
 */
function getSkillActivations(filter = {}) {
  const st = getState();
  const { skill, sinceMs, cwd, kind } = filter;
  const out = [];
  for (const entry of st.skills.values()) {
    for (const r of entry.records || []) {
      if (skill && r.skill !== skill) continue;
      if (kind && r.kind !== kind) continue;
      if (cwd && r.cwd !== cwd) continue;
      if (sinceMs != null && !(Number.isFinite(r.ts) && r.ts >= sinceMs)) continue;
      out.push(r);
    }
  }
  return out;
}

/** Test hook: flush pending appends and forget in-memory state. */
function resetForTests() {
  for (const st of states.values()) { st.metaLog.flush(); st.textLog.flush(); st.skillsLog.flush(); }
  states.clear();
}

module.exports = { scanSessions, getSearchText, getSessionInfo, getSkillActivations, setSkillRoots, resetForTests };
