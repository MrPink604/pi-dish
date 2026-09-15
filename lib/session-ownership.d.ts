// Generated from src/core/session-ownership.ts; edit that source and run npm run build:core.
import type { BridgeCapability, BridgeRegistryEntry, HarnessDescriptor, HarnessId, NativeSessionId, ProcessIdentity, SessionIdentity } from './contracts';
import { BridgeSession } from './bridge-session';
import { RPCSession } from './rpc-session';
import type { DiscoveryCandidate, LiveSourceObservation, SessionSource, SessionSourceResolver } from './session-source-contracts';
import * as tmux from './tmux';
import type { RecoveryRecord } from './session-recovery';
export type LiveSession = InstanceType<typeof BridgeSession> | InstanceType<typeof RPCSession>;
export interface OwnershipObservations {
    /** Presentation listeners only; the selected transport cannot be replaced. */
    onLive(session: LiveSession): void;
    onRetired(route: string): void;
    readSessionTailEntry(source: SessionSource): unknown;
}
export interface RuntimeDescription {
    kind: 'rpc' | 'tmux' | 'terminal';
    pid: unknown;
    server?: string;
    tmuxSession?: string | null;
    windowIndex?: number | null;
    windowName?: string | null;
}
/** Captures retain observations, not permission to act after an arbitrary await. */
export interface RpcCloseCapture {
    readonly kind: 'rpc';
    readonly rpc: InstanceType<typeof RPCSession>;
    readonly registry: BridgeRegistryEntry | null;
}
export interface OwnedPaneCloseCapture {
    readonly kind: 'owned-pane';
    readonly sessionId: string;
    readonly descriptor: HarnessDescriptor;
    readonly registry: BridgeRegistryEntry;
    readonly placement: tmux.SpawnPlacement;
    readonly agentProcess: ProcessIdentity;
}
export interface PrimeCloseCapture {
    readonly kind: 'owned-agent';
    readonly sessionId: string;
    readonly registry: BridgeRegistryEntry;
    readonly placement: tmux.SpawnPlacement;
}
export interface LogicalCloseCapture {
    readonly kind: 'logical';
    readonly sessionId: string;
    readonly registry: BridgeRegistryEntry;
    readonly hasBirthMarker: boolean;
    readonly legacyProcess: ProcessIdentity | null;
    readonly legacyBridge: InstanceType<typeof BridgeSession> | null;
}
export interface LogicalCloseProof {
    readonly registry: BridgeRegistryEntry;
    readonly process: ProcessIdentity;
}
export interface PaneRestartCapture {
    readonly kind: 'pane-restart';
    readonly sessionId: string;
    readonly descriptor: HarnessDescriptor;
    readonly registry: BridgeRegistryEntry;
    readonly placement: tmux.SpawnPlacement;
}
interface BounceIdentity {
    readonly sessionId: string;
    readonly harnessId: HarnessId;
    readonly sessionFile: unknown;
}
export interface RpcBounceAuthority extends BounceIdentity {
    readonly rpc: InstanceType<typeof RPCSession>;
    readonly reg: BridgeRegistryEntry | null;
    readonly spawn: tmux.SpawnPlacement | null;
}
export interface PaneBounceAuthority extends BounceIdentity {
    readonly rpc: null;
    readonly reg: BridgeRegistryEntry;
    readonly spawn: tmux.SpawnPlacement;
}
export type BounceAuthority = RpcBounceAuthority | PaneBounceAuthority;
export type BeforeLifecycleAction = () => (() => undefined) | Promise<() => undefined>;
export declare class OwnershipRefusal extends Error {
    readonly status: 404 | 409;
    constructor(message: string, status?: 404 | 409);
}
/** Waiting/skipped actions preserve the exact interruption through launch/stop layers. */
export declare class LifecycleInterruption extends Error {
    readonly disposition: 'waiting' | 'skipped';
    constructor(disposition: 'waiting' | 'skipped', message: string);
}
export interface SessionOwnership {
    readonly sessionSources: SessionSourceResolver;
    getRegisteredSession(sessionId: string): BridgeRegistryEntry | null;
    refreshRegisteredSession(sessionId: string): BridgeRegistryEntry | null;
    getRPCSession(sessionId: string): InstanceType<typeof RPCSession> | null | undefined;
    getBridgeSession(sessionId: string): Promise<InstanceType<typeof BridgeSession>>;
    liveSourceObservations(sessionId: string): LiveSourceObservation[];
    resolveSessionCandidate(sessionId: string, options?: {
        discover?: boolean;
    }): SessionSource | null;
    liveSessionHistoryPending(sessionId: string): boolean;
    getLiveSession(sessionId: string): Promise<LiveSession | null>;
    adoptBridgeSessionSwitch(session: LiveSession, data: unknown): void;
    describeRuntime(sessionId: string): Promise<RuntimeDescription | null>;
    locatePiPane(sessionId: string): Promise<tmux.PaneTarget | null>;
    liveSubsessionCandidates(active: readonly {
        id: string;
        harnessId: unknown;
        sessionFile?: unknown;
    }[]): DiscoveryCandidate[];
    captureRpcClose(sessionId: string): RpcCloseCapture | null;
    captureOwnedPaneClose(sessionId: string, descriptor: HarnessDescriptor): Promise<OwnedPaneCloseCapture>;
    revalidateOwnedPaneClose(capture: OwnedPaneCloseCapture): void;
    capturePrimeClose(sessionId: string, descriptor: HarnessDescriptor): PrimeCloseCapture;
    checkPrimeClosePane(capture: PrimeCloseCapture, keepPane: boolean): Promise<boolean>;
    preparePrimeClose(capture: PrimeCloseCapture, keepPane: boolean, beforeAction: BeforeLifecycleAction | null): Promise<void>;
    captureLogicalClose(sessionId: string, registry: BridgeRegistryEntry): Promise<LogicalCloseCapture>;
    revalidateLogicalClose(capture: LogicalCloseCapture): LogicalCloseProof;
    capturePaneRestart(sessionId: string, descriptor: HarnessDescriptor): Promise<PaneRestartCapture>;
    preparePaneRestart(capture: PaneRestartCapture): Promise<BridgeRegistryEntry>;
    revalidatePaneRestart(capture: PaneRestartCapture, proved: BridgeRegistryEntry): BridgeRegistryEntry;
    preparePrimeRestartStop(capture: PaneRestartCapture, beforeAction: BeforeLifecycleAction | null): Promise<() => undefined>;
    preparePrimeReplacement(capture: PaneRestartCapture, sessionFile: string): Promise<() => undefined>;
    captureBounceAuthority(row: {
        id: string;
        harnessId?: unknown;
        conflicted?: unknown;
    }): BounceAuthority | null;
    bounceIdentityFailure(authority: BounceAuthority): string | null;
}
export declare function routeIdentity(value: unknown): (SessionIdentity & {
    encoded: boolean;
}) | null;
export declare function routeSessionId(harnessId: HarnessId, nativeSessionId: NativeSessionId): string;
export declare function registryIdentity(input: unknown): SessionIdentity | null;
export declare function sameProcessIdentity(left: unknown, right: unknown): boolean;
export declare function spawnMatchesRegistryClaim(spawn: tmux.SpawnPlacement | null | undefined, registryEntry: BridgeRegistryEntry | null | undefined): boolean;
export declare function proveBridgeRegistryClaim(entry: BridgeRegistryEntry): Promise<void>;
/** Synchronous observations, not an authorization that survives an await. */
export declare function spawnAllowsOwnedPaneClose(spawn: tmux.SpawnPlacement | null | undefined, registryEntry: BridgeRegistryEntry | null | undefined): boolean;
export declare function spawnAllowsManagedClose(spawn: tmux.SpawnPlacement | null | undefined, registryEntry: BridgeRegistryEntry | null | undefined, closeMode: HarnessDescriptor['closeMode']): boolean;
export declare function spawnAllowsRestart(spawn: tmux.SpawnPlacement | null | undefined, registryEntry: BridgeRegistryEntry | null | undefined, closeMode: HarnessDescriptor['closeMode']): boolean;
export declare function liveSessionSupports(session: LiveSession, capability: BridgeCapability): boolean;
export declare function sessionIdentityFields(harnessId: HarnessId, nativeSessionId: NativeSessionId): {
    id: string;
    sessionKey: import("./contracts").SessionId;
    harnessId: HarnessId;
    harnessLabel: string;
    nativeSessionId: NativeSessionId;
};
export declare function sessionSwitchRouteData(session: LiveSession, input: unknown): {
    sessionId: string;
    previousSessionId: string;
    nativeSessionId: NativeSessionId;
    previousNativeSessionId: NativeSessionId;
} | null;
/** Persisted Pi ids keep their legacy raw route; alternate routes require an encoded tuple. */
export declare function recoveryRouteId(saved: Pick<RecoveryRecord, 'harnessId' | 'nativeSessionId'>): string;
/** Validate historical evidence without granting ownership of any live runtime. */
export declare function validateRecoveryRecord(saved: RecoveryRecord): SessionSource;
export declare function createSessionOwnership(observations: OwnershipObservations): SessionOwnership;
export {};
