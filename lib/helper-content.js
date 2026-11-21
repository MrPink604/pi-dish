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
const helper_refs_1 = require("./helper-refs");
function compactToolRef(raw) {
    if (typeof raw !== 'string')
        return '';
    const ref = raw.trim();
    if (!ref)
        return '';
    const slash = ref.indexOf('/');
    const host = slash > 0 ? ref.slice(0, slash + 1) : '';
    const id = slash > 0 ? ref.slice(slash + 1) : ref;
    const decoded = (0, helper_refs_1.decodeRouteSessionId)(id);
    const native = decoded ? decoded.nativeSessionId : id;
    const uuid = helper_refs_1.SESSION_UUID_TAIL_RE.exec(native);
    if (uuid)
        return `${host}${uuid[1].slice(0, 8)}`;
    if (native.length > 16)
        return `${host}${native.slice(0, 12)}…`;
    return `${host}${native}`;
}
function firstArgLine(raw) {
    if (typeof raw !== 'string')
        return '';
    return raw.split('\n').map(line => line.trim()).find(Boolean) || '';
}
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
/** Text blocks only: extractTextContent joins non-text blocks as empty lines, so it can't equal a prompt's echo once an image is attached. */
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
/** Prime's Python kernel tool wraps shell access in bash('...'): surface that command, else the first code line. */
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
    if (toolName === 'ipython' || toolName === 'python_repl')
        return ipythonCodeSummary(args.code);
    // OMP eval args lead with language ("py"); prefer the cell title, then the ipython summary.
    if (toolName === 'eval') {
        const title = typeof args.title === 'string' ? args.title.trim() : '';
        if (title)
            return (0, helper_format_1.truncate)(title, 60);
        return ipythonCodeSummary(args.code);
    }
    // A bot's code mode script: its first line of code, past comments and the options line.
    if (toolName === 'codemode') {
        const line = typeof args.code === 'string' ? args.code.split('\n').map(text => text.trim()).find(text => text && !text.startsWith('//')) : '';
        return line ? (0, helper_format_1.truncate)(line, 60) : '';
    }
    if (['Read', 'read', 'Edit', 'edit', 'Write', 'write'].includes(toolName))
        return typeof args.path === 'string' ? args.path : '';
    if (toolName === 'invoke_subagent') {
        const role = typeof args.Role === 'string' ? args.Role.trim() : '';
        const typeName = typeof args.TypeName === 'string' ? args.TypeName.trim() : '';
        const label = role && typeName ? `${role} (${typeName})` : (role || typeName);
        if (label)
            return (0, helper_format_1.truncate)(label, 60);
    }
    if (toolName === 'manage_subagents' && typeof args.Action === 'string')
        return (0, helper_format_1.truncate)(args.Action, 40);
    if (toolName === 'define_subagent' && typeof args.Name === 'string')
        return (0, helper_format_1.truncate)(args.Name, 50);
    if (toolName === 'send_message') {
        const to = typeof args.Recipient === 'string' ? args.Recipient.slice(0, 8) : '';
        const msg = typeof args.Message === 'string' ? args.Message.split('\n')[0].trim() : '';
        if (to || msg)
            return (0, helper_format_1.truncate)(to && msg ? `→ ${to}: ${msg}` : (msg || `→ ${to}`), 60);
    }
    if (toolName === 'manage_task') {
        const action = typeof args.Action === 'string' ? args.Action : '';
        const rawId = typeof args.TaskId === 'string' ? args.TaskId : '';
        const shortId = rawId.includes('/') ? rawId.slice(rawId.lastIndexOf('/') + 1) : rawId;
        if (action || shortId)
            return (0, helper_format_1.truncate)([action, shortId].filter(Boolean).join(' '), 50);
    }
    if (toolName === 'schedule') {
        const when = typeof args.CronExpression === 'string' && args.CronExpression
            ? args.CronExpression
            : (typeof args.DurationSeconds === 'number' ? `${args.DurationSeconds}s` : '');
        const prompt = typeof args.Prompt === 'string' ? args.Prompt.split('\n')[0].trim() : '';
        if (when || prompt)
            return (0, helper_format_1.truncate)([when, prompt].filter(Boolean).join(': '), 60);
        // Bot schedule tool uses lowercase action/name/cron.
        const action = typeof args.action === 'string' ? args.action : '';
        const name = typeof args.name === 'string' ? args.name : '';
        const cron = typeof args.cron === 'string' ? args.cron : '';
        if (action || name) {
            const head = [action, name].filter(Boolean).join(' ');
            return (0, helper_format_1.truncate)(cron ? `${head} (${cron})` : head, 60);
        }
    }
    if (toolName === 'spawn_worker') {
        const name = typeof args.name === 'string' ? args.name.trim() : '';
        const host = typeof args.host === 'string' && args.host.trim() ? args.host.trim() : '';
        const harness = typeof args.harness === 'string' && args.harness.trim() && args.harness !== 'pi' ? args.harness.trim() : '';
        const where = [harness, host].filter(Boolean).join(' · ');
        if (name)
            return (0, helper_format_1.truncate)(where ? `${name} (${where})` : name, 60);
        if (where)
            return (0, helper_format_1.truncate)(where, 60);
    }
    if (toolName === 'sessions') {
        const action = typeof args.action === 'string' ? args.action : '';
        const ref = compactToolRef(args.ref);
        const host = typeof args.host === 'string' && args.host.trim() ? args.host.trim() : '';
        if (action === 'send') {
            const body = firstArgLine(args.message);
            return (0, helper_format_1.truncate)([`send ${ref || ''}`.trim(), body].filter(Boolean).join(': '), 60);
        }
        if (action === 'search') {
            const q = typeof args.query === 'string' ? args.query.trim() : '';
            return (0, helper_format_1.truncate)(`search ${q ? `"${q}"` : ''}${host ? ` (${host})` : ''}`.trim(), 60);
        }
        if (action === 'read' || action === 'close' || action === 'wait') {
            return (0, helper_format_1.truncate)([action, ref].filter(Boolean).join(' '), 60);
        }
        if (action)
            return (0, helper_format_1.truncate)(host ? `${action} (${host})` : action, 60);
    }
    if (toolName === 'kb_search' && typeof args.query === 'string')
        return (0, helper_format_1.truncate)(`"${args.query.trim()}"`, 60);
    if (toolName === 'kb_read')
        return (0, helper_format_1.truncate)(typeof args.page === 'string' && args.page.trim() ? args.page.trim() : 'index', 60);
    if (toolName === 'kb_write') {
        const mode = typeof args.mode === 'string' && args.mode ? args.mode : 'append';
        const page = typeof args.page === 'string' ? args.page.trim() : '';
        if (page)
            return (0, helper_format_1.truncate)(`${mode} ${page}`, 60);
    }
    if (toolName === 'context_notes') {
        const action = typeof args.action === 'string' ? args.action : '';
        if (action === 'write' && typeof args.text === 'string') {
            return (0, helper_format_1.truncate)(`write (${args.text.length.toLocaleString()} chars)`, 60);
        }
        if (action)
            return (0, helper_format_1.truncate)(action, 40);
    }
    if (toolName === 'bot_update') {
        const target = typeof args.bot === 'string' && args.bot.trim() ? `${args.bot.trim()}: ` : '';
        const fields = Object.keys(args).filter(k => k !== 'bot' && args[k] !== undefined);
        if (fields.length)
            return (0, helper_format_1.truncate)(`${target}${fields.join(', ')}`, 60);
        if (target)
            return (0, helper_format_1.truncate)(target.slice(0, -2), 60);
    }
    if (toolName === 'bot_create') {
        const name = typeof args.name === 'string' ? args.name.trim() : '';
        const extras = [args.fresh === true ? 'fresh' : '', typeof args.model === 'string' ? args.model : ''].filter(Boolean).join(' · ');
        if (name)
            return (0, helper_format_1.truncate)(extras ? `${name} (${extras})` : name, 60);
    }
    if (toolName === 'bots') {
        const action = typeof args.action === 'string' ? args.action : '';
        const bot = typeof args.bot === 'string' ? args.bot.trim() : '';
        if (action || bot)
            return (0, helper_format_1.truncate)([action, bot].filter(Boolean).join(' '), 60);
    }
    if (toolName === 'room_post') {
        const to = Array.isArray(args.to) ? args.to.filter((item) => typeof item === 'string' && !!item).join(', ') : '';
        const msg = firstArgLine(args.message);
        if (to || msg)
            return (0, helper_format_1.truncate)(to && msg ? `→ ${to}: ${msg}` : (to ? `→ ${to}` : msg), 60);
    }
    if (toolName === 'room_read') {
        return typeof args.limit === 'number' ? `last ${args.limit}` : 'recent';
    }
    if (toolName === 'ask_bot') {
        const bot = typeof args.bot === 'string' ? args.bot.trim() : '';
        const q = firstArgLine(args.question);
        if (bot || q)
            return (0, helper_format_1.truncate)(bot && q ? `→ ${bot}: ${q}` : (bot ? `→ ${bot}` : q), 60);
    }
    if (toolName === 'history') {
        const action = typeof args.action === 'string' ? args.action : '';
        const extra = typeof args.window === 'number' ? `#${args.window}` : (typeof args.query === 'string' && args.query ? `"${args.query}"` : '');
        if (action || extra)
            return (0, helper_format_1.truncate)([action, extra].filter(Boolean).join(' '), 60);
    }
    if (toolName === 'new_context' && typeof args.summary === 'string')
        return (0, helper_format_1.truncate)(args.summary.trim(), 60);
    if (toolName === 'run_workflow') {
        const desc = typeof args.Description === 'string' && args.Description.trim()
            ? args.Description.trim()
            : (typeof args.ScriptPath === 'string' ? args.ScriptPath : '');
        if (desc)
            return (0, helper_format_1.truncate)(desc, 60);
    }
    if (toolName === 'swarm') {
        const action = typeof args.action === 'string' ? args.action : '';
        const name = typeof args.name === 'string' ? args.name : '';
        if (action === 'add' && name) {
            const count = Array.isArray(args.tasks) ? ` (${args.tasks.length})` : (typeof args.n === 'number' && args.n > 1 ? ` ×${args.n}` : '');
            return (0, helper_format_1.truncate)(`add @${name}${count}`, 60);
        }
        if (action === 'title' && typeof args.title === 'string')
            return (0, helper_format_1.truncate)(`title "${args.title}"`, 60);
        if (action === 'kill' && name)
            return (0, helper_format_1.truncate)(`kill @${name}`, 60);
        if (action === 'model') {
            const target = name ? `@${name}` : '@coordinator';
            const model = typeof args.model === 'string' ? ` → ${args.model}` : '';
            return (0, helper_format_1.truncate)(`model ${target}${model}`, 60);
        }
        if (action)
            return (0, helper_format_1.truncate)(action, 40);
    }
    if (toolName === 'post_message' && typeof args.text === 'string') {
        const ch = typeof args.channel === 'string' && args.channel ? `#${args.channel} ` : '';
        return (0, helper_format_1.truncate)(`${ch}${args.text.split('\n')[0].trim()}`, 60);
    }
    if (toolName === 'read_board') {
        if (args.status === true)
            return 'status';
        const ch = typeof args.channel === 'string' && args.channel ? `#${args.channel} ` : '';
        return typeof args.since === 'number' ? `${ch}since #${args.since}` : (ch ? ch.trim() : 'all');
    }
    if (toolName === 'swarm_wait') {
        const since = typeof args.since === 'number' ? `since #${args.since}` : '';
        const all = args.mentions_only === false ? ' (all)' : '';
        return (0, helper_format_1.truncate)(`wait ${since}${all}`.trim(), 50);
    }
    if (toolName === 'search_web' && typeof args.query === 'string')
        return (0, helper_format_1.truncate)(args.query, 60);
    const keys = Object.keys(args);
    if (keys.length) {
        const first = args[keys[0]];
        if (typeof first === 'string' || typeof first === 'number' || typeof first === 'boolean')
            return (0, helper_format_1.truncate)(String(first), 40);
        return (0, helper_format_1.truncate)(keys.join(', '), 40);
    }
    return '';
}
/**
 * Unwrap Prime's `BashResult(exit_code=0, output='...', duration=0.017)` repr to
 * its output. Null for anything else, including a partial streaming prefix.
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
/** Drives `.message.no-text` (focus mode, tool grouping); shared by static and streaming renderers. */
function messageHasVisibleText(msg) {
    if (!(0, helper_values_1.record)(msg))
        return false;
    if (msg.errorMessage)
        return true;
    if (typeof msg.content === 'string')
        return !!msg.content;
    return Array.isArray(msg.content) && msg.content.some((b) => (0, helper_values_1.record)(b) && ((b.type === 'text' && typeof b.text === 'string' && !!b.text)
        || (b.type === 'image' && ((typeof b.url === 'string' && !!b.url) || (typeof b.data === 'string' && !!b.data)))));
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
/** Live events carry `{ data, mimeType }`; history pages project bytes to `{ url, mimeType }`. mimeType defaults to image/png. */
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
