const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { BridgeSession } = require('../lib/bridge-session');

async function startFakeHost(hasCompact) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-omp-compact-'));
  const home = path.join(root, 'home');
  const socketDir = path.join(root, 'sockets');
  const sessionFile = path.join(root, 'fake-omp.jsonl');
  const callFile = path.join(root, 'compact-call.json');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(socketDir, { recursive: true, mode: 0o700 });
  const child = spawn('bun', [path.join(__dirname, 'fixtures', 'fake-omp-bridge-host.ts')], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      HOME: home,
      PI_DISH_SOCKET_DIR: socketDir,
      FAKE_OMP_SESSION_FILE: sessionFile,
      FAKE_OMP_COMPACT_CALL: callFile,
      FAKE_OMP_HAS_COMPACT: hasCompact ? '1' : '0',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', chunk => { stderr += chunk; });
  try {
    await new Promise((resolve, reject) => {
      let stdout = '';
      const timer = setTimeout(() => reject(new Error(`fake host timeout: ${stderr}`)), 5000);
      child.stdout.on('data', chunk => {
        stdout += chunk;
        if (stdout.includes('READY')) { clearTimeout(timer); resolve(); }
      });
      child.once('exit', code => reject(new Error(`fake host exited ${code}: ${stderr}`)));
    });
  } catch (error) {
    child.kill('SIGTERM');
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
  const registryDir = path.join(home, '.pi', 'dish', 'sessions');
  const registryPath = path.join(registryDir, fs.readdirSync(registryDir).find(name => name.endsWith('.json')));
  const claim = JSON.parse(fs.readFileSync(registryPath, 'utf8'));
  return {
    root, callFile, claim, child,
    async close() {
      child.kill('SIGTERM');
      await new Promise(resolve => child.once('exit', resolve));
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test('OMP bridge compact operation uses public ctx.compact and forwards lifecycle events', async () => {
  const host = await startFakeHost(true);
  const session = new BridgeSession(host.claim);
  try {
    assert.equal(host.claim.capabilities.compact, true);
    await session.connect();
    const commands = await session.getCommands();
    assert.equal(commands.commands.some(command => command.name === 'compact'), true,
      'compact control is advertised when the operation is available');
    const events = [];
    session.on('compaction_start', data => events.push(['start', data]));
    session.on('compaction_end', data => events.push(['end', data]));
    const result = await session.compact('retain decisions');
    assert.match(result.info, /started/i);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('compaction_end timeout')), 2000);
      session.once('compaction_end', () => { clearTimeout(timer); resolve(); });
    });
    assert.equal(JSON.parse(fs.readFileSync(host.callFile, 'utf8')).instructions, 'retain decisions');
    assert.deepEqual(events.map(([name]) => name), ['start', 'end']);
    assert.equal(session.compacting, false);
  } finally {
    session.close();
    await host.close();
  }
});

test('OMP bridge degrades compact capability when the host context lacks ctx.compact', async () => {
  const host = await startFakeHost(false);
  const session = new BridgeSession(host.claim);
  try {
    assert.equal(host.claim.capabilities.compact, false);
    await session.connect();
    const commands = await session.getCommands();
    assert.equal(commands.commands.some(command => command.name === 'compact'), false,
      'compact control is hidden when the host lacks the operation');
    await assert.rejects(session.compact(), /does not advertise compact/);
    assert.equal(fs.existsSync(host.callFile), false);
  } finally {
    session.close();
    await host.close();
  }
});
