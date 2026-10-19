// Generated test/tool from test/vault-cli.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * pi-dish-vault CLI: the aac argv it builds and the envelope the listener
 * decodes — item, fields, reason and the calling session as the approval card
 * shows it. `aac` is a stub that records its argv (AAC_BIN), so nothing here
 * talks to Bitwarden or a relay.
 *
 * Run with: npm test
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const test_types_js_1 = require("./test-types.js");
const run = (0, node_util_1.promisify)(node_child_process_1.execFile);
const cli = path.join(__dirname, '..', 'skills', 'pi-dish-vault', 'scripts', 'pi-dish-vault.js');
const PREFIX = 'pidish-vault:v1:';
function setup(t, withSession) {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-dish-vault-cli-'));
    t.after(() => fs.rmSync(home, { recursive: true, force: true }));
    if (withSession) {
        const registry = path.join(home, '.pi', 'dish', 'sessions');
        fs.mkdirSync(registry, { recursive: true });
        fs.writeFileSync(path.join(registry, 'a.json'), JSON.stringify({
            sessionId: '01a0a845-cc06-772e-9e2c-51ae78b25cf6', pid: process.pid, cwd: '/nowhere', name: 'Htpc provision', updatedAt: new Date().toISOString(),
        }));
    }
    const argvLog = path.join(home, 'aac-argv.json');
    const aac = path.join(home, 'aac');
    fs.writeFileSync(aac, `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(argvLog)}, JSON.stringify(process.argv.slice(2)));\nprocess.exit(7);\n`, { mode: 0o755 });
    return { home, aac, argvLog };
}
async function hostServer(t) {
    const server = http.createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ hostId: 'h', label: 'desktop' })); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => server.close());
    return `http://127.0.0.1:${server.address().port}`;
}
function decode(domain) {
    assert.ok(domain.startsWith(PREFIX));
    return (0, test_types_js_1.record)(JSON.parse(Buffer.from(domain.slice(PREFIX.length), 'base64url').toString('utf8')));
}
test('run hands aac an envelope naming the item, fields, reason and calling session, and passes its exit code through', async (t) => {
    const { home, aac, argvLog } = setup(t, true);
    const url = await hostServer(t);
    const env = { ...process.env, HOME: home, AAC_BIN: aac, PI_DISH_URL: url, PI_DISH_SESSION_ID: '', PI_DISH_VAULT_RELAY_URL: 'ws://relay.test' };
    const result = await run(process.execPath, [cli, 'run', '--item', 'fleet-sudo-desktop', '--env', 'PW=password', '--env', 'USER_NAME=username',
        '--reason', 'install rocprofiler', '--timeout', '120', '--', 'sh', '-c', 'echo hi'], { env }).then(() => 0, (error) => error.code);
    assert.equal(result, 7);
    const argv = JSON.parse(fs.readFileSync(argvLog, 'utf8'));
    assert.deepEqual(argv.slice(0, 6), ['--relay-url', 'ws://relay.test', '--output', 'json', 'run', '--domain']);
    assert.deepEqual(argv.slice(7), ['--timeout', '120', '--env', 'PW=password', '--env', 'USER_NAME=username', '--', 'sh', '-c', 'echo hi']);
    assert.deepEqual(decode(argv[6]), {
        item: 'fleet-sudo-desktop', fields: ['password', 'username'], timeoutSec: 120, reason: 'install rocprofiler',
        session: { ref: 'desktop/01a0a845', name: 'Htpc provision', host: 'desktop' },
    });
});
test('outside a pi-dish session the envelope carries no session claim', async (t) => {
    const { home, aac, argvLog } = setup(t, false);
    const env = { ...process.env, HOME: home, AAC_BIN: aac, PI_DISH_URL: 'http://127.0.0.1:9', PI_DISH_SESSION_ID: '' };
    delete env.PI_DISH_VAULT_RELAY_URL;
    await run(process.execPath, [cli, 'run', '--item', 'github.com', '--env', 'T=password', '--', 'true'], { env }).catch(() => { });
    const argv = JSON.parse(fs.readFileSync(argvLog, 'utf8'));
    assert.deepEqual(argv.slice(0, 3), ['--output', 'json', 'run']);
    assert.deepEqual(decode(argv[4]), { item: 'github.com', fields: ['password'], timeoutSec: 300 });
});
test('run refuses unknown fields, missing commands and out-of-range timeouts before calling aac', async (t) => {
    const { home, aac, argvLog } = setup(t, false);
    const env = { ...process.env, HOME: home, AAC_BIN: aac };
    for (const args of [
        ['--item', 'x', '--env', 'T=ssn', '--', 'true'],
        ['--item', 'x', '--env', 'T=password'],
        ['--item', 'x', '--env', 'T=password', '--timeout', '5000', '--', 'true'],
        ['--env', 'T=password', '--', 'true'],
        ['--item', 'x', '--env', '1T=password', '--', 'true'],
    ]) {
        const failed = await run(process.execPath, [cli, 'run', ...args], { env }).then(() => false, () => true);
        assert.ok(failed, args.join(' '));
    }
    assert.equal(fs.existsSync(argvLog), false);
});
