/**
 * Web Push for installed browser clients. Each host pushes for its own live
 * sessions; the browser registers one subscription with every host, so the
 * fleet keeps its no-hub-aggregation rule. Every host must therefore sign with
 * the same VAPID key pair (`~/.pi/dish/vapid.json`, file-level like the token):
 * a host whose key differs from the subscribing origin's refuses the
 * subscription instead of accepting one it can never deliver to.
 *
 * Triggers come from sampling the host's live-session catalog, which every
 * harness bridge keeps current in its registry entry without a socket client:
 *   - finished: a session observed working is idle for two consecutive samples
 *     (the gap between turns, or a provider retry, must not ring);
 *   - waiting: a session's ask dialog becomes pending.
 * The first sample after subscriptions appear is a baseline and never rings.
 */
import crypto = require('crypto');
import fs = require('fs');
import path = require('path');
import webpush = require('web-push');
import dishStore = require('./dish-store');
import { isRecord } from './wire-protocol';

const VAPID_FILE = 'vapid.json';
const SUBSCRIPTIONS_STORE = 'push-subscriptions.json';
const DEFAULT_SUBJECT = 'mailto:pi-dish@example.com';
export const SAMPLE_INTERVAL_MS = 3000;
/** Consecutive idle samples before a working session counts as finished. */
export const FINISHED_IDLE_SAMPLES = 2;
const PUSH_TTL_SECONDS = 4 * 60 * 60;
const PREVIEW_CHARS = 180;
/**
 * A push service may answer "gone" for a subscription it has not finished
 * provisioning (observed with FCM right after subscribe). Pruning then would
 * silently drop a working device, so young subscriptions are only reported.
 */
export const GONE_GRACE_MS = 10 * 60 * 1000;
const MAX_ENDPOINT_LENGTH = 2048;
const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

export interface VapidKeys {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly subject: string;
}

export interface PushSubscriptionRecord {
  readonly endpoint: string;
  readonly keys: { readonly p256dh: string; readonly auth: string };
  readonly createdAt: string;
}

export interface PushSessionRow {
  readonly id: string;
  readonly name?: string | null;
  readonly turnInProgress?: boolean;
  readonly askPending?: boolean;
  readonly compacting?: boolean;
  readonly sessionFile?: string | null;
}

export type PushEventKind = 'finished' | 'waiting';

export interface PushPayload {
  readonly kind: PushEventKind | 'test' | 'vault';
  readonly title: string;
  readonly body: string;
  readonly hostId: string;
  readonly sessionId: string | null;
  /** Notification tag: one visible notification per session per device. */
  readonly tag: string;
  /** Pending vault approval the notification opens (kind `vault` only). */
  readonly vaultRequestId?: string;
}

interface SessionWatch { working: boolean; idleSamples: number; asking: boolean }
export type SessionWatchState = ReadonlyMap<string, Readonly<SessionWatch>>;
export interface SessionTransition { readonly kind: PushEventKind; readonly row: PushSessionRow }

/**
 * Pure transition step. `previous === null` is a baseline sample: it records
 * state and never reports. Sessions absent from `rows` are dropped silently —
 * a session that closed or crashed did not finish.
 */
export function sessionTransitions(previous: SessionWatchState | null, rows: readonly PushSessionRow[]): {
  readonly state: SessionWatchState; readonly transitions: readonly SessionTransition[];
} {
  const state = new Map<string, SessionWatch>();
  const transitions: SessionTransition[] = [];
  for (const row of rows) {
    const busy = row.turnInProgress === true || row.compacting === true;
    const asking = row.askPending === true;
    const before = previous?.get(row.id);
    if (previous && asking && !before?.asking) transitions.push({ kind: 'waiting', row });
    if (busy) { state.set(row.id, { working: true, idleSamples: 0, asking }); continue; }
    if (!before?.working) { state.set(row.id, { working: false, idleSamples: 0, asking }); continue; }
    const idleSamples = before.idleSamples + 1;
    if (idleSamples >= FINISHED_IDLE_SAMPLES) {
      transitions.push({ kind: 'finished', row });
      state.set(row.id, { working: false, idleSamples: 0, asking });
    } else state.set(row.id, { working: true, idleSamples, asking });
  }
  return { state, transitions };
}

export function decodeSubscription(value: unknown, now: () => number = Date.now): PushSubscriptionRecord | null {
  if (!isRecord(value) || typeof value.endpoint !== 'string' || !isRecord(value.keys)) return null;
  const { endpoint } = value;
  const { p256dh, auth } = value.keys;
  if (endpoint.length > MAX_ENDPOINT_LENGTH || typeof p256dh !== 'string' || typeof auth !== 'string') return null;
  if (!BASE64URL.test(p256dh) || !BASE64URL.test(auth)) return null;
  let url: URL;
  try { url = new URL(endpoint); } catch { return null; }
  // Push services are public HTTPS endpoints; anything else is not a subscription.
  if (url.protocol !== 'https:') return null;
  return { endpoint, keys: { p256dh, auth }, createdAt: new Date(now()).toISOString() };
}

/** Plain text of the last assistant message, collapsed and shortened for a notification. */
export function assistantPreview(messages: readonly { readonly role?: unknown; readonly content: unknown }[]): string | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.role !== 'assistant') continue;
    const parts = typeof message.content === 'string' ? [message.content]
      : Array.isArray(message.content) ? message.content.flatMap((part: unknown) =>
        isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? [part.text] : []) : [];
    const text = parts.join(' ').replace(/\s+/g, ' ').trim();
    if (!text) continue;
    return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS - 1).trimEnd()}…` : text;
  }
  return null;
}

function decodeVapid(value: unknown): VapidKeys | null {
  if (!isRecord(value) || typeof value.publicKey !== 'string' || typeof value.privateKey !== 'string') return null;
  if (!BASE64URL.test(value.publicKey) || !BASE64URL.test(value.privateKey)) return null;
  const subject = typeof value.subject === 'string' && /^(mailto:|https:)/.test(value.subject) ? value.subject : DEFAULT_SUBJECT;
  return { publicKey: value.publicKey, privateKey: value.privateKey, subject };
}

/**
 * The host's VAPID keys, generated on first use. The private key is a signing
 * secret: written 0600 and created exclusively, so two racing first uses
 * cannot leave the host with a key its earlier subscriptions don't match.
 */
export function readVapidKeys(): VapidKeys {
  const file = path.join(dishStore.dishDir(), VAPID_FILE);
  try {
    const keys = decodeVapid(JSON.parse(fs.readFileSync(file, 'utf8')));
    if (keys) return keys;
    throw new Error(`${file} is not a valid VAPID key file; fix or remove it.`);
  } catch (error) {
    if (!isRecord(error) || error.code !== 'ENOENT') throw error;
  }
  const generated = webpush.generateVAPIDKeys();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  try {
    fs.writeFileSync(file, JSON.stringify({ ...generated, subject: DEFAULT_SUBJECT }, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
  } catch (error) {
    if (!isRecord(error) || error.code !== 'EEXIST') throw error;
  }
  return readVapidKeys();
}

export interface PushSendResult { readonly gone: boolean }
export type PushSender = (subscription: PushSubscriptionRecord, payload: PushPayload, vapid: VapidKeys) => Promise<PushSendResult>;

/** Collapse key per session, so an offline device receives only the latest state. */
function topicFor(tag: string): string {
  return crypto.createHash('sha256').update(tag).digest('base64url').slice(0, 32);
}

export const sendWebPush: PushSender = async (subscription, payload, vapid) => {
  try {
    await webpush.sendNotification(subscription, JSON.stringify(payload), {
      vapidDetails: vapid, TTL: PUSH_TTL_SECONDS, urgency: 'high', topic: topicFor(payload.tag),
    });
    return { gone: false };
  } catch (error) {
    // 404/410: the browser dropped the subscription; anything else may recover.
    const status = isRecord(error) ? error.statusCode : undefined;
    if (status === 404 || status === 410) return { gone: true };
    throw error;
  }
};

export interface PushNotifierPorts {
  /** Current live sessions on this host. */
  sessions(): readonly PushSessionRow[];
  /** Agent-launched peers report to the agent that launched them, not the user. */
  agentLaunched(sessionId: string): boolean;
  readMessages(sessionFile: string): readonly { readonly role?: unknown; readonly content: unknown }[];
  host(): { readonly hostId: string; readonly label: string };
  send?: PushSender;
  log?: { error?(message: string): void };
  now?(): number;
}

export type SubscribeResult = { readonly ok: true } | { readonly ok: false; readonly status: 400 | 409; readonly error: string };

export interface PushNotifier {
  publicKey(): string;
  subscribe(subscription: unknown, publicKey: unknown): SubscribeResult;
  unsubscribe(endpoint: unknown): boolean;
  /** Sends a test notification to one registered endpoint; false when not registered here. */
  test(endpoint: unknown): Promise<boolean>;
  /** Delivers a host-level notification (not a session transition) to every registered device; `tag` is host-relative. */
  notify(payload: Omit<PushPayload, 'hostId'>): Promise<void>;
  /** One sampling step (exposed for tests). */
  sample(): Promise<void>;
  start(): void;
  stop(): void;
}

export function createPushNotifier(ports: PushNotifierPorts): PushNotifier {
  const send = ports.send || sendWebPush;
  const logError = ports.log?.error || ((message: string) => console.error(message));
  const now = ports.now || Date.now;
  let watch: SessionWatchState | null = null;
  let timer: NodeJS.Timeout | undefined;
  let flight: Promise<void> | null = null;
  let stopped = false;

  function subscriptions(): PushSubscriptionRecord[] {
    const list = dishStore.readStore(SUBSCRIPTIONS_STORE).subscriptions;
    if (!Array.isArray(list)) return [];
    return list.flatMap((entry: unknown) => {
      const decoded = decodeSubscription(entry);
      return decoded ? [{ ...decoded, createdAt: isRecord(entry) && typeof entry.createdAt === 'string' ? entry.createdAt : decoded.createdAt }] : [];
    });
  }
  function save(list: readonly PushSubscriptionRecord[]): void {
    dishStore.writeStore(SUBSCRIPTIONS_STORE, { subscriptions: list });
  }

  /** Delivers to every target; returns the failure messages. Settled "gone" endpoints are pruned. */
  async function deliver(targets: readonly PushSubscriptionRecord[], payload: PushPayload): Promise<string[]> {
    const vapid = readVapidKeys();
    const gone = new Set<string>();
    const failures: string[] = [];
    await Promise.all(targets.map(async target => {
      let message: string;
      try {
        if (!(await send(target, payload, vapid)).gone) return;
        if (now() - Date.parse(target.createdAt) >= GONE_GRACE_MS) { gone.add(target.endpoint); return; }
        message = 'the push service does not recognize this new subscription yet; retry in a minute';
      } catch (error) { message = error instanceof Error ? error.message : String(error); }
      message = `${new URL(target.endpoint).host}: ${message}`;
      logError(`[push] ${message}`);
      failures.push(message);
    }));
    if (gone.size) save(subscriptions().filter(entry => !gone.has(entry.endpoint)));
    return failures;
  }

  function payloadFor(transition: SessionTransition): PushPayload {
    const { hostId, label } = ports.host();
    const { row, kind } = transition;
    let detail: string | null = null;
    if (kind === 'finished' && row.sessionFile) {
      try { detail = assistantPreview(ports.readMessages(row.sessionFile)); } catch {}
    }
    const status = kind === 'waiting' ? 'Waiting for your answer' : 'Finished';
    return {
      kind, hostId, sessionId: row.id,
      title: row.name || 'pi-dish session',
      body: detail ? `${status} on ${label}: ${detail}` : `${status} on ${label}`,
      tag: `${hostId}:${row.id}`,
    };
  }

  async function sample(): Promise<void> {
    const targets = subscriptions();
    // No device listening: forget the baseline so enabling later never rings for old work.
    if (!targets.length) { watch = null; return; }
    const step = sessionTransitions(watch, ports.sessions());
    watch = step.state;
    for (const transition of step.transitions) {
      if (stopped) return;
      if (ports.agentLaunched(transition.row.id)) continue;
      await deliver(targets, payloadFor(transition));
    }
  }

  function tick(): Promise<void> {
    if (!flight) flight = sample().finally(() => { flight = null; });
    return flight;
  }

  return {
    publicKey: () => readVapidKeys().publicKey,
    subscribe(value, publicKey) {
      const subscription = decodeSubscription(value, now);
      if (!subscription) return { ok: false, status: 400, error: 'Invalid push subscription.' };
      if (publicKey !== readVapidKeys().publicKey) {
        return { ok: false, status: 409, error: 'This host signs with a different VAPID key. Copy ~/.pi/dish/vapid.json from the host you installed the app from.' };
      }
      save([...subscriptions().filter(entry => entry.endpoint !== subscription.endpoint), subscription]);
      return { ok: true };
    },
    unsubscribe(endpoint) {
      if (typeof endpoint !== 'string') return false;
      const list = subscriptions();
      if (!list.some(entry => entry.endpoint === endpoint)) return false;
      save(list.filter(entry => entry.endpoint !== endpoint));
      return true;
    },
    async test(endpoint) {
      const target = subscriptions().find(entry => entry.endpoint === endpoint);
      if (!target) return false;
      const { hostId, label } = ports.host();
      const [failure] = await deliver([target], { kind: 'test', hostId, sessionId: null, title: 'pi-dish', body: `Notifications from ${label} are working.`, tag: `${hostId}:test` });
      if (failure) throw new Error(`Push service refused the test: ${failure}`);
      // A push service answering "gone" pruned the endpoint: report it as unregistered.
      return subscriptions().some(entry => entry.endpoint === endpoint);
    },
    async notify(payload) {
      const targets = subscriptions();
      if (!targets.length || stopped) return;
      const { hostId } = ports.host();
      await deliver(targets, { ...payload, hostId, tag: `${hostId}:${payload.tag}` });
    },
    sample: tick,
    start() {
      if (timer || stopped) return;
      timer = setInterval(() => { tick().catch(error => logError(`[push] ${error instanceof Error ? error.message : String(error)}`)); }, SAMPLE_INTERVAL_MS);
      timer.unref?.();
    },
    stop() { stopped = true; clearInterval(timer); timer = undefined; },
  };
}
