/** Closed first-party metadata. Identity and opaque extras are separate owners. */
export interface SessionFields<Timestamp = string | number> {
  name?: string | null;
  model?: string | null;
  harnessId?: string;
  harnessLabel?: string;
  thinkingLevel?: string | null;
  isActive?: boolean;
  capabilities?: Partial<Record<string, boolean>>;
  closeMode?: string;
  conflicted?: boolean;
  liveInstanceCount?: number;
  contextPercent?: number;
  contextTokens?: number;
  contextWindow?: number;
  messageCount?: number;
  lastActivity?: Timestamp | null;
  turnInProgress?: boolean;
  compacting?: boolean;
  cwd?: string | null;
  subagentLive?: boolean;
  parentId?: string | null;
  parentSource?: string | null;
  familyParentId?: string | null;
  routine?: string;
  routineId?: string;
  routineInvocationId?: string;
  searchSnippet?: string;
  searchScore?: number;
}
/** Legacy wire helper compatibility; authoritative browser state uses SessionRow. */
export interface SessionMetadata extends Record<string, unknown>,
  Pick<SessionFields, 'name' | 'model' | 'harnessId' | 'thinkingLevel' | 'isActive' | 'capabilities'> {
  id: string;
}
/** A decoded row, before the answering endpoint stamps browser host identity. */
export interface SessionRow {
  readonly id: string;
  readonly fields: Readonly<SessionFields>;
  readonly extras: Readonly<Record<string, unknown>>;
}
export type SessionMutationPatch = Pick<SessionFields, 'name' | 'model' | 'thinkingLevel'>;
export type SessionActivityPatch = Pick<SessionFields, 'turnInProgress' | 'compacting'>;
export type SessionTranscriptPatch = Pick<SessionFields,
  'name' | 'model' | 'cwd' | 'messageCount' | 'contextTokens' | 'contextWindow' | 'contextPercent' | 'lastActivity' | 'isActive'>;
export interface SessionList {
  active: SessionRow[];
  previous: SessionRow[];
  children?: SessionRow[];
  indexing?: boolean;
  discoveryTruncated?: boolean;
  discoverySkipped?: number;
}
export interface ModelPricing {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}
export interface CatalogModel extends Record<string, unknown> {
  id: string;
  provider: string;
  name: string;
  selector?: string | null;
  contextWindow: number;
  reasoning: boolean;
  thinking?: string[] | null;
  pricing: ModelPricing | null;
  free: boolean;
  enabled?: boolean;
}
export interface ModelChangeRequest { modelId: string }
export interface ThinkingChangeRequest { level: string }
export interface EnabledModelsRequest { enabledIds: string[] | null }
export interface MutationResult extends Record<string, unknown> { success: true }
export interface ThinkingResult extends MutationResult { level: string }
export interface EnabledModelsResult extends MutationResult { enabledModels: string[] | null }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function text(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value); }
function invalid(kind: string): never { throw new Error(`Invalid ${kind} response`); }

type FieldDecoders = { [K in keyof Required<SessionFields>]: (value: unknown) => SessionFields[K] };
const optionalString = (value: unknown) => typeof value === 'string' ? value : undefined;
const nullableString = (value: unknown) => value === null ? null : optionalString(value);
const optionalNumber = (value: unknown) => finite(value) ? value : undefined;
const optionalBoolean = (value: unknown) => typeof value === 'boolean' ? value : undefined;
const fieldDecoders: FieldDecoders = {
  name: nullableString, model: nullableString, thinkingLevel: nullableString,
  harnessId: optionalString, harnessLabel: optionalString, capabilities: decodeCapabilities,
  isActive: optionalBoolean, closeMode: optionalString, conflicted: optionalBoolean,
  liveInstanceCount: optionalNumber, contextPercent: optionalNumber, contextTokens: optionalNumber,
  contextWindow: optionalNumber, messageCount: optionalNumber,
  lastActivity: value => value === null || typeof value === 'string' || finite(value) ? value : undefined,
  turnInProgress: optionalBoolean, compacting: optionalBoolean, cwd: nullableString,
  subagentLive: optionalBoolean, parentId: nullableString, parentSource: nullableString,
  familyParentId: nullableString, routine: optionalString, routineId: optionalString,
  routineInvocationId: optionalString, searchSnippet: optionalString, searchScore: optionalNumber,
};
function decodeCapabilities(value: unknown): SessionFields['capabilities'] {
  if (value === undefined) return undefined;
  if (!record(value)) return invalid('session capabilities');
  const capabilities: Record<string, boolean> = {};
  for (const [key, enabled] of Object.entries(value)) {
    if (typeof enabled !== 'boolean') return invalid('session capabilities');
    Object.defineProperty(capabilities, key, { value: enabled, enumerable: true, configurable: true, writable: true });
  }
  return capabilities;
}
function decodeFields(value: Record<string, unknown>): SessionFields {
  const fields: SessionFields = {};
  for (const key of Object.keys(fieldDecoders) as (keyof SessionFields)[]) {
    if (!Object.hasOwn(value, key)) continue;
    const decoded = fieldDecoders[key](value[key]);
    if (decoded !== undefined) Object.defineProperty(fields, key, { value: decoded, enumerable: true, configurable: true, writable: true });
  }
  return fields;
}
/**
 * Browser ingress. Keep the established fatal control checks; malformed
 * newly named presentation fields are omitted, never smuggled into extras.
 * This accepts serialized wire timestamps. Server Date projection stays separate.
 */
export function decodeSessionRow(value: unknown): SessionRow {
  if (!record(value) || !Object.hasOwn(value, 'id')) return invalid('session');
  validateSessionControls(value);
  const wire = value;
  const extras: Record<string, unknown> = {};
  for (const [key, extra] of Object.entries(wire)) {
    if (key === 'id' || key === 'host' || key === 'hostLabel' || Object.hasOwn(fieldDecoders, key)) continue;
    Object.defineProperty(extras, key, { value: extra, enumerable: true, configurable: true, writable: true });
  }
  return { id: wire.id, fields: decodeFields(wire), extras };
}
function decodePatch<K extends keyof SessionFields>(value: unknown, keys: readonly K[]): Pick<SessionFields, K> {
  if (!record(value)) return invalid('session patch');
  // Every selected property is optional; values enter only through its decoder.
  const patch = {} as Pick<SessionFields, K>;
  for (const key of keys) {
    if (!Object.hasOwn(value, key) || value[key] === undefined) continue;
    const decoded = fieldDecoders[key](value[key]);
    if (decoded === undefined) return invalid('session patch');
    Object.defineProperty(patch, key, { value: decoded, enumerable: true, configurable: true, writable: true });
  }
  return patch;
}
export function decodeSessionMutationPatch(value: unknown): SessionMutationPatch {
  return decodePatch(value, ['name', 'model', 'thinkingLevel']);
}
export function decodeSessionActivityPatch(value: unknown): SessionActivityPatch {
  return decodePatch(value, ['turnInProgress', 'compacting']);
}
export function decodeSessionTranscriptPatch(value: unknown): SessionTranscriptPatch {
  return decodePatch(value, ['name', 'model', 'cwd', 'messageCount', 'contextTokens', 'contextWindow', 'contextPercent', 'lastActivity', 'isActive']);
}

function validateSessionControls(value: unknown): asserts value is Record<string, unknown> & { id: string } {
  if (!record(value) || !text(value.id)) return invalid('session');
  for (const key of ['name', 'model', 'thinkingLevel']) {
    if (value[key] !== undefined && value[key] !== null && typeof value[key] !== 'string') return invalid('session');
  }
  if (value.harnessId !== undefined && !text(value.harnessId)) return invalid('session');
  if (value.isActive !== undefined && typeof value.isActive !== 'boolean') return invalid('session');
}

export function decodeSessionMetadata(value: unknown): SessionMetadata {
  validateSessionControls(value);
  const capabilities = decodeCapabilities(value.capabilities);
  // The checks establish every named property; extras are deliberately unknown.
  return { ...value, ...(capabilities ? { capabilities } : {}) } as SessionMetadata;
}

export function decodeSessionList(value: unknown): SessionList {
  if (!record(value) || !Array.isArray(value.active) || !Array.isArray(value.previous)
      || (value.children !== undefined && !Array.isArray(value.children))) return invalid('session list');
  return { active: value.active.map(decodeSessionRow), previous: value.previous.map(decodeSessionRow),
    ...(Array.isArray(value.children) ? { children: value.children.map(decodeSessionRow) } : {}),
    ...(typeof value.indexing === 'boolean' ? { indexing: value.indexing } : {}),
    ...(typeof value.discoveryTruncated === 'boolean' ? { discoveryTruncated: value.discoveryTruncated } : {}),
    ...(finite(value.discoverySkipped) ? { discoverySkipped: value.discoverySkipped } : {}) };
}

/** Preserve the existing client projection; full API rows retain provenance. */
type ClientPrivateField = 'sessionKey' | 'nativeSessionId' | 'profileId' | 'profileVersion'
  | 'sessionFile' | 'parentSession' | 'parentSessionSource' | 'pid';
export function sessionForClient<T extends SessionFields<Date | string | number> & { id: string }>(session: T): Omit<T, ClientPrivateField> {
  // Catalog rows have already established named metadata. This is only a wire
  // projection: preserve Date values until JSON serialization and opaque extras.
  const { sessionKey, nativeSessionId, profileId, profileVersion, sessionFile,
    parentSession, parentSessionSource, pid, ...client } = session as T & Partial<Record<ClientPrivateField, unknown>>;
  return client;
}

function pricing(value: unknown): ModelPricing | null {
  if (!record(value) || !finite(value.input) || !finite(value.output)) return null;
  return { input: value.input, output: value.output,
    ...(finite(value.cacheRead) ? { cacheRead: value.cacheRead } : {}),
    ...(finite(value.cacheWrite) ? { cacheWrite: value.cacheWrite } : {}) };
}
const THINKING_LEVELS = new Set(['minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

/** Harness model discovery accepts native refs/records, then projects API rows. */
export function normalizeModels(value: unknown): CatalogModel[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item: unknown): CatalogModel[] => {
    if (typeof item === 'string') {
      const slash = item.indexOf('/');
      if (slash <= 0 || slash === item.length - 1) return [];
      const provider = item.slice(0, slash), id = item.slice(slash + 1);
      return [{ id, provider, name: id, selector: item, contextWindow: 0,
        reasoning: false, thinking: null, pricing: null, free: false }];
    }
    if (!record(item)) return [];
    const id = item.id || item.modelId;
    if (!text(id) || !text(item.provider)) return [];
    const cost = pricing(item.pricing || item.cost);
    return [{ id, provider: item.provider, name: text(item.name) ? item.name : id,
      selector: text(item.selector) ? item.selector : `${item.provider}/${id}`,
      contextWindow: finite(item.contextWindow) ? item.contextWindow : 0,
      reasoning: !!item.reasoning,
      thinking: Array.isArray(item.thinking) ? item.thinking.filter((level): level is string =>
        typeof level === 'string' && THINKING_LEVELS.has(level)) : null,
      pricing: cost, free: !!cost && cost.input === 0 && cost.output === 0 }];
  });
}

/** Decode API/catalog-cache rows, preserving extra metadata and optional legacy fields. */
export function decodeModelCatalog(value: unknown): CatalogModel[] {
  if (!Array.isArray(value)) return invalid('model catalog');
  return value.map((item: unknown) => {
    if (!record(item) || !text(item.id) || !text(item.provider)) return invalid('model catalog');
    if (item.enabled !== undefined && typeof item.enabled !== 'boolean') return invalid('model catalog');
    if (item.selector !== undefined && item.selector !== null && typeof item.selector !== 'string') return invalid('model catalog');
    const model = normalizeModels([item])[0]!;
    return { ...item, ...model, ...(item.enabled === undefined ? {} : { enabled: item.enabled }) };
  });
}

export function decodeMutationResult(value: unknown): MutationResult {
  if (!record(value) || value.success !== true) return invalid('mutation');
  return { ...value, success: true };
}
export function decodeThinkingResult(value: unknown): ThinkingResult {
  const result = decodeMutationResult(value);
  if (!text(result.level)) return invalid('thinking');
  return { ...result, level: result.level };
}
export function decodeEnabledModelsResult(value: unknown): EnabledModelsResult {
  const result = decodeMutationResult(value);
  if (result.enabledModels !== null && (!Array.isArray(result.enabledModels) || !result.enabledModels.every(text))) return invalid('enabled models');
  return { ...result, enabledModels: result.enabledModels === null ? null : [...result.enabledModels] as string[] };
}

/** A harness can acknowledge the mutation without reporting a usable level. */
export function thinkingResult(value: unknown, requested: string): ThinkingResult {
  return { success: true, level: record(value) && text(value.level) ? value.level : requested };
}
