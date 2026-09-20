// Generated from src/core/session-files.ts; edit that source and run npm run build:core.
import type { CacheExpiry, SessionEntries, SessionInfo } from './session-metadata-contracts.js';
import type { IndexedUsage, UsageCosts, UsageTokens } from './session-index-data.js';
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
export declare function parseSessionContent(content: string, mtime?: Date, candidate?: SessionFileProfile): SessionInfo;
export declare function getSessionInfo(filePath: string | SessionFileSource): SessionInfo;
export declare function parseSessionEntries(content: string): SessionEntries;
export declare function sanitizeUsage(usage: unknown): SanitizedUsage | undefined;
export declare function readSessionMessages(filePath: string | SessionFileSource): readonly SessionMessage[];
export declare function readSessionMessagesAtLeaf(filePath: string | SessionFileSource, leafId: unknown): readonly SessionMessage[];
export declare function readSessionMessageById(filePath: string | SessionFileSource, entryId: unknown): SessionMessage | null;
export declare const SEARCH_TEXT_SESSION_CAP = 4000000;
/** Search text plus enough tree state to validate a future append cheaply. */
export declare function buildSearchIndexFromContent(content: string): SessionSearchProjection;
export declare function buildSearchIndexFromEntries(entries: SessionEntries): SessionSearchProjection;
/**
 * Extend a search index from an appended byte range. A normal live turn is a
 * chain starting at the prior leaf and remains byte-range-only. A /tree jump
 * starts at an older parent; return null so the caller rebuilds the active
 * branch once and discards abandoned text.
 */
export declare function extendSearchIndexFromContent(content: string, tree: boolean, leafId: string | null): SessionSearchProjection | null;
export declare function extendSearchIndexFromEntries(entries: SessionEntries, tree: boolean, leafId: string | null): SessionSearchProjection | null;
export declare function buildSearchTextFromContent(content: string): string;
/** Compact corpus-index usage, derived during the same read as metadata/text. */
export declare function buildIndexedUsageFromContent(content: string, candidate?: SessionFileProfile): IndexedUsage;
export declare function buildIndexedUsageFromEntries(entries: SessionEntries, candidate?: SessionFileProfile): IndexedUsage;
/**
 * O(delta) usage extension for an append-only session file. Only valid for
 * usage objects that carry `state` (built by this schema); mutates and
 * returns `usage`.
 */
export declare function extendIndexedUsageFromEntries(usage: IndexedUsage, entries: SessionEntries, candidate?: SessionFileProfile): IndexedUsage;
export declare function getSessionStats(filePath: string | SessionFileSource): Readonly<SessionStats>;
/**
 * cwd from a session file's first line (the session header entry) via a
 * bounded read — session files run to tens of MB and this is hit for every
 * directory by /api/cwds. Returns null when unreadable/absent.
 */
export declare function readSessionCwd(filePath: string | SessionFileSource): unknown;
/**
 * The session JSONL's last complete entry via a bounded tail read — the
 * caller only needs the terminal bookkeeping entry (harnesses stamp one when
 * they dispose a session), and these files run to tens of MB.
 *
 * Returns null when the tail holds no parseable whole line: a final entry
 * larger than the window (a huge tool result) is exactly the shape of a
 * session still being written, and callers treat "unknown" as "not
 * finished" rather than re-reading the file. Never grep the whole file for a
 * marker instead — a transcript that merely discusses one contains the
 * string, and a revived session appends past its own exit entry.
 */
export declare function readSessionTailEntry(input: string | SessionFileSource): unknown;
/** Fallback cwd from pi's session dir naming (--home-user-proj-- → /home/user/proj). */
export declare function decodeDirToCwd(dirName: string): string;
/** Test hook: drop caches so fixtures rewritten in place are re-read. */
export declare function resetCaches(): void;
