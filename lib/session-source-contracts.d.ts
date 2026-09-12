// Generated from src/core/session-source-contracts.ts; edit that source and run npm run build:core.
import type { HarnessDescriptor, HarnessId, NativeSessionId, SessionId } from './contracts';
/** Read identity only. Neither discovery nor a live observation proves process ownership. */
export interface SessionSource {
    readonly file: string;
    readonly harnessId: HarnessId;
    readonly nativeSessionId: NativeSessionId;
    readonly sessionKey: SessionId;
    readonly routeId: SessionId;
    readonly profileId: string;
    readonly profileVersion: number;
    readonly parentSession: string | null;
}
export interface DiscoveryCandidate extends SessionSource {
    readonly dirName: string;
    readonly depth: number;
    readonly identitySource: 'basename' | 'header';
}
export interface DiscoveryResult {
    readonly candidates: readonly DiscoveryCandidate[];
    readonly truncated: boolean;
    readonly skipped: number;
}
export interface DiscoveryOptions {
    readonly descriptor?: HarnessDescriptor;
    readonly harnessId?: HarnessId;
    readonly profileId?: string;
    readonly profileVersion?: number;
    readonly maxDepth?: number;
    readonly maxFiles?: number;
    readonly maxEntries?: number;
    readonly excludeIds?: ReadonlySet<NativeSessionId> | readonly NativeSessionId[];
}
export interface LiveSourceObservation {
    readonly kind: 'registered' | 'rpc';
    readonly harnessId: HarnessId;
    readonly nativeSessionId: NativeSessionId;
    readonly file: string | null;
}
export interface SourceLookup {
    /** Keep raw route bytes: encoded Pi aliases must not enable partial matching. */
    readonly route: string;
    readonly exact?: boolean;
    readonly discover?: boolean;
    readonly live: readonly LiveSourceObservation[];
}
/** Implemented by session-source.ts; read provenance never proves process ownership. */
export interface SessionSourceResolver {
    resolve(input: SourceLookup): SessionSource | null;
    /** Replace discovered route entries, including on a truncated enumeration. */
    refresh(discovery: DiscoveryResult): void;
    /** Retire every route/profile alias for a vanished or replaced file. */
    invalidate(file: string): void;
    clear(): void;
}
