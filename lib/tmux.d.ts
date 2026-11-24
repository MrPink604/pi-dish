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
/** Values are interpolated as-is, including undefined. */
export type SpawnEnvironment = Readonly<Record<string, unknown>>;
interface PaneCommand {
    cwd?: unknown;
    command: readonly unknown[];
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
 * Persisted evidence, never live authority. Optional observations are kept
 * verbatim and uncoerced; consumers must narrow them before use.
 */
export interface SpawnPlacement extends PaneTarget, Record<string, unknown> {
    createdAt?: unknown;
    spawnToken?: unknown;
    bridgeInstanceId?: unknown;
    paneProcess?: unknown;
    wrapperPath?: unknown;
    /** Prime daemon transport: the root agent this pane's launch created or resumed. */
    primeAgent?: unknown;
}
/** Daemon owning a pi-dish-launched Prime root agent, plus the root/worker identity seen at registration. */
export interface PrimeAgentPlacement {
    daemonSocket: string;
    activeSessionId: string;
    workerInstanceId: string | null;
    sessionFile: string;
}
/** Persisted evidence only: callers re-read the live roster before acting on it. */
export declare function primeAgentPlacement(value: unknown): PrimeAgentPlacement | null;
export declare function spawnPrimeAgent(spawn: SpawnPlacement | null | undefined): PrimeAgentPlacement | null;
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
/** True when tmux rejected a command because no server listens on the target socket. */
export declare function isNoServerError(error: unknown): boolean;
/** Fires when a tmux command against pi-dish's headless socket fails with no server running. */
export declare function onHeadlessNoServer(listener: (socket: string) => void): () => void;
/** Fires after a spawn placement is recorded on pi-dish's headless socket. */
export declare function onHeadlessSpawn(listener: (sessionId: string, socket: string) => void): () => void;
/**
 * Argv prefix that starts the tmux server for `socket` in its own transient
 * user scope. A tmux server stays in the cgroup of whatever started it, and
 * tmux puts each pane in a scope PartOf= that unit; started from a pi-dish
 * pane, agent panes would stop whenever pi-dish.service stops. Null - start
 * tmux directly - without a reachable user systemd manager, without
 * systemd-run, or with PI_DISH_TMUX_SCOPE=0.
 */
export declare function tmuxServerScopeArgv(socket: string, env?: NodeJS.ProcessEnv): string[] | null;
export declare function isTmuxAvailable(): boolean;
export declare function tmuxTmpdir(): string;
/** pi-dish's own server for agents launched without a target. */
export declare function headlessTmuxSocket(): string;
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
export interface LiveTmuxPane {
    paneId: string;
    panePid: number | null;
    dead: boolean;
    paneProcess: ProcessIdentity | null;
}
export interface TmuxServerSnapshot {
    pid: number;
    server: ProcessIdentity;
    panes: Map<string, LiveTmuxPane>;
}
/** PID of the server answering on `socket`; null when none answers. Never starts a server. */
export declare function serverPid(socket: string): Promise<number | null>;
/**
 * Single-command snapshot of a running tmux server and its panes. Uses -N so
 * it never starts a server; handles an empty server (exit-empty off) by
 * falling back to serverPid when list-panes reports "no current target".
 */
export declare function inspectServer(socket: string): Promise<TmuxServerSnapshot | null>;
/** Applies exit-empty off to an already-running headless server without ever starting one. */
export declare function configureHeadlessServer(socket?: string): Promise<void>;
/**
 * Ensures pi-dish's headless tmux server is running using the same flags
 * (-f /dev/null, HEADLESS_SERVER_OPTIONS, transient systemd scope) as
 * spawnInTmux, and -N when a server is already running.
 */
export declare function ensureHeadlessServer(socket?: string): Promise<number | null>;
/**
 * Clients attached to the pane's session, including grouped viewer sessions.
 * Null (unreadable) means "possibly watched", never "nobody is looking".
 */
export declare function paneAttachedClients(socket: string, paneId: string): Promise<number | null>;
/**
 * Viewers get a throwaway grouped session (own current window, destroyed on
 * detach) so the desktop client's focus is not stolen. -N: a viewer arriving
 * after the server died must not start a replacement that reads tmux.conf.
 */
export declare function attachPaneArgv(socket: string, paneId: string): Promise<string[] | null>;
export declare function getPrefixKey(socket: string): Promise<string | null>;
/** Persisted placements by route id. Evidence only: callers re-read live state before acting. */
export declare function listSpawns(): Record<string, SpawnPlacement>;
export declare function recordSpawn(sessionId: string, { socket, paneId, spawnToken, bridgeInstanceId, paneProcess, wrapperPath, primeAgent }: PaneTarget & {
    spawnToken?: unknown;
    bridgeInstanceId?: unknown;
    paneProcess?: ProcessIdentityInput | null;
    wrapperPath?: unknown;
    primeAgent?: unknown;
}): void;
export declare function getSpawn(sessionId: string): SpawnPlacement | null;
export declare function removeSpawn(sessionId: string, expected?: SpawnPlacement | null): boolean;
/** Move one exact placement when its live bridge adopts a new session. */
export declare function rekeySpawn(previousSessionId: string, sessionId: string, expected?: SpawnPlacement | null): boolean;
/** Drop unregistered placements whose panes are gone, preserving concurrent writes. */
export declare function pruneSpawns(registeredIds?: ReadonlySet<string>): Promise<Record<string, unknown>>;
export {};
