// Generated test/tool from test/browser-fleet-view.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const browser_vm_js_1 = require("./browser-vm.js");
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require('node:vm');
const context = { URL };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../public/browser.js'), 'utf8'), context);
(0, browser_vm_js_1.assertBrowserApiContext)(context);
const { decodeFleetHealth, formatBytes, formatUptime, meterLevel, fleetSessionsHtml, fleetHealthHtml } = context.PiDishBrowser;
const plain = (value) => JSON.parse(JSON.stringify(value));
const GB = 1024 ** 3;
test('host health wire data narrows numbers and degrades malformed parts to absent', () => {
    const wire = {
        sampledAt: 'x', uptimeSec: 7200, platform: 'linux', arch: 'x64',
        cpu: { cores: 7.6, model: 'm', utilization: 1.4, windowMs: 10, load: [1, 2, 3] },
        memory: { totalBytes: 16 * GB, availableBytes: 20 * GB },
        disk: { path: '~', totalBytes: 100 * GB, availableBytes: -5 },
        sessions: { live: 3, working: -1, waiting: '2', subagents: 1.6, byHarness: { pi: 3 } },
    };
    assert.deepEqual(plain(decodeFleetHealth(wire)), {
        uptimeSec: 7200, platform: 'linux', arch: 'x64',
        cpu: { cores: 8, utilization: 1, load: [1, 2, 3] },
        memory: { totalBytes: 16 * GB, availableBytes: 16 * GB },
        disk: { totalBytes: 100 * GB, availableBytes: 0 },
        sessions: { live: 3, working: 0, waiting: 0, subagents: 2 },
    });
    const sparse = decodeFleetHealth({ cpu: { utilization: 'high', load: [1, 2] }, memory: { totalBytes: 0, availableBytes: 0 }, disk: null, sessions: [] });
    assert.deepEqual(plain(sparse), {
        uptimeSec: null, platform: '', arch: '', cpu: { cores: 0, utilization: null, load: null },
        memory: null, disk: null, sessions: null,
    });
    assert.equal(decodeFleetHealth({ cpu: { load: [1, Infinity, 3] } }).cpu.load, null);
    assert.equal(decodeFleetHealth({ cpu: { utilization: -0.5 } }).cpu.utilization, 0);
    assert.throws(() => decodeFleetHealth(null), /Invalid host health/);
    assert.throws(() => decodeFleetHealth('health'), /Invalid host health/);
});
test('byte, uptime and meter-level formatting', () => {
    assert.equal(formatBytes(0), '0 B');
    assert.equal(formatBytes(1023), '1023 B');
    assert.equal(formatBytes(1024), '1 KB');
    assert.equal(formatBytes(1536), '1.5 KB');
    assert.equal(formatBytes(16 * GB), '16 GB');
    assert.equal(formatBytes(150 * GB), '150 GB');
    assert.equal(formatBytes(2.25 * 1024 * GB), '2.3 TB');
    assert.equal(formatUptime(59), '0m');
    assert.equal(formatUptime(3 * 60), '3m');
    assert.equal(formatUptime(2 * 3600 + 5 * 60), '2h 5m');
    assert.equal(formatUptime(3 * 86400 + 4 * 3600 + 59 * 60), '3d 4h');
    assert.equal(meterLevel(0), 'ok');
    assert.equal(meterLevel(0.7499), 'ok');
    assert.equal(meterLevel(0.75), 'warn');
    assert.equal(meterLevel(0.8999), 'warn');
    assert.equal(meterLevel(0.9), 'crit');
    assert.equal(meterLevel(1), 'crit');
});
test('session summaries prefer the host report and fall back to the client list', () => {
    assert.equal(fleetSessionsHtml({ live: 4, working: 2, waiting: 1, subagents: 1 }, { live: 9, working: 9 }), '<div class="fleet-sessions"><strong>4</strong> live · <span class="fleet-working">2 working</span> · 1 waiting on you · 1 subagent</div>');
    assert.equal(fleetSessionsHtml({ live: 0, working: 0, waiting: 0, subagents: 3 }, null), '<div class="fleet-sessions"><strong>0</strong> live · 3 subagents</div>');
    assert.equal(fleetSessionsHtml(null, { live: 2, working: 1 }), '<div class="fleet-sessions"><strong>2</strong> live · <span class="fleet-working">1 working</span></div>');
    assert.equal(fleetSessionsHtml(null, null), '<div class="fleet-sessions muted">Sessions unknown</div>');
});
test('health meters carry levels and mark absent readings unavailable', () => {
    const html = fleetHealthHtml(decodeFleetHealth({
        platform: 'linux', arch: 'x64',
        cpu: { cores: 4, utilization: 0.8, load: [2, 1, 0.5] },
        memory: { totalBytes: 10 * GB, availableBytes: 0.5 * GB },
        disk: null,
    }));
    assert.match(html, /class="fleet-meter" data-level="warn" role="meter" aria-label="CPU"[^>]*aria-valuenow="80"/);
    assert.match(html, /80% · load 2\.00 · 4 cores/);
    assert.match(html, /Load average 2\.00 \/ 1\.00 \/ 0\.50/);
    assert.match(html, /data-level="crit" role="meter" aria-label="Memory"[^>]*aria-valuenow="95"/);
    assert.match(html, /9\.5 GB \/ 10 GB/);
    assert.match(html, /<div class="fleet-meter unknown"><span class="fleet-meter-label">Disk ~<\/span>.*unavailable/);
    const idle = fleetHealthHtml(decodeFleetHealth({ cpu: {}, memory: { totalBytes: GB, availableBytes: GB } }));
    assert.match(idle, /fleet-meter unknown"><span class="fleet-meter-label">CPU/);
    assert.match(idle, /data-level="ok" role="meter" aria-label="Memory"[^>]*aria-valuenow="0"/);
});
