// Generated test/tool from test/session-hibernation.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Memory-pressure hibernation (lib/session-hibernation.js): the pressure
 * thresholds, per-tree memory/kernel/service classification, the bounded
 * backwards `eval` scan, and the sampler's selection, skip and wake policy.
 * Ownership and live-safety proofs are ports here; their production
 * implementation is the shared lifecycle action tested in
 * test/session-bounces.test.js.
 *
 * HOME points at a temp dir so ~/.pi/dish/hibernation.json is per-test state.
 *
 * Run with: npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const promises_1 = require("node:timers/promises");
const session_hibernation_1 = require("../lib/session-hibernation");
const originalHome = process.env.HOME;
const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-hibernation-'));
process.env.HOME = tmpHome;
const dishDir = path.join(tmpHome, '.pi', 'dish');
const storeFile = path.join(dishDir, 'hibernation.json');
test.after(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    if (originalHome === undefined)
        delete process.env.HOME;
    else
        process.env.HOME = originalHome;
});
test.beforeEach(() => fs.rmSync(dishDir, { recursive: true, force: true }));
const GIB_KB = 1024 * 1024;
function meminfo({ totalGiB = 16, availableGiB = 8, swapTotalGiB = 16, swapFreeGiB = 16 } = {}) {
    return [
        `MemTotal:       ${totalGiB * GIB_KB} kB`,
        'MemFree:          100 kB',
        `MemAvailable:   ${Math.round(availableGiB * GIB_KB)} kB`,
        `SwapTotal:      ${swapTotalGiB * GIB_KB} kB`,
        `SwapFree:       ${Math.round(swapFreeGiB * GIB_KB)} kB`,
    ].join('\n');
}
test('pressure needs scarce available RAM or mostly used swap, at the documented boundaries', () => {
    const sample = (options) => {
        const parsed = (0, session_hibernation_1.parseMeminfo)(meminfo(options));
        assert.ok(parsed);
        return parsed;
    };
    assert.equal((0, session_hibernation_1.memoryPressure)(sample({ availableGiB: 1.6 })), null, 'exactly 10% available is not pressure');
    assert.match(String((0, session_hibernation_1.memoryPressure)(sample({ availableGiB: 1.5 }))), /^9% of RAM available/);
    assert.equal((0, session_hibernation_1.memoryPressure)(sample({ swapFreeGiB: 4 })), null, 'exactly 75% swap used is not pressure');
    assert.match(String((0, session_hibernation_1.memoryPressure)(sample({ swapFreeGiB: 3 }))), /^swap 81% used/);
    assert.equal((0, session_hibernation_1.memoryPressure)(sample({ swapTotalGiB: 0, swapFreeGiB: 0 })), null, 'a host without swap is judged on RAM only');
    assert.equal((0, session_hibernation_1.parseMeminfo)('SwapTotal: 1 kB'), null, 'missing MemAvailable cannot be judged');
    assert.equal((0, session_hibernation_1.parseMeminfo)(null), null);
});
function procTree(entries) {
    return {
        pids: () => Object.keys(entries).map(Number),
        read: (pid, file) => {
            const entry = entries[pid];
            if (!entry)
                return null;
            if (file === 'cmdline')
                return entry.argv.join('\0') + '\0';
            return `Name:\tx\nPPid:\t${entry.ppid}\nVmRSS:\t ${entry.rssKb ?? 0} kB\nVmSwap:\t ${entry.swapKb ?? 0} kB\n`;
        },
    };
}
test('process trees sum memory and classify kernels, broker services and browsers', () => {
    const proc = procTree({
        100: { ppid: 1, argv: ['/home/u/.local/bin/omp', '--resume', 'x.jsonl'], rssKb: 1000, swapKb: 4000 },
        101: { ppid: 100, argv: ['/usr/bin/python3', '-u', '/tmp/omp-python-runner-1000/runner-a.py'], rssKb: 10 },
        102: { ppid: 100, argv: ['/home/u/.local/bin/omp', '__omp_worker_js_eval_process'], rssKb: 20 },
        103: { ppid: 100, argv: ['/home/u/.local/bin/omp', '__omp_worker_daemon_broker'], rssKb: 30 },
        104: { ppid: 103, argv: ['/bin/zsh', '-c', 'npm run dev'], rssKb: 40 },
        105: { ppid: 104, argv: ['node', 'server.js'], rssKb: 50 },
        106: { ppid: 100, argv: ['/opt/google/chrome/chrome', '--headless'], rssKb: 60 },
        200: { ppid: 1, argv: ['/usr/bin/python3', '/tmp/omp-python-runner-1000/runner-b.py'], rssKb: 99999 },
    });
    const tree = (0, session_hibernation_1.inspectProcessTree)(100, proc);
    assert.ok(tree);
    assert.equal(tree.processes, 7, 'an unrelated kernel outside the tree is not counted');
    assert.equal(tree.rssBytes, (1000 + 10 + 20 + 30 + 40 + 50 + 60) * 1024);
    assert.equal(tree.swapBytes, 4000 * 1024);
    assert.deepEqual([...tree.kernels].sort(), ['JavaScript eval kernel', 'python eval kernel']);
    assert.equal(tree.serviceProcesses, 2, 'everything under the launch broker is a supervised service');
    assert.equal(tree.browserProcesses, 1);
    assert.equal((0, session_hibernation_1.inspectProcessTree)(999, proc), null, 'a vanished agent has no tree to judge');
});
function transcript(lines) {
    const file = path.join(tmpHome, `t-${Math.random().toString(36).slice(2)}.jsonl`);
    fs.writeFileSync(file, lines.map(line => JSON.stringify(line)).join('\n') + '\n');
    return file;
}
function toolCall(name, at) {
    return { type: 'message', timestamp: new Date(at).toISOString(), message: { role: 'assistant', content: [{ type: 'toolCall', id: 'c', name, arguments: {} }] } };
}
function text(at, body = 'ok') {
    return { type: 'message', timestamp: new Date(at).toISOString(), message: { role: 'user', content: [{ type: 'text', text: body }] } };
}
test('eval use is found only inside the window, reading backwards across chunk and multibyte boundaries', () => {
    const now = Date.UTC(2026, 9, 14, 12);
    const since = now - session_hibernation_1.HIBERNATION_EVAL_WINDOW_MS;
    const hour = 3_600_000;
    // A 300 KiB multibyte line forces the reader across its 256 KiB chunk boundary.
    const wide = text(now - hour, 'é'.repeat(150 * 1024));
    assert.equal((0, session_hibernation_1.evalUsedSince)(transcript([toolCall('eval', now - 3 * hour), wide, text(now - hour / 2)]), since), true);
    assert.equal((0, session_hibernation_1.evalUsedSince)(transcript([toolCall('eval', now - 10 * hour), text(now - 9 * hour), wide]), since), false, 'an older entry ends the search before an out-of-window eval');
    assert.equal((0, session_hibernation_1.evalUsedSince)(transcript([toolCall('bash', now - hour), wide]), since), false);
    assert.equal((0, session_hibernation_1.evalUsedSince)(transcript([toolCall('eval', now - 3 * hour), wide]), since, 64 * 1024), true, 'a window beyond the scan bound counts as recent use');
    assert.equal((0, session_hibernation_1.evalUsedSince)(null, since), true);
    assert.equal((0, session_hibernation_1.evalUsedSince)(path.join(tmpHome, 'missing.jsonl'), since), true);
});
function tree(extra = {}) {
    return { processes: 1, rssBytes: 512 * 1024 ** 2, swapBytes: 512 * 1024 ** 2, kernels: [], serviceProcesses: 0, browserProcesses: 0, ...extra };
}
function sampler(rows, { pressure = true, mode = 'pressure', viewers = {}, now = Date.UTC(2026, 9, 14, 12), executeFails = false } = {}) {
    const executed = [];
    const resumed = [];
    const errors = [];
    let resumeImpl = async (id) => { resumed.push(id); };
    const hibernation = (0, session_hibernation_1.createSessionHibernation)({
        readSettings: () => ({ hibernation: mode }),
        readMeminfo: () => meminfo(pressure ? { availableGiB: 0.5 } : {}),
        candidates: () => rows,
        viewers: id => viewers[id] || 0,
        capture: row => row,
        paneAttached: async (row) => !!row.attached,
        inspect: async (row) => ({ eligible: true, blockers: row.blockers || [] }),
        execute: async (row) => {
            if (executeFails)
                throw new Error('pane did not exit');
            executed.push(row.id);
        },
        resume: id => resumeImpl(id),
        processTree: pid => rows.find(row => row.pid === pid)?.tree ?? null,
        evalUsedSince: file => !!rows.find(row => row.sessionFile === file)?.evalRecent,
        now: () => now,
        log: { info: () => { }, error: message => { errors.push(message); } },
    });
    return { hibernation, executed, resumed, errors, setResume(impl) { resumeImpl = impl; } };
}
let nextPid = 1000;
function row(id, idleMs, extra = {}, now = Date.UTC(2026, 9, 14, 12)) {
    const pid = nextPid++;
    return { id, harnessId: 'omp', pid, sessionFile: `/s/${id}.jsonl`, lastActivity: new Date(now - idleMs).toISOString(), tree: tree(), ...extra };
}
test('the longest-idle provably idle session is hibernated, one per sample, with its record', async () => {
    const hour = 3_600_000;
    const rows = [
        row('newer', 3 * hour),
        row('oldest', 9 * hour, { tree: tree({ kernels: ['python eval kernel'], browserProcesses: 3 }) }),
    ];
    const { hibernation, executed } = sampler(rows);
    assert.deepEqual(await hibernation.tick(), { hibernated: 'oldest' });
    assert.deepEqual(executed, ['oldest']);
    const record = hibernation.records().get('oldest');
    assert.ok(record);
    assert.equal(record.freedBytes, 1024 ** 3);
    assert.deepEqual(record.discarded, ['python eval kernel', 'browser tabs'], 'a kernel idle beyond the eval window is discarded and recorded');
    assert.match(record.reason, /^Memory pressure: 3% of RAM available .*; idle 9 h$/);
    assert.equal(hibernation.isHibernated('oldest'), true);
    assert.ok(fs.existsSync(storeFile));
});
test('every unsafe or watched session is kept', async () => {
    const hour = 3_600_000, now = Date.UTC(2026, 9, 14, 12);
    const rows = [
        row('recent', session_hibernation_1.HIBERNATION_MIN_IDLE_MS - 1),
        row('unknown-activity', 0, { lastActivity: null }),
        row('working', 5 * hour, { turnInProgress: true }),
        row('asking', 5 * hour, { askPending: true }),
        row('compacting', 5 * hour, { compacting: true }),
        row('conflicted', 5 * hour, { conflicted: true }),
        row('prime', 5 * hour, { harnessId: 'prime' }),
        row('warm-cache', 5 * hour, { cacheExpiry: { expiresAt: now + 60_000 } }),
        row('viewed', 5 * hour),
        row('tmux', 5 * hour, { attached: true }),
        row('service', 5 * hour, { tree: tree({ serviceProcesses: 1 }) }),
        row('kernel-recent-eval', 5 * hour, { tree: tree({ kernels: ['python eval kernel'] }), evalRecent: true }),
        row('blocked', 5 * hour, { blockers: ['Waiting for background work and pending deliveries to finish.'] }),
        row('vanished', 5 * hour, { tree: null }),
    ];
    const { hibernation, executed } = sampler(rows, { viewers: { viewed: 1 } });
    assert.deepEqual(await hibernation.tick(), { skipped: 'No idle session is safe to hibernate.' });
    assert.deepEqual(executed, []);
    assert.equal(hibernation.records().size, 0);
});
test('no pressure or the off switch hibernates nothing', async () => {
    const rows = [row('idle', 5 * 3_600_000)];
    assert.deepEqual(await sampler(rows, { pressure: false }).hibernation.tick(), { skipped: 'No memory pressure.' });
    assert.deepEqual(await sampler(rows, { mode: 'off' }).hibernation.tick(), { skipped: 'Hibernation is off.' });
});
test('a failed stop records nothing and does not cascade to the next candidate', async () => {
    const rows = [row('a', 9 * 3_600_000), row('b', 8 * 3_600_000)];
    const { hibernation, errors } = sampler(rows, { executeFails: true });
    assert.deepEqual(await hibernation.tick(), { skipped: 'Hibernation failed; retrying at the next sample.' });
    assert.equal(hibernation.records().size, 0);
    assert.equal(errors.length, 1);
});
test('wake resumes once for concurrent messages, then forgets; live sessions shed stale records', async () => {
    const rows = [row('sleepy', 9 * 3_600_000)];
    const fixture = sampler(rows);
    await fixture.hibernation.tick();
    rows.length = 0;
    let release = () => { };
    fixture.setResume(id => new Promise(resolve => { fixture.resumed.push(id); release = resolve; }));
    const first = fixture.hibernation.wake('sleepy');
    const second = fixture.hibernation.wake('sleepy');
    await (0, promises_1.setImmediate)();
    release();
    assert.deepEqual(await Promise.all([first, second]), [true, true]);
    assert.deepEqual(fixture.resumed, ['sleepy']);
    assert.equal(fixture.hibernation.isHibernated('sleepy'), false);
    assert.equal(await fixture.hibernation.wake('sleepy'), false, 'a non-hibernated session is not resumed');
    // A failed resume leaves an ordinary inactive session rather than a retry loop.
    const failing = sampler([row('fragile', 9 * 3_600_000)]);
    await failing.hibernation.tick();
    failing.setResume(async () => { throw new Error('resume refused'); });
    await assert.rejects(failing.hibernation.wake('fragile'), /resume refused/);
    assert.equal(failing.hibernation.isHibernated('fragile'), false);
    // A session resumed by any other path (and now in use) sheds its record at the next sample.
    const elsewhere = [row('elsewhere', 9 * 3_600_000)];
    const other = sampler(elsewhere);
    await other.hibernation.tick();
    assert.equal(other.hibernation.isHibernated('elsewhere'), true);
    elsewhere[0] = { ...elsewhere[0], lastActivity: new Date(Date.UTC(2026, 9, 14, 12)).toISOString() };
    assert.deepEqual(await other.hibernation.tick(), { skipped: 'No idle session is safe to hibernate.' });
    assert.equal(other.hibernation.isHibernated('elsewhere'), false);
});
