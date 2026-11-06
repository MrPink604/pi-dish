// Generated from src/core/running-tool-calls.ts; edit that source and run npm run build:core.
import type { RunningToolCall } from './contracts';
/** Keep the reconnect snapshot identical for bridge and RPC transports. */
declare function trackRunningToolCalls(runningToolCalls: Map<string, RunningToolCall>, event: string, value?: unknown, now?: number): void;
declare const _default: {
    trackRunningToolCalls: typeof trackRunningToolCalls;
};
export = _default;
