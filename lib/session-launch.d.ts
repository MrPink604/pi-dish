// Generated from src/core/session-launch.ts; edit that source and run npm run build:core.
import type { BridgeRegistryEntry, HarnessDescriptor, HarnessEnvironment, ProcessIdentity, ProcessIdentityInput } from './contracts';
import { LifecycleInterruption } from './session-ownership';
import type { BeforeLifecycleAction } from './session-ownership';
import * as tmux from './tmux';
export interface HarnessLaunchSpec {
    env: HarnessEnvironment;
    argv: string[];
}
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
export interface NewSessionLaunchOptions extends PilotSelectionOptions {
    descriptor: HarnessDescriptor;
    name?: string | null;
    target?: HarnessLaunchTarget | null;
}
export interface ResumeSessionLaunchOptions extends NewSessionLaunchOptions {
    sessionFile: string;
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
    args: readonly string[];
    cwd?: string | null;
    name?: string | null;
    hidden?: boolean;
    restartPane?: RestartPaneOptions | null;
}
export interface CleanupEvidence extends tmux.PaneTarget {
    knownProcesses: ProcessIdentity[];
    timeout: number;
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
export declare const HEADLESS_TMUX_SERVER = "pi-dish";
export declare function harnessLaunchSpec(descriptor: HarnessDescriptor): HarnessLaunchSpec;
export declare function createSessionLaunch(observations: SessionLaunchObservations): SessionLaunch;
export {};
