#!/usr/bin/env node
// Generated edge from skills/pi-dish-vault/scripts/pi-dish-vault.ts; edit that source and run npm run build:edges.
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
exports.SEARCH_PREFIX = exports.PAIR_PROBE = exports.FIELDS = exports.ENVELOPE_PREFIX = void 0;
exports.parseRunArgs = parseRunArgs;
exports.encodeEnvelope = encodeEnvelope;
exports.decodeSearchReply = decodeSearchReply;
/**
 * Ask the operator for one Bitwarden item through Bitwarden Agent Access
 * (`aac`), approved from pi-dish (TASKS/vault-approvals.md).
 *
 * `run` wraps `aac run`: the request travels end-to-end encrypted to the
 * hub's pi-dish-vault-listener, which asks pi-dish for the operator's
 * decision; on approval aac injects the requested fields into one command's
 * environment. The value never passes through this process's output.
 *
 * The aac `--domain` query carries a pi-dish envelope naming the item, the
 * fields, the reason and this session, so the approval card can say who is
 * asking and why.
 */
const path = require("node:path");
const node_child_process_1 = require("node:child_process");
let core;
try {
    core = require(path.join(__dirname, '..', '..', 'lib', 'pi-dish-client.js'));
}
catch (e) {
    process.stderr.write('pi-dish-vault: could not load the shared pi-dish client library '
        + `(${e instanceof Error && e.message ? e.message : e}).\n`
        + 'Install the skills by symlinking the skill directories from the pi-dish repo '
        + '(run ./install.sh in the pi-dish checkout) so this script sits next to skills/lib/.\n');
    process.exit(1);
}
const fail = core.makeFail('pi-dish-vault');
exports.ENVELOPE_PREFIX = 'pidish-vault:v1:';
exports.FIELDS = ['username', 'password', 'totp', 'uri', 'notes'];
const DEFAULT_TIMEOUT_SEC = 300;
const MAX_TIMEOUT_SEC = 600;
const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const HELP = {
    run: `run — fetch one Bitwarden item, approved in pi-dish, into one command's environment.

Usage: run --item <id-or-name> --env VAR=field [--env ...] [--reason <text>] [--timeout <secs>] -- <cmd> [args...]

Flags:
  --item NAME      Bitwarden item id or exact name
  --env VAR=FIELD  inject FIELD (username, password, totp, uri, notes) as $VAR; repeatable
  --reason TEXT    one short, honest line shown on the approval card
  --timeout SECS   how long to wait for the decision (default ${DEFAULT_TIMEOUT_SEC}, max ${MAX_TIMEOUT_SEC})
  --session ID     this caller's session id, when discovery cannot infer it

Example:
  run --item fleet-sudo-desktop --env PW=password --reason "install rocprofiler" \\
    -- sh -c 'printf "%s\\n" "$PW" | sudo -S pacman -S --needed rocprofiler'`,
    search: `search — list vault items you may request: names, ids and URIs, never values. No approval needed.

Usage: search [text...] [--json]

Without text, lists every requestable item (up to 100). Request an item by its id
with \`run --item <id>\`; names are not unique.`,
    pair: `pair — pair this host with the hub's vault listener (once per host).

Usage: pair <psk-token>

The operator prints a token with \`pair <host-name>\` in the listener's tmux window.`,
    status: `status — show whether aac is installed and which listener connections are cached.

Usage: status`,
};
/** `run` arguments; everything after `--` is the command. */
function parseRunArgs(argv) {
    const split = argv.indexOf('--');
    if (split < 0 || split === argv.length - 1)
        throw new Error('give the command after --');
    const flags = argv.slice(0, split);
    const args = { item: '', env: [], fields: [], reason: null, timeout: DEFAULT_TIMEOUT_SEC, command: argv.slice(split + 1) };
    for (let i = 0; i < flags.length; i++) {
        const flag = flags[i];
        const value = flags[i + 1];
        if (value === undefined)
            throw new Error(`${flag} needs a value`);
        i++;
        if (flag === '--item')
            args.item = value;
        else if (flag === '--reason')
            args.reason = value;
        else if (flag === '--session')
            args.session = value;
        else if (flag === '--timeout') {
            const seconds = Number(value);
            if (!Number.isInteger(seconds) || seconds < 10 || seconds > MAX_TIMEOUT_SEC)
                throw new Error(`--timeout must be 10-${MAX_TIMEOUT_SEC} seconds`);
            args.timeout = seconds;
        }
        else if (flag === '--env') {
            const [name, field, extra] = value.split('=');
            if (extra !== undefined || !ENV_NAME_RE.test(name) || !exports.FIELDS.includes(field)) {
                throw new Error(`--env must be VAR=field with field one of ${exports.FIELDS.join(', ')}`);
            }
            args.env.push(value);
            if (!args.fields.includes(field))
                args.fields.push(field);
        }
        else
            throw new Error(`unknown option: ${flag}`);
    }
    if (!args.item.trim())
        throw new Error('--item is required');
    if (!args.env.length)
        throw new Error('at least one --env VAR=field is required');
    return args;
}
function encodeEnvelope(body) {
    const payload = { item: body.item, fields: body.fields, timeoutSec: body.timeoutSec };
    if (body.reason)
        payload.reason = body.reason;
    if (body.session)
        payload.session = body.session;
    return exports.ENVELOPE_PREFIX + Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}
/** This session as the approval card should show it; null when the CLI runs outside a pi-dish session. */
async function sessionClaim(explicit) {
    const routeId = core.discoverSessionQuietly(explicit);
    if (!routeId)
        return null;
    const nativeId = core.nativeSessionId(routeId) || String(routeId);
    const entry = core.registryEntries().find(candidate => core.registryRouteId(candidate) === routeId);
    let host = null;
    try {
        const { data } = await core.request(core.defaultBase(), '/api/host');
        const label = core.record(data ?? {}).label;
        host = typeof label === 'string' && label ? label : null;
    }
    catch { }
    const short = core.stableSessionRef(nativeId);
    return {
        ref: host ? `${host}/${short}` : short,
        name: typeof entry?.name === 'string' && entry.name ? entry.name : null,
        host,
    };
}
function aacArgv(argv) {
    const relay = process.env.PI_DISH_VAULT_RELAY_URL;
    return relay ? ['--relay-url', relay, ...argv] : [...argv];
}
const aacBin = () => process.env.AAC_BIN || 'aac';
async function run(argv) {
    const args = parseRunArgs(argv);
    const envelope = encodeEnvelope({
        item: args.item.trim(), fields: args.fields, reason: args.reason?.trim() || null,
        session: await sessionClaim(args.session), timeoutSec: args.timeout,
    });
    // aac logs its INFO status lines to stdout, mixed into the command's output; JSON mode logs only warnings.
    const aacArgs = aacArgv(['--output', 'json', 'run', '--domain', envelope, '--timeout', String(args.timeout),
        ...args.env.flatMap(mapping => ['--env', mapping]), '--', ...args.command]);
    process.stderr.write(`pi-dish-vault: waiting for approval of ${args.item} in pi-dish (up to ${args.timeout}s)…\n`);
    const child = (0, node_child_process_1.spawn)(aacBin(), aacArgs, { stdio: 'inherit' });
    for (const signal of ['SIGINT', 'SIGTERM'])
        process.on(signal, () => child.kill(signal));
    child.on('error', error => fail(`could not run ${aacBin()}: ${error.message} (install aac v0.11.0 or set AAC_BIN)`));
    child.on('exit', (code, signal) => process.exit(signal ? 1 : code ?? 1));
}
/** aac v0.11.0 pairs non-interactively only alongside a request; the listener answers this probe itself. */
exports.PAIR_PROBE = 'pidish-vault:pair';
function pair(token) {
    if (!token)
        return fail('usage: pair <psk-token>');
    const result = (0, node_child_process_1.spawnSync)(aacBin(), aacArgv(['connect', '--token', token, '--domain', exports.PAIR_PROBE, '--output', 'json', '--timeout', '30']), { encoding: 'utf8' });
    if (result.error)
        return fail(`could not run ${aacBin()}: ${result.error.message}`);
    if (result.status !== 0)
        return fail(`pairing failed (exit ${result.status}): ${(result.stderr || result.stdout || '').trim().split('\n').pop() || 'no output'}`);
    process.stdout.write('Paired with the vault listener. `status` lists the cached connection.\n');
}
/** The listener answers this probe itself with item metadata as JSON in `notes`. */
exports.SEARCH_PREFIX = 'pidish-vault:search:';
/** The listing carried in an `aac --output json connect` reply. */
function decodeSearchReply(stdout) {
    const notes = core.record(core.record(JSON.parse(stdout)).credential ?? {}).notes;
    if (typeof notes !== 'string')
        throw new Error('the listener returned no listing (is it up to date?)');
    const listing = core.record(JSON.parse(notes));
    const results = Array.isArray(listing.results) ? listing.results.flatMap((entry) => {
        const row = core.record(entry ?? {});
        return typeof row.id === 'string' ? [{
                id: row.id, name: typeof row.name === 'string' ? row.name : '', kind: typeof row.kind === 'string' ? row.kind : '',
                uris: Array.isArray(row.uris) ? row.uris.filter((uri) => typeof uri === 'string') : [],
            }] : [];
    }) : [];
    return { results, truncated: listing.truncated === true };
}
function search(args) {
    const json = args.includes('--json');
    const text = args.filter(arg => arg !== '--json').join(' ').trim();
    const probe = exports.SEARCH_PREFIX + Buffer.from(text, 'utf8').toString('base64url');
    const result = (0, node_child_process_1.spawnSync)(aacBin(), aacArgv(['--output', 'json', 'connect', '--domain', probe, '--timeout', '30']), { encoding: 'utf8' });
    if (result.error)
        return fail(`could not run ${aacBin()}: ${result.error.message}`);
    if (result.status !== 0)
        return fail(`search failed (exit ${result.status}): ${(result.stderr || result.stdout || '').trim().split('\n').pop() || 'no output'}`);
    const listing = decodeSearchReply(result.stdout);
    if (json)
        return void process.stdout.write(JSON.stringify(listing, null, 2) + '\n');
    for (const entry of listing.results)
        process.stdout.write(`${entry.id}\t${entry.kind}\t${entry.name}\t${entry.uris.join(' ')}\n`);
    if (!listing.results.length)
        process.stdout.write('# No matching items.\n');
    if (listing.truncated)
        process.stdout.write('# More items match; narrow the search.\n');
}
function status() {
    const result = (0, node_child_process_1.spawnSync)(aacBin(), ['connections', 'list'], { encoding: 'utf8' });
    if (result.error)
        return fail(`aac is not installed (${result.error.message}); install aac v0.11.0 or set AAC_BIN`);
    process.stdout.write(result.stdout || '');
    if (result.status !== 0)
        process.stderr.write(result.stderr || '');
    process.exitCode = result.status ?? 1;
}
async function main() {
    const [command, ...rest] = process.argv.slice(2);
    if (!command || command === '--help' || command === '-h' || command === 'help') {
        const topic = command === 'help' ? rest[0] : undefined;
        if (topic && HELP[topic])
            return void process.stdout.write(HELP[topic] + '\n');
        return void process.stdout.write(`pi-dish-vault — Bitwarden items for agents, approved in pi-dish\n\nCommands:\n${Object.values(HELP).map(text => `  ${text.split('\n')[0]}`).join('\n')}\n\nRun \`help <command>\` for flags.\n`);
    }
    if (rest.includes('--help') && HELP[command] && !rest.includes('--'))
        return void process.stdout.write(HELP[command] + '\n');
    try {
        if (command === 'run')
            return await run(rest);
        if (command === 'pair')
            return pair(rest[0]);
        if (command === 'search')
            return search(rest);
        if (command === 'status')
            return status();
        fail(`unknown command: ${command} (run --help for the command list)`);
    }
    catch (error) {
        fail(core.errorMessage(error));
    }
}
if (require.main === module)
    void main();
