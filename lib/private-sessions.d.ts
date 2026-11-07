// Generated from src/core/private-sessions.ts; edit that source and run npm run build:core.
import type { HarnessDescriptor, HarnessId } from './contracts';
/**
 * Private sessions live outside every fleet-backed-up path. The root follows
 * the XDG state convention and is resolved per call (tests swap HOME), never
 * captured at module load.
 */
declare function privateRootPath(harnessId: HarnessId, env?: NodeJS.ProcessEnv): string;
/** Null for harnesses without private-session support (prime today). */
declare function privateRootFor(descriptor: Pick<HarnessDescriptor, 'privateRootPath'> | null | undefined): string | null;
/** Create the root (0700) before a spawn writes into it. */
declare function ensurePrivateRoot(root: string): void;
/**
 * Realpath-safe containment so a symlink cannot change privacy; a missing
 * root answers false. The lexical check spares ordinary rows a realpath call.
 */
declare function isPrivateSessionFile(descriptor: Pick<HarnessDescriptor, 'privateRootPath'> | null | undefined, file: string | null | undefined): boolean;
interface SessionRoot {
    readonly root: string;
    readonly singleWorkspace: boolean;
    readonly private: boolean;
}
/**
 * Every directory that can hold one harness's sessions, primary first. The
 * private root is a single flat workspace (`pi --session-dir` writes
 * `<ts>_<id>.jsonl`). A `roots` override suppresses the real private root
 * unless `privateRoots` names one, so fixtures never mix in real private sessions.
 */
declare function sessionRootsFor(descriptor: HarnessDescriptor, options?: {
    roots?: Partial<Record<HarnessId, string>>;
    privateRoots?: Partial<Record<HarnessId, string>>;
}): SessionRoot[];
declare const _default: {
    privateRootPath: typeof privateRootPath;
    privateRootFor: typeof privateRootFor;
    ensurePrivateRoot: typeof ensurePrivateRoot;
    isPrivateSessionFile: typeof isPrivateSessionFile;
    sessionRootsFor: typeof sessionRootsFor;
};
export = _default;
