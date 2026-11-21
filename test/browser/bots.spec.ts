import { test, expect } from '@playwright/test';
import { fork, type ChildProcess } from 'node:child_process';
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import { sanitizeTestEnv } from '../test-env.js';
import { record as isRecord } from '../../lib/helper-values.js';

interface BotApiRow {
  id: string;
  sessionId: string;
  name: string;
  parentId: string | null;
  status: string;
}

interface TestHost {
  home: string;
  label: string;
  base: string;
  localhostBase: string;
  hostId: string;
  child: ChildProcess;
}

interface HostOptions {
  label: string;
  settings?: Record<string, unknown>;
  token?: string;
  liveSessionId?: string;
  sessions?: readonly { id: string; cwd: string; text: string }[];
  provenance?: Record<string, { sourceSessionId: string; operationId: null; createdAt: number }>;
}

async function startHost(options: HostOptions, started: { home: string; child?: ChildProcess }[], logs: string[]): Promise<TestHost> {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `pi-dish-bots-${options.label}-`));
  const recordEntry: { home: string; child?: ChildProcess } = { home };
  started.push(recordEntry);
  const dish = path.join(home, '.pi/dish');
  fs.mkdirSync(dish, { recursive: true });
  fs.mkdirSync(path.join(home, 'tmux'), { recursive: true });
  if (options.token) fs.writeFileSync(path.join(dish, 'token'), options.token);
  fs.writeFileSync(path.join(dish, 'settings.json'), JSON.stringify({ hostLabel: options.label, ...options.settings }));
  if (options.provenance) {
    fs.writeFileSync(path.join(dish, 'session-provenance.json'), JSON.stringify({ version: 1, launches: options.provenance }));
  }
  const sessionDir = path.join(home, '.pi/agent/sessions/project');
  fs.mkdirSync(sessionDir, { recursive: true });
  for (const session of options.sessions ?? []) {
    fs.writeFileSync(path.join(sessionDir, `${session.id}.jsonl`), [
      { type: 'session', cwd: session.cwd, timestamp: '2026-11-21T00:00:00.000Z' },
      { type: 'message', message: { role: 'user', content: session.text } },
    ].map(line => JSON.stringify(line)).join('\n') + '\n');
  }
  const child = fork(path.join(__dirname, '../fixtures/browser-server.js'), [], {
    env: {
      ...sanitizeTestEnv(),
      HOME: home,
      TMUX_TMPDIR: path.join(home, 'tmux'),
      PI_DISH_BOTS: 'off',
      PI_DISH_INDEX_SYNC_BUDGET: '1000',
      ...(options.liveSessionId ? { PI_DISH_TEST_LIVE_SESSION: options.liveSessionId } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  recordEntry.child = child;
  for (const stream of [child.stdout, child.stderr]) {
    stream?.on('data', (chunk: Buffer) => logs.push(`${options.label}: ${chunk}`));
  }
  const base = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${options.label} startup timed out`)), 15000);
    const failed = (err: Error) => { clearTimeout(timer); reject(err); };
    child.once('error', failed);
    child.once('exit', code => failed(new Error(`${options.label} exited (${code})`)));
    child.once('message', (message: unknown) => {
      if (!isRecord(message) || typeof message.base !== 'string') return failed(new Error(`${options.label} invalid base`));
      clearTimeout(timer);
      resolve(message.base);
    });
  });
  const descriptor: unknown = await (await fetch(`${base}/api/host`)).json();
  if (!isRecord(descriptor) || typeof descriptor.hostId !== 'string') throw new Error(`${options.label} descriptor lacks hostId`);
  const port = new URL(base).port;
  return { home, label: options.label, base, localhostBase: `http://localhost:${port}`, hostId: descriptor.hostId, child };
}

async function stopHosts(started: readonly { home: string; child?: ChildProcess }[]): Promise<void> {
  await Promise.all(started.map(async entry => {
    const child = entry.child;
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>(resolve => {
        const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
        child.once('exit', () => { clearTimeout(timer); resolve(); });
        child.kill('SIGTERM');
      });
    }
    fs.rmSync(entry.home, { recursive: true, force: true });
  }));
}

async function fetchBots(base: string, token?: string): Promise<BotApiRow[]> {
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  const payload: unknown = await (await fetch(`${base}/api/bots`, { headers })).json();
  if (!isRecord(payload) || !Array.isArray(payload.bots)) return [];
  return payload.bots as BotApiRow[];
}

test('localhost peer without bots renders and manages Bots from a fleet hub, including cross-host workers and active service worker', async ({ page }, testInfo) => {
  const started: { home: string; child?: ChildProcess }[] = [];
  const logs: string[] = [];
  const HUB_WORKER = '2026-11-21T00-01-00-hub-worker';
  const HUB_ORDINARY = '2026-11-21T00-02-00-hub-ordinary';
  const DESKTOP_WORKER = '2026-11-21T00-03-00-desktop-worker';
  const DESKTOP_ORDINARY = '2026-11-21T00-04-00-desktop-ordinary';

  try {
    const hub = await startHost({
      label: 'beelink',
      settings: { bots: true },
      liveSessionId: HUB_WORKER,
      sessions: [
        { id: HUB_WORKER, cwd: '/fixture/hub', text: 'hub worker prompt' },
        { id: HUB_ORDINARY, cwd: '/fixture/hub', text: 'hub ordinary prompt' },
      ],
    }, started, logs);

    const seeded = await fetchBots(hub.base);
    const fleet = seeded.find(bot => bot.name === 'Fleet');
    expect(fleet).toBeDefined();
    fs.writeFileSync(path.join(hub.home, '.pi/dish/session-provenance.json'), JSON.stringify({
      version: 1,
      launches: { [HUB_WORKER]: { sourceSessionId: fleet!.sessionId, operationId: null, createdAt: Date.now() } },
    }));

    const desktop = await startHost({
      label: 'desktop',
      settings: { remotes: [{ name: 'beelink', url: hub.base }] },
      liveSessionId: DESKTOP_WORKER,
      sessions: [
        { id: DESKTOP_WORKER, cwd: '/fixture/desktop', text: 'desktop worker prompt' },
        { id: DESKTOP_ORDINARY, cwd: '/fixture/desktop', text: 'desktop ordinary prompt' },
      ],
      provenance: {
        [DESKTOP_WORKER]: { sourceSessionId: `${hub.hostId}:${fleet!.sessionId}`, operationId: null, createdAt: Date.now() },
      },
    }, started, logs);

    const botResponses: { url: string; status: number }[] = [];
    page.on('response', response => {
      if (response.url().includes('/api/bots')) botResponses.push({ url: response.url(), status: response.status() });
    });

    await page.goto(desktop.localhostBase);

    // Bots section loads from the fleet hub without issuing a 501 against self.
    const fleetNode = page.locator(`.bots-segment .bot-node[data-bot-id="${fleet!.id}"]`);
    await expect(fleetNode).toBeVisible();
    await expect(page.locator(`.bot-children[data-bot-children="${fleet!.id}"] .session-item[data-id="${HUB_WORKER}"][data-host="${hub.hostId}"]`)).toBeVisible();
    await expect(page.locator(`.bot-children[data-bot-children="${fleet!.id}"] .session-item[data-id="${DESKTOP_WORKER}"][data-host="${desktop.hostId}"]`)).toBeVisible();
    await expect(page.locator(`.session-item[data-id="${HUB_WORKER}"]`)).toHaveCount(1);
    await expect(page.locator(`.session-item[data-id="${DESKTOP_WORKER}"]`)).toHaveCount(1);
    expect(botResponses.some(res => res.url === `${desktop.localhostBase}/api/bots`)).toBe(false);
    expect(botResponses.some(res => res.url === `${desktop.localhostBase}/hosts/beelink/api/bots` && res.status === 200)).toBe(true);

    // Ordinary sessions stay in their host sections on All, while bot workers stay inside Bots.
    await page.locator('#tabAll').click();
    await expect(page.locator(`.host-section .session-item[data-id="${DESKTOP_ORDINARY}"]`)).toBeVisible();
    await expect(page.locator(`.host-section .session-item[data-id="${HUB_ORDINARY}"]`)).toBeVisible();
    await expect(page.locator(`.host-section .session-item[data-id="${DESKTOP_WORKER}"]`)).toHaveCount(0);
    await expect(page.locator(`.host-section .session-item[data-id="${HUB_WORKER}"]`)).toHaveCount(0);
    await page.locator('#tabActive').click();

    // Wait for the PWA service worker on localhost, reload under its control, and confirm Bots still render.
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload();
    await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await expect(fleetNode).toBeVisible();
    await expect(page.locator(`.bot-children[data-bot-children="${fleet!.id}"] .session-item[data-id="${DESKTOP_WORKER}"]`)).toBeVisible();

    // Create, edit, and retire a bot from the peer client: every mutation targets the fleet hub.
    await page.locator('.bots-segment .bot-new-btn').click();
    await expect(page.locator('#botNewForm')).toBeVisible();
    await page.locator('#botName').fill('DeskSub');
    await page.locator('#botIdentity').fill('You are DeskSub, created from desktop localhost.');
    await page.locator('#botParent').selectOption(fleet!.id);
    await page.locator('#botCreateBtn').click();
    await expect(page.locator('#botNewModal')).toBeHidden();

    const created = (await fetchBots(hub.base)).find(bot => bot.name === 'DeskSub');
    expect(created?.parentId).toBe(fleet!.id);
    const subNode = page.locator(`.bot-node[data-bot-id="${created!.id}"]`);
    await expect(subNode).toBeVisible();
    await expect(subNode).toHaveAttribute('style', 'padding-left:14px');

    await subNode.hover();
    await subNode.locator('.bot-edit-btn').click();
    await expect(page.locator('#botNewForm')).toBeVisible();
    await page.locator('#botParent').selectOption('');
    await page.locator('#botCreateBtn').click();
    await expect(page.locator('#botNewModal')).toBeHidden();
    await expect(subNode).toHaveAttribute('style', 'padding-left:0px');
    expect((await fetchBots(hub.base)).find(bot => bot.id === created!.id)?.parentId).toBeNull();

    await subNode.hover();
    await subNode.locator('.bot-retire-btn').click();
    await expect(subNode.locator('.bot-retire-btn.confirm')).toBeVisible();
    await subNode.locator('.bot-retire-btn').click();
    await expect(subNode).toHaveCount(0);
    expect((await fetchBots(hub.base)).find(bot => bot.id === created!.id)?.status).toBe('retired');

    // Undo in a transcript routes to the fleet hub and restores the previous revision.
    const renameRes = await fetch(`${hub.base}/api/bots/${fleet!.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Armada' }),
    });
    const renamedBody: unknown = await renameRes.json();
    const revision = isRecord(renamedBody) && isRecord(renamedBody.bot) && typeof renamedBody.bot.revision === 'number'
      ? renamedBody.bot.revision : 0;
    expect(revision).toBeGreaterThan(1);
    fs.appendFileSync(path.join(hub.home, '.pi/agent/sessions/project', `${HUB_WORKER}.jsonl`), JSON.stringify({
      type: 'custom_message',
      customType: 'bot-change',
      display: true,
      timestamp: '2026-11-21T00:05:00.000Z',
      content: [{ type: 'text', text: 'Armada: name changed' }],
      details: { botId: fleet!.id, botName: 'Armada', revision, fields: ['name'], lines: ['name: "Fleet" → "Armada"'] },
    }) + '\n');
    await page.locator(`.bots-segment .session-item[data-id="${HUB_WORKER}"]`).click();
    const undoBtn = page.locator('.message.bot-change .bot-change-undo');
    await expect(undoBtn).toBeVisible();
    await undoBtn.click();
    await expect(undoBtn).toHaveText('Undone');
    expect((await fetchBots(hub.base)).find(bot => bot.id === fleet!.id)?.name).toBe('Fleet');

    // Collapsing Fleet and opening a desktop worker via URL query params expands Fleet using the peer bots host id.
    await page.locator(`.bot-tree-toggle[data-bot-toggle="${fleet!.id}"]`).click();
    await expect(page.locator(`.bot-children[data-bot-children="${fleet!.id}"]`)).toHaveCount(0);
    await page.goto(`${desktop.localhostBase}/?openHost=${encodeURIComponent(desktop.hostId)}&openSession=${encodeURIComponent(DESKTOP_WORKER)}`);
    await expect(page.locator(`.bot-children[data-bot-children="${fleet!.id}"] .session-item[data-id="${DESKTOP_WORKER}"]`)).toHaveClass(/\bactive\b/);
  } finally {
    await stopHosts(started);
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach('server-output', { body: logs.join(''), contentType: 'text/plain' });
    }
  }
});

test('localhost peer discovers Bots from a token-authenticated user-catalog host and clears them when removed', async ({ page }, testInfo) => {
  const started: { home: string; child?: ChildProcess }[] = [];
  const logs: string[] = [];
  const token = 'bot-catalog-token';

  try {
    const desktop = await startHost({ label: 'desktop' }, started, logs);
    const hub = await startHost({
      label: 'beelink',
      token,
      settings: { bots: true, allowedOrigins: [desktop.localhostBase] },
    }, started, logs);
    const fleet = (await fetchBots(hub.base, token)).find(bot => bot.name === 'Fleet');
    expect(fleet).toBeDefined();

    await page.addInitScript(entry => {
      localStorage.setItem('pi-dish-hosts', JSON.stringify([entry]));
    }, { base: hub.base, label: 'beelink', token });

    await page.goto(desktop.localhostBase);
    await expect(page.locator(`.bots-segment .bot-node[data-bot-id="${fleet!.id}"]`)).toBeVisible();

    // Removing the bots host clears the Bots section cleanly.
    await page.locator('#btnFleet').click();
    await page.locator('.host-remove-btn').click();
    await expect(page.locator('.bots-segment')).toHaveCount(0);
  } finally {
    await stopHosts(started);
    if (testInfo.status !== testInfo.expectedStatus) {
      await testInfo.attach('server-output', { body: logs.join(''), contentType: 'text/plain' });
    }
  }
});

export {};
