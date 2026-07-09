#!/usr/bin/env node
/**
 * Test fixture standing in for the `pi` binary when spawned inside tmux by the
 * tmux.test.js suite. Reads PI_DISH_SPAWN_TOKEN (set via tmux `-e`), then —
 * unless PI_FIXTURE_NOREGISTER is set — writes a pi-dish-bridge-style registry
 * entry stamped with that token (plus a listening Unix socket and a dummy
 * session JSONL), exactly as the real bridge extension would. Then it sleeps so
 * its pid stays alive and its tmux pane stays open.
 */
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const token = process.env.PI_DISH_SPAWN_TOKEN || '';
const home = process.env.HOME || os.homedir();
const args = process.argv.slice(2);

const sessionIdx = args.indexOf('--session');
let sessionFile;
let sessionId;
if (sessionIdx >= 0 && args[sessionIdx + 1]) {
  sessionFile = args[sessionIdx + 1];
  sessionId = path.basename(sessionFile, '.jsonl');
} else {
  sessionId = '2026-07-09T00-00-00-' + (token.slice(0, 8) || 'newsess1');
  sessionFile = path.join(home, '.pi', 'agent', 'sessions', 'proj', sessionId + '.jsonl');
}

// Never register — exercises the server's 30s spawn timeout path.
if (process.env.PI_FIXTURE_NOREGISTER) {
  setInterval(() => {}, 1 << 30);
} else {
  fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
  if (!fs.existsSync(sessionFile)) {
    fs.writeFileSync(sessionFile, JSON.stringify({ type: 'session', cwd: process.cwd() }) + '\n');
  }

  const regDir = path.join(home, '.pi', 'dish', 'sessions');
  const sockDir = path.join(home, '.pi', 'dish', 'sockets');
  fs.mkdirSync(regDir, { recursive: true });
  fs.mkdirSync(sockDir, { recursive: true });

  const socketPath = path.join(sockDir, sessionId + '.sock');
  try { fs.unlinkSync(socketPath); } catch {}
  const srv = net.createServer((sock) => {
    sock.write(JSON.stringify({ type: 'hello', turnInProgress: false }) + '\n');
  });
  srv.listen(socketPath, () => {
    fs.writeFileSync(path.join(regDir, sessionId + '.json'), JSON.stringify({
      sessionId,
      sessionFile,
      cwd: process.cwd(),
      pid: process.pid,
      socketPath,
      name: 'tmux spawn',
      model: 'anthropic/claude-opus-4',
      spawnToken: token,
    }));
  });
  setInterval(() => {}, 1 << 30);
}
