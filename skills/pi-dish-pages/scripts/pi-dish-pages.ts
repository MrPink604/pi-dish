#!/usr/bin/env node
'use strict';
/**
 * Publish an HTML artifact through the local pi-dish server, optionally asking
 * a fleet hub to front it publicly. The agent only talks to its own host on
 * loopback: `--via <hub>` goes through this server's /hosts/<hub> proxy, so no
 * hub address or credential reaches the agent's environment. Plumbing is
 * skills/lib.
 */
import fs = require('node:fs');
import path = require('node:path');
import type * as Client from '../../lib/pi-dish-client.js';

let core: typeof Client;
try {
  core = require(path.join(__dirname, '..', '..', 'lib', 'pi-dish-client.js'));
} catch (e) {
  process.stderr.write(`pi-dish-pages: could not load the shared pi-dish client library (${e instanceof Error && e.message ? e.message : e}).\n`
    + 'Install the skills by symlinking the skill directories from the pi-dish repo '
    + '(run ./install.sh in the pi-dish checkout) so this script sits next to skills/lib/.\n');
  process.exit(1);
}

const { makeFail, defaultBase, discoverSessionQuietly, request, hostPath, jsonInit, parseCommandLine } = core;
const fail = makeFail('pi-dish-pages');

const USAGE = `pi-dish-pages — publish an HTML file or directory as a pi-dish page.

Usage: pi-dish-pages publish <path> [--title TEXT] [--via HUB] [--json]

Flags:
  --title TEXT   page title shown in pi-dish
  --via HUB      also map the page on fleet hub HUB and print its link
                 (default $PI_DISH_PUBLIC_VIA)
  --json         the raw response, plus the hub mapping
  --session ID   this caller's session id, when discovery cannot infer it
  --url URL      pi-dish base URL (default $PI_DISH_URL, else http://127.0.0.1:3333)

The page is served live from disk: after edits, refresh; do not re-publish.

Example:
  pi-dish-pages publish "$PWD/plan.html" --title "Refactor plan"`;

function isHelp(argv: readonly string[]) {
  const [first] = argv;
  return !first || first === 'help' || argv.includes('--help') || argv.includes('-h');
}

async function publishViaHub(base: string, hub: string, page: unknown): Promise<unknown> {
  const { data } = await request(base, '/api/host');
  const host = core.record(data ?? {});
  if (!host?.hostId) throw new Error('this server did not report a hostId (upgrade pi-dish)');
  try {
    const { data } = await request(base, hostPath(hub, '/api/fleet-artifacts'),
      jsonInit({ token: core.record(page).token, kind: 'page', hostId: host.hostId }));
    return data;
  } catch (error) {
    if (core.errorStatus(error) === 404) {
      throw new Error(`hub "${hub}" did not accept the mapping — check it is in this host's remotes, `
        + 'that it lists this host in its own remotes, and that it runs a pi-dish new enough to have /api/fleet-artifacts');
    }
    throw error;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (isHelp(argv)) return void process.stdout.write(USAGE + '\n');
  let args;
  try { args = parseCommandLine(argv, 'publish', ['title', 'via']); } catch (error) { return fail(core.errorMessage(error)); }
  if (args.command !== 'publish') {
    return fail(`unknown command: ${args.command} (use publish; run --help for usage)`);
  }
  const target = args.positional[0];
  if (!target) return fail('publish needs a path');
  const abs = path.resolve(target);
  if (!fs.existsSync(abs)) return fail(`no such file or directory: ${abs}`);

  const base = defaultBase(args.url);
  const via = args.values.via || process.env.PI_DISH_PUBLIC_VIA || null;

  // Page comments route back to the session that published the artifact, so
  // identify it the same way the comments CLI does. Discovery failing is a
  // shrug, not an error: an absent sessionId lets the server infer one from
  // the path, while sending an explicit null would be rejected.
  const sessionId = discoverSessionQuietly(args.session);
  let page: unknown;
  try {
    const { data } = await request(base, '/api/pages',
      jsonInit({ path: abs, title: args.values.title || null, ...(sessionId ? { sessionId } : {}) }));
    page = data;
  } catch (error) {
    return fail(`could not publish ${abs}: ${core.errorMessage(error)}`);
  }

  let hub: unknown = null;
  let hubError: string | null = null;
  if (via) {
    try { hub = await publishViaHub(base, via, page); } catch (error) { hubError = core.errorMessage(error); }
  }

  const hubFields = hub ? core.record(hub) : null;
  if (args.json) {
    // `owner` is the name the hub knows *this* host by, which is what its
    // mapping is keyed on — handy when a fleet map disagrees with itself.
    const mapping = hubFields ? { via, path: hubFields.path, url: hubFields.url, owner: hubFields.host || null } : null;
    core.print({ ...core.record(page ?? {}), hub: mapping, hubError }, true);
  } else {
    const pageFields = core.record(page);
    process.stdout.write(`${pageFields.url || pageFields.path}\n`);
    if (hubFields) {
      process.stdout.write(hubFields.url
        ? `via ${via}: ${hubFields.url}\n`
        : `via ${via}: ${hubFields.path} (on ${via}'s own address — it hands out no absolute URL)\n`);
    }
  }
  // The local link is real either way; a failed hub mapping only costs public
  // reachability, so say so plainly instead of failing the publish.
  if (hubError) fail(`published locally, but not through "${via}": ${hubError}`);
}

main();
