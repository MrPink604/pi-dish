#!/usr/bin/env node
// Generated edge from skills/pi-dish-review/scripts/pi-dish-review.ts; edit that source and run npm run build:edges.
'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Ask the user for decisions as a review deck shown inline in this session's
 * pi-dish transcript, and (by default) wait for the answers. The CLI talks
 * only to its own host on loopback; remote hosts are reached through that
 * server's /hosts/<peer> proxy. Plumbing is skills/lib.
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
const { makeFail, defaultBase, discoverSession, discoverSessionQuietly, api, jsonInit, parseCommandLine, parseRef, resolveHostPart, fleetHosts, hostSupports, resolveSessionRef, fleetHost, record, sessionRows, errorMessage, errorStatus, errorBody, } = core;
const fail = makeFail('pi-dish-review');
const USAGE = `pi-dish-review — ask the user for decisions as cards inline in this session's pi-dish transcript.

Usage: pi-dish-review ask <file.json|-> [--wait | --no-wait] [--timeout SECS]
       pi-dish-review wait <[host/]reviewId> [--timeout SECS]
       pi-dish-review answers <[host/]reviewId>
       pi-dish-review cancel <[host/]reviewId>

Flags:
  --wait           block until the user answers and print the answers (default,
                   unless the deck says "wait": false)
  --no-wait        post the deck and return; the answers arrive later in this
                   session as a "[review response: …]" message
  --timeout SECS   stop waiting after SECS; the deck stays open and the answers
                   then arrive as a message
  --json           print raw JSON
  --host NAME      act on a fleet host via this server's /hosts proxy; a
                   host-qualified <[host/]reviewId> or --session <host>/<id>
                   implies it. Without --host, answers/wait/cancel also look up
                   remote reviews across reachable fleet peers.
  --session ID     owning session id or [host/]ref (default: this session)
  --url URL        pi-dish base URL (default $PI_DISH_URL, else http://127.0.0.1:3333)

Exit codes (ask/wait): 0 answered/withdrawn/timed out, 2 rejected by user,
3 dismissed by user, 1 error. answers always exits 0 when the review exists.

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
const CLIENT_HEADERS = { 'X-Pi-Dish-Client': '1' };
const REVIEW_ID_RE = /^rv_[0-9a-f]{16}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const VALID_STATUSES = new Set(['open', 'submitted', 'cancelled', 'rejected', 'dismissed']);
const LOOKUP_TIMEOUT_MS = process.env.PI_DISH_REVIEW_LOOKUP_TIMEOUT_MS && Number.isFinite(Number(process.env.PI_DISH_REVIEW_LOOKUP_TIMEOUT_MS))
    ? Math.max(50, Number(process.env.PI_DISH_REVIEW_LOOKUP_TIMEOUT_MS)) : 15_000;
const WAIT_RETRY_MS = process.env.PI_DISH_REVIEW_WAIT_RETRY_MS && Number.isFinite(Number(process.env.PI_DISH_REVIEW_WAIT_RETRY_MS))
    ? Math.max(0, Number(process.env.PI_DISH_REVIEW_WAIT_RETRY_MS)) : 2000;
const WAIT_MAX_RETRIES = process.env.PI_DISH_REVIEW_WAIT_RETRIES && Number.isFinite(Number(process.env.PI_DISH_REVIEW_WAIT_RETRIES))
    ? Math.max(0, Math.floor(Number(process.env.PI_DISH_REVIEW_WAIT_RETRIES))) : 30;
const OPEN_LATER = 'the deck stays open in the transcript; the answers will arrive in this session as a "[review response: …]" message. '
    + 'Do not ask these questions again in chat.';
// Populated lazily only when /api/hosts or /api/host is queried, so local fast paths
// and retry-only error paths never issue extra HTTP requests.
let cachedFleet;
let cachedSelfLabel;
async function loadFleet(base, signal) {
    if (cachedFleet === undefined)
        cachedFleet = await fleetHosts(base, signal);
    if (cachedSelfLabel === undefined && cachedFleet) {
        const self = cachedFleet.find(entry => fleetHost(entry).self);
        const label = self ? fleetHost(self).label : null;
        cachedSelfLabel = typeof label === 'string' && label ? label : null;
    }
    return cachedFleet;
}
async function ensureSelfLabel(base, host, error) {
    if (host !== null || cachedSelfLabel !== undefined || typeof errorStatus(error) !== 'number')
        return;
    try {
        const init = typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
            ? { signal: AbortSignal.timeout(Math.min(2000, LOOKUP_TIMEOUT_MS)) } : {};
        const label = record((await api(base, null, '/api/host', init)).data ?? {}).label;
        cachedSelfLabel = typeof label === 'string' && label ? label : null;
    }
    catch {
        cachedSelfLabel = null;
    }
}
const selfDisplay = () => cachedSelfLabel ? `${cachedSelfLabel} (self)` : 'local host';
const whereAsked = (base, host) => host ? `server ${base}, host "${host}"` : `server ${base}, ${selfDisplay()}`;
const reviewsPath = (sessionId, rest = '') => `/api/sessions/${encodeURIComponent(String(sessionId))}/reviews${rest}`;
const isBodiless404 = (error) => errorStatus(error) === 404 && !errorBody(error).error;
const isNoSuchReview = (error) => errorStatus(error) === 404 && errorBody(error).error === 'no such review';
const peerSupportsReviews = (entry) => !entry.capabilities || hostSupports(entry, 'reviewsV1');
function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}
function isSessionMissing(error) {
    const status = errorStatus(error), msg = errorBody(error).error;
    return (status === 404 && msg === 'Session not found') || (status === 400 && msg === 'Invalid session ID');
}
/** Strict validation so an empty/partial/mismatched HTTP 200 never passes as a valid review. */
function parseReviewPayload(payload, expectedReviewId) {
    if (!isPlainObject(payload))
        return null;
    const rev = payload.review, res = payload.result;
    if (!isPlainObject(rev) || !isPlainObject(res))
        return null;
    if (rev.id !== expectedReviewId || res.reviewId !== expectedReviewId)
        return null;
    if (typeof rev.sessionId !== 'string' || !rev.sessionId)
        return null;
    if (typeof rev.status !== 'string' || !VALID_STATUSES.has(rev.status))
        return null;
    if (typeof res.status !== 'string' || !VALID_STATUSES.has(res.status))
        return null;
    if (res.status === 'submitted' && !isPlainObject(res.answers))
        return null;
    return { review: rev, result: res, sessionId: rev.sessionId };
}
function parseCancelledReview(payload, expectedReviewId) {
    if (!isPlainObject(payload) || !isPlainObject(payload.review))
        return null;
    const rev = payload.review;
    return rev.id === expectedReviewId && rev.status === 'cancelled' && rev.outcome === undefined && !rev.resolution ? rev : null;
}
// Matches src/core/page-forms.ts visibleText: C0 (except tab and newline), DEL, C1, bidi and line-separator controls.
const CONTROL_RE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
function visibleText(text) {
    return text.replace(/\r\n?/g, '\n').replace(CONTROL_RE, char => {
        const code = char.charCodeAt(0);
        return code <= 0xff ? `\\x${code.toString(16).padStart(2, '0')}` : `\\u${code.toString(16).padStart(4, '0')}`;
    });
}
/** One end-to-end AbortSignal budget covering headers and body reads across all discovery calls. */
function createDiscoveryBudget(waitDeadline) {
    const remaining = Math.min(LOOKUP_TIMEOUT_MS, Math.max(0, waitDeadline - Date.now()));
    const controller = new AbortController();
    const label = remaining < 1000 ? `${Math.round(remaining)}ms` : `${Math.round(remaining / 100) / 10}s`;
    const abortTimedOut = () => controller.abort(new Error(`timed out after ${label}`));
    if (remaining <= 0) {
        abortTimedOut();
        return { signal: controller.signal, abort: () => { }, dispose: () => { } };
    }
    const timer = setTimeout(abortTimedOut, remaining);
    timer.unref();
    return {
        signal: controller.signal,
        abort(reason) { clearTimeout(timer); controller.abort(reason); },
        dispose() { clearTimeout(timer); },
    };
}
function withSignal(signal, headers = CLIENT_HEADERS) {
    return signal ? { headers, signal } : { headers };
}
function formatSearchReport(base, report) {
    const parts = [`server ${base}`];
    if (report.asked.length)
        parts.push(`hosts asked: ${report.asked.join(', ')}`);
    if (report.unreachable.length)
        parts.push(`unreachable: ${report.unreachable.join(', ')}`);
    if (report.unsupported.length)
        parts.push(`no reviewsV1: ${report.unsupported.join(', ')}`);
    if (report.failed.length)
        parts.push(`failed: ${report.failed.join(', ')}`);
    return parts.join('; ');
}
async function failAtHost(base, host, prefix, error) {
    await ensureSelfLabel(base, host, error);
    if (isBodiless404(error))
        return fail(`this pi-dish predates review decks (no reviewsV1); update pi-dish (${whereAsked(base, host)})`);
    fail(`${prefix}: ${errorMessage(error)} (${whereAsked(base, host)})`);
}
async function failPost(base, host, error) {
    await ensureSelfLabel(base, host, error);
    if (isBodiless404(error))
        return fail(`this pi-dish predates review decks (no reviewsV1); update pi-dish, or ask in chat (${whereAsked(base, host)})`);
    const errors = errorBody(error).errors;
    if (Array.isArray(errors))
        return fail(`the review was refused; fix and post again:\n${errors.map(line => `  - ${line}`).join('\n')}`);
    fail(`could not post the review: ${errorMessage(error)} (${whereAsked(base, host)})`);
}
function parseReviewTarget(raw) {
    const trimmed = raw.trim();
    if (!trimmed)
        throw new Error('a review id is required');
    const slash = trimmed.indexOf('/');
    if (slash !== -1) {
        const hostPart = trimmed.slice(0, slash), reviewId = trimmed.slice(slash + 1);
        if (!hostPart)
            throw new Error(`invalid review ref "${trimmed}": nothing before "/" to name a host`);
        if (!reviewId)
            throw new Error(`invalid review ref "${trimmed}": nothing after "/" to name a review`);
        return { hostPart, reviewId };
    }
    const colon = trimmed.indexOf(':');
    if (colon > 0 && UUID_RE.test(trimmed.slice(0, colon)) && trimmed.slice(colon + 1)) {
        return { hostPart: trimmed.slice(0, colon), reviewId: trimmed.slice(colon + 1) };
    }
    return { hostPart: null, reviewId: trimmed };
}
async function resolveExplicitHost(base, specifiers, signal) {
    const active = specifiers.filter((item) => !!item.hostPart);
    if (!active.length)
        return null;
    await loadFleet(base, signal);
    let chosen = null;
    for (const item of active) {
        let resolved;
        try {
            resolved = await resolveHostPart(base, item.hostPart);
        }
        catch (error) {
            throw new Error(`${errorMessage(error)} (server ${base})`);
        }
        const host = resolved.host == null ? null : String(resolved.host);
        if (chosen && chosen.host !== host) {
            throw new Error(`conflicting hosts: ${chosen.source} names "${chosen.hostPart}" (${chosen.host ?? selfDisplay()}) `
                + `but ${item.source} names "${item.hostPart}" (${host ?? selfDisplay()}) (server ${base})`);
        }
        if (!chosen)
            chosen = { source: item.source, hostPart: item.hostPart, host, entry: resolved.entry };
    }
    return chosen ? { host: chosen.host, entry: chosen.entry } : null;
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
/** Long-polls until the review is answered, rejected, dismissed or withdrawn; null once `deadline` passes with it still open. */
async function waitFor(base, host, sessionId, reviewId, deadline) {
    let failures = 0;
    let lastError = null;
    for (;;) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) {
            if (failures > 0 && lastError !== null)
                throw lastError;
            return null;
        }
        const poll = Math.max(1, Math.min(50, Math.ceil(remaining / 1000)));
        const init = { headers: CLIENT_HEADERS };
        let pollTimedOut = false;
        let timer = null;
        if (Number.isFinite(deadline)) {
            const controller = new AbortController();
            init.signal = controller.signal;
            timer = setTimeout(() => { pollTimedOut = true; controller.abort(new Error('wait poll timed out')); }, remaining);
            timer.unref();
        }
        try {
            const { data } = await api(base, host, reviewsPath(sessionId, `/${encodeURIComponent(reviewId)}/wait?timeout=${poll}&outcomes=1`), init);
            const raw = isPlainObject(data) ? data.result : null;
            if (!isPlainObject(raw))
                throw new Error('wait response ended without a review result');
            if (raw.reviewId !== undefined && raw.reviewId !== reviewId)
                throw new Error(`wait response returned review "${String(raw.reviewId)}" instead of "${reviewId}"`);
            if (raw.status === 'cancelled' || raw.status === 'rejected' || raw.status === 'dismissed')
                return raw;
            if (raw.status === 'submitted') {
                if (!isPlainObject(raw.answers))
                    throw new Error('wait response reported submitted without answers');
                return raw;
            }
            if (raw.status !== 'open')
                throw new Error(`wait response had unexpected status "${String(raw.status)}"`);
            failures = 0;
            lastError = null;
        }
        catch (error) {
            if (pollTimedOut && deadline - Date.now() <= 0) {
                if (failures > 0 && lastError !== null)
                    throw lastError;
                return null;
            }
            // A restarting pi-dish refuses connections or drops a flushed wait; a 4xx is final.
            const status = errorStatus(error);
            if (typeof status === 'number' && status >= 400 && status < 500)
                throw error;
            lastError = error;
            if (++failures > WAIT_MAX_RETRIES)
                throw error;
            await (0, promises_1.setTimeout)(WAIT_RETRY_MS);
        }
        finally {
            if (timer)
                clearTimeout(timer);
        }
    }
}
function outcomeExitCode(status) {
    if (status === 'rejected')
        return 2;
    if (status === 'dismissed')
        return 3;
    return 0;
}
function messageDeliveryNote(delivery, deliveredText) {
    if (delivery.via !== 'message')
        return null;
    const state = typeof delivery.state === 'string' && delivery.state ? delivery.state : 'unknown';
    if (state === 'delivered')
        return deliveredText;
    const error = typeof delivery.error === 'string' && delivery.error.trim() ? visibleText(delivery.error.trim()) : null;
    return `(Session message delivery state: ${visibleText(state)}${error ? ` — ${error}` : ''}.)`;
}
function answeredText(result) {
    if (result.status === 'cancelled')
        return `review ${result.reviewId} was withdrawn; it has no answers.`;
    const delivery = record(result.delivery ?? {});
    if (result.status === 'rejected') {
        const reason = typeof result.reason === 'string' && result.reason.trim() ? visibleText(result.reason.trim()) : null;
        const lines = [`review ${result.reviewId} was REJECTED by the user (no answers).`];
        if (reason) {
            if (reason.includes('\n'))
                lines.push('reason: |', ...reason.split('\n').map(line => `  ${line}`));
            else
                lines.push(`reason: ${reason}`);
        }
        lines.push('Do not proceed with the proposal as presented.');
        const note = messageDeliveryNote(delivery, '(This was also sent to this session as a "[review response: …]" message.)');
        if (note)
            lines.push(note);
        return lines.join('\n');
    }
    if (result.status === 'dismissed') {
        const lines = [
            `review ${result.reviewId} was DISMISSED by the user (no answers).`,
            'Proceed on your own judgement or drop it.',
        ];
        const note = messageDeliveryNote(delivery, '(This was also sent to this session as a "[review response: …]" message.)');
        if (note)
            lines.push(note);
        return lines.join('\n');
    }
    const note = messageDeliveryNote(delivery, '(These answers were also sent to this session as a "[review response: …]" message.)');
    const also = note ? `\n${note}` : '';
    return `${JSON.stringify(result, null, 2)}${also}`;
}
async function executeReviewCommand(base, host, sessionId, reviewId, command, timeoutSecs, waitDeadline, json, signal) {
    const item = reviewsPath(sessionId, `/${encodeURIComponent(reviewId)}`);
    if (command === 'wait') {
        const result = await waitFor(base, host, sessionId, reviewId, waitDeadline);
        if (!result)
            return print({ reviewId, status: 'open' }, json, `No answer within ${timeoutSecs} s: ${OPEN_LATER}`);
        print(result, json, answeredText(result));
        const code = outcomeExitCode(result.status);
        if (code)
            process.exitCode = code;
        return;
    }
    if (command === 'answers') {
        const { data } = await api(base, host, item, withSignal(signal));
        const parsed = parseReviewPayload(data, reviewId);
        if (!parsed)
            throw new Error(`malformed review response for ${reviewId}`);
        return print(parsed.result, true, '');
    }
    const { data } = await api(base, host, `${item}/cancel`, { ...jsonInit({}, CLIENT_HEADERS), ...(signal ? { signal } : {}) });
    const review = parseCancelledReview(data, reviewId);
    if (!review)
        throw new Error(`malformed cancel response for ${reviewId}`);
    return print(review, json, `review ${reviewId} withdrawn.`);
}
async function finishValidatedHit(base, host, hit, reviewId, command, timeoutSecs, waitDeadline, json) {
    if (command === 'answers')
        return print(hit.result, true, '');
    await executeReviewCommand(base, host, hit.sessionId, reviewId, command, timeoutSecs, waitDeadline, json);
}
/**
 * Walk launch-provenance parent edges from the local active catalog so a worker
 * on a mixed-version fleet can still reach a spawning bot/parent session on a
 * host whose server predates GET /api/reviews/:reviewId.
 */
async function tryLaunchParents(base, localSessionId, hosts, reviewId, command, timeoutSecs, waitDeadline, json, signal) {
    const selfId = typeof localSessionId === 'string' ? localSessionId : String(localSessionId ?? '');
    if (!selfId || !hosts.size || signal.aborted)
        return { done: false };
    const parents = [];
    try {
        const catalog = record((await api(base, null, '/api/sessions?active=1', { signal })).data ?? {});
        const byId = new Map();
        for (const row of [...sessionRows(catalog.active), ...sessionRows(catalog.children), ...sessionRows(catalog.previous)]) {
            const r = record(row);
            if (typeof r.id === 'string')
                byId.set(r.id, r);
        }
        const visited = new Set();
        let currentId = selfId;
        for (let depth = 0; depth < 8 && currentId && !visited.has(currentId); depth++) {
            visited.add(currentId);
            const parentId = typeof byId.get(currentId)?.parentId === 'string' ? String(byId.get(currentId).parentId) : null;
            if (!parentId)
                break;
            const parsed = parseRef(parentId);
            if (parsed.hostPart) {
                try {
                    const resolved = await resolveHostPart(base, parsed.hostPart);
                    parents.push({ host: resolved.host == null ? null : String(resolved.host), sessionId: parsed.id });
                }
                catch { }
                break;
            }
            parents.push({ host: null, sessionId: parsed.id });
            currentId = parsed.id;
        }
    }
    catch {
        return { done: false };
    }
    for (const parent of parents) {
        if (!hosts.has(parent.host) || signal.aborted)
            continue;
        try {
            const { data } = await api(base, parent.host, reviewsPath(parent.sessionId, `/${encodeURIComponent(reviewId)}`), withSignal(signal));
            const valid = parseReviewPayload(data, reviewId);
            if (!valid)
                return { done: false, host: parent.host, error: new Error(`malformed review response for ${reviewId}`) };
            await finishValidatedHit(base, parent.host, valid, reviewId, command, timeoutSecs, waitDeadline, json);
            return { done: true };
        }
        catch (error) {
            if (errorStatus(error) !== 404)
                return { done: false, host: parent.host, error };
        }
    }
    return { done: false };
}
async function resolveSessionOnHost(base, host, sessionRef, signal) {
    if (sessionRef.hostIdForm)
        return null;
    try {
        return (await resolveSessionRef(base, sessionRef.id, host, signal ? { signal } : undefined)).id;
    }
    catch (error) {
        if (errorStatus(error) === 404 || /^(?:Session not found|id prefix must be at least 4 characters)/i.test(errorMessage(error))) {
            return null;
        }
        throw error;
    }
}
function partitionRemotePeers(hosts) {
    const candidates = [];
    const unreachable = [];
    const unsupported = [];
    for (const value of hosts ?? []) {
        const entry = fleetHost(value);
        const name = !entry.self && typeof entry.name === 'string' ? entry.name : '';
        if (!name)
            continue;
        if (!entry.reachable)
            unreachable.push(`${name} (${String(entry.error || 'unreachable')})`);
        else if (!peerSupportsReviews(entry))
            unsupported.push(name);
        else
            candidates.push({ name, entry });
    }
    return { candidates, unreachable, unsupported };
}
/**
 * Fan out across candidate peers under one shared deadline, returning as soon as
 * the first valid review arrives (and aborting any slower/stalled probes).
 */
async function racePeers(candidates, budget, probe) {
    if (!candidates.length)
        return { winner: null, failed: [], staleLookup: [] };
    const failed = [];
    const staleLookup = [];
    let winner = null;
    await new Promise(resolve => {
        let remaining = candidates.length;
        const finish = () => { if (--remaining === 0)
            resolve(); };
        for (const peer of candidates) {
            void probe(peer.name).then(found => {
                if (found && !winner) {
                    winner = found;
                    budget.abort();
                    resolve();
                    return;
                }
                finish();
            }, reason => {
                if (winner)
                    return;
                if (isBodiless404(reason))
                    staleLookup.push(peer.name);
                else if (errorStatus(reason) !== 404)
                    failed.push(`${peer.name} (${errorMessage(reason)})`);
                finish();
            });
        }
    });
    return { winner, failed, staleLookup };
}
async function runWithExplicitSession(base, explicitHost, sessionRef, reviewId, targetLabel, command, timeoutSecs, waitDeadline, json) {
    const prefix = `${command} ${targetLabel}`;
    // Explicitly host-qualified request stays pinned to that host.
    if (explicitHost) {
        const targetHost = explicitHost.host;
        try {
            return await executeReviewCommand(base, targetHost, sessionRef.id, reviewId, command, timeoutSecs, waitDeadline, json);
        }
        catch (firstError) {
            if (!isSessionMissing(firstError))
                return await failAtHost(base, targetHost, prefix, firstError);
            let resolvedHere = null;
            try {
                resolvedHere = await resolveSessionOnHost(base, targetHost, sessionRef);
            }
            catch (resolveError) {
                return await failAtHost(base, targetHost, prefix, resolveError);
            }
            if (resolvedHere && resolvedHere !== sessionRef.id) {
                try {
                    return await executeReviewCommand(base, targetHost, resolvedHere, reviewId, command, timeoutSecs, waitDeadline, json);
                }
                catch (retryError) {
                    return await failAtHost(base, targetHost, prefix, retryError);
                }
            }
            await ensureSelfLabel(base, targetHost, firstError);
            return fail(`${prefix}: Session not found: ${sessionRef.id} (${whereAsked(base, targetHost)})`);
        }
    }
    // Unqualified --session: try local first (fast path); any local 404/missing-session carries on to peers.
    let localMatchedSession = false;
    let localStaleReviews = false;
    const localFailed = [];
    const budget = createDiscoveryBudget(waitDeadline);
    try {
        try {
            return await executeReviewCommand(base, null, sessionRef.id, reviewId, command, timeoutSecs, waitDeadline, json);
        }
        catch (firstError) {
            if (isNoSuchReview(firstError))
                localMatchedSession = true;
            else if (isBodiless404(firstError))
                localStaleReviews = true;
            else if (isSessionMissing(firstError)) {
                let resolvedHere = null;
                try {
                    resolvedHere = await resolveSessionOnHost(base, null, sessionRef, budget.signal);
                }
                catch (resolveError) {
                    if (errorStatus(resolveError) !== 404 && !/ambiguous session id prefix/i.test(errorMessage(resolveError))) {
                        return await failAtHost(base, null, prefix, resolveError);
                    }
                    localFailed.push(`${selfDisplay()} (${errorMessage(resolveError)})`);
                }
                if (resolvedHere && resolvedHere !== sessionRef.id) {
                    try {
                        return await executeReviewCommand(base, null, resolvedHere, reviewId, command, timeoutSecs, waitDeadline, json);
                    }
                    catch (retryError) {
                        if (isNoSuchReview(retryError))
                            localMatchedSession = true;
                        else if (isBodiless404(retryError))
                            localStaleReviews = true;
                        else
                            return await failAtHost(base, null, prefix, retryError);
                    }
                }
            }
            else {
                return await failAtHost(base, null, prefix, firstError);
            }
        }
        const hosts = await loadFleet(base, budget.signal);
        const { candidates, unreachable, unsupported } = partitionRemotePeers(hosts);
        const report = {
            asked: [selfDisplay(), ...candidates.map(peer => peer.name)],
            unreachable, unsupported, failed: [...localFailed], staleLookup: [],
        };
        if (!hosts && budget.signal.aborted)
            report.failed.push(`${selfDisplay()} (/api/hosts: ${errorMessage(budget.signal.reason)})`);
        let peerMatchedSession = false;
        const { winner, failed, staleLookup } = await racePeers(candidates, budget, async (peerName) => {
            const peerSessionId = await resolveSessionOnHost(base, peerName, sessionRef, budget.signal);
            if (!peerSessionId)
                return null;
            peerMatchedSession = true;
            const { data } = await api(base, peerName, reviewsPath(peerSessionId, `/${encodeURIComponent(reviewId)}`), withSignal(budget.signal));
            const hit = parseReviewPayload(data, reviewId);
            if (!hit)
                throw new Error(`malformed review response for ${reviewId}`);
            return { host: peerName, hit };
        });
        report.failed.push(...failed);
        report.staleLookup.push(...staleLookup);
        if (winner) {
            budget.dispose();
            try {
                return await finishValidatedHit(base, winner.host, winner.hit, reviewId, command, timeoutSecs, waitDeadline, json);
            }
            catch (peerError) {
                return await failAtHost(base, winner.host, prefix, peerError);
            }
        }
        if (localStaleReviews && !candidates.length) {
            return fail(`this pi-dish predates review decks (no reviewsV1); update pi-dish (${formatSearchReport(base, report)})`);
        }
        const reason = localMatchedSession || peerMatchedSession ? 'no such review' : `Session not found: ${sessionRef.id}`;
        return fail(`${prefix}: ${reason} (${formatSearchReport(base, report)})`);
    }
    finally {
        budget.dispose();
    }
}
async function runByReviewId(base, explicitHost, reviewId, targetLabel, command, timeoutSecs, waitDeadline, json) {
    const prefix = `${command} ${targetLabel}`;
    const localSessionId = discoverSessionQuietly();
    // Explicit host (--host NAME or host/reviewId), no --session.
    if (explicitHost) {
        const host = explicitHost.host;
        if (host === null && localSessionId) {
            try {
                return await executeReviewCommand(base, null, localSessionId, reviewId, command, timeoutSecs, waitDeadline, json);
            }
            catch (error) {
                if (errorStatus(error) !== 404)
                    return await failAtHost(base, null, prefix, error);
            }
        }
        if (explicitHost.entry && !peerSupportsReviews(explicitHost.entry)) {
            return fail(`this pi-dish predates review decks (no reviewsV1); update pi-dish (${whereAsked(base, host)})`);
        }
        const budget = createDiscoveryBudget(waitDeadline);
        try {
            const { data } = await api(base, host, `/api/reviews/${encodeURIComponent(reviewId)}`, withSignal(budget.signal));
            const hit = parseReviewPayload(data, reviewId);
            if (!hit)
                throw new Error(`malformed review response for ${reviewId}`);
            budget.dispose();
            return await finishValidatedHit(base, host, hit, reviewId, command, timeoutSecs, waitDeadline, json);
        }
        catch (error) {
            if (isBodiless404(error)) {
                const fallback = await tryLaunchParents(base, localSessionId, new Set([host]), reviewId, command, timeoutSecs, waitDeadline, json, budget.signal);
                if (fallback.done)
                    return;
                if (fallback.error !== undefined)
                    return await failAtHost(base, fallback.host ?? host, prefix, fallback.error);
                return fail(`${prefix}: ${whereAsked(base, host)} does not support review lookup by id; pass --session <id> or upgrade pi-dish there`);
            }
            return await failAtHost(base, host, prefix, error);
        }
        finally {
            budget.dispose();
        }
    }
    // Bare reviewId, no --session, no --host: try local caller's session first (0 extra HTTP calls on hit/non-404).
    let localError = null;
    if (localSessionId) {
        try {
            return await executeReviewCommand(base, null, localSessionId, reviewId, command, timeoutSecs, waitDeadline, json);
        }
        catch (error) {
            if (errorStatus(error) !== 404)
                return await failAtHost(base, null, prefix, error);
            localError = error;
        }
    }
    if (!REVIEW_ID_RE.test(reviewId)) {
        if (localError)
            return await failAtHost(base, null, prefix, localError);
        return fail(`${prefix}: no such review (${whereAsked(base, null)})`);
    }
    const budget = createDiscoveryBudget(waitDeadline);
    try {
        // Local lookup by review id (handles another session on this same host).
        let localStaleLookup = false;
        const localFailed = [];
        try {
            const { data } = await api(base, null, `/api/reviews/${encodeURIComponent(reviewId)}`, withSignal(budget.signal));
            const hit = parseReviewPayload(data, reviewId);
            if (hit) {
                budget.dispose();
                return await finishValidatedHit(base, null, hit, reviewId, command, timeoutSecs, waitDeadline, json);
            }
            localFailed.push(`${selfDisplay()} (malformed review response for ${reviewId})`);
        }
        catch (error) {
            if (isBodiless404(error))
                localStaleLookup = true;
            else if (errorStatus(error) !== 404)
                return await failAtHost(base, null, prefix, error);
        }
        // Fleet lookup across reachable peers advertising reviewsV1, finishing on the first valid review.
        const hosts = await loadFleet(base, budget.signal);
        const { candidates, unreachable, unsupported } = partitionRemotePeers(hosts);
        const report = {
            asked: [selfDisplay(), ...candidates.map(peer => peer.name)],
            unreachable, unsupported, failed: localFailed, staleLookup: localStaleLookup ? [selfDisplay()] : [],
        };
        if (!hosts && budget.signal.aborted)
            report.failed.push(`${selfDisplay()} (/api/hosts: ${errorMessage(budget.signal.reason)})`);
        const { winner, failed, staleLookup } = await racePeers(candidates, budget, async (peerName) => {
            const { data } = await api(base, peerName, `/api/reviews/${encodeURIComponent(reviewId)}`, withSignal(budget.signal));
            const hit = parseReviewPayload(data, reviewId);
            if (!hit)
                throw new Error(`malformed review response for ${reviewId}`);
            return { host: peerName, hit };
        });
        report.failed.push(...failed);
        report.staleLookup.push(...staleLookup);
        if (winner) {
            budget.dispose();
            try {
                return await finishValidatedHit(base, winner.host, winner.hit, reviewId, command, timeoutSecs, waitDeadline, json);
            }
            catch (error) {
                return await failAtHost(base, winner.host, prefix, error);
            }
        }
        // Mixed-version fallback: check launch-provenance parents on hosts predating GET /api/reviews/:reviewId.
        const staleHosts = new Set([...(localStaleLookup ? [null] : []), ...staleLookup]);
        const fallback = await tryLaunchParents(base, localSessionId, staleHosts, reviewId, command, timeoutSecs, waitDeadline, json, budget.signal);
        if (fallback.done)
            return;
        if (fallback.error !== undefined)
            return await failAtHost(base, fallback.host ?? null, prefix, fallback.error);
        if (localError && isBodiless404(localError) && !candidates.length) {
            return fail(`this pi-dish predates review decks (no reviewsV1); update pi-dish (${formatSearchReport(base, report)})`);
        }
        const staleNote = report.staleLookup.length
            ? `; ${report.staleLookup.join(', ')} predates review lookup by id (pass --session [host/]ID or upgrade pi-dish there)` : '';
        return fail(`${prefix}: no such review (${formatSearchReport(base, report)}${staleNote})`);
    }
    finally {
        budget.dispose();
    }
}
async function main() {
    const argv = process.argv.slice(2);
    if (!argv.length || argv.includes('--help') || argv.includes('-h') || argv[0] === 'help')
        return void process.stdout.write(USAGE + '\n');
    const hasWait = argv.includes('--wait'), hasNoWait = argv.includes('--no-wait');
    if (hasWait && hasNoWait)
        return fail('--wait and --no-wait cannot be used together');
    const waitFlag = hasWait ? true : hasNoWait ? false : null;
    // `-` (stdin) is a positional the shared parser would take for an option.
    const fromStdin = argv.slice(1).includes('-');
    let args;
    try {
        args = parseCommandLine(argv.filter((arg, index) => arg !== '--wait' && arg !== '--no-wait' && !(index > 0 && arg === '-')), 'ask', ['timeout', 'host']);
    }
    catch (error) {
        return fail(errorMessage(error));
    }
    const timeout = args.values.timeout === undefined ? null : Number(args.values.timeout);
    if (timeout !== null && !(Number.isFinite(timeout) && timeout > 0))
        return fail('--timeout must be a positive number of seconds');
    const base = defaultBase(args.url);
    const hostFlag = args.values.host;
    const target = fromStdin ? '-' : args.positional[0];
    let parsedSession = null;
    if (args.session !== undefined) {
        try {
            parsedSession = parseRef(args.session);
        }
        catch (error) {
            return fail(errorMessage(error));
        }
    }
    if (args.command === 'ask') {
        if (!target)
            return fail('ask needs a deck file (or - for stdin)');
        let explicitHost;
        try {
            explicitHost = await resolveExplicitHost(base, [
                { source: '--host', hostPart: hostFlag },
                { source: '--session', hostPart: parsedSession?.hostPart },
            ]);
        }
        catch (error) {
            return fail(errorMessage(error));
        }
        const host = explicitHost?.host ?? null;
        if (host && !parsedSession)
            return fail(`--host ${host} with ask requires --session <id> on that host (server ${base})`);
        let sessionId;
        if (parsedSession)
            sessionId = parsedSession.id;
        else {
            try {
                sessionId = discoverSession();
            }
            catch (error) {
                return fail(errorMessage(error));
            }
        }
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
        const postReview = async (sid) => record(record((await api(base, host, reviewsPath(sid), jsonInit({ ...deck, wait }, CLIENT_HEADERS))).data ?? {}).review ?? {});
        let review;
        try {
            review = await postReview(sessionId);
        }
        catch (error) {
            if (parsedSession && isSessionMissing(error)) {
                let resolvedId = null;
                try {
                    resolvedId = await resolveSessionOnHost(base, host, parsedSession);
                }
                catch (resolveError) {
                    return await failPost(base, host, resolveError);
                }
                if (!resolvedId || resolvedId === parsedSession.id)
                    return await failPost(base, host, error);
                sessionId = resolvedId;
                try {
                    review = await postReview(sessionId);
                }
                catch (retryError) {
                    return await failPost(base, host, retryError);
                }
            }
            else {
                return await failPost(base, host, error);
            }
        }
        const cards = Array.isArray(review.cards) ? review.cards.length : 0;
        const page = typeof review.companionPage === 'string' ? ` Full detail: ${review.companionPage}` : '';
        const summary = `Review "${review.title}" (${review.id}): ${cards} card${cards === 1 ? '' : 's'} for the user, inline in this session's pi-dish transcript.${page}`;
        if (!wait)
            return print(review, args.json, `${summary}\nThe answers arrive in this session as a "[review response: …]" message. End your turn now; do not repeat the questions in chat.`);
        if (!args.json)
            process.stdout.write(`${summary}\nWaiting for the answers…\n`);
        const waitDeadline = timeout === null ? Infinity : Date.now() + timeout * 1000;
        let result;
        try {
            result = await waitFor(base, host, sessionId, String(review.id), waitDeadline);
        }
        catch (error) {
            await ensureSelfLabel(base, host, error);
            return fail(`stopped waiting for ${review.id} (${errorMessage(error)}; ${whereAsked(base, host)}); ${OPEN_LATER}`);
        }
        if (!result)
            return print({ reviewId: review.id, status: 'open' }, args.json, `No answer within ${timeout} s: ${OPEN_LATER}`);
        print(result, args.json, answeredText(result));
        const code = outcomeExitCode(result.status);
        if (code)
            process.exitCode = code;
        return;
    }
    if (args.command !== 'wait' && args.command !== 'answers' && args.command !== 'cancel') {
        return fail(`unknown command: ${args.command} (use ask, wait, answers or cancel; run --help for usage)`);
    }
    if (!target)
        return fail(`${args.command} needs a review id`);
    const waitDeadline = args.command === 'wait' && timeout !== null ? Date.now() + timeout * 1000 : Infinity;
    let parsedTarget;
    try {
        parsedTarget = parseReviewTarget(target);
    }
    catch (error) {
        return fail(errorMessage(error));
    }
    let explicitHost;
    try {
        explicitHost = await resolveExplicitHost(base, [
            { source: '--host', hostPart: hostFlag },
            { source: `ref "${target}"`, hostPart: parsedTarget.hostPart },
            { source: '--session', hostPart: parsedSession?.hostPart },
        ]);
    }
    catch (error) {
        return fail(errorMessage(error));
    }
    if (parsedSession) {
        return await runWithExplicitSession(base, explicitHost, parsedSession, parsedTarget.reviewId, target, args.command, timeout, waitDeadline, args.json);
    }
    return await runByReviewId(base, explicitHost, parsedTarget.reviewId, target, args.command, timeout, waitDeadline, args.json);
}
main();
