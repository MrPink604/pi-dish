// Generated from src/core/helper-content.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractTextContent = extractTextContent;
exports.extractTextBlocks = extractTextBlocks;
exports.ipythonCodeSummary = ipythonCodeSummary;
exports.getToolSummary = getToolSummary;
exports.parseIpythonResult = parseIpythonResult;
exports.pythonReprUnescape = pythonReprUnescape;
exports.messageHasVisibleText = messageHasVisibleText;
exports.getToolOutputText = getToolOutputText;
exports.extractImageBlocks = extractImageBlocks;
const helper_values_1 = require("./helper-values");
const helper_format_1 = require("./helper-format");
function extractTextContent(content) {
    if (!content)
        return '';
    if (typeof content === 'string')
        return content;
    if (Array.isArray(content)) {
        const blocks = content;
        return blocks.map(c => typeof c === 'string' ? c : (0, helper_values_1.record)(c) && c.type === 'text' && typeof c.text === 'string' ? c.text : '').join('\n');
    }
    return '';
}
/** Text of the text blocks only — no phantom separators from image or other
 *  non-text blocks (extractTextContent joins those in as empty lines, so it
 *  can never equal the composer's trimmed text once an image is attached).
 *  Used when comparing a prompt to its echo. */
function extractTextBlocks(content) {
    if (!content)
        return '';
    if (typeof content === 'string')
        return content;
    if (!Array.isArray(content))
        return '';
    const blocks = content;
    return blocks
        .filter(c => typeof c === 'string' || ((0, helper_values_1.record)(c) && c.type === 'text'))
        .map(c => typeof c === 'string' ? c : (0, helper_values_1.record)(c) && typeof c.text === 'string' ? c.text : '')
        .join('\n');
}
/**
 * Prime's single built-in tool: a stateful Python kernel whose shell access
 * is wrapped in bash('...') calls. Surface the wrapped command when present,
 * otherwise the first line of the code — mirroring the Bash/read summaries.
 */
function ipythonCodeSummary(code) {
    if (typeof code !== 'string' || !code)
        return '';
    const m = /(?:^|[^A-Za-z0-9_])bash\(\s*(['"])((?:\\.|(?!\1).)*)\1/.exec(code);
    const inner = m ? m[2].replace(/\\(['"\\])/g, '$1') : code.split('\n')[0];
    return (0, helper_format_1.truncate)(inner, 60);
}
function getToolSummary(toolName, args) {
    if (!(0, helper_values_1.record)(args))
        return '';
    if (toolName === 'Bash' || toolName === 'bash')
        return typeof args.command === 'string' && args.command ? (0, helper_format_1.truncate)(args.command.split('\n')[0], 60) : '';
    if (toolName === 'ipython')
        return ipythonCodeSummary(args.code);
    if (['Read', 'read', 'Edit', 'edit', 'Write', 'write'].includes(toolName))
        return typeof args.path === 'string' ? args.path : '';
    const keys = Object.keys(args);
    if (keys.length)
        return (0, helper_format_1.truncate)(String(args[keys[0]]), 40);
    return '';
}
/**
 * Prime's ipython tool results are the Python repr of a BashResult (or plain
 * kernel text): `BashResult(exit_code=0, output='...', duration=0.017)`.
 * Unwrap it so transcripts show the command output instead of the repr.
 * Returns null for anything else, including a partial streaming prefix.
 */
function parseIpythonResult(text) {
    if (typeof text !== 'string')
        return null;
    const m = /^BashResult\(exit_code=(-?\d+), output=(['"])((?:\\.|(?!\2).)*)\2(?:, duration=([0-9.eE+-]+))?\)\s*$/.exec(text);
    if (!m)
        return null;
    return { exitCode: Number(m[1]), output: pythonReprUnescape(m[3]), durationMs: m[4] != null ? Math.round(Number(m[4]) * 1000) : null };
}
function pythonReprUnescape(text) {
    return text.replace(/\\(x[0-9a-fA-F]{2}|u[0-9a-fA-F]{4}|[\s\S])/g, (_all, seq) => {
        if (seq[0] === 'x')
            return String.fromCharCode(parseInt(seq.slice(1), 16));
        if (seq[0] === 'u')
            return String.fromCharCode(parseInt(seq.slice(1), 16));
        const map = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0', '\n': '' };
        return Object.hasOwn(map, seq) ? map[seq] : seq;
    });
}
/**
 * Whether a message renders any prose (a non-empty text block or an error).
 * Drives the `.message.no-text` class that focus mode and tool-activity
 * grouping key on. One definition for the static and streaming renderers —
 * they used to derive it independently and disagreed about errorMessage.
 */
function messageHasVisibleText(msg) {
    if (!(0, helper_values_1.record)(msg))
        return false;
    if (msg.errorMessage)
        return true;
    if (typeof msg.content === 'string')
        return !!msg.content;
    return Array.isArray(msg.content) && msg.content.some((b) => (0, helper_values_1.record)(b) && b.type === 'text' && typeof b.text === 'string' && !!b.text);
}
function getToolOutputText(partialResult) {
    if (!(0, helper_values_1.record)(partialResult) || !Array.isArray(partialResult.content))
        return '';
    const blocks = partialResult.content;
    return blocks
        .filter((c) => (0, helper_values_1.record)(c) && c.type === 'text')
        .map(c => typeof c.text === 'string' ? c.text : '')
        .join('');
}
/**
 * Image content blocks from a message or tool-result content array. Live
 * events carry `{ data, mimeType }`; historical pages project those bytes to
 * `{ url, mimeType }` so the browser can cache/lazy-load them. Non-array
 * content and blocks without either source yield nothing; mimeType defaults
 * to image/png. Rendering stays with the DOM-owning caller.
 */
function extractImageBlocks(content) {
    if (!Array.isArray(content))
        return [];
    const out = [];
    const blocks = content;
    for (const block of blocks) {
        if (!(0, helper_values_1.record)(block) || block.type !== 'image')
            continue;
        const mimeType = typeof block.mimeType === 'string' && block.mimeType ? block.mimeType : 'image/png';
        if (typeof block.url === 'string' && block.url)
            out.push({ url: block.url, mimeType });
        else if (typeof block.data === 'string' && block.data)
            out.push({ data: block.data, mimeType });
    }
    return out;
}
