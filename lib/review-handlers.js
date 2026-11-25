// Generated from src/core/review-handlers.ts; edit that source and run npm run build:core.
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.createReviewHandlers = createReviewHandlers;
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
const fs = require("fs");
const os = require("os");
const path = require("path");
const http_boundary_1 = require("./http-boundary");
const helper_values_1 = require("./helper-values");
const page_forms_1 = require("./page-forms");
const session_key_1 = require("./session-key");
const range_response_1 = require("./range-response");
const reviews = __importStar(require("./reviews"));
const IMAGE_TYPES = {
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.avif': 'image/avif',
};
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const DEFAULT_GRACE_MS = 15_000;
const WAIT_DEFAULT_SECS = 50;
const WAIT_MAX_SECS = 600;
const JSON_CONTENT_TYPE_RE = /^application\/(?:[a-z0-9.+-]+\+)?json(?:\s*;|$)/i;
function parseOptionalObjectBody(req) {
    const contentLength = Number(req.headers['content-length']);
    const hasTransfer = typeof req.headers['transfer-encoding'] === 'string' && req.headers['transfer-encoding'].trim() !== '';
    const hasPayload = (Number.isFinite(contentLength) && contentLength > 0) || hasTransfer;
    const contentType = typeof req.headers['content-type'] === 'string' ? req.headers['content-type'].trim() : '';
    if (hasPayload && !JSON_CONTENT_TYPE_RE.test(contentType)) {
        return { error: 'request body must be a JSON object' };
    }
    if (req.body === undefined)
        return { body: {} };
    if (!(0, helper_values_1.record)(req.body))
        return { error: 'request body must be a JSON object' };
    return { body: req.body };
}
function createReviewHandlers(ports) {
    const graceMs = ports.graceMs ?? DEFAULT_GRACE_MS;
    const maxWriteMs = Math.max(graceMs * 4, 30_000);
    const startedAt = Date.now();
    const listeners = new Map();
    const waiters = new Map();
    const inFlightWrites = new Map();
    const detachedAt = new Map();
    const timers = new Map();
    let stopped = false;
    function emit(review) {
        const data = { review: reviews.clientReview(review) };
        for (const listener of listeners.get(review.sessionId) ?? []) {
            try {
                listener(data);
            }
            catch { }
        }
    }
    function requireClient(req, res) {
        if (req.headers[reviews.REVIEW_CLIENT_HEADER] === reviews.REVIEW_CLIENT_VALUE)
            return true;
        res.status(403).json({ error: 'X-Pi-Dish-Client: 1 header is required' });
        return false;
    }
    function sessionOf(req, res) {
        let sessionId;
        try {
            sessionId = (0, session_key_1.canonicalSessionId)(req.params.id);
        }
        catch {
            res.status(400).json({ error: 'Invalid session ID' });
            return null;
        }
        if (!ports.sessionKnown(sessionId)) {
            res.status(404).json({ error: 'Session not found' });
            return null;
        }
        return sessionId;
    }
    // The store fails closed: an unreadable one answers 500, never "no reviews".
    function loadReview(sessionId, req, res) {
        if (!reviews.REVIEW_ID_RE.test(req.params.reviewId)) {
            res.status(404).json({ error: 'no such review' });
            return null;
        }
        const review = reviews.readReviews(sessionId).find(item => item.id === req.params.reviewId);
        if (!review) {
            res.status(404).json({ error: 'no such review' });
            return null;
        }
        return review;
    }
    function load(req, res) {
        const sessionId = sessionOf(req, res);
        if (!sessionId)
            return null;
        const review = loadReview(sessionId, req, res);
        return review ? { sessionId, review } : null;
    }
    function guarded(handler) {
        return async (req, res) => {
            try {
                await handler(req, res);
            }
            catch (error) {
                if (!res.headersSent)
                    res.status((0, http_boundary_1.errorStatus)(error, 500)).json({ error: (0, http_boundary_1.errorMessage)(error) });
                else
                    res.end();
            }
        };
    }
    // ---- media ----
    async function resolveMedia(sessionId, spec) {
        const errors = [];
        const assets = [];
        const media = [];
        const cwd = ports.sessionCwd(sessionId);
        for (const [cardIndex, card] of spec.cards.entries()) {
            const row = [];
            for (const [index, item] of card.media.entries()) {
                const where = `cards[${cardIndex}] ("${card.id}").media[${index}].src "${item.src}"`;
                if (/^https:\/\//i.test(item.src)) {
                    try {
                        new URL(item.src);
                        row.push({ kind: 'url', url: item.src });
                    }
                    catch {
                        errors.push(`${where} is not a valid URL`);
                    }
                    continue;
                }
                const token = reviews.pageToken(item.src);
                if (item.src.startsWith('/page/')) {
                    if (!token || item.src.split('/').some(segment => segment === '..' || segment === '.'))
                        errors.push(`${where} is not a /page/<token>/<file> path`);
                    else if (!ports.pageExists(token))
                        errors.push(`${where}: no page ${token} is published on this host`);
                    else
                        row.push({ kind: 'url', url: item.src });
                    continue;
                }
                const expanded = item.src === '~' || item.src.startsWith('~/') ? path.join(os.homedir(), item.src.slice(1)) : item.src;
                if (!path.isAbsolute(expanded) && !cwd) {
                    errors.push(`${where}: the session's directory is unknown; use an absolute path`);
                    continue;
                }
                const absPath = path.resolve(cwd ?? '/', expanded);
                const mimeType = IMAGE_TYPES[path.extname(absPath).toLowerCase()];
                if (!mimeType) {
                    errors.push(`${where} is not an image (${Object.keys(IMAGE_TYPES).join(', ')})`);
                    continue;
                }
                // Exactly this file, and only within the session's reach: never a fuzzy match elsewhere.
                const notFound = `${where}: not found among this session's files (its directory, files its tools touched, uploads)`;
                if (await ports.resolveSessionFile(sessionId, absPath) !== absPath) {
                    errors.push(notFound);
                    continue;
                }
                let realPath;
                try {
                    realPath = fs.realpathSync(absPath);
                    const stat = fs.statSync(realPath);
                    if (!stat.isFile()) {
                        errors.push(`${where} is not a file`);
                        continue;
                    }
                    if (stat.size > MAX_IMAGE_BYTES) {
                        errors.push(`${where} is over ${MAX_IMAGE_BYTES / 1024 / 1024} MB`);
                        continue;
                    }
                }
                catch {
                    errors.push(`${where} cannot be read`);
                    continue;
                }
                // A link inside the reach must not lead out of it: the real file is under the real directory, or itself in reach.
                let realCwd = null;
                try {
                    realCwd = cwd ? fs.realpathSync(cwd) : null;
                }
                catch { }
                if (realPath !== absPath && !(realCwd && realPath.startsWith(realCwd + path.sep))
                    && await ports.resolveSessionFile(sessionId, realPath) !== realPath) {
                    errors.push(notFound);
                    continue;
                }
                let slot = assets.findIndex(asset => asset.realPath === realPath);
                if (slot < 0)
                    slot = assets.push({ path: absPath, realPath, mimeType }) - 1;
                row.push({ kind: 'asset', slot });
            }
            media.push(row);
        }
        return errors.length ? { errors } : { media, assets };
    }
    // The file must still be the one resolved at creation: a path swapped for a link elsewhere is refused.
    const media = guarded((req, res) => {
        const found = load(req, res);
        if (!found)
            return;
        const slot = /^\d+$/.test(req.params.slot) ? Number(req.params.slot) : -1;
        const asset = Number.isSafeInteger(slot) ? found.review.assets[slot] : undefined;
        if (!asset)
            return res.status(404).json({ error: 'no such media' });
        let stat;
        try {
            if (fs.realpathSync(asset.path) !== asset.realPath)
                throw new Error('moved');
            stat = fs.statSync(asset.realPath);
            if (!stat.isFile() || stat.size > MAX_IMAGE_BYTES)
                throw new Error('not a file');
        }
        catch {
            return res.status(404).json({ error: 'the image is no longer there' });
        }
        res.setHeader('Cache-Control', 'private, no-cache');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        (0, range_response_1.sendRangedFile)(req, res, asset.realPath, { mimeType: asset.mimeType, size: stat.size, mtimeMs: stat.mtimeMs });
    });
    // ---- delivery ----
    function liveWaiters(reviewId) {
        return [...waiters.get(reviewId)?.set ?? []].filter(waiter => !waiter.res.writableEnded && !waiter.res.destroyed && !waiter.res.socket?.destroyed);
    }
    function clearTimer(reviewId) {
        const entry = timers.get(reviewId);
        if (!entry)
            return;
        clearTimeout(entry.timer);
        timers.delete(reviewId);
    }
    function schedule(sessionId, reviewId, delay) {
        clearTimer(reviewId);
        const timer = setTimeout(() => {
            timers.delete(reviewId);
            void settle(sessionId, reviewId).catch(error => ports.log(`[reviews] delivering ${reviewId}: ${(0, http_boundary_1.errorMessage)(error)}`));
        }, Math.max(0, delay));
        timer.unref();
        timers.set(reviewId, { sessionId, timer });
    }
    function setReviewDelivery(review, delivery) {
        if (review.submission)
            review.submission.delivery = delivery;
        else if (review.resolution)
            review.resolution.delivery = delivery;
    }
    function conflictResponse(review) {
        const client = reviews.clientReview(review);
        if (review.status === 'submitted')
            return { code: 'answered', error: 'this review was already answered', review: client };
        if (review.status === 'cancelled')
            return { code: 'cancelled', error: 'the agent withdrew this review', review: client };
        if (review.status === 'rejected')
            return { code: 'rejected', error: 'this review was already rejected', review: client };
        return { code: 'dismissed', error: 'this review was already dismissed', review: client };
    }
    function legacyOutcomeError(review) {
        if (review.status === 'rejected') {
            const reason = review.resolution?.reason;
            return reason ? `review was rejected by the user: ${(0, page_forms_1.visibleText)(reason)}` : 'review was rejected by the user';
        }
        return 'review was dismissed by the user (no answers)';
    }
    function fallbackHoldUntil(review) {
        const waitingSince = review.spec.wait ? Math.max(startedAt, review.createdAt) : -Infinity;
        return Math.max(waitingSince, detachedAt.get(review.id)?.at ?? -Infinity) + graceMs;
    }
    function setDelivery(sessionId, reviewId, delivery) {
        if (delivery.state !== 'pending')
            detachedAt.delete(reviewId);
        const updated = reviews.updateReview(sessionId, reviewId, review => {
            setReviewDelivery(review, delivery);
        });
        if (updated)
            emit(updated);
        return updated;
    }
    /**
     * Writes a wait response; invokes `onWritten` only once `res.end` finishes on
     * an intact socket. Delivery writes (those with `onWritten`) stay tracked in
     * `inFlightWrites` until completion or explicit abort so a slow successful
     * write and fallback message delivery cannot both happen.
     */
    function writeWaiter(res, review, onWritten) {
        if (res.writableEnded || res.destroyed || res.socket?.destroyed)
            return;
        let failed = false;
        let aborted = false;
        let entry = null;
        const release = () => {
            if (!entry)
                return;
            const bucket = inFlightWrites.get(review.id);
            if (bucket) {
                bucket.delete(entry);
                if (!bucket.size)
                    inFlightWrites.delete(review.id);
            }
            entry = null;
        };
        const scheduleAfterFailure = () => {
            if (!onWritten || stopped || aborted || inFlightWrites.get(review.id)?.size)
                return;
            schedule(review.sessionId, review.id, Math.max(0, fallbackHoldUntil(review) - Date.now()));
        };
        if (onWritten) {
            entry = {
                sessionId: review.sessionId,
                startedAt: Date.now(),
                res,
                abort: () => {
                    aborted = true;
                    release();
                    try {
                        res.destroy();
                    }
                    catch { }
                },
            };
            const bucket = inFlightWrites.get(review.id) ?? new Set();
            bucket.add(entry);
            inFlightWrites.set(review.id, bucket);
        }
        const onError = () => { failed = true; release(); scheduleAfterFailure(); };
        const onClose = () => { if (!res.writableFinished) {
            failed = true;
            release();
            scheduleAfterFailure();
        } };
        res.once('error', onError);
        res.once('close', onClose);
        const body = JSON.stringify({ review: reviews.clientReview(review), result: reviews.reviewResult(review) });
        try {
            res.end(body, () => {
                res.off('error', onError);
                res.off('close', onClose);
                release();
                if (!aborted && !failed && !res.destroyed && !res.socket?.destroyed && res.writableFinished) {
                    onWritten?.();
                }
                else {
                    scheduleAfterFailure();
                }
            });
        }
        catch {
            res.off('error', onError);
            res.off('close', onClose);
            release();
            scheduleAfterFailure();
        }
    }
    function markWaiterDelivered(sessionId, reviewId, delivery) {
        if (stopped)
            return;
        try {
            let changed = false;
            const updated = reviews.updateReview(sessionId, reviewId, review => {
                if (reviews.reviewDelivery(review)?.state !== 'pending')
                    return;
                setReviewDelivery(review, delivery);
                changed = true;
            });
            if (!changed || !updated)
                return;
            clearTimer(reviewId);
            detachedAt.delete(reviewId);
            emit(updated);
        }
        catch (error) {
            ports.log(`[reviews] could not record waiter delivery of ${reviewId}: ${(0, http_boundary_1.errorMessage)(error)}`);
        }
    }
    function withWaiterDelivery(review) {
        const current = reviews.reviewDelivery(review);
        if (!current || current.state !== 'pending')
            return null;
        const delivery = { state: 'delivered', via: 'waiter', at: Date.now(), error: null };
        if (review.submission)
            return { delivery, delivered: { ...review, submission: { ...review.submission, delivery } } };
        if (review.resolution)
            return { delivery, delivered: { ...review, resolution: { ...review.resolution, delivery } } };
        return null;
    }
    /** A pending answer or user resolution goes to an attached waiter, waits out the grace period, or becomes a message. */
    async function settle(sessionId, reviewId) {
        if (stopped)
            return;
        const review = reviews.readReviews(sessionId).find(item => item.id === reviewId);
        if (!review || reviews.reviewDelivery(review)?.state !== 'pending')
            return;
        const flights = inFlightWrites.get(reviewId);
        if (flights?.size) {
            const now = Date.now();
            let nextCheck = Infinity;
            for (const flight of [...flights]) {
                if (flight.res.destroyed || flight.res.socket?.destroyed) {
                    flights.delete(flight);
                    continue;
                }
                const deadline = flight.startedAt + maxWriteMs;
                if (now < deadline) {
                    nextCheck = Math.min(nextCheck, deadline - now);
                }
                else {
                    // A wedged write past the budget is terminated before fallback so both cannot deliver.
                    flight.abort();
                }
            }
            if (!flights.size)
                inFlightWrites.delete(reviewId);
            if (Number.isFinite(nextCheck))
                return schedule(sessionId, reviewId, nextCheck);
        }
        const isOutcome = review.status === 'rejected' || review.status === 'dismissed';
        const attached = liveWaiters(reviewId);
        const capable = isOutcome ? attached.filter(waiter => waiter.supportsOutcomes) : attached;
        const legacy = isOutcome ? attached.filter(waiter => !waiter.supportsOutcomes) : [];
        if (capable.length) {
            const prepared = withWaiterDelivery(review);
            if (!prepared)
                return;
            // Leave pending on disk until a waiter write actually succeeds; if all fail, the fallback timer delivers via message.
            schedule(sessionId, reviewId, graceMs);
            for (const waiter of capable) {
                waiter.finish(prepared.delivered, () => markWaiterDelivered(sessionId, reviewId, prepared.delivery));
            }
            for (const waiter of legacy)
                waiter.finish(review);
            return;
        }
        if (legacy.length) {
            // Legacy waiters do not recognize rejected/dismissed; finish their flushed 200 without claiming delivery so message fallback still runs.
            for (const waiter of legacy)
                waiter.finish(review);
        }
        // A waiting CLI that has not attached yet (just started, or back after a restart) gets the grace period too.
        const holdUntil = fallbackHoldUntil(review);
        if (Date.now() < holdUntil)
            return schedule(sessionId, reviewId, holdUntil - Date.now());
        const delivering = setDelivery(sessionId, reviewId, { state: 'delivering', via: 'message', at: null, error: null });
        if (!delivering)
            return;
        let outcome;
        try {
            const message = reviews.formatReviewMessage(delivering, (0, session_key_1.resolveSessionRoute)(sessionId).harnessId === 'omp');
            const unconfirmed = await ports.deliverMessage(sessionId, message);
            outcome = { state: unconfirmed ? 'uncertain' : 'delivered', via: 'message', at: Date.now(), error: unconfirmed };
        }
        catch (error) {
            // An admission refusal (409) happens before anything reaches the agent; any other failure may follow a send.
            outcome = { state: (0, http_boundary_1.errorStatus)(error, 0) === 409 ? 'failed' : 'uncertain', via: 'message', at: Date.now(), error: (0, http_boundary_1.errorMessage)(error) };
        }
        try {
            setDelivery(sessionId, reviewId, outcome);
        }
        catch (error) {
            ports.log(`[reviews] could not record the delivery of ${reviewId}: ${(0, http_boundary_1.errorMessage)(error)}`);
        }
    }
    // ---- routes ----
    const create = guarded(async (req, res) => {
        const sessionId = sessionOf(req, res);
        if (!sessionId || !requireClient(req, res))
            return;
        const checked = reviews.validateReviewSpec(req.body);
        if ('errors' in checked)
            return res.status(400).json({ error: checked.errors.join('; '), errors: checked.errors });
        const resolved = await resolveMedia(sessionId, checked.spec);
        if ('errors' in resolved)
            return res.status(400).json({ error: resolved.errors.join('; '), errors: resolved.errors });
        const stored = reviews.readReviews(sessionId);
        if (stored.filter(review => review.status === 'open').length >= reviews.MAX_OPEN_REVIEWS) {
            return res.status(409).json({ error: `this session already has ${reviews.MAX_OPEN_REVIEWS} open reviews; wait for answers or cancel some` });
        }
        const review = {
            id: reviews.newReviewId(), sessionId, createdAt: Date.now(), anchorMessageIndex: ports.lastMessageIndex(sessionId),
            spec: checked.spec, media: resolved.media, assets: resolved.assets, status: 'open', submission: null,
        };
        reviews.writeReviews(sessionId, [...stored, review]);
        emit(review);
        res.status(201).json({ review: reviews.clientReview(review) });
    });
    const list = guarded((req, res) => {
        const sessionId = sessionOf(req, res);
        if (!sessionId)
            return;
        res.setHeader('Cache-Control', 'no-store');
        res.json({ reviews: reviews.readReviews(sessionId).map(reviews.clientReview) });
    });
    const get = guarded((req, res) => {
        const found = load(req, res);
        if (!found)
            return;
        res.setHeader('Cache-Control', 'no-store');
        res.json({ review: reviews.clientReview(found.review), result: reviews.reviewResult(found.review) });
    });
    // Lookup by review id across stored sessions; enforces the same sessionKnown and private-PIN gates as session routes.
    const lookup = guarded((req, res) => {
        const reviewId = req.params.reviewId;
        if (!reviews.REVIEW_ID_RE.test(reviewId))
            return res.status(404).json({ error: 'no such review' });
        const review = reviews.findReviewById(reviewId, ports.log);
        if (!review || !ports.sessionKnown(review.sessionId) || ports.privateRefused?.(req, review.sessionId)) {
            return res.status(404).json({ error: 'no such review' });
        }
        res.setHeader('Cache-Control', 'no-store');
        res.json({ review: reviews.clientReview(review), result: reviews.reviewResult(review) });
    });
    // Long-poll for the agent's CLI: answers with the review once it is answered,
    // rejected, dismissed or cancelled, or still open after `timeout` seconds.
    // Headers go out at once so a proxy's first-byte timer never cuts the poll.
    const wait = guarded((req, res) => {
        const sessionId = sessionOf(req, res);
        if (!sessionId)
            return;
        // HEAD on wait must never claim a pending answer or attach a waiter.
        if (req.method === 'HEAD') {
            res.setHeader('Allow', 'GET');
            return res.status(405).end();
        }
        if (!requireClient(req, res))
            return;
        const review = loadReview(sessionId, req, res);
        if (!review)
            return;
        const requested = Number(req.query.timeout);
        const seconds = Number.isFinite(requested) && requested > 0 ? Math.min(requested, WAIT_MAX_SECS) : WAIT_DEFAULT_SECS;
        const supportsOutcomes = req.query.outcomes === '1' || req.query.outcomes === 'true';
        res.setHeader('Cache-Control', 'no-store, no-transform');
        if (review.status !== 'open') {
            if ((review.status === 'rejected' || review.status === 'dismissed') && !supportsOutcomes) {
                if (reviews.reviewDelivery(review)?.state === 'pending' && !timers.has(review.id)) {
                    schedule(sessionId, review.id, graceMs);
                }
                return res.status(409).json({
                    code: review.status,
                    error: legacyOutcomeError(review),
                    review: reviews.clientReview(review),
                    result: reviews.reviewResult(review),
                });
            }
            res.status(200).type('application/json');
            const prepared = withWaiterDelivery(review);
            if (prepared) {
                if (!timers.has(review.id))
                    schedule(sessionId, review.id, graceMs);
                return writeWaiter(res, prepared.delivered, () => markWaiterDelivered(sessionId, review.id, prepared.delivery));
            }
            return writeWaiter(res, review);
        }
        res.status(200).type('application/json');
        res.flushHeaders();
        const bucket = waiters.get(review.id) ?? { sessionId, set: new Set() };
        waiters.set(review.id, bucket);
        let done = false;
        const detach = (recordDetach) => {
            if (done)
                return;
            done = true;
            clearTimeout(timer);
            bucket.set.delete(waiter);
            if (!bucket.set.size)
                waiters.delete(review.id);
            if (recordDetach)
                detachedAt.set(review.id, { sessionId, at: Date.now() });
        };
        const waiter = {
            res,
            supportsOutcomes,
            finish: (current, onWritten) => { detach(true); writeWaiter(res, current, onWritten); },
            close: () => { detach(false); if (!res.writableEnded && !res.destroyed)
                res.end(); },
        };
        const timer = setTimeout(() => {
            detach(true);
            try {
                writeWaiter(res, reviews.readReviews(sessionId).find(item => item.id === review.id) ?? review);
            }
            catch {
                writeWaiter(res, review);
            }
        }, seconds * 1000);
        bucket.set.add(waiter);
        res.on('close', () => detach(true));
    });
    const submit = guarded((req, res) => {
        const sessionId = sessionOf(req, res);
        if (!sessionId || !requireClient(req, res))
            return;
        const review = loadReview(sessionId, req, res);
        if (!review)
            return;
        const contentLength = Number(req.headers['content-length']);
        if ((Number.isFinite(contentLength) && contentLength > reviews.MAX_SUBMIT_BYTES)
            || Buffer.byteLength(JSON.stringify(req.body ?? null)) > reviews.MAX_SUBMIT_BYTES) {
            return res.status(413).json({ error: `submission exceeds ${reviews.MAX_SUBMIT_BYTES / 1024} KiB` });
        }
        const body = (0, http_boundary_1.requestBody)(req);
        const id = body.submissionId;
        if (typeof id !== 'string' || !reviews.SUBMISSION_ID_RE.test(id)) {
            return res.status(400).json({ error: 'submissionId must be 8-64 letters, digits, "_" or "-"' });
        }
        // Any id ever accepted answers with its receipt, never a second send.
        if (review.submission?.id === id)
            return res.status(200).json({ review: reviews.clientReview(review), repeated: true });
        if (review.status !== 'open') {
            return res.status(409).json(conflictResponse(review));
        }
        const checked = reviews.validateReviewAnswers(review.spec, body.answers);
        if ('errors' in checked)
            return res.status(400).json({ error: checked.errors.join('; '), errors: checked.errors });
        let accepted = null;
        let raced = null;
        reviews.updateReview(sessionId, review.id, current => {
            if (current.status !== 'open') {
                raced = current;
                return;
            }
            current.status = 'submitted';
            current.submission = {
                id, submittedAt: Date.now(), answers: checked.answers, changed: reviews.changedQuestions(current.spec, checked.answers),
                delivery: { state: 'pending', via: null, at: null, error: null },
            };
            accepted = current;
        });
        if (raced)
            return res.status(409).json(conflictResponse(raced));
        if (!accepted)
            return res.status(404).json({ error: 'no such review' });
        res.status(202).json({ review: reviews.clientReview(accepted) });
        emit(accepted);
        void settle(sessionId, review.id).catch(error => ports.log(`[reviews] delivering ${review.id}: ${(0, http_boundary_1.errorMessage)(error)}`));
    });
    function resolveOutcome(targetStatus) {
        return guarded((req, res) => {
            const sessionId = sessionOf(req, res);
            if (!sessionId || !requireClient(req, res))
                return;
            const review = loadReview(sessionId, req, res);
            if (!review)
                return;
            const contentLength = Number(req.headers['content-length']);
            if ((Number.isFinite(contentLength) && contentLength > reviews.MAX_SUBMIT_BYTES)
                || Buffer.byteLength(JSON.stringify(req.body ?? null)) > reviews.MAX_SUBMIT_BYTES) {
                return res.status(413).json({ error: `request exceeds ${reviews.MAX_SUBMIT_BYTES / 1024} KiB` });
            }
            const parsedBody = parseOptionalObjectBody(req);
            if ('error' in parsedBody)
                return res.status(400).json({ error: parsedBody.error });
            const body = parsedBody.body;
            let givenId = null;
            if (body.resolutionId !== undefined && body.resolutionId !== null) {
                if (typeof body.resolutionId !== 'string' || !reviews.SUBMISSION_ID_RE.test(body.resolutionId)) {
                    return res.status(400).json({ error: 'resolutionId must be 8-64 letters, digits, "_" or "-"' });
                }
                givenId = body.resolutionId;
            }
            // A repeated retry with the already-accepted id returns its receipt without a second send.
            if (givenId !== null && review.status === targetStatus && review.resolution?.id === givenId) {
                return res.status(200).json({ review: reviews.clientReview(review), repeated: true });
            }
            let reason = null;
            if (targetStatus === 'rejected') {
                const checked = reviews.validateRejectReason(body.reason);
                if ('error' in checked)
                    return res.status(400).json({ error: checked.error });
                reason = checked.reason;
            }
            if (review.status === targetStatus && review.resolution) {
                if (givenId === null && (targetStatus === 'dismissed' || reason === review.resolution.reason)) {
                    return res.status(200).json({ review: reviews.clientReview(review), repeated: true });
                }
                return res.status(409).json(conflictResponse(review));
            }
            if (review.status !== 'open') {
                return res.status(409).json(conflictResponse(review));
            }
            const id = givenId ?? reviews.newResolutionId();
            let accepted = null;
            let raced = null;
            reviews.updateReview(sessionId, review.id, current => {
                if (current.status !== 'open') {
                    raced = current;
                    return;
                }
                current.status = targetStatus;
                current.resolution = {
                    outcome: targetStatus,
                    id,
                    resolvedAt: Date.now(),
                    reason,
                    delivery: { state: 'pending', via: null, at: null, error: null },
                };
                accepted = current;
            });
            if (raced)
                return res.status(409).json(conflictResponse(raced));
            if (!accepted)
                return res.status(404).json({ error: 'no such review' });
            res.status(202).json({ review: reviews.clientReview(accepted) });
            emit(accepted);
            void settle(sessionId, review.id).catch(error => ports.log(`[reviews] delivering ${review.id}: ${(0, http_boundary_1.errorMessage)(error)}`));
        });
    }
    const reject = resolveOutcome('rejected');
    const dismiss = resolveOutcome('dismissed');
    const cancel = guarded((req, res) => {
        const sessionId = sessionOf(req, res);
        if (!sessionId || !requireClient(req, res))
            return;
        const review = loadReview(sessionId, req, res);
        if (!review)
            return;
        if (review.status === 'cancelled')
            return res.json({ review: reviews.clientReview(review) });
        if (review.status !== 'open') {
            return res.status(409).json(conflictResponse(review));
        }
        const cancelled = reviews.updateReview(sessionId, review.id, current => {
            if (current.status === 'open')
                current.status = 'cancelled';
        });
        if (!cancelled)
            return res.status(404).json({ error: 'no such review' });
        if (cancelled.status !== 'cancelled')
            return res.status(409).json(conflictResponse(cancelled));
        clearTimer(cancelled.id);
        detachedAt.delete(cancelled.id);
        for (const waiter of liveWaiters(cancelled.id))
            waiter.finish(cancelled);
        emit(cancelled);
        res.json({ review: reviews.clientReview(cancelled) });
    });
    function subscribe(sessionId, listener) {
        let key;
        try {
            key = (0, session_key_1.canonicalSessionId)(sessionId);
        }
        catch {
            return () => { };
        }
        const set = listeners.get(key) ?? new Set();
        listeners.set(key, set);
        set.add(listener);
        return () => {
            set.delete(listener);
            if (!set.size)
                listeners.delete(key);
        };
    }
    function removeSession(sessionId) {
        let key;
        try {
            key = (0, session_key_1.canonicalSessionId)(sessionId);
        }
        catch {
            return;
        }
        listeners.delete(key);
        for (const [reviewId, entry] of [...timers]) {
            if (entry.sessionId === key)
                clearTimer(reviewId);
        }
        for (const [reviewId, entry] of [...detachedAt]) {
            if (entry.sessionId === key)
                detachedAt.delete(reviewId);
        }
        for (const [reviewId, bucket] of [...waiters]) {
            if (bucket.sessionId !== key)
                continue;
            for (const waiter of [...bucket.set])
                waiter.close();
            waiters.delete(reviewId);
        }
        for (const [reviewId, flights] of [...inFlightWrites]) {
            for (const flight of [...flights]) {
                if (flight.sessionId === key)
                    flight.abort();
            }
            if (!flights.size)
                inFlightWrites.delete(reviewId);
        }
        try {
            reviews.deleteReviews(key);
        }
        catch (error) {
            ports.log(`[reviews] could not remove reviews for ${key}: ${(0, http_boundary_1.errorMessage)(error)}`);
        }
    }
    function start() {
        for (const review of reviews.readAllReviews(ports.log)) {
            const state = reviews.reviewDelivery(review)?.state;
            if (state === 'pending')
                schedule(review.sessionId, review.id, startedAt + graceMs - Date.now());
            if (state === 'delivering') {
                try {
                    setDelivery(review.sessionId, review.id, {
                        state: 'uncertain', via: 'message', at: null, error: 'pi-dish stopped while delivering; the agent may or may not have it',
                    });
                }
                catch (error) {
                    ports.log(`[reviews] ${review.id}: ${(0, http_boundary_1.errorMessage)(error)}`);
                }
            }
        }
    }
    function stop() {
        stopped = true;
        for (const { timer } of timers.values())
            clearTimeout(timer);
        timers.clear();
        inFlightWrites.clear();
    }
    return { create, list, get, lookup, wait, submit, reject, dismiss, cancel, media, subscribe, removeSession, start, stop };
}
