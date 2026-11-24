#!/usr/bin/env node
// Generated edge from skills/pi-dish-review/scripts/pi-dish-review.ts; edit that source and run npm run build:edges.
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Ask the user for decisions as a review deck shown inline in this session's
 * pi-dish transcript, and (by default) wait for the answers. The CLI talks
 * only to its own host on loopback; the deck is stored there and reached from
 * any hub through its /hosts proxy. Plumbing is skills/lib.
 */
const fs = require("node:fs");
const path = require("node:path");
const promises_1 = require("node:timers/promises");
let core;
try {
    core = require(path.join(__dirname, '..', '..', 'lib', 'pi-dish-client.js'));
}
catch (e) {
    process.stderr.write(`pi-dish-review: could not load the shared pi-dish client library (${e instanceof Error && e.message ? e.message : e}).\n`
        + 'Install the skills by symlinking the skill directories from the pi-dish repo '
        + '(run ./install.sh in the pi-dish checkout) so this script sits next to skills/lib/.\n');
    process.exit(1);
}
const { makeFail, defaultBase, discoverSession, request, jsonInit, parseCommandLine, record, errorMessage, errorStatus, errorBody } = core;
const fail = makeFail('pi-dish-review');
const USAGE = `pi-dish-review — ask the user for decisions as cards inline in this session's pi-dish transcript.

Usage: pi-dish-review ask <file.json|-> [--wait | --no-wait] [--timeout SECS]
       pi-dish-review wait <reviewId> [--timeout SECS]
       pi-dish-review answers <reviewId>
       pi-dish-review cancel <reviewId>

Flags:
  --wait           block until the user answers and print the answers (default,
                   unless the deck says "wait": false)
  --no-wait        post the deck and return; the answers arrive later in this
                   session as a "[review response: …]" message
  --timeout SECS   stop waiting after SECS; the deck stays open and the answers
                   then arrive as a message
  --json           print raw JSON
  --session ID     this caller's session id, when discovery cannot infer it
  --url URL        pi-dish base URL (default $PI_DISH_URL, else http://127.0.0.1:3333)

Deck format (hard limits: 1-6 cards, 1-3 questions and 0-4 shots per card,
context <= 500 characters):
  { "title": "…", "companionPage": "/page/<token>", "cards": [
    { "id": "mags", "title": "Magazines (2 of 4)", "context": "One short paragraph.",
      "media": [{ "src": "shots/mag-a.png", "label": "5.1 tab" }],
      "questions": [
        { "id": "quick_mag", "type": "choice", "prompt": "Quick Magazine shape?",
          "options": [{ "value": "tab", "label": "5.1 tab", "description": "Steel box" }, "vial"],
          "default": "tab", "why": "Reads at a glance" } ] } ] }
Question types: choice, multi (default is a list), approve (default "approve"
or "revise"), text. Shots are image files this session can reach, /page/<token>/…
paths, or https URLs. See skills/pi-dish-review/SKILL.md.`;
function reviewsPath(sessionId, rest = '') {
    return `/api/sessions/${encodeURIComponent(String(sessionId))}/reviews${rest}`;
}
function staleHost(error) {
    return errorStatus(error) === 404 && !errorBody(error).error;
}
function print(value, json, text) {
    process.stdout.write(json ? JSON.stringify(value, null, 2) + '\n' : text + '\n');
}
function readSpec(source) {
    const text = source === '-' ? fs.readFileSync(0, 'utf8') : fs.readFileSync(path.resolve(source), 'utf8');
    try {
        return JSON.parse(text);
    }
    catch (error) {
        throw new Error(`${source} is not valid JSON: ${errorMessage(error)}`);
    }
}
/** Long-polls until the review is answered or withdrawn; null once `timeoutSecs` pass with it still open. */
async function waitFor(base, sessionId, reviewId, timeoutSecs) {
    const deadline = timeoutSecs === null ? Infinity : Date.now() + timeoutSecs * 1000;
    let failures = 0;
    for (;;) {
        const remaining = deadline - Date.now();
        if (remaining <= 0)
            return null;
        const poll = Math.max(1, Math.min(50, Math.ceil(remaining / 1000)));
        try {
            const { data } = await request(base, reviewsPath(sessionId, `/${encodeURIComponent(reviewId)}/wait?timeout=${poll}`));
            failures = 0;
            const result = record(record(data ?? {}).result ?? {});
            if (result.status !== 'open')
                return result;
        }
        catch (error) {
            // A restarting pi-dish refuses connections for a few seconds; a 4xx is final.
            const status = errorStatus(error);
            if (typeof status === 'number' && status >= 400 && status < 500)
                throw error;
            if (++failures > 30)
                throw error;
            await (0, promises_1.setTimeout)(2000);
        }
    }
}
function answeredText(result) {
    if (result.status === 'cancelled')
        return `review ${result.reviewId} was withdrawn; it has no answers.`;
    const delivery = record(result.delivery ?? {});
    const also = delivery.via === 'message' ? '\n(These answers were also sent to this session as a "[review response: …]" message.)' : '';
    return `${JSON.stringify(result, null, 2)}${also}`;
}
const OPEN_LATER = 'the deck stays open in the transcript; the answers will arrive in this session as a "[review response: …]" message. '
    + 'Do not ask these questions again in chat.';
async function main() {
    const argv = process.argv.slice(2);
    if (!argv.length || argv.includes('--help') || argv.includes('-h') || argv[0] === 'help')
        return void process.stdout.write(USAGE + '\n');
    const hasWait = argv.includes('--wait');
    const hasNoWait = argv.includes('--no-wait');
    if (hasWait && hasNoWait)
        return fail('--wait and --no-wait cannot be used together');
    const waitFlag = hasWait ? true : hasNoWait ? false : null;
    // `-` (stdin) is a positional the shared parser would take for an option.
    const fromStdin = argv.slice(1).includes('-');
    let args;
    try {
        args = parseCommandLine(argv.filter((arg, index) => arg !== '--wait' && arg !== '--no-wait' && !(index > 0 && arg === '-')), 'ask', ['timeout']);
    }
    catch (error) {
        return fail(errorMessage(error));
    }
    const timeout = args.values.timeout === undefined ? null : Number(args.values.timeout);
    if (timeout !== null && !(Number.isFinite(timeout) && timeout > 0))
        return fail('--timeout must be a positive number of seconds');
    let sessionId;
    try {
        sessionId = discoverSession(args.session);
    }
    catch (error) {
        return fail(errorMessage(error));
    }
    const base = defaultBase(args.url);
    const target = fromStdin ? '-' : args.positional[0];
    if (args.command === 'ask') {
        if (!target)
            return fail('ask needs a deck file (or - for stdin)');
        let spec;
        try {
            spec = readSpec(target);
        }
        catch (error) {
            return fail(errorMessage(error));
        }
        if (!spec || typeof spec !== 'object' || Array.isArray(spec))
            return fail('the review must be a JSON object with "title" and "cards"');
        const deck = record(spec);
        const wait = waitFlag ?? deck.wait !== false;
        let review;
        try {
            const { data } = await request(base, reviewsPath(sessionId), jsonInit({ ...deck, wait }));
            review = record(record(data ?? {}).review ?? {});
        }
        catch (error) {
            if (staleHost(error))
                return fail('this pi-dish predates review decks (no reviewsV1); update pi-dish, or ask in chat');
            const errors = errorBody(error).errors;
            if (Array.isArray(errors))
                return fail(`the review was refused; fix and post again:\n${errors.map(line => `  - ${line}`).join('\n')}`);
            return fail(`could not post the review: ${errorMessage(error)}`);
        }
        const cards = Array.isArray(review.cards) ? review.cards.length : 0;
        const page = typeof review.companionPage === 'string' ? ` Full detail: ${review.companionPage}` : '';
        const summary = `Review "${review.title}" (${review.id}): ${cards} card${cards === 1 ? '' : 's'} for the user, inline in this session's pi-dish transcript.${page}`;
        if (!wait) {
            return print(review, args.json, `${summary}\nThe answers arrive in this session as a "[review response: …]" message. End your turn now; do not repeat the questions in chat.`);
        }
        if (!args.json)
            process.stdout.write(`${summary}\nWaiting for the answers…\n`);
        let result;
        try {
            result = await waitFor(base, sessionId, String(review.id), timeout);
        }
        catch (error) {
            return fail(`stopped waiting for ${review.id} (${errorMessage(error)}); ${OPEN_LATER}`);
        }
        if (!result)
            return print({ reviewId: review.id, status: 'open' }, args.json, `No answer within ${timeout} s: ${OPEN_LATER}`);
        return print(result, args.json, answeredText(result));
    }
    if (args.command !== 'wait' && args.command !== 'answers' && args.command !== 'cancel') {
        return fail(`unknown command: ${args.command} (use ask, wait, answers or cancel; run --help for usage)`);
    }
    if (!target)
        return fail(`${args.command} needs a review id`);
    const item = reviewsPath(sessionId, `/${encodeURIComponent(target)}`);
    try {
        if (args.command === 'wait') {
            const result = await waitFor(base, sessionId, target, timeout);
            if (!result)
                return print({ reviewId: target, status: 'open' }, args.json, `No answer within ${timeout} s: ${OPEN_LATER}`);
            return print(result, args.json, answeredText(result));
        }
        if (args.command === 'answers') {
            const { data } = await request(base, item);
            const result = record(record(data ?? {}).result ?? {});
            return print(result, true, '');
        }
        const { data } = await request(base, `${item}/cancel`, jsonInit({}));
        const review = record(record(data ?? {}).review ?? {});
        return print(review, args.json, `review ${target} withdrawn.`);
    }
    catch (error) {
        if (staleHost(error))
            return fail('this pi-dish predates review decks (no reviewsV1); update pi-dish');
        return fail(`${args.command} ${target}: ${errorMessage(error)}`);
    }
}
main();
