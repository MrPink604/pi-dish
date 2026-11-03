// Generated from src/core/prime-daemon.ts; edit that source and run npm run build:core.
import type { ExtensionUIState, NativeSessionId, RunningToolCall } from './contracts';
import { type ProtocolRecord } from './wire-protocol';
export declare const PRIME_DAEMON_PROTOCOL: Readonly<{
    name: "prime-agent.daemon";
    version: 7;
}>;
type Listener = (data: unknown) => void;
interface PromptOptions {
    deliverAs?: 'steer' | 'followUp';
    images?: unknown[];
}
interface TreeOptions {
    summarize?: boolean;
    customInstructions?: string;
    label?: string;
}
export interface PrimeQueueState {
    steering: string[];
    followUp: string[];
}
/**
 * The daemon socket Prime itself would use for this launch configuration:
 * an explicit `--daemon-socket` in PI_DISH_PRIME_COMMAND, then
 * PRIME_AGENT_DAEMON_SOCKET (command assignment, then server env), then the
 * per-user default the Rust launcher pins. Managed launches pass the result
 * explicitly so pi-dish always watches the daemon its own clients use.
 */
export declare function primeDaemonSocket(env?: NodeJS.ProcessEnv): string;
/** One root agent row from the daemon roster (`list`). */
export interface PrimeAgentSummary {
    activeSessionId: string;
    nativeSessionId: NativeSessionId;
    sessionFile: string;
    cwd: string | null;
    lifecycle: string | null;
    isStreaming: boolean;
    isCompacting: boolean;
    workerPid: number | null;
    workerInstanceId: string | null;
    attachedClients: number;
    sessionName: string | null;
    thinkingLevel: string | null;
    model: {
        provider: string;
        id: string;
    } | null;
    queue: PrimeQueueState;
    lastActivityAt: string | null;
    created: string | null;
}
/** Root agents only: RLM children are discovered from their artifacts. */
export declare function primeRootSummary(row: unknown): PrimeAgentSummary | null;
export declare class PrimeDaemonConnection {
    readonly socketPath: string;
    readonly clientId: string;
    hello: ProtocolRecord | null;
    alive: boolean;
    private sock;
    private pending;
    private eventHandlers;
    private closeHandlers;
    constructor(socketPath: string);
    connect({ timeout }?: {
        timeout?: number | undefined;
    }): Promise<ProtocolRecord>;
    request(command: ProtocolRecord & {
        type: string;
    }, { timeout }?: {
        timeout?: number | undefined;
    }): Promise<unknown>;
    onEvents(activeSessionId: string, handler: (event: ProtocolRecord) => void): void;
    offEvents(activeSessionId: string): void;
    onClose(handler: (error: Error) => void): void;
    private _closed;
    close(): void;
}
/** A live Prime root agent, as consumed by the session routes (LiveSession). */
export declare class PrimeDaemonSession {
    readonly harnessId: 'prime';
    readonly activeSessionId: string;
    readonly daemonSocket: string;
    id: NativeSessionId;
    nativeSessionId: NativeSessionId;
    sessionFile: string;
    cwd: string | null;
    alive: boolean;
    turnInProgress: boolean;
    compacting: boolean;
    lastActivityAt: Date;
    summary: PrimeAgentSummary;
    queueState: PrimeQueueState;
    extUIState: ExtensionUIState;
    runningToolCalls: Map<string, RunningToolCall>;
    state: ProtocolRecord;
    lastStats?: unknown;
    attached: boolean;
    bounceExecuting?: boolean;
    bounceActivityRevision?: number;
    private listeners;
    private daemon;
    private streamingAssistantMessage;
    constructor(daemon: PrimeDaemon, summary: PrimeAgentSummary);
    /** Roster rows are authoritative for identity and the fields Prime emits no event for. */
    applySummary(summary: PrimeAgentSummary): void;
    _event(event: ProtocolRecord): void;
    _retire(): void;
    _emit(event: string, data: unknown): void;
    on(event: string, cb: Listener): () => void;
    off(event: string, cb: Listener): void;
    once(event: string, cb: Listener): () => void;
    send(command: string, params?: ProtocolRecord, { timeout }?: {
        timeout?: number | undefined;
    }): Promise<unknown>;
    prompt(message: string, opts?: PromptOptions): Promise<unknown>;
    steer(message: string, opts?: PromptOptions): Promise<unknown>;
    abort(): Promise<unknown>;
    compact(customInstructions?: string): Promise<unknown>;
    setModel(provider: string, modelId: string): Promise<unknown>;
    setName(name: string): Promise<unknown>;
    setThinkingLevel(level: string): Promise<unknown>;
    getState(): Promise<unknown>;
    getCommands(): Promise<unknown>;
    getAvailableModels(): Promise<unknown>;
    getSessionStats(): Promise<unknown>;
    getQueue(): Promise<unknown>;
    exportHtml(outputPath?: string): Promise<unknown>;
    readTree(): Promise<unknown>;
    navigateTree(targetId: string, opts?: TreeOptions): Promise<unknown>;
    /** Prime refuses the mutation unless `text` still names that queued entry. */
    cancelQueued(kind: 'steering' | 'followUp', index: number, text: string): Promise<unknown>;
    respondExtensionUI(): Promise<unknown>;
    _refreshStats(): void;
}
export interface PrimeStopObservation {
    activeSessionId: string;
    workerInstanceId: string | null;
    sessionFile: string;
}
/**
 * The roster cache and connection for one daemon socket. Refreshes poll the
 * public `list` command; each root agent gets one PrimeDaemonSession that
 * attaches for events. An unreachable socket means no live Prime agents.
 */
export declare class PrimeDaemon {
    readonly socketPath: string;
    private connection;
    private connecting;
    private sessions;
    private refreshing;
    private timer;
    lastError: string | null;
    constructor(socketPath: string);
    private connected;
    request(command: ProtocolRecord & {
        type: string;
    }, options?: {
        timeout?: number;
    }): Promise<unknown>;
    /** Current live roots from the last refresh (synchronous, for list assembly). */
    list(): PrimeDaemonSession[];
    byNativeId(nativeSessionId: unknown): PrimeDaemonSession | null;
    byActiveSessionId(activeSessionId: unknown): PrimeDaemonSession | null;
    refresh(): Promise<PrimeDaemonSession[]>;
    private _refresh;
    private attach;
    private retireAll;
    /** Wait for a root agent matching `predicate` to appear in the roster. */
    waitFor(predicate: (summary: PrimeAgentSummary) => boolean, { timeout, interval }?: {
        interval?: number | undefined;
        timeout?: number | undefined;
    }): Promise<PrimeDaemonSession[]>;
    /**
     * Stop one root through the supervisor after re-reading the roster: the
     * agent id, worker instance and transcript must still match what the
     * caller authorized. No retry; a lost reply is indeterminate.
     */
    stop(expected: PrimeStopObservation, beforeStop: () => void | Promise<void>, { timeout }?: {
        timeout?: number | undefined;
    }): Promise<void>;
    start(intervalMs?: number): void;
    shutdown(): void;
}
/** The daemon for the configured Prime launch; replaced when the socket changes. */
export declare function getPrimeDaemon(env?: NodeJS.ProcessEnv): PrimeDaemon;
/** Test seam: drop the cached daemon (and its connection). */
export declare function resetPrimeDaemon(): void;
export {};
