#!/usr/bin/env node
// Generated edge from skills/pi-dish-comments/scripts/pi-dish-comments.ts; edit that source and run npm run build:edges.
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Read and acknowledge the anchored review comments the user left for this
 * session in the pi-dish UI. Plumbing is skills/lib.
 */
const path = require("node:path");
let core;
try {
    core = require(path.join(__dirname, '..', '..', 'lib', 'pi-dish-client.js'));
}
catch (e) {
    process.stderr.write(`pi-dish-comments: could not load the shared pi-dish client library (${e instanceof Error && e.message ? e.message : e}).\n`
        + 'Install the skills by symlinking the skill directories from the pi-dish repo '
        + '(run ./install.sh in the pi-dish checkout) so this script sits next to skills/lib/.\n');
    process.exit(1);
}
const { makeFail, defaultBase, discoverSession, request, jsonInit, parseCommandLine, print } = core;
const fail = makeFail('pi-dish-comments');
function commentsIn(result) {
    if (!Array.isArray(result.comments))
        throw new TypeError('comments must be an array');
    return result.comments;
}
function lineLabel(value) {
    if (!value)
        return '';
    const anchor = core.record(value);
    if (anchor.startLine)
        return `:${anchor.startLine}${Number(anchor.endLine) > Number(anchor.startLine) ? `-${anchor.endLine}` : ''}`;
    const oldPart = anchor.oldStart ? `old ${anchor.oldStart}${Number(anchor.oldEnd) > Number(anchor.oldStart) ? `-${anchor.oldEnd}` : ''}` : '';
    const newPart = anchor.newStart ? `new ${anchor.newStart}${Number(anchor.newEnd) > Number(anchor.newStart) ? `-${anchor.newEnd}` : ''}` : '';
    return [oldPart, newPart].filter(Boolean).join(', ');
}
function targetLabel(value) {
    const target = core.record(value);
    if (target.kind === 'file')
        return `${target.relPath || target.path}${lineLabel(target.anchor)}`;
    if (target.kind === 'diff')
        return `${target.repo}/${target.path} (${lineLabel(target.anchor) || 'diff'})`;
    if (!target.title && typeof target.root !== 'string')
        throw new TypeError('page root must be a string');
    return `${target.title || path.basename(typeof target.root === 'string' ? target.root : '')} (${target.root})`;
}
function printBatch(value) {
    const result = core.record(value);
    const comments = commentsIn(result);
    if (!comments.length) {
        process.stdout.write('No open pi-dish comments.\n');
        return;
    }
    for (const value of comments) {
        const comment = core.record(value);
        const target = core.record(comment.target);
        const anchor = core.record(target.anchor ?? {});
        const quote = anchor.quote || '';
        if (typeof quote !== 'string' || typeof comment.body !== 'string')
            throw new TypeError('comment text must be a string');
        process.stdout.write(`[${comment.id}] ${target.kind}: ${targetLabel(comment.target)}\n`);
        if (quote)
            process.stdout.write(quote.split('\n').map((line) => `  > ${line}`).join('\n') + '\n');
        process.stdout.write(`  ${comment.body.replace(/\n/g, '\n  ')}\n\n`);
    }
    if (Array.isArray(result.missing)) {
        process.stdout.write(`${comments.length} selected comments shown.\n`);
    }
    else {
        process.stdout.write(`${comments.length} shown, ${result.total} open${result.hasMore ? ' (more pending)' : ''}.\n`);
    }
}
function printIndex(value) {
    const result = core.record(value);
    const comments = commentsIn(result);
    if (!comments.length) {
        process.stdout.write('No open pi-dish comments.\n');
        return;
    }
    for (const value of comments) {
        const comment = core.record(value);
        const target = core.record(comment.target);
        const preview = String(comment.bodyPreview || '').replace(/\s+/g, ' ').trim();
        process.stdout.write(`[${comment.id}] ${target.kind}: ${targetLabel(comment.target)}${preview ? ` — ${preview}` : ''}\n`);
    }
    process.stdout.write(`${result.total} open comments indexed. Use get <id> [<id> ...] for any inferred group.\n`);
}
async function main() {
    try {
        const args = parseCommandLine(process.argv.slice(2), 'list');
        const base = defaultBase(args.url);
        const sessionId = discoverSession(args.session);
        const ids = args.positional;
        if (args.command === 'session') {
            print(String(sessionId));
            return;
        }
        if (args.command === 'list') {
            const { data: result } = await request(base, `/api/comments/index?sessionId=${encodeURIComponent(String(sessionId))}`);
            if (args.json)
                print(result, true);
            else
                printIndex(result);
            return;
        }
        if (args.command === 'get') {
            if (!ids.length)
                throw new Error('get needs at least one comment id');
            const { data: result } = await request(base, '/api/comments/get', jsonInit({ sessionId, ids }));
            if (args.json)
                print(result, true);
            else {
                printBatch(result);
                const missing = core.record(result).missing;
                if (Array.isArray(missing) && missing.length)
                    process.stdout.write(`Unavailable or closed: ${missing.join(', ')}\n`);
            }
            return;
        }
        if (args.command === 'count') {
            const { data: result } = await request(base, `/api/comments/count?sessionId=${encodeURIComponent(String(sessionId))}`);
            if (args.json)
                print(result, true);
            else
                print(String(core.record(result).total));
            return;
        }
        if (args.command === 'ack') {
            if (!ids.length)
                throw new Error('ack needs at least one comment id');
            for (const id of ids)
                await request(base, `/api/comments/${encodeURIComponent(id)}/ack`, jsonInit({ sessionId }));
            if (args.json)
                print({ acknowledged: ids }, true);
            else
                process.stdout.write(`Acknowledged ${ids.join(', ')}\n`);
            return;
        }
        throw new Error(`unknown command: ${args.command} (use list, get, ack, count, or session)`);
    }
    catch (error) {
        fail(core.errorMessage(error));
    }
}
main();
