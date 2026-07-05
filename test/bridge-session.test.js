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

const { BridgeSession } = require('../lib/bridge-session.js');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-bridge-test-'));

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
