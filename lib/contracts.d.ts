// Generated from src/core/contracts.ts; edit that source and run npm run build:core.
/** Core identities are strings on the wire; brands distinguish their roles in typed code. */
declare const identityKind: unique symbol;
export type NativeSessionId = string & {
    readonly [identityKind]: 'native-session';
};
export type SessionId = string & {
    readonly [identityKind]: 'session-route';
};
export type HostId = string & {
    readonly [identityKind]: 'host';
};
export type HarnessId = 'pi' | 'omp' | 'prime';
export type BridgeCapability = 'prompt' | 'steer' | 'followUp' | 'abort' | 'compact' | 'models' | 'setModel' | 'setThinking' | 'rename' | 'commands' | 'reload' | 'queueRead' | 'queueCancel' | 'treeRead' | 'treeNavigation' | 'extensionUI' | 'shareSnapshot' | 'guardedReload';
/** Registry/wire values are unvalidated; policy checks exact booleans. */
export type AdvertisedCapabilities = Partial<Record<BridgeCapability, unknown>>;
export type SessionCapability = 'prompt' | 'steer' | 'followUp' | 'abort' | 'compact' | 'models' | 'setModel' | 'setThinking' | 'rename' | 'commands' | 'queueCancel' | 'tree' | 'export' | 'close' | 'restart' | 'resume';
export type SessionCapabilities = Record<SessionCapability, boolean>;
export interface CapabilityContext {
    active?: boolean;
    conflicted?: boolean;
    closeAllowed?: boolean;
    restartAllowed?: boolean;
}
/** A route id is unique within its host, not across the fleet. */
export interface SessionRef {
    readonly hostId: HostId;
    readonly sessionId: SessionId;
}
export interface SessionIdentity {
    harnessId: HarnessId;
    nativeSessionId: NativeSessionId;
}
export interface ProcessIdentity {
    pid: number;
    startTime: string;
}
/** Registry/OS input retains the legacy numeric-string coercion at the boundary. */
export interface ProcessIdentityInput {
    pid?: number | string;
    startTime?: number | string;
}
export interface ProcessAncestry {
    complete: boolean;
    processes: ProcessIdentity[];
}
export interface LaunchOptions {
    model?: string;
    thinking?: string;
}
/** Missing file remains representable: the legacy argv builders accept an empty options object. */
export interface ResumeOptions {
    file?: string;
    model?: string;
}
export interface HostBuiltin {
    name: string;
    description: string;
    args?: string;
    allowedArgs?: string[];
    freeArgs?: boolean;
    requireArgs?: boolean;
    blockedArgs?: (string | {
        arg: string;
        exact: boolean;
    })[];
}
export type HarnessEnvironment = Record<string, string | undefined>;
export interface HarnessDescriptor {
    id: HarnessId;
    label: string;
    wrapperEntrypoint: string | null;
    eventProfile: string;
    profileId: string;
    profileVersion: number;
    rootPath: () => string;
    layout: 'nested' | 'flat';
    commandEnv: string;
    command: string;
    rpcFallback: boolean;
    modelCatalog: 'pi-sdk' | 'command' | null;
    closeMode: 'logical' | 'owned-pane' | 'owned-agent' | 'client-only' | 'unsupported';
    nestedSubsessions?: boolean;
    sessionExitCustomType?: string;
    blobsPath?: () => string;
    spawnTokenMode?: 'wrapper';
    discoveryExtensionsDir?: (env?: HarnessEnvironment) => string;
    wrapperTokenRequired?: boolean;
    spawnEnv?: Record<string, string>;
    pilotConfig?: Record<string, string>;
    taskAgents?: {
        unpack: (dir: string) => string[];
        userDir: (env?: HarnessEnvironment) => string;
        projectDir: (cwd: string) => string;
    };
    hostBuiltins?: HostBuiltin[];
    argv: {
        new: (options?: LaunchOptions) => string[];
        resume: (options?: ResumeOptions) => (string | undefined)[];
        models: string[];
        export?: (options: {
            file: string;
            output: string;
        }) => string[];
        configGet?: (key: string) => string[];
        configSet?: (key: string, json: string) => string[];
        usage?: string[];
    };
}
/** Tool payloads stay opaque here; the transport does not validate tool-specific schemas. */
export interface ToolExecutionData {
    toolCallId?: string;
    toolName?: string;
    args?: unknown;
    startedAt?: number | string;
    partialResult?: unknown;
}
export interface RunningToolCall {
    toolName: string;
    args: unknown;
    startedAt: number;
    lastPartialResult: unknown;
}
export {};
