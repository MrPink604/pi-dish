// Generated test/tool from test/agy-acp.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Integration test for the Antigravity (`agy`) harness: the real server routes
 * launch the relay (lib/agy-relay.js) in an isolated tmux server, and the relay
 * drives a fake `agy acp` ACP agent over stdio, selected by PI_DISH_AGY_COMMAND.
 *
 * Covers the wiring contract, not the transport's own units (test/acp-session
 * covers handshake, segmentation and the mirror): harness listing gated on the
 * binary, the `agy models` catalog grouped into ACP base models, model/thinking
 * validation on POST /api/sessions/new, POST /api/sessions/new into a tmux pane,
 * the bridge registry claim, the SSE stream, a prompt turn, the Pi-format
 * mirror, an ask round trip, close (pane and claim gone), resume, and survival
 * of a dropped server-side bridge connection while a turn is still running.
 *
 * Run with: npm test
 */
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const node_child_process_1 = require("node:child_process");
const promises_1 = require("node:timers/promises");
const test_types_js_1 = require("./test-types.js");
const sse_reader_js_1 = require("./sse-reader.js");
// HOME must be set before any server/lib module resolves dishDir() or a harness root.
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-agy-'));
process.env.HOME = tmpHome;
process.env.PORT = '0';
process.env.HOST = '127.0.0.1';
// An isolated tmux server keeps the live one (and its sessions) untouched.
const tmuxDir = path.join(tmpHome, 'tmux');
fs.mkdirSync(tmuxDir, { recursive: true });
process.env.TMUX_TMPDIR = tmuxDir;
// Never attach to a resident Prime daemon; agy never looks at this socket.
process.env.PRIME_AGENT_DAEMON_SOCKET = path.join(tmpHome, 'no-prime-daemon.sock');
const fixture = path.join(__dirname, 'fixtures', 'fake-agy-acp.js');
/** `agy models` rows: per-level Gemini variants, a base-only row, and the Claude/GPT rows ACP never serves. */
const modelListing = [
    'Fetching available models...',
    'gemini-4-carbon-medium\tGemini 4 Carbon (Medium)',
    'gemini-4-carbon-high\tGemini 4 Carbon (High)',
    'gemini-4-carbon-low\tGemini 4 Carbon (Low)',
    'gemini-4-hydrogen-low\tGemini 4 Hydrogen (Low)',
    'gemini-4-hydrogen-medium\tGemini 4 Hydrogen (Medium)',
    'gemini-4-hydrogen-high\tGemini 4 Hydrogen (High)',
    'gemini-4-hydrogen-xhigh\tGemini 4 Hydrogen (XHigh)',
    'gemini-pro-orchestrator\tOrchestrator (Carbon)',
    'gemini-3.8-flash-high\tGemini 3.8 Flash (High)',
    'claude-sonnet-4-6\tClaude Sonnet 4.6 (Thinking)',
    'gpt-oss-120b-medium\tGPT-OSS 120B (Medium)',
].join('\\n');
/**
 * One `PI_DISH_AGY_COMMAND`: `models` answers the catalog listing (failing if
 * ambient provider credentials leak through), every other argv is the ACP
 * stand-in — so discovery and the relay's child share a single binary.
 */
const agyBinary = `sh -c 'if [ "$1" = models ]; then `
    + '[ -z "$GEMINI_API_KEY$GOOGLE_API_KEY" ] || { echo "ambient provider credentials reached agy models" >&2; exit 1; }; '
    + `printf "%b\\n" "${modelListing}"; `
    + `else exec "${process.execPath}" "${fixture}" "$@"; fi' sh`;
/** `env FAKE_AGY_SCRIPT=<script>` rides the command line into the relay's agy child. */
const agyCommand = (script) => script ? `env FAKE_AGY_SCRIPT=${script} ${agyBinary}` : agyBinary;
process.env.PI_DISH_AGY_COMMAND = agyBinary;
const projDir = path.join(tmpHome, 'proj');
fs.mkdirSync(projDir, { recursive: true });
const server = require('../server.js');
const tmuxLib = require('../lib/tmux.js');
const bridgeLib = require('../lib/bridge-session.js');
const acpLib = require('../lib/acp-session.js');
const { routeIdentity } = require('../lib/session-ownership.js');
let base = '';
const get = async (requestPath) => {
    const response = await fetch(base + requestPath);
    return { status: response.status, body: (0, test_types_js_1.record)(await response.json()) };
};
const post = async (requestPath, body) => {
    const response = await fetch(base + requestPath, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
    });
    return { status: response.status, body: (0, test_types_js_1.record)(await response.json().catch(() => ({}))) };
};
const sessionPath = (id, suffix) => `/api/sessions/${encodeURIComponent(id)}${suffix}`;
const messageText = (message) => (0, test_types_js_1.records)((0, test_types_js_1.record)(message).content)
    .filter(block => block.type === 'text').map(block => String(block.text ?? '')).join('');
async function until(predicate, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (!predicate()) {
        if (Date.now() > deadline)
            throw new Error('Timed out waiting for the Antigravity session');
        await (0, promises_1.setTimeout)(20);
    }
}
function claimFile(sessionId) {
    const nativeId = (0, test_types_js_1.present)(routeIdentity(sessionId)?.nativeSessionId, 'the route carries an agy native id');
    return path.join(tmpHome, '.pi', 'dish', 'sessions', `${nativeId}.json`);
}
const readClaim = (sessionId) => (0, test_types_js_1.record)(JSON.parse(fs.readFileSync(claimFile(sessionId), 'utf8')));
function claimFor(sessionId) {
    const identity = (0, test_types_js_1.present)(routeIdentity(sessionId), 'the route is an agy route');
    return bridgeLib.listRegisteredSessions().find(entry => entry.sessionId === identity.nativeSessionId
        || ((0, test_types_js_1.record)(entry.wrapper).harnessId === 'agy' && entry.nativeSessionId === identity.nativeSessionId)) ?? null;
}
function capture(session) {
    const events = [];
    for (const event of ['hello', 'agent_start', 'turn_start', 'message_start', 'message_update', 'message_end',
        'tool_execution_start', 'tool_execution_end', 'turn_end', 'agent_end', 'extension_ui_request', 'extension_ui_resolved']) {
        session.on(event, (data) => events.push({ event, data }));
    }
    return events;
}
const assistantText = (events) => events
    .filter(entry => entry.event === 'message_end' && (0, test_types_js_1.record)((0, test_types_js_1.record)(entry.data).message).role === 'assistant')
    .map(entry => messageText((0, test_types_js_1.record)(entry.data).message)).join('\n');
test.before(async () => {
    if (!server.listening)
        await new Promise(resolve => server.once('listening', resolve));
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Test server lacks a TCP address');
    base = `http://127.0.0.1:${address.port}`;
});
test.after(async () => {
    await new Promise(resolve => server.close(() => resolve()));
    // Relay panes outlive the server by design; the isolated tmux server must not outlive the test.
    for (const name of fs.existsSync(tmuxDir) ? fs.readdirSync(tmuxDir) : []) {
        try {
            (0, node_child_process_1.execFileSync)('tmux', ['-S', path.join(tmuxDir, name), 'kill-server'], { stdio: 'ignore' });
        }
        catch { }
    }
    // Session-index flushes are timer-backed and can finish just after the listener closes.
    fs.rmSync(tmpHome, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});
test('/api/harnesses lists Antigravity only when agy resolves', async () => {
    const saved = process.env.PI_DISH_AGY_COMMAND;
    process.env.PI_DISH_AGY_COMMAND = path.join(tmpHome, 'missing', 'agy');
    try {
        const { body } = await get('/api/harnesses');
        const ids = (0, test_types_js_1.records)(body.harnesses).map(row => (0, test_types_js_1.record)(row).id);
        assert.ok(ids.includes('pi'), 'the Pi lineage stays listed');
        assert.ok(!ids.includes('agy'), 'an unresolved agy must not be offered');
    }
    finally {
        process.env.PI_DISH_AGY_COMMAND = saved;
    }
    const { body } = await get('/api/harnesses');
    const agy = (0, test_types_js_1.records)(body.harnesses).map(row => (0, test_types_js_1.record)(row)).find(row => row.id === 'agy');
    const row = (0, test_types_js_1.record)((0, test_types_js_1.present)(agy, 'agy appears once its command resolves'));
    assert.equal(row.available, true);
    assert.equal(row.closeMode, 'owned-pane');
});
test('/api/models?harness=agy groups the Gemini listing into models with thinking levels', async () => {
    const catalog = async () => {
        const response = await fetch(`${base}/api/models?harness=agy&cwd=${encodeURIComponent(projDir)}`);
        const body = await response.json();
        assert.equal(response.status, 200, JSON.stringify(body));
        return (0, test_types_js_1.records)(body);
    };
    const rows = await catalog();
    assert.deepEqual(rows.map(row => String(row.id)).sort(), ['gemini-3.8-flash', 'gemini-4-carbon', 'gemini-4-hydrogen', 'gemini-pro-orchestrator'], 'one row per ACP base model; the Claude/GPT rows stay hidden');
    const byId = new Map(rows.map(row => [String(row.id), row]));
    const carbon = (0, test_types_js_1.record)((0, test_types_js_1.present)(byId.get('gemini-4-carbon'), 'the Carbon base model is listed'));
    assert.equal(carbon.name, 'Gemini 4 Carbon', 'the level suffix is stripped from the label');
    assert.equal(carbon.provider, 'google-antigravity');
    assert.equal(carbon.selector, 'google-antigravity/gemini-4-carbon');
    assert.equal(carbon.reasoning, true);
    assert.deepEqual(carbon.thinking, ['low', 'medium', 'high']);
    const hydrogen = (0, test_types_js_1.record)((0, test_types_js_1.present)(byId.get('gemini-4-hydrogen'), 'the Hydrogen base model is listed'));
    assert.deepEqual(hydrogen.thinking, ['low', 'medium', 'high', 'xhigh'], 'Hydrogen also offers xhigh');
    const orchestrator = (0, test_types_js_1.record)((0, test_types_js_1.present)(byId.get('gemini-pro-orchestrator'), 'a suffix-free id stays one entry'));
    assert.equal(orchestrator.name, 'Orchestrator (Carbon)', 'an unrelated trailing group is not a level');
    assert.equal(orchestrator.reasoning, false);
    assert.equal(orchestrator.thinking, null);
    // `agy` construction keys are what sign the CLI in; they must not reach `agy models`.
    const savedKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'ambient-key-that-must-not-reach-agy';
    try {
        assert.equal((await catalog()).length, rows.length);
    }
    finally {
        if (savedKey === undefined)
            delete process.env.GEMINI_API_KEY;
        else
            process.env.GEMINI_API_KEY = savedKey;
    }
});
test('agy new-session refuses a model or thinking level the catalog lacks', async () => {
    const refusals = [{
            body: { model: 'gemini-9-imaginary' }, error: /Model gemini-9-imaginary is not available from Antigravity/,
        }, {
            body: { model: 'gemini-4-carbon', thinking: 'xhigh' }, error: /Thinking level xhigh is not valid for gemini-4-carbon; valid levels: low, medium, high\./,
        }, {
            body: { model: 'claude-sonnet-4-6' }, error: /only offers Gemini models/,
        }, {
            body: { model: 'openai/gpt-5' }, error: /only offers Gemini models on the google-antigravity provider/,
        }];
    for (const refusal of refusals) {
        const refused = await post('/api/sessions/new', { harness: 'agy', cwd: projDir, ...refusal.body });
        assert.equal(refused.status, 400, `${JSON.stringify(refusal.body)} → ${JSON.stringify(refused.body)}`);
        assert.match(String(refused.body.error), refusal.error);
    }
});
test('agy session: relay in a tmux pane, new, streamed turn, mirror read, close, resume', { timeout: 90000 }, async () => {
    const created = await post('/api/sessions/new', { harness: 'agy', cwd: projDir });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const sessionId = String((0, test_types_js_1.present)(created.body.id));
    // The ACP client lives in the pane, not in this server process.
    assert.equal(acpLib.getAllAcpSessions().length, 0, 'no in-server agy acp child exists');
    const spawn = (0, test_types_js_1.present)(tmuxLib.getSpawn(sessionId), 'the relay has a recorded tmux placement');
    assert.equal(path.dirname(String(spawn.socket)), tmuxDir, 'the pane lives on the isolated tmux server');
    assert.equal(await tmuxLib.paneExists(String(spawn.socket), String(spawn.paneId)), true, 'the relay pane is alive');
    const claim = readClaim(sessionId);
    assert.equal(claim.protocolVersion, 2);
    assert.equal((0, test_types_js_1.record)(claim.wrapper).harnessId, 'agy');
    assert.equal(claim.sessionId, claim.nativeSessionId);
    assert.equal(claim.pid, Number((0, test_types_js_1.record)(spawn.paneProcess).pid), 'the claim pid is the relay pane process');
    assert.notEqual(claim.pid, process.pid, 'the relay is not a server child');
    assert.equal(claim.spawnToken, spawn.spawnToken, 'the launch token correlates the claim');
    const listed = await get('/api/sessions?active=1');
    const active = (0, test_types_js_1.records)(listed.body.active).map(row => (0, test_types_js_1.record)(row)).find(row => row.id === sessionId);
    const row = (0, test_types_js_1.record)((0, test_types_js_1.present)(active, 'the agy route is an active catalog row'));
    assert.equal(row.harnessId, 'agy');
    assert.equal(row.harnessLabel, 'Antigravity');
    assert.equal(row.closeMode, 'owned-pane');
    assert.equal(row.isActive, true);
    assert.equal((0, test_types_js_1.record)(row.capabilities).prompt, true);
    assert.equal((0, test_types_js_1.record)(row.capabilities).close, true);
    assert.equal((0, test_types_js_1.record)(row.capabilities).rename, false, 'ACP has no rename method');
    assert.equal((0, test_types_js_1.record)(row.capabilities).compact, false, 'compaction is not a pi-dish capability');
    const stream = (0, sse_reader_js_1.sseReader)(`${base}${sessionPath(sessionId, '/stream')}`);
    try {
        await stream.waitFor(event => event.event === 'init', 10000);
        const prompted = await post(sessionPath(sessionId, '/prompt'), { message: 'hello antigravity' });
        assert.equal(prompted.status, 200, JSON.stringify(prompted.body));
        const end = await stream.waitFor(event => event.event === 'message_end' && (0, test_types_js_1.record)((0, test_types_js_1.record)(event.data).message).role === 'assistant', 20000);
        assert.equal(messageText((0, test_types_js_1.record)(end.data).message), 'Fake Antigravity reply.');
        await stream.waitFor(event => event.event === 'turn_end', 20000);
    }
    finally {
        stream.close();
    }
    // Model and thinking routes go through the relay's ACP requests.
    const modelsResponse = await fetch(`${base}/api/models?sessionId=${encodeURIComponent(sessionId)}`);
    const modelsBody = await modelsResponse.json();
    assert.equal(modelsResponse.status, 200, JSON.stringify(modelsBody));
    const modelRows = (0, test_types_js_1.records)(modelsBody).map(model => (0, test_types_js_1.record)(model));
    assert.ok(modelRows.length > 0, 'the relay lists the account models');
    assert.ok(modelRows.every(model => String(model.id).startsWith('gemini-')), 'only Gemini models are offered');
    const thinking = await post(sessionPath(sessionId, '/thinking'), { level: 'high' });
    assert.equal(thinking.status, 200, JSON.stringify(thinking.body));
    const switched = await post(sessionPath(sessionId, '/model'), { modelId: 'google-antigravity/gemini-4-argon' });
    assert.equal(switched.status, 200, JSON.stringify(switched.body));
    assert.equal(readClaim(sessionId).model, 'google-antigravity/gemini-4-argon');
    assert.equal(readClaim(sessionId).thinkingLevel, 'high');
    // xhigh is part of agy's vocabulary, but ACP only offers it on Hydrogen.
    const carbonXhigh = await post(sessionPath(sessionId, '/thinking'), { level: 'xhigh' });
    assert.equal(carbonXhigh.status, 500, JSON.stringify(carbonXhigh.body));
    assert.match(String(carbonXhigh.body.error), /did not offer thinking level xhigh/);
    const hydrogen = await post(sessionPath(sessionId, '/model'), { modelId: 'google-antigravity/gemini-4-hydrogen' });
    assert.equal(hydrogen.status, 200, JSON.stringify(hydrogen.body));
    const hydrogenXhigh = await post(sessionPath(sessionId, '/thinking'), { level: 'xhigh' });
    assert.equal(hydrogenXhigh.status, 200, JSON.stringify(hydrogenXhigh.body));
    assert.equal(hydrogenXhigh.body.level, 'xhigh');
    assert.equal(readClaim(sessionId).thinkingLevel, 'xhigh');
    const messages = await get(sessionPath(sessionId, '/messages'));
    assert.equal(messages.status, 200, JSON.stringify(messages.body));
    const history = (0, test_types_js_1.records)(messages.body.messages).map(message => (0, test_types_js_1.record)(message));
    const user = history.find(message => message.role === 'user');
    assert.equal(messageText((0, test_types_js_1.present)(user)), 'hello antigravity');
    assert.equal(messageText(history.filter(message => message.role === 'assistant').pop()), 'Fake Antigravity reply.');
    // The mirror is a Pi-format JSONL beside its raw ACP sidecar, not agy's store.
    const mirrorRoot = path.join(tmpHome, '.pi', 'dish', 'agy', 'sessions');
    const mirrors = fs.readdirSync(mirrorRoot).filter(name => name.endsWith('.jsonl') && !name.endsWith('.acp.jsonl'));
    assert.equal(mirrors.length, 1, 'one owned session writes one mirror');
    const header = (0, test_types_js_1.record)(JSON.parse(fs.readFileSync(path.join(mirrorRoot, mirrors[0]), 'utf8').split('\n')[0]));
    assert.equal(header.type, 'session');
    assert.equal(path.resolve(String(header.cwd)), path.resolve(projDir));
    // The raw `<id>.acp.jsonl` sidecar must never surface as a second agy session.
    const everything = await get('/api/sessions');
    const agyRows = [...(0, test_types_js_1.records)(everything.body.active), ...(0, test_types_js_1.records)(everything.body.previous)]
        .map(candidate => (0, test_types_js_1.record)(candidate)).filter(candidate => candidate.harnessId === 'agy');
    assert.equal(agyRows.length, 1);
    const closed = await post(sessionPath(sessionId, '/close'), {});
    assert.equal(closed.status, 200, JSON.stringify(closed.body));
    assert.equal(closed.body.success, true);
    await until(() => tmuxLib.getSpawn(sessionId) === null);
    assert.equal(await tmuxLib.paneExists(String(spawn.socket), String(spawn.paneId)), false, 'close kills the relay pane');
    await until(() => !fs.existsSync(claimFile(sessionId)));
    const resumed = await post(sessionPath(sessionId, '/resume'), {});
    assert.equal(resumed.status, 200, JSON.stringify(resumed.body));
    assert.equal(resumed.body.id, sessionId);
    assert.equal(resumed.body.alreadyActive, undefined, 'a resumed mirror spawns a fresh relay pane');
    assert.ok(await tmuxLib.paneExists(String((0, test_types_js_1.present)(tmuxLib.getSpawn(sessionId)).socket), String((0, test_types_js_1.present)(tmuxLib.getSpawn(sessionId)).paneId)), 'resume opens a new pane');
    const reopened = await get(sessionPath(sessionId, '/stats'));
    assert.equal(reopened.status, 200, JSON.stringify(reopened.body));
    // A fresh ACP child reports its own defaults; only the mirror persists.
    assert.equal(typeof reopened.body.thinkingLevel, 'string');
    assert.equal((0, test_types_js_1.record)(reopened.body.runtime).kind, 'tmux');
    const second = await post(sessionPath(sessionId, '/prompt'), { message: 'after resume' });
    assert.equal(second.status, 200, JSON.stringify(second.body));
    const mirrorFile = path.join(mirrorRoot, mirrors[0]);
    await until(() => {
        try {
            return fs.readFileSync(mirrorFile, 'utf8').includes('after resume');
        }
        catch {
            return false;
        }
    });
    const afterResume = await get(sessionPath(sessionId, '/messages'));
    assert.equal(afterResume.status, 200, JSON.stringify(afterResume.body));
    assert.ok((0, test_types_js_1.records)(afterResume.body.messages).some(message => (0, test_types_js_1.record)(message).role === 'assistant' && messageText(message) === 'Fake Antigravity reply.'), 'the resumed relay serves the new turn');
    const reclosed = await post(sessionPath(sessionId, '/close'), {});
    assert.equal(reclosed.status, 200, JSON.stringify(reclosed.body));
});
test('agy ask dialog round-trips through the relay bridge', { timeout: 60000 }, async () => {
    process.env.PI_DISH_AGY_COMMAND = agyCommand('elicit');
    const created = await post('/api/sessions/new', { harness: 'agy', cwd: projDir });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const sessionId = String((0, test_types_js_1.present)(created.body.id));
    try {
        const claim = (0, test_types_js_1.present)(claimFor(sessionId), 'the elicit session registered');
        const live = await bridgeLib.getBridgeSession(claim);
        await live.waitForHello({ timeout: 5000 });
        const events = capture(live);
        const prompted = await post(sessionPath(sessionId, '/prompt'), { message: 'ask me something' });
        assert.equal(prompted.status, 200, JSON.stringify(prompted.body));
        await until(() => events.some(entry => entry.event === 'extension_ui_request'
            && (0, test_types_js_1.record)(entry.data).method === 'ask'));
        const request = (0, test_types_js_1.record)(events.find(entry => entry.event === 'extension_ui_request'
            && (0, test_types_js_1.record)(entry.data).method === 'ask').data);
        const answered = await post(sessionPath(sessionId, '/ui-response'), {
            requestId: String(request.id),
            value: { kind: 'submit', results: [{ id: 'q1', selectedOptions: ['yes'] }] },
        });
        assert.equal(answered.status, 200, JSON.stringify(answered.body));
        await until(() => events.some(entry => entry.event === 'extension_ui_resolved'
            && (0, test_types_js_1.record)(entry.data).id === request.id));
        await until(() => assistantText(events).includes('answer:'));
        assert.match(assistantText(events), /"content":\{"q1":"1"\}/, 'the answer reaches agy as the elicitation result');
        assert.equal(live.extUIState.dialogs.size, 0, 'the answered dialog leaves the replay state');
    }
    finally {
        process.env.PI_DISH_AGY_COMMAND = agyBinary;
        const closed = await post(sessionPath(sessionId, '/close'), {});
        assert.equal(closed.status, 200, JSON.stringify(closed.body));
    }
});
test('a dropped server connection does not lose a running turn', { timeout: 60000 }, async () => {
    process.env.PI_DISH_AGY_COMMAND = agyCommand('delayed');
    const created = await post('/api/sessions/new', { harness: 'agy', cwd: projDir });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const sessionId = String((0, test_types_js_1.present)(created.body.id));
    try {
        const first = await bridgeLib.getBridgeSession((0, test_types_js_1.present)(claimFor(sessionId), 'the session registered'));
        await first.waitForHello({ timeout: 5000 });
        const firstEvents = capture(first);
        const prompted = await post(sessionPath(sessionId, '/prompt'), { message: 'start a slow turn' });
        assert.equal(prompted.status, 200, JSON.stringify(prompted.body));
        await until(() => assistantText(firstEvents).includes('First part.') || firstEvents.some(entry => entry.event === 'message_update' && JSON.stringify(entry.data).includes('First part.')));
        assert.equal(readClaim(sessionId).turnInProgress, true, 'the claim shows the live turn');
        // Simulate a server restart: drop the pooled bridge socket and the registry
        // cache, then rediscover the session from disk and reconnect.
        first.close();
        bridgeLib.invalidateRegistryCache();
        const rediscovered = (0, test_types_js_1.present)(claimFor(sessionId), 'the running session is still registered');
        assert.equal(rediscovered.turnInProgress, true, 'rediscovery reports the turn as active');
        const second = await bridgeLib.getBridgeSession(rediscovered);
        const secondEvents = capture(second);
        const hello = await second.waitForHello({ timeout: 5000 });
        assert.equal(hello.turnInProgress, true, 'the replacement connection rejoins the running turn');
        await until(() => secondEvents.some(entry => entry.event === 'turn_end'));
        assert.equal(assistantText(secondEvents), 'First part. Second part.', 'the whole reply arrives after reconnect');
        // The relay broadcasts turn_end over the socket before writeClaim() atomically replaces the claim file.
        await until(() => readClaim(sessionId).turnInProgress === false, 5000);
        const messages = await get(sessionPath(sessionId, '/messages'));
        assert.equal(messages.status, 200, JSON.stringify(messages.body));
        const assistant = (0, test_types_js_1.records)(messages.body.messages).map(message => (0, test_types_js_1.record)(message))
            .filter(message => message.role === 'assistant').pop();
        assert.equal(messageText(assistant), 'First part. Second part.', 'the mirror holds the full reply');
    }
    finally {
        process.env.PI_DISH_AGY_COMMAND = agyBinary;
        const closed = await post(sessionPath(sessionId, '/close'), {});
        assert.equal(closed.status, 200, JSON.stringify(closed.body));
    }
});
test('agy relay keeps background tool turns live across end_turn and replays running tools on reconnect', { timeout: 60000 }, async () => {
    const savedIdle = process.env.PI_DISH_AGY_AUTONOMOUS_IDLE_MS;
    process.env.PI_DISH_AGY_AUTONOMOUS_IDLE_MS = '150';
    process.env.PI_DISH_AGY_COMMAND = agyCommand('background-reconnect');
    const created = await post('/api/sessions/new', { harness: 'agy', cwd: projDir });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const sessionId = String((0, test_types_js_1.present)(created.body.id));
    try {
        const first = await bridgeLib.getBridgeSession((0, test_types_js_1.present)(claimFor(sessionId), 'the session registered'));
        await first.waitForHello({ timeout: 5000 });
        const firstEvents = capture(first);
        const prompted = await post(sessionPath(sessionId, '/prompt'), { message: 'run background suite' });
        assert.equal(prompted.status, 200, JSON.stringify(prompted.body));
        await until(() => assistantText(firstEvents).includes('Running background suite.'));
        assert.equal(first.turnInProgress, true, 'turn stays active after end_turn while background command runs');
        assert.equal(first.runningToolCalls.has('call-bg-reconn'), true, 'running tool stays tracked on bridge');
        assert.equal(readClaim(sessionId).turnInProgress, true, 'registry claim reports active turn');
        const state = (0, test_types_js_1.record)(await first.send('get_state'));
        assert.equal((0, test_types_js_1.record)(state.lifecycle).backgroundWork, true, 'lifecycle reports active backgroundWork');
        assert.equal((0, test_types_js_1.record)(state.lifecycle).idle, false);
        // Reconnect a fresh bridge socket while the background command is still running.
        first.close();
        bridgeLib.invalidateRegistryCache();
        const second = await bridgeLib.getBridgeSession((0, test_types_js_1.present)(claimFor(sessionId), 'the running session is still registered'));
        const secondEvents = capture(second);
        const hello = await second.waitForHello({ timeout: 5000 });
        assert.equal(hello.turnInProgress, true);
        await until(() => second.runningToolCalls.has('call-bg-reconn'), 5000);
        await until(() => secondEvents.some(entry => entry.event === 'turn_end'), 10000);
        assert.equal(second.turnInProgress, false);
        assert.equal(second.runningToolCalls.size, 0);
        assert.match(assistantText(secondEvents), /Background suite finished\./);
    }
    finally {
        if (savedIdle === undefined)
            delete process.env.PI_DISH_AGY_AUTONOMOUS_IDLE_MS;
        else
            process.env.PI_DISH_AGY_AUTONOMOUS_IDLE_MS = savedIdle;
        process.env.PI_DISH_AGY_COMMAND = agyBinary;
        const closed = await post(sessionPath(sessionId, '/close'), {});
        assert.equal(closed.status, 200, JSON.stringify(closed.body));
    }
});
test('agy sessions refuse capabilities the relay does not carry', async () => {
    const created = await post('/api/sessions/new', { harness: 'agy', cwd: projDir });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const sessionId = String((0, test_types_js_1.present)(created.body.id));
    try {
        const renamed = await post(sessionPath(sessionId, '/rename'), { name: 'nope' });
        assert.equal(renamed.status, 409);
        assert.match(String(renamed.body.error), /does not support renaming/);
        const tree = await get(sessionPath(sessionId, '/tree'));
        assert.equal(tree.status, 409);
        assert.match(String(tree.body.error), /Antigravity/);
        const branch = await post(sessionPath(sessionId, '/branch'), { entryId: 'entry' });
        assert.equal(branch.status, 409);
        assert.match(String(branch.body.error), /Antigravity/);
        const followUp = await post(sessionPath(sessionId, '/follow-up'), { message: 'later' });
        assert.equal(followUp.status, 409);
        assert.match(String(followUp.body.error), /follow-ups/);
        const exported = await fetch(`${base}${sessionPath(sessionId, '/export')}`);
        assert.equal(exported.status, 200);
        assert.match(await exported.text(), /<html/i);
        const shared = await post(sessionPath(sessionId, '/share'), {});
        assert.equal(shared.status, 200, JSON.stringify(shared.body));
        const sharePath = String((0, test_types_js_1.present)(shared.body.path));
        const sharedHtml = await fetch(`${base}${sharePath}`);
        assert.equal(sharedHtml.status, 200);
        assert.match(await sharedHtml.text(), /<html/i);
        const named = await post('/api/sessions/new', { harness: 'agy', cwd: projDir, name: 'named' });
        assert.equal(named.status, 400);
        assert.match(String(named.body.error), /does not support naming/);
        const slash = await post(sessionPath(sessionId, '/command'), { message: '/definitely-not-a-command' });
        assert.equal(slash.status, 400);
        assert.match(String(slash.body.error), /unknown or unsupported command/);
    }
    finally {
        const closed = await post(sessionPath(sessionId, '/close'), {});
        assert.equal(closed.status, 200, JSON.stringify(closed.body));
    }
});
test('agy new-session applies a catalog model and thinking level to the relay', { timeout: 90000 }, async () => {
    const created = await post('/api/sessions/new', {
        harness: 'agy', cwd: projDir, model: 'google-antigravity/gemini-4-hydrogen', thinking: 'high',
    });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const sessionId = String((0, test_types_js_1.present)(created.body.id));
    try {
        await until(() => fs.existsSync(claimFile(sessionId)));
        const claim = readClaim(sessionId);
        assert.equal(claim.model, 'google-antigravity/gemini-4-hydrogen', 'the relay started on the picked model');
        assert.equal(claim.thinkingLevel, 'high', 'the relay applied the picked thought level');
        const listed = await get('/api/sessions?active=1');
        const row = (0, test_types_js_1.record)((0, test_types_js_1.present)((0, test_types_js_1.records)(listed.body.active).map(candidate => (0, test_types_js_1.record)(candidate))
            .find(candidate => candidate.id === sessionId), 'the new agy route is listed'));
        assert.equal(row.model, 'google-antigravity/gemini-4-hydrogen');
        assert.equal(row.thinkingLevel, 'high');
    }
    finally {
        await post(sessionPath(sessionId, '/close'), {});
    }
});
test('/api/usage-limits reports Gemini windows with the ACP tier and fails fast when signed out', async () => {
    const host = await get('/api/host');
    assert.equal((0, test_types_js_1.record)(host.body.capabilities).usageLimits, true);
    const ok = await get('/api/usage-limits');
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const agy = (0, test_types_js_1.record)((0, test_types_js_1.present)((0, test_types_js_1.records)(ok.body.harnesses).map(row => (0, test_types_js_1.record)(row)).find(row => row.harness === 'agy')));
    assert.equal(agy.error, undefined);
    const reports = (0, test_types_js_1.records)(agy.reports).map(row => (0, test_types_js_1.record)(row));
    assert.equal(reports.length, 1);
    assert.equal(reports[0].provider, 'google-antigravity');
    assert.equal(reports[0].planType, 'Google AI Ultra');
    const limits = (0, test_types_js_1.records)(reports[0].limits).map(row => (0, test_types_js_1.record)(row));
    assert.deepEqual(limits.map(row => row.label), ['5 hours', '7 days']);
    assert.equal(limits[0].usedFraction, 0.25);
    assert.ok(Math.abs(Number(limits[1].usedFraction) - 0.09) < 1e-9);
    process.env.PI_DISH_AGY_COMMAND = agyCommand('auth');
    const started = Date.now();
    try {
        const unauth = await get('/api/usage-limits');
        assert.equal(unauth.status, 200);
        const failed = (0, test_types_js_1.record)((0, test_types_js_1.present)((0, test_types_js_1.records)(unauth.body.harnesses).map(row => (0, test_types_js_1.record)(row)).find(row => row.harness === 'agy')));
        assert.match(String(failed.error), /not signed in on this host/);
        assert.ok(Date.now() - started < 5000, 'interactive auth prompt aborts immediately');
    }
    finally {
        process.env.PI_DISH_AGY_COMMAND = agyBinary;
    }
});
test('agy brain subagents, background tasks, task logs, swarm board, and slash commands wire end-to-end', { timeout: 90000 }, async () => {
    const created = await post('/api/sessions/new', { harness: 'agy', cwd: projDir });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const sessionId = String((0, test_types_js_1.present)(created.body.id));
    const nativeId = (0, test_types_js_1.present)(routeIdentity(sessionId)?.nativeSessionId, 'agy native id');
    const brainRoot = path.join(tmpHome, '.gemini', 'antigravity-cli', 'brain');
    const coordSys = path.join(brainRoot, nativeId, '.system_generated');
    const workerNativeId = '66666666-6666-6666-6666-666666666666';
    const subNativeId = '77777777-7777-7777-7777-777777777777';
    try {
        await until(() => fs.existsSync(claimFile(sessionId)));
        // Seed brain directory for the active agy session: background task, regular subagent, and live swarm.
        fs.mkdirSync(path.join(coordSys, 'logs'), { recursive: true });
        fs.mkdirSync(path.join(coordSys, 'tasks'), { recursive: true });
        fs.mkdirSync(path.join(coordSys, 'subagents'), { recursive: true });
        fs.mkdirSync(path.join(coordSys, 'swarm'), { recursive: true });
        fs.mkdirSync(path.join(brainRoot, workerNativeId, '.system_generated', 'logs'), { recursive: true });
        fs.mkdirSync(path.join(brainRoot, subNativeId, '.system_generated', 'logs'), { recursive: true });
        fs.writeFileSync(path.join(coordSys, 'logs', 'transcript.jsonl'), [
            {
                step_index: 1, type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-11-19T14:00:00Z',
                tool_calls: [{ name: 'run_command', args: { CommandLine: JSON.stringify('npm test'), toolSummary: JSON.stringify('Run suite') } }],
            },
            {
                step_index: 2, type: 'GENERIC', status: 'DONE', created_at: '2026-11-19T14:00:01Z',
                content: `Tool is running as a background task with task id: ${nativeId}/task-42\nLog output:\nrunning tests`,
            },
        ].map(r => JSON.stringify(r)).join('\n') + '\n');
        fs.writeFileSync(path.join(coordSys, 'tasks', 'task-42.log'), 'running tests\npass 1/2\n');
        fs.writeFileSync(path.join(coordSys, 'subagents', `${subNativeId}.json`), JSON.stringify({
            conversationId: subNativeId,
            subagentDescriptor: { typeName: 'research', role: 'Codebase Researcher' },
            state: 'SUBAGENT_STATE_ALIVE',
            spawnStepIndex: 3,
            workspaceUris: [`file://${projDir}`],
        }));
        fs.writeFileSync(path.join(brainRoot, subNativeId, '.system_generated', 'logs', 'transcript.jsonl'), [
            { step_index: 0, type: 'USER_INPUT', status: 'DONE', created_at: '2026-11-19T14:00:05Z', content: 'Audit routes' },
            { step_index: 1, type: 'PLANNER_RESPONSE', status: 'DONE', created_at: '2026-11-19T14:00:06Z', model: 'gemini-3.8-flash', content: 'Checked routes.' },
        ].map(r => JSON.stringify(r)).join('\n') + '\n');
        fs.writeFileSync(path.join(coordSys, 'subagents', `${workerNativeId}.json`), JSON.stringify({
            conversationId: workerNativeId,
            subagentDescriptor: { typeName: 'worker', role: 'Swarm Worker (verifier)' },
            state: 'SUBAGENT_STATE_ALIVE',
            spawnStepIndex: 4,
            workspaceUris: [`file://${projDir}`],
        }));
        fs.writeFileSync(path.join(brainRoot, workerNativeId, '.system_generated', 'logs', 'transcript.jsonl'), [
            { step_index: 0, type: 'USER_INPUT', status: 'DONE', created_at: '2026-11-19T14:00:10Z', content: 'Verify fixes' },
            { step_index: 1, type: 'PLANNER_RESPONSE', status: 'RUNNING', created_at: '2026-11-19T14:00:11Z', model: 'gemini-4-carbon', tool_calls: [{ name: 'run_command', args: { CommandLine: JSON.stringify('npm run check') } }] },
        ].map(r => JSON.stringify(r)).join('\n') + '\n');
        fs.writeFileSync(path.join(coordSys, 'swarm', 'swarm.json'), JSON.stringify({ version: 1, backend: 'local', swarm_id: 'sw-e2e' }));
        fs.writeFileSync(path.join(coordSys, 'swarm', 'members.json'), JSON.stringify({
            title: 'Fix tasks UI',
            members: {
                coordinator: { conversation_id: nativeId, role: 'coordinator', applied_model: 'gemini-4-carbon', phase: 'waiting', last_read_seq: 2 },
                verifier: { conversation_id: workerNativeId, role: 'worker', applied_model: 'gemini-4-carbon', phase: 'working', last_read_seq: 1 },
            },
        }));
        fs.writeFileSync(path.join(coordSys, 'swarm', 'board.jsonl'), [
            { seq: 1, agent: 'coordinator', text: '@verifier check the build', time: '2026-11-19 14:00:12', kind: 'brief' },
            { seq: 2, agent: 'verifier', text: '[done] @coordinator build is green', time: '2026-11-19 14:00:20' },
        ].map(r => JSON.stringify(r)).join('\n') + '\n');
        // 1. Tasks API + task log API + path traversal rejection.
        const tasksRes = await get(sessionPath(sessionId, '/tasks'));
        assert.equal(tasksRes.status, 200, JSON.stringify(tasksRes.body));
        assert.equal(tasksRes.body.supported, true);
        assert.equal((0, test_types_js_1.records)(tasksRes.body.tasks).length, 1);
        assert.equal((0, test_types_js_1.records)(tasksRes.body.tasks)[0].id, 'task-42');
        assert.equal((0, test_types_js_1.records)(tasksRes.body.subagents).length, 2);
        assert.equal((0, test_types_js_1.record)(tasksRes.body.swarm).title, 'Fix tasks UI');
        const logRes = await get(sessionPath(sessionId, '/tasks/task-42/log'));
        assert.equal(logRes.status, 200, JSON.stringify(logRes.body));
        assert.match(String(logRes.body.content), /pass 1\/2/);
        const badLog = await get(sessionPath(sessionId, '/tasks/task-missing/log'));
        assert.equal(badLog.status, 404);
        // 2. Lineage exposes brain subagent & swarm worker; child messages parse cleanly; resume is refused.
        const lineageRes = await get(sessionPath(sessionId, '/lineage'));
        assert.equal(lineageRes.status, 200, JSON.stringify(lineageRes.body));
        const tree = (0, test_types_js_1.record)(lineageRes.body.tree);
        const children = (0, test_types_js_1.records)(tree.children);
        assert.equal(children.length, 2, `expected 2 brain children in lineage, got ${JSON.stringify(children)}`);
        const workerNode = (0, test_types_js_1.present)(children.find(c => (0, test_types_js_1.record)(c.session).name === '@verifier'), 'swarm worker in lineage');
        const workerRouteId = String((0, test_types_js_1.present)((0, test_types_js_1.record)(workerNode.session).id));
        assert.equal((0, test_types_js_1.record)(workerNode.session).subagentLive, true);
        assert.equal((0, test_types_js_1.record)(workerNode.session).turnInProgress, true);
        const subNode = (0, test_types_js_1.present)(children.find(c => (0, test_types_js_1.record)(c.session).name === 'Codebase Researcher'), 'subagent in lineage');
        const subRouteId = String((0, test_types_js_1.present)((0, test_types_js_1.record)(subNode.session).id));
        const subMsgs = await get(sessionPath(subRouteId, '/messages'));
        assert.equal(subMsgs.status, 200, JSON.stringify(subMsgs.body));
        assert.ok((0, test_types_js_1.records)(subMsgs.body.messages).some(m => messageText(m).includes('Checked routes.')));
        const resumeSub = await post(sessionPath(subRouteId, '/resume'), {});
        assert.equal(resumeSub.status, 409, 'native agy brain subagents must not be resumed directly');
        // 3. Swarm API works from both coordinator and worker routes, including incremental ?since=.
        const swarmRes = await get(sessionPath(sessionId, '/swarm'));
        assert.equal(swarmRes.status, 200, JSON.stringify(swarmRes.body));
        assert.equal(swarmRes.body.hasSwarm, true);
        assert.equal(swarmRes.body.title, 'Fix tasks UI');
        assert.equal((0, test_types_js_1.records)(swarmRes.body.posts).length, 2);
        const swarmSince = await get(sessionPath(workerRouteId, '/swarm?since=1'));
        assert.equal(swarmSince.status, 200, JSON.stringify(swarmSince.body));
        assert.equal(swarmSince.body.coordinatorId, sessionId);
        assert.equal((0, test_types_js_1.records)(swarmSince.body.posts).length, 1);
        assert.equal((0, test_types_js_1.records)(swarmSince.body.posts)[0].seq, 2);
        // 4. Slash commands list includes swarm board / tasks / agents, and /command handles them cleanly.
        const cmdsResp = await fetch(`${base}/api/commands?sessionId=${encodeURIComponent(sessionId)}`);
        assert.equal(cmdsResp.status, 200);
        const cmdNames = (0, test_types_js_1.records)(await cmdsResp.json()).map(c => String(c.name));
        assert.ok(cmdNames.includes('swarm board'), 'commands include swarm board');
        assert.ok(cmdNames.includes('tasks'), 'commands include tasks');
        assert.ok(cmdNames.includes('agents'), 'commands include agents');
        for (const cmd of ['/swarm board', '/tasks', '/agents']) {
            const ran = await post(sessionPath(sessionId, '/command'), { message: cmd });
            assert.equal(ran.status, 200, `${cmd}: ${JSON.stringify(ran.body)}`);
        }
        // 5. Brain artifacts endpoint, file containment (allows brain .md, blocks .system_generated & symlinks),
        //    and HTML export + share on agy-brain-v1 subagent transcripts.
        const brainDir = path.dirname(coordSys);
        const planFile = path.join(brainDir, 'plan.md');
        fs.writeFileSync(planFile, '# Rollout Plan\n\nStep 1: ship it.\n');
        fs.writeFileSync(`${planFile}.metadata.json`, JSON.stringify({
            Summary: 'Rollout plan for tasks UI',
            UserFacing: true,
            RequestFeedback: true,
        }));
        const escapedTarget = path.join(tmpHome, 'secret-outside.md');
        fs.writeFileSync(escapedTarget, 'secret\n');
        fs.symlinkSync(escapedTarget, path.join(brainDir, 'escape.md'));
        const artsRes = await get(sessionPath(sessionId, '/artifacts'));
        assert.equal(artsRes.status, 200, JSON.stringify(artsRes.body));
        const arts = (0, test_types_js_1.records)(artsRes.body.artifacts);
        assert.equal(arts.length, 1);
        assert.equal(arts[0].name, 'plan.md');
        assert.equal(arts[0].requestFeedback, true);
        const previewRes = await get(sessionPath(sessionId, `/file?path=${encodeURIComponent(planFile)}`));
        assert.equal(previewRes.status, 200, JSON.stringify(previewRes.body));
        assert.match(String(previewRes.body.content), /Rollout Plan/);
        assert.equal((0, test_types_js_1.record)(previewRes.body.artifact).requestFeedback, true);
        const sysBlocked = await get(sessionPath(sessionId, `/file?path=${encodeURIComponent(path.join(coordSys, 'logs', 'transcript.jsonl'))}`));
        assert.equal(sysBlocked.status, 404, 'must not expose .system_generated files via brain root');
        const symBlocked = await get(sessionPath(sessionId, `/file?path=${encodeURIComponent(path.join(brainDir, 'escape.md'))}`));
        assert.equal(symBlocked.status, 404, 'must reject symlink escapes out of brain dir');
        const subExport = await fetch(`${base}${sessionPath(subRouteId, '/export')}`);
        const subExportHtml = await subExport.text();
        assert.equal(subExport.status, 200, subExportHtml);
        assert.match(subExportHtml, /<html/i);
        const subShare = await post(sessionPath(subRouteId, '/share'), {});
        assert.equal(subShare.status, 200, JSON.stringify(subShare.body));
        const subShareHtml = await fetch(`${base}${String((0, test_types_js_1.present)(subShare.body.path))}`);
        assert.equal(subShareHtml.status, 200);
        assert.match(await subShareHtml.text(), /<html/i);
    }
    finally {
        await post(sessionPath(sessionId, '/close'), {});
    }
});
test('agy relay supports /btw Side Chat (ask, stream, follow-up, cancel, close) without touching main history', { timeout: 90000 }, async () => {
    const created = await post('/api/sessions/new', { harness: 'agy', cwd: projDir });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const sessionId = String((0, test_types_js_1.present)(created.body.id));
    try {
        await until(() => fs.existsSync(claimFile(sessionId)));
        // Commands catalog advertises /btw.
        const cmdsResp = await fetch(`${base}/api/commands?sessionId=${encodeURIComponent(sessionId)}`);
        assert.equal(cmdsResp.status, 200);
        const cmdNames = (0, test_types_js_1.records)(await cmdsResp.json()).map(c => String(c.name));
        assert.ok(cmdNames.includes('btw'), `expected /btw in agy commands, got ${JSON.stringify(cmdNames)}`);
        // Start via /btw command.
        const started = await post(sessionPath(sessionId, '/command'), { message: '/btw quick question' });
        assert.equal(started.status, 200, JSON.stringify(started.body));
        const initialChat = (0, test_types_js_1.record)((0, test_types_js_1.present)(started.body.sideChat));
        const chatId = String((0, test_types_js_1.present)(initialChat.id));
        // Poll /side-chat until turn 1 settles with the streamed answer.
        const pollUntil = async (fn, timeoutMs = 10_000) => {
            const deadline = Date.now() + timeoutMs;
            while (Date.now() < deadline) {
                if (await fn())
                    return;
                await new Promise(r => setTimeout(r, 25));
            }
            throw new Error('Timed out waiting for side chat state');
        };
        let settledChat = {};
        await pollUntil(async () => {
            const res = await get(sessionPath(sessionId, '/side-chat'));
            if (res.status !== 200 || !res.body.sideChat)
                return false;
            const sc = (0, test_types_js_1.record)(res.body.sideChat);
            const turns = (0, test_types_js_1.records)(sc.turns);
            if (turns.length === 1 && turns[0].status === 'complete') {
                settledChat = sc;
                return true;
            }
            return false;
        });
        assert.equal((0, test_types_js_1.records)(settledChat.turns)[0].answer, 'Side: answered "quick question"');
        // Follow-up in the same side chat reuses the sibling ACP session.
        const follow = await post(sessionPath(sessionId, '/side-chat'), { question: 'follow up', chatId });
        assert.equal(follow.status, 200, JSON.stringify(follow.body));
        await pollUntil(async () => {
            const res = await get(sessionPath(sessionId, '/side-chat'));
            const turns = (0, test_types_js_1.records)((0, test_types_js_1.record)(res.body.sideChat).turns);
            return turns.length === 2 && turns[1].status === 'complete' && turns[1].answer === 'Side: answered "follow up"';
        });
        // Cancel a slow side-chat turn cleanly.
        const slow = await post(sessionPath(sessionId, '/side-chat'), { question: 'slow check', chatId });
        assert.equal(slow.status, 200, JSON.stringify(slow.body));
        const cancelled = await post(sessionPath(sessionId, '/side-chat/cancel'), { chatId });
        assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
        const afterCancelTurns = (0, test_types_js_1.records)((0, test_types_js_1.record)(cancelled.body.sideChat).turns);
        assert.equal(afterCancelTurns[2]?.status, 'cancelled');
        // Close clears the side chat.
        const closed = await post(sessionPath(sessionId, '/side-chat/close'), { chatId });
        assert.equal(closed.status, 200, JSON.stringify(closed.body));
        assert.equal(closed.body.sideChat, null);
        // Main session mirror has zero messages from the side chat.
        const mainMsgs = await get(sessionPath(sessionId, '/messages'));
        assert.equal(mainMsgs.status, 200, JSON.stringify(mainMsgs.body));
        assert.equal((0, test_types_js_1.records)(mainMsgs.body.messages).length, 0, 'side chat must never pollute the main transcript');
        // Side-chat session id was recorded for agy-import exclusion.
        const { readAgySideChatIds } = require('../lib/acp-session.js');
        assert.ok(readAgySideChatIds().size >= 1, 'ephemeral side-chat session id should be recorded for import filtering');
    }
    finally {
        await post(sessionPath(sessionId, '/close'), {});
    }
});
test('agy relay accepts image-only prompt and steer while still rejecting empty payloads', { timeout: 90000 }, async () => {
    const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
    const created = await post('/api/sessions/new', { harness: 'agy', cwd: projDir });
    assert.equal(created.status, 200, JSON.stringify(created.body));
    const sessionId = String((0, test_types_js_1.present)(created.body.id));
    try {
        await until(() => fs.existsSync(claimFile(sessionId)));
        // Empty message with no valid images is still rejected.
        const empty = await post(sessionPath(sessionId, '/prompt'), { message: '', images: [] });
        assert.equal(empty.status, 400, JSON.stringify(empty.body));
        // Image-only prompt (empty message string + image block) succeeds through the relay.
        const stream = (0, sse_reader_js_1.sseReader)(`${base}${sessionPath(sessionId, '/stream')}`);
        try {
            await stream.waitFor(event => event.event === 'init', 10000);
            const prompted = await post(sessionPath(sessionId, '/prompt'), {
                message: '',
                images: [{ data: PNG, mimeType: 'image/png' }],
            });
            assert.equal(prompted.status, 200, JSON.stringify(prompted.body));
            await stream.waitFor(event => event.event === 'message_end' && (0, test_types_js_1.record)((0, test_types_js_1.record)(event.data).message).role === 'assistant', 20000);
            await stream.waitFor(event => event.event === 'turn_end', 20000);
        }
        finally {
            stream.close();
        }
        const messages = await get(sessionPath(sessionId, '/messages'));
        assert.equal(messages.status, 200, JSON.stringify(messages.body));
        const userMsg = (0, test_types_js_1.records)(messages.body.messages).find(msg => msg.role === 'user');
        const blocks = (0, test_types_js_1.records)((0, test_types_js_1.record)((0, test_types_js_1.present)(userMsg, 'image-only user message recorded in mirror')).content);
        assert.equal(blocks.some(block => block.type === 'image' && block.mimeType === 'image/png'), true, `expected image block in mirror, got ${JSON.stringify(blocks)}`);
        assert.equal(blocks.some(block => block.type === 'text' && block.text === ''), false, 'image-only prompt should not synthesize an empty text block');
        // Image-only steer also passes the relay guard.
        const steered = await post(sessionPath(sessionId, '/steer'), {
            message: '',
            images: [{ data: PNG, mimeType: 'image/png' }],
        });
        assert.equal(steered.status, 200, JSON.stringify(steered.body));
    }
    finally {
        await post(sessionPath(sessionId, '/close'), {});
    }
});
