#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

function fail(message) {
  process.stderr.write(`pi-dish-sessions: ${message}\n`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const result = { command: argv[0] || 'list', positional: [] };
  const takesValue = new Set(['--url', '--session', '--cwd', '--model', '--name', '--prompt', '--limit', '--host']);
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json' || arg === '--active' || arg === '--no-wait') result[arg.slice(2).replace('-', '_')] = true;
    else if (takesValue.has(arg)) {
      if (i + 1 >= argv.length) throw new Error(`${arg} needs a value`);
      result[arg.slice(2)] = argv[++i];
    } else if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
    else result.positional.push(arg);
  }
  return result;
}

function parentPid(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const match = stat.match(/^\d+ \([\s\S]*\) \S (\d+) /);
    return match ? Number(match[1]) : null;
  } catch {
    try {
      const value = execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).trim();
      return /^\d+$/.test(value) ? Number(value) : null;
    } catch { return null; }
  }
}

function ancestorPids() {
  const result = new Set();
  let pid = process.pid;
  while (pid && !result.has(pid)) { result.add(pid); pid = parentPid(pid); }
  return result;
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (e) { return e.code === 'EPERM'; }
}

function registryEntries() {
  const dir = path.join(os.homedir(), '.pi', 'dish', 'sessions');
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter(name => name.endsWith('.json')).flatMap(name => {
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (!entry?.sessionId) return [];
      if (entry.socketPath && !fs.existsSync(entry.socketPath)) return [];
      if (Number.isInteger(entry.pid) && !pidAlive(entry.pid)) return [];
      return [entry];
    } catch { return []; }
  });
}

function registryRouteId(entry) {
  const harnessId = entry?.wrapper?.harnessId || entry?.harnessId || 'pi';
  const nativeSessionId = entry?.nativeSessionId || entry?.sessionId;
  if (harnessId === 'pi') return nativeSessionId;
  return '~sk1_' + Buffer.from(JSON.stringify([harnessId, nativeSessionId]), 'utf8').toString('base64url');
}

function discoverSession(explicit) {
  if (explicit) return explicit;
  if (process.env.PI_DISH_SESSION_ID) return process.env.PI_DISH_SESSION_ID;
  const entries = registryEntries();
  const ancestors = ancestorPids();
  const byPid = entries.filter(entry => Number.isInteger(entry.pid) && ancestors.has(entry.pid));
  if (byPid.length) {
    byPid.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return registryRouteId(byPid[0]);
  }
  const cwd = path.resolve(process.cwd());
  const byCwd = entries.filter(entry => entry.cwd && path.resolve(entry.cwd) === cwd);
  if (byCwd.length === 1) return registryRouteId(byCwd[0]);
  if (!entries.length) throw new Error('no live pi-dish bridge sessions found; pass --session <id>');
  throw new Error(`could not identify this session; pass --session <id> (${entries.length} live sessions)`);
}

// One token for this server. A `/hosts/<name>` request is still a request to
// the local server: it attaches each peer's own credential when it proxies, so
// the CLI never holds per-host tokens.
const TOKEN = process.env.PI_DISH_TOKEN || '';

async function request(base, pathname, init = {}) {
  const headers = { ...(init.headers || {}) };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const response = await fetch(new URL(pathname, base), { ...init, headers });
  let data;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) {
    const error = new Error(data?.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.body = data;
    throw error;
  }
  return { data, status: response.status };
}

// Cross-host reach is only a path prefix: every route the CLI already speaks
// composes behind the local server's /hosts/<name> proxy (TASKS/multi-host.md
// block 6). No host means the local server, exactly as before.
function hostPath(host, pathname) {
  return host ? `/hosts/${encodeURIComponent(host)}${pathname}` : pathname;
}

async function api(base, host, pathname, init) {
  try {
    return await request(base, hostPath(host, pathname), init);
  } catch (e) {
    // The proxy answers an unconfigured name with a bare 404 (the fleet map is
    // not a discovery surface), so confirm against the fleet before blaming it.
    if (host && e.status === 404 && !e.body?.error) {
      const unknown = await unknownHostError(base, host);
      if (unknown) throw unknown;
    }
    throw e;
  }
}

async function unknownHostError(base, host) {
  let names;
  try {
    const { data } = await request(base, '/api/hosts');
    names = (data?.hosts || []).map(entry => entry.name).filter(Boolean);
  } catch { return null; }
  if (names.includes(host)) return null;
  const known = names.length ? names.join(', ') : 'no remotes configured';
  return new Error(`unknown host "${host}" (known: ${known}); run 'hosts' to list the fleet`);
}

function jsonInit(body, headers = {}) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) };
}

function print(value, json) {
  if (json) process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  else if (typeof value === 'string') process.stdout.write(value + '\n');
  else process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

// Absent means unsupported (mixed-version fleets are the steady state); only
// the capabilities an agent can act on are worth a column.
const AGENT_CAPABILITIES = ['sessions', 'search', 'spawns', 'comments', 'pages', 'terminal'];

function hostLine(host) {
  const name = host.self ? '(self)' : host.name;
  const state = host.reachable ? 'reachable' : `unreachable:${host.error || 'unknown'}`;
  const capabilities = host.capabilities
    ? (AGENT_CAPABILITIES.filter(key => host.capabilities[key]).join(',') || 'none')
    : '-';
  return `${name}\t${state}\t${host.label || host.name || ''}\t${capabilities}`;
}

function sessionLine(session) {
  const state = session.isActive ? (session.turnInProgress || session.compacting ? 'working' : 'active') : 'inactive';
  return `${session.id}\t${state}\t${session.name || 'Unnamed'}\t${session.cwd || ''}`;
}

// Host-qualified caller identity (`<hostId>:<sessionId>`, TASKS/multi-host.md
// block 6): still advisory, still just the existing provenance fields — the
// qualifier only says which host the id belongs to.
async function qualifyCaller(base, sessionId) {
  try {
    const { data } = await request(base, '/api/host');
    return data?.hostId ? `${data.hostId}:${sessionId}` : sessionId;
  } catch { return sessionId; }
}

async function createSpawn(base, host, body, callerId) {
  const init = () => jsonInit(body, { 'X-Pi-Dish-Session-Id': callerId });
  try {
    return await api(base, host, '/api/sessions/new', init());
  } catch (e) {
    // A host resolves provenance ids against its own sessions, so a peer may
    // refuse a foreign caller. Provenance is advisory: drop the attribution
    // rather than fail the spawn.
    if (!host || !/requestedBySessionId/i.test(e.message || '')) throw e;
    process.stderr.write(`pi-dish-sessions: ${host} did not accept cross-host launch provenance; spawning unattributed\n`);
    const { requestedBySessionId, ...rest } = body;
    return api(base, host, '/api/sessions/new', jsonInit(rest));
  }
}

async function pollSpawn(base, host, spawnId, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await api(base, host, `/api/session-spawns/${encodeURIComponent(spawnId)}`);
    if (result.status !== 202 && result.data.status !== 'starting') return result.data;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`spawn ${spawnId} did not finish within ${Math.round(timeoutMs / 1000)}s`);
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); }
  catch (e) { return fail(e.message); }
  const base = args.url || process.env.PI_DISH_URL || 'http://127.0.0.1:3333';
  // This session's own identity is always resolved locally, so `session`
  // ignores --host; every other command routes through it.
  const host = args.host || null;

  try {
    if (args.command === 'session' || args.command === 'self') {
      print(discoverSession(args.session), args.json);
      return;
    }

    if (args.command === 'hosts') {
      const { data } = await request(base, '/api/hosts');
      if (args.json) return print(data, true);
      for (const entry of data.hosts || []) process.stdout.write(hostLine(entry) + '\n');
      const remotes = (data.hosts || []).filter(entry => !entry.self);
      if (remotes.length) process.stdout.write('# Add --host <name> to any command to act on that host.\n');
      else process.stdout.write('# No remotes configured; this host is the whole fleet.\n');
      return;
    }

    if (args.command === 'list') {
      const qs = args.active ? '?active=1' : '';
      const { data } = await api(base, host, `/api/sessions${qs}`);
      if (args.json) return print(data, true);
      for (const session of [...(data.active || []), ...(data.previous || [])]) process.stdout.write(sessionLine(session) + '\n');
      if (data.indexing) process.stdout.write('# Session index is still building; repeat list for more.\n');
      if (data.discoveryTruncated) process.stdout.write('# Nested session discovery reached its safety limit.\n');
      return;
    }

    if (args.command === 'spawn') {
      const sourceSessionId = discoverSession(args.session);
      // Advisory launch provenance, unchanged: a cross-host spawn qualifies the
      // caller with this host's id so the target's sidecar records who asked.
      const callerId = host ? await qualifyCaller(base, sourceSessionId) : sourceSessionId;
      const body = { async: true, requestedBySessionId: callerId };
      if (args.cwd) body.cwd = args.cwd;
      if (args.model) body.model = args.model;
      const { data } = await createSpawn(base, host, body, callerId);
      if (args.no_wait) return print(data, args.json);
      const operation = await pollSpawn(base, host, data.spawnId);
      if (operation.status === 'error') throw new Error(operation.error || 'session spawn failed');
      const id = operation.sessionId;
      if (args.name) await api(base, host, `/api/sessions/${encodeURIComponent(id)}/rename`, jsonInit({ name: args.name }));
      if (args.prompt) await api(base, host, `/api/sessions/${encodeURIComponent(id)}/prompt`, jsonInit({ message: args.prompt }));
      return print({ ...operation, spawnId: data.spawnId, sessionId: id, ...(host ? { host } : {}) }, args.json);
    }

    if (args.command === 'search') {
      const query = args.positional.join(' ').trim();
      if (!query) throw new Error('search needs a query');
      const { data } = await api(base, host, `/api/search?q=${encodeURIComponent(query)}`);
      const limit = Math.max(1, Math.min(100, Number.parseInt(args.limit || '20', 10) || 20));
      const results = (data.results || []).slice(0, limit);
      if (args.json) return print({ ...data, results }, true);
      for (const session of results) {
        const when = session.lastActivity ? String(session.lastActivity).slice(0, 10) : '';
        const matches = session.matchCount ? `${session.matchCount} match${session.matchCount === 1 ? '' : 'es'}` : 'metadata match';
        process.stdout.write(`${sessionLine(session)}\t${when}\t${matches}\n`);
        for (const snippet of session.snippets || []) {
          process.stdout.write(`    …${String(snippet).replace(/\s+/g, ' ').trim()}…\n`);
        }
      }
      if (!results.length) process.stdout.write('No matches.\n');
      if (data.total > results.length) process.stdout.write(`# ${data.total - results.length} more results not shown; refine the query or raise --limit.\n`);
      if (data.indexing) process.stdout.write('# Session index is still building; results may be partial — retry shortly.\n');
      return;
    }

    const id = args.positional.shift();
    if (!id) throw new Error(`${args.command} needs a target session id`);

    if (args.command === 'related') {
      const { data } = await api(base, host, `/api/sessions/${encodeURIComponent(id)}/related`);
      if (args.json) return print(data, true);
      for (const relation of data.relations || []) {
        process.stdout.write(`${relation.kind}\t${relation.session.id}\t${relation.session.name || 'Unnamed'}\t${relation.source}\n`);
      }
      if (!data.relations?.length) process.stdout.write('No related sessions.\n');
      return;
    }

    if (args.command === 'show') {
      const limit = Math.max(1, Math.min(100, Number.parseInt(args.limit || '20', 10) || 20));
      const [lists, messages] = await Promise.all([
        api(base, host, '/api/sessions'),
        api(base, host, `/api/sessions/${encodeURIComponent(id)}/messages?limit=${limit}`),
      ]);
      const session = [...(lists.data.active || []), ...(lists.data.previous || [])].find(item => item.id === id) || null;
      return print({ session, ...messages.data }, true);
    }

    if (args.command === 'send' || args.command === 'prompt' || args.command === 'steer' || args.command === 'follow-up') {
      const message = args.positional.join(' ').trim();
      if (!message) throw new Error(`${args.command} needs message text`);
      const route = args.command === 'steer' ? 'steer' : args.command === 'follow-up' ? 'follow-up' : 'prompt';
      const { data } = await api(base, host, `/api/sessions/${encodeURIComponent(id)}/${route}`, jsonInit({ message }));
      return print(data, args.json);
    }

    const route = args.command === 'interrupt' || args.command === 'abort' ? 'abort'
      : args.command === 'resume' ? 'resume'
        : args.command === 'close' || args.command === 'terminate' ? 'close' : null;
    if (!route) throw new Error(`unknown command: ${args.command}`);
    const { data } = await api(base, host, `/api/sessions/${encodeURIComponent(id)}/${route}`, jsonInit({}));
    print(data, args.json);
  } catch (e) {
    fail(e.message);
  }
}

main();
