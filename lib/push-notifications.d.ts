// Generated from src/core/push-notifications.ts; edit that source and run npm run build:core.
export declare const SAMPLE_INTERVAL_MS = 3000;
/** Consecutive idle samples before a working session counts as finished. */
export declare const FINISHED_IDLE_SAMPLES = 2;
/**
 * A push service may answer "gone" for a subscription it has not finished
 * provisioning (observed with FCM right after subscribe). Pruning then would
 * silently drop a working device, so young subscriptions are only reported.
 */
export declare const GONE_GRACE_MS: number;
export interface VapidKeys {
    readonly publicKey: string;
    readonly privateKey: string;
    readonly subject: string;
}
export interface PushSubscriptionRecord {
    readonly endpoint: string;
    readonly keys: {
        readonly p256dh: string;
        readonly auth: string;
    };
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
interface SessionWatch {
    working: boolean;
    idleSamples: number;
    asking: boolean;
}
export type SessionWatchState = ReadonlyMap<string, Readonly<SessionWatch>>;
export interface SessionTransition {
    readonly kind: PushEventKind;
    readonly row: PushSessionRow;
}
/**
 * Pure transition step. `previous === null` is a baseline sample: it records
 * state and never reports. Sessions absent from `rows` are dropped silently —
 * a session that closed or crashed did not finish.
 */
export declare function sessionTransitions(previous: SessionWatchState | null, rows: readonly PushSessionRow[]): {
    readonly state: SessionWatchState;
    readonly transitions: readonly SessionTransition[];
};
export declare function decodeSubscription(value: unknown, now?: () => number): PushSubscriptionRecord | null;
/** Plain text of the last assistant message, collapsed and shortened for a notification. */
export declare function assistantPreview(messages: readonly {
    readonly role?: unknown;
    readonly content: unknown;
}[]): string | null;
/**
 * The host's VAPID keys, generated on first use. The private key is a signing
 * secret: written 0600 and created exclusively, so two racing first uses
 * cannot leave the host with a key its earlier subscriptions don't match.
 */
export declare function readVapidKeys(): VapidKeys;
export interface PushSendResult {
    readonly gone: boolean;
}
export type PushSender = (subscription: PushSubscriptionRecord, payload: PushPayload, vapid: VapidKeys) => Promise<PushSendResult>;
export declare const sendWebPush: PushSender;
export interface PushNotifierPorts {
    /** Current live sessions on this host. */
    sessions(): readonly PushSessionRow[];
    /** Agent-launched peers report to the agent that launched them, not the user. */
    agentLaunched(sessionId: string): boolean;
    readMessages(sessionFile: string): readonly {
        readonly role?: unknown;
        readonly content: unknown;
    }[];
    host(): {
        readonly hostId: string;
        readonly label: string;
    };
    send?: PushSender;
    log?: {
        error?(message: string): void;
    };
    now?(): number;
}
export type SubscribeResult = {
    readonly ok: true;
} | {
    readonly ok: false;
    readonly status: 400 | 409;
    readonly error: string;
};
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
export declare function createPushNotifier(ports: PushNotifierPorts): PushNotifier;
export {};
