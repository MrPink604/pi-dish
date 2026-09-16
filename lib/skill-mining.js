// Generated from src/core/skill-mining.ts; edit that source and run npm run build:core.
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseSkillBlockText = parseSkillBlockText;
exports.parseTruncationNotice = parseTruncationNotice;
exports.parseTargetedRanges = parseTargetedRanges;
exports.classifySkillPath = classifySkillPath;
exports.mineSkillsFromContent = mineSkillsFromContent;
exports.mineSkillsFromEntries = mineSkillsFromEntries;
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
const path = __importStar(require("node:path"));
const os = __importStar(require("node:os"));
const helper_content_1 = require("./helper-content");
const helper_values_1 = require("./helper-values");
// Absolute or ~-rooted tokens inside bash command strings (mirrors
// lib/file-mention.js's COMMAND_PATH_RE — the same bash-path mining).
const COMMAND_PATH_RE = /(?:^|[\s'"`=(<>])((?:\/|~\/)[\w.@%+-]+(?:\/[\w.@%+-]+)*)/g;
/**
 * Match pi's own skill-block format (AgentSession.parseSkillBlock). Kept in
 * sync with that regex deliberately — explicit invocations must be detected
 * via pi's format, not a heuristic. Returns { name, location } or null.
 */
function parseSkillBlockText(text) {
    if (typeof text !== 'string')
        return null;
    const match = text.match(/^<skill name="([^"]+)" location="([^"]+)">\n[\s\S]*?\n<\/skill>(?:\n\n[\s\S]+)?$/);
    if (!match)
        return null;
    return { name: match[1], location: match[2] };
}
/**
 * Last line a truncated `read` result actually returned, parsed from the
 * tool's text notice rather than guessed from the requested range.
 */
function parseTruncationNotice(text) {
    if (typeof text !== 'string')
        return null;
    let m = text.match(/\[Showing lines \d+-(\d+) of \d+/);
    if (m)
        return Number(m[1]);
    m = text.match(/\[Truncated: showing (\d+) of \d+ lines/);
    if (m)
        return Number(m[1]);
    m = text.match(/\[Truncated: (\d+) lines shown/);
    if (m)
        return Number(m[1]);
    return null;
}
/**
 * Trivially-parseable line ranges for a targeted (bash) access to `token`.
 * `sed -n '10,50p' file` → [[10,50]]; a grep-style access → null (a touch,
 * never fabricated line data).
 */
function parseTargetedRanges(command, token) {
    if (typeof command !== 'string')
        return null;
    // Only look at the segment of the pipeline that names the token.
    const idx = command.indexOf(token);
    const seg = idx >= 0 ? command.slice(Math.max(0, idx - 60), idx + token.length + 4) : command;
    const before = idx >= 0 ? command.slice(0, idx) : command;
    if (/\b(grep|rg|ag|ack|awk|find|ls|wc|stat|file|xxd|hexdump)\b/.test(before))
        return null;
    // sed -n '10,50p'
    let m = command.match(/sed\s+-n\s+['"]?(\d+),(\d+)p/);
    if (m)
        return [[Number(m[1]), Number(m[2])]];
    // sed -n '10p'
    m = command.match(/sed\s+-n\s+['"]?(\d+)p/);
    if (m)
        return [[Number(m[1]), Number(m[1])]];
    // head -n 40  (from the top)
    m = command.match(/head\s+(?:-n\s*)?-?(\d+)/);
    if (m && /\b(head|cat)\b/.test(before + seg))
        return [[1, Number(m[1])]];
    if (/\bcat\b/.test(before))
        return 'all';
    return null; // an unrecognized read of the file — a touch without line data
}
/** Resolve a tool-arg / command path against cwd + home. */
function makeResolver(cwd, home) {
    return (value) => {
        if (typeof value !== 'string' || !value)
            return null;
        let p = value;
        if (p.startsWith('~/'))
            p = path.join(home, p.slice(2));
        else if (p === '~')
            p = home;
        if (!path.isAbsolute(p)) {
            if (!cwd)
                return null;
            p = path.resolve(cwd, p);
        }
        return path.normalize(p);
    };
}
/** Classify SKILL.md itself, or a file beneath an inventory skill directory. */
function classifySkillPath(absPath, ctx) {
    if (!absPath)
        return null;
    const base = path.basename(absPath);
    if (base === 'SKILL.md')
        return { skill: absPath, file: 'SKILL.md' };
    const roots = ctx && ctx.roots;
    if (roots) {
        for (const [dir, skillMd] of roots) {
            if (absPath === dir)
                continue;
            if (absPath.startsWith(dir + path.sep)) {
                return { skill: skillMd, file: absPath.slice(dir.length + 1) };
            }
        }
    }
    return null;
}
/** Read the toolCall blocks out of an assistant message entry. */
function toolCallsOf(entry) {
    const m = entry.type === 'message' ? entry.message : undefined;
    if (!(0, helper_values_1.record)(m) || m.role !== 'assistant' || !Array.isArray(m.content))
        return [];
    return m.content.filter((b) => (0, helper_values_1.record)(b) && b.type === 'toolCall');
}
function entryTs(entry) {
    const raw = entry.timestamp || ((0, helper_values_1.record)(entry.message) ? entry.message.timestamp : undefined);
    const t = typeof raw === 'number' ? raw : Date.parse(String(raw));
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
        if (!line.trim())
            continue;
        try {
            entries.push(JSON.parse(line));
        }
        catch { /* torn/partial line */ }
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
        // Preserve the existing failure for null entries; malformed JSON lines are
        // ignored by the content parser, not normalized into synthetic entries.
        if (e == null)
            throw new TypeError('Cannot read properties of null or undefined');
        if (!(0, helper_values_1.record)(e))
            continue;
        const message = e.message;
        if (e.type === 'message' && (0, helper_values_1.record)(message) && message.role === 'toolResult' && message.toolCallId) {
            resultText.set(message.toolCallId, (0, helper_content_1.extractTextContent)(message.content));
        }
    }
    const records = [];
    let cwd = initialState?.cwd ?? null;
    let provider = initialState?.provider ?? null;
    let model = initialState?.model ?? 'unknown';
    for (const entry of entries) {
        if (!(0, helper_values_1.record)(entry))
            continue;
        if (entry.type === 'session' && typeof entry.cwd === 'string' && entry.cwd)
            cwd = entry.cwd;
        if (entry.type === 'model_change') {
            if (typeof entry.provider === 'string' && entry.provider)
                provider = entry.provider;
            if (typeof entry.modelId === 'string' && entry.modelId)
                model = entry.modelId;
        }
        const msg = entry.type === 'message' && (0, helper_values_1.record)(entry.message) ? entry.message : null;
        if (msg?.role === 'assistant') {
            if (typeof msg.provider === 'string' && msg.provider)
                provider = msg.provider;
            if (typeof msg.model === 'string' && msg.model)
                model = msg.model;
        }
        const resolve = makeResolver(cwd, home);
        const modelRef = provider ? `${provider}/${model}` : model;
        const ts = entryTs(entry);
        // explicit /skill: invocation (user message expanded to a skill block)
        if (msg?.role === 'user') {
            const parsed = parseSkillBlockText((0, helper_content_1.extractTextContent)(msg.content));
            if (parsed) {
                records.push({
                    skill: parsed.location, file: 'SKILL.md', kind: 'explicit',
                    ranges: 'all', ts, sessionId, entryId: typeof entry.id === 'string' && entry.id ? entry.id : null, cwd, model: modelRef,
                });
            }
            continue;
        }
        if (msg?.role !== 'assistant')
            continue;
        const seenTargeted = new Set(); // one targeted record per skill per message
        for (const call of toolCallsOf(entry)) {
            const args = (0, helper_values_1.record)(call.arguments) ? call.arguments : {};
            if (call.name === 'read') {
                const abs = resolve(args.path || args.file_path);
                const cls = classifySkillPath(abs, skillCtx);
                if (!cls)
                    continue;
                const offset = (0, helper_values_1.finite)(args.offset) ? args.offset : null;
                const limit = (0, helper_values_1.finite)(args.limit) ? args.limit : null;
                const rec = { ...cls, kind: 'read', ts, sessionId, entryId: typeof entry.id === 'string' && entry.id ? entry.id : null, cwd, model: modelRef, ranges: 'all' };
                if (offset != null && limit != null) {
                    rec.ranges = [[offset, offset + limit - 1]];
                }
                else if (offset != null) {
                    const end = parseTruncationNotice(resultText.get(call.id));
                    rec.ranges = [[offset, end != null ? end : -1]];
                }
                else {
                    rec.ranges = 'all';
                    const end = parseTruncationNotice(resultText.get(call.id));
                    if (end != null)
                        rec.truncatedTo = end;
                }
                records.push(rec);
            }
            else if (call.name === 'bash' && typeof args.command === 'string') {
                for (const m of args.command.matchAll(COMMAND_PATH_RE)) {
                    const abs = resolve(m[1]);
                    const cls = classifySkillPath(abs, skillCtx);
                    if (!cls)
                        continue;
                    if (seenTargeted.has(cls.skill + '\0' + cls.file))
                        continue;
                    seenTargeted.add(cls.skill + '\0' + cls.file);
                    records.push({
                        ...cls, kind: 'targeted',
                        ranges: parseTargetedRanges(args.command, m[1]),
                        ts, sessionId, entryId: typeof entry.id === 'string' && entry.id ? entry.id : null, cwd, model: modelRef,
                    });
                }
            }
        }
    }
    return { records, state: { cwd, provider, model } };
}
