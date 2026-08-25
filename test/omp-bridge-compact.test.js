const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const { BridgeSession } = require('../lib/bridge-session');

async function waitFor(predicate, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('condition timeout');
}

async function startFakeHost(hasCompact, {
  swallowOutcome = false,
  nestedSubsession = false,
  askDialog = false,
  askThrow = false,
  checkUiRestore = false,
  nativeProjection = null,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-omp-compact-'));
  const home = path.join(root, 'home');
  const socketDir = path.join(root, 'sockets');
  const parentFile = path.join(root, 'fake-parent.jsonl');
  const sessionFile = nestedSubsession
    ? path.join(root, 'fake-parent', 'Explore.jsonl')
    : path.join(root, 'fake-omp.jsonl');
  const callFile = path.join(root, 'compact-call.json');
  const askResultFile = path.join(root, 'ask-result.json');
  const uiRestoreResultFile = path.join(root, 'ui-restore-result.json');
  fs.mkdirSync(home, { recursive: true });
  fs.mkdirSync(socketDir, { recursive: true, mode: 0o700 });
  if (nestedSubsession) {
    fs.writeFileSync(parentFile, JSON.stringify({ type: 'session', id: 'fake-parent', cwd: root }) + '\n');
  }
  const child = spawn('bun', [path.join(__dirname, 'fixtures', 'fake-omp-bridge-host.ts')], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      HOME: home,
      PI_DISH_SOCKET_DIR: socketDir,
      FAKE_OMP_SESSION_FILE: sessionFile,
      FAKE_OMP_COMPACT_CALL: callFile,
      FAKE_OMP_HAS_COMPACT: hasCompact ? '1' : '0',
      FAKE_OMP_COMPACT_SWALLOW: swallowOutcome ? '1' : '0',
      FAKE_OMP_ASK_RESULT: askDialog ? askResultFile : '',
      FAKE_OMP_ASK_THROW: askThrow ? '1' : '0',
      FAKE_OMP_UI_RESTORE_RESULT: checkUiRestore ? uiRestoreResultFile : '',
      FAKE_OMP_NATIVE_PROJECTION: nativeProjection ? JSON.stringify(nativeProjection) : '',
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
    root, callFile, askResultFile, claim, child,
    async close() {
      child.kill('SIGTERM');
      await new Promise(resolve => child.once('exit', resolve));
      const uiRestored = fs.existsSync(uiRestoreResultFile)
        ? JSON.parse(fs.readFileSync(uiRestoreResultFile, 'utf8')) : null;
      fs.rmSync(root, { recursive: true, force: true });
      return { uiRestored };
    },
  };
}

test('OMP bridge projects the native ask tool through extension UI', async () => {
  const host = await startFakeHost(false, { askDialog: true });
  const session = new BridgeSession(host.claim);
  const requests = [];
  session.on('extension_ui_request', request => requests.push(request));
  try {
    await session.connect();
    const request = await waitFor(() => requests.find(candidate => candidate.method === 'ask'));
    assert.equal(request.questions[0].question, 'Deploy now?');
    assert.equal(requests.filter(candidate => candidate.method === 'ask').length, 1,
      'transient OMP handler proxies do not accumulate ask wrappers');
    assert.equal(request.questions[0].options[0].description, 'Ship the current build.');

    const answer = {
      kind: 'submit',
      results: [{
        id: 'deploy',
        question: 'Deploy now?',
        options: ['Yes', 'No'],
        multi: false,
        selectedOptions: ['Yes'],
      }],
    };
    await session.respondExtensionUI(request.id, { value: answer });
    await waitFor(() => fs.existsSync(host.askResultFile));
    assert.deepEqual(JSON.parse(fs.readFileSync(host.askResultFile, 'utf8')), answer);
  } finally {
    session.close();
    await host.close();
  }
});

test('OMP bridge retires an ask request when local presentation throws', async () => {
  const host = await startFakeHost(false, { askDialog: true, askThrow: true });
  const session = new BridgeSession(host.claim);
  const requests = [];
  session.on('extension_ui_request', request => requests.push(request));
  try {
    await session.connect();
    await waitFor(() => fs.existsSync(host.askResultFile));
    assert.deepEqual(JSON.parse(fs.readFileSync(host.askResultFile, 'utf8')), {
      error: 'fake ask presentation failed',
    });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(requests.some(request => request.method === 'ask'), false,
      'failed ask is absent from bridge replay');
  } finally {
    session.close();
    await host.close();
  }
});

test('OMP bridge restores the shared UI context during extension shutdown', async () => {
  const host = await startFakeHost(false, { checkUiRestore: true });
  const session = new BridgeSession(host.claim);
  await session.connect();
  session.close();
  const result = await host.close();
  assert.equal(result.uiRestored, true, 'reload cannot accumulate another askDialog wrapper');
});

test('OMP bridge projects native todos, plan mode, and prewalk as extension UI', async () => {
  const host = await startFakeHost(false, {
    nativeProjection: {
      todos: [{
        name: 'Implementation',
        tasks: [
          { content: 'Wire native state', status: 'completed' },
          { content: 'Verify browser', status: 'in_progress' },
          { content: 'Wait for upstream', status: 'blocked', blocker: 'API review' },
        ],
      }],
      planMode: { enabled: true, workflow: 'parallel' },
      prewalk: { target: { provider: 'zai', id: 'glm-5.2' }, thinkingLevel: 'high' },
    },
  });
  const session = new BridgeSession(host.claim);
  const requests = [];
  session.on('extension_ui_request', request => requests.push(request));
  try {
    await session.connect();
    await waitFor(() => requests.filter(request => request.method === 'setStatus').length === 2
      && requests.some(request => request.method === 'setWidget'));
    const widget = requests.find(request => request.method === 'setWidget');
    assert.equal(widget.widgetKey, 'Todos');
    assert.deepEqual(widget.widgetLines, [
      'Implementation  1/3',
      '  [x] Wire native state',
      '  [>] Verify browser',
      '  [!] Wait for upstream — API review',
    ]);
    assert.equal(requests.find(request => request.statusKey === 'planmode').statusText, 'Plan mode · parallel');
    assert.equal(requests.find(request => request.statusKey === 'prewalk').statusText,
      'Prewalk → zai/glm-5.2 · high');
  } finally {
    session.close();
    await host.close();
  }
});

test('OMP bridge uses a nested subagent header id instead of its local agent filename', async () => {
  const host = await startFakeHost(false, { nestedSubsession: true });
  try {
    assert.equal(host.claim.nativeSessionId, 'fake-omp');
    assert.equal(path.basename(host.claim.sessionFile), 'Explore.jsonl');
  } finally {
    await host.close();
  }
});

test('OMP bridge compact operation uses public ctx.compact and forwards lifecycle events', async () => {
  const host = await startFakeHost(true);
  const session = new BridgeSession(host.claim);
  try {
    assert.equal(host.claim.capabilities.compact, true);
    assert.equal(host.claim.capabilities.shareSnapshot, true);
    await session.connect();
    assert.deepEqual(await session.getShareSnapshot(), {
      systemPrompt: 'effective fake OMP system prompt',
      tools: [{ name: 'read', description: 'Read a file' }],
    });
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

test('OMP bridge releases the compaction gate when the host swallows a failure', async () => {
  const host = await startFakeHost(true, { swallowOutcome: true });
  const session = new BridgeSession(host.claim);
  try {
    await session.connect();
    const events = [];
    session.on('compaction_end', data => events.push(data));
    const result = await session.compact('will be refused');
    assert.match(result.info, /started/i);
    // No session_before_compact/session_compact ever fires; the resolution
    // probe must report the swallowed failure and release the gate.
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('compaction_end timeout')), 5000);
      session.once('compaction_end', () => { clearTimeout(timer); resolve(); });
    });
    assert.match(events[0].errorMessage, /finished without compacting/i);
    assert.equal(session.compacting, false);
    // The gate is genuinely down: a new compact attempt reaches the host
    // instead of being refused as already-in-progress.
    const again = await session.compact();
    assert.match(again.info, /started/i);
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
