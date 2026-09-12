// Generated from src/core/session-catalog-contracts.ts; edit that source and run npm run build:core.
import type { SessionCapabilities, HarnessDescriptor, SessionId, SessionIdentity } from './contracts';
import type { SessionFields } from './session-api';
import type { SessionInfo } from './session-metadata-contracts';
import type { SessionSource, DiscoveryCandidate } from './session-source-contracts';
/** Already computed by lifecycle policy; presentation advice is never an ownership proof. */
export interface CatalogAdvice {
    readonly capabilities: Readonly<SessionCapabilities>;
    readonly closeMode: HarnessDescriptor['closeMode'];
    readonly conflicted: boolean;
    readonly liveInstanceCount: number;
}
export interface CatalogLiveObservation extends Readonly<SessionIdentity> {
    readonly kind: 'registered' | 'rpc';
    readonly source: SessionSource | null;
    readonly id: SessionId;
    readonly fields: Readonly<Pick<SessionFields<Date | string | number>, 'name' | 'model' | 'thinkingLevel' | 'contextTokens' | 'contextPercent' | 'contextWindow' | 'messageCount' | 'lastActivity' | 'turnInProgress' | 'compacting' | 'cwd'>>;
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
    /** Existing realpath/existence observations; filesystem I/O remains at ingress. */
    readonly canonicalPaths: ReadonlyMap<string, string>;
    readonly existingDirectories: ReadonlySet<string>;
    readonly indexing: boolean;
    readonly discoveryTruncated: boolean;
    readonly discoverySkipped: number;
    readonly activeOnly: boolean;
}
export interface SessionCatalogOptions {
    readonly harnesses: ReadonlyMap<SessionIdentity['harnessId'], Readonly<Pick<HarnessDescriptor, 'id' | 'label' | 'layout'>>>;
    /** Existing model-window lookup policy, invoked at composition time, never persisted. */
    readonly contextWindowForModel: (model: string | null | undefined) => number;
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
    readonly active: readonly CatalogSession[];
    readonly previous: readonly CatalogSession[];
    readonly children: readonly CatalogSession[];
    readonly byId: ReadonlyMap<SessionId, CatalogSession>;
    readonly byPath: ReadonlyMap<string, CatalogSession>;
    readonly indexing: boolean;
    readonly discoveryTruncated: boolean;
    readonly discoverySkipped: number;
}
