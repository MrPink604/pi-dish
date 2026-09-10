// Generated from src/core/rpc-session.ts; edit that source and run npm run build:core.
/**
 * Manages pi sessions spawned via `pi --mode rpc`.
 * All session interaction goes through RPC — no control sockets or file polling.
 *
 * Pi's RPC protocol uses {"type":"command", ...} on stdin/stdout.
 * Responses: {"type":"response", "id":..., "command":"...", "success":true, "data":{...}}
 * Events: turn_start, message_start, message_update, message_end, turn_end, etc.
 *
 * Framing note: pi's docs require splitting on LF only — Node's readline also
 * splits on U+2028/U+2029 which are valid inside JSON strings, so we do our
 * own buffering.
 */
import { type ChildProcessWithoutNullStreams } from 'child_process';
import { PendingRequests } from './pending-requests';
import { type ProtocolRecord } from './wire-protocol';
import type { LaunchOptions, NativeSessionId, RunningToolCall } from './contracts';
interface RecoveryObserver {
    initialize(): void;
    event(type: string, data?: unknown): void;
    dispose(): void;
}
interface RPCLaunchOptions extends LaunchOptions {
    cwd?: string;
}
interface PromptOptions {
    deliverAs?: 'steer' | 'followUp';
    images?: unknown[];
}
type Listener = (data: unknown) => void;
declare class RPCSession {
    id: NativeSessionId;
    proc: ChildProcessWithoutNullStreams;
    alive: boolean;
    pending: InstanceType<typeof PendingRequests>;
    nextRequestId: number;
    listeners: Map<string, Listener[]>;
    state: ProtocolRecord | null;
    sessionFile: string | null;
    cwd: string | null;
    turnInProgress: boolean;
    compacting: boolean;
    stderrTail: string[];
    lastActivityAt: Date;
    streamingAssistantMessage: ProtocolRecord | null;
    runningToolCalls: Map<string, RunningToolCall>;
    recoveryBridgeOwned: boolean;
    recoveryInstanceId: string;
    recoveryStartTime: string | null;
    recoveryObserver: RecoveryObserver;
    bounceExecuting?: boolean;
    lastStats?: unknown;
    constructor(id: NativeSessionId, proc: ChildProcessWithoutNullStreams);
    _canObserveRecovery(): boolean;
    _handleMessage(input: unknown): void;
    _emit(event: string, data: unknown): void;
    on(event: string, cb: Listener): () => void;
    off(event: string, cb: Listener): void;
    send(command: string, params?: ProtocolRecord, { timeout }?: {
        timeout?: number | undefined;
    }): Promise<unknown>;
    /** Fire-and-forget write (extension_ui_response has no response). */
    write(obj: ProtocolRecord): void;
    prompt(message: string, opts?: PromptOptions): Promise<unknown>;
    steer(message: string, opts?: PromptOptions): Promise<unknown>;
    setModel(provider: string, modelId: string): Promise<unknown>;
    setName(name: string): Promise<unknown>;
    getAvailableModels(): Promise<unknown>;
    getSessionStats(): Promise<unknown>;
    getCommands(): Promise<unknown>;
    compact(customInstructions?: string): Promise<unknown>;
    abort(): Promise<unknown>;
    setThinkingLevel(level: string): Promise<unknown>;
    newSession(): Promise<unknown>;
    exportHtml(outputPath?: string): Promise<unknown>;
    _refreshStats(): void;
    respondExtensionUI(requestId: string, response: ProtocolRecord): void;
    kill(): void;
}
declare function getPiLaunchSpec(): {
    env: Record<string, string>;
    argv: string[];
};
declare function createRPCSession(opts?: RPCLaunchOptions): Promise<RPCSession>;
declare function resumeRPCSession(sessionPath: string, cwd?: string): Promise<RPCSession>;
declare function getRPCSession(id: NativeSessionId): RPCSession | undefined;
declare function getAllRPCSessions(): RPCSession[];
declare const _default: {
    RPCSession: typeof RPCSession;
    createRPCSession: typeof createRPCSession;
    resumeRPCSession: typeof resumeRPCSession;
    getRPCSession: typeof getRPCSession;
    getAllRPCSessions: typeof getAllRPCSessions;
    getPiLaunchSpec: typeof getPiLaunchSpec;
    rpcSessions: Map<NativeSessionId, RPCSession>;
};
export = _default;
