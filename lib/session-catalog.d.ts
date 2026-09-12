// Generated from src/core/session-catalog.ts; edit that source and run npm run build:core.
import type { HarnessId, NativeSessionId, SessionId } from './contracts';
import type { SessionInfo } from './session-metadata-contracts';
import type { SessionSource } from './session-source-contracts';
import type { CatalogAdvice, CatalogHistoryObservation, CatalogLiveObservation, CatalogRoutineAnnotation, CatalogSession, SessionCatalog, SessionCatalogInput, SessionCatalogOptions } from './session-catalog-contracts';
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
/** Validate advisory store snapshots without migrating or granting authority to
 * those stores. Invalid records are ignored individually. */
declare function decodeLaunchParents(value: unknown): ReadonlyMap<SessionId, SessionId>;
declare function decodeRoutineAnnotations(value: unknown): ReadonlyMap<SessionId, CatalogRoutineAnnotation>;
/** Model catalogs can warm after indexing, so context derivation stays read-time. */
declare function withSessionContext<T extends Readonly<SessionInfo>>(info: T, contextWindowForModel: SessionCatalogOptions['contextWindowForModel']): T & {
    contextWindow: number;
    contextPercent: number;
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
