/**
 * Bots onto new code: when pi-dish starts and a bot's relay runs another build, the relay is restarted through the
 * bounce queue once it is idle. Each case boots server.js against a temp HOME and an isolated tmux server with bots
 * on; the relay in the pane is the real one, its model scripted by `fixtures/bot-scripted-models.js`
 * (`PI_DISH_BOT_MODELS`). A relay from before builds were recorded is made by removing the build from its lock and
 * its `relay-build` file, which is how the first deploy of this change finds the bots already running.
 *
 * Run with: npm test
 */
import test = require('node:test');
import assert = require('node:assert');
import fs = require('node:fs');
import net = require('node:net');
import os = require('node:os');
import path = require('node:path');
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import type { AddressInfo } from 'node:net';
import { record, records } from './test-types.js';
import { sanitizeTestEnv } from './test-env.js';

const SERVER = path.join(__dirname, '..', 'server.js');
const MODELS = path.join(__dirname, 'fixtures', 'bot-scripted-models.js');

interface Booted { base: string; child: ChildProcess; log(): string; stop(): Promise<void> }
const children = new Set<Booted>();
const homes = new Set<string>();

test.after(async () => {
  for (const booted of children) await booted.stop().catch(() => {});
  for (const home of homes) {
    const relays = fs.readdirSync(botsDir(home), { withFileTypes: true }).filter(entry => entry.isDirectory() && entry.name !== 'sessions')
      .map(entry => relayLock(home, entry.name)?.pid).filter((pid): pid is number => typeof pid === 'number');
    // Relay panes outlive the server; the isolated tmux server must not, and a relay stops with its pane.
    try { execFileSync('tmux', ['-S', path.join(home, 'tmux', 'pi-dish'), 'kill-server'], { stdio: 'ignore' }); } catch {}
    for (const pid of relays) await until(() => !alive(pid), `relay ${pid} stops with its pane`, 15_000).catch(() => process.kill(pid, 'SIGKILL'));
    fs.rmSync(home, { recursive: true, force: true });
  }
});

function makeHome(): string {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-bot-restart-'));
  homes.add(home);
  fs.mkdirSync(path.join(home, '.pi', 'dish'), { recursive: true });
  fs.mkdirSync(path.join(home, 'tmux'), { recursive: true });
  fs.writeFileSync(path.join(home, '.pi', 'dish', 'settings.json'), JSON.stringify({ bots: true }));
  return home;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const port = (probe.address() as AddressInfo).port;
      probe.close(error => error ? reject(error) : resolve(port));
    });
  });
}

/** A server on `port` with bots on; the same port each time, so a relay started by an earlier server still reaches it. */
async function boot(home: string, port: number): Promise<Booted> {
  const base = `http://127.0.0.1:${port}`;
  const env: NodeJS.ProcessEnv = {
    ...sanitizeTestEnv(process.env), HOME: home, PORT: String(port), TMUX_TMPDIR: path.join(home, 'tmux'), PI_OFFLINE: '1',
    PI_DISH_BOTS: 'on', PI_DISH_URL: base, PI_DISH_BOT_MODELS: MODELS, PI_DISH_BOT_FAUX_DIR: home,
  };
  const child = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stderr?.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
  child.stdout?.on('data', (chunk: Buffer) => { output += chunk.toString('utf8'); });
  const exited = new Promise<void>(resolve => { child.once('close', () => resolve()); });
  const booted: Booted = {
    base, child, log: () => output,
    async stop() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      await exited;
      children.delete(booted);
    },
  };
  children.add(booted);
  await untilAsync(async () => {
    if (child.exitCode !== null || child.signalCode !== null) throw new Error(`server exited during startup: ${output}`);
    return fetch(`${base}/api/host`).then(response => response.ok, () => false);
  }, 'the server listens');
  return booted;
}

async function until(predicate: () => boolean, message: string, timeout = 30_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${message}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

async function untilAsync(predicate: () => Promise<boolean>, message: string, timeout = 30_000): Promise<void> {
  const deadline = Date.now() + timeout;
  while (!await predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${message}`);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
}

async function get(base: string, requestPath: string): Promise<Record<string, unknown>> {
  return record(await (await fetch(base + requestPath)).json());
}

async function prompt(base: string, route: string, message: string): Promise<void> {
  const response = await fetch(`${base}/api/sessions/${encodeURIComponent(route)}/prompt`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }),
  });
  assert.equal(response.status, 200, `the prompt is taken: ${await response.text()}`);
}

const botsDir = (home: string) => path.join(home, '.pi', 'dish', 'bots');

function relayLock(home: string, id: string): { pid: number; build?: string } | null {
  try { return JSON.parse(fs.readFileSync(path.join(botsDir(home), id, 'relay.lock'), 'utf8')) as { pid: number; build?: string }; }
  catch { return null; }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

/** What the bot's chat holds: each message's role and text, and each notice's type and text. */
function chat(home: string, id: string): { kind: string; text: string }[] {
  let lines: string[];
  try { lines = fs.readFileSync(path.join(botsDir(home), 'sessions', `${id}.jsonl`), 'utf8').split('\n').filter(Boolean); }
  catch { return []; }
  return lines.map(line => record(JSON.parse(line))).flatMap(entry => {
    const message = entry.type === 'message' ? record(entry.message) : entry.type === 'custom_message' ? entry : null;
    if (!message) return [];
    const text = records(message.content).filter(block => block.type === 'text').map(block => String(block.text ?? '')).join('');
    return [{ kind: entry.type === 'message' ? String(message.role) : String(entry.customType), text }];
  });
}

const said = (home: string, id: string, text: string) => chat(home, id).filter(entry => entry.kind === 'assistant' && entry.text === text).length;

/** Fleet, once its relay is up and listed as a live session. */
async function liveFleet(booted: Booted, home: string): Promise<{ id: string; route: string; pid: number; build: string }> {
  let fleet: Record<string, unknown> | undefined;
  await untilAsync(async () => {
    fleet = records((await get(booted.base, '/api/bots')).bots)[0];
    if (!fleet) return false;
    const lock = relayLock(home, String(fleet.id));
    if (!lock?.build || !alive(lock.pid)) return false;
    const sessions = await get(booted.base, '/api/sessions?active=1').catch(() => ({ active: [] }));
    return records(record(sessions).active).some(row => row.id === fleet!.sessionId);
  }, 'Fleet\u2019s relay runs and is listed');
  const id = String(fleet!.id);
  const lock = relayLock(home, id)!;
  return { id, route: String(fleet!.sessionId), pid: lock.pid, build: lock.build! };
}

/** Makes the running relay look like one from before relays recorded their build. */
function forgetBuild(home: string, id: string): void {
  const lock = relayLock(home, id)!;
  fs.writeFileSync(path.join(botsDir(home), id, 'relay.lock'), JSON.stringify({ pid: lock.pid, startTime: (lock as Record<string, unknown>).startTime }));
  fs.rmSync(path.join(botsDir(home), id, 'relay-build'), { force: true });
}

async function bounces(base: string): Promise<Record<string, unknown>[]> {
  return records((await get(base, '/api/session-bounces')).operations).flatMap(operation => records(record(operation).targets));
}

test('pi-dish restarts an idle relay from another build once, keeping its conversation, and leaves one on its own build alone',
  { timeout: 180_000 }, async () => {
    const home = makeHome();
    const port = await freePort();
    let server = await boot(home, port);
    const before = await liveFleet(server, home);
    assert.match(before.build, /^[0-9a-f]{12}$/, 'the relay records the build it started from');
    await prompt(server.base, before.route, 'Remember seven.');
    await until(() => said(home, before.id, 'echo 1: Remember seven.') === 1, 'Fleet answers');
    await server.stop();
    assert.ok(alive(before.pid), 'the relay outlives the server');

    forgetBuild(home, before.id);
    server = await boot(home, port);
    await until(() => relayLock(home, before.id)?.pid !== before.pid && relayLock(home, before.id)?.build === before.build,
      'the stale relay is replaced by one on the server\u2019s build');
    await until(() => !alive(before.pid), 'the old relay stops');
    await until(() => server.log().includes(`bot Fleet: restarted onto build ${before.build}`), 'the server logs the restart');
    const after = await liveFleet(server, home);
    assert.deepEqual(chat(home, before.id).filter(entry => entry.kind === 'bot-restart'),
      [{ kind: 'bot-restart', text: `Restarted onto new pi-dish code (build ${before.build}).` }], 'the chat says so');
    await prompt(server.base, after.route, 'What did I ask you to remember?');
    await until(() => said(home, before.id, 'echo 2: What did I ask you to remember?') === 1, 'Fleet answers from its stored conversation');
    const targets = await bounces(server.base);
    assert.deepEqual(targets.map(target => [target.sessionId, target.status]), [[after.route, 'completed']], 'one restart, done');
    assert.equal(relayLock(home, before.id)?.pid, after.pid, 'restarted once');
    await server.stop();

    // The next start finds the relay on its own build.
    server = await boot(home, port);
    await until(() => server.log().includes(`bot Fleet: relay ${after.pid} is already running`), 'the server finds the relay running');
    assert.deepEqual(await bounces(server.base), [], 'nothing is queued');
    // Bounce agents can restart it by hand.
    const preview = records((await get(server.base, '/api/session-bounces/preview?mode=restart')).targets);
    assert.deepEqual(preview.map(target => [target.sessionId, target.eligible, target.blockers]), [[after.route, true, []]]);
    assert.equal(relayLock(home, before.id)?.pid, after.pid);
    assert.equal(chat(home, before.id).filter(entry => entry.kind === 'bot-restart').length, 1);
    await server.stop();
  });

test('a stale relay in a run is restarted only once the run ends', { timeout: 180_000 }, async () => {
  const home = makeHome();
  const port = await freePort();
  let server = await boot(home, port);
  const before = await liveFleet(server, home);
  fs.writeFileSync(path.join(home, 'hold'), '');
  await prompt(server.base, before.route, 'Take your time.');
  await until(() => fs.existsSync(path.join(home, 'holding')), 'the run waits on its model');
  await server.stop();

  forgetBuild(home, before.id);
  server = await boot(home, port);
  await untilAsync(async () => (await bounces(server.base)).some(target => target.status === 'waiting'
    && /Waiting for the current turn to finish/.test(String(target.reason))), 'the restart waits for the run');
  assert.equal(relayLock(home, before.id)?.pid, before.pid, 'the relay in its run is left alone');
  assert.equal(said(home, before.id, 'echo 1: Take your time.'), 0);

  fs.rmSync(path.join(home, 'hold'));
  await until(() => relayLock(home, before.id)?.pid !== before.pid && relayLock(home, before.id)?.build === before.build, 'the restart follows the run');
  // The new relay takes the lock before it writes the restart line.
  await until(() => chat(home, before.id).some(entry => entry.kind === 'bot-restart'), 'the new relay writes the restart line');
  const kinds = chat(home, before.id).map(entry => entry.kind === 'assistant' ? entry.text : entry.kind);
  assert.deepEqual(kinds.slice(-2), ['echo 1: Take your time.', 'bot-restart'], 'the run answered before the relay restarted');
  await untilAsync(async () => (await bounces(server.base)).some(target => target.status === 'completed'), 'the restart completes');
  await server.stop();
});

test('a message sent while a bot\u2019s relay is down starts it and is delivered once', { timeout: 180_000 }, async () => {
  const home = makeHome();
  const port = await freePort();
  const server = await boot(home, port);
  const before = await liveFleet(server, home);
  process.kill(before.pid, 'SIGKILL');
  await until(() => !alive(before.pid), 'the relay is down');

  await prompt(server.base, before.route, 'Are you there?');
  await until(() => said(home, before.id, 'echo 1: Are you there?') === 1, 'the bot is back and answers');
  assert.notEqual(relayLock(home, before.id)?.pid, before.pid);
  assert.equal(chat(home, before.id).filter(entry => entry.kind === 'user' && entry.text === 'Are you there?').length, 1, 'delivered once');
  await server.stop();
});
