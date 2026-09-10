// Generated from src/core/harnesses.ts; edit that source and run npm run build:core.
import type { HarnessDescriptor } from './contracts';
declare function getHarness(id: unknown): HarnessDescriptor | null;
declare function listHarnesses(): HarnessDescriptor[];
declare function resolveLaunchSpec(descriptor: HarnessDescriptor, env?: NodeJS.ProcessEnv): {
    env: {
        [x: string]: string;
    };
    argv: string[];
};
declare const _default: {
    registry: Record<string, HarnessDescriptor>;
    getHarness: typeof getHarness;
    listHarnesses: typeof listHarnesses;
    resolveLaunchSpec: typeof resolveLaunchSpec;
};
export = _default;
