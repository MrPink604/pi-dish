// Generated from src/core/message-hold.ts; edit that source and run npm run build:core.
import type { LiveSession } from './session-ownership';
export interface PeerSender {
    id: string;
    ref: string;
    name: string;
}
type Delivery = 'prompt' | 'followUp';
interface HoldPorts {
    getLiveSession(id: string): Promise<LiveSession | null>;
    supports(session: LiveSession, capability: Delivery): boolean;
    readSettings(): Record<string, unknown>;
    onError?(error: unknown): void;
}
export interface MessageHold {
    enqueue(sessionId: string, delivery: Delivery, message: string, sender: PeerSender): {
        held: true;
        until: string;
    };
    start(): void;
    wake(sessionId: string): void;
    stop(): void;
}
export declare const MAX_MESSAGE_HOLD_WINDOW_MS: number;
export declare function messageHoldWindowMs(settings: Record<string, unknown>): number;
export declare function peerSender(value: unknown): PeerSender | null;
/** Recipient-owned durable inbox. Each delivery mode keeps its own fixed window. */
export declare function createMessageHold(ports: HoldPorts): MessageHold;
export {};
