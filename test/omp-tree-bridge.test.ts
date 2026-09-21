/**
 * OMP tree protocol tests against the real shared bridge core and a fake host.
 * The host deliberately gives navigation methods only to registered command
 * handlers, matching OMP's ExtensionCommandContext boundary.
 */
import test = require('node:test');
import { bridgeEntry, present, record, records } from './test-types.js';
import assert = require('node:assert');
import fs = require('node:fs');
import os = require('node:os');
import path = require('node:path');
import { spawn, spawnSync } from 'node:child_process';
import { isRecord } from '../lib/wire-protocol.js';

const bunAvailable = spawnSync('bun', ['--version'], { stdio: 'ignore' }).status === 0;
const fixture = path.join(__dirname, 'fixtures', 'fake-omp-tree-host.ts');
const { BridgeSession }: typeof import('../lib/bridge-session.js') = require('../lib/bridge-session.js')

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function waitForValue<T>(read: () => T | null | undefined | false, label: string, timeout = 5000): Promise<T> {
  const deadline = Date.now() + timeout;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const value = read();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await delay(25);
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError ?? '');
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${detail}` : ''}`);
}

async function startHost(mode: string) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `pi-dish-omp-tree-${mode}-`));
  const log = path.join(home, 'operations.jsonl');
  fs.writeFileSync(log, '');
  const child = spawn('bun', [fixture], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      HOME: home,
      // The bridge stamps $TMUX/$TMUX_PANE into its registry entry and renames
      // that window after the session — inheriting them would rename the pane
      // running the test suite.
      TMUX: '',
      TMUX_PANE: '',
      PI_DISH_SOCKET_DIR: path.join(home, 'sockets'),
      FAKE_OMP_TREE_MODE: mode,
      FAKE_OMP_TREE_LOG: log,
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });

  try {
    const registryDir = path.join(home, '.pi', 'dish', 'sessions');
    const registered = await waitForValue(() => {
      if (child.exitCode !== null) throw new Error(`fake host exited ${child.exitCode}: ${stderr}`);
      const name = fs.readdirSync(registryDir).find((file) => file.endsWith('.json'));
      if (!name) return null;
      const registryPath = path.join(registryDir, name);
      const entry = bridgeEntry(record(JSON.parse(fs.readFileSync(registryPath, 'utf8'))));
      return { registryPath, entry };
    }, 'complete fake OMP registry entry');
    const { registryPath, entry } = registered;
    const session = new BridgeSession(entry);
    await session.connect();
    return {
      home,
      log,
      entry,
      registryPath,
      session,
      async serviceTree() {
        // BridgeSession writes the socket request synchronously, but allow the
        // fake host's event loop to enqueue it before simulating the keypress
        // pi-dish sends into the pane.
        await delay(25);
        child.kill('SIGUSR2');
      },
      async serviceTreeByCommand() {
        await delay(25);
        child.kill('SIGUSR1');
      },
      async stop() {
        session.close();
        if (child.exitCode === null) child.kill('SIGTERM');
        await Promise.race([
          new Promise<void>((resolve) => child.once('exit', () => resolve())),
          delay(2000).then(() => { if (child.exitCode === null) child.kill('SIGKILL'); }),
        ]);
        fs.rmSync(home, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (child.exitCode === null) child.kill('SIGKILL');
    fs.rmSync(home, { recursive: true, force: true });
    throw error;
  }
}

type FakeTreeHost = Awaited<ReturnType<typeof startHost>>;
function readOperations(host: FakeTreeHost): Record<string, unknown>[] {
  return fs.readFileSync(host.log, 'utf8').trim().split('\n').filter(Boolean).map(line => {
    const value: unknown = JSON.parse(line);
    if (!isRecord(value)) throw new Error('Invalid operation log entry');
    return value;
  });
}

test('OMP bridge serializes tree reads and runs navigate/branch only in command context', { skip: !bunAvailable }, async () => {
  const host = await startHost('normal');
  try {
    // Leaf-only read: same leaf as the full tree, none of the O(session)
    // serialization the transcript route used to pay per request.
    assert.deepEqual(await host.session.readTreeLeaf(), { leafId: 'u2' });

    const before = record(await host.session.readTree());
    assert.equal(before.leafId, 'u2');
    assert.deepEqual(before.activePathIds, ['u2', 'a1', 'u1']);
    const nodes = records(before.nodes);
    assert.deepEqual(nodes.map(node => [node.id, node.depth, node.isLeaf]), [
      ['u1', 0, false], ['a1', 0, false], ['u2', 0, true],
    ]);
    assert.equal(record(present(nodes[0])).text, 'first prompt');

    const navigating = host.session.treeNavigate('a1', { summarize: true });
    await host.serviceTree();
    const navigated = record(await navigating);
    assert.equal(navigated.leafId, 'a1');
    const branching = host.session.branchTree('u1');
    await host.serviceTree();
    const branched = record(await branching);
    assert.equal(branched.leafId, 'u1');

    assert.deepEqual(readOperations(host), [
      { operation: 'navigate', targetId: 'a1', summarize: true, insideCommand: true, trigger: 'shortcut' },
      { operation: 'branch', entryId: 'u1', insideCommand: true, trigger: 'shortcut' },
    ]);
    assert.equal(host.entry.treeServiceShortcut, 'ctrl+alt+shift+f12',
      'the registry advertises the chord pi-dish presses instead of typing the command');
    const commands = record(await host.session.getCommands());
    assert.equal(records(commands.commands).some(command => record(command).name === 'dish-tree-service'), false,
      'the internal service command is not advertised to pi-dish clients');
  } finally {
    await host.stop();
  }
});

test('OMP bridge maps command-context acquisition and operation timeouts to distinct errors', { skip: !bunAvailable }, async (t) => {
  await t.test('acquisition timeout', async () => {
    const host = await startHost('acquisition-timeout');
    try {
      await assert.rejects(
        host.session.treeNavigate('a1'),
        /tree navigation command context acquisition timed out after 100ms/,
      );
    } finally {
      await host.stop();
    }
  });

  await t.test('operation timeout', async () => {
    const host = await startHost('operation-timeout');
    try {
      const operation = host.session.treeNavigate('a1');
      await host.serviceTree();
      await assert.rejects(operation, /tree navigation timed out after 100ms/);
      assert.deepEqual(readOperations(host), [
        { operation: 'navigate', targetId: 'a1', summarize: false, insideCommand: true, trigger: 'shortcut' },
      ]);
    } finally {
      await host.stop();
    }
  });
});

test('OMP bridge maps cancelled tree operations to precise errors', { skip: !bunAvailable }, async (t) => {
  await t.test('navigate cancellation', async () => {
    const host = await startHost('cancel-navigate');
    try {
      const operation = host.session.treeNavigate('a1');
      await host.serviceTree();
      await assert.rejects(operation, /tree navigation cancelled by Fake Oh My Pi/);
    } finally {
      await host.stop();
    }
  });

  await t.test('branch cancellation', async () => {
    const host = await startHost('cancel-branch');
    try {
      const operation = host.session.branchTree('u1');
      await host.serviceTree();
      await assert.rejects(operation, /tree branch cancelled by Fake Oh My Pi/);
    } finally {
      await host.stop();
    }
  });
});

test('OMP bridge capability-gates missing read and command-context APIs', { skip: !bunAvailable }, async (t) => {
  await t.test('missing ReadonlySessionManager API degrades before registration', async () => {
    const host = await startHost('missing-tree-api');
    try {
      const capabilities = record(host.entry.capabilities);
      assert.equal(capabilities.treeRead, false);
      assert.equal(capabilities.treeNavigation, false);
      await assert.rejects(host.session.readTree(), /does not advertise treeRead/);
    } finally {
      await host.stop();
    }
  });

  await t.test('missing command-context method fails closed after discovery', async () => {
    const host = await startHost('missing-command-api');
    try {
      const operation = host.session.treeNavigate('a1');
      await host.serviceTree();
      await assert.rejects(operation, /does not expose navigateTree/);
      const updated = await waitForValue(() => {
        const entry = JSON.parse(fs.readFileSync(host.registryPath, 'utf8'));
        return entry.capabilities.treeNavigation === false && entry;
      }, 'treeNavigation capability downgrade');
      assert.equal(updated.capabilities.treeRead, true);
    } finally {
      await host.stop();
    }
  });
});

// A host without extension shortcuts (or a bridge predating them) advertises
// no chord, and pi-dish falls back to typing the service command.
test('OMP bridge without shortcut support keeps the typed service command', { skip: !bunAvailable }, async () => {
  const host = await startHost('no-shortcut');
  try {
    assert.equal(host.entry.treeServiceShortcut, null);
    const operation = host.session.treeNavigate('a1');
    await host.serviceTreeByCommand();
    assert.equal(record(await operation).leafId, 'a1');
    assert.deepEqual(readOperations(host), [
      { operation: 'navigate', targetId: 'a1', summarize: false, insideCommand: true, trigger: 'command' },
    ]);
  } finally {
    await host.stop();
  }
});

export {};
