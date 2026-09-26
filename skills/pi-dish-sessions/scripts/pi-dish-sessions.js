#!/usr/bin/env node
// Generated edge from skills/pi-dish-sessions/scripts/pi-dish-sessions.ts; edit that source and run npm run build:edges.
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * pi-dish-sessions — read and control peer pi coding-agent sessions through
 * the pi-dish HTTP API.
 *
 * The plumbing (session discovery, HTTP, ref resolution, transcript
 * rendering) lives in skills/lib/pi-dish-client.js. Skills are installed by
 * symlinking each skill directory into ~/.pi/agent/skills/, and Node resolves
 * requires through the realpath, so this relative path reaches the pi-dish
 * repo's own copy even when invoked through the link.
 */
const path = require("node:path");
const os = require("node:os");
const node_child_process_1 = require("node:child_process");
let core;
try {
    core = require(path.join(__dirname, '..', '..', 'lib', 'pi-dish-client.js'));
}
catch (e) {
    process.stderr.write('pi-dish-sessions: could not load the shared pi-dish client library '
        + `(${e instanceof Error && e.message ? e.message : e}).\n`
        + 'Install the skills by symlinking the skill directories from the pi-dish repo '
        + '(run ./install.sh in the pi-dish checkout) so this script sits next to skills/lib/.\n');
    process.exit(1);
}
const { makeFail, print, defaultBase, discoverSession, request, api, jsonInit, requestText, fleetHosts, hostSupports, entryForHostName, resolveSessionRef, mergeSearchResults, renderTranscript, registryEntries, registryRouteId, sessionHarnessId, stableSessionRef, } = core;
const fail = makeFail('pi-dish-sessions');
function wireArray(value) { return Array.isArray(value) ? value : []; }
const SHARED_FLAGS = [
    ['--json', 'machine-readable JSON instead of tab-separated lines'],
    ['--host NAME', 'act on a fleet host (see `hosts`); a host-qualified ref implies it'],
    ['--url URL', 'pi-dish base URL (default $PI_DISH_URL, else http://127.0.0.1:3333)'],
    ['--session ID', "this caller's own session id, when discovery cannot infer it"],
];
const COMMANDS = [
    {
        name: 'list',
        usage: 'list [--active] [--host NAME] [--json]',
        summary: 'List sessions on a host: live ones first, then historical.',
        flags: [['--active', 'live sessions only (skips the historical scan — much faster)']],
        example: 'list --active',
    },
    {
        name: 'search',
        usage: 'search <query…> [--limit N] [--all-hosts | --host NAME] [--json]',
        summary: 'Search every indexed transcript. The corpus is long-term memory — search before re-deriving.',
        flags: [
            ['--limit N', 'results to show (default 20)'],
            ['--all-hosts', 'fan out to every reachable host advertising `search` and merge by relevance'],
        ],
        example: 'search "jsonl torn tail" cwd:~/work/api since:30d --limit 5',
        notes: [
            'Grammar: plain terms, "quoted phrases", -negation, name:/cwd:/model:/id:, since:/before:, is:active.',
            "Run `docs search` for ranking and strategy.",
        ],
    },
    {
        name: 'resolve',
        usage: 'resolve <ref> [--host NAME] [--json]',
        summary: 'Show what a ref points at (full id, host, name, cwd, state) without touching the session.',
        flags: [],
        example: 'resolve 8f3ab2c1',
    },
    {
        name: 'read',
        usage: 'read <ref> [--limit N] [--before INDEX] [--thinking] [--host NAME]',
        summary: 'Render a session transcript as markdown — the way to recall what another session did.',
        flags: [
            ['--limit N', 'messages in the window, newest last (default 30)'],
            ['--before INDEX', 'page older history; use the index the previous page printed'],
            ['--thinking', 'include thinking blocks (omitted by default)'],
        ],
        example: 'read 8f3ab2c1 --limit 60',
    },
    {
        name: 'show',
        usage: 'show <ref> [--limit N] [--host NAME]',
        summary: 'The same window as `read`, as raw JSON — when you need message ids or metadata.',
        flags: [['--limit N', 'messages in the window (default 20)']],
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
        usage: 'spawn [--cwd DIR] [--name NAME] [--harness ID] [--model REF] [--prompt TEXT] [--no-wait] [--host NAME] [--json]',
        summary: 'Start an ordinary, durable session (not a subagent) and optionally give it its first prompt.',
        flags: [
            ['--cwd DIR', 'working directory for the new session'],
            ['--name NAME', 'rename the session once it is live'],
            ['--harness ID', 'coding agent to run (default: the harness this session itself runs on)'],
            ['--model REF', 'canonical provider/id model ref (default: the host default)'],
            ['--prompt TEXT', 'first prompt, sent once the session is ready'],
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
    },
    {
        name: 'steer',
        usage: 'steer <ref> <message…> [--host NAME] [--json]',
        summary: 'Deliver a message *into* the current turn to redirect work already in progress.',
        flags: [],
        example: 'steer 8f3ab2c1 "Stop — the regression is in session-index, not the parser"',
    },
    {
        name: 'follow-up',
        usage: 'follow-up <ref> <message…> [--host NAME] [--json]',
        summary: 'Queue a message for after the current turn completes.',
        flags: [],
        example: 'follow-up 8f3ab2c1 "Then run the full suite and report the tail"',
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
        usage: 'hosts [--json]',
        summary: 'List this server and its fleet with reachability and capabilities.',
        flags: [],
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
// =========================================================================
// Argument parsing
// =========================================================================
const VALUE_FLAGS = new Map([
    ['--url', 'url'], ['--session', 'session'], ['--cwd', 'cwd'], ['--harness', 'harness'],
    ['--model', 'model'], ['--name', 'name'], ['--prompt', 'prompt'], ['--limit', 'limit'],
    ['--host', 'host'], ['--before', 'before'],
]);
const BOOL_FLAGS = new Map([
    ['--json', 'json'], ['--active', 'active'], ['--no-wait', 'no_wait'],
    ['--thinking', 'thinking'], ['--all-hosts', 'all_hosts'],
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
// =========================================================================
// Output formatting
// =========================================================================
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
 * The handle each row prints, per host. A non-Pi route id is ~100 base64
 * characters whose first ~30 are identical for every session of that harness
 * on the host, so printing it invites an agent to retype it — and a mistyped
 * key still decodes, leaving the server nothing to say but "not found".
 * `stableSessionRef` picks the shortest *identifier* that still resolves
 * there (normally the uuid tail) and leaves a route id whole rather than
 * printing a snapshot-unique truncation of it.
 * A host that predates ref aliases resolves route-id prefixes only, so its
 * rows keep printing full ids.
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
function writeSnippets(session) {
    for (const snippet of wireArray(session.snippets)) {
        process.stdout.write(`    …${String(snippet).replace(/\s+/g, ' ').trim()}…\n`);
    }
}
// =========================================================================
// Spawn helpers
// =========================================================================
// Host-qualified caller identity (`<hostId>:<sessionId>`, TASKS/multi-host.md
// block 6): still advisory, still just the existing provenance fields — the
// qualifier only says which host the id belongs to.
async function qualifyCaller(base, sessionId) {
    try {
        const { data } = await request(base, '/api/host');
        return core.record(data ?? {}).hostId ? `${core.record(data).hostId}:${sessionId}` : sessionId;
    }
    catch {
        return sessionId;
    }
}
// A peer spawned from an OMP session should be an OMP session: the harness is
// inherited from the caller, not defaulted to Pi (the HTTP route's own default,
// kept for the web UI's explicit selection). `--harness` overrides. The target
// host is asked what it actually has, so a missing harness fails here naming
// the alternatives instead of dying inside a launch.
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
    const init = () => jsonInit(body, { 'X-Pi-Dish-Session-Id': String(callerId) });
    try {
        return await api(base, host, '/api/sessions/new', init());
    }
    catch (e) {
        // A host resolves provenance ids against its own sessions, so a peer may
        // refuse a foreign caller. Provenance is advisory: drop the attribution
        // rather than fail the spawn.
        if (!host || !/requestedBySessionId/i.test(core.errorMessage(e) || ''))
            throw e;
        process.stderr.write(`pi-dish-sessions: ${host} did not accept cross-host launch provenance; spawning unattributed\n`);
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
// =========================================================================
// docs
// =========================================================================
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
// =========================================================================
// search --all-hosts
// =========================================================================
const FLEET_SEARCH_TIMEOUT_MS = 20000;
function abortInit() {
    // Feature-detected: a sleeping tailnet peer black-holes TCP, and an
    // undeadlined fan-out request would hold the fan-out open for minutes.
    if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function')
        return {};
    return { signal: AbortSignal.timeout(FLEET_SEARCH_TIMEOUT_MS) };
}
async function fleetSearch(base, query, limit, json) {
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
    // A partial result set must look partial: name every host that is missing.
    const unanswered = Object.entries(status).filter(([, value]) => value.status !== 'ok');
    if (json) {
        return print({ results: merged.map((row) => ({ ...row.session, host: row.host })), hosts: status }, true);
    }
    for (const row of merged) {
        process.stdout.write(`${row.host}\t${searchRow(row.session, refsByHost.get(row.host)?.get(row.session.id))}\n`);
        writeSnippets(row.session);
    }
    if (!merged.length)
        process.stdout.write('No matches.\n');
    for (const [label, value] of unanswered) {
        process.stdout.write(`# ${label} did not answer (${value.error})\n`);
    }
    if (Object.values(status).some((value) => value.indexing)) {
        process.stdout.write('# A session index is still building; results may be partial — retry shortly.\n');
    }
}
// =========================================================================
// load
// =========================================================================
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
// =========================================================================
// main
// =========================================================================
// =========================================================================
// attach — join a live session's tmux pane from this terminal (local only)
// =========================================================================
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
const REF_COMMANDS = new Set(['resolve', 'read', 'show', 'related', 'send', 'steer', 'follow-up', 'interrupt', 'resume', 'close']);
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
            const { data } = await request(base, '/api/hosts');
            if (args.json)
                return print(data, true);
            const hosts = core.fleetRows(core.record(data).hosts);
            for (const entry of hosts)
                process.stdout.write(hostLine(entry) + '\n');
            const remotes = hosts.filter(entry => !core.fleetHost(entry).self);
            if (remotes.length)
                process.stdout.write('# Add --host <name> to any command to act on that host.\n');
            else
                process.stdout.write('# No remotes configured; this host is the whole fleet.\n');
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
            const qs = args.active ? '?active=1' : '';
            const { data } = await api(base, hostFlag, `/api/sessions${qs}`);
            if (args.json)
                return print(data, true);
            // `children` is what `--active` returns for subagents running inside a
            // live session: real sessions with transcripts, absent from `previous`
            // on that request (and already in it on a full list).
            const catalog = core.record(data);
            const rows = [...core.sessionRows(catalog.active), ...core.sessionRows(catalog.children), ...core.sessionRows(catalog.previous)];
            const refs = refIndex(rows, await entryForHostName(base, hostFlag));
            for (const session of rows) {
                process.stdout.write(sessionLine(session, refs.get(session.id)) + '\n');
            }
            if (catalog.indexing)
                process.stdout.write('# Session index is still building; repeat list for more.\n');
            if (catalog.discoveryTruncated)
                process.stdout.write('# Nested session discovery reached its safety limit.\n');
            return;
        }
        if (spec.name === 'spawn') {
            const sourceSessionId = discoverSession(args.session, { noneMessage: 'no live pi-dish bridge sessions found; pass --session <id>' });
            // Advisory launch provenance, unchanged: a cross-host spawn qualifies the
            // caller with this host's id so the target's sidecar records who asked.
            const callerId = hostFlag ? await qualifyCaller(base, sourceSessionId) : sourceSessionId;
            const harness = await resolveSpawnHarness(base, hostFlag, args.harness, sourceSessionId);
            const body = { async: true, requestedBySessionId: callerId, harness };
            if (args.cwd)
                body.cwd = args.cwd;
            if (args.model)
                body.model = args.model;
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
            if (args.name)
                await api(base, hostFlag, `/api/sessions/${encodeURIComponent(id)}/rename`, jsonInit({ name: args.name }));
            if (args.prompt)
                await api(base, hostFlag, `/api/sessions/${encodeURIComponent(id)}/prompt`, jsonInit({ message: args.prompt }));
            return print({ ...operation, spawnId, sessionId: id, harness, ...(hostFlag ? { host: hostFlag } : {}) }, args.json);
        }
        if (spec.name === 'search') {
            const query = args.positional.join(' ').trim();
            if (!query)
                throw new Error('search needs a query');
            const limit = intArg(args.limit, 20);
            if (args.all_hosts && hostFlag)
                throw new Error('--all-hosts and --host are mutually exclusive');
            if (args.all_hosts)
                return await fleetSearch(base, query, limit, args.json);
            const { data } = await api(base, hostFlag, `/api/search?q=${encodeURIComponent(query)}`);
            const search = core.record(data);
            const results = core.sessionRows(search.results).slice(0, limit);
            if (args.json)
                return print({ ...search, results }, true);
            const searchRefs = refIndex(results, await entryForHostName(base, hostFlag));
            for (const session of results) {
                process.stdout.write(searchRow(session, searchRefs.get(session.id)) + '\n');
                writeSnippets(session);
            }
            if (!results.length)
                process.stdout.write('No matches.\n');
            if (Number(search.total) > results.length)
                process.stdout.write(`# ${Number(search.total) - results.length} more results not shown; refine the query or raise --limit.\n`);
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
            if (args.json)
                return print({ host, id, ref: target.ref || null, session: target.session }, true);
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
                ref, host, limit, thinking: !!args.thinking,
            }));
            return;
        }
        if (spec.name === 'show') {
            const limit = intArg(args.limit, 20);
            const messages = await api(base, host, `/api/sessions/${encodeURIComponent(id)}/messages?limit=${limit}`);
            return print({ session: target.session, ...core.record(messages.data ?? {}) }, true);
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
            const { data } = await api(base, host, `/api/sessions/${encodeURIComponent(id)}/${route}`, jsonInit({ message }));
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
