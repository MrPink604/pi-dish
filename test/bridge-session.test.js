/**
 * Unit tests for BridgeSession's socket protocol guards. A stub Unix-socket
 * server stands in for the bridge extension: it answers get_commands and
 * ignores everything else, proving the send() timeout rejects instead of
 * leaving the caller hanging forever (the pre-timeout behavior).
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-bridge-test-'));
process.env.HOME = tmpDir;

const {
  BridgeSession,
  REGISTRY_DIR,
  invalidateRegistryCache,
  listRegisteredSessions,
  pruneRegisteredSession,
} = require('../lib/bridge-session.js');
const { processIdentity } = require('../lib/process-identity');

function writeRegistryEntry(name, entry) {
  fs.mkdirSync(REGISTRY_DIR, { recursive: true });
  const registryPath = path.join(REGISTRY_DIR, `${name}.json`);
  fs.writeFileSync(registryPath, JSON.stringify(entry));
  invalidateRegistryCache();
  return registryPath;
}

function alternateClaim(socketPath, overrides = {}) {
  const identity = processIdentity(process.pid);
  return {
    protocolVersion: 2,
    wrapper: { harnessId: 'omp', name: 'Oh My Pi', wrapperVersion: 'test' },
    harnessId: 'omp',
    nativeSessionId: 'alternate-session',
    sessionId: 'alternate-session',
    sessionFile: path.join(tmpDir, 'alternate-session.jsonl'),
    bridgeInstanceId: 'alternate-instance',
    instanceId: 'alternate-instance',
    socketPath,
    pid: identity.pid,
    startTime: identity.startTime,
    spawnToken: null,
    capabilities: { prompt: true, reload: false },
    ...overrides,
  };
}

test('send() resolves matched responses and times out on unanswered commands', async () => {
  const socketPath = path.join(tmpDir, 'bridge.sock');
  const server = net.createServer((sock) => {
    sock.on('data', (chunk) => {
      for (const line of chunk.toString().trim().split('\n')) {
        const cmd = JSON.parse(line);
        if (cmd.command === 'get_commands') {
          sock.write(JSON.stringify({ type: 'response', id: cmd.id, success: true, data: { commands: [] } }) + '\n');
        }
        // Anything else is deliberately never answered.
      }
    });
  });
  await new Promise((r) => server.listen(socketPath, r));

  const sess = new BridgeSession({ sessionId: 'test-session', socketPath, pid: process.pid, cwd: tmpDir });
  await sess.connect();

  assert.deepEqual(await sess.getCommands(), { commands: [] });

  await assert.rejects(
    sess.send('never_answered', {}, { timeout: 100 }),
    /timed out after 100ms/,
    'an unanswered command must reject instead of hanging',
  );

  sess.close();
  await new Promise((r) => server.close(r));
});

test('registry scan prunes a current entry whose process starttime does not match', () => {
  fs.mkdirSync(REGISTRY_DIR, { recursive: true });
  const socketPath = path.join(tmpDir, 'reused-pid.sock');
  const registryPath = path.join(REGISTRY_DIR, 'reused-pid.json');
  fs.writeFileSync(socketPath, 'stale socket path');
  fs.writeFileSync(registryPath, JSON.stringify({
    sessionId: 'reused-pid',
    socketPath,
    pid: process.pid,
    startTime: '0',
  }));
  invalidateRegistryCache();

  assert.deepEqual(listRegisteredSessions(), [], 'PID reuse cannot satisfy the old birth identity');
  assert.equal(fs.existsSync(registryPath), false, 'stale claim is pruned');
  assert.equal(fs.existsSync(socketPath), true, 'scanner never unlinks a possibly rebound socket path');
});

test('legacy registry compatibility is limited to Pi', () => {
  const identity = processIdentity(process.pid);
  const piSocketPath = path.join(tmpDir, 'legacy-pi.sock');
  const ompSocketPath = path.join(tmpDir, 'legacy-omp.sock');
  fs.writeFileSync(piSocketPath, 'socket placeholder');
  fs.writeFileSync(ompSocketPath, 'socket placeholder');
  const piPath = writeRegistryEntry('legacy-pi', {
    harnessId: 'pi', sessionId: 'legacy-pi', socketPath: piSocketPath,
    pid: identity.pid, startTime: identity.startTime,
  });
  const ompPath = writeRegistryEntry('legacy-omp', {
    harnessId: 'omp', sessionId: 'legacy-omp', socketPath: ompSocketPath,
    pid: identity.pid, startTime: identity.startTime,
  });

  const sessions = listRegisteredSessions();
  assert.equal(sessions.some((entry) => entry.sessionId === 'legacy-pi'), true, 'legacy Pi remains supported');
  assert.equal(sessions.some((entry) => entry.sessionId === 'legacy-omp'), false, 'legacy alternate claims are rejected');
  assert.equal(fs.existsSync(piPath), true);
  assert.equal(fs.existsSync(ompPath), false, 'invalid alternate claim is pruned');
  fs.rmSync(piPath, { force: true });
});

test('registry scan rejects contradictory alternate wrapper identity', () => {
  const socketPath = path.join(tmpDir, 'contradictory-wrapper.sock');
  fs.writeFileSync(socketPath, 'socket placeholder');
  const registryPath = writeRegistryEntry('contradictory-wrapper', alternateClaim(socketPath, {
    harnessId: 'omp',
    wrapper: { harnessId: 'prime', name: 'Prime Agent', wrapperVersion: 'test' },
  }));

  assert.equal(
    listRegisteredSessions().some((entry) => entry.socketPath === socketPath),
    false,
    'outer and wrapper harness identities must agree',
  );
  assert.equal(fs.existsSync(registryPath), false);
});

test('pruning an inspected claim preserves a replacement bridge registry entry', () => {
  fs.mkdirSync(REGISTRY_DIR, { recursive: true });
  const socketPath = path.join(tmpDir, 'replacement.sock');
  const registryPath = path.join(REGISTRY_DIR, 'replacement.json');
  const identity = processIdentity(process.pid);
  const inspected = {
    sessionId: 'replacement', socketPath, pid: identity.pid,
    startTime: identity.startTime, instanceId: 'old-instance',
  };
  const replacement = { ...inspected, instanceId: 'new-instance' };
  fs.writeFileSync(registryPath, JSON.stringify(replacement));

  assert.equal(pruneRegisteredSession(inspected), false, 'old claim cannot prune a replacement instance');
  assert.deepEqual(JSON.parse(fs.readFileSync(registryPath, 'utf8')), replacement);
  fs.rmSync(registryPath, { force: true });
});

test('tracks compacting state from the hello and compaction events', async () => {
  const socketPath = path.join(tmpDir, 'bridge-compact.sock');
  let clientSock = null;
  const server = net.createServer((sock) => {
    clientSock = sock;
    sock.on('error', () => {});
    // Connect mid-compaction: the hello snapshot must seed sess.compacting.
    sock.write(JSON.stringify({ type: 'hello', turnInProgress: false, compacting: true }) + '\n');
  });
  await new Promise((r) => server.listen(socketPath, r));

  const sess = new BridgeSession({ sessionId: 'compact-session', socketPath, pid: process.pid, cwd: tmpDir });
  await sess.connect();
  const hello = await sess.waitForHello();
  assert.equal(hello.type, 'hello', 'hello can be awaited as identity proof');
  assert.equal(sess.compacting, true, 'hello with compacting seeds the flag');

  clientSock.write(JSON.stringify({ type: 'event', event: 'compaction_end', data: {} }) + '\n');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sess.compacting, false, 'compaction_end clears the flag');

  clientSock.write(JSON.stringify({ type: 'event', event: 'compaction_start', data: {} }) + '\n');
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(sess.compacting, true, 'compaction_start sets the flag');

  sess.close();
  await new Promise((r) => server.close(r));
});

test('tracks running tools, including update-only phases, until a completion boundary', () => {
  const sess = new BridgeSession({
    sessionId: 'tool-state-session', socketPath: '/unused', pid: process.pid, cwd: tmpDir,
  });
  sess._handle({ type: 'event', event: 'tool_execution_start', data: {
    toolCallId: 'tc1', toolName: 'Bash', args: { command: 'sleep 1' }, startedAt: 123,
  } });
  sess._handle({ type: 'event', event: 'tool_execution_update', data: {
    toolCallId: 'tc1', partialResult: { content: [{ type: 'text', text: 'partial' }] },
  } });
  assert.deepEqual(sess.runningToolCalls.get('tc1'), {
    toolName: 'Bash',
    args: { command: 'sleep 1' },
    startedAt: 123,
    lastPartialResult: { content: [{ type: 'text', text: 'partial' }] },
  });

  sess._handle({ type: 'event', event: 'tool_execution_end', data: { toolCallId: 'tc1' } });
  assert.equal(sess.runningToolCalls.has('tc1'), false, 'end removes the completed call');

  sess._handle({ type: 'event', event: 'tool_execution_update', data: {
    toolCallId: 'late', toolName: 'Bash', args: { command: 'jobs' },
    partialResult: { content: [{ type: 'text', text: 'background output' }] },
  } });
  assert.equal(sess.runningToolCalls.get('late').toolName, 'Bash',
    'a post-turn/update-only background phase is replayable');
  sess._handle({ type: 'event', event: 'agent_end', data: {} });
  assert.equal(sess.runningToolCalls.size, 0, 'agent_end clears orphaned running calls');
});

test('captures extension UI replay before server listeners attach', () => {
  const sess = new BridgeSession({
    sessionId: 'ui-state-session', socketPath: '/unused', pid: process.pid, cwd: tmpDir,
  });
  sess._handle({ type: 'event', event: 'extension_ui_request', data: {
    method: 'setWidget', widgetKey: 'Todos', widgetLines: ['[>] Verify browser'],
  } });
  sess._handle({ type: 'event', event: 'extension_ui_request', data: {
    method: 'setStatus', statusKey: 'planmode', statusText: 'Plan mode · parallel',
  } });
  sess._handle({ type: 'event', event: 'extension_ui_request', data: {
    method: 'ask', id: 'ask-1', questions: [{ id: 'q', question: 'Continue?' }],
  } });

  assert.deepEqual(sess.extUIState.widgets.get('Todos').widgetLines, ['[>] Verify browser']);
  assert.equal(sess.extUIState.statuses.get('planmode').statusText, 'Plan mode · parallel');
  assert.equal(sess.extUIState.dialogs.get('ask-1').method, 'ask');

  sess._handle({ type: 'event', event: 'extension_ui_resolved', data: { id: 'ask-1' } });
  assert.equal(sess.extUIState.dialogs.has('ask-1'), false);
  sess._handle({ type: 'event', event: 'session_switch', data: {} });
  assert.equal(sess.extUIState.widgets.size, 0);
  assert.equal(sess.extUIState.statuses.size, 0);
});

test('protocol-v2 connections reject a hello from a different registry claim', async () => {
  const socketPath = path.join(tmpDir, 'bridge-wrong-claim.sock');
  const server = net.createServer((sock) => {
    sock.write(JSON.stringify({
      type: 'hello',
      protocolVersion: 2,
      wrapper: { harnessId: 'omp' },
      harnessId: 'omp',
      nativeSessionId: 'other-session',
      sessionId: 'other-session',
      bridgeInstanceId: 'other-bridge',
      instanceId: 'other-bridge',
      pid: process.pid,
      spawnToken: 'wrong-token',
      capabilities: { prompt: true },
    }) + '\n');
  });
  await new Promise((r) => server.listen(socketPath, r));

  const sess = new BridgeSession({
    protocolVersion: 2,
    wrapper: { harnessId: 'prime' },
    harnessId: 'prime',
    nativeSessionId: 'expected-session',
    sessionId: 'expected-session',
    bridgeInstanceId: 'expected-bridge',
    instanceId: 'expected-bridge',
    socketPath,
    pid: process.pid,
    spawnToken: 'expected-token',
    capabilities: { prompt: false },
  });
  await assert.rejects(sess.connect(), /does not match the selected registry claim/);
  assert.equal(sess.harnessId, 'prime', 'untrusted hello cannot replace claim identity');
  assert.equal(sess.capabilities.prompt, false, 'untrusted hello cannot elevate capabilities');

  await new Promise((r) => server.close(r));
});

test('alternate protocol-v2 connections reject every changed static claim field', async (t) => {
  const cases = [
    ['wrapper identity', (claim) => ({ wrapper: { ...claim.wrapper, wrapperVersion: 'different' } })],
    ['capabilities', (claim) => ({ capabilities: { ...claim.capabilities, reload: true } })],
    ['socket path', (claim) => ({ socketPath: `${claim.socketPath}.different` })],
    ['contradictory outer harness', () => ({ harnessId: 'prime' })],
  ];
  for (const [name, change] of cases) {
    await t.test(name, async () => {
      const socketPath = path.join(tmpDir, `bridge-changed-${name.replace(/\W+/g, '-')}.sock`);
      const claim = alternateClaim(socketPath);
      const server = net.createServer((sock) => {
        sock.write(JSON.stringify({ type: 'hello', ...claim, ...change(claim) }) + '\n');
      });
      await new Promise((r) => server.listen(socketPath, r));

      const sess = new BridgeSession(claim);
      await assert.rejects(sess.connect(), /does not match the selected registry claim/);
      assert.deepEqual(sess.wrapper, claim.wrapper, 'untrusted hello cannot replace wrapper identity');
      assert.deepEqual(sess.capabilities, claim.capabilities, 'untrusted hello cannot replace capabilities');
      await new Promise((r) => server.close(r));
    });
  }
});

test('alternate protocol-v2 connections accept an exact static claim', async () => {
  const socketPath = path.join(tmpDir, 'bridge-exact-static-claim.sock');
  const claim = alternateClaim(socketPath);
  const server = net.createServer((sock) => {
    sock.write(JSON.stringify({
      type: 'hello',
      ...claim,
      turnInProgress: false,
      model: 'openai/test-model',
    }) + '\n');
  });
  await new Promise((r) => server.listen(socketPath, r));

  const sess = new BridgeSession(claim);
  await sess.connect();
  const hello = await sess.waitForHello();
  assert.equal(hello.instanceId, claim.instanceId);
  assert.equal(sess.model, 'openai/test-model', 'volatile hello state remains accepted');

  sess.close();
  await new Promise((r) => server.close(r));
});
