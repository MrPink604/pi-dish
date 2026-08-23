#!/usr/bin/env node
/**
 * Stand-in for the system ssh binary (test/remote-hosts.test.js).
 *
 * Honors just enough of `ssh -N -L <socket>:127.0.0.1:<port> <dest>` to be a
 * real forward: it listens on the unix socket lib/remote-hosts.js asked for
 * and splices every connection to the local TCP port. That exercises the
 * whole ssh transport — run dir, socket path, lazy spawn, requests over
 * socketPath, teardown — with no ssh host in sight.
 *
 * PI_DISH_FAKE_SSH_FAIL=1 makes it behave like a refused forward: complain on
 * stderr the way ssh does and exit non-zero without creating the socket.
 */
const fs = require('fs');
const net = require('net');

const args = process.argv.slice(2);
const dashL = args.indexOf('-L');
const spec = dashL === -1 ? '' : args[dashL + 1] || '';
const match = /^(.+):127\.0\.0\.1:(\d+)$/.exec(spec);
if (!match) {
  process.stderr.write(`fake-ssh: unsupported forward spec ${spec}\n`);
  process.exit(1);
}
const [, socketPath, port] = match;

if (process.env.PI_DISH_FAKE_SSH_FAIL === '1') {
  process.stderr.write('user@box: Permission denied (publickey).\n');
  process.exit(255);
}

const server = net.createServer((client) => {
  const upstream = net.connect(Number(port), '127.0.0.1');
  const drop = () => { client.destroy(); upstream.destroy(); };
  client.on('error', drop);
  upstream.on('error', drop);
  client.pipe(upstream);
  upstream.pipe(client);
});
server.on('error', (err) => {
  process.stderr.write(`unix_listener: cannot bind to path: ${socketPath} (${err.code})\n`);
  process.exit(255);
});
server.listen(socketPath);

const bye = () => { try { fs.unlinkSync(socketPath); } catch {} process.exit(0); };
process.on('SIGTERM', bye);
process.on('SIGINT', bye);
