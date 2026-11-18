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
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createHostHealth, parseMemAvailable, parseProcMounts, parseMacOsDf, parseNvidiaSmi, parseMacOsGpus, readLinuxDrmGpus, defaultHostHealthDeps, } = require('../lib/host-health.js');
const GB = 1024 ** 3;
const MIB = 1024 ** 2;
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
    assert.deepEqual(health.disks, [{ path: '~', fsType: null, totalBytes: 4096 * 1000, availableBytes: 4096 * 250 }]);
    assert.deepEqual(health.gpus, []);
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
    assert.deepEqual(failed.disks, []);
    const empty = await createHostHealth(fakeDeps({ statfs: () => ({ bsize: 4096, blocks: 0, bavail: 0 }) }).deps).read();
    assert.equal(empty.disk, null);
    assert.deepEqual(empty.disks, []);
    const noCpus = await createHostHealth(fakeDeps({ cpus: () => [] }).deps).read();
    assert.equal(noCpus.cpu.cores, 0);
    assert.equal(noCpus.cpu.model, null);
    assert.equal(noCpus.cpu.utilization, null);
});
test('parseProcMounts filters virtual/snap mounts, unescapes spaces and deduplicates devices', () => {
    const mounts = [
        'tmpfs /run tmpfs rw 0 0',
        'rootfs / rootfs rw 0 0',
        '/dev/nvme0n1p2 / btrfs rw,subvol=/@ 0 0',
        '/dev/nvme0n1p2 /home btrfs rw,subvol=/@home 0 0',
        '/dev/nvme0n1p2 /var/log btrfs rw,subvol=/@log 0 0',
        '/dev/nvme0n1p1 /boot/efi vfat rw 0 0',
        '/dev/sdb1 /mnt/Big\\040Data xfs rw 0 0',
        '/dev/sdc1 /run/media/user/usb exfat rw 0 0',
        '/dev/loop0 /snap/core24/1643 squashfs ro 0 0',
        '/dev/nvme0n1p2 /var/lib/docker/overlay2/abc ext4 rw 0 0',
        'overlay /var/lib/docker/overlay2/abc/merged overlay rw 0 0',
        'tank/models /tank/models zfs rw 0 0',
        'proc /proc proc rw 0 0',
        'efivarfs /sys/firmware/efi/efivars efivarfs rw 0 0',
    ].join('\n');
    assert.deepEqual(parseProcMounts(mounts), [
        { source: '/dev/nvme0n1p2', mount: '/', fsType: 'btrfs' },
        { source: '/dev/nvme0n1p1', mount: '/boot/efi', fsType: 'vfat' },
        { source: '/dev/sdb1', mount: '/mnt/Big Data', fsType: 'xfs' },
        { source: '/dev/sdc1', mount: '/run/media/user/usb', fsType: 'exfat' },
        { source: 'tank/models', mount: '/tank/models', fsType: 'zfs' },
    ]);
    // Container root overlay is kept while nested overlays are ignored.
    assert.deepEqual(parseProcMounts('overlay / overlay rw 0 0\noverlay /sub overlay rw 0 0\n'), [
        { source: 'overlay', mount: '/', fsType: 'overlay' },
    ]);
    assert.deepEqual(parseProcMounts(null), []);
});
test('parseMacOsDf keeps local disk partitions and skips internal APFS system volumes', () => {
    const df = [
        'Filesystem     1024-blocks      Used Available Capacity  Mounted on',
        '/dev/disk3s1s1   971350180  10500000 450000000     3%    /',
        'devfs                  200       200         0   100%    /dev',
        '/dev/disk3s6     971350180   2097152 450000000     1%    /System/Volumes/VM',
        '/dev/disk3s5     971350180 500000000 450000000    53%    /System/Volumes/Data',
        '/dev/disk4s1    1953525164 400000000 1553525164   21%    /Volumes/Scratch Disk',
        'map auto_home            0         0         0   100%    /System/Volumes/Data/home',
    ].join('\n');
    assert.deepEqual(parseMacOsDf(df), [
        { source: '/dev/disk3s1s1', mount: '/', fsType: null },
        { source: '/dev/disk4s1', mount: '/Volumes/Scratch Disk', fsType: null },
    ]);
    assert.deepEqual(parseMacOsDf(null), []);
});
test('parseNvidiaSmi reads single/multi GPUs, unified memory N/A and clamps ranges', () => {
    const smi = [
        '0, NVIDIA GeForce RTX 4090, 35, 12288, 24564, 52',
        '1, NVIDIA GB10, 120, [N/A], [Not Supported], 48',
        '2, Broken Card, [N/A], [N/A], [N/A], [N/A]',
        '3, Card, Rev 2, 10, 1024, 4096, 61.6',
    ].join('\n');
    assert.deepEqual(parseNvidiaSmi(smi), [
        {
            name: 'NVIDIA GeForce RTX 4090',
            utilization: 0.35,
            memory: { totalBytes: 24564 * MIB, availableBytes: (24564 - 12288) * MIB },
            temperatureC: 52,
        },
        { name: 'NVIDIA GB10', utilization: 1, memory: null, temperatureC: 48 },
        {
            name: 'Card, Rev 2',
            utilization: 0.1,
            memory: { totalBytes: 4096 * MIB, availableBytes: 3072 * MIB },
            temperatureC: 62,
        },
    ]);
    assert.deepEqual(parseNvidiaSmi(null), []);
});
test('parseMacOsGpus reads Apple Silicon and discrete macOS IOAccelerator entries', () => {
    const ioreg = [
        '+-o AGXAccelerator  <class AGXAcceleratorG14X, id 0x100000412>',
        '    {',
        '      "model" = "Apple M2 Max"',
        '      "PerformanceStatistics" = {"Device Utilization %"=28,"In use system memory"=1073741824}',
        '    }',
        '+-o AMDRadeonX6000  <class AMDRadeonX6000, id 0x100000499>',
        '    {',
        '      "model" = "AMD Radeon Pro 5500M"',
        '      "VRAM,totalMB" = 8192',
        '      "PerformanceStatistics" = {"Device Utilization %"=64,"vramUsedBytes"=2147483648}',
        '    }',
    ].join('\n');
    assert.deepEqual(parseMacOsGpus(ioreg), [
        { name: 'Apple M2 Max', utilization: 0.28, memory: null, temperatureC: null },
        {
            name: 'AMD Radeon Pro 5500M',
            utilization: 0.64,
            memory: { totalBytes: 8192 * MIB, availableBytes: 8192 * MIB - 2 * GB },
            temperatureC: null,
        },
    ]);
    assert.deepEqual(parseMacOsGpus(null), []);
});
test('readLinuxDrmGpus reads AMD sysfs metrics, skips NVIDIA and skips headless BMC VGA', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-drm-'));
    try {
        const write = (rel, value) => {
            const full = path.join(tmp, rel);
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, value);
        };
        // card0: NVIDIA (skipped to avoid duplicating nvidia-smi)
        write('card0/device/uevent', 'DRIVER=nvidia\n');
        write('card0/device/gpu_busy_percent', '50\n');
        // card1: AMD GPU with busy%, VRAM, hwmon temperature
        write('card1/device/uevent', 'DRIVER=amdgpu\n');
        write('card1/device/vendor', '0x1002\n');
        write('card1/device/gpu_busy_percent', '42\n');
        write('card1/device/mem_info_vram_total', String(8 * GB));
        write('card1/device/mem_info_vram_used', String(2 * GB));
        write('card1/device/hwmon/hwmon3/temp1_input', '63400\n');
        // card2: BMC VGA without busy% or VRAM (skipped)
        write('card2/device/uevent', 'DRIVER=ast\n');
        // card10: AMD discrete GPU with explicit product_name (numeric sort after card1)
        write('card10/device/uevent', 'DRIVER=amdgpu\n');
        write('card10/device/product_name', 'AMD Radeon RX 7900 XTX\n');
        write('card10/device/gpu_busy_percent', '85\n');
        // connector symlink/entry (ignored)
        fs.mkdirSync(path.join(tmp, 'card1-DP-1'), { recursive: true });
        fs.mkdirSync(path.join(tmp, 'renderD128'), { recursive: true });
        assert.deepEqual(readLinuxDrmGpus(tmp), [
            {
                name: 'AMD GPU',
                utilization: 0.42,
                memory: { totalBytes: 8 * GB, availableBytes: 6 * GB },
                temperatureC: 63,
            },
            { name: 'AMD Radeon RX 7900 XTX', utilization: 0.85, memory: null, temperatureC: null },
        ]);
    }
    finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }
});
test('Linux host health enumerates all partitions (redacting homedir) and combines NVIDIA + DRM GPUs', async () => {
    const sizes = {
        '/home/fixture': { bsize: 4096, blocks: 1000, bavail: 400 },
        '/': { bsize: 4096, blocks: 2000, bavail: 1000 },
        '/boot/efi': { bsize: 4096, blocks: 100, bavail: 90 },
        '/home/fixture/models': { bsize: 4096, blocks: 5000, bavail: 500 },
        '/mnt/data': { bsize: 4096, blocks: 4000, bavail: 2000 },
    };
    const fake = fakeDeps({
        readMounts: () => [
            '/dev/sda2 / ext4 rw 0 0',
            '/dev/sda1 /boot/efi vfat rw 0 0',
            '/dev/sdb1 /mnt/data xfs rw 0 0',
            '/dev/sdc1 /home/fixture/models ext4 rw 0 0',
            '/dev/sdd1 /unreadable ext4 rw 0 0',
        ].join('\n'),
        statfs: target => sizes[target] ?? null,
        execCommand: async (file) => file === 'nvidia-smi'
            ? '0, NVIDIA RTX 5090, 75, 16384, 32768, 67\n'
            : null,
        readDrmGpus: () => [{ name: 'AMD GPU', utilization: 0.05, memory: null, temperatureC: 45 }],
    });
    const health = await createHostHealth(fake.deps).read();
    assert.deepEqual(health.disks, [
        { path: '/', fsType: 'ext4', totalBytes: 4096 * 2000, availableBytes: 4096 * 1000 },
        { path: '/boot/efi', fsType: 'vfat', totalBytes: 4096 * 100, availableBytes: 4096 * 90 },
        { path: '/mnt/data', fsType: 'xfs', totalBytes: 4096 * 4000, availableBytes: 4096 * 2000 },
        { path: '~/models', fsType: 'ext4', totalBytes: 4096 * 5000, availableBytes: 4096 * 500 },
    ]);
    assert.deepEqual(health.gpus, [
        {
            name: 'NVIDIA RTX 5090',
            utilization: 0.75,
            memory: { totalBytes: 32768 * MIB, availableBytes: 16384 * MIB },
            temperatureC: 67,
        },
        { name: 'AMD GPU', utilization: 0.05, memory: null, temperatureC: 45 },
    ]);
});
test('macOS host health reads partitions from df and GPUs from ioreg', async () => {
    const fake = fakeDeps({
        platform: 'darwin',
        statfs: target => target === '/Volumes/Work'
            ? { bsize: 4096, blocks: 500, bavail: 100 }
            : { bsize: 4096, blocks: 1000, bavail: 500 },
        execCommand: async (file) => {
            if (file === 'df') {
                return [
                    'Filesystem 1024-blocks Used Available Capacity Mounted on',
                    '/dev/disk3s1s1 1000 500 500 50% /',
                    '/dev/disk4s1 500 400 100 80% /Volumes/Work',
                ].join('\n');
            }
            if (file === 'ioreg') {
                return '+-o AGXAccelerator <class AGX>\n"model" = "Apple M3 Pro"\n"PerformanceStatistics" = {"Device Utilization %"=19}\n';
            }
            return null;
        },
    });
    const health = await createHostHealth(fake.deps).read();
    assert.deepEqual(health.disks, [
        { path: '/', fsType: null, totalBytes: 4096 * 1000, availableBytes: 4096 * 500 },
        { path: '/Volumes/Work', fsType: null, totalBytes: 4096 * 500, availableBytes: 4096 * 100 },
    ]);
    assert.deepEqual(health.gpus, [
        { name: 'Apple M3 Pro', utilization: 0.19, memory: null, temperatureC: null },
    ]);
});
test('default dependencies read this machine without throwing', async () => {
    const health = await createHostHealth(defaultHostHealthDeps).read();
    assert.ok(health.cpu.cores > 0);
    assert.ok(health.memory.totalBytes > 0);
    assert.ok(health.memory.availableBytes >= 0 && health.memory.availableBytes <= health.memory.totalBytes);
    assert.equal(health.platform, process.platform);
    assert.ok(health.disk === null || health.disk.totalBytes > 0);
    assert.ok(Array.isArray(health.disks));
    for (const d of health.disks) {
        assert.ok(typeof d.path === 'string' && d.path.length > 0);
        assert.ok(d.totalBytes > 0 && d.availableBytes >= 0 && d.availableBytes <= d.totalBytes);
    }
    assert.ok(Array.isArray(health.gpus));
    for (const g of health.gpus) {
        assert.ok(g.utilization === null || (g.utilization >= 0 && g.utilization <= 1));
        assert.ok(g.memory === null || (g.memory.totalBytes > 0 && g.memory.availableBytes >= 0));
    }
});
