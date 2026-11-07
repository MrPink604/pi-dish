// Generated from src/core/rpc-session.ts; edit that source and run npm run build:core.
/** `pi --mode rpc` sessions. Framing is LF-only, never readline's. */
import { type ChildProcessWithoutNullStreams } from 'child_process';
import { PendingRequests } from './pending-requests';
import { type ProtocolRecord } from './wire-protocol';
import { type RecoveryObserver } from './session-recovery';
import { TransportSession } from './transport-session';
import type { LaunchOptions, NativeSessionId, PromptOptions } from './contracts';
interface RPCLaunchOptions extends LaunchOptions {
    cwd?: unknown;
}
declare class RPCSession extends TransportSession {
    id: NativeSessionId;
    proc: ChildProcessWithoutNullStreams;
    alive: boolean;
    pending: InstanceType<typeof PendingRequests>;
    nextRequestId: number;
    state: ProtocolRecord | null;
    sessionFile: string | null;
    cwd: string | null;
    stderrTail: string[];
    recoveryBridgeOwned: boolean;
    recoveryInstanceId: string;
    recoveryStartTime: string | null;
    recoveryObserver: RecoveryObserver;
    bounceExecuting?: boolean;
    bounceActivityRevision?: number;
    constructor(id: NativeSessionId, proc: ChildProcessWithoutNullStreams);
    _canObserveRecovery(): boolean;
    _handleMessage(input: unknown): void;
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
    respondExtensionUI(requestId: string, response: ProtocolRecord): void;
    kill(): void;
}
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
    rpcSessions: Map<NativeSessionId, RPCSession>;
};
export = _default;
