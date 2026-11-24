// Generated test/tool from test/reviews.test.ts; edit that source and run npm run build:tests.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Review decks: the bounded format and its errors, answer checks, the
 * delivered message, and the server path end to end. A real server boots as a
 * child with a fake live pi bridge session, plus a hub that lists it as a
 * remote; the pi-dish-review CLI posts and waits as an agent would.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const node_child_process_1 = require("node:child_process");
const crypto = require("node:crypto");
const node_events_1 = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const test_types_js_1 = require("./test-types.js");
const test_env_js_1 = require("./test-env.js");
const sse_reader_js_1 = require("./sse-reader.js");
const reviews = require('../lib/reviews');
const reviewHandlersModule = require('../lib/review-handlers');
const sessionKey = require('../lib/session-key');
const SERVER = path.join(__dirname, '..', 'server.js');
const CLI = path.join(__dirname, '..', 'skills', 'pi-dish-review', 'scripts', 'pi-dish-review.js');
const SESSION_ID = '2026-11-23T09-00-00-review01';
const GRACE_MS = 1500;
// A 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
function choice(id, extra = {}) {
    return { id, type: 'choice', prompt: `Pick ${id}`, options: ['a', 'b', 'c'], default: 'a', ...extra };
}
function card(id, extra = {}) {
    return { id, title: `Card ${id}`, context: 'One short paragraph.', questions: [choice(`${id}_q`)], ...extra };
}
const DECK = {
    title: 'Halden part looks',
    cards: [
        card('mags', {
            media: [{ src: 'shots/mag.png', label: '5.1 tab' }],
            questions: [
                choice('quick_mag', { options: [{ value: 'tab', label: '5.1 tab', description: 'Steel box' }, 'vial'], default: 'tab', why: 'Reads at a glance' }),
                { id: 'finish', type: 'multi', prompt: 'Finishes?', options: ['brass', 'steel', 'black'], default: ['steel'] },
            ],
        }),
        card('sign', { questions: [
                { id: 'scope', type: 'approve', prompt: 'Scope sign-off', default: 'approve' },
                { id: 'notes', type: 'text', prompt: 'Anything else?' },
            ] }),
    ],
};
function validSpec(raw) {
    const checked = reviews.validateReviewSpec(raw);
    assert.ok('spec' in checked, JSON.stringify(checked));
    return checked.spec;
}
test('hard bounds are refused with where and how to split', () => {
    const tooMany = reviews.validateReviewSpec({ title: 'x', cards: Array.from({ length: 7 }, (_, index) => card(`c${index}`)) });
    assert.deepEqual(tooMany, { errors: ['cards has 7 items; max is 6 — ask fewer things now, or post a follow-up deck after these answers'] });
    const result = reviews.validateReviewSpec({ title: 'x', extra: 1, cards: [
            card('a', { questions: [choice('q1'), choice('q2'), choice('q3'), choice('q4')] }),
            card('b', { media: ['1.png', '2.png', '3.png', '4.png', '5.png'], context: 'x'.repeat(501) }),
            card('c', { questions: [{ id: 'r', type: 'rank', prompt: 'Rank' }, choice('a_q', { default: 'z' }), choice('b_q')] }),
        ] });
    assert.ok('errors' in result);
    assert.deepEqual(result.errors, [
        'the review has unknown key "extra" (allowed: title, companionPage, wait, cards)',
        'cards[0] ("a").questions has 4 items; max is 3 — split into separate cards or drop non-decisions',
        'cards[1] ("b").context is 501 characters; max is 500 — one short paragraph: what is being decided and what changes',
        'cards[1] ("b").media has 5 items; max is 4 — show only the shots the decision depends on; link the rest through companionPage',
        'cards[2] ("c").questions[0].type must be one of choice, multi, approve, text',
        'cards[2] ("c").questions[1] ("a_q").default must be one of the option values (a, b, c)',
        'cards[2] ("c").questions[2] ("b_q").id "b_q" is repeated',
    ]);
    const spec = validSpec(DECK);
    assert.equal(spec.wait, true);
    const [first] = spec.cards[0].questions;
    assert.ok(first.type === 'choice');
    assert.deepEqual(first.options[1], { value: 'vial', label: 'vial', description: null });
    assert.equal(first.allowOther, true);
});
test('answers are checked against the deck; defaults, other and notes are kept apart', () => {
    const spec = validSpec(DECK);
    const bad = reviews.validateReviewAnswers(spec, {
        quick_mag: { value: 'z' }, finish: { value: 'steel' }, scope: { value: 'yes', other: 'x' }, notes: { value: 'x', note: 'n' }, ghost: {},
    });
    assert.ok('errors' in bad);
    assert.deepEqual(bad.errors, [
        'unknown question "ghost"', '"quick_mag" must be one of tab, vial', '"finish" must be a list of brass, steel, black',
        '"scope" has unknown key "other" (allowed: value, note)', '"scope" must be "approve" or "revise"',
        '"notes" has unknown key "note" (allowed: value)',
    ]);
    const good = reviews.validateReviewAnswers(spec, {
        quick_mag: { value: null, other: 'A lit vial', note: 'drain the light as it empties' },
        finish: { value: ['black', 'steel'] }, scope: { value: 'approve' }, notes: { value: '  ' },
    });
    assert.deepEqual(good, { answers: {
            quick_mag: { value: null, default: false, note: 'drain the light as it empties', other: 'A lit vial' },
            finish: { value: ['steel', 'black'], default: false },
            scope: { value: 'approve', default: true },
            notes: { value: null, default: false },
        } });
    assert.deepEqual(reviews.changedQuestions(spec, 'answers' in good ? good.answers : {}), ['quick_mag', 'finish']);
});
test('the delivered message lists changes and notes first, summarizes defaults, keeps values with other and defuses OMP syntax', () => {
    const spec = validSpec(DECK);
    const checked = reviews.validateReviewAnswers(spec, {
        quick_mag: { value: 'vial', note: 'see @plan.md' },
        finish: { value: ['steel', 'black'], other: 'plus @grip', note: 'matte' },
        scope: { value: 'approve' },
        notes: { value: 'Warmer\ncrop' },
    });
    assert.ok('answers' in checked);
    const review = {
        id: 'rv_0123456789abcdef', sessionId: SESSION_ID, createdAt: 0, anchorMessageIndex: null, spec, media: [], assets: [], status: 'submitted',
        submission: { id: 'sub-00001', submittedAt: Date.UTC(2026, 10, 23, 10, 0, 0), answers: checked.answers, changed: ['quick_mag', 'finish'],
            delivery: { state: 'pending', via: null, at: null, error: null } },
    };
    const expected = [
        '[review response: Halden part looks (rv_0123456789abcdef), submitted 2026-11-23T10:00:00Z]',
        'quick_mag (default tab): vial',
        '  note: see @plan.md',
        'finish (default steel): steel, black',
        '  other: plus @grip',
        '  note: matte',
        'all other questions with a default: default',
        'notes: |',
        '  Warmer',
        '  crop',
        'full answer set: pi-dish-review answers rv_0123456789abcdef',
    ];
    assert.equal(reviews.formatReviewMessage(review, false), expected.join('\n'));
    const ompLines = reviews.formatReviewMessage(review, true).split('\n');
    assert.equal(ompLines[2], '  note: see \\@plan.md');
    assert.equal(ompLines[4], '  other: plus \\@grip');
    const otherOnly = reviews.validateReviewAnswers(spec, {
        quick_mag: { value: null, other: 'A lit vial' }, finish: { value: ['steel'] }, scope: { value: 'approve' },
    });
    assert.ok('answers' in otherOnly);
    const otherOnlyMsg = reviews.formatReviewMessage({
        ...review,
        submission: { ...review.submission, answers: otherOnly.answers, changed: ['quick_mag'] },
    }, false);
    assert.match(otherOnlyMsg, /\nquick_mag: other \(default tab\): A lit vial\n/);
});
// ---- the server ------------------------------------------------------------
const children = [];
const prompts = [];
let bridge = null;
test.after(() => {
    for (const child of children) {
        try {
            child.kill('SIGKILL');
        }
        catch { }
    }
    bridge?.close();
});
function freePort() {
    return new Promise((resolve, reject) => {
        const probe = net.createServer();
        probe.once('error', reject);
        probe.listen(0, '127.0.0.1', () => {
            const address = probe.address();
            if (!address || typeof address === 'string')
                return reject(new Error('Port probe lacks TCP address'));
            probe.close(error => error ? reject(error) : resolve(address.port));
        });
    });
}
// Polls real child processes and background delivery; there is no event to await across processes.
const pause = (ms) => new Promise(resolve => setTimeout(resolve, ms));
async function until(read, what, ms = 10_000) {
    const deadline = Date.now() + ms;
    for (;;) {
        const value = await read();
        if (value)
            return value;
        if (Date.now() > deadline)
            throw new Error(`timed out waiting for ${what}`);
        await pause(50);
    }
}
async function boot(home, port, extra = {}) {
    const env = { ...(0, test_env_js_1.sanitizeTestEnv)(), HOME: home, HOST: '127.0.0.1', PORT: String(port), TMUX_TMPDIR: path.join(home, 'tmux'), ...extra };
    fs.mkdirSync(path.join(home, 'tmux'), { recursive: true });
    const child = (0, node_child_process_1.spawn)(process.execPath, [SERVER], { env, stdio: ['ignore', 'ignore', 'pipe'] });
    children.push(child);
    let stderr = '';
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    const base = `http://127.0.0.1:${port}`;
    await until(async () => {
        if (child.exitCode !== null)
            throw new Error(`server exited (${child.exitCode}): ${stderr}`);
        try {
            return (await fetch(`${base}/api/host`)).ok;
        }
        catch {
            return false;
        }
    }, `the server on ${port}: ${stderr}`, 30_000);
    return { base, child };
}
async function json(response) {
    const text = await response.text();
    try {
        return (0, test_types_js_1.record)(JSON.parse(text));
    }
    catch {
        throw new Error(`not JSON (${response.status}): ${text.slice(0, 200)}`);
    }
}
const CLIENT_HEADER = { 'X-Pi-Dish-Client': '1' };
const post = (url, body, headers = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...CLIENT_HEADER, ...headers }, body: JSON.stringify(body) });
let home = '';
let ownerPort = 0;
let owner = '';
let ownerChild = null;
let hub = '';
const api = (base, rest = '') => `${base}/api/sessions/${SESSION_ID}/reviews${rest}`;
const viaHub = (rest = '') => `${hub}/hosts/owner/api/sessions/${SESSION_ID}/reviews${rest}`;
const ownerEnv = () => ({ PI_DISH_REVIEW_GRACE_MS: String(GRACE_MS) });
function cli(args, input, extraEnv = {}) {
    const child = (0, node_child_process_1.spawn)(process.execPath, [CLI, ...args], {
        env: { ...(0, test_env_js_1.sanitizeTestEnv)(), HOME: home, PI_DISH_URL: owner, PI_DISH_SESSION_ID: SESSION_ID, ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    children.push(child);
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });
    child.stdin?.end(input === undefined ? '' : JSON.stringify(input));
    const exited = new Promise(resolve => child.on('exit', code => resolve(code)));
    return { child, stdout: () => stdout, stderr: () => stderr, exited };
}
async function openReview(title) {
    return until(async () => {
        const listed = await json(await fetch(api(owner)));
        return listed.reviews.find(review => review.title === title && review.status === 'open') ?? null;
    }, `the open review "${title}"`);
}
async function settled(reviewId) {
    return until(async () => {
        const { review } = await json(await fetch(api(owner, `/${reviewId}`)));
        const state = (0, test_types_js_1.record)((0, test_types_js_1.record)((0, test_types_js_1.record)(review).submission ?? {}).delivery ?? {}).state;
        return state && state !== 'pending' && state !== 'delivering' ? (0, test_types_js_1.record)(review) : null;
    }, `the delivery of ${reviewId}`);
}
const DEFAULTS = { quick_mag: { value: 'tab' }, finish: { value: ['steel'] }, scope: { value: 'approve' } };
test('boot an owner host with a live session, and a hub that fronts it', async () => {
    home = (0, test_env_js_1.createTestTempDir)('pi-dish-reviews-');
    const cwd = path.join(home, 'project');
    fs.mkdirSync(path.join(cwd, 'shots'), { recursive: true });
    fs.writeFileSync(path.join(cwd, 'shots', 'mag.png'), PNG);
    fs.mkdirSync(path.join(home, 'outside'), { recursive: true });
    fs.writeFileSync(path.join(home, 'outside', 'secret.png'), PNG);
    fs.symlinkSync(path.join(home, 'outside', 'secret.png'), path.join(cwd, 'shots', 'link.png'));
    const sessions = path.join(home, '.pi', 'agent', 'sessions', 'project');
    fs.mkdirSync(sessions, { recursive: true });
    const sessionFile = path.join(sessions, `${SESSION_ID}.jsonl`);
    fs.writeFileSync(sessionFile, [
        { type: 'session', cwd, timestamp: '2026-11-23T09:00:00.000Z' },
        { type: 'message', message: { role: 'user', content: 'show me the magazines' } },
    ].map(entry => JSON.stringify(entry)).join('\n') + '\n');
    const socketPath = path.join(home, 'bridge.sock');
    bridge = net.createServer(socket => {
        socket.on('error', () => { });
        socket.write(JSON.stringify({ type: 'hello', turnInProgress: false, queue: { steering: [], followUp: [] } }) + '\n');
        let buffer = '';
        socket.on('data', chunk => {
            buffer += chunk;
            for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
                const message = (0, test_types_js_1.record)(JSON.parse(buffer.slice(0, end)));
                buffer = buffer.slice(end + 1);
                if (message.command === 'prompt')
                    prompts.push(String(message.message));
                const data = message.command === 'prompt' ? { queued: false, admitted: true }
                    : message.command === 'get_available_models' ? { models: [] } : message.command === 'get_commands' ? [] : {};
                socket.write(JSON.stringify({ type: 'response', id: message.id, success: true, data }) + '\n');
            }
        });
    });
    await new Promise(resolve => bridge.listen(socketPath, resolve));
    const registry = path.join(home, '.pi', 'dish', 'sessions');
    fs.mkdirSync(registry, { recursive: true });
    fs.writeFileSync(path.join(registry, `${SESSION_ID}.json`), JSON.stringify({
        sessionId: SESSION_ID, sessionFile, socketPath, pid: process.pid, cwd, name: 'Review fixture', capabilities: { followUpIfBusy: true },
    }));
    ownerPort = await freePort();
    const booted = await boot(home, ownerPort, ownerEnv());
    owner = booted.base;
    ownerChild = booted.child;
    const hubHome = (0, test_env_js_1.createTestTempDir)('pi-dish-reviews-hub-');
    fs.mkdirSync(path.join(hubHome, '.pi', 'dish'), { recursive: true });
    fs.writeFileSync(path.join(hubHome, '.pi', 'dish', 'settings.json'), JSON.stringify({ remotes: [{ name: 'owner', url: owner }] }));
    hub = (await boot(hubHome, await freePort())).base;
    assert.equal((0, test_types_js_1.record)((await json(await fetch(`${owner}/api/host`))).capabilities).reviewsV1, true);
});
test('media is served only from the session\'s reach, through the hub too', async () => {
    const outside = await post(api(owner), { ...DECK, cards: [card('x', { media: [path.join(home, 'outside', 'secret.png')] })] });
    assert.equal(outside.status, 400);
    assert.match(String((await json(outside)).error), /secret\.png.*not found among this session's files/);
    const linked = await post(api(owner), { ...DECK, cards: [card('x', { media: ['shots/link.png'] })] });
    assert.equal(linked.status, 400, 'a link inside the directory must not lead out of it');
    const notImage = await post(api(owner), { ...DECK, cards: [card('x', { media: ['shots/mag.txt'] })] });
    assert.match(String((await json(notImage)).error), /is not an image/);
    const noPage = await post(api(owner), { ...DECK, cards: [card('x', { media: ['/page/missing00000000/mag.png'] })] });
    assert.equal(noPage.status, 400);
    assert.match(String((await json(noPage)).error), /no page missing00000000 is published on this host/);
    const pageDir = path.join(home, 'project', 'shots');
    fs.writeFileSync(path.join(pageDir, 'index.html'), '<!doctype html><title>Shots</title>\n');
    const pubRes = await post(`${owner}/api/pages`, { path: pageDir, title: 'Shots' });
    assert.equal(pubRes.status, 200);
    const published = await json(pubRes);
    const pageShot = `/page/${String(published.token)}/mag.png`;
    const withPage = await post(api(owner), { ...DECK, title: 'Page media deck', wait: false, cards: [card('x', { media: [pageShot] })] });
    assert.equal(withPage.status, 201);
    const pageReview = (0, test_types_js_1.record)((await json(withPage)).review);
    assert.deepEqual((0, test_types_js_1.record)(pageReview.cards[0]).media[0], { label: null, alt: null, asset: null, url: pageShot });
    await post(api(owner, `/${pageReview.id}/cancel`), {});
    const events = (0, sse_reader_js_1.sseReader)(`${owner}/api/sessions/${SESSION_ID}/stream`);
    try {
        const created = await post(viaHub(), { ...DECK, title: 'Media deck', wait: false });
        assert.equal(created.status, 201);
        const review = (0, test_types_js_1.record)((await json(created)).review);
        const media = (0, test_types_js_1.record)((0, test_types_js_1.record)(review.cards[0]).media[0]);
        assert.deepEqual(media, { label: '5.1 tab', alt: null, asset: 0, url: null });
        assert.equal(review.anchorMessageIndex, 0);
        const update = await events.waitFor(event => event.event === 'review_updated');
        assert.equal((0, test_types_js_1.record)((0, test_types_js_1.record)(update.data).review).id, review.id);
        for (const url of [api(owner, `/${review.id}/media/0`), viaHub(`/${review.id}/media/0`)]) {
            const shot = await fetch(url);
            assert.equal(shot.status, 200, url);
            assert.equal(shot.headers.get('content-type'), 'image/png');
            assert.deepEqual(Buffer.from(await shot.arrayBuffer()), PNG);
        }
        assert.equal((await fetch(api(owner, `/${review.id}/media/1`))).status, 404);
        const cancelled = await json(await post(api(owner, `/${review.id}/cancel`), {}));
        assert.equal((0, test_types_js_1.record)(cancelled.review).status, 'cancelled');
    }
    finally {
        events.close();
    }
});
test('a waiting CLI gets the answers; the session gets no message', async () => {
    const before = prompts.length;
    const run = cli(['ask', '-'], { ...DECK, title: 'Waited deck' });
    const review = await openReview('Waited deck');
    const submitted = await post(viaHub(`/${review.id}/submit`), { submissionId: 'sub-wait-0001', answers: { ...DEFAULTS, quick_mag: { value: 'vial', note: 'lit' } } });
    assert.equal(submitted.status, 202);
    assert.equal(await run.exited, 0, run.stderr());
    const printed = (0, test_types_js_1.record)(JSON.parse(run.stdout().slice(run.stdout().indexOf('{'))));
    assert.deepEqual(printed.changedFromDefault, ['quick_mag']);
    assert.deepEqual((0, test_types_js_1.record)(printed.answers).quick_mag, { value: 'vial', default: false, note: 'lit' });
    assert.deepEqual((0, test_types_js_1.record)(printed.delivery), { state: 'delivered', via: 'waiter', at: (0, test_types_js_1.record)(printed.delivery).at, error: null });
    await pause(GRACE_MS + 300);
    assert.equal(prompts.length, before, 'no message when a waiter took the answers');
    const repeated = await post(api(owner, `/${review.id}/submit`), { submissionId: 'sub-wait-0001', answers: DEFAULTS });
    assert.equal(repeated.status, 200);
    assert.equal((await json(repeated)).repeated, true);
    const other = await post(api(owner, `/${review.id}/submit`), { submissionId: 'sub-wait-0002', answers: DEFAULTS });
    assert.equal(other.status, 409);
});
test('with no waiter the answers arrive as one message; a detached waiter gets the grace period first', async () => {
    const posted = cli(['ask', '-', '--no-wait'], { ...DECK, title: 'Async deck' });
    assert.equal(await posted.exited, 0, posted.stderr());
    assert.match(posted.stdout(), /Review "Async deck" \(rv_[0-9a-f]{16}\): 2 cards[\s\S]*\[review response: …\]/);
    const review = await openReview('Async deck');
    const before = prompts.length;
    assert.equal((await post(api(owner, `/${review.id}/submit`), { submissionId: 'sub-async-01', answers: DEFAULTS })).status, 202);
    const done = await settled(String(review.id));
    assert.deepEqual((0, test_types_js_1.record)((0, test_types_js_1.record)(done.submission).delivery).via, 'message');
    assert.equal(prompts.length, before + 1);
    assert.match(prompts[before], new RegExp(`^\\[review response: Async deck \\(${review.id}\\)[^\\n]*\\]\\nno changes from defaults\\nunanswered: notes\\nfull answer set: pi-dish-review answers ${review.id}$`));
    // The agent's CLI is killed mid-wait: an answer within the grace period waits for it to come back.
    const waited = cli(['ask', '-'], { ...DECK, title: 'Detached deck' });
    const detached = await openReview('Detached deck');
    await pause(200);
    waited.child.kill('SIGKILL');
    await waited.exited;
    await pause(100);
    const start = Date.now();
    await post(api(owner, `/${detached.id}/submit`), { submissionId: 'sub-detach-1', answers: DEFAULTS });
    await pause(GRACE_MS / 3);
    assert.equal(prompts.length, before + 1, 'held for a returning waiter');
    await settled(String(detached.id));
    assert.ok(Date.now() - start >= GRACE_MS - 400, 'delivered as a message only after the grace period');
    assert.equal(prompts.length, before + 2);
});
test('a refused deck lists every problem through the CLI', async () => {
    const run = cli(['ask', '-'], { title: 'Too big', cards: Array.from({ length: 7 }, (_, index) => card(`c${index}`)) });
    assert.equal(await run.exited, 1);
    assert.match(run.stderr(), /the review was refused; fix and post again:\n {2}- cards has 7 items; max is 6/);
});
test('answers survive a restart; one cut off before delivery is delivered once after it', async () => {
    const waited = cli(['ask', '-'], { ...DECK, title: 'Restart deck' });
    const review = await openReview('Restart deck');
    await pause(200);
    waited.child.kill('SIGKILL');
    await waited.exited;
    const before = prompts.length;
    assert.equal((await post(api(owner, `/${review.id}/submit`), { submissionId: 'sub-restart1', answers: DEFAULTS })).status, 202);
    ownerChild.kill('SIGKILL');
    await new Promise(resolve => ownerChild.once('exit', resolve));
    ownerChild = (await boot(home, ownerPort, ownerEnv())).child;
    const done = await settled(String(review.id));
    assert.equal((0, test_types_js_1.record)((0, test_types_js_1.record)(done.submission).delivery).via, 'message');
    await pause(300);
    assert.equal(prompts.filter(prompt => prompt.includes(String(review.id))).length, 1);
    assert.equal(prompts.length, before + 1);
    const answers = cli(['answers', String(review.id)]);
    assert.equal(await answers.exited, 0, answers.stderr());
    assert.equal((0, test_types_js_1.record)(JSON.parse(answers.stdout())).status, 'submitted');
    const repeated = await post(api(owner, `/${review.id}/submit`), { submissionId: 'sub-restart1', answers: DEFAULTS });
    assert.equal(repeated.status, 200);
    const stat = fs.statSync(path.join(home, '.pi', 'dish', 'reviews'));
    assert.equal(stat.mode & 0o077, 0, 'the store is owner-only');
});
test('CSRF header is required (and proxied), HEAD wait has no side effects, and submit caps body at 64 KiB', async () => {
    const rawPost = (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    // Create without X-Pi-Dish-Client is refused both directly and through the hub.
    assert.equal((await rawPost(api(owner), { ...DECK, title: 'No header', wait: false })).status, 403);
    assert.equal((await rawPost(viaHub(), { ...DECK, title: 'No header hub', wait: false })).status, 403);
    const created = await post(viaHub(), { ...DECK, title: 'CSRF deck', wait: true });
    assert.equal(created.status, 201);
    const reviewId = String((0, test_types_js_1.record)((await json(created)).review).id);
    // Missing header is refused on wait, submit, and cancel (directly and via hub) with zero side effects.
    assert.equal((await fetch(api(owner, `/${reviewId}/wait?timeout=1`))).status, 403);
    assert.equal((await fetch(viaHub(`/${reviewId}/wait?timeout=1`))).status, 403);
    assert.equal((await rawPost(api(owner, `/${reviewId}/submit`), { submissionId: 'sub-csrf-01', answers: DEFAULTS })).status, 403);
    assert.equal((await rawPost(viaHub(`/${reviewId}/submit`), { submissionId: 'sub-csrf-01', answers: DEFAULTS })).status, 403);
    assert.equal((await rawPost(api(owner, `/${reviewId}/cancel`), {})).status, 403);
    assert.equal((await rawPost(viaHub(`/${reviewId}/cancel`), {})).status, 403);
    assert.equal((0, test_types_js_1.record)((await json(await fetch(api(owner, `/${reviewId}`)))).review).status, 'open');
    // Oversized submit body (>64 KiB) is refused with 413 before validating answers.
    const huge = await post(api(owner, `/${reviewId}/submit`), { submissionId: 'sub-huge-01', answers: { notes: { value: 'x'.repeat(70 * 1024) } } });
    assert.equal(huge.status, 413);
    assert.equal((0, test_types_js_1.record)((await json(await fetch(api(owner, `/${reviewId}`)))).review).status, 'open');
    // HEAD on wait returns 405 and never claims a pending submission.
    const before = prompts.length;
    assert.equal((await post(viaHub(`/${reviewId}/submit`), { submissionId: 'sub-head-01', answers: DEFAULTS })).status, 202);
    const headDirect = await fetch(api(owner, `/${reviewId}/wait`), { method: 'HEAD', headers: CLIENT_HEADER });
    assert.equal(headDirect.status, 405);
    const headHub = await fetch(viaHub(`/${reviewId}/wait`), { method: 'HEAD', headers: CLIENT_HEADER });
    assert.equal(headHub.status, 405);
    const done = await settled(reviewId);
    assert.equal((0, test_types_js_1.record)((0, test_types_js_1.record)(done.submission).delivery).via, 'message', 'HEAD wait did not claim the pending submission');
    assert.equal(prompts.length, before + 1);
    // GET wait with X-Pi-Dish-Client passes through the /hosts hub proxy.
    const proxiedWait = await fetch(viaHub(`/${reviewId}/wait?timeout=1`), { headers: CLIENT_HEADER });
    assert.equal(proxiedWait.status, 200);
    assert.equal((0, test_types_js_1.record)((await json(proxiedWait)).result).status, 'submitted');
});
test('unknown or deleted sessions (including private) return 404; DELETE purges only the deleted route id', async () => {
    // Unknown session returns 404 on every review route.
    const ghost = '2026-11-23T09-00-00-ghost000';
    const ghostBase = `${owner}/api/sessions/${ghost}/reviews`;
    const fakeId = 'rv_0123456789abcdef';
    assert.equal((await fetch(ghostBase)).status, 404);
    assert.equal((await post(ghostBase, { ...DECK, wait: false })).status, 404);
    assert.equal((await fetch(`${ghostBase}/${fakeId}`)).status, 404);
    assert.equal((await fetch(`${ghostBase}/${fakeId}/wait?timeout=1`, { headers: CLIENT_HEADER })).status, 404);
    assert.equal((await post(`${ghostBase}/${fakeId}/submit`, { submissionId: 'sub-ghost-1', answers: DEFAULTS })).status, 404);
    assert.equal((await post(`${ghostBase}/${fakeId}/cancel`, {})).status, 404);
    assert.equal((await fetch(`${ghostBase}/${fakeId}/media/0`)).status, 404);
    // Private session: deleting its transcript must not expose its reviews without the PIN.
    const pinSet = await fetch(`${owner}/api/private-sessions/pin`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '4321' }),
    });
    assert.equal(pinSet.status, 200);
    const unlocked = await json(await fetch(`${owner}/api/private-sessions/unlock`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: '4321' }),
    }));
    const unlockHeader = { 'x-pi-dish-private-unlock': String(unlocked.token) };
    const privId = '2026-11-23T09-00-00-priv0001';
    const privDir = path.join(home, '.local', 'state', 'pi-dish', 'private-sessions', 'pi');
    fs.mkdirSync(privDir, { recursive: true, mode: 0o700 });
    const privFile = path.join(privDir, `${privId}.jsonl`);
    const cwd = path.join(home, 'project');
    fs.writeFileSync(privFile, JSON.stringify({ type: 'session', cwd, timestamp: '2026-11-23T09:00:00.000Z' }) + '\n');
    const privBase = `${owner}/api/sessions/${privId}/reviews`;
    const privCreated = await post(privBase, { ...DECK, title: 'Private deck', wait: false }, unlockHeader);
    assert.equal(privCreated.status, 201);
    const privReviewId = String((0, test_types_js_1.record)((await json(privCreated)).review).id);
    // Locked request is refused while the private transcript exists (session route and lookup route).
    assert.equal((await fetch(privBase)).status, 404);
    assert.equal((await fetch(`${privBase}/${privReviewId}/media/0`)).status, 404);
    assert.equal((await fetch(`${owner}/api/reviews/${privReviewId}`)).status, 404);
    assert.equal((await fetch(`${hub}/hosts/owner/api/reviews/${privReviewId}`)).status, 404);
    // Unlocked request can look up the private review by id.
    const privLookup = await fetch(`${owner}/api/reviews/${privReviewId}`, { headers: unlockHeader });
    assert.equal(privLookup.status, 200);
    assert.equal((0, test_types_js_1.record)((await json(privLookup)).review).sessionId, privId);
    // Even if the private file is removed on disk outside DELETE, every route still answers 404.
    fs.unlinkSync(privFile);
    assert.equal((await fetch(privBase)).status, 404);
    assert.equal((await fetch(`${privBase}/${privReviewId}`)).status, 404);
    assert.equal((await fetch(`${owner}/api/reviews/${privReviewId}`)).status, 404);
    assert.equal((await fetch(`${owner}/api/reviews/${privReviewId}`, { headers: unlockHeader })).status, 404);
    assert.equal((await fetch(`${privBase}/${privReviewId}/media/0`)).status, 404);
    assert.equal((await post(`${privBase}/${privReviewId}/submit`, { submissionId: 'sub-priv-01', answers: DEFAULTS })).status, 404);
    assert.equal((await post(`${privBase}/${privReviewId}/cancel`, {})).status, 404);
    assert.equal((await fetch(`${privBase}/${privReviewId}/wait?timeout=1`, { headers: CLIENT_HEADER })).status, 404);
    // Permanent DELETE /api/sessions/:id purges the deleted parent's reviews, and does not touch a
    // surviving top-level session whose id a deleted child claimed.
    const parentNative = 'omp-review-parent-01';
    const survivorNative = 'omp-review-survivor-01';
    assert.ok(sessionKey.validSessionId(parentNative) && sessionKey.validSessionId(survivorNative));
    const parentRoute = sessionKey.encodeSessionKey('omp', parentNative);
    const survivorRoute = sessionKey.encodeSessionKey('omp', survivorNative);
    const ompDir = path.join(home, '.omp', 'agent', 'sessions', 'project');
    const parentFile = path.join(ompDir, `${parentNative}.jsonl`);
    const survivorFile = path.join(ompDir, `${survivorNative}.jsonl`);
    const childDir = parentFile.slice(0, -'.jsonl'.length);
    fs.mkdirSync(childDir, { recursive: true });
    fs.writeFileSync(parentFile, JSON.stringify({ type: 'session', version: 3, id: parentNative, cwd }) + '\n');
    fs.writeFileSync(survivorFile, JSON.stringify({ type: 'session', version: 3, id: survivorNative, cwd }) + '\n');
    // Child transcript inside the deleted parent's folder claims the survivor's id.
    fs.writeFileSync(path.join(childDir, 'Helper.jsonl'), JSON.stringify({ type: 'session', version: 3, id: survivorNative, cwd }) + '\n');
    const storePath = (id) => path.join(home, '.pi', 'dish', 'reviews', `${crypto.createHash('sha256').update(sessionKey.canonicalSessionId(id)).digest('hex').slice(0, 32)}.json`);
    assert.equal((await post(`${owner}/api/sessions/${encodeURIComponent(parentRoute)}/reviews`, { ...DECK, title: 'Parent', wait: false })).status, 201);
    const survivorCreated = await post(`${owner}/api/sessions/${encodeURIComponent(survivorRoute)}/reviews`, { ...DECK, title: 'Survivor', wait: false });
    assert.equal(survivorCreated.status, 201);
    const survivorReviewId = String((0, test_types_js_1.record)((await json(survivorCreated)).review).id);
    assert.ok(fs.existsSync(storePath(parentRoute)) && fs.existsSync(storePath(survivorRoute)));
    const deleted = await fetch(`${owner}/api/sessions/${encodeURIComponent(parentRoute)}`, { method: 'DELETE' });
    assert.equal(deleted.status, 200);
    assert.ok(!fs.existsSync(storePath(parentRoute)), 'deleted parent reviews purged');
    assert.equal((await fetch(`${owner}/api/sessions/${encodeURIComponent(parentRoute)}/reviews`)).status, 404);
    assert.ok(fs.existsSync(storePath(survivorRoute)), 'surviving session reviews untouched');
    const survivorList = await json(await fetch(`${owner}/api/sessions/${encodeURIComponent(survivorRoute)}/reviews`));
    assert.equal(survivorList.reviews.some(item => item.id === survivorReviewId), true);
    // Lookup by review id works directly and through /hosts/<peer>, and 404s for deleted/unknown/invalid ids.
    for (const url of [`${owner}/api/reviews/${survivorReviewId}`, `${hub}/hosts/owner/api/reviews/${survivorReviewId}`]) {
        const looked = await fetch(url);
        assert.equal(looked.status, 200, url);
        const body = await json(looked);
        assert.equal((0, test_types_js_1.record)(body.review).id, survivorReviewId);
        assert.equal((0, test_types_js_1.record)(body.review).sessionId, survivorRoute);
        assert.equal((0, test_types_js_1.record)(body.result).reviewId, survivorReviewId);
    }
    assert.equal((await fetch(`${owner}/api/reviews/rv_0000000000000000`)).status, 404);
    assert.equal((await fetch(`${owner}/api/reviews/not-a-review-id`)).status, 404);
});
test('CLI on a non-hub worker host resolves reviews whose session lives on another host', async (t) => {
    // Reproduces the OSBG bot bug: bot session lives on a token-gated hub ("beelink"),
    // while the worker runs on another host ("framework") whose CLI only talks to its local server.
    const hubHome = (0, test_env_js_1.createTestTempDir)('pi-dish-reviews-beelink-');
    const workerHome = (0, test_env_js_1.createTestTempDir)('pi-dish-reviews-framework-');
    const HUB_TOKEN = 'beelink-review-token-0123456789';
    const HUB_HOST_ID = '11111111-2222-4333-8444-555555555555';
    const BOT_NATIVE_ID = 'osbg-bot-01';
    assert.ok(sessionKey.validSessionId(BOT_NATIVE_ID));
    const BOT_ROUTE_ID = sessionKey.encodeSessionKey('bot', BOT_NATIVE_ID);
    const WORKER_SESSION_ID = '2026-11-23T10-00-00-worker01';
    // Seed a bot session on beelink (mirror file under ~/.pi/dish/bots/sessions + token + host-id).
    fs.mkdirSync(path.join(hubHome, '.pi', 'dish', 'bots', 'sessions'), { recursive: true });
    fs.writeFileSync(path.join(hubHome, '.pi', 'dish', 'token'), `${HUB_TOKEN}\n`);
    fs.writeFileSync(path.join(hubHome, '.pi', 'dish', 'host-id'), `${HUB_HOST_ID}\n`);
    fs.writeFileSync(path.join(hubHome, '.pi', 'dish', 'settings.json'), JSON.stringify({ hostLabel: 'beelink' }));
    fs.writeFileSync(path.join(hubHome, '.pi', 'dish', 'bots', 'sessions', `${BOT_NATIVE_ID}.jsonl`), JSON.stringify({ type: 'session', version: 3, id: BOT_NATIVE_ID, cwd: hubHome, timestamp: '2026-11-23T10:00:00.000Z' }) + '\n');
    const beelink = await boot(hubHome, await freePort(), { PI_DISH_REVIEW_GRACE_MS: String(GRACE_MS) });
    t.after(() => { try {
        beelink.child.kill('SIGKILL');
    }
    catch { } });
    // Seed a worker session on framework with beelink + an unreachable peer configured in remotes.
    const workerSessions = path.join(workerHome, '.pi', 'agent', 'sessions', 'worker');
    fs.mkdirSync(workerSessions, { recursive: true });
    fs.writeFileSync(path.join(workerSessions, `${WORKER_SESSION_ID}.jsonl`), JSON.stringify({ type: 'session', cwd: workerHome, timestamp: '2026-11-23T10:05:00.000Z' }) + '\n');
    const downPort = await freePort();
    fs.mkdirSync(path.join(workerHome, '.pi', 'dish'), { recursive: true });
    fs.writeFileSync(path.join(workerHome, '.pi', 'dish', 'settings.json'), JSON.stringify({
        hostLabel: 'framework',
        remotes: [
            { name: 'beelink', url: beelink.base, token: HUB_TOKEN },
            { name: 'down', url: `http://127.0.0.1:${downPort}` },
        ],
    }));
    const framework = await boot(workerHome, await freePort(), { PI_DISH_REVIEW_GRACE_MS: String(GRACE_MS) });
    t.after(() => { try {
        framework.child.kill('SIGKILL');
    }
    catch { } });
    const hubHeaders = { Authorization: `Bearer ${HUB_TOKEN}` };
    const botReviewsUrl = `${beelink.base}/api/sessions/${encodeURIComponent(BOT_ROUTE_ID)}/reviews`;
    const noMediaDeck = { ...DECK, cards: DECK.cards.map(item => ({ ...item, media: [] })) };
    // Post and answer one review on the bot's session on beelink.
    const createdRes = await post(botReviewsUrl, { ...noMediaDeck, title: 'OSBG review', wait: false }, hubHeaders);
    assert.equal(createdRes.status, 201, await createdRes.clone().text());
    const reviewId = String((0, test_types_js_1.record)((await json(createdRes)).review).id);
    const submitRes = await post(`${botReviewsUrl}/${reviewId}/submit`, {
        submissionId: 'sub-osbg-0001',
        answers: { ...DEFAULTS, quick_mag: { value: 'vial', note: 'beelink pick' } },
    }, hubHeaders);
    assert.equal(submitRes.status, 202);
    // Helper that runs pi-dish-review from the worker on framework (NO beelink URL, NO beelink token).
    const workerCli = (args, extraEnv = {}) => cli(args, undefined, { HOME: workerHome, PI_DISH_URL: framework.base, PI_DISH_SESSION_ID: WORKER_SESSION_ID, ...extraEnv });
    // 1. Bare `answers <reviewId>` (the exact failing command reported by OSBG) finds it via peer relay.
    const bare = workerCli(['answers', reviewId]);
    assert.equal(await bare.exited, 0, bare.stderr());
    const bareParsed = (0, test_types_js_1.record)(JSON.parse(bare.stdout()));
    assert.equal(bareParsed.reviewId, reviewId);
    assert.equal(bareParsed.status, 'submitted');
    assert.deepEqual((0, test_types_js_1.record)(bareParsed.answers).quick_mag, { value: 'vial', default: false, note: 'beelink pick' });
    // 2. `answers <reviewId> --session <botRouteId>` (the second failing command) and short native ref both resolve across peers.
    for (const sessionArg of [BOT_ROUTE_ID, BOT_NATIVE_ID, `beelink/${BOT_NATIVE_ID}`, `${HUB_HOST_ID}:${BOT_ROUTE_ID}`]) {
        const withSess = workerCli(['answers', reviewId, '--session', sessionArg]);
        assert.equal(await withSess.exited, 0, `--session ${sessionArg}: ${withSess.stderr()}`);
        assert.equal((0, test_types_js_1.record)(JSON.parse(withSess.stdout())).reviewId, reviewId);
    }
    // 3. Explicit host addressing (`beelink/<id>` and `--host beelink`) and running outside any local session.
    for (const argv of [[`answers`, `beelink/${reviewId}`], ['answers', reviewId, '--host', 'beelink']]) {
        const explicit = workerCli(argv);
        assert.equal(await explicit.exited, 0, `${argv.join(' ')}: ${explicit.stderr()}`);
        assert.equal((0, test_types_js_1.record)(JSON.parse(explicit.stdout())).reviewId, reviewId);
    }
    const emptyHome = (0, test_env_js_1.createTestTempDir)('pi-dish-reviews-nosess-');
    const noSession = workerCli(['answers', reviewId], { HOME: emptyHome, PI_DISH_SESSION_ID: '' });
    assert.equal(await noSession.exited, 0, noSession.stderr());
    assert.equal((0, test_types_js_1.record)(JSON.parse(noSession.stdout())).reviewId, reviewId);
    // 4. `wait` and `cancel` also work across hosts on bare review ids.
    const openWaitRes = await post(botReviewsUrl, { ...noMediaDeck, title: 'OSBG remote wait', wait: true }, hubHeaders);
    assert.equal(openWaitRes.status, 201);
    const waitId = String((0, test_types_js_1.record)((await json(openWaitRes)).review).id);
    const waiting = workerCli(['wait', waitId, '--timeout', '15']);
    await pause(250);
    assert.equal((await post(`${botReviewsUrl}/${waitId}/submit`, { submissionId: 'sub-osbg-wait1', answers: DEFAULTS }, hubHeaders)).status, 202);
    assert.equal(await waiting.exited, 0, waiting.stderr());
    assert.equal((0, test_types_js_1.record)(JSON.parse(waiting.stdout())).status, 'submitted');
    const openCancelRes = await post(botReviewsUrl, { ...noMediaDeck, title: 'OSBG remote cancel', wait: false }, hubHeaders);
    assert.equal(openCancelRes.status, 201);
    const cancelId = String((0, test_types_js_1.record)((await json(openCancelRes)).review).id);
    const cancelling = workerCli(['cancel', cancelId]);
    assert.equal(await cancelling.exited, 0, cancelling.stderr());
    assert.match(cancelling.stdout(), new RegExp(`review ${cancelId} withdrawn`));
    assert.equal((0, test_types_js_1.record)((await json(await fetch(`${botReviewsUrl}/${cancelId}`, { headers: hubHeaders }))).review).status, 'cancelled');
    // 5. Error messages name the server URL and every host asked (plus unreachable peers).
    const missingReview = workerCli(['answers', 'rv_ffffffffffffffff']);
    assert.equal(await missingReview.exited, 1);
    assert.match(missingReview.stderr(), new RegExp(framework.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(missingReview.stderr(), /framework \(self\)/);
    assert.match(missingReview.stderr(), /beelink/);
    assert.match(missingReview.stderr(), /unreachable: down/);
    const missingSession = workerCli(['answers', reviewId, '--session', 'no-such-session-9999']);
    assert.equal(await missingSession.exited, 1);
    assert.match(missingSession.stderr(), /Session not found: no-such-session-9999/);
    assert.match(missingSession.stderr(), new RegExp(framework.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(missingSession.stderr(), /framework \(self\), beelink/);
    const unknownHost = workerCli(['answers', `nope/${reviewId}`]);
    assert.equal(await unknownHost.exited, 1);
    assert.match(unknownHost.stderr(), /unknown host "nope"/);
    assert.match(unknownHost.stderr(), new RegExp(framework.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const conflict = workerCli(['answers', `beelink/${reviewId}`, '--host', 'down']);
    assert.equal(await conflict.exited, 1);
    assert.match(conflict.stderr(), /conflicting hosts/);
    assert.match(conflict.stderr(), new RegExp(framework.base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});
test('mixed-version peer without /api/reviews/:id falls back through launch provenance', async (t) => {
    const reviewId = 'rv_abcdef0123456789';
    const HUB_HOST_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const LEGACY_BOT_ID = 'legacy-bot';
    assert.ok(sessionKey.validSessionId(LEGACY_BOT_ID));
    const BOT_ROUTE = sessionKey.encodeSessionKey('bot', LEGACY_BOT_ID);
    const WORKER_ID = '2026-11-23T11-00-00-worker02';
    const fake = http.createServer((req, res) => {
        const url = req.url ?? '';
        res.setHeader('Content-Type', 'application/json');
        if (url === '/api/hosts') {
            return res.end(JSON.stringify({
                hosts: [
                    { self: true, name: null, hostId: '22222222-3333-4444-8555-666666666666', label: 'framework', reachable: true, capabilities: { reviewsV1: true } },
                    { name: 'beelink', hostId: HUB_HOST_ID, label: 'beelink', reachable: true, capabilities: { reviewsV1: true } },
                ],
            }));
        }
        if (url === '/api/sessions?active=1') {
            return res.end(JSON.stringify({
                active: [{ id: WORKER_ID, parentId: `${HUB_HOST_ID}:${BOT_ROUTE}`, isActive: true }],
                children: [],
                previous: [],
            }));
        }
        if (url === `/api/sessions/${WORKER_ID}/reviews/${reviewId}`) {
            res.statusCode = 404;
            return res.end(JSON.stringify({ error: 'no such review' }));
        }
        // Both local and peer simulate older servers lacking GET /api/reviews/:reviewId (bodiless 404).
        if (url === `/api/reviews/${reviewId}` || url === `/hosts/beelink/api/reviews/${reviewId}`) {
            res.statusCode = 404;
            res.setHeader('Content-Type', 'text/plain');
            return res.end('Not found');
        }
        if (url === `/hosts/beelink/api/sessions/${encodeURIComponent(BOT_ROUTE)}/reviews/${reviewId}`) {
            return res.end(JSON.stringify({
                review: { id: reviewId, sessionId: BOT_ROUTE, status: 'submitted' },
                result: { reviewId, status: 'submitted', answers: { quick_mag: { value: 'tab', default: true } } },
            }));
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => fake.close(() => resolve())));
    const address = fake.address();
    assert.ok(address && typeof address !== 'string');
    const fakeBase = `http://127.0.0.1:${address.port}`;
    const run = cli(['answers', reviewId], undefined, { PI_DISH_URL: fakeBase, PI_DISH_SESSION_ID: WORKER_ID });
    assert.equal(await run.exited, 0, run.stderr());
    assert.equal((0, test_types_js_1.record)(JSON.parse(run.stdout())).reviewId, reviewId);
    assert.deepEqual((0, test_types_js_1.record)((0, test_types_js_1.record)(JSON.parse(run.stdout())).answers).quick_mag, { value: 'tab', default: true });
});
test('unqualified --session carries on to peers on local miss or pre-reviews local 404, while host-qualified stays pinned', async (t) => {
    const reviewId = 'rv_1122334455667788';
    const SHARED_SESSION = '2026-11-23T12-00-00-shared01';
    let localMode = 'no-such-review';
    let peerCalls = 0;
    const fake = http.createServer((req, res) => {
        const url = req.url ?? '';
        res.setHeader('Content-Type', 'application/json');
        if (url === '/api/host')
            return res.end(JSON.stringify({ hostId: '22222222-3333-4444-8555-666666666666', label: 'framework', capabilities: { reviewsV1: true } }));
        if (url === '/api/hosts') {
            return res.end(JSON.stringify({
                hosts: [
                    { self: true, name: null, hostId: '22222222-3333-4444-8555-666666666666', label: 'framework', reachable: true, capabilities: localMode === 'pre-reviews' ? {} : { reviewsV1: true, resolve: true } },
                    { name: 'beelink', hostId: '11111111-2222-4333-8444-555555555555', label: 'beelink', reachable: true, capabilities: { reviewsV1: true, resolve: true } },
                ],
            }));
        }
        if (url === `/api/sessions/${SHARED_SESSION}/reviews/${reviewId}`) {
            res.statusCode = 404;
            if (localMode === 'pre-reviews') {
                res.setHeader('Content-Type', 'text/plain');
                return res.end('Not found');
            }
            return res.end(JSON.stringify({ error: 'no such review' }));
        }
        if (url.startsWith('/hosts/beelink/'))
            peerCalls++;
        if (url === `/hosts/beelink/api/sessions/resolve?id=${SHARED_SESSION}`) {
            return res.end(JSON.stringify({ session: { id: SHARED_SESSION, name: 'Shared on beelink' } }));
        }
        if (url === `/hosts/beelink/api/sessions/${SHARED_SESSION}/reviews/${reviewId}`) {
            return res.end(JSON.stringify({
                review: { id: reviewId, sessionId: SHARED_SESSION, status: 'submitted' },
                result: { reviewId, status: 'submitted', answers: { quick_mag: { value: 'vial', default: false } } },
            }));
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'not found' }));
    });
    await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => fake.close(() => resolve())));
    const address = fake.address();
    assert.ok(address && typeof address !== 'string');
    const fakeBase = `http://127.0.0.1:${address.port}`;
    // 1. Local session exists but has no such review -> unqualified --session discovers it on beelink.
    const fromPeer = cli(['answers', reviewId, '--session', SHARED_SESSION], undefined, { PI_DISH_URL: fakeBase, PI_DISH_SESSION_ID: 'other-local' });
    assert.equal(await fromPeer.exited, 0, fromPeer.stderr());
    assert.equal((0, test_types_js_1.record)(JSON.parse(fromPeer.stdout())).reviewId, reviewId);
    assert.ok(peerCalls > 0);
    // 2. Pre-reviews local server (bodiless 404) -> unqualified --session still discovers it on beelink.
    localMode = 'pre-reviews';
    const fromPreReviews = cli(['answers', reviewId, '--session', SHARED_SESSION], undefined, { PI_DISH_URL: fakeBase, PI_DISH_SESSION_ID: 'other-local' });
    assert.equal(await fromPreReviews.exited, 0, fromPreReviews.stderr());
    assert.equal((0, test_types_js_1.record)(JSON.parse(fromPreReviews.stdout())).reviewId, reviewId);
    // 3. Explicitly host-qualified (`self/<session>` and `--host self`) stays pinned and never asks peers.
    localMode = 'no-such-review';
    peerCalls = 0;
    const pinnedRef = cli(['answers', reviewId, '--session', `self/${SHARED_SESSION}`], undefined, { PI_DISH_URL: fakeBase, PI_DISH_SESSION_ID: 'other-local' });
    assert.equal(await pinnedRef.exited, 1);
    assert.match(pinnedRef.stderr(), /no such review/);
    assert.equal(peerCalls, 0, 'host-qualified --session self/<id> must stay pinned');
    const pinnedFlag = cli(['answers', reviewId, '--host', 'self', '--session', SHARED_SESSION], undefined, { PI_DISH_URL: fakeBase, PI_DISH_SESSION_ID: 'other-local' });
    assert.equal(await pinnedFlag.exited, 1);
    assert.match(pinnedFlag.stderr(), /no such review/);
    assert.equal(peerCalls, 0, '--host self must stay pinned');
});
test('empty or malformed HTTP 200 peer is skipped in favor of a valid peer, and fails non-zero when none is valid', async (t) => {
    const reviewId = 'rv_2233445566778899';
    const OWNER_SESSION = '2026-11-23T12-30-00-valid001';
    let goodEnabled = true;
    let badBody = {};
    const fake = http.createServer((req, res) => {
        const url = req.url ?? '';
        res.setHeader('Content-Type', 'application/json');
        if (url === '/api/hosts') {
            return res.end(JSON.stringify({
                hosts: [
                    { self: true, name: null, hostId: '22222222-3333-4444-8555-666666666666', label: 'framework', reachable: true, capabilities: { reviewsV1: true } },
                    { name: 'badpeer', hostId: '33333333-4444-4555-8666-777777777777', label: 'badpeer', reachable: true, capabilities: { reviewsV1: true } },
                    ...(goodEnabled ? [{ name: 'goodpeer', hostId: '44444444-5555-4666-8777-888888888888', label: 'goodpeer', reachable: true, capabilities: { reviewsV1: true } }] : []),
                ],
            }));
        }
        if (url === `/api/reviews/${reviewId}`) {
            res.statusCode = 404;
            return res.end(JSON.stringify({ error: 'no such review' }));
        }
        if (url === `/hosts/badpeer/api/reviews/${reviewId}`)
            return res.end(JSON.stringify(badBody));
        if (url === `/hosts/goodpeer/api/reviews/${reviewId}`) {
            return res.end(JSON.stringify({
                review: { id: reviewId, sessionId: OWNER_SESSION, status: 'submitted' },
                result: { reviewId, status: 'submitted', answers: { quick_mag: { value: 'tab', default: true } } },
            }));
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'no such review' }));
    });
    await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve));
    t.after(() => new Promise(resolve => fake.close(() => resolve())));
    const address = fake.address();
    assert.ok(address && typeof address !== 'string');
    const fakeBase = `http://127.0.0.1:${address.port}`;
    // 1. First peer returns empty HTTP 200 {}, second peer returns valid review -> valid peer wins.
    const skippedEmpty = cli(['answers', reviewId], undefined, { PI_DISH_URL: fakeBase, PI_DISH_SESSION_ID: '' });
    assert.equal(await skippedEmpty.exited, 0, skippedEmpty.stderr());
    assert.equal((0, test_types_js_1.record)(JSON.parse(skippedEmpty.stdout())).reviewId, reviewId);
    // 2. First peer returns mismatched review id -> skipped, valid peer wins.
    badBody = {
        review: { id: 'rv_0000000000000000', sessionId: OWNER_SESSION, status: 'submitted' },
        result: { reviewId: 'rv_0000000000000000', status: 'submitted', answers: {} },
    };
    const skippedWrongId = cli(['answers', reviewId], undefined, { PI_DISH_URL: fakeBase, PI_DISH_SESSION_ID: '' });
    assert.equal(await skippedWrongId.exited, 0, skippedWrongId.stderr());
    assert.equal((0, test_types_js_1.record)(JSON.parse(skippedWrongId.stdout())).reviewId, reviewId);
    // 3. Only the empty-200 peer exists -> never prints {} or exits 0.
    goodEnabled = false;
    badBody = {};
    const onlyBad = cli(['answers', reviewId], undefined, { PI_DISH_URL: fakeBase, PI_DISH_SESSION_ID: '' });
    assert.equal(await onlyBad.exited, 1);
    assert.equal(onlyBad.stdout().trim(), '');
    assert.match(onlyBad.stderr(), /badpeer \(malformed review response/);
});
test('stalled peer bodies obey the end-to-end discovery deadline and wait --timeout counts discovery time', async (t) => {
    const reviewId = 'rv_33445566778899aa';
    const OWNER_SESSION = '2026-11-23T13-00-00-owner001';
    let goodPeerMode = 'submitted';
    const openSockets = new Set();
    const fake = http.createServer((req, res) => {
        const url = req.url ?? '';
        res.setHeader('Content-Type', 'application/json');
        if (url === '/api/hosts') {
            return res.end(JSON.stringify({
                hosts: [
                    { self: true, name: null, hostId: '22222222-3333-4444-8555-666666666666', label: 'framework', reachable: true, capabilities: { reviewsV1: true, resolve: true } },
                    { name: 'stalled', hostId: '55555555-6666-4777-8888-999999999999', label: 'stalled', reachable: true, capabilities: { reviewsV1: true, resolve: true } },
                    ...(goodPeerMode !== 'absent'
                        ? [{ name: 'beelink', hostId: '11111111-2222-4333-8444-555555555555', label: 'beelink', reachable: true, capabilities: { reviewsV1: true, resolve: true } }]
                        : []),
                ],
            }));
        }
        // Stalled peer flushes 200 headers and never finishes the body (both lookup and --session resolve).
        if (url === `/hosts/stalled/api/reviews/${reviewId}` || url.startsWith('/hosts/stalled/api/sessions/resolve')) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.flushHeaders();
            res.write('{');
            if (req.socket)
                openSockets.add(req.socket);
            req.on('close', () => { if (req.socket)
                openSockets.delete(req.socket); });
            return;
        }
        if (url === `/hosts/beelink/api/sessions/resolve?id=${OWNER_SESSION}`) {
            return res.end(JSON.stringify({ session: { id: OWNER_SESSION, name: 'Beelink owner' } }));
        }
        if (url === `/hosts/beelink/api/reviews/${reviewId}` || url === `/hosts/beelink/api/sessions/${OWNER_SESSION}/reviews/${reviewId}`) {
            if (goodPeerMode === 'slow-open') {
                const timer = setTimeout(() => {
                    if (res.destroyed)
                        return;
                    res.end(JSON.stringify({
                        review: { id: reviewId, sessionId: OWNER_SESSION, status: 'open' },
                        result: { reviewId, status: 'open', answers: {} },
                    }));
                }, 450);
                timer.unref();
                return;
            }
            return res.end(JSON.stringify({
                review: { id: reviewId, sessionId: OWNER_SESSION, status: 'submitted' },
                result: { reviewId, status: 'submitted', answers: { quick_mag: { value: 'vial', default: false } } },
            }));
        }
        if (url.startsWith(`/hosts/beelink/api/sessions/${OWNER_SESSION}/reviews/${reviewId}/wait`)) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.flushHeaders();
            const timer = setTimeout(() => {
                if (!res.writableEnded && !res.destroyed)
                    res.end(JSON.stringify({ result: { reviewId, status: 'open' } }));
            }, 5000);
            timer.unref();
            req.on('close', () => clearTimeout(timer));
            return;
        }
        res.statusCode = 404;
        res.end(JSON.stringify({ error: url.includes('/sessions/') && !url.includes('/reviews/') ? 'Session not found' : 'no such review' }));
    });
    await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
        for (const sock of openSockets) {
            try {
                sock.destroy();
            }
            catch { }
        }
        await new Promise(resolve => fake.close(() => resolve()));
    });
    const address = fake.address();
    assert.ok(address && typeof address !== 'string');
    const fakeBase = `http://127.0.0.1:${address.port}`;
    // 1. Stalled peer does not delay a healthy peer on either bare lookup or --session fan-out.
    const tFast = Date.now();
    const fastBare = cli(['answers', reviewId], undefined, { PI_DISH_URL: fakeBase, PI_DISH_SESSION_ID: '' });
    assert.equal(await fastBare.exited, 0, fastBare.stderr());
    assert.equal((0, test_types_js_1.record)(JSON.parse(fastBare.stdout())).reviewId, reviewId);
    assert.ok(Date.now() - tFast < 3000, 'healthy peer won without waiting for stalled peer');
    const tSess = Date.now();
    const fastSess = cli(['answers', reviewId, '--session', OWNER_SESSION], undefined, { PI_DISH_URL: fakeBase, PI_DISH_SESSION_ID: '' });
    assert.equal(await fastSess.exited, 0, fastSess.stderr());
    assert.equal((0, test_types_js_1.record)(JSON.parse(fastSess.stdout())).reviewId, reviewId);
    assert.ok(Date.now() - tSess < 3000, '--session fan-out did not wait for stalled peer');
    // 2. When only a stalled peer exists, both --session and bare lookup abort its stalled body at the deadline.
    goodPeerMode = 'absent';
    const tSessionTimeout = Date.now();
    const stalledSession = cli(['answers', reviewId, '--session', OWNER_SESSION], undefined, {
        PI_DISH_URL: fakeBase, PI_DISH_SESSION_ID: '', PI_DISH_REVIEW_LOOKUP_TIMEOUT_MS: '350',
    });
    assert.equal(await stalledSession.exited, 1);
    assert.match(stalledSession.stderr(), /stalled \(timed out/);
    assert.ok(Date.now() - tSessionTimeout < 3000, '--session stalled body aborted at discovery deadline');
    // 3. Bare `wait --timeout 1` caps discovery at 1s (NOT 15s) even without overriding lookup timeout.
    const tWaitStalled = Date.now();
    const stalledWait = cli(['wait', reviewId, '--timeout', '1'], undefined, {
        PI_DISH_URL: fakeBase, PI_DISH_SESSION_ID: '',
    });
    assert.equal(await stalledWait.exited, 1);
    assert.match(stalledWait.stderr(), /stalled \(timed out/);
    assert.ok(Date.now() - tWaitStalled < 3500, 'bare wait --timeout 1 capped discovery at 1s instead of 15s');
    // 4. Discovery latency is counted against `wait --timeout`: 450ms discovery + remaining wait ends right around 1s.
    goodPeerMode = 'slow-open';
    const tWaitBudget = Date.now();
    const budgetedWait = cli(['wait', reviewId, '--timeout', '1'], undefined, {
        PI_DISH_URL: fakeBase, PI_DISH_SESSION_ID: '',
    });
    assert.equal(await budgetedWait.exited, 0, budgetedWait.stderr());
    assert.match(budgetedWait.stdout(), /No answer within 1 s/);
    assert.ok(Date.now() - tWaitBudget < 2500, 'discovery time counted against wait --timeout');
});
test('CLI wait retries dropped or malformed responses and exits non-zero when retries run out', async () => {
    const reviewId = 'rv_0123456789abcdef';
    let attempts = 0;
    let mode = 'recover';
    const fake = http.createServer((req, res) => {
        attempts++;
        assert.equal(req.headers['x-pi-dish-client'], '1', 'CLI sends CSRF header on wait');
        if (mode === 'always-drop' || attempts === 1) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.flushHeaders();
            req.socket.destroy();
            return;
        }
        if (attempts === 2) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('{}');
            return;
        }
        if (attempts === 3) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ result: { status: 'submitted' } }));
            return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            result: { reviewId, status: 'submitted', answers: { quick_mag: { value: 'vial', default: false } }, delivery: { state: 'delivered', via: 'waiter', at: 1, error: null } },
        }));
    });
    await new Promise(resolve => fake.listen(0, '127.0.0.1', resolve));
    const address = fake.address();
    assert.ok(address && typeof address !== 'string');
    const fakeBase = `http://127.0.0.1:${address.port}`;
    try {
        const recovered = cli(['wait', reviewId], undefined, {
            PI_DISH_URL: fakeBase, PI_DISH_REVIEW_WAIT_RETRY_MS: '10', PI_DISH_REVIEW_WAIT_RETRIES: '5',
        });
        assert.equal(await recovered.exited, 0, recovered.stderr());
        assert.equal(attempts, 4);
        assert.deepEqual((0, test_types_js_1.record)(JSON.parse(recovered.stdout())).answers, { quick_mag: { value: 'vial', default: false } });
        mode = 'always-drop';
        attempts = 0;
        const exhausted = cli(['wait', reviewId], undefined, {
            PI_DISH_URL: fakeBase, PI_DISH_REVIEW_WAIT_RETRY_MS: '10', PI_DISH_REVIEW_WAIT_RETRIES: '2',
        });
        assert.equal(await exhausted.exited, 1, 'never exits 0 without answers');
        assert.equal(exhausted.stdout().trim(), '', 'does not print {}');
        assert.match(exhausted.stderr(), /wait response ended without a review result/);
    }
    finally {
        await new Promise(resolve => fake.close(() => resolve()));
    }
});
test('failed waiter writes stay pending for message fallback, and timer settle failures are caught and logged', async (t) => {
    const prevHome = process.env.HOME;
    const unitHome = (0, test_env_js_1.createTestTempDir)('pi-dish-reviews-unit-');
    process.env.HOME = unitHome;
    const graceMs = 120;
    // Control both setTimeout and Date so the grace-period fallback cannot race wall-clock stalls.
    t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
    const delivered = [];
    const logs = [];
    const logWaiters = [];
    const unhandled = [];
    const onUnhandled = (reason) => { unhandled.push(reason); };
    process.on('unhandledRejection', onUnhandled);
    const handlers = reviewHandlersModule.createReviewHandlers({
        sessionKnown: () => true,
        sessionCwd: () => unitHome,
        resolveSessionFile: async () => null,
        pageExists: () => false,
        lastMessageIndex: () => 0,
        deliverMessage: async (_id, text) => { delivered.push(text); return null; },
        log: line => {
            logs.push(line);
            for (const notify of logWaiters.splice(0))
                notify(line);
        },
        graceMs,
    });
    const waitForSettledDelivery = (reviewId) => new Promise(resolve => {
        const isDelivered = () => reviews.readReviews(SESSION_ID).find(item => item.id === reviewId)?.submission?.delivery.state === 'delivered';
        if (isDelivered())
            return resolve();
        const unsubscribe = handlers.subscribe(SESSION_ID, ({ review }) => {
            if (review.id === reviewId && review.submission?.delivery.state === 'delivered') {
                unsubscribe();
                resolve();
            }
        });
    });
    const waitForLog = (reviewId) => new Promise(resolve => {
        if (logs.some(line => line.includes(reviewId)))
            return resolve();
        const onLine = (line) => {
            if (line.includes(reviewId))
                resolve();
            else
                logWaiters.push(onLine);
        };
        logWaiters.push(onLine);
    });
    function mockReq(overrides = {}) {
        return {
            method: 'POST', params: { id: SESSION_ID }, query: {}, headers: { 'x-pi-dish-client': '1' }, body: {},
            ...overrides,
        };
    }
    function mockRes(options = {}) {
        const emitter = new node_events_1.EventEmitter();
        let statusCode = 200;
        let body = '';
        const res = Object.assign(emitter, {
            writableEnded: false,
            writableFinished: false,
            destroyed: false,
            socket: { destroyed: false },
            status(code) { statusCode = code; return res; },
            type() { return res; },
            setHeader() { return res; },
            flushHeaders() { },
            json(value) { body = JSON.stringify(value); res.writableEnded = true; res.writableFinished = true; return res; },
            end(chunk, cb) {
                if (options.failWrite) {
                    res.destroyed = true;
                    res.socket.destroyed = true;
                    res.emit('error', new Error('EPIPE'));
                    res.emit('close');
                    cb?.();
                    return res;
                }
                if (chunk)
                    body += chunk;
                res.writableEnded = true;
                res.writableFinished = true;
                cb?.();
                return res;
            },
        });
        return { res: res, status: () => statusCode, body: () => body };
    }
    const noMediaDeck = { ...DECK, cards: DECK.cards.map(item => ({ ...item, media: [] })) };
    try {
        // 1. Live waiter whose res.end fails: delivery stays pending, fallback timer delivers via message.
        const c1 = mockRes();
        await handlers.create(mockReq({ body: { ...noMediaDeck, title: 'Broken live waiter', wait: true } }), c1.res, () => { });
        assert.equal(c1.status(), 201);
        const id1 = String((0, test_types_js_1.record)(JSON.parse(c1.body()).review).id);
        const brokenWait1 = mockRes({ failWrite: true });
        await handlers.wait(mockReq({ method: 'GET', params: { id: SESSION_ID, reviewId: id1 }, query: { timeout: '10' } }), brokenWait1.res, () => { });
        const s1 = mockRes();
        await handlers.submit(mockReq({ params: { id: SESSION_ID, reviewId: id1 }, body: { submissionId: 'sub-fail-01', answers: DEFAULTS } }), s1.res, () => { });
        assert.equal(s1.status(), 202);
        assert.equal(reviews.readReviews(SESSION_ID).find(item => item.id === id1)?.submission?.delivery.state, 'pending', 'failed waiter write does not mark delivered');
        t.mock.timers.tick(graceMs - 1);
        assert.equal(reviews.readReviews(SESSION_ID).find(item => item.id === id1)?.submission?.delivery.state, 'pending', 'delivery stays pending before grace period expires');
        const settled1 = waitForSettledDelivery(id1);
        t.mock.timers.tick(1);
        await settled1;
        assert.ok(delivered.some(msg => msg.includes(id1)), 'fallback message after broken live waiter');
        assert.equal(reviews.readReviews(SESSION_ID).find(item => item.id === id1)?.submission?.delivery.via, 'message');
        // 2. Late GET /wait claiming a pending review whose res.end fails: still falls back to message.
        const c2 = mockRes();
        await handlers.create(mockReq({ body: { ...noMediaDeck, title: 'Broken late waiter', wait: true } }), c2.res, () => { });
        const id2 = String((0, test_types_js_1.record)(JSON.parse(c2.body()).review).id);
        await handlers.submit(mockReq({ params: { id: SESSION_ID, reviewId: id2 }, body: { submissionId: 'sub-fail-02', answers: DEFAULTS } }), mockRes().res, () => { });
        const brokenWait2 = mockRes({ failWrite: true });
        await handlers.wait(mockReq({ method: 'GET', params: { id: SESSION_ID, reviewId: id2 } }), brokenWait2.res, () => { });
        assert.equal(reviews.readReviews(SESSION_ID).find(item => item.id === id2)?.submission?.delivery.state, 'pending', 'failed late waiter write leaves delivery pending');
        t.mock.timers.tick(graceMs - 1);
        assert.equal(reviews.readReviews(SESSION_ID).find(item => item.id === id2)?.submission?.delivery.state, 'pending', 'late waiter fallback waits out grace period');
        const settled2 = waitForSettledDelivery(id2);
        t.mock.timers.tick(1);
        await settled2;
        assert.ok(delivered.some(msg => msg.includes(id2)), 'fallback message after broken late waiter');
        assert.equal(reviews.readReviews(SESSION_ID).find(item => item.id === id2)?.submission?.delivery.via, 'message');
        // 3. Timer-driven settle failure (unreadable store) is caught and logged with no unhandled rejection.
        const c3 = mockRes();
        await handlers.create(mockReq({ body: { ...noMediaDeck, title: 'Corrupt timer', wait: true } }), c3.res, () => { });
        const id3 = String((0, test_types_js_1.record)(JSON.parse(c3.body()).review).id);
        await handlers.submit(mockReq({ params: { id: SESSION_ID, reviewId: id3 }, body: { submissionId: 'sub-fail-03', answers: DEFAULTS } }), mockRes().res, () => { });
        const storeFile = path.join(unitHome, '.pi', 'dish', 'reviews', `${crypto.createHash('sha256').update(SESSION_ID).digest('hex').slice(0, 32)}.json`);
        const backup = fs.readFileSync(storeFile, 'utf8');
        fs.writeFileSync(storeFile, '{corrupt');
        const logged3 = waitForLog(id3);
        t.mock.timers.tick(graceMs);
        await logged3;
        assert.equal(unhandled.length, 0, 'no unhandled promise rejection from timer-driven settle');
        fs.writeFileSync(storeFile, backup);
        assert.equal(reviews.readReviews(SESSION_ID).find(item => item.id === id3)?.submission?.delivery.state, 'pending', 'answer stays pending and recoverable');
    }
    finally {
        handlers.stop();
        t.mock.timers.reset();
        process.off('unhandledRejection', onUnhandled);
        process.env.HOME = prevHome;
    }
});
