// Generated from src/core/session-launch.ts; edit that source and run npm run build:core.
import type { BridgeRegistryEntry, HarnessDescriptor, ProcessIdentity, ProcessIdentityInput } from './contracts';
import { LifecycleInterruption } from './session-ownership';
import type { BeforeLifecycleAction } from './session-ownership';
import { type CuAgentLeases } from './cu-agent-leases';
import * as tmux from './tmux';
export interface HarnessLaunchTarget {
    type?: string;
    socket?: unknown;
    tmuxSession?: string | null;
    newTmuxSession?: string | null;
    windowName?: string | null;
}
export interface PilotSelectionOptions {
    model?: string | null;
    thinking?: string | null;
    cwd?: string | null;
}
/** HTTP pilot selection precedes routine-store validation; no field is trusted yet. */
export interface PilotValidationInput {
    model?: unknown;
    thinking?: unknown;
    cwd?: unknown;
}
export interface NewSessionLaunchOptions {
    model?: unknown;
    thinking?: unknown;
    cwd?: unknown;
    descriptor: HarnessDescriptor;
    name?: string | null;
    target?: HarnessLaunchTarget | null;
    /** Harness private root, outside fleet backups. */
    private?: boolean;
}
export interface ResumeSessionLaunchOptions extends PilotSelectionOptions {
    descriptor: HarnessDescriptor;
    name?: string | null;
    target?: HarnessLaunchTarget | null;
    sessionFile: string;
    /** Canonical pi-dish route id when already known. */
    sessionId?: string | null;
    /** Bind headless tmux launch to one exact already-running server (-N, no server creation, no RPC fallback). */
    expectedTmuxServer?: ProcessIdentity | null;
    /** Pre-probed CU Slice-2 capability decision (avoids re-probing `/v1/status` on restart). */
    cuSlice2?: boolean;
}
export interface RpcResumeOptions extends PilotSelectionOptions {
    sessionFile: string;
}
export interface RestartPaneOptions {
    sessionId: string;
    paneId: string;
    paneProcess: ProcessIdentityInput | null;
    spawn: tmux.SpawnPlacement;
    registry: BridgeRegistryEntry | null;
    beforeAction?: BeforeLifecycleAction | null;
}
export interface SpawnHarnessOptions {
    descriptor: HarnessDescriptor;
    target: HarnessLaunchTarget;
    args: readonly unknown[];
    cwd?: unknown;
    name?: string | null;
    hidden?: boolean;
    knownSessionId?: string | null;
    restartPane?: RestartPaneOptions | null;
    expectedTmuxServer?: ProcessIdentity | null;
    /** Pre-probed CU Slice-2 capability decision (avoids re-probing `/v1/status` on restart). */
    cuSlice2?: boolean;
    /** When true alongside `restartPane`, transfers the session's active/displaced CU lease in place via `bind_transfer`. */
    cuBindTransfer?: boolean;
}
export interface CleanupEvidence extends tmux.PaneTarget {
    knownProcesses: ProcessIdentity[];
    timeout: number;
    /** Original tmux server birth captured at spawn; required before any retry may kill the pane. */
    serverProcess?: ProcessIdentity | null;
    /** Original pane root process birth captured at spawn; required before any retry may kill the pane. */
    paneProcess?: ProcessIdentity | null;
}
export interface ResumeUncertainty extends tmux.PaneTarget {
    knownProcesses: ProcessIdentity[];
    detachedWorker?: true;
}
interface LaunchFailureDetails {
    error: unknown;
    status: number;
}
export type LaunchOutcome = {
    kind: 'ready';
    id: string;
} | (LaunchFailureDetails & {
    kind: 'fallback-permitted';
}) | (LaunchFailureDetails & {
    kind: 'fallback-forbidden';
}) | (LaunchFailureDetails & {
    kind: 'cleanup-incomplete';
    cleanup: CleanupEvidence;
}) | (LaunchFailureDetails & {
    kind: 'explicit-uncertain';
    placement: ResumeUncertainty;
}) | (LaunchFailureDetails & {
    kind: 'detached-replacement-uncertain';
    placement: ResumeUncertainty;
}) | {
    kind: 'interrupted';
    error: LifecycleInterruption;
    status: number;
};
export interface SessionLaunchObservations {
    runHarnessModelCommand(descriptor: HarnessDescriptor, options: {
        cwd?: unknown;
    }): Promise<unknown>;
    cuLeases?: Pick<CuAgentLeases, 'configured' | 'prepareSpawn' | 'bindSpawnedProcess' | 'attachSpawnedSession' | 'abortSpawn'> & Partial<Pick<CuAgentLeases, 'prepareTransfer'>>;
}
export interface SessionLaunch {
    validateHarnessPilotSelection(descriptor: HarnessDescriptor, options: PilotValidationInput): Promise<void>;
    launchNewSession(options: NewSessionLaunchOptions): Promise<LaunchOutcome>;
    launchResumedSession(options: ResumeSessionLaunchOptions): Promise<LaunchOutcome>;
    resumeRpcSession(options: RpcResumeOptions): Promise<LaunchOutcome>;
    spawnHarnessInTmux(options: SpawnHarnessOptions): Promise<LaunchOutcome>;
}
export declare class LaunchError extends Error {
    readonly status: number;
    constructor(message: string, status: number);
}
export declare function cleanupProcesses(error: unknown): ProcessIdentity[] | null;
export declare function createSessionLaunch(observations: SessionLaunchObservations): SessionLaunch;
export {};
