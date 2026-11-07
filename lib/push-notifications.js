// Generated from src/core/push-notifications.ts; edit that source and run npm run build:core.
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GONE_GRACE_MS = exports.FINISHED_IDLE_SAMPLES = exports.SAMPLE_INTERVAL_MS = void 0;
exports.sessionTransitions = sessionTransitions;
exports.readVapidKeys = readVapidKeys;
exports.createPushNotifier = createPushNotifier;
/**
 * Web Push: each host pushes for its own live sessions and the browser
 * subscribes to every host. All hosts must share the VAPID key pair
 * (`~/.pi/dish/vapid.json`); a mismatched host refuses subscriptions it could
 * never deliver to. Triggers: a working session idle for two samples, or a
 * pending ask dialog. The first sample after subscribing is a silent baseline.
 */
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const webpush = require("web-push");
const dishStore = require("./dish-store");
const helper_values_1 = require("./helper-values");
const http_boundary_1 = require("./http-boundary");
const VAPID_FILE = 'vapid.json';
const SUBSCRIPTIONS_STORE = 'push-subscriptions.json';
const DEFAULT_SUBJECT = 'mailto:pi-dish@example.com';
exports.SAMPLE_INTERVAL_MS = 3000;
exports.FINISHED_IDLE_SAMPLES = 2;
const PUSH_TTL_SECONDS = 4 * 60 * 60;
const PREVIEW_CHARS = 180;
/** Push services (FCM) may report "gone" for a just-provisioned subscription; young ones are only reported, not pruned. */
exports.GONE_GRACE_MS = 10 * 60 * 1000;
const MAX_ENDPOINT_LENGTH = 2048;
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;
/** `previous === null` is a silent baseline. Sessions absent from `rows` closed or crashed; they did not finish. */
function sessionTransitions(previous, rows) {
    const state = new Map();
    const transitions = [];
    for (const row of rows) {
        const busy = row.turnInProgress === true || row.compacting === true;
        const asking = row.askPending === true;
        const before = previous?.get(row.id);
        if (previous && asking && !before?.asking)
            transitions.push({ kind: 'waiting', row });
        if (busy) {
            state.set(row.id, { working: true, idleSamples: 0, asking });
            continue;
        }
        if (!before?.working) {
            state.set(row.id, { working: false, idleSamples: 0, asking });
            continue;
        }
        const idleSamples = before.idleSamples + 1;
        if (idleSamples >= exports.FINISHED_IDLE_SAMPLES) {
            transitions.push({ kind: 'finished', row });
            state.set(row.id, { working: false, idleSamples: 0, asking });
        }
        else
            state.set(row.id, { working: true, idleSamples, asking });
    }
    return { state, transitions };
}
function decodeSubscription(value, now = Date.now) {
    if (!(0, helper_values_1.record)(value) || typeof value.endpoint !== 'string' || !(0, helper_values_1.record)(value.keys))
        return null;
    const { endpoint } = value;
    const { p256dh, auth } = value.keys;
    if (endpoint.length > MAX_ENDPOINT_LENGTH || typeof p256dh !== 'string' || typeof auth !== 'string')
        return null;
    if (!BASE64URL.test(p256dh) || !BASE64URL.test(auth))
        return null;
    let url;
    try {
        url = new URL(endpoint);
    }
    catch {
        return null;
    }
    // Push services are public HTTPS endpoints; anything else is not a subscription.
    if (url.protocol !== 'https:')
        return null;
    return { endpoint, keys: { p256dh, auth }, createdAt: new Date(now()).toISOString() };
}
function assistantPreview(messages) {
    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        if (message.role !== 'assistant')
            continue;
        const parts = typeof message.content === 'string' ? [message.content]
            : Array.isArray(message.content) ? message.content.flatMap((part) => (0, helper_values_1.record)(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : []) : [];
        const text = parts.join(' ').replace(/\s+/g, ' ').trim();
        if (!text)
            continue;
        return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS - 1).trimEnd()}…` : text;
    }
    return null;
}
function decodeVapid(value) {
    if (!(0, helper_values_1.record)(value) || typeof value.publicKey !== 'string' || typeof value.privateKey !== 'string')
        return null;
    if (!BASE64URL.test(value.publicKey) || !BASE64URL.test(value.privateKey))
        return null;
    const subject = typeof value.subject === 'string' && /^(mailto:|https:)/.test(value.subject) ? value.subject : DEFAULT_SUBJECT;
    return { publicKey: value.publicKey, privateKey: value.privateKey, subject };
}
/** Private key is written 0600 and created exclusively so racing first uses can't orphan earlier subscriptions. */
function readVapidKeys() {
    const file = path.join(dishStore.dishDir(), VAPID_FILE);
    try {
        const keys = decodeVapid(JSON.parse(fs.readFileSync(file, 'utf8')));
        if (keys)
            return keys;
        throw new Error(`${file} is not a valid VAPID key file; fix or remove it.`);
    }
    catch (error) {
        if (!(0, helper_values_1.record)(error) || error.code !== 'ENOENT')
            throw error;
    }
    const generated = webpush.generateVAPIDKeys();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
        fs.writeFileSync(file, JSON.stringify({ ...generated, subject: DEFAULT_SUBJECT }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
    }
    catch (error) {
        if (!(0, helper_values_1.record)(error) || error.code !== 'EEXIST')
            throw error;
    }
    return readVapidKeys();
}
/** Collapse key per session, so an offline device receives only the latest state. */
function topicFor(tag) {
    return crypto.createHash('sha256').update(tag).digest('base64url').slice(0, 32);
}
const sendWebPush = async (subscription, payload, vapid) => {
    try {
        await webpush.sendNotification(subscription, JSON.stringify(payload), {
            vapidDetails: vapid, TTL: PUSH_TTL_SECONDS, urgency: 'high', topic: topicFor(payload.tag),
        });
        return { gone: false };
    }
    catch (error) {
        // 404/410: the browser dropped the subscription; anything else may recover.
        const status = (0, helper_values_1.record)(error) ? error.statusCode : undefined;
        if (status === 404 || status === 410)
            return { gone: true };
        throw error;
    }
};
function createPushNotifier(ports) {
    const send = ports.send || sendWebPush;
    const logError = ports.log?.error || ((message) => console.error(message));
    const now = ports.now || Date.now;
    let watch = null;
    let timer;
    let flight = null;
    let stopped = false;
    function subscriptions() {
        const list = dishStore.readStore(SUBSCRIPTIONS_STORE).subscriptions;
        if (!Array.isArray(list))
            return [];
        return list.flatMap((entry) => {
            const decoded = decodeSubscription(entry);
            return decoded ? [{ ...decoded, createdAt: (0, helper_values_1.record)(entry) && typeof entry.createdAt === 'string' ? entry.createdAt : decoded.createdAt }] : [];
        });
    }
    function save(list) {
        dishStore.writeStore(SUBSCRIPTIONS_STORE, { subscriptions: list });
    }
    /** Delivers to every target; returns the failure messages. Settled "gone" endpoints are pruned. */
    async function deliver(targets, payload) {
        const vapid = readVapidKeys();
        const gone = new Set();
        const failures = [];
        await Promise.all(targets.map(async (target) => {
            let message;
            try {
                if (!(await send(target, payload, vapid)).gone)
                    return;
                if (now() - Date.parse(target.createdAt) >= exports.GONE_GRACE_MS) {
                    gone.add(target.endpoint);
                    return;
                }
                message = 'the push service does not recognize this new subscription yet; retry in a minute';
            }
            catch (error) {
                message = (0, http_boundary_1.errorMessage)(error);
            }
            message = `${new URL(target.endpoint).host}: ${message}`;
            logError(`[push] ${message}`);
            failures.push(message);
        }));
        if (gone.size)
            save(subscriptions().filter(entry => !gone.has(entry.endpoint)));
        return failures;
    }
    function payloadFor(transition) {
        const { hostId, label } = ports.host();
        const { row, kind } = transition;
        let detail = null;
        if (kind === 'finished' && row.sessionFile) {
            try {
                detail = assistantPreview(ports.readMessages(row.sessionFile));
            }
            catch { }
        }
        // Preview leads the body for the lock screen; the host rides in the title.
        return {
            kind, hostId, sessionId: row.id,
            title: `${row.name || 'pi-dish session'} · ${label}`,
            body: detail || (kind === 'waiting' ? 'Waiting for your answer' : 'Finished'),
            tag: `${hostId}:${row.id}`,
        };
    }
    async function sample() {
        const targets = subscriptions();
        // No device listening: forget the baseline so enabling later never rings for old work.
        if (!targets.length) {
            watch = null;
            return;
        }
        const step = sessionTransitions(watch, ports.sessions());
        watch = step.state;
        for (const transition of step.transitions) {
            if (stopped)
                return;
            if (ports.agentLaunched(transition.row.id))
                continue;
            await deliver(targets, payloadFor(transition));
        }
    }
    function tick() {
        if (!flight)
            flight = sample().finally(() => { flight = null; });
        return flight;
    }
    return {
        publicKey: () => readVapidKeys().publicKey,
        subscribe(value, publicKey) {
            const subscription = decodeSubscription(value, now);
            if (!subscription)
                return { ok: false, status: 400, error: 'Invalid push subscription.' };
            if (publicKey !== readVapidKeys().publicKey) {
                return { ok: false, status: 409, error: 'This host signs with a different VAPID key. Copy ~/.pi/dish/vapid.json from the host you installed the app from.' };
            }
            save([...subscriptions().filter(entry => entry.endpoint !== subscription.endpoint), subscription]);
            return { ok: true };
        },
        unsubscribe(endpoint) {
            if (typeof endpoint !== 'string')
                return false;
            const list = subscriptions();
            if (!list.some(entry => entry.endpoint === endpoint))
                return false;
            save(list.filter(entry => entry.endpoint !== endpoint));
            return true;
        },
        async test(endpoint) {
            const target = subscriptions().find(entry => entry.endpoint === endpoint);
            if (!target)
                return false;
            const { hostId, label } = ports.host();
            const [failure] = await deliver([target], { kind: 'test', hostId, sessionId: null, title: 'pi-dish', body: `Notifications from ${label} are working.`, tag: `${hostId}:test` });
            if (failure)
                throw new Error(`Push service refused the test: ${failure}`);
            // A push service answering "gone" pruned the endpoint: report it as unregistered.
            return subscriptions().some(entry => entry.endpoint === endpoint);
        },
        async notify(payload) {
            const targets = subscriptions();
            if (!targets.length || stopped)
                return;
            const { hostId } = ports.host();
            await deliver(targets, { ...payload, hostId, tag: `${hostId}:${payload.tag}` });
        },
        sample: tick,
        start() {
            if (timer || stopped)
                return;
            timer = setInterval(() => { tick().catch(error => logError(`[push] ${(0, http_boundary_1.errorMessage)(error)}`)); }, exports.SAMPLE_INTERVAL_MS);
            timer.unref?.();
        },
        stop() { stopped = true; clearInterval(timer); timer = undefined; },
    };
}
