// Generated from src/core/live-session-info.ts; edit that source and run npm run build:core.
import { BridgeSession } from './bridge-session';
import { type PrimeDaemonSession } from './prime-daemon';
import type { SessionOwnership } from './session-ownership';
export declare function createLiveSessionInfo(ownership: SessionOwnership): {
    primeLiveSession: (sessionId: string) => PrimeDaemonSession | null;
    isLive: (sessionId: string) => boolean;
    getLiveContextUsage: (sessionId: string) => unknown;
    liveTreeLeafId: (session: InstanceType<typeof BridgeSession>) => Promise<unknown>;
};
