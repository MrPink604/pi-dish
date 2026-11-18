// Generated from src/core/acp-transcript.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AcpTranscript = exports.AGY_PROVIDER = void 0;
exports.acpUsage = acpUsage;
exports.extractAcpPlanTier = extractAcpPlanTier;
exports.normalizeAgyUsageReports = normalizeAgyUsageReports;
exports.acpStopReason = acpStopReason;
exports.normalizeAcpTool = normalizeAcpTool;
exports.acpToolResult = acpToolResult;
exports.planWidgetRequest = planWidgetRequest;
exports.askFromElicitation = askFromElicitation;
exports.askElicitationResult = askElicitationResult;
exports.permissionDialog = permissionDialog;
exports.permissionResult = permissionResult;
exports.readAcpMirrorLastTimestamp = readAcpMirrorLastTimestamp;
exports.backupAcpMirror = backupAcpMirror;
exports.restoreAcpMirror = restoreAcpMirror;
exports.readAcpMirrorHeader = readAcpMirrorHeader;
/**
 * Antigravity (`agy` ACP) → Pi JSONL translation and the mirror writer.
 *
 * The ACP stream is chunks and tool calls, not messages; `AcpSession` segments
 * it into Pi messages and hands the finished records here. Every entry is
 * appended synchronously so a reader that reacts to the emitted `message_end`
 * already sees the transcript. The live stream is the primary source;
 * `session/load` replay is used only to import conversations that started
 * outside pi-dish (the mirror header then records the lossy import).
 *
 * Beside the mirror (`.jsonl`) the raw frames of both directions are kept in a
 * `.acp.jsonl` sidecar as `{t, dir, msg}`, the same shape as the captures in
 * `docs/agy-acp-capture/`. No reader consumes the sidecar; it exists so the
 * mirror can be rebuilt if the translation changes.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const wire_protocol_1 = require("./wire-protocol");
const helper_values_1 = require("./helper-values");
/** Model provider string for every agy session (also a zero-rate plan provider). */
exports.AGY_PROVIDER = 'google-antigravity';
function nonempty(value) { return typeof value === 'string' && value.length > 0; }
/** ACP `PromptResponse.usage` → Pi's usage counters. */
function acpUsage(value) {
    if (!(0, helper_values_1.record)(value))
        return null;
    const mapping = [
        ['inputTokens', 'input'],
        ['outputTokens', 'output'],
        ['cachedReadTokens', 'cacheRead'],
        ['cachedWriteTokens', 'cacheWrite'],
        ['thoughtTokens', 'reasoning'],
        ['totalTokens', 'totalTokens'],
    ];
    const usage = {};
    for (const [from, to] of mapping) {
        const amount = value[from];
        if ((0, helper_values_1.finite)(amount))
            usage[to] = amount;
    }
    return Object.keys(usage).length ? usage : null;
}
/** `_meta.antigravity.tier.name` from `session/new` or `session/resume`. */
function extractAcpPlanTier(result) {
    if (!(0, helper_values_1.record)(result))
        return null;
    const meta = (0, helper_values_1.record)(result._meta) ? result._meta : {};
    const agy = (0, helper_values_1.record)(meta.antigravity) ? meta.antigravity : {};
    const tier = (0, helper_values_1.record)(agy.tier) ? agy.tier : {};
    const name = typeof tier.name === 'string' ? tier.name.trim() : '';
    return name ? name.slice(0, 40) : null;
}
function agyWindowLabel(windowValue, rawName, id) {
    if (windowValue === '5h')
        return { label: '5 hours', rank: 0 };
    if (windowValue === 'weekly')
        return { label: '7 days', rank: 1 };
    const stripped = rawName.replace(/\s*limit\s+remaining$/i, '').trim();
    return { label: stripped || windowValue || id || 'Quota', rank: 2 };
}
/**
 * `agy -p /usage --output-format json` → pi-dish's `/api/usage-limits` reports.
 * Only Gemini quota buckets are projected (matching agy's Gemini-only model scope).
 */
function normalizeAgyUsageReports(parsed, options = {}) {
    const envelope = (0, helper_values_1.record)(parsed) ? parsed : {};
    if (envelope.status === 'ERROR') {
        const message = typeof envelope.error === 'string' && envelope.error.trim()
            ? envelope.error.trim()
            : 'Antigravity /usage failed';
        throw new Error(message);
    }
    const command = (0, helper_values_1.record)(envelope.command) ? envelope.command : {};
    const data = (0, helper_values_1.record)(command.data) ? command.data : {};
    if (command.name !== 'usage' || !Array.isArray(data.groups)) {
        throw new Error('Unexpected Antigravity /usage output');
    }
    const geminiGroups = data.groups.filter((group) => (0, helper_values_1.record)(group) && !/\b(?:claude|gpt)\b/i.test((0, helper_values_1.text)(group.name)));
    const qualifyGroup = geminiGroups.length > 1;
    const ranked = [];
    for (const group of geminiGroups) {
        const groupName = (0, helper_values_1.text)(group.name).trim();
        const buckets = Array.isArray(group.buckets) ? group.buckets : [];
        for (const raw of buckets) {
            if (!(0, helper_values_1.record)(raw))
                continue;
            const id = (0, helper_values_1.text)(raw.id).trim();
            if (id.startsWith('3p-'))
                continue;
            const remaining = Number(raw.remaining_fraction);
            if (!Number.isFinite(remaining))
                continue;
            const usedFraction = Math.min(1, Math.max(0, 1 - remaining));
            const { label: baseLabel, rank } = agyWindowLabel((0, helper_values_1.text)(raw.window).trim(), (0, helper_values_1.text)(raw.name).trim(), id);
            const label = qualifyGroup && groupName ? `${groupName} · ${baseLabel}` : baseLabel;
            const parsedReset = typeof raw.reset_time === 'string' && raw.reset_time ? Date.parse(raw.reset_time) : NaN;
            ranked.push({
                rank,
                limit: {
                    id: id ? id.slice(0, 60) : null,
                    label: label.slice(0, 120),
                    windowLabel: baseLabel.slice(0, 60),
                    resetsAt: Number.isFinite(parsedReset) ? parsedReset : null,
                    usedFraction,
                    unit: 'percent',
                    status: remaining <= 0 ? 'exhausted' : 'ok',
                },
            });
        }
    }
    ranked.sort((a, b) => a.rank - b.rank || a.limit.label.localeCompare(b.limit.label));
    if (!ranked.length)
        return [];
    const planType = typeof options.planType === 'string' && options.planType.trim()
        ? options.planType.trim().slice(0, 40)
        : null;
    return [{
            provider: exports.AGY_PROVIDER,
            fetchedAt: (0, helper_values_1.finite)(options.fetchedAt) ? options.fetchedAt : Date.now(),
            planType,
            limits: ranked.map(entry => entry.limit),
            resetCredits: null,
        }];
}
/** ACP stop reasons → Pi's assistant `stopReason` vocabulary. */
function acpStopReason(value) {
    switch (value) {
        case 'end_turn': return 'stop';
        case 'max_tokens': return 'length';
        case 'cancelled': return 'aborted';
        case 'refusal': return 'error';
        default: return 'stop';
    }
}
function locationPath(update) {
    const locations = Array.isArray(update.locations) ? update.locations : [];
    for (const row of locations) {
        if (!(0, helper_values_1.record)(row))
            continue;
        if (nonempty(row.path))
            return row.path;
    }
    return '';
}
/** agy sends its native call in non-ACP `name`/`args` next to ACP's `title`/`kind`. */
function normalizeAcpTool(update) {
    const value = (0, helper_values_1.record)(update) ? update : {};
    const nativeName = nonempty(value.name) ? value.name : 'tool';
    const args = (0, helper_values_1.record)(value.args) ? value.args : ((0, helper_values_1.record)(value.rawInput) ? value.rawInput : {});
    const filePath = nonempty(args.Path) ? args.Path : locationPath(value);
    const title = nonempty(value.title) ? value.title : nativeName;
    const kind = (0, helper_values_1.text)(value.kind);
    switch (nativeName) {
        case 'run_command':
            return { toolName: 'bash', args: { command: (0, helper_values_1.text)(args.CommandLine) }, nativeName, title, kind };
        case 'read_file':
            return { toolName: 'read', args: { path: filePath }, nativeName, title, kind };
        case 'edit_file':
            return { toolName: 'edit', args: { path: filePath, oldText: (0, helper_values_1.text)(args.Target), newText: (0, helper_values_1.text)(args.Replacement) }, nativeName, title, kind };
        case 'write_file':
            return { toolName: 'write', args: { path: filePath, content: (0, helper_values_1.text)(args.Content) }, nativeName, title, kind };
        default:
            return { toolName: nativeName, args, nativeName, title, kind };
    }
}
const DIFF_CONTEXT = 3;
const DIFF_LINE_LIMIT = 200;
function splitDiffLines(value) {
    if (!value)
        return [];
    return value.replace(/\n$/, '').split('\n');
}
function uniqueLineMap(lines, start, end) {
    const seen = new Map();
    for (let i = start; i < end; i++) {
        const line = lines[i];
        if (!line.trim())
            continue;
        seen.set(line, seen.has(line) ? -1 : i);
    }
    return seen;
}
function patienceEdits(oldLines, newLines, start, oldEnd, newEnd) {
    const oldUnique = uniqueLineMap(oldLines, start, oldEnd);
    const newUnique = uniqueLineMap(newLines, start, newEnd);
    const pairs = [];
    for (const [line, oldIdx] of oldUnique) {
        if (oldIdx < 0)
            continue;
        const newIdx = newUnique.get(line);
        if (newIdx !== undefined && newIdx >= 0)
            pairs.push({ oldIdx, newIdx });
    }
    const tails = [];
    const prev = new Array(pairs.length).fill(-1);
    for (let i = 0; i < pairs.length; i++) {
        let lo = 0, hi = tails.length;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (pairs[tails[mid]].newIdx < pairs[i].newIdx)
                lo = mid + 1;
            else
                hi = mid;
        }
        if (lo > 0)
            prev[i] = tails[lo - 1];
        tails[lo] = i;
    }
    const anchors = [];
    for (let cur = tails.length ? tails[tails.length - 1] : -1; cur >= 0; cur = prev[cur])
        anchors.push(pairs[cur]);
    anchors.reverse();
    const edits = [];
    let prevOld = start, prevNew = start;
    for (const anchor of anchors) {
        if (anchor.oldIdx < prevOld || anchor.newIdx < prevNew)
            continue;
        let oi = anchor.oldIdx, ni = anchor.newIdx;
        while (oi > prevOld && ni > prevNew && oldLines[oi - 1] === newLines[ni - 1]) {
            oi--;
            ni--;
        }
        let len = 1;
        while (oi + len < oldEnd && ni + len < newEnd && oldLines[oi + len] === newLines[ni + len])
            len++;
        if (prevOld < oi || prevNew < ni)
            edits.push({ oldStart: prevOld, oldEnd: oi, newStart: prevNew, newEnd: ni });
        prevOld = oi + len;
        prevNew = ni + len;
    }
    if (prevOld < oldEnd || prevNew < newEnd) {
        edits.push({ oldStart: prevOld, oldEnd, newStart: prevNew, newEnd });
    }
    return edits;
}
/**
 * Whole-file diff blocks arrive as `{type:'diff', path, oldText, newText}`; split
 * unchanged spans into bounded unified diff hunks so single- and multi-region
 * edits on large files never copy the whole file into the JSONL mirror.
 */
function diffText(block) {
    const filePath = (0, helper_values_1.text)(block.path);
    const oldLines = splitDiffLines((0, helper_values_1.text)(block.oldText));
    const newLines = splitDiffLines((0, helper_values_1.text)(block.newText));
    let prefix = 0;
    while (prefix < oldLines.length && prefix < newLines.length && oldLines[prefix] === newLines[prefix])
        prefix++;
    let suffix = 0;
    while (suffix < oldLines.length - prefix && suffix < newLines.length - prefix
        && oldLines[oldLines.length - 1 - suffix] === newLines[newLines.length - 1 - suffix]) {
        suffix++;
    }
    const head = filePath ? `${filePath}\n` : '';
    if (prefix === oldLines.length && prefix === newLines.length)
        return `${head}(no changes)`;
    const edits = patienceEdits(oldLines, newLines, prefix, oldLines.length - suffix, newLines.length - suffix);
    const groups = [];
    for (const edit of edits) {
        const current = groups[groups.length - 1];
        if (current && edit.oldStart - current[current.length - 1].oldEnd <= DIFF_CONTEXT * 2)
            current.push(edit);
        else
            groups.push([edit]);
    }
    const rendered = [];
    for (const group of groups) {
        const first = group[0], last = group[group.length - 1];
        const hunkOldStart = Math.max(0, first.oldStart - DIFF_CONTEXT);
        const hunkOldEnd = Math.min(oldLines.length, last.oldEnd + DIFF_CONTEXT);
        const hunkNewStart = Math.max(0, first.newStart - DIFF_CONTEXT);
        const hunkNewEnd = Math.min(newLines.length, last.newEnd + DIFF_CONTEXT);
        const oldCount = hunkOldEnd - hunkOldStart;
        const newCount = hunkNewEnd - hunkNewStart;
        rendered.push(`@@ -${oldCount ? hunkOldStart + 1 : 0},${oldCount} +${newCount ? hunkNewStart + 1 : 0},${newCount} @@`);
        let cursorOld = hunkOldStart;
        for (const edit of group) {
            while (cursorOld < edit.oldStart)
                rendered.push(` ${oldLines[cursorOld++]}`);
            for (let i = edit.oldStart; i < edit.oldEnd; i++)
                rendered.push(`-${oldLines[i]}`);
            for (let j = edit.newStart; j < edit.newEnd; j++)
                rendered.push(`+${newLines[j]}`);
            cursorOld = edit.oldEnd;
        }
        while (cursorOld < hunkOldEnd)
            rendered.push(` ${oldLines[cursorOld++]}`);
    }
    const omitted = rendered.length - DIFF_LINE_LIMIT;
    const body = omitted > 0 ? [...rendered.slice(0, DIFF_LINE_LIMIT), `... (${omitted} more diff lines)`] : rendered;
    return `${head}${body.join('\n')}`;
}
/** Completion content plus agy's `rawOutput`; bash keeps the exit status as Pi details. */
function acpToolResult(update, call) {
    const value = (0, helper_values_1.record)(update) ? update : {};
    const chunks = Array.isArray(value.content) ? value.content : [];
    const parts = [];
    for (const item of chunks) {
        if (!(0, helper_values_1.record)(item))
            continue;
        if (item.type === 'diff') {
            parts.push(diffText(item));
            continue;
        }
        const block = (0, helper_values_1.record)(item.content) ? item.content : item;
        if (block.type === 'text' && typeof block.text === 'string')
            parts.push(block.text);
    }
    const raw = (0, helper_values_1.record)(value.rawOutput) ? value.rawOutput : {};
    const output = (0, helper_values_1.text)(raw.output);
    let body = parts.filter(Boolean).join('\n');
    if (call.nativeName === 'run_command' && output)
        body = output;
    else if (!body)
        body = output;
    if (call.nativeName === 'run_command') {
        const exitCode = raw.exit_code;
        return {
            text: body,
            details: {
                kind: 'bash',
                timedOut: raw.timed_out === true || raw.timedOut === true,
                timeoutDisabled: true,
                ...((0, helper_values_1.finite)(exitCode) ? { exitCode } : {}),
            },
        };
    }
    if (!body && call.nativeName === 'read_file' && value.status === 'completed') {
        const readPath = (0, helper_values_1.text)(call.args.path);
        return { text: readPath ? `${readPath}\n(content not reported by agy)` : '(content not reported by agy)' };
    }
    return { text: body };
}
/** ACP `plan` update → a read-only widget, the only surface Pi has for it. */
function planWidgetRequest(id, entries) {
    if (!Array.isArray(entries))
        return null;
    const lines = entries.flatMap((entry) => {
        if (!(0, helper_values_1.record)(entry))
            return [];
        const content = nonempty(entry.content) ? entry.content : nonempty(entry.title) ? entry.title : null;
        if (!content)
            return [];
        const mark = entry.status === 'completed' ? '[x]' : entry.status === 'in_progress' ? '[>]' : '[ ]';
        return [`${mark} ${content}`];
    });
    if (!lines.length)
        return null;
    return { type: 'extension_ui_request', id, method: 'setWidget', widgetKey: 'agy-plan', widgetLines: lines, widgetPlacement: 'aboveEditor' };
}
function stripRecommended(label) {
    const match = /^\(recommended\)\s*/i.exec(label);
    return match ? { label: label.slice(match[0].length), recommended: true } : { label, recommended: false };
}
/**
 * One `elicitation/create` form → the browser's `ask` dialog. Each non-`_other`
 * property is a question; the recommended mark comes from the pending
 * `ask_question` call, which is the only place agy states it.
 */
function askFromElicitation(id, params, pendingQuestions) {
    const record = (0, helper_values_1.record)(params) ? params : {};
    const schema = (0, helper_values_1.record)(record.requestedSchema) ? record.requestedSchema : {};
    const properties = (0, helper_values_1.record)(schema.properties) ? schema.properties : {};
    const pending = Array.isArray(pendingQuestions) ? pendingQuestions : [];
    const questions = [];
    const display = [];
    let questionIndex = 0;
    for (const [key, raw] of Object.entries(properties)) {
        if (key.endsWith('_other') || !(0, helper_values_1.record)(raw))
            continue;
        const multi = raw.type === 'array';
        const pendingQuestion = (0, helper_values_1.record)(pending[questionIndex]) ? pending[questionIndex] : {};
        const pendingOptions = Array.isArray(pendingQuestion.options) ? pendingQuestion.options : [];
        const oneOf = Array.isArray(raw.oneOf) ? raw.oneOf.filter(helper_values_1.record) : [];
        const options = [];
        let recommended = null;
        const count = Math.max(oneOf.length, pendingOptions.length);
        for (let i = 0; i < count; i++) {
            const entry = oneOf[i];
            const pendingOption = pendingOptions[i];
            const pendingLabel = typeof pendingOption === 'string' ? pendingOption
                : (0, helper_values_1.record)(pendingOption) ? (0, helper_values_1.text)(pendingOption.label) || (0, helper_values_1.text)(pendingOption.title) : '';
            const strippedPending = stripRecommended(pendingLabel);
            const rawLabel = entry ? (0, helper_values_1.text)(entry.title) || (0, helper_values_1.text)(entry.label) : '';
            const label = rawLabel ? stripRecommended(rawLabel).label : strippedPending.label;
            if (!label)
                continue;
            const value = entry && entry.const !== undefined ? String(entry.const)
                : (0, helper_values_1.record)(pendingOption) && pendingOption.value !== undefined ? String(pendingOption.value) : label;
            if (strippedPending.recommended && recommended === null)
                recommended = options.length;
            options.push({ label, value });
        }
        const question = (0, helper_values_1.text)(raw.title) || (0, helper_values_1.text)(pendingQuestion.question) || `Question ${key}`;
        questions.push({ key, multi, options });
        display.push({
            id: key,
            question,
            header: (0, helper_values_1.text)(raw.description),
            multi,
            recommended,
            options: options.map(option => ({ label: option.label, description: '', preview: '' })),
        });
        questionIndex++;
    }
    if (!questions.length)
        return null;
    return {
        request: {
            type: 'extension_ui_request',
            id,
            method: 'ask',
            title: (0, helper_values_1.text)(record.message) || 'Question',
            questions: display,
        },
        questions,
    };
}
const ASK_OPTION_LIMIT = 64;
/** The browser's ask response → the elicitation result (`accept` / `decline` / `cancel`). */
function askElicitationResult(response, questions) {
    if (response.cancelled === true)
        return { action: 'cancel' };
    const value = (0, helper_values_1.record)(response.value) ? response.value : {};
    if (value.kind === 'chat')
        return { action: 'decline' };
    if (value.kind !== 'submit' || !Array.isArray(value.results))
        return { action: 'cancel' };
    const content = {};
    for (const question of questions) {
        const row = value.results.slice(0, ASK_OPTION_LIMIT).find(item => (0, helper_values_1.record)(item) && item.id === question.key);
        if (!(0, helper_values_1.record)(row))
            continue;
        const selected = Array.isArray(row.selectedOptions)
            ? row.selectedOptions.filter((item) => typeof item === 'string')
            : [];
        const values = selected.flatMap(label => {
            const match = question.options.find(option => option.label === label);
            return match ? [match.value] : [];
        });
        if (values.length)
            content[question.key] = question.multi ? values : values[0];
        const custom = typeof row.customInput === 'string' ? row.customInput.trim() : '';
        if (custom)
            content[`${question.key}_other`] = custom;
    }
    return { action: 'accept', content };
}
/** An unexpected permission request becomes a `select` dialog rather than hanging the turn. */
function permissionDialog(id, params) {
    const record = (0, helper_values_1.record)(params) ? params : {};
    const raw = Array.isArray(record.options) ? record.options : [];
    const options = [];
    for (const row of raw) {
        if (!(0, helper_values_1.record)(row) || typeof row.optionId !== 'string' || !row.optionId)
            continue;
        options.push({ optionId: row.optionId, label: (0, helper_values_1.text)(row.name) || row.optionId, description: (0, helper_values_1.text)(row.kind) });
    }
    if (!options.length)
        return null;
    const call = (0, helper_values_1.record)(record.toolCall) ? record.toolCall : {};
    return {
        options: options.map(option => ({ optionId: option.optionId, label: option.label })),
        request: {
            type: 'extension_ui_request',
            id,
            method: 'select',
            title: 'Permission required',
            message: (0, helper_values_1.text)(call.title) || (0, helper_values_1.text)(call.name) || (0, helper_values_1.text)(record.sessionId) || 'Antigravity requested permission',
            options: options.map(option => ({ label: option.label, description: option.description })),
        },
    };
}
/** The select response → ACP's `{outcome:{outcome:'selected'|'cancelled'}}`. */
function permissionResult(response, options) {
    if (response.cancelled === true)
        return { outcome: { outcome: 'cancelled' } };
    const label = typeof response.value === 'string' ? response.value : '';
    const match = options.find(option => option.label === label) ?? options.find(option => option.optionId === label);
    return match
        ? { outcome: { outcome: 'selected', optionId: match.optionId } }
        : { outcome: { outcome: 'cancelled' } };
}
const TAIL_BYTES = 1024 * 1024;
function lastEntryIdIn(content) {
    const lines = content.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line)
            continue;
        try {
            const entry = JSON.parse(line);
            if ((0, helper_values_1.record)(entry) && entry.type !== 'session' && nonempty(entry.id))
                return entry.id;
        }
        catch { /* A torn tail line cannot anchor the chain. */ }
    }
    return null;
}
/** Mirrors reach tens of MB; read the tail unless one entry exceeds the window. */
function tailSlice(file) {
    const stats = fs.statSync(file);
    const length = Math.min(stats.size, TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    const fd = fs.openSync(file, 'r');
    try {
        fs.readSync(fd, buffer, 0, length, stats.size - length);
    }
    finally {
        fs.closeSync(fd);
    }
    return { text: buffer.toString('utf8'), complete: length === stats.size };
}
function lastTimestampIn(content) {
    const lines = content.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i].trim();
        if (!line)
            continue;
        try {
            const entry = JSON.parse(line);
            if (!(0, helper_values_1.record)(entry) || entry.type === 'session')
                continue;
            if (typeof entry.timestamp === 'number' && Number.isFinite(entry.timestamp))
                return entry.timestamp;
            if (typeof entry.timestamp === 'string') {
                const at = Date.parse(entry.timestamp);
                if (Number.isFinite(at))
                    return at;
            }
        }
        catch { /* A torn tail line cannot date the mirror. */ }
    }
    return null;
}
/** Timestamp of the mirror's newest entry; null when it has none (or no file). */
function readAcpMirrorLastTimestamp(file) {
    try {
        const tail = tailSlice(file);
        const found = lastTimestampIn(tail.text);
        if (found !== null || tail.complete)
            return found;
        return lastTimestampIn(fs.readFileSync(file, 'utf8'));
    }
    catch {
        return null;
    }
}
/** Rename a mirror and sidecar aside before re-import; `.bak` never matches discovery. */
function backupAcpMirror(file) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const sidecar = file.replace(/\.jsonl$/, '.acp.jsonl');
    const move = (from) => {
        const to = `${from}.${stamp}.bak`;
        try {
            fs.renameSync(from, to);
            return to;
        }
        catch {
            return null;
        }
    };
    return { mirror: move(file), sidecar: move(sidecar) };
}
/** Put a backup back after a failed replay so resume can fall back to `session/resume`. */
function restoreAcpMirror(file, backup) {
    const sidecar = file.replace(/\.jsonl$/, '.acp.jsonl');
    const restore = (from, to) => {
        if (!from)
            return;
        try {
            fs.rmSync(to, { force: true });
            fs.renameSync(from, to);
        }
        catch { /* Best effort. */ }
    };
    restore(backup.mirror, file);
    restore(backup.sidecar, sidecar);
}
/** Read the mirror header (id, cwd, agy version); throws when the file is not a mirror. */
function readAcpMirrorHeader(file) {
    const buffer = Buffer.alloc(4096);
    const fd = fs.openSync(file, 'r');
    let read = 0;
    try {
        read = fs.readSync(fd, buffer, 0, buffer.length, 0);
    }
    finally {
        fs.closeSync(fd);
    }
    const first = buffer.subarray(0, read).toString('utf8').split('\n')[0];
    let header;
    try {
        header = JSON.parse(first);
    }
    catch {
        header = null;
    }
    if (!(0, helper_values_1.record)(header) || header.type !== 'session' || !nonempty(header.id)) {
        throw new Error(`Not an Antigravity session mirror: ${file}`);
    }
    const agy = (0, helper_values_1.record)(header.agy) ? header.agy : {};
    const rawImport = (0, helper_values_1.record)(agy.imported) ? agy.imported : null;
    const imported = rawImport && typeof rawImport.source === 'string'
        ? { at: (0, helper_values_1.finite)(rawImport.at) ? rawImport.at : Date.parse((0, helper_values_1.text)(rawImport.at)) || 0, source: rawImport.source }
        : null;
    return {
        id: header.id,
        cwd: nonempty(header.cwd) ? header.cwd : null,
        agentVersion: nonempty(agy.version) ? agy.version : null,
        imported,
    };
}
/** Linear parent chain; agy has no branches, so every entry extends the last. */
class AcpTranscript {
    file;
    sidecarFile;
    parentId = null;
    replayUserText = null;
    replayAssistant = null;
    constructor(options) {
        this.file = options.file;
        this.sidecarFile = options.file.replace(/\.jsonl$/, '.acp.jsonl');
        fs.mkdirSync(path.dirname(options.file), { recursive: true });
        let size = 0;
        try {
            size = fs.statSync(options.file).size;
        }
        catch (error) {
            if (error.code !== 'ENOENT')
                throw error;
        }
        if (size > 0) {
            const tail = tailSlice(options.file);
            this.parentId = lastEntryIdIn(tail.text);
            if (!this.parentId && !tail.complete) {
                this.parentId = lastEntryIdIn(fs.readFileSync(options.file, 'utf8'));
            }
            return;
        }
        const header = {
            type: 'session',
            version: 3,
            id: options.sessionId,
            cwd: options.cwd,
            timestamp: new Date().toISOString(),
            agy: {
                version: options.agentVersion,
                ...(options.imported
                    ? { imported: { at: new Date(options.imported.at).toISOString(), source: options.imported.source } }
                    : {}),
            },
        };
        fs.writeFileSync(options.file, JSON.stringify(header) + '\n');
    }
    /** Append one entry; `timestamp` is the Pi entry stamp, not the message start. */
    entry(type, fields, at = Date.now()) {
        const entry = {
            type,
            id: crypto.randomUUID(),
            parentId: this.parentId,
            timestamp: new Date(at).toISOString(),
            ...fields,
        };
        fs.appendFileSync(this.file, JSON.stringify(entry) + '\n');
        this.parentId = entry.id;
        return entry;
    }
    appendUser(content, timestamp = Date.now()) {
        const blocks = typeof content === 'string' ? [{ type: 'text', text: content }] : content;
        this.entry('message', { message: { role: 'user', content: blocks, timestamp } });
    }
    /** `message` is the finished assistant snapshot emitted on `message_end`. */
    appendAssistant(message, at) {
        this.entry('message', { message }, at);
    }
    appendToolResult(data) {
        this.entry('message', {
            message: {
                role: 'toolResult',
                toolCallId: data.toolCallId,
                toolName: data.toolName,
                content: [{ type: 'text', text: data.content }],
                isError: data.isError === true,
                timestamp: data.timestamp ?? Date.now(),
                ...(data.details ? { details: data.details } : {}),
            },
        });
    }
    appendModelChange(modelId) {
        this.entry('model_change', { modelId, provider: exports.AGY_PROVIDER });
    }
    appendThinkingLevel(thinkingLevel) {
        this.entry('thinking_level_change', { thinkingLevel });
    }
    appendSessionInfo(name) {
        this.entry('session_info', { name });
    }
    /**
     * `session/load` replay: user chunks carry whole prompts, assistant text and
     * completed tool calls arrive without updates or prompt results. A user chunk
     * closes the previous message; a completed/failed call is start plus end; the
     * load response flushes whatever is still open (`flushReplay`).
     */
    applyReplayUpdate(raw) {
        const update = (0, helper_values_1.record)(raw) ? raw : {};
        const kind = (0, helper_values_1.text)(update.sessionUpdate);
        if (kind === 'user_message_chunk') {
            const content = (0, wire_protocol_1.asRecord)(update.content);
            if (content.type !== 'text')
                return;
            this.flushReplay();
            this.replayUserText = (0, helper_values_1.text)(content.text);
            return;
        }
        if (kind === 'agent_message_chunk' || kind === 'agent_thought_chunk') {
            const content = (0, wire_protocol_1.asRecord)(update.content);
            if (content.type !== 'text')
                return;
            this.flushReplayUser();
            this.ensureReplayAssistant();
            const message = this.replayAssistant;
            const blocks = message.content;
            const type = kind === 'agent_thought_chunk' ? 'thinking' : 'text';
            const last = blocks[blocks.length - 1];
            if ((0, helper_values_1.record)(last) && last.type === type) {
                const key = type === 'text' ? 'text' : 'thinking';
                last[key] = (0, helper_values_1.text)(last[key]) + (0, helper_values_1.text)(content.text);
            }
            else {
                blocks.push(type === 'text'
                    ? { type: 'text', text: (0, helper_values_1.text)(content.text) }
                    : { type: 'thinking', thinking: (0, helper_values_1.text)(content.text) });
            }
            return;
        }
        if (kind !== 'tool_call')
            return;
        const status = (0, helper_values_1.text)(update.status);
        const call = normalizeAcpTool(update);
        const toolCallId = (0, helper_values_1.text)(update.toolCallId) || `call-replay-${crypto.randomUUID()}`;
        this.flushReplayUser();
        this.ensureReplayAssistant();
        this.replayAssistant.content.push({
            type: 'toolCall', id: toolCallId, name: call.toolName, arguments: call.args,
        });
        this.flushReplayAssistant('toolUse');
        if (status !== 'completed' && status !== 'failed')
            return;
        const result = acpToolResult(update, call);
        this.appendToolResult({
            toolCallId,
            toolName: call.toolName,
            content: result.text,
            isError: status === 'failed',
            ...(result.details ? { details: result.details } : {}),
        });
    }
    /** The `session/load` response ends the replay; write the open message. */
    flushReplay() {
        this.flushReplayAssistant('stop');
        this.flushReplayUser();
    }
    ensureReplayAssistant() {
        if (this.replayAssistant)
            return;
        const message = {
            role: 'assistant',
            content: [],
            timestamp: Date.now(),
            provider: exports.AGY_PROVIDER,
        };
        this.replayAssistant = message;
    }
    flushReplayAssistant(stopReason) {
        const message = this.replayAssistant;
        if (!message)
            return;
        this.replayAssistant = null;
        message.stopReason = stopReason;
        this.appendAssistant(message);
    }
    flushReplayUser() {
        const content = this.replayUserText;
        if (content === null)
            return;
        this.replayUserText = null;
        this.appendUser(content);
    }
    /** Raw frame sidecar: `{t, dir, msg}` exactly as the capture recorder wrote it. */
    appendRaw(dir, msg) {
        try {
            fs.appendFileSync(this.sidecarFile, JSON.stringify({ t: Date.now(), dir, msg }) + '\n');
        }
        catch { /* A missing sidecar directory must not break the transport. */ }
    }
}
exports.AcpTranscript = AcpTranscript;
