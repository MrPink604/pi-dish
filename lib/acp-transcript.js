// Generated from src/core/acp-transcript.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AcpTranscript = exports.AGY_PROVIDER = void 0;
exports.acpUsage = acpUsage;
exports.acpStopReason = acpStopReason;
exports.normalizeAcpTool = normalizeAcpTool;
exports.acpToolResult = acpToolResult;
exports.planWidgetRequest = planWidgetRequest;
exports.askFromElicitation = askFromElicitation;
exports.askElicitationResult = askElicitationResult;
exports.permissionDialog = permissionDialog;
exports.permissionResult = permissionResult;
exports.readAcpMirrorHeader = readAcpMirrorHeader;
/**
 * Antigravity (`agy` ACP) → Pi JSONL translation and the mirror writer.
 *
 * The ACP stream is chunks and tool calls, not messages; `AcpSession` segments
 * it into Pi messages and hands the finished records here. Every entry is
 * appended synchronously so a reader that reacts to the emitted `message_end`
 * already sees the transcript. `session/load` replay is not used: this writer
 * covers the live stream only.
 *
 * Beside the mirror (`.jsonl`) the raw frames of both directions are kept in a
 * `.acp.jsonl` sidecar as `{t, dir, msg}`, the same shape as the captures in
 * `docs/agy-acp-capture/`. No reader consumes the sidecar; it exists so the
 * mirror can be rebuilt if the translation changes.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
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
/** Whole-file diff blocks arrive as `{type:'diff', path, oldText, newText}`. */
function diffText(block) {
    const filePath = (0, helper_values_1.text)(block.path);
    const before = (0, helper_values_1.text)(block.oldText);
    const after = (0, helper_values_1.text)(block.newText);
    return `${filePath ? filePath + '\n' : ''}--- before\n${before}\n+++ after\n${after}`;
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
function lastEntryId(file) {
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
    const found = lastEntryIdIn(buffer.toString('utf8'));
    if (found || length === stats.size)
        return found;
    return lastEntryIdIn(fs.readFileSync(file, 'utf8'));
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
    return {
        id: header.id,
        cwd: nonempty(header.cwd) ? header.cwd : null,
        agentVersion: nonempty(agy.version) ? agy.version : null,
    };
}
/** Linear parent chain; agy has no branches, so every entry extends the last. */
class AcpTranscript {
    file;
    sidecarFile;
    parentId = null;
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
            this.parentId = lastEntryId(options.file);
            return;
        }
        const header = {
            type: 'session',
            version: 3,
            id: options.sessionId,
            cwd: options.cwd,
            timestamp: new Date().toISOString(),
            agy: { version: options.agentVersion },
        };
        fs.writeFileSync(options.file, JSON.stringify(header) + '\n');
    }
    /** Append one entry; `timestamp` is the Pi entry stamp, not the message start. */
    entry(type, fields) {
        const entry = {
            type,
            id: crypto.randomUUID(),
            parentId: this.parentId,
            timestamp: new Date().toISOString(),
            ...fields,
        };
        fs.appendFileSync(this.file, JSON.stringify(entry) + '\n');
        this.parentId = entry.id;
        return entry;
    }
    appendUser(content, timestamp = Date.now()) {
        this.entry('message', { message: { role: 'user', content: [{ type: 'text', text: content }], timestamp } });
    }
    /** `message` is the finished assistant snapshot emitted on `message_end`. */
    appendAssistant(message) {
        this.entry('message', { message });
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
    /** Raw frame sidecar: `{t, dir, msg}` exactly as the capture recorder wrote it. */
    appendRaw(dir, msg) {
        try {
            fs.appendFileSync(this.sidecarFile, JSON.stringify({ t: Date.now(), dir, msg }) + '\n');
        }
        catch { /* A missing sidecar directory must not break the transport. */ }
    }
}
exports.AcpTranscript = AcpTranscript;
