// Generated from src/core/tmux.ts; edit that source and run npm run build:core.
import type { ProcessIdentity, ProcessIdentityInput } from './contracts';
export interface PaneTarget {
    socket: string;
    paneId: string;
}
/** Location only: none of these fields establish process or pane ownership. */
export interface PaneLocation {
    tmuxSession: string;
    windowIndex: number;
    windowName: string;
}
export interface TmuxServer {
    socket: string;
    name: string;
    sessions: {
        name: string;
        windows: number;
        attached: boolean;
    }[];
}
/** Retain legacy environment interpolation, including undefined values. */
export type SpawnEnvironment = Readonly<Record<string, unknown>>;
interface PaneCommand {
    cwd?: string | null;
    command: readonly string[];
    env?: SpawnEnvironment | null;
}
export interface SpawnOptions extends PaneCommand {
    socket: string;
    tmuxSession?: string | null;
    newTmuxSessionName?: string | null;
    windowName?: string | null;
}
/** Async preparation returns the synchronous checker run adjacent to execFile. */
export interface RespawnOptions extends PaneTarget, PaneCommand {
    expectedProcess: ProcessIdentityInput | null;
    beforeAction?: (() => (() => undefined) | Promise<() => undefined>) | null;
}
/**
 * A decoded placement is still only persisted evidence, never live authority.
 * Optional observations are retained verbatim; consumers must narrow tokens or
 * wrapper paths before using them. Legacy process numbers/strings are not coerced.
 */
export interface SpawnPlacement extends PaneTarget, Record<string, unknown> {
    createdAt?: unknown;
    spawnToken?: unknown;
    bridgeInstanceId?: unknown;
    paneProcess?: unknown;
    wrapperPath?: unknown;
}
export interface PaneProcessState {
    paneExists: boolean;
    knownProcesses: ProcessIdentity[];
}
export interface PaneProcessOptions {
    knownProcesses?: readonly ProcessIdentity[];
}
export interface PaneCleanupOptions extends PaneProcessOptions {
    timeout?: number;
}
export interface PaneCleanupError extends Error {
    remainingProcesses: ProcessIdentity[];
}
export declare function isTmuxAvailable(): boolean;
export declare function tmuxTmpdir(): string;
/** Enumerate live socket servers under the tmux tmpdir, skipping stale sockets. */
export declare function listServers(): Promise<TmuxServer[]>;
export declare function isSocketAllowed(socket: unknown): socket is string;
/** Open a detached window or session with child argv and tmux -e KEY=VALUE flags. */
export declare function spawnInTmux({ socket, tmuxSession, newTmuxSessionName, windowName, cwd, command, env }: SpawnOptions): Promise<{
    paneId: string;
}>;
/** Replace only the exact pane-root birth authorized by the caller. */
export declare function respawnPane({ socket, paneId, cwd, command, env, expectedProcess, beforeAction }: RespawnOptions): Promise<{
    paneId: string;
}>;
export declare function sendKeys(socket: string, paneId: string, text: string): Promise<void>;
export declare function sendKey(socket: string, paneId: string, key: string): Promise<void>;
export declare function renameWindow(socket: string | null | undefined, target: string | null | undefined, name: unknown): Promise<void>;
export declare function hasSession(socket: string, name: string): Promise<boolean>;
export declare function killPane(socket: string, paneId: string): Promise<void>;
/**
 * Read-only snapshot. Keep known exact descendants observable after the root
 * exits and they are reparented; never mistake PID reuse for the old writer.
 */
export declare function paneProcessState(socket: string, paneId: string, { knownProcesses }?: PaneProcessOptions): Promise<PaneProcessState>;
/** Exact birth identity of the process currently anchoring a tmux pane. */
export declare function paneProcessIdentity(socket: string, paneId: string): Promise<ProcessIdentity | null>;
/**
 * Kill the pane, then wait for both tmux and its captured process tree to exit.
 * Hidden-session fallback cannot leave two processes writing the same JSONL.
 */
export declare function killPaneAndWait(socket: string, paneId: string, { timeout, knownProcesses }?: PaneCleanupOptions): Promise<void>;
/** Human-facing location, not process ownership. Window names can contain ':'. */
export declare function paneLocation(socket: string, paneId: string): Promise<PaneLocation | null>;
/**
 * Weak location backstop for old/stale registry stamps, not ownership proof.
 * Scan allowed sockets and walk at most 20 parents to find the containing pane.
 */
export declare function findPaneByPid(pid: number | string | null | undefined): Promise<(PaneTarget & PaneLocation) | null>;
export declare function paneExists(socket: string, paneId: string): Promise<boolean>;
/**
 * A viewer gets a throwaway grouped session: independent current window, same
 * windows, destroyed on detach, without stealing the desktop client's focus.
 */
export declare function attachPaneArgv(socket: string, paneId: string): Promise<string[] | null>;
/** Server prefix key, or null when unavailable. */
export declare function getPrefixKey(socket: string): Promise<string | null>;
export declare function recordSpawn(sessionId: string, { socket, paneId, spawnToken, bridgeInstanceId, paneProcess, wrapperPath }: PaneTarget & {
    spawnToken?: unknown;
    bridgeInstanceId?: unknown;
    paneProcess?: ProcessIdentityInput | null;
    wrapperPath?: unknown;
}): void;
export declare function getSpawn(sessionId: string): SpawnPlacement | null;
export declare function removeSpawn(sessionId: string, expected?: SpawnPlacement | null): boolean;
/** Move one exact placement when its live bridge adopts a new session. */
export declare function rekeySpawn(previousSessionId: string, sessionId: string, expected?: SpawnPlacement | null): boolean;
/** Drop unregistered placements whose panes are gone, preserving concurrent writes. */
export declare function pruneSpawns(registeredIds?: ReadonlySet<string>): Promise<Record<string, unknown>>;
export {};
