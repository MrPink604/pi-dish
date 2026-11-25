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
import crypto = require('node:crypto');
import { EventEmitter } from 'node:events';
import fs = require('node:fs');
import http = require('node:http');
import net = require('node:net');
import path = require('node:path');
import { record } from './test-types.js';
import { createTestTempDir, sanitizeTestEnv } from './test-env.js';
import { sseReader } from './sse-reader.js';
import type { ApplicationRequest, ApplicationResponse } from '../lib/http-boundary';
import type { ReviewRecord, ReviewSpec } from '../lib/reviews';

const reviews: typeof import('../lib/reviews') = require('../lib/reviews');
const reviewHandlersModule: typeof import('../lib/review-handlers') = require('../lib/review-handlers');
const sessionKey: typeof import('../lib/session-key') = require('../lib/session-key');

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

test('the delivered message lists changes and notes first, summarizes defaults, keeps values with other and defuses OMP syntax', () => {
  const spec = validSpec(DECK);
  const checked = reviews.validateReviewAnswers(spec, {
    quick_mag: { value: 'vial', note: 'see @plan.md' },
    finish: { value: ['steel', 'black'], other: 'plus @grip', note: 'matte' },
    scope: { value: 'approve' },
    notes: { value: 'Warmer\ncrop' },
  });
  assert.ok('answers' in checked);
  const review: ReviewRecord = {
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
    submission: { ...review.submission!, answers: otherOnly.answers, changed: ['quick_mag'] },
  }, false);
  assert.match(otherOnlyMsg, /\nquick_mag: other \(default tab\): A lit vial\n/);
});

test('reject reason validation, reviewResult and fallback messages for rejected and dismissed decks', () => {
  assert.deepEqual(reviews.validateRejectReason(undefined), { reason: null });
  assert.deepEqual(reviews.validateRejectReason('   '), { reason: null });
  assert.deepEqual(reviews.validateRejectReason('  wrong approach  '), { reason: 'wrong approach' });
  assert.deepEqual(reviews.validateRejectReason('x'.repeat(500)), { reason: 'x'.repeat(500) });
  assert.ok('error' in reviews.validateRejectReason('x'.repeat(501)));
  assert.ok('error' in reviews.validateRejectReason(42));

  const spec = validSpec(DECK);
  const at = Date.UTC(2026, 10, 25, 10, 0, 0);
  const rejected: ReviewRecord = {
    id: 'rv_0123456789abcdef', sessionId: SESSION_ID, createdAt: 0, anchorMessageIndex: null, spec, media: [], assets: [],
    status: 'rejected', submission: null,
    resolution: { outcome: 'rejected', id: 'res-000001', resolvedAt: at, reason: 'Drop @plan.md\nwrong scope', delivery: { state: 'pending', via: null, at: null, error: null } },
  };
  const rejectedMsg = reviews.formatReviewMessage(rejected, false);
  assert.equal(rejectedMsg, [
    '[review response: Halden part looks (rv_0123456789abcdef), REJECTED by the user at 2026-11-25T10:00:00Z]',
    'reason: |',
    '  Drop @plan.md',
    '  wrong scope',
    'The user rejected this proposal (no answers were submitted). Do not proceed with it as proposed.',
    'status: pi-dish-review answers rv_0123456789abcdef',
  ].join('\n'));
  assert.match(reviews.formatReviewMessage(rejected, true), /Drop \\@plan\.md/);
  const rejectedResult = reviews.reviewResult(rejected);
  assert.equal(rejectedResult.status, 'rejected');
  assert.equal(rejectedResult.reason, 'Drop @plan.md\nwrong scope');
  assert.equal(rejectedResult.resolvedAt, '2026-11-25T10:00:00.000Z');
  assert.deepEqual(rejectedResult.answers, {});
  assert.deepEqual(rejectedResult.changedFromDefault, []);

  // Client wire view emits legacy-recognized closed status `'cancelled'` plus explicit `outcome`.
  const rejectedClient = reviews.clientReview(rejected);
  assert.equal(rejectedClient.status, 'cancelled');
  assert.equal(rejectedClient.outcome, 'rejected');
  assert.equal(rejectedClient.resolution?.outcome, 'rejected');

  const rejectedNoReason: ReviewRecord = {
    ...rejected,
    resolution: { ...rejected.resolution!, reason: null },
  };
  assert.equal(reviews.formatReviewMessage(rejectedNoReason, false), [
    '[review response: Halden part looks (rv_0123456789abcdef), REJECTED by the user at 2026-11-25T10:00:00Z]',
    'The user rejected this proposal (no answers were submitted; no reason given). Do not proceed with it as proposed.',
    'status: pi-dish-review answers rv_0123456789abcdef',
  ].join('\n'));

  const dismissed: ReviewRecord = {
    id: 'rv_0123456789abcdef', sessionId: SESSION_ID, createdAt: 0, anchorMessageIndex: null, spec, media: [], assets: [],
    status: 'dismissed', submission: null,
    resolution: { outcome: 'dismissed', id: 'res-000002', resolvedAt: at, reason: null, delivery: { state: 'pending', via: null, at: null, error: null } },
  };
  assert.equal(reviews.formatReviewMessage(dismissed, false), [
    '[review response: Halden part looks (rv_0123456789abcdef), DISMISSED by the user (no answers) at 2026-11-25T10:00:00Z]',
    'The user declined to answer this review. Proceed on your own judgement or drop it.',
    'status: pi-dish-review answers rv_0123456789abcdef',
  ].join('\n'));
  const dismissedResult = reviews.reviewResult(dismissed);
  assert.equal(dismissedResult.status, 'dismissed');
  assert.equal(dismissedResult.reason, null);
  assert.deepEqual(dismissedResult.answers, {});
  const dismissedClient = reviews.clientReview(dismissed);
  assert.equal(dismissedClient.status, 'cancelled');
  assert.equal(dismissedClient.outcome, 'dismissed');
  assert.equal(dismissedClient.resolution?.outcome, 'dismissed');
});

// Pinned verbatim copy of the f87452d store reader (`isRecordShape` + `readFile` in src/core/reviews.ts)
// so rollback compatibility is verified without git history (CI runs depth-1 checkouts).
function readReviewsF87452d(file: string): { sessionId: string; reviews: Record<string, unknown>[] } {
  const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
  const data: unknown = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!isObj(data) || typeof data.sessionId !== 'string' || !Array.isArray(data.reviews)) {
    throw new Error(`${file} is malformed`);
  }
  const sessionId = data.sessionId;
  const isLegacyRecordShape = (value: unknown): value is Record<string, unknown> =>
    isObj(value) && typeof value.id === 'string' && reviews.REVIEW_ID_RE.test(value.id) && value.sessionId === sessionId
      && typeof value.createdAt === 'number' && isObj(value.spec) && Array.isArray(value.media) && Array.isArray(value.assets)
      && (value.status === 'open' || value.status === 'submitted' || value.status === 'cancelled')
      && (value.submission === null || (isObj(value.submission) && typeof value.submission.id === 'string' && isObj(value.submission.delivery)))
      && (value.status === 'submitted') === (value.submission !== null);
  if (!data.reviews.every(isLegacyRecordShape)) throw new Error(`${file} holds a malformed review`);
  return { sessionId, reviews: data.reviews as Record<string, unknown>[] };
}

test('on-disk store remains readable by the f87452d rollback reader alongside open siblings', () => {
  const prevHome = process.env.HOME;
  const rollbackHome = createTestTempDir('pi-dish-reviews-rollback-');
  process.env.HOME = rollbackHome;
  try {
    const spec = validSpec(DECK);
    const openRec: ReviewRecord = {
      id: 'rv_1111111111111111', sessionId: SESSION_ID, createdAt: 1, anchorMessageIndex: 0,
      spec, media: [], assets: [], status: 'open', submission: null,
    };
    const dismissedRec: ReviewRecord = {
      id: 'rv_2222222222222222', sessionId: SESSION_ID, createdAt: 2, anchorMessageIndex: 0,
      spec, media: [], assets: [], status: 'dismissed', submission: null,
      resolution: { outcome: 'dismissed', id: 'res-rb-0001', resolvedAt: 20, reason: null, delivery: { state: 'delivered', via: 'waiter', at: 21, error: null } },
    };
    const rejectedRec: ReviewRecord = {
      id: 'rv_3333333333333333', sessionId: SESSION_ID, createdAt: 3, anchorMessageIndex: 0,
      spec, media: [], assets: [], status: 'rejected', submission: null,
      resolution: { outcome: 'rejected', id: 'res-rb-0002', resolvedAt: 30, reason: 'Rollback check', delivery: { state: 'delivered', via: 'message', at: 31, error: null } },
    };
    reviews.writeReviews(SESSION_ID, [openRec, dismissedRec, rejectedRec]);

    // Raw JSON on disk uses legacy-compatible status `'cancelled'` plus `resolution.outcome`.
    const storeFile = path.join(rollbackHome, '.pi', 'dish', 'reviews', `${crypto.createHash('sha256').update(SESSION_ID).digest('hex').slice(0, 32)}.json`);
    const rawOnDisk = record(JSON.parse(fs.readFileSync(storeFile, 'utf8')));
    const rawList = rawOnDisk.reviews as Record<string, unknown>[];
    assert.equal(rawList[0].status, 'open');
    assert.equal(rawList[1].status, 'cancelled');
    assert.equal(record(rawList[1].resolution).outcome, 'dismissed');
    assert.equal(rawList[2].status, 'cancelled');
    assert.equal(record(rawList[2].resolution).outcome, 'rejected');

    // Verify the pinned f87452d reader loads all records (open + dismissed + rejected siblings).
    const oldLoaded = readReviewsF87452d(storeFile).reviews;
    assert.equal(oldLoaded.length, 3);
    assert.equal(oldLoaded[0].id, openRec.id);
    assert.equal(oldLoaded[0].status, 'open');
    assert.equal(oldLoaded[1].id, dismissedRec.id);
    assert.equal(oldLoaded[1].status, 'cancelled');
    assert.equal(oldLoaded[2].id, rejectedRec.id);
    assert.equal(oldLoaded[2].status, 'cancelled');

    // Current reader reconstructs the exact terminal statuses and resolutions.
    const newLoaded = reviews.readReviews(SESSION_ID);
    assert.deepEqual(newLoaded.map(item => [item.id, item.status]), [
      [openRec.id, 'open'],
      [dismissedRec.id, 'dismissed'],
      [rejectedRec.id, 'rejected'],
    ]);
    assert.equal(newLoaded[2].resolution?.reason, 'Rollback check');

    // Forward compatibility: a store written in pure f87452d shape (no `resolution` key) loads cleanly.
    fs.writeFileSync(storeFile, JSON.stringify({ sessionId: SESSION_ID, reviews: [openRec] }) + '\n');
    assert.deepEqual(reviews.readReviews(SESSION_ID).map(item => [item.id, item.status]), [[openRec.id, 'open']]);
  } finally {
    process.env.HOME = prevHome;
  }
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

const CLIENT_HEADER = { 'X-Pi-Dish-Client': '1' };
const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...CLIENT_HEADER, ...headers }, body: JSON.stringify(body) });

let home = '';
let ownerPort = 0;
let owner = '';
let ownerChild: ChildProcess | null = null;
let hub = '';
const api = (base: string, rest = '') => `${base}/api/sessions/${SESSION_ID}/reviews${rest}`;
const viaHub = (rest = '') => `${hub}/hosts/owner/api/sessions/${SESSION_ID}/reviews${rest}`;
const ownerEnv = () => ({ PI_DISH_REVIEW_GRACE_MS: String(GRACE_MS) });

interface Cli { child: ChildProcess; stdout: () => string; stderr: () => string; exited: Promise<number | null> }
function cli(args: string[], input?: unknown, extraEnv: NodeJS.ProcessEnv = {}): Cli {
  const child = spawn(process.execPath, [CLI, ...args], {
    env: { ...sanitizeTestEnv(), HOME: home, PI_DISH_URL: owner, PI_DISH_SESSION_ID: SESSION_ID, ...extraEnv }, stdio: ['pipe', 'pipe', 'pipe'],
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
    const rec = record(review);
    const holder = record(rec.submission ?? rec.resolution ?? {});
    const state = record(holder.delivery ?? {}).state;
    return state && state !== 'pending' && state !== 'delivering' ? rec : null;
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
  const ownerCaps = record((await json(await fetch(`${owner}/api/host`))).capabilities);
  assert.equal(ownerCaps.reviewsV1, true);
  assert.equal(ownerCaps.reviewsDismissV1, true);
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

test('CSRF header is required (and proxied), HEAD wait has no side effects, and submit caps body at 64 KiB', async () => {
  const rawPost = (url: string, body: unknown) =>
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  // Create without X-Pi-Dish-Client is refused both directly and through the hub.
  assert.equal((await rawPost(api(owner), { ...DECK, title: 'No header', wait: false })).status, 403);
  assert.equal((await rawPost(viaHub(), { ...DECK, title: 'No header hub', wait: false })).status, 403);

  const created = await post(viaHub(), { ...DECK, title: 'CSRF deck', wait: true });
  assert.equal(created.status, 201);
  const reviewId = String(record((await json(created)).review).id);

  // Missing header is refused on wait, submit, reject, dismiss, and cancel (directly and via hub) with zero side effects.
  assert.equal((await fetch(api(owner, `/${reviewId}/wait?timeout=1`))).status, 403);
  assert.equal((await fetch(viaHub(`/${reviewId}/wait?timeout=1`))).status, 403);
  assert.equal((await rawPost(api(owner, `/${reviewId}/submit`), { submissionId: 'sub-csrf-01', answers: DEFAULTS })).status, 403);
  assert.equal((await rawPost(viaHub(`/${reviewId}/submit`), { submissionId: 'sub-csrf-01', answers: DEFAULTS })).status, 403);
  assert.equal((await rawPost(api(owner, `/${reviewId}/reject`), { reason: 'nope' })).status, 403);
  assert.equal((await rawPost(viaHub(`/${reviewId}/reject`), { reason: 'nope' })).status, 403);
  assert.equal((await rawPost(api(owner, `/${reviewId}/dismiss`), {})).status, 403);
  assert.equal((await rawPost(viaHub(`/${reviewId}/dismiss`), {})).status, 403);
  assert.equal((await rawPost(api(owner, `/${reviewId}/cancel`), {})).status, 403);
  assert.equal((await rawPost(viaHub(`/${reviewId}/cancel`), {})).status, 403);
  assert.equal(record((await json(await fetch(api(owner, `/${reviewId}`)))).review).status, 'open');

  // Oversized submit body (>64 KiB) is refused with 413 before validating answers.
  const huge = await post(api(owner, `/${reviewId}/submit`), { submissionId: 'sub-huge-01', answers: { notes: { value: 'x'.repeat(70 * 1024) } } });
  assert.equal(huge.status, 413);
  assert.equal(record((await json(await fetch(api(owner, `/${reviewId}`)))).review).status, 'open');

  // HEAD on wait returns 405 and never claims a pending submission.
  const before = prompts.length;
  assert.equal((await post(viaHub(`/${reviewId}/submit`), { submissionId: 'sub-head-01', answers: DEFAULTS })).status, 202);
  const headDirect = await fetch(api(owner, `/${reviewId}/wait`), { method: 'HEAD', headers: CLIENT_HEADER });
  assert.equal(headDirect.status, 405);
  const headHub = await fetch(viaHub(`/${reviewId}/wait`), { method: 'HEAD', headers: CLIENT_HEADER });
  assert.equal(headHub.status, 405);
  const done = await settled(reviewId);
  assert.equal(record(record(done.submission).delivery).via, 'message', 'HEAD wait did not claim the pending submission');
  assert.equal(prompts.length, before + 1);

  // GET wait with X-Pi-Dish-Client passes through the /hosts hub proxy.
  const proxiedWait = await fetch(viaHub(`/${reviewId}/wait?timeout=1`), { headers: CLIENT_HEADER });
  assert.equal(proxiedWait.status, 200);
  assert.equal(record((await json(proxiedWait)).result).status, 'submitted');
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
  assert.equal((await post(`${ghostBase}/${fakeId}/reject`, { reason: 'no' })).status, 404);
  assert.equal((await post(`${ghostBase}/${fakeId}/dismiss`, {})).status, 404);
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
  const privReviewId = String(record((await json(privCreated)).review).id);
  // Locked request is refused while the private transcript exists (session route and lookup route).
  assert.equal((await fetch(privBase)).status, 404);
  assert.equal((await fetch(`${privBase}/${privReviewId}/media/0`)).status, 404);
  assert.equal((await fetch(`${owner}/api/reviews/${privReviewId}`)).status, 404);
  assert.equal((await fetch(`${hub}/hosts/owner/api/reviews/${privReviewId}`)).status, 404);
  // Unlocked request can look up the private review by id.
  const privLookup = await fetch(`${owner}/api/reviews/${privReviewId}`, { headers: unlockHeader });
  assert.equal(privLookup.status, 200);
  assert.equal(record((await json(privLookup)).review).sessionId, privId);
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
  const storePath = (id: string) =>
    path.join(home, '.pi', 'dish', 'reviews', `${crypto.createHash('sha256').update(sessionKey.canonicalSessionId(id)).digest('hex').slice(0, 32)}.json`);
  assert.equal((await post(`${owner}/api/sessions/${encodeURIComponent(parentRoute)}/reviews`, { ...DECK, title: 'Parent', wait: false })).status, 201);
  const survivorCreated = await post(`${owner}/api/sessions/${encodeURIComponent(survivorRoute)}/reviews`, { ...DECK, title: 'Survivor', wait: false });
  assert.equal(survivorCreated.status, 201);
  const survivorReviewId = String(record((await json(survivorCreated)).review).id);
  assert.ok(fs.existsSync(storePath(parentRoute)) && fs.existsSync(storePath(survivorRoute)));
  const deleted = await fetch(`${owner}/api/sessions/${encodeURIComponent(parentRoute)}`, { method: 'DELETE' });
  assert.equal(deleted.status, 200);
  assert.ok(!fs.existsSync(storePath(parentRoute)), 'deleted parent reviews purged');
  assert.equal((await fetch(`${owner}/api/sessions/${encodeURIComponent(parentRoute)}/reviews`)).status, 404);
  assert.ok(fs.existsSync(storePath(survivorRoute)), 'surviving session reviews untouched');
  const survivorList = await json(await fetch(`${owner}/api/sessions/${encodeURIComponent(survivorRoute)}/reviews`));
  assert.equal((survivorList.reviews as Record<string, unknown>[]).some(item => item.id === survivorReviewId), true);
  // Lookup by review id works directly and through /hosts/<peer>, and 404s for deleted/unknown/invalid ids.
  for (const url of [`${owner}/api/reviews/${survivorReviewId}`, `${hub}/hosts/owner/api/reviews/${survivorReviewId}`]) {
    const looked = await fetch(url);
    assert.equal(looked.status, 200, url);
    const body = await json(looked);
    assert.equal(record(body.review).id, survivorReviewId);
    assert.equal(record(body.review).sessionId, survivorRoute);
    assert.equal(record(body.result).reviewId, survivorReviewId);
  }
  assert.equal((await fetch(`${owner}/api/reviews/rv_0000000000000000`)).status, 404);
  assert.equal((await fetch(`${owner}/api/reviews/not-a-review-id`)).status, 404);
});

test('CLI on a non-hub worker host resolves reviews whose session lives on another host', async t => {
  // Reproduces the OSBG bot bug: bot session lives on a token-gated hub ("beelink"),
  // while the worker runs on another host ("framework") whose CLI only talks to its local server.
  const hubHome = createTestTempDir('pi-dish-reviews-beelink-');
  const workerHome = createTestTempDir('pi-dish-reviews-framework-');
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
  fs.writeFileSync(
    path.join(hubHome, '.pi', 'dish', 'bots', 'sessions', `${BOT_NATIVE_ID}.jsonl`),
    JSON.stringify({ type: 'session', version: 3, id: BOT_NATIVE_ID, cwd: hubHome, timestamp: '2026-11-23T10:00:00.000Z' }) + '\n',
  );
  const beelink = await boot(hubHome, await freePort(), { PI_DISH_REVIEW_GRACE_MS: String(GRACE_MS) });
  t.after(() => { try { beelink.child.kill('SIGKILL'); } catch {} });

  // Seed a worker session on framework with beelink + an unreachable peer configured in remotes.
  const workerSessions = path.join(workerHome, '.pi', 'agent', 'sessions', 'worker');
  fs.mkdirSync(workerSessions, { recursive: true });
  fs.writeFileSync(
    path.join(workerSessions, `${WORKER_SESSION_ID}.jsonl`),
    JSON.stringify({ type: 'session', cwd: workerHome, timestamp: '2026-11-23T10:05:00.000Z' }) + '\n',
  );
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
  t.after(() => { try { framework.child.kill('SIGKILL'); } catch {} });

  const hubHeaders = { Authorization: `Bearer ${HUB_TOKEN}` };
  const botReviewsUrl = `${beelink.base}/api/sessions/${encodeURIComponent(BOT_ROUTE_ID)}/reviews`;
  const noMediaDeck = { ...DECK, cards: DECK.cards.map(item => ({ ...item, media: [] })) };

  // Post and answer one review on the bot's session on beelink.
  const createdRes = await post(botReviewsUrl, { ...noMediaDeck, title: 'OSBG review', wait: false }, hubHeaders);
  assert.equal(createdRes.status, 201, await createdRes.clone().text());
  const reviewId = String(record((await json(createdRes)).review).id);
  const submitRes = await post(`${botReviewsUrl}/${reviewId}/submit`, {
    submissionId: 'sub-osbg-0001',
    answers: { ...DEFAULTS, quick_mag: { value: 'vial', note: 'beelink pick' } },
  }, hubHeaders);
  assert.equal(submitRes.status, 202);

  // Helper that runs pi-dish-review from the worker on framework (NO beelink URL, NO beelink token).
  const workerCli = (args: string[], extraEnv: NodeJS.ProcessEnv = {}) =>
    cli(args, undefined, { HOME: workerHome, PI_DISH_URL: framework.base, PI_DISH_SESSION_ID: WORKER_SESSION_ID, ...extraEnv });

  // 1. Bare `answers <reviewId>` (the exact failing command reported by OSBG) finds it via peer relay.
  const bare = workerCli(['answers', reviewId]);
  assert.equal(await bare.exited, 0, bare.stderr());
  const bareParsed = record(JSON.parse(bare.stdout()));
  assert.equal(bareParsed.reviewId, reviewId);
  assert.equal(bareParsed.status, 'submitted');
  assert.deepEqual(record(bareParsed.answers).quick_mag, { value: 'vial', default: false, note: 'beelink pick' });

  // 2. `answers <reviewId> --session <botRouteId>` (the second failing command) and short native ref both resolve across peers.
  for (const sessionArg of [BOT_ROUTE_ID, BOT_NATIVE_ID, `beelink/${BOT_NATIVE_ID}`, `${HUB_HOST_ID}:${BOT_ROUTE_ID}`]) {
    const withSess = workerCli(['answers', reviewId, '--session', sessionArg]);
    assert.equal(await withSess.exited, 0, `--session ${sessionArg}: ${withSess.stderr()}`);
    assert.equal(record(JSON.parse(withSess.stdout())).reviewId, reviewId);
  }

  // 3. Explicit host addressing (`beelink/<id>` and `--host beelink`) and running outside any local session.
  for (const argv of [[`answers`, `beelink/${reviewId}`], ['answers', reviewId, '--host', 'beelink']]) {
    const explicit = workerCli(argv);
    assert.equal(await explicit.exited, 0, `${argv.join(' ')}: ${explicit.stderr()}`);
    assert.equal(record(JSON.parse(explicit.stdout())).reviewId, reviewId);
  }
  const emptyHome = createTestTempDir('pi-dish-reviews-nosess-');
  const noSession = workerCli(['answers', reviewId], { HOME: emptyHome, PI_DISH_SESSION_ID: '' });
  assert.equal(await noSession.exited, 0, noSession.stderr());
  assert.equal(record(JSON.parse(noSession.stdout())).reviewId, reviewId);

  // 4. `wait` and `cancel` also work across hosts on bare review ids.
  const openWaitRes = await post(botReviewsUrl, { ...noMediaDeck, title: 'OSBG remote wait', wait: true }, hubHeaders);
  assert.equal(openWaitRes.status, 201);
  const waitId = String(record((await json(openWaitRes)).review).id);
  const waiting = workerCli(['wait', waitId, '--timeout', '15']);
  await pause(250);
  assert.equal((await post(`${botReviewsUrl}/${waitId}/submit`, { submissionId: 'sub-osbg-wait1', answers: DEFAULTS }, hubHeaders)).status, 202);
  assert.equal(await waiting.exited, 0, waiting.stderr());
  assert.equal(record(JSON.parse(waiting.stdout())).status, 'submitted');

  const openCancelRes = await post(botReviewsUrl, { ...noMediaDeck, title: 'OSBG remote cancel', wait: false }, hubHeaders);
  assert.equal(openCancelRes.status, 201);
  const cancelId = String(record((await json(openCancelRes)).review).id);
  const cancelling = workerCli(['cancel', cancelId]);
  assert.equal(await cancelling.exited, 0, cancelling.stderr());
  assert.match(cancelling.stdout(), new RegExp(`review ${cancelId} withdrawn`));
  assert.equal(record((await json(await fetch(`${botReviewsUrl}/${cancelId}`, { headers: hubHeaders }))).review).status, 'cancelled');

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

test('mixed-version peer without /api/reviews/:id falls back through launch provenance', async t => {
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
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => fake.close(() => resolve())));
  const address = fake.address();
  assert.ok(address && typeof address !== 'string');
  const fakeBase = `http://127.0.0.1:${address.port}`;

  const run = cli(['answers', reviewId], undefined, { PI_DISH_URL: fakeBase, PI_DISH_SESSION_ID: WORKER_ID });
  assert.equal(await run.exited, 0, run.stderr());
  assert.equal(record(JSON.parse(run.stdout())).reviewId, reviewId);
  assert.deepEqual(record(record(JSON.parse(run.stdout())).answers).quick_mag, { value: 'tab', default: true });
});

test('unqualified --session carries on to peers on local miss or pre-reviews local 404, while host-qualified stays pinned', async t => {
  const reviewId = 'rv_1122334455667788';
  const SHARED_SESSION = '2026-11-23T12-00-00-shared01';
  let localMode: 'no-such-review' | 'pre-reviews' = 'no-such-review';
  let peerCalls = 0;
  const fake = http.createServer((req, res) => {
    const url = req.url ?? '';
    res.setHeader('Content-Type', 'application/json');
    if (url === '/api/host') return res.end(JSON.stringify({ hostId: '22222222-3333-4444-8555-666666666666', label: 'framework', capabilities: { reviewsV1: true } }));
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
      if (localMode === 'pre-reviews') { res.setHeader('Content-Type', 'text/plain'); return res.end('Not found'); }
      return res.end(JSON.stringify({ error: 'no such review' }));
    }
    if (url.startsWith('/hosts/beelink/')) peerCalls++;
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
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => fake.close(() => resolve())));
  const address = fake.address();
  assert.ok(address && typeof address !== 'string');
  const fakeBase = `http://127.0.0.1:${address.port}`;

  // 1. Local session exists but has no such review -> unqualified --session discovers it on beelink.
  const fromPeer = cli(['answers', reviewId, '--session', SHARED_SESSION], undefined, { PI_DISH_URL: fakeBase, PI_DISH_SESSION_ID: 'other-local' });
  assert.equal(await fromPeer.exited, 0, fromPeer.stderr());
  assert.equal(record(JSON.parse(fromPeer.stdout())).reviewId, reviewId);
  assert.ok(peerCalls > 0);

  // 2. Pre-reviews local server (bodiless 404) -> unqualified --session still discovers it on beelink.
  localMode = 'pre-reviews';
  const fromPreReviews = cli(['answers', reviewId, '--session', SHARED_SESSION], undefined, { PI_DISH_URL: fakeBase, PI_DISH_SESSION_ID: 'other-local' });
  assert.equal(await fromPreReviews.exited, 0, fromPreReviews.stderr());
  assert.equal(record(JSON.parse(fromPreReviews.stdout())).reviewId, reviewId);

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

test('empty or malformed HTTP 200 peer is skipped in favor of a valid peer, and fails non-zero when none is valid', async t => {
  const reviewId = 'rv_2233445566778899';
  const OWNER_SESSION = '2026-11-23T12-30-00-valid001';
  let goodEnabled = true;
  let badBody: unknown = {};
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
    if (url === `/api/reviews/${reviewId}`) { res.statusCode = 404; return res.end(JSON.stringify({ error: 'no such review' })); }
    if (url === `/hosts/badpeer/api/reviews/${reviewId}`) return res.end(JSON.stringify(badBody));
    if (url === `/hosts/goodpeer/api/reviews/${reviewId}`) {
      return res.end(JSON.stringify({
        review: { id: reviewId, sessionId: OWNER_SESSION, status: 'submitted' },
        result: { reviewId, status: 'submitted', answers: { quick_mag: { value: 'tab', default: true } } },
      }));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'no such review' }));
  });
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => fake.close(() => resolve())));
  const address = fake.address();
  assert.ok(address && typeof address !== 'string');
  const fakeBase = `http://127.0.0.1:${address.port}`;

  // 1. First peer returns empty HTTP 200 {}, second peer returns valid review -> valid peer wins.
  const skippedEmpty = cli(['answers', reviewId], undefined, { PI_DISH_URL: fakeBase, PI_DISH_SESSION_ID: '' });
  assert.equal(await skippedEmpty.exited, 0, skippedEmpty.stderr());
  assert.equal(record(JSON.parse(skippedEmpty.stdout())).reviewId, reviewId);

  // 2. First peer returns mismatched review id -> skipped, valid peer wins.
  badBody = {
    review: { id: 'rv_0000000000000000', sessionId: OWNER_SESSION, status: 'submitted' },
    result: { reviewId: 'rv_0000000000000000', status: 'submitted', answers: {} },
  };
  const skippedWrongId = cli(['answers', reviewId], undefined, { PI_DISH_URL: fakeBase, PI_DISH_SESSION_ID: '' });
  assert.equal(await skippedWrongId.exited, 0, skippedWrongId.stderr());
  assert.equal(record(JSON.parse(skippedWrongId.stdout())).reviewId, reviewId);

  // 3. Only the empty-200 peer exists -> never prints {} or exits 0.
  goodEnabled = false;
  badBody = {};
  const onlyBad = cli(['answers', reviewId], undefined, { PI_DISH_URL: fakeBase, PI_DISH_SESSION_ID: '' });
  assert.equal(await onlyBad.exited, 1);
  assert.equal(onlyBad.stdout().trim(), '');
  assert.match(onlyBad.stderr(), /badpeer \(malformed review response/);
});

test('stalled peer bodies obey the end-to-end discovery deadline and wait --timeout counts discovery time', async t => {
  const reviewId = 'rv_33445566778899aa';
  const OWNER_SESSION = '2026-11-23T13-00-00-owner001';
  let goodPeerMode: 'absent' | 'submitted' | 'slow-open' = 'submitted';
  const openSockets = new Set<net.Socket>();
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
      if (req.socket) openSockets.add(req.socket);
      req.on('close', () => { if (req.socket) openSockets.delete(req.socket); });
      return;
    }
    if (url === `/hosts/beelink/api/sessions/resolve?id=${OWNER_SESSION}`) {
      return res.end(JSON.stringify({ session: { id: OWNER_SESSION, name: 'Beelink owner' } }));
    }
    if (url === `/hosts/beelink/api/reviews/${reviewId}` || url === `/hosts/beelink/api/sessions/${OWNER_SESSION}/reviews/${reviewId}`) {
      if (goodPeerMode === 'slow-open') {
        const timer = setTimeout(() => {
          if (res.destroyed) return;
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
        if (!res.writableEnded && !res.destroyed) res.end(JSON.stringify({ result: { reviewId, status: 'open' } }));
      }, 5000);
      timer.unref();
      req.on('close', () => clearTimeout(timer));
      return;
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: url.includes('/sessions/') && !url.includes('/reviews/') ? 'Session not found' : 'no such review' }));
  });
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    for (const sock of openSockets) { try { sock.destroy(); } catch {} }
    await new Promise<void>(resolve => fake.close(() => resolve()));
  });
  const address = fake.address();
  assert.ok(address && typeof address !== 'string');
  const fakeBase = `http://127.0.0.1:${address.port}`;

  // 1. Stalled peer does not delay a healthy peer on either bare lookup or --session fan-out.
  const tFast = Date.now();
  const fastBare = cli(['answers', reviewId], undefined, { PI_DISH_URL: fakeBase, PI_DISH_SESSION_ID: '' });
  assert.equal(await fastBare.exited, 0, fastBare.stderr());
  assert.equal(record(JSON.parse(fastBare.stdout())).reviewId, reviewId);
  assert.ok(Date.now() - tFast < 3000, 'healthy peer won without waiting for stalled peer');

  const tSess = Date.now();
  const fastSess = cli(['answers', reviewId, '--session', OWNER_SESSION], undefined, { PI_DISH_URL: fakeBase, PI_DISH_SESSION_ID: '' });
  assert.equal(await fastSess.exited, 0, fastSess.stderr());
  assert.equal(record(JSON.parse(fastSess.stdout())).reviewId, reviewId);
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
  let mode: 'recover' | 'always-drop' = 'recover';
  const fake = http.createServer((req, res) => {
    attempts++;
    assert.equal(req.headers['x-pi-dish-client'], '1', 'CLI sends CSRF header on wait');
    if (mode === 'always-drop' || attempts === 1) {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.flushHeaders();
      req.socket.destroy();
      return;
    }
    if (attempts === 2) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
    if (attempts === 3) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ result: { status: 'submitted' } })); return; }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      result: { reviewId, status: 'submitted', answers: { quick_mag: { value: 'vial', default: false } }, delivery: { state: 'delivered', via: 'waiter', at: 1, error: null } },
    }));
  });
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
  const address = fake.address();
  assert.ok(address && typeof address !== 'string');
  const fakeBase = `http://127.0.0.1:${address.port}`;
  try {
    const recovered = cli(['wait', reviewId], undefined, {
      PI_DISH_URL: fakeBase, PI_DISH_REVIEW_WAIT_RETRY_MS: '10', PI_DISH_REVIEW_WAIT_RETRIES: '5',
    });
    assert.equal(await recovered.exited, 0, recovered.stderr());
    assert.equal(attempts, 4);
    assert.deepEqual(record(JSON.parse(recovered.stdout())).answers, { quick_mag: { value: 'vial', default: false } });

    mode = 'always-drop';
    attempts = 0;
    const exhausted = cli(['wait', reviewId], undefined, {
      PI_DISH_URL: fakeBase, PI_DISH_REVIEW_WAIT_RETRY_MS: '10', PI_DISH_REVIEW_WAIT_RETRIES: '2',
    });
    assert.equal(await exhausted.exited, 1, 'never exits 0 without answers');
    assert.equal(exhausted.stdout().trim(), '', 'does not print {}');
    assert.match(exhausted.stderr(), /wait response ended without a review result/);
  } finally {
    await new Promise<void>(resolve => fake.close(() => resolve()));
  }
});

test('failed waiter writes stay pending for message fallback, and timer settle failures are caught and logged', async t => {
  const prevHome = process.env.HOME;
  const unitHome = createTestTempDir('pi-dish-reviews-unit-');
  process.env.HOME = unitHome;
  const graceMs = 120;
  // Control both setTimeout and Date so the grace-period fallback cannot race wall-clock stalls.
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.now() });
  const delivered: string[] = [];
  const logs: string[] = [];
  const logWaiters: Array<(line: string) => void> = [];
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => { unhandled.push(reason); };
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
      for (const notify of logWaiters.splice(0)) notify(line);
    },
    graceMs,
  });

  const waitForSettledDelivery = (reviewId: string) => new Promise<void>(resolve => {
    const isDelivered = () => reviews.readReviews(SESSION_ID).find(item => item.id === reviewId)?.submission?.delivery.state === 'delivered';
    if (isDelivered()) return resolve();
    const unsubscribe = handlers.subscribe(SESSION_ID, ({ review }) => {
      if (review.id === reviewId && review.submission?.delivery.state === 'delivered') {
        unsubscribe();
        resolve();
      }
    });
  });

  const waitForLog = (reviewId: string) => new Promise<void>(resolve => {
    if (logs.some(line => line.includes(reviewId))) return resolve();
    const onLine = (line: string) => {
      if (line.includes(reviewId)) resolve();
      else logWaiters.push(onLine);
    };
    logWaiters.push(onLine);
  });

  function mockReq(overrides: Record<string, unknown> = {}): ApplicationRequest {
    return {
      method: 'POST', params: { id: SESSION_ID }, query: {}, headers: { 'x-pi-dish-client': '1' }, body: {},
      ...overrides,
    } as unknown as ApplicationRequest;
  }
  function mockRes(options: { failWrite?: boolean; delayWrite?: boolean } = {}) {
    const emitter = new EventEmitter();
    let statusCode = 200;
    let body = '';
    let pendingEnd: (() => void) | null = null;
    const res = Object.assign(emitter, {
      writableEnded: false,
      writableFinished: false,
      destroyed: false,
      socket: { destroyed: false },
      status(code: number) { statusCode = code; return res; },
      type() { return res; },
      setHeader() { return res; },
      flushHeaders() {},
      destroy() {
        res.destroyed = true;
        res.socket.destroyed = true;
        res.emit('close');
        return res;
      },
      json(value: unknown) { body = JSON.stringify(value); res.writableEnded = true; res.writableFinished = true; return res; },
      end(chunk?: string, cb?: () => void) {
        if (options.failWrite) {
          res.destroyed = true;
          res.socket.destroyed = true;
          res.emit('error', new Error('EPIPE'));
          res.emit('close');
          cb?.();
          return res;
        }
        if (chunk) body += chunk;
        if (options.delayWrite) {
          res.writableEnded = true;
          pendingEnd = () => {
            if (!res.destroyed) res.writableFinished = true;
            cb?.();
          };
          return res;
        }
        res.writableEnded = true;
        res.writableFinished = true;
        cb?.();
        return res;
      },
    });
    return {
      res: res as unknown as ApplicationResponse,
      status: () => statusCode,
      body: () => body,
      finishWrite: () => { const fn = pendingEnd; pendingEnd = null; fn?.(); },
      raw: res,
    };
  }

  const noMediaDeck = { ...DECK, cards: DECK.cards.map(item => ({ ...item, media: [] })) };
  try {
    // 1. Live waiter whose res.end fails: delivery stays pending, fallback timer delivers via message.
    const c1 = mockRes();
    await handlers.create(mockReq({ body: { ...noMediaDeck, title: 'Broken live waiter', wait: true } }), c1.res, () => {});
    assert.equal(c1.status(), 201);
    const id1 = String(record(JSON.parse(c1.body()).review).id);
    const brokenWait1 = mockRes({ failWrite: true });
    await handlers.wait(mockReq({ method: 'GET', params: { id: SESSION_ID, reviewId: id1 }, query: { timeout: '10' } }), brokenWait1.res, () => {});
    const s1 = mockRes();
    await handlers.submit(mockReq({ params: { id: SESSION_ID, reviewId: id1 }, body: { submissionId: 'sub-fail-01', answers: DEFAULTS } }), s1.res, () => {});
    assert.equal(s1.status(), 202);
    assert.equal(reviews.readReviews(SESSION_ID).find(item => item.id === id1)?.submission?.delivery.state, 'pending',
      'failed waiter write does not mark delivered');
    t.mock.timers.tick(graceMs - 1);
    assert.equal(reviews.readReviews(SESSION_ID).find(item => item.id === id1)?.submission?.delivery.state, 'pending',
      'delivery stays pending before grace period expires');
    const settled1 = waitForSettledDelivery(id1);
    t.mock.timers.tick(1);
    await settled1;
    assert.ok(delivered.some(msg => msg.includes(id1)), 'fallback message after broken live waiter');
    assert.equal(reviews.readReviews(SESSION_ID).find(item => item.id === id1)?.submission?.delivery.via, 'message');

    // 2. Late GET /wait claiming a pending review whose res.end fails: still falls back to message.
    const c2 = mockRes();
    await handlers.create(mockReq({ body: { ...noMediaDeck, title: 'Broken late waiter', wait: true } }), c2.res, () => {});
    const id2 = String(record(JSON.parse(c2.body()).review).id);
    await handlers.submit(mockReq({ params: { id: SESSION_ID, reviewId: id2 }, body: { submissionId: 'sub-fail-02', answers: DEFAULTS } }), mockRes().res, () => {});
    const brokenWait2 = mockRes({ failWrite: true });
    await handlers.wait(mockReq({ method: 'GET', params: { id: SESSION_ID, reviewId: id2 } }), brokenWait2.res, () => {});
    assert.equal(reviews.readReviews(SESSION_ID).find(item => item.id === id2)?.submission?.delivery.state, 'pending',
      'failed late waiter write leaves delivery pending');
    t.mock.timers.tick(graceMs - 1);
    assert.equal(reviews.readReviews(SESSION_ID).find(item => item.id === id2)?.submission?.delivery.state, 'pending',
      'late waiter fallback waits out grace period');
    const settled2 = waitForSettledDelivery(id2);
    t.mock.timers.tick(1);
    await settled2;
    assert.ok(delivered.some(msg => msg.includes(id2)), 'fallback message after broken late waiter');
    assert.equal(reviews.readReviews(SESSION_ID).find(item => item.id === id2)?.submission?.delivery.via, 'message');

    // 3. Timer-driven settle failure (unreadable store) is caught and logged with no unhandled rejection.
    const c3 = mockRes();
    await handlers.create(mockReq({ body: { ...noMediaDeck, title: 'Corrupt timer', wait: true } }), c3.res, () => {});
    const id3 = String(record(JSON.parse(c3.body()).review).id);
    await handlers.submit(mockReq({ params: { id: SESSION_ID, reviewId: id3 }, body: { submissionId: 'sub-fail-03', answers: DEFAULTS } }), mockRes().res, () => {});
    const storeFile = path.join(unitHome, '.pi', 'dish', 'reviews', `${crypto.createHash('sha256').update(SESSION_ID).digest('hex').slice(0, 32)}.json`);
    const backup = fs.readFileSync(storeFile, 'utf8');
    fs.writeFileSync(storeFile, '{corrupt');
    const logged3 = waitForLog(id3);
    t.mock.timers.tick(graceMs);
    await logged3;
    assert.equal(unhandled.length, 0, 'no unhandled promise rejection from timer-driven settle');
    fs.writeFileSync(storeFile, backup);
    assert.equal(reviews.readReviews(SESSION_ID).find(item => item.id === id3)?.submission?.delivery.state, 'pending',
      'answer stays pending and recoverable');

    // 4. Delayed successful live waiter write outlasting graceMs completes via waiter without duplicate fallback.
    const deliveredBefore4 = delivered.length;
    const c4 = mockRes();
    await handlers.create(mockReq({ body: { ...noMediaDeck, title: 'Slow live waiter', wait: true } }), c4.res, () => {});
    const id4 = String(record(JSON.parse(c4.body()).review).id);
    const slowWait4 = mockRes({ delayWrite: true });
    await handlers.wait(mockReq({ method: 'GET', params: { id: SESSION_ID, reviewId: id4 }, query: { timeout: '10', outcomes: '1' } }), slowWait4.res, () => {});
    const r4 = mockRes();
    await handlers.reject(mockReq({ params: { id: SESSION_ID, reviewId: id4 }, body: { resolutionId: 'res-slow-01', reason: 'Wait for write' } }), r4.res, () => {});
    assert.equal(r4.status(), 202);
    // Outlast graceMs significantly while the socket write is still in flight.
    t.mock.timers.tick(graceMs * 3);
    assert.equal(delivered.length, deliveredBefore4, 'fallback does not fire while a live waiter write is still in flight');
    assert.equal(reviews.readReviews(SESSION_ID).find(item => item.id === id4)?.resolution?.delivery.state, 'pending');
    slowWait4.finishWrite();
    assert.equal(reviews.readReviews(SESSION_ID).find(item => item.id === id4)?.resolution?.delivery.via, 'waiter');
    assert.equal(reviews.readReviews(SESSION_ID).find(item => item.id === id4)?.resolution?.delivery.state, 'delivered');
    t.mock.timers.tick(graceMs * 10);
    assert.equal(delivered.length, deliveredBefore4, 'no duplicate fallback after delayed successful write');

    // 5. Delayed successful late waiter write also prevents duplicate fallback.
    const deliveredBefore5 = delivered.length;
    const c5 = mockRes();
    await handlers.create(mockReq({ body: { ...noMediaDeck, title: 'Slow late waiter', wait: true } }), c5.res, () => {});
    const id5 = String(record(JSON.parse(c5.body()).review).id);
    await handlers.dismiss(mockReq({ params: { id: SESSION_ID, reviewId: id5 }, body: { resolutionId: 'res-slow-02' } }), mockRes().res, () => {});
    const slowWait5 = mockRes({ delayWrite: true });
    await handlers.wait(mockReq({ method: 'GET', params: { id: SESSION_ID, reviewId: id5 }, query: { outcomes: '1' } }), slowWait5.res, () => {});
    t.mock.timers.tick(graceMs * 3);
    assert.equal(delivered.length, deliveredBefore5, 'fallback waits for delayed late waiter write');
    slowWait5.finishWrite();
    assert.equal(reviews.readReviews(SESSION_ID).find(item => item.id === id5)?.resolution?.delivery.via, 'waiter');
    assert.equal(delivered.length, deliveredBefore5);

    // 6. Wedged waiter write past maxWriteMs is explicitly terminated before fallback, and late completion cannot override.
    const c6 = mockRes();
    await handlers.create(mockReq({ body: { ...noMediaDeck, title: 'Hung waiter', wait: true } }), c6.res, () => {});
    const id6 = String(record(JSON.parse(c6.body()).review).id);
    const hungWait6 = mockRes({ delayWrite: true });
    await handlers.wait(mockReq({ method: 'GET', params: { id: SESSION_ID, reviewId: id6 }, query: { timeout: '10', outcomes: '1' } }), hungWait6.res, () => {});
    await handlers.dismiss(mockReq({ params: { id: SESSION_ID, reviewId: id6 }, body: { resolutionId: 'res-hung-01' } }), mockRes().res, () => {});
    const settled6 = new Promise<void>(resolve => {
      const unsubscribe = handlers.subscribe(SESSION_ID, ({ review }) => {
        if (review.id === id6 && review.resolution?.delivery.state === 'delivered') {
          unsubscribe();
          resolve();
        }
      });
    });
    t.mock.timers.tick(30_000);
    await settled6;
    assert.equal(hungWait6.raw.destroyed, true, 'wedged write socket is terminated before fallback');
    assert.equal(reviews.readReviews(SESSION_ID).find(item => item.id === id6)?.resolution?.delivery.via, 'message');
    hungWait6.finishWrite();
    assert.equal(reviews.readReviews(SESSION_ID).find(item => item.id === id6)?.resolution?.delivery.via, 'message');

    // 7. Two waiters: independent write deadlines — one finishing never leaves another hung, and staggered deadlines act independently.
    const deliveredBefore7 = delivered.length;
    const c7a = mockRes();
    await handlers.create(mockReq({ body: { ...noMediaDeck, title: 'Two waiters fast+hung', wait: true } }), c7a.res, () => {});
    const id7a = String(record(JSON.parse(c7a.body()).review).id);
    const fastWait = mockRes({ delayWrite: true });
    const hungSecondWait = mockRes({ delayWrite: true });
    await handlers.wait(mockReq({ method: 'GET', params: { id: SESSION_ID, reviewId: id7a }, query: { timeout: '10', outcomes: '1' } }), fastWait.res, () => {});
    await handlers.wait(mockReq({ method: 'GET', params: { id: SESSION_ID, reviewId: id7a }, query: { timeout: '10', outcomes: '1' } }), hungSecondWait.res, () => {});
    await handlers.reject(mockReq({ params: { id: SESSION_ID, reviewId: id7a }, body: { resolutionId: 'res-two-01', reason: 'Two waiters' } }), mockRes().res, () => {});
    // First waiter finishes right away, marking delivered and clearing the shared fallback timer.
    fastWait.finishWrite();
    assert.equal(reviews.readReviews(SESSION_ID).find(item => item.id === id7a)?.resolution?.delivery.via, 'waiter');
    assert.equal(hungSecondWait.raw.destroyed, false);
    // Second waiter's independent write deadline still terminates its hung socket.
    t.mock.timers.tick(30_000);
    assert.equal(hungSecondWait.raw.destroyed, true, 'second hung waiter is terminated on its own deadline after first waiter finished');
    assert.equal(delivered.length, deliveredBefore7, 'no duplicate fallback message');

    // Staggered deadlines: early hung waiter times out without prematurely aborting or triggering fallback against a later live waiter.
    const c7b = mockRes();
    await handlers.create(mockReq({ body: { ...noMediaDeck, title: 'Two waiters staggered', wait: true } }), c7b.res, () => {});
    const id7b = String(record(JSON.parse(c7b.body()).review).id);
    const earlyHung = mockRes({ delayWrite: true });
    await handlers.wait(mockReq({ method: 'GET', params: { id: SESSION_ID, reviewId: id7b }, query: { timeout: '10', outcomes: '1' } }), earlyHung.res, () => {});
    await handlers.dismiss(mockReq({ params: { id: SESSION_ID, reviewId: id7b }, body: { resolutionId: 'res-two-02' } }), mockRes().res, () => {});
    t.mock.timers.tick(10_000);
    const lateSlow = mockRes({ delayWrite: true });
    await handlers.wait(mockReq({ method: 'GET', params: { id: SESSION_ID, reviewId: id7b }, query: { outcomes: '1' } }), lateSlow.res, () => {});
    t.mock.timers.tick(20_000); // t=30_000: earlyHung expires; lateSlow still has 10_000ms left.
    assert.equal(earlyHung.raw.destroyed, true, 'early hung waiter expires at its own deadline');
    assert.equal(lateSlow.raw.destroyed, false, 'later waiter keeps its own independent deadline');
    assert.equal(delivered.length, deliveredBefore7, 'fallback holds while the second waiter is still live');
    lateSlow.finishWrite();
    assert.equal(reviews.readReviews(SESSION_ID).find(item => item.id === id7b)?.resolution?.delivery.via, 'waiter');
    t.mock.timers.tick(30_000);
    assert.equal(delivered.length, deliveredBefore7);

    // 8. Non-object bodies (null, array, primitives) return 400 before changing state.
    const c8 = mockRes();
    await handlers.create(mockReq({ body: { ...noMediaDeck, title: 'Bad body unit', wait: false } }), c8.res, () => {});
    const id8 = String(record(JSON.parse(c8.body()).review).id);
    for (const badBody of [null, [], 'text', 123, true]) {
      const rejRes = mockRes();
      await handlers.reject(mockReq({ params: { id: SESSION_ID, reviewId: id8 }, body: badBody }), rejRes.res, () => {});
      assert.equal(rejRes.status(), 400);
      const disRes = mockRes();
      await handlers.dismiss(mockReq({ params: { id: SESSION_ID, reviewId: id8 }, body: badBody }), disRes.res, () => {});
      assert.equal(disRes.status(), 400);
    }
    assert.equal(reviews.readReviews(SESSION_ID).find(item => item.id === id8)?.status, 'open');
  } finally {
    handlers.stop();
    t.mock.timers.reset();
    process.off('unhandledRejection', onUnhandled);
    process.env.HOME = prevHome;
  }
});

test('reject and dismiss: live CLI waiter, fallback messages, answers CLI, idempotency, races with submit, body validation, terminal escaping, and legacy skew', async () => {
  const noMediaDeck = { ...DECK, cards: DECK.cards.map(item => ({ ...item, media: [] })) };

  // 1. Live waiting CLI gets REJECTED with reason via hub, exits 2, no duplicate message; wire review keeps legacy closed status `'cancelled'` + `outcome`.
  const beforeReject = prompts.length;
  const waitReject = cli(['ask', '-'], { ...noMediaDeck, title: 'Reject waited deck' });
  const rejectTarget = await openReview('Reject waited deck');
  const rejectId = String(rejectTarget.id);
  const badReason = await post(viaHub(`/${rejectId}/reject`), { resolutionId: 'res-too-long1', reason: 'x'.repeat(501) });
  assert.equal(badReason.status, 400);

  // Malformed JSON bodies return 400; unsupported non-empty media types (including +json) return 415 without resolving the deck.
  const arrayReject = await post(api(owner, `/${rejectId}/reject`), ['not', 'an', 'object']);
  assert.equal(arrayReject.status, 400);
  const arrayDismiss = await post(api(owner, `/${rejectId}/dismiss`), []);
  assert.equal(arrayDismiss.status, 400);
  const problemJsonReject = await fetch(api(owner, `/${rejectId}/reject`), {
    method: 'POST', headers: { 'Content-Type': 'application/problem+json', ...CLIENT_HEADER }, body: JSON.stringify({ reason: 'must not be dropped' }),
  });
  assert.equal(problemJsonReject.status, 415);
  const problemJsonDismiss = await fetch(api(owner, `/${rejectId}/dismiss`), {
    method: 'POST', headers: { 'Content-Type': 'application/problem+json', ...CLIENT_HEADER }, body: JSON.stringify({ resolutionId: 'res-prob-01' }),
  });
  assert.equal(problemJsonDismiss.status, 415);
  const textReject = await fetch(api(owner, `/${rejectId}/reject`), {
    method: 'POST', headers: { 'Content-Type': 'text/plain', ...CLIENT_HEADER }, body: 'plain text',
  });
  assert.equal(textReject.status, 415);
  const textDismiss = await fetch(api(owner, `/${rejectId}/dismiss`), {
    method: 'POST', headers: { 'Content-Type': 'text/plain', ...CLIENT_HEADER }, body: 'plain text',
  });
  assert.equal(textDismiss.status, 415);
  assert.equal(record((await json(await fetch(api(owner, `/${rejectId}`)))).review).status, 'open');

  const rawReason = 'Wrong direction\x1b[2K\rFAKE\u202eDROP';
  const sseEvents = sseReader(`${owner}/api/sessions/${SESSION_ID}/stream`);
  let rejectedWire: Record<string, unknown>;
  try {
    await sseEvents.waitFor(event => event.event === 'init');
    const rejected = await post(viaHub(`/${rejectId}/reject`), { resolutionId: 'res-reject-01', reason: rawReason });
    assert.equal(rejected.status, 202);
    rejectedWire = record((await json(rejected)).review);
    assert.equal(rejectedWire.status, 'cancelled', 'wire status stays legacy-recognized cancelled');
    assert.equal(rejectedWire.outcome, 'rejected');
    assert.equal(record(rejectedWire.resolution).outcome, 'rejected');
    const sseUpdate = await sseEvents.waitFor(event => event.event === 'review_updated' && record(record(event.data).review).id === rejectId);
    const sseReview = record(record(sseUpdate.data).review);
    assert.equal(sseReview.status, 'cancelled', 'SSE review_updated carries legacy closed status');
    assert.equal(sseReview.outcome, 'rejected');
  } finally { sseEvents.close(); }

  // CLI human-readable output escapes terminal controls while preserving raw reason in JSON.
  assert.equal(await waitReject.exited, 2, waitReject.stderr());
  assert.match(waitReject.stdout(), /REJECTED by the user/);
  assert.ok(!waitReject.stdout().includes('\x1b'), 'CLI human output must not contain raw ESC');
  assert.ok(!waitReject.stdout().includes('\u202e'), 'CLI human output must not contain raw bidi override');
  assert.match(waitReject.stdout(), /Wrong direction\\x1b\[2K/);
  assert.match(waitReject.stdout(), /\\u202eDROP/);
  await pause(GRACE_MS + 300);
  assert.equal(prompts.length, beforeReject, 'no fallback message when a live waiter took the rejection');

  // `pi-dish-review answers <id>` exits 0 and preserves raw reason in structured JSON.
  const rejectAnswers = cli(['answers', rejectId]);
  assert.equal(await rejectAnswers.exited, 0, rejectAnswers.stderr());
  const rejectParsed = record(JSON.parse(rejectAnswers.stdout()));
  assert.equal(rejectParsed.status, 'rejected');
  assert.equal(rejectParsed.reason, rawReason);
  assert.deepEqual(rejectParsed.answers, {});
  assert.equal(record(rejectParsed.delivery).via, 'waiter');

  // GET /reviews list also emits legacy closed status `'cancelled'` + `outcome: 'rejected'`.
  const listedAfterReject = (await json(await fetch(api(owner)))).reviews as Record<string, unknown>[];
  const listedItem = listedAfterReject.find(item => item.id === rejectId);
  assert.equal(listedItem?.status, 'cancelled');
  assert.equal(listedItem?.outcome, 'rejected');

  // Idempotent repeat with same resolutionId -> 200; conflicting ids/actions -> 409 with legacy-closed winning review.
  const repeatReject = await post(api(owner, `/${rejectId}/reject`), { resolutionId: 'res-reject-01', reason: rawReason });
  assert.equal(repeatReject.status, 200);
  assert.equal((await json(repeatReject)).repeated, true);
  for (const [label, res] of [
    ['reject different id', await post(api(owner, `/${rejectId}/reject`), { resolutionId: 'res-reject-02', reason: 'Other' })],
    ['reject no id different reason', await post(api(owner, `/${rejectId}/reject`), { reason: 'Other' })],
    ['dismiss after reject', await post(api(owner, `/${rejectId}/dismiss`), { resolutionId: 'res-dismiss-1' })],
    ['submit after reject', await post(api(owner, `/${rejectId}/submit`), { submissionId: 'sub-after-rej', answers: DEFAULTS })],
    ['cancel after reject', await post(api(owner, `/${rejectId}/cancel`), {})],
  ] as const) {
    assert.equal(res.status, 409, label);
    const body = await json(res);
    assert.equal(body.code, 'rejected', label);
    assert.equal(record(body.review).status, 'cancelled', `${label} carries legacy-closed status`);
    assert.equal(record(body.review).outcome, 'rejected', label);
  }

  // Legacy waiter (without outcomes=1) on already-rejected review gets 409 with escaped reason text and raw reason in JSON result.
  const legacyAlready = await fetch(api(owner, `/${rejectId}/wait?timeout=2`), { headers: CLIENT_HEADER });
  assert.equal(legacyAlready.status, 409);
  const legacyAlreadyBody = await json(legacyAlready);
  assert.equal(legacyAlreadyBody.code, 'rejected');
  assert.ok(!String(legacyAlreadyBody.error).includes('\x1b'), 'legacy 409 error escapes ESC');
  assert.ok(!String(legacyAlreadyBody.error).includes('\u202e'), 'legacy 409 error escapes bidi override');
  assert.match(String(legacyAlreadyBody.error), /Wrong direction\\x1b\[2K/);
  assert.equal(record(legacyAlreadyBody.result).status, 'rejected');
  assert.equal(record(legacyAlreadyBody.result).reason, rawReason);

  // 2. Live waiting CLI with --json gets DISMISSED via hub, exits 3, no duplicate message; absent body is accepted on dismiss/reject.
  const beforeDismiss = prompts.length;
  const waitDismiss = cli(['ask', '-', '--json'], { ...noMediaDeck, title: 'Dismiss waited deck' });
  const dismissTarget = await openReview('Dismiss waited deck');
  const dismissId = String(dismissTarget.id);
  const dismissed = await post(viaHub(`/${dismissId}/dismiss`), { resolutionId: 'res-dismiss-01' });
  assert.equal(dismissed.status, 202);
  assert.equal(await waitDismiss.exited, 3, waitDismiss.stderr());
  const dismissPrinted = record(JSON.parse(waitDismiss.stdout()));
  assert.equal(dismissPrinted.status, 'dismissed');
  assert.equal(dismissPrinted.reason, null);
  assert.deepEqual(dismissPrinted.answers, {});
  assert.equal(record(dismissPrinted.delivery).via, 'waiter');
  await pause(GRACE_MS + 300);
  assert.equal(prompts.length, beforeDismiss, 'no fallback message when a live waiter took the dismissal');

  // Absent body (no Content-Type, no payload) is accepted on both dismiss and reject.
  const emptyDismissCreated = await json(await post(api(owner), { ...noMediaDeck, title: 'Absent body dismiss', wait: false }));
  const emptyDismissId = String(record(emptyDismissCreated.review).id);
  const emptyDismissRes = await fetch(api(owner, `/${emptyDismissId}/dismiss`), { method: 'POST', headers: CLIENT_HEADER });
  assert.equal(emptyDismissRes.status, 202);
  await settled(emptyDismissId);
  const emptyRejectCreated = await json(await post(api(owner), { ...noMediaDeck, title: 'Absent body reject', wait: false }));
  const emptyRejectId = String(record(emptyRejectCreated.review).id);
  const emptyRejectRes = await fetch(api(owner, `/${emptyRejectId}/reject`), { method: 'POST', headers: CLIENT_HEADER });
  assert.equal(emptyRejectRes.status, 202);
  await settled(emptyRejectId);

  // Idempotent repeat dismiss (same id and omitted id) -> 200; conflicting actions -> 409.
  assert.equal((await post(api(owner, `/${dismissId}/dismiss`), { resolutionId: 'res-dismiss-01' })).status, 200);
  assert.equal((await post(api(owner, `/${dismissId}/dismiss`), {})).status, 200);
  assert.equal((await post(api(owner, `/${dismissId}/dismiss`), { resolutionId: 'res-dismiss-02' })).status, 409);
  assert.equal((await post(api(owner, `/${dismissId}/submit`), { submissionId: 'sub-after-dis', answers: DEFAULTS })).status, 409);
  assert.equal((await post(api(owner, `/${dismissId}/reject`), { reason: 'late' })).status, 409);
  assert.equal((await post(api(owner, `/${dismissId}/cancel`), {})).status, 409);

  // 3. Fallback message delivery (no waiter) for both rejected and dismissed.
  const beforeFallback = prompts.length;
  const asyncRejectCreated = await json(await post(api(owner), { ...noMediaDeck, title: 'Async reject deck', wait: false }));
  const asyncRejectId = String(record(asyncRejectCreated.review).id);
  assert.equal((await post(api(owner, `/${asyncRejectId}/reject`), { resolutionId: 'res-async-rej', reason: 'Too complex' })).status, 202);
  const settledReject = await settled(asyncRejectId);
  assert.equal(record(record(settledReject.resolution).delivery).via, 'message');
  assert.equal(prompts.length, beforeFallback + 1);
  assert.match(prompts[beforeFallback], new RegExp(`^\\[review response: Async reject deck \\(${asyncRejectId}\\), REJECTED by the user at [^\\]]+\\]\\nreason: Too complex\\n`));

  const asyncDismissCreated = await json(await post(api(owner), { ...noMediaDeck, title: 'Async dismiss deck', wait: false }));
  const asyncDismissId = String(record(asyncDismissCreated.review).id);
  assert.equal((await post(api(owner, `/${asyncDismissId}/dismiss`), { resolutionId: 'res-async-dis' })).status, 202);
  const settledDismiss = await settled(asyncDismissId);
  assert.equal(record(record(settledDismiss.resolution).delivery).via, 'message');
  assert.equal(prompts.length, beforeFallback + 2);
  assert.match(prompts[beforeFallback + 1], new RegExp(`^\\[review response: Async dismiss deck \\(${asyncDismissId}\\), DISMISSED by the user \\(no answers\\) at [^\\]]+\\]\\n`));

  // 4. Live legacy waiter (no outcomes=1): gets 200 with rejected status (never defaults) AND server still sends fallback message.
  const beforeLegacy = prompts.length;
  const legacyDeck = await json(await post(api(owner), { ...noMediaDeck, title: 'Legacy waiter deck', wait: true }));
  const legacyId = String(record(legacyDeck.review).id);
  const legacyWait = fetch(api(owner, `/${legacyId}/wait?timeout=10`), { headers: CLIENT_HEADER });
  await pause(150);
  assert.equal((await post(api(owner, `/${legacyId}/reject`), { resolutionId: 'res-legacy-01', reason: 'Legacy check' })).status, 202);
  const legacyRes = await legacyWait;
  assert.equal(legacyRes.status, 200);
  const legacyData = await json(legacyRes);
  assert.equal(record(legacyData.result).status, 'rejected');
  assert.deepEqual(record(legacyData.result).answers, {});
  const legacySettled = await settled(legacyId);
  assert.equal(record(record(legacySettled.resolution).delivery).via, 'message');
  assert.equal(prompts.length, beforeLegacy + 1);
  assert.match(prompts[beforeLegacy], /REJECTED by the user/);

  // 5. Concurrent races (submit vs reject, submit vs dismiss, reject vs dismiss): first-writer-wins with clear 409.
  for (const [label, pair] of [
    ['submit vs reject', (id: string) => [
      post(api(owner, `/${id}/submit`), { submissionId: 'sub-race-0001', answers: DEFAULTS }),
      post(api(owner, `/${id}/reject`), { resolutionId: 'res-race-0001', reason: 'Race reject' }),
    ]],
    ['submit vs dismiss', (id: string) => [
      post(api(owner, `/${id}/submit`), { submissionId: 'sub-race-0002', answers: DEFAULTS }),
      post(api(owner, `/${id}/dismiss`), { resolutionId: 'res-race-0002' }),
    ]],
    ['reject vs dismiss', (id: string) => [
      post(api(owner, `/${id}/reject`), { resolutionId: 'res-race-0003', reason: 'Race reject' }),
      post(api(owner, `/${id}/dismiss`), { resolutionId: 'res-race-0004' }),
    ]],
  ] as const) {
    const created = await json(await post(api(owner), { ...noMediaDeck, title: `Race ${label}`, wait: false }));
    const raceId = String(record(created.review).id);
    const [r1, r2] = await Promise.all(pair(raceId));
    const statuses = [r1.status, r2.status].sort((a, b) => a - b);
    assert.deepEqual(statuses, [202, 409], `${label} must yield exactly one 202 and one 409`);
    const winnerRes = r1.status === 202 ? r1 : r2;
    const loserRes = r1.status === 409 ? r1 : r2;
    const winnerReview = record((await json(winnerRes)).review);
    const loserBody = await json(loserRes);
    assert.equal(record(loserBody.review).status, winnerReview.status, `${label} 409 returns winning wire status`);
    assert.equal(record(loserBody.review).outcome, winnerReview.outcome, `${label} 409 returns winning outcome`);
    await settled(raceId);
    assert.equal(prompts.filter(prompt => prompt.includes(raceId)).length, 1, `${label} delivers exactly once`);
  }

  // 6. Reject/dismiss after cancel returns 409.
  const cancelledDeck = await json(await post(api(owner), { ...noMediaDeck, title: 'Cancelled before dismiss', wait: false }));
  const cancelledId = String(record(cancelledDeck.review).id);
  assert.equal((await post(api(owner, `/${cancelledId}/cancel`), {})).status, 200);
  const dismissCancelled = await post(api(owner, `/${cancelledId}/dismiss`), { resolutionId: 'res-after-can' });
  assert.equal(dismissCancelled.status, 409);
  assert.equal((await json(dismissCancelled)).code, 'cancelled');
  const rejectCancelled = await post(api(owner, `/${cancelledId}/reject`), { resolutionId: 'res-after-can2', reason: 'nope' });
  assert.equal(rejectCancelled.status, 409);
  assert.equal((await json(rejectCancelled)).code, 'cancelled');
});

test('CLI delivery note says "sent" only for delivered state, reporting recorded state and escaped error otherwise', async t => {
  const reviewId = 'rv_445566778899aabb';
  let currentResult: Record<string, unknown> = {};
  const fake = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ result: currentResult }));
  });
  await new Promise<void>(resolve => fake.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>(resolve => fake.close(() => resolve())));
  const address = fake.address();
  assert.ok(address && typeof address !== 'string');
  const fakeBase = `http://127.0.0.1:${address.port}`;

  // 1. Delivered via message -> says "also sent".
  currentResult = { reviewId, status: 'dismissed', reason: null, answers: {}, delivery: { state: 'delivered', via: 'message', at: 1, error: null } };
  const deliveredRun = cli(['wait', reviewId], undefined, { PI_DISH_URL: fakeBase });
  assert.equal(await deliveredRun.exited, 3, deliveredRun.stderr());
  assert.match(deliveredRun.stdout(), /also sent to this session/);

  // 2. Failed via message -> does NOT say "sent"; reports state and escaped error.
  currentResult = {
    reviewId, status: 'rejected', reason: 'no\x1b[31m', answers: {},
    delivery: { state: 'failed', via: 'message', at: 1, error: 'session busy\x1b[2K' },
  };
  const failedRun = cli(['wait', reviewId], undefined, { PI_DISH_URL: fakeBase });
  assert.equal(await failedRun.exited, 2, failedRun.stderr());
  assert.doesNotMatch(failedRun.stdout(), /also sent/);
  assert.match(failedRun.stdout(), /Session message delivery state: failed — session busy\\x1b\[2K\./);
  assert.ok(!failedRun.stdout().includes('\x1b'));

  // 3. Uncertain via message on submitted -> does NOT say "sent"; reports state and error.
  currentResult = {
    reviewId, status: 'submitted', answers: { quick_mag: { value: 'tab', default: true } },
    delivery: { state: 'uncertain', via: 'message', at: null, error: 'bridge dropped' },
  };
  const uncertainRun = cli(['wait', reviewId], undefined, { PI_DISH_URL: fakeBase });
  assert.equal(await uncertainRun.exited, 0, uncertainRun.stderr());
  assert.doesNotMatch(uncertainRun.stdout(), /also sent/);
  assert.match(uncertainRun.stdout(), /Session message delivery state: uncertain — bridge dropped\./);
});
