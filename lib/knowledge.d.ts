// Generated from src/core/knowledge.ts; edit that source and run npm run build:core.
export declare const KNOWLEDGE_SETTING = "knowledgeRemote";
export declare const ENTRY_MAX_BYTES: number;
export declare const PAGE_WARN_BYTES: number;
export declare const PAGE_MAX_BYTES: number;
export declare const SUMMARY_MAX_CHARS = 160;
export declare const SOURCE_MAX_CHARS = 500;
export declare const TITLE_MAX_CHARS = 120;
export type KnowledgeScope = 'shared' | 'bot';
/** A request the knowledge base refuses; `status` is the HTTP answer. */
export declare class KnowledgeError extends Error {
    readonly status: number;
    constructor(message: string, status: number);
}
export interface KnowledgeHit {
    path: string;
    scope: KnowledgeScope;
    botId?: string;
    botName?: string;
    lines: {
        line: number;
        text: string;
    }[];
}
export interface KnowledgeSearch {
    results: KnowledgeHit[];
    /** Pages that matched; more than `results` holds when the cap cut the list. */
    total: number;
}
export interface KnowledgeReadResult {
    path: string;
    scope: KnowledgeScope;
    botId?: string;
    botName?: string;
    text: string;
    /** 12-char Git blob SHA-1 of the file on disk; null only when reading an uncreated empty index. */
    revision: string | null;
}
export interface KnowledgeReadOptions {
    scope?: KnowledgeScope;
    /** Calling or spawning bot id, used for `scope: 'bot'`, `bot:<slug>`, and fallback reads. */
    botId?: string;
    /** Explicit target bot id when reading a specific bot's KB (e.g. an ancestor's). */
    targetBotId?: string;
    /** Allowed bot ids this caller may read; when provided, any other bot id is refused with 403. */
    readableBotIds?: readonly string[];
    /** Optional display names for bot ids (e.g. from the bot registry). */
    botNames?: Readonly<Record<string, string>>;
    /** When reading a named page with shared default scope, fall back to `botId`'s KB on miss. */
    fallbackToBot?: boolean;
}
export interface KnowledgeSearchOptions {
    scope?: 'all' | KnowledgeScope;
    /** Readable bot ids to include when scope is `'all'` or `'bot'`. */
    botIds?: readonly string[];
    /** Optional display names for bot ids (e.g. from the bot registry). */
    botNames?: Readonly<Record<string, string>>;
}
export interface KnowledgeWrite {
    /** The page's slug, such as `beelink`; `topics/beelink.md` and `beelink.md` name it too. */
    page: string;
    /** Required: `'bot'` for the bot's own KB, `'shared'` for the shared KB. */
    scope: KnowledgeScope;
    /** Target bot id; required when `scope === 'bot'`. */
    botId?: string;
    /** Calling bot id for scope-isolation enforcement; must equal `botId` when writing a bot KB. */
    callerBotId?: string;
    /** Bot display name for `bots/<bot-id>/index.md`'s header. */
    botName?: string;
    /** `append` adds one entry; `replace` writes the whole page, for tidying it. */
    mode: 'append' | 'replace';
    text: string;
    /** Where the fact comes from (at most 500 chars); required for an entry. */
    source?: string;
    /** Page title in index.md (at most 120 chars); omitted: existing title, or slug words when new. */
    title?: string;
    /** One-line topic scope for index.md (at most 160 chars). Required when creating a new page; optional later. */
    summary?: string;
    /** Required when `mode === 'replace'` on an existing page; must be omitted when creating a new page. */
    revision?: string;
    /** Normalized source substrings intentionally removed or merged during `mode === 'replace'`; recorded in commit body. */
    droppedSources?: string[];
    /** Who wrote it: stamped on an entry and named in the commit. */
    author: string;
}
export interface KnowledgeWriteResult {
    path: string;
    scope: KnowledgeScope;
    botId?: string;
    created: boolean;
    revision: string;
    pageBytes: number;
    /** The new commit, or null when the page was unchanged. */
    commit: string | null;
    pushed: boolean;
    pushError?: string;
    warning?: string;
}
export interface KnowledgeBase {
    readonly remote: string;
    readonly dir: string;
    search(query: string, options?: KnowledgeSearchOptions): Promise<KnowledgeSearch>;
    /** A page, or the index when none is named. */
    read(page?: string, options?: KnowledgeReadOptions): Promise<KnowledgeReadResult>;
    write(entry: KnowledgeWrite): Promise<KnowledgeWriteResult>;
}
/** The repository path a page name means within a scope; `index.md` for an empty name. */
export declare function knowledgePagePath(page: string | undefined): string;
/** 12-character Git blob SHA-1 prefix of the file's exact UTF-8 bytes. */
export declare function pageRevision(content: Buffer | string): string;
/**
 * Extracts normalized source strings from balanced `(Source: …)` citations on
 * each line, preserving duplicates as a multiset. Nested parentheses inside the
 * source (e.g. `(Opus)`) are kept intact.
 */
export declare function extractSourceStamps(markdown: string): string[];
/**
 * Multiset diff of `(Source: …)` stamps between `beforeText` and `afterText`,
 * accounting for merged citations (substring match up to the merged stamp's
 * count) and explicit `droppedSources` overrides.
 */
export declare function missingSourceStamps(beforeText: string, afterText: string, droppedSources?: readonly string[]): {
    source: string;
    before: number;
    after: number;
}[];
/**
 * Inserts or updates `- [Title](rel): summary` (or `- [Title](rel)` when no
 * summary is known) in an `index.md` body. Preserves existing title/summary
 * when omitted on update, and keeps summary-less legacy lines intact.
 */
export declare function upsertIndexLine(indexBody: string, rel: string, title?: string, summary?: string, _created?: boolean, headerTitle?: string): string;
export interface SearchablePage {
    path: string;
    text: string;
    scope?: KnowledgeScope;
    botId?: string;
    botName?: string;
}
/** Pages that hold every term (case-insensitive), with the lines holding any of them. */
export declare function searchPages(pages: readonly SearchablePage[], query: string): KnowledgeSearch;
/** An entry ends with its source, the day it was added and who added it. */
export declare function stampEntry(text: string, source: string, author: string, day: string): string;
export interface KnowledgeOptions {
    remote: string;
    dir: string;
    /** The day an entry is stamped with, `YYYY-MM-DD`; today in UTC by default. */
    today?: () => string;
}
export declare const MISSING_SCOPE_ERROR = "Refused: scope is required (\"bot\" or \"shared\"). Use \"bot\" for your own area's working knowledge (repo conventions, your workflows), or \"shared\" for durable facts about hosts and the fleet that other bots and workers need.";
export declare function openKnowledgeBase({ remote, dir, today }: KnowledgeOptions): KnowledgeBase;
