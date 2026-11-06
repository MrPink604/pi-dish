import { test as base, expect, type Locator, type Route, type TestInfo } from '@playwright/test';
import type { ChildProcess } from 'node:child_process';
import { fork } from 'node:child_process';
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import { sanitizeTestEnv } from '../test-env.js';
import { isRecord } from '../../lib/wire-protocol.js';
import type { SessionEntry } from '../../src/browser/session-state.js';
import { installFixtureApp } from '../fixtures/browser-app.js';

const ROOT = '2026-09-09T00-00-00-shared-root';
const CHILD = '2026-09-09T00-01-00-shared-child';

export interface BrowserHost {
  home: string;
  label: string;
  token: string;
  child: ChildProcess;
  commands: Record<string, unknown>[];
  emit(event: string, data: unknown, entry?: unknown): boolean;
  base: string;
  hostId: string;
}
export interface FleetFixture {
  self: BrowserHost;
  peer: BrowserHost;
  select(host: BrowserHost, id?: string): Promise<unknown>;
  row(host: BrowserHost, id?: string): Locator;
}
interface BrowserFixtures {
  liveSessions: boolean;
  instrumentApp: boolean;
  fleet: FleetFixture;
}

interface StoppingHost { home: string; child?: ChildProcess }

function requiredRoute(route: Route | null | undefined): Route {
  if (!route) throw new Error('Expected a held Playwright route');
  return route;
}

// Holds the next matching request so the test can change selection first.
function heldRoute(): { readonly received: Promise<Route>; hold(route: Route): void } {
  let settle!: (route: Route) => void;
  const received = new Promise<Route>(resolve => { settle = resolve; });
  return { received, hold: route => settle(route) };
}


async function startHost(label: string, logs: string[], started: StoppingHost[], origin: string | null, liveSessions: boolean): Promise<BrowserHost> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-browser-'));
  const token = `browser-fixture-${label}`;
  const stopping: StoppingHost = { home };
  started.push(stopping); // Register before setup so partial failures also clean up.
  const dish = path.join(home, '.pi/dish');
  fs.mkdirSync(dish, { recursive: true });
  if (origin) {
    fs.writeFileSync(path.join(dish, 'token'), token);
    fs.writeFileSync(path.join(dish, 'settings.json'), JSON.stringify({ allowedOrigins: [origin] }));
  }
  const dir = path.join(home, '.pi/agent/sessions/project');
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(home, 'tmux'));
  for (const id of [ROOT, CHILD]) {
    const header: Record<string, unknown> = { type: 'session', cwd: '/fixture/project', timestamp: '2026-09-09T00:00:00.000Z' };
    if (id === CHILD) header.parentSession = path.join(dir, `${ROOT}.jsonl`);
    fs.writeFileSync(path.join(dir, `${id}.jsonl`), [
      header,
      { type: 'message', message: { role: 'user', content: `${label} ${id === ROOT ? 'root' : 'child'} transcript` } },
    ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
  }
  const child = fork(path.join(__dirname, '../fixtures/browser-server.js'), [], {
    env: { ...sanitizeTestEnv(), HOME: home, TMUX_TMPDIR: path.join(home, 'tmux'),
      PI_DISH_INDEX_SYNC_BUDGET: '1000',
      ...(liveSessions ? { PI_DISH_TEST_LIVE_SESSION: ROOT } : {}),
      PI_DISH_OMP_COMMAND: `${process.execPath} ${path.join(__dirname, '../fixtures/fake-omp-export.js')}` },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  stopping.child = child;
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', (data: Buffer) => logs.push(`${label}: ${data}`));
  }
  const commands: Record<string, unknown>[] = [];
  child.on('message', (event: unknown) => {
    if (!isRecord(event)) throw new Error('Browser host sent an invalid event');
    if (event.type === 'command') {
      if (!isRecord(event.message)) throw new Error('Browser host sent an invalid command');
      commands.push(event.message);
    }
  });
  const emit = (event: string, data: unknown, entry?: unknown): boolean => child.send({ event, data, entry });
  const base = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} startup timed out`)), 15000);
    const failed = (err: Error) => { clearTimeout(timer); reject(err); };
    child.once('error', failed);
    child.once('exit', (code) => failed(new Error(`${label} exited (${code})`)));
    child.once('message', (message: unknown) => { if (!isRecord(message) || typeof message.base !== 'string') return failed(new Error(`${label} returned an invalid base URL`)); clearTimeout(timer); resolve(message.base); });
  });
  const response = await fetch(`${base}/api/host`);
  if (!response.ok) throw new Error(`${label} descriptor: ${response.status}`);
  const descriptor: unknown = await response.json();
  if (!isRecord(descriptor)) throw new Error(`${label} descriptor is invalid`);
  if (typeof descriptor.hostId !== 'string') throw new Error(`${label} descriptor lacks hostId`);
  return { home, label, token, child, commands, emit, base, hostId: descriptor.hostId };
}

async function stopHost(host: StoppingHost): Promise<void> {
  const child = host.child;
  if (child && child.exitCode === null && child.signalCode === null) {
    await new Promise<void>(resolve => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
      child.once('exit', () => { clearTimeout(timer); resolve(); });
      child.kill('SIGTERM');
    });
  }
  fs.rmSync(host.home, { recursive: true, force: true });
}

const test = base.extend<BrowserFixtures>({
  liveSessions: [false, { option: true }],
  instrumentApp: [true, { option: true }],
  fleet: async ({ page, liveSessions, instrumentApp }, use, testInfo: TestInfo) => {
    const hosts: StoppingHost[] = [], logs: string[] = [], errors: string[] = [];
    page.on('pageerror', (error: Error) => errors.push(error.message));
    try {
      if (instrumentApp) await installFixtureApp(page);
      const self = await startHost('self', logs, hosts, null, liveSessions);
      const peer = await startHost('peer', logs, hosts, self.base, liveSessions);
      await page.addInitScript(({ entry, instrumentApp }) => {
        // Tests that need registry/list facts replace the list snapshot through
        // its actual writer; mutation/transcript patches deliberately cannot.
        if (instrumentApp) window.fixtureSessionListPatch = (id: string, fields: Record<string, unknown>, host = fixtureApp.features.sessionState.sessionHostId(id)) => {
          const parts = new Map<string | null, { hostId: string | null; active: SessionEntry[]; previous: SessionEntry[] }>();
          for (const kind of ['active', 'previous'] as const) {
            for (const row of fixtureApp.features.sessionState.sessions[kind]) {
              const key = row.host || null;
              if (!parts.has(key)) parts.set(key, { hostId: key, active: [], previous: [] });
              const part = fixtureElement(parts.get(key), 'browser host session partition');
              part[kind].push(row.id === id && key === (host || null) ? { ...row, ...fields } : row);
            }
          }
          fixtureApp.features.sessionState.setSessionLists([...parts.values()]);
        };
        localStorage.setItem('pi-dish-hosts', JSON.stringify([entry]));
      }, { entry: { base: peer.base, hostId: peer.hostId, label: peer.label, token: peer.token }, instrumentApp });
      await page.goto(self.base);
      await page.locator('#tabAll').click();
      await expect(page.locator(`.session-item[data-id="${ROOT}"]`)).toHaveCount(2);
      const row = (host: BrowserHost, id = ROOT): Locator => page.locator(`.session-item[data-id="${id}"][data-host="${host.hostId}"]`);
      const select = async (host: BrowserHost, id = ROOT): Promise<unknown> => {
        if (instrumentApp) return page.evaluate(({ id, host }) => fixtureApp.features.sessionView.select(id, { host }), { id, host: host.hostId });
        await row(host, id).click();
        await expect(row(host, id)).toHaveClass(/\bactive\b/);
      };
      await use({ self, peer, select, row });
    } finally {
      await Promise.all(hosts.map(stopHost));
      if (testInfo.status !== testInfo.expectedStatus) {
        await testInfo.attach('server-output', { body: logs.join(''), contentType: 'text/plain' });
      }
    }
  },
});

export { test, expect, ROOT, CHILD, requiredRoute, heldRoute };

