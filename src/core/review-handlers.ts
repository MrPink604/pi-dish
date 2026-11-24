/**
 * Review deck routes under `/api/sessions/:id/reviews` (so the `/hosts/<peer>`
 * proxy carries them like any session route), their media, the waiting CLI
 * and delivery.
 *
 * A submission is stored before anything is sent. It then goes to the
 * agent's waiting CLI when one is attached; otherwise it arrives in the
 * session as a `[review response: …]` message (a hibernated session or a bot
 * is woken). A CLI that just reconnected between polls, or that is coming back
 * after a pi-dish restart, gets a short grace period first, so one answer is
 * not delivered both ways.
 */
import fs = require('fs');
import os = require('os');
import path = require('path');
import type { ApplicationRequest, ApplicationResponse, RouteHandler } from './http-boundary';
import { errorMessage, errorStatus, requestBody } from './http-boundary';
import { canonicalSessionId, resolveSessionRoute } from './session-key';
import { sendRangedFile } from './range-response';
import * as reviews from './reviews';
import type { MediaSource, ReviewAsset, ReviewRecord, ReviewSpec } from './reviews';

export interface ReviewHandlerPorts {
  sessionKnown(sessionId: string): boolean;
  sessionCwd(sessionId: string): string | null;
  /** An absolute path as the session's file viewer reaches it, or null. */
  resolveSessionFile(sessionId: string, absPath: string): Promise<string | null>;
  pageExists(token: string): boolean;
  /** The transcript's last message index; null when unknown. */
  lastMessageIndex(sessionId: string): number | null;
  /** Resolves to null once the session took it, or to why that is unconfirmed (SessionCommandHandlers.deliverText). */
  deliverMessage(sessionId: string, text: string): Promise<string | null>;
  log(line: string): void;
  /** How long a just-detached (or not yet reattached) waiting CLI keeps an answer from becoming a message. */
  graceMs?: number;
}

export interface ReviewHandlers {
  create: RouteHandler;
  list: RouteHandler;
  get: RouteHandler;
  wait: RouteHandler;
  submit: RouteHandler;
  cancel: RouteHandler;
  media: RouteHandler;
  /** `review_updated` for a session's event stream; returns the unsubscribe. */
  subscribe(sessionId: string, listener: (data: { review: reviews.ClientReview }) => void): () => void;
  /** Settles answers a restart cut off: pending ones after the grace period, delivering ones as uncertain. */
  start(): void;
  stop(): void;
}

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
};
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const DEFAULT_GRACE_MS = 15_000;
const WAIT_DEFAULT_SECS = 50;
const WAIT_MAX_SECS = 600;

interface Waiter { res: ApplicationResponse; finish(review: ReviewRecord): void }

export function createReviewHandlers(ports: ReviewHandlerPorts): ReviewHandlers {
  const graceMs = ports.graceMs ?? DEFAULT_GRACE_MS;
  const startedAt = Date.now();
  const listeners = new Map<string, Set<(data: { review: reviews.ClientReview }) => void>>();
  const waiters = new Map<string, Set<Waiter>>();
  const detachedAt = new Map<string, number>();
  const timers = new Map<string, NodeJS.Timeout>();
  let stopped = false;

  function emit(review: ReviewRecord): void {
    const data = { review: reviews.clientReview(review) };
    for (const listener of listeners.get(review.sessionId) ?? []) {
      try { listener(data); } catch {}
    }
  }

  function sessionOf(req: ApplicationRequest, res: ApplicationResponse): string | null {
    try { return canonicalSessionId(req.params.id); } catch {
      res.status(400).json({ error: 'Invalid session ID' });
      return null;
    }
  }

  // The store fails closed: an unreadable one answers 500, never "no reviews".
  function load(req: ApplicationRequest, res: ApplicationResponse): { sessionId: string; review: ReviewRecord } | null {
    const sessionId = sessionOf(req, res);
    if (!sessionId) return null;
    if (!reviews.REVIEW_ID_RE.test(req.params.reviewId)) { res.status(404).json({ error: 'no such review' }); return null; }
    const review = reviews.readReviews(sessionId).find(item => item.id === req.params.reviewId);
    if (!review) { res.status(404).json({ error: 'no such review' }); return null; }
    return { sessionId, review };
  }

  function guarded(handler: (req: ApplicationRequest, res: ApplicationResponse) => unknown): RouteHandler {
    return async (req, res) => {
      try { await handler(req, res); } catch (error) {
        if (!res.headersSent) res.status(errorStatus(error, 500)).json({ error: errorMessage(error) });
        else res.end();
      }
    };
  }

  // ---- media ----

  async function resolveMedia(sessionId: string, spec: ReviewSpec): Promise<{ media: MediaSource[][]; assets: ReviewAsset[] } | { errors: string[] }> {
    const errors: string[] = [];
    const assets: ReviewAsset[] = [];
    const media: MediaSource[][] = [];
    const cwd = ports.sessionCwd(sessionId);
    for (const [cardIndex, card] of spec.cards.entries()) {
      const row: MediaSource[] = [];
      for (const [index, item] of card.media.entries()) {
        const where = `cards[${cardIndex}] ("${card.id}").media[${index}].src "${item.src}"`;
        if (/^https:\/\//i.test(item.src)) {
          try { new URL(item.src); row.push({ kind: 'url', url: item.src }); } catch { errors.push(`${where} is not a valid URL`); }
          continue;
        }
        const token = reviews.pageToken(item.src);
        if (item.src.startsWith('/page/')) {
          if (!token || item.src.split('/').some(segment => segment === '..' || segment === '.')) errors.push(`${where} is not a /page/<token>/<file> path`);
          else if (!ports.pageExists(token)) errors.push(`${where}: no page ${token} is published on this host`);
          else row.push({ kind: 'url', url: item.src });
          continue;
        }
        const expanded = item.src === '~' || item.src.startsWith('~/') ? path.join(os.homedir(), item.src.slice(1)) : item.src;
        if (!path.isAbsolute(expanded) && !cwd) { errors.push(`${where}: the session's directory is unknown; use an absolute path`); continue; }
        const absPath = path.resolve(cwd ?? '/', expanded);
        const mimeType = IMAGE_TYPES[path.extname(absPath).toLowerCase()];
        if (!mimeType) { errors.push(`${where} is not an image (${Object.keys(IMAGE_TYPES).join(', ')})`); continue; }
        // Exactly this file, and only within the session's reach: never a fuzzy match elsewhere.
        const notFound = `${where}: not found among this session's files (its directory, files its tools touched, uploads)`;
        if (await ports.resolveSessionFile(sessionId, absPath) !== absPath) { errors.push(notFound); continue; }
        let realPath: string;
        try {
          realPath = fs.realpathSync(absPath);
          const stat = fs.statSync(realPath);
          if (!stat.isFile()) { errors.push(`${where} is not a file`); continue; }
          if (stat.size > MAX_IMAGE_BYTES) { errors.push(`${where} is over ${MAX_IMAGE_BYTES / 1024 / 1024} MB`); continue; }
        } catch { errors.push(`${where} cannot be read`); continue; }
        // A link inside the reach must not lead out of it: the real file is under the real directory, or itself in reach.
        let realCwd: string | null = null;
        try { realCwd = cwd ? fs.realpathSync(cwd) : null; } catch {}
        if (realPath !== absPath && !(realCwd && realPath.startsWith(realCwd + path.sep))
          && await ports.resolveSessionFile(sessionId, realPath) !== realPath) {
          errors.push(notFound);
          continue;
        }
        let slot = assets.findIndex(asset => asset.realPath === realPath);
        if (slot < 0) slot = assets.push({ path: absPath, realPath, mimeType }) - 1;
        row.push({ kind: 'asset', slot });
      }
      media.push(row);
    }
    return errors.length ? { errors } : { media, assets };
  }

  // The file must still be the one resolved at creation: a path swapped for a link elsewhere is refused.
  const media = guarded((req, res) => {
    const found = load(req, res);
    if (!found) return;
    const slot = /^\d+$/.test(req.params.slot) ? Number(req.params.slot) : -1;
    const asset = Number.isSafeInteger(slot) ? found.review.assets[slot] : undefined;
    if (!asset) return res.status(404).json({ error: 'no such media' });
    let stat: fs.Stats;
    try {
      if (fs.realpathSync(asset.path) !== asset.realPath) throw new Error('moved');
      stat = fs.statSync(asset.realPath);
      if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES) throw new Error('not a file');
    } catch {
      return res.status(404).json({ error: 'the image is no longer there' });
    }
    res.setHeader('Cache-Control', 'private, no-cache');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    sendRangedFile(req, res, asset.realPath, { mimeType: asset.mimeType, size: stat.size, mtimeMs: stat.mtimeMs });
  });

  // ---- delivery ----

  function liveWaiters(reviewId: string): Waiter[] {
    return [...waiters.get(reviewId) ?? []].filter(waiter => !waiter.res.writableEnded && !waiter.res.destroyed);
  }

  function schedule(sessionId: string, reviewId: string, delay: number): void {
    clearTimeout(timers.get(reviewId));
    const timer = setTimeout(() => {
      timers.delete(reviewId);
      void settle(sessionId, reviewId);
    }, Math.max(0, delay));
    timer.unref();
    timers.set(reviewId, timer);
  }

  function setDelivery(sessionId: string, reviewId: string, delivery: reviews.ReviewDelivery): ReviewRecord | null {
    if (delivery.state !== 'pending') detachedAt.delete(reviewId);
    const updated = reviews.updateReview(sessionId, reviewId, review => {
      if (review.submission) review.submission.delivery = delivery;
    });
    if (updated) emit(updated);
    return updated;
  }

  /** A pending answer goes to an attached waiter, waits out the grace period, or becomes a message. */
  async function settle(sessionId: string, reviewId: string): Promise<void> {
    if (stopped) return;
    const review = reviews.readReviews(sessionId).find(item => item.id === reviewId);
    if (!review?.submission || review.submission.delivery.state !== 'pending') return;
    const attached = liveWaiters(reviewId);
    if (attached.length) {
      clearTimeout(timers.get(reviewId));
      timers.delete(reviewId);
      const delivered = setDelivery(sessionId, reviewId, { state: 'delivered', via: 'waiter', at: Date.now(), error: null });
      if (delivered) for (const waiter of attached) waiter.finish(delivered);
      return;
    }
    // A waiting CLI that has not attached yet (just started, or back after a restart) gets the grace period too.
    const waitingSince = review.spec.wait ? Math.max(startedAt, review.createdAt) : -Infinity;
    const holdUntil = Math.max(waitingSince, detachedAt.get(reviewId) ?? -Infinity) + graceMs;
    if (Date.now() < holdUntil) return schedule(sessionId, reviewId, holdUntil - Date.now());
    const delivering = setDelivery(sessionId, reviewId, { state: 'delivering', via: 'message', at: null, error: null });
    if (!delivering) return;
    let outcome: reviews.ReviewDelivery;
    try {
      const message = reviews.formatReviewMessage(delivering, resolveSessionRoute(sessionId).harnessId === 'omp');
      const unconfirmed = await ports.deliverMessage(sessionId, message);
      outcome = { state: unconfirmed ? 'uncertain' : 'delivered', via: 'message', at: Date.now(), error: unconfirmed };
    } catch (error) {
      // An admission refusal (409) happens before anything reaches the agent; any other failure may follow a send.
      outcome = { state: errorStatus(error, 0) === 409 ? 'failed' : 'uncertain', via: 'message', at: Date.now(), error: errorMessage(error) };
    }
    try { setDelivery(sessionId, reviewId, outcome); }
    catch (error) { ports.log(`[reviews] could not record the delivery of ${reviewId}: ${errorMessage(error)}`); }
  }

  // ---- routes ----

  const create = guarded(async (req, res) => {
    const sessionId = sessionOf(req, res);
    if (!sessionId) return;
    if (!ports.sessionKnown(sessionId)) return res.status(404).json({ error: 'Session not found' });
    const checked = reviews.validateReviewSpec(req.body);
    if ('errors' in checked) return res.status(400).json({ error: checked.errors.join('; '), errors: checked.errors });
    const resolved = await resolveMedia(sessionId, checked.spec);
    if ('errors' in resolved) return res.status(400).json({ error: resolved.errors.join('; '), errors: resolved.errors });
    const stored = reviews.readReviews(sessionId);
    if (stored.filter(review => review.status === 'open').length >= reviews.MAX_OPEN_REVIEWS) {
      return res.status(409).json({ error: `this session already has ${reviews.MAX_OPEN_REVIEWS} open reviews; wait for answers or cancel some` });
    }
    const review: ReviewRecord = {
      id: reviews.newReviewId(), sessionId, createdAt: Date.now(), anchorMessageIndex: ports.lastMessageIndex(sessionId),
      spec: checked.spec, media: resolved.media, assets: resolved.assets, status: 'open', submission: null,
    };
    reviews.writeReviews(sessionId, [...stored, review]);
    emit(review);
    res.status(201).json({ review: reviews.clientReview(review) });
  });

  const list = guarded((req, res) => {
    const sessionId = sessionOf(req, res);
    if (!sessionId) return;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ reviews: reviews.readReviews(sessionId).map(reviews.clientReview) });
  });

  const get = guarded((req, res) => {
    const found = load(req, res);
    if (!found) return;
    res.setHeader('Cache-Control', 'no-store');
    res.json({ review: reviews.clientReview(found.review), result: reviews.reviewResult(found.review) });
  });

  // Long-poll for the agent's CLI: answers with the review once it is answered or
  // cancelled, or still open after `timeout` seconds. Headers go out at once so a
  // proxy's first-byte timer never cuts the poll.
  const wait = guarded((req, res) => {
    const found = load(req, res);
    if (!found) return;
    const { sessionId, review } = found;
    const requested = Number(req.query.timeout);
    const seconds = Number.isFinite(requested) && requested > 0 ? Math.min(requested, WAIT_MAX_SECS) : WAIT_DEFAULT_SECS;
    res.status(200).type('application/json').setHeader('Cache-Control', 'no-store, no-transform');
    const send = (current: ReviewRecord) => {
      if (!res.writableEnded && !res.destroyed) res.end(JSON.stringify({ review: reviews.clientReview(current), result: reviews.reviewResult(current) }));
    };
    if (review.status !== 'open') {
      const claimed = review.submission?.delivery.state === 'pending'
        ? setDelivery(sessionId, review.id, { state: 'delivered', via: 'waiter', at: Date.now(), error: null }) : null;
      if (claimed) { clearTimeout(timers.get(review.id)); timers.delete(review.id); }
      return send(claimed ?? review);
    }
    res.flushHeaders();
    const set = waiters.get(review.id) ?? new Set<Waiter>();
    waiters.set(review.id, set);
    let done = false;
    const detach = () => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      set.delete(waiter);
      if (!set.size) waiters.delete(review.id);
      detachedAt.set(review.id, Date.now());
    };
    const waiter: Waiter = { res, finish: current => { detach(); send(current); } };
    const timer = setTimeout(() => {
      detach();
      try { send(reviews.readReviews(sessionId).find(item => item.id === review.id) ?? review); } catch { send(review); }
    }, seconds * 1000);
    set.add(waiter);
    res.on('close', detach);
  });

  const submit = guarded((req, res) => {
    const found = load(req, res);
    if (!found) return;
    const { sessionId, review } = found;
    const body = requestBody(req);
    const id = body.submissionId;
    if (typeof id !== 'string' || !reviews.SUBMISSION_ID_RE.test(id)) {
      return res.status(400).json({ error: 'submissionId must be 8-64 letters, digits, "_" or "-"' });
    }
    // Any id ever accepted answers with its receipt, never a second send.
    if (review.submission?.id === id) return res.status(200).json({ review: reviews.clientReview(review), repeated: true });
    if (review.status === 'submitted') {
      return res.status(409).json({ code: 'answered', error: 'this review was already answered', review: reviews.clientReview(review) });
    }
    if (review.status === 'cancelled') {
      return res.status(409).json({ code: 'cancelled', error: 'the agent withdrew this review', review: reviews.clientReview(review) });
    }
    const checked = reviews.validateReviewAnswers(review.spec, body.answers);
    if ('errors' in checked) return res.status(400).json({ error: checked.errors.join('; '), errors: checked.errors });
    const accepted = reviews.updateReview(sessionId, review.id, current => {
      current.status = 'submitted';
      current.submission = {
        id, submittedAt: Date.now(), answers: checked.answers, changed: reviews.changedQuestions(current.spec, checked.answers),
        delivery: { state: 'pending', via: null, at: null, error: null },
      };
    });
    if (!accepted) return res.status(404).json({ error: 'no such review' });
    res.status(202).json({ review: reviews.clientReview(accepted) });
    emit(accepted);
    void settle(sessionId, review.id).catch(error => ports.log(`[reviews] delivering ${review.id}: ${errorMessage(error)}`));
  });

  const cancel = guarded((req, res) => {
    const found = load(req, res);
    if (!found) return;
    if (found.review.status === 'submitted') {
      return res.status(409).json({ code: 'answered', error: 'this review was already answered', review: reviews.clientReview(found.review) });
    }
    const cancelled = reviews.updateReview(found.sessionId, found.review.id, current => { current.status = 'cancelled'; });
    if (!cancelled) return res.status(404).json({ error: 'no such review' });
    clearTimeout(timers.get(cancelled.id));
    timers.delete(cancelled.id);
    detachedAt.delete(cancelled.id);
    for (const waiter of liveWaiters(cancelled.id)) waiter.finish(cancelled);
    emit(cancelled);
    res.json({ review: reviews.clientReview(cancelled) });
  });

  function subscribe(sessionId: string, listener: (data: { review: reviews.ClientReview }) => void): () => void {
    let key: string;
    try { key = canonicalSessionId(sessionId); } catch { return () => {}; }
    const set = listeners.get(key) ?? new Set();
    listeners.set(key, set);
    set.add(listener);
    return () => {
      set.delete(listener);
      if (!set.size) listeners.delete(key);
    };
  }

  function start(): void {
    for (const review of reviews.readAllReviews(ports.log)) {
      const state = review.submission?.delivery.state;
      if (state === 'pending') schedule(review.sessionId, review.id, startedAt + graceMs - Date.now());
      if (state === 'delivering') {
        try {
          setDelivery(review.sessionId, review.id, {
            state: 'uncertain', via: 'message', at: null, error: 'pi-dish stopped while delivering; the agent may or may not have it',
          });
        } catch (error) { ports.log(`[reviews] ${review.id}: ${errorMessage(error)}`); }
      }
    }
  }

  function stop(): void {
    stopped = true;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
  }

  return { create, list, get, wait, submit, cancel, media, subscribe, start, stop };
}
