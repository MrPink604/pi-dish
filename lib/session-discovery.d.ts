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
 * Basename identity for normal files; generic/nested session files use
 * validated header ids. Nested layouts are bounded.
 */
declare function discoverSessionCandidates(rootDir: string, options?: DiscoveryOptions): DiscoveryResult;
/**
 * The ordinary root precedes the private root, so on a native-id collision
 * the ordinary store keeps the route (first wins).
 */
declare function discoverHarnessSessions(descriptors?: readonly HarnessDescriptor[], options?: HarnessDiscoveryOptions): DiscoveryResult;
declare function findSessionCandidate(rootDir: string, sessionId: string, options?: FindOptions): {
    candidate: Candidate | null;
    truncated: boolean;
    skipped: number;
};
/**
 * Bounded to one parent's artifact subtree; corpus-wide collisions are the
 * full walk's business, so a row it later refuses simply 404s on click.
 */
declare function discoverSubsessionCandidates(parentFile: string, options?: DiscoveryOptions): Candidate[];
/**
 * Lifecycle proof, stricter than sidebar discovery: every JSONL and dir in the
 * subtree must be inspectable; symlinks, ambiguous headers or depth caps never
 * count as evidence that all descendants exited.
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
