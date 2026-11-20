// Generated from src/core/knowledge.ts; edit that source and run npm run build:core.
export declare const KNOWLEDGE_SETTING = "knowledgeRemote";
/** A request the knowledge base refuses; `status` is the HTTP answer. */
export declare class KnowledgeError extends Error {
    readonly status: number;
    constructor(message: string, status: number);
}
export interface KnowledgeHit {
    path: string;
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
export interface KnowledgeWrite {
    /** The page's slug, such as `beelink`; `topics/beelink.md` and `beelink.md` name it too. */
    page: string;
    /** `append` adds one entry; `replace` writes the whole page, for tidying it. */
    mode: 'append' | 'replace';
    text: string;
    /** Where the fact comes from; required for an entry. */
    source?: string;
    /** A new page's title; the slug's words by default. */
    title?: string;
    /** Who wrote it: stamped on an entry and named in the commit. */
    author: string;
}
export interface KnowledgeWriteResult {
    path: string;
    created: boolean;
    /** The new commit, or null when the page was unchanged. */
    commit: string | null;
    pushed: boolean;
    pushError?: string;
}
export interface KnowledgeBase {
    readonly remote: string;
    readonly dir: string;
    search(query: string): Promise<KnowledgeSearch>;
    /** A page, or the index when none is named. */
    read(page?: string): Promise<{
        path: string;
        text: string;
    }>;
    write(entry: KnowledgeWrite): Promise<KnowledgeWriteResult>;
}
/** The repository path a page name means; the index for an empty name. */
export declare function knowledgePagePath(page: string | undefined): string;
/** Pages that hold every term (case-insensitive), with the lines holding any of them. */
export declare function searchPages(pages: readonly {
    path: string;
    text: string;
}[], query: string): KnowledgeSearch;
/** An entry ends with its source, the day it was added and who added it. */
export declare function stampEntry(text: string, source: string, author: string, day: string): string;
export interface KnowledgeOptions {
    remote: string;
    dir: string;
    /** The day an entry is stamped with, `YYYY-MM-DD`; today in UTC by default. */
    today?: () => string;
}
export declare function openKnowledgeBase({ remote, dir, today }: KnowledgeOptions): KnowledgeBase;
