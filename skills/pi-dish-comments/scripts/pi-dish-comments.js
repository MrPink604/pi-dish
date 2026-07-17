#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

function fail(message) {
  process.stderr.write(`pi-dish-comments: ${message}\n`);
  process.exitCode = 1;
}

function parseArgs(argv) {
  const args = { command: argv[0] || 'list', ids: [] };
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--json') args.json = true;
    else if (arg === '--session') args.session = argv[++i];
    else if (arg === '--url') args.url = argv[++i];
    else if (arg.startsWith('-')) throw new Error(`unknown option: ${arg}`);
    else args.ids.push(arg);
  }
  return args;
}

function parentPid(pid) {
  try {
    const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const match = stat.match(/^\d+ \([\s\S]*\) \S (\d+) /);
    return match ? Number(match[1]) : null;
  } catch {
    // macOS has no /proc; keep the same discovery contract via ps without
    // involving a shell. (The cwd fallback below still works if ps is absent.)
    try {
      const value = execFileSync('ps', ['-o', 'ppid=', '-p', String(pid)], { encoding: 'utf8' }).trim();
      return /^\d+$/.test(value) ? Number(value) : null;
    } catch {
      return null;
    }
  }
}

function ancestorPids() {
  const result = new Set();
  let pid = process.pid;
  while (pid && !result.has(pid)) {
    result.add(pid);
    pid = parentPid(pid);
  }
  return result;
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function registryEntries() {
  const dir = path.join(os.homedir(), '.pi', 'dish', 'sessions');
  let names;
  try { names = fs.readdirSync(dir); } catch { return []; }
  return names.filter((name) => name.endsWith('.json')).flatMap((name) => {
    try {
      const entry = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      if (!entry?.sessionId) return [];
      // Mirror the server's scanRegistry liveness rules (minus its pruning
      // side effects — this CLI only reads): a crashed pi leaves its entry
      // behind, and a dead session must not win cwd fallback or inflate the
      // "N live sessions" count in the ambiguity error.
      if (entry.socketPath && !fs.existsSync(entry.socketPath)) return [];
      if (Number.isInteger(entry.pid) && !pidAlive(entry.pid)) return [];
      return [entry];
    } catch {
      return [];
    }
  });
}

function discoverSession(explicit) {
  if (explicit) return explicit;
  if (process.env.PI_DISH_SESSION_ID) return process.env.PI_DISH_SESSION_ID;
  const entries = registryEntries();
  const ancestors = ancestorPids();
  const byPid = entries.filter((entry) => Number.isInteger(entry.pid) && ancestors.has(entry.pid));
  if (byPid.length === 1) return byPid[0].sessionId;
  if (byPid.length > 1) {
    byPid.sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
    return byPid[0].sessionId;
  }
  const cwd = path.resolve(process.cwd());
  const byCwd = entries.filter((entry) => entry.cwd && path.resolve(entry.cwd) === cwd);
  if (byCwd.length === 1) return byCwd[0].sessionId;
  if (!entries.length) throw new Error('no live pi-dish bridge sessions found');
  throw new Error(`could not identify this session; pass --session <id> (${entries.length} live sessions)`);
}

async function request(base, pathname, init) {
  const response = await fetch(new URL(pathname, base), init);
  let result;
  try { result = await response.json(); } catch { result = null; }
  if (!response.ok) throw new Error(result?.error || `HTTP ${response.status}`);
  return result;
}

function lineLabel(anchor) {
  if (!anchor) return '';
  if (anchor.startLine) return `:${anchor.startLine}${anchor.endLine > anchor.startLine ? `-${anchor.endLine}` : ''}`;
  const oldPart = anchor.oldStart ? `old ${anchor.oldStart}${anchor.oldEnd > anchor.oldStart ? `-${anchor.oldEnd}` : ''}` : '';
  const newPart = anchor.newStart ? `new ${anchor.newStart}${anchor.newEnd > anchor.newStart ? `-${anchor.newEnd}` : ''}` : '';
  return [oldPart, newPart].filter(Boolean).join(', ');
}

function targetLabel(target) {
  if (target.kind === 'file') return `${target.relPath || target.path}${lineLabel(target.anchor)}`;
  if (target.kind === 'diff') return `${target.repo}/${target.path} (${lineLabel(target.anchor) || 'diff'})`;
  return `${target.title || path.basename(target.root)} (${target.root})`;
}

function printBatch(result) {
  if (!result.comments.length) {
    process.stdout.write('No open pi-dish comments.\n');
    return;
  }
  for (const comment of result.comments) {
    const quote = comment.target.anchor?.quote || '';
    process.stdout.write(`[${comment.id}] ${comment.target.kind}: ${targetLabel(comment.target)}\n`);
    if (quote) process.stdout.write(quote.split('\n').map((line) => `  > ${line}`).join('\n') + '\n');
    process.stdout.write(`  ${comment.body.replace(/\n/g, '\n  ')}\n\n`);
  }
  if (Array.isArray(result.missing)) {
    process.stdout.write(`${result.comments.length} selected comments shown.\n`);
  } else {
    process.stdout.write(`${result.comments.length} shown, ${result.total} open${result.hasMore ? ' (more pending)' : ''}.\n`);
  }
}

function printIndex(result) {
  if (!result.comments.length) {
    process.stdout.write('No open pi-dish comments.\n');
    return;
  }
  for (const comment of result.comments) {
    const preview = String(comment.bodyPreview || '').replace(/\s+/g, ' ').trim();
    process.stdout.write(`[${comment.id}] ${comment.target.kind}: ${targetLabel(comment.target)}${preview ? ` — ${preview}` : ''}\n`);
  }
  process.stdout.write(`${result.total} open comments indexed. Use get <id> [<id> ...] for any inferred group.\n`);
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (error) { return fail(error.message); }
  const base = args.url || process.env.PI_DISH_URL || 'http://127.0.0.1:3333';
  let sessionId;
  try { sessionId = discoverSession(args.session); } catch (error) { return fail(error.message); }

  try {
    if (args.command === 'session') {
      process.stdout.write(sessionId + '\n');
      return;
    }
    if (args.command === 'list') {
      const result = await request(base, `/api/comments/index?sessionId=${encodeURIComponent(sessionId)}`);
      if (args.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      else printIndex(result);
      return;
    }
    if (args.command === 'get') {
      if (!args.ids.length) throw new Error('get needs at least one comment id');
      const result = await request(base, '/api/comments/get', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, ids: args.ids }),
      });
      if (args.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      else {
        printBatch(result);
        if (result.missing?.length) process.stdout.write(`Unavailable or closed: ${result.missing.join(', ')}\n`);
      }
      return;
    }
    if (args.command === 'count') {
      const result = await request(base, `/api/comments/count?sessionId=${encodeURIComponent(sessionId)}`);
      if (args.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      else process.stdout.write(String(result.total) + '\n');
      return;
    }
    if (args.command === 'ack') {
      if (!args.ids.length) throw new Error('ack needs at least one comment id');
      const acknowledged = [];
      for (const id of args.ids) {
        await request(base, `/api/comments/${encodeURIComponent(id)}/ack`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId }),
        });
        acknowledged.push(id);
      }
      if (args.json) process.stdout.write(JSON.stringify({ acknowledged }, null, 2) + '\n');
      else process.stdout.write(`Acknowledged ${acknowledged.join(', ')}\n`);
      return;
    }
    throw new Error(`unknown command: ${args.command} (use list, get, ack, count, or session)`);
  } catch (error) {
    fail(error.message);
  }
}

main();
