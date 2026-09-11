/** Browser-facing API values. Unknown extension fields stay opaque. */
export interface SessionMetadata extends Record<string, unknown> {
  id: string;
  name?: string | null;
  model?: string | null;
  harnessId?: string;
  thinkingLevel?: string | null;
  isActive?: boolean;
  capabilities?: Partial<Record<string, boolean>>;
}
export interface SessionList extends Record<string, unknown> {
  active: SessionMetadata[];
  previous: SessionMetadata[];
  children?: SessionMetadata[];
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

export function decodeSessionMetadata(value: unknown): SessionMetadata {
  if (!record(value) || !text(value.id)) return invalid('session');
  for (const key of ['name', 'model', 'thinkingLevel']) {
    if (value[key] !== undefined && value[key] !== null && typeof value[key] !== 'string') return invalid('session');
  }
  if (value.harnessId !== undefined && !text(value.harnessId)) return invalid('session');
  if (value.isActive !== undefined && typeof value.isActive !== 'boolean') return invalid('session');
  let capabilities: Record<string, boolean> | undefined;
  if (value.capabilities !== undefined) {
    if (!record(value.capabilities)) return invalid('session capabilities');
    capabilities = {};
    for (const [key, enabled] of Object.entries(value.capabilities)) {
      if (typeof enabled !== 'boolean') return invalid('session capabilities');
      Object.defineProperty(capabilities, key, { value: enabled, enumerable: true, configurable: true, writable: true });
    }
  }
  // The checks establish every named property; extras are deliberately unknown.
  return { ...value, ...(capabilities ? { capabilities } : {}) } as SessionMetadata;
}

export function decodeSessionList(value: unknown): SessionList {
  if (!record(value) || !Array.isArray(value.active) || !Array.isArray(value.previous)
      || (value.children !== undefined && !Array.isArray(value.children))) return invalid('session list');
  return { ...value, active: value.active.map(decodeSessionMetadata), previous: value.previous.map(decodeSessionMetadata),
    ...(Array.isArray(value.children) ? { children: value.children.map(decodeSessionMetadata) } : {}) };
}

/** Preserve the existing client projection; full API rows retain provenance. */
export function sessionForClient(session: Record<string, unknown>): SessionMetadata {
  const { sessionKey, nativeSessionId, profileId, profileVersion, sessionFile,
    parentSession, parentSessionSource, pid, ...client } = session;
  return decodeSessionMetadata(client);
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
