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
/** Malformed/missing frontmatter keeps the filename fallback; unreadable files drop. */
export declare function parseAgentFile(file: string, source: TaskAgent['source']): TaskAgent | null;
export declare function listTaskAgents(descriptor: HarnessDescriptor, runJson: HarnessJsonCommand, { cwd, env }?: {
    cwd?: string;
    env?: HarnessEnvironment;
}): Promise<TaskAgent[]>;
export declare function _resetCacheForTests(): void;
