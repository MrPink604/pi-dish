import path = require('path');
import { canonicalSessionId, encodeSessionKey } from './session-key';
import { isRecord } from './wire-protocol';
import type { HarnessId, NativeSessionId, SessionId } from './contracts';
import type { SessionInfo } from './session-metadata-contracts';
import type { SessionSource } from './session-source-contracts';
import type {
  CatalogAdvice, CatalogHistoryObservation, CatalogLiveObservation, CatalogRoutineAnnotation,
  CatalogSession, SessionCatalog, SessionCatalogInput, SessionCatalogOptions,
} from './session-catalog-contracts';

type LiveFields = CatalogLiveObservation['fields'];
interface ObservationContext {
  readonly nativeSessionId: NativeSessionId;
  readonly source: SessionSource | null;
  readonly info: Readonly<SessionInfo> | null;
  readonly advice: CatalogAdvice;
}
interface RegisteredContext extends ObservationContext { readonly harnessId: HarnessId; }
const string = (value: unknown): string | null => typeof value === 'string' ? value : null;
const number = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const timestamp = (value: unknown): Date | string | number | undefined =>
  typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
    || (value instanceof Date && Number.isFinite(value.getTime())) ? value : undefined;

function record(value: unknown): Record<string, unknown> { return isRecord(value) ? value : {}; }
function modelRef(value: unknown): string | null {
  if (typeof value === 'string') return value || null;
  const model = record(value);
  const provider = string(model.provider);
  const id = string(model.id) || string(model.modelId);
  return provider && id ? `${provider}/${id}` : null;
}

function observation(kind: CatalogLiveObservation['kind'], harnessId: HarnessId, claimedFile: string | null,
  fields: LiveFields, pid: number | null, context: ObservationContext): CatalogLiveObservation {
  const key = encodeSessionKey(harnessId, context.nativeSessionId);
  const id = canonicalSessionId(key);
  const source = context.source;
  if (source && (source.harnessId !== harnessId || source.nativeSessionId !== context.nativeSessionId
      || source.sessionKey !== key || source.routeId !== id || source.file !== claimedFile)) {
    throw new TypeError('Live session source does not match its captured identity and file claim');
  }
  return { kind, harnessId, nativeSessionId: context.nativeSessionId, claimedFile, source, id,
    fields, pid, info: context.info, advice: context.advice };
}

/** Validate only the registry fields consumed by the catalog. Group selection,
 * conflicts and lifecycle advice remain with the registry/policy adapter. */
function registeredSessionObservation(value: unknown, context: RegisteredContext): CatalogLiveObservation {
  if (!isRecord(value)) throw new TypeError('Invalid registered session observation');
  const usage = record(value.contextUsage);
  return observation('registered', context.harnessId, string(value.sessionFile), {
    name: string(value.name), model: string(value.model), thinkingLevel: string(value.thinkingLevel),
    contextTokens: number(usage.tokens), contextPercent: number(usage.percent),
    contextWindow: number(usage.contextWindow), lastActivity: timestamp(value.updatedAt),
    turnInProgress: value.turnInProgress === true, compacting: value.compacting === true,
    cwd: string(value.cwd),
  }, number(value.pid) ?? null, context);
}

/** RPC state and model objects enter as unknown, not as a handwritten signature
 * asserting that another module already validated their presentation fields. */
function rpcSessionObservation(value: unknown, context: ObservationContext): CatalogLiveObservation {
  if (!isRecord(value)) throw new TypeError('Invalid RPC session observation');
  const state = record(value.state);
  const usage = record(record(value.lastStats).contextUsage);
  return observation('rpc', 'pi', string(value.sessionFile) || string(state.sessionFile), {
    name: string(state.sessionName) || string(state.name),
    model: modelRef(state.model) || modelRef(value.model), thinkingLevel: string(state.thinkingLevel),
    contextTokens: number(usage.tokens), contextPercent: number(usage.percent),
    contextWindow: number(usage.contextWindow) || number(record(state.model).contextWindow),
    messageCount: number(state.messageCount), lastActivity: timestamp(value.lastActivityAt),
    turnInProgress: value.turnInProgress === true, compacting: value.compacting === true,
    cwd: string(value.cwd),
  }, number(record(value.proc).pid) ?? null, context);
}

/** Validate advisory store snapshots without migrating or granting authority to
 * those stores. Invalid records are ignored individually. */
function decodeLaunchParents(value: unknown): ReadonlyMap<SessionId, SessionId> {
  const parents = new Map<SessionId, SessionId>();
  if (!isRecord(value)) return parents;
  for (const [child, raw] of Object.entries(value)) {
    if (!isRecord(raw)) continue;
    try { parents.set(canonicalSessionId(child), canonicalSessionId(raw.sourceSessionId)); } catch { /* Invalid hint. */ }
  }
  return parents;
}
function decodeRoutineAnnotations(value: unknown): ReadonlyMap<SessionId, CatalogRoutineAnnotation> {
  const routines = new Map<SessionId, CatalogRoutineAnnotation>();
  if (!(value instanceof Map)) return routines;
  for (const [sessionId, raw] of value as Map<unknown, unknown>) {
    if (!isRecord(raw) || typeof raw.routineName !== 'string'
        || typeof raw.routineId !== 'string' || typeof raw.id !== 'string') continue;
    try {
      routines.set(canonicalSessionId(sessionId), {
        routine: raw.routineName, routineId: raw.routineId, routineInvocationId: raw.id,
      });
    } catch { /* Invalid hint. */ }
  }
  return routines;
}

/** Model catalogs can warm after indexing, so context derivation stays read-time. */
function withSessionContext<T extends Readonly<SessionInfo>>(info: T,
  contextWindowForModel: SessionCatalogOptions['contextWindowForModel']): T & { contextWindow: number; contextPercent: number } {
  const contextWindow = contextWindowForModel(info.model);
  const contextPercent = info.contextTokens > 0 ? Math.min(100, Math.floor(info.contextTokens / contextWindow * 100)) : 0;
  return { ...info, contextWindow, contextPercent };
}

function subsessionLabel(source: SessionSource | null): string | null {
  if (!source?.parentSession) return null;
  const handle = path.basename(source.file, '.jsonl');
  return handle === 'session' ? null : handle;
}
function identityFields(harnessId: HarnessId, nativeSessionId: NativeSessionId, options: SessionCatalogOptions) {
  const harness = options.harnesses.get(harnessId);
  if (!harness) throw new TypeError('Unknown catalog harness');
  const sessionKey = encodeSessionKey(harnessId, nativeSessionId);
  return { id: canonicalSessionId(sessionKey), sessionKey, harnessId, nativeSessionId, harnessLabel: harness.label };
}

function buildActiveSession(live: CatalogLiveObservation, options: SessionCatalogOptions): CatalogSession {
  const fields = live.fields;
  const registered = live.kind === 'registered';
  const info = live.info ? withSessionContext(live.info, options.contextWindowForModel) : null;
  const model = registered ? fields.model || info?.model : fields.model;
  const percent = registered ? fields.contextPercent ?? info?.contextPercent : fields.contextPercent;
  const parentSession = live.info?.parentSession || (registered ? live.source?.parentSession : null) || null;
  return {
    ...identityFields(live.harnessId, live.nativeSessionId, options),
    capabilities: { ...live.advice.capabilities }, closeMode: live.advice.closeMode,
    conflicted: live.advice.conflicted, liveInstanceCount: live.advice.liveInstanceCount || 1,
    name: (registered ? fields.name || info?.name : fields.name) || 'New Session',
    model: model || 'unknown', contextPercent: percent == null ? 0 : Math.round(percent * 10) / 10,
    contextTokens: (registered ? fields.contextTokens ?? info?.contextTokens : fields.contextTokens) ?? 0,
    contextWindow: (registered ? fields.contextWindow || options.contextWindowForModel(model) : fields.contextWindow) || 0,
    thinkingLevel: fields.thinkingLevel || null,
    messageCount: (registered ? info?.messageCount : fields.messageCount) || 0,
    lastActivity: registered ? info?.lastActivity || fields.lastActivity || new Date(0) : fields.lastActivity,
    isActive: true, turnInProgress: fields.turnInProgress === true, compacting: fields.compacting === true,
    cwd: (registered ? fields.cwd || info?.cwd : fields.cwd) || null,
    sessionFile: live.claimedFile || null,
    parentSession,
    parentSessionSource: registered && !live.info?.parentSession && live.source?.parentSession ? 'omp-subsession-layout' : null,
    pid: live.pid || null,
  };
}

function projectHistory(source: SessionSource, raw: Readonly<SessionInfo>, advice: CatalogAdvice,
  options: SessionCatalogOptions, liveChild: boolean, dirName?: string): CatalogSession {
  const info = withSessionContext(raw, options.contextWindowForModel);
  let cwd = info.cwd;
  if (!cwd && dirName !== undefined && source.harnessId === 'pi' && options.harnesses.get('pi')?.layout === 'nested') {
    const decoded = '/' + dirName.replace(/^--/, '').replace(/--$/, '').replace(/-/g, '/');
    cwd = options.directoryExists(decoded) ? decoded : null;
  }
  return {
    ...identityFields(source.harnessId, source.nativeSessionId, options),
    capabilities: { ...advice.capabilities, ...(liveChild ? { resume: false } : {}) }, closeMode: advice.closeMode,
    profileId: source.profileId, profileVersion: source.profileVersion,
    name: subsessionLabel(source) || info.name || source.nativeSessionId.slice(0, 8),
    model: info.model || 'unknown', contextPercent: info.contextPercent || 0, contextTokens: info.contextTokens || 0,
    messageCount: info.messageCount || 0, lastActivity: info.lastActivity, isActive: false,
    ...(liveChild ? { subagentLive: true } : {}),
    cwd, sessionFile: source.file, parentSession: info.parentSession || source.parentSession || null,
    parentSessionSource: !info.parentSession && source.parentSession ? 'omp-subsession-layout' : null,
  };
}
function buildSourceSession(source: SessionSource, info: Readonly<SessionInfo>, advice: CatalogAdvice,
  options: SessionCatalogOptions): CatalogSession {
  return projectHistory(source, info, advice, options, false);
}
function buildHistoricalSession(history: CatalogHistoryObservation, options: SessionCatalogOptions,
  projection: { cwdFallback?: boolean } = {}): CatalogSession {
  return projectHistory(history.source, history.info, history.advice, options, history.liveChild,
    projection.cwdFallback === false ? undefined : history.source.dirName);
}

function activityTime(session: CatalogSession): number {
  const value = session.lastActivity;
  return value instanceof Date ? value.getTime() : value === undefined ? NaN : new Date(value ?? 0).getTime();
}

function composeSessionCatalog(input: SessionCatalogInput, options: SessionCatalogOptions): SessionCatalog {
  const active: CatalogSession[] = [], previous: CatalogSession[] = [], children: CatalogSession[] = [];
  const seen = new Set<SessionId>();
  // A registered row owns the logical session even when the RPC snapshot was
  // collected first. Conflicted rows remain visible; advice already disables control.
  for (const kind of ['registered', 'rpc'] as const) {
    for (const live of input.active) {
      if (live.kind !== kind || seen.has(live.id)) continue;
      const row = buildActiveSession(live, options);
      seen.add(row.id); active.push(row);
    }
  }
  for (const history of input.history) {
    if (seen.has(history.source.routeId) || (input.activeOnly && !history.liveChild)) continue;
    const row = buildHistoricalSession(history, options, { cwdFallback: !input.activeOnly });
    seen.add(row.id);
    (input.activeOnly ? children : previous).push(row);
  }
  active.sort((a, b) => activityTime(b) - activityTime(a));
  previous.sort((a, b) => activityTime(b) - activityTime(a));
  const list = [...active, ...previous, ...children];
  const byId = new Map(list.map(session => [session.id, session]));
  const byPath = new Map<string, CatalogSession>();
  for (const session of list) {
    const canonical = options.canonicalPath(session.sessionFile);
    if (canonical) byPath.set(canonical, session);
  }
  for (const session of list) {
    let nativeParent: SessionId | null = null;
    if (session.parentSession && session.sessionFile) {
      const parentFile = path.isAbsolute(session.parentSession) ? session.parentSession
        : path.resolve(path.dirname(session.sessionFile), session.parentSession);
      const canonical = options.canonicalPath(parentFile);
      nativeParent = canonical ? byPath.get(canonical)?.id || null : null;
    }
    const launchParent = input.launchParents.get(session.id) || null;
    const parentId = nativeParent || launchParent;
    session.parentId = parentId && parentId !== session.id ? parentId : null;
    session.parentSource = nativeParent ? session.parentSessionSource || 'pi-session-header'
      : launchParent ? 'pi-dish-launch' : null;
    const parent = parentId && parentId !== session.id ? byId.get(parentId) : undefined;
    session.familyParentId = parent && (parent.cwd || '~') === (session.cwd || '~') ? parent.id : null;
    const routine = input.routines.get(session.id);
    if (routine) {
      session.routine = routine.routine;
      session.routineId = routine.routineId;
      session.routineInvocationId = routine.routineInvocationId;
    }
  }
  return { list, active, previous, children, byId, byPath,
    indexing: input.indexing, discoveryTruncated: input.discoveryTruncated, discoverySkipped: input.discoverySkipped };
}

export = {
  registeredSessionObservation, rpcSessionObservation, decodeLaunchParents, decodeRoutineAnnotations,
  withSessionContext, subsessionLabel, buildActiveSession, buildSourceSession, buildHistoricalSession, composeSessionCatalog,
};
