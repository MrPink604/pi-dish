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
    // Records its argv; prints AAC_STUB_STDOUT and exits 0 when given, else exits 7.
    fs.writeFileSync(aac, `#!${process.execPath}\nrequire('fs').writeFileSync(${JSON.stringify(argvLog)}, JSON.stringify(process.argv.slice(2)));\nif (process.env.AAC_STUB_STDOUT) { process.stdout.write(process.env.AAC_STUB_STDOUT); process.exit(0); }\nprocess.exit(7);\n`, { mode: 0o755 });
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
test('a refused run asks the listener why and prints the reason, keeping aac exit 4', async (t) => {
    const { home } = setup(t, false);
    const probes = path.join(home, 'probes.json');
    // `run` exits 4 like a refused aac request; `connect` answers a check probe with AAC_STUB_VERDICT.
    const aac = path.join(home, 'aac-refuse');
    fs.writeFileSync(aac, `#!${process.execPath}
const argv = process.argv.slice(2);
if (argv.includes('run')) process.exit(4);
require('fs').writeFileSync(${JSON.stringify(probes)}, JSON.stringify(argv));
if (!process.env.AAC_STUB_VERDICT) process.exit(4);
process.stdout.write(JSON.stringify({ success: true, credential: { notes: process.env.AAC_STUB_VERDICT } }));
`, { mode: 0o755 });
    const refuse = (verdict) => run(process.execPath, [cli, 'run', '--item', 'hf', '--env', 'T=password', '--', 'true'], {
        env: { ...process.env, HOME: home, AAC_BIN: aac, PI_DISH_URL: 'http://127.0.0.1:9', PI_DISH_SESSION_ID: '', AAC_STUB_VERDICT: verdict ?? '' },
    }).then(() => assert.fail('a refused run fails'), (error) => error);
    const missing = await refuse(JSON.stringify({ error: '"huggingface-read" has no password; it has field:key' }));
    assert.equal(missing.code, 4);
    assert.match(missing.stderr ?? '', /refused before approval: "huggingface-read" has no password; it has field:key/);
    const probe = JSON.parse(fs.readFileSync(probes, 'utf8'));
    const domain = probe[probe.indexOf('--domain') + 1];
    assert.ok(domain.startsWith('pidish-vault:check:'));
    assert.deepEqual(decode(PREFIX + domain.slice('pidish-vault:check:'.length)), { item: 'hf', fields: ['password'], timeoutSec: 300 });
    // A listener that cannot check (older, or unreachable) leaves the generic explanation.
    for (const verdict of [JSON.stringify({ ok: true }), null]) {
        assert.match((await refuse(verdict)).stderr ?? '', /denied in pi-dish, or approved but not released/);
    }
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
test('search sends the encoded text as a probe and prints only the listed metadata', async (t) => {
    const { home, aac, argvLog } = setup(t, false);
    const listing = { results: [{ id: 'i-1', name: 'github.com', kind: 'login', uris: ['https://github.com'], fields: ['password', 'field:api-key'] }], truncated: true };
    const env = { ...process.env, HOME: home, AAC_BIN: aac, AAC_STUB_STDOUT: JSON.stringify({ success: true, credential: { notes: JSON.stringify(listing) } }) };
    delete env.PI_DISH_VAULT_RELAY_URL;
    const { stdout } = await run(process.execPath, [cli, 'search', 'git', 'hub'], { env });
    const argv = JSON.parse(fs.readFileSync(argvLog, 'utf8'));
    assert.deepEqual(argv.slice(0, 4), ['--output', 'json', 'connect', '--domain']);
    assert.equal(Buffer.from(argv[4].slice('pidish-vault:search:'.length), 'base64url').toString('utf8'), 'git hub');
    assert.equal(stdout, 'i-1\tlogin\tgithub.com\thttps://github.com\n  fields: password, field:api-key\n# More items match; narrow the search.\n');
    const json = await run(process.execPath, [cli, 'search', '--json'], { env });
    assert.deepEqual(JSON.parse(json.stdout), listing);
});
test('sync sends the sync probe and fails when the listener refuses it', async (t) => {
    const { home, aac, argvLog } = setup(t, false);
    const env = { ...process.env, HOME: home, AAC_BIN: aac, AAC_STUB_STDOUT: JSON.stringify({ success: true, credential: {} }) };
    delete env.PI_DISH_VAULT_RELAY_URL;
    const { stdout } = await run(process.execPath, [cli, 'sync'], { env });
    assert.deepEqual(JSON.parse(fs.readFileSync(argvLog, 'utf8')), ['--output', 'json', 'connect', '--domain', 'pidish-vault:sync', '--timeout', '60']);
    assert.equal(stdout, 'Vault synced.\n');
    delete env.AAC_STUB_STDOUT;
    const refused = await run(process.execPath, [cli, 'sync'], { env }).then(() => null, (error) => error);
    assert.equal(refused?.code, 1);
    assert.match(refused?.stderr ?? '', /sync failed \(exit 7\)/);
});
test('custom fields reach their variables through the notes bundle, alongside direct slots', async (t) => {
    const { home } = setup(t, false);
    const argvLog = path.join(home, 'aac-run-argv.json');
    // Emulates aac run: --env VAR=slot pairs from AAC_STUB_CREDENTIAL, then the command.
    const aac = path.join(home, 'aac-run');
    fs.writeFileSync(aac, `#!${process.execPath}
const argv = process.argv.slice(2); require('fs').writeFileSync(${JSON.stringify(argvLog)}, JSON.stringify(argv));
const credential = JSON.parse(process.env.AAC_STUB_CREDENTIAL); const env = { ...process.env };
for (let i = 0; i < argv.length; i++) if (argv[i] === '--env') { const [name, slot] = argv[i + 1].split('='); env[name] = credential[slot]; }
const command = argv.slice(argv.indexOf('--') + 1);
const child = require('child_process').spawnSync(command[0], command.slice(1), { env, stdio: 'inherit' });
process.exit(child.status ?? 1);
`, { mode: 0o755 });
    const credential = { password: 'pw-1', notes: JSON.stringify({ fields: { 'api key': 'sk-1' }, notes: 'body' }) };
    const env = { ...process.env, HOME: home, AAC_BIN: aac, AAC_STUB_CREDENTIAL: JSON.stringify(credential), PI_DISH_URL: 'http://127.0.0.1:9', PI_DISH_SESSION_ID: '' };
    delete env.PI_DISH_VAULT_RELAY_URL;
    const { stdout } = await run(process.execPath, [cli, 'run', '--item', 'keys', '--env', 'KEY=field:api key', '--env', 'PW=password', '--env', 'BODY=notes',
        '--', process.execPath, '-e', 'process.stdout.write(JSON.stringify([process.env.KEY, process.env.PW, process.env.BODY, process.env.PI_DISH_VAULT_BUNDLE ?? null]))'], { env });
    assert.deepEqual(JSON.parse(stdout), ['sk-1', 'pw-1', 'body', null]);
    const argv = JSON.parse(fs.readFileSync(argvLog, 'utf8'));
    assert.deepEqual(decode(argv[4]).fields, ['field:api key', 'password', 'notes']);
    assert.ok(!argv.some(arg => arg.includes('sk-1') || arg.includes('pw-1')), 'values never cross argv');
});
test('the inject step refuses a bundle missing a requested custom field', async (t) => {
    const { home } = setup(t, false);
    const env = { ...process.env, HOME: home, PI_DISH_VAULT_BUNDLE: JSON.stringify({ fields: {}, notes: null }) };
    const failed = await run(process.execPath, [cli, '__inject', JSON.stringify(['KEY=field:api-key']), '--', 'true'], { env }).then(() => false, () => true);
    assert.ok(failed);
});
