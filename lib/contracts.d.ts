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
export type BridgeCapability = 'prompt' | 'steer' | 'followUp' | 'abort' | 'compact' | 'models' | 'setModel' | 'setThinking' | 'rename' | 'commands' | 'reload' | 'queueRead' | 'queueCancel' | 'treeRead' | 'treeNavigation' | 'extensionUI' | 'shareSnapshot' | 'guardedReload' | 'btw';
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
/** Minimum decoded registry shape. This is not a protocol-v2 ownership proof. */
export interface BridgeRegistryEntry extends Record<string, unknown> {
    sessionId: NativeSessionId;
    socketPath: string;
}
export interface ExtensionUIState {
    widgets: Map<unknown, unknown>;
    statuses: Map<unknown, unknown>;
    dialogs: Map<unknown, unknown>;
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
/** Saved new-session selections reach the harness/native argv boundary unchanged. */
export interface LaunchOptions {
    model?: unknown;
    thinking?: unknown;
}
/** Missing file remains representable: the legacy argv builders accept an empty options object. */
export interface ResumeOptions {
    file?: string;
    model?: string;
}
export interface ResumeFileOptions extends ResumeOptions {
    file: string;
}
export interface HarnessResumeArgv {
    (options: ResumeFileOptions): string[];
    (options?: ResumeOptions): (string | undefined)[];
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
    /**
     * Prime-style RLM subagent artifacts: children persist outside the sessions
     * root at `<root>/../session-artifacts/<parentId>/sub-<id8>/<child>.jsonl`,
     * recursively (a child's own children interleave another
     * `session-artifacts/<childId>` segment). Child session headers carry
     * `parentSession`/`rlmDepth`; liveness comes from the per-child
     * `rlm-subagent.json` display entry, not an in-file exit marker.
     */
    subagentArtifacts?: boolean;
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
    /**
     * Bare package specifier the generated launch wrapper must import itself
     * and pass to createHarnessBridge. OMP's extension loader only rewrites
     * bare host-package specifiers inside the extension entry's own directory
     * tree — the generated wrapper lives under ~/.pi/dish/launch-wrappers/, so
     * the same import inside the repo's nested modules resolves nothing there.
     */
    wrapperHostPackage?: string;
    argv: {
        new: (options?: LaunchOptions) => unknown[];
        resume: HarnessResumeArgv;
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
