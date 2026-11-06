import { configuredCacheRetention, loadCacheRetentionConfig } from './cache-retention';
import type { CacheRetentionConfig } from './cache-retention';
import { extractTextContent } from './helper-content';
import { truncate } from './helper-format';
import { splitSessionRefContext } from './helper-refs';
import { record as isRecord } from './helper-values';

export type CacheExpiryBasis = 'fixed' | 'minimum' | 'estimate' | 'learned';
/** 'unknown' anchors cache activity with no documented, estimated or configured window; only the serve-time learner fills it in. */
export type StoredCacheExpiryBasis = CacheExpiryBasis | 'unknown';

export interface CacheExpiry {
  readonly refreshedAt: number;
  readonly expiresAt: number;
  readonly retentionMs: number;
  readonly retention: string;
  readonly basis: StoredCacheExpiryBasis;
  /** Cache identity of the message that set the window; retained for incremental parsing. */
  readonly identity: string;
  readonly tier?: '1h';
}

/** Accumulator output before read-time model-window overlays. No route authority. */
export interface SessionInfo {
  model: string;
  name: string | null;
  messageCount: number;
  contextTokens: number;
  lastActivity: Date;
  cwd: string | null;
  sessionId: string | null;
  parentSession: string | null;
  cacheExpiry: CacheExpiry | null;
}
/** The parser retains physical framing without a second JSON pass. */
export interface SessionEntries extends ReadonlyArray<unknown> {
  readonly firstEntryOnFirstLine?: boolean;
}

interface MetadataProfile { readonly profileId?: string }
function nonempty(value: unknown): value is string { return typeof value === 'string' && value.length > 0; }
function shortName(text: string) {
  return truncate(text, 40, '...');
}
function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function decodeCacheExpiry(value: unknown): CacheExpiry | null {
  if (!isRecord(value)) return null;
  const refreshedAt = finiteNumber(value.refreshedAt);
  const expiresAt = finiteNumber(value.expiresAt);
  const retentionMs = finiteNumber(value.retentionMs);
  const basis = value.basis;
  if (refreshedAt === null || expiresAt === null || retentionMs === null ||
      typeof value.retention !== 'string' || typeof value.identity !== 'string' ||
      !['fixed', 'minimum', 'estimate', 'learned', 'unknown'].includes(String(basis))) return null;
  return { refreshedAt, expiresAt, retentionMs, retention: value.retention,
    basis: basis as StoredCacheExpiryBasis, identity: value.identity,
    ...(value.tier === '1h' ? { tier: '1h' as const } : {}) };
}

export function cacheIdentity(message: Record<string, unknown>): string {
  return [message.api, message.provider, message.model].map(value => typeof value === 'string' ? value : '').join('\u0000');
}
export function cacheTokens(usage: Record<string, unknown>, key: 'cacheRead' | 'cacheWrite' | 'cacheWrite1h'): number {
  const value = finiteNumber(usage[key]);
  return value !== null && value > 0 ? value : 0;
}
export function hasCacheActivity(message: Record<string, unknown>): boolean {
  if (!isRecord(message.usage)) return false;
  return cacheTokens(message.usage, 'cacheRead') > 0 || cacheTokens(message.usage, 'cacheWrite') > 0;
}
export function isHardCacheMiss(usage: unknown): boolean {
  return isRecord(usage) && cacheTokens(usage, 'cacheRead') === 0 && cacheTokens(usage, 'cacheWrite') > 0;
}

export interface CacheTarget {
  readonly api: string;
  readonly provider: string;
  readonly model: string;
}

/** Normalize a message's cache ownership: explicit fields, model slug, then API. */
export function resolveCacheTarget(message: Record<string, unknown>): CacheTarget {
  const api = typeof message.api === 'string' ? message.api : '';
  let provider = typeof message.provider === 'string' ? message.provider.toLowerCase() : '';
  let model = typeof message.model === 'string' ? message.model : '';
  if (!provider) {
    const slash = model.indexOf('/');
    if (slash > 0) {
      provider = model.slice(0, slash).toLowerCase();
      model = model.slice(slash + 1);
    }
  }
  if (!provider) {
    if (api === 'anthropic-messages') provider = 'anthropic';
    else if (api === 'bedrock-converse-stream') provider = 'amazon-bedrock';
    else if (api.startsWith('openai-')) provider = 'openai';
  }
  return { api, provider, model };
}

/**
 * Anthropic's extended retention tier. Pi reports it as cacheWrite1h
 * dominating cacheWrite. OMP omits that split but still prices the write, and
 * Anthropic bills 1h-tier writes at 2× base input against 1.25× for the 5m
 * tier, so for Anthropic targets the priced write/input rate ratio decides
 * when the split is absent. Other providers' write premiums mean nothing here.
 */
export function cacheTier1h(usage: Record<string, unknown>, anthropic = false): boolean {
  const write = cacheTokens(usage, 'cacheWrite');
  if (write <= 0) return false;
  if (usage.cacheWrite1h !== undefined || !anthropic) return cacheTokens(usage, 'cacheWrite1h') >= write;
  const cost = isRecord(usage.cost) ? usage.cost : null;
  const input = finiteNumber(usage.input), writeCost = finiteNumber(cost?.cacheWrite), inputCost = finiteNumber(cost?.input);
  if (!input || input <= 0 || !writeCost || !inputCost || inputCost <= 0) return false;
  return (writeCost / write) / (inputCost / input) >= 1.6;
}

/**
 * Documented fixed/minimum windows and conservative provider estimates. This
 * ladder is the learner's Bayesian prior and the fallback when no learned
 * model has activated.
 */
export function builtinCacheRetention(target: CacheTarget, long1h: boolean): { retentionMs: number; retention: string; basis: CacheExpiryBasis } | null {
  const { api, provider, model } = target;
  if (provider === 'opencode-go' && /^deepseek-/i.test(model)) {
    return { retentionMs: 24 * 60 * 60_000, retention: '24h', basis: 'minimum' };
  }
  // Anthropic's published windows belong to Anthropic itself. Third parties
  // speaking its wire format (Kimi, GLM, …) run their own caches and were
  // observed warm after hours; the learner, not this ladder, answers for them.
  if (provider === 'anthropic') {
    return long1h
      ? { retentionMs: 60 * 60_000, retention: '1h', basis: 'fixed' }
      : { retentionMs: 5 * 60_000, retention: '5m', basis: 'fixed' };
  }
  if (api === 'bedrock-converse-stream' || provider === 'amazon-bedrock') {
    return { retentionMs: 5 * 60_000, retention: '5m', basis: 'estimate' };
  }
  if (api.startsWith('openai-') || provider === 'openai' || provider === 'openai-codex') {
    const version = /^gpt-(\d+)(?:\.(\d+))?/.exec(model);
    const explicit = !!version && (Number(version[1]) > 5 || (Number(version[1]) === 5 && Number(version[2] || 0) >= 6));
    return explicit
      ? { retentionMs: 30 * 60_000, retention: '30m', basis: 'minimum' }
      : { retentionMs: 10 * 60_000, retention: '~10m', basis: 'estimate' };
  }
  return null;
}

/**
 * Providers report cache token activity, not expiry timestamps. Derive only
 * documented fixed/minimum windows and conservative provider estimates.
 */
export function cacheExpiryForMessage(message: Record<string, unknown>, previous: CacheExpiry | null = null,
  fallbackTimestamp?: unknown, config: CacheRetentionConfig = loadCacheRetentionConfig()): CacheExpiry | null {
  if (!isRecord(message.usage) || !hasCacheActivity(message)) return null;
  const usage = message.usage;
  const identity = cacheIdentity(message);
  const target = resolveCacheTarget(message);
  const read = cacheTokens(usage, 'cacheRead');
  const long = cacheTier1h(usage, target.provider === 'anthropic');
  const startedAt = new Date((message.timestamp ?? fallbackTimestamp) as string | number | Date).getTime();
  if (!Number.isFinite(startedAt)) return null;

  let retentionMs: number | null = null;
  let retention = '';
  let basis: StoredCacheExpiryBasis = 'estimate';
  if (read > 0 && previous?.identity === identity) {
    ({ retentionMs, retention, basis } = previous);
  } else {
    const configured = configuredCacheRetention(config, target.provider, target.model);
    const derived = configured ?? builtinCacheRetention(target, long);
    // No known window: keep an 'unknown' anchor (refresh time + identity) so
    // a learned TTL can still project an expiry at serve time.
    ({ retentionMs, retention, basis } = derived ?? { retentionMs: 0, retention: '', basis: 'unknown' });
  }
  if (retentionMs === null) return null;
  return { refreshedAt: startedAt, expiresAt: startedAt + retentionMs, retentionMs, retention, basis, identity,
    ...(long ? { tier: '1h' as const } : {}) };
}


/** The model id a model_change entry records, in the profile's field. */
export function entryModel(entry: Record<string, unknown>, profileId: string | undefined): string | null {
  const model = profileId === 'omp-v1' ? entry.model : entry.modelId;
  return typeof model === 'string' && model ? model : null;
}

/** Validate persisted accumulator output, reviving its serialized activity Date. */
export function decodeSessionInfo(value: unknown): SessionInfo | null {
  if (!isRecord(value) || typeof value.model !== 'string' ||
      !['name', 'cwd', 'sessionId', 'parentSession'].every(key => value[key] === null || typeof value[key] === 'string') ||
      typeof value.messageCount !== 'number' || !Number.isFinite(value.messageCount) ||
      typeof value.contextTokens !== 'number' || !Number.isFinite(value.contextTokens)) return null;
  const raw = value.lastActivity;
  if (!(raw instanceof Date) && typeof raw !== 'string' && typeof raw !== 'number') return null;
  const lastActivity = new Date(raw);
  if (!Number.isFinite(lastActivity.getTime())) return null;
  return { model: value.model, name: value.name as string | null,
    cwd: value.cwd as string | null, sessionId: value.sessionId as string | null,
    parentSession: value.parentSession as string | null,
    messageCount: value.messageCount, contextTokens: value.contextTokens, lastActivity,
    cacheExpiry: decodeCacheExpiry(value.cacheExpiry) };
}

export function sessionInfoFromEntries(entries: SessionEntries, mtime?: Date, candidate: MetadataProfile = {},
  config: CacheRetentionConfig = loadCacheRetentionConfig()): SessionInfo {
  const info: SessionInfo = {
    model: 'unknown', name: null, messageCount: 0, contextTokens: 0,
    lastActivity: mtime || new Date(0), cwd: null, sessionId: null, parentSession: null,
    cacheExpiry: null,
  };
  return accumulateSessionInfo(info, entries, candidate, true, config);
}

/**
 * Extend an info object with entries appended after the range it was built
 * from (session-index's O(delta) path). Mutates and returns `info`; `mtime` is
 * the file's new mtime, which a full parse floors lastActivity at.
 */
export function extendSessionInfoFromEntries(info: SessionInfo, entries: SessionEntries, mtime?: Date, candidate: MetadataProfile = {},
  config: CacheRetentionConfig = loadCacheRetentionConfig()): SessionInfo {
  if (mtime && mtime.getTime() > new Date(info.lastActivity).getTime()) info.lastActivity = mtime;
  return accumulateSessionInfo(info, entries, candidate, false, config);
}

function accumulateSessionInfo(info: SessionInfo, entries: SessionEntries, candidate: MetadataProfile, fromStart: boolean,
  config: CacheRetentionConfig): SessionInfo {
  const profileId = candidate.profileId || 'pi-v3';
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (!isRecord(entry)) continue;
    const message = isRecord(entry.message) ? entry.message : null;
    // Only an entry parsed from physical line zero can be the header; a later
    // session-shaped entry must not be promoted to one.
    const isFirst = fromStart && i === 0 && entries.firstEntryOnFirstLine === true;
    if (profileId === 'omp-v1' && isFirst && entry.type === 'title' && nonempty(entry.title)) info.name = entry.title;
    if (entry.type === 'session') {
      if (nonempty(entry.cwd)) info.cwd = entry.cwd;
      // Native identity and lineage belong to Pi's first-line SessionHeader.
      // Later session-shaped custom entries must not rewrite provenance.
      if (isFirst || (profileId === 'omp-v1' && info.sessionId === null)) {
        if (typeof entry.id === 'string' && entry.id) info.sessionId = entry.id;
        if (typeof entry.parentSession === 'string' && entry.parentSession) info.parentSession = entry.parentSession;
      }
    }
    if (entry.type === 'model_change') {
      const model = entryModel(entry, profileId);
      if (model) info.model = model;
      info.cacheExpiry = null;
    }
    // Explicit names win; the first user message is only a fallback.
    if (entry.type === 'session_info' && nonempty(entry.name)) info.name = entry.name;
    if (nonempty(entry.sessionName)) info.name = entry.sessionName;
    if (entry.type === 'message' && message?.role === 'user') {
      info.messageCount++;
      if (info.name === null) {
        // The <session-refs> block is appended context, not user text, so it
        // must never become the session name.
        const { text } = splitSessionRefContext(extractTextContent(message.content));
        if (text) info.name = shortName(text);
      }
    }
    if (info.name === null && entry.type === 'custom_message' &&
        entry.customType === 'session-message' && nonempty(entry.content)) {
      info.name = shortName(entry.content);
    }
    if (typeof entry.timestamp === 'string' || typeof entry.timestamp === 'number') {
      const ts = new Date(entry.timestamp).getTime();
      if (Number.isFinite(ts) && ts > new Date(info.lastActivity).getTime()) info.lastActivity = new Date(ts);
    }
    if (entry.type === 'message' && message?.role === 'assistant' && isRecord(message.usage)) {
      const tokens = message.usage.totalTokens;
      info.contextTokens = typeof tokens === 'number' && Number.isFinite(tokens) ? tokens : 0;
      if (hasCacheActivity(message)) {
        info.cacheExpiry = cacheExpiryForMessage(
          message.model === undefined ? { ...message, model: info.model } : message,
          info.cacheExpiry, entry.timestamp, config);
      }
    }
    if (entry.type === 'compaction') {
      info.contextTokens = 0;
      info.cacheExpiry = null;
    }
  }
  return info;
}
