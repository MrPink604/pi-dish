// Generated from src/core/session-discovery.ts; edit that source and run npm run build:core.
import type { HarnessDescriptor, HarnessId, NativeSessionId, SessionId } from './contracts';
import type { DiscoveryCandidate, DiscoveryOptions, DiscoveryResult, LiveSourceObservation } from './session-source';
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
/** Authoritative route -> file snapshot from discovery (omits ambiguous header IDs and lets basename/ordinary roots win). */
interface AuthoritativeRouteSnapshot {
    readonly harnessId: HarnessId;
    readonly byRoute: ReadonlyMap<SessionId, string>;
    readonly truncated: boolean;
}
interface ResolveNestedSubsessionOptions {
    readonly harnessId?: HarnessId;
    readonly descriptor?: HarnessDescriptor;
    readonly snapshot?: AuthoritativeRouteSnapshot;
    readonly rootDir?: string;
    readonly roots?: Partial<Record<HarnessId, string>>;
    readonly privateRoots?: Partial<Record<HarnessId, string>>;
    readonly live?: readonly LiveSourceObservation[];
}
interface NestedSubsessionResolverOptions {
    readonly harnessId?: HarnessId;
    readonly descriptor?: HarnessDescriptor;
    readonly rootDir?: string;
    readonly roots?: Partial<Record<HarnessId, string>>;
    readonly privateRoots?: Partial<Record<HarnessId, string>>;
    /** Snapshot reuse TTL in ms (0 = reuse one lazy snapshot for the resolver's lifetime). */
    readonly snapshotTtlMs?: number;
    readonly live?: (routeId: SessionId) => readonly LiveSourceObservation[];
}
/** Build one authoritative route -> file map for a harness using the exact discovery precedence rules. */
declare function buildAuthoritativeRouteSnapshot(descriptor: HarnessDescriptor, options?: {
    rootDir?: string;
    roots?: Partial<Record<HarnessId, string>>;
    privateRoots?: Partial<Record<HarnessId, string>>;
}): AuthoritativeRouteSnapshot;
/** Safe OMP subagent filename stem (rejects traversal and OMP's `changes.jsonl` log). */
declare function isValidTaskAgentId(value: unknown): value is string;
/**
 * Resolve one OMP `task` subagent id (`<parent-stem>/<agentId>.jsonl`) to its
 * canonical pi-dish route id (`~sk1_...`), verified back against discovery's
 * authoritative route-to-file mapping so collisions and non-routable copies
 * never produce a link.
 */
declare function resolveNestedSubsessionRouteId(parentFile: unknown, agentId: unknown, options?: ResolveNestedSubsessionOptions): SessionId | null;
/**
 * Reusable authoritative resolver for a request (snapshotTtlMs: 0) or long-lived
 * SSE stream (snapshotTtlMs > 0). Never scans per chip: refreshes at most once
 * per frame when a previously unseen file appears, and memoizes misses within a frame.
 */
declare function createNestedSubsessionResolver(options?: NestedSubsessionResolverOptions): {
    forParentFrame: (parentFile: string) => (agentId: string) => SessionId | null;
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
    isValidTaskAgentId: typeof isValidTaskAgentId;
    buildAuthoritativeRouteSnapshot: typeof buildAuthoritativeRouteSnapshot;
    createNestedSubsessionResolver: typeof createNestedSubsessionResolver;
    resolveNestedSubsessionRouteId: typeof resolveNestedSubsessionRouteId;
    readSessionHeader: typeof readSessionHeader;
    safeHeaderSessionId: typeof safeHeaderSessionId;
    DEFAULT_MAX_DEPTH: number;
    DEFAULT_MAX_FILES: number;
    DEFAULT_MAX_ENTRIES: number;
};
export = _default;
