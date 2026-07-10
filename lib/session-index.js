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
const { parseSessionContent, buildSearchTextFromContent } = require('./session-files.js');

const SYNC_BUDGET_DEFAULT = 20;
const FLUSH_MS = 500;
const COMPACT_MIN_DEAD_BYTES = 1_000_000;

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
      meta: new Map(), // file -> { mtimeMs, size, info }
      text: new Map(), // file -> { mtimeMs, size, text, indexedAt }
      backlog: new Map(), // file -> fs.Stats (pending background indexing)
      building: false,
    };
    for (const [f, e] of st.metaLog.load()) {
      const info = e.v || {};
      st.meta.set(f, {
        mtimeMs: e.m, size: e.s,
        info: { ...info, lastActivity: new Date(info.lastActivity || 0) },
        _bytes: e._bytes,
      });
    }
    for (const [f, e] of st.textLog.load()) {
      st.text.set(f, { mtimeMs: e.m, size: e.s, text: e.t || '', endsNl: !!e.nl, _bytes: e._bytes });
    }
    if (st.metaLog.needsCompaction()) compactMeta(st);
    if (st.textLog.needsCompaction()) compactText(st);
    states.set(dir, st);
  }
  return st;
}

const encodeMeta = (f, e) => ({ f, m: e.mtimeMs, s: e.size, v: e.info });
const encodeText = (f, e) => ({ f, m: e.mtimeMs, s: e.size, nl: e.endsNl ? 1 : 0, t: e.text });

function compactMeta(st) { st.metaLog.compact(st.meta, encodeMeta); }
function compactText(st) { st.textLog.compact(st.text, encodeText); }

/** Parse one file once and update both index tables + their logs. */
function indexFile(st, file, stats) {
  const content = fs.readFileSync(file, 'utf-8');
  const info = parseSessionContent(content, stats.mtime);
  const text = buildSearchTextFromContent(content);
  setEntry(st.meta, st.metaLog, file,
    { mtimeMs: stats.mtimeMs, size: stats.size, info }, encodeMeta);
  setEntry(st.text, st.textLog, file,
    { mtimeMs: stats.mtimeMs, size: stats.size, text, endsNl: content.endsWith('\n') }, encodeText);
  return info;
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
  for (const [map, log] of [[st.meta, st.metaLog], [st.text, st.textLog]]) {
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
    const [file, stats] = next.value;
    st.backlog.delete(file);
    try { indexFile(st, file, stats); } catch {} // vanished/unreadable: skip
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

  for (const file of files) {
    seen.add(file);
    let stats;
    try { stats = fs.statSync(file); } catch { dropEntry(st, file); continue; }
    const cached = st.meta.get(file);
    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      st.backlog.delete(file); // a stale queue entry for a file we just served
      infos.set(file, cached.info);
      continue;
    }
    if (budget > 0) {
      budget--;
      try { infos.set(file, indexFile(st, file, stats)); } catch {}
    } else {
      st.backlog.set(file, stats);
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
function getSearchText(file) {
  const st = getState();
  const cached = st.text.get(file);
  let stats;
  try { stats = fs.statSync(file); } catch { return ''; }
  if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
    return cached.text;
  }
  if (cached && cached.endsNl && stats.size > cached.size) {
    try {
      const delta = readByteRange(file, cached.size, stats.size);
      const extra = buildSearchTextFromContent(delta);
      cached.text += (extra ? ' ' + extra : '');
      cached.mtimeMs = stats.mtimeMs;
      cached.size = stats.size;
      cached.endsNl = delta.endsWith('\n');
      return cached.text;
    } catch {} // fall through to a full re-index
  }
  try { indexFile(st, file, stats); } catch { return cached ? cached.text : ''; }
  return st.text.get(file).text;
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

/** Test hook: flush pending appends and forget in-memory state. */
function resetForTests() {
  for (const st of states.values()) { st.metaLog.flush(); st.textLog.flush(); }
  states.clear();
}

module.exports = { scanSessions, getSearchText, resetForTests };
