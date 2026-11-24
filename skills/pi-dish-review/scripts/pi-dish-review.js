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
const PEER_LOOKUP_TIMEOUT_MS = 15_000;
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
async function loadFleet(base) {
    if (cachedFleet === undefined)
        cachedFleet = await fleetHosts(base);
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
        const label = record((await api(base, null, '/api/host', peerInit({}))).data ?? {}).label;
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
const peerSupportsReviews = (entry) => !entry.capabilities || hostSupports(entry, 'reviewsV1');
function isSessionMissing(error) {
    const status = errorStatus(error), msg = errorBody(error).error;
    return (status === 404 && msg === 'Session not found') || (status === 400 && msg === 'Invalid session ID');
}
function peerInit(headers = CLIENT_HEADERS) {
    if (typeof AbortSignal === 'undefined' || typeof AbortSignal.timeout !== 'function')
        return { headers };
    return { headers, signal: AbortSignal.timeout(PEER_LOOKUP_TIMEOUT_MS) };
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
async function resolveExplicitHost(base, specifiers) {
    const active = specifiers.filter((item) => !!item.hostPart);
    if (!active.length)
        return null;
    await loadFleet(base);
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
/** Long-polls until the review is answered or withdrawn; null once `timeoutSecs` pass with it still open. */
async function waitFor(base, host, sessionId, reviewId, timeoutSecs) {
    const deadline = timeoutSecs === null ? Infinity : Date.now() + timeoutSecs * 1000;
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
        try {
            const { data } = await api(base, host, reviewsPath(sessionId, `/${encodeURIComponent(reviewId)}/wait?timeout=${poll}`), { headers: CLIENT_HEADERS });
            const raw = data && typeof data === 'object' && !Array.isArray(data) ? data.result : null;
            if (!raw || typeof raw !== 'object' || Array.isArray(raw))
                throw new Error('wait response ended without a review result');
            const result = raw;
            if (result.status === 'cancelled')
                return result;
            if (result.status === 'submitted') {
                if (!result.answers || typeof result.answers !== 'object' || Array.isArray(result.answers)) {
                    throw new Error('wait response reported submitted without answers');
                }
                return result;
            }
            if (result.status !== 'open')
                throw new Error(`wait response had unexpected status "${String(result.status)}"`);
            failures = 0;
            lastError = null;
        }
        catch (error) {
            // A restarting pi-dish refuses connections or drops a flushed wait; a 4xx is final.
            const status = errorStatus(error);
            if (typeof status === 'number' && status >= 400 && status < 500)
                throw error;
            lastError = error;
            if (++failures > WAIT_MAX_RETRIES)
                throw error;
            await (0, promises_1.setTimeout)(WAIT_RETRY_MS);
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
async function executeReviewCommand(base, host, sessionId, reviewId, command, timeout, json) {
    const item = reviewsPath(sessionId, `/${encodeURIComponent(reviewId)}`);
    if (command === 'wait') {
        const result = await waitFor(base, host, sessionId, reviewId, timeout);
        if (!result)
            return print({ reviewId, status: 'open' }, json, `No answer within ${timeout} s: ${OPEN_LATER}`);
        return print(result, json, answeredText(result));
    }
    if (command === 'answers') {
        const { data } = await api(base, host, item, { headers: CLIENT_HEADERS });
        return print(record(record(data ?? {}).result ?? {}), true, '');
    }
    const { data } = await api(base, host, `${item}/cancel`, jsonInit({}, CLIENT_HEADERS));
    return print(record(record(data ?? {}).review ?? {}), json, `review ${reviewId} withdrawn.`);
}
async function finishLookupHit(base, host, payload, reviewId, command, timeout, json) {
    const body = record(payload ?? {});
    if (command === 'answers')
        return print(record(body.result ?? {}), true, '');
    const ownerSessionId = typeof record(body.review ?? {}).sessionId === 'string' ? String(record(body.review ?? {}).sessionId) : '';
    if (!ownerSessionId)
        throw new Error(`review lookup for ${reviewId} returned no sessionId`);
    await executeReviewCommand(base, host, ownerSessionId, reviewId, command, timeout, json);
}
/**
 * Walk launch-provenance parent edges from the local active catalog so a worker
 * on a mixed-version fleet can still reach a spawning bot/parent session on a
 * host whose server predates GET /api/reviews/:reviewId.
 */
async function tryLaunchParents(base, localSessionId, hosts, reviewId, command, timeout, json) {
    const selfId = typeof localSessionId === 'string' ? localSessionId : String(localSessionId ?? '');
    if (!selfId || !hosts.size)
        return { done: false };
    const parents = [];
    try {
        const catalog = record((await api(base, null, '/api/sessions?active=1')).data ?? {});
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
        if (!hosts.has(parent.host))
            continue;
        try {
            await executeReviewCommand(base, parent.host, parent.sessionId, reviewId, command, timeout, json);
            return { done: true };
        }
        catch (error) {
            if (errorStatus(error) !== 404)
                return { done: false, host: parent.host, error };
        }
    }
    return { done: false };
}
async function resolveSessionOnHost(base, host, sessionRef) {
    if (sessionRef.hostIdForm)
        return null;
    try {
        return (await resolveSessionRef(base, sessionRef.id, host)).id;
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
async function runWithExplicitSession(base, explicitHost, sessionRef, reviewId, targetLabel, command, timeout, json) {
    const prefix = `${command} ${targetLabel}`;
    const targetHost = explicitHost?.host ?? null;
    // Try direct route on the chosen (or local) host first.
    try {
        return await executeReviewCommand(base, targetHost, sessionRef.id, reviewId, command, timeout, json);
    }
    catch (firstError) {
        if (!isSessionMissing(firstError))
            return await failAtHost(base, targetHost, prefix, firstError);
        // Try expanding a short ref/alias on the same host before giving up or fanning out.
        let resolvedHere = null;
        try {
            resolvedHere = await resolveSessionOnHost(base, targetHost, sessionRef);
        }
        catch (resolveError) {
            return await failAtHost(base, targetHost, prefix, resolveError);
        }
        if (resolvedHere && resolvedHere !== sessionRef.id) {
            try {
                return await executeReviewCommand(base, targetHost, resolvedHere, reviewId, command, timeout, json);
            }
            catch (retryError) {
                return await failAtHost(base, targetHost, prefix, retryError);
            }
        }
        if (explicitHost) {
            await ensureSelfLabel(base, targetHost, firstError);
            return fail(`${prefix}: Session not found: ${sessionRef.id} (${whereAsked(base, targetHost)})`);
        }
        // No explicit host: look up the session across reachable fleet peers.
        const { candidates, unreachable, unsupported } = partitionRemotePeers(await loadFleet(base));
        const report = { asked: [selfDisplay()], unreachable, unsupported, failed: [], staleLookup: [] };
        const matched = [];
        const settled = await Promise.allSettled(candidates.map(async (peer) => {
            report.asked.push(peer.name);
            const id = await resolveSessionOnHost(base, peer.name, sessionRef);
            return id ? { host: peer.name, id } : null;
        }));
        settled.forEach((outcome, index) => {
            if (outcome.status === 'fulfilled') {
                if (outcome.value)
                    matched.push(outcome.value);
            }
            else
                report.failed.push(`${candidates[index].name} (${errorMessage(outcome.reason)})`);
        });
        if (matched.length === 1) {
            try {
                return await executeReviewCommand(base, matched[0].host, matched[0].id, reviewId, command, timeout, json);
            }
            catch (peerError) {
                return await failAtHost(base, matched[0].host, prefix, peerError);
            }
        }
        if (matched.length > 1) {
            const probes = await Promise.allSettled(matched.map(async (hit) => ({
                hit, data: (await api(base, hit.host, reviewsPath(hit.id, `/${encodeURIComponent(reviewId)}`), peerInit(CLIENT_HEADERS))).data,
            })));
            const hits = probes.flatMap(outcome => outcome.status === 'fulfilled' ? [outcome.value] : []);
            if (hits.length === 1) {
                const winner = hits[0];
                if (command === 'answers')
                    return print(record(record(winner.data ?? {}).result ?? {}), true, '');
                try {
                    return await executeReviewCommand(base, winner.hit.host, winner.hit.id, reviewId, command, timeout, json);
                }
                catch (peerError) {
                    return await failAtHost(base, winner.hit.host, prefix, peerError);
                }
            }
            return fail(`${prefix}: session "${sessionRef.id}" exists on multiple hosts (${matched.map(m => m.host).join(', ')}); pass --host <name> (${formatSearchReport(base, report)})`);
        }
        return fail(`${prefix}: Session not found: ${sessionRef.id} (${formatSearchReport(base, report)})`);
    }
}
async function runByReviewId(base, explicitHost, reviewId, targetLabel, command, timeout, json) {
    const prefix = `${command} ${targetLabel}`;
    const localSessionId = discoverSessionQuietly();
    // Explicit host (--host NAME or host/reviewId), no --session.
    if (explicitHost) {
        const host = explicitHost.host;
        if (host === null && localSessionId) {
            try {
                return await executeReviewCommand(base, null, localSessionId, reviewId, command, timeout, json);
            }
            catch (error) {
                if (errorStatus(error) !== 404)
                    return await failAtHost(base, null, prefix, error);
            }
        }
        if (explicitHost.entry && !peerSupportsReviews(explicitHost.entry)) {
            return fail(`this pi-dish predates review decks (no reviewsV1); update pi-dish (${whereAsked(base, host)})`);
        }
        try {
            const { data } = await api(base, host, `/api/reviews/${encodeURIComponent(reviewId)}`, { headers: CLIENT_HEADERS });
            return await finishLookupHit(base, host, data, reviewId, command, timeout, json);
        }
        catch (error) {
            if (isBodiless404(error)) {
                const fallback = await tryLaunchParents(base, localSessionId, new Set([host]), reviewId, command, timeout, json);
                if (fallback.done)
                    return;
                if (fallback.error !== undefined)
                    return await failAtHost(base, fallback.host ?? host, prefix, fallback.error);
                return fail(`${prefix}: ${whereAsked(base, host)} does not support review lookup by id; pass --session <id> or upgrade pi-dish there`);
            }
            return await failAtHost(base, host, prefix, error);
        }
    }
    // Bare reviewId, no --session, no --host: try local caller's session first (0 extra HTTP calls on hit/non-404).
    let localError = null;
    if (localSessionId) {
        try {
            return await executeReviewCommand(base, null, localSessionId, reviewId, command, timeout, json);
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
    // Local lookup by review id (handles another session on this same host).
    let localStaleLookup = false;
    try {
        const { data } = await api(base, null, `/api/reviews/${encodeURIComponent(reviewId)}`, { headers: CLIENT_HEADERS });
        return await finishLookupHit(base, null, data, reviewId, command, timeout, json);
    }
    catch (error) {
        if (isBodiless404(error))
            localStaleLookup = true;
        else if (errorStatus(error) !== 404)
            return await failAtHost(base, null, prefix, error);
    }
    // Fleet lookup across reachable peers advertising reviewsV1.
    const { candidates, unreachable, unsupported } = partitionRemotePeers(await loadFleet(base));
    const report = {
        asked: [selfDisplay()], unreachable, unsupported, failed: [], staleLookup: localStaleLookup ? [selfDisplay()] : [],
    };
    const staleHosts = new Set(localStaleLookup ? [null] : []);
    const settled = await Promise.allSettled(candidates.map(async (peer) => {
        report.asked.push(peer.name);
        const { data } = await api(base, peer.name, `/api/reviews/${encodeURIComponent(reviewId)}`, peerInit(CLIENT_HEADERS));
        return { host: peer.name, data };
    }));
    for (let i = 0; i < settled.length; i++) {
        const outcome = settled[i], peer = candidates[i];
        if (outcome.status === 'fulfilled') {
            try {
                return await finishLookupHit(base, outcome.value.host, outcome.value.data, reviewId, command, timeout, json);
            }
            catch (error) {
                return await failAtHost(base, outcome.value.host, prefix, error);
            }
        }
        if (isBodiless404(outcome.reason)) {
            report.staleLookup.push(peer.name);
            staleHosts.add(peer.name);
        }
        else if (errorStatus(outcome.reason) !== 404)
            report.failed.push(`${peer.name} (${errorMessage(outcome.reason)})`);
    }
    // Mixed-version fallback: check launch-provenance parents on hosts predating GET /api/reviews/:reviewId.
    const fallback = await tryLaunchParents(base, localSessionId, staleHosts, reviewId, command, timeout, json);
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
        let result;
        try {
            result = await waitFor(base, host, sessionId, String(review.id), timeout);
        }
        catch (error) {
            await ensureSelfLabel(base, host, error);
            return fail(`stopped waiting for ${review.id} (${errorMessage(error)}; ${whereAsked(base, host)}); ${OPEN_LATER}`);
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
        return await runWithExplicitSession(base, explicitHost, parsedSession, parsedTarget.reviewId, target, args.command, timeout, args.json);
    }
    return await runByReviewId(base, explicitHost, parsedTarget.reviewId, target, args.command, timeout, args.json);
}
main();
