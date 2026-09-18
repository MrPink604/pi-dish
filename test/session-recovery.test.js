// Generated tool from test/session-recovery.test.ts; edit that source and run npm run build:tools.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const node_child_process_1 = require("node:child_process");
const node_events_1 = require("node:events");
const node_stream_1 = require("node:stream");
const { createLineSplitter } = require('../lib/line-splitter.js');
const { processIdentity } = require('../lib/process-identity.js');
const recovery = require('../lib/session-recovery.js');
const { RPCSession } = require('../lib/rpc-session.js');
const { validSessionId } = require('../lib/session-key.js');
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const bunAvailable = (0, node_child_process_1.spawnSync)('bun', ['--version'], { stdio: 'ignore' }).status === 0;
function requiredRecord(record) {
    assert.ok(record);
    return record;
}
function fixture(t) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'dish-recovery-'));
    const previousHome = process.env.HOME;
    process.env.HOME = home;
    const childCompletions = new Map();
    const ownChild = (child) => {
        childCompletions.set(child, new Promise((resolve) => child.once('close', () => resolve())));
        return child;
    };
    t.after(async () => {
        for (const child of childCompletions.keys()) {
            if (child.exitCode === null && child.signalCode === null && !child.killed)
                child.kill('SIGKILL');
        }
        await Promise.all(childCompletions.values());
        if (previousHome === undefined)
            delete process.env.HOME;
        else
            process.env.HOME = previousHome;
        fs.rmSync(home, { recursive: true, force: true });
    });
    const sessionFile = path.join(home, 'session.jsonl');
    fs.writeFileSync(sessionFile, JSON.stringify({ type: 'session', id: 'native', cwd: home }) + '\n');
    const snapshot = {
        harnessId: 'pi', nativeSessionId: 'native', sessionFile, cwd: home,
        name: 'Durable work', model: 'provider/model', thinkingLevel: 'high',
        pid: process.pid, startTime: processIdentity(process.pid)?.startTime ?? null,
        instanceId: 'original-owner', activity: 'running', runId: 'run-one', shutdown: false,
    };
    const read = () => {
        const value = recovery.readRecord(snapshot.harnessId, snapshot.nativeSessionId);
        assert.ok(value);
        return value;
    };
    const append = (message) => fs.appendFileSync(sessionFile, JSON.stringify({ type: 'message', message }) + '\n');
    return { home, sessionFile, snapshot, read, append, ownChild };
}
test('durable observations survive writer exit, registry removal and module reload without losing controls', (t) => {
    const { home, snapshot, read } = fixture(t);
    recovery.patchControl('pi', 'native', { excluded: true, attempt: { delivery: 'uncertain', status: 'needs-review' } });
    const writerPath = path.join(__dirname, 'fixtures', 'session-recovery-writer.js');
    const writer = (0, node_child_process_1.spawnSync)(process.execPath, [writerPath], { env: { ...process.env, SNAPSHOT: JSON.stringify(snapshot) }, encoding: 'utf8' });
    assert.equal(writer.status, 0, writer.stderr);
    const saved = read();
    assert.equal(saved.activity, 'running');
    assert.equal(recovery.checkpointMatches(saved), true);
    const registry = path.join(home, '.pi', 'dish', 'sessions');
    fs.mkdirSync(registry, { recursive: true });
    fs.writeFileSync(path.join(registry, 'stale.json'), '{}');
    fs.rmSync(registry, { recursive: true });
    delete require.cache[require.resolve('../lib/session-recovery')];
    const reopened = require('../lib/session-recovery.js');
    assert.deepEqual(reopened.listRecords(), [saved]);
    assert.deepEqual(reopened.getControl('pi', 'native'), {
        excluded: true, closed: false, attempt: { delivery: 'uncertain', status: 'needs-review' },
    });
    assert.equal(requiredRecord(reopened.recordSession(snapshot)).observationId, saved.observationId, 'identical boundaries do not churn observations');
    for (const kind of ['observations', 'controls']) {
        const dir = path.join(home, '.pi', 'dish', 'recovery', kind);
        assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
        const files = fs.readdirSync(dir);
        assert.equal(files.length, 1, 'completed writes leave no temp files');
        assert.equal(fs.statSync(path.join(dir, files[0])).mode & 0o777, 0o600);
    }
});
test('checkpoints describe actual saved bytes and fail closed after changes or deletion', (t) => {
    const { snapshot, sessionFile, append } = fixture(t);
    const saved = requiredRecord(recovery.recordSession(snapshot));
    append({ role: 'user', content: 'new saved prompt' });
    assert.equal(recovery.checkpointMatches(saved), false);
    const newer = requiredRecord(recovery.recordSession(snapshot));
    assert.notEqual(newer.observationId, saved.observationId);
    assert.equal(recovery.checkpointMatches(newer), true);
    fs.unlinkSync(sessionFile);
    assert.equal(recovery.checkpointMatches(newer), false);
    const missing = requiredRecord(recovery.recordSession(snapshot));
    assert.equal(missing.checkpoint, null);
    assert.equal(recovery.checkpointMatches(missing), false);
});
test('failed durable control writes leave previous exclusion and delivery evidence intact', (t) => {
    fixture(t);
    const before = recovery.patchControl('pi', 'native', {
        excluded: true, attempt: { delivery: 'uncertain', status: 'needs-review' },
    });
    const fsync = fs.fsyncSync;
    fs.fsyncSync = () => { throw new Error('simulated storage failure'); };
    try {
        assert.throws(() => recovery.patchControl('pi', 'native', { excluded: false, attempt: null }), /storage failure/);
    }
    finally {
        fs.fsyncSync = fsync;
    }
    assert.deepEqual(recovery.getControl('pi', 'native'), before);
});
test('corrupt observations are isolated and corrupt controls cannot silently drop an exclusion', (t) => {
    const { home, snapshot } = fixture(t);
    recovery.recordSession(snapshot);
    const other = recovery.recordSession({ ...snapshot, nativeSessionId: '../../other/harness', harnessId: 'omp' });
    recovery.patchControl('pi', 'native', { excluded: true });
    const dir = path.join(home, '.pi', 'dish', 'recovery');
    for (const file of fs.readdirSync(path.join(dir, 'observations'))) {
        const filePath = path.join(dir, 'observations', file);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (typeof data === 'object' && data !== null && 'harnessId' in data && data.harnessId === 'pi')
            fs.writeFileSync(filePath, '{torn');
    }
    fs.writeFileSync(path.join(dir, 'observations', 'ignored.tmp'), '{torn');
    assert.equal(recovery.readRecord('pi', 'native'), null);
    assert.deepEqual(recovery.listRecords(), [other]);
    const controlFile = path.join(dir, 'controls', fs.readdirSync(path.join(dir, 'controls'))[0]);
    fs.writeFileSync(controlFile, '{torn');
    assert.equal(recovery.getControl('pi', 'native').excluded, true);
    const corruptAttempt = recovery.getControl('pi', 'native').attempt;
    assert.ok(corruptAttempt);
    assert.equal(corruptAttempt.status, 'needs-review');
    assert.throws(() => recovery.patchControl('pi', 'native', { excluded: false }));
    assert.equal(fs.readFileSync(controlFile, 'utf8'), '{torn');
});
test('HOME isolation and observation updates preserve independently written exclusions and close intent', (t) => {
    const { home, snapshot } = fixture(t);
    recovery.recordSession(snapshot);
    recovery.patchControl('pi', 'native', { closed: true, excluded: true });
    recovery.recordSession({ ...snapshot, runId: 'new-run', instanceId: 'new-owner' });
    assert.deepEqual(recovery.getControl('pi', 'native'), { closed: true, excluded: true, attempt: null });
    const otherHome = path.join(home, 'other-home');
    fs.mkdirSync(otherHome);
    process.env.HOME = otherHome;
    assert.deepEqual(recovery.listRecords(), []);
    assert.equal(recovery.readRecord('pi', 'native'), null);
    assert.deepEqual(recovery.getControl('pi', 'native'), { excluded: false, closed: false, attempt: null });
    process.env.HOME = home;
    assert.equal(requiredRecord(recovery.readRecord('pi', 'native')).runId, 'new-run');
});
test('initializing or disposing a new observer cannot consume an interrupted checkpoint; actual shutdown can', async (t) => {
    const { snapshot, read } = fixture(t);
    const before = recovery.recordSession(snapshot);
    const observer = recovery.createSessionObserver({ snapshot: () => ({ ...snapshot, instanceId: 'reopened' }), waitsForSettled: true });
    observer.initialize();
    observer.event('metadata');
    await delay(10);
    assert.deepEqual(read(), before);
    observer.event('shutdown');
    const ended = read();
    assert.equal(ended.instanceId, 'reopened');
    assert.equal(ended.shutdown, true);
    assert.equal(ended.activity, 'uncertain', 'generic shutdown is not proof of intentional user close');
    observer.dispose();
});
test('whole runs retain identity across model turns, wait for saved input, and settle after retries', async (t) => {
    const { snapshot, read, append } = fixture(t);
    const observer = recovery.createSessionObserver({ snapshot: () => snapshot, waitsForSettled: true });
    t.after(() => observer.dispose());
    observer.initialize();
    observer.event('agent_start');
    const starting = read();
    assert.equal(starting.activity, 'uncertain', 'input has not reached JSONL yet');
    observer.event('message_end', { message: { role: 'user' } });
    assert.equal(read().observationId, starting.observationId, 'message_end precedes native append');
    append({ role: 'user', content: 'perform the task' });
    await delay(10);
    assert.equal(read().activity, 'running');
    assert.equal(recovery.checkpointMatches(read()), true);
    observer.event('message_update', { message: { role: 'assistant', content: 'partial' } });
    const stable = read();
    await delay(10);
    assert.deepEqual(read(), stable, 'stream deltas do not create durable writes');
    append({ role: 'assistant', stopReason: 'toolUse', content: [] });
    observer.event('turn_end');
    await delay(10);
    assert.equal(read().activity, 'running');
    assert.equal(read().runId, starting.runId);
    observer.event('agent_end', { messages: [{ role: 'assistant', stopReason: 'error' }], willRetry: true });
    await delay(10);
    assert.equal(read().activity, 'running');
    assert.equal(read().runId, starting.runId);
    observer.event('agent_start');
    append({ role: 'assistant', stopReason: 'stop', content: 'done' });
    observer.event('agent_end', { messages: [{ role: 'assistant', stopReason: 'stop' }] });
    await delay(10);
    assert.equal(read().activity, 'uncertain', 'post-run compaction/continuation has not settled');
    assert.equal(read().runId, starting.runId);
    observer.event('agent_settled');
    await delay(10);
    assert.equal(read().activity, 'idle');
    assert.equal(read().runId, null);
});
test('aborted runs and unobserved compaction completion stay uncertain', async (t) => {
    const { snapshot, read, append } = fixture(t);
    const observer = recovery.createSessionObserver({ snapshot: () => snapshot, waitsForSettled: true });
    t.after(() => observer.dispose());
    observer.event('agent_start');
    append({ role: 'assistant', stopReason: 'aborted' });
    observer.event('agent_end', { messages: [{ role: 'assistant', stopReason: 'aborted' }] });
    observer.event('agent_settled');
    await delay(10);
    assert.equal(read().activity, 'uncertain');
    observer.event('compaction_start');
    observer.event('compaction_end', { unknown: true });
    await delay(10);
    assert.equal(read().activity, 'uncertain');
});
test('retirement cancels pending checkpoints so switched identities cannot receive stale callbacks', async (t) => {
    const { snapshot, read, append } = fixture(t);
    let active = snapshot;
    const observer = recovery.createSessionObserver({ snapshot: () => active });
    observer.event('agent_start');
    append({ role: 'user', content: 'work' });
    observer.event('message_end');
    observer.event('retire');
    observer.dispose();
    active = { ...snapshot, nativeSessionId: 'switched' };
    await delay(10);
    assert.equal(read().shutdown, true);
    assert.equal(read().activity, 'uncertain');
    assert.equal(recovery.readRecord('pi', 'switched'), null);
});
test('RPC recovery fallback yields to the live bridge and never retakes ownership after registry cleanup', async (t) => {
    const { home, snapshot, read, append } = fixture(t);
    const stdin = new node_stream_1.PassThrough();
    const stdout = new node_stream_1.PassThrough();
    const stderr = new node_stream_1.PassThrough();
    const stdio = [stdin, stdout, stderr, null, null];
    const proc = Object.assign(new node_child_process_1.ChildProcess(), { pid: process.pid, stdin, stdout, stderr, stdio });
    const nativeId = 'native';
    assert.ok(validSessionId(nativeId));
    const rpc = new RPCSession(nativeId, proc);
    rpc.cwd = home;
    rpc.sessionFile = snapshot.sessionFile;
    t.after(() => rpc.recoveryObserver.dispose());
    rpc.recoveryObserver.initialize();
    rpc.recoveryObserver.event('agent_start');
    append({ role: 'user', content: 'fallback work' });
    rpc.recoveryObserver.event('message_end');
    await delay(10);
    assert.equal(read().instanceId, rpc.recoveryInstanceId);
    const dir = path.join(home, '.pi', 'dish', 'sessions');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'bridge.json'), JSON.stringify({ ...snapshot, recoveryObservation: true }));
    const bridge = recovery.recordSession({ ...snapshot, instanceId: 'bridge-owner' });
    rpc.recoveryObserver.event('agent_start');
    assert.deepEqual(read(), bridge);
    fs.rmSync(dir, { recursive: true });
    proc.emit('exit', 0);
    assert.deepEqual(read(), bridge, 'bridge shutdown must not awaken an RPC second writer');
});
test('the real bridge checkpoints without a server and retires switched sessions', { skip: !bunAvailable }, async (t) => {
    const { home, ownChild } = fixture(t);
    const bridgeFixture = path.join(__dirname, 'fixtures', 'session-recovery-bridge.ts');
    const child = ownChild((0, node_child_process_1.spawn)('bun', [bridgeFixture], {
        cwd: path.join(__dirname, '..'),
        env: { ...process.env, HOME: home, TMUX: '', TMUX_PANE: '', PI_DISH_SOCKET_DIR: path.join(home, 'sockets') },
        stdio: ['pipe', 'pipe', 'pipe'],
    }));
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const pending = new Map();
    const seen = new Set();
    child.stdout.on('data', createLineSplitter((line) => {
        seen.add(line);
        pending.get(line)?.();
    }));
    const wait = (line) => seen.has(line) ? Promise.resolve() : new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Missing ${line}: ${stderr}`)), 5000);
        pending.set(line, () => { clearTimeout(timer); pending.delete(line); resolve(); });
    });
    await wait('READY');
    const send = (command) => { child.stdin.write(JSON.stringify(command) + '\n'); return wait('ACK:' + command); };
    await send('run');
    const first = requiredRecord(recovery.readRecord('omp', 'bridge-old'));
    assert.equal(first.activity, 'running');
    assert.equal(recovery.checkpointMatches(first), true);
    assert.equal(recovery.readRecord('pi', 'bridge-old'), null, 'a wrapper and stock bridge must not create duplicate recovery intent');
    await send('turn');
    assert.equal(requiredRecord(recovery.readRecord('omp', 'bridge-old')).runId, first.runId);
    assert.equal(requiredRecord(recovery.readRecord('omp', 'bridge-old')).activity, 'running');
    await send('switch');
    assert.equal(requiredRecord(recovery.readRecord('omp', 'bridge-old')).shutdown, true);
    assert.equal(requiredRecord(recovery.readRecord('omp', 'bridge-new')).activity, 'idle');
    await send('child');
    assert.equal(recovery.readRecord('omp', 'worker'), null, 'nested subagents are not independently recoverable owners');
    const closed = child.exitCode === null ? (0, node_events_1.once)(child, 'close') : Promise.resolve();
    await send('shutdown');
    await closed;
    assert.equal(requiredRecord(recovery.readRecord('omp', 'bridge-new')).shutdown, true);
    assert.equal(requiredRecord(recovery.readRecord('omp', 'bridge-new')).activity, 'uncertain');
    assert.deepEqual(fs.readdirSync(path.join(home, '.pi', 'dish', 'sessions')), []);
    assert.equal(recovery.readRecord('pi', 'bridge-old'), null, 'wrapper shutdown must not activate a previously suppressed stock observer');
});
