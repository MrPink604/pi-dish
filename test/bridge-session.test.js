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
