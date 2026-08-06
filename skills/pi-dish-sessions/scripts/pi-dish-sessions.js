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
  const takesValue = new Set(['--url', '--session', '--cwd', '--model', '--name', '--prompt', '--limit']);
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

function discoverSession(explicit) {
  if (explicit) return explicit;
  if (process.env.PI_DISH_SESSION_ID) return process.env.PI_DISH_SESSION_ID;
  const entries = registryEntries();
  const ancestors = ancestorPids();
  const byPid = entries.filter(entry => Number.isInteger(entry.pid) && ancestors.has(entry.pid));
  if (byPid.length) {
    byPid.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return byPid[0].sessionId;
  }
  const cwd = path.resolve(process.cwd());
  const byCwd = entries.filter(entry => entry.cwd && path.resolve(entry.cwd) === cwd);
  if (byCwd.length === 1) return byCwd[0].sessionId;
  if (!entries.length) throw new Error('no live pi-dish bridge sessions found; pass --session <id>');
  throw new Error(`could not identify this session; pass --session <id> (${entries.length} live sessions)`);
}

async function request(base, pathname, init) {
  const response = await fetch(new URL(pathname, base), init);
  let data;
  try { data = await response.json(); } catch { data = null; }
  if (!response.ok) throw new Error(data?.error || `HTTP ${response.status}`);
  return { data, status: response.status };
}

function jsonInit(body, headers = {}) {
  return { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body || {}) };
}

function print(value, json) {
  if (json) process.stdout.write(JSON.stringify(value, null, 2) + '\n');
  else if (typeof value === 'string') process.stdout.write(value + '\n');
  else process.stdout.write(JSON.stringify(value, null, 2) + '\n');
}

function sessionLine(session) {
  const state = session.isActive ? (session.turnInProgress || session.compacting ? 'working' : 'active') : 'inactive';
  return `${session.id}\t${state}\t${session.name || 'Unnamed'}\t${session.cwd || ''}`;
}

async function pollSpawn(base, spawnId, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await request(base, `/api/session-spawns/${encodeURIComponent(spawnId)}`);
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

  try {
    if (args.command === 'session' || args.command === 'self') {
      print(discoverSession(args.session), args.json);
      return;
    }

    if (args.command === 'list') {
      const qs = args.active ? '?active=1' : '';
      const { data } = await request(base, `/api/sessions${qs}`);
      if (args.json) return print(data, true);
      for (const session of [...(data.active || []), ...(data.previous || [])]) process.stdout.write(sessionLine(session) + '\n');
      if (data.indexing) process.stdout.write('# Session index is still building; repeat list for more.\n');
      if (data.discoveryTruncated) process.stdout.write('# Nested session discovery reached its safety limit.\n');
      return;
    }

    if (args.command === 'spawn') {
      const sourceSessionId = discoverSession(args.session);
      const body = { async: true, requestedBySessionId: sourceSessionId };
      if (args.cwd) body.cwd = args.cwd;
      if (args.model) body.model = args.model;
      const { data } = await request(base, '/api/sessions/new', jsonInit(body, { 'X-Pi-Dish-Session-Id': sourceSessionId }));
      if (args.no_wait) return print(data, args.json);
      const operation = await pollSpawn(base, data.spawnId);
      if (operation.status === 'error') throw new Error(operation.error || 'session spawn failed');
      const id = operation.sessionId;
      if (args.name) await request(base, `/api/sessions/${encodeURIComponent(id)}/rename`, jsonInit({ name: args.name }));
      if (args.prompt) await request(base, `/api/sessions/${encodeURIComponent(id)}/prompt`, jsonInit({ message: args.prompt }));
      return print({ ...operation, spawnId: data.spawnId, sessionId: id }, args.json);
    }

    const id = args.positional.shift();
    if (!id) throw new Error(`${args.command} needs a target session id`);

    if (args.command === 'related') {
      const { data } = await request(base, `/api/sessions/${encodeURIComponent(id)}/related`);
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
        request(base, '/api/sessions'),
        request(base, `/api/sessions/${encodeURIComponent(id)}/messages?limit=${limit}`),
      ]);
      const session = [...(lists.data.active || []), ...(lists.data.previous || [])].find(item => item.id === id) || null;
      return print({ session, ...messages.data }, true);
    }

    if (args.command === 'send' || args.command === 'prompt' || args.command === 'steer' || args.command === 'follow-up') {
      const message = args.positional.join(' ').trim();
      if (!message) throw new Error(`${args.command} needs message text`);
      const route = args.command === 'steer' ? 'steer' : args.command === 'follow-up' ? 'follow-up' : 'prompt';
      const { data } = await request(base, `/api/sessions/${encodeURIComponent(id)}/${route}`, jsonInit({ message }));
      return print(data, args.json);
    }

    const route = args.command === 'interrupt' || args.command === 'abort' ? 'abort'
      : args.command === 'resume' ? 'resume'
        : args.command === 'close' || args.command === 'terminate' ? 'close' : null;
    if (!route) throw new Error(`unknown command: ${args.command}`);
    const { data } = await request(base, `/api/sessions/${encodeURIComponent(id)}/${route}`, jsonInit({}));
    print(data, args.json);
  } catch (e) {
    fail(e.message);
  }
}

main();
