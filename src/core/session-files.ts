/**
 * Session JSONL readers. Files run to tens of MB, so each reader caches its
 * projection by file stamp. `getSessionInfo` returns a fresh shallow copy (callers
 * overlay live usage); other readers return cached arrays — treat as immutable.
 */
import fs from 'node:fs';
import { cacheRetentionRevision, loadCacheRetentionConfig } from './cache-retention.js';
import { cacheExpiryForMessage, hasCacheActivity, isHardCacheMiss, sessionInfoFromEntries } from './session-metadata.js';
import { record as isRecord } from './helper-values.js';
import { applyLearnedCacheExpiry } from './cache-lifetime.js';
import type { CacheExpiry, SessionEntries, SessionInfo } from './session-metadata.js';
import { COST_KEYS, TOKEN_KEYS } from './session-index-data.js';
import type { IndexedUsage, UsageBucket, UsageCosts, UsageTokens } from './session-index-data.js';
import { extractTextContent } from './helper-content.js';
import { createUsageCostEstimator, isPlanProvider, pricingRevision } from './harness-pricing.js';
import type { UsageCostEstimator } from './harness-pricing.js';

export interface SessionFileProfile {
  readonly profileId?: string;
  readonly profileVersion?: number;
  readonly harnessId?: string;
}
/** File read options, not an identity or lifecycle authority. SessionSource fits. */
export interface SessionFileSource extends SessionFileProfile { readonly file: string }
export interface SanitizedUsage extends Partial<UsageTokens> {
  totalTokens?: number;
  cost?: Readonly<Partial<UsageCosts>>;
  cacheWrite1h?: number;
}
export interface AssistantGenStats { readonly durationMs?: number; readonly outputTokens?: unknown }
/** Borrowed display projection: external payloads retain their original values. */
export interface SessionMessage extends AssistantGenStats {
  readonly id?: unknown;
  readonly role?: unknown;
  readonly content: unknown;
  readonly timestamp?: unknown;
  readonly model?: unknown;
  readonly provider?: unknown;
  readonly responseModel?: unknown;
  readonly usage?: Readonly<SanitizedUsage>;
  readonly cacheExpiry?: Readonly<CacheExpiry>;
  readonly errorMessage?: unknown;
  readonly stopReason?: unknown;
  readonly toolName?: unknown;
  readonly toolCallId?: unknown;
  readonly isError?: unknown;
  readonly customType?: unknown;
  readonly details?: unknown;
  readonly display?: unknown;
}
export interface SessionStats {
  readonly tokens: Readonly<Omit<UsageTokens, 'reasoning'>>;
  readonly reasoningTokens: number;
  readonly cost: number;
  readonly costs: Readonly<UsageCosts>;
  readonly costUnavailable: Readonly<UsageCosts>;
  readonly responseTiming: Readonly<{ measured: number; medianMs: number | null; slowestMs: number | null }>;
  readonly userMessages: number;
  readonly assistantMessages: number;
  readonly toolCalls: number;
  readonly toolResults: number;
  readonly compactions: number;
  readonly genMs: number;
  readonly genOutput: number;
  readonly hardCacheMisses: number;
}
/** Direct parser output retains malformed JSON tree ids; the index validates its leaf. */
export interface SessionSearchProjection { text: string; tree: boolean; leafId: unknown }
interface Cached<T> { stats: fs.Stats; value: T }
interface ActiveTree { ids: Set<unknown>; leafId: unknown }
interface MessageData {
  messages: SessionMessage[];
  byId: Map<unknown, SessionMessage>;
  /** Lazy lowercased per-message text, index-aligned with `messages` (see readSessionSearchText). */
  searchText?: string[];
}
interface ModelContinuity { provider: unknown; model: unknown }
const EMPTY_FIELDS: Readonly<Record<string, unknown>> = Object.freeze({});
/** Match JS property access on JSON values, including null throwing and boxing. */
function fields(value: unknown): Record<string, unknown> {
  if (value === null || value === undefined) throw new TypeError('Cannot read properties of null or undefined');
  return (typeof value === 'object' ? value : Object(value)) as Record<string, unknown>;
}
/** Date accepts coercible JSON values at runtime, beyond its TS overloads. */
function entryDate(value: unknown): Date {
  if (typeof value === 'string' || typeof value === 'number') return new Date(value);
  return Reflect.construct(Date, [value]) as Date;
}

// Malformed operands contribute 0. Finite operands may still overflow; that is
// preserved, and the index decoder rejects persisted nonfinite projections.
function tokenAmount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

// OMP bookkeeping entries that contribute neither transcript rows nor counters.
// `custom_message` is handled separately because visible notices use it too.
const TOLERATED_NON_MESSAGE_ENTRY_TYPES = new Set([
  'custom', 'session_init', 'reset_boundary', 'mode_change', 'ttsr_injection',
  'credential_pin', 'label', 'service_tier_change',
]);

function source(candidate: string | SessionFileSource): SessionFileSource {
  return typeof candidate === 'string' ? { file: candidate, profileId: 'pi-v3', profileVersion: 1, harnessId: 'pi' } : candidate;
}

function sameFile(left: fs.Stats, right: fs.Stats): boolean {
  return left.mtimeMs === right.mtimeMs && left.size === right.size &&
    left.ctimeMs === right.ctimeMs && left.dev === right.dev && left.ino === right.ino;
}

// One opportunistic raw parse shared by all readers and the corpus index. WeakRef
// avoids pinning a second large transcript; GC changes work, never freshness.
let parsedFile: { file: string; stats: fs.Stats; entries: WeakRef<SessionEntries>; endsNl: boolean } | undefined;
export function readSessionFileEntries(file: string, stats: fs.Stats = fs.statSync(file)): {
  entries: SessionEntries; endsNl: boolean;
} {
  if (parsedFile?.file === file && sameFile(parsedFile.stats, stats)) {
    const entries = parsedFile.entries.deref();
    if (entries) return { entries, endsNl: parsedFile.endsNl };
  }
  const content = fs.readFileSync(file, 'utf-8');
  const entries = parseSessionEntries(content);
  const endsNl = content.endsWith('\n');
  parsedFile = { file, stats, entries: new WeakRef(entries), endsNl };
  return { entries, endsNl };
}

/** File-stamp revalidating LRU shared by every reader. */
function statCached<T>(cache: Map<string, Cached<T>>, input: string | SessionFileSource, max: number, parse: (file: string, stats: fs.Stats, candidate: SessionFileSource) => T, extraKey = ''): T {
  const candidate = source(input);
  const filePath = candidate.file;
  const cacheKey = `${filePath}\0${candidate.profileId || 'pi-v3'}\0${candidate.profileVersion ?? 1}\0${pricingRevision(candidate.harnessId)}${extraKey ? '\0' + extraKey : ''}`;
  const stats = fs.statSync(filePath);
  const cached = cache.get(cacheKey);
  if (cached && sameFile(cached.stats, stats)) {
    cache.delete(cacheKey); cache.set(cacheKey, cached);
    return cached.value;
  }
  const value = parse(filePath, stats, candidate);
  cache.delete(cacheKey);
  if (cache.size >= max) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(cacheKey, { stats, value });
  return value;
}

const infoCache = new Map<string, Cached<SessionInfo>>();

export function getSessionInfo(filePath: string | SessionFileSource): SessionInfo {
  return { ...statCached(infoCache, filePath, 1000,
    (fp, stats, candidate) => sessionInfoFromEntries(readSessionFileEntries(fp, stats).entries, stats.mtime, candidate), `cache:${cacheRetentionRevision()}`) };
}

/**
 * Parent chain from the leaf (the *last* entry, as pi's SessionManager does on
 * reopen) to the root; off-chain entries are abandoned /tree branches. Null for
 * pre-tree files (no parentId), where every entry is active.
 */
function activeTree(entries: SessionEntries, leafOverride?: unknown): ActiveTree | null {
  const byId = new Map<unknown, Record<string, unknown>>();
  let leafId: unknown = null;
  for (const raw of entries) {
    const e = fields(raw);
    if (e.type === 'session' || !e.id) continue;
    if (e.parentId === undefined) return null; // pre-tree linear file
    byId.set(e.id, e);
    leafId = e.id;
  }
  if (leafOverride !== undefined) {
    if (leafOverride !== null && !byId.has(leafOverride)) {
      throw new Error(`Session tree leaf not found: ${leafOverride}`);
    }
    leafId = leafOverride;
  }
  if (leafId === null && leafOverride === null) return { ids: new Set(), leafId: null };
  if (!leafId) return null;
  const active = new Set<unknown>();
  let cur: unknown = leafId;
  while (cur != null && !active.has(cur)) {
    active.add(cur);
    cur = byId.get(cur)?.parentId; // missing parent (torn line) ends the walk
  }
  return { ids: active, leafId };
}

// Snapcompact compaction records can carry tens of MB of base64 preserveData no
// projection uses. OMP serializes it last, so parse the prefix; else full parse.
const LARGE_COMPACTION_RECORD = 64 * 1024;
function parseEntry(line: string): unknown {
  if (line.length >= LARGE_COMPACTION_RECORD && line.startsWith('{"type":"compaction",')) {
    const preserveAt = line.indexOf(',"preserveData":');
    if (preserveAt > 0 && line.endsWith('}}')) {
      try {
        const entry: unknown = JSON.parse(line.slice(0, preserveAt) + '}');
        if (isRecord(entry) && entry.type === 'compaction' && typeof entry.id === 'string' &&
            (entry.parentId === null || typeof entry.parentId === 'string')) return entry;
      } catch {}
    }
  }
  return JSON.parse(line);
}

export function parseSessionEntries(content: string): SessionEntries {
  const entries: unknown[] & { firstEntryOnFirstLine?: boolean } = [];
  const lines = content.split('\n');
  for (let i = 0; i < lines.length; i++) {
    try {
      entries.push(parseEntry(lines[i]));
      // Only physical line zero can be the header/title line.
      if (i === 0) entries.firstEntryOnFirstLine = true;
    } catch (e) {}
  }
  return entries;
}

/** Chronological model changes only; reuse one state per pass. */
function advanceModelChange(entry: Record<string, unknown>, state: ModelContinuity, profileId: string | undefined, policy: 'display' | 'usage'): void {
  if (policy === 'display') {
    if (profileId === 'omp-v1' && typeof entry.model === 'string') {
      const slash = entry.model.indexOf('/');
      if (slash > 0) { state.provider = entry.model.slice(0, slash); state.model = entry.model.slice(slash + 1); }
      else { state.provider = entry.provider || state.provider; state.model = entry.model; }
    } else { state.provider = entry.provider || state.provider; state.model = entry.modelId || state.model; }
    return;
  }
  // Billing continuity admits strings only; OMP's empty suffix keeps the previous
  // model, unlike the display fallback.
  if (profileId === 'omp-v1') {
    const ref = typeof entry.model === 'string' ? entry.model : '';
    const slash = ref.indexOf('/');
    if (slash > 0) {
      state.provider = ref.slice(0, slash);
      state.model = ref.slice(slash + 1) || state.model;
    } else if (ref) {
      if (typeof entry.provider === 'string' && entry.provider) state.provider = entry.provider;
      state.model = ref;
    }
  } else {
    if (typeof entry.provider === 'string' && entry.provider) state.provider = entry.provider;
    if (typeof entry.modelId === 'string' && entry.modelId) state.model = entry.modelId;
  }
}

type ServiceTierFamily = 'openai' | 'anthropic' | 'google';
type ServiceTierContinuity = Partial<Record<ServiceTierFamily, string>> | null;

/**
 * Per-family tier map written by OMP /fast (null clears). Families mirror OMP's
 * own provider resolution; unknown providers keep the flat estimate.
 */
function advanceServiceTierChange(entry: Record<string, unknown>, tiers: { value: ServiceTierContinuity }): void {
  if (entry.type !== 'service_tier_change') return;
  const raw = entry.serviceTier;
  if (!raw || typeof raw !== 'object') { tiers.value = null; return; }
  const next: Partial<Record<ServiceTierFamily, string>> = {};
  for (const family of ['openai', 'anthropic', 'google'] as const) {
    const tier = (raw as Record<string, unknown>)[family];
    if (typeof tier === 'string' && tier) next[family] = tier;
  }
  tiers.value = Object.keys(next).length ? next : null;
}

/** Fast tiers: priority/ultrafast. */
function providerUnderFastTier(provider: unknown, tiers: ServiceTierContinuity): boolean {
  if (!tiers) return false;
  if (provider === 'openai' || provider === 'openai-codex') {
    return tiers.openai === 'priority' || tiers.openai === 'ultrafast';
  }
  if (provider === 'anthropic') return tiers.anthropic === 'priority';
  if (provider === 'google' || provider === 'google-vertex') return tiers.google === 'priority';
  return false;
}

function messageFromEntry(entry: Record<string, unknown>, candidate: SessionFileProfile | undefined,
  estimateCost: UsageCostEstimator, fallbackModel: { provider?: unknown; model?: unknown } = {}, cacheExpiry?: CacheExpiry | null, tiers: ServiceTierContinuity = null): SessionMessage | null {
  if (entry.type === 'message' && entry.message) {
    const message = fields(entry.message);
    // Hidden custom messages are model state, not transcript UI.
    if (message.role === 'custom' && message.display === false) return null;
    const usage = sanitizeUsage(message.usage);
    if (usage) {
      const estimated = messageUsageCost(candidate, message, fallbackModel, estimateCost, tiers);
      if (estimated) usage.cost = estimated;
      else delete usage.cost;
    }
    return {
      // Anchors pi's HTML export deep links (?targetId=<id>).
      id: entry.id || undefined,
      role: message.role,
      content: message.content || [],
      timestamp: message.timestamp || entry.timestamp,
      model: message.model,
      provider: message.provider || undefined,
      responseModel: message.responseModel || undefined,
      ...(cacheExpiry ? { cacheExpiry } : {}),
      usage,
      errorMessage: message.errorMessage || undefined,
      stopReason: message.stopReason || undefined,
      toolName: message.toolName || undefined,
      toolCallId: message.toolCallId || undefined,
      isError: message.isError || undefined,
      customType: message.customType || undefined,
      details: message.details || undefined,
      display: typeof message.display === 'boolean' ? message.display : undefined,
      ...assistantGenStats(entry),
    };
  }
  if (entry.type === 'custom_message') {
    if (entry.customType === 'session-message') {
      return {
        id: entry.id || undefined,
        role: 'user',
        content: [{ type: 'text', text: entry.content }],
        timestamp: entry.timestamp,
      };
    }
    // Content is private reasoning; only type/details reach the client.
    if (entry.customType === 'interrupted-thinking') {
      return {
        id: entry.id || undefined,
        role: 'custom',
        customType: entry.customType,
        content: [],
        details: entry.details || undefined,
        display: false,
        timestamp: entry.timestamp,
      };
    }
    if (entry.display === false) return null;
    return {
      id: entry.id || undefined,
      role: 'custom',
      customType: entry.customType || 'custom-message',
      content: entry.content || [],
      details: entry.details || undefined,
      display: entry.display,
      timestamp: entry.timestamp,
    };
  }
  if (entry.type === 'branch_summary') {
    // Tree navigation injects this as context, so it is shown.
    return {
      id: entry.id || undefined,
      role: 'branchSummary',
      content: [{ type: 'text', text: entry.summary || '' }],
      timestamp: entry.timestamp,
    };
  }
  if (typeof entry.type === 'string' && TOLERATED_NON_MESSAGE_ENTRY_TYPES.has(entry.type)) return null;
  return null;
}

/**
 * The stream /messages paginates over (array index is stream index), active
 * tree path only.
 */
function parseMessageData(entries: SessionEntries, candidate?: SessionFileProfile, leafOverride?: unknown): MessageData {
  const cacheConfig = loadCacheRetentionConfig();
  const estimateCost = createUsageCostEstimator(candidate?.harnessId);
  const active = activeTree(entries, leafOverride)?.ids || null;
  const messages: SessionMessage[] = [];
  const byId = new Map<unknown, SessionMessage>();
  const model: ModelContinuity = { provider: null, model: null };
  let cacheExpiry: CacheExpiry | null = null;
  const tiers: { value: ServiceTierContinuity } = { value: null };
  for (const raw of entries) {
    try {
      const entry = fields(raw);
      if (entry.type === 'model_change') {
        advanceModelChange(entry, model, candidate?.profileId, 'display');
        cacheExpiry = null;
      }
      advanceServiceTierChange(entry, tiers);
      if (entry.type === 'compaction') cacheExpiry = null;
      let responseCacheExpiry: CacheExpiry | null = null;
      const rawMessage = entry.type === 'message' && entry.message ? fields(entry.message) : null;
      if (rawMessage?.role === 'assistant' && hasCacheActivity(rawMessage)) {
        const cacheMessage = {
          ...rawMessage,
          provider: rawMessage.provider ?? model.provider,
          model: rawMessage.model ?? model.model,
        };
        responseCacheExpiry = cacheExpiryForMessage(cacheMessage, cacheExpiry, entry.timestamp, cacheConfig);
        cacheExpiry = responseCacheExpiry;
      }
      const message = messageFromEntry(entry, candidate, estimateCost, model, applyLearnedCacheExpiry(responseCacheExpiry, cacheConfig), tiers.value);
      if (!message) continue;
      // Abandoned entries stay addressable so a rendered lazy image URL can't
      // change meaning after /tree navigation.
      if (entry.id) byId.set(entry.id, message);
      if (active && entry.id && !active.has(entry.id)) continue;
      messages.push(message);
    } catch (e) {}
  }
  return { messages, byId };
}

// API boundary: copy only documented counters and cost components.
export function sanitizeUsage(usage: unknown): SanitizedUsage | undefined {
  if (!usage || typeof usage !== 'object') return undefined;
  const raw = fields(usage);
  const out: SanitizedUsage = {};
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'cacheWrite1h', 'reasoning', 'totalTokens'] as const) {
    const value = raw[key];
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
  }
  if (raw.cost && typeof raw.cost === 'object') {
    const rawCost = fields(raw.cost);
    const cost: Partial<UsageCosts> = {};
    for (const key of COST_KEYS) {
      const value = rawCost[key];
      if (typeof value === 'number' && Number.isFinite(value)) cost[key] = value;
    }
    if (Object.keys(cost).length) out.cost = cost;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * message.timestamp is stamped at API call start, the entry's when appended.
 * Empty when either is missing or inverted.
 */
function assistantGenStats(entry: Record<string, unknown>): AssistantGenStats {
  const m = fields(entry.message);
  if (m.role !== 'assistant') return {};
  const start = m.timestamp;
  const end = entry.timestamp ? entryDate(entry.timestamp).getTime() : NaN;
  if (typeof start !== 'number' || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return {};
  return { durationMs: end - start, outputTokens: fields(m.usage ?? EMPTY_FIELDS).output || 0 };
}

const messagesCache = new Map<string, Cached<MessageData>>();

export function readSessionMessages(filePath: string | SessionFileSource): readonly SessionMessage[] {
  // Sized above the client's 5-session retention (lazy images, warm-restore).
  return statCached(messagesCache, filePath, 8,
    (fp, stats, candidate) => parseMessageData(readSessionFileEntries(fp, stats).entries, candidate),
    `cache:${cacheRetentionRevision()}`).messages;
}

// A live OMP session can move its leaf without a JSONL anchor, so the bridge
// decides the branch. Leaf is in the key: one open fires several page requests.
export function readSessionMessagesAtLeaf(filePath: string | SessionFileSource, leafId: unknown): readonly SessionMessage[] {
  return statCached(messagesCache, filePath, 8,
    (fp, stats, candidate) => parseMessageData(readSessionFileEntries(fp, stats).entries, candidate, leafId),
    `leaf:${leafId ?? ''}\0cache:${cacheRetentionRevision()}`).messages;
}

export function readSessionMessageById(filePath: string | SessionFileSource, entryId: unknown): SessionMessage | null {
  return statCached(messagesCache, filePath, 8,
    (fp, stats, candidate) => parseMessageData(readSessionFileEntries(fp, stats).entries, candidate),
    `cache:${cacheRetentionRevision()}`).byId.get(entryId) || null;
}

/**
 * Lowercased text index-aligned with readSessionMessages, memoized on the shared
 * cache entry so both come from one revalidation.
 */
export function readSessionSearchText(filePath: string | SessionFileSource): {
  readonly messages: readonly SessionMessage[]; readonly texts: readonly string[];
} {
  const data = statCached(messagesCache, filePath, 8,
    (fp, stats, candidate) => parseMessageData(readSessionFileEntries(fp, stats).entries, candidate),
    `cache:${cacheRetentionRevision()}`);
  if (!data.searchText) {
    data.searchText = data.messages.map(message => extractTextContent(message.content).toLowerCase());
  }
  return { messages: data.messages, texts: data.searchText };
}

/**
 * Prose cap only stops one giant paste eating the budget; tool results are
 * low-recall dumps. Session-cap overflow drops the *oldest* text.
 */
const SEARCH_TEXT_PROSE_CAP = 100_000;
const SEARCH_TEXT_TOOL_RESULT_CAP = 500;
const SEARCH_TEXT_TOOL_CALL_CAP = 300;
export const SEARCH_TEXT_SESSION_CAP = 4_000_000;

// High-recall args (paths, commands, URLs) go first so bulky args (oldText)
// can't crowd them out of the per-call cap.
const TOOL_ARG_PRIORITY = new Set([
  'path', 'file_path', 'filename', 'file', 'cwd', 'command', 'cmd',
  'url', 'pattern', 'query',
]);

function toolCallSearchText(block: Record<string, unknown>): string {
  const first: unknown[] = [block.name || ''];
  const rest: string[] = [];
  if (block.arguments && typeof block.arguments === 'object') {
    for (const [key, value] of Object.entries(block.arguments)) {
      if (typeof value !== 'string' || !value) continue;
      (TOOL_ARG_PRIORITY.has(key) ? first : rest).push(value);
    }
  }
  return first.concat(rest).join(' ').substring(0, SEARCH_TEXT_TOOL_CALL_CAP);
}

/** Persisted by the index for server-side list search. */
function searchTextFromEntries(entries: SessionEntries, active: Set<unknown> | null): string {
  const parts: string[] = [];
  let total = 0;
  let head = 0; // parts before head were evicted by the session cap
  const push = (part: string) => {
    if (!part) return;
    parts.push(part);
    total += part.length + 1;
    while (total > SEARCH_TEXT_SESSION_CAP && head < parts.length - 1) {
      total -= parts[head].length + 1;
      head++;
    }
  };
  for (const raw of entries) {
    try {
      const entry = fields(raw);
      if (active && entry.id && !active.has(entry.id)) continue;
      const message = entry.message ? fields(entry.message) : null;
      if (entry.type === 'message' && message &&
          !(message.role === 'custom' && message.display === false)) {
        const m = message;
        const cap = m.role === 'toolResult' ? SEARCH_TEXT_TOOL_RESULT_CAP : SEARCH_TEXT_PROSE_CAP;
        const text = extractTextContent(m.content);
        if (text) push(text.substring(0, cap));
        // Tool calls hold the best recall keys (paths, commands), which never
        // reach a text block.
        if (Array.isArray(m.content)) {
          for (const rawBlock of m.content) {
            const block = rawBlock ? fields(rawBlock) : null;
            if (block && block.type === 'toolCall') push(toolCallSearchText(block));
          }
        }
      }
      if (entry.type === 'custom_message' && entry.content &&
          (entry.customType === 'session-message' ||
           (entry.customType !== 'interrupted-thinking' && entry.display !== false))) {
        push(extractTextContent(entry.content).substring(0, SEARCH_TEXT_PROSE_CAP));
      }
      if (entry.type === 'branch_summary' && typeof entry.summary === 'string' && entry.summary) {
        push(entry.summary.substring(0, SEARCH_TEXT_PROSE_CAP));
      }
    } catch (e) {}
  }
  return (head ? parts.slice(head) : parts).join(' ').toLowerCase();
}

export function buildSearchTextFromContent(content: string): string {
  return buildSearchIndexFromEntries(parseSessionEntries(content)).text;
}

export function buildSearchIndexFromEntries(entries: SessionEntries): SessionSearchProjection {
  const tree = activeTree(entries);
  return {
    text: searchTextFromEntries(entries, tree?.ids || null),
    tree: !!tree,
    leafId: tree?.leafId || null,
  };
}

export function extendSearchIndexFromEntries(entries: SessionEntries, tree: boolean, leafId: string | null): SessionSearchProjection | null {
  let nextLeafId: unknown = leafId;
  if (tree) {
    for (const raw of entries) {
      const entry = fields(raw);
      if (entry.type === 'session' || !entry.id) continue;
      if (entry.parentId === undefined || entry.parentId !== nextLeafId) return null;
      nextLeafId = entry.id;
    }
  } else if (entries.some(raw => {
    const entry = fields(raw);
    return entry.type !== 'session' && entry.id && entry.parentId !== undefined;
  })) {
    // A linear index has no tree anchor: rebuild once on transition to tree format.
    return null;
  }
  return { text: searchTextFromEntries(entries, null), tree, leafId: nextLeafId };
}

const statsCache = new Map<string, Cached<SessionStats>>();

const emptyCosts = (): UsageCosts => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });

// Plan providers report zero costs meaning unpriced, not free. Explicit zeros
// from other providers stay authoritative.
function reportedCost(harnessId: string | undefined, provider: unknown, usage: unknown): Partial<UsageCosts> | undefined {
  const cost = fields(usage ?? EMPTY_FIELDS).cost;
  const rawCost = cost ? fields(cost) : null;
  if (isPlanProvider(harnessId, provider) &&
      rawCost && COST_KEYS.every(key => rawCost[key] === 0)) return undefined;
  if (!cost || typeof cost !== 'object') return undefined;
  const sanitized: Partial<UsageCosts> = {};
  for (const key of COST_KEYS) {
    const value = rawCost?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) sanitized[key] = value;
  }
  return Object.keys(sanitized).length ? sanitized : undefined;
}

function usageCost(candidate: SessionFileProfile | undefined, provider: unknown, model: unknown, usage: unknown, estimateCost: UsageCostEstimator, preferReported = false): Partial<UsageCosts> | undefined {
  const estimated = estimateCost(provider, model, usage);
  // Under a fast tier OMP scales its persisted cost by an account-specific
  // multiplier (never in `models --json`), so reported cost outranks the estimate.
  if (preferReported) return reportedCost(candidate?.harnessId, provider, usage) ?? estimated;
  return estimated || reportedCost(candidate?.harnessId, provider, usage);
}

/** Prices the raw selected/response identity without rewriting it. */
function messageUsageCost(candidate: SessionFileProfile | undefined, message: Record<string, unknown>, fallback: { provider?: unknown; model?: unknown }, estimateCost: UsageCostEstimator, tiers: ServiceTierContinuity = null): Partial<UsageCosts> | undefined {
  const provider = message.provider || fallback.provider;
  return usageCost(candidate, provider,
    message.responseModel || message.model || fallback.model, message.usage, estimateCost,
    providerUnderFastTier(provider, tiers));
}

function isEmptyFailedUsage(message: Record<string, unknown>): boolean {
  if (message?.stopReason !== 'error') return false;
  const usage = message.usage;
  const raw = usage ? fields(usage) : null;
  const cost = raw?.cost ? fields(raw.cost) : null;
  return !raw || (
    !['input', 'output', 'cacheRead', 'cacheWrite', 'reasoning', 'totalTokens'].some(key => Number(raw[key]) > 0) &&
    (!cost || COST_KEYS.every(key => !cost[key]))
  );
}

/**
 * A missing price increments a parallel count (partial-estimate marker) rather
 * than destroying the subtotal. Explicit zero stays authoritative.
 */
function addReportedCosts(bucket: UsageBucket, cost: Partial<UsageCosts> | undefined): void {
  bucket.costs ||= emptyCosts();
  bucket.costUnavailable ||= emptyCosts();
  for (const key of COST_KEYS) {
    const value = cost?.[key];
    if (typeof value === 'number' && Number.isFinite(value)) {
      const previous = bucket.costs[key];
      bucket.costs[key] = (typeof previous === 'number' && Number.isFinite(previous) ? previous : 0) + value;
    } else {
      bucket.costUnavailable[key] = Number(bucket.costUnavailable[key]) + 1;
    }
  }
}

function computeSessionStats(filePath: string, stats: fs.Stats, candidate: SessionFileProfile = {}): SessionStats {
  const estimateCost = createUsageCostEstimator(candidate.harnessId);
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  const costBucket = { costs: emptyCosts(), costUnavailable: emptyCosts() };
  let reasoningTokens = 0, hardCacheMisses = 0;
  let userMessages = 0, assistantMessages = 0, toolCalls = 0, toolResults = 0, compactions = 0;
  // Sums only measurable messages so speed is not diluted.
  let genMs = 0, genOutput = 0;
  const responseDurations: number[] = [];
  const model: ModelContinuity = { provider: null, model: null };
  const tiers: { value: ServiceTierContinuity } = { value: null };
  for (const raw of readSessionFileEntries(filePath, stats).entries) {
    const entry = fields(raw);
    if (entry.type === 'model_change') advanceModelChange(entry, model, candidate.profileId, 'display');
    advanceServiceTierChange(entry, tiers);
    if (entry.type === 'compaction') { compactions++; continue; }
    if (entry.type !== 'message' || !entry.message) continue;
    const m = fields(entry.message);
    if (m.role === 'user') userMessages++;
    else if (m.role === 'toolResult') toolResults++;
    else if (m.role === 'assistant') {
      assistantMessages++;
      if (Array.isArray(m.content)) toolCalls += m.content.filter(c => fields(c).type === 'toolCall').length;
      const u = m.usage ? fields(m.usage) : null;
      if (u) {
        tokens.input += tokenAmount(u.input);
        tokens.output += tokenAmount(u.output);
        tokens.cacheRead += tokenAmount(u.cacheRead);
        tokens.cacheWrite += tokenAmount(u.cacheWrite);
        reasoningTokens += tokenAmount(u.reasoning);
        if (isHardCacheMiss(u)) hardCacheMisses++;
      }
      addReportedCosts(costBucket, messageUsageCost(candidate, m, model, estimateCost, tiers.value));
      const gen = assistantGenStats(entry);
      if (gen.durationMs && gen.outputTokens) {
        genMs += gen.durationMs;
        genOutput += tokenAmount(gen.outputTokens);
      }
      if (gen.durationMs) responseDurations.push(gen.durationMs);
    }
  }
  responseDurations.sort((a, b) => a - b);
  const middle = Math.floor(responseDurations.length / 2);
  const responseTiming = {
    measured: responseDurations.length,
    medianMs: responseDurations.length ? (responseDurations.length % 2 ? responseDurations[middle] : (responseDurations[middle - 1] + responseDurations[middle]) / 2) : null,
    slowestMs: responseDurations.length ? responseDurations[responseDurations.length - 1] : null,
  };
  const { costs, costUnavailable } = costBucket;
  return { tokens, reasoningTokens, hardCacheMisses, cost: costs.total, costs, costUnavailable, responseTiming, userMessages, assistantMessages, toolCalls, toolResults, compactions, genMs, genOutput };
}

/** Derived during the same read as metadata/text. */
export function buildIndexedUsageFromContent(content: string, candidate: SessionFileProfile = {}): IndexedUsage {
  return buildIndexedUsageFromEntries(parseSessionEntries(content), candidate);
}

export function buildIndexedUsageFromEntries(entries: SessionEntries, candidate: SessionFileProfile = {},
  estimateCost: UsageCostEstimator = createUsageCostEstimator(candidate.harnessId)): IndexedUsage {
  const usage: IndexedUsage = {
    total: { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 }, costs: emptyCosts(), costUnavailable: emptyCosts(), calls: 0, measured: 0, durationMs: 0, slowestMs: 0 },
    days: {}, models: {}, cwd: null,
    // Persisted so appended ranges accumulate without re-reading earlier entries.
    state: { provider: null, model: 'unknown' },
  };
  return accumulateIndexedUsage(usage, entries, candidate, estimateCost);
}

/** O(delta) for append-only files; requires `state` and mutates `usage`. */
export function extendIndexedUsageFromEntries(usage: IndexedUsage, entries: SessionEntries, candidate: SessionFileProfile = {},
  estimateCost: UsageCostEstimator = createUsageCostEstimator(candidate.harnessId)): IndexedUsage {
  return accumulateIndexedUsage(usage, entries, candidate, estimateCost);
}

function accumulateIndexedUsage(usage: IndexedUsage, entries: SessionEntries, candidate: SessionFileProfile, estimateCost: UsageCostEstimator): IndexedUsage {
  const profileId = candidate.profileId || 'pi-v3';
  const { total, days, models } = usage;
  const model = { provider: usage.state?.provider ?? null, model: usage.state?.model ?? 'unknown' };
  const tiers: { value: ServiceTierContinuity } = { value: usage.state?.serviceTier ?? null };
  let cwd = usage.cwd ?? null;
  const add = (bucket: UsageBucket, u: Record<string, unknown> & { cost?: Partial<UsageCosts> }, duration: number) => {
    bucket.calls = (bucket.calls || 0) + 1;
    bucket.tokens ||= { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
    for (const k of TOKEN_KEYS) {
      if (Object.hasOwn(bucket.tokens, k)) bucket.tokens[k] = Number(bucket.tokens[k]) + tokenAmount(u[k]);
    }
    addReportedCosts(bucket, u?.cost);
    if (duration) { bucket.measured = (bucket.measured || 0) + 1; bucket.durationMs = (bucket.durationMs || 0) + duration; bucket.slowestMs = Math.max(bucket.slowestMs || 0, duration); }
  };
  for (const raw of entries) {
    const e = fields(raw);
    if (e.type === 'session' && typeof e.cwd === 'string' && e.cwd) cwd = e.cwd;
    if (e.type === 'model_change') advanceModelChange(e, model, profileId, 'usage');
    advanceServiceTierChange(e, tiers);
    const message = e.type === 'message' && fields(e.message ?? EMPTY_FIELDS);
    const m = message && message.role === 'assistant' ? message : null;
    if (!m) continue;
    // A retry's rejected attempt with no tokens and no cost is not usage.
    if (isEmptyFailedUsage(m)) continue;
    const p = (typeof m.provider === 'string' && m.provider) || model.provider || 'unknown';
    // Routed models (OpenRouter `auto`) bill under the concrete response model.
    const mid = (typeof m.responseModel === 'string' && m.responseModel)
      || (typeof m.model === 'string' && m.model) || model.model || 'unknown';
    const ref = `${p}/${mid}`;
    const ts = entryDate(e.timestamp || m.timestamp);
    const day = Number.isFinite(ts.getTime()) ? `${ts.getFullYear()}-${String(ts.getMonth() + 1).padStart(2, '0')}-${String(ts.getDate()).padStart(2, '0')}` : 'unknown';
    const duration = assistantGenStats(e).durationMs || 0;
    const u = { ...fields(m.usage ?? EMPTY_FIELDS), cost: usageCost(candidate, p, mid, m.usage, estimateCost, providerUnderFastTier(p, tiers.value)) };
    add(total, u, duration); add(days[day] ||= {}, u, duration);
    const modelBucket = models[ref] ||= { provider: p, model: mid, days: {} };
    add(modelBucket, u, duration); add(modelBucket.days[day] ||= {}, u, duration);
  }
  usage.cwd = cwd;
  usage.state = { provider: model.provider, model: model.model, ...(tiers.value ? { serviceTier: tiers.value } : {}) };
  return usage;
}

export function getSessionStats(filePath: string | SessionFileSource): Readonly<SessionStats> {
  return statCached(statsCache, filePath, 200, computeSessionStats);
}

/** Bounded header read; null when unreadable/absent. */
export function readSessionCwd(filePath: string | SessionFileSource): unknown {
  const candidate = source(filePath);
  filePath = candidate.file;
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(8192);
    const n = fs.readSync(fd, buf, 0, buf.length, 0);
    const lines = buf.toString('utf8', 0, n).split('\n');
    for (const line of lines) {
      const entry = fields(JSON.parse(line));
      if (entry.type === 'session') return entry.cwd || null;
      if (candidate.profileId !== 'omp-v1') break;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
  }
}

const tailCache = new Map<string, Cached<unknown>>();
const TAIL_BYTES = 64 * 1024;

/**
 * Bounded tail read: harnesses stamp a terminal entry on dispose. Null ("not
 * finished") when no complete line. Never grep the whole file for a marker: a
 * transcript may discuss it, and a revived session appends past its exit entry.
 */
export function readSessionTailEntry(input: string | SessionFileSource): unknown {
  return statCached(tailCache, input, 500, (filePath, stats) => {
    if (!stats.size) return null;
    let fd;
    try {
      fd = fs.openSync(filePath, 'r');
      const length = Math.min(TAIL_BYTES, stats.size);
      const buf = Buffer.alloc(length);
      const n = fs.readSync(fd, buf, 0, length, stats.size - length);
      const lines = buf.toString('utf8', 0, n).split('\n');
      while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
      const last = lines[lines.length - 1];
      return last && last.startsWith('{') ? JSON.parse(last) : null;
    } catch {
      return null;
    } finally {
      if (fd !== undefined) { try { fs.closeSync(fd); } catch {} }
    }
  });
}

/** Test hook: fixtures rewritten in place are re-read. */
export function resetCaches(): void {
  infoCache.clear();
  messagesCache.clear();
  statsCache.clear();
  tailCache.clear();
  parsedFile = undefined;
}

