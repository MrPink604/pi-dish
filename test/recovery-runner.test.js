// Generated tool from test/recovery-runner.test.ts; edit that source and run npm run build:tools.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const node_child_process_1 = require("node:child_process");
const recovery_runner_1 = require("../lib/recovery-runner");
const process_identity_1 = require("../lib/process-identity");
const bridge_session_1 = require("../lib/bridge-session");
const harnesses_1 = require("../lib/harnesses");
const session_key_1 = require("../lib/session-key");
const session_source_1 = require("../lib/session-source");
function scenario(t, overrides = {}) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dish-recovery-runner-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'session.jsonl');
    fs.writeFileSync(file, [
        { type: 'session', id: 'session', cwd: dir },
        { type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'Deploy this project' }] } },
    ].map(value => JSON.stringify(value)).join('\n') + '\n');
    const record = { version: 1, harnessId: 'pi', nativeSessionId: 'session', sessionFile: file, cwd: dir,
        name: null, model: null, thinkingLevel: null, pid: 42, startTime: null, instanceId: 'fixture',
        bootId: null, checkpoint: null,
        observationId: 'observation', updatedAt: new Date(1).toISOString(), activity: 'idle', runId: null, shutdown: false, ...overrides.record };
    function observedLive(observation, recovered = record) {
        if (!observation)
            return null;
        const sessionId = recovered.nativeSessionId;
        assert.ok((0, session_key_1.validSessionId)(sessionId));
        const session = new bridge_session_1.BridgeSession({ sessionId, socketPath: path.join(dir, 'unused.sock'),
            harnessId: recovered.harnessId, sessionFile: recovered.sessionFile, cwd: recovered.cwd });
        session.turnInProgress = observation.turnInProgress;
        if (observation.compacting !== undefined)
            session.compacting = observation.compacting;
        return session;
    }
    let mode = overrides.mode || 'restore';
    let current = record;
    let live = observedLive(overrides.live || null);
    let control = { excluded: false, closed: false, attempt: null, ...overrides.control };
    let matched = true;
    const prompts = [], launches = [];
    const store = {
        listRecords: () => [current], readRecord: () => current,
        getControl: () => control,
        patchControl: (_harness, _id, patch) => { control = { ...control, ...patch }; return control; },
        checkpointMatches: () => matched,
    };
    const deps = {
        store, getMode: () => mode, routeId: r => r.nativeSessionId,
        probeLive: async () => live,
        validateRecord: r => {
            if (!fs.existsSync(r.cwd))
                throw new Error('Original working directory is missing');
            const descriptor = (0, harnesses_1.getHarness)(r.harnessId);
            assert.ok(descriptor);
            assert.ok((0, session_key_1.validSessionId)(r.nativeSessionId));
            return (0, session_source_1.sourceForIdentity)(descriptor.id, r.nativeSessionId, r.sessionFile);
        },
        restore: async (r) => { launches.push(r.nativeSessionId); live = observedLive({ turnInProgress: false }, r); return { success: true, id: r.nativeSessionId }; },
        continueSession: async (_r, _session, text) => { prompts.push(text); },
        ...overrides.deps,
    };
    const runner = (0, recovery_runner_1.createRecoveryRunner)(deps);
    return { runner, deps, record, store, prompts, launches, file,
        control: () => control, row: () => {
            const row = runner.report().sessions[0];
            assert.ok(row);
            return row;
        },
        setMode: (v) => { mode = v; }, setMatch: (v) => { matched = v; },
        setLive: (v) => { live = observedLive(v, current); },
        setRecord: (v) => { current = v; } };
}
test('off startup never launches, including a later settings change without another startup', async (t) => {
    const s = scenario(t, { mode: 'off' });
    await s.runner.start();
    s.setMode('continue');
    await s.runner.start();
    assert.deepEqual(s.launches, []);
    assert.deepEqual(s.prompts, []);
});
test('delayed configured startup restores old observations once without a browser or prompt', async (t) => {
    const s = scenario(t);
    await Promise.all([s.runner.start(), s.runner.start()]);
    assert.deepEqual(s.launches, ['session']);
    assert.deepEqual(s.prompts, []);
    assert.equal(s.row().status, 'restored');
});
test('idle working-set sessions restore again after a later process loss without prompting', async (t) => {
    const s = scenario(t, { mode: 'continue' });
    await s.runner.start();
    s.setLive(null);
    const nextStartup = (0, recovery_runner_1.createRecoveryRunner)(s.deps);
    await nextStartup.start();
    assert.deepEqual(s.launches, ['session', 'session']);
    assert.deepEqual(s.prompts, []);
    assert.equal(nextStartup.report().sessions[0].status, 'restored');
});
test('a surviving live agent takes precedence over old interrupted evidence', async (t) => {
    const s = scenario(t, { mode: 'continue', live: { turnInProgress: true }, record: { activity: 'running', runId: 'run' } });
    await s.runner.start();
    assert.equal(s.row().status, 'live');
    assert.deepEqual(s.launches, []);
    assert.deepEqual(s.prompts, []);
});
test('an interrupted matched run receives one inspection prompt, never the original request', async (t) => {
    const s = scenario(t, { mode: 'continue', record: { activity: 'running', runId: 'run' } });
    await s.runner.start();
    assert.equal(s.row().status, 'continued');
    assert.deepEqual(s.prompts, [recovery_runner_1.RECOVERY_PROMPT]);
    assert.notEqual(s.prompts[0], 'Deploy this project');
    s.setLive(null);
    const restart = (0, recovery_runner_1.createRecoveryRunner)(s.deps);
    await restart.start();
    assert.equal(restart.report().sessions[0].status, 'needs-review');
    assert.equal(s.launches.length, 1);
    assert.equal(s.prompts.length, 1);
});
test('advanced transcripts restore without an automatic prompt', async (t) => {
    const s = scenario(t, { mode: 'continue', record: { activity: 'running', runId: 'run' } });
    s.setMatch(false);
    await s.runner.start();
    assert.equal(s.row().status, 'needs-review');
    assert.deepEqual(s.launches, ['session']);
    assert.deepEqual(s.prompts, []);
});
test('a new lifecycle observation during restore suppresses continuation', async (t) => {
    const s = scenario(t, { mode: 'continue', record: { activity: 'running', runId: 'run' } });
    const restore = s.deps.restore;
    s.deps.restore = async (r) => { const result = await restore(r); s.setRecord({ ...r, activity: 'idle', observationId: 'new' }); return result; };
    const runner = (0, recovery_runner_1.createRecoveryRunner)(s.deps);
    await runner.start();
    assert.equal(runner.report().sessions[0].status, 'needs-review');
    assert.deepEqual(s.prompts, []);
});
test('uncertain delivery remains reviewable even when the agent survives', async (t) => {
    const s = scenario(t, { mode: 'continue', live: { turnInProgress: false },
        control: { attempt: { observationId: 'old', status: 'restoring', delivery: 'uncertain' } } });
    await s.runner.start();
    assert.equal(s.row().status, 'needs-review');
    assert.deepEqual(s.launches, []);
    assert.deepEqual(s.prompts, []);
});
test('lost prompt acknowledgement cannot cause a restart or explicit retry to resend', async (t) => {
    const s = scenario(t, { mode: 'continue', record: { activity: 'running', runId: 'run' } });
    s.deps.continueSession = async (_r, _live, text) => { s.prompts.push(text); throw new Error('socket closed after send'); };
    const runner = (0, recovery_runner_1.createRecoveryRunner)(s.deps);
    await runner.start();
    assert.equal(runner.report().sessions[0].status, 'needs-review');
    const attempt = s.control().attempt;
    assert.ok(attempt);
    assert.equal(attempt.delivery, 'uncertain');
    s.setLive(null);
    const restart = (0, recovery_runner_1.createRecoveryRunner)(s.deps);
    await restart.start();
    assert.equal(s.launches.length, 1);
    await restart.retry('session');
    assert.equal(s.launches.length, 2);
    assert.equal(s.prompts.length, 1);
    assert.equal(restart.report().sessions[0].status, 'needs-review');
});
test('overlapping explicit restores share one launch', async (t) => {
    const s = scenario(t);
    await Promise.all([s.runner.retry('session'), s.runner.retry('session')]);
    assert.deepEqual(s.launches, ['session']);
});
test('excluded and explicitly closed sessions do not recover', async (t) => {
    const excluded = scenario(t, { control: { excluded: true } });
    const closed = scenario(t, { control: { closed: true } });
    await Promise.all([excluded.runner.start(), closed.runner.start()]);
    assert.deepEqual(excluded.launches, []);
    assert.deepEqual(closed.launches, []);
    assert.equal(excluded.row().excluded, true);
    assert.equal(closed.row().status, 'closed');
});
test('hibernated sessions wait for a message at startup but stay explicitly restorable', async (t) => {
    const s = scenario(t);
    const runner = (0, recovery_runner_1.createRecoveryRunner)({ ...s.deps, hibernated: id => id === 'session' });
    await runner.start();
    assert.deepEqual(s.launches, []);
    const row = runner.report().sessions[0];
    assert.equal(row.status, 'pending');
    assert.match(String(row.reason), /^Hibernated under memory pressure/);
    await runner.retry('session');
    assert.deepEqual(s.launches, ['session']);
});
test('generic shutdown does not resurrect a deliberately quit TUI', async (t) => {
    const s = scenario(t, { mode: 'continue', record: { shutdown: true, activity: 'running', runId: 'run' } });
    await s.runner.start();
    assert.equal(s.row().status, 'needs-review');
    assert.deepEqual(s.launches, []);
});
test('missing original cwd fails before launching rather than falling back', async (t) => {
    const s = scenario(t, { record: { cwd: '/definitely-missing-recovery-workspace' } });
    await s.runner.start();
    assert.equal(s.row().status, 'failed');
    assert.deepEqual(s.launches, []);
});
test('unresolved tool effects and corrupt tails require review', async (t) => {
    const s = scenario(t);
    fs.appendFileSync(s.file, JSON.stringify({ type: 'message', message: {
            role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'deploy', name: 'bash' }],
        } }) + '\n');
    const missingResultReason = await (0, recovery_runner_1.continuationSafety)(s.file);
    assert.ok(typeof missingResultReason === 'string');
    assert.equal(Boolean(missingResultReason), true);
    fs.appendFileSync(s.file, JSON.stringify({ type: 'message', message: {
            role: 'toolResult', toolCallId: 'deploy', content: [{ type: 'text', text: 'done' }],
        } }) + '\n');
    assert.equal(await (0, recovery_runner_1.continuationSafety)(s.file), null);
    fs.appendFileSync(s.file, '{"type":"message"');
    const corruptReason = await (0, recovery_runner_1.continuationSafety)(s.file);
    assert.ok(typeof corruptReason === 'string');
    assert.equal(Boolean(corruptReason), true);
});
test('transcript entries that are not JSON objects cannot be verified', async (t) => {
    const s = scenario(t);
    const base = JSON.stringify({ type: 'message', message: { role: 'user', content: [{ type: 'text', text: 'go' }] } }) + '\n';
    for (const line of ['null', '[]', '42', '"text"']) {
        fs.writeFileSync(s.file, base + line + '\n');
        assert.ok(typeof await (0, recovery_runner_1.continuationSafety)(s.file) === 'string', `${line} is not a verifiable entry`);
    }
});
test('unverifiable assistant content restores for review without continuing automatically', async (t) => {
    const s = scenario(t, { mode: 'continue', record: { activity: 'running', runId: 'run' } });
    fs.appendFileSync(s.file, JSON.stringify({ type: 'message', message: {
            role: 'assistant', stopReason: 'toolUse', content: [null],
        } }) + '\n');
    await s.runner.start();
    assert.deepEqual(s.launches, ['session']);
    assert.equal(s.row().status, 'needs-review');
    assert.deepEqual(s.prompts, []);
    assert.equal(s.control().attempt?.delivery, null);
});
test('aborted responses and compaction are never automatically continued', async (t) => {
    const s = scenario(t);
    fs.appendFileSync(s.file, JSON.stringify({ type: 'message', message: {
            role: 'assistant', stopReason: 'aborted', content: [],
        } }) + '\n');
    const abortedReason = await (0, recovery_runner_1.continuationSafety)(s.file);
    assert.ok(typeof abortedReason === 'string');
    assert.equal(Boolean(abortedReason), true);
    fs.appendFileSync(s.file, JSON.stringify({ type: 'compaction', summary: 'partial' }) + '\n');
    const compactionReason = await (0, recovery_runner_1.continuationSafety)(s.file);
    assert.ok(typeof compactionReason === 'string');
    assert.equal(Boolean(compactionReason), true);
});
test('a compacting recovered session cannot receive a queued recovery prompt', async (t) => {
    const s = scenario(t, { mode: 'continue', record: { activity: 'running', runId: 'run' } });
    const restore = s.deps.restore;
    s.deps.restore = async (record) => {
        const result = await restore(record);
        s.setLive({ turnInProgress: false, compacting: true });
        return result;
    };
    const runner = (0, recovery_runner_1.createRecoveryRunner)(s.deps);
    await runner.start();
    assert.equal(runner.report().sessions[0].status, 'needs-review');
    assert.deepEqual(s.prompts, []);
});
test('an exclusion arriving during the final live handshake cancels continuation', async (t) => {
    const s = scenario(t, { mode: 'continue', record: { activity: 'running', runId: 'run' } });
    const probe = s.deps.probeLive;
    let probes = 0;
    s.deps.probeLive = async (record) => {
        const live = await probe(record);
        if (++probes === 2)
            s.store.patchControl('pi', 'session', { excluded: true });
        return live;
    };
    const runner = (0, recovery_runner_1.createRecoveryRunner)(s.deps);
    await runner.start();
    assert.deepEqual(s.prompts, []);
    assert.equal(s.control().excluded, true);
});
test('a genuine new run retires an old review outcome but not uncertain delivery', async (t) => {
    const s = scenario(t, { control: { attempt: {
                observationId: 'observation', status: 'needs-review', reason: 'old failure', delivery: null,
            } } });
    await s.runner.start();
    s.setRecord({ ...s.record, observationId: 'new-user-run', activity: 'idle' });
    assert.equal(s.row().status, 'pending');
    const restart = (0, recovery_runner_1.createRecoveryRunner)(s.deps);
    await restart.start();
    assert.deepEqual(s.launches, ['session']);
    assert.equal(restart.report().sessions[0].status, 'restored');
});
test('bounded reports prefer newest observations and closed records do not crowd out startup work', async (t) => {
    const s = scenario(t);
    const records = Array.from({ length: 5001 }, (_, index) => ({
        ...s.record, nativeSessionId: `closed-${index}`, updatedAt: new Date(index + 2).toISOString(),
    }));
    records.push({ ...s.record, nativeSessionId: 'eligible', updatedAt: new Date(1).toISOString() });
    s.deps.store.listRecords = () => [...records];
    const getControl = s.deps.store.getControl;
    s.deps.store.getControl = (harness, id) => ({ ...getControl(harness, id), closed: id.startsWith('closed-') });
    const runner = (0, recovery_runner_1.createRecoveryRunner)(s.deps);
    const report = runner.report();
    assert.equal(report.truncated, true);
    assert.equal(report.totalRecords, 5002);
    assert.equal(report.sessions.length, 5000);
    assert.equal(report.sessions[0].id, 'closed-5000');
    await runner.start();
    assert.deepEqual(s.launches, ['eligible']);
});
test('a malformed truthy delivery marker cannot authorize another idle restore', async (t) => {
    const delivery = { unexpected: 'confirmed' };
    const s = scenario(t, { control: { attempt: {
                observationId: 'observation', status: 'restored', delivery,
            } } });
    await s.runner.start();
    assert.deepEqual(s.launches, []);
    assert.deepEqual(s.prompts, []);
    assert.equal(s.row().status, 'needs-review');
    const attempt = s.control().attempt;
    assert.ok(attempt);
    assert.deepEqual(attempt.delivery, delivery);
});
test('legacy report values survive without broadening literal ambiguity checks', async (t) => {
    const attempt = {
        observationId: 'observation', status: ['restoring'], delivery: { value: 'uncertain' },
        reason: { legacy: 'detail' }, updatedAt: ['old timestamp'],
    };
    const s = scenario(t, { live: { turnInProgress: false }, control: { attempt } });
    assert.deepEqual(s.row().status, attempt.status);
    assert.deepEqual(s.row().reason, attempt.reason);
    assert.deepEqual(s.row().updatedAt, attempt.updatedAt);
    await s.runner.start();
    assert.equal(s.row().status, 'live');
    assert.deepEqual(s.launches, []);
    assert.deepEqual(s.prompts, []);
    assert.deepEqual(s.control().attempt, attempt);
});
test('an interrupted agy relay receives one recovery prompt like Pi and OMP', async (t) => {
    const s = scenario(t, { mode: 'continue', record: { harnessId: 'agy', activity: 'running', runId: 'run' } });
    await s.runner.start();
    assert.equal(s.row().status, 'continued');
    assert.deepEqual(s.launches, ['session']);
    assert.deepEqual(s.prompts, [recovery_runner_1.RECOVERY_PROMPT]);
});
test('a harness without a verified recovery prompt path restores but never prompts', async (t) => {
    const s = scenario(t, { mode: 'continue', record: { harnessId: 'prime', activity: 'running', runId: 'run' } });
    await s.runner.start();
    assert.deepEqual(s.launches, ['session'], 'the transcript is restored for review');
    assert.equal(s.row().status, 'needs-review');
    assert.match(String(s.row().reason), /no verified recovery prompt path/);
    assert.deepEqual(s.prompts, []);
});
test('a launch whose agent is not running and registered is never reported restored', async (t) => {
    const s = scenario(t, { deps: { restore: async (r) => ({ success: true, id: r.nativeSessionId }) } });
    await s.runner.start();
    assert.equal(s.row().status, 'needs-review');
    assert.match(String(s.row().reason), /not running with a registered bridge/);
});
test('a tmux server loss restores hung-up agents without prompting, respects continuationSafety and skips pending routine closes', async (t) => {
    const s = scenario(t, { mode: 'restore', record: { shutdown: true, activity: 'uncertain' } });
    await s.runner.start();
    assert.equal(s.row().status, 'needs-review', 'at startup a generic shutdown is still ambiguous');
    assert.deepEqual(s.launches, []);
    await s.runner.recoverLost(['session']);
    assert.equal(s.row().status, 'restored');
    assert.deepEqual(s.launches, ['session']);
    assert.deepEqual(s.prompts, []);
    // Even in continue mode for a running turn, tmux-lost restores idle without
    // starting a new paid turn and surfaces continuationSafety findings.
    const interrupted = scenario(t, { mode: 'continue', record: { shutdown: false, activity: 'running', runId: 'run-1' } });
    fs.appendFileSync(interrupted.file, JSON.stringify({
        type: 'message',
        message: { role: 'assistant', stopReason: 'toolUse', content: [{ type: 'toolCall', id: 'tc-1', name: 'bash' }] },
    }) + '\n');
    await interrupted.runner.recoverLost(['session']);
    assert.deepEqual(interrupted.launches, ['session']);
    assert.deepEqual(interrupted.prompts, [], 'tmux server loss must never send an automatic prompt');
    assert.equal(interrupted.row().status, 'needs-review');
    assert.match(String(interrupted.row().reason), /Tool calls have no recorded result/);
    // A completed one-shot routine waiting on its close grace timer is never resurrected.
    const closing = scenario(t, {
        mode: 'restore',
        record: { shutdown: true, activity: 'uncertain' },
        deps: { isPendingClose: id => id === 'session' },
    });
    await closing.runner.recoverLost(['session']);
    assert.deepEqual(closing.launches, []);
    assert.equal(closing.row().status, 'closed');
});
test('a tmux server loss with recovery off reports pending and waits for retry-all', async (t) => {
    const s = scenario(t, { mode: 'off', record: { shutdown: true, activity: 'uncertain' } });
    await s.runner.recoverLost(['session']);
    assert.equal(s.row().status, 'pending');
    assert.deepEqual(s.launches, []);
    const outcomes = await s.runner.retryAll();
    assert.deepEqual(outcomes.map(outcome => outcome.status), ['restored']);
    assert.deepEqual(s.launches, ['session']);
    assert.deepEqual(await s.runner.retryAll(), [], 'a running session leaves the retry-all set');
});
test('retry-all retries failed rows, leaves needs-review/ambiguous one-by-one, and honors the private PIN gate', async (t) => {
    const shutdown = scenario(t, { record: { shutdown: true, activity: 'uncertain' } });
    await shutdown.runner.start();
    assert.deepEqual(await shutdown.runner.retryAll(), []);
    assert.deepEqual(shutdown.launches, []);
    // Ambiguous delivery stays one-by-one even if it was also in the tmux-lost set.
    const ambiguous = scenario(t, {
        mode: 'off',
        control: { attempt: { observationId: 'observation', status: 'needs-review', delivery: 'uncertain' } },
    });
    await ambiguous.runner.recoverLost(['session']);
    assert.deepEqual(await ambiguous.runner.retryAll(), []);
    assert.deepEqual(ambiguous.launches, []);
    // Private sessions are hidden from locked reports and skipped by locked retry-all.
    const priv = scenario(t, {
        record: { nativeSessionId: 'private-sess', cwd: '/definitely-missing-recovery-workspace' },
        deps: { isPrivate: r => r.nativeSessionId === 'private-sess' },
    });
    await priv.runner.start();
    assert.equal(priv.runner.report().sessions.length, 1);
    assert.deepEqual(priv.runner.report({ includePrivate: false }).sessions, []);
    assert.equal(priv.runner.report({ includePrivate: false }).totalRecords, 0);
    priv.setRecord({ ...priv.record, nativeSessionId: 'private-sess', cwd: path.dirname(priv.file) });
    assert.deepEqual(await priv.runner.retryAll({ includePrivate: false }), []);
    assert.deepEqual(priv.launches, [], 'locked retry-all must never launch a private session');
    const unlocked = await priv.runner.retryAll({ includePrivate: true });
    assert.deepEqual(unlocked.map(outcome => outcome.status), ['restored']);
    assert.deepEqual(priv.launches, ['private-sess']);
});
test('persisted tmux loss limiter enforces exponential backoff, rolling cap, restart persistence and fail-closed corruption', t => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dish-recovery-runner-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    const stateFile = path.join(dir, 'tmux-recovery-state.json');
    let clock = 1_000_000;
    const open = () => (0, recovery_runner_1.createTmuxLossLimiter)({
        file: () => stateFile,
        now: () => clock,
        baseBackoffMs: 10_000,
        maxBackoffMs: 60_000,
        windowMs: 100_000,
        maxAttempts: 3,
    });
    const first = open();
    assert.equal(first.check().allowed, true);
    first.record();
    assert.equal(fs.statSync(stateFile).mode & 0o777, 0o600);
    // Re-open (simulating a pi-dish restart): backoff must persist across processes.
    const afterRestart = open();
    clock += 5_000;
    const blocked1 = afterRestart.check();
    assert.equal(blocked1.allowed, false);
    assert.match(blocked1.reason, /backoff/i);
    // After baseBackoffMs (10s), attempt 2 succeeds and backoff doubles to 20s.
    clock += 5_000;
    assert.equal(afterRestart.check().allowed, true);
    afterRestart.record();
    clock += 15_000;
    assert.equal(open().check().allowed, false, 'second backoff doubled to 20s');
    // After 20s, attempt 3 succeeds and reaches maxAttempts=3 in the 100s window.
    clock += 5_000;
    assert.equal(open().check().allowed, true);
    open().record();
    clock += 50_000;
    const capped = open().check();
    assert.equal(capped.allowed, false);
    assert.match(capped.reason, /limit of 3 attempt/);
    // Once the oldest attempt ages past windowMs (100s from initial 1_000_000), recovery opens again.
    clock = 1_000_000 + 100_000;
    assert.equal(open().check().allowed, true);
    // Corrupt state file fails closed.
    fs.writeFileSync(stateFile, '{corrupt');
    const corrupt = open().check();
    assert.equal(corrupt.allowed, false);
    assert.match(corrupt.reason, /corrupt/i);
});
test('watchTmuxServer distinguishes dead/replaced servers from slow servers and single-session exits', async (t) => {
    const sleeper = (0, node_child_process_1.spawn)('sleep', ['30'], { stdio: 'ignore' });
    t.after(() => sleeper.kill('SIGKILL'));
    const deadPid = sleeper.pid;
    assert.ok(deadPid);
    const deadIdentity = (0, process_identity_1.processIdentity)(deadPid);
    const selfIdentity = (0, process_identity_1.processIdentity)(process.pid);
    const parentIdentity = (0, process_identity_1.processIdentity)(process.ppid);
    assert.ok(deadIdentity && selfIdentity && parentIdentity);
    const livePane = (paneId) => ({ paneId, panePid: process.pid, dead: false, paneProcess: selfIdentity });
    let snapshot = { pid: selfIdentity.pid, server: selfIdentity, panes: new Map([['%0', livePane('%0')]]) };
    let agentIds = ['a', 'b'];
    let botIds = ['bot-1'];
    const lost = [];
    let configuredCount = 0;
    const watch = (0, recovery_runner_1.watchTmuxServer)({
        socket: '/unused',
        inspectServer: async () => snapshot,
        configureServer: async () => { configuredCount++; },
        snapshotSessions: (_socket, panes) => {
            const livePanes = [...panes.values()].filter(pane => !pane.dead);
            return livePanes.length
                ? { agentIds: [...agentIds], botIds: [...botIds], processes: [] }
                : { agentIds: [], botIds: [], processes: [] };
        },
        onLost: async (event) => { lost.push(event); },
        intervalMs: 3_600_000,
        settleMs: 0,
        exitWaitMs: 0,
    });
    t.after(() => watch.stop());
    await watch.tick();
    assert.equal(configuredCount, 1, 'configures exit-empty off once when first observing a server');
    // Slow running server: snapshot is null while server process is still alive -> NOT a loss.
    snapshot = null;
    await watch.tick();
    assert.equal(lost.length, 0, 'no answer from a live server process is not a loss');
    // Single session exits while server keeps the same identity -> NOT a loss.
    snapshot = { pid: selfIdentity.pid, server: selfIdentity, panes: new Map() };
    await watch.tick();
    assert.equal(lost.length, 0, 'an empty server with the same identity means sessions exited on their own');
    // Dead remain-on-exit pane is excluded and never queued for recovery.
    snapshot = {
        pid: selfIdentity.pid,
        server: selfIdentity,
        panes: new Map([['%0', { paneId: '%0', panePid: null, dead: true, paneProcess: null }]]),
    };
    await watch.tick();
    assert.equal(lost.length, 0);
    // Re-populate live pane, then replace server PID -> triggers onLost with agents and bots.
    snapshot = { pid: selfIdentity.pid, server: selfIdentity, panes: new Map([['%0', livePane('%0')]]) };
    await watch.tick();
    snapshot = { pid: parentIdentity.pid, server: parentIdentity, panes: new Map() };
    await watch.tick();
    assert.equal(lost.length, 1);
    assert.deepEqual(lost[0]?.agentIds, ['a', 'b']);
    assert.deepEqual(lost[0]?.botIds, ['bot-1']);
    assert.equal(lost[0]?.replacementPid, parentIdentity.pid);
    // Dead server process exits -> triggers onLost.
    agentIds = ['c'];
    botIds = [];
    snapshot = { pid: deadIdentity.pid, server: deadIdentity, panes: new Map([['%1', livePane('%1')]]) };
    await watch.tick();
    sleeper.kill('SIGKILL');
    await new Promise(resolve => sleeper.once('exit', resolve));
    snapshot = null;
    await watch.tick();
    assert.equal(lost.length, 2);
    assert.deepEqual(lost[1]?.agentIds, ['c']);
    assert.deepEqual(lost[1]?.botIds, []);
    assert.equal(lost[1]?.replacementPid, null);
});
