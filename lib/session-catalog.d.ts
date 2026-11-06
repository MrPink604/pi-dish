// Generated from src/core/session-catalog.ts; edit that source and run npm run build:core.
import type { ServedCacheExpiry } from './cache-lifetime';
import type { HarnessDescriptor, HarnessId, NativeSessionId, SessionCapabilities, SessionId, SessionIdentity } from './contracts';
import type { SessionInfo } from './session-metadata';
import type { DiscoveryCandidate, SessionSource } from './session-source';
import type { CacheRetentionConfig } from './cache-retention';
import { type SessionFields } from './session-api';
/** Already computed by lifecycle policy; presentation advice is never an ownership proof. */
export interface CatalogAdvice {
    readonly capabilities: Readonly<SessionCapabilities>;
    readonly closeMode: HarnessDescriptor['closeMode'];
    readonly conflicted: boolean;
    readonly liveInstanceCount: number;
}
export interface CatalogLiveObservation extends Readonly<SessionIdentity> {
    /** `prime`: a root agent read from Prime's daemon roster (no bridge registry row). */
    readonly kind: 'registered' | 'rpc' | 'prime';
    /** Reported even before the JSONL exists. This is not a resolved read source. */
    readonly claimedFile: string | null;
    readonly source: SessionSource | null;
    readonly id: SessionId;
    readonly fields: Readonly<Pick<SessionFields<Date | string | number>, 'name' | 'model' | 'thinkingLevel' | 'fastMode' | 'contextTokens' | 'contextPercent' | 'contextWindow' | 'messageCount' | 'lastActivity' | 'turnInProgress' | 'askPending' | 'compacting' | 'cwd'>>;
    readonly info: Readonly<SessionInfo> | null;
    readonly pid: number | null;
    readonly advice: CatalogAdvice;
}
export interface CatalogHistoryObservation {
    readonly source: DiscoveryCandidate;
    readonly info: Readonly<SessionInfo>;
    readonly liveChild: boolean;
    readonly advice: CatalogAdvice;
}
export interface CatalogRoutineAnnotation {
    readonly routine: string;
    readonly routineId: string;
    readonly routineInvocationId: string;
}
/** Inputs are captured for one composition, not callbacks into mutable lifecycle stores. */
export interface SessionCatalogInput {
    readonly active: readonly CatalogLiveObservation[];
    readonly history: readonly CatalogHistoryObservation[];
    readonly launchParents: ReadonlyMap<SessionId, SessionId>;
    readonly routines: ReadonlyMap<SessionId, CatalogRoutineAnnotation>;
    readonly indexing: boolean;
    readonly discoveryTruncated: boolean;
    readonly discoverySkipped: number;
    readonly activeOnly: boolean;
}
export interface SessionCatalogOptions {
    readonly harnesses: ReadonlyMap<SessionIdentity['harnessId'], Readonly<Pick<HarnessDescriptor, 'id' | 'label' | 'layout' | 'privateRootPath'>>>;
    /** Existing model-window lookup policy, invoked at composition time, never persisted. */
    readonly contextWindowForModel: (model: string | null | undefined) => number;
    /** Read-only probes keep path derivation in the catalog, without duplicating it in adapters. */
    readonly canonicalPath: (file: string | null) => string | null;
    readonly directoryExists: (directory: string) => boolean;
    /** One settings snapshot per catalog; individual projections may load on demand. */
    readonly cacheRetention?: CacheRetentionConfig;
}
/** Before JSON serialization; default API fields omitted by view=client remain explicit. */
export interface CatalogSession extends SessionFields<Date | string | number> {
    readonly id: SessionId;
    readonly sessionKey: SessionId;
    readonly nativeSessionId: SessionIdentity['nativeSessionId'];
    readonly harnessId: SessionIdentity['harnessId'];
    readonly sessionFile: string | null;
    readonly profileId?: string;
    readonly profileVersion?: number;
    readonly parentSession: string | null;
    readonly parentSessionSource: string | null;
    readonly pid?: number | null;
}
export interface SessionCatalog {
    /** Active first, then previous and any active-only children, each route appearing once. */
    readonly list: readonly CatalogSession[];
    readonly active: readonly CatalogSession[];
    readonly previous: readonly CatalogSession[];
    readonly children: readonly CatalogSession[];
    readonly byId: ReadonlyMap<SessionId, CatalogSession>;
    readonly byPath: ReadonlyMap<string, CatalogSession>;
    readonly indexing: boolean;
    readonly discoveryTruncated: boolean;
    readonly discoverySkipped: number;
}
interface ObservationContext {
    readonly nativeSessionId: NativeSessionId;
    readonly source: SessionSource | null;
    readonly info: Readonly<SessionInfo> | null;
    readonly advice: CatalogAdvice;
}
interface RegisteredContext extends ObservationContext {
    readonly harnessId: HarnessId;
}
/** Validate only the registry fields consumed by the catalog. Group selection,
 * conflicts and lifecycle advice remain with the registry/policy adapter. */
declare function registeredSessionObservation(value: unknown, context: RegisteredContext): CatalogLiveObservation;
/** RPC state and model objects enter as unknown, not as a handwritten signature
 * asserting that another module already validated their presentation fields. */
declare function rpcSessionObservation(value: unknown, context: ObservationContext): CatalogLiveObservation;
/** A live Prime daemon root: the roster supplies identity, model, activity and
 * busy state, while the transcript (when it exists) supplies history counters.
 * Only root agents reach here; RLM children stay silent helper semantics. */
declare function primeSessionObservation(value: unknown, context: ObservationContext): CatalogLiveObservation;
/** Validate advisory store snapshots without migrating or granting authority to
 * those stores. Invalid records are ignored individually. */
declare function decodeLaunchParents(value: unknown): ReadonlyMap<SessionId, SessionId>;
declare function decodeRoutineAnnotations(value: unknown): ReadonlyMap<SessionId, CatalogRoutineAnnotation>;
/**
 * Context derivation stays read-time: model catalogs warm after indexing, and
 * a stored 'unknown' cache-expiry anchor must never reach a client.
 */
declare function withSessionContext<T extends Readonly<SessionInfo>>(info: T, contextWindowForModel: SessionCatalogOptions['contextWindowForModel'], cacheRetention?: SessionCatalogOptions['cacheRetention']): T & {
    contextWindow: number;
    contextPercent: number;
    cacheExpiry: ServedCacheExpiry | null;
};
declare function subsessionLabel(source: SessionSource | null): string | null;
declare function buildActiveSession(live: CatalogLiveObservation, options: SessionCatalogOptions): CatalogSession;
declare function buildSourceSession(source: SessionSource, info: Readonly<SessionInfo>, advice: CatalogAdvice, options: SessionCatalogOptions): CatalogSession;
declare function buildHistoricalSession(history: CatalogHistoryObservation, options: SessionCatalogOptions, projection?: {
    cwdFallback?: boolean;
}): CatalogSession;
declare function composeSessionCatalog(input: SessionCatalogInput, options: SessionCatalogOptions): SessionCatalog;
declare const _default: {
    registeredSessionObservation: typeof registeredSessionObservation;
    rpcSessionObservation: typeof rpcSessionObservation;
    primeSessionObservation: typeof primeSessionObservation;
    decodeLaunchParents: typeof decodeLaunchParents;
    decodeRoutineAnnotations: typeof decodeRoutineAnnotations;
    withSessionContext: typeof withSessionContext;
    subsessionLabel: typeof subsessionLabel;
    buildActiveSession: typeof buildActiveSession;
    buildSourceSession: typeof buildSourceSession;
    buildHistoricalSession: typeof buildHistoricalSession;
    composeSessionCatalog: typeof composeSessionCatalog;
};
export = _default;
