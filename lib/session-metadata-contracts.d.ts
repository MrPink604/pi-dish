// Generated from src/core/session-metadata-contracts.ts; edit that source and run npm run build:core.
/** Accumulator output before read-time model-window overlays. No route authority. */
export interface SessionInfo {
    model: string;
    name: string | null;
    messageCount: number;
    contextTokens: number;
    lastActivity: Date;
    cwd: string | null;
    sessionId: string | null;
    parentSession: string | null;
}
/** The existing parser retains physical framing without a second JSON pass. */
export interface SessionEntries extends ReadonlyArray<unknown> {
    readonly firstEntryOnFirstLine?: boolean;
}
