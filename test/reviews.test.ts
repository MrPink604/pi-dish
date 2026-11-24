/**
 * Review decks: the bounded format and its errors, answer checks, the
 * delivered message, and the server path end to end. A real server boots as a
 * child with a fake live pi bridge session, plus a hub that lists it as a
 * remote; the pi-dish-review CLI posts and waits as an agent would.
 */
import test = require('node:test');
import assert = require('node:assert/strict');
import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import fs = require('node:fs');
import net = require('node:net');
import path = require('node:path');
import { record } from './test-types.js';
import { createTestTempDir, sanitizeTestEnv } from './test-env.js';
import { sseReader } from './sse-reader.js';
import type { ReviewRecord, ReviewSpec } from '../lib/reviews';

const reviews: typeof import('../lib/reviews') = require('../lib/reviews');

const SERVER = path.join(__dirname, '..', 'server.js');
const CLI = path.join(__dirname, '..', 'skills', 'pi-dish-review', 'scripts', 'pi-dish-review.js');
const SESSION_ID = '2026-11-23T09-00-00-review01';
const GRACE_MS = 1500;
// A 1x1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

function choice(id: string, extra: Record<string, unknown> = {}) {
  return { id, type: 'choice', prompt: `Pick ${id}`, options: ['a', 'b', 'c'], default: 'a', ...extra };
}

function card(id: string, extra: Record<string, unknown> = {}) {
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

function validSpec(raw: unknown): ReviewSpec {
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

test('the delivered message lists changes and notes first, summarizes defaults and defuses OMP syntax', () => {
  const spec = validSpec(DECK);
  const checked = reviews.validateReviewAnswers(spec, {
    quick_mag: { value: 'vial', note: 'see @plan.md' }, finish: { value: ['steel'] }, scope: { value: 'approve' }, notes: { value: 'Warmer\ncrop' },
  });
  assert.ok('answers' in checked);
  const review: ReviewRecord = {
    id: 'rv_0123456789abcdef', sessionId: SESSION_ID, createdAt: 0, anchorMessageIndex: null, spec, media: [], assets: [], status: 'submitted',
    submission: { id: 'sub-00001', submittedAt: Date.UTC(2026, 10, 23, 10, 0, 0), answers: checked.answers, changed: ['quick_mag'],
      delivery: { state: 'pending', via: null, at: null, error: null } },
  };
  const expected = [
    '[review response: Halden part looks (rv_0123456789abcdef), submitted 2026-11-23T10:00:00Z]',
    'quick_mag (default tab): vial',
    '  note: see @plan.md',
    'all other questions with a default: default',
    'notes: |',
    '  Warmer',
    '  crop',
    'full answer set: pi-dish-review answers rv_0123456789abcdef',
  ];
  assert.equal(reviews.formatReviewMessage(review, false), expected.join('\n'));
  assert.equal(reviews.formatReviewMessage(review, true).split('\n')[2], '  note: see \\@plan.md');
});

// ---- the server ------------------------------------------------------------

const children: ChildProcess[] = [];
const prompts: string[] = [];
let bridge: net.Server | null = null;
test.after(() => {
  for (const child of children) { try { child.kill('SIGKILL'); } catch {} }
  bridge?.close();
});

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      if (!address || typeof address === 'string') return reject(new Error('Port probe lacks TCP address'));
      probe.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

// Polls real child processes and background delivery; there is no event to await across processes.
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

async function until<T>(read: () => Promise<T | null> | T | null, what: string, ms = 10_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value) return value;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await pause(50);
  }
}

async function boot(home: string, port: number, extra: NodeJS.ProcessEnv = {}): Promise<{ base: string; child: ChildProcess }> {
  const env: NodeJS.ProcessEnv = { ...sanitizeTestEnv(), HOME: home, HOST: '127.0.0.1', PORT: String(port), TMUX_TMPDIR: path.join(home, 'tmux'), ...extra };
  fs.mkdirSync(path.join(home, 'tmux'), { recursive: true });
  const child = spawn(process.execPath, [SERVER], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  children.push(child);
  let stderr = '';
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  const base = `http://127.0.0.1:${port}`;
  await until(async () => {
    if (child.exitCode !== null) throw new Error(`server exited (${child.exitCode}): ${stderr}`);
    try { return (await fetch(`${base}/api/host`)).ok; } catch { return false; }
  }, `the server on ${port}: ${stderr}`, 30_000);
  return { base, child };
}

async function json(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  try { return record(JSON.parse(text)); } catch { throw new Error(`not JSON (${response.status}): ${text.slice(0, 200)}`); }
}

const post = (url: string, body: unknown) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

let home = '';
let ownerPort = 0;
let owner = '';
let ownerChild: ChildProcess | null = null;
let hub = '';
const api = (base: string, rest = '') => `${base}/api/sessions/${SESSION_ID}/reviews${rest}`;
const viaHub = (rest = '') => `${hub}/hosts/owner/api/sessions/${SESSION_ID}/reviews${rest}`;
const ownerEnv = () => ({ PI_DISH_REVIEW_GRACE_MS: String(GRACE_MS) });

interface Cli { child: ChildProcess; stdout: () => string; stderr: () => string; exited: Promise<number | null> }
function cli(args: string[], input?: unknown): Cli {
  const child = spawn(process.execPath, [CLI, ...args], {
    env: { ...sanitizeTestEnv(), HOME: home, PI_DISH_URL: owner, PI_DISH_SESSION_ID: SESSION_ID }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  children.push(child);
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  child.stdin?.end(input === undefined ? '' : JSON.stringify(input));
  const exited = new Promise<number | null>(resolve => child.on('exit', code => resolve(code)));
  return { child, stdout: () => stdout, stderr: () => stderr, exited };
}

async function openReview(title: string): Promise<Record<string, unknown>> {
  return until(async () => {
    const listed = await json(await fetch(api(owner)));
    return (listed.reviews as Record<string, unknown>[]).find(review => review.title === title && review.status === 'open') ?? null;
  }, `the open review "${title}"`);
}

async function settled(reviewId: string): Promise<Record<string, unknown>> {
  return until(async () => {
    const { review } = await json(await fetch(api(owner, `/${reviewId}`)));
    const state = record(record(record(review).submission ?? {}).delivery ?? {}).state;
    return state && state !== 'pending' && state !== 'delivering' ? record(review) : null;
  }, `the delivery of ${reviewId}`);
}

const DEFAULTS = { quick_mag: { value: 'tab' }, finish: { value: ['steel'] }, scope: { value: 'approve' } };

test('boot an owner host with a live session, and a hub that fronts it', async () => {
  home = createTestTempDir('pi-dish-reviews-');
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
    socket.on('error', () => {});
    socket.write(JSON.stringify({ type: 'hello', turnInProgress: false, queue: { steering: [], followUp: [] } }) + '\n');
    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk;
      for (let end = buffer.indexOf('\n'); end >= 0; end = buffer.indexOf('\n')) {
        const message = record(JSON.parse(buffer.slice(0, end)));
        buffer = buffer.slice(end + 1);
        if (message.command === 'prompt') prompts.push(String(message.message));
        const data = message.command === 'prompt' ? { queued: false, admitted: true }
          : message.command === 'get_available_models' ? { models: [] } : message.command === 'get_commands' ? [] : {};
        socket.write(JSON.stringify({ type: 'response', id: message.id, success: true, data }) + '\n');
      }
    });
  });
  await new Promise<void>(resolve => bridge!.listen(socketPath, resolve));
  const registry = path.join(home, '.pi', 'dish', 'sessions');
  fs.mkdirSync(registry, { recursive: true });
  fs.writeFileSync(path.join(registry, `${SESSION_ID}.json`), JSON.stringify({
    sessionId: SESSION_ID, sessionFile, socketPath, pid: process.pid, cwd, name: 'Review fixture', capabilities: { followUpIfBusy: true },
  }));
  ownerPort = await freePort();
  const booted = await boot(home, ownerPort, ownerEnv());
  owner = booted.base;
  ownerChild = booted.child;
  const hubHome = createTestTempDir('pi-dish-reviews-hub-');
  fs.mkdirSync(path.join(hubHome, '.pi', 'dish'), { recursive: true });
  fs.writeFileSync(path.join(hubHome, '.pi', 'dish', 'settings.json'), JSON.stringify({ remotes: [{ name: 'owner', url: owner }] }));
  hub = (await boot(hubHome, await freePort())).base;
  assert.equal(record((await json(await fetch(`${owner}/api/host`))).capabilities).reviewsV1, true);
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
  const pageReview = record((await json(withPage)).review);
  assert.deepEqual((record((pageReview.cards as unknown[])[0]).media as unknown[])[0], { label: null, alt: null, asset: null, url: pageShot });
  await post(api(owner, `/${pageReview.id}/cancel`), {});

  const events = sseReader(`${owner}/api/sessions/${SESSION_ID}/stream`);
  try {
    const created = await post(viaHub(), { ...DECK, title: 'Media deck', wait: false });
    assert.equal(created.status, 201);
    const review = record((await json(created)).review);
    const media = record((record((review.cards as unknown[])[0]).media as unknown[])[0]);
    assert.deepEqual(media, { label: '5.1 tab', alt: null, asset: 0, url: null });
    assert.equal(review.anchorMessageIndex, 0);
    const update = await events.waitFor(event => event.event === 'review_updated');
    assert.equal(record(record(update.data).review).id, review.id);
    for (const url of [api(owner, `/${review.id}/media/0`), viaHub(`/${review.id}/media/0`)]) {
      const shot = await fetch(url);
      assert.equal(shot.status, 200, url);
      assert.equal(shot.headers.get('content-type'), 'image/png');
      assert.deepEqual(Buffer.from(await shot.arrayBuffer()), PNG);
    }
    assert.equal((await fetch(api(owner, `/${review.id}/media/1`))).status, 404);
    const cancelled = await json(await post(api(owner, `/${review.id}/cancel`), {}));
    assert.equal(record(cancelled.review).status, 'cancelled');
  } finally { events.close(); }
});

test('a waiting CLI gets the answers; the session gets no message', async () => {
  const before = prompts.length;
  const run = cli(['ask', '-'], { ...DECK, title: 'Waited deck' });
  const review = await openReview('Waited deck');
  const submitted = await post(viaHub(`/${review.id}/submit`), { submissionId: 'sub-wait-0001', answers: { ...DEFAULTS, quick_mag: { value: 'vial', note: 'lit' } } });
  assert.equal(submitted.status, 202);
  assert.equal(await run.exited, 0, run.stderr());
  const printed = record(JSON.parse(run.stdout().slice(run.stdout().indexOf('{'))));
  assert.deepEqual(printed.changedFromDefault, ['quick_mag']);
  assert.deepEqual(record(printed.answers).quick_mag, { value: 'vial', default: false, note: 'lit' });
  assert.deepEqual(record(printed.delivery), { state: 'delivered', via: 'waiter', at: record(printed.delivery).at, error: null });
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
  assert.deepEqual(record(record(done.submission).delivery).via, 'message');
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
  ownerChild!.kill('SIGKILL');
  await new Promise(resolve => ownerChild!.once('exit', resolve));
  ownerChild = (await boot(home, ownerPort, ownerEnv())).child;
  const done = await settled(String(review.id));
  assert.equal(record(record(done.submission).delivery).via, 'message');
  await pause(300);
  assert.equal(prompts.filter(prompt => prompt.includes(String(review.id))).length, 1);
  assert.equal(prompts.length, before + 1);
  const answers = cli(['answers', String(review.id)]);
  assert.equal(await answers.exited, 0, answers.stderr());
  assert.equal(record(JSON.parse(answers.stdout())).status, 'submitted');
  const repeated = await post(api(owner, `/${review.id}/submit`), { submissionId: 'sub-restart1', answers: DEFAULTS });
  assert.equal(repeated.status, 200);
  const stat = fs.statSync(path.join(home, '.pi', 'dish', 'reviews'));
  assert.equal(stat.mode & 0o077, 0, 'the store is owner-only');
});
