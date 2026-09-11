const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const { BridgeSession } = require('../lib/bridge-session');

const bunAvailable = spawnSync('bun', ['--version'], { stdio: 'ignore' }).status === 0;

async function startFakeHost({ btwError = '', btwAnswer = '' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-omp-btw-'));
  const home = path.join(root, 'home');
  const socketDir = path.join(root, 'sockets');
  const sessionFile = path.join(root, 'fake-omp.jsonl');
  const callFile = path.join(root, 'btw-call.json');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(socketDir, { recursive: true, mode: 0o700 });
  const child = spawn('bun', [path.join(__dirname, 'fixtures', 'fake-omp-bridge-host.ts')], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      HOME: home,
      // A fake host must not adopt (and rename) the tmux pane running the tests.
      TMUX: '',
      TMUX_PANE: '',
      PI_DISH_SOCKET_DIR: socketDir,
      FAKE_OMP_SESSION_FILE: sessionFile,
      FAKE_OMP_HAS_BTW: '1',
      FAKE_OMP_BTW_CALL: callFile,
      FAKE_OMP_BTW_ERROR: btwError,
      FAKE_OMP_BTW_ANSWER: btwAnswer,
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
    root, sessionFile, callFile, claim, child,
    async close() {
      child.kill('SIGTERM');
      await new Promise(resolve => child.once('exit', resolve));
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

test('OMP bridge /btw answers an ephemeral side question without touching the transcript', { skip: !bunAvailable }, async () => {
  const host = await startFakeHost({ btwAnswer: '42 — the ephemeral answer' });
  const session = new BridgeSession(host.claim);
  try {
    await session.connect();
    assert.equal(session.capabilities.btw, true, 'wrapper advertises the btw capability');

    const commands = await session.getCommands();
    const listed = commands.commands.find(command => command.name === 'btw');
    assert.ok(listed, 'btw is listed');
    assert.equal(listed.supported, true);

    const before = fs.readFileSync(host.sessionFile, 'utf8');
    const result = await session.runCommand('/btw what is the answer?', undefined, { timeout: 180000 });
    assert.equal(result.answer, '42 — the ephemeral answer');

    const call = JSON.parse(fs.readFileSync(host.callFile, 'utf8'));
    assert.match(call.promptText, /what is the answer\?/, 'question reaches the ephemeral turn');
    assert.match(call.promptText, /Ephemeral side question/, 'OMP’s btw template wraps the question');

    assert.equal(fs.readFileSync(host.sessionFile, 'utf8'), before, 'side question never persists');
  } finally {
    session.close();
    await host.close();
  }
});

test('OMP bridge /btw requires a question and surfaces host failures', { skip: !bunAvailable }, async () => {
  const host = await startFakeHost({ btwError: 'no model configured' });
  const session = new BridgeSession(host.claim);
  try {
    await session.connect();
    await assert.rejects(session.runCommand('/btw', undefined, { timeout: 180000 }), /usage: \/btw <question>/);
    assert.ok(!fs.existsSync(host.callFile), 'a bare /btw never reaches the session');
    await assert.rejects(
      session.runCommand('/btw will this fail?', undefined, { timeout: 180000 }),
      /no model configured/,
    );
  } finally {
    session.close();
    await host.close();
  }
});
