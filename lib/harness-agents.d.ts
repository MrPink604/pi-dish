// Generated from src/core/harness-agents.ts; edit that source and run npm run build:core.
import type { HarnessDescriptor, HarnessEnvironment } from './contracts';
/** Project > user > bundled definitions, matching the harness override order. */
export interface TaskAgent {
    name: string;
    description: string;
    model: string | null;
    thinkingLevel: string | null;
    source: 'project' | 'user' | 'bundled';
    path: string;
}
export interface HarnessJsonCommandOptions {
    cwd?: string;
}
export type HarnessJsonCommand = (descriptor: HarnessDescriptor, argv: string[], options?: HarnessJsonCommandOptions) => Promise<unknown>;
export declare function listTaskAgents(descriptor: HarnessDescriptor, runJson: HarnessJsonCommand, { cwd, env }?: {
    cwd?: string;
    env?: HarnessEnvironment;
}): Promise<TaskAgent[]>;
