#!/usr/bin/env node
'use strict';
/**
 * Publish an HTML artifact through the local pi-dish server, optionally
 * asking a fleet hub to front it publicly (TASKS/multi-host.md block 7).
 *
 * The agent only ever talks to its own host on loopback: `--via <hub>` goes
 * out through this server's /hosts/<hub> proxy, so no hub address or
 * credential lives in the agent's environment.
 *
 * The plumbing (session discovery, HTTP) lives in
 * skills/lib/pi-dish-client.js. Skills are installed by symlinking each skill
 * directory into ~/.pi/agent/skills/, and Node resolves requires through the
 * realpath, so this relative path reaches the pi-dish repo's own copy even
 * when invoked through the link.
 */
const fs = require('node:fs');
const path = require('node:path');

let core;
try {
  core = require(path.join(__dirname, '..', '..', 'lib', 'pi-dish-client.js'));
} catch (e) {
  process.stderr.write(
    'pi-dish-pages: could not load the shared pi-dish client library '
    + `(${e && e.message ? e.message : e}).\n`
    + 'Install the skills by symlinking the skill directories from the pi-dish repo '
    + '(run ./install.sh in the pi-dish checkout) so this script sits next to skills/lib/.\n',
  );
  process.exit(1);
}

const { makeFail, defaultBase, discoverSessionQuietly, request, hostPath, jsonInit } = core;
const fail = makeFail('pi-dish-pages');

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

async function publishViaHub(base, hub, page) {
  const { data: host } = await request(base, '/api/host');
  if (!host?.hostId) throw new Error('this server did not report a hostId (upgrade pi-dish)');
  try {
    const { data } = await request(base, hostPath(hub, '/api/fleet-artifacts'),
      jsonInit({ token: page.token, kind: 'page', hostId: host.hostId }));
    return data;
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

  const base = defaultBase(args.url);
  const via = args.via || process.env.PI_DISH_PUBLIC_VIA || null;

  // Page comments route back to the session that published the artifact, so
  // identify it the same way the comments CLI does. Discovery failing is a
  // shrug, not an error: an absent sessionId lets the server infer one from
  // the path, while sending an explicit null would be rejected.
  const sessionId = discoverSessionQuietly(args.session);
  let page;
  try {
    const { data } = await request(base, '/api/pages',
      jsonInit({ path: abs, title: args.title || null, ...(sessionId ? { sessionId } : {}) }));
    page = data;
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
