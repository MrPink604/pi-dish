// Generated from src/core/harnesses.ts; edit that source and run npm run build:core.
import type { HarnessDescriptor, HarnessId } from './contracts';
declare function getHarness(id: unknown): HarnessDescriptor | null;
declare function listHarnesses(): HarnessDescriptor[];
/**
 * One configured command line: bare `env`, then KEY=VALUE assignments (which
 * override `baseEnv`), then the argv.
 */
declare function parseLaunchWords(input: unknown, baseEnv?: Record<string, string>): {
    env: Record<string, string>;
    words: string[];
};
declare function resolveLaunchSpec(descriptor: HarnessDescriptor, env?: NodeJS.ProcessEnv): {
    env: Record<string, string>;
    argv: string[];
};
declare const _default: {
    registry: Readonly<Record<HarnessId, HarnessDescriptor>>;
    getHarness: typeof getHarness;
    listHarnesses: typeof listHarnesses;
    resolveLaunchSpec: typeof resolveLaunchSpec;
    parseLaunchWords: typeof parseLaunchWords;
};
export = _default;
