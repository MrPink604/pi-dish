#!/usr/bin/env node
// Generated edge from skills/pi-dish-sessions/scripts/pi-dish-sessions.ts; edit that source and run npm run build:edges.
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Read and control peer pi coding-agent sessions through the pi-dish HTTP API.
 * Plumbing (discovery, HTTP, refs, transcript rendering) is skills/lib.
 */
const path = require("node:path");
const os = require("node:os");
const node_child_process_1 = require("node:child_process");
let core;
try {
    core = require(path.join(__dirname, '..', '..', 'lib', 'pi-dish-client.js'));
}
catch (e) {
    process.stderr.write(`pi-dish-sessions: could not load the shared pi-dish client library (${e instanceof Error && e.message ? e.message : e}).\n`
        + 'Install the skills by symlinking the skill directories from the pi-dish repo '
        + '(run ./install.sh in the pi-dish checkout) so this script sits next to skills/lib/.\n');
    process.exit(1);
}
const { makeFail, print, defaultBase, discoverSession, fleetCallerId, request, api, jsonInit, requestText, fleetHosts, hostSupports, entryForHostName, resolveSessionRef, mergeSearchResults, renderTranscript, registryEntries, registryRouteId, sessionHarnessId, stableSessionRef, wireArray, } = core;
const fail = makeFail('pi-dish-sessions');
const SHARED_FLAGS = [
    ['--json', 'machine-readable JSON instead of tab-separated lines'],
    ['--host NAME', 'act on a fleet host (see `hosts`); a host-qualified ref implies it'],
    ['--url URL', 'pi-dish base URL (default $PI_DISH_URL, else http://127.0.0.1:3333)'],
    ['--session ID', "this caller's own session id, when discovery cannot infer it"],
];
// Default bounds for agent callers: unbounded transcripts and session lists
// were the bulk of what agents read and then cut down with head/grep/jq. Each
// cut prints one `# …` line saying how to get more (stderr under --json).
const DEFAULT_MAX_CHARS = 12000;
const DEFAULT_LIST_ROWS = 50;
const DEFAULT_SEARCH_ROWS = 20;
const SEARCH_RESULT_CAP = 100;
const SHOW_STRING_CAP = 2000;
const SESSION_FIELDS = [
    'id', 'ref', 'name', 'cwd', 'harnessId', 'model', 'isActive', 'turnInProgress', 'compacting',
    'subagentLive', 'lastActivity', 'messageCount', 'hibernation', 'private',
];
const SEARCH_FIELDS = [...SESSION_FIELDS, 'matchCount', 'searchScore', 'snippets', 'host'];
const MAX_CHARS_FLAG = ['--max-chars N', `cap text output at about N chars (default ${DEFAULT_MAX_CHARS}; 0 = no cap)`];
const FIELDS_FLAG = ['--fields A,B', '--json: keep only these row fields (default: a compact set; `all` = every field)'];
const FULL_FLAG = ['--full', 'lift every default bound (row limit, --max-chars, --fields)'];
const COMMANDS = [
    {
        name: 'list',
        usage: 'list [--active] [--limit N] [--full] [--host NAME] [--json]',
        summary: 'List sessions on a host: live ones first, then historical.',
        flags: [
            ['--active', 'live sessions only (skips the historical scan — much faster)'],
            ['--limit N', `rows to show, live first (default ${DEFAULT_LIST_ROWS})`],
            MAX_CHARS_FLAG, FIELDS_FLAG, FULL_FLAG,
        ],
        example: 'list --active',
    },
    {
        name: 'search',
        usage: 'search <query…> [--limit N] [--full] [--all-hosts | --host NAME] [--json]',
        summary: 'Search every indexed transcript. The corpus is long-term memory — search before re-deriving.',
        flags: [
            ['--limit N', `results to show (default ${DEFAULT_SEARCH_ROWS}, max ${SEARCH_RESULT_CAP})`],
            ['--all-hosts', 'fan out to every reachable host advertising `search` and merge by relevance'],
            MAX_CHARS_FLAG, FIELDS_FLAG, FULL_FLAG,
        ],
        example: 'search "jsonl torn tail" cwd:~/work/api since:30d --limit 5',
        notes: [
            'Grammar: plain terms, "quoted phrases", -negation, name:/cwd:/model:/id:, since:/before:, is:active.',
            "Run `docs search` for ranking and strategy.",
        ],
    },
    {
        name: 'resolve',
        usage: 'resolve <ref> [--fields A,B] [--host NAME] [--json]',
        summary: 'Show what a ref points at (full id, host, name, cwd, state) without touching the session.',
        flags: [FIELDS_FLAG, FULL_FLAG],
        example: 'resolve 8f3ab2c1',
    },
    {
        name: 'read',
        usage: 'read <ref> [--limit N] [--before INDEX] [--thinking] [--max-chars N] [--host NAME]',
        summary: 'Render a session transcript as markdown — the way to recall what another session did.',
        flags: [
            ['--limit N', 'messages in the window, newest last (default 30)'],
            ['--before INDEX', 'page older history; use the index the previous page printed'],
            ['--thinking', 'include thinking blocks (omitted by default)'],
            MAX_CHARS_FLAG, FULL_FLAG,
        ],
        example: 'read 8f3ab2c1 --limit 60',
        notes: ['Past --max-chars the oldest messages of the window are dropped first; the cut line prints the command that pages back to them.'],
    },
    {
        name: 'show',
        usage: 'show <ref> [--limit N] [--before INDEX] [--max-chars N] [--host NAME]',
        summary: 'The same window as `read`, as raw JSON — when you need message ids or metadata.',
        flags: [
            ['--limit N', 'messages in the window (default 20)'],
            ['--before INDEX', 'page older history'],
            ['--max-chars N', `cap the JSON at about N chars (default ${DEFAULT_MAX_CHARS}; 0 = no cap): strings over ${SHOW_STRING_CAP} chars are clipped, then the oldest messages dropped`],
            FIELDS_FLAG, FULL_FLAG,
        ],
        example: 'show 8f3ab2c1 --limit 5',
    },
    {
        name: 'related',
        usage: 'related <ref> [--host NAME] [--json]',
        summary: 'Parents and children: native Pi lineage plus advisory pi-dish launch provenance.',
        flags: [],
        example: 'related 8f3ab2c1',
    },
    {
        name: 'spawn',
        usage: 'spawn [--cwd DIR] [--name NAME] [--harness ID] [--model REF] [--thinking-level LEVEL] [--prompt TEXT] [--private] [--no-wait] [--host NAME] [--json]',
        summary: 'Start an ordinary, durable session (not a subagent) and optionally give it its first prompt.',
        flags: [
            ['--cwd DIR', 'working directory for the new session'],
            ['--name NAME', 'rename the session once it is live; a harness that cannot rename keeps its own title, and the spawn still succeeds'],
            ['--harness ID', 'coding agent to run (default: the harness this session itself runs on)'],
            ['--model REF', 'canonical provider/id model ref (default: the host default)'],
            ['--thinking-level LEVEL', 'reasoning level for the model, such as low, high or max (default: the harness default)'],
            ['--prompt TEXT', 'first prompt, sent once the session is ready'],
            ['--private', 'hidden until the PIN is entered in pi-dish; transcript outside the fleet session backup (pi/omp only; no --prompt)'],
            ['--no-wait', 'return the spawn id immediately instead of waiting for readiness'],
        ],
        example: 'spawn --cwd ~/work/api --name "index audit" --prompt "Audit the session index caps"',
    },
    {
        name: 'send',
        aliases: ['prompt'],
        usage: 'send <ref> <message…> [--host NAME] [--json]',
        summary: 'Send a normal prompt. Mid-turn it is queued; otherwise it starts a turn.',
        flags: [],
        example: 'send 8f3ab2c1 "Check whether the cap is still 4MB"',
        notes: [
            'Carries this caller as its sender. A target host with `messageHoldWindowMs` set holds a peer send for that window instead of interrupting; the answer then reports `held` and `until` (the target is left alone, and a held message to an inactive target waits for an explicit `resume`).',
            'A session that cannot be identified as the sender sends nothing extra, and the host delivers immediately — the unheld behavior.',
        ],
    },
    {
        name: 'steer',
        usage: 'steer <ref> <message…> [--host NAME] [--json]',
        summary: 'Deliver a message *into* the current turn to redirect work already in progress.',
        flags: [],
        example: 'steer 8f3ab2c1 "Stop — the regression is in session-index, not the parser"',
        notes: ['An explicit interruption: it carries no sender and is never held.'],
    },
    {
        name: 'follow-up',
        usage: 'follow-up <ref> <message…> [--host NAME] [--json]',
        summary: 'Queue a message for after the current turn completes.',
        flags: [],
        example: 'follow-up 8f3ab2c1 "Then run the full suite and report the tail"',
        notes: ['Held like `send` when the target host holds peer messages; the answer reports `held` and `until`.'],
    },
    {
        name: 'interrupt',
        aliases: ['abort'],
        usage: 'interrupt <ref> [--host NAME] [--json]',
        summary: 'Abort the current turn. The session stays live.',
        flags: [],
        example: 'interrupt 8f3ab2c1',
    },
    {
        name: 'resume',
        usage: 'resume <ref> [--host NAME] [--json]',
        summary: 'Bring an inactive JSONL session back as a live process.',
        flags: [],
        example: 'resume 8f3ab2c1',
    },
    {
        name: 'close',
        aliases: ['terminate'],
        usage: 'close <ref> [--host NAME] [--json]',
        summary: 'Graceful shutdown (SIGTERM; extension cleanup runs). There is no force-kill.',
        flags: [],
        example: 'close 8f3ab2c1',
    },
    {
        name: 'share',
        usage: 'share <ref> [--host NAME] [--json]',
        summary: 'Publish a read-only public HTML link to a Pi or OMP session transcript (POST /api/sessions/:id/share).',
        flags: [],
        example: 'share 8f3ab2c1',
        notes: [
            'Idempotent: a session that is already shared answers its existing link. Anyone holding the link can read the transcript; the user revokes it in pi-dish.',
            'Prints the absolute URL when the host has a public base, else the /share/<token> path relative to the address the user browses pi-dish at.',
        ],
    },
    {
        name: 'attach',
        usage: 'attach [session-or-query] [--json]',
        summary: "Attach this terminal to a live session's tmux pane (local host only).",
        flags: [],
        example: 'attach refactor-auth',
        notes: [
            'Matches a session id, ref route id, or name/cwd substring; with no query, fzf picks (or the list prints).',
            'Local by design: it joins a tmux pane on this machine, so --host does not apply.',
        ],
    },
    {
        name: 'hosts',
        usage: 'hosts [--max-chars N] [--json]',
        summary: 'List this server and its fleet with reachability and capabilities.',
        flags: [MAX_CHARS_FLAG, ['--fields A,B', '--json: keep only these host fields (name and self always stay)']],
        example: 'hosts',
        notes: ['Absent capability means unsupported — never assume a peer serves what this host serves.'],
    },
    {
        name: 'load',
        usage: 'load [--all-hosts | --host NAME] [--json]',
        summary: "How busy a host is: live/working sessions, CPU, memory and disk.",
        flags: [
            ['--all-hosts', 'every reachable host advertising `hostHealth`, one line each'],
        ],
        example: 'load --all-hosts',
        notes: [
            'A coarse snapshot, not monitoring: CPU is the busy share since the previous reading (or a short sample).',
            'Before starting heavy work (builds, test suites, spawning several peers), check whether another host is idler.',
        ],
    },
    {
        name: 'host',
        usage: 'host [--host NAME] [--json]',
        summary: "Is pi-dish up? This server's identity, version and capabilities (GET /api/host).",
        flags: [],
        example: 'host',
        notes: [
            'There is no /api/health route: `host` is the liveness check (it needs no token) and fails naming the URL when nothing answers; `load` reads GET /api/host/health.',
        ],
    },
    {
        name: 'config',
        usage: 'config [--host NAME] [--json]',
        summary: 'Server features the UI gates on: terminal, tmux, speech-to-text (GET /api/config).',
        flags: [],
        example: 'config --json',
    },
    {
        name: 'usage',
        usage: 'usage [--days 1|7|30|all] [--sort cost|tokens] [--limit N] [--host NAME] [--json]',
        summary: 'Token and cost usage across every session on a host (GET /api/usage-summary).',
        flags: [
            ['--days D', 'range: 1, 7, 30 (default) or all'],
            ['--sort KEY', 'rank groups by cost (default) or tokens'],
            ['--limit N', 'rows per group in the text summary (default 5, max 20); --json is the whole route payload'],
        ],
        example: 'usage --days 7',
    },
    {
        name: 'models',
        usage: 'models [--harness ID] [--cwd DIR] [--max-chars N] [--host NAME] [--json]',
        summary: 'Models a harness can run on a host, with context window and enabled state (GET /api/models).',
        flags: [
            ['--harness ID', 'harness whose catalog to list (default pi)'],
            ['--cwd DIR', 'project directory, for harnesses with per-project model overrides'],
            MAX_CHARS_FLAG,
        ],
        example: 'models --harness omp',
    },
    {
        name: 'docs',
        usage: 'docs [topic] [--host NAME] [--json]',
        summary: "Read the running server's own agent docs (refs, search, sessions, fleet).",
        flags: [],
        example: 'docs refs',
        notes: ['Docs come from the host that serves them, so a mixed-version fleet still reads the truth.'],
    },
    {
        name: 'session',
        aliases: ['self'],
        usage: 'session [--session ID]',
        summary: "Print this caller's own session id (process ancestry against the bridge registry).",
        flags: [],
        example: 'session',
    },
    {
        name: 'help',
        usage: 'help [command]',
        summary: 'This help, or one command in detail.',
        flags: [],
        example: 'help read',
    },
];
const BY_NAME = new Map();
for (const spec of COMMANDS) {
    BY_NAME.set(spec.name, spec);
    for (const alias of spec.aliases || [])
        BY_NAME.set(alias, spec);
}
const REF_EXPLAINER = [
    '  01a070d2                a session id, its uuid tail, or a unique ≥4-char prefix of either',
    '                          (what list/search/resolve print — copy that, never retype a ~sk1_ key)',
    '  tycho/01a070d2          host-qualified: a fleet name, host uuid, or label; self/… is explicit local',
    '  <hostId>:<sessionId>    provenance form (full uuid + full id), as recorded for cross-host spawns',
];
function padded(rows) {
    const width = Math.max(0, ...rows.map(([left]) => left.length));
    return rows.map(([left, right]) => `  ${left.padEnd(width)}  ${right}`);
}
function globalHelp() {
    const lines = [
        'pi-dish-sessions — read and control peer pi coding-agent sessions over the pi-dish API.',
        '',
        'Usage: pi-dish-sessions <command> [args] [flags]',
        '',
        'Session refs (any command taking <ref> accepts all three forms):',
        ...REF_EXPLAINER,
        '',
        'Commands:',
        ...padded(COMMANDS.map((spec) => [
            spec.name + (spec.aliases ? ` (${spec.aliases.join(', ')})` : ''),
            spec.summary,
        ])),
        '',
        'Shared flags:',
        ...padded(SHARED_FLAGS),
        '',
        `Output bounds (default; each cut prints one \`# …\` line saying how to get more, on stderr under --json):`,
        `  list ${DEFAULT_LIST_ROWS} rows, search ${DEFAULT_SEARCH_ROWS} results; read, show and list/search/hosts/models text about ${DEFAULT_MAX_CHARS} chars;`,
        '  list/search/resolve/show --json rows keep a compact field set. Raise with --limit N, --max-chars N (0 = no cap),',
        '  --fields A,B (all = every field); --full lifts them all.',
        '',
        'Environment:',
        ...padded([
            ['PI_DISH_URL', 'default base URL for this server'],
            ['PI_DISH_TOKEN', 'bearer token for this server only; peers are reached through its proxy'],
            ['PI_DISH_SESSION_ID', "override this caller's own session id"],
        ]),
        '',
        "Run 'docs' for server-side topics: refs, search grammar, fleet, session control.",
        "Run 'help <command>' for that command's flags and a worked example.",
    ];
    return lines.join('\n');
}
function commandHelp(name) {
    const spec = BY_NAME.get(name);
    if (!spec)
        return null;
    const lines = [
        `${spec.name}${spec.aliases ? ` (alias: ${spec.aliases.join(', ')})` : ''} — ${spec.summary}`,
        '',
        `Usage: ${spec.usage}`,
    ];
    const flags = [...(spec.flags || []), ...SHARED_FLAGS];
    if (flags.length) {
        lines.push('', 'Flags:', ...padded(flags));
    }
    if (spec.notes?.length)
        lines.push('', 'Notes:', ...spec.notes.map((note) => `  ${note}`));
    lines.push('', 'Example:', `  ${spec.example}`);
    return lines.join('\n');
}
const VALUE_FLAGS = new Map([
    ['--url', 'url'], ['--session', 'session'], ['--cwd', 'cwd'], ['--harness', 'harness'],
    ['--model', 'model'], ['--name', 'name'], ['--prompt', 'prompt'], ['--limit', 'limit'],
    ['--host', 'host'], ['--before', 'before'], ['--max-chars', 'max_chars'], ['--fields', 'fields'],
    ['--days', 'days'], ['--sort', 'sort'], ['--thinking-level', 'thinking_level'],
]);
const BOOL_FLAGS = new Map([
    ['--json', 'json'], ['--active', 'active'], ['--no-wait', 'no_wait'], ['--private', 'private'],
    ['--thinking', 'thinking'], ['--all-hosts', 'all_hosts'], ['--full', 'full'],
]);
function parseArgs(argv) {
    const leading = argv[0];
    const hasCommand = !!leading && !leading.startsWith('-');
    const result = { command: hasCommand ? leading : 'list', explicitCommand: hasCommand, positional: [] };
    for (let i = hasCommand ? 1 : 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === '--help' || arg === '-h')
            result.help = true;
        else if (BOOL_FLAGS.has(arg))
            result[BOOL_FLAGS.get(arg)] = true;
        else if (VALUE_FLAGS.has(arg)) {
            if (i + 1 >= argv.length)
                throw new Error(`${arg} needs a value`);
            result[VALUE_FLAGS.get(arg)] = argv[++i];
        }
        else if (arg.startsWith('-'))
            throw new Error(`unknown option: ${arg}`);
        else
            result.positional.push(arg);
    }
    return result;
}
function intArg(value, fallback, max = 100) {
    return Math.max(1, Math.min(max, Number.parseInt(value || String(fallback), 10) || fallback));
}
/** A command's output bounds: explicit flags win, `--full` lifts the defaults. */
function outputBounds(args, fields) {
    let chars = args.full ? null : DEFAULT_MAX_CHARS;
    if (args.max_chars !== undefined) {
        if (!/^\d+$/.test(args.max_chars))
            throw new Error('--max-chars needs a whole number (0 = no cap)');
        chars = Number(args.max_chars) || null;
    }
    let picked = args.full ? null : fields;
    if (args.fields !== undefined) {
        picked = args.fields === 'all' ? null : args.fields.split(',').map(name => name.trim()).filter(Boolean);
    }
    return { chars, fields: picked };
}
/** A wire row reduced to `fields` (null keeps every field); `keep` always stays. */
function pickFields(row, fields, keep = ['id']) {
    const source = core.record(row ?? {});
    if (!fields)
        return source;
    const picked = {};
    for (const name of [...keep, ...fields])
        if (Object.hasOwn(source, name))
            picked[name] = source[name];
    return picked;
}
/** One `# …` line naming what a bound cut and how to get it: stdout for text, stderr under --json. */
function cutNotice(json, message) {
    (json ? process.stderr : process.stdout).write(`# ${message}\n`);
}
/** Write `text`, cut at the last line boundary within `maxChars` (null: no cap). */
function writeCapped(text, maxChars, more) {
    if (maxChars === null || text.length <= maxChars)
        return void process.stdout.write(text);
    const end = text.lastIndexOf('\n', maxChars - 1);
    const kept = end > 0 ? text.slice(0, end + 1) : `${text.slice(0, maxChars)}\n`;
    process.stdout.write(kept);
    cutNotice(false, `Output cut at --max-chars ${maxChars} (${text.length - kept.length} more chars); ${more}`);
}
/** Clip every string longer than `max` inside a JSON value; `counter.clipped` counts them. */
function clipStrings(value, max, counter) {
    if (typeof value === 'string') {
        if (value.length <= max)
            return value;
        counter.clipped++;
        return `${value.slice(0, max)}…[+${value.length - max} chars]`;
    }
    if (Array.isArray(value))
        return value.map(item => clipStrings(item, max, counter));
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, clipStrings(item, max, counter)]));
    }
    return value;
}
/**
 * Fit a `/messages` window under `maxChars` of pretty JSON: clip long strings
 * first, then drop the oldest messages. The kept window's `firstIndex` moves
 * with it, so `--before firstIndex` pages back to what was dropped.
 */
function boundShow(payload, maxChars) {
    const size = (value) => JSON.stringify(value, null, 2).length;
    if (maxChars === null || size(payload) <= maxChars)
        return { payload, dropped: 0, clipped: 0 };
    const counter = { clipped: 0 };
    const messages = wireArray(payload.messages).map(message => clipStrings(message, SHOW_STRING_CAP, counter));
    let bounded = { ...payload, messages };
    let dropped = 0;
    while (size(bounded) > maxChars && messages.length - dropped > 1) {
        dropped++;
        bounded = { ...payload, messages: messages.slice(dropped) };
        if (typeof payload.firstIndex === 'number')
            bounded.firstIndex = payload.firstIndex + dropped;
        bounded.hasMore = true;
    }
    return { payload: bounded, dropped, clipped: counter.clipped };
}
// Absent means unsupported (mixed-version fleets are the steady state); only
// the capabilities an agent can act on are worth a column.
const AGENT_CAPABILITIES = ['sessions', 'search', 'spawns', 'comments', 'pages', 'terminal', 'resolve', 'docs', 'hostHealth'];
function hostLine(value) {
    const host = core.fleetHost(value);
    const name = host.self ? '(self)' : host.name;
    const state = host.reachable ? 'reachable' : `unreachable:${host.error || 'unknown'}`;
    const capabilities = host.capabilities
        ? (AGENT_CAPABILITIES.filter(key => core.record(host.capabilities)[key]).join(',') || 'none')
        : '-';
    return `${name}\t${state}\t${host.label || host.name || ''}\t${capabilities}`;
}
function sessionLine(session, ref) {
    // `subagent` is a session another live session runs: it has a transcript to
    // read but no socket to drive, so it is neither active nor plain history.
    const state = session.isActive
        ? (session.turnInProgress || session.compacting ? 'working' : 'active')
        : session.subagentLive ? 'subagent' : 'inactive';
    return `${ref || session.id}\t${state}\t${session.name || 'Unnamed'}\t${session.cwd || ''}`;
}
/**
 * The handle each row prints, per host: a non-Pi route id is ~100 base64
 * characters that invite a mistyped retype, so prefer the shortest identifier
 * the host still resolves (normally the uuid tail). Hosts predating ref aliases
 * resolve route-id prefixes only and keep printing full ids.
 */
function refIndex(sessions, entry) {
    const rows = sessions || [];
    const refs = new Map();
    if (!hostSupports(entry, 'refAliases'))
        return refs;
    const ids = rows.map((session) => session.id);
    for (const session of rows)
        refs.set(session.id, stableSessionRef(session.id, ids));
    return refs;
}
function searchRow(session, ref) {
    const when = session.lastActivity ? String(session.lastActivity).slice(0, 10) : '';
    const matches = session.matchCount ? `${session.matchCount} match${session.matchCount === 1 ? '' : 'es'}` : 'metadata match';
    return `${sessionLine(session, ref)}\t${when}\t${matches}`;
}
function snippetText(session) {
    return wireArray(session.snippets).map(snippet => `    …${String(snippet).replace(/\s+/g, ' ').trim()}…\n`).join('');
}
// The local server's identity, for the display ref of a cross-host peer
// message sender (`<label>/<ref>`).
async function localHostIdentity(base) {
    try {
        const host = core.record((await request(base, '/api/host')).data ?? {});
        if (typeof host.hostId !== 'string' || !host.hostId)
            return null;
        return { id: host.hostId, label: typeof host.label === 'string' && /^[a-z0-9][a-z0-9-]{0,31}$/.test(host.label) ? host.label : null };
    }
    catch {
        return null;
    }
}
// The identity stamped on a peer `send`/`follow-up` so the owning host may hold
// it for `messageHoldWindowMs` instead of interrupting a busy session. `steer`
// carries none. An unidentifiable caller yields null and delivers immediately;
// cross-host sends qualify the identity with the host id and this host's label.
async function peerSenderIdentity(base, targetHost, sourceSessionId) {
    if (sourceSessionId == null || sourceSessionId === '')
        return null;
    const self = String(sourceSessionId);
    const entries = registryEntries();
    const entry = entries.find((candidate) => String(registryRouteId(candidate)) === self);
    let name = entry ? String(entry.name || core.record(entry.wrapper ?? {}).name || '') : '';
    let ref = entry ? stableSessionRef(self, entries.map(registryRouteId)) : '';
    if (!name || !ref) {
        // Not (or no longer) in the local registry — e.g. `--session` naming a
        // sibling. Ask the host for the name and the short handle it recommends.
        try {
            const resolved = await resolveSessionRef(base, self, null);
            name = name || String(resolved.session.name || '');
            ref = ref || resolved.ref || '';
        }
        catch { }
    }
    if (!ref)
        ref = stableSessionRef(self, null) || self;
    if (!name)
        name = 'Unnamed';
    if (!targetHost)
        return { id: self, ref, name };
    const host = await localHostIdentity(base);
    if (!host)
        return null;
    return { id: `${host.id}:${self}`, ref: `${host.label || host.id}/${ref}`, name };
}
// A peer spawned from an OMP session is an OMP session: the harness is
// inherited, `--harness` overrides, and the target host's installed set is
// checked here so a missing harness names the alternatives.
async function resolveSpawnHarness(base, host, explicit, callerSessionId) {
    const wanted = explicit || sessionHarnessId(callerSessionId);
    if (!wanted)
        throw new Error(`could not tell which harness ${callerSessionId} runs; pass --harness <id>`);
    let harnesses;
    try {
        harnesses = core.record((await api(base, host, '/api/harnesses')).data).harnesses;
    }
    catch {
        return wanted;
    } // Older host without the route: let it validate.
    if (!Array.isArray(harnesses) || !harnesses.length)
        return wanted;
    const entries = harnesses;
    const match = entries.find((entry) => core.record(entry).id === wanted);
    const usable = entries.filter((entry) => core.record(entry).available !== false).map((entry) => core.record(entry).id);
    const where = host ? ` on ${host}` : '';
    if (!match)
        throw new Error(`unknown harness "${wanted}"${where} (available: ${usable.join(', ') || 'none'})`);
    if (core.record(match).available === false) {
        throw new Error(`harness "${wanted}" is not installed${where}`
            + `${explicit ? '' : ' (inherited from this session)'}; available: ${usable.join(', ') || 'none'}`);
    }
    return wanted;
}
async function createSpawn(base, host, body, callerId) {
    const init = () => jsonInit(body, { 'X-Pi-Dish-Session-Id': callerId });
    try {
        return await api(base, host, '/api/sessions/new', init());
    }
    catch (e) {
        // A server that predates fleet-qualified callers, or a --session it cannot
        // find, refuses the attribution. Provenance is advisory: drop it rather
        // than fail the spawn, and say why.
        const reason = core.errorMessage(e) || '';
        if (!/requestedBySessionId/i.test(reason))
            throw e;
        process.stderr.write(`pi-dish-sessions: ${host || base} did not accept launch provenance (${reason}); spawning unattributed\n`);
        const { requestedBySessionId, ...rest } = body;
        return api(base, host, '/api/sessions/new', jsonInit(rest));
    }
}
async function pollSpawn(base, host, spawnId, timeoutMs = 45000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const result = await api(base, host, `/api/session-spawns/${encodeURIComponent(spawnId)}`);
        if (result.status !== 202) {
            const operation = core.record(result.data);
            if (operation.status !== 'starting')
                return operation;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
    }
    throw new Error(`spawn ${spawnId} did not finish within ${Math.round(timeoutMs / 1000)}s`);
}
const DOCS_UNSUPPORTED = "this host's pi-dish does not serve agent docs; try without --host or upgrade it";
async function listDocs(base, host, json) {
    const entry = await entryForHostName(base, host);
    if (entry && !hostSupports(entry, 'docs'))
        throw new Error(DOCS_UNSUPPORTED);
    let data;
    try {
        ({ data } = await api(base, host, '/api/agent-docs'));
    }
    catch (e) {
        if (core.errorStatus(e) === 404)
            throw new Error(DOCS_UNSUPPORTED);
        throw e;
    }
    const topics = wireArray(core.record(data ?? {}).topics);
    if (json)
        return print({ topics }, true);
    if (!topics.length) {
        process.stdout.write('This host ships no agent docs.\n');
        return;
    }
    for (const value of topics) {
        const topic = core.record(value);
        process.stdout.write(`${topic.name} — ${topic.title || topic.name}\n`);
        if (topic.description)
            process.stdout.write(`    ${topic.description}\n`);
    }
    process.stdout.write("# Read one with: docs <topic>\n");
}
async function showDoc(base, host, topic, json) {
    const entry = await entryForHostName(base, host);
    if (entry && !hostSupports(entry, 'docs'))
        throw new Error(DOCS_UNSUPPORTED);
    let text;
    try {
        ({ text } = await requestText(base, core.hostPath(host, `/api/agent-docs/${encodeURIComponent(topic)}`)));
    }
    catch (e) {
        if (core.errorStatus(e) === 404 && core.errorBody(e).error) {
            // The host serves docs but not this one: name the topics it does have.
            let names = [];
            try {
                const { data } = await api(base, host, '/api/agent-docs');
                names = wireArray(core.record(data ?? {}).topics).map((t) => core.record(t).name);
            }
            catch { }
            throw new Error(`unknown docs topic "${topic}"${names.length ? ` (available: ${names.join(', ')})` : ''}`);
        }
        if (core.errorStatus(e) === 404)
            throw new Error(DOCS_UNSUPPORTED);
        throw e;
    }
    if (json)
        return print({ topic, markdown: text }, true);
    process.stdout.write(text.endsWith('\n') ? text : text + '\n');
}
const FLEET_SEARCH_TIMEOUT_MS = 20000;
function abortInit() {
    // Feature-detected: a sleeping tailnet peer black-holes TCP, and an
    // undeadlined fan-out request would hold the fan-out open for minutes.
    if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function')
        return {};
    return { signal: AbortSignal.timeout(FLEET_SEARCH_TIMEOUT_MS) };
}
async function fleetSearch(base, query, limit, bounds, json) {
    const hosts = await fleetHosts(base);
    if (!hosts)
        throw new Error('--all-hosts needs GET /api/hosts; this server did not answer it');
    const targets = [];
    const skipped = [];
    for (const value of hosts) {
        const entry = core.fleetHost(value);
        if (entry.self) {
            targets.push({ label: '(self)', host: null });
            continue;
        }
        if (!entry.reachable) {
            skipped.push({ label: entry.name, reason: entry.error || 'unreachable' });
            continue;
        }
        if (!hostSupports(entry, 'search')) {
            skipped.push({ label: entry.name, reason: 'does not serve search' });
            continue;
        }
        targets.push({ label: entry.name, host: entry.name });
    }
    const settled = await Promise.allSettled(targets.map((target) => api(base, target.host, `/api/search?q=${encodeURIComponent(query)}`, abortInit())));
    const buckets = [];
    const status = {};
    // Refs are per host: a ref is only short enough to print if the host that
    // owns the session can resolve the short form, and uniqueness is judged
    // against that host's own corpus.
    const refsByHost = new Map();
    for (const skip of skipped)
        status[String(skip.label)] = { status: 'skipped', error: skip.reason };
    settled.forEach((outcome, i) => {
        const target = targets[i];
        if (outcome.status === 'fulfilled') {
            const data = core.record(outcome.value.data ?? {});
            const results = core.sessionRows(data.results);
            buckets.push({ host: target.label, results });
            refsByHost.set(target.label, refIndex(results, hosts.find((value) => {
                const h = core.fleetHost(value);
                return (h.self ? '(self)' : h.name) === target.label;
            })));
            status[String(target.label)] = { status: 'ok', total: data.total ?? results.length, indexing: !!data.indexing };
        }
        else {
            const reason = core.record(outcome.reason ?? {});
            const message = reason?.name === 'TimeoutError' ? `timed out after ${FLEET_SEARCH_TIMEOUT_MS / 1000}s`
                : (reason?.message || 'request failed');
            status[String(target.label)] = { status: 'error', error: message };
        }
    });
    const merged = mergeSearchResults(buckets, limit);
    const available = buckets.reduce((sum, bucket) => sum + (bucket.results?.length || 0), 0);
    const rowCut = merged.length < available
        ? `${available - merged.length} more results not shown; refine the query, raise --limit (max ${SEARCH_RESULT_CAP}) or --full.` : null;
    // A partial result set must look partial: name every host that is missing.
    const unanswered = Object.entries(status).filter(([, value]) => value.status !== 'ok');
    if (json) {
        print({
            results: merged.map((row) => pickFields({
                ...row.session, ref: refsByHost.get(row.host)?.get(row.session.id), host: row.host,
            }, bounds.fields)),
            hosts: status,
        }, true);
        if (rowCut)
            cutNotice(true, rowCut);
        return;
    }
    writeCapped(merged.map((row) => `${row.host}\t${searchRow(row.session, refsByHost.get(row.host)?.get(row.session.id))}\n${snippetText(row.session)}`).join(''), bounds.chars, '--max-chars N or --full for more, or --limit fewer results.');
    if (!merged.length)
        process.stdout.write('No matches.\n');
    if (rowCut)
        cutNotice(false, rowCut);
    for (const [label, value] of unanswered) {
        process.stdout.write(`# ${label} did not answer (${value.error})\n`);
    }
    if (Object.values(status).some((value) => value.indexing)) {
        process.stdout.write('# A session index is still building; results may be partial — retry shortly.\n');
    }
}
const LOAD_UNSUPPORTED = 'this host does not report load (GET /api/host/health); update pi-dish there';
function percent(value) {
    return typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value * 100)}%` : '?';
}
function gib(value) {
    return typeof value === 'number' && Number.isFinite(value) ? `${(value / 1024 ** 3).toFixed(value >= 100 * 1024 ** 3 ? 0 : 1)}G` : '?';
}
function usedShare(value) {
    const bytes = core.record(value ?? {});
    const total = Number(bytes.totalBytes), available = Number(bytes.availableBytes);
    if (!(total > 0) || !Number.isFinite(available))
        return '?';
    return `${percent((total - available) / total)} of ${gib(total)}`;
}
function loadLine(data) {
    const health = core.record(data ?? {});
    const cpu = core.record(health.cpu ?? {}), sessions = core.record(health.sessions ?? {});
    const load = Array.isArray(cpu.load) ? Number(cpu.load[0]).toFixed(2) : '?';
    const live = `${Number(sessions.live) || 0} live, ${Number(sessions.working) || 0} working`;
    return `${live}\tcpu ${percent(cpu.utilization)} load ${load}/${Number(cpu.cores) || '?'}` +
        `\tmem ${usedShare(health.memory)}\tdisk ${usedShare(health.disk)}`;
}
function compactCount(value) {
    const n = Number(value);
    if (!Number.isFinite(n))
        return '?';
    for (const [scale, suffix] of [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']]) {
        if (Math.abs(n) >= scale)
            return `${(n / scale).toFixed(1)}${suffix}`;
    }
    return String(n);
}
function dollars(value) {
    const n = Number(value);
    return Number.isFinite(n) ? `$${n.toFixed(2)}` : '?';
}
function usageCells(value) {
    const row = core.record(value ?? {});
    const tokens = core.record(row.tokens ?? {}), costs = core.record(row.costs ?? {});
    return `${dollars(costs.total)}\t${compactCount(row.calls)} calls\tin ${compactCount(tokens.input)} out ${compactCount(tokens.output)}` +
        ` cache r/w ${compactCount(tokens.cacheRead)}/${compactCount(tokens.cacheWrite)}`;
}
/** `/api/usage-summary` as a short report: totals, spend by period, the top `rows` of each group. */
function usageText(data, rows) {
    const lines = [`usage ${data.range === 'all' ? 'all time' : `last ${data.range}d`}, ranked by ${data.sort}`];
    lines.push(`total\t${usageCells(data.totals)}`);
    const spend = core.record(data.headlineCosts ?? {});
    lines.push(`spend\ttoday ${dollars(spend.today)}\t7d ${dollars(spend.days7)}\t30d ${dollars(spend.days30)}\tmonth ${dollars(spend.month)}\tall ${dollars(spend.all)}`);
    const groups = core.record(data.groups ?? {});
    let cut = false;
    for (const name of ['models', 'providers', 'workspaces', 'sessions']) {
        const list = wireArray(groups[name]);
        if (!list.length)
            continue;
        cut ||= list.length > rows;
        lines.push(`${name} (top ${Math.min(rows, list.length)}):`);
        for (const value of list.slice(0, rows)) {
            const row = core.record(value);
            lines.push(`  ${usageCells(row)}\t${name === 'sessions' ? `${row.name || row.id}\t${row.id}` : row.key}`);
        }
    }
    if (cut)
        lines.push(`# Groups show their top ${rows}; --limit N (max 20) or --json for the whole payload.`);
    if (Number(data.unpricedModelCalls) > 0)
        lines.push(`# ${data.unpricedModelCalls} calls have no known price; their cost is missing from the totals.`);
    if (data.indexing)
        lines.push('# Session index is still building; totals may be partial — retry shortly.');
    return lines.join('\n') + '\n';
}
function modelLine(value) {
    const model = core.record(value ?? {});
    const flags = [
        model.reasoning || (Array.isArray(model.thinking) && model.thinking.length) ? 'reasoning' : '',
        model.free ? 'free' : '',
        model.enabled === false ? 'disabled' : '',
    ].filter(Boolean).join(',');
    const context = Number(model.contextWindow) > 0 ? compactCount(model.contextWindow) : '?';
    return `${model.selector || `${model.provider}/${model.id}`}\t${model.name || model.id}\tctx ${context}\t${flags || '-'}`;
}
async function fleetLoad(base, json) {
    const hosts = await fleetHosts(base);
    if (!hosts)
        throw new Error('--all-hosts needs GET /api/hosts; this server did not answer it');
    const status = {};
    const targets = [];
    for (const value of hosts) {
        const entry = core.fleetHost(value);
        const label = entry.self ? '(self)' : String(entry.name);
        if (!entry.self && !entry.reachable) {
            status[label] = { status: 'skipped', error: entry.error || 'unreachable' };
            continue;
        }
        if (!hostSupports(entry, 'hostHealth')) {
            status[label] = { status: 'skipped', error: 'does not report load' };
            continue;
        }
        // A placeholder keeps the printed order the fleet's order.
        status[label] = { status: 'pending' };
        targets.push({ label, host: entry.self ? null : String(entry.name) });
    }
    const settled = await Promise.allSettled(targets.map(target => api(base, target.host, '/api/host/health', abortInit())));
    settled.forEach((outcome, i) => {
        const label = targets[i].label;
        if (outcome.status === 'fulfilled')
            status[label] = { status: 'ok', ...core.record(outcome.value.data ?? {}) };
        else {
            const reason = core.record(outcome.reason ?? {});
            status[label] = { status: 'error', error: reason?.name === 'TimeoutError' ? 'timed out' : (reason?.message || 'request failed') };
        }
    });
    if (json)
        return print({ hosts: status }, true);
    for (const [label, value] of Object.entries(status)) {
        const row = core.record(value);
        process.stdout.write(row.status === 'ok' ? `${label}\t${loadLine(row)}\n` : `# ${label}: ${row.error}\n`);
    }
}
function commandExists(cmd) {
    try {
        (0, node_child_process_1.execFileSync)('which', [cmd], { stdio: 'ignore' });
        return true;
    }
    catch {
        return false;
    }
}
function activeTmuxEntries() {
    const entries = registryEntries();
    const seen = new Set();
    const result = [];
    for (const entry of entries) {
        const tmux = core.record(entry.tmux ?? {});
        if (!tmux.socket || !tmux.pane)
            continue;
        const key = `${tmux.socket}#${tmux.pane}`;
        if (seen.has(key))
            continue;
        seen.add(key);
        let winName = null;
        try {
            winName = (0, node_child_process_1.execFileSync)('tmux', ['-S', String(tmux.socket), 'display-message', '-p', '-t', String(tmux.pane), '#{window_name}'], { encoding: 'utf8', timeout: 1000 }).trim() || null;
        }
        catch { }
        result.push({
            harness: core.record(entry.wrapper ?? {}).name || entry.harnessId || 'Pi',
            name: entry.name || winName || 'Unnamed',
            state: entry.turnInProgress ? 'working' : (entry.compacting ? 'compacting' : 'idle'),
            cwd: entry.cwd ? core.stringValue(entry.cwd, 'entry.cwd.replace is not a function').replace(os.homedir(), '~') : '',
            model: entry.model || '',
            socket: tmux.socket,
            pane: tmux.pane,
            sessionId: entry.sessionId,
            routeId: registryRouteId(entry),
            pid: entry.pid,
            updatedAt: entry.updatedAt || null,
        });
    }
    result.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return result;
}
function attachToTmux(socket, pane) {
    const isInsideTmux = Boolean(process.env.TMUX);
    const currentTmuxSocket = isInsideTmux ? process.env.TMUX?.split(',')[0] : null;
    try {
        (0, node_child_process_1.execFileSync)('tmux', ['-S', String(socket), 'select-window', '-t', String(pane)], { stdio: 'ignore', timeout: 2000 });
        (0, node_child_process_1.execFileSync)('tmux', ['-S', String(socket), 'select-pane', '-t', String(pane)], { stdio: 'ignore', timeout: 2000 });
    }
    catch { }
    // Malformed socket metadata is still Node's path-validation error here;
    // listing it as JSON above did not require it to be a string.
    const resolvedSocket = isInsideTmux && currentTmuxSocket
        ? (typeof socket === 'string' ? path.resolve(socket) : Reflect.apply(path.resolve, path, [socket]))
        : null;
    if (isInsideTmux && currentTmuxSocket && path.resolve(currentTmuxSocket) === resolvedSocket) {
        (0, node_child_process_1.execFileSync)('tmux', ['-S', String(socket), 'switch-client', '-t', String(pane)], { stdio: 'inherit' });
    }
    else {
        // A nested attach needs $TMUX gone, same as the server's pane-view PTY.
        const env = { ...process.env };
        delete env.TMUX;
        delete env.TMUX_PANE;
        (0, node_child_process_1.spawnSync)('tmux', ['-S', String(socket), 'attach-session', '-t', String(pane)], { stdio: 'inherit', env });
    }
}
function pickSessionWithFzf(entries) {
    return new Promise((resolve, reject) => {
        const fzf = (0, node_child_process_1.spawn)('fzf', [
            '--exit-0',
            '--delimiter=\t',
            '--with-nth=1',
            '--preview-window=right:60%:wrap',
            '--preview', 'tmux -S {2} capture-pane -ep -t {3} 2>/dev/null',
            '--header=Enter: attach | Esc: cancel',
            '--prompt=Pi-Dish Session > ',
        ], { stdio: ['pipe', 'pipe', 'inherit'] });
        let stdout = '';
        fzf.stdout.on('data', chunk => { stdout += chunk.toString(); });
        fzf.on('close', code => {
            if (code !== 0 || !stdout.trim())
                return resolve(null);
            const parts = stdout.trim().split('\t');
            const socket = parts[1];
            const pane = parts[2];
            const match = entries.find(e => e.socket === socket && e.pane === pane);
            resolve(match || { socket, pane });
        });
        fzf.on('error', err => {
            if (core.record(err).code === 'ENOENT')
                resolve(null);
            else
                reject(err);
        });
        for (const e of entries) {
            const tag = `[${e.harness}]`.padEnd(10);
            const title = core.stringValue(e.name, 'e.name.padEnd is not a function').padEnd(28);
            const state = `(${e.state})`.padEnd(11);
            const cwd = e.cwd ? `${e.cwd}` : '';
            const model = e.model ? `[${e.model}]` : '';
            const display = `${tag} ${title} ${state} ${cwd}  ${model}`.trim();
            fzf.stdin.write(`${display}\t${e.socket}\t${e.pane}\t${e.sessionId}\n`);
        }
        fzf.stdin.end();
    });
}
async function runAttach(args) {
    const targetQuery = args.positional.join(' ').trim();
    const entries = activeTmuxEntries();
    if (!entries.length) {
        throw new Error('no active tmux-managed pi-dish sessions found');
    }
    let selected = null;
    if (targetQuery) {
        selected = entries.find(e => e.sessionId === targetQuery || e.routeId === targetQuery
            || (e.name != null && core.stringValue(e.name, 'e.name?.toLowerCase is not a function').toLowerCase() === targetQuery.toLowerCase()))
            || entries.find(e => (e.name != null && core.stringValue(e.name, 'e.name?.toLowerCase is not a function').toLowerCase().includes(targetQuery.toLowerCase()))
                || e.cwd?.toLowerCase().includes(targetQuery.toLowerCase()));
        if (!selected)
            throw new Error(`no active session matches "${targetQuery}"`);
    }
    else {
        if (!process.stdout.isTTY || !commandExists('fzf')) {
            if (args.json)
                return print(entries, true);
            for (let i = 0; i < entries.length; i++) {
                const e = entries[i];
                process.stdout.write(`[${i + 1}] ${e.harness}\t${e.name}\t${e.state}\t${e.cwd}\t${e.socket} ${e.pane}\n`);
            }
            return;
        }
        selected = await pickSessionWithFzf(entries);
        if (!selected)
            return;
    }
    if (args.json)
        return print(selected, true);
    attachToTmux(selected.socket, selected.pane);
}
const REF_COMMANDS = new Set(['resolve', 'read', 'show', 'related', 'send', 'steer', 'follow-up', 'interrupt', 'resume', 'close', 'share']);
async function main() {
    let args;
    try {
        args = parseArgs(process.argv.slice(2));
    }
    catch (e) {
        return fail(core.errorMessage(e));
    }
    const spec = BY_NAME.get(args.command);
    if (args.help) {
        // A bare `--help` (no command word) is the global help, not `list`'s.
        const help = args.explicitCommand && spec && spec.name !== 'help' ? commandHelp(spec.name) : globalHelp();
        return process.stdout.write(help + '\n');
    }
    if (args.command === 'help') {
        const wanted = args.positional[0];
        if (!wanted)
            return process.stdout.write(globalHelp() + '\n');
        const help = commandHelp(wanted);
        if (!help)
            return fail(`unknown command: ${wanted} (run --help for the command list)`);
        return process.stdout.write(help + '\n');
    }
    if (!spec)
        return fail(`unknown command: ${args.command} (run --help for the command list)`);
    const base = defaultBase(args.url);
    // This session's own identity is always resolved locally, so `session`
    // ignores --host; every other command routes through it.
    const hostFlag = args.host || null;
    try {
        if (spec.name === 'session') {
            print(discoverSession(args.session, { noneMessage: 'no live pi-dish bridge sessions found; pass --session <id>' }), args.json);
            return;
        }
        if (spec.name === 'attach') {
            return await runAttach(args);
        }
        if (spec.name === 'hosts') {
            const bounds = outputBounds(args, null);
            const { data } = await request(base, '/api/hosts');
            if (args.json && !bounds.fields)
                return print(data, true);
            const hosts = wireArray(core.record(data).hosts);
            if (args.json)
                return print({ ...core.record(data), hosts: hosts.map(entry => pickFields(entry, bounds.fields, ['name', 'self'])) }, true);
            writeCapped(hosts.map(entry => hostLine(entry) + '\n').join(''), bounds.chars, '--max-chars N or --full for more, or --json --fields name,reachable.');
            const remotes = hosts.filter(entry => !core.fleetHost(entry).self);
            if (remotes.length)
                process.stdout.write('# Add --host <name> to any command to act on that host.\n');
            else
                process.stdout.write('# No remotes configured; this host is the whole fleet.\n');
            return;
        }
        if (spec.name === 'host') {
            const url = base + core.hostPath(hostFlag, '');
            let data;
            try {
                ({ data } = await api(base, hostFlag, '/api/host'));
            }
            catch (error) {
                if (core.errorStatus(error) === undefined)
                    throw new Error(`no pi-dish answering at ${url} (${core.errorMessage(error)})`);
                throw error;
            }
            if (args.json)
                return print(data, true);
            const info = core.record(data ?? {});
            const capabilities = core.record(info.capabilities ?? {});
            process.stdout.write([
                `up: ${url}`,
                `hostId: ${info.hostId ?? ''}`,
                `label: ${info.label ?? ''}`,
                `version: ${info.version ?? ''}`,
                `capabilities: ${Object.keys(capabilities).filter(key => capabilities[key]).join(',') || 'none'}`,
            ].join('\n') + '\n');
            return;
        }
        if (spec.name === 'config') {
            const { data } = await api(base, hostFlag, '/api/config');
            if (args.json)
                return print(data, true);
            for (const [key, value] of Object.entries(core.record(data ?? {})))
                process.stdout.write(`${key}: ${typeof value === 'string' ? value : JSON.stringify(value)}\n`);
            return;
        }
        if (spec.name === 'usage') {
            const params = new URLSearchParams({ days: args.days || '30', sort: args.sort || 'cost' });
            const { data } = await api(base, hostFlag, `/api/usage-summary?${params}`);
            if (args.json)
                return print(data, true);
            process.stdout.write(usageText(core.record(data ?? {}), intArg(args.limit, 5, 20)));
            return;
        }
        if (spec.name === 'models') {
            const bounds = outputBounds(args, null);
            const params = new URLSearchParams();
            if (args.harness)
                params.set('harness', args.harness);
            if (args.cwd)
                params.set('cwd', args.cwd);
            const { data } = await api(base, hostFlag, `/api/models${params.size ? `?${params}` : ''}`);
            if (args.json)
                return print(data, true);
            const models = wireArray(data);
            writeCapped(models.map(model => modelLine(model) + '\n').join(''), bounds.chars, '--max-chars N or --full for more, or --json and filter.');
            if (!models.length)
                process.stdout.write('No models.\n');
            return;
        }
        if (spec.name === 'load') {
            if (args.all_hosts && hostFlag)
                throw new Error('--all-hosts and --host are mutually exclusive');
            if (args.all_hosts)
                return await fleetLoad(base, args.json);
            const entry = await entryForHostName(base, hostFlag);
            if (entry && !hostSupports(entry, 'hostHealth'))
                throw new Error(LOAD_UNSUPPORTED);
            let data;
            try {
                ({ data } = await api(base, hostFlag, '/api/host/health'));
            }
            catch (error) {
                if (core.record(error ?? {}).status === 404)
                    throw new Error(LOAD_UNSUPPORTED);
                throw error;
            }
            if (args.json)
                return print(data, true);
            process.stdout.write(`${hostFlag || '(self)'}\t${loadLine(data)}\n`);
            return;
        }
        if (spec.name === 'docs') {
            const topic = args.positional[0];
            if (!topic)
                return await listDocs(base, hostFlag, args.json);
            return await showDoc(base, hostFlag, topic, args.json);
        }
        if (spec.name === 'list') {
            const bounds = outputBounds(args, SESSION_FIELDS);
            const limit = args.full ? Infinity : intArg(args.limit, DEFAULT_LIST_ROWS, Infinity);
            const qs = args.active ? '?active=1' : '';
            const { data } = await api(base, hostFlag, `/api/sessions${qs}`);
            if (args.json && (!data || typeof data !== 'object'))
                return print(data, true);
            // `children` is what `--active` returns for subagents running inside a
            // live session: real sessions with transcripts, absent from `previous`
            // on that request (and already in it on a full list).
            const catalog = core.record(data);
            const rows = [...core.sessionRows(catalog.active), ...core.sessionRows(catalog.children), ...core.sessionRows(catalog.previous)];
            // Refs are judged against the whole catalog, never just the rows shown.
            const refs = refIndex(rows, await entryForHostName(base, hostFlag));
            const rowCut = rows.length > limit ? `Showing ${limit} of ${rows.length} sessions (live first); --limit N or --full for more.` : null;
            if (args.json) {
                let left = limit;
                const take = (group) => {
                    const kept = core.sessionRows(group).slice(0, left);
                    left -= kept.length;
                    return kept.map(session => pickFields({ ...session, ref: refs.get(session.id) }, bounds.fields));
                };
                const active = take(catalog.active), children = take(catalog.children), previous = take(catalog.previous);
                print({ ...catalog, active, previous, children, total: rows.length }, true);
                if (rowCut)
                    cutNotice(true, rowCut);
                return;
            }
            writeCapped(rows.slice(0, limit).map(session => sessionLine(session, refs.get(session.id)) + '\n').join(''), bounds.chars, '--max-chars N or --full for more, or --limit fewer rows.');
            if (rowCut)
                cutNotice(false, rowCut);
            if (catalog.indexing)
                process.stdout.write('# Session index is still building; repeat list for more.\n');
            if (catalog.discoveryTruncated)
                process.stdout.write('# Nested session discovery reached its safety limit.\n');
            return;
        }
        if (spec.name === 'spawn') {
            const sourceSessionId = discoverSession(args.session, { noneMessage: 'no live pi-dish bridge sessions found; pass --session <id>' });
            // Advisory launch provenance always names the caller fleet-globally, so
            // it is valid on whichever host PI_DISH_URL or --host reaches.
            const callerId = fleetCallerId(sourceSessionId);
            const harness = await resolveSpawnHarness(base, hostFlag, args.harness, sourceSessionId);
            const body = { async: true, requestedBySessionId: callerId, harness };
            if (args.cwd)
                body.cwd = args.cwd;
            if (args.model)
                body.model = args.model;
            if (args.thinking_level)
                body.thinking = args.thinking_level;
            // A private session is invisible to this CLI once spawned: name it in the
            // spawn request, and it cannot take a first prompt.
            if (args.private) {
                if (args.prompt)
                    throw new Error('--private cannot be combined with --prompt: private sessions are hidden from the API until the PIN is entered in pi-dish');
                body.private = true;
                if (args.name)
                    body.name = args.name;
            }
            const { data } = await createSpawn(base, hostFlag, body, callerId);
            if (args.no_wait)
                return print({ ...core.record(data ?? {}), harness }, args.json);
            const spawnId = core.record(data).spawnId;
            if (typeof spawnId !== 'string')
                throw new TypeError('spawn response did not report a spawnId');
            const operation = await pollSpawn(base, hostFlag, spawnId);
            if (operation.status === 'error')
                throw new Error(String(operation.error || 'session spawn failed'));
            const id = operation.sessionId;
            if (typeof id !== 'string')
                throw new TypeError('spawn response did not report a sessionId');
            // A name is cosmetic. A harness that cannot rename must not leave a
            // launched session without its prompt, or report the spawn as failed.
            let nameError;
            if (args.name && !args.private) {
                try {
                    await api(base, hostFlag, `/api/sessions/${encodeURIComponent(id)}/rename`, jsonInit({ name: args.name }));
                }
                catch (error) {
                    nameError = core.errorMessage(error);
                    process.stderr.write(`pi-dish-sessions: session started but not named (${nameError})\n`);
                }
            }
            if (args.prompt)
                await api(base, hostFlag, `/api/sessions/${encodeURIComponent(id)}/prompt`, jsonInit({ message: args.prompt }));
            return print({
                ...operation, spawnId, sessionId: id, harness,
                ...(hostFlag ? { host: hostFlag } : {}), ...(nameError ? { nameError } : {}),
            }, args.json);
        }
        if (spec.name === 'search') {
            const query = args.positional.join(' ').trim();
            if (!query)
                throw new Error('search needs a query');
            const bounds = outputBounds(args, SEARCH_FIELDS);
            const limit = args.full ? SEARCH_RESULT_CAP : intArg(args.limit, DEFAULT_SEARCH_ROWS, SEARCH_RESULT_CAP);
            if (args.all_hosts && hostFlag)
                throw new Error('--all-hosts and --host are mutually exclusive');
            if (args.all_hosts)
                return await fleetSearch(base, query, limit, bounds, args.json);
            const { data } = await api(base, hostFlag, `/api/search?q=${encodeURIComponent(query)}`);
            const search = core.record(data);
            const results = core.sessionRows(search.results).slice(0, limit);
            const searchRefs = refIndex(results, await entryForHostName(base, hostFlag));
            const rowCut = Number(search.total) > results.length
                ? `${Number(search.total) - results.length} more results not shown; refine the query, raise --limit (max ${SEARCH_RESULT_CAP}) or --full.` : null;
            if (args.json) {
                print({ ...search, results: results.map(session => pickFields({ ...session, ref: searchRefs.get(session.id) }, bounds.fields)) }, true);
                if (rowCut)
                    cutNotice(true, rowCut);
                return;
            }
            writeCapped(results.map(session => `${searchRow(session, searchRefs.get(session.id))}\n${snippetText(session)}`).join(''), bounds.chars, '--max-chars N or --full for more, or --limit fewer results.');
            if (!results.length)
                process.stdout.write('No matches.\n');
            if (rowCut)
                cutNotice(false, rowCut);
            if (search.indexing)
                process.stdout.write('# Session index is still building; results may be partial — retry shortly.\n');
            return;
        }
        if (!REF_COMMANDS.has(spec.name))
            throw new Error(`unknown command: ${args.command}`);
        const ref = args.positional.shift();
        if (!ref)
            throw new Error(`${spec.name} needs a target session ref (run 'help ${spec.name}')`);
        // Every session-scoped command resolves its ref first: a full id resolves
        // to itself, so callers passing bare ids are unaffected, and the resolved
        // host is what routes the call from here on.
        const target = await resolveSessionRef(base, ref, hostFlag);
        const host = target.host;
        const id = target.id;
        if (spec.name === 'resolve') {
            if (args.json) {
                const { fields } = outputBounds(args, SESSION_FIELDS);
                return print({ host, id, ref: target.ref || null, session: pickFields(target.session, fields) }, true);
            }
            const session = target.session;
            // The short ref first: it is what the caller should keep, and the full
            // id below it is what the routes speak.
            if (target.ref && target.ref !== id)
                process.stdout.write(`ref: ${host ? `${host}/` : ''}${target.ref}\n`);
            process.stdout.write(`${id}\n`);
            process.stdout.write(`host: ${host || '(self)'}\n`);
            process.stdout.write(`name: ${session.name || 'Unnamed'}\n`);
            process.stdout.write(`cwd: ${session.cwd || ''}\n`);
            process.stdout.write(`state: ${session.isActive ? 'active' : 'inactive'}\n`);
            if (session.lastActivity)
                process.stdout.write(`last activity: ${session.lastActivity}\n`);
            return;
        }
        if (spec.name === 'read') {
            const limit = intArg(args.limit, 30, 500);
            const before = args.before != null ? `&before=${encodeURIComponent(args.before)}` : '';
            const { data } = await api(base, host, `/api/sessions/${encodeURIComponent(id)}/messages?limit=${limit}${before}`);
            // The route's own `session` is the richer one (model, context, cwd);
            // the resolved list entry backfills what it does not carry.
            const payload = { ...core.record(data), session: { ...target.session, ...core.record(core.record(data).session ?? {}) } };
            process.stdout.write(renderTranscript(payload, {
                ref, host, limit, thinking: !!args.thinking, maxChars: outputBounds(args, null).chars,
            }));
            return;
        }
        if (spec.name === 'show') {
            const bounds = outputBounds(args, SESSION_FIELDS);
            const limit = intArg(args.limit, 20);
            const before = args.before != null ? `&before=${encodeURIComponent(args.before)}` : '';
            const messages = await api(base, host, `/api/sessions/${encodeURIComponent(id)}/messages?limit=${limit}${before}`);
            const window = { session: target.session, ...core.record(messages.data ?? {}) };
            const shown = boundShow({ ...window, session: pickFields(window.session, bounds.fields) }, bounds.chars);
            print(shown.payload, true);
            if (shown.dropped || shown.clipped) {
                const parts = [
                    shown.clipped ? `${shown.clipped} string${shown.clipped === 1 ? '' : 's'} clipped to ${SHOW_STRING_CAP} chars` : '',
                    shown.dropped ? `the ${shown.dropped} oldest message${shown.dropped === 1 ? '' : 's'} dropped (show ${ref} --limit ${limit} --before ${shown.payload.firstIndex} pages back)` : '',
                ].filter(Boolean);
                cutNotice(true, `show cut to fit --max-chars ${bounds.chars}: ${parts.join('; ')}; --max-chars 0 or --full for everything.`);
            }
            return;
        }
        if (spec.name === 'share') {
            const { data } = await api(base, host, `/api/sessions/${encodeURIComponent(id)}/share`, jsonInit({}));
            if (args.json)
                return print(data, true);
            const link = core.record(data ?? {});
            process.stdout.write(`${link.url || link.path}\n`);
            return;
        }
        if (spec.name === 'related') {
            const { data } = await api(base, host, `/api/sessions/${encodeURIComponent(id)}/related`);
            if (args.json)
                return print(data, true);
            const relations = wireArray(core.record(data).relations);
            for (const value of relations) {
                const relation = core.record(value);
                const session = core.record(relation.session);
                process.stdout.write(`${relation.kind}\t${session.id}\t${session.name || 'Unnamed'}\t${relation.source}\n`);
            }
            if (!relations.length)
                process.stdout.write('No related sessions.\n');
            return;
        }
        if (spec.name === 'send' || spec.name === 'steer' || spec.name === 'follow-up') {
            const message = args.positional.join(' ').trim();
            if (!message)
                throw new Error(`${args.command} needs message text`);
            const route = spec.name === 'send' ? 'prompt' : spec.name;
            const body = { message };
            if (spec.name !== 'steer') {
                // `steer` interrupts now, so it carries no sender and is never held.
                const sender = await peerSenderIdentity(base, host, core.discoverSessionQuietly(args.session));
                if (sender)
                    body.sender = sender;
            }
            const { data } = await api(base, host, `/api/sessions/${encodeURIComponent(id)}/${route}`, jsonInit(body));
            return print(data, args.json);
        }
        const route = spec.name === 'interrupt' ? 'abort' : spec.name === 'resume' ? 'resume' : 'close';
        const { data } = await api(base, host, `/api/sessions/${encodeURIComponent(id)}/${route}`, jsonInit({}));
        print(data, args.json);
    }
    catch (e) {
        fail(core.errorMessage(e));
    }
}
main();
