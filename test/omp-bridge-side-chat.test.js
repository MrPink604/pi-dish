// Generated test/tool from test/omp-bridge-side-chat.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const node_child_process_1 = require("node:child_process");
const node_events_1 = require("node:events");
const promises_1 = require("node:timers/promises");
const test_types_js_1 = require("./test-types.js");
const sessionKey = require('../lib/session-key.js');
function decodeClaim(value) {
    const claim = (0, test_types_js_1.record)(value);
    assert.ok(sessionKey.validSessionId(claim.sessionId));
    assert.ok(typeof claim.socketPath === 'string');
    return { ...claim, sessionId: claim.sessionId, socketPath: claim.socketPath };
}
const bridge = require('../lib/bridge-session.js');
const bunAvailable = (0, node_child_process_1.spawnSync)('bun', ['--version'], { stdio: 'ignore' }).status === 0;
async function startFakeHost({ btwError = '', btwAnswer = '', btwDelayMs = 0 } = {}) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-omp-side-chat-'));
    const home = path.join(root, 'home');
    const socketDir = path.join(root, 'sockets');
    const sessionFile = path.join(root, 'fake-omp.jsonl');
    const callFile = path.join(root, 'btw-call.json');
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(socketDir, { recursive: true, mode: 0o700 });
    const child = (0, node_child_process_1.spawn)('bun', [path.join(__dirname, 'fixtures', 'fake-omp-bridge-host.ts')], {
        cwd: path.resolve(__dirname, '..'),
        env: {
            ...process.env,
            HOME: home,
            // A fake host must not adopt (and rename) the tmux pane running the tests.
            TMUX: '',
            TMUX_PANE: '',
            PI_DISH_SOCKET_DIR: socketDir,
            FAKE_OMP_SESSION_FILE: sessionFile,
            FAKE_OMP_HAS_BTW: '1',
            FAKE_OMP_BTW_CALL: callFile,
            FAKE_OMP_BTW_ERROR: btwError,
            FAKE_OMP_BTW_ANSWER: btwAnswer,
            FAKE_OMP_BTW_DELAY_MS: String(btwDelayMs),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', chunk => { stderr += chunk; });
    try {
        let stdout = '';
        const ready = (async () => {
            for await (const chunk of child.stdout) {
                stdout += chunk;
                if (stdout.includes('READY'))
                    return;
            }
            throw new Error(`fake host exited ${child.exitCode}: ${stderr}`);
        })();
        // The external Bun fixture exposes only its READY line; real time bounds a missing process signal.
        const timeout = new AbortController();
        try {
            await Promise.race([
                ready,
                (0, promises_1.setTimeout)(5000, undefined, { signal: timeout.signal }).then(() => { throw new Error(`fake host timeout: ${stderr}`); }),
            ]);
        }
        finally {
            timeout.abort();
        }
    }
    catch (error) {
        child.kill('SIGTERM');
        fs.rmSync(root, { recursive: true, force: true });
        throw error;
    }
    const registryDir = path.join(home, '.pi', 'dish', 'sessions');
    const registryName = fs.readdirSync(registryDir).find(name => name.endsWith('.json'));
    assert.ok(registryName);
    const parsedClaim = JSON.parse(fs.readFileSync(path.join(registryDir, registryName), 'utf8'));
    const claim = decodeClaim(parsedClaim);
    return {
        root, sessionFile, callFile, claim, child,
        async close() {
            if (child.exitCode === null && child.signalCode === null) {
                let closed = (0, node_events_1.once)(child, 'close');
                child.kill('SIGTERM');
                await Promise.race([closed, (0, promises_1.setTimeout)(3000)]);
                if (child.exitCode === null && child.signalCode === null) {
                    closed = (0, node_events_1.once)(child, 'close');
                    child.kill('SIGKILL');
                    await closed;
                }
            }
            fs.rmSync(root, { recursive: true, force: true });
        },
    };
}
/** The wire state of a side_chat snapshot (`{ sideChat }`), or null. */
function chatOf(data) {
    const container = (0, test_types_js_1.record)(data);
    return container.sideChat === null ? null : (0, test_types_js_1.record)(container.sideChat);
}
function turnsOf(chat) {
    return chat ? (0, test_types_js_1.records)(chat.turns) : [];
}
function lastTurn(chat) {
    const turns = turnsOf(chat);
    assert.ok(turns.length > 0, 'the side chat has a turn');
    return turns[turns.length - 1];
}
function waitForSideChat(session, predicate, timeoutMs = 5000) {
    return new Promise((resolve, reject) => {
        const onEvent = (data) => {
            let matched = false;
            try {
                matched = predicate(chatOf(data));
            }
            catch {
                matched = false;
            }
            if (!matched)
                return;
            clearTimeout(timer);
            session.off('side_chat', onEvent);
            resolve(data);
        };
        const timer = setTimeout(() => {
            session.off('side_chat', onEvent);
            reject(new Error('timed out waiting for a side_chat snapshot'));
        }, timeoutMs);
        session.on('side_chat', onEvent);
    });
}
function collectSideChatEvents(session) {
    const snapshots = [];
    const deltas = [];
    session.on('side_chat', data => snapshots.push(data));
    session.on('side_chat_delta', data => deltas.push((0, test_types_js_1.record)(data)));
    return { snapshots, deltas };
}
test('OMP bridge advertises sideChat and lists /btw', { skip: !bunAvailable }, async () => {
    const host = await startFakeHost();
    const session = new bridge.BridgeSession(host.claim);
    try {
        await session.connect();
        const advertised = (0, test_types_js_1.record)(session.capabilities);
        assert.equal(advertised.sideChat, true, 'wrapper advertises the sideChat capability');
        assert.equal('btw' in advertised, false, 'the old btw capability is gone');
        const commands = (0, test_types_js_1.records)((0, test_types_js_1.record)(await session.getCommands()).commands);
        const listed = commands.find(command => command.name === 'btw');
        assert.ok(listed, 'btw is still the command name');
        assert.equal(listed.supported, true);
    }
    finally {
        session.close();
        await host.close();
    }
});
test('OMP bridge answers a side chat asynchronously without touching the transcript', { skip: !bunAvailable }, async () => {
    const answer = '42 — the ephemeral answer';
    const host = await startFakeHost({ btwAnswer: answer, btwDelayMs: 500 });
    const session = new bridge.BridgeSession(host.claim);
    try {
        await session.connect();
        const { deltas } = collectSideChatEvents(session);
        const completed = waitForSideChat(session, chat => lastTurn(chat).status === 'complete');
        const before = fs.readFileSync(host.sessionFile, 'utf8');
        const askedAt = Date.now();
        const asked = (0, test_types_js_1.record)(await session.send('side_chat_ask', { question: '  what is the answer?  ' }));
        assert.ok(Date.now() - askedAt < 500, 'the ask returns before the provider turn finishes');
        const chat = chatOf(asked);
        assert.ok(chat, 'the response carries the side chat');
        assert.ok(typeof chat.id === 'string' && chat.id.length > 0);
        const started = lastTurn(chat);
        assert.equal(started.status, 'running');
        assert.equal(started.answer, '', 'nothing streamed yet');
        assert.equal(started.question, 'what is the answer?', 'the question is trimmed');
        assert.ok(typeof started.id === 'string');
        const finished = chatOf(await completed);
        const final = lastTurn(finished);
        assert.equal(final.status, 'complete');
        assert.equal(final.answer, answer);
        assert.equal(final.id, started.id, 'the same turn completed');
        assert.equal(finished?.id, chat.id, 'the same chat stayed open');
        assert.ok(deltas.length >= 2, 'the answer streams in deltas');
        assert.equal(deltas.map(delta => String(delta.delta)).join(''), answer);
        for (const delta of deltas) {
            assert.equal(delta.chatId, chat.id);
            assert.equal(delta.turnId, started.id);
        }
        const calls = JSON.parse(fs.readFileSync(host.callFile, 'utf8'));
        const call = (0, test_types_js_1.record)((0, test_types_js_1.records)(calls)[0]);
        assert.match(String(call.promptText), /what is the answer\?/, 'the question reaches the ephemeral turn');
        assert.match(String(call.promptText), /Ephemeral side question/, 'OMP’s btw template wraps the question');
        assert.equal(call.conversationKey, `side:${chat.id}`);
        assert.deepEqual(call.history, [], 'the first turn has no history');
        assert.equal(fs.readFileSync(host.sessionFile, 'utf8'), before, 'the side chat never persists');
    }
    finally {
        session.close();
        await host.close();
    }
});
test('OMP bridge keeps follow-ups in one side chat and refuses them while it answers', { skip: !bunAvailable }, async () => {
    const firstAnswer = 'the first side answer';
    const host = await startFakeHost({ btwAnswer: firstAnswer, btwDelayMs: 1000 });
    const session = new bridge.BridgeSession(host.claim);
    try {
        await session.connect();
        const firstComplete = waitForSideChat(session, chat => lastTurn(chat).status === 'complete');
        const asked = (0, test_types_js_1.record)(await session.send('side_chat_ask', { question: 'first?' }));
        const chat = chatOf(asked);
        assert.ok(chat);
        const chatId = String(chat.id);
        await assert.rejects(session.send('side_chat_ask', { question: 'too soon?', chatId }), /still answering/);
        const first = lastTurn(chatOf(await firstComplete));
        assert.equal(first.status, 'complete');
        assert.equal(first.answer, firstAnswer);
        const followUpComplete = waitForSideChat(session, current => turnsOf(current).length === 2 && lastTurn(current).status === 'complete');
        const followedUp = (0, test_types_js_1.record)(await session.send('side_chat_ask', { question: 'second?', chatId }));
        const followUpChat = chatOf(followedUp);
        assert.equal(followUpChat?.id, chatId);
        assert.equal(turnsOf(followUpChat).length, 2);
        await followUpComplete;
        const calls = (0, test_types_js_1.records)(JSON.parse(fs.readFileSync(host.callFile, 'utf8')));
        assert.equal(calls.length, 2);
        // The earlier turn reaches OMP as a user/assistant message pair, the user
        // side wrapped in the same btw template as a fresh question.
        const history = (0, test_types_js_1.records)(calls[1].history);
        assert.deepEqual(history.map(message => message.role), ['user', 'assistant']);
        assert.match(String((0, test_types_js_1.records)(history[0].content)[0].text), /Ephemeral side question[\s\S]*Question:\nfirst\?$/);
        assert.deepEqual(history[1].content, [{ type: 'text', text: firstAnswer }]);
        assert.equal(history[1].stopReason, 'stop');
        assert.equal(calls[1].conversationKey, `side:${chatId}`);
        assert.equal(calls[1].conversationKey, calls[0].conversationKey, 'the chat keeps one conversation key');
        await assert.rejects(session.send('side_chat_ask', { question: 'orphan?', chatId: 'not-a-chat' }), /was closed/);
    }
    finally {
        session.close();
        await host.close();
    }
});
test('OMP bridge cancels a running side turn and a late answer cannot overwrite it', { skip: !bunAvailable }, async () => {
    const host = await startFakeHost({ btwAnswer: 'too late', btwDelayMs: 1000 });
    const session = new bridge.BridgeSession(host.claim);
    try {
        await session.connect();
        const { snapshots } = collectSideChatEvents(session);
        const asked = (0, test_types_js_1.record)(await session.send('side_chat_ask', { question: 'slow question?' }));
        const chat = chatOf(asked);
        assert.ok(chat);
        const chatId = String(chat.id);
        assert.equal(lastTurn(chat).status, 'running');
        const cancelledSnapshot = waitForSideChat(session, current => lastTurn(current).status === 'cancelled');
        const cancelled = (0, test_types_js_1.record)(await session.send('side_chat_cancel', { chatId }));
        assert.equal(lastTurn(chatOf(cancelled)).status, 'cancelled');
        await cancelledSnapshot;
        // Past the fake's own delay (a separate process on the real clock, so no
        // fake timers can drive it): the aborted turn must not report completion.
        await (0, promises_1.setTimeout)(1200);
        for (const snapshot of snapshots) {
            for (const turn of turnsOf(chatOf(snapshot))) {
                assert.notEqual(turn.status, 'complete', 'a cancelled turn never completes later');
            }
        }
        const closed = (0, test_types_js_1.record)(await session.send('side_chat_close', { chatId }));
        assert.equal(closed.sideChat, null, 'closing clears the side chat');
        assert.equal(chatOf(snapshots[snapshots.length - 1]), null);
    }
    finally {
        session.close();
        await host.close();
    }
});
test('OMP bridge rejects a blank side question and surfaces host failures', { skip: !bunAvailable }, async () => {
    const host = await startFakeHost({ btwError: 'no model configured' });
    const session = new bridge.BridgeSession(host.claim);
    try {
        await session.connect();
        await assert.rejects(session.send('side_chat_ask', { question: '   ' }), /usage: \/btw <question>/);
        assert.ok(!fs.existsSync(host.callFile), 'a blank question never reaches the session');
        const errored = waitForSideChat(session, chat => lastTurn(chat).status === 'error');
        const asked = (0, test_types_js_1.record)(await session.send('side_chat_ask', { question: 'will this fail?' }));
        assert.equal(lastTurn(chatOf(asked)).status, 'running');
        const failed = lastTurn(chatOf(await errored));
        assert.equal(failed.status, 'error');
        assert.match(String(failed.error), /no model configured/);
        assert.equal(failed.question, 'will this fail?');
    }
    finally {
        session.close();
        await host.close();
    }
});
