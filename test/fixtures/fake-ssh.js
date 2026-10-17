#!/usr/bin/env node
// Generated test/tool from test/fixtures/fake-ssh.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Stand-in for the system ssh binary (test/remote-hosts.test.js).
 *
 * Honors just enough of `ssh [-N|-T] [-o opt]... [-L <socket>:127.0.0.1:<port>]
 * <dest> [command]` to be a real hop:
 *   - `-L` listens on the unix socket lib/remote-hosts.js asked for and
 *     splices every connection to the local TCP port;
 *   - a command runs through `sh -c` with HOME set to PI_DISH_FAKE_SSH_HOME
 *     (the "far side"), stdin piped through and stdout/stderr inherited, and
 *     this process exits with its status. Like a real dropped session, this
 *     process exiting ends the command's stdin; it does not kill the command.
 * That exercises the ssh transport and deployed hosts — run dir, socket path,
 * lazy spawn, uploads, requests over socketPath, teardown — with no ssh host.
 *
 * PI_DISH_FAKE_SSH_LOG appends each invocation's command (or "-N") as a line.
 * PI_DISH_FAKE_SSH_LISTEN_DELAY_MS delays the forward socket, like a slow hop.
 * PI_DISH_FAKE_SSH_FAIL=1 makes it behave like a refused connection: complain
 * on stderr the way ssh does and exit non-zero without creating the socket.
 */
const node_child_process_1 = require("node:child_process");
const fs = require("node:fs");
const net = require("node:net");
const args = process.argv.slice(2);
let spec = '';
let dest = null;
const commandWords = [];
for (let i = 0; i < args.length; i++) {
    if (dest !== null)
        commandWords.push(args[i]);
    else if (args[i] === '-L')
        spec = args[++i] || '';
    else if (args[i] === '-o')
        i++;
    else if (!args[i].startsWith('-'))
        dest = args[i];
}
const command = commandWords.join(' ');
if (process.env.PI_DISH_FAKE_SSH_LOG)
    fs.appendFileSync(process.env.PI_DISH_FAKE_SSH_LOG, `${command || '-N'}\n`);
if (process.env.PI_DISH_FAKE_SSH_FAIL === '1') {
    process.stderr.write('user@box: Permission denied (publickey).\n');
    process.exit(255);
}
let socketPath = null;
if (spec || !command) {
    const match = /^(.+):127\.0\.0\.1:(\d+)$/.exec(spec);
    if (!match) {
        process.stderr.write(`fake-ssh: unsupported forward spec ${spec}\n`);
        process.exit(1);
    }
    const [, forwardSocket, port] = match;
    socketPath = forwardSocket;
    const server = net.createServer((client) => {
        const upstream = net.connect(Number(port), '127.0.0.1');
        const drop = () => { client.destroy(); upstream.destroy(); };
        client.on('error', drop);
        upstream.on('error', drop);
        client.pipe(upstream);
        upstream.pipe(client);
    });
    server.on('error', (error) => {
        const code = 'code' in error ? String(error.code) : 'unknown';
        process.stderr.write(`unix_listener: cannot bind to path: ${forwardSocket} (${code})\n`);
        process.exit(255);
    });
    setTimeout(() => server.listen(forwardSocket), Number(process.env.PI_DISH_FAKE_SSH_LISTEN_DELAY_MS) || 0);
}
const bye = (code) => { if (socketPath) {
    try {
        fs.unlinkSync(socketPath);
    }
    catch { }
} process.exit(code); };
process.on('SIGTERM', () => bye(0));
process.on('SIGINT', () => bye(0));
if (command) {
    const remote = (0, node_child_process_1.spawn)('sh', ['-c', command], {
        env: { ...process.env, HOME: process.env.PI_DISH_FAKE_SSH_HOME || process.env.HOME },
        stdio: ['pipe', 'inherit', 'inherit'],
    });
    remote.stdin.on('error', () => { });
    process.stdin.pipe(remote.stdin);
    remote.on('exit', (code) => bye(code ?? 255));
}
