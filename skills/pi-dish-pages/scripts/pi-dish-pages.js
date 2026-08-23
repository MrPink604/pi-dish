#!/usr/bin/env node
/**
 * Publish an HTML artifact through the local pi-dish server, optionally
 * asking a fleet hub to front it publicly (TASKS/multi-host.md block 7).
 *
 * The agent only ever talks to its own host on loopback: `--via <hub>` goes
 * out through this server's /hosts/<hub> proxy, so no hub address or
 * credential lives in the agent's environment.
 */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

function fail(message) {
  process.stderr.write(`pi-dish-pages: ${message}\n`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const args = { command: argv[0] || 'publish', rest: [] };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--title') args.title = argv[++i];
    else if (arg === '--via') args.via = argv[++i];
    else if (arg === '--session') args.session = argv[++i];
    else if (arg === '--url') args.url = argv[++i];
    else if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
    else args.rest.push(arg);
  }
  return args;
}

async function request(base, pathname, init) {
  const response = await fetch(new URL(pathname, base), init);
  let result;
  try { result = await response.json(); } catch { result = null; }
  if (!response.ok) {
    const error = new Error(result?.error || `HTTP ${response.status}`);
    error.status = response.status;
    throw error;
  }
  return result;
}

// The comments CLI already knows how to identify this session; borrow it when
// it's installed so page comments route back to this agent. A page still
// publishes fine without it.
function discoverSession(explicit) {
  if (explicit) return explicit;
  if (process.env.PI_DISH_SESSION_ID) return process.env.PI_DISH_SESSION_ID;
  const cli = path.join(os.homedir(), '.pi', 'agent', 'skills', 'pi-dish-comments', 'scripts', 'pi-dish-comments.js');
  if (!fs.existsSync(cli)) return null;
  try {
    const id = execFileSync(process.execPath, [cli, 'session'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return id || null;
  } catch {
    return null;
  }
}

async function publishViaHub(base, hub, page) {
  const host = await request(base, '/api/host');
  if (!host?.hostId) throw new Error('this server did not report a hostId (upgrade pi-dish)');
  try {
    return await request(base, `/hosts/${encodeURIComponent(hub)}/api/fleet-artifacts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: page.token, kind: 'page', hostId: host.hostId }),
    });
  } catch (error) {
    if (error.status === 404) {
      throw new Error(`hub "${hub}" did not accept the mapping — check it is in this host's remotes, `
        + 'that it lists this host in its own remotes, and that it runs a pi-dish new enough to have /api/fleet-artifacts');
    }
    throw error;
  }
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (error) { return fail(error.message); }
  if (args.command !== 'publish') {
    return fail(`unknown command: ${args.command} (use publish)`);
  }
  const target = args.rest[0];
  if (!target) return fail('publish needs a path');
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) return fail(`no such file or directory: ${abs}`);

  const base = args.url || process.env.PI_DISH_URL || 'http://127.0.0.1:3333';
  const via = args.via || process.env.PI_DISH_PUBLIC_VIA || null;

  // An absent sessionId lets the server infer one from the path; sending an
  // explicit null is an error, not a shrug.
  const sessionId = discoverSession(args.session);
  let page;
  try {
    page = await request(base, '/api/pages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: abs, title: args.title || null, ...(sessionId ? { sessionId } : {}) }),
    });
  } catch (error) {
    return fail(`could not publish ${abs}: ${error.message}`);
  }

  let hub = null;
  let hubError = null;
  if (via) {
    try { hub = await publishViaHub(base, via, page); } catch (error) { hubError = error.message; }
  }

  if (args.json) {
    // `owner` is the name the hub knows *this* host by, which is what its
    // mapping is keyed on — handy when a fleet map disagrees with itself.
    const mapping = hub ? { via, path: hub.path, url: hub.url, owner: hub.host || null } : null;
    process.stdout.write(JSON.stringify({ ...page, hub: mapping, hubError }, null, 2) + '\n');
  } else {
    process.stdout.write(`${page.url || page.path}\n`);
    if (hub) {
      process.stdout.write(hub.url
        ? `via ${via}: ${hub.url}\n`
        : `via ${via}: ${hub.path} (on ${via}'s own address — it hands out no absolute URL)\n`);
    }
  }
  // The local link is real either way; a failed hub mapping only costs public
  // reachability, so say so plainly instead of failing the publish.
  if (hubError) fail(`published locally, but not through "${via}": ${hubError}`);
}

main();
