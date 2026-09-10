// Generated from src/core/process-identity.ts; edit that source and run npm run build:core.
import type { ProcessIdentity, ProcessIdentityInput, ProcessAncestry } from './contracts';
/**
 * Return the exact identity of a live Linux process. PIDs can be reused;
 * /proc field 22 is the process start time in clock ticks since boot and is
 * stable for the lifetime of one process.
 */
declare function processIdentity(pid: number | string | undefined): ProcessIdentity | null;
declare function processIdentityAlive(identity: ProcessIdentityInput | null | undefined): boolean;
/**
 * Inspect an exact process's complete Linux parent chain. `complete` is true
 * only after reaching the process-tree root; callers making destructive
 * ownership decisions must fail closed for an incomplete chain.
 */
declare function inspectProcessAncestry(identity: ProcessIdentityInput | null | undefined, { maxDepth }?: {
    maxDepth?: number | undefined;
}): ProcessAncestry;
declare const _default: {
    processIdentity: typeof processIdentity;
    processIdentityAlive: typeof processIdentityAlive;
    inspectProcessAncestry: typeof inspectProcessAncestry;
};
export = _default;
