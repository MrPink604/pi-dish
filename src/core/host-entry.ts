/**
 * Entrypoint of the host bundle a hub deploys over ssh (remote-hosts.ts,
 * `deploy: true`). The bundle lives at `<root>/lib/pi-dish-host.js`, so the
 * application root is this file's parent directory, the same layout every
 * `path.resolve(__dirname, '..')` resource lookup already assumes.
 *
 * The hub owns this process's lifetime through the ssh channel's stdin:
 *   - the first line is the bearer token the hub will present; it travels
 *     on stdin rather than in argv or the environment of the remote command;
 *   - end of input means the hub's ssh session is gone, and the host exits
 *     through the ordinary SIGTERM path. Agents keep running in tmux.
 */
import path = require('node:path');
import { startServer } from './server-app';

const TOKEN_RE = /^[0-9a-f]{32,128}$/;

let buffered = '';
let started = false;

function start(token: string): void {
  if (started) return;
  started = true;
  if (!TOKEN_RE.test(token)) {
    console.error('pi-dish host: expected a hex bearer token on the first line of stdin');
    process.exit(2);
  }
  process.env.PI_DISH_TOKEN = token;
  startServer(path.resolve(__dirname, '..'));
}

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk: string) => {
  if (started) return;
  buffered += chunk;
  const newline = buffered.indexOf('\n');
  if (newline !== -1) start(buffered.slice(0, newline).trim());
});
process.stdin.on('end', () => {
  if (!started) process.exit(2);
  process.kill(process.pid, 'SIGTERM');
});
