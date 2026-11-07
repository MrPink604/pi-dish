// Generated from src/core/session-files.ts; edit that source and run npm run build:core.
/**
 * Session JSONL readers. Session files run to tens of MB, so each reader
 * caches its projection keyed by (mtimeMs, size, ctimeMs, device, inode) and
 * re-parses only changed files. `getSessionInfo` returns a fresh shallow copy
 * per call (callers overlay live usage); the other readers return cached
 * arrays — treat them as immutable.
 */
import fs from 'node:fs';
import type { CacheExpiry, SessionEntries, SessionInfo } from './session-metadata.js';
import type { IndexedUsage, UsageCosts, UsageTokens } from './session-index-data.js';
import type { UsageCostEstimator } from './harness-pricing.js';
export interface SessionFileProfile {
    readonly profileId?: string;
    readonly profileVersion?: number;
    readonly harnessId?: string;
}
/** File read options, not an identity or lifecycle authority. SessionSource fits. */
export interface SessionFileSource extends SessionFileProfile {
    readonly file: string;
}
export interface SanitizedUsage extends Partial<UsageTokens> {
    totalTokens?: number;
    cost?: Readonly<Partial<UsageCosts>>;
    cacheWrite1h?: number;
}
export interface AssistantGenStats {
    readonly durationMs?: number;
    readonly outputTokens?: unknown;
}
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
    readonly responseTiming: Readonly<{
        measured: number;
        medianMs: number | null;
        slowestMs: number | null;
    }>;
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
export interface SessionSearchProjection {
    text: string;
    tree: boolean;
    leafId: unknown;
}
export declare function readSessionFileEntries(file: string, stats?: fs.Stats): {
    entries: SessionEntries;
    endsNl: boolean;
};
export declare function getSessionInfo(filePath: string | SessionFileSource): SessionInfo;
export declare function parseSessionEntries(content: string): SessionEntries;
export declare function sanitizeUsage(usage: unknown): SanitizedUsage | undefined;
export declare function readSessionMessages(filePath: string | SessionFileSource): readonly SessionMessage[];
export declare function readSessionMessagesAtLeaf(filePath: string | SessionFileSource, leafId: unknown): readonly SessionMessage[];
export declare function readSessionMessageById(filePath: string | SessionFileSource, entryId: unknown): SessionMessage | null;
/**
 * Lowercased per-message text, index-aligned with readSessionMessages ('' for
 * a message with no text). Memoized on the shared message cache entry so a
 * repeated search over an unchanged file is a plain string scan, and both are
 * returned from one revalidation.
 */
export declare function readSessionSearchText(filePath: string | SessionFileSource): {
    readonly messages: readonly SessionMessage[];
    readonly texts: readonly string[];
};
export declare const SEARCH_TEXT_SESSION_CAP = 4000000;
export declare function buildSearchTextFromContent(content: string): string;
export declare function buildSearchIndexFromEntries(entries: SessionEntries): SessionSearchProjection;
export declare function extendSearchIndexFromEntries(entries: SessionEntries, tree: boolean, leafId: string | null): SessionSearchProjection | null;
/** Compact corpus-index usage, derived during the same read as metadata/text. */
export declare function buildIndexedUsageFromContent(content: string, candidate?: SessionFileProfile): IndexedUsage;
export declare function buildIndexedUsageFromEntries(entries: SessionEntries, candidate?: SessionFileProfile, estimateCost?: UsageCostEstimator): IndexedUsage;
/**
 * O(delta) usage extension for an append-only session file. Only valid for
 * usage objects that carry `state` (built by this schema); mutates and
 * returns `usage`.
 */
export declare function extendIndexedUsageFromEntries(usage: IndexedUsage, entries: SessionEntries, candidate?: SessionFileProfile, estimateCost?: UsageCostEstimator): IndexedUsage;
export declare function getSessionStats(filePath: string | SessionFileSource): Readonly<SessionStats>;
/** cwd from the session header line via a bounded read; null when unreadable/absent. */
export declare function readSessionCwd(filePath: string | SessionFileSource): unknown;
/**
 * The session JSONL's last complete entry via a bounded tail read: harnesses
 * stamp a terminal bookkeeping entry when they dispose a session.
 *
 * Null when the tail holds no complete line; callers treat "unknown" as "not
 * finished". Never grep the whole file for a marker: a transcript that merely
 * discusses one contains the string, and a revived session appends past its
 * own exit entry.
 */
export declare function readSessionTailEntry(input: string | SessionFileSource): unknown;
/** Test hook: drop caches so fixtures rewritten in place are re-read. */
export declare function resetCaches(): void;
