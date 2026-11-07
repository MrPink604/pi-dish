// Generated from src/core/terminal.ts; edit that source and run npm run build:core.
import type { IPty } from 'node-pty';
import type WebSocket from 'ws';
export interface TerminalMetadata extends Record<string, unknown> {
    tmuxPrefix?: string | null;
}
export interface TerminalOptions {
    idleKillMs?: number;
    bufferMax?: number;
    command?: string[] | null;
    env?: NodeJS.ProcessEnv | null;
    meta?: TerminalMetadata | null;
}
export interface TerminalAttachFrame extends Record<string, unknown> {
    type: 'attach';
    replay: string;
    cwd: string;
    tmuxPrefix?: string | null;
}
export interface TerminalOutputFrame {
    type: 'output';
    data: string;
}
export interface TerminalExitFrame {
    type: 'exit';
    code: number;
}
export interface TerminalErrorFrame {
    type: 'error';
    error: unknown;
}
export type TerminalServerFrame = TerminalAttachFrame | TerminalOutputFrame | TerminalExitFrame | TerminalErrorFrame;
export interface TerminalState {
    proc: IPty;
    cwd: string;
    buffer: string;
    clients: Set<WebSocket>;
    idleTimer: NodeJS.Timeout | null;
    idleKillMs: number;
    bufferMax: number;
    meta: TerminalMetadata | null;
    lastOutputAt: number;
    exited: boolean;
}
declare const terminals: Map<string, TerminalState>;
export { terminals as _terminals };
export declare function isTerminalEnabled(): boolean;
export declare function isTerminalAvailable(): boolean;
/** Frame callbacks follow the current PTY after restart, not the original one. */
export declare function attachClient(sessionId: string, cwd: string | null | undefined, ws: WebSocket, opts?: TerminalOptions): TerminalState;
export declare function detachClient(sessionId: string, ws: WebSocket): void;
export declare function killTerminal(sessionId: string): void;
export declare function killAllTerminals(): void;
