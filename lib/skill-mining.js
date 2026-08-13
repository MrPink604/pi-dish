/**
 * Mine skill-activation records from a session JSONL's parsed content. Pure
 * and side-effect-free so it can be unit-tested and called from inside the
 * session-index parse pass (never a separate corpus walk).
 *
 * A record is the primitive the Skills view is built on:
 *
 *   { skill, file, kind, ranges, truncatedTo?, ts, sessionId, entryId, cwd, model }
 *
 * - `skill`   absolute SKILL.md path (stable identity, matches pi's `location`)
 * - `file`    which file under the skill dir was touched (relative; 'SKILL.md'
 *             for the skill file itself)
 * - `kind`    'read' | 'targeted' | 'explicit'
 * - `ranges`  line ranges [[start,end], …] for ranged reads; the string 'all'
 *             for a full-content read; null for a grep-style touch (no fake
 *             line data, ever). An open-ended read (offset, no limit) stores
 *             end === -1 (to EOF).
 * - `truncatedTo` last line the tool actually returned, parsed from the read
 *             result's truncation notice, when the read was un-ranged but the
 *             file was truncated.
 *
 * Detection rules (per the Skills view Phase 1 contract):
 * - read: a `read` tool call whose resolved path is SKILL.md under a known
 *   skill root, or any file under a skill directory.
 * - targeted: a `bash` tool call whose command references a skill-path token
 *   (same bash-path mining as lib/file-mention.js). cat/sed -n ranges are
 *   parsed when trivial; grep-style access records no ranges.
 * - explicit: a user message matching pi's own skill-block format
 *   `<skill name="…" location="…">…</skill>` — a full-body read.
 */
const path = require('path');
const os = require('os');
const { extractTextContent } = require('../public/helpers.js');

// Absolute or ~-rooted tokens inside bash command strings (mirrors
// lib/file-mention.js's COMMAND_PATH_RE — the same bash-path mining).
const COMMAND_PATH_RE = /(?:^|[\s'"`=(<>])((?:\/|~\/)[\w.@%+-]+(?:\/[\w.@%+-]+)*)/g;

/**
 * Match pi's own skill-block format (AgentSession.parseSkillBlock). Kept in
 * sync with that regex deliberately — explicit invocations must be detected
 * via pi's format, not a heuristic. Returns { name, location } or null.
 */
function parseSkillBlockText(text) {
  if (typeof text !== 'string') return null;
  const match = text.match(/^<skill name="([^"]+)" location="([^"]+)">\n[\s\S]*?\n<\/skill>(?:\n\n[\s\S]+)?$/);
  if (!match) return null;
  return { name: match[1], location: match[2] };
}

/**
 * Last line a truncated `read` result actually returned, parsed from the
 * notice embedded in the tool result text. Two shapes are handled: pi's live
 * JSONL form `[Showing lines X-Y of Z…]` and the documented
 * `[Truncated: showing N of M lines…]` form. Returns a number or null.
 */
function parseTruncationNotice(text) {
  if (typeof text !== 'string') return null;
  let m = text.match(/\[Showing lines \d+-(\d+) of \d+/);
  if (m) return Number(m[1]);
  m = text.match(/\[Truncated: showing (\d+) of \d+ lines/);
  if (m) return Number(m[1]);
  m = text.match(/\[Truncated: (\d+) lines shown/);
  if (m) return Number(m[1]);
  return null;
}

/**
 * Trivially-parseable line ranges for a targeted (bash) access to `token`.
 * `sed -n '10,50p' file` → [[10,50]]; `head -n 40` / `cat` → 'all'; a
 * grep-style access → null (a touch, never fabricated line data).
 */
function parseTargetedRanges(command, token) {
  if (typeof command !== 'string') return null;
  // Only look at the segment of the pipeline that names the token.
  const idx = command.indexOf(token);
  const seg = idx >= 0 ? command.slice(Math.max(0, idx - 60), idx + token.length + 4) : command;
  const before = idx >= 0 ? command.slice(0, idx) : command;
  if (/\b(grep|rg|ag|ack|awk|find|ls|wc|stat|file|xxd|hexdump)\b/.test(before)) return null;
  // sed -n '10,50p'
  let m = command.match(/sed\s+-n\s+['"]?(\d+),(\d+)p/);
  if (m) return [[Number(m[1]), Number(m[2])]];
  // sed -n '10p'
  m = command.match(/sed\s+-n\s+['"]?(\d+)p/);
  if (m) return [[Number(m[1]), Number(m[1])]];
  // head -n 40  (from the top)
  m = command.match(/head\s+(?:-n\s*)?-?(\d+)/);
  if (m && /\b(head|cat)\b/.test(before + seg)) return [[1, Number(m[1])]];
  if (/\bcat\b/.test(before)) return 'all';
  return null; // an unrecognized read of the file — a touch without line data
}

/** Resolve a tool-arg / command path against cwd + home. */
function makeResolver(cwd, home) {
  return (p) => {
    if (typeof p !== 'string' || !p) return null;
    if (p.startsWith('~/')) p = path.join(home, p.slice(2));
    else if (p === '~') p = home;
    if (!path.isAbsolute(p)) {
      if (!cwd) return null;
      p = path.resolve(cwd, p);
    }
    return path.normalize(p);
  };
}

/**
 * Given a resolved absolute path, decide whether it is a skill file and which
 * skill it belongs to. `ctx.roots` maps a skill directory → its SKILL.md path.
 * Any basename SKILL.md always counts (per the contract), even without a root.
 * Returns { skill, file } or null.
 */
function classifySkillPath(absPath, ctx) {
  if (!absPath) return null;
  const base = path.basename(absPath);
  if (base === 'SKILL.md') return { skill: absPath, file: 'SKILL.md' };
  const roots = ctx && ctx.roots;
  if (roots) {
    for (const [dir, skillMd] of roots) {
      if (absPath === dir) continue;
      if (absPath.startsWith(dir + path.sep)) {
        return { skill: skillMd, file: absPath.slice(dir.length + 1) };
      }
    }
  }
  return null;
}

/** Read the toolCall blocks out of an assistant message entry. */
function toolCallsOf(entry) {
  const m = entry && entry.type === 'message' && entry.message;
  if (!m || m.role !== 'assistant' || !Array.isArray(m.content)) return [];
  return m.content.filter((b) => b && b.type === 'toolCall');
}

function entryTs(entry) {
  const raw = entry.timestamp || entry.message?.timestamp;
  const t = typeof raw === 'number' ? raw : Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

/**
 * Mine every skill-activation record from one session's JSONL content.
 * `opts.skillCtx.roots` is a Map(skillDir → SKILL.md path) from the inventory;
 * when empty, SKILL.md reads and explicit blocks are still detected.
 */
function mineSkillsFromContent(content, opts = {}) {
  const entries = [];
  for (const line of String(content || '').split('\n')) {
    if (!line.trim()) continue;
    try { entries.push(JSON.parse(line)); } catch { /* torn/partial line */ }
  }
  return mineSkillsFromEntries(entries, opts).records;
}

/**
 * Entry-based form so the session-index parse pass can feed one parsed-entry
 * array to every derivation, and so an appended byte range can be mined
 * incrementally: `initialState` is the `{ cwd, provider, model }` continuity
 * returned by the previous call over the earlier part of the same file.
 * Returns `{ records, state }`. Known incremental-fidelity limit: a read
 * toolCall and its toolResult can straddle two appended batches, in which
 * case the un-ranged-read truncation recovery (pass 1) misses — the record
 * still lands, minus its recovered end line, until the next full re-index.
 */
function mineSkillsFromEntries(entries, opts = {}) {
  const { sessionId = null, skillCtx = null, home = os.homedir(), initialState = null } = opts;

  // Pass 1: index read-tool results by their toolCallId so an un-ranged read
  // can recover its truncation end line.
  const resultText = new Map();
  for (const e of entries) {
    if (e.type === 'message' && e.message?.role === 'toolResult' && e.message.toolCallId) {
      resultText.set(e.message.toolCallId, extractTextContent(e.message.content));
    }
  }

  const records = [];
  let cwd = initialState?.cwd ?? null;
  let provider = initialState?.provider ?? null;
  let model = initialState?.model ?? 'unknown';
  for (const entry of entries) {
    if (entry.type === 'session' && entry.cwd) cwd = entry.cwd;
    if (entry.type === 'model_change') { provider = entry.provider || provider; model = entry.modelId || model; }
    const msg = entry.type === 'message' ? entry.message : null;
    if (msg?.role === 'assistant') {
      if (msg.provider) provider = msg.provider;
      if (msg.model) model = msg.model;
    }
    const resolve = makeResolver(cwd, home);
    const modelRef = provider ? `${provider}/${model}` : model;
    const ts = entryTs(entry);

    // explicit /skill: invocation (user message expanded to a skill block)
    if (msg?.role === 'user') {
      const parsed = parseSkillBlockText(extractTextContent(msg.content));
      if (parsed) {
        records.push({
          skill: parsed.location, file: 'SKILL.md', kind: 'explicit',
          ranges: 'all', ts, sessionId, entryId: entry.id || null, cwd, model: modelRef,
        });
      }
      continue;
    }

    if (msg?.role !== 'assistant') continue;
    const seenTargeted = new Set(); // one targeted record per skill per message
    for (const call of toolCallsOf(entry)) {
      const args = call.arguments || {};
      if (call.name === 'read') {
        const abs = resolve(args.path || args.file_path);
        const cls = classifySkillPath(abs, skillCtx);
        if (!cls) continue;
        const offset = Number.isFinite(args.offset) ? args.offset : null;
        const limit = Number.isFinite(args.limit) ? args.limit : null;
        const rec = { ...cls, kind: 'read', ts, sessionId, entryId: entry.id || null, cwd, model: modelRef };
        if (offset != null && limit != null) {
          rec.ranges = [[offset, offset + limit - 1]];
        } else if (offset != null) {
          const end = parseTruncationNotice(resultText.get(call.id));
          rec.ranges = [[offset, end != null ? end : -1]];
        } else {
          rec.ranges = 'all';
          const end = parseTruncationNotice(resultText.get(call.id));
          if (end != null) rec.truncatedTo = end;
        }
        records.push(rec);
      } else if (call.name === 'bash' && typeof args.command === 'string') {
        for (const m of args.command.matchAll(COMMAND_PATH_RE)) {
          const abs = resolve(m[1]);
          const cls = classifySkillPath(abs, skillCtx);
          if (!cls) continue;
          if (seenTargeted.has(cls.skill + '\0' + cls.file)) continue;
          seenTargeted.add(cls.skill + '\0' + cls.file);
          records.push({
            ...cls, kind: 'targeted',
            ranges: parseTargetedRanges(args.command, m[1]),
            ts, sessionId, entryId: entry.id || null, cwd, model: modelRef,
          });
        }
      }
    }
  }
  return { records, state: { cwd, provider, model } };
}

module.exports = {
  parseSkillBlockText,
  parseTruncationNotice,
  parseTargetedRanges,
  classifySkillPath,
  mineSkillsFromContent,
  mineSkillsFromEntries,
};
