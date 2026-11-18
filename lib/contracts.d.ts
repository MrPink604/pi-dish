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
export type HarnessId = 'pi' | 'omp' | 'prime' | 'agy';
export type BridgeCapability = 'prompt' | 'steer' | 'followUp' | 'abort' | 'compact' | 'models' | 'setModel' | 'setThinking' | 'rename' | 'commands' | 'reload' | 'queueRead' | 'queueCancel' | 'treeRead' | 'treeNavigation' | 'extensionUI' | 'shareSnapshot' | 'guardedReload' | 'sideChat' | 'fastMode' | 'login';
/** One asynchronous answer inside the ephemeral side chat (never the transcript). */
export type SideChatTurnStatus = 'running' | 'complete' | 'error' | 'cancelled';
export interface SideChatTurn {
    id: string;
    question: string;
    answer: string;
    status: SideChatTurnStatus;
    error?: string;
    startedAt: number;
    updatedAt: number;
}
export interface SideChat {
    id: string;
    createdAt: number;
    turns: SideChatTurn[];
}
/** A bridge session owns at most one side chat; JSON `null` means none is open. */
export type SideChatState = SideChat | null;
/** Registry/wire values are unvalidated; policy checks exact booleans. */
export type AdvertisedCapabilities = Partial<Record<BridgeCapability, unknown>>;
export type SessionCapability = 'prompt' | 'steer' | 'followUp' | 'abort' | 'compact' | 'models' | 'setModel' | 'setThinking' | 'rename' | 'commands' | 'queueCancel' | 'tree' | 'export' | 'close' | 'restart' | 'resume' | 'fastMode';
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
/** Registry/OS input may carry numeric strings; coerce at the boundary. */
export interface ProcessIdentityInput {
    pid?: number | string;
    startTime?: number | string;
}
export interface ProcessAncestry {
    complete: boolean;
    processes: ProcessIdentity[];
}
export interface LaunchOptions {
    model?: unknown;
    thinking?: unknown;
    /** Working directory the host will start in; relay-style launchers pass it explicitly. */
    cwd?: unknown;
    /** Alternate session directory (`--session-dir`); private roots only. */
    sessionDir?: string;
}
export interface PromptOptions {
    deliverAs?: 'steer' | 'followUp';
    images?: unknown[];
}
/** `file` may be absent: argv builders accept an empty options object. */
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
    /** `--session-dir` root the fleet backup never captures; resolved per call so tests can swap HOME. */
    privateRootPath?: () => string;
    layout: 'nested' | 'flat';
    commandEnv: string;
    command: string;
    rpcFallback: boolean;
    modelCatalog: 'pi-sdk' | 'command' | null;
    /**
     * Output shape of `argv.models`: absent means JSON. `'agy-list'` is agy's
     * human listing (`<id>\t<label>` lines behind a "Fetching…" banner).
     */
    modelsFormat?: 'agy-list';
    closeMode: 'logical' | 'owned-pane' | 'owned-agent' | 'client-only' | 'unsupported';
    nestedSubsessions?: boolean;
    sessionExitCustomType?: string;
    /**
     * Prime RLM subagents persist at `<root>/../session-artifacts/<parentId>/sub-<id8>/<child>.jsonl`,
     * nesting recursively. Headers carry `parentSession`/`rlmDepth`; liveness comes
     * from the per-child `rlm-subagent.json`, not an in-file exit marker.
     */
    subagentArtifacts?: boolean;
    blobsPath?: () => string;
    spawnTokenMode?: 'wrapper';
    discoveryExtensionsDir?: (env?: HarnessEnvironment) => string;
    /**
     * Flat-layout files that are not sessions: the ACP transport keeps a raw
     * `<id>.acp.jsonl` sidecar beside each mirror, and nothing may discover it
     * as a route.
     */
    auxiliaryJsonlSuffixes?: readonly string[];
    /**
     * Absent: live sessions come from the bridge extension registry (plus Pi RPC).
     * `'prime-daemon'`: no extensions; roots come from the daemon roster and socket.
     */
    liveTransport?: 'prime-daemon';
    /**
     * tmux argv prefix that hosts the bridge in place of the harness CLI, e.g.
     * agy's relay, which owns the ACP child and registers the bridge itself.
     * `command`/`commandEnv` keep naming the harness binary for availability and
     * child spawning; the relay reads `commandEnv` for its own child.
     */
    launchCommand?: () => string[];
    spawnEnv?: Record<string, string>;
    /** Ambient process env vars stripped before running this harness unless set in `commandEnv`. */
    unsetEnv?: readonly string[];
    pilotConfig?: Record<string, string>;
    /** CLI tab order for the settings editor; the schema is read at request time so new settings need no pi-dish change. */
    settingsTabs?: readonly string[];
    taskAgents?: {
        unpack: (dir: string) => string[];
        userDir: (env?: HarnessEnvironment) => string;
        projectDir: (cwd: string) => string;
    };
    hostBuiltins?: HostBuiltin[];
    /**
     * Bare specifier the generated launch wrapper imports itself: OMP only rewrites
     * bare host-package imports inside the extension entry's own tree, and the
     * wrapper lives under ~/.pi/dish/launch-wrappers/.
     */
    wrapperHostPackage?: string;
    /**
     * Host modules the wrapper imports after the host package and passes, in this
     * order, as createHarnessBridge's trailing arguments (OMP: auth for remote
     * /login, the extension UI controller and html-form parser for host dialogs).
     */
    wrapperHostModules?: readonly string[];
    argv: {
        new: (options?: LaunchOptions) => unknown[];
        resume: HarnessResumeArgv;
        models: string[];
        export?: (options: {
            file: string;
            output: string;
        }) => string[];
        configGet?: (key: string) => string[];
        /** `value` is the CLI's raw form: JSON for arrays/records, plain text for scalars. */
        configSet?: (key: string, value: string) => string[];
        /** Every setting with value, type and description (credentials redacted). */
        configList?: string[];
        /** Human listing: the only CLI surface carrying each setting's tab and enum values. */
        configSchema?: string[];
        configReset?: (key: string) => string[];
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
