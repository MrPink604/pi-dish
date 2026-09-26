// Generated test/tool from test/host-health.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Unit tests for lib/host-health.js — the on-demand host capacity snapshot
 * behind GET /api/host/health: CPU busy share between snapshots (or a short
 * first sample), Linux MemAvailable over freemem, platform load handling,
 * disk degradation and the brief sharing of concurrent reads.
 *
 * Run with: npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { createHostHealth, parseMemAvailable, defaultHostHealthDeps } = require('../lib/host-health.js');
const GB = 1024 ** 3;
const MEMINFO = 'MemTotal:       16384000 kB\nMemFree:         1024000 kB\nMemAvailable:    8192000 kB\nBuffers:          100 kB\n';
/** Two cores whose cumulative busy/idle times the test advances explicitly. */
function fakeDeps(overrides = {}) {
    const clock = { now: 1_000_000 };
    const cpu = { busy: 0, idle: 0 };
    const calls = { sleep: [], cpus: 0, statfs: [] };
    // Work done while a short sample sleeps, so first reads measure something.
    let duringSleep = { busy: 0, idle: 0 };
    const core = () => ({
        model: '  Fixture CPU  ', speed: 1000,
        times: { user: cpu.busy / 2, nice: 0, sys: cpu.busy / 2, idle: cpu.idle, irq: 0 },
    });
    const deps = {
        cpus: () => { calls.cpus++; return [core(), core()]; },
        loadavg: () => [1.5, 1, 0.5],
        totalmem: () => 16 * GB,
        freemem: () => 1 * GB,
        uptime: () => 3600.4,
        readMeminfo: () => MEMINFO,
        statfs: target => { calls.statfs.push(target); return { bsize: 4096, blocks: 1000, bavail: 250 }; },
        homedir: () => '/home/fixture',
        platform: 'linux',
        arch: 'x64',
        now: () => clock.now,
        sleep: async (ms) => {
            calls.sleep.push(ms);
            clock.now += ms;
            cpu.busy += duringSleep.busy;
            cpu.idle += duringSleep.idle;
        },
        ...overrides,
    };
    return {
        deps, clock, cpu, calls,
        work(busy, idle) { cpu.busy += busy; cpu.idle += idle; },
        sampleWork(busy, idle) { duringSleep = { busy, idle }; },
    };
}
test('parseMemAvailable reads kB from /proc/meminfo and tolerates absence', () => {
    assert.equal(parseMemAvailable(MEMINFO), 8192000 * 1024);
    assert.equal(parseMemAvailable('MemTotal: 1 kB\n'), null);
    assert.equal(parseMemAvailable(''), null);
    assert.equal(parseMemAvailable(null), null);
    // Anchored to a line start: a differently named field does not satisfy it.
    assert.equal(parseMemAvailable('XMemAvailable: 5 kB\n'), null);
});
test('a first read takes its own short sample and reports the full snapshot shape', async () => {
    const fake = fakeDeps();
    fake.sampleWork(30, 70);
    const health = await createHostHealth(fake.deps).read();
    assert.deepEqual(fake.calls.sleep, [250]);
    assert.equal(health.cpu.utilization, 0.3);
    assert.equal(health.cpu.windowMs, 250);
    assert.equal(health.cpu.cores, 2);
    assert.equal(health.cpu.model, 'Fixture CPU');
    assert.deepEqual(health.cpu.load, [1.5, 1, 0.5]);
    assert.equal(health.uptimeSec, 3600);
    assert.equal(health.platform, 'linux');
    assert.equal(health.arch, 'x64');
    assert.equal(health.sampledAt, new Date(fake.clock.now).toISOString());
    // MemAvailable wins over freemem, which counts page cache as used.
    assert.deepEqual(health.memory, { totalBytes: 16 * GB, availableBytes: 8192000 * 1024 });
    assert.deepEqual(health.disk, { path: '~', totalBytes: 4096 * 1000, availableBytes: 4096 * 250 });
    assert.deepEqual(fake.calls.statfs, ['/home/fixture']);
});
test('a later read reports the busy share since the previous snapshot without sampling', async () => {
    const fake = fakeDeps();
    const health = createHostHealth(fake.deps);
    await health.read();
    fake.clock.now += 10_000;
    fake.work(80, 20);
    const second = await health.read();
    assert.deepEqual(fake.calls.sleep, [250], 'no second sample');
    assert.equal(second.cpu.utilization, 0.8);
    assert.equal(second.cpu.windowMs, 10_000);
    fake.clock.now += 3_000;
    fake.work(0, 100);
    const third = await health.read();
    assert.equal(third.cpu.utilization, 0, 'the window restarts at each snapshot');
    assert.equal(third.cpu.windowMs, 3_000);
});
test('a window older than five minutes, or no elapsed CPU time, resamples or reports null', async () => {
    const fake = fakeDeps();
    const health = createHostHealth(fake.deps);
    await health.read();
    fake.clock.now += 5 * 60_000 + 1;
    fake.work(1000, 0); // stale busy time outside a meaningful window
    fake.sampleWork(10, 90);
    const stale = await health.read();
    assert.deepEqual(fake.calls.sleep, [250, 250], 'a long quiet period takes a fresh sample');
    assert.equal(stale.cpu.utilization, 0.1);
    assert.equal(stale.cpu.windowMs, 250);
    const idle = fakeDeps();
    idle.sampleWork(0, 0);
    const none = await createHostHealth(idle.deps).read();
    assert.equal(none.cpu.utilization, null, 'no counted CPU time means unknown, not idle');
});
test('concurrent and closely spaced reads share one snapshot for two seconds', async () => {
    const fake = fakeDeps();
    const health = createHostHealth(fake.deps);
    const [a, b] = await Promise.all([health.read(), health.read()]);
    assert.equal(a, b);
    assert.deepEqual(fake.calls.sleep, [250], 'concurrent callers do not each sample');
    fake.clock.now += 1000; // still inside the sharing window measured from the first call
    assert.equal(await health.read(), a);
    fake.clock.now += 1000;
    const fresh = await health.read();
    assert.notEqual(fresh, a, 'the snapshot expires after two seconds');
});
test('a failed snapshot is not shared with later callers', async () => {
    let fail = true;
    const fake = fakeDeps({ loadavg: () => { if (fail)
            throw new Error('loadavg failed'); return [0, 0, 0]; } });
    const health = createHostHealth(fake.deps);
    await assert.rejects(health.read(), /loadavg failed/);
    fail = false;
    const recovered = await health.read();
    assert.deepEqual(recovered.cpu.load, [0, 0, 0]);
});
test('non-Linux hosts use freemem; Windows reports no load average', async () => {
    const mac = await createHostHealth(fakeDeps({ platform: 'darwin' }).deps).read();
    assert.deepEqual(mac.memory, { totalBytes: 16 * GB, availableBytes: 1 * GB }, 'meminfo is Linux-only');
    assert.deepEqual(mac.cpu.load, [1.5, 1, 0.5]);
    const win = await createHostHealth(fakeDeps({ platform: 'win32', loadavg: () => [0, 0, 0] }).deps).read();
    assert.equal(win.cpu.load, null, 'Windows reports [0,0,0]: absent, not idle');
    const noMeminfo = await createHostHealth(fakeDeps({ readMeminfo: () => null }).deps).read();
    assert.equal(noMeminfo.memory.availableBytes, 1 * GB, 'Linux without MemAvailable falls back to freemem');
    const malformedLoad = await createHostHealth(fakeDeps({ loadavg: () => [1, NaN, 2] }).deps).read();
    assert.equal(malformedLoad.cpu.load, null);
    const clamped = await createHostHealth(fakeDeps({ readMeminfo: () => 'MemAvailable: 99999999999 kB\n' }).deps).read();
    assert.equal(clamped.memory.availableBytes, 16 * GB, 'available never exceeds total');
});
test('an unreadable or empty home filesystem reports disk as null', async () => {
    const failed = await createHostHealth(fakeDeps({ statfs: () => null }).deps).read();
    assert.equal(failed.disk, null);
    const empty = await createHostHealth(fakeDeps({ statfs: () => ({ bsize: 4096, blocks: 0, bavail: 0 }) }).deps).read();
    assert.equal(empty.disk, null);
    const noCpus = await createHostHealth(fakeDeps({ cpus: () => [] }).deps).read();
    assert.equal(noCpus.cpu.cores, 0);
    assert.equal(noCpus.cpu.model, null);
    assert.equal(noCpus.cpu.utilization, null);
});
test('default dependencies read this machine without throwing', async () => {
    const health = await createHostHealth(defaultHostHealthDeps).read();
    assert.ok(health.cpu.cores > 0);
    assert.ok(health.memory.totalBytes > 0);
    assert.ok(health.memory.availableBytes >= 0 && health.memory.availableBytes <= health.memory.totalBytes);
    assert.equal(health.platform, process.platform);
    assert.ok(health.disk === null || health.disk.totalBytes > 0);
});
