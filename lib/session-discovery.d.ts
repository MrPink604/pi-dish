// Generated from src/core/session-discovery.ts; edit that source and run npm run build:core.
import type { HarnessDescriptor, HarnessId, NativeSessionId } from './contracts';
import type { DiscoveryCandidate, DiscoveryOptions, DiscoveryResult } from './session-source';
interface SessionHeader {
    id: string | null;
    cwd: string | null;
    parentSession: string | null;
}
type Candidate = DiscoveryCandidate;
interface HarnessDiscoveryOptions extends DiscoveryOptions {
    roots?: Partial<Record<HarnessId, string>>;
    privateRoots?: Partial<Record<HarnessId, string>>;
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
declare function discoverSessionCandidates(rootDir: string, options?: DiscoveryOptions): DiscoveryResult;
/**
 * Discover configured harness roots while retaining per-harness identity.
 * The ordinary root precedes the private root, so if both somehow hold one
 * native id, the ordinary store keeps the route (first wins).
 */
declare function discoverHarnessSessions(descriptors?: readonly HarnessDescriptor[], options?: HarnessDiscoveryOptions): DiscoveryResult;
declare function findSessionCandidate(rootDir: string, sessionId: string, options?: FindOptions): {
    candidate: Candidate | null;
    truncated: boolean;
    skipped: number;
};
/**
 * The nested subsession files under one session's own artifact directory
 * (`<parent>.jsonl` -> `<parent>/<agent>.jsonl`, recursively). Bounded to that
 * subtree: a corpus-wide collision stays the full walk's business, so a row
 * whose id it later refuses simply 404s on click.
 */
declare function discoverSubsessionCandidates(parentFile: string, options?: DiscoveryOptions): Candidate[];
/**
 * Lifecycle proof, deliberately stricter than sidebar discovery. Every JSONL
 * and directory in the parent's subtree must be inspectable; no lossy
 * candidate filtering, symlinks, ambiguous headers, or depth caps count as
 * evidence that all descendants exited.
 */
declare function inspectSubsessionExits(parentFile: unknown, options?: DiscoveryOptions): {
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
