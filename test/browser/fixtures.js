const { test: base, expect } = require('@playwright/test');
const { fork } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { sanitizeTestEnv } = require('../test-env');

const ROOT = '2026-09-09T00-00-00-shared-root';
const CHILD = '2026-09-09T00-01-00-shared-child';

async function startHost(label, logs, hosts, origin, liveSessions) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-browser-'));
  const host = { home, label, token: `browser-fixture-${label}` };
  hosts.push(host); // Register before setup so partial failures also clean up.
  const dish = path.join(home, '.pi/dish');
  fs.mkdirSync(dish, { recursive: true });
  if (origin) {
    fs.writeFileSync(path.join(dish, 'token'), host.token);
    fs.writeFileSync(path.join(dish, 'settings.json'), JSON.stringify({ allowedOrigins: [origin] }));
  }
  const dir = path.join(home, '.pi/agent/sessions/project');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(home, 'tmux'));
  for (const id of [ROOT, CHILD]) {
    const header = { type: 'session', cwd: '/fixture/project', timestamp: '2026-09-09T00:00:00.000Z' };
    if (id === CHILD) header.parentSession = path.join(dir, `${ROOT}.jsonl`);
    fs.writeFileSync(path.join(dir, `${id}.jsonl`), [
      header,
      { type: 'message', message: { role: 'user', content: `${label} ${id === ROOT ? 'root' : 'child'} transcript` } },
    ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
  }
  host.child = fork(path.join(__dirname, '../fixtures/browser-server.js'), [], {
    env: { ...sanitizeTestEnv(), HOME: home, TMUX_TMPDIR: path.join(home, 'tmux'),
      PI_DISH_INDEX_SYNC_BUDGET: '1000',
      ...(liveSessions ? { PI_DISH_TEST_LIVE_SESSION: ROOT } : {}),
      PI_DISH_OMP_COMMAND: `${process.execPath} ${path.join(__dirname, '../fixtures/fake-omp-export.js')}` },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  for (const stream of [host.child.stdout, host.child.stderr]) {
    stream.on('data', data => logs.push(`${label}: ${data}`));
  }
  host.commands = [];
  host.child.on('message', event => { if (event.type === 'command') host.commands.push(event.message); });
  host.emit = (event, data, entry) => host.child.send({ event, data, entry });
  host.base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} startup timed out`)), 15000);
    const failed = err => { clearTimeout(timer); reject(err); };
    host.child.once('error', failed);
    host.child.once('exit', code => failed(new Error(`${label} exited (${code})`)));
    host.child.once('message', message => { clearTimeout(timer); resolve(message.base); });
  });
  const response = await fetch(`${host.base}/api/host`);
  if (!response.ok) throw new Error(`${label} descriptor: ${response.status}`);
  host.hostId = (await response.json()).hostId;
  return host;
}

async function stopHost(host) {
  if (host.child && host.child.exitCode === null && host.child.signalCode === null) {
    await new Promise(resolve => {
      const timer = setTimeout(() => host.child.kill('SIGKILL'), 3000);
      host.child.once('exit', () => { clearTimeout(timer); resolve(); });
      host.child.kill('SIGTERM');
    });
  }
  fs.rmSync(host.home, { recursive: true, force: true });
}

const test = base.extend({
  liveSessions: [false, { option: true }],
  fleet: async ({ page, liveSessions }, use, testInfo) => {
    const hosts = [], logs = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      const self = await startHost('self', logs, hosts, null, liveSessions);
      const peer = await startHost('peer', logs, hosts, self.base, liveSessions);
      await page.addInitScript(entry => {
        // Tests that need registry/list facts replace the list snapshot through
        // its actual writer; mutation/transcript patches deliberately cannot.
        window.fixtureSessionListPatch = (id, fields, host = sessionState.sessionHostId(id)) => {
          const parts = new Map();
          for (const kind of ['active', 'previous']) {
            for (const row of sessionState.sessions[kind]) {
              const key = row.host || null;
              if (!parts.has(key)) parts.set(key, { hostId: key, active: [], previous: [] });
              parts.get(key)[kind].push(row.id === id && key === (host || null) ? { ...row, ...fields } : row);
            }
          }
          sessionState.setSessionLists([...parts.values()]);
        };
        localStorage.setItem('pi-dish-hosts', JSON.stringify([entry]));
      }, { base: peer.base, hostId: peer.hostId, label: peer.label, token: peer.token });
      await page.goto(self.base);
      await page.locator('#tabAll').click();
      await expect(page.locator(`.session-item[data-id="${ROOT}"]`)).toHaveCount(2);
      const select = (host, id = ROOT) => page.evaluate(({ id, host }) => selectSession(id, { host }), { id, host: host.hostId });
      const row = (host, id = ROOT) => page.locator(`.session-item[data-id="${id}"][data-host="${host.hostId}"]`);
      await use({ self, peer, select, row });
      expect(errors, 'uncaught browser errors').toEqual([]);
    } finally {
      await Promise.all(hosts.map(stopHost));
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('server-output', { body: logs.join(''), contentType: 'text/plain' });
      }
    }
  },
});

module.exports = { test, expect, ROOT, CHILD };
