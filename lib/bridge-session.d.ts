// Generated from src/core/bridge-session.ts; edit that source and run npm run build:core.
import net = require('net');
import { EventEmitter } from 'events';
import { PendingRequests } from './pending-requests';
import { type ProtocolRecord } from './wire-protocol';
import type { AdvertisedCapabilities, BridgeRegistryEntry, ExtensionUIState, HarnessId, NativeSessionId, PromptOptions, RunningToolCall, SideChatState } from './contracts';
type BridgeRequest = Promise<unknown> & {
    readonly requestId?: number;
};
interface TreeOptions {
    summarize?: boolean;
    customInstructions?: string;
    label?: string;
}
type BridgeEvents = Record<string, unknown[]>;
declare function listRegisteredSessions(): BridgeRegistryEntry[];
declare function invalidateRegistryCache(): void;
declare function validRegistryClaimShape(input: unknown): boolean;
declare function sameRegistryClaim(left: unknown, right: unknown): boolean;
/**
 * Re-reads before unlinking so a stale scan can't erase a new bridge's claim for
 * the same session. The socket is left alone: a replacement bridge may have bound it.
 */
declare function pruneRegisteredSession(entry: unknown): boolean;
declare function pruneUnreachableRegisteredSession(entry: unknown, error: unknown): boolean;
declare function pidAlive(pid: unknown): boolean;
declare function getRegisteredSession(sessionId: NativeSessionId): BridgeRegistryEntry | null;
declare function getRegisteredSessionByNativeId(harnessId: HarnessId, nativeSessionId: NativeSessionId): BridgeRegistryEntry | null;
declare function getRegisteredSessionByClaim(claim: unknown): BridgeRegistryEntry | null;
declare function refreshRegisteredSession(sessionId: NativeSessionId): BridgeRegistryEntry | null;
/** A live bridge socket with the prompt/abort/model surface RPCSession exposes. */
declare class BridgeSession extends EventEmitter<BridgeEvents> {
    id: NativeSessionId;
    protocolVersion: unknown;
    wrapper: unknown;
    harnessId: unknown;
    nativeSessionId: NativeSessionId;
    bridgeInstanceId: unknown;
    capabilities: AdvertisedCapabilities;
    registryClaim: BridgeRegistryEntry;
    sessionFile: unknown;
    cwd: unknown;
    pid: unknown;
    startTime: unknown;
    socketPath: string;
    name: unknown;
    model: unknown;
    contextUsage: unknown;
    fastMode: unknown;
    turnInProgress: boolean;
    compacting: boolean;
    queueState: unknown;
    sideChat: SideChatState;
    runningToolCalls: Map<string, RunningToolCall>;
    extUIState: ExtensionUIState;
    treeLeafUnsupported?: boolean;
    alive: boolean;
    sock: net.Socket | null;
    _nextId: number;
    _pending: InstanceType<typeof PendingRequests>;
    hello: ProtocolRecord | null;
    bounceExecuting?: boolean;
    bounceActivityRevision?: number;
    constructor(registryEntry: BridgeRegistryEntry);
    connect(): Promise<this>;
    /** v1 claims predate claim-bound identity; v2 claims are immutable and proved by hello. */
    private get legacyClaim();
    _validateV2Hello(msg: unknown): NodeJS.ErrnoException | null;
    _handle(input: unknown): void;
    waitForHello({ timeout }?: {
        timeout?: number | undefined;
    }): Promise<ProtocolRecord>;
    send(command: string, params?: ProtocolRecord, { timeout }?: {
        timeout?: number | undefined;
    }): BridgeRequest;
    prompt(message: string, opts?: PromptOptions): BridgeRequest;
    steer(message: string, opts?: PromptOptions): BridgeRequest;
    abort(): BridgeRequest;
    compact(instructions?: string): BridgeRequest;
    cancelQueued(kind: 'steering' | 'followUp', index: number, text: string): BridgeRequest;
    setModel(provider: string, modelId: string): BridgeRequest;
    setName(name: string): BridgeRequest;
    getCommands(): BridgeRequest;
    getAvailableModels(): BridgeRequest;
    getShareSnapshot(): BridgeRequest;
    setThinkingLevel(level: string): BridgeRequest;
    setFastMode(enabled: boolean): BridgeRequest;
    sideChatAsk(question: string, chatId?: string): BridgeRequest;
    sideChatCancel(chatId: string): BridgeRequest;
    sideChatClose(chatId: string): BridgeRequest;
    runCommand(message: string, deliverAs?: 'steer' | 'followUp'): BridgeRequest;
    readTree(): BridgeRequest;
    readTreeLeaf(): BridgeRequest;
    navigateTree(targetId: string, opts?: TreeOptions): BridgeRequest;
    treeNavigate(targetId: string, opts?: Pick<TreeOptions, 'summarize'>): BridgeRequest;
    branchTree(targetId: string): BridgeRequest;
    respondExtensionUI(requestId: string, response: ProtocolRecord): BridgeRequest;
    close(): void;
}
declare function getBridgeSession(sessionId: NativeSessionId | BridgeRegistryEntry): Promise<BridgeSession>;
declare const _default: {
    REGISTRY_DIR: string;
    listRegisteredSessions: typeof listRegisteredSessions;
    invalidateRegistryCache: typeof invalidateRegistryCache;
    getRegisteredSession: typeof getRegisteredSession;
    getRegisteredSessionByNativeId: typeof getRegisteredSessionByNativeId;
    getRegisteredSessionByClaim: typeof getRegisteredSessionByClaim;
    refreshRegisteredSession: typeof refreshRegisteredSession;
    validRegistryClaimShape: typeof validRegistryClaimShape;
    sameRegistryClaim: typeof sameRegistryClaim;
    pruneRegisteredSession: typeof pruneRegisteredSession;
    pruneUnreachableRegisteredSession: typeof pruneUnreachableRegisteredSession;
    getBridgeSession: typeof getBridgeSession;
    BridgeSession: typeof BridgeSession;
    pidAlive: typeof pidAlive;
    processIdentity: (pid: number | string | undefined) => import("./contracts").ProcessIdentity | null;
    processIdentityAlive: (identity: import("./contracts").ProcessIdentityInput | null | undefined) => boolean;
};
export = _default;
