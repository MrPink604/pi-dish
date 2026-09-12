// Generated from src/core/session-discovery.ts; edit that source and run npm run build:core.
import type { HarnessDescriptor, HarnessId, NativeSessionId } from './contracts';
import type { DiscoveryCandidate, DiscoveryOptions } from './session-source-contracts';
interface SessionHeader {
    id: string | null;
    cwd: string | null;
    parentSession: string | null;
}
type Candidate = DiscoveryCandidate;
interface Result {
    candidates: Candidate[];
    truncated: boolean;
    skipped: number;
}
interface HarnessDiscoveryOptions extends DiscoveryOptions {
    roots?: Partial<Record<HarnessId, string>>;
}
interface FindOptions extends DiscoveryOptions {
    allowPartial?: boolean;
}
declare function readSessionHeader(filePath: string, profileId?: string): SessionHeader | null;
declare function safeHeaderSessionId(value: unknown): NativeSessionId | null;
/**
 * Discover harness session JSONLs, including bounded nested layouts used by
 * external launchers and OMP subagents. Normal files retain their basename
 * identity; generic/nested session files use validated header ids.
 */
declare function discoverSessionCandidates(rootDir: string, options?: DiscoveryOptions): Result;
/** Discover configured harness roots while retaining per-harness identity. */
declare function discoverHarnessSessions(descriptors?: readonly HarnessDescriptor[], options?: HarnessDiscoveryOptions): Result;
declare function findSessionCandidate(rootDir: string, sessionId: string, options?: FindOptions): {
    candidate: Candidate | null;
    truncated: boolean;
    skipped: number;
};
/**
 * The nested subsession files under one session's own artifact directory
 * (`<parent>.jsonl` → `<parent>/<agent>.jsonl`, recursively). Bounded to that
 * subtree: callers resolve the subagents of a handful of *live* sessions per
 * request and must not pay the corpus-wide walk `discoverSessionCandidates`
 * performs.
 *
 * Identity derivation, the symlink refusal, the depth reach and the
 * two-header-ids-one-file ambiguity rule are the corpus walk's own — a
 * candidate found here is one that walk would also emit. What it cannot see
 * is a *corpus-wide* collision (a header id that some other workspace's file
 * claims by basename), so route lookup stays with the full walk, which is
 * authoritative: a row whose id it later refuses simply 404s on click rather
 * than opening a stranger's transcript.
 */
declare function discoverSubsessionCandidates(parentFile: string, options?: DiscoveryOptions): Candidate[];
/**
 * Lifecycle proof, deliberately stricter than sidebar discovery. Every JSONL
 * and directory in the parent's subtree must be inspectable; no lossy
 * candidate filtering, symlinks, ambiguous headers, or depth caps count as
 * evidence that all descendants exited.
 */
declare function inspectSubsessionExits(parentFile: string, options?: DiscoveryOptions): {
    complete: boolean;
    blockers: string[];
};
/** Retire all parser-profile observations of a replaced file. */
declare function invalidateSessionHeader(file: string): void;
declare function clearSessionHeaders(): void;
declare const _default: {
    invalidateSessionHeader: typeof invalidateSessionHeader;
    clearSessionHeaders: typeof clearSessionHeaders;
    discoverSessionCandidates: typeof discoverSessionCandidates;
    discoverHarnessSessions: typeof discoverHarnessSessions;
    findSessionCandidate: typeof findSessionCandidate;
    discoverSubsessionCandidates: typeof discoverSubsessionCandidates;
    inspectSubsessionExits: typeof inspectSubsessionExits;
    readSessionHeader: typeof readSessionHeader;
    safeHeaderSessionId: typeof safeHeaderSessionId;
    DEFAULT_MAX_DEPTH: number;
    DEFAULT_MAX_FILES: number;
    DEFAULT_MAX_ENTRIES: number;
};
export = _default;
