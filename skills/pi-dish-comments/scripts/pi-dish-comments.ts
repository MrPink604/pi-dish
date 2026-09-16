#!/usr/bin/env node
'use strict';
/**
 * pi-dish-comments — read and acknowledge the anchored review comments the
 * user left for this session in the pi-dish UI.
 *
 * The plumbing (session discovery, HTTP) lives in
 * skills/lib/pi-dish-client.js. Skills are installed by symlinking each skill
 * directory into ~/.pi/agent/skills/, and Node resolves requires through the
 * realpath, so this relative path reaches the pi-dish repo's own copy even
 * when invoked through the link.
 */
import path = require('node:path');

let core: typeof import('../../lib/pi-dish-client.js');
try {
  core = require(path.join(__dirname, '..', '..', 'lib', 'pi-dish-client.js'));
} catch (e) {
  process.stderr.write(
    'pi-dish-comments: could not load the shared pi-dish client library '
    + `(${e instanceof Error && e.message ? e.message : e}).\n`
    + 'Install the skills by symlinking the skill directories from the pi-dish repo '
    + '(run ./install.sh in the pi-dish checkout) so this script sits next to skills/lib/.\n',
  );
  process.exit(1);
}

const { makeFail, defaultBase, discoverSession, request, jsonInit } = core;
const fail = makeFail('pi-dish-comments');

interface CommentArgs {
  command: string;
  ids: string[];
  json?: boolean;
  session?: string;
  url?: string;
}
interface CommentAnchor {
  startLine?: unknown; endLine?: unknown;
  oldStart?: unknown; oldEnd?: unknown;
  newStart?: unknown; newEnd?: unknown;
  quote?: unknown;
}
interface CommentTarget {
  kind?: unknown; relPath?: unknown; path?: unknown;
  repo?: unknown; title?: unknown; root?: unknown; anchor?: unknown;
}
interface CommentResult {
  comments?: unknown; missing?: unknown; total?: unknown; hasMore?: unknown;
}
interface Comment {
  id?: unknown; body?: unknown; bodyPreview?: unknown; target?: unknown;
}
function commentsIn(result: CommentResult): unknown[] {
  if (!Array.isArray(result.comments)) throw new TypeError('comments must be an array');
  return result.comments;
}

function parseArgs(argv: string[]): CommentArgs {
  const args: CommentArgs = { command: argv[0] || 'list', ids: [] };
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

function lineLabel(value: unknown) {
  const anchor: CommentAnchor = core.record(value);
  if (!value) return '';
  if (anchor.startLine) return `:${anchor.startLine}${Number(anchor.endLine) > Number(anchor.startLine) ? `-${anchor.endLine}` : ''}`;
  const oldPart = anchor.oldStart ? `old ${anchor.oldStart}${Number(anchor.oldEnd) > Number(anchor.oldStart) ? `-${anchor.oldEnd}` : ''}` : '';
  const newPart = anchor.newStart ? `new ${anchor.newStart}${Number(anchor.newEnd) > Number(anchor.newStart) ? `-${anchor.newEnd}` : ''}` : '';
  return [oldPart, newPart].filter(Boolean).join(', ');
}

function targetLabel(value: unknown) {
  const target: CommentTarget = core.record(value);
  if (target.kind === 'file') return `${target.relPath || target.path}${lineLabel(target.anchor)}`;
  if (target.kind === 'diff') return `${target.repo}/${target.path} (${lineLabel(target.anchor) || 'diff'})`;
  if (!target.title && typeof target.root !== 'string') throw new TypeError('page root must be a string');
  return `${target.title || path.basename(typeof target.root === 'string' ? target.root : '')} (${target.root})`;
}

function printBatch(value: unknown) {
  const result: CommentResult = core.record(value);
  const comments = commentsIn(result);
  if (!comments.length) {
    process.stdout.write('No open pi-dish comments.\n');
    return;
  }
  for (const value of comments) {
    const comment: Comment = core.record(value);
    const target: CommentTarget = core.record(comment.target);
    const anchor: CommentAnchor = core.record(target.anchor);
    const quote = anchor.quote || '';
    if (typeof quote !== 'string' || typeof comment.body !== 'string') throw new TypeError('comment text must be a string');
    process.stdout.write(`[${comment.id}] ${target.kind}: ${targetLabel(comment.target)}\n`);
    if (quote) process.stdout.write(quote.split('\n').map((line) => `  > ${line}`).join('\n') + '\n');
    process.stdout.write(`  ${comment.body.replace(/\n/g, '\n  ')}\n\n`);
  }
  if (Array.isArray(result.missing)) {
    process.stdout.write(`${comments.length} selected comments shown.\n`);
  } else {
    process.stdout.write(`${comments.length} shown, ${result.total} open${result.hasMore ? ' (more pending)' : ''}.\n`);
  }
}

function printIndex(value: unknown) {
  const result: CommentResult = core.record(value);
  const comments = commentsIn(result);
  if (!comments.length) {
    process.stdout.write('No open pi-dish comments.\n');
    return;
  }
  for (const value of comments) {
    const comment: Comment = core.record(value);
    const target: CommentTarget = core.record(comment.target);
    const preview = String(comment.bodyPreview || '').replace(/\s+/g, ' ').trim();
    process.stdout.write(`[${comment.id}] ${target.kind}: ${targetLabel(comment.target)}${preview ? ` — ${preview}` : ''}\n`);
  }
  process.stdout.write(`${result.total} open comments indexed. Use get <id> [<id> ...] for any inferred group.\n`);
}

async function main() {
  let args;
  try { args = parseArgs(process.argv.slice(2)); } catch (error) { return fail(core.errorMessage(error)); }
  const base = defaultBase(args.url);
  let sessionId;
  try { sessionId = discoverSession(args.session); } catch (error) { return fail(core.errorMessage(error)); }

  try {
    if (args.command === 'session') {
      process.stdout.write(String(sessionId) + '\n');
      return;
    }
    if (args.command === 'list') {
      const { data: result } = await request(base, `/api/comments/index?sessionId=${encodeURIComponent(String(sessionId))}`);
      if (args.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      else printIndex(result);
      return;
    }
    if (args.command === 'get') {
      if (!args.ids.length) throw new Error('get needs at least one comment id');
      const { data: result } = await request(base, '/api/comments/get', jsonInit({ sessionId, ids: args.ids }));
      if (args.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      else {
        printBatch(result);
        const missing = core.record(result).missing;
        if (Array.isArray(missing) && missing.length) process.stdout.write(`Unavailable or closed: ${missing.join(', ')}\n`);
      }
      return;
    }
    if (args.command === 'count') {
      const { data: result } = await request(base, `/api/comments/count?sessionId=${encodeURIComponent(String(sessionId))}`);
      if (args.json) process.stdout.write(JSON.stringify(result, null, 2) + '\n');
      else process.stdout.write(String(core.record(result).total) + '\n');
      return;
    }
    if (args.command === 'ack') {
      if (!args.ids.length) throw new Error('ack needs at least one comment id');
      const acknowledged = [];
      for (const id of args.ids) {
        await request(base, `/api/comments/${encodeURIComponent(id)}/ack`, jsonInit({ sessionId }));
        acknowledged.push(id);
      }
      if (args.json) process.stdout.write(JSON.stringify({ acknowledged }, null, 2) + '\n');
      else process.stdout.write(`Acknowledged ${acknowledged.join(', ')}\n`);
      return;
    }
    throw new Error(`unknown command: ${args.command} (use list, get, ack, count, or session)`);
  } catch (error) {
    fail(core.errorMessage(error));
  }
}

main();
