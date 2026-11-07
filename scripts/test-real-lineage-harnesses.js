#!/usr/bin/env node
// Generated test/tool from scripts/test-real-lineage-harnesses.ts; edit that source and run npm run build:tests.
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Opt-in integration canary for the real OMP and Prime Agent CLIs.
 *
 * This intentionally does not run under `npm test`: the harnesses are large,
 * independently released tools. Install them, then provide their executable
 * paths (and Bun's bin directory for OMP):
 *
 *   PI_DISH_REAL_OMP_BIN=/path/to/omp \
 *   PI_DISH_REAL_PRIME_BIN=/path/to/prime-agent \
 *   PI_DISH_REAL_BUN_BIN_DIR=/path/containing/bun \
 *   npm run test:lineage
 *
 * Select just one with `npm run test:lineage -- omp` (or `prime`); only its
 * executable is required, plus Bun for OMP.
 *
 * The canary uses an isolated HOME, tmux server, bridge socket directory, and
 * Prime daemon. It sends real streamed turns only to a localhost fake OpenAI
 * Responses endpoint, with a dummy key; no paid credentials are used.
 */
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const os = require("node:os");
const path = require("node:path");
const node_child_process_1 = require("node:child_process");
const test_types_js_1 = require("../test/test-types.js");
const idleChild = path.join(__dirname, '..', 'test', 'fixtures', 'idle-child.js');
const text = (value) => String(value ?? '');
const tmuxApi = () => {
    if (!tmux)
        throw new Error('tmux module not loaded');
    return tmux;
};
const selection = process.argv[2] || 'all';
if (process.argv.length > 3 || !['all', 'omp', 'prime'].includes(selection)) {
    throw new Error('Usage: npm run test:lineage -- [all|omp|prime]');
}
const selected = selection === 'all' ? ['omp', 'prime'] : [selection === 'omp' ? 'omp' : 'prime'];
const ompBin = process.env.PI_DISH_REAL_OMP_BIN;
const primeBin = process.env.PI_DISH_REAL_PRIME_BIN;
const bunBinDir = process.env.PI_DISH_REAL_BUN_BIN_DIR;
const binaries = { omp: ompBin, prime: primeBin };
for (const name of selected) {
    const file = binaries[name];
    if (!file)
        throw new Error(`PI_DISH_REAL_${name.toUpperCase()}_BIN is required for ${name}`);
    if (!path.isAbsolute(file))
        throw new Error(`${name} executable path must be absolute`);
    fs.accessSync(file, fs.constants.X_OK);
}
if (selected.includes('omp')) {
    if (!bunBinDir || !path.isAbsolute(bunBinDir)) {
        throw new Error('PI_DISH_REAL_BUN_BIN_DIR must be an absolute directory for OMP');
    }
    fs.accessSync(path.join(bunBinDir, 'bun'), fs.constants.X_OK);
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-lineage-real-'));
const home = path.join(root, 'home');
const tmuxDir = path.join(root, 'tmux');
const tmuxSocket = path.join(tmuxDir, 's');
const work = path.join(root, 'work');
const socketDir = path.join(root, 'sockets');
const primeDaemon = path.join(root, 'prime-daemon.sock');
fs.mkdirSync(tmuxDir, { recursive: true });
fs.mkdirSync(work, { recursive: true });
fs.mkdirSync(socketDir, { recursive: true });
fs.chmodSync(socketDir, 0o700);
// Drop the operator's deployment env (HOST/PORT/share port) before pinning
// this run's own — see test/test-env.js.
const testEnv = require('../test/test-env.js');
testEnv.applyTestEnv();
const originalPath = process.env.PATH || '';
process.env.PATH = [selected.includes('omp') && bunBinDir, ...selected.map(name => path.dirname(String(binaries[name]))), originalPath]
    .filter((value) => typeof value === 'string' && !!value).join(path.delimiter);
process.env.HOME = home;
// Fleet CLI overlays may otherwise override this canary's model configuration.
for (const key of ['PI_CONFIG_FILES', 'PI_CODING_AGENT_DIR', 'OMP_AGENT_DIR'])
    delete process.env[key];
process.env.TMUX_TMPDIR = tmuxDir;
process.env.PORT = '0';
process.env.PI_DISH_SOCKET_DIR = socketDir;
process.env.PI_DISH_SPAWN_TIMEOUT_MS = '20000';
const shellWord = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
if (selected.includes('omp'))
    process.env.PI_DISH_OMP_COMMAND = [
        shellWord(ompBin), '--no-extensions', '--no-skills', '--no-rules',
    ].join(' ');
if (selected.includes('prime')) {
    process.env.PI_DISH_PRIME_COMMAND = [
        shellWord(primeBin), '--offline', '--daemon-socket', shellWord(primeDaemon),
        '--no-skills', '--no-prompt-templates', '--no-context-files',
    ].join(' ');
}
const { encodeSessionKey } = require('../lib/session-key');
let server = null;
let tmux = null;
let fakeRequestCount = 0;
let holdNextResponse = false;
const fakeRequests = [];
// service_tier values by provider request sequence (1-based), so a streamed
// turn can assert what the harness actually put on the wire. `null` means the
// field was absent (the provider's standard tier).
const fakeServiceTiers = [];
const fakeOpenAi = http.createServer((req, res) => {
    fakeRequests.push(`${req.method} ${req.url}`);
    if (req.method !== 'POST' || req.url !== '/v1/responses') {
        res.writeHead(404).end();
        return;
    }
    let body = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
        let request;
        try {
            request = (0, test_types_js_1.record)(JSON.parse(body));
        }
        catch {
            res.writeHead(400).end();
            return;
        }
        assert.equal(request.stream, true);
        const serviceTier = typeof request.service_tier === 'string' ? request.service_tier : null;
        const holdResponse = holdNextResponse;
        holdNextResponse = false;
        const sequence = ++fakeRequestCount;
        fakeServiceTiers[sequence - 1] = serviceTier;
        const messageId = `msg_pi_dish_${sequence}`;
        const responseId = `resp_pi_dish_${sequence}`;
        const text = `pi-dish fake provider response ${sequence}`;
        const responseBase = {
            id: responseId,
            object: 'response',
            created_at: Math.floor(Date.now() / 1000),
            model: request.model,
            output: [],
            usage: null,
            incomplete_details: null,
        };
        const completedItem = {
            type: 'message', id: messageId, role: 'assistant', status: 'completed',
            content: [{ type: 'output_text', text, annotations: [] }],
        };
        const events = [
            { type: 'response.created', response: { ...responseBase, status: 'in_progress' } },
            { type: 'response.in_progress', response: { ...responseBase, status: 'in_progress' } },
            { type: 'response.output_item.added', output_index: 0,
                item: { type: 'message', id: messageId, role: 'assistant', status: 'in_progress', content: [] } },
            { type: 'response.content_part.added', output_index: 0, item_id: messageId, content_index: 0,
                part: { type: 'output_text', text: '', annotations: [] } },
            { type: 'response.output_text.delta', output_index: 0, item_id: messageId, content_index: 0, delta: text },
            { type: 'response.output_text.done', output_index: 0, item_id: messageId, content_index: 0,
                text, logprobs: [] },
            { type: 'response.content_part.done', output_index: 0, item_id: messageId, content_index: 0,
                part: { type: 'output_text', text, annotations: [] } },
            { type: 'response.output_item.done', output_index: 0, item: completedItem },
            { type: 'response.completed', response: { ...responseBase, status: 'completed', output: [completedItem],
                    usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15,
                        input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 } } } },
        ];
        res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive',
        });
        for (const event of events) {
            res.write(`data: ${JSON.stringify(event)}\n\n`);
            if (holdResponse && event.type === 'response.output_text.delta') {
                // Keep a real provider turn in flight until Prime aborts the request.
                return;
            }
            await sleep(25);
        }
        res.end();
    });
});
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
let base = '';
const getArray = async (route) => {
    const response = await fetch(base + route);
    return { status: response.status, body: (0, test_types_js_1.records)(await response.json()) };
};
async function request(method, route, body) {
    const response = await fetch(base + route, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (0, test_types_js_1.record)(await response.json().catch(() => ({})));
    return { status: response.status, body: data };
}
const get = (route) => request('GET', route);
const post = (route, body = {}) => request('POST', route, body);
let tmuxSessionId = ''; // Stable even when the rename endpoint renames the tmux session.
const target = () => ({ type: 'tmux', socket: tmuxSocket, tmuxSession: tmuxSessionId });
async function waitFor(check, label, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const value = await check();
        if (value)
            return value;
        await sleep(150);
    }
    throw new Error(`Timed out waiting for ${label}`);
}
async function openSessionStream(sessionId) {
    const abort = new AbortController();
    const response = await fetch(`${base}/api/sessions/${encodeURIComponent(sessionId)}/stream`, { signal: abort.signal });
    assert.equal(response.status, 200);
    const reader = response.body?.getReader();
    if (!reader)
        throw new Error('Stream response has no body');
    const decoder = new TextDecoder();
    const events = [];
    const payloads = [];
    let buffer = '';
    const pump = (async () => {
        while (true) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buffer += decoder.decode(value, { stream: true });
            let split;
            while ((split = buffer.indexOf('\n\n')) >= 0) {
                const frame = buffer.slice(0, split);
                buffer = buffer.slice(split + 2);
                const lines = frame.split('\n');
                const event = lines.find(line => line.startsWith('event: '))?.slice(7);
                if (event) {
                    events.push(event);
                    const data = lines.find(line => line.startsWith('data: '))?.slice(6);
                    if (data) {
                        try {
                            payloads.push({ event, data: (0, test_types_js_1.record)(JSON.parse(data)) });
                        }
                        catch { }
                    }
                }
            }
        }
    })().catch((error) => {
        if (!(abort.signal.aborted && error instanceof Error && error.name === 'AbortError'))
            throw error;
    });
    return {
        events,
        payloads,
        close: async () => {
            abort.abort();
            try {
                await reader.cancel();
            }
            catch { }
            await pump;
        },
    };
}
async function runStreamedTurn(sessionId, prompt) {
    const requestCountBefore = fakeRequestCount;
    const expectedAssistantText = `pi-dish fake provider response ${requestCountBefore + 1}`;
    const stream = await openSessionStream(sessionId);
    try {
        await waitFor(() => stream.events.includes('init'), 'SSE init');
        const accepted = await post(`/api/sessions/${encodeURIComponent(sessionId)}/prompt`, { message: prompt });
        assert.equal(accepted.status, 200, JSON.stringify(accepted.body));
        await waitFor(() => stream.events.includes('turn_start'), 'bridge turn_start', 30000);
        await waitFor(() => stream.events.includes('message_update') || stream.events.includes('turn_end') || stream.events.includes('agent_end'), 'bridge message_update or terminal event', 30000);
        assert.ok(stream.events.includes('message_update'), 'turn ended without a bridge message_update');
        await waitFor(() => stream.events.includes('message_end'), 'bridge message_end', 30000);
        await waitFor(() => stream.events.includes('turn_end') || stream.events.includes('agent_end'), 'bridge turn completion', 30000);
        const transcript = await waitFor(async () => {
            const messages = await get(`/api/sessions/${encodeURIComponent(sessionId)}/messages`);
            return fakeRequestCount > requestCountBefore
                && (0, test_types_js_1.records)(messages.body.messages).some(message => JSON.stringify(message.content).includes(expectedAssistantText))
                ? messages : null;
        }, 'persisted streamed assistant message', 30000);
        return {
            events: [...new Set(stream.events)],
            transcript,
            providerRequestSequence: requestCountBefore + 1,
            providerServiceTier: fakeServiceTiers[requestCountBefore] ?? null,
            assistantText: expectedAssistantText,
        };
    }
    catch (error) {
        const details = `events: ${stream.events.join(', ') || 'none'}; payloads: ${JSON.stringify(stream.payloads.slice(-8))}; fake requests: ${fakeRequests.join(', ') || 'none'}`;
        throw new Error(`${error instanceof Error ? error.message : String(error)} (${details})`, { cause: error });
    }
    finally {
        await stream.close();
    }
}
async function testOmp() {
    const created = await post('/api/sessions/new', { harness: 'omp', model: 'openai/gpt-4o-mini', target: target() });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const id = text(created.body.id);
    assert.match(id, /^~sk1_/);
    const active = await waitFor(async () => {
        const list = await get('/api/sessions?active=1');
        return (0, test_types_js_1.records)(list.body.active).find(session => session.id === id);
    }, 'real OMP active session');
    assert.equal(active.harnessId, 'omp');
    const capabilities = (0, test_types_js_1.record)(active.capabilities);
    assert.equal(capabilities.prompt, true);
    assert.equal(capabilities.close, true);
    assert.equal(capabilities.queueCancel, false);
    assert.equal(capabilities.tree, true);
    const commands = await getArray(`/api/commands?sessionId=${encodeURIComponent(id)}`);
    assert.equal(commands.status, 200, JSON.stringify(commands.body));
    assert.ok(commands.body.length > 0);
    assert.ok(commands.body.some(command => command.name === 'btw' && command.supported === true), 'real OMP advertises /btw through the bridge');
    const models = await getArray(`/api/models?sessionId=${encodeURIComponent(id)}`);
    assert.equal(models.status, 200, JSON.stringify(models.body));
    assert.ok(models.body.some(model => model.provider === 'openai' && model.id === 'gpt-4o-mini'));
    assert.equal((await post(`/api/sessions/${encodeURIComponent(id)}/rename`, { name: 'OMP managed real canary' })).status, 200);
    assert.equal((await post(`/api/sessions/${encodeURIComponent(id)}/thinking`, { level: 'low' })).status, 200);
    assert.equal((await post(`/api/sessions/${encodeURIComponent(id)}/command`, { message: '/dish-push' })).status, 200);
    // Fast mode only counts if the priority tier reaches the provider payload.
    // The local fake provider records each request's service_tier, so assert the
    // real streamed turn while /fast is on, then assert it drops once /fast is off.
    const fastOn = await post(`/api/sessions/${encodeURIComponent(id)}/fast`, { enabled: true });
    assert.equal(fastOn.status, 200, JSON.stringify(fastOn.body));
    const fastOnState = (0, test_types_js_1.record)((0, test_types_js_1.present)(fastOn.body.fastMode));
    assert.equal(fastOnState.available, true, `real OMP fast mode availability after /fast on: ${JSON.stringify(fastOn.body)}`);
    assert.equal(fastOnState.enabled, true, `real OMP fast mode enabled after /fast on: ${JSON.stringify(fastOn.body)}`);
    assert.equal(fastOnState.active, true, `real OMP fast mode active after /fast on: ${JSON.stringify(fastOn.body)}`);
    const turn = await runStreamedTurn(id, 'pi-dish managed OMP integration canary');
    assert.equal(turn.providerServiceTier, 'priority', 'fast mode must send service_tier=priority on the real streamed provider request');
    const fastOff = await post(`/api/sessions/${encodeURIComponent(id)}/fast`, { enabled: false });
    assert.equal(fastOff.status, 200, JSON.stringify(fastOff.body));
    const fastOffState = (0, test_types_js_1.record)((0, test_types_js_1.present)(fastOff.body.fastMode));
    assert.equal(fastOffState.available, true, `real OMP fast mode availability after /fast off: ${JSON.stringify(fastOff.body)}`);
    assert.equal(fastOffState.enabled, false, `real OMP fast mode enabled after /fast off: ${JSON.stringify(fastOff.body)}`);
    assert.equal(fastOffState.active, false, `real OMP fast mode active after /fast off: ${JSON.stringify(fastOff.body)}`);
    const plainTurn = await runStreamedTurn(id, 'pi-dish managed OMP standard-tier canary');
    assert.notEqual(plainTurn.providerServiceTier, 'priority', 'fast mode must be gone from the provider payload after /fast off');
    // /btw starts an asynchronous side chat: the ask returns immediately and the
    // answer streams into the side chat state, never the transcript.
    const sideChatAsk = await post(`/api/sessions/${encodeURIComponent(id)}/side-chat`, { question: 'summarize this session' });
    assert.equal(sideChatAsk.status, 200, JSON.stringify(sideChatAsk.body));
    const sideChat = await waitFor(async () => {
        const state = await get(`/api/sessions/${encodeURIComponent(id)}/side-chat`);
        assert.equal(state.status, 200, JSON.stringify(state.body));
        if (state.body.sideChat == null)
            return null;
        const chat = (0, test_types_js_1.record)(state.body.sideChat);
        const turns = (0, test_types_js_1.records)(chat.turns);
        const last = turns[turns.length - 1];
        if (last?.status === 'error')
            throw new Error(`real OMP side chat failed: ${text(last.error)}`);
        return last?.status === 'complete' ? chat : null;
    }, 'real OMP side chat answer', 30000);
    const sideChatTurns = (0, test_types_js_1.records)(sideChat.turns);
    const sideChatAnswer = text(sideChatTurns[sideChatTurns.length - 1].answer);
    assert.match(sideChatAnswer, /^pi-dish fake provider response \d+$/, 'real OMP side chat answer');
    const tree = await get(`/api/sessions/${encodeURIComponent(id)}/tree`);
    assert.equal(tree.status, 200, JSON.stringify(tree.body));
    assert.ok((0, test_types_js_1.records)(tree.body.nodes).some(node => node.role === 'assistant' && node.text === plainTurn.assistantText && node.active), 'the real OMP live tree includes the persisted assistant response on its active path');
    const closeSpawn = (0, test_types_js_1.present)(tmuxApi().getSpawn(id));
    assert.ok((0, test_types_js_1.record)(closeSpawn.paneProcess).startTime, 'real OMP close has an owned pane identity');
    const close = await post(`/api/sessions/${encodeURIComponent(id)}/close`);
    assert.equal(close.status, 200, JSON.stringify(close.body));
    assert.equal(await tmuxApi().paneExists(text(closeSpawn.socket), text(closeSpawn.paneId)), false);
    assert.equal(tmuxApi().getSpawn(id), null);
    assert.equal((await get(`/api/sessions/${encodeURIComponent(id)}/tree`)).status, 409, 'inactive OMP tree reads remain capability-gated');
    // A fresh model-less OMP TUI does not create its JSONL until a real turn.
    // Resume a minimal current-format corpus through the actual OMP loader so
    // CLI dialect, wrapper loading, routing, and historical reads are covered.
    const headerId = crypto.randomUUID();
    const resumeNativeId = `2026-08-08T00-00-00-000Z_${headerId}`;
    const resumeFile = path.join(home, '.omp', 'agent', 'sessions', '-real-canary-work', `${resumeNativeId}.jsonl`);
    fs.mkdirSync(path.dirname(resumeFile), { recursive: true });
    const now = new Date().toISOString();
    // OMP patches its title in place. Give the v1 title record the same fixed
    // width its SessionManager creates, or a current OMP correctly rejects the
    // old spike-era fixture as malformed and initializes a fresh session.
    const title = { type: 'title', v: 1, title: 'OMP real resume fixture', updatedAt: now, pad: '' };
    title.pad = ' '.repeat(Math.max(0, 255 - Buffer.byteLength(JSON.stringify(title))));
    fs.writeFileSync(resumeFile, [
        title,
        { type: 'session', version: 3, id: headerId, timestamp: now, cwd: work },
        { type: 'message', id: 'user-1', parentId: null, timestamp: now,
            message: { role: 'user', content: [{ type: 'text', text: 'real OMP resume canary' }], timestamp: now } },
    ].map(value => JSON.stringify(value)).join('\n') + '\n');
    const resumeId = encodeSessionKey('omp', (0, test_types_js_1.nativeId)(resumeNativeId));
    const resumed = await post(`/api/sessions/${encodeURIComponent(resumeId)}/resume`, { target: target() });
    assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
    assert.equal(resumed.body.id, resumeId);
    const messages = await get(`/api/sessions/${encodeURIComponent(resumeId)}/messages`);
    assert.equal(messages.status, 200, JSON.stringify(messages.body));
    assert.equal((0, test_types_js_1.record)(messages.body.session).harnessId, 'omp');
    assert.ok((0, test_types_js_1.records)(messages.body.messages).some(message => JSON.stringify(message.content).includes('real OMP resume canary')), JSON.stringify({ session: messages.body.session, messages: messages.body.messages, file: fs.readFileSync(resumeFile, 'utf8') }));
    return {
        version: (0, node_child_process_1.execFileSync)(String(ompBin), ['--version'], { encoding: 'utf8', timeout: 10000 }).trim(),
        routeNamespace: id.slice(0, 5),
        commands: commands.body.length,
        models: models.body.length,
        streamedTurnEvents: turn.events,
        fastModeEnabledState: fastOnState,
        fastModeEnabledProviderTier: turn.providerServiceTier,
        fastModeDisabledState: fastOffState,
        fastModeDisabledProviderTier: plainTurn.providerServiceTier,
        persistedAssistantMessage: true,
        liveTreeRead: true,
        inactiveTreeReadRefused: true,
        closeStatus: close.status,
        resumeSameRoute: resumed.body.id === resumeId,
        historyMessageRead: true,
        sideChatAnswer,
    };
}
function primeDaemonRequest(socketPath, command, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        const socket = net.connect(socketPath);
        const id = `pi-dish-canary-${String(command.type)}`;
        const timer = setTimeout(() => {
            socket.destroy();
            reject(new Error(`Prime daemon ${String(command.type)} timed out after ${timeoutMs}ms`));
        }, timeoutMs);
        let buffer = '';
        socket.setEncoding('utf8');
        socket.on('data', (chunk) => {
            buffer += chunk;
            let newline;
            while ((newline = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, newline);
                buffer = buffer.slice(newline + 1);
                let message;
                try {
                    message = (0, test_types_js_1.record)(JSON.parse(line));
                }
                catch {
                    continue;
                }
                if (message.type === 'daemon_hello') {
                    socket.write(JSON.stringify({
                        type: 'command', id,
                        protocol: { name: 'prime-agent.daemon', version: 7 },
                        clientId: 'pi-dish-canary',
                        command: { ...command, id },
                    }) + '\n');
                }
                else if (message.type === 'response' && message.id === id) {
                    clearTimeout(timer);
                    socket.end();
                    if (message.success !== true) {
                        reject(new Error(`Prime daemon ${String(command.type)} failed: ${JSON.stringify(message.error)}`));
                        return;
                    }
                    resolve((0, test_types_js_1.record)(message.data ?? {}));
                }
            }
        });
        socket.on('error', (error) => { clearTimeout(timer); reject(error); });
    });
}
/**
 * Stop only the isolated daemon this canary started. The public
 * `prime-agent shutdown` command stops every agent on its daemon and requires
 * --force outside a terminal; this speaks the daemon protocol (v7 `shutdown`)
 * over the canary's own socket instead: no extra process, one supervisor.
 */
async function shutdownPrime(daemonSocket = primeDaemon) {
    if (!selected.includes('prime') || !fs.existsSync(daemonSocket))
        return { success: true };
    const data = await primeDaemonRequest(daemonSocket, { type: 'shutdown' });
    return { success: true, ...data };
}
/** Roster rows from the isolated daemon's own CLI, scoped by env socket. */
function primeDaemonRoster() {
    const output = (0, node_child_process_1.execFileSync)(String(primeBin), ['list', '--json'], {
        encoding: 'utf8',
        timeout: 20000,
        env: { ...process.env, HOME: home, PRIME_AGENT_DAEMON_SOCKET: primeDaemon },
    });
    return (0, test_types_js_1.records)((0, test_types_js_1.record)(JSON.parse(output)).sessions);
}
function rosterHasAgent(predicate) {
    return primeDaemonRoster().some(predicate);
}
async function testPrime() {
    const created = await post('/api/sessions/new', { harness: 'prime', model: 'openai/gpt-4o-mini', target: target() });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const id = text(created.body.id);
    assert.match(id, /^~sk1_/);
    const active = await waitFor(async () => {
        const list = await get('/api/sessions?active=1');
        return (0, test_types_js_1.records)(list.body.active).find(session => session.id === id);
    }, 'real Prime active session');
    assert.equal(active.harnessId, 'prime');
    const capabilities = (0, test_types_js_1.record)(active.capabilities);
    // Prime 0.10's daemon exposes the full session command surface; the
    // extension-era capability holes are gone.
    assert.equal(capabilities.close, true, 'owned Prime roots can stop through their daemon');
    assert.equal(capabilities.restart, true);
    assert.equal(capabilities.compact, true);
    assert.equal(capabilities.tree, true);
    assert.equal(capabilities.queueCancel, true);
    assert.equal((await post(`/api/sessions/${encodeURIComponent(id)}/rename`, { name: 'Prime managed real canary' })).status, 200);
    assert.equal((await post(`/api/sessions/${encodeURIComponent(id)}/thinking`, { level: 'low' })).status, 200);
    const models = await getArray(`/api/models?sessionId=${encodeURIComponent(id)}`);
    assert.equal(models.status, 200, JSON.stringify(models.body));
    assert.ok(models.body.some(model => model.provider === 'openai' && model.id === 'gpt-4o-mini'));
    const turn = await runStreamedTurn(id, 'pi-dish managed Prime integration canary');
    const tree = await get(`/api/sessions/${encodeURIComponent(id)}/tree`);
    assert.equal(tree.status, 200, JSON.stringify(tree.body));
    assert.ok((0, test_types_js_1.records)(tree.body.nodes).some(node => node.role === 'assistant' && node.text === turn.assistantText && node.active), 'the real Prime live tree includes the persisted assistant response on its active path');
    // A held provider turn is Prime-busy: queue a follow-up, prove it shows up
    // in the SSE queue_update, cancel it through the queue route, then abort.
    const heldText = 'pi-dish queued follow-up for the Prime canary';
    const held = await openSessionStream(id);
    let queueUpdateSeen = false;
    let queueCancelSeen = false;
    try {
        await waitFor(() => held.events.includes('init'), 'Prime held-turn SSE init');
        const beforeHold = fakeRequestCount;
        holdNextResponse = true;
        assert.equal((await post(`/api/sessions/${encodeURIComponent(id)}/prompt`, { message: 'Keep this turn open for the queue canary' })).status, 200);
        await waitFor(() => fakeRequestCount > beforeHold && held.events.includes('turn_start'), 'Prime held turn started', 30000);
        await waitFor(() => held.events.includes('message_update'), 'Prime held turn first delta', 30000);
        assert.equal((await post(`/api/sessions/${encodeURIComponent(id)}/follow-up`, { message: heldText })).status, 200);
        await waitFor(() => held.payloads.some(({ event, data }) => event === 'queue_update' && Array.isArray(data.followUp) && data.followUp.includes(heldText)), 'queued follow-up in the Prime SSE queue_update', 15000);
        queueUpdateSeen = true;
        const cancelled = await post(`/api/sessions/${encodeURIComponent(id)}/queue/cancel`, { kind: 'followUp', index: 0, text: heldText });
        assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
        await waitFor(() => held.payloads.some(({ event, data }) => event === 'queue_update' && Array.isArray(data.followUp) && !data.followUp.includes(heldText)), 'cancelled follow-up leaving the Prime SSE queue_update', 15000);
        queueCancelSeen = true;
        assert.equal((await post(`/api/sessions/${encodeURIComponent(id)}/abort`, {})).status, 200);
        await waitFor(() => held.events.includes('agent_end') || held.events.includes('turn_end'), 'aborted Prime turn boundary', 30000);
    }
    finally {
        await held.close();
    }
    const peer = await post('/api/sessions/new', { harness: 'prime', model: 'openai/gpt-4o-mini', target: target() });
    assert.equal(peer.status, 200, JSON.stringify(peer.body));
    const peerId = text(peer.body.id);
    assert.notEqual(peerId, id);
    await waitFor(async () => {
        const list = await get('/api/sessions?active=1');
        return (0, test_types_js_1.records)(list.body.active).find(session => session.id === peerId);
    }, 'real Prime peer active session');
    const spawnBefore = (0, test_types_js_1.record)((0, test_types_js_1.present)(tmuxApi().getSpawn(id)));
    const agentBefore = (0, test_types_js_1.record)(spawnBefore.primeAgent);
    assert.ok(agentBefore.activeSessionId, 'the Prime spawn record names its daemon agent');
    assert.ok(agentBefore.sessionFile, 'the Prime spawn record names its transcript');
    const paneLocationBefore = await tmuxApi().paneLocation(text(spawnBefore.socket), text(spawnBefore.paneId));
    const restarted = await post(`/api/sessions/${encodeURIComponent(id)}/restart`);
    assert.equal(restarted.status, 200, JSON.stringify(restarted.body));
    const spawnAfter = (0, test_types_js_1.record)((0, test_types_js_1.present)(tmuxApi().getSpawn(id)));
    const agentAfter = (0, test_types_js_1.record)(spawnAfter.primeAgent);
    assert.equal(spawnAfter.paneId, spawnBefore.paneId, 'restart keeps the original client pane');
    assert.deepEqual(await tmuxApi().paneLocation(text(spawnAfter.socket), text(spawnAfter.paneId)), paneLocationBefore, 'restart keeps the pane where it was');
    assert.notEqual(agentAfter.activeSessionId, agentBefore.activeSessionId, 'restart starts a new Prime agent');
    assert.equal(agentAfter.sessionFile, agentBefore.sessionFile, 'restart resumes the same transcript');
    const restartedTurn = await runStreamedTurn(id, 'Prime answers after same-pane restart');
    assert.ok((0, test_types_js_1.records)(restartedTurn.transcript.body.messages).some(message => JSON.stringify(message.content).includes(turn.assistantText)), 'pre-restart transcript survives');
    await runStreamedTurn(peerId, 'Prime peer still answers after another root restarts');
    const peerSpawn = (0, test_types_js_1.record)((0, test_types_js_1.present)(tmuxApi().getSpawn(peerId)));
    const peerAgent = (0, test_types_js_1.record)(peerSpawn.primeAgent);
    assert.ok(peerAgent.activeSessionId, 'the peer spawn record names its daemon agent');
    const closed = await post(`/api/sessions/${encodeURIComponent(id)}/close`);
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
    assert.equal(await tmuxApi().paneExists(text(spawnAfter.socket), text(spawnAfter.paneId)), false, 'close removes the Prime client pane');
    await waitFor(() => !rosterHasAgent(row => row.activeSessionId === agentAfter.activeSessionId || row.sessionFile === agentAfter.sessionFile), 'closed Prime agent leaving the isolated daemon roster', 20000);
    assert.equal(rosterHasAgent(row => row.activeSessionId === peerAgent.activeSessionId), true, 'closing one root leaves the peer agent running');
    await runStreamedTurn(peerId, 'Prime peer still answers after another root closes');
    const resumed = await post(`/api/sessions/${encodeURIComponent(id)}/resume`, { target: target() });
    assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
    assert.equal(resumed.body.id, id);
    const resumedSpawn = (0, test_types_js_1.record)((0, test_types_js_1.present)(tmuxApi().getSpawn(id)));
    assert.equal((0, test_types_js_1.record)(resumedSpawn.primeAgent).sessionFile, agentBefore.sessionFile, 'resume reopens the closed transcript');
    const messages = await get(`/api/sessions/${encodeURIComponent(id)}/messages`);
    assert.equal(messages.status, 200, JSON.stringify(messages.body));
    assert.equal((0, test_types_js_1.record)(messages.body.session).harnessId, 'prime');
    const resumedTurn = await runStreamedTurn(id, 'pi-dish managed Prime post-resume integration canary');
    assert.ok(resumedTurn.providerRequestSequence > turn.providerRequestSequence);
    assert.ok((0, test_types_js_1.records)(resumedTurn.transcript.body.messages).some(message => JSON.stringify(message.content).includes(turn.assistantText)), 'resume keeps the earlier transcript');
    assert.ok((0, test_types_js_1.records)(resumedTurn.transcript.body.messages).some(message => JSON.stringify(message.content).includes(resumedTurn.assistantText)));
    // A manually started TUI on the same isolated daemon socket must appear as
    // an unowned Prime row: prompts work, close/restart are refused.
    const manualWork = path.join(root, 'prime-manual-work');
    fs.mkdirSync(manualWork, { recursive: true });
    const beforeManual = new Set((0, test_types_js_1.records)((await get('/api/sessions?active=1')).body.active).map(row => text(row.id)));
    (0, node_child_process_1.execFileSync)('tmux', ['-S', tmuxSocket, 'new-session', '-d', '-s', 'prime-manual', '-c', manualWork, [
            'env', `HOME=${shellWord(home)}`, `PRIME_AGENT_DAEMON_SOCKET=${shellWord(primeDaemon)}`,
            shellWord(primeBin), '--offline', '--daemon-socket', shellWord(primeDaemon),
            '--no-skills', '--no-prompt-templates', '--no-context-files',
            '--model', 'openai/gpt-4o-mini',
        ].join(' ')], { stdio: 'ignore' });
    let manualId = '';
    try {
        const manual = await waitFor(async () => {
            const list = await get('/api/sessions?active=1');
            return (0, test_types_js_1.records)(list.body.active).find(row => row.harnessId === 'prime' && !beforeManual.has(text(row.id)));
        }, 'manually started Prime TUI as an active row', 30000);
        manualId = text(manual.id);
        assert.equal((0, test_types_js_1.record)(manual.capabilities).close, false, 'a manual Prime session is not closeable');
        assert.equal((await post(`/api/sessions/${encodeURIComponent(manualId)}/close`)).status, 409, 'pi-dish refuses to close a Prime session it did not launch');
        await runStreamedTurn(manualId, 'pi-dish can prompt a manually started Prime TUI');
    }
    finally {
        try {
            (0, node_child_process_1.execFileSync)('tmux', ['-S', tmuxSocket, 'kill-session', '-t', 'prime-manual'], { stdio: 'ignore' });
        }
        catch { }
    }
    return {
        version: (0, node_child_process_1.execFileSync)(String(primeBin), ['--version'], { encoding: 'utf8', timeout: 10000 }).trim(),
        routeNamespace: id.slice(0, 5),
        models: models.body.length,
        streamedTurnEvents: turn.events,
        persistedAssistantMessage: true,
        liveTreeRead: true,
        queueUpdateVisible: queueUpdateSeen,
        queueCancelAccepted: queueCancelSeen,
        ownedRootClosed: true,
        daemonRosterRemoval: true,
        samePaneRestarted: true,
        newAgentOnRestart: true,
        postRestartPersistedAssistantMessage: true,
        otherRootSurvivedAndAnswered: true,
        postResumePersistedAssistantMessage: true,
        manualRowDiscovered: true,
        manualCloseRefused: true,
        manualPromptWorks: true,
    };
}
async function cleanup() {
    try {
        await shutdownPrime();
    }
    catch { }
    const activeServer = server;
    if (activeServer?.listening)
        await new Promise((resolve, reject) => activeServer.close(error => error ? reject(error) : resolve()));
    if (fakeOpenAi.listening)
        await new Promise((resolve, reject) => fakeOpenAi.close(error => error ? reject(error) : resolve()));
    try {
        (0, node_child_process_1.execFileSync)('tmux', ['-S', tmuxSocket, 'kill-server'], { stdio: 'ignore' });
    }
    catch { }
    await sleep(250);
    fs.rmSync(root, { recursive: true, force: true });
}
(async () => {
    try {
        await new Promise((resolve, reject) => {
            fakeOpenAi.once('error', reject);
            fakeOpenAi.listen(0, '127.0.0.1', resolve);
        });
        process.env.OPENAI_API_KEY = 'pi-dish-local-canary-key';
        const fakeAddress = fakeOpenAi.address();
        if (!fakeAddress || typeof fakeAddress === 'string')
            throw new Error('Fake provider lacks TCP address');
        const fakeBaseUrl = `http://127.0.0.1:${fakeAddress.port}/v1`;
        process.env.OPENAI_BASE_URL = fakeBaseUrl;
        for (const agentDir of [path.join(home, '.omp', 'agent'), path.join(home, '.prime', 'agent')]) {
            fs.mkdirSync(agentDir, { recursive: true });
        }
        fs.writeFileSync(path.join(home, '.omp', 'agent', 'models.yml'), [
            'providers:',
            '  openai:',
            `    baseUrl: ${JSON.stringify(fakeBaseUrl)}`,
            '    apiKey: pi-dish-local-canary-key',
            '',
        ].join('\n'));
        fs.writeFileSync(path.join(home, '.prime', 'agent', 'models.json'), JSON.stringify({
            providers: { openai: { baseUrl: fakeBaseUrl, apiKey: 'pi-dish-local-canary-key' } },
        }, null, 2));
        tmuxSessionId = (0, node_child_process_1.execFileSync)('tmux', [
            '-S', tmuxSocket, '-f', '/dev/null', 'new-session', '-d', '-s', 'work', '-c', work,
            '-P', '-F', '#{session_id}',
            process.execPath, idleChild,
        ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
        const activeServer = require('../server.js');
        server = activeServer;
        tmux = require('../lib/tmux');
        if (!activeServer.listening)
            await new Promise(resolve => activeServer.once('listening', resolve));
        const serverAddress = activeServer.address();
        if (!serverAddress || typeof serverAddress === 'string')
            throw new Error('Canary server lacks TCP address');
        base = `http://127.0.0.1:${serverAddress.port}`;
        const harnesses = await get('/api/harnesses');
        assert.equal(harnesses.status, 200);
        const installed = (0, test_types_js_1.records)(harnesses.body.harnesses);
        for (const id of selected) {
            const harness = (0, test_types_js_1.present)(installed.find(item => item.id === id));
            assert.equal(harness.available, true, `${id} must be reported installed`);
            assert.equal(harness.rpcFallback, false);
        }
        const result = {};
        for (const id of selected)
            result[id] = await (id === 'omp' ? testOmp() : testPrime());
        // OMP: two streamed turns (fast on, then off) plus one side-chat turn.
        // Prime: the managed turn, the held/aborted turn, restart, two peer turns,
        // the post-resume turn and the manual TUI prompt.
        const expectedCalls = (selected.includes('omp') ? 3 : 0) + (selected.includes('prime') ? 7 : 0);
        assert.equal(fakeRequestCount, expectedCalls, 'each streamed turn must use the local fake provider');
        result.fakeProviderRequests = fakeRequestCount;
        console.log(JSON.stringify(result, null, 2));
    }
    finally {
        await cleanup();
    }
})().catch((error) => {
    console.error(error instanceof Error ? error.stack : error);
    process.exitCode = 1;
});
